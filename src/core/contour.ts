import { type Mask, type Raster, alphaMask, downscaleMask, largestComponent, fillHoles } from './raster';
import { offsetMask } from './distance';
import type { Pt } from './geometry';

export interface CutShapeOptions {
  alphaThreshold: number;
  /** Raster pikseli cinsinden offset */
  offsetPx: number;
  /** 0 = ham, 1 = çok yumuşak */
  smoothing: number;
  /** Kaynak raster pikseli cinsinden en büyük sadeleştirme sapması. */
  simplifyPx: number;
  maxWorkSize?: number;
}
export interface CutShape { points: Pt[]; extraPartsRatio: number }

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

/** Moore komşuluk takibi. Başlangıca ilk dönüşte kapanır; geri komşu yönü değişebilir. */
export function traceBoundary(m: Mask): Pt[] {
  const { width: w, height: h, data } = m;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < w * h; i++) if (data[i]) { start = i; break; }
  if (start < 0) return [];
  const sx = start % w, sy = (start / w) | 0;
  const pts: Pt[] = [];
  let x = sx, y = sy;
  let back = 0; // tarama sırası gereği batı komşusu boş
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

export function smoothClosed(pts: Pt[], window: number): Pt[] {
  const n = pts.length;
  if (window <= 1 || n < window) return pts.slice();
  const half = window >> 1;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0;
    for (let k = -half; k <= half; k++) {
      const p = pts[(i + k + n) % n];
      sx += p.x;
      sy += p.y;
    }
    out.push({ x: sx / window, y: sy / window });
  }
  return out;
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

export function stickerCutShape(r: Raster, o: CutShapeOptions): CutShape {
  if (isFullyOpaque(r)) {
    // Tam dolu görselde alfa sınırı yoktur; PNG'nin dış kenarı kesim sınırıdır.
    // Opak PNG'de kesim yolu görüntü dikdörtgenidir; işaretli ofset dört kenarı taşır.
    const offset = o.offsetPx;
    if (r.width + 2 * offset <= 0 || r.height + 2 * offset <= 0) {
      throw new StickerError('OFFSET_EMPTY', 'İçe ofset sticker boyutundan büyük; kesim çizgisi oluşturulamadı.');
    }
    const start = offset === 0 ? 0 : -offset;
    return { points: [
      { x: start, y: start },
      { x: r.width + offset, y: start },
      { x: r.width + offset, y: r.height + offset },
      { x: start, y: r.height + offset },
    ], extraPartsRatio: 0 };
  }
  const f = Math.min(1, (o.maxWorkSize ?? 1024) / Math.max(r.width, r.height));
  const small = downscaleMask(alphaMask(r, o.alphaThreshold), f);
  const sx = r.width / small.width, sy = r.height / small.height;
  const { mask: main, area, otherAreas } = largestComponent(small);
  if (area === 0) throw new StickerError('EMPTY', 'Bu PNG tamamen şeffaf, kesilecek bir şekil yok.');
  const filled = fillHoles(main);
  const radius = o.offsetPx / sx;
  const { mask, pad } = offsetMask(filled, radius);
  const insetShape = largestComponent(mask);
  if (insetShape.area === 0) {
    throw new StickerError('OFFSET_EMPTY', 'İçe ofset sticker şeklini tamamen siliyor; değeri azaltın.');
  }
  const window = 1 + 2 * Math.round(Math.max(0, Math.min(1, o.smoothing)) * 6);
  const tolerance = Math.max(0.5, Math.max(0, o.simplifyPx) / Math.max(sx, sy));
  const simplified = simplifyClosed(smoothClosed(traceBoundary(insetShape.mask), window), tolerance);
  const maxOther = Math.max(
    otherAreas.reduce((m, a) => Math.max(m, a), 0),
    insetShape.otherAreas.reduce((m, a) => Math.max(m, a), 0),
  );
  return {
    points: simplified.map((p) => ({ x: (p.x - pad + 0.5) * sx, y: (p.y - pad + 0.5) * sy })),
    extraPartsRatio: Math.max(maxOther / area, maxOther / insetShape.area),
  };
}
