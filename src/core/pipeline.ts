import { type BBox, type Raster } from './raster';
import { type Pt, type Affine, itemMatrix, transformPoints, multiply, polygonBounds, apply } from './geometry';
import { type CutShape, type CutShapeOptions, StickerError, stickerCutShape, cutShapeFromMask } from './contour';
import {
  type Pack, type Item, type Settings, DEFAULT_SETTINGS, effectiveSettings, mmPerDesignPx, nfc, isRegionItem, itemLabel,
} from './project';
import { type RoleResult, assignRoles, transparencyRatio } from './roles';
import { type MatchOptions, type MatchProgress, matchStickersSteps } from './match';
import { cloneRaster, compositeOverWhite, downscaleRaster, drawRaster, strokePolyline, createRaster } from './render';
import { checkLayout } from './checks';
import { regionLocation, unmatchedRegionText } from './region-label';
import { buildPdf, type PdfAsset, type BuildPdfOptions } from './pdf';
import { comparePaths, type CompareOptions, type CompareResult } from './compare';
import { encodeRle, decodeRle } from './shape';

export interface Asset { width: number; height: number; raster: Raster }
export interface LoadedFile extends Asset { name: string; bytes: Uint8Array }
export type Level = 'error' | 'warning' | 'info';
export interface Message { level: Level; code: string; text: string; itemId?: string; file?: string; region?: BBox; marker?: number }
export interface InitOptions {
  design?: string;
  background?: string;
  stickers?: string[];
  page?: { widthMm: number; heightMm?: number };
  match?: Partial<MatchOptions>;
  /** Eşleşmeyen tasarım bölgelerini PNG'siz kesim öğesi yap (varsayılan: açık). */
  regionItems?: boolean;
}
export interface InitResult { pack: Pack | null; roles: RoleResult; unmatchedRegions: BBox[]; messages: Message[] }
export type CutCache = Map<string, CutShape>;
export const createCutCache = (): CutCache => new Map();

const ANALYSIS_MAX = 2048;
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function prepareLoadedFile(name: string, bytes: Uint8Array, raster: Raster): LoadedFile {
  const long = Math.max(raster.width, raster.height);
  const shrink = long > ANALYSIS_MAX && transparencyRatio(raster) >= 0.05;
  return {
    name: nfc(name),
    bytes,
    width: raster.width,
    height: raster.height,
    raster: shrink ? downscaleRaster(raster, ANALYSIS_MAX / long) : raster,
  };
}

export function formatMessage(m: Message): string {
  const prefix = m.level === 'error' ? 'HATA' : m.level === 'warning' ? 'UYARI' : 'BİLGİ';
  return `${prefix}: ${m.text}`;
}

export function regionItemText(b: BBox, width: number, height: number, marker: number, ambiguous: boolean): string {
  const where = regionLocation(b, width, height);
  return ambiguous
    ? `Bölge ${marker}: Sayfanın ${where} çizime PNG eşleşmedi; kesim çizgisi tasarımın kendisinden alındı. Doğruysa onayla, PNG'si varsa Sticker ekle bölümünden yerleştir.`
    : `Bölge ${marker}: Sayfanın ${where} çizim tasarımdan kesildi.`;
}

export type InitProgress = MatchProgress;

export function initPack(files: LoadedFile[], opts: InitOptions = {}): InitResult {
  const steps = initPackSteps(files, opts);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** initPack'in ilerleme veren hali: eşleştirme bölge bölge ilerler (worker'da iptal edilebilir). */
