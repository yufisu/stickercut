/**
 * PDF girdisi için saf yardımcılar. pdf.js'e bağlı değil: ana pakete girer ve testte çalışır.
 * PDF'in kendisini çizen kod `platform/pdf-raster.ts`'te, yalnızca PDF bırakılınca yüklenir.
 */

/** Çizimli sayfaların hedef çözünürlüğü. Procreate dışa aktarımları (1600 px / 80 mm ≈ 508 dpi) ile aynı düzeyde. */
export const PDF_DPI = 500;
/** iPad tuval sınırının (16.7 MP) güvenli altı; büyük tabakalarda çözünürlük buna göre düşer. */
export const PDF_MAX_PIXELS = 8_000_000;
/** Sayfa türünü anlamak için yapılan küçük çizimin çözünürlüğü. */
export const PDF_PROBE_DPI = 50;
/** Kurulumda bir PDF'ten en fazla bu kadar çizimli sayfa alınır. */
export const PDF_MAX_PAGES = 12;

export const MM_PER_PT = 25.4 / 72;

export type PageKind = 'art' | 'cut' | 'blank';

export const isPdfFile = (f: { name: string; type?: string }): boolean =>
  /\.(pdf|ai)$/i.test(f.name) || f.type === 'application/pdf';

export const isPngFile = (f: { name: string; type?: string }): boolean =>
  !isPdfFile(f) && (/\.png$/i.test(f.name) || f.type === 'image/png');

/** pt cinsinden sayfa ölçüsü → pt başına piksel. Toplam piksel `maxPixels`'ı aşmaz. */
export function renderScale(widthPt: number, heightPt: number, dpi = PDF_DPI, maxPixels = PDF_MAX_PIXELS): number {
  const wanted = dpi / 72;
  const cap = Math.sqrt(maxPixels / Math.max(1, widthPt * heightPt));
  return Math.min(wanted, cap);
}

/**
 * Küçük (≈50 dpi) RGBA çizimden sayfa türü.
 * Kesim sayfaları ince çizgilerden oluşur: boyalı piksellerin neredeyse hiçbiri dört komşusuyla çevrili değildir.
 * Gerçek sayfalarda ölçüldü: kesim sayfalarında bu oran %0, çizimli sayfalarda ≥ %79.
 */
export function classifyPage(data: ArrayLike<number>, width: number, height: number): PageKind {
  const n = width * height;
  const ink = new Uint8Array(n);
  let inkCount = 0, opaque = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    opaque++;
    // Beyaza yakın olmayan her opak piksel "boya" sayılır (beyaz zemin ve beyaz kenar dolguları sayılmaz).
    if (255 - Math.min(data[i], data[i + 1], data[i + 2]) > 40) { ink[p] = 1; inkCount++; }
  }
  if (inkCount < n * 0.001) {
    // Boya yok: tamamen boş ya da düz beyaz sayfa. Şeffaf zeminde beyaz şekiller varsa çizimdir.
    return opaque > n * 0.005 && opaque < n * 0.98 ? 'art' : 'blank';
  }
  if (inkCount > n * 0.15) return 'art';
  let interior = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (ink[p] && ink[p - 1] && ink[p + 1] && ink[p - width] && ink[p + width]) interior++;
    }
  }
  return interior < inkCount * 0.25 ? 'cut' : 'art';
}

/** `kahve pack.pdf` → `kahve pack.png`; çok sayfalıysa `kahve pack sayfa 2.png`. */
export function pdfPageFileName(pdfName: string, page: number, artPages: number): string {
  const stem = pdfName.replace(/\.(pdf|ai)$/i, '');
  return artPages > 1 ? `${stem} sayfa ${page}.png` : `${stem}.png`;
}

/** Ad alınmışsa `ad (2).png`, `ad (3).png` … */
export function uniqueFileName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const stem = name.replace(/\.png$/i, '');
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i}).png`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** pdf.js hatalarını kullanıcıya anlaşılır Türkçe mesaja çevirir. */
export function pdfErrorText(fileName: string, e: unknown): string {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'PasswordException') return `${fileName} şifreli. Şifresiz kaydedip yeniden yükle.`;
  if (name === 'InvalidPDFException') {
    return /\.ai$/i.test(fileName)
      ? `${fileName} açılamadı. Illustrator'da "PDF uyumlu dosya oluştur" seçeneğiyle kaydet ya da PDF olarak dışa aktar.`
      : `${fileName} geçerli bir PDF değil.`;
  }
  const detail = e instanceof Error ? e.message : String(e);
  return `${fileName} okunamadı: ${detail}`;
}

const fmtMm = (v: number) => (Math.round(v * 10) / 10).toLocaleString('tr-TR');

/** Kurulumda sayfa ölçüsü PDF'ten alındığında gösterilen bildirim. */
export const pageSizeNotice = (widthMm: number, heightMm: number) =>
  `Sayfa ölçüsü PDF'ten alındı: ${fmtMm(widthMm)} × ${fmtMm(heightMm)} mm.`;
