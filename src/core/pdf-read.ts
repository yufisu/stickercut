import {
  PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFString, PDFHexString, PDFStream, PDFRawStream, PDFContentStream,
  decodePDFRawStream, type PDFContext, type PDFObject, type PDFPageLeaf,
} from 'pdf-lib';
import { strFromU8 } from 'fflate';
import { type Affine, type Pt, multiply, apply, transformPoints, polygonBounds } from './geometry';
import { type Pack, PT_PER_MM } from './project';
import type { Message } from './pipeline';

export type Rgb = [number, number, number];
export interface RefPath {
  points: Pt[];                // sayfa birimi (pt), y yukarı, MediaBox kökeni çıkarılmış, /Rotate uygulanmış
  closed: boolean;
  strokeRgb: Rgb | null;       // boyama işlemi kontur çizmediyse null
  fillRgb: Rgb | null;         // dolgu yoksa null
  spotName: string | null;     // konturun Separation/DeviceN adı
  lineWidthPt: number;
  layer: string | null;        // /Layer veya /OC işaretli içerikten
  anchors: number; curves: number; lines: number;
  role: 'cut' | 'border' | 'other';
  confidence: 'high' | 'low';  // low = gri/siyah kontur yedeği
}
export interface RefPage { index: number; widthPt: number; heightPt: number; rotate: number; paths: RefPath[]; layers: string[] }
export interface RefDocument { pages: RefPage[]; cutPage: number; messages: Message[] }
export interface ReadOptions { pages?: number[]; descendForms?: boolean; cutPage?: number }

export type Token =
  | { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'str' }
  | { t: 'arr'; v: Token[] } | { t: 'dict' } | { t: 'op'; v: string };

export type ColorKind = 'gray' | 'rgb' | 'cmyk' | 'sep' | 'devn' | 'indexed' | 'pattern' | 'lab' | 'unknown';
export interface ColorSpace { kind: ColorKind; n: number; spotName?: string; alt?: ColorSpace; tint?: { c0: number[]; c1: number[]; n: number } }
export interface FormInfo { tokens: Token[]; matrix: Affine; resources: ContentResources | null }
/** İçerik akışının adla eriştiği kaynaklar; yorumlayıcı pdf-lib'den bağımsız kalsın diye soyutlandı. */
export interface ContentResources {
  colorSpace(name: string): ColorSpace | undefined;
  form(name: string): FormInfo | undefined;
  layer(name: string): string | undefined;
}
export interface InterpContext { ctm: Affine; resources?: ContentResources; depth?: number }

// ---------- Sözcük çözümleyici ----------

const CLASS = new Uint8Array(256); // 0 düz, 1 boşluk, 2 ayraç
for (const b of [0, 9, 10, 12, 13, 32]) CLASS[b] = 1;
for (const ch of '()<>[]{}/%') CLASS[ch.charCodeAt(0)] = 2;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
const decodeName = (raw: string) => raw.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

