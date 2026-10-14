import type { BBox } from './raster';

export interface Settings {
  /** İşaretli kesim ofseti (mm); pozitif dışarı. */
  offsetMm: number;
  whiteBorder: boolean;
  strokeWidthPt: number;
  /** Sıkılık: 2r'den dar girintiler köprülenir (mm). */
  closingMm: number;
  /** Dışbükey köşe yuvarlama (mm); yalnızca max(0, offset)'ten büyükse etkili. */
  cornerRadiusMm: number;
  /** Opak PNG dikdörtgeninin köşe yarıçapı (mm). */
  rectCornerRadiusMm: number;
  /** Kontur yumuşatma (Gauss σ, mm). */
  smoothMm: number;
  /** Kesim yolunun izin verilen en büyük sadeleştirme sapması (mm). */
  simplifyMm: number;
  /** Bu açıdan daha sivri köşeler korunur (0 = köşe koruma kapalı). */
  cornerAngleDeg: number;
  /** Ana parçaya bu mesafedeki parçalar köprülenir (mm); 0 = yalnızca en büyük parça. */
  bridgeMm: number;
  /** Ana parçaya göre bu orandan küçük parçalar atılır. */
  minPartRatio: number;
  /** Komşu kesim çizgileri arasında istenen en az boşluk (mm). */
  minGapMm: number;
  /** Kesim çizgisinin çizime yaklaşma uyarı eşiği (mm); 0 = ölçme. */
  tightMm: number;
  alphaThreshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  offsetMm: 0,
  whiteBorder: false,
  strokeWidthPt: 1,
  closingMm: 1,
  cornerRadiusMm: 0,
  rectCornerRadiusMm: 1.5,
  smoothMm: 0.2,
  simplifyMm: 0.06,
  cornerAngleDeg: 0,
  bridgeMm: 2,
  minPartRatio: 0.01,
  minGapMm: 2,
  tightMm: 0.3,
  alphaThreshold: 128,
};

export interface CutPreset { id: string; name: string; blurb: string; settings: Partial<Settings> }
/** Kurulum ekranındaki kesim stili presetleri. */
export const CUT_PRESETS: CutPreset[] = [
  { id: 'snug', name: 'Yapışık', blurb: 'Kesim çizgisi çizimin kenarını izler; girintiler 2 mm\'ye kadar köprülenir.', settings: { offsetMm: 0, whiteBorder: false } },
  { id: 'margin', name: '0.5 mm pay', blurb: 'Baskı kaymasına karşı çizgi yarım milimetre dışarıda.', settings: { offsetMm: 0.5, whiteBorder: false } },
  { id: 'white', name: 'Beyaz kenar 1 mm', blurb: 'Sayfa 1\'e beyaz kenar eklenir, kesim kenarın dışından geçer.', settings: { offsetMm: 1, whiteBorder: true } },
];

/** Tasarım görselinden alınan bölge: bbox (tasarım px) + bbox-yerel maske (rle). */
export interface RegionSource { bbox: BBox; rle: string }

export interface Item {
  id: string;
  /** Sticker PNG'si; bölge öğelerinde null. */
  file: string | null;
  region?: RegionSource;
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  printOnly: boolean;
  needsReview: boolean;
  matchScore: number | null;
  overrides: Partial<Settings>;
}

export type RegionItem = Item & { file: null; region: RegionSource };
export const isRegionItem = (i: Item): i is RegionItem => i.file === null && !!i.region;

/** Kullanıcıya gösterilecek kısa ad: dosya adı ya da "bölge i3". */
export function itemLabel(i: Item): string {
  return i.file === null ? `bölge ${i.id}` : (i.file.split('/').pop() ?? i.file);
}

export interface Pack {
  version: 2;
  page: { widthMm: number; heightMm: number };
  designSize: { widthPx: number; heightPx: number };
  files: { design: string; background: string };
  defaults: Settings;
  items: Item[];
}

export const PT_PER_MM = 72 / 25.4;

export class PackError extends Error {
  constructor(public problems: string[]) {
    super(`pack.json geçersiz:\n- ${problems.join('\n- ')}`);
    this.name = 'PackError';
  }
}

export const nfc = (s: string): string => s.normalize('NFC');

export function effectiveSettings(pack: Pack, item: Item): Settings {
  return { ...pack.defaults, ...item.overrides };
}

export function mmPerDesignPx(pack: Pack): { x: number; y: number } {
  return { x: pack.page.widthMm / pack.designSize.widthPx, y: pack.page.heightMm / pack.designSize.heightPx };
}

export function aspectMismatch(pack: Pack): number {
  const page = pack.page.widthMm / pack.page.heightMm;
  const design = pack.designSize.widthPx / pack.designSize.heightPx;
  return Math.abs(page - design) / design;
}

