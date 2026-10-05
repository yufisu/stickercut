import { describe, it, expect } from 'vitest';
import {
  multiply, apply, invert, itemMatrix, transformPoints, closedPathSvg,
  polygonBounds, pointInPolygon, type Affine,
  flattenClosedPath, flattenPath, type Pt,
} from '../../src/core/geometry';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('geometry', () => {
  it('multiply önce sağdakini uygular', () => {
    const t: Affine = [1, 0, 0, 1, 10, 0];
    const s: Affine = [2, 0, 0, 2, 0, 0];
    close(apply(multiply(t, s), { x: 1, y: 1 }), { x: 12, y: 2 });
  });

  it('invert tersini verir', () => {
    const m: Affine = [2, 0.5, -0.3, 1.5, 7, -4];
    close(apply(multiply(invert(m), m), { x: 3, y: 5 }), { x: 3, y: 5 });
  });

  it('itemMatrix sticker merkezini x,y noktasına koyar', () => {
    const m = itemMatrix({ x: 100, y: 50, scale: 0.5, rotationDeg: 0 }, 200, 100);
    close(apply(m, { x: 100, y: 50 }), { x: 100, y: 50 });
    close(apply(m, { x: 0, y: 0 }), { x: 50, y: 25 });
  });

  it('itemMatrix 90° döndürmede sağ üst köşeyi sağ alta götürür', () => {
    const m = itemMatrix({ x: 0, y: 0, scale: 1, rotationDeg: 90 }, 20, 10);
    close(apply(m, { x: 20, y: 0 }), { x: 5, y: 10 });
  });

  it('closedPathSvg dik köşeleri dışarı taşırmadan kapalı kontur üretir', () => {
    const d = closedPathSvg([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(d).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    expect(closedPathSvg([{ x: 0, y: 0 }])).toBe('');
  });

  it('transformPoints, polygonBounds, pointInPolygon', () => {
    const sq = transformPoints([1, 0, 0, 1, 5, 5], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(polygonBounds(sq)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
    expect(pointInPolygon({ x: 10, y: 10 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 1, y: 10 }, sq)).toBe(false);
  });

  it('transforms absolute Bezier handles with rotation, scale and translation', () => {
    const points: Pt[] = [{ x: 2, y: 3, handleIn: { x: 1, y: 3 }, handleOut: { x: 2, y: 5 } }];
    const transformed = transformPoints([0, 2, -2, 0, 10, 20], points);
    expect(transformed).toEqual([{ x: 4, y: 24, handleIn: { x: 4, y: 22 }, handleOut: { x: 0, y: 24 } }]);
    expect(points[0].handleOut).toEqual({ x: 2, y: 5 });
  });

  it('emits closing Beziers and falls back to anchors for a missing handle', () => {
    const points: Pt[] = [
      { x: 0, y: 0, handleIn: { x: -10, y: 0 } },
      { x: 10, y: 0, handleOut: { x: 10, y: 5 } },
      { x: 0, y: 10, handleOut: { x: -10, y: 10 } },
    ];
    expect(closedPathSvg(points)).toBe('M 0 0 L 10 0 C 10 5 0 10 0 10 C -10 10 -10 0 0 0 Z');
    const flat = flattenClosedPath(points, 0.1);
    expect(flat.some((p) => p.x === -7.5 && p.y === 5)).toBe(true);
    expect(flat.every((p) => !p.handleIn && !p.handleOut)).toBe(true);
    expect(flat.at(-1)).not.toEqual(flat[0]);
    expect(flattenPath(points, false).every((p) => p.x >= 0)).toBe(true);
  });

  it('bounds use actual curve extrema including the closing segment', () => {
    const points: Pt[] = [
      { x: 0, y: 0, handleIn: { x: -10, y: 0 }, handleOut: { x: 0, y: -10 } },
      { x: 10, y: 0, handleIn: { x: 10, y: -10 } },
      { x: 10, y: 10 },
      { x: 0, y: 10, handleOut: { x: -10, y: 10 } },
    ];
    expect(polygonBounds(points)).toEqual({ minX: -7.5, minY: -7.5, maxX: 10, maxY: 10 });
  });

  it('hit tests curved outlines and invalidates flattening after a handle edit', () => {
    const points: Pt[] = [
      { x: 0, y: 0, handleOut: { x: 0, y: -10 } },
      { x: 10, y: 0, handleIn: { x: 10, y: -10 } },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: -5 }, points)).toBe(true);
    expect(pointInPolygon({ x: 5, y: -8 }, points)).toBe(false);
    points[0].handleOut!.y = -4;
    points[1].handleIn!.y = -4;
    expect(pointInPolygon({ x: 5, y: -5 }, points)).toBe(false);
  });
});