export function tokenizeContent(bytes: Uint8Array): Token[] {
  const n = bytes.length;
  let i = 0;
  const word = () => {
    const start = i;
    while (i < n && CLASS[bytes[i]] === 0) i++;
    return latin1(bytes, start, i);
  };
  const skipLiteral = () => { // '(' geçildi; parantez derinliği ve ters bölü kaçışları izlenir
    let depth = 1;
    while (i < n) {
      const b = bytes[i++];
      if (b === 0x5c) i++;
      else if (b === 0x28) depth++;
      else if (b === 0x29 && --depth === 0) return;
    }
  };
  const skipInlineImage = (): boolean => { // ID'den sonra tek boşluk, ikili veri, sonra boşluk + EI + boşluk/EOF
    for (i++; i < n; i++) {
      if (bytes[i] === 0x45 && bytes[i + 1] === 0x49 && CLASS[bytes[i - 1]] === 1 && (i + 2 >= n || CLASS[bytes[i + 2]] !== 0)) {
        i += 2;
        return true;
      }
    }
    return false;
  };
  const parse = (closer: 'arr' | 'dict' | null): Token[] => {
    const out: Token[] = [];
    while (i < n) {
      const b = bytes[i];
      if (CLASS[b] === 1) { i++; continue; }
      if (CLASS[b] === 0) {
        const w = word();
        if (NUMBER.test(w)) out.push({ t: 'num', v: parseFloat(w) });
        else {
          out.push({ t: 'op', v: w });
          if (w === 'ID' && skipInlineImage()) out.push({ t: 'op', v: 'EI' });
        }
        continue;
      }
      i++;
      switch (b) {
        case 0x2f: out.push({ t: 'name', v: decodeName(word()) }); break;                        // /
        case 0x28: skipLiteral(); out.push({ t: 'str' }); break;                                 // (
        case 0x3c:                                                                               // << veya <hex>
          if (bytes[i] === 0x3c) { i++; parse('dict'); out.push({ t: 'dict' }); }
          else { while (i < n && bytes[i] !== 0x3e) i++; i++; out.push({ t: 'str' }); }
          break;
        case 0x5b: out.push({ t: 'arr', v: parse('arr') }); break;                               // [
        case 0x5d: if (closer === 'arr') return out; break;                                      // ]
        case 0x3e: if (closer === 'dict' && bytes[i] === 0x3e) { i++; return out; } break;      // >>
        case 0x25: while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++; break;           // % yorum
        default: break;                                                                          // ) { } başıboş ayraçlar
      }
    }
    return out;
  };
  return parse(null);
}

// ---------- Renk ----------

const GRAY: ColorSpace = { kind: 'gray', n: 1 };
const RGB: ColorSpace = { kind: 'rgb', n: 3 };
const CMYK: ColorSpace = { kind: 'cmyk', n: 4 };
const UNKNOWN: ColorSpace = { kind: 'unknown', n: 1 };
const DEVICE: Record<string, ColorSpace> = {
  DeviceGray: GRAY, DeviceRGB: RGB, DeviceCMYK: CMYK, CalGray: GRAY, CalRGB: RGB, G: GRAY, RGB, CMYK,
  Lab: { kind: 'lab', n: 3 }, Indexed: { kind: 'indexed', n: 1 }, I: { kind: 'indexed', n: 1 }, Pattern: { kind: 'pattern', n: 1 },
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function toRgb(cs: ColorSpace, v: number[]): Rgb | null {
  switch (cs.kind) {
    case 'gray': return v.length >= 1 ? [clamp01(v[0]), clamp01(v[0]), clamp01(v[0])] : null;
    case 'rgb': return v.length >= 3 ? [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])] : null;
    case 'cmyk': {
      if (v.length < 4) return null;
      const [c, m, y, k] = v.map(clamp01);
      return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
    }
    case 'sep': case 'devn': {
      const { tint, alt } = cs;
      if (!tint || !alt || v.length < 1) return null;
      const t = clamp01(v[0]) ** tint.n;
      return toRgb(alt, tint.c0.map((c0, i) => c0 + t * ((tint.c1[i] ?? 0) - c0)));
    }
    default: return null;
  }
}
const initialComponents = (cs: ColorSpace): number[] =>
  cs.kind === 'rgb' ? [0, 0, 0] : cs.kind === 'cmyk' ? [0, 0, 0, 1] : cs.kind === 'sep' || cs.kind === 'devn' ? Array(cs.n).fill(1) : [0];

// ---------- Yorumlayıcı ----------

interface GState { ctm: Affine; strokeCs: ColorSpace; fillCs: ColorSpace; stroke: Rgb | null; fill: Rgb | null; spot: string | null; lineWidth: number }
interface Subpath { pts: Pt[]; closed: boolean }

const CUT_SPOT = /cut|kiss|thru|contour/i;

function roleOf(p: RefPath): RefPath['role'] {
  const s = p.strokeRgb;
  if ((s && s[0] >= 0.8 && s[1] <= 0.25 && s[2] <= 0.25) || (p.spotName && CUT_SPOT.test(p.spotName))) return 'cut';
  if (p.fillRgb?.every((v) => v >= 0.97)) return 'border';
  return 'other';
}

