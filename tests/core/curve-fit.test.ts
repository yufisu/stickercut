import { describe, expect, it } from 'vitest';
import { contourCorners, fitClosedCurves } from '../../src/core/curve-fit';
import { flattenClosedPath, polygonBounds, type Pt } from '../../src/core/geometry';

const circle = (n = 360): Pt[] => Array.from({ length: n }, (_, i) => ({
  x: 100 * Math.cos(i * 2 * Math.PI / n), y: 100 * Math.sin(i * 2 * Math.PI / n),
}));
const segmentDistance = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const distance = (p: Pt, poly: Pt[]) => Math.min(...poly.map((a, i) => segmentDistance(p, a, poly[(i + 1) % poly.length])));

describe('fitClosedCurves', () => {
  it('dairenin 360 noktasını dört düzgün Bézier eğrisine indirir, kapanışta teğetleri korur', () => {
    const source = circle(), fitted = fitClosedCurves(source, 0.1, []);
    expect(fitted).toHaveLength(4);
    const flat = flattenClosedPath(fitted, 0.005);
    for (const p of flat) expect(Math.abs(Math.hypot(p.x, p.y) - 100)).toBeLessThan(0.1);
    for (const p of fitted) {
      expect(p.handleIn).toBeDefined(); expect(p.handleOut).toBeDefined();
      const a = { x: p.x - p.handleIn!.x, y: p.y - p.handleIn!.y };
      const b = { x: p.handleOut!.x - p.x, y: p.handleOut!.y - p.y };
      expect(a.x * b.y - a.y * b.x).toBeCloseTo(0, 6);
      expect(a.x * b.x + a.y * b.y).toBeGreaterThan(0);
    }
  });

  it('keskin dikdörtgen köşelerini ve dört düz kenarı korur', () => {
    const source: Pt[] = [];
    for (let x = 0; x < 100; x++) source.push({ x, y: 0 });
    for (let y = 0; y < 80; y++) source.push({ x: 100, y });
    for (let x = 100; x > 0; x--) source.push({ x, y: 80 });
    for (let y = 80; y > 0; y--) source.push({ x: 0, y });
    const corners = contourCorners(source, 100, 7);
    expect(corners).toHaveLength(4);
    expect(fitClosedCurves(source, 5, corners)).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 },
    ]);
    expect(contourCorners(source, 0, 7)).toEqual([]);
  });

  it('girintili organik şekli iki yönde sapma sınırında tutar', () => {
    const source: Pt[] = Array.from({ length: 600 }, (_, i) => {
      const t = i * 2 * Math.PI / 600, r = 100 + 25 * Math.cos(5 * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    });
    const tolerance = 0.5, fitted = fitClosedCurves(source, tolerance, []);
    const flat = flattenClosedPath(fitted, 0.01);
    expect(fitted.length).toBeLessThan(50);
    for (const p of source) expect(distance(p, flat)).toBeLessThanOrEqual(tolerance + 0.01);
    for (const p of flat) expect(distance(p, source)).toBeLessThanOrEqual(tolerance + 0.01);
  });

  it('sıfır değeri ayrıntıyı korur, daha büyük sapma daha az noktayla sonuçlanır', () => {
    const source = circle();
    expect(fitClosedCurves(source, 0, [])).toEqual(source);
    const fine = fitClosedCurves(source, 0.001, []);
    const simple = fitClosedCurves(source, 0.1, []);
    expect(simple.length).toBeLessThan(fine.length);
    const bounds = polygonBounds(simple);
    expect(bounds.minX).toBeCloseTo(-100, 1);
    expect(bounds.maxY).toBeCloseTo(100, 1);
  });
});
