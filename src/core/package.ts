import { zipSync, strToU8, type Zippable, type ZipOptions } from 'fflate';
import { type Pack, PT_PER_MM, effectiveSettings, mmPerDesignPx, itemLabel } from './project';
import { type Pt, polygonBounds } from './geometry';
import { type CutCache, type LoadedFile, type Message, computeCuts, formatMessage, packAssetNames } from './pipeline';
import { type PdfAsset, buildPdf } from './pdf';
import { buildSvg } from './svg';
import { renderAllStickerPngs } from './export-png';
import { encodePngRgba } from './png-encode';

export interface PackageOptions {
  /** Dosya adlarının kökü (ör. "kahve" → kahve.pdf, kahve-kesim.pdf …). */
  name: string;
  /** Mockup PNG çözünürlüğü (varsayılan 300). */
  pngDpi?: number;
  /** mockup/ klasörüne sticker başına PNG (varsayılan açık). */
  mockups?: boolean;
  /** Baskı görseli + kesim çizgilerini içeren SVG de eklensin (varsayılan kapalı). */
  printSvg?: boolean;
  spotColor?: boolean;
  spotName?: string;
  layers?: boolean;
  /** README tarihi; verilmezse bugün. */
  date?: Date;
}

export async function buildPrinterPackage(
  pack: Pack, files: Map<string, LoadedFile>, cache: CutCache | undefined, opts: PackageOptions,
): Promise<{ zip: Uint8Array | null; entries: string[]; messages: Message[] }> {
  const { cuts, messages } = computeCuts(pack, files, cache);
  const assets = new Map<string, PdfAsset>();
  for (const name of packAssetNames(pack)) {
    const f = files.get(name);
    if (f) assets.set(name, f);
    else if (name === pack.files.background || name === pack.files.design) {
      messages.push({ level: 'error', code: 'MISSING_FILE', file: name, text: `"${name}" dosyası projede yok.` });
    }
  }
  if (messages.some((m) => m.level === 'error')) return { zip: null, entries: [], messages };

  const { name, pngDpi = 300, mockups = true, printSvg = false, spotColor, spotName, layers } = opts;
  const pdfOpts = { spotColor, spotName, layers };
  const text = (s: string): [Uint8Array, ZipOptions] => [strToU8(s), { level: 6 }];
  const binary = (b: Uint8Array): [Uint8Array, ZipOptions] => [b, { level: 0 }]; // PDF/PNG zaten sıkıştırılmış
  const zip: Zippable = {
    [`${name}.pdf`]: binary(await buildPdf({ pack, assets, cuts }, pdfOpts)),
    [`${name}-kesim.pdf`]: binary(await buildPdf({ pack, assets, cuts }, { ...pdfOpts, pages: 'cut' })),
    [`${name}-kesim.svg`]: text(buildSvg(pack, cuts, { pages: 'cut', layers })),
  };
  if (printSvg) zip[`${name}-baski.svg`] = text(buildSvg(pack, cuts, { pages: 'both', assets, layers }));
  if (mockups) {
    const r = renderAllStickerPngs(pack, files, cuts, { dpi: pngDpi });
    messages.push(...r.messages);
    for (const s of r.renders) zip[`mockup/${s.name}`] = binary(encodePngRgba(s.raster));
  }
  const entries = [...Object.keys(zip), 'README.txt'];
  zip['README.txt'] = text(readmeText(pack, cuts, entries, opts, messages));
  return { zip: zipSync(zip), entries, messages };
}

const mmText = (v: number) => String(Math.round(v * 10) / 10);
const range = (a: number, b: number) => `${mmText(a)}–${mmText(b)}`;