/** Kapanış parçası başlangıca dönüyorsa yinelenen son noktayı ilkine katla. */
function mergeClosing(pts: Pt[]): Pt[] {
  const first = pts[0], last = pts[pts.length - 1];
  if (pts.length < 3 || Math.abs(first.x - last.x) > 1e-3 || Math.abs(first.y - last.y) > 1e-3) return pts;
  const merged = pts.slice(0, -1);
  merged[0] = { ...first, ...(last.handleIn ? { handleIn: last.handleIn } : {}) };
  return merged;
}

function makePath(points: Pt[], closed: boolean, strokes: boolean, fills: boolean, g: GState, layer: string | null): RefPath {
  const segments = closed ? points.length : points.length - 1;
  let curves = 0;
  for (let i = 0; i < segments; i++) if (points[i].handleOut || points[(i + 1) % points.length].handleIn) curves++;
  const [a, b, c, d] = g.ctm;
  const path: RefPath = {
    points, closed,
    strokeRgb: strokes ? g.stroke : null, fillRgb: fills ? g.fill : null, spotName: strokes ? g.spot : null,
    lineWidthPt: g.lineWidth * Math.sqrt(Math.abs(a * d - b * c)), layer,
    anchors: points.length, curves, lines: segments - curves, role: 'other', confidence: 'high',
  };
  path.role = roleOf(path);
  return path;
}

function run(tokens: Token[], res: ContentResources | null, init: GState, depth: number, out: RefPath[], marks: (string | null)[]): void {
  let g = init;
  const stack: GState[] = [];
  const operands: Token[] = [];
  let subpaths: Subpath[] = [];
  let current = null as Subpath | null; // atamalar kapanışlarda; TS'nin null'a daraltmasını önler

  const nums = () => operands.flatMap((t) => (t.t === 'num' ? [t.v] : []));
  const take = (k: number): number[] | null => { const v = nums(); return v.length >= k ? v.slice(-k) : null; };
  const pt = (x: number, y: number): Pt => apply(g.ctm, { x, y });
  const layer = () => (marks.length ? marks[marks.length - 1] : null);
  const begin = (p: Pt) => { current = { pts: [p], closed: false }; subpaths.push(current); return current; };
  // h'den sonra gelen parça yeni alt yol başlatır (PDF 8.5.2.1); m olmadan gelen parça da öyle.
  const open = (): Subpath => (current && !current.closed ? current : begin(current ? { x: current.pts[0].x, y: current.pts[0].y } : pt(0, 0)));
  const last = (s: Subpath) => s.pts[s.pts.length - 1];
  const setColor = (stroking: boolean, cs: ColorSpace, comps: number[]) => {
    const rgb = toRgb(cs, comps);
    if (stroking) { g.strokeCs = cs; g.stroke = rgb; g.spot = cs.spotName ?? null; }
    else { g.fillCs = cs; g.fill = rgb; }
  };
  const paint = (strokes: boolean, fills: boolean, close: boolean) => {
    for (const s of subpaths) {
      const closed = s.closed || close || (fills && !strokes);
      const pts = closed ? mergeClosing(s.pts) : s.pts;
      if (pts.length >= 2) out.push(makePath(pts, closed, strokes, fills, g, layer()));
    }
    subpaths = [];
    current = null;
  };

  for (const tok of tokens) {
    if (tok.t !== 'op') { operands.push(tok); continue; }
    switch (tok.v) {
      case 'q': stack.push({ ...g }); break;
      case 'Q': if (stack.length) g = stack.pop()!; break;
      case 'cm': { const m = take(6); if (m) g.ctm = multiply(g.ctm, m as Affine); break; }
      case 'w': { const m = take(1); if (m) g.lineWidth = m[0]; break; }
      case 'm': { const m = take(2); if (m) begin(pt(m[0], m[1])); break; }
      case 'l': { const m = take(2); if (m) open().pts.push(pt(m[0], m[1])); break; }
      case 'c': {
        const m = take(6);
        if (m) { const s = open(); last(s).handleOut = pt(m[0], m[1]); s.pts.push({ ...pt(m[4], m[5]), handleIn: pt(m[2], m[3]) }); }
        break;
      }
      case 'v': { const m = take(4); if (m) open().pts.push({ ...pt(m[2], m[3]), handleIn: pt(m[0], m[1]) }); break; }
      case 'y': { const m = take(4); if (m) { const s = open(); last(s).handleOut = pt(m[0], m[1]); s.pts.push(pt(m[2], m[3])); } break; }
      case 'h': if (current) current.closed = true; break;
      case 're': {
        const m = take(4);
        if (m) { const [x, y, w, h] = m; const s = begin(pt(x, y)); s.pts.push(pt(x + w, y), pt(x + w, y + h), pt(x, y + h)); s.closed = true; }
        break;
      }
      case 'S': paint(true, false, false); break;
      case 's': paint(true, false, true); break;
      case 'f': case 'F': case 'f*': paint(false, true, false); break;
      case 'B': case 'B*': paint(true, true, false); break;
      case 'b': case 'b*': paint(true, true, true); break;
      case 'n': subpaths = []; current = null; break; // W/W* kırpması: sonraki boyama işlemi yolu zaten tüketir
      case 'G': case 'g': { const m = take(1); if (m) setColor(tok.v === 'G', GRAY, m); break; }
      case 'RG': case 'rg': { const m = take(3); if (m) setColor(tok.v === 'RG', RGB, m); break; }
      case 'K': case 'k': { const m = take(4); if (m) setColor(tok.v === 'K', CMYK, m); break; }
      case 'CS': case 'cs': {
        const name = operands[operands.length - 1];
        if (name?.t === 'name') { const cs = DEVICE[name.v] ?? res?.colorSpace(name.v) ?? UNKNOWN; setColor(tok.v === 'CS', cs, initialComponents(cs)); }
        break;
      }
      case 'SC': case 'SCN': case 'sc': case 'scn': {
        const stroking = tok.v[0] === 'S';
        setColor(stroking, stroking ? g.strokeCs : g.fillCs, nums());
        break;
      }
      case 'Do': {
        const name = operands[operands.length - 1];
        const form = name?.t === 'name' && depth < 2 ? res?.form(name.v) : undefined;
        if (form) run(form.tokens, form.resources ?? res, { ...g, ctm: multiply(g.ctm, form.matrix) }, depth + 1, out, marks);
        break;
      }
      case 'BDC': {
        const [tag, prop] = operands.slice(-2);
        const name = tag?.t === 'name' && prop?.t === 'name' && (tag.v === 'Layer' || tag.v === 'OC') ? res?.layer(prop.v) : undefined;
        marks.push(name ?? layer());
        break;
      }
      case 'BMC': marks.push(layer()); break;
      case 'EMC': marks.pop(); break;
      default: break; // bilinmeyen işleçler zararsız
    }
    operands.length = 0;
  }
}

