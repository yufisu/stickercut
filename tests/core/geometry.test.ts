import { describe, it, expect } from 'vitest';
import {
  multiply, apply, invert, itemMatrix, transformPoints, closedPathSvg,
  polygonBounds, pointInPolygon, type Affine,
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

  it('closedPathSvg n nokta için n kübik segment üretir', () => {
    const d = closedPathSvg([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(4);
    expect(closedPathSvg([{ x: 0, y: 0 }])).toBe('');
  });

  it('transformPoints, polygonBounds, pointInPolygon', () => {
    const sq = transformPoints([1, 0, 0, 1, 5, 5], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(polygonBounds(sq)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
    expect(pointInPolygon({ x: 10, y: 10 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 1, y: 10 }, sq)).toBe(false);
  });
});
