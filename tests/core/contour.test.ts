import { describe, it, expect } from 'vitest';
import { createMask, type Raster } from '../../src/core/raster';
import { traceBoundary, simplifyClosed, stickerCutShape, StickerError } from '../../src/core/contour';

function raster(size: number, fn: (x: number, y: number) => number): Raster {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    data[o] = 200; data[o + 1] = 50; data[o + 2] = 50; data[o + 3] = fn(x, y);
  }
  return { width: size, height: size, data };
}
const inCircle = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
const radii = (pts: { x: number; y: number }[], cx: number, cy: number) =>
  pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const opts = { alphaThreshold: 128, offsetPx: 0, smoothing: 0.5 };

describe('traceBoundary', () => {
  it('3x3 karenin 8 kenar pikselini sırayla verir', () => {
    const m = createMask(5, 5);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) m.data[y * 5 + x] = 1;
    const pts = traceBoundary(m);
    expect(pts).toHaveLength(8);
    expect(pts[0]).toEqual({ x: 1, y: 1 });
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(8);
  });

  it('tek piksel için tek nokta, boş maske için boş dizi', () => {
    const m = createMask(3, 3);
    expect(traceBoundary(m)).toEqual([]);
    m.data[4] = 1;
    expect(traceBoundary(m)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('simplifyClosed', () => {
  it('düz çizgi üzerindeki ara noktaları atar', () => {
    const pts = [];
    for (let x = 0; x < 10; x++) pts.push({ x, y: 0 });
    for (let y = 1; y < 10; y++) pts.push({ x: 9, y });
    for (let x = 8; x >= 0; x--) pts.push({ x, y: 9 });
    for (let y = 8; y > 0; y--) pts.push({ x: 0, y });
    expect(simplifyClosed(pts, 0.5)).toHaveLength(4);
  });
});

describe('stickerCutShape', () => {
  it('dairenin konturu yarıçapı korur', () => {
    const r = raster(400, (x, y) => (inCircle(x, y, 200, 200, 100) ? 255 : 0));
    const { points, extraPartsRatio } = stickerCutShape(r, opts);
    expect(Math.abs(mean(radii(points, 200, 200)) - 100)).toBeLessThan(1.5);
    expect(extraPartsRatio).toBe(0);
  });

  it('offset yarıçapı tam o kadar büyütür', () => {
    const r = raster(400, (x, y) => (inCircle(x, y, 200, 200, 100) ? 255 : 0));
    const { points } = stickerCutShape(r, { ...opts, offsetPx: 20 });
    expect(Math.abs(mean(radii(points, 200, 200)) - 120)).toBeLessThan(1.5);
  });

  it('kaçak lekeyi atar, iç boşluğu doldurur', () => {
    const r = raster(400, (x, y) => {
      if (x < 20 && y < 20) return 200; // leke
      const inRing = inCircle(x, y, 200, 200, 100) && !inCircle(x, y, 200, 200, 60);
      return inRing ? 255 : 0;
    });
    const { points, extraPartsRatio } = stickerCutShape(r, opts);
    const rs = radii(points, 200, 200);
    expect(Math.min(...rs)).toBeGreaterThan(95);
    expect(Math.max(...rs)).toBeLessThan(105);
    expect(extraPartsRatio).toBeGreaterThan(0);
    expect(extraPartsRatio).toBeLessThan(0.05);
  });

  it('büyük ikinci parçayı oranla raporlar', () => {
    const r = raster(400, (x, y) => (inCircle(x, y, 120, 200, 80) || inCircle(x, y, 320, 200, 50) ? 255 : 0));
    expect(stickerCutShape(r, opts).extraPartsRatio).toBeGreaterThan(0.3);
  });

  it('şeffaflığı olmayan PNG için NO_ALPHA hatası', () => {
    expect(() => stickerCutShape(raster(50, () => 255), opts)).toThrowError(StickerError);
    try { stickerCutShape(raster(50, () => 255), opts); } catch (e) { expect((e as StickerError).code).toBe('NO_ALPHA'); }
  });

  it('tamamen şeffaf PNG için EMPTY hatası', () => {
    try { stickerCutShape(raster(50, () => 0), opts); expect.unreachable(); }
    catch (e) { expect((e as StickerError).code).toBe('EMPTY'); }
  });

  it('büyük görüntüyü küçültüp orijinal koordinatlara geri ölçekler', () => {
    const r = raster(3000, (x, y) => (inCircle(x, y, 1500, 1500, 1000) ? 255 : 0));
    const { points } = stickerCutShape(r, opts);
    expect(Math.abs(mean(radii(points, 1500, 1500)) - 1000)).toBeLessThan(6);
  });
});