export function interpretContent(tokens: Token[], ctx: InterpContext): RefPath[] {
  const out: RefPath[] = [];
  const state: GState = { ctm: ctx.ctm, strokeCs: GRAY, fillCs: GRAY, stroke: [0, 0, 0], fill: [0, 0, 0], spot: null, lineWidth: 1 };
  run(tokens, ctx.resources ?? null, state, ctx.depth ?? 0, out, []);
  return out;
}

// ---------- pdf-lib katmanı ----------

type OnError = () => void;

/** Dolaylı nesneyi çözer ve tür tutmuyorsa undefined verir (pdf-lib'in lookupMaybe'i tür uyuşmazlığında fırlatır). */
function resolve<T extends PDFObject>(ctx: PDFContext, obj: PDFObject | undefined, type: Function & { prototype: T }): T | undefined {
  const r = obj === undefined ? undefined : ctx.lookup(obj);
  return r instanceof type ? (r as T) : undefined;
}
function attempt<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}
function numbers(arr: PDFArray | undefined, ctx: PDFContext): number[] | undefined {
  const v = arr?.asArray().map((o) => resolve(ctx, o, PDFNumber)?.asNumber());
  return v?.every((x): x is number => x !== undefined) ? v : undefined;
}

function streamBytes(obj: PDFObject | undefined, onError: OnError): Uint8Array {
  if (obj instanceof PDFContentStream) return obj.getUnencodedContents();
  if (obj instanceof PDFRawStream) {
    try { return decodePDFRawStream(obj).decode(); } catch { onError(); }
  }
  return new Uint8Array();
}

