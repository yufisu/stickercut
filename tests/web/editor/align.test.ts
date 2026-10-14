import { describe, it, expect } from 'vitest';
import { alignItems, distributeItems, type IdBounds } from '../../../web/src/editor/align';
import type { Bounds } from '../../../web/src/editor/snap';

const box = (id: string, minX: number, minY: number, w: number, h: number): IdBounds => ({ id, b: { minX, minY, maxX: minX + w, maxY: minY + h } });
const items = [box('a', 0, 0, 10, 10), box('b', 20, 5, 20, 30), box('c', 50, 50, 5, 5)]; // toplam kutu 0..55 × 0..55

describe('align', () => {
  it('alignItems seçimin toplam kutusuna hizalar', () => {
    expect(alignItems(items, 'left')).toEqual([{ id: 'a', dx: 0, dy: 0 }, { id: 'b', dx: -20, dy: 0 }, { id: 'c', dx: -50, dy: 0 }]);
    expect(alignItems(items, 'right')).toEqual([{ id: 'a', dx: 45, dy: 0 }, { id: 'b', dx: 15, dy: 0 }, { id: 'c', dx: 0, dy: 0 }]);
    expect(alignItems(items, 'hcenter')).toEqual([{ id: 'a', dx: 22.5, dy: 0 }, { id: 'b', dx: -2.5, dy: 0 }, { id: 'c', dx: -25, dy: 0 }]);
    expect(alignItems(items, 'top')).toEqual([{ id: 'a', dx: 0, dy: 0 }, { id: 'b', dx: 0, dy: -5 }, { id: 'c', dx: 0, dy: -50 }]);
    expect(alignItems(items, 'bottom')).toEqual([{ id: 'a', dx: 0, dy: 45 }, { id: 'b', dx: 0, dy: 20 }, { id: 'c', dx: 0, dy: 0 }]);
    expect(alignItems(items, 'vcenter')).toEqual([{ id: 'a', dx: 0, dy: 22.5 }, { id: 'b', dx: 0, dy: 7.5 }, { id: 'c', dx: 0, dy: -25 }]);
  });

  it('tek öğe ve boş seçim için sıfır; hedef verilirse (örn. sayfa) ona hizalar', () => {
    expect(alignItems([items[1]], 'right')).toEqual([{ id: 'b', dx: 0, dy: 0 }]);
    expect(alignItems([], 'left')).toEqual([]);
    const page: Bounds = { minX: 0, minY: 0, maxX: 80, maxY: 140 };
    expect(alignItems([items[0]], 'hcenter', page)).toEqual([{ id: 'a', dx: 35, dy: 0 }]);
    expect(alignItems([items[0]], 'bottom', page)).toEqual([{ id: 'a', dx: 0, dy: 130 }]);
  });

  it('distributeItems eşit boşluk bırakır; ilk ve son yerinde kalır; giriş sırası korunur', () => {
    const row = [box('p', 0, 0, 10, 10), box('r', 50, 0, 10, 10), box('q', 12, 0, 10, 10)]; // 0..60, boşluk (60-30)/2 = 15 → q 25'e
    expect(distributeItems(row, 'x')).toEqual([{ id: 'p', dx: 0, dy: 0 }, { id: 'r', dx: 0, dy: 0 }, { id: 'q', dx: 13, dy: 0 }]);
    const col = [box('p', 0, 0, 10, 10), box('q', 0, 10, 10, 20), box('r', 0, 90, 10, 10)]; // 0..100, boşluk (100-40)/2 = 30 → q 40'a
    expect(distributeItems(col, 'y')).toEqual([{ id: 'p', dx: 0, dy: 0 }, { id: 'q', dx: 0, dy: 30 }, { id: 'r', dx: 0, dy: 0 }]);
    expect(distributeItems(row.slice(0, 2), 'x')).toEqual([{ id: 'p', dx: 0, dy: 0 }, { id: 'r', dx: 0, dy: 0 }]);
    expect(distributeItems([], 'x')).toEqual([]);
  });

  it('distributeItems farklı boyutlarda da aralıkları eşitler', () => {
    const mixed = [box('a', 0, 0, 10, 1), box('b', 15, 0, 20, 1), box('c', 40, 0, 4, 1), box('d', 60, 0, 10, 1)];
    const moves = distributeItems(mixed, 'x');
    const placed = mixed.map(({ id, b }) => ({ minX: b.minX + moves.find((m) => m.id === id)!.dx, maxX: b.maxX + moves.find((m) => m.id === id)!.dx }));
    const gaps = placed.slice(1).map((b, i) => b.minX - placed[i].maxX);
    for (const g of gaps) expect(g).toBeCloseTo(26 / 3, 9);
    expect(placed[0].minX).toBe(0);
    expect(placed[3].maxX).toBe(70);
  });
});
