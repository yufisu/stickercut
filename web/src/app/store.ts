import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import type { Pack, Item } from '../../../src/core/project';
import type { Message } from '../../../src/core/pipeline';
import type { Pt, Coord } from '../../../src/core/geometry';
import type { CompareResult } from '../../../src/core/compare';
import type { Phase, CutStats } from '../engine/protocol';
import { reviewMessages } from './messages';
import { itemStatuses, type ItemStatus } from './status';

export type Role = 'design' | 'background' | 'sticker' | 'ignore';
export interface FileEntry {
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Görüntüleme bitmap'i (uzun kenar ≤ 1600). */
  bitmap: ImageBitmap;
  /** 96 px küçük resim. */
  thumb: ImageBitmap;
  role: Role;
}

export type Tool = 'select' | 'pan' | 'add' | 'region' | 'measure';
export type ViewMode = 'edit' | 'cut' | 'print';
export type ThemePref = 'system' | 'light' | 'dark';
export type InspectorTab = 'sticker' | 'page' | 'cut' | 'qa';
export type Detent = 'peek' | 'half' | 'full';
export type Screen = 'setup' | 'editor';

export interface Camera { zoom: number; panX: number; panY: number }
export interface Guide { axis: 'x' | 'y'; atMm: number; fromMm: number; toMm: number; kind: 'page' | 'item' | 'grid' }
export interface Gesture {
  kind: 'move' | 'scale' | 'rotate';
  preview: Map<string, Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg'>>;
  guides: Guide[];
}
export interface CutEntry { key: string; points: Pt[]; stats?: CutStats; path?: Path2D }
export interface JobState {
  id: number;
  kind: string;
  label: string;
  phase: Phase | null;
  done: number;
  total: number;
  cancellable: boolean;
  /** Arayüzü kilitler (kurulum, dışa aktarma); kesim hesapları kilitlemez. */
  blocking: boolean;
  cancel: () => void;
}
export interface Prefs { theme: ThemePref; grid: boolean; rulers: boolean; showCuts: boolean; snap: boolean; ghostInCutView: boolean }
export interface ReferenceState { name: string; cuts: Pt[][]; borders: Pt[][]; pageMm: { w: number; h: number }; cutPage: number }
export interface Toast { id: number; text: string; kind: 'info' | 'success' | 'warning' | 'error'; action?: { label: string; run: () => void } }

const DEFAULT_PREFS: Prefs = { theme: 'system', grid: false, rulers: true, showCuts: true, snap: true, ghostInCutView: true };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem('stickercut:ui');
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
}

/** Tek mağaza: belge, kurulum, türetilmiş kesimler, seçim, görünüm ve işler. Yazma yalnızca app/actions üzerinden. */
export const store = {
  // belge (kalıcı + geri alınabilir)
  doc: signal<Pack | null>(null),
  docVersion: signal(0),
  // kurulum (kalıcı, geri alınamaz)
  files: signal<ReadonlyMap<string, FileEntry>>(new Map()),
  pageSetup: signal<{ widthMm: number; heightMm: number | null }>({ widthMm: 80, heightMm: null }),
  presetId: signal<string>('snug'),
  initMessages: signal<Message[]>([]),
  dismissedMarkers: signal<ReadonlySet<number>>(new Set()),
  // worker'dan türetilen (kalıcı değil)
  cuts: new Map<string, CutEntry>(),
  cutsVersion: signal(0),
  cutMessages: signal<Message[]>([]),
  // seçim ve düzenleme
  selection: signal<ReadonlySet<string>>(new Set()),
  gesture: signal<Gesture | null>(null),
  marquee: signal<{ a: Coord; b: Coord } | null>(null),
  measure: signal<{ a: Coord; b: Coord } | null>(null),
  // görünüm
  camera: signal<Camera>({ zoom: 1, panX: 0, panY: 0 }),
  stageSize: signal<{ width: number; height: number; dpr: number }>({ width: 0, height: 0, dpr: 1 }),
  cursorMm: signal<Coord | null>(null),
  tool: signal<Tool>('select'),
  viewMode: signal<ViewMode>('edit'),
  prefs: signal<Prefs>(loadPrefs()),
  inspectorTab: signal<InspectorTab>('sticker'),
  sheetDetent: signal<Detent>('half'),
  layersOpen: signal(false),
  focusedMarker: signal<number | null>(null),
  hoverId: signal<string | null>(null),
  shortcutsOpen: signal(false),
  // referans karşılaştırma
  reference: signal<ReferenceState | null>(null),
  compare: signal<CompareResult | null>(null),
  showReference: signal(true),
  // dışa aktarma seçenekleri
  exportOptions: signal<{ layers: boolean; spotColor: boolean; spotName: string; bleedMm: number; pngDpi: number }>({ layers: true, spotColor: false, spotName: 'CutContour', bleedMm: 0, pngDpi: 300 }),
  /** Rol atamasına kullanıcı elle dokunduysa otomatik atama yeni dosyalara karışmaz. */
  rolesLocked: signal(false),
  /** Yerleştirmeden sonra tuvali sığdır. */
  fitRequested: signal(0),
  // işler ve bildirimler
  jobs: signal<ReadonlyMap<number, JobState>>(new Map()),
  toasts: signal<Toast[]>([]),
  canUndo: signal(false),
  canRedo: signal(false),
  /** Hata gibi genel mesajlar (kurulum ekranı). */
  notice: signal<Message | null>(null),
};

export const screen: ReadonlySignal<Screen> = computed(() => (store.doc.value ? 'editor' : 'setup'));
export const busy: ReadonlySignal<boolean> = computed(() => [...store.jobs.value.values()].some((j) => j.blocking));
export const primaryId: ReadonlySignal<string | null> = computed(() => {
  let last: string | null = null;
  for (const id of store.selection.value) last = id;
  return last;
});
export const primaryItem: ReadonlySignal<Item | null> = computed(() => {
  const id = primaryId.value, doc = store.doc.value;
  return (id && doc?.items.find((i) => i.id === id)) || null;
});
export const selectedItems: ReadonlySignal<Item[]> = computed(() => {
  const doc = store.doc.value, sel = store.selection.value;
  return doc ? doc.items.filter((i) => sel.has(i.id)) : [];
});
/** Kurulum + kesim uyarıları, belgeye göre süzülmüş. */
export const messages: ReadonlySignal<Message[]> = computed(() => {
  const doc = store.doc.value;
  const base = doc ? reviewMessages(doc, store.initMessages.value, store.dismissedMarkers.value) : store.initMessages.value;
  return [...base, ...store.cutMessages.value];
});
export const itemStatus: ReadonlySignal<ReadonlyMap<string, ItemStatus>> = computed(() => {
  store.cutsVersion.value; // kesim tazeliği değişince yeniden hesapla
  const doc = store.doc.value;
  return doc ? itemStatuses(doc, messages.value, store.cuts) : new Map();
});
export const warningCount: ReadonlySignal<{ errors: number; warnings: number }> = computed(() => {
  let errors = 0, warnings = 0;
  for (const m of messages.value) { if (m.level === 'error') errors++; else if (m.level === 'warning') warnings++; }
  return { errors, warnings };
});

export function setSignal<T>(s: Signal<T>, v: T): void { s.value = v; }