function pageContent(ctx: PDFContext, leaf: PDFPageLeaf, onError: OnError): Uint8Array {
  const c = attempt(() => leaf.Contents());
  const streams = c instanceof PDFArray ? c.asArray().map((o) => ctx.lookup(o)) : c ? [c] : [];
  const chunks = streams.map((s) => streamBytes(s, onError));
  const out = new Uint8Array(chunks.reduce((n, ch) => n + ch.length + 1, 0));
  let pos = 0;
  for (const ch of chunks) { out.set(ch, pos); pos += ch.length; out[pos++] = 0x0a; } // akışlar arasında satır sonu
  return out;
}

function decodeText(s: PDFString | PDFHexString): string {
  const b = s.asBytes();
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return s.decodeText(); // UTF-16BE BOM
  const utf8 = strFromU8(b);
  return utf8.includes('�') ? s.decodeText() : utf8;                       // ham UTF-8 (Illustrator), değilse PDFDocEncoding
}

/** Illustrator katmanı /Title, OCG /Name, OCMD ise ilk OCG'si. */
function layerName(dict: PDFDict, ctx: PDFContext, depth = 0): string | undefined {
  const text = (key: string) => {
    const s = ctx.lookup(dict.get(PDFName.of(key)));
    return s instanceof PDFString || s instanceof PDFHexString ? decodeText(s) : undefined;
  };
  const title = text('Title') ?? text('Name');
  if (title !== undefined || depth > 2) return title;
  const ocgs = dict.get(PDFName.of('OCGs'));
  const first = resolve(ctx, ocgs, PDFDict) ?? resolve(ctx, resolve(ctx, ocgs, PDFArray)?.get(0), PDFDict);
  return first ? layerName(first, ctx, depth + 1) : undefined;
}

function tintFunction(raw: PDFObject | undefined, ctx: PDFContext): ColorSpace['tint'] {
  const obj = raw === undefined ? undefined : ctx.lookup(raw);
  const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
  if (!dict || resolve(ctx, dict.get(PDFName.of('FunctionType')), PDFNumber)?.asNumber() !== 2) return undefined;
  const arr = (key: string) => numbers(resolve(ctx, dict.get(PDFName.of(key)), PDFArray), ctx);
  return { c0: arr('C0') ?? [0], c1: arr('C1') ?? [1], n: resolve(ctx, dict.get(PDFName.of('N')), PDFNumber)?.asNumber() ?? 1 };
}

function parseColorSpace(raw: PDFObject | undefined, ctx: PDFContext, depth = 0): ColorSpace {
  const obj = raw === undefined ? undefined : ctx.lookup(raw);
  if (obj instanceof PDFName) return DEVICE[obj.decodeText()] ?? UNKNOWN;
  if (!(obj instanceof PDFArray) || depth > 4) return UNKNOWN;
  const family = resolve(ctx, obj.get(0), PDFName)?.decodeText();
  if (family === 'ICCBased') {
    const stream = resolve(ctx, obj.get(1), PDFStream);
    const n = resolve(ctx, stream?.dict.get(PDFName.of('N')), PDFNumber)?.asNumber();
    if (n === 1) return GRAY;
    if (n === 3) return RGB;
    if (n === 4) return CMYK;
    const alt = stream?.dict.get(PDFName.of('Alternate'));
    return alt ? parseColorSpace(alt, ctx, depth + 1) : UNKNOWN;
  }
  if (family === 'Separation' || family === 'DeviceN') {
    const names = family === 'Separation'
      ? [resolve(ctx, obj.get(1), PDFName)?.decodeText() ?? '']
      : resolve(ctx, obj.get(1), PDFArray)?.asArray().map((o) => resolve(ctx, o, PDFName)?.decodeText() ?? '') ?? [];
    return {
      kind: family === 'Separation' ? 'sep' : 'devn', n: Math.max(1, names.length), spotName: names.join(' + '),
      alt: parseColorSpace(obj.get(2), ctx, depth + 1), tint: tintFunction(obj.get(3), ctx),
    };
  }
  return (family && DEVICE[family]) || UNKNOWN;
}

