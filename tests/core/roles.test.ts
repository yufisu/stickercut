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
  });
});