export function nextItemId(pack: Pack): string {
  const ids = new Set(pack.items.map((i) => i.id));
  let n = 1;
  while (ids.has(`i${n}`)) n++;
  return `i${n}`;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const NUMERIC_KEYS = [
  'offsetMm', 'strokeWidthPt', 'closingMm', 'cornerRadiusMm', 'rectCornerRadiusMm', 'smoothMm', 'simplifyMm',
  'cornerAngleDeg', 'bridgeMm', 'minPartRatio', 'minGapMm', 'tightMm', 'alphaThreshold',
] as const;

/** Bilinen ayar alanlarını alır; v1 `smoothing` (0–1) → `smoothMm = 0.4·smoothing`. */
export function migrateSettings(raw: unknown): Partial<Settings> {
  if (!isObj(raw)) return {};
  const out: Partial<Settings> = {};
  for (const k of NUMERIC_KEYS) if (isNum(raw[k])) out[k] = raw[k];
  if (typeof raw.whiteBorder === 'boolean') out.whiteBorder = raw.whiteBorder;
  if (out.smoothMm === undefined && isNum(raw.smoothing)) out.smoothMm = Math.round(0.4 * Math.max(0, Math.min(1, raw.smoothing)) * 1000) / 1000;
  return out;
}

function rleLength(rle: string): number {
  let total = 0;
  for (const token of rle.split(',')) {
    const n = parseInt(token, 36);
    if (!Number.isFinite(n) || n < 0) return -1;
    total += n;
  }
  return total;
}

export function parsePack(text: string): Pack {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new PackError([`JSON okunamadı: ${(e as Error).message}`]); }
  const problems: string[] = [];
  if (!isObj(raw)) throw new PackError(['Kök bir nesne olmalı']);
  if (raw.version !== 1 && raw.version !== 2) problems.push('version 1 ya da 2 olmalı');
  const page = isObj(raw.page) ? raw.page : {};
  const size = isObj(raw.designSize) ? raw.designSize : {};
  const files = isObj(raw.files) ? raw.files : {};
  const positive = (v: unknown, name: string) => { if (!isNum(v) || v <= 0) problems.push(`${name} pozitif bir sayı olmalı`); };
  positive(page.widthMm, 'page.widthMm');
  positive(page.heightMm, 'page.heightMm');
  positive(size.widthPx, 'designSize.widthPx');
  positive(size.heightPx, 'designSize.heightPx');
  if (typeof files.design !== 'string') problems.push('files.design bir dosya adı olmalı');
  if (typeof files.background !== 'string') problems.push('files.background bir dosya adı olmalı');
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  if (!Array.isArray(raw.items)) problems.push('items bir dizi olmalı');
  const items: Item[] = rawItems.map((it: unknown, i: number) => {
    const o = isObj(it) ? it : {};
    let region: RegionSource | undefined;
    if (o.file === null) {
      const r = isObj(o.region) ? o.region : null;
      const b = r && isObj(r.bbox) ? r.bbox : null;
      if (!r || !b || !isNum(b.x) || !isNum(b.y) || !isNum(b.w) || !isNum(b.h) || b.w <= 0 || b.h <= 0 || typeof r.rle !== 'string') {
        problems.push(`items[${i}] dosyasız öğe için geçerli bir region (bbox + rle) gerekli`);
      } else if (rleLength(r.rle) !== b.w * b.h) {
        problems.push(`items[${i}].region.rle bbox boyutuyla uyuşmuyor`);
      } else region = { bbox: { x: b.x, y: b.y, w: b.w, h: b.h }, rle: r.rle };
    } else if (typeof o.file !== 'string') problems.push(`items[${i}].file bir dosya adı olmalı`);
    for (const k of ['x', 'y', 'scale'] as const) if (!isNum(o[k])) problems.push(`items[${i}].${k} sayı olmalı`);
    return {
      id: typeof o.id === 'string' ? o.id : '',
      file: o.file === null ? null : nfc(String(o.file ?? '')),
      ...(region ? { region } : {}),
      x: o.x as number,
      y: o.y as number,
      scale: o.scale as number,
      rotationDeg: isNum(o.rotationDeg) ? o.rotationDeg : 0,
      printOnly: o.printOnly === true,
      needsReview: o.needsReview === true,
      matchScore: isNum(o.matchScore) ? o.matchScore : null,
      overrides: migrateSettings(o.overrides),
    };
  });
  if (problems.length) throw new PackError(problems);
  const pack: Pack = {
    version: 2,
    page: { widthMm: page.widthMm as number, heightMm: page.heightMm as number },
    designSize: { widthPx: size.widthPx as number, heightPx: size.heightPx as number },
    files: { design: nfc(files.design as string), background: nfc(files.background as string) },
    defaults: { ...DEFAULT_SETTINGS, ...migrateSettings(raw.defaults) },
    items: [],
  };
  for (const item of items) {
    if (!item.id) item.id = nextItemId(pack);
    pack.items.push(item);
  }
  return pack;
}

export function serializePack(pack: Pack): string {
  return JSON.stringify({ ...pack, version: 2 }, null, 2) + '\n';
}
