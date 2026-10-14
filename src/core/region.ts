import type { BBox, Raster } from './raster';
import { createRaster } from './render';
import { decodeRle } from './shape';
import { regionLocation } from './region-label';

/** Bölge öğesi yardımcıları; pipeline'a (ve pdf-lib'e) bağımlı olmadan web ana iş parçacığından kullanılır. */

export interface RegionAsset { width: number; height: number; raster: Raster }

export function regionItemText(b: BBox, width: number, height: number, marker: number, ambiguous: boolean): string {
  const where = regionLocation(b, width, height);
  return ambiguous
    ? `Bölge ${marker}: Sayfanın ${where} çizime PNG eşleşmedi; kesim çizgisi tasarımın kendisinden alındı. Doğruysa onayla, PNG'si varsa Sticker ekle bölümünden yerleştir.`
    : `Bölge ${marker}: Sayfanın ${where} çizim tasarımdan kesildi.`;
}

/** Bölge öğesinin görselini tasarım rasterinden keser (alfa = bölge maskesi), bbox-yerel rasterde. */
export function regionRaster(design: RegionAsset, region: { bbox: BBox; rle: string }): Raster {
  const { bbox, rle } = region;
  const mask = decodeRle(rle, bbox.w, bbox.h);
  const k = design.raster.width / design.width;
  const out = createRaster(bbox.w, bbox.h);
  const src = design.raster;
  for (let y = 0; y < bbox.h; y++) {
    const sy = Math.min(src.height - 1, Math.max(0, Math.floor((bbox.y + y + 0.5) * k)));
    for (let x = 0; x < bbox.w; x++) {
      if (!mask.data[y * bbox.w + x]) continue;
      const sx = Math.min(src.width - 1, Math.max(0, Math.floor((bbox.x + x + 0.5) * k)));
      const si = (sy * src.width + sx) * 4, di = (y * bbox.w + x) * 4;
      out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}
