export interface Settings {
  offsetMm: number;
  whiteBorder: boolean;
  strokeWidthPt: number;
  smoothing: number;
  /** Kesim yolunun izin verilen en büyük sadeleştirme sapması (mm). */
  simplifyMm: number;
  alphaThreshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  offsetMm: 0,
  whiteBorder: false,
  strokeWidthPt: 1,
  smoothing: 0.5,
  simplifyMm: 0.06,
  alphaThreshold: 128,
};

export interface Item {
  id: string;
  file: string;
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  printOnly: boolean;
  needsReview: boolean;
  matchScore: number | null;
  overrides: Partial<Settings>;
}

export interface Pack {
  version: 1;
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

export function parsePack(text: string): Pack {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new PackError([`JSON okunamadı: ${(e as Error).message}`]); }
  const problems: string[] = [];
  if (!isObj(raw)) throw new PackError(['Kök bir nesne olmalı']);
  if (raw.version !== 1) problems.push('version 1 olmalı');
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
    if (typeof o.file !== 'string') problems.push(`items[${i}].file bir dosya adı olmalı`);
    for (const k of ['x', 'y', 'scale'] as const) if (!isNum(o[k])) problems.push(`items[${i}].${k} sayı olmalı`);
    return {
      id: typeof o.id === 'string' ? o.id : '',
      file: nfc(String(o.file ?? '')),
      x: o.x as number,
      y: o.y as number,
      scale: o.scale as number,
      rotationDeg: isNum(o.rotationDeg) ? o.rotationDeg : 0,
      printOnly: o.printOnly === true,
      needsReview: o.needsReview === true,
      matchScore: isNum(o.matchScore) ? o.matchScore : null,
      overrides: isObj(o.overrides) ? (o.overrides as Partial<Settings>) : {},
    };
  });
  if (problems.length) throw new PackError(problems);
  const pack: Pack = {
    version: 1,
    page: { widthMm: page.widthMm as number, heightMm: page.heightMm as number },
    designSize: { widthPx: size.widthPx as number, heightPx: size.heightPx as number },
    files: { design: nfc(files.design as string), background: nfc(files.background as string) },
    defaults: { ...DEFAULT_SETTINGS, ...(isObj(raw.defaults) ? (raw.defaults as Partial<Settings>) : {}) },
    items: [],
  };
  for (const item of items) {
    if (!item.id) item.id = nextItemId(pack);
    pack.items.push(item);
  }
  return pack;
}

export function serializePack(pack: Pack): string {
  return JSON.stringify(pack, null, 2) + '\n';
}
