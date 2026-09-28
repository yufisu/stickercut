import { describe, it, expect } from 'vitest';
import { initPack, computeCuts, prepareLoadedFile, renderPackPreview, type LoadedFile } from '../../src/core/pipeline';
import { checkLayout } from '../../src/core/checks';
import { createRaster } from '../../src/core/render';
import { makeScene, paint } from '../helpers/scene';

const EMPTY = new Uint8Array(0);
function sceneFiles(): LoadedFile[] {
  const s = makeScene();
  return [
    prepareLoadedFile('tasarim.png', EMPTY, s.design),
    prepareLoadedFile('arka.png', EMPTY, s.background),
    ...s.stickers.map((st) => prepareLoadedFile(st.file, EMPTY, st.raster)),
  ];
}
const assetsOf = (files: LoadedFile[]) => new Map(files.map((f) => [f.name, f]));

describe('prepareLoadedFile', () => {
  it('büyük şeffaf PNG’yi 2048’e küçültür, orijinal boyutu saklar', () => {
    const big = paint(3000, 3000, (x, y) => (x > 100 && y > 100 && x < 2900 && y < 2900 ? [1, 2, 3, 255] : null));
    const f = prepareLoadedFile('b.png', EMPTY, big);
    expect([f.width, f.height, f.raster.width]).toEqual([3000, 3000, 2048]);
  });
  it('opak büyük PNG’ye (tasarım) dokunmaz', () => {
    const opaque = { width: 3000, height: 10, data: new Uint8ClampedArray(3000 * 10 * 4).fill(255) };
    expect(prepareLoadedFile('d.png', EMPTY, opaque).raster.width).toBe(3000);
  });
  it('adı NFC yapar', () => {
    expect(prepareLoadedFile('ç.png'.normalize('NFD'), EMPTY, createRaster(1, 1)).name).toBe('ç.png'.normalize('NFC'));
  });
});

describe('initPack', () => {
  it('sahneden 4 öğeli paket kurar, kullanılmayanı bildirir', () => {
    const res = initPack(sceneFiles(), { page: { widthMm: 80 } });
    expect(res.pack!.items).toHaveLength(4);
    expect(res.pack!.page).toEqual({ widthMm: 80, heightMm: 120 });
    expect(res.pack!.files).toEqual({ design: 'tasarim.png', background: 'arka.png' });
    expect(res.messages.map((m) => m.code)).toContain('UNUSED_STICKER');
    expect(res.pack!.items.map((i) => i.id)).toEqual(['i1', 'i2', 'i3', 'i4']);
  });

  it('sayfa verilmezse 80 mm varsayar ve bilgi verir', () => {
    const res = initPack(sceneFiles());
    expect(res.pack!.page.widthMm).toBe(80);
    expect(res.messages.find((m) => m.code === 'PAGE_DEFAULT')?.level).toBe('info');
  });

  it('rol belirlenemezse pack null ve hata döner', () => {
    const res = initPack(sceneFiles().slice(2));
    expect(res.pack).toBeNull();
    expect(res.messages[0].level).toBe('error');
  });

  it('küçültülmüş raster’da scale’i orijinal boyuta göre verir', () => {
    const files = sceneFiles().map((f) => (f.name === 'cay.png'
      ? { ...f, width: 800, height: 800 } // raster 400 → orijinal 800 gibi davran
      : f));
    const res = initPack(files);
    const cays = res.pack!.items.filter((i) => i.file === 'cay.png').map((i) => i.scale).sort();
    expect(cays[0]).toBeCloseTo(0.2, 2);
    expect(cays[1]).toBeCloseTo(0.25, 2);
  });
});

describe('computeCuts', () => {
  it('her kesilen öğe için tasarım px’inde kontur üretir', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    const { cuts, messages } = computeCuts(pack!, assetsOf(files));
    expect(cuts.size).toBe(4);
    expect(messages.filter((m) => m.level === 'error')).toEqual([]);
    const cay = pack!.items.find((i) => i.file === 'cay.png' && i.scale > 0.45)!;
    const r = cuts.get(cay.id)!.map((p) => Math.hypot(p.x - cay.x, p.y - cay.y));
    expect(r.reduce((a, b) => a + b, 0) / r.length).toBeGreaterThan(88);
  });

  it('offset mm’yi öğe ölçeğine göre çevirir', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.defaults.offsetMm = 2; // 80mm / 800px → 1px = 0.1mm → 20 tasarım px
    const { cuts } = computeCuts(pack!, assetsOf(files));
    const cay = pack!.items.find((i) => i.file === 'cay.png' && i.scale > 0.45)!;
    const r = cuts.get(cay.id)!.map((p) => Math.hypot(p.x - cay.x, p.y - cay.y));
    expect(Math.abs(r.reduce((a, b) => a + b, 0) / r.length - 110)).toBeLessThan(2);
  });

  it('printOnly öğeleri kesmez; eksik dosya ve şeffafsız PNG için hata verir', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].printOnly = true;
    pack!.items[1].file = 'yok.png';
    const opaque = prepareLoadedFile('opak.png', EMPTY, { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) });
    pack!.items[2].file = 'opak.png';
    const { cuts, messages } = computeCuts(pack!, assetsOf([...files, opaque]));
    expect(cuts.has(pack!.items[0].id)).toBe(false);
    expect(messages.filter((m) => m.level === 'error').map((m) => m.code).sort()).toEqual(['MISSING_FILE', 'NO_ALPHA']);
  });
});

describe('checkLayout', () => {
  it('çakışan ve sayfa dışına taşan kesimleri uyarır', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[1].x = pack!.items[0].x + 30;
    pack!.items[1].y = pack!.items[0].y;
    pack!.items[2].x = 5;
    const { cuts } = computeCuts(pack!, assetsOf(files));
    const codes = checkLayout(pack!, cuts).map((m) => m.code);
    expect(codes).toContain('OVERLAP');
    expect(codes).toContain('OUTSIDE_PAGE');
  });

  it('sayfa oranı tasarımla uyuşmazsa uyarır', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80, heightMm: 140 } });
    expect(checkLayout(pack!, new Map()).map((m) => m.code)).toEqual(['ASPECT']);
  });
});

describe('renderPackPreview', () => {
  it('arka plan boyutunda opak önizleme üretir', () => {
    const files = sceneFiles();
    const { pack } = initPack(files);
    const out = renderPackPreview(pack!, assetsOf(files), computeCuts(pack!, assetsOf(files)).cuts);
    expect([out.width, out.height]).toEqual([800, 1200]);
    expect(out.data[3]).toBe(255);
  });
});
