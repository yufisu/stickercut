import { type BBox, type Raster } from './raster';
import { type Pt, itemMatrix, transformPoints, multiply, polygonBounds, apply } from './geometry';
import { type CutShape, StickerError, stickerCutShape } from './contour';
import { type Pack, DEFAULT_SETTINGS, effectiveSettings, mmPerDesignPx, nfc } from './project';
import { type RoleResult, assignRoles, transparencyRatio } from './roles';
import { type MatchOptions, matchStickers } from './match';
import { cloneRaster, compositeOverWhite, downscaleRaster, drawRaster, strokePolyline } from './render';
import { checkLayout } from './checks';

export interface Asset { width: number; height: number; raster: Raster }
export interface LoadedFile extends Asset { name: string; bytes: Uint8Array }
export type Level = 'error' | 'warning' | 'info';
export interface Message { level: Level; code: string; text: string; itemId?: string; file?: string }
export interface InitOptions {
  design?: string;
  background?: string;
  stickers?: string[];
  page?: { widthMm: number; heightMm?: number };
  match?: Partial<MatchOptions>;
}
export interface InitResult { pack: Pack | null; roles: RoleResult; unmatchedRegions: BBox[]; messages: Message[] }
export type CutCache = Map<string, CutShape>;

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

export function initPack(files: LoadedFile[], opts: InitOptions = {}): InitResult {
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
  const result = matchStickers(design.raster, background.raster, stickerFiles.map((f) => ({ file: f.name, raster: f.raster })), opts.match);

  const messages: Message[] = [];
  const widthMm = opts.page?.widthMm ?? 80;
  const heightMm = opts.page?.heightMm ?? round((widthMm * design.height) / design.width, 1);
  if (!opts.page) {
    messages.push({ level: 'info', code: 'PAGE_DEFAULT', text: `Sayfa boyutu verilmedi; ${widthMm} × ${heightMm} mm varsayıldı.` });
  }
  const pack: Pack = {
    version: 1,
    page: { widthMm, heightMm },
    designSize: { widthPx: design.width, heightPx: design.height },
    files: { design: design.name, background: background.name },
    defaults: { ...DEFAULT_SETTINGS },
    items: result.items.map((m, i) => {
      const f = byName.get(m.file)!;
      return {
        id: `i${i + 1}`,
        file: m.file,
        x: round(m.x, 2),
        y: round(m.y, 2),
        scale: round((m.scale * f.raster.width) / f.width, 6),
        rotationDeg: 0,
        printOnly: false,
        needsReview: m.needsReview,
        matchScore: round(m.score, 3),
        overrides: {},
      };
    }),
  };
  for (const item of pack.items) {
    if (item.needsReview) {
      messages.push({ level: 'warning', code: 'NEEDS_REVIEW', itemId: item.id, file: item.file,
        text: `"${item.file}" (${item.id}) eşleşmesi zayıf (skor ${item.matchScore}); yerini kontrol et.` });
    }
  }
  for (const file of result.unusedStickers) {
    messages.push({ level: 'warning', code: 'UNUSED_STICKER', file, text: `"${file}" tasarımda bulunamadı (kullanılmıyor olabilir).` });
  }
  for (const b of result.unmatchedRegions) {
    messages.push({ level: 'warning', code: 'UNMATCHED_REGION',
      text: `Tasarımda eşleşmeyen bir bölge var (x=${b.x}, y=${b.y}, ${b.w}×${b.h} px); bu sticker’ın PNG’si eksik olabilir.` });
  }
  return { pack, roles, unmatchedRegions: result.unmatchedRegions, messages };
}

export function computeCuts(pack: Pack, assets: Map<string, Asset>, cache: CutCache = new Map()): { cuts: Map<string, Pt[]>; messages: Message[] } {
  const cuts = new Map<string, Pt[]>();
  const messages: Message[] = [];
  const warned = new Set<string>();
  const mm = mmPerDesignPx(pack).x;
  for (const item of pack.items) {
    if (item.printOnly) continue;
    const a = assets.get(item.file);
    if (!a) {
      messages.push({ level: 'error', code: 'MISSING_FILE', itemId: item.id, file: item.file, text: `"${item.file}" dosyası projede yok.` });
      continue;
    }
    const s = effectiveSettings(pack, item);
    const rasterPerOrig = a.raster.width / a.width;
    const offsetRasterPx = round((s.offsetMm / (mm * item.scale)) * rasterPerOrig, 1);
    const key = `${item.file}|${offsetRasterPx}|${s.smoothing}|${s.alphaThreshold}`;
    let shape = cache.get(key);
    if (!shape) {
      try {
        shape = stickerCutShape(a.raster, { alphaThreshold: s.alphaThreshold, offsetPx: offsetRasterPx, smoothing: s.smoothing });
      } catch (e) {
        if (!(e instanceof StickerError)) throw e;
        messages.push({ level: 'error', code: e.code, itemId: item.id, file: item.file, text: `"${item.file}": ${e.message}` });
        continue;
      }
      cache.set(key, shape);
    }
    if (shape.extraPartsRatio > 0.05 && !warned.has(item.file)) {
      warned.add(item.file);
      messages.push({ level: 'warning', code: 'EXTRA_PARTS', itemId: item.id, file: item.file,
        text: `"${item.file}" birden fazla parçadan oluşuyor; sadece en büyük parça kesilecek.` });
    }
    const toOrig: [number, number, number, number, number, number] = [1 / rasterPerOrig, 0, 0, 1 / rasterPerOrig, 0, 0];
    cuts.set(item.id, transformPoints(multiply(itemMatrix(item, a.width, a.height), toOrig), shape.points));
  }
  messages.push(...checkLayout(pack, cuts));
  return { cuts, messages };
}

export function renderPackPreview(pack: Pack, assets: Map<string, Asset>, cuts: Map<string, Pt[]> | null): Raster {
  const bg = assets.get(pack.files.background);
  if (!bg) throw new Error(`Arka plan dosyası yok: ${pack.files.background}`);
  const out = cloneRaster(compositeOverWhite(bg.raster));
  for (const item of pack.items) {
    const a = assets.get(item.file);
    if (!a) continue;
    const k = a.width / a.raster.width;
    drawRaster(out, a.raster, multiply(itemMatrix(item, a.width, a.height), [k, 0, 0, k, 0, 0]));
  }
  if (cuts) for (const pts of cuts.values()) strokePolyline(out, pts, true, [255, 0, 0], 3);
  for (const item of pack.items) {
    const a = assets.get(item.file);
    if (!item.needsReview || !a) continue;
    const m = itemMatrix(item, a.width, a.height);
    const corners = [apply(m, { x: 0, y: 0 }), apply(m, { x: a.width, y: 0 }), apply(m, { x: a.width, y: a.height }), apply(m, { x: 0, y: a.height })];
    const b = polygonBounds(corners);
    strokePolyline(out, [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }], true, [255, 140, 0], 4);
  }
  return out;
}
