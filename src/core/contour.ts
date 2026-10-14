import { type Mask, type Raster, fillHoles, largestComponent, labelComponents, maskArea } from './raster';
import { signedDistance, thresholdField, closeMask, squaredDistance } from './distance';
import {
  alphaCoverage, coverageFromMask, selectParts, bridgeParts, isoContour, roundedRect, maskOutline, decodeRle,
} from './shape';
import { transformPoints, flattenClosedPath, type Pt, type Affine } from './geometry';
import type { RegionSource } from './project';
import { resampleClosed, gaussianClosed, tangentsClosed, detectCorners, fitG1Closed, selfIntersects } from './spline';

export interface CutShapeOptions {
  /** Kaynak raster pikseli / mm (öğenin baskı ölçeğinde). */
  pxPerMm: number;
  alphaThreshold: number;
  /** İşaretli; pozitif dışarı. */
  offsetMm: number;
  /** Sıkılık: 2r'den dar girintiler köprülenir. */
  closingMm: number;
  /** Dışbükey köşe yuvarlama; yalnızca max(0, offset)'ten büyükse etkili. */
  cornerRadiusMm: number;
  /** Opak PNG dikdörtgeninin köşe yarıçapı. */
  rectCornerRadiusMm: number;
  smoothMm: number;
  /** Fit toleransı (en büyük sapma). */
  simplifyMm: number;
  /** Bu açıdan sivri köşeler korunur; 0 = kapalı. */
  cornerAngleDeg: number;
  /** Ana parçaya bu mesafedeki parçalar köprülenir; 0 = yalnızca en büyük parça. */
  bridgeMm: number;
  minPartRatio: number;
  /** Çizime yakınlık ölçümü eşiği; 0 = ölçme. */
  tightMm: number;
  maxWorkSize?: number;
  workPxPerMm?: number;
}

export interface Clearance { minMm: number; insideRatio: number; worst: Pt | null }
export interface CutShape {
  /** Kaynak raster pikselinde kapalı, tutamaçlı yol. */
  points: Pt[];
  extraPartsRatio: number;
  partsBridged: number;
  clearance: Clearance;
  stats: { anchors: number; lines: number; workSize: number; ms: number };
}

export type StickerErrorCode = 'NO_ALPHA' | 'EMPTY' | 'OFFSET_EMPTY';
export class StickerError extends Error {
  constructor(public code: StickerErrorCode, message: string) {
    super(message);
    this.name = 'StickerError';
  }
}

export function isFullyOpaque(r: Raster): boolean {
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] < 250) return false;
  return true;
}

// Saat yönünde 8 komşu (y aşağı): B, KB, K, KD, D, GD, G, GB
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
const dirIndex = (dx: number, dy: number) => {
  for (let d = 0; d < 8; d++) if (DX[d] === dx && DY[d] === dy) return d;
  return -1;
};

/** Moore komşuluk takibi (piksel merkezleri). Eşleştirmede kaba silüet için kullanılır. */
export function traceBoundary(m: Mask): Pt[] {
  const { width: w, height: h, data } = m;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < w * h; i++) if (data[i]) { start = i; break; }
  if (start < 0) return [];
  const sx = start % w, sy = (start / w) | 0;
  const pts: Pt[] = [];
  let x = sx, y = sy;
  let back = 0;
  const limit = 4 * w * h + 8;
  for (let iter = 0; iter < limit; iter++) {
    pts.push({ x, y });
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = x + DX[d], ny = y + DY[d];
      if (!on(nx, ny)) continue;
      const pd = (back + k - 1) % 8;
      const bx = x + DX[pd], by = y + DY[pd];
      x = nx;
      y = ny;
      back = dirIndex(bx - x, by - y);
      moved = true;
      break;
    }
    if (!moved) break;
    if (x === sx && y === sy) break;
  }
  return pts;
}

