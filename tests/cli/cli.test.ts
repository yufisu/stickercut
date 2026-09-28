import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
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

  it('bilinmeyen komut kullanım metni ve 2 döner', async () => {
    expect(await run(['yok'], io)).toBe(2);
    expect(lines.join('\n')).toContain('Kullanım');
  });
});
