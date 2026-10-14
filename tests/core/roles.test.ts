import { describe, it, expect } from 'vitest';
import { assignRoles, transparencyRatio, contentScore } from '../../src/core/roles';
import { makeScene, background } from '../helpers/scene';

const scene = makeScene();
const stickerInputs = scene.stickers.map((s) => ({ file: s.file, raster: s.raster }));

describe('roles', () => {
  it('şeffaflık oranı ve içerik skoru', () => {
    expect(transparencyRatio(scene.design)).toBe(0);
    expect(transparencyRatio(scene.stickers[0].raster)).toBeGreaterThan(0.2);
    expect(contentScore(scene.design)).toBeGreaterThan(contentScore(scene.background));
  });

  it('isim ipucuyla arka planı seçer', () => {
    const r = assignRoles([
      { file: 'tasarim.png', raster: scene.design },
      { file: 'bases/turk kahvesi arka.png', raster: scene.background },
      ...stickerInputs,
    ]);
    expect(r).toMatchObject({ design: 'tasarim.png', background: 'bases/turk kahvesi arka.png', ambiguous: false });
    expect(r.stickers.sort()).toEqual(['baklava.png', 'cay.png', 'kahve.png', 'kullanilmayan.png']);
  });

  it('ipucu yoksa içeriği fazla olanı tam tasarım sayar', () => {
    const r = assignRoles([{ file: 'b.png', raster: scene.background }, { file: 'a.png', raster: scene.design }]);
    expect(r.design).toBe('a.png');
    expect(r.background).toBe('b.png');
  });

  it('iki aday çift varsa belirsiz der', () => {
    const other = background(500, 700);
    const r = assignRoles([
      { file: 'a.png', raster: scene.design }, { file: 'b.png', raster: scene.background },
      { file: 'c.png', raster: other }, { file: 'd.png', raster: other },
    ]);
    expect(r.ambiguous).toBe(true);
    expect(r.design).toBeNull();
    expect(r.reason).toContain('Birden fazla');
  });

  it('sadece tasarım ipucu verilirse aynı boyuttaki diğer opak dosyayı arka plan yapar', () => {
    const other = background(500, 700);
    const r = assignRoles([
      { file: 'a.png', raster: scene.design }, { file: 'b.png', raster: scene.background },
      { file: 'c.png', raster: other }, { file: 'd.png', raster: other },
    ], { design: 'a.png' });
    expect(r).toMatchObject({ design: 'a.png', background: 'b.png', ambiguous: false });
  });

  it('hiç çift yoksa açıklayıcı neden verir', () => {
    const r = assignRoles(stickerInputs);
    expect(r.ambiguous).toBe(true);
    expect(r.reason).toContain('bulunamadı');
    expect(r.reason).toContain('Tam tasarım olarak seç');
  });

  describe('tek sayfa modu', () => {
    it('tek opak PNG tam tasarım olur, arka plan yok, kestirim eklenir', () => {
      const r = assignRoles([{ file: 'sayfa.png', raster: scene.design }]);
      expect(r).toMatchObject({ design: 'sayfa.png', background: null, stickers: [], ambiguous: false, single: true });
      expect(r.sheet?.kind).toBe('flat');
    });
    it('tek opak sayfa + şeffaf sticker’lar: sticker’lar eşleştirmeye gider', () => {
      const r = assignRoles([{ file: 'sayfa.png', raster: scene.design }, ...stickerInputs]);
      expect(r.single).toBe(true);
      expect(r.stickers.sort()).toEqual(['baklava.png', 'cay.png', 'kahve.png', 'kullanilmayan.png']);
    });
    it('tek başına şeffaf sayfa da tam tasarım olur', () => {
      const r = assignRoles([{ file: 'seffaf.png', raster: scene.stickers[0].raster }]);
      expect(r).toMatchObject({ design: 'seffaf.png', background: null, stickers: [], single: true });
    });
    it('tasarım ipucunun eşi yoksa ya da arka plan istenmiyorsa tek sayfa', () => {
      const other = background(500, 700);
      expect(assignRoles([{ file: 'a.png', raster: scene.design }, { file: 'c.png', raster: other }], { design: 'a.png' }))
        .toMatchObject({ design: 'a.png', background: null, single: true });
      expect(assignRoles([{ file: 'a.png', raster: scene.design }, { file: 'b.png', raster: scene.background }], { design: 'a.png', noBackground: true }))
        .toMatchObject({ design: 'a.png', background: null, single: true });
    });
  });
});