function resourcesOf(dict: PDFDict | undefined, ctx: PDFContext, parent: ContentResources | null, onError: OnError): ContentResources {
  const colorSpaces = new Map<string, ColorSpace | undefined>();
  const forms = new Map<string, FormInfo | undefined>();
  const entry = (category: string, name: string) => resolve(ctx, dict?.get(PDFName.of(category)), PDFDict)?.get(PDFName.of(name));
  const formOf = (obj: PDFObject, owner: ContentResources): FormInfo | undefined => {
    const stream = resolve(ctx, obj, PDFStream);
    if (!stream || resolve(ctx, stream.dict.get(PDFName.of('Subtype')), PDFName) !== PDFName.of('Form')) return undefined; // görüntüler atlanır
    const matrix = numbers(resolve(ctx, stream.dict.get(PDFName.of('Matrix')), PDFArray), ctx);
    const res = resolve(ctx, stream.dict.get(PDFName.of('Resources')), PDFDict);
    return {
      tokens: tokenizeContent(streamBytes(stream, onError)),
      matrix: matrix?.length === 6 ? (matrix as Affine) : [1, 0, 0, 1, 0, 0],
      resources: res ? resourcesOf(res, ctx, owner, onError) : null,
    };
  };
  const self: ContentResources = {
    colorSpace(name) {
      if (!colorSpaces.has(name)) {
        const obj = entry('ColorSpace', name);
        colorSpaces.set(name, obj ? parseColorSpace(obj, ctx) : parent?.colorSpace(name));
      }
      return colorSpaces.get(name);
    },
    form(name) {
      if (!forms.has(name)) {
        const obj = entry('XObject', name);
        forms.set(name, obj ? formOf(obj, self) : parent?.form(name));
      }
      return forms.get(name);
    },
    layer(name) {
      const d = resolve(ctx, entry('Properties', name), PDFDict);
      return d ? layerName(d, ctx) : parent?.layer(name);
    },
  };
  return self;
}

function pageLayers(resources: PDFDict | undefined, ctx: PDFContext, paths: RefPath[]): string[] {
  const names: string[] = [];
  const add = (n: string | null | undefined) => { if (n && !names.includes(n)) names.push(n); };
  const props = resolve(ctx, resources?.get(PDFName.of('Properties')), PDFDict);
  for (const value of props?.values() ?? []) { const d = resolve(ctx, value, PDFDict); add(d && layerName(d, ctx)); }
  for (const p of paths) add(p.layer);
  return names;
}

/** /Rotate 90: (x,y)→(y, W−x); 180: (W−x, H−y); 270: (H−y, x). */
function rotation(rotate: number, w: number, h: number): Affine {
  if (rotate === 90) return [0, -1, 1, 0, 0, w];
  if (rotate === 180) return [-1, 0, 0, -1, w, h];
  if (rotate === 270) return [0, 1, -1, 0, h, 0];
  return [1, 0, 0, 1, 0, 0];
}

function readPage(doc: PDFDocument, index: number, depth: number, messages: Message[]): RefPage {
  const ctx = doc.context;
  const leaf = doc.getPage(index).node;
  const box = attempt(() => numbers(leaf.MediaBox(), ctx)) ?? [0, 0, 612, 792];
  const [x, y, w, h] = box.length === 4
    ? [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1])]
    : [0, 0, 612, 792];
  const rotate = ((Math.round((attempt(() => leaf.Rotate()?.asNumber()) ?? 0) / 90) * 90) % 360 + 360) % 360;
  const swap = rotate === 90 || rotate === 270;
  let warned = false;
  const onError = () => {
    if (warned) return;
    warned = true;
    messages.push({ level: 'warning', code: 'REF_UNSUPPORTED_FILTER', text: `Referansın ${index + 1}. sayfasındaki içerik desteklenmeyen bir filtreyle sıkıştırılmış; o kısım atlandı.` });
  };
  const resources = attempt(() => leaf.Resources());
  const paths = interpretContent(tokenizeContent(pageContent(ctx, leaf, onError)), {
    ctm: multiply(rotation(rotate, w, h), [1, 0, 0, 1, -x, -y]), resources: resourcesOf(resources, ctx, null, onError), depth,
  });
  return { index, widthPt: swap ? h : w, heightPt: swap ? w : h, rotate, paths, layers: pageLayers(resources, ctx, paths) };
}

