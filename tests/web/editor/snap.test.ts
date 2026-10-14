import { describe, it, expect } from 'vitest';
import { snapCandidates, snapDelta, type Bounds } from '../../../web/src/editor/snap';

const page = { w: 80, h: 140 };
const box = (minX: number, minY: number, w: number, h: number): Bounds => ({ minX, minY, maxX: minX + w, maxY: minY + h });
const moving = box(0, 3, 10, 10); // y konumları 3, 8, 13: sayfa yatay çizgilerinden uzak
const narrow = box(0, 3, 7, 10); // 5 mm ızgarada min/merkez/max farklı uzaklıkta kalır

describe('snap', () => {
  it('snapCandidates sayfa kenar + orta çizgileri ve öğe kenar + merkezlerini üretir', () => {
    const pageOnly = snapCandidates(page, []);
    expect(pageOnly).toHaveLength(6);
    expect(pageOnly.filter((g) => g.axis === 'x').map((g) => g.atMm)).toEqual([0, 40, 80]);
    expect(pageOnly.filter((g) => g.axis === 'y').map((g) => g.atMm)).toEqual([0, 70, 140]);
    expect(pageOnly[0]).toEqual({ axis: 'x', atMm: 0, fromMm: 0, toMm: 140, kind: 'page' });
    expect(pageOnly[3]).toEqual({ axis: 'y', atMm: 0, fromMm: 0, toMm: 80, kind: 'page' });
    const all = snapCandidates(page, [box(50, 20, 10, 10)]);
    expect(all).toHaveLength(12);
    expect(all.slice(6)).toEqual([
      { axis: 'x', atMm: 50, fromMm: 20, toMm: 30, kind: 'item' },
      { axis: 'x', atMm: 55, fromMm: 20, toMm: 30, kind: 'item' },
      { axis: 'x', atMm: 60, fromMm: 20, toMm: 30, kind: 'item' },
      { axis: 'y', atMm: 20, fromMm: 50, toMm: 60, kind: 'item' },
      { axis: 'y', atMm: 25, fromMm: 50, toMm: 60, kind: 'item' },
      { axis: 'y', atMm: 30, fromMm: 50, toMm: 60, kind: 'item' },
    ]);
  });

  it('eşik içindeki en yakın çizgiye yapışır, ötesini yok sayar', () => {
    const c = snapCandidates(page, []);
    const centre = snapDelta(moving, 39.5, 0, c, null, 1); // sol kenar 39.5 → sayfa ortası 40
    expect(centre.dx).toBeCloseTo(40, 12);
    expect(centre.dy).toBe(0);
    expect(centre.guides).toEqual([{ axis: 'x', atMm: 40, fromMm: 0, toMm: 140, kind: 'page' }]);
    const right = snapDelta(moving, 70.4, 0, c, null, 1); // sağ kenar 80.4 → sayfa sağ kenarı 80
    expect(right.dx).toBeCloseTo(70, 12);
    expect(right.guides[0].atMm).toBe(80);
    expect(snapDelta(moving, 37, 0, c, null, 1)).toEqual({ dx: 37, dy: 0, guides: [] });
    expect(snapDelta(moving, 39.5, 0, c, null, 0.4)).toEqual({ dx: 39.5, dy: 0, guides: [] });
  });

  it('diğer öğelerin kenar ve merkezlerine yapışır; kılavuz iki kutuyu da kapsar', () => {
    const c = snapCandidates(page, [box(50, 20, 16, 10)]); // x çizgileri 50, 58, 66
    const edge = snapDelta(moving, 49.7, 0, c, null, 1);
    expect(edge.dx).toBeCloseTo(50, 12);
    expect(edge.guides).toEqual([{ axis: 'x', atMm: 50, fromMm: 3, toMm: 30, kind: 'item' }]);
    const mid = snapDelta(moving, 52.8, 0, c, null, 1); // merkez 57.8 → öğe merkezi 58
    expect(mid.dx).toBeCloseTo(53, 12);
    expect(mid.guides[0]).toMatchObject({ axis: 'x', atMm: 58, kind: 'item' });
  });

  it('ızgara: en yakın çizgiye yapışır, eşitlikte sayfa/öğe çizgisi ızgarayı yener, null ızgarayı kapatır', () => {
    const grid = snapDelta(narrow, 12.3, 0, [], 5, 1); // sağ kenar 19.3 → 20 (0.7); sol 12.3 → 10 ve merkez 15.8 → 15 daha uzak
    expect(grid.dx).toBeCloseTo(13, 12);
    expect(grid.dy).toBe(0);
    expect(grid.guides).toEqual([{ axis: 'x', atMm: 20, fromMm: 3, toMm: 13, kind: 'grid' }]);
    const tie = snapDelta(narrow, 39.6, 0, snapCandidates(page, []), 5, 1); // 40: hem sayfa ortası hem ızgara
    expect(tie.dx).toBeCloseTo(40, 12);
    expect(tie.guides).toEqual([{ axis: 'x', atMm: 40, fromMm: 0, toMm: 140, kind: 'page' }]);
    expect(snapDelta(narrow, 12.3, 0, [], null, 1)).toEqual({ dx: 12.3, dy: 0, guides: [] });
    expect(snapDelta(narrow, 12.3, 0, [], 5, 0.5)).toEqual({ dx: 12.3, dy: 0, guides: [] });
  });

  it('iki eksende aynı anda yapışır', () => {
    const r = snapDelta(moving, 34.7, 61.7, snapCandidates(page, []), null, 1); // merkez (39.7, 69.7) → sayfa merkezi (40, 70)
    expect(r.dx).toBeCloseTo(35, 12);
    expect(r.dy).toBeCloseTo(62, 12);
    expect(r.guides).toEqual([
      { axis: 'x', atMm: 40, fromMm: 0, toMm: 140, kind: 'page' },
      { axis: 'y', atMm: 70, fromMm: 0, toMm: 80, kind: 'page' },
    ]);
  });
});
