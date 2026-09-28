import {
  type BBox, type Mask, type Raster, createMask, alphaMask, downscaleMask, largestComponent,
  labelComponents, fillHoles, dilateSquare, erodeSquare,
} from './raster';
import { compositeOverWhite } from './render';

export interface MatchOptions { diffThreshold: number; minAreaRatio: number; reviewBelow: number; rejectBelow: number }
export const DEFAULT_MATCH_OPTIONS: MatchOptions = { diffThreshold: 48, minAreaRatio: 0.001, reviewBelow: 0.85, rejectBelow: 0.5 };

export interface StickerInput { file: string; raster: Raster }
/** scale: tasarım px / raster px */
export interface MatchedItem { file: string; x: number; y: number; scale: number; score: number; needsReview: boolean }
export interface MatchResult { items: MatchedItem[]; unusedStickers: string[]; unmatchedRegions: BBox[] }
export interface Region { bbox: BBox; mask: Mask }

interface Prepared { file: string; raster: Raster; bbox: BBox }
/** tasarım = t + s·sticker */
interface Placement { s: number; tx: number; ty: number }

/** Girdiler opak (compositeOverWhite sonrası) olmalı. */
export function diffMask(design: Raster, background: Raster, threshold: number): Mask {
  const a = design.data, b = background.data;
  const m = createMask(design.width, design.height);
  for (let i = 0, o = 0; i < m.data.length; i++, o += 4) {
    const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
    m.data[i] = d > threshold ? 1 : 0;
  }
  return m;
}

export function findRegions(diff: Mask, minAreaRatio: number): Region[] {
  const opened = dilateSquare(erodeSquare(diff, 1), 1);
  const closed = erodeSquare(dilateSquare(opened, 4), 4);
  const { labels, areas } = labelComponents(closed);
  const w = closed.width;
  const box = areas.map(() => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1 }));
  for (let i = 0; i < labels.length; i++) {
    const k = labels[i];
    if (!k) continue;
    const x = i % w, y = (i / w) | 0, b = box[k];
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
  }
  const minArea = minAreaRatio * diff.width * diff.height;
  const regions: Region[] = [];
  for (let k = 1; k < areas.length; k++) {
    if (areas[k] < minArea) continue;
    const b = box[k];
    const bbox = { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
    const crop = createMask(bbox.w, bbox.h);
    for (let y = 0; y < bbox.h; y++) for (let x = 0; x < bbox.w; x++) {
      crop.data[y * bbox.w + x] = labels[(bbox.y + y) * w + bbox.x + x] === k ? 1 : 0;
    }
    regions.push({ bbox, mask: fillHoles(crop) });
  }
  return regions.sort((p, q) => p.bbox.y - q.bbox.y || p.bbox.x - q.bbox.x);
}

