import { type Pack, mmPerDesignPx } from './project';
import {
  type Affine, type Coord, type Pt, transformPoints, flattenPath, polygonBounds, pointInPolygon,
  pointSegmentDistanceSquared, polygonArea, polylineLength,
} from './geometry';
import type { Message } from './pipeline';

export interface CompareOptions {
  sampleMm?: number;   // ince örnekleme aralığı (0.2)
  coarseMm?: number;   // aday sıralaması için kaba aralık (1)
  flattenMm?: number;  // Bézier düzleştirme toleransı (0.05)
  meanMm?: number;     // "eşleşiyor" için ortalama sapma sınırı (0.25)
  maxMm?: number;      // "eşleşiyor" için Hausdorff sınırı (0.8)
  searchMm?: number;   // aday eşleme için en büyük uzaklık (8)
}
const DEFAULTS: Required<CompareOptions> = { sampleMm: 0.2, coarseMm: 1, flattenMm: 0.05, meanMm: 0.25, maxMm: 0.8, searchMm: 8 };

export type Verdict = 'eşleşiyor' | 'sapıyor' | 'eşleşme yok';
export interface PathStats { anchors: number; curves: number; lines: number; lengthMm: number; areaMm2: number; bboxMm: { minX: number; minY: number; maxX: number; maxY: number } }
export interface ItemComparison {
  itemId: string; file: string; ref: number | null; verdict: Verdict;
  meanMm: number | null; hausdorffMm: number | null; signedMeanMm: number | null;
  tool: PathStats; refStats: PathStats | null;
}
export interface CompareResult {
  items: ItemComparison[];
  unmatchedRefs: { index: number; stats: PathStats }[];
  summary: { items: number; matched: number; deviating: number; missing: number; extraRefs: number; meanMm: number | null; maxHausdorffMm: number | null; suggestedOffsetMm: number | null };
  messages: Message[];
}

interface Shape { pts: Pt[]; flat: Pt[]; fine: Pt[]; coarse: Pt[]; bbox: PathStats['bboxMm']; centroid: Coord }

/** mm cinsinden kapalı yolun istatistikleri. */
export function pathStats(pts: Pt[]): PathStats {
  let curves = 0;
  for (let i = 0; i < pts.length; i++) if (pts[i].handleOut || pts[(i + 1) % pts.length].handleIn) curves++;
  const b = polygonBounds(pts);
  return {
    anchors: pts.length, curves, lines: pts.length - curves,
    lengthMm: polylineLength(pts, true, DEFAULTS.flattenMm), areaMm2: polygonArea(pts, DEFAULTS.flattenMm),
    bboxMm: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY },
  };
}

/** Kapalı çokgeni, ardışık örnekler en fazla step aralıklı olacak şekilde sıklaştırır. */
function densify(flat: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i], b = flat[(i + 1) % flat.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

function prepare(pts: Pt[], o: Required<CompareOptions>): Shape {
  const flat = flattenPath(pts, true, o.flattenMm);
  const fine = densify(flat, o.sampleMm);
  let sx = 0, sy = 0;
  for (const p of fine) { sx += p.x; sy += p.y; }
  const n = Math.max(1, fine.length);
  return { pts, flat, fine, coarse: densify(flat, o.coarseMm), bbox: polygonBounds(flat), centroid: { x: sx / n, y: sy / n } };
}

/** Her örneğin çokgenin kenarlarına en kısa uzaklığı. */
function directed(samples: Pt[], poly: Pt[]): { mean: number; max: number; dists: number[] } {
  let sum = 0, max = 0;
  const dists = samples.map((p) => {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const d = pointSegmentDistanceSquared(p, poly[j], poly[i]);
      if (d < best) { best = d; if (best < 1e-8) break; }
    }
    const dist = Math.sqrt(best);
    sum += dist;
    if (dist > max) max = dist;
    return dist;
  });
  return { mean: samples.length ? sum / samples.length : 0, max, dists };
}

function distance(a: Shape, b: Shape, fine: boolean): { meanMm: number; hausdorffMm: number; signedMeanMm: number } {
  const ab = directed(fine ? a.fine : a.coarse, b.flat), ba = directed(fine ? b.fine : b.coarse, a.flat);
  let signed = 0;
  if (fine) {
    // Araç örneği referans çokgeninin dışındaysa pozitif, içindeyse negatif.
    a.fine.forEach((p, i) => { signed += pointInPolygon(p, b.flat) ? -ab.dists[i] : ab.dists[i]; });
    signed /= Math.max(1, a.fine.length);
  }
  return { meanMm: (ab.mean + ba.mean) / 2, hausdorffMm: Math.max(ab.max, ba.max), signedMeanMm: signed };
}

export function pathDistance(aMm: Pt[], bMm: Pt[], opts: CompareOptions = {}): { meanMm: number; hausdorffMm: number; signedMeanMm: number } {
  const o = { ...DEFAULTS, ...opts };
  return distance(prepare(aMm, o), prepare(bMm, o), true);
}

