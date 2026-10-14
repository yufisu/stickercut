import { batch } from '@preact/signals';
import { store, busy, selectedItems } from '../store';
import { EditHistory } from '../history';
import { nextItemId, isRegionItem, mmPerDesignPx, type Pack, type Item, type Settings } from '../../../../src/core/project';
import { polygonBounds, flattenClosedPath, itemMatrix, apply } from '../../../../src/core/geometry';
import { presetById } from '../presets';
import { scheduleCuts } from './cuts';
import { scheduleDocSave } from './autosave';
import { toast } from './jobs';

export const history = new EditHistory();

export interface CommitOptions { coalesce?: string; selection?: Iterable<string> }

function syncHistoryFlags(): void {
  store.canUndo.value = history.canUndo;
  store.canRedo.value = history.canRedo;
}

/** Belgeyi değiştiren tek giriş noktası: geçmişe yazar, kesimleri ve kaydı planlar. */
export function commit(next: Pack, opts: CommitOptions = {}): void {
  batch(() => {
    store.doc.value = next;
    store.docVersion.value++;
    if (opts.selection) store.selection.value = new Set(opts.selection);
    store.cutMessages.value = [];
  });
  history.record(next, [...store.selection.value], opts.coalesce);
  syncHistoryFlags();
  scheduleCuts();
  scheduleDocSave();
}

/** Kopya üzerinde değişiklik yapıp commit eder. fn false dönerse vazgeçilir. */
export function mutate(fn: (draft: Pack) => void | false, opts: CommitOptions = {}): boolean {
  const doc = store.doc.value;
  if (!doc) return false;
  const draft = structuredClone(doc);
  if (fn(draft) === false) return false;
  commit(draft, opts);
  return true;
}

export function resetHistory(pack: Pack | null, selection: string[] = []): void {
  history.reset(pack, selection);
  syncHistoryFlags();
}

function restoreSnapshot(s: { pack: Pack; selection: string[] } | null): void {
  if (!s) return;
  batch(() => {
    store.doc.value = s.pack;
    store.docVersion.value++;
    store.selection.value = new Set(s.selection.filter((id) => s.pack.items.some((i) => i.id === id)));
    store.cutMessages.value = [];
  });
  syncHistoryFlags();
  scheduleCuts();
  scheduleDocSave();
}

export function undo(): void { if (!busy.value) restoreSnapshot(history.undo()); }
export function redo(): void { if (!busy.value) restoreSnapshot(history.redo()); }

// --- seçim ---
export function select(ids: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
  const next = mode === 'replace' ? new Set<string>() : new Set(store.selection.value);
  for (const id of ids) {
    if (mode === 'toggle' && next.has(id)) next.delete(id); else next.add(id);
  }
  store.selection.value = next;
  history.select([...next]);
}
export function selectAll(): void { const doc = store.doc.value; if (doc) select(doc.items.map((i) => i.id)); }
export function clearSelection(): void { select([]); }

// --- öğe düzenleme ---
export function deleteSelected(): void {
  const ids = store.selection.value;
  if (!ids.size) return;
  mutate((d) => { d.items = d.items.filter((i) => !ids.has(i.id)); }, { selection: [] });
}

export function duplicateSelected(): void {
  const ids = store.selection.value;
  if (!ids.size) return;
  const added: string[] = [];
  mutate((d) => {
    const mm = mmPerDesignPx(d), shift = 3 / mm.x; // 3 mm sağ-aşağı
    for (const src of d.items.filter((i) => ids.has(i.id))) {
      const id = nextItemId({ ...d, items: [...d.items, ...added.map((a) => ({ ...src, id: a }))] });
      d.items.push({ ...structuredClone(src), id, x: src.x + shift, y: src.y + shift, needsReview: false, matchScore: null });
      added.push(id);
    }
  }, { selection: added });
}