export async function readPdfPaths(bytes: Uint8Array, opts: ReadOptions = {}): Promise<RefDocument> {
  const messages: Message[] = [];
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) {
    messages.push({ level: 'error', code: 'REF_ENCRYPTED', text: 'Referans PDF şifreli; kesim çizgileri okunamadı.' });
    return { pages: [], cutPage: 0, messages };
  }
  const count = doc.getPageCount();
  const indices = (opts.pages ?? [...Array(count).keys()]).filter((i) => Number.isInteger(i) && i >= 0 && i < count);
  const pages = indices.map((index) => readPage(doc, index, opts.descendForms === false ? 2 : 0, messages));

  // Hiçbir sayfada kırmızı yoksa dolgusuz konturlar düşük güvenle kesim sayılır; belge düzeyinde bakılır ki
  // baskı sayfasındaki gri çizgiler gerçek kesim sayfası varken terfi etmesin.
  if (!pages.some((p) => p.paths.some((x) => x.role === 'cut'))) {
    let promoted = false;
    for (const page of pages) for (const p of page.paths) {
      if (p.fillRgb !== null || (p.strokeRgb === null && p.spotName === null)) continue;
      p.role = 'cut';
      p.confidence = 'low';
      promoted = true;
    }
    if (promoted) messages.push({ level: 'warning', code: 'REF_NO_RED', text: 'Referansta kırmızı kesim çizgisi yok; gri/siyah konturlar kesim olarak alındı.' });
  }
  let cutPage = pages[0]?.index ?? 0, best = -1;
  for (const page of pages) {
    const n = page.paths.filter((p) => p.role === 'cut').length;
    if (n >= best) { best = n; cutPage = page.index; } // eşitlikte son sayfa
  }
  return { pages, cutPage: opts.cutPage ?? cutPage, messages };
}

// ---------- Tasarım px eşlemesi ----------

/** Sayfa pt (y yukarı) → tasarım px (y aşağı), tutamaçlar dahil. */
export function refToDesign(path: RefPath, page: RefPage, pack: Pack): Pt[] {
  const { widthPx, heightPx } = pack.designSize;
  return transformPoints([widthPx / page.widthPt, 0, 0, -heightPx / page.heightPt, 0, heightPx], path.points);
}

const fmt = (v: number) => String(Math.round(v * 10) / 10);

export function referenceForPack(doc: RefDocument, pack: Pack): { cuts: Pt[][]; borders: Pt[][]; pageMm: { w: number; h: number }; messages: Message[] } {
  const messages: Message[] = [];
  const page = doc.pages.find((p) => p.index === doc.cutPage) ?? doc.pages[0];
  if (!page) return { cuts: [], borders: [], pageMm: { w: 0, h: 0 }, messages };
  const pageMm = { w: page.widthPt / PT_PER_MM, h: page.heightPt / PT_PER_MM };
  if (Math.abs(pageMm.w - pack.page.widthMm) > 0.5 || Math.abs(pageMm.h - pack.page.heightMm) > 0.5) {
    messages.push({ level: 'warning', code: 'REF_PAGE_SIZE',
      text: `Referans sayfası ${fmt(pageMm.w)} × ${fmt(pageMm.h)} mm, pack ${fmt(pack.page.widthMm)} × ${fmt(pack.page.heightMm)} mm; referans çizgileri sayfa oranına göre ölçeklendi.` });
  }
  const cuts = page.paths.filter((p) => p.role === 'cut').map((p) => refToDesign(p, page, pack));
  // Sayfayı kaplayan beyaz zemin dolgusu sticker kenarı değildir.
  const isBorder = (p: RefPath, pg: RefPage) => {
    if (p.role !== 'border') return false;
    const b = polygonBounds(p.points);
    return (b.maxX - b.minX) * (b.maxY - b.minY) < 0.95 * pg.widthPt * pg.heightPt;
  };
  const borders = doc.pages.flatMap((pg) => pg.paths.filter((p) => isBorder(p, pg)).map((p) => refToDesign(p, pg, pack)));
  return { cuts, borders, pageMm, messages };
}
