import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { initPack, computeCuts, prepareLoadedFile } from '../../src/core/pipeline';
import { DEFAULT_SETTINGS, type Pack } from '../../src/core/project';
import { renderStickerPng, renderAllStickerPngs } from '../../src/core/export-png';
import { encodePngRgba } from '../../src/core/png-encode';
import { createRaster } from '../../src/core/render';
import { makeScene, paint } from '../helpers/scene';

const px = (r: { width: number; data: ArrayLike<number> }, x: number, y: number) =>
  Array.from({ length: 4 }, (_, c) => r.data[(Math.round(y) * r.width + Math.round(x)) * 4 + c]);

/** 18 mm çapında mavi daire: 400 px sticker, 0.5 ölçek, 0.1 mm/tasarım px, 1 mm ofset. */
function circlePack(whiteBorder: boolean) {
  const raster = paint(400, 400, (x, y) => ((x + 0.5 - 200) ** 2 + (y + 0.5 - 200) ** 2 <= 180 ** 2 ? [30, 90, 200, 255] : null));
  const pack: Pack = {
    version: 2, page: { widthMm: 80, heightMm: 120 }, designSize: { widthPx: 800, heightPx: 1200 },
    files: { design: 'tasarim.png', background: 'arka.png' },
    defaults: { ...DEFAULT_SETTINGS, offsetMm: 1, whiteBorder },
    items: [{ id: 'i1', file: 'mavi.png', x: 220, y: 260, scale: 0.5, rotationDeg: 0, printOnly: false, needsReview: false, matchScore: null, overrides: {} }],
  };
  const assets = new Map([['mavi.png', { width: 400, height: 400, raster }]]);
  return { pack, assets, cut: computeCuts(pack, assets).cuts.get('i1')! };
}

describe('renderStickerPng', () => {
  it('300 dpi, 1 mm beyaz kenar: boyut, merkez rengi, beyaz halka, kesim dışı şeffaf', () => {
    const { pack, assets, cut } = circlePack(true);
    const r = renderStickerPng(pack, pack.items[0], assets.get('mavi.png')!, cut);
    expect(r.dpi).toBe(300);
    expect(r.name).toBe('i1-mavi.png');
    expect(r.widthMm).toBeCloseTo(21, 0); // 18 çap + 2 × 1 kenar + 2 × 0.5 pay
    expect(r.heightMm).toBeCloseTo(21, 0);
    const k = 300 / 25.4;
    expect([r.raster.width, r.raster.height]).toEqual([Math.ceil(r.widthMm * k), Math.ceil(r.heightMm * k)]);
    const cx = r.raster.width / 2, cy = r.raster.height / 2;
    expect(px(r.raster, cx, cy)).toEqual([30, 90, 200, 255]);
    expect(px(r.raster, cx + 8.5 * k, cy)).toEqual([30, 90, 200, 255]);   // sticker kenarının hemen içi (yarıçap 9 mm)
    expect(px(r.raster, cx + 9.5 * k, cy)).toEqual([255, 255, 255, 255]); // beyaz kenar halkası (9–10 mm)
    expect(px(r.raster, cx, cy - 9.5 * k)).toEqual([255, 255, 255, 255]);
    expect(px(r.raster, cx + 10.5 * k, cy)[3]).toBe(0);                  // kesim dışı
    expect(px(r.raster, 0, 0)[3]).toBe(0);
  });

  it('beyaz kenar kapalıysa halka şeffaf kalır; dpi ve pay seçenekleri uygulanır', () => {
    const { pack, assets, cut } = circlePack(false);
    const r = renderStickerPng(pack, pack.items[0], assets.get('mavi.png')!, cut, { dpi: 150, paddingMm: 1 });
    const k = 150 / 25.4, cx = r.raster.width / 2, cy = r.raster.height / 2;
    expect(r.widthMm).toBeCloseTo(22, 0);
    expect(r.raster.width).toBe(Math.ceil(r.widthMm * k));
    expect(px(r.raster, cx, cy)).toEqual([30, 90, 200, 255]);
    expect(px(r.raster, cx + 9.5 * k, cy)[3]).toBe(0);
    expect(renderStickerPng(pack, pack.items[0], assets.get('mavi.png')!, cut, { whiteBorder: true }).raster.data).not.toEqual(r.raster.data);
  });
});

describe('renderAllStickerPngs', () => {
  it('printOnly öğeleri atlar, adı id + dosya taban adıyla kurar, eksik dosyayı bildirir', () => {
    const s = makeScene();
    const empty = new Uint8Array(0);
    const files = [
      prepareLoadedFile('tasarim.png', empty, s.design), prepareLoadedFile('arka.png', empty, s.background),
      ...s.stickers.map((st) => prepareLoadedFile(`assets/${st.file}`, empty, st.raster)),
    ];
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].printOnly = true;
    const assets = new Map(files.map((f) => [f.name, f]));
    const { cuts } = computeCuts(pack!, assets);
    const { renders, messages } = renderAllStickerPngs(pack!, assets, cuts, { dpi: 72 });
    expect(messages).toEqual([]);
    expect(renders.map((r) => r.itemId)).toEqual(pack!.items.slice(1).map((i) => i.id));
    expect(renders.map((r) => r.name)).toEqual(pack!.items.slice(1).map((i) => `${i.id}-${i.file!.slice('assets/'.length)}`));
    for (const r of renders) expect(r.raster.width).toBe(Math.ceil(r.widthMm * (72 / 25.4)));

    assets.delete(pack!.items[1].file!);
    const missing = renderAllStickerPngs(pack!, assets, cuts, { dpi: 72 });
    expect(missing.messages.map((m) => m.code)).toEqual(['MISSING_FILE']);
    expect(missing.renders.length).toBeLessThan(renders.length);
  });
});

describe('encodePngRgba', () => {
  it('pngjs ile çözülünce aynı pikselleri verir', () => {
    const r = createRaster(7, 5);
    for (let i = 0; i < r.data.length; i++) r.data[i] = (i * 37 + 5) % 256;
    const bytes = encodePngRgba(r);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const png = PNG.sync.read(Buffer.from(bytes));
    expect([png.width, png.height]).toEqual([7, 5]);
    expect([...png.data]).toEqual([...r.data]);

    const { pack, assets, cut } = circlePack(true);
    const sticker = renderStickerPng(pack, pack.items[0], assets.get('mavi.png')!, cut, { dpi: 100 }).raster;
    const decoded = PNG.sync.read(Buffer.from(encodePngRgba(sticker)));
    expect([decoded.width, decoded.height]).toEqual([sticker.width, sticker.height]);
    expect(Buffer.from(decoded.data).equals(Buffer.from(sticker.data))).toBe(true);
  });
});