export function* initPackSteps(files: LoadedFile[], opts: InitOptions = {}): Generator<InitProgress, InitResult> {
  const byName = new Map(files.map((f) => [f.name, f]));
  const roles = assignRoles(files.map((f) => ({ file: f.name, raster: f.raster })), {
    design: opts.design && nfc(opts.design),
    background: opts.background && nfc(opts.background),
  });
  const fail = (text: string): InitResult => ({ pack: null, roles, unmatchedRegions: [], messages: [{ level: 'error', code: 'ROLES', text }] });
  if (!roles.design || !roles.background) return fail(roles.reason ?? 'Tam tasarım ve arka plan belirlenemedi.');
  const design = byName.get(roles.design), background = byName.get(roles.background);
  if (!design) return fail(`Tam tasarım dosyası bulunamadı: ${roles.design}`);
  if (!background) return fail(`Arka plan dosyası bulunamadı: ${roles.background}`);

  const stickerFiles = (opts.stickers?.map(nfc) ?? roles.stickers)
    .map((n) => byName.get(n))
    .filter((f): f is LoadedFile => f !== undefined);
  const result = yield* matchStickersSteps(design.raster, background.raster, stickerFiles.map((f) => ({ file: f.name, raster: f.raster })), opts.match);

  const messages: Message[] = [];
  const widthMm = opts.page?.widthMm ?? 80;
  const heightMm = opts.page?.heightMm ?? round((widthMm * design.height) / design.width, 1);
  if (!opts.page) {
    messages.push({ level: 'info', code: 'PAGE_DEFAULT', text: `Sayfa boyutu verilmedi; ${widthMm} × ${heightMm} mm varsayıldı.` });
  }
  // Analiz rasteri küçültülmüşse bölge koordinatlarını orijinal tasarım pikseline çevir.
  const k = design.width / design.raster.width;
  const pack: Pack = {
    version: 2,
    page: { widthMm, heightMm },
    designSize: { widthPx: design.width, heightPx: design.height },
    files: { design: design.name, background: background.name },
    defaults: { ...DEFAULT_SETTINGS },
    items: result.items.map((m, i) => {
      const f = byName.get(m.file)!;
      return {
        id: `i${i + 1}`,
        file: m.file,
        x: round(m.x * k, 2),
        y: round(m.y * k, 2),
        scale: round((m.scale * k * f.raster.width) / f.width, 6),
        rotationDeg: round(m.rotationDeg, 2),
        printOnly: false,
        needsReview: m.needsReview,
        matchScore: round(m.score, 3),
        overrides: {},
      };
    }),
  };
  for (const item of pack.items) {
    if (item.needsReview) {
      messages.push({ level: 'warning', code: 'NEEDS_REVIEW', itemId: item.id, file: item.file ?? undefined,
        text: `"${itemLabel(item)}" otomatik yerleşimi belirsiz. Önizlemedeki turuncu çerçeveye dokunup konumunu kontrol et.` });
    }
  }
  for (const file of result.unusedStickers) {
    messages.push({ level: 'warning', code: 'UNUSED_STICKER', file,
      text: `"${file.split('/').pop()}" için güvenilir bir yer bulunamadı. Tasarımda varsa Sticker ekle bölümünden yerleştir.` });
  }
  const usage = new Map<string, number>();
  for (const item of pack.items) if (item.file) usage.set(item.file, (usage.get(item.file) ?? 0) + 1);
  for (const [file, count] of usage) if (count > 1) {
    messages.push({ level: 'info', code: 'REUSED_STICKER', file,
      text: `"${file.split('/').pop()}" tasarımda ${count} kez kullanılıyor; tek PNG’den ${count} ayrı kesim çizgisi oluşturuldu.` });
  }
  const unmatchedRegions: BBox[] = [];
  for (const [index, region] of result.unmatchedRegions.entries()) {
    const marker = index + 1;
    const b: BBox = k === 1 ? region.bbox : { x: Math.round(region.bbox.x * k), y: Math.round(region.bbox.y * k), w: Math.round(region.bbox.w * k), h: Math.round(region.bbox.h * k) };
    unmatchedRegions.push(b);
    if (opts.regionItems === false) {
      messages.push({ level: 'warning', code: 'UNMATCHED_REGION', region: b, marker, text: unmatchedRegionText(b, design.width, design.height, marker) });
      continue;
    }
    const id = `i${pack.items.length + 1}`;
    const ambiguous = stickerFiles.length > 0;
    pack.items.push({
      id, file: null, region: { bbox: b, rle: encodeRle(k === 1 ? region.mask : scaleMask(region.mask, b.w, b.h)) },
      x: round(b.x + b.w / 2, 2), y: round(b.y + b.h / 2, 2), scale: 1, rotationDeg: 0,
      printOnly: false, needsReview: ambiguous, matchScore: null, overrides: {},
    });
    messages.push({ level: ambiguous ? 'warning' : 'info', code: 'REGION_ITEM', itemId: id, region: b, marker,
      text: regionItemText(b, design.width, design.height, marker, ambiguous) });
  }
  return { pack, roles, unmatchedRegions, messages };
}

