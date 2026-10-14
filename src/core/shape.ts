import { type Mask, type Raster, createMask, labelComponents, largestComponent } from './raster';
import { squaredDistance, closeMask, thresholdField } from './distance';
import type { Pt } from './geometry';

/**
 * Raster şekil aşaması: alfa → kapsama maskesi → parça seçimi/köprüleme → uzaklık alanı → alt piksel kontur.
 * Tüm birimler çalışma pikseli; mm dönüşümünü contour.ts yapar.
 */

/** Alfa kanalını f oranında kutu filtreyle küçültür; blok ortalaması eşiği geçen pikseller dolu olur. Çevresine pad ekler. */
export function alphaCoverage(r: Raster, threshold: number, f: number, pad: number): Mask {
  const w2 = Math.max(1, Math.round(r.width * f)), h2 = Math.max(1, Math.round(r.height * f));
  const out = createMask(w2 + 2 * pad, h2 + 2 * pad);
  const sx = r.width / w2, sy = r.height / h2;
  for (let y = 0; y < h2; y++) {
    const v0 = Math.floor(y * sy), v1 = Math.max(v0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w2; x++) {
      const u0 = Math.floor(x * sx), u1 = Math.max(u0 + 1, Math.floor((x + 1) * sx));
      let sum = 0, n = 0;
      for (let v = v0; v < v1; v++) {
        let o = (v * r.width + u0) * 4 + 3;
        for (let u = u0; u < u1; u++, o += 4) { sum += r.data[o]; n++; }
      }
      out.data[(y + pad) * out.width + x + pad] = sum >= threshold * n ? 1 : 0;
    }
  }
  return out;
}

export interface PartsResult { mask: Mask; kept: number; droppedRatio: number }

/** En büyük parçaya göre minPartRatio'dan küçük parçaları atar. droppedRatio = atılan en büyük parça / ana parça. */
export function selectParts(m: Mask, minPartRatio: number): PartsResult {
  const { labels, areas } = labelComponents(m);
  let best = 0;
  for (let k = 1; k < areas.length; k++) if (areas[k] > areas[best]) best = k;
  const mask = createMask(m.width, m.height);
  if (!best) return { mask, kept: 0, droppedRatio: 0 };
  const main = areas[best];
  const keep = new Uint8Array(areas.length);
  let kept = 0, maxDropped = 0;
  for (let k = 1; k < areas.length; k++) {
    if (areas[k] >= minPartRatio * main) { keep[k] = 1; kept++; } else if (areas[k] > maxDropped) maxDropped = areas[k];
  }
  for (let i = 0; i < labels.length; i++) mask.data[i] = keep[labels[i]];
  return { mask, kept, droppedRatio: maxDropped / main };
}

export interface BridgeResult { mask: Mask; bridged: number; droppedRatio: number }

/**
 * Ana parçaya en fazla bridgePx uzaklıktaki parçaları, yalnızca aralarındaki boyunda dolgu yaparak ana parçaya bağlar.
 * Daha uzaktaki parçalar atılır. Maske, bridgePx/2 kadar pad'lenmiş olmalı.
 */
