import { type Raster, type Mask, createMask, maskArea, dilateSquare } from './raster';
import { findRegions, type Region } from './match';
import { cloneRaster } from './render';
import { encodePngRows } from './png-encode';

/**
 * Tek sayfa modu: yalnızca sticker dolu sayfa verildiğinde arka planı sayfanın kendisinden çıkarır.
 * Baskın düz renk (ya da şeffaflık) arka plan sayılır; ondan ayrışan adalar sticker adayıdır.
 * Sticker'sız arka plan, bu adaların yeri çevre rengiyle doldurularak üretilir; böylece yazı ve süsler
 * baskıda olduğu gibi kalır.
 */

export type Rgb = [number, number, number];
export interface SheetBackground {
  /** flat: baskın düz renk; transparent: şeffaf alanlar (sayfanın en az %20'si). */
  kind: 'flat' | 'transparent';
  /** Baskın opak renk (şeffaf sayfada beyaz). */
  rgb: Rgb;
  transparentRatio: number;
  /** Arka plan sayılan piksel oranı (tüm sayfa). */
  coverage: number;
  /** Arka plan sayılan piksel oranı (kenar şeridi). */
  edgeCoverage: number;
}

export interface SheetAnalysis {
  background: SheetBackground;
  /** Kesim öğesi olacak sticker adayları (tasarım analiz pikseli). */
  regions: Region[];
  /** Sayfa kenarına dayanan alanlar (başlık bandı, çerçeve, köşe süsü): kesilemez, arka planda kalır. */
  kept: Region[];
  /** kept alanının sayfaya oranı. */
  keptRatio: number;
  /** ok: düz arka plan; warn: kısmen desenli, sonuç eksik olabilir; busy: şekiller ayrılamadı. */
  verdict: 'ok' | 'warn' | 'busy';
}

/** match.ts fark eşiğiyle aynı: arka plandan bu kadar uzak renkler çizim sayılır. */
export const SHEET_TOLERANCE = 48;

const TRANSPARENT_KIND_RATIO = 0.2;

export const hexOf = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function isBackground(data: Uint8Array | Uint8ClampedArray, o: number, bg: Pick<SheetBackground, 'kind' | 'rgb'>, tol: number): boolean {
  if (data[o + 3] < 128) return true;
  if (bg.kind === 'transparent') return false;
  return Math.abs(data[o] - bg.rgb[0]) <= tol && Math.abs(data[o + 1] - bg.rgb[1]) <= tol && Math.abs(data[o + 2] - bg.rgb[2]) <= tol;
}

/** Hızlı kestirim (kurulum ekranı için): baskın renk, şeffaflık ve kenarların ne kadarının arka plan olduğu. */
export function estimateSheetBackground(r: Raster, tol = SHEET_TOLERANCE): SheetBackground {
  const { width: w, height: h, data } = r;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 200_000)));
  const buckets = new Uint32Array(1 << 15);
  let samples = 0, transparent = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const o = (y * w + x) * 4;
    samples++;
    if (data[o + 3] < 128) { transparent++; continue; }
    buckets[((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3)]++;
  }
  let best = 0;
  for (let k = 1; k < buckets.length; k++) if (buckets[k] > buckets[best]) best = k;
  const centre: Rgb = [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
  // Kova merkezine yakın örneklerin ortalaması: kova sınırına düşen düz rengi de yakalar.
  let sr = 0, sg = 0, sb = 0, m = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const o = (y * w + x) * 4;
    if (data[o + 3] < 128) continue;
    if (Math.abs(data[o] - centre[0]) <= 12 && Math.abs(data[o + 1] - centre[1]) <= 12 && Math.abs(data[o + 2] - centre[2]) <= 12) {
      sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; m++;
    }
  }
  const transparentRatio = samples ? transparent / samples : 0;
  const kind = transparentRatio >= TRANSPARENT_KIND_RATIO || m === 0 ? 'transparent' : 'flat';
  const rgb: Rgb = kind === 'transparent' ? [255, 255, 255] : [Math.round(sr / m), Math.round(sg / m), Math.round(sb / m)];
  const bg = { kind, rgb } as const;
  let covered = 0, edgeSamples = 0, edgeCovered = 0;
  const strip = Math.max(2, Math.round(0.02 * Math.min(w, h)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const isBg = isBackground(data, (y * w + x) * 4, bg, tol);
    if (isBg) covered++;
    if (x < strip || y < strip || x >= w - strip || y >= h - strip) { edgeSamples++; if (isBg) edgeCovered++; }
  }
  return { kind, rgb, transparentRatio, coverage: samples ? covered / samples : 0, edgeCoverage: edgeSamples ? edgeCovered / edgeSamples : 0 };
}

/** Arka plandan ayrışan pikseller (1 = çizim). */
export function sheetForeground(r: Raster, bg: Pick<SheetBackground, 'kind' | 'rgb'>, tol = SHEET_TOLERANCE): Mask {
  const m = createMask(r.width, r.height);
  for (let i = 0, o = 0; i < m.data.length; i++, o += 4) m.data[i] = isBackground(r.data, o, bg, tol) ? 0 : 1;
  return m;
}

