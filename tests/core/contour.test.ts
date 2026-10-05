import { describe, it, expect } from 'vitest';
import { createMask, type Raster } from '../../src/core/raster';
import { traceBoundary, simplifyClosed, stickerCutShape, StickerError } from '../../src/core/contour';
import { flattenClosedPath, polygonBounds } from '../../src/core/geometry';

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
const opts = { alphaThreshold: 128, offsetPx: 0, smoothing: 0.5, simplifyPx: 0 };

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

  it('girintili bir sınırda başlangıca döndüğünde tekrar tekrar dolaşmaz', () => {
    const rows = [
      '............', '............', '....##..##..', '.....###....',
      '.....##..#..', '...#..####..', '....##.###..', '...####.#...',
      '....##...#..', '...#..##.#..', '............', '............',
    ];
    const m = createMask(12, 12);
    rows.forEach((row, y) => [...row].forEach((cell, x) => { m.data[y * 12 + x] = cell === '#' ? 1 : 0; }));
    const points = traceBoundary(m);
    expect(points.length).toBeLessThan(100);
    expect(points[0]).toEqual({ x: 4, y: 2 });
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
  it('küçük kenar dalgalanmalarını az noktayla izlerken belirtilen sapma sınırını korur', () => {
    const r = raster(300, (x, y) => {
      const wave = Math.round(2 * Math.sin(y / 3));
      return y >= 35 && y <= 265 && x >= 35 + wave && x <= 265 + wave ? 255 : 0;
    });
    const detailed = stickerCutShape(r, { ...opts, simplifyPx: 0 }).points;
    const simplified = stickerCutShape(r, { ...opts, simplifyPx: 3 }).points;
    const distanceToSegment = (p: typeof detailed[number], a: typeof detailed[number], b: typeof detailed[number]) => {
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    expect(detailed.length).toBeGreaterThan(50);
    expect(simplified.length).toBeLessThan(detailed.length / 10);
    const flat = flattenClosedPath(simplified, 0.01);
    for (const point of detailed) {
      expect(Math.min(...flat.map((p, i) => distanceToSegment(point, p, flat[(i + 1) % flat.length])))).toBeLessThanOrEqual(3.01);
    }
  });

  it('sıfır sadeleştirmede ham konturu korur, pozitif değerde eğri kontrolleri üretir', () => {
    const r = raster(400, (x, y) => (inCircle(x, y, 200, 200, 100) ? 255 : 0));
    const detailed = stickerCutShape(r, { ...opts, smoothing: 0, simplifyPx: 0 }).points;
    const fitted = stickerCutShape(r, { ...opts, simplifyPx: 1 }).points;
    expect(detailed.length).toBeGreaterThan(500);
    expect(detailed.every((p) => !p.handleIn && !p.handleOut)).toBe(true);
    expect(fitted.length).toBeLessThan(20);
    expect(fitted.some((p) => p.handleIn && p.handleOut)).toBe(true);
  });

  it('yüksek yumuşatmada çok küçük şeffaf konturları çökertmez', () => {
    for (const size of [2, 3]) {
      const r = raster(10, (x, y) => x >= 3 && x < 3 + size && y >= 3 && y < 3 + size ? 255 : 0);
      const raw = stickerCutShape(r, { ...opts, smoothing: 0 }).points;
      const smoothed = stickerCutShape(r, { ...opts, smoothing: 1 }).points;
      expect(smoothed).toEqual(raw);
      expect(polygonBounds(smoothed)).toEqual({ minX: 3.5, minY: 3.5, maxX: size + 2.5, maxY: size + 2.5 });
    }
  });

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

  it('negatif offset kesim yolunu içeri taşır ve aşırı değeri reddeder', () => {
    const r = raster(400, (x, y) => (inCircle(x, y, 200, 200, 100) ? 255 : 0));
    const { points } = stickerCutShape(r, { ...opts, offsetPx: -20 });
    expect(Math.abs(mean(radii(points, 200, 200)) - 80)).toBeLessThan(1.5);
    expect(() => stickerCutShape(r, { ...opts, offsetPx: -150 })).toThrow('İçe ofset');
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

  it('tam opak PNG için görüntü kenarından dikdörtgen kesim yolu üretir', () => {
    expect(stickerCutShape(raster(50, () => 255), opts)).toEqual({
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }],
      extraPartsRatio: 0,
    });
    expect(stickerCutShape(raster(50, () => 255), { ...opts, offsetPx: 5 }).points).toEqual([
      { x: -5, y: -5 }, { x: 55, y: -5 }, { x: 55, y: 55 }, { x: -5, y: 55 },
    ]);
    expect(stickerCutShape(raster(50, () => 255), { ...opts, offsetPx: -5 }).points).toEqual([
      { x: 5, y: 5 }, { x: 45, y: 5 }, { x: 45, y: 45 }, { x: 5, y: 45 },
    ]);
    expect(() => stickerCutShape(raster(50, () => 255), { ...opts, offsetPx: -25 })).toThrow('İçe ofset');
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
