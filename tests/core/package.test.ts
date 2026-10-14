import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { initPack, prepareLoadedFile, type LoadedFile } from '../../src/core/pipeline';
import { buildPrinterPackage } from '../../src/core/package';
import { encodePng } from '../../src/cli/png';
import { makeScene } from '../helpers/scene';

function scene() {
  const s = makeScene();
  const f = (name: string, r: Parameters<typeof encodePng>[0]) => prepareLoadedFile(name, encodePng(r), r);
  const files: LoadedFile[] = [f('tasarim.png', s.design), f('arka.png', s.background), ...s.stickers.map((st) => f(`assets/${st.file}`, st.raster))];
  const { pack } = initPack(files, { page: { widthMm: 80 } });
  return { pack: pack!, files: new Map(files.map((x) => [x.name, x])) };
}

describe('buildPrinterPackage', () => {
  it('zip girdileri, PDF sayfa sayıları ve README içeriği', async () => {
    const { pack, files } = scene();
    pack.items[0].printOnly = true;
    const { zip, entries, messages } = await buildPrinterPackage(pack, files, undefined, { name: 'kahve', date: new Date('2026-10-14T09:00:00Z') });
    expect(messages.filter((m) => m.level === 'error')).toEqual([]);
    const got = unzipSync(zip!);
    expect(Object.keys(got).sort()).toEqual([...entries].sort());
    expect(entries).toEqual([
      'kahve.pdf', 'kahve-kesim.pdf', 'kahve-kesim.svg',
      ...pack.items.slice(1).map((i) => `mockup/${i.id}-${i.file.slice('assets/'.length)}`),
      'README.txt',
    ]);
    expect((await PDFDocument.load(got['kahve.pdf'])).getPageCount()).toBe(2);
    expect((await PDFDocument.load(got['kahve-kesim.pdf'])).getPageCount()).toBe(1);
    expect(strFromU8(got['kahve-kesim.svg'])).toContain('id="Kesim"');
    expect([...got['mockup/i2-kahve.png'].subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const readme = strFromU8(got['README.txt']);
    expect(readme.startsWith('kahve – baskı paketi')).toBe(true);
    expect(readme).toContain('Tarih: 2026-10-14');
    expect(readme).toContain('Sayfa: 80 × 120 mm (226.77 × 340.16 pt)');
    expect(readme).toContain('4 sticker, 3 kesim çizgisi, 1 sadece baskı');
    expect(readme).toContain('1 pt kontur, RGB kırmızı (1,0,0), dolgu yok');
    expect(readme).toContain('"Baskı" ve "Kesim"');
    expect(readme).toContain('Tabaka dizimi (33 × 48 cm) baskıcı tarafından yapılır');
    expect(readme).toContain('i1\tassets/cay.png\tsadece baskı');
    expect(readme).toMatch(/i2\tassets\/kahve\.png\tx [\d.]+–[\d.]+ mm\ty [\d.]+–[\d.]+ mm\t[\d.]+ × [\d.]+ mm/);
    expect(readme).not.toContain('CutContour');
    for (const e of entries) expect(readme).toContain(e);
  });

  it('seçenekler: spot renk ve katmansızlık README’ye yansır, baskı SVG’si eklenir, mockup kapatılabilir', async () => {
    const { pack, files } = scene();
    const { zip, entries } = await buildPrinterPackage(pack, files, undefined, {
      name: 'k', mockups: false, printSvg: true, spotColor: true, spotName: 'KissCut', layers: false,
    });
    expect(entries).toEqual(['k.pdf', 'k-kesim.pdf', 'k-kesim.svg', 'k-baski.svg', 'README.txt']);
    const got = unzipSync(zip!);
    const readme = strFromU8(got['README.txt']);
    expect(readme).toContain('"KissCut" adlı spot renk');
    expect(readme).toContain('katman (OCG) yok');
    expect(strFromU8(got['k-baski.svg'])).toContain('data:image/png;base64,');
    expect(strFromU8(got['k-kesim.svg'])).not.toContain('id="Kesim"');
  });

  it('eksik dosyada zip null ve hata mesajı döner', async () => {
    const { pack, files } = scene();
    pack.items[0].file = 'yok.png';
    const { zip, entries, messages } = await buildPrinterPackage(pack, files, undefined, { name: 'k' });
    expect(zip).toBeNull();
    expect(entries).toEqual([]);
    expect(messages.some((m) => m.code === 'MISSING_FILE')).toBe(true);
  });
});
