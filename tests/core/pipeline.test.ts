import { describe, it, expect } from 'vitest';
import { initPack, computeCuts, prepareLoadedFile, renderPackPreview, type LoadedFile } from '../../src/core/pipeline';
import { checkLayout } from '../../src/core/checks';
import { createRaster } from '../../src/core/render';
import { polygonBounds } from '../../src/core/geometry';
import { decodePng } from '../../src/cli/png';
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
  it('dönen tekrarları tek PNG ile iki öğe yapar ve kaynak kullanımını bildirir', () => {
    const s = makeScene([
      { file: 'kullanilmayan.png', x: 230, y: 300, scale: 0.6, rotationDeg: 20 },
      { file: 'kullanilmayan.png', x: 590, y: 880, scale: 0.5, rotationDeg: -15 },
    ]);
    const files = [
      prepareLoadedFile('tasarim.png', EMPTY, s.design),
      prepareLoadedFile('arka.png', EMPTY, s.background),
      ...s.stickers.map((st) => prepareLoadedFile(st.file, EMPTY, st.raster)),
    ];
    const res = initPack(files, { page: { widthMm: 80 } });
    expect(res.pack?.items.filter((i) => i.file === 'kullanilmayan.png')).toHaveLength(2);
    expect(res.pack?.items.map((i) => i.rotationDeg).sort((a, b) => a - b)).toEqual([-15, 20]);
    expect(res.messages.find((m) => m.code === 'REUSED_STICKER')?.text).toContain('2 ayrı kesim çizgisi');
  });

  it('bölge öğeleri kapalıyken eksik çizimi numaralı bölge olarak bildirir', () => {
    const s = makeScene([{ file: 'baklava.png', x: 220, y: 880, scale: 0.5 }]);
    const files = [
      prepareLoadedFile('tasarim.png', EMPTY, s.design),
      prepareLoadedFile('arka.png', EMPTY, s.background),
    ];
    const res = initPack(files, { page: { widthMm: 80 }, regionItems: false });
    const region = res.messages.find((m) => m.code === 'UNMATCHED_REGION');
    expect(res.pack!.items).toHaveLength(0);
    expect(region?.region).toBeDefined();
    expect(region?.marker).toBe(1);
    expect(region?.text).toContain('turuncu 1 işaretine');
    expect(region?.text).not.toContain('x=');
  });

  it('PNG verilmeyen çizimi tasarımdan bölge öğesi yapar ve kesim üretir (sticker varsa kontrol ister)', () => {
    const s = makeScene([{ file: 'baklava.png', x: 220, y: 880, scale: 0.5 }, { file: 'cay.png', x: 560, y: 300, scale: 0.5 }]);
    const files = [
      prepareLoadedFile('tasarim.png', EMPTY, s.design),
      prepareLoadedFile('arka.png', EMPTY, s.background),
      prepareLoadedFile('cay.png', EMPTY, s.stickers.find((st) => st.file === 'cay.png')!.raster),
    ];
    const res = initPack(files, { page: { widthMm: 80 } });
    const region = res.pack!.items.find((i) => i.file === null)!;
    expect(region).toBeDefined();
    expect(region.region!.bbox.w).toBeGreaterThan(140);
    expect(region.region!.bbox.w).toBeLessThan(160);
    expect(region.region!.bbox.h).toBeGreaterThan(110);
    expect(region.needsReview).toBe(true);
    expect(Math.abs(region.x - 220)).toBeLessThan(4);
    expect(Math.abs(region.y - 880)).toBeLessThan(4);
    const msg = res.messages.find((m) => m.code === 'REGION_ITEM')!;
    expect(msg.level).toBe('warning');
    expect(msg.itemId).toBe(region.id);
    expect(res.messages.some((m) => m.code === 'UNMATCHED_REGION')).toBe(false);
    const { cuts, messages } = computeCuts(res.pack!, assetsOf(files));
    expect(messages.filter((m) => m.level === 'error')).toEqual([]);
    const b = polygonBounds(cuts.get(region.id)!);
    expect(b.minX).toBeGreaterThan(region.region!.bbox.x - 8);
    expect(b.maxX).toBeLessThan(region.region!.bbox.x + region.region!.bbox.w + 8);
  });

  it('yalnızca tasarım + arka plan ile her bölge bilgi düzeyinde öğe olur', () => {
    const files = sceneFiles().slice(0, 2);
    const res = initPack(files, { page: { widthMm: 80 } });
    expect(res.pack!.items).toHaveLength(4);
    expect(res.pack!.items.every((i) => i.file === null && !i.needsReview)).toBe(true);
    expect(res.messages.filter((m) => m.code === 'REGION_ITEM').every((m) => m.level === 'info')).toBe(true);
    const { cuts } = computeCuts(res.pack!, assetsOf(files));
    expect(cuts.size).toBe(4);
    const preview = renderPackPreview(res.pack!, assetsOf(files), cuts);
    expect([preview.width, preview.height]).toEqual([800, 1200]);
  });

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