/** Seçimi mm cinsinden iter (ok tuşları). Ardışık itmeler tek geri alma adımıdır. */
export function nudge(dxMm: number, dyMm: number): void {
  const ids = store.selection.value;
  if (!ids.size) return;
  mutate((d) => {
    const mm = mmPerDesignPx(d);
    for (const i of d.items) if (ids.has(i.id)) { i.x = round2(i.x + dxMm / mm.x); i.y = round2(i.y + dyMm / mm.y); }
  }, { coalesce: 'nudge' });
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function setPlacement(updates: Map<string, Partial<Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg'>>>): void {
  mutate((d) => {
    for (const i of d.items) {
      const u = updates.get(i.id);
      if (!u) continue;
      if (u.x !== undefined) i.x = round2(u.x);
      if (u.y !== undefined) i.y = round2(u.y);
      if (u.scale !== undefined) i.scale = Math.max(0.005, Math.round(u.scale * 1e6) / 1e6);
      if (u.rotationDeg !== undefined) i.rotationDeg = Math.round(u.rotationDeg * 10) / 10 || 0;
    }
  });
}

export function setItemFields(ids: Iterable<string>, fields: Partial<Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg' | 'printOnly' | 'needsReview' | 'file'>>, coalesce?: string): void {
  const set = new Set(ids);
  mutate((d) => {
    for (const i of d.items) {
      if (!set.has(i.id)) continue;
      if (fields.file !== undefined && i.file !== null) i.file = fields.file;
      for (const k of ['x', 'y', 'scale', 'rotationDeg', 'printOnly', 'needsReview'] as const) {
        const v = fields[k];
        if (v !== undefined) (i as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }, { coalesce });
}

export function setOverride<K extends keyof Settings>(ids: Iterable<string>, key: K, value: Settings[K] | undefined, coalesce?: string): void {
  const set = new Set(ids);
  mutate((d) => {
    for (const i of d.items) {
      if (!set.has(i.id)) continue;
      if (value === undefined) delete i.overrides[key]; else i.overrides[key] = value;
    }
  }, { coalesce });
}

export function setDefaults(patch: Partial<Settings>, coalesce?: string): void {
  mutate((d) => { Object.assign(d.defaults, patch); }, { coalesce });
}

export function applyPreset(id: string): void {
  const p = presetById(id);
  store.presetId.value = id;
  if (p && store.doc.value) setDefaults(p.settings);
  scheduleDocSave();
}

export function setPage(widthMm: number, heightMm: number): void {
  if (!(widthMm > 0) || !(heightMm > 0)) return;
  mutate((d) => { d.page = { widthMm, heightMm }; }, { coalesce: 'page' });
}

export function setBase(which: 'design' | 'background', name: string): void {
  const f = store.files.value.get(name), doc = store.doc.value;
  if (!f || !doc || f.width !== doc.designSize.widthPx || f.height !== doc.designSize.heightPx) return;
  mutate((d) => {
    const other = which === 'design' ? 'background' : 'design';
    if (d.files[other] === name) d.files[other] = d.files[which];
    d.files[which] = name;
  });
  syncRoles();
}

/** Dosya rollerini belgeyle hizalar (tasarım/arka plan/sticker/yok say). */
export function syncRoles(): void {
  const doc = store.doc.value;
  if (!doc) return;
  const next = new Map(store.files.value);
  for (const f of next.values()) {
    if (f.name === doc.files.design) f.role = 'design';
    else if (f.name === doc.files.background) f.role = 'background';
    else if (f.role === 'design' || f.role === 'background') f.role = doc.items.some((i) => i.file === f.name) ? 'sticker' : 'ignore';
  }
  store.files.value = next;
}

export function approve(ids: Iterable<string>): void {
  setItemFields(ids, { needsReview: false });
}

export function reorder(id: string, direction: 'up' | 'down' | 'top' | 'bottom'): void {
  mutate((d) => {
    const i = d.items.findIndex((it) => it.id === id);
    if (i < 0) return false;
    const [item] = d.items.splice(i, 1);
    const target = direction === 'top' ? d.items.length : direction === 'bottom' ? 0 : direction === 'up' ? Math.min(d.items.length, i + 1) : Math.max(0, i - 1);
    d.items.splice(target, 0, item);
  });
}

/** Yüklü bir sticker PNG'sini sayfaya ekler (varsayılan: sayfa ortası, genişliğin %25'i). */
export function addStickerItem(file: string, at?: { x: number; y: number }, widthPx?: number): string | null {
  const f = store.files.value.get(file), doc = store.doc.value;
  if (!f || !doc) return null;
  let id = '';
  mutate((d) => {
    id = nextItemId(d);
    const w = widthPx ?? d.designSize.widthPx * 0.25;
    d.items.push({
      id, file, x: at?.x ?? d.designSize.widthPx / 2, y: at?.y ?? d.designSize.heightPx / 2,
      scale: w / f.width, rotationDeg: 0, printOnly: false, needsReview: false, matchScore: null, overrides: {},
    });
  }, { selection: [id] });
  return id;
}

/** Eşleşmeyen bölgeye bir sticker'ı sığdırarak yerleştirir ve bölge uyarısını kapatır. */
export function placeInRegion(marker: number, file: string): void {
  const m = store.initMessages.value.find((x) => x.code === 'UNMATCHED_REGION' && x.marker === marker) ?? null;
  const f = store.files.value.get(file);
  const region = m?.region;
  if (!region || !f) return;
  const scale = Math.min(region.w / f.width, region.h / f.height);
  addStickerItem(file, { x: region.x + region.w / 2, y: region.y + region.h / 2 }, f.width * scale);
  dismissMarker(marker);
}

export function dismissMarker(marker: number): void {
  store.dismissedMarkers.value = new Set([...store.dismissedMarkers.value, marker]);
  scheduleDocSave();
}

/** Seçili öğelerin sınırlarını (tasarım px) verir: taze kesim varsa onu, yoksa görsel dikdörtgenini kullanır. */
export function itemBounds(item: Item): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const cut = store.cuts.get(item.id);
  if (cut && !item.printOnly) return polygonBounds(cut.points);
  const size = isRegionItem(item) ? { w: item.region.bbox.w, h: item.region.bbox.h } : (() => { const f = item.file === null ? undefined : store.files.value.get(item.file); return f ? { w: f.width, h: f.height } : null; })();
  if (!size) return null;
  const m = itemMatrix(item, size.w, size.h);
  return polygonBounds([apply(m, { x: 0, y: 0 }), apply(m, { x: size.w, y: 0 }), apply(m, { x: size.w, y: size.h }), apply(m, { x: 0, y: size.h })]);
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignSelected(mode: AlignMode): void {
  const items = selectedItems.value;
  if (items.length < 2) return;
  const bounds = items.map((i) => ({ id: i.id, b: itemBounds(i) })).filter((x): x is { id: string; b: NonNullable<ReturnType<typeof itemBounds>> } => !!x.b);
  const all = { minX: Math.min(...bounds.map((x) => x.b.minX)), maxX: Math.max(...bounds.map((x) => x.b.maxX)), minY: Math.min(...bounds.map((x) => x.b.minY)), maxY: Math.max(...bounds.map((x) => x.b.maxY)) };
  const updates = new Map<string, Partial<Item>>();
  for (const { id, b } of bounds) {
    const item = items.find((i) => i.id === id)!;
    const dx = mode === 'left' ? all.minX - b.minX : mode === 'right' ? all.maxX - b.maxX : mode === 'hcenter' ? (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2 : 0;
    const dy = mode === 'top' ? all.minY - b.minY : mode === 'bottom' ? all.maxY - b.maxY : mode === 'vcenter' ? (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2 : 0;
    updates.set(id, { x: item.x + dx, y: item.y + dy });
  }
  setPlacement(updates);
}

export function distributeSelected(axis: 'x' | 'y'): void {
  const items = selectedItems.value;
  if (items.length < 3) return;
  const rows = items.map((i) => ({ item: i, b: itemBounds(i)! })).filter((r) => r.b);
  const key = axis === 'x' ? ['minX', 'maxX'] as const : ['minY', 'maxY'] as const;
  rows.sort((a, b) => a.b[key[0]] - b.b[key[0]]);
  const total = rows[rows.length - 1].b[key[1]] - rows[0].b[key[0]];
  const sizes = rows.reduce((s, r) => s + (r.b[key[1]] - r.b[key[0]]), 0);
  const gap = (total - sizes) / (rows.length - 1);
  const updates = new Map<string, Partial<Item>>();
  let cursor = rows[0].b[key[0]];
  for (const r of rows) {
    const size = r.b[key[1]] - r.b[key[0]], delta = cursor - r.b[key[0]];
    updates.set(r.item.id, axis === 'x' ? { x: r.item.x + delta } : { y: r.item.y + delta });
    cursor += size + gap;
  }
  setPlacement(updates);
}

/** Bir öğenin düzleştirilmiş kesim/kenar poligonu (tasarım px), vuruş testi için. */
export function itemOutline(item: Item): { x: number; y: number }[] | null {
  const cut = store.cuts.get(item.id);
  if (cut && !item.printOnly) return flattenClosedPath(cut.points, 1);
  const b = itemBounds(item);
  return b ? [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }] : null;
}

export function notify(text: string): void { toast(text); }