/** Sayfayı arka plan + sticker adayları + kenara dayanan geniş alanlar olarak ayırır. */
export function analyzeSheet(r: Raster, opts: { minAreaRatio?: number; tolerance?: number } = {}): SheetAnalysis {
  const tol = opts.tolerance ?? SHEET_TOLERANCE;
  const background = estimateSheetBackground(r, tol);
  const all = findRegions(sheetForeground(r, background, tol), opts.minAreaRatio ?? 0.001);
  const { width: W, height: H } = r;
  const regions: Region[] = [], kept: Region[] = [];
  let keptArea = 0;
  for (const region of all) {
    const b = region.bbox, area = maskArea(region.mask);
    // Sayfa kenarına değen bir şeklin kesim çizgisi sayfadan taşar; sticker değil süs/band kabul edilir.
    const touchesEdge = b.x <= 1 || b.y <= 1 || b.x + b.w >= W - 1 || b.y + b.h >= H - 1;
    if (touchesEdge) { kept.push(region); keptArea += area; } else regions.push(region);
  }
  const keptRatio = keptArea / (W * H);
  const verdict = !regions.length || keptRatio > 0.4 || background.coverage < 0.15 ? 'busy' : keptRatio >= 0.15 ? 'warn' : 'ok';
  return { background, regions, kept, keptRatio, verdict };
}

/**
 * Sticker'sız arka plan (analiz çözünürlüğünde): her sticker adayının yeri, kenar halkasının ortalama
 * rengiyle (ya da halka çoğunlukla şeffafsa şeffaflıkla) doldurulur. pad, kenar yumuşatma pikselleri için genişletme.
 */
export function eraseRegions(r: Raster, analysis: SheetAnalysis, tol = SHEET_TOLERANCE, pad = 2): Raster {
  const out = cloneRaster(r);
  const { width: W, height: H } = r, ring = 3, margin = pad + ring + 1;
  const bg = analysis.background;
  for (const region of analysis.regions) {
    const x0 = Math.max(0, region.bbox.x - margin), y0 = Math.max(0, region.bbox.y - margin);
    const x1 = Math.min(W, region.bbox.x + region.bbox.w + margin), y1 = Math.min(H, region.bbox.y + region.bbox.h + margin);
    const lw = x1 - x0, lh = y1 - y0;
    const local = createMask(lw, lh);
    for (let y = 0; y < region.bbox.h; y++) for (let x = 0; x < region.bbox.w; x++) {
      if (region.mask.data[y * region.bbox.w + x]) local.data[(y + region.bbox.y - y0) * lw + x + region.bbox.x - x0] = 1;
    }
    const inner = dilateSquare(local, pad), outer = dilateSquare(inner, ring);
    let sr = 0, sg = 0, sb = 0, n = 0, clear = 0, any = 0;
    let fr = 0, fg = 0, fb = 0, fn = 0;
    for (let i = 0; i < inner.data.length; i++) {
      if (!outer.data[i] || inner.data[i]) continue;
      const o = (((i / lw) | 0) + y0) * W * 4 + ((i % lw) + x0) * 4;
      any++;
      if (r.data[o + 3] < 128) { clear++; continue; }
      fr += r.data[o]; fg += r.data[o + 1]; fb += r.data[o + 2]; fn++;
      if (isBackground(r.data, o, bg, tol)) { sr += r.data[o]; sg += r.data[o + 1]; sb += r.data[o + 2]; n++; }
    }
    const transparent = bg.kind === 'transparent' || (any > 0 && clear * 2 >= any);
    const fill = transparent ? [0, 0, 0, 0]
      : n ? [sr / n, sg / n, sb / n, 255] : fn ? [fr / fn, fg / fn, fb / fn, 255] : [...bg.rgb, 255];
    for (let i = 0; i < inner.data.length; i++) {
      if (!inner.data[i]) continue;
      const o = (((i / lw) | 0) + y0) * W * 4 + ((i % lw) + x0) * 4;
      out.data[o] = fill[0]; out.data[o + 1] = fill[1]; out.data[o + 2] = fill[2]; out.data[o + 3] = fill[3];
    }
  }
  return out;
}

/**
 * Rasteri width×height PNG'ye kodlar. Boyut farklıysa (küçültülmüş analiz rasteri) satırlar
 * önceden çarpılmış alfa ile çift doğrusal örneklenir; büyük görüntü bellekte tutulmaz.
 */
export function encodeRasterAt(r: Raster, width: number, height: number): Uint8Array {
  if (r.width === width && r.height === height) {
    const stride = width * 4;
    return encodePngRows(width, height, (y, out) => out.set(r.data.subarray(y * stride, (y + 1) * stride)));
  }
  const sx = r.width / width, sy = r.height / height;
  return encodePngRows(width, height, (y, out) => {
    const v = Math.min(r.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const v0 = Math.floor(v), v1 = Math.min(r.height - 1, v0 + 1), fy = v - v0;
    for (let x = 0; x < width; x++) {
      const u = Math.min(r.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const u0 = Math.floor(u), u1 = Math.min(r.width - 1, u0 + 1), fx = u - u0;
      let a = 0, cr = 0, cg = 0, cb = 0;
      for (const [uu, vv, wgt] of [[u0, v0, (1 - fx) * (1 - fy)], [u1, v0, fx * (1 - fy)], [u0, v1, (1 - fx) * fy], [u1, v1, fx * fy]] as const) {
        const o = (vv * r.width + uu) * 4, al = r.data[o + 3] * wgt;
        a += al; cr += r.data[o] * al; cg += r.data[o + 1] * al; cb += r.data[o + 2] * al;
      }
      const o = x * 4;
      out[o] = a ? cr / a : 0; out[o + 1] = a ? cg / a : 0; out[o + 2] = a ? cb / a : 0; out[o + 3] = Math.round(a);
    }
  });
}
