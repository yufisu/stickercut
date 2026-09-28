import type { BBox } from './raster';

export function regionLocation(b: BBox, width: number, height: number): string {
  const x = (b.x + b.w / 2) / width, y = (b.y + b.h / 2) / height;
  const horizontal = x < 1 / 3 ? 'sol' : x > 2 / 3 ? 'sağ' : 'orta';
  const vertical = y < 1 / 3 ? 'üst' : y > 2 / 3 ? 'alt' : 'orta';
  if (horizontal === 'orta' && vertical === 'orta') return 'ortasındaki';
  if (horizontal === 'orta') return `${vertical} ortasındaki`;
  if (vertical === 'orta') return `${horizontal} ortasındaki`;
  return `${horizontal} ${vertical} bölümündeki`;
}

export function unmatchedRegionText(b: BBox, width: number, height: number, marker: number): string {
  return `Bölge ${marker}: Sayfanın ${regionLocation(b, width, height)} çizim eşleşmedi. Önizlemedeki turuncu ${marker} işaretine bak; PNG eksik veya eşleşme yanlış olabilir.`;
}

export function legacyRegion(text: string): BBox | null {
  const m = /x=(\d+), y=(\d+), (\d+)×(\d+) px/.exec(text);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}