const near = (a: Shape, b: Shape, s: number) =>
  a.bbox.minX - b.bbox.maxX <= 2 * s && b.bbox.minX - a.bbox.maxX <= 2 * s &&
  a.bbox.minY - b.bbox.maxY <= 2 * s && b.bbox.minY - a.bbox.maxY <= 2 * s &&
  Math.hypot(a.centroid.x - b.centroid.x, a.centroid.y - b.centroid.y) <= s;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const fmt = (v: number) => String(Math.round(v * 100) / 100);

export function comparePaths(pack: Pack, cuts: Map<string, Pt[]>, refs: Pt[][], opts: CompareOptions = {}): CompareResult {
  const o = { ...DEFAULTS, ...opts };
  const mm = mmPerDesignPx(pack);
  const toMm: Affine = [mm.x, 0, 0, mm.y, 0, 0];
  const files = new Map(pack.items.map((i) => [i.id, i.file]));
  const tools = [...cuts].map(([itemId, pts]) => ({ itemId, file: files.get(itemId) ?? '', shape: prepare(transformPoints(toMm, pts), o) }));
  const refShapes = refs.map((pts) => prepare(transformPoints(toMm, pts), o));

  // Aday çiftleri kaba sapmayla sırala, en küçükten başlayarak bire bir eşle.
  const pairs: { score: number; t: number; r: number }[] = [];
  tools.forEach((tool, t) => refShapes.forEach((ref, r) => {
    if (near(tool.shape, ref, o.searchMm)) pairs.push({ score: distance(tool.shape, ref, false).meanMm, t, r });
  }));
  pairs.sort((a, b) => a.score - b.score);
  const refOf = new Array<number>(tools.length).fill(-1), taken = new Set<number>();
  for (const p of pairs) if (refOf[p.t] < 0 && !taken.has(p.r)) { refOf[p.t] = p.r; taken.add(p.r); }

  const messages: Message[] = [];
  const items: ItemComparison[] = tools.map((tool, t) => {
    const r = refOf[t];
    const stats = pathStats(tool.shape.pts);
    if (r < 0) {
      messages.push({ level: 'warning', code: 'REF_MISSING', itemId: tool.itemId, file: tool.file, text: `${tool.itemId} kesim çizgisinin referansta karşılığı yok.` });
      return { itemId: tool.itemId, file: tool.file, ref: null, verdict: 'eşleşme yok', meanMm: null, hausdorffMm: null, signedMeanMm: null, tool: stats, refStats: null };
    }
    const d = distance(tool.shape, refShapes[r], true);
    const verdict: Verdict = d.meanMm <= o.meanMm && d.hausdorffMm <= o.maxMm ? 'eşleşiyor' : 'sapıyor';
    if (verdict === 'sapıyor') {
      messages.push({ level: 'warning', code: 'REF_DEVIATION', itemId: tool.itemId, file: tool.file,
        text: `${tool.itemId} kesim çizgisi referanstan sapıyor: ort. ${d.meanMm.toFixed(2)} mm, maks ${d.hausdorffMm.toFixed(1)} mm.` });
    }
    return { itemId: tool.itemId, file: tool.file, ref: r, verdict, ...d, tool: stats, refStats: pathStats(refShapes[r].pts) };
  });
  const unmatchedRefs = refShapes.map((s, index) => ({ index, stats: pathStats(s.pts) })).filter((u) => !taken.has(u.index));
  const compared = items.filter((i) => i.ref !== null);
  const signedMedian = median(compared.map((i) => i.signedMeanMm!));
  const suggestedOffsetMm = signedMedian !== null && Math.abs(signedMedian) > 0.05 ? -signedMedian : null;

  if (unmatchedRefs.length) messages.push({ level: 'info', code: 'REF_EXTRA', text: `Referansta aracın üretmediği ${unmatchedRefs.length} kesim yolu var.` });
  if (suggestedOffsetMm !== null) {
    const amount = fmt(Math.abs(suggestedOffsetMm)), outside = suggestedOffsetMm < 0;
    messages.push({ level: 'info', code: 'REF_OFFSET_HINT',
      text: `Kesim çizgileri referansa göre ortalama ${amount} mm ${outside ? 'dışarıda' : 'içeride'}; offsetMm değerini ${amount} mm ${outside ? 'azaltmayı' : 'artırmayı'} dene.` });
  }
  return {
    items, unmatchedRefs,
    summary: {
      items: items.length,
      matched: items.filter((i) => i.verdict === 'eşleşiyor').length,
      deviating: items.filter((i) => i.verdict === 'sapıyor').length,
      missing: items.length - compared.length,
      extraRefs: unmatchedRefs.length,
      meanMm: compared.length ? compared.reduce((s, i) => s + i.meanMm!, 0) / compared.length : null,
      maxHausdorffMm: compared.length ? Math.max(...compared.map((i) => i.hausdorffMm!)) : null,
      suggestedOffsetMm,
    },
    messages,
  };
}
