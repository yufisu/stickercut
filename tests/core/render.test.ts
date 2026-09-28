import { describe, it, expect } from 'vitest';
import {
  createRaster, compositeOverWhite, drawRaster, downscaleRaster, strokePolyline,
} from '../../src/core/render';
import { itemMatrix } from '../../src/core/geometry';

const px = (r: { width: number; data: ArrayLike<number> }, x: number, y: number) =>
  Array.from({ length: 4 }, (_, c) => r.data[(y * r.width + x) * 4 + c]);

describe('render', () => {
  it('compositeOverWhite yarı saydamı beyazla karıştırır', () => {
    const r = createRaster(1, 1);
    r.data.set([0, 0, 0, 128]);
    expect(px(compositeOverWhite(r), 0, 0)).toEqual([127, 127, 127, 255]);
  });

  it('drawRaster sticker pikselini beklenen yere koyar', () => {
    const dst = createRaster(100, 100);
    dst.data.fill(255);
    const src = createRaster(10, 10);
    src.data.set([255, 0, 0, 255], (0 * 10 + 0) * 4); // sol üst köşe kırmızı
    drawRaster(dst, src, itemMatrix({ x: 50, y: 50, scale: 2, rotationDeg: 0 }, 10, 10));
    expect(px(dst, 40, 40)).toEqual([255, 0, 0, 255]);
    expect(px(dst, 41, 41)).toEqual([255, 0, 0, 255]);
    expect(px(dst, 42, 42)).toEqual([255, 255, 255, 255]);
  });

  it('downscaleRaster alfa ağırlıklı ortalar', () => {
    const r = createRaster(2, 2);
    r.data.set([255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0]);
    const d = downscaleRaster(r, 0.5);
    expect(d.width).toBe(1);
    expect(px(d, 0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('strokePolyline çizgi boyunca renk basar', () => {
    const r = createRaster(20, 20);
    strokePolyline(r, [{ x: 2, y: 10 }, { x: 18, y: 10 }], false, [255, 0, 0], 2);
    expect(px(r, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(px(r, 10, 15)[3]).toBe(0);
  });
});
