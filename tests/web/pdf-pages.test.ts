import { describe, expect, it } from 'vitest';
import {
  classifyPage, renderScale, pdfPageFileName, uniqueFileName, pdfErrorText, isPdfFile, isPngFile, pageSizeNotice,
  PDF_DPI, PDF_MAX_PIXELS, MM_PER_PT,
} from '../../web/src/app/pdf-pages';

/** w×h RGBA; `paint(x, y)` → [r, g, b, a] ya da null (şeffaf). */
function raster(w: number, h: number, paint: (x: number, y: number) => number[] | null): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = paint(x, y);
    if (c) d.set(c, (y * w + x) * 4);
  }
  return d;
}
const RED = [230, 30, 40, 255], WHITE = [255, 255, 255, 255], INK = [90, 60, 40, 255];
const W = 160, H = 280; // 80×140 mm ≈ 50 dpi

describe('classifyPage', () => {
  it('ince kırmızı çerçeveler kesim sayfasıdır (şeffaf ya da beyaz zeminde)', () => {
    const ring = (x: number, y: number, cx: number, cy: number) => Math.abs(Math.hypot(x - cx, y - cy) - 25) < 0.8;
    const lines = (x: number, y: number) => ring(x, y, 50, 60) || ring(x, y, 110, 140) || ring(x, y, 60, 220);
    expect(classifyPage(raster(W, H, (x, y) => (lines(x, y) ? RED : null)), W, H)).toBe('cut');
    expect(classifyPage(raster(W, H, (x, y) => (lines(x, y) ? RED : WHITE)), W, H)).toBe('cut');
  });

  it('dolu şekiller ya da opak zemin çizimdir', () => {
    expect(classifyPage(raster(W, H, () => [200, 220, 140, 255]), W, H)).toBe('art');
    const blobs = (x: number, y: number) => Math.hypot(x - 50, y - 60) < 20 || Math.hypot(x - 110, y - 200) < 18;
    expect(classifyPage(raster(W, H, (x, y) => (blobs(x, y) ? INK : null)), W, H)).toBe('art');
  });

  it('şeffaf zeminde yalnızca beyaz şekiller de çizimdir; boş ve düz beyaz sayfa boştur', () => {
    expect(classifyPage(raster(W, H, (x, y) => (Math.hypot(x - 80, y - 140) < 30 ? WHITE : null)), W, H)).toBe('art');
    expect(classifyPage(raster(W, H, () => null), W, H)).toBe('blank');
    expect(classifyPage(raster(W, H, () => WHITE), W, H)).toBe('blank');
  });
});

describe('renderScale', () => {
  const pt = (mm: number) => mm / MM_PER_PT;
  it('80×140 mm sayfa 500 dpi çizilir', () => {
    const s = renderScale(pt(80), pt(140));
    expect(s).toBeCloseTo(PDF_DPI / 72, 6);
    expect(Math.round(pt(80) * s)).toBe(1575);
  });
  it('33×48 cm tabaka piksel sınırını aşmaz', () => {
    const s = renderScale(pt(330), pt(480));
    expect(pt(330) * s * pt(480) * s).toBeLessThanOrEqual(PDF_MAX_PIXELS + 1);
    expect(s).toBeLessThan(PDF_DPI / 72);
  });
});

describe('adlar ve hatalar', () => {
  it('PDF sayfa adları', () => {
    expect(pdfPageFileName('kahve pack.pdf', 1, 1)).toBe('kahve pack.png');
    expect(pdfPageFileName('Kedi.PDF', 2, 3)).toBe('Kedi sayfa 2.png');
    expect(pdfPageFileName('seal.ai', 1, 1)).toBe('seal.png');
  });
  it('çakışan ada numara eklenir', () => {
    expect(uniqueFileName('washi.png', new Set(['başka.png']))).toBe('washi.png');
    expect(uniqueFileName('washi.png', new Set(['washi.png', 'washi (2).png']))).toBe('washi (3).png');
  });
  it('dosya türleri', () => {
    expect(isPdfFile({ name: 'a.pdf' })).toBe(true);
    expect(isPdfFile({ name: 'a.ai' })).toBe(true);
    expect(isPdfFile({ name: 'adsız', type: 'application/pdf' })).toBe(true);
    expect(isPngFile({ name: 'a.PNG' })).toBe(true);
    expect(isPngFile({ name: 'a.pdf', type: 'image/png' })).toBe(false);
    expect(isPngFile({ name: 'a.txt', type: 'text/plain' })).toBe(false);
  });
  it('pdf.js hataları anlaşılır mesaja çevrilir', () => {
    expect(pdfErrorText('a.pdf', Object.assign(new Error('x'), { name: 'PasswordException' }))).toContain('şifreli');
    expect(pdfErrorText('eski.ai', Object.assign(new Error('x'), { name: 'InvalidPDFException' }))).toContain('PDF uyumlu');
    expect(pdfErrorText('a.pdf', Object.assign(new Error('x'), { name: 'InvalidPDFException' }))).toBe('a.pdf geçerli bir PDF değil.');
    expect(pdfErrorText('a.pdf', new Error('bozuk'))).toBe('a.pdf okunamadı: bozuk');
  });
  it('sayfa ölçüsü bildirimi Türkçe ondalık kullanır', () => {
    expect(pageSizeNotice(80, 140.04)).toBe('Sayfa ölçüsü PDF\'ten alındı: 80 × 140 mm.');
    expect(pageSizeNotice(52.04, 73.66)).toBe('Sayfa ölçüsü PDF\'ten alındı: 52 × 73,7 mm.');
  });
});
