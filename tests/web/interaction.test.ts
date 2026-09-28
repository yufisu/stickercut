import { describe, it, expect } from 'vitest';
import { corners, containsPoint, handles, hitHandle, moved, scaled, rotated } from '../../web/src/ui/interaction';

const g = { x: 100, y: 100, scale: 0.5, rotationDeg: 0, w: 200, h: 100 };

describe('interaction', () => {
  it('corners ve containsPoint', () => {
    expect(corners(g)).toEqual([{ x: 50, y: 75 }, { x: 150, y: 75 }, { x: 150, y: 125 }, { x: 50, y: 125 }]);
    expect(containsPoint(g, { x: 60, y: 80 })).toBe(true);
    expect(containsPoint(g, { x: 40, y: 80 })).toBe(false);
    expect(containsPoint({ ...g, rotationDeg: 90 }, { x: 110, y: 145 })).toBe(true);
  });

  it('handles ve hitHandle', () => {
    const h = handles(g, 20);
    expect(h.scale).toEqual({ x: 150, y: 125 });
    expect(h.rotate.x).toBeCloseTo(100);
    expect(h.rotate.y).toBeCloseTo(55);
    expect(hitHandle(g, { x: 148, y: 124 }, 10, 20)).toBe('scale');
    expect(hitHandle(g, { x: 100, y: 57 }, 10, 20)).toBe('rotate');
    expect(hitHandle(g, { x: 100, y: 100 }, 10, 20)).toBeNull();
  });

  it('moved, scaled, rotated', () => {
    expect(moved(g, { x: 0, y: 0 }, { x: 5, y: -3 })).toEqual({ x: 105, y: 97 });
    expect(scaled(g, { x: 150, y: 100 }, { x: 200, y: 100 })).toBeCloseTo(1);
    expect(rotated(g, { x: 200, y: 100 }, { x: 100, y: 200 })).toBe(90);
    expect(rotated(g, { x: 200, y: 100 }, { x: 200, y: 104 })).toBe(0); // 3°'nin altı 0'a yapışır
  });
});
