import { describe, it, expect } from 'vitest';
import { estimateSheetBackground, analyzeSheet, eraseRegions, encodeRasterAt, hexOf } from '../../src/core/sheet';
import { encodePngRgba, encodePngRows } from '../../src/core/png-encode';
import { decodePng } from '../../src/cli/png';
import { cloneRaster, createRaster, drawRaster } from '../../src/core/render';
import { itemMatrix } from '../../src/core/geometry';
import { makeScene, paint, STICKERS, PLACEMENTS, BG } from '../helpers/scene';
import type { Raster } from '../../src/core/raster';

const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];

/** Şeffaf sayfa: aynı sticker'lar, arka plansız. */
function transparentSheet(): Raster {
  const sheet = createRaster(800, 1200);
  for (const p of PLACEMENTS) {
    const s = STICKERS[p.file]();
    drawRaster(sheet, s, itemMatrix({ ...p, rotationDeg: 0 }, s.width, s.height));
  }
  return sheet;
}

describe('estimateSheetBackground', () => {
  it('düz renkli sayfada baskın rengi ve kenar kapsamını bulur', () => {
    const bg = estimateSheetBackground(makeScene().design);
    expect(bg.kind).toBe('flat');
    for (let c = 0; c < 3; c++) expect(Math.abs(bg.rgb[c] - BG[c])).toBeLessThanOrEqual(2);
    expect(bg.edgeCoverage).toBeGreaterThan(0.95);
    expect(bg.coverage).toBeGreaterThan(0.6);
    expect(hexOf([200, 220, 140])).toBe('#c8dc8c');
  });
  it('çoğu şeffaf sayfayı şeffaf arka plan sayar', () => {
    const bg = estimateSheetBackground(transparentSheet());
    expect(bg.kind).toBe('transparent');
    expect(bg.transparentRatio).toBeGreaterThan(0.5);
  });
});

describe('analyzeSheet', () => {
  it('düz sayfada her sticker ayrı aday, karar ok', () => {
    const a = analyzeSheet(makeScene().design);
    expect(a.verdict).toBe('ok');
    expect(a.regions).toHaveLength(PLACEMENTS.length);
    expect(a.kept).toHaveLength(0);
  });
  it('sayfa kenarına dayanan başlık bandı ve köşe süsü arka planda kalır', () => {
    const d = cloneRaster(makeScene().design);
    const band = paint(800, 90, () => [180, 40, 40, 255]);
    const corner = paint(60, 60, () => [40, 40, 180, 255]);
    drawRaster(d, band, [1, 0, 0, 1, 0, 0]);
    drawRaster(d, corner, [1, 0, 0, 1, 740, 1140]);
    const a = analyzeSheet(d);
    expect(a.kept).toHaveLength(2);
    expect(a.regions).toHaveLength(PLACEMENTS.length);
    expect(a.verdict).toBe('ok');
  });
  it('ızgara desenli arka planı ayıramaz (busy)', () => {
    const grid = paint(800, 1200, (x, y) => (x % 40 < 4 || y % 40 < 4 ? [40, 90, 220, 255] : [250, 245, 170, 255]));
    const s = STICKERS['cay.png']();
    drawRaster(grid, s, itemMatrix({ x: 400, y: 600, scale: 0.6, rotationDeg: 0 }, s.width, s.height));
    expect(analyzeSheet(grid).verdict).toBe('busy');
  });
  it('şeffaf sayfada beyaz sticker da bulunur', () => {
    const sheet = transparentSheet();
    const white = paint(200, 200, (x, y) => ((x - 100) ** 2 + (y - 100) ** 2 < 90 ** 2 ? [255, 255, 255, 255] : null));
    drawRaster(sheet, white, [1, 0, 0, 1, 300, 520]);
    const a = analyzeSheet(sheet);
    expect(a.background.kind).toBe('transparent');
    expect(a.regions).toHaveLength(PLACEMENTS.length + 1);
  });
});

describe('eraseRegions', () => {
  it('sticker yerlerini çevre rengiyle doldurur, geri kalanı aynen bırakır', () => {
    const d = makeScene().design;
    const erased = eraseRegions(d, analyzeSheet(d));
    for (const p of PLACEMENTS) {
      const c = px(erased, p.x, p.y);
      for (let k = 0; k < 3; k++) expect(Math.abs(c[k] - BG[k])).toBeLessThanOrEqual(3);
      expect(c[3]).toBe(255);
    }
    expect(px(erased, 5, 5)).toEqual(px(d, 5, 5));
    expect(px(erased, 400, 600)).toEqual(px(d, 400, 600));
  });
  it('şeffaf sayfada sticker yerlerini şeffaf yapar', () => {
    const sheet = transparentSheet();
    const erased = eraseRegions(sheet, analyzeSheet(sheet));
    for (const p of PLACEMENTS) expect(px(erased, p.x, p.y)[3]).toBe(0);
  });
});

describe('PNG kodlama', () => {
  it('satır satır kodlama tek parça kodlamayla aynı pikselleri verir', () => {
    const r = paint(37, 23, (x, y) => [x * 6, y * 11, (x * y) % 256, 255 - x]);
    const rows = decodePng(encodePngRows(37, 23, (y, out) => out.set(r.data.subarray(y * 37 * 4, (y + 1) * 37 * 4))));
    expect([...rows.data]).toEqual([...decodePng(encodePngRgba(r)).data]);
  });
  it('encodeRasterAt aynı boyutta birebir, farklı boyutta ölçekleyerek kodlar', () => {
    const flat = paint(50, 40, () => [12, 200, 90, 255]);
    expect([...decodePng(encodeRasterAt(flat, 50, 40)).data]).toEqual([...flat.data]);
    const big = decodePng(encodeRasterAt(flat, 125, 100));
    expect([big.width, big.height]).toEqual([125, 100]);
    expect(px(big, 60, 50)).toEqual([12, 200, 90, 255]);
    const clear = decodePng(encodeRasterAt(createRaster(10, 10), 30, 30));
    expect(px(clear, 15, 15)[3]).toBe(0);
  });
});