/** Kaçak lekeleri hariç tutan, en büyük parçanın tam çözünürlükte sıkı sınırı. */
function prepareSticker(s: StickerInput): Prepared | null {
  const r = s.raster;
  const full = alphaMask(r, 128);
  const small = downscaleMask(full, Math.min(1, 512 / Math.max(r.width, r.height)));
  const { mask: keep, area } = largestComponent(small);
  if (!area) return null;
  const keepD = dilateSquare(keep, 1);
  const sx = r.width / small.width, sy = r.height / small.height;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < r.height; y++) {
    const ky = Math.min(small.height - 1, Math.floor(y / sy));
    for (let x = 0; x < r.width; x++) {
      if (!full.data[y * r.width + x]) continue;
      if (!keepD.data[ky * small.width + Math.min(small.width - 1, Math.floor(x / sx))]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { file: s.file, raster: r, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

/** IoU(silüet) × renk benzerliği, bölge üzerinde n×n örnekle. */
function score(design: Raster, region: Region, st: Prepared, pl: Placement, n: number): number {
  const { bbox, mask } = region;
  const r = st.raster;
  let inter = 0, union = 0, diffSum = 0, diffCount = 0;
  for (let j = 0; j < n; j++) {
    const Y = Math.floor(bbox.y + ((j + 0.5) * bbox.h) / n);
    for (let i = 0; i < n; i++) {
      const X = Math.floor(bbox.x + ((i + 0.5) * bbox.w) / n);
      const regionOn = mask.data[(Y - bbox.y) * mask.width + (X - bbox.x)] === 1;
      const u = Math.floor((X + 0.5 - pl.tx) / pl.s), v = Math.floor((Y + 0.5 - pl.ty) / pl.s);
      const inside = u >= 0 && v >= 0 && u < r.width && v < r.height;
      const so = (v * r.width + u) * 4;
      const a = inside ? r.data[so + 3] : 0;
      const stOn = a >= 128;
      if (regionOn || stOn) union++;
      if (regionOn && stOn) inter++;
      if (a >= 250) {
        const d = (Y * design.width + X) * 4;
        diffSum += (Math.abs(r.data[so] - design.data[d]) + Math.abs(r.data[so + 1] - design.data[d + 1])
          + Math.abs(r.data[so + 2] - design.data[d + 2])) / 3;
        diffCount++;
      }
    }
  }
  if (!union || !diffCount) return 0;
  return (inter / union) * (1 - diffSum / diffCount / 255);
}

/** Merkez ve ölçek üzerinde tepe tırmanma. */
function refine(design: Raster, region: Region, st: Prepared, start: Placement): { pl: Placement; score: number } {
  const cu = st.bbox.x + st.bbox.w / 2, cv = st.bbox.y + st.bbox.h / 2;
  const at = (cx: number, cy: number, s: number): Placement => ({ s, tx: cx - s * cu, ty: cy - s * cv });
  let cx = start.tx + start.s * cu, cy = start.ty + start.s * cv, s = start.s;
  let best = score(design, region, st, start, 96);
  for (const step of [2, 1, 0.5]) {
    for (let iter = 0; iter < 10; iter++) {
      let improved = false;
      for (const ds of [1 - 0.005 * step, 1, 1 + 0.005 * step]) {
        for (const dx of [-step, 0, step]) {
          for (const dy of [-step, 0, step]) {
            if (ds === 1 && dx === 0 && dy === 0) continue;
            const cand = at(cx + dx, cy + dy, s * ds);
            const sc = score(design, region, st, cand, 96);
            if (sc > best) { best = sc; cx += dx; cy += dy; s *= ds; improved = true; }
          }
        }
      }
      if (!improved) break;
    }
  }
  return { pl: at(cx, cy, s), score: best };
}

export function matchStickers(
  design: Raster, background: Raster, stickers: StickerInput[], options: Partial<MatchOptions> = {},
): MatchResult {
  if (design.width !== background.width || design.height !== background.height) {
    throw new Error('Tam tasarım ve arka plan aynı boyutta olmalı.');
  }
  const o = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const dc = compositeOverWhite(design);
  const regions = findRegions(diffMask(dc, compositeOverWhite(background), o.diffThreshold), o.minAreaRatio);
  const prepared = stickers.map(prepareSticker).filter((p): p is Prepared => p !== null);
  const used = new Set<string>();
  const items: MatchedItem[] = [];
  const unmatchedRegions: BBox[] = [];
  for (const region of regions) {
    let best: { st: Prepared; pl: Placement; score: number } | null = null;
    for (const st of prepared) {
      const sx = region.bbox.w / st.bbox.w, sy = region.bbox.h / st.bbox.h;
      if (Math.abs(sx / sy - 1) > 0.1) continue;
      const s = (sx + sy) / 2;
      const pl = {
        s,
        tx: region.bbox.x + region.bbox.w / 2 - s * (st.bbox.x + st.bbox.w / 2),
        ty: region.bbox.y + region.bbox.h / 2 - s * (st.bbox.y + st.bbox.h / 2),
      };
      const sc = score(dc, region, st, pl, 48);
      if (!best || sc > best.score) best = { st, pl, score: sc };
    }
    if (!best || best.score < o.rejectBelow) { unmatchedRegions.push(region.bbox); continue; }
    const { pl, score: sc } = refine(dc, region, best.st, best.pl);
    used.add(best.st.file);
    items.push({
      file: best.st.file,
      x: pl.tx + (pl.s * best.st.raster.width) / 2,
      y: pl.ty + (pl.s * best.st.raster.height) / 2,
      scale: pl.s,
      score: sc,
      needsReview: sc < o.reviewBelow,
    });
  }
  return { items, unusedStickers: stickers.map((s) => s.file).filter((f) => !used.has(f)), unmatchedRegions };
}
