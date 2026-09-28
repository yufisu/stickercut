import { describe, it, expect } from 'vitest';
import { createMask, maskArea } from '../../src/core/raster';
import { squaredDistance, offsetMask } from '../../src/core/distance';

function disc(size: number, r: number) {
  const m = createMask(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= r * r) m.data[y * size + x] = 1;
  }
  return m;
}

describe('distance', () => {
  it('squaredDistance tam Öklid kare mesafesini verir', () => {
    const m = createMask(21, 21);
    m.data[10 * 21 + 10] = 1;
    const d = squaredDistance(m);
    expect(d[10 * 21 + 10]).toBe(0);
    expect(d[14 * 21 + 13]).toBe(25);
    expect(d[0]).toBe(200);
  });

  it('offsetMask yarıçap kadar büyütür ve pad ekler', () => {
    const m = disc(40, 10);
    const { mask, pad } = offsetMask(m, 5);
    expect(pad).toBe(6);
    expect(mask.width).toBe(52);
    const expected = Math.PI * 15 * 15;
    expect(Math.abs(maskArea(mask) - expected) / expected).toBeLessThan(0.03);
  });

  it('offsetMask(0) sadece pad ekler', () => {
    const m = disc(20, 5);
    const { mask } = offsetMask(m, 0);
    expect(maskArea(mask)).toBe(maskArea(m));
  });

  it('negatif offset Öklid mesafesiyle içeri alır', () => {
    const m = disc(80, 25);
    const { mask, pad } = offsetMask(m, -5);
    expect(pad).toBe(1);
    const expected = Math.PI * 20 * 20;
    expect(Math.abs(maskArea(mask) - expected) / expected).toBeLessThan(0.05);
    expect(maskArea(mask)).toBeLessThan(maskArea(m));
  });
});