/** Maskeyi en yakın komşu örneklemeyle w×h boyutuna getirir (küçültülmüş analiz rasteri → tasarım px). */
function scaleMask(m: { width: number; height: number; data: Uint8Array }, w: number, h: number) {
  const out = { width: w, height: h, data: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.height - 1, Math.floor((y + 0.5) * m.height / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(m.width - 1, Math.floor((x + 0.5) * m.width / w));
      out.data[y * w + x] = m.data[sy * m.width + sx];
    }
  }
  return out;
}

const finite = (v: unknown, fallback: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

/** Ayarları motor seçeneklerine çevirir; geçersiz değerler varsayılana döner. */
export function cutOptionsFor(s: Settings, pxPerMm: number): CutShapeOptions {
  const d = DEFAULT_SETTINGS;
  return {
    pxPerMm: round(pxPerMm, 4),
    alphaThreshold: finite(s.alphaThreshold, d.alphaThreshold, 1, 255),
    offsetMm: finite(s.offsetMm, d.offsetMm),
    closingMm: finite(s.closingMm, d.closingMm, 0, 20),
    cornerRadiusMm: finite(s.cornerRadiusMm, d.cornerRadiusMm, 0, 20),
    rectCornerRadiusMm: finite(s.rectCornerRadiusMm, d.rectCornerRadiusMm, 0, 50),
    smoothMm: finite(s.smoothMm, d.smoothMm, 0, 5),
    simplifyMm: finite(s.simplifyMm, d.simplifyMm, 0, 5),
    cornerAngleDeg: finite(s.cornerAngleDeg, d.cornerAngleDeg, 0, 180),
    bridgeMm: finite(s.bridgeMm, d.bridgeMm, 0, 50),
    minPartRatio: finite(s.minPartRatio, d.minPartRatio, 0, 1),
    tightMm: finite(s.tightMm, d.tightMm, 0, 5),
  };
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface CutDetail { shape: CutShape; options: CutShapeOptions; matrix: Affine }
export interface CutsResult { cuts: Map<string, Pt[]>; messages: Message[] }

export function computeCuts(pack: Pack, assets: Map<string, Asset>, cache: CutCache = createCutCache()): CutsResult {
  const { cuts, messages } = computeCutsDetailed(pack, assets, cache);
  return { cuts, messages };
}

/** computeCuts + öğe başına ham şekil, seçenekler ve dönüşüm (istatistik ve doğrulama için). */
export function computeCutsDetailed(pack: Pack, assets: Map<string, Asset>, cache: CutCache = createCutCache()): CutsResult & { details: Map<string, CutDetail> } {
  const steps = cutSteps(pack, assets, cache);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

export interface CutStep { itemId: string; points: Pt[]; detail: CutDetail }

/** Öğe öğe kesim hesabı; her öğeden sonra sonucu verir (worker akışı ve iptal için). */
export function* cutSteps(pack: Pack, assets: Map<string, Asset>, cache: CutCache = createCutCache()): Generator<CutStep, CutsResult & { details: Map<string, CutDetail> }> {
  const cuts = new Map<string, Pt[]>();
  const details = new Map<string, CutDetail>();
  const messages: Message[] = [];
  const warned = new Set<string>();
  const mm = mmPerDesignPx(pack);
  for (const item of pack.items) {
    if (item.printOnly) continue;
    let w: number, h: number, rasterPerOrig: number, sourceKey: string;
    let compute: (o: CutShapeOptions) => CutShape;
    if (item.file !== null) {
      const a = assets.get(item.file);
      if (!a) {
        messages.push({ level: 'error', code: 'MISSING_FILE', itemId: item.id, file: item.file, text: `"${item.file}" dosyası projede yok.` });
        continue;
      }
      w = a.width; h = a.height; rasterPerOrig = a.raster.width / a.width; sourceKey = item.file;
      compute = (o) => stickerCutShape(a.raster, o);
    } else if (item.region) {
      const { bbox, rle } = item.region;
      w = bbox.w; h = bbox.h; rasterPerOrig = 1; sourceKey = `region:${bbox.w}x${bbox.h}:${hash(rle)}`;
      compute = (o) => cutShapeFromMask(decodeRle(rle, bbox.w, bbox.h), o);
    } else {
      messages.push({ level: 'error', code: 'MISSING_FILE', itemId: item.id, text: `${item.id} öğesinin kaynağı yok.` });
      continue;
    }
    const s = effectiveSettings(pack, item);
    const o = cutOptionsFor(s, rasterPerOrig / (mm.x * item.scale));
    const key = `${sourceKey}|${Object.values(o).join('|')}`;
    let shape = cache.get(key);
    if (!shape) {
      try {
        shape = compute(o);
      } catch (e) {
        if (!(e instanceof StickerError)) throw e;
        messages.push({ level: 'error', code: e.code, itemId: item.id, file: item.file ?? undefined, text: `"${itemLabel(item)}": ${e.message}` });
        continue;
      }
      cache.set(key, shape);
    }
    const label = itemLabel(item), once = (code: string) => { const k = `${code}:${sourceKey}`; if (warned.has(k)) return false; warned.add(k); return true; };
    if (shape.extraPartsRatio > 0.05 && once('EXTRA_PARTS')) {
      messages.push({ level: 'warning', code: 'EXTRA_PARTS', itemId: item.id, file: item.file ?? undefined,
        text: `"${label}" birden fazla parçadan oluşuyor; uzak parçalar kesilmeyecek. Gerekirse köprüleme mesafesini artır.` });
    }
    if (shape.partsBridged > 0 && once('PARTS_BRIDGED')) {
      messages.push({ level: 'info', code: 'PARTS_BRIDGED', itemId: item.id, file: item.file ?? undefined,
        text: `"${label}" ${shape.partsBridged + 1} parçadan oluşuyor; parçalar tek kesim çizgisinde köprülendi.` });
    }
    const toOrig: Affine = [1 / rasterPerOrig, 0, 0, 1 / rasterPerOrig, 0, 0];
    const m = multiply(itemMatrix(item, w, h), toOrig);
    const points = transformPoints(m, shape.points), detail: CutDetail = { shape, options: o, matrix: m };
    cuts.set(item.id, points);
    details.set(item.id, detail);
    yield { itemId: item.id, points, detail };
    const c = shape.clearance;
    if (o.tightMm > 0 && c.worst && c.minMm < Math.min(o.offsetMm, o.tightMm) - 0.1) {
      const p = apply(m, c.worst), r = 2 / mm.x;
      const region: BBox = { x: Math.round(p.x - r), y: Math.round(p.y - r), w: Math.round(2 * r), h: Math.round(2 * r) };
      messages.push({ level: 'warning', code: 'TIGHT_SPOT', itemId: item.id, file: item.file ?? undefined, region,
        text: c.minMm < 0
          ? `"${label}" kesim çizgisi çizime ${(-c.minMm).toFixed(2)} mm giriyor; ofseti artır, köşe korumayı aç ya da köşe yuvarlamayı azalt.`
          : `"${label}" kesim çizgisi çizime ${c.minMm.toFixed(2)} mm kadar yaklaşıyor (ofset ${o.offsetMm} mm).` });
    }
  }
  messages.push(...checkLayout(pack, cuts, { minGapMm: pack.defaults.minGapMm }));
  return { cuts, messages, details };
}

/** Bölge öğesinin görselini tasarım rasterinden keser (alfa = bölge maskesi), bbox-yerel rasterde. */
export function regionRaster(design: Asset, region: { bbox: BBox; rle: string }): Raster {
  const { bbox, rle } = region;
  const mask = decodeRle(rle, bbox.w, bbox.h);
  const k = design.raster.width / design.width;
  const out = createRaster(bbox.w, bbox.h);
  const src = design.raster;
  for (let y = 0; y < bbox.h; y++) {
    const sy = Math.min(src.height - 1, Math.max(0, Math.floor((bbox.y + y + 0.5) * k)));
    for (let x = 0; x < bbox.w; x++) {
      if (!mask.data[y * bbox.w + x]) continue;
      const sx = Math.min(src.width - 1, Math.max(0, Math.floor((bbox.x + x + 0.5) * k)));
      const si = (sy * src.width + sx) * 4, di = (y * bbox.w + x) * 4;
      out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = 255;
    }
  }
  return out;
}

export function renderPackPreview(pack: Pack, assets: Map<string, Asset>, cuts: Map<string, Pt[]> | null): Raster {
  const bg = assets.get(pack.files.background);
  if (!bg) throw new Error(`Arka plan dosyası yok: ${pack.files.background}`);
  const out = cloneRaster(compositeOverWhite(bg.raster));
  const design = assets.get(pack.files.design);
  for (const item of pack.items) {
    if (isRegionItem(item)) {
      if (design) drawRaster(out, regionRaster(design, item.region), itemMatrix(item, item.region.bbox.w, item.region.bbox.h));
      continue;
    }
    const a = item.file === null ? undefined : assets.get(item.file);
    if (!a) continue;
    const k = a.width / a.raster.width;
    drawRaster(out, a.raster, multiply(itemMatrix(item, a.width, a.height), [k, 0, 0, k, 0, 0]));
  }
  if (cuts) for (const pts of cuts.values()) strokePolyline(out, pts, true, [255, 0, 0], 3);
  for (const item of pack.items) {
    if (!item.needsReview) continue;
    const size = isRegionItem(item) ? { width: item.region.bbox.w, height: item.region.bbox.h } : (item.file === null ? undefined : assets.get(item.file));
    if (!size) continue;
    const m = itemMatrix(item, size.width, size.height);
    const corners = [apply(m, { x: 0, y: 0 }), apply(m, { x: size.width, y: 0 }), apply(m, { x: size.width, y: size.height }), apply(m, { x: 0, y: size.height })];
    const b = polygonBounds(corners);
    strokePolyline(out, [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }], true, [255, 140, 0], 4);
  }
  return out;
}

/** PDF ve önizleme için gereken dosya adları (bölge öğesi varsa tasarım da dahil). */
export function packAssetNames(pack: Pack, withDesign = false): string[] {
  const names = [pack.files.background, ...pack.items.map((i) => i.file).filter((f): f is string => f !== null)];
  if (withDesign || pack.items.some(isRegionItem)) names.unshift(pack.files.design);
  return [...new Set(names)];
}

/** Dışa aktarma için PDF varlıkları; eksik arka plan/tasarım hata mesajı üretir. */
export function pdfAssetsFor(pack: Pack, files: Map<string, LoadedFile>, messages: Message[]): Map<string, PdfAsset> {
  const assets = new Map<string, PdfAsset>();
  for (const name of packAssetNames(pack)) {
    const f = files.get(name);
    if (f) assets.set(name, { bytes: f.bytes, width: f.width, height: f.height });
    else if (name === pack.files.background) {
      messages.push({ level: 'error', code: 'MISSING_FILE', file: name, text: `Arka plan dosyası "${name}" projede yok.` });
    } else if (name === pack.files.design) {
      messages.push({ level: 'error', code: 'MISSING_FILE', file: name, text: `Tam tasarım dosyası "${name}" projede yok; bölge öğeleri için gerekli.` });
    }
  }
  return assets;
}

export async function buildPackPdf(
  pack: Pack, files: Map<string, LoadedFile>, cache?: CutCache, opts?: BuildPdfOptions,
): Promise<{ pdf: Uint8Array | null; messages: Message[]; cuts: Map<string, Pt[]> }> {
  const { cuts, messages } = computeCuts(pack, files, cache);
  const assets = pdfAssetsFor(pack, files, messages);
  if (messages.some((m) => m.level === 'error')) return { pdf: null, messages, cuts };
  return { pdf: await buildPdf({ pack, assets, cuts }, opts), messages, cuts };
}

/** Kesimleri hesaplayıp referans (Illustrator) yollarıyla karşılaştırır. */
export function compareWithReference(
  pack: Pack, files: Map<string, Asset>, ref: { cuts: Pt[][] }, cache?: CutCache, opts?: CompareOptions,
): { result: CompareResult; messages: Message[] } {
  const { cuts, messages } = computeCuts(pack, files, cache);
  const result = comparePaths(pack, cuts, ref.cuts, opts);
  return { result, messages: [...messages, ...result.messages] };
}