export function bridgeParts(m: Mask, bridgePx: number): BridgeResult {
  const { labels, areas } = labelComponents(m);
  const order = areas.map((_, k) => k).filter((k) => k > 0).sort((a, b) => areas[b] - areas[a]);
  if (order.length < 2) return { mask: { width: m.width, height: m.height, data: m.data.slice() }, bridged: 0, droppedRatio: 0 };
  const n = m.width * m.height;
  const partMask = (k: number): Mask => {
    const p = createMask(m.width, m.height);
    for (let i = 0; i < n; i++) p.data[i] = labels[i] === k ? 1 : 0;
    return p;
  };
  const main = order[0];
  const dMain = squaredDistance(partMask(main));
  const gap = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const k = labels[i];
    if (!k || k === main) continue;
    const g = gap.get(k);
    if (g === undefined || dMain[i] < g) gap.set(k, dMain[i]);
  }
  const keptParts: number[] = [main];
  let maxGap = 0, maxDropped = 0;
  for (const k of order.slice(1)) {
    const g = Math.sqrt(gap.get(k) ?? Infinity);
    if (g <= bridgePx) { keptParts.push(k); if (g > maxGap) maxGap = g; } else if (areas[k] > maxDropped) maxDropped = areas[k];
  }
  const kept = createMask(m.width, m.height);
  const keep = new Uint8Array(areas.length);
  for (const k of keptParts) keep[k] = 1;
  for (let i = 0; i < n; i++) kept.data[i] = keep[labels[i]];
  const droppedRatio = maxDropped / areas[main];
  if (keptParts.length < 2) return { mask: kept, bridged: 0, droppedRatio };
  const fields = keptParts.map((k) => (k === main ? dMain : squaredDistance(partMask(k))));
  // Kapama yarıçapı: düz kenarlar için aralığın yarısı yeter; dışbükey parçalarda boyun aşınır, bağlanana dek büyüt.
  let R = Math.ceil(maxGap / 2) + 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const closed = closeMask(kept, R);
    const limit = (R + 1) * (R + 1);
    const result = createMask(m.width, m.height);
    result.data.set(kept.data);
    for (let i = 0; i < n; i++) {
      if (!closed.data[i] || result.data[i]) continue;
      let near = 0;
      for (const d of fields) if (d[i] <= limit && ++near >= 2) break;
      if (near >= 2) result.data[i] = 1;
    }
    const grown = Math.min(Math.max(bridgePx, R), Math.ceil(R * 1.5));
    if (labelComponents(result).areas.length - 1 === 1 || grown === R) {
      return { mask: result, bridged: keptParts.length - 1, droppedRatio };
    }
    R = grown;
  }
  return { mask: kept, bridged: 0, droppedRatio };
}

/** Çatlak kenarı: a dolu piksel, b hemen yanındaki boş piksel (4 komşu); (vx, vy) kenarın başladığı piksel köşesi. */
export interface CrackEdge { ax: number; ay: number; bx: number; by: number; vx: number; vy: number }

// Yönler saat yönünde (ekranda y aşağı): D, G, B, K
const DIR_X = [1, 0, -1, 0], DIR_Y = [0, 1, 0, -1];
// Köşe noktası v=(vx,vy) pikselin sol üst köşesi; yöne göre ön-sol ve ön-sağ pikseller
const FL_X = [0, 0, -1, -1], FL_Y = [-1, 0, 0, -1];
const FR_X = [0, -1, -1, 0], FR_Y = [0, 0, -1, -1];

/** İlk dolu pikselin parçasının dış sınırını, dolu taraf sağda kalacak şekilde piksel köşelerinden izler (8 komşuluk). */
export function traceCrack(m: Mask): CrackEdge[] {
  const { width: w, height: h, data } = m;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < w * h; i++) if (data[i]) { start = i; break; }
  if (start < 0) return [];
  const sx = start % w, sy = (start / w) | 0;
  const edges: CrackEdge[] = [];
  let vx = sx, vy = sy, d = 0;
  const limit = 4 * w * h + 8;
  for (let iter = 0; iter < limit; iter++) {
    edges.push({ ax: vx + FR_X[d], ay: vy + FR_Y[d], bx: vx + FL_X[d], by: vy + FL_Y[d], vx, vy });
    vx += DIR_X[d];
    vy += DIR_Y[d];
    if (on(vx + FL_X[d], vy + FL_Y[d])) d = (d + 3) % 4;
    else if (!on(vx + FR_X[d], vy + FR_Y[d])) d = (d + 1) % 4;
    if (vx === sx && vy === sy && d === 0) break;
  }
  return edges;
}

export interface IsoResult { points: Pt[]; area: number; otherAreas: number[] }

/** `field ≤ level` bölgesinin en büyük parçasının alt piksel hassasiyetli kapalı konturu (saat yönü, y aşağı). */
export function isoContour(field: ArrayLike<number>, width: number, height: number, level: number): IsoResult {
  const { mask, area, otherAreas } = largestComponent(thresholdField(field, width, height, level));
  if (!area) return { points: [], area: 0, otherAreas };
  const points: Pt[] = [];
  for (const e of traceCrack(mask)) {
    const fa = field[e.ay * width + e.ax];
    const inside = e.bx >= 0 && e.by >= 0 && e.bx < width && e.by < height;
    const fb = inside ? field[e.by * width + e.bx] : NaN;
    let t = fb > fa ? (level - fa) / (fb - fa) : 0.5;
    if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
    points.push({ x: e.ax + 0.5 + t * (e.bx - e.ax), y: e.ay + 0.5 + t * (e.by - e.ay) });
  }
  return { points, area, otherAreas };
}

