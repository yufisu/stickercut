/**
 * PDF (ve PDF uyumlu .ai) sayfalarını PNG'ye çizer. Yalnızca bir PDF bırakılınca dinamik import edilir;
 * pdf.js ana pakete girmez. Eski tarayıcı derlemesi kullanılır: iPad Safari'de eksik dil özellikleri dolgulanır.
 */
import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { classifyPage, renderScale, MM_PER_PT, PDF_DPI, PDF_MAX_PIXELS, PDF_PROBE_DPI, type PageKind } from '../app/pdf-pages';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfPage {
  /** 1'den başlar. */
  page: number;
  kind: PageKind;
  widthMm: number;
  heightMm: number;
  /** Yalnızca alınan çizimli sayfalarda dolu. */
  png: Uint8Array | null;
}

export interface RasterizeOptions {
  dpi?: number;
  maxPixels?: number;
  /** Bu kadar çizimli sayfa PNG'ye çevrilir; sonrakiler yalnızca sınıflanır (`png: null`). */
  maxArtPages?: number;
  onProgress?: (done: number, total: number) => void;
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  // iOS tuval belleğini hemen geri versin.
  canvas.width = 0;
  canvas.height = 0;
}

/** Sayfayı şeffaf zeminle çizer (çizimde zemin yoksa PNG'de de olmaz). */
async function draw(page: PDFPageProxy, scale: number): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!ctx) throw new Error('Tuval açılamadı.');
  // `canvas: null` + kendi bağlamımız: pdf.js aksi halde opak (alpha: false) bağlam açıp beyazla doldurur.
  await page.render({ canvasContext: ctx, canvas: null, viewport, background: 'rgba(0,0,0,0)' }).promise;
  return { canvas, ctx };
}

function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Sayfa PNG\'ye çevrilemedi (bellek yetmedi olabilir).')); return; }
      blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, 'image/png');
  });
}

/** Her sayfayı türüne göre sınıflar; çizimli sayfaları PNG'ye çevirir. */
export async function rasterizePdf(data: Uint8Array, opts: RasterizeOptions = {}): Promise<PdfPage[]> {
  const task = getDocument({ data, enableXfa: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages: PdfPage[] = [];
    let art = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      opts.onProgress?.(n - 1, doc.numPages);
      const page = await doc.getPage(n);
      const size = page.getViewport({ scale: 1 }); // pt; /Rotate ve /UserUnit dahil
      const widthMm = size.width * MM_PER_PT, heightMm = size.height * MM_PER_PT;

      const probe = await draw(page, PDF_PROBE_DPI / 72);
      const kind = classifyPage(probe.ctx.getImageData(0, 0, probe.canvas.width, probe.canvas.height).data, probe.canvas.width, probe.canvas.height);
      releaseCanvas(probe.canvas);

      let png: Uint8Array | null = null;
      if (kind === 'art' && art < (opts.maxArtPages ?? Infinity)) {
        const full = await draw(page, renderScale(size.width, size.height, opts.dpi ?? PDF_DPI, opts.maxPixels ?? PDF_MAX_PIXELS));
        try { png = await toPng(full.canvas); } finally { releaseCanvas(full.canvas); }
        art++;
      }
      page.cleanup();
      pages.push({ page: n, kind, widthMm, heightMm, png });
    }
    opts.onProgress?.(doc.numPages, doc.numPages);
    return pages;
  } finally {
    await task.destroy();
  }
}
