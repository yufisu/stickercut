import type { Raster } from '../../src/core/raster';
import { createRaster, cloneRaster, drawRaster } from '../../src/core/render';
import { itemMatrix } from '../../src/core/geometry';

type RGBA = [number, number, number, number];

export function paint(w: number, h: number, fn: (x: number, y: number) => RGBA | null): Raster {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y);
    if (c) r.data.set(c, (y * w + x) * 4);
  }
  return r;
}

const inCircle = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;

/** Aynı daire silüetli iki sticker (çay/kahve) sadece renk deseniyle ayrışır — gerçek fincanlar gibi. */
export const STICKERS: Record<string, () => Raster> = {
  'cay.png': () => paint(400, 400, (x, y) =>
    inCircle(x, y, 200, 200, 180) ? ((((x >> 3) + (y >> 3)) & 1) ? [220, 40, 40, 255] : [255, 255, 255, 255]) : null),
  'kahve.png': () => paint(400, 400, (x, y) =>
    inCircle(x, y, 200, 200, 180) ? (((y / 10) | 0) & 1 ? [40, 60, 200, 255] : [250, 220, 40, 255]) : null),
  'baklava.png': () => paint(400, 400, (x, y) =>
    x >= 50 && x < 350 && y >= 80 && y < 320 ? (x % 24 < 6 && y % 24 < 6 ? [110, 60, 20, 255] : [240, 150, 40, 255]) : null),
  'kullanilmayan.png': () => paint(400, 400, (x, y) =>
    y > 40 && y < 360 && Math.abs(x - 200) < (y - 40) / 2 ? [130, 40, 160, 255] : null),
};

export const BG: RGBA = [200, 220, 140, 255];
export function background(w = 800, h = 1200): Raster {
  return paint(w, h, (x, y) => ((x * 7 + y * 13) % 97 === 0 ? [90, 120, 60, 255] : BG));
}

export interface ScenePlacement { file: string; x: number; y: number; scale: number }
export const PLACEMENTS: ScenePlacement[] = [
  { file: 'cay.png', x: 220, y: 260, scale: 0.5 },
  { file: 'kahve.png', x: 580, y: 280, scale: 0.6 },
  { file: 'baklava.png', x: 220, y: 880, scale: 0.5 },
  { file: 'cay.png', x: 560, y: 900, scale: 0.4 },
];

export function makeScene(placements: ScenePlacement[] = PLACEMENTS) {
  const stickers = Object.entries(STICKERS).map(([file, make]) => ({ file, raster: make() }));
  const bg = background();
  const design = cloneRaster(bg);
  for (const p of placements) {
    const s = stickers.find((st) => st.file === p.file)!.raster;
    drawRaster(design, s, itemMatrix({ ...p, rotationDeg: 0 }, s.width, s.height));
  }
  return { design, background: bg, stickers };
}