/** Maskenin ilk parçasının piksel köşelerinden geçen dış hattı (ardışık köşe noktaları, saat yönü). */
export function maskOutline(m: Mask): Pt[] {
  return traceCrack(m).map((e) => ({ x: e.vx, y: e.vy }));
}

/** İkili maskeyi f oranında kutu filtreyle küçültür (kapsama ≥ %50 dolu) ve pad ekler. f = 1 → kopya + pad. */
export function coverageFromMask(m: Mask, f: number, pad: number): Mask {
  const w2 = Math.max(1, Math.round(m.width * f)), h2 = Math.max(1, Math.round(m.height * f));
  const out = createMask(w2 + 2 * pad, h2 + 2 * pad);
  const sx = m.width / w2, sy = m.height / h2;
  for (let y = 0; y < h2; y++) {
    const v0 = Math.floor(y * sy), v1 = Math.max(v0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w2; x++) {
      const u0 = Math.floor(x * sx), u1 = Math.max(u0 + 1, Math.floor((x + 1) * sx));
      let sum = 0, n = 0;
      for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) { sum += m.data[v * m.width + u]; n++; }
      out.data[(y + pad) * out.width + x + pad] = sum * 2 >= n ? 1 : 0;
    }
  }
  return out;
}

const KAPPA = 0.5522847498;

/** Dikdörtgen [-o, w+o]×[-o, h+o], köşeleri radius ile yuvarlanmış; radius 0 → 4 düz köşe. Geçersiz boyutta boş dizi. */
export function roundedRect(w: number, h: number, offset: number, radius: number): Pt[] {
  const x0 = 0 - offset, y0 = 0 - offset, x1 = w + offset, y1 = h + offset;
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return [];
  const r = Math.min(Math.max(0, radius), (x1 - x0) / 2, (y1 - y0) / 2);
  if (r <= 0) return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const k = KAPPA * r;
  const pts: Pt[] = [
    { x: x0 + r, y: y0 }, { x: x1 - r, y: y0 }, // üst kenar
    { x: x1, y: y0 + r }, { x: x1, y: y1 - r }, // sağ kenar
    { x: x1 - r, y: y1 }, { x: x0 + r, y: y1 }, // alt kenar
    { x: x0, y: y1 - r }, { x: x0, y: y0 + r }, // sol kenar
  ];
  const edge = (a: Pt, b: Pt) => {
    a.handleOut = { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    b.handleIn = { x: b.x - (b.x - a.x) / 3, y: b.y - (b.y - a.y) / 3 };
  };
  const arc = (a: Pt, b: Pt, dirA: Pt, dirB: Pt) => {
    a.handleOut = { x: a.x + dirA.x * k, y: a.y + dirA.y * k };
    b.handleIn = { x: b.x + dirB.x * k, y: b.y + dirB.y * k };
  };
  edge(pts[0], pts[1]); arc(pts[1], pts[2], { x: 1, y: 0 }, { x: 0, y: -1 });
  edge(pts[2], pts[3]); arc(pts[3], pts[4], { x: 0, y: 1 }, { x: 1, y: 0 });
  edge(pts[4], pts[5]); arc(pts[5], pts[6], { x: -1, y: 0 }, { x: 0, y: 1 });
  edge(pts[6], pts[7]); arc(pts[7], pts[0], { x: 0, y: -1 }, { x: -1, y: 0 });
  return pts;
}

/** Satır sıralı, boş ile başlayan dolu/boş koşu uzunlukları; base-36, virgülle. */
export function encodeRle(m: Mask): string {
  const runs: number[] = [];
  let current = 0, length = 0;
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i] ? 1 : 0;
    if (v === current) { length++; continue; }
    runs.push(length);
    current = v;
    length = 1;
  }
  runs.push(length);
  return runs.map((n) => n.toString(36)).join(',');
}

export function decodeRle(rle: string, width: number, height: number): Mask {
  const out = createMask(width, height);
  let i = 0, v = 0;
  for (const token of rle.split(',')) {
    const n = parseInt(token, 36);
    if (!Number.isFinite(n) || n < 0) throw new Error('Bölge maskesi (rle) bozuk.');
    if (v) out.data.fill(1, i, i + n);
    i += n;
    v ^= 1;
  }
  if (i !== width * height) throw new Error('Bölge maskesi (rle) boyutla uyuşmuyor.');
  return out;
}
