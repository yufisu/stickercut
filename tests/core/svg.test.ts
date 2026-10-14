import { describe, it, expect } from 'vitest';
import { initPack, computeCuts, prepareLoadedFile, type LoadedFile } from '../../src/core/pipeline';
import { buildSvg, toBase64 } from '../../src/core/svg';
import { encodePng } from '../../src/cli/png';
import { makeScene } from '../helpers/scene';

function scene() {
  const s = makeScene();
  const f = (name: string, r: Parameters<typeof encodePng>[0]) => prepareLoadedFile(name, encodePng(r), r);
  const files: LoadedFile[] = [f('tasarim.png', s.design), f('arka.png', s.background), ...s.stickers.map((st) => f(st.file, st.raster))];
  const { pack } = initPack(files, { page: { widthMm: 80 } });
  const assets = new Map(files.map((x) => [x.name, x]));
  return { pack: pack!, assets, cuts: () => computeCuts(pack!, assets).cuts };
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('buildSvg', () => {
  it('kesim SVG: mm kök öznitelikleri, printOnly hariç her öğeye bir yol, kırmızı kontur, Bézier', () => {
    const { pack, cuts } = scene();
    pack.items[0].printOnly = true;
    pack.items[1].overrides.strokeWidthPt = 2;
    const svg = buildSvg(pack, cuts(), { pages: 'cut' });
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="80mm" height="120mm" viewBox="0 0 80 120">');
    expect(svg).toContain('<g id="Kesim" data-name="Kesim" fill="none" stroke="#ff0000" stroke-width="0.353" stroke-linejoin="round">');
    expect(count(svg, /<path /g)).toBe(3);
    expect(svg).not.toContain('id="i1"');
    expect(svg).toMatch(/<path id="i2" stroke-width="0.706" d="M [^"]* C [^"]* Z"\/>/);
    expect(svg).not.toContain('<image');
    // Tüm koordinatlar sayfanın içinde (mm).
    const nums = [...svg.matchAll(/ d="([^"]*)"/g)].flatMap((m) => m[1].match(/-?\d+(\.\d+)?/g)!.map(Number));
    expect(Math.max(...nums)).toBeLessThanOrEqual(120);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
  });

  it('baskı SVG: benzersiz dosya başına bir base64 görsel, her öğeye bir <use>, beyaz kenar dolguları', () => {
    const { pack, assets, cuts } = scene();
    pack.defaults.whiteBorder = true;
    const cay = pack.items.find((i) => i.file === 'cay.png' && i.scale > 0.45)!;
    Object.assign(cay, { x: 220, y: 260, scale: 0.5, rotationDeg: 0 });
    const svg = buildSvg(pack, cuts(), { pages: 'both', assets });
    expect(count(svg, /data:image\/png;base64,/g)).toBe(4); // arka plan + 3 benzersiz sticker (cay iki kez kullanılıyor)
    expect(count(svg, /<use /g)).toBe(4);
    expect(count(svg, /<path fill="#fff" d="/g)).toBe(4);
    expect(svg).toContain('<g id="Baski" data-name="Baskı">');
    expect(svg.indexOf('id="Baski"')).toBeLessThan(svg.indexOf('id="Kesim"'));
    expect(svg).toMatch(/<image id="img-cay\.png" width="400" height="400" xlink:href="data:image\/png;base64,/);
    expect(svg).toContain('<use xlink:href="#img-cay.png" transform="matrix(0.05 0 0 0.05 12 16)"/>');
    expect(svg).toMatch(/<image width="80" height="120" preserveAspectRatio="none" xlink:href="data:image\/png;base64,/);
    // Beyaz dolgular arka plandan sonra, sticker’lardan önce gelir.
    expect(svg.indexOf('<path fill="#fff"')).toBeGreaterThan(svg.indexOf('preserveAspectRatio'));
    expect(svg.indexOf('<path fill="#fff"')).toBeLessThan(svg.indexOf('<use '));
  });

  it('units:"pt" viewBox’u pt yapar, ölçüler mm kalır; layers:false grup adlarını bırakır', () => {
    const { pack, cuts } = scene();
    const svg = buildSvg(pack, cuts(), { pages: 'cut', units: 'pt', strokeHex: '#f00', layers: false });
    expect(svg).toContain('width="80mm" height="120mm" viewBox="0 0 226.772 340.157"');
    expect(svg).toContain('<g fill="none" stroke="#f00" stroke-width="1" stroke-linejoin="round">');
    expect(svg).not.toContain('data-name');
  });

  it('baskı istenip dosya verilmezse açık hata verir', () => {
    const { pack, cuts } = scene();
    expect(() => buildSvg(pack, cuts(), { pages: 'print' })).toThrow('Dosya eksik');
  });
});

describe('toBase64', () => {
  it('Buffer ile aynı sonucu verir', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 1000, 3001, 200_000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 73 + 11) % 256);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
