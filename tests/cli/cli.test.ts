import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';
import { run, type Io } from '../../src/cli/run';
import { encodePng } from '../../src/cli/png';
import { makeScene } from '../helpers/scene';

let dir: string;
let lines: string[];
const io: Io = { out: (s) => lines.push(s), err: (s) => lines.push(s) };

beforeEach(() => {
  lines = [];
  dir = join(mkdtempSync(join(tmpdir(), 'sc-')), 'çay ve kahve'.normalize('NFD'));
  mkdirSync(join(dir, 'bases'), { recursive: true });
  mkdirSync(join(dir, 'assets'));
  const s = makeScene();
  writeFileSync(join(dir, 'bases', 'turk kahvesi.png'), encodePng(s.design));
  writeFileSync(join(dir, 'bases', 'turk kahvesi arka.png'), encodePng(s.background));
  for (const st of s.stickers) {
    const name = st.file === 'cay.png' ? 'çay.png'.normalize('NFD') : st.file;
    writeFileSync(join(dir, 'assets', name), encodePng(st.raster));
  }
});

describe('cli', () => {
  it('init → build uçtan uca çalışır', async () => {
    expect(await run(['init', dir, '--page', '80x120', '--json'], io)).toBe(0);
    const out = JSON.parse(lines.join('\n'));
    expect(out.items).toBe(4);
    const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
    expect(pack.items.map((i: { file: string }) => i.file)).toContain('assets/çay.png'.normalize('NFC'));
    expect(existsSync(join(dir, 'pack.preview.png'))).toBe(true);

    lines = [];
    expect(await run(['build', join(dir, 'pack.json'), '--offset', '1', '--white-border'], io)).toBe(0);
    const doc = await PDFDocument.load(readFileSync(join(dir, 'pack.pdf')));
    expect(doc.getPageCount()).toBe(2);
    expect(JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')).defaults.offsetMm).toBe(0); // bayrak kalıcı değil
    expect(await run(['build', join(dir, 'pack.json'), '--offset=-0.5', '-o', join(dir, 'inset.pdf')], io)).toBe(0);
    expect(existsSync(join(dir, 'inset.pdf'))).toBe(true);
  });

  it('preview komutu önizleme yazar', async () => {
    await run(['init', dir, '--page', '80x120'], io);
    expect(await run(['preview', join(dir, 'pack.json'), '--no-cut', '-o', join(dir, 'p.png')], io)).toBe(0);
    expect(existsSync(join(dir, 'p.png'))).toBe(true);
  });

  it('export → import → build çalışır', async () => {
    await run(['init', dir, '--page', '80x120'], io);
    const zip = join(dir, '..', 'paket.zip');
    expect(await run(['export', join(dir, 'pack.json'), '-o', zip], io)).toBe(0);
    const target = join(dir, '..', 'acilan');
    expect(await run(['import', zip, target], io)).toBe(0);
    expect(await run(['build', join(target, 'pack.json')], io)).toBe(0);
    expect(await run(['import', zip, target], io)).toBe(1); // üzerine yazmaz
  });

  it('--out başka klasördeyse yollar göreli ve export yine çalışır', async () => {
    const other = mkdtempSync(join(tmpdir(), 'sc-out-'));
    expect(await run(['init', dir, '--page', '80x120', '-o', join(other, 'kahve.pack.json')], io)).toBe(0);
    expect(await run(['build', join(other, 'kahve.pack.json')], io)).toBe(0);
    expect(existsSync(join(other, 'kahve.pack.pdf'))).toBe(true);
    expect(await run(['export', join(other, 'kahve.pack.json'), '-o', join(other, 'k.zip')], io)).toBe(0);
  });

  it('belirsiz rollerde açık hata ve ipucuyla çözüm', async () => {
    const s = makeScene();
    writeFileSync(join(dir, 'bases', 'baska.png'), encodePng(s.design));
    writeFileSync(join(dir, 'bases', 'baska arka.png'), encodePng(s.background));
    expect(await run(['init', dir], io)).toBe(1);
    expect(lines.join('\n')).toContain('Birden fazla');
    expect(await run(['init', dir, '--design', 'bases/turk kahvesi.png', '--background', 'bases/turk kahvesi arka.png'], io)).toBe(0);
  });

  it('build dışa aktarma bayrakları: svg, png klasörü, paket, spot renk, yalnızca kesim', async () => {
    await run(['init', dir, '--page', '80x120'], io);
    const pack = join(dir, 'pack.json'), pngDir = join(dir, 'mockup');
    lines = [];
    expect(await run(['build', pack, '--svg', '--print-svg', '--png-dir', pngDir, '--dpi', '72', '--package', '--spot', '--json'], io)).toBe(0);
    const out = JSON.parse(lines.join('\n'));
    expect(existsSync(out.svgPath)).toBe(true);
    expect(readFileSync(out.svgPath, 'utf8')).toContain('<svg');
    expect(existsSync(out.printSvgPath)).toBe(true);
    expect(out.pngs.length).toBe(4);
    expect(out.pngs.every((p: string) => existsSync(p))).toBe(true);
    expect(existsSync(out.packagePath)).toBe(true);
    expect(out.options.spotColor).toBe(true);
    expect(await run(['build', pack, '--cut-only', '--no-layers', '-o', join(dir, 'kesim.pdf')], io)).toBe(0);
    expect((await PDFDocument.load(readFileSync(join(dir, 'kesim.pdf')))).getPageCount()).toBe(1);
  });

  it('compare kendi PDF’iyle eşleşir, 2 mm kaydırınca sapar', async () => {
    await run(['init', dir, '--page', '80x120'], io);
    const pack = join(dir, 'pack.json');
    expect(await run(['build', pack], io)).toBe(0);
    lines = [];
    expect(await run(['compare', pack, join(dir, 'pack.pdf'), '--json'], io)).toBe(0);
    const out = JSON.parse(lines.join('\n'));
    expect(out.cutPage).toBe(2);
    expect(out.summary.matched).toBe(out.summary.items);
    expect(out.items.every((i: { verdict: string }) => i.verdict === 'eşleşiyor')).toBe(true);
    const moved = JSON.parse(readFileSync(pack, 'utf8'));
    moved.items[0].x += 20; // 2 mm
    writeFileSync(pack, JSON.stringify(moved));
    lines = [];
    expect(await run(['compare', pack, join(dir, 'pack.pdf'), '--json'], io)).toBe(1);
    expect(JSON.parse(lines.join('\n')).items.find((i: { itemId: string }) => i.itemId === 'i1').verdict).toBe('sapıyor');
  });

  it('doctor rapor verir; eksik dosyada 1, --strict ile uyarıda 1 döner', async () => {
    await run(['init', dir, '--page', '80x120'], io);
    const pack = join(dir, 'pack.json');
    lines = [];
    expect(await run(['doctor', pack, '--json'], io)).toBe(0);
    const out = JSON.parse(lines.join('\n'));
    expect(out.items).toHaveLength(4);
    expect(out.items.every((i: { g1: boolean; lines: number }) => i.g1 && i.lines === 0)).toBe(true);
    const broken = JSON.parse(readFileSync(pack, 'utf8'));
    broken.items[1].file = 'assets/yok.png';
    writeFileSync(pack, JSON.stringify(broken));
    expect(await run(['doctor', pack], io)).toBe(1);
    expect(lines.join('\n')).toContain('HATA');
    await run(['init', dir, '--page', '80x120'], io);
    expect(await run(['doctor', pack, '--margin', '60', '--strict'], io)).toBe(1); // 60 mm kenar payı her şeyi uyarır
  });

  it('bilinmeyen komut kullanım metni ve 2 döner', async () => {
    expect(await run(['yok'], io)).toBe(2);
    expect(lines.join('\n')).toContain('Kullanım');
  });

  it('zip içindeki ters slash\'lı yol traversal hedef klasörün dışına çıkamaz', async () => {
    const outer = mkdtempSync(join(tmpdir(), 'sc-outer-'));
    const target = join(outer, 'target');
    mkdirSync(target);
    const zipPath = join(outer, 'evil.zip');
    const validPack = JSON.stringify({
      version: 1,
      page: { widthMm: 80, heightMm: 140 },
      designSize: { widthPx: 800, heightPx: 1200 },
      files: { design: 'd.png', background: 'b.png' },
      items: [],
    });
    writeFileSync(zipPath, zipSync({
      'pack.json': strToU8(validPack),
      '..\\..\\evil.txt': strToU8('pwned'),
    }));
    expect(await run(['import', zipPath, target], io)).toBe(1);
    expect(existsSync(join(outer, 'evil.txt'))).toBe(false);
  });
});
