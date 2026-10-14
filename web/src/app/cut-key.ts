import { type Item, type Pack, effectiveSettings, isRegionItem } from '../../../src/core/project';

/**
 * Bir öğenin kesim çizgisini belirleyen tüm girdilerin kararlı anahtarı.
 * Worker her kesimle bu anahtarı geri yollar; anahtar güncel öğeninkiyle aynıysa sonuç "taze"dir.
 * Böylece sıra numarası olmadan bayat sonuçlar ayıklanır.
 */
export function cutKey(pack: Pack, item: Item): string {
  const s = effectiveSettings(pack, item);
  const source = isRegionItem(item) ? `r:${item.region.bbox.w}x${item.region.bbox.h}:${item.region.rle.length}:${item.region.rle.slice(0, 64)}` : `f:${item.file}`;
  return [
    source, item.x, item.y, item.scale, item.rotationDeg, item.printOnly ? 1 : 0,
    s.offsetMm, s.closingMm, s.cornerRadiusMm, s.rectCornerRadiusMm, s.smoothMm, s.simplifyMm, s.cornerAngleDeg,
    s.bridgeMm, s.minPartRatio, s.tightMm, s.alphaThreshold,
    pack.page.widthMm, pack.page.heightMm, pack.designSize.widthPx, pack.designSize.heightPx,
  ].join('|');
}
