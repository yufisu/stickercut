import { describe, it, expect } from 'vitest';
import { transformGroup, groupBounds, boundsCentre, normalizeDeg } from '../../../web/src/editor/transform';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};
const place = (x: number, y: number, scale = 1, rotationDeg = 0) => ({ x, y, scale, rotationDeg });

describe('transform', () => {
  it('normalizeDeg (-180, 180] aralığına indirger', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(540)).toBe(180);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-360)).toBe(0);
    expect(Object.is(normalizeDeg(-0), 0)).toBe(true);
  });

  it('pivot etrafında 90° döndürme merkezleri saat yönünde taşır, açıları toplar', () => {
    const out = transformGroup([place(10, 0), place(20, 10, 1, 170)], { x: 0, y: 0 }, { deg: 90 });
    close(out[0], { x: 0, y: 10 });
    expect(out[0].rotationDeg).toBe(90);
    close(out[1], { x: -10, y: 20 });
    expect(out[1].rotationDeg).toBe(-100);
    const about = transformGroup([place(20, 10)], { x: 10, y: 10 }, { deg: 90 });
    close(about[0], { x: 10, y: 20 });
    const back = transformGroup(about, { x: 10, y: 10 }, { deg: -90 });
    close(back[0], { x: 20, y: 10 });
    expect(back[0].rotationDeg).toBe(0);
  });

  it('pivot etrafında ölçekleme scale\'i çarpar ve merkezleri pivottan uzaklaştırır', () => {
    const out = transformGroup([place(10, 5, 0.5), place(0, 0, 2)], { x: 0, y: 0 }, { k: 2 });
    close(out[0], { x: 20, y: 10 });
    expect(out[0].scale).toBe(1);
    close(out[1], { x: 0, y: 0 });
    expect(out[1].scale).toBe(4);
    const about = transformGroup([place(30, 30)], { x: 20, y: 20 }, { k: 0.5 });
    close(about[0], { x: 25, y: 25 });
    expect(about[0].scale).toBe(0.5);
  });

  it('taşıma, boş dönüşüm ve birleşik dönüşüm (ölçek → döndürme → taşıma)', () => {
    const items = [place(10, 0, 1, 45)];
    expect(transformGroup(items, { x: 0, y: 0 }, { dx: 5, dy: -3 })).toEqual([place(15, -3, 1, 45)]);
    expect(transformGroup(items, { x: 7, y: 7 }, {})).toEqual(items);
    expect(items[0]).toEqual(place(10, 0, 1, 45)); // girdi değişmez
    const out = transformGroup(items, { x: 0, y: 0 }, { k: 2, deg: 90, dx: 1, dy: 1 }); // (10,0) → (20,0) → (0,20) → (1,21)
    close(out[0], { x: 1, y: 21 });
    expect(out[0].scale).toBe(2);
    expect(out[0].rotationDeg).toBe(135);
  });

  it('fazladan alanları korur (Item gibi nesneler)', () => {
    const out = transformGroup([{ ...place(1, 2), id: 'i1', file: 'a.png' }], { x: 0, y: 0 }, { dx: 1 });
    expect(out[0]).toEqual({ x: 2, y: 2, scale: 1, rotationDeg: 0, id: 'i1', file: 'a.png' });
  });

  it('groupBounds ve boundsCentre', () => {
    expect(groupBounds([{ minX: 0, minY: 5, maxX: 10, maxY: 15 }, { minX: -3, minY: 8, maxX: 4, maxY: 30 }])).toEqual({ minX: -3, minY: 5, maxX: 10, maxY: 30 });
    expect(groupBounds([])).toEqual({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    expect(boundsCentre({ minX: 0, minY: 10, maxX: 10, maxY: 40 })).toEqual({ x: 5, y: 25 });
  });
});
