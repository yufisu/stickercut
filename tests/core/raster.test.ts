import { describe, it, expect } from 'vitest';
import {
  createMask, alphaMask, maskArea, bboxOf, labelComponents, largestComponent,
  fillHoles, downscaleMask, padMask, dilateSquare, erodeSquare, type Mask,
} from '../../src/core/raster';

function maskFrom(rows: string[]): Mask {
  const m = createMask(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => { m.data[y * m.width + x] = c === '#' ? 1 : 0; }));
  return m;
}
function rowsOf(m: Mask): string[] {
  const out: string[] = [];
  for (let y = 0; y < m.height; y++) {
    let s = '';
    for (let x = 0; x < m.width; x++) s += m.data[y * m.width + x] ? '#' : '.';
    out.push(s);
  }
  return out;
}

describe('raster', () => {
  it('alphaMask alfa eşiğine göre maske çıkarır', () => {
    const r = { width: 3, height: 1, data: new Uint8Array([0,0,0,0, 0,0,0,127, 0,0,0,128]) };
    expect([...alphaMask(r).data]).toEqual([0, 0, 1]);
    expect([...alphaMask(r, 100).data]).toEqual([0, 1, 1]);
  });

  it('bboxOf sıkı sınır döner, boşsa null', () => {
    expect(bboxOf(maskFrom(['....', '.##.', '..#.']))).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(bboxOf(maskFrom(['...']))).toBeNull();
  });

  it('labelComponents 8-komşuluk kullanır', () => {
    const { areas } = labelComponents(maskFrom(['#...', '.#..', '...#']));
    expect(areas.slice(1).sort()).toEqual([1, 2]);
  });

  it('largestComponent en büyüğü tutar, diğerlerini raporlar', () => {
    const res = largestComponent(maskFrom(['##..#', '##...', '.....']));
    expect(res.area).toBe(4);
    expect(res.otherAreas).toEqual([1]);
    expect(rowsOf(res.mask)).toEqual(['##...', '##...', '.....']);
  });

  it('largestComponent boş maskede alan 0 döner', () => {
    expect(largestComponent(maskFrom(['...'])).area).toBe(0);
  });

  it('fillHoles kapalı boşlukları doldurur, kenara açılanları doldurmaz', () => {
    const m = maskFrom(['#####', '#...#', '#####', '#...#', '##.##']);
    expect(rowsOf(fillHoles(m))).toEqual(['#####', '#####', '#####', '#...#', '##.##']);
    expect(maskArea(m)).toBe(18);
  });

  it('downscaleMask blok merkezlerinden örnekler', () => {
    const m = maskFrom(['##..', '##..', '....', '....']);
    expect(rowsOf(downscaleMask(m, 0.5))).toEqual(['#.', '..']);
    expect(downscaleMask(m, 1).data).not.toBe(m.data);
  });

  it('padMask kenar ekler', () => {
    expect(rowsOf(padMask(maskFrom(['#']), 1))).toEqual(['...', '.#.', '...']);
  });

  it('dilateSquare ve erodeSquare kare yapısal elemanla çalışır', () => {
    const m = maskFrom(['.....', '.....', '..#..', '.....', '.....']);
    const d = dilateSquare(m, 1);
    expect(rowsOf(d)).toEqual(['.....', '.###.', '.###.', '.###.', '.....']);
    expect(rowsOf(erodeSquare(d, 1))).toEqual(['.....', '.....', '..#..', '.....', '.....']);
  });
});
