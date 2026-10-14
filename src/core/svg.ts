import { type Pack, PT_PER_MM, effectiveSettings, mmPerDesignPx } from './project';
import { type Affine, type Pt, multiply, itemMatrix, transformPoints, closedPathSvg } from './geometry';
import type { PdfAsset } from './pdf';

export interface SvgOptions {
  pages: 'cut' | 'print' | 'both';
  /** Baskı katmanı için PNG baytları; data URI olarak gömülür. */
  assets?: Map<string, PdfAsset>;
  /** viewBox birimi; genişlik/yükseklik her zaman mm (varsayılan mm). */
  units?: 'mm' | 'pt';
  /** Grupları Baskı / Kesim adlarıyla etiketle (varsayılan açık). */
  layers?: boolean;
  /** Kesim çizgisi rengi (varsayılan #ff0000). */
  strokeHex?: string;
}

const fmt = (v: number, digits = 3) => String(Number(v.toFixed(digits)));
/** XML id: ASCII harf/rakam/_ . - dışı karakterler _ olur; harfle başlamazsa _ eklenir. */
const xmlId = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^(?![A-Za-z_])/, '_');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** btoa/Buffer olmadan base64; büyük PNG’ler için parça parça birleştirir. */
export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0), rest = bytes.length - i;
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (rest > 1 ? B64[(n >> 6) & 63] : '=') + (rest > 2 ? B64[n & 63] : '=');
    if (s.length >= 0x10000) { parts.push(s); s = ''; }
  }
  parts.push(s);
  return parts.join('');
}

export function buildSvg(pack: Pack, cuts: Map<string, Pt[]>, opts: SvgOptions): string {
  const { pages, units = 'mm', layers = true, strokeHex = '#ff0000' } = opts;
  const u = units === 'pt' ? PT_PER_MM : 1;                 // mm → viewBox birimi
  const mm = mmPerDesignPx(pack);
  const toUnit: Affine = [mm.x * u, 0, 0, mm.y * u, 0, 0];   // tasarım px → viewBox birimi
  const pageW = pack.page.widthMm * u, pageH = pack.page.heightMm * u;
  const strokeWidth = (pt: number) => fmt(units === 'pt' ? pt : pt / PT_PER_MM);
  const label = (id: string, name: string) => (layers ? ` id="${id}" data-name="${name}"` : '');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(pack.page.widthMm)}mm" height="${fmt(pack.page.heightMm)}mm" viewBox="0 0 ${fmt(pageW)} ${fmt(pageH)}">`,
  ];

  if (pages !== 'cut') {
    const asset = (file: string) => {
      const a = opts.assets?.get(file);
      if (!a) throw new Error(`Dosya eksik: ${file}`);
      return a;
    };
    const dataUri = (file: string) => `data:image/png;base64,${toBase64(asset(file).bytes)}`;
    const ids = new Map<string, string>(), taken = new Set<string>();
    for (const file of new Set(pack.items.map((i) => i.file))) {
      let id = `img-${xmlId(file)}`;
      for (let n = 2; taken.has(id); n++) id = `img-${xmlId(file)}-${n}`;
      taken.add(id);
      ids.set(file, id);
    }
    lines.push(`<g${label('Baski', 'Baskı')}>`, '<defs>');
    for (const [file, id] of ids) lines.push(`<image id="${id}" width="${asset(file).width}" height="${asset(file).height}" xlink:href="${dataUri(file)}"/>`);
    lines.push('</defs>', `<image width="${fmt(pageW)}" height="${fmt(pageH)}" preserveAspectRatio="none" xlink:href="${dataUri(pack.files.background)}"/>`);
    for (const item of pack.items) {
      const cut = cuts.get(item.id);
      if (cut && !item.printOnly && effectiveSettings(pack, item).whiteBorder) lines.push(`<path fill="#fff" d="${closedPathSvg(transformPoints(toUnit, cut))}"/>`);
    }
    for (const item of pack.items) {
      const a = asset(item.file);
      const m = multiply(toUnit, itemMatrix(item, a.width, a.height)).map((v) => fmt(v, 6));
      lines.push(`<use xlink:href="#${ids.get(item.file)}" transform="matrix(${m.join(' ')})"/>`);
    }
    lines.push('</g>');
  }

  if (pages !== 'print') {
    lines.push(`<g${label('Kesim', 'Kesim')} fill="none" stroke="${strokeHex}" stroke-width="${strokeWidth(pack.defaults.strokeWidthPt)}" stroke-linejoin="round">`);
    for (const item of pack.items) {
      const cut = cuts.get(item.id);
      if (!cut || item.printOnly) continue;
      const w = effectiveSettings(pack, item).strokeWidthPt;
      const override = w === pack.defaults.strokeWidthPt ? '' : ` stroke-width="${strokeWidth(w)}"`;
      lines.push(`<path id="${xmlId(item.id)}"${override} d="${closedPathSvg(transformPoints(toUnit, cut))}"/>`);
    }
    lines.push('</g>');
  }

  lines.push('</svg>');
  return lines.join('\n') + '\n';
}