describe('initPack — tek sayfa modu', () => {
  const sheetOnly = () => [prepareLoadedFile('sayfa.png', EMPTY, makeScene().design)];

  it('yalnızca sticker sayfasından bölge öğeleri ve sticker’sız arka plan üretir', () => {
    const files = sheetOnly();
    const res = initPack(files, { page: { widthMm: 80 } });
    expect(res.pack).not.toBeNull();
    const bg = res.syntheticBackground!;
    expect(bg.name).toBe('otomatik arka plan.png');
    expect([bg.width, bg.height]).toEqual([800, 1200]);
    expect(decodePng(bg.bytes).width).toBe(800);
    expect(res.pack!.files).toEqual({ design: 'sayfa.png', background: 'otomatik arka plan.png' });
    expect(res.pack!.items).toHaveLength(4);
    expect(res.pack!.items.every((i) => i.file === null && !i.needsReview)).toBe(true);
    expect(res.messages.find((m) => m.code === 'SINGLE_SHEET')?.text).toContain('4 şekil');
    const assets = assetsOf([...files, bg]);
    const { cuts, messages } = computeCuts(res.pack!, assets);
    expect(cuts.size).toBe(4);
    expect(messages.filter((m) => m.level === 'error')).toEqual([]);
    expect(renderPackPreview(res.pack!, assets, cuts).width).toBe(800);
  });

  it('sayfa + sticker PNG’leri: sticker’lar eşleşir, arka plan yine sayfadan gelir', () => {
    const s = makeScene();
    const files = [prepareLoadedFile('sayfa.png', EMPTY, s.design), ...s.stickers.map((st) => prepareLoadedFile(st.file, EMPTY, st.raster))];
    const res = initPack(files, { page: { widthMm: 80 } });
    expect(res.syntheticBackground).toBeDefined();
    expect(res.pack!.items.map((i) => i.file).sort()).toEqual(['baklava.png', 'cay.png', 'cay.png', 'kahve.png']);
  });

  it('background: null aynı boyutlu eşi yok sayar; ad çakışması numaralanır', () => {
    const s = makeScene();
    const files = [
      prepareLoadedFile('sayfa.png', EMPTY, s.design), prepareLoadedFile('arka.png', EMPTY, s.background),
      prepareLoadedFile('otomatik arka plan.png', EMPTY, createRaster(4, 4)),
    ];
    const res = initPack(files, { design: 'sayfa.png', background: null, page: { widthMm: 80 } });
    expect(res.syntheticBackground?.name).toBe('otomatik arka plan 2.png');
    expect(res.pack!.files.background).toBe('otomatik arka plan 2.png');
  });

  it('desenli arka planda anlaşılır hata verir', () => {
    const grid = paint(800, 1200, (x, y) => (x % 40 < 4 || y % 40 < 4 ? [40, 90, 220, 255] : [250, 245, 170, 255]));
    const res = initPack([prepareLoadedFile('izgara.png', EMPTY, grid)]);
    expect(res.pack).toBeNull();
    expect(res.messages[0]).toMatchObject({ level: 'error', code: 'SHEET_BUSY' });
    expect(res.messages[0].text).toContain('arka plan PNG');
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

  it('mm cinsinden sadeleştirme ve öğe override’ı önbellekte ayrı tutulur', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    const assets = assetsOf(files), cache = new Map();
    pack!.defaults.simplifyMm = 0;
    const detailed = computeCuts(pack!, assets, cache).cuts;
    pack!.defaults.simplifyMm = 0.2;
    const simple = computeCuts(pack!, assets, cache).cuts;
    const id = pack!.items[0].id;
    expect(simple.get(id)!.length).toBeLessThan(detailed.get(id)!.length);
    pack!.items[0].overrides.simplifyMm = 0;
    const overridden = computeCuts(pack!, assets, cache).cuts;
    expect(overridden.get(id)!.length).toBe(detailed.get(id)!.length);
    expect(overridden.get(pack!.items[1].id)!.length).toBe(simple.get(pack!.items[1].id)!.length);
  });

  it('seçili sticker için negatif mm ofseti uygular, diğerlerini ve önbelleği korur', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    const assets = assetsOf(files), cache = new Map();
    const baseline = computeCuts(pack!, assets, cache).cuts;
    const item = pack!.items.find((i) => i.file === 'cay.png' && i.scale > 0.45)!;
    item.overrides.offsetMm = -0.5;
    const inset = computeCuts(pack!, assets, cache).cuts;
    const bounds = (pts: Parameters<typeof polygonBounds>[0]) => {
      const b = polygonBounds(pts);
      return { width: b.maxX - b.minX, height: b.maxY - b.minY };
    };
    const before = bounds(baseline.get(item.id)!);
    const after = bounds(inset.get(item.id)!);
    expect(before.width - after.width).toBeCloseTo(10, 0); // iki tarafta 0,5 mm; 0,1 mm/tasarım px
    expect(before.height - after.height).toBeCloseTo(10, 0);
    const other = pack!.items.find((i) => i.id !== item.id)!;
    expect(inset.get(other.id)).toEqual(baseline.get(other.id));
  });

  it('printOnly öğeleri kesmez; eksik dosyayı bildirir, opak PNG’yi keser', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].printOnly = true;
    pack!.items[1].file = 'yok.png';
    const opaque = prepareLoadedFile('opak.png', EMPTY, { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) });
    pack!.items[2].file = 'opak.png';
    const { cuts, messages } = computeCuts(pack!, assetsOf([...files, opaque]));
    expect(cuts.has(pack!.items[0].id)).toBe(false);
    expect(cuts.get(pack!.items[2].id)).toHaveLength(4); // sivri köşeli dikdörtgen (varsayılan 0 mm)
    pack!.items[2].overrides.rectCornerRadiusMm = 1.5;
    expect(computeCuts(pack!, assetsOf([...files, opaque])).cuts.get(pack!.items[2].id)).toHaveLength(8);
    expect(messages.filter((m) => m.level === 'error').map((m) => m.code)).toEqual(['MISSING_FILE']);
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