/** Baskıcıya giden düz metin açıklama; Türkçe, UTF-8. */
export function readmeText(pack: Pack, cuts: Map<string, Pt[]>, entries: string[], opts: PackageOptions, messages: Message[]): string {
  const { name, pngDpi = 300, spotColor, spotName = 'CutContour', layers = true } = opts;
  const mm = mmPerDesignPx(pack);
  const { widthMm: w, heightMm: h } = pack.page;
  const cutItems = pack.items.filter((i) => !i.printOnly && cuts.has(i.id));
  const printOnly = pack.items.filter((i) => i.printOnly).length;
  const widths = [...new Set(cutItems.map((i) => effectiveSettings(pack, i).strokeWidthPt))].join(' / ');
  const explain = (e: string) =>
    e === `${name}.pdf` ? 'İki sayfa: 1. sayfa baskı görseli, 2. sayfa kesim çizgileri.'
    : e === `${name}-kesim.pdf` ? 'Yalnızca kesim sayfası.'
    : e === `${name}-kesim.svg` ? 'Kesim çizgileri, mm biriminde SVG.'
    : e === `${name}-baski.svg` ? 'Baskı görseli ve kesim çizgileri tek SVG’de (Baskı / Kesim grupları).'
    : e.startsWith('mockup/') ? `Sticker önizlemesi, ${pngDpi} dpi, kesim silüetine göre kırpılmış.`
    : e === 'README.txt' ? 'Bu dosya.' : '';
  const col = Math.max(...entries.map((e) => e.length)) + 2;
  const title = `${name} – baskı paketi (stickercut)`;
  const section = (t: string) => ['', t, '-'.repeat(t.length)];
  const lines = [
    title, '='.repeat(title.length), '',
    `Tarih: ${(opts.date ?? new Date()).toISOString().slice(0, 10)}`,
    `Sayfa: ${mmText(w)} × ${mmText(h)} mm (${(w * PT_PER_MM).toFixed(2)} × ${(h * PT_PER_MM).toFixed(2)} pt)`,
    'Kutular: MediaBox, CropBox, BleedBox, TrimBox ve ArtBox sayfanın kendisidir; taşma payı yok.',
    `İçerik: ${pack.items.length} sticker, ${cutItems.length} kesim çizgisi, ${printOnly} sadece baskı.`,
    ...section('Dosyalar'),
    ...entries.map((e) => `${e.padEnd(col)}${explain(e)}`),
    ...section('Kesim çizgisi'),
    `Her sticker için kapalı bir Bézier yolu: ${widths || pack.defaults.strokeWidthPt} pt kontur, RGB kırmızı (1,0,0), dolgu yok.`,
    ...(spotColor ? [`Kesim çizgileri ayrıca "${spotName}" adlı spot renkle (Separation, alternatif DeviceCMYK 0/100/100/0) tanımlı; kırmızı sadece ekranda görünür.`] : []),
    layers
      ? 'PDF’de içerik "Baskı" ve "Kesim" adlı iki katmanda (OCG); sayfalar da aynı adlarla etiketli.'
      : 'PDF’de katman (OCG) yok; 1. sayfa baskı, 2. sayfa kesim.',
    'Tabaka dizimi (33 × 48 cm) baskıcı tarafından yapılır; sayfalar ölçeklenmeden yerleştirilmelidir.',
    ...section('Stickerlar'),
    ...pack.items.map((item) => {
      const cut = cuts.get(item.id);
      const source = item.file ?? itemLabel(item);
      if (!cut || item.printOnly) return `${item.id}\t${source}\t${item.printOnly ? 'sadece baskı' : 'kesim yok'}`;
      const b = polygonBounds(cut);
      const x0 = b.minX * mm.x, x1 = b.maxX * mm.x, y0 = b.minY * mm.y, y1 = b.maxY * mm.y;
      return `${item.id}\t${source}\tx ${range(x0, x1)} mm\ty ${range(y0, y1)} mm\t${mmText(x1 - x0)} × ${mmText(y1 - y0)} mm`;
    }),
  ];
  const warnings = messages.filter((m) => m.level !== 'error');
  if (warnings.length) lines.push(...section('Uyarılar'), ...warnings.map(formatMessage));
  return lines.join('\n') + '\n';
}
