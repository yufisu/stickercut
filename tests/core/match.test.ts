import { describe, it, expect } from 'vitest';
import { matchStickers } from '../../src/core/match';
import { createRaster, cloneRaster } from '../../src/core/render';
import { makeScene, PLACEMENTS } from '../helpers/scene';

describe('matchStickers', () => {
  it('tüm kopyaları doğru sticker, konum (±1px) ve ölçekle (±%1) bulur', () => {
    const { design, background, stickers } = makeScene();
    const res = matchStickers(design, background, stickers);
    expect(res.items).toHaveLength(PLACEMENTS.length);
    expect(res.unmatchedRegions).toEqual([]);
    for (const p of PLACEMENTS) {
      const hit = res.items.find((i) => Math.hypot(i.x - p.x, i.y - p.y) < 3);
      expect(hit, `${p.file} @ ${p.x},${p.y}`).toBeDefined();
      expect(hit!.file).toBe(p.file);
      expect(Math.abs(hit!.x - p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(hit!.y - p.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(hit!.scale / p.scale - 1)).toBeLessThan(0.01);
      expect(hit!.needsReview).toBe(false);
    }
    expect(res.unusedStickers).toEqual(['kullanilmayan.png']);
  });

  it('birbirine değen iki sticker için emin olmadan yerleştirmez, eşleşmeyen bölge bildirir', () => {
    const { design, background, stickers } = makeScene([
      { file: 'cay.png', x: 300, y: 300, scale: 0.5 },
      { file: 'cay.png', x: 470, y: 300, scale: 0.5 },
    ]);
    const res = matchStickers(design, background, stickers);
    expect(res.items).toEqual([]);
    expect(res.unmatchedRegions).toHaveLength(1);
  });

  it('tasarımdaki şeffaf alanlar (RGB çöp) sahte bölge üretmez', () => {
    const { background, stickers } = makeScene([]);
    const design = cloneRaster(background);
    const bg = cloneRaster(background);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
      const o = (y * design.width + x) * 4;
      design.data.set([(x * 37) % 256, (y * 91) % 256, 17, 0], o);
      bg.data.set([0, 0, 0, 0], o);
    }
    const res = matchStickers(design, bg, stickers);
    expect(res.items).toEqual([]);
    expect(res.unmatchedRegions).toEqual([]);
  });

  it('farklı boyutlu tasarım ve arka planı reddeder', () => {
    const { design, stickers } = makeScene([]);
    expect(() => matchStickers(design, createRaster(10, 10), stickers)).toThrow('aynı boyutta');
  });
});