function douglasPeucker(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy;
    let far = -1, fd = eps;
    for (let i = a + 1; i < b; i++) {
      const t = len2 ? Math.max(0, Math.min(1, ((pts[i].x - A.x) * dx + (pts[i].y - A.y) * dy) / len2)) : 0;
      const d = Math.hypot(pts[i].x - A.x - t * dx, pts[i].y - A.y - t * dy);
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function simplifyClosed(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = douglasPeucker(pts.slice(0, far + 1), eps);
  const b = douglasPeucker([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Bölge maskesinin bbox-yerel tasarım pikselinde sade dış hattı (kırpma ve önizleme için). */
export function regionOutline(region: RegionSource): Pt[] {
  const mask = decodeRle(region.rle, region.bbox.w, region.bbox.h);
  return simplifyClosed(maskOutline(largestComponent(mask).mask), 0.5);
}

interface WorkGrid { f: number; padPx: number; pxPerMmW: number }

/** Çalışma çözünürlüğü: 32 px/mm, 1024 px tavan, asla büyütme; en büyük yarıçap kadar pad. */
function workGrid(long: number, o: CutShapeOptions): WorkGrid {
  const padMm = Math.max(o.closingMm, o.bridgeMm, Math.max(0, o.offsetMm), o.cornerRadiusMm, 0) + 0.1;
  const padRaw = padMm * o.pxPerMm;
  const target = Math.min(o.maxWorkSize ?? 1024, (o.workPxPerMm ?? 32) * (long / o.pxPerMm + 2 * padMm));
  const f = Math.min(1, target / (long + 2 * padRaw));
  return { f, padPx: Math.ceil(padRaw * f), pxPerMmW: o.pxPerMm * f };
}

function countLines(path: Pt[]): number {
  let lines = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    if (!a.handleOut && !b.handleIn) lines++;
  }
  return lines;
}

function rectShape(w: number, h: number, o: CutShapeOptions, started: number): CutShape {
  const points = roundedRect(w, h, o.offsetMm * o.pxPerMm, o.rectCornerRadiusMm * o.pxPerMm);
  if (!points.length) throw new StickerError('OFFSET_EMPTY', 'İçe ofset sticker boyutundan büyük; kesim çizgisi oluşturulamadı.');
  return {
    points, extraPartsRatio: 0, partsBridged: 0,
    clearance: { minMm: o.offsetMm, insideRatio: o.offsetMm < 0 ? 1 : 0, worst: null },
    stats: { anchors: points.length, lines: countLines(points), workSize: Math.max(w, h), ms: performance.now() - started },
  };
}

/** Alan değerini sürekli koordinatta çift doğrusal örnekler (piksel merkezleri i+0.5). */
function sampleField(field: Float32Array, w: number, h: number, x: number, y: number): number {
  const u = Math.min(Math.max(x - 0.5, 0), w - 1), v = Math.min(Math.max(y - 0.5, 0), h - 1);
  const i0 = Math.min(Math.floor(u), w - 2), j0 = Math.min(Math.floor(v), h - 2);
  const fx = u - i0, fy = v - j0;
  const f00 = field[j0 * w + i0], f10 = field[j0 * w + i0 + 1], f01 = field[(j0 + 1) * w + i0], f11 = field[(j0 + 1) * w + i0 + 1];
  return (f00 * (1 - fx) + f10 * fx) * (1 - fy) + (f01 * (1 - fx) + f11 * fx) * fy;
}

/** Çalışma ızgarasındaki (pad'li) maskeden kesim yolu üretir; sonuç çalışma pikselindedir. */
function cutFromWork(m0: Mask, grid: WorkGrid, o: CutShapeOptions, started: number): CutShape {
  const { width: w, height: h } = m0;
  const px = (mm: number) => mm * grid.pxPerMmW;
  const parts = selectParts(m0, o.minPartRatio);
  if (!parts.kept) throw new StickerError('EMPTY', 'Bu PNG tamamen şeffaf, kesilecek bir şekil yok.');
  const art = fillHoles(parts.mask); // çizim silüeti
  let dropped = parts.droppedRatio, bridged = 0;
  const closingPx = px(o.closingMm);
  let shape = closingPx >= 0.5 ? closeMask(art, closingPx) : art;
  if (labelComponents(shape).areas.length > 2) {
    const bridgePx = px(o.bridgeMm);
    if (bridgePx > 0) {
      const b = bridgeParts(shape, bridgePx);
      shape = b.mask; bridged = b.bridged; dropped = Math.max(dropped, b.droppedRatio);
    }
    if (labelComponents(shape).areas.length > 2) {
      const lc = largestComponent(shape);
      dropped = Math.max(dropped, lc.otherAreas.reduce((a, b) => Math.max(a, b), 0) / lc.area);
      shape = lc.mask;
    }
  }
  shape = fillHoles(shape);
  const sdf = signedDistance(shape);
  const offsetPx = px(o.offsetMm), cornerPx = px(o.cornerRadiusMm);
  let iso;
  if (cornerPx > Math.max(0, offsetPx) + 0.5) {
    const eroded = thresholdField(sdf, w, h, offsetPx - cornerPx);
    if (!maskArea(eroded)) throw new StickerError('OFFSET_EMPTY', 'İçe ofset ve köşe yuvarlama şekli tamamen siliyor; değerleri azaltın.');
    const d = squaredDistance(eroded);
    for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
    iso = isoContour(d, w, h, cornerPx);
  } else {
    iso = isoContour(sdf, w, h, offsetPx);
  }
  if (!iso.points.length) throw new StickerError('OFFSET_EMPTY', 'İçe ofset sticker şeklini tamamen siliyor; değeri azaltın.');
  const extraPartsRatio = Math.max(dropped, iso.otherAreas.reduce((a, b) => Math.max(a, b), 0) / iso.area);

  // Vektör aşaması
  const step = Math.max(px(0.1), 1);
  const resampled = resampleClosed(iso.points, step);
  let sigmaPx = Math.max(px(o.smoothMm), 1);
  let smooth = gaussianClosed(resampled, sigmaPx / step);
  while (sigmaPx > 1 && selfIntersects(smooth)) {
    sigmaPx = Math.max(1, sigmaPx / 2);
    smooth = gaussianClosed(resampled, sigmaPx / step);
  }
  const tangents = tangentsClosed(smooth);
  const rRound = Math.max(offsetPx, cornerPx, closingPx, 0);
  const reach = Math.ceil((Math.max(rRound * Math.PI / 2, px(0.5)) + 2 * sigmaPx) / step);
  const corners = o.cornerAngleDeg > 0 ? detectCorners(smooth, tangents, o.cornerAngleDeg, reach, 3 * rRound + step) : [];
  const tolerance = Math.max(px(o.simplifyMm), 0.3);
  const path = fitG1Closed(smooth, tangents, tolerance, corners);

  // Çizime yakınlık: işaretli uzaklık (içeride negatif)
  let clearance: Clearance = { minMm: Infinity, insideRatio: 0, worst: null };
  if (o.tightMm > 0 && path.length >= 3) {
    const artSdf = signedDistance(art);
    // Düz kısımlarda seyrek kalmasın diye 1 px adımla yeniden örnekle (ince çıkıntılar atlanmasın).
    const flat = resampleClosed(flattenClosedPath(path, 0.25), 1);
    let inside = 0, min = Infinity, worst: Pt | null = null;
    for (const p of flat) {
      const d = sampleField(artSdf, w, h, p.x, p.y);
      if (d < 0) inside++;
      if (d < min) { min = d; worst = p; }
    }
    clearance = { minMm: min / grid.pxPerMmW, insideRatio: flat.length ? inside / flat.length : 0, worst };
  }
  return {
    points: path, extraPartsRatio, partsBridged: bridged, clearance,
    stats: { anchors: path.length, lines: countLines(path), workSize: Math.max(w, h), ms: performance.now() - started },
  };
}

function toSource(shape: CutShape, grid: WorkGrid): CutShape {
  const m: Affine = [1 / grid.f, 0, 0, 1 / grid.f, -grid.padPx / grid.f, -grid.padPx / grid.f];
  return {
    ...shape,
    points: transformPoints(m, shape.points),
    clearance: { ...shape.clearance, worst: shape.clearance.worst ? transformPoints(m, [shape.clearance.worst])[0] : null },
  };
}

/** Sticker PNG'sinden kesim yolu (kaynak raster pikselinde). Tamamen opak PNG → (yuvarlak köşeli) dikdörtgen. */
export function stickerCutShape(r: Raster, o: CutShapeOptions): CutShape {
  const started = performance.now();
  if (isFullyOpaque(r)) return rectShape(r.width, r.height, o, started);
  const grid = workGrid(Math.max(r.width, r.height), o);
  const m0 = alphaCoverage(r, o.alphaThreshold, grid.f, grid.padPx);
  return toSource(cutFromWork(m0, grid, o, started), grid);
}

/** Tasarım bölgesi maskesinden (bbox-yerel piksel) kesim yolu. Bbox'ın ≥ %99'unu dolduran maske dikdörtgen sayılır. */
export function cutShapeFromMask(mask: Mask, o: CutShapeOptions): CutShape {
  const started = performance.now();
  const area = maskArea(mask);
  if (!area) throw new StickerError('EMPTY', 'Bölge boş; kesilecek bir şekil yok.');
  if (area >= 0.99 * mask.width * mask.height) return rectShape(mask.width, mask.height, o, started);
  const grid = workGrid(Math.max(mask.width, mask.height), o);
  const m0 = coverageFromMask(mask, grid.f, grid.padPx);
  return toSource(cutFromWork(m0, grid, o, started), grid);
}
