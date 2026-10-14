import { describe, it, expect } from 'vitest';
import { hitTest, marqueeHits, handleHit, type HitItem } from '../../../web/src/editor/hit';
import type { Pt } from '../../../src/core/geometry';

const square = (id: string, x: number, y: number, w: number, h = w): HitItem => ({
  id,
  outline: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
  bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h },
});

describe('hit', () => {
  it('hitTest üstteki (dizinin sonundaki) öğeyi önce bulur', () => {
    const items = [square('a', 0, 0, 100), square('b', 50, 50, 100)];
    expect(hitTest(items, { x: 75, y: 75 }, 4)).toBe('b');
    expect(hitTest(items, { x: 25, y: 25 }, 4)).toBe('a');
    expect(hitTest(items, { x: 200, y: 200 }, 4)).toBeNull();
    expect(hitTest([], { x: 0, y: 0 }, 4)).toBeNull();
  });

  it('küçük öğeler şişirilmiş kutuyla yakalanır, büyükler yakalanmaz', () => {
    const tiny = square('t', 100, 100, 3); // 3 px < 2·4 → kutu 96..107
    expect(hitTest([tiny], { x: 106, y: 106 }, 4)).toBe('t');
    expect(hitTest([tiny], { x: 108, y: 106 }, 4)).toBeNull();
    const thin = square('n', 0, 0, 100, 2); // tek kenarı dar olsa da şişer
    expect(hitTest([thin], { x: 50, y: 5 }, 4)).toBe('n');
    const big = square('g', 0, 0, 100);
    expect(hitTest([big], { x: 102, y: 50 }, 4)).toBeNull();
    expect(hitTest([tiny], { x: 102, y: 102 }, 0)).toBe('t');
    expect(hitTest([tiny], { x: 104, y: 102 }, 0)).toBeNull();
  });

  it('eğri dış hatlar (tutamaçlı) düzleştirilerek test edilir', () => {
    // Üst kenarı y = -30'a kadar şişen kare.
    const outline: Pt[] = [
      { x: 0, y: 0, handleOut: { x: 0, y: -40 } }, { x: 100, y: 0, handleIn: { x: 100, y: -40 } }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const item: HitItem = { id: 'c', outline, bounds: { minX: 0, minY: -30, maxX: 100, maxY: 100 } };
    expect(hitTest([item], { x: 50, y: -20 }, 0)).toBe('c');
    expect(hitTest([item], { x: 50, y: -35 }, 0)).toBeNull();
  });

  it('marqueeHits kutusu kesişenleri z sırasıyla döndürür; ters dikdörtgen düzeltilir', () => {
    const items = [square('a', 0, 0, 10), square('b', 20, 0, 10), square('c', 40, 0, 10)];
    expect(marqueeHits(items, { minX: 5, minY: 5, maxX: 25, maxY: 8 })).toEqual(['a', 'b']);
    expect(marqueeHits(items, { minX: 25, minY: 8, maxX: 5, maxY: 5 })).toEqual(['a', 'b']);
    expect(marqueeHits(items, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toEqual(['a', 'b']); // kenara değen sayılır
    expect(marqueeHits(items, { minX: 11, minY: 11, maxX: 19, maxY: 19 })).toEqual([]);
  });

  it('handleHit yarıçap içindeki en yakın tutamacı seçer', () => {
    const handles = [{ kind: 'scale' as const, at: { x: 0, y: 0 } }, { kind: 'rotate' as const, at: { x: 10, y: 0 } }];
    expect(handleHit(handles, { x: 4, y: 0 }, 6)).toBe('scale');
    expect(handleHit(handles, { x: 6, y: 0 }, 6)).toBe('rotate');
    expect(handleHit(handles, { x: 5, y: 0 }, 6)).toBe('scale'); // eşitlikte ilk
    expect(handleHit(handles, { x: 5, y: 10 }, 6)).toBeNull();
    expect(handleHit([], { x: 0, y: 0 }, 6)).toBeNull();
  });
});
