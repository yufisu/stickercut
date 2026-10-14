import type { Asset, Message } from './pipeline';
import { type Item, type Pack, effectiveSettings, mmPerDesignPx } from './project';
import { type Affine, type Pt, flattenPath, itemMatrix, multiply, polygonBounds, transformPoints } from './geometry';
import type { Raster } from './raster';
import { applyCoverage, coverageMask, createRaster, downscaleRaster, drawRaster, fillCoverage } from './render';

export interface StickerPngOptions {
  /** Çıktı çözünürlüğü (varsayılan 300). */
  dpi?: number;
  /** Kesim silüeti çevresinde şeffaf pay (varsayılan 0.5 mm). */
  paddingMm?: number;
  /** Beyaz kenar dolgusu; verilmezse öğenin etkin ayarı. */
  whiteBorder?: boolean;
}
export interface StickerRender { itemId: string; file: string; name: string; raster: Raster; widthMm: number; heightMm: number; dpi: number }

const baseName = (file: string) => file.split('/').pop()!.replace(/\.png$/i, '');

/** Tek sticker’ı kesim silüetine göre kırpılmış, saydam arka planlı PNG raster’ı olarak çizer. */
export function renderStickerPng(pack: Pack, item: Item, asset: Asset, cut: Pt[], opts: StickerPngOptions = {}): StickerRender {
  const { dpi = 300, paddingMm = 0.5, whiteBorder = effectiveSettings(pack, item).whiteBorder } = opts;
  const mm = mmPerDesignPx(pack), pxPerMm = dpi / 25.4;
  const b = polygonBounds(cut);
  const widthMm = (b.maxX - b.minX) * mm.x + 2 * paddingMm, heightMm = (b.maxY - b.minY) * mm.y + 2 * paddingMm;
  const w = Math.ceil(widthMm * pxPerMm), h = Math.ceil(heightMm * pxPerMm);
  const kx = mm.x * pxPerMm, ky = mm.y * pxPerMm, pad = paddingMm * pxPerMm;
  const toOut: Affine = [kx, 0, 0, ky, pad - b.minX * kx, pad - b.minY * ky]; // tasarım px → çıktı px
  const cov = coverageMask(w, h, flattenPath(transformPoints(toOut, cut), true));
  const out = createRaster(w, h);
  if (whiteBorder) fillCoverage(out, cov, [255, 255, 255]);

  let src = asset.raster;
  const k = asset.width / src.width; // raster px → orijinal sticker px
  let m = multiply(toOut, multiply(itemMatrix(item, asset.width, asset.height), [k, 0, 0, k, 0, 0]));
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  if (scale < 0.75) { // en yakın komşu örnekleme öncesi kutu filtresiyle küçült
    src = downscaleRaster(src, scale);
    const f = asset.raster.width / src.width;
    m = multiply(m, [f, 0, 0, f, 0, 0]);
  }
  drawRaster(out, src, m);
  applyCoverage(out, cov);
  return { itemId: item.id, file: item.file, name: `${item.id}-${baseName(item.file)}.png`, raster: out, widthMm, heightMm, dpi };
}

export function renderAllStickerPngs(
  pack: Pack, assets: Map<string, Asset>, cuts: Map<string, Pt[]>, opts: StickerPngOptions = {},
): { renders: StickerRender[]; messages: Message[] } {
  const renders: StickerRender[] = [], messages: Message[] = [];
  for (const item of pack.items) {
    const cut = cuts.get(item.id);
    if (!cut || item.printOnly) continue;
    const a = assets.get(item.file);
    if (!a) {
      messages.push({ level: 'error', code: 'MISSING_FILE', itemId: item.id, file: item.file, text: `"${item.file}" dosyası projede yok.` });
      continue;
    }
    renders.push(renderStickerPng(pack, item, a, cut, opts));
  }
  return { renders, messages };
}
