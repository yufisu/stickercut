import { batch } from '@preact/signals';
import { store, busy, type FileEntry, type Role } from '../store';
import { engine } from '../../engine/engine';
import * as storage from '../../platform/storage';
import { parsePack, nfc, type Pack } from '../../../../src/core/project';
import { zipToPack } from '../../../../src/core/zip';
import type { Message } from '../../../../src/core/pipeline';
import { runJob, toast } from './jobs';
import { commit, resetHistory, syncRoles, addStickerItem } from './edit';
import { recomputeCuts, cancelCuts } from './cuts';
import { saveFilesNow, scheduleDocSave, cancelPendingSaves, flushSaves } from './autosave';
import { reviewMessages } from '../messages';

const DISPLAY_MAX = 1600;
const THUMB = 96;

async function makeBitmaps(bytes: Uint8Array): Promise<{ bitmap: ImageBitmap; thumb: ImageBitmap }> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  const probe = await createImageBitmap(blob);
  const f = Math.min(1, DISPLAY_MAX / Math.max(probe.width, probe.height));
  const t = Math.min(1, THUMB / Math.max(probe.width, probe.height));
  const thumb = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(probe.width * t)), resizeHeight: Math.max(1, Math.round(probe.height * t)), resizeQuality: 'high' });
  if (f === 1) return { bitmap: probe, thumb };
  const bitmap = await createImageBitmap(blob, { resizeWidth: Math.round(probe.width * f), resizeHeight: Math.round(probe.height * f), resizeQuality: 'high' });
  probe.close();
  return { bitmap, thumb };
}

/** Dosyaları worker'a ve mağazaya ekler (bitmap'ler ana iş parçacığında). */
async function registerFiles(entries: { name: string; bytes: Uint8Array; role?: Role }[], ctl?: { signal: AbortSignal; progress: (p: 'decode', d: number, t: number) => void }): Promise<void> {
  const infos = await engine.addFiles(entries.map(({ name, bytes }) => ({ name: nfc(name), bytes })), ctl ? { signal: ctl.signal, onProgress: (phase, d, t) => phase === 'decode' && ctl.progress('decode', d, t) } : undefined);
  const next = new Map(store.files.value);
  for (const e of entries) {
    const info = infos.find((i) => i.name === nfc(e.name));
    if (!info) continue;
    const { bitmap, thumb } = await makeBitmaps(e.bytes);
    const old = next.get(info.name);
    old?.bitmap.close(); old?.thumb.close();
    next.set(info.name, { name: info.name, bytes: e.bytes, width: info.width, height: info.height, bitmap, thumb, role: e.role ?? old?.role ?? 'ignore' });
  }
  store.files.value = next;
}

function autoRoles(roles: { design: string | null; background: string | null; stickers: string[] }, onlyNew: Set<string> | null): void {
  const next = new Map(store.files.value);
  for (const f of next.values()) {
    if (onlyNew && !onlyNew.has(f.name)) continue;
    if (onlyNew) { f.role = roles.stickers.includes(f.name) ? 'sticker' : 'ignore'; continue; }
    f.role = f.name === roles.design ? 'design' : f.name === roles.background ? 'background' : roles.stickers.includes(f.name) ? 'sticker' : 'ignore';
  }
  store.files.value = next;
}

/** Kurulum ekranı: PNG'leri (veya bir proje .zip'ini) ekle. */
export async function addFiles(list: File[]): Promise<void> {
  if (busy.value) return;
  const zip = list.find((f) => /\.zip$/i.test(f.name));
  if (zip) { await importZip(new Uint8Array(await zip.arrayBuffer())); return; }
  const pngs = list.filter((f) => /\.png$/i.test(f.name) || f.type === 'image/png');
  if (!pngs.length) { toast('PNG ya da proje .zip dosyası seç.', 'warning'); return; }
  const generic = pngs.filter((f) => /^IMG_\d+\.png$/i.test(f.name));
  await runJob({ kind: 'addFiles', label: 'Dosyalar okunuyor', cancellable: false }, async (ctl) => {
    const entries = await Promise.all(pngs.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    await registerFiles(entries, { signal: ctl.signal, progress: ctl.progress });
    const roles = await engine.roles();
    batch(() => {
      autoRoles(roles, store.rolesLocked.value ? new Set(entries.map((e) => nfc(e.name))) : null);
      store.notice.value = roles.reason && !store.rolesLocked.value ? { level: 'warning', code: 'ROLES', text: roles.reason } : null;
    });
    if (generic.length) toast('Fotoğraflar\'dan gelen dosyalar yeniden adlandırılmış (IMG_…). Rolleri elle kontrol et.', 'warning');
    saveFilesNow();
    scheduleDocSave();
  });
}

export async function removeFile(name: string): Promise<void> {
  const file = store.files.value.get(name);
  if (!file || store.doc.value || busy.value) return;
  await runJob({ kind: 'removeFile', label: 'Dosya kaldırılıyor', cancellable: false }, async () => {
    await engine.removeFiles([name]);
    file.bitmap.close(); file.thumb.close();
    const next = new Map(store.files.value);
    next.delete(name);
    batch(() => { store.files.value = next; store.notice.value = null; });
    saveFilesNow();
  });
}

export function setRole(name: string, role: Role): void {
  const next = new Map(store.files.value);
  const f = next.get(name);
  if (!f) return;
  if (role === 'design' || role === 'background') for (const o of next.values()) if (o.role === role) o.role = 'ignore';
  f.role = role;
  batch(() => { store.files.value = next; store.rolesLocked.value = true; store.notice.value = null; });
  saveFilesNow();
}

async function importZip(bytes: Uint8Array): Promise<void> {
  await runJob({ kind: 'import', label: 'Proje açılıyor', cancellable: false }, async (ctl) => {
    const { packJson, files } = zipToPack(bytes);
    const pack = parsePack(packJson);
    await engine.reset();
    for (const f of store.files.value.values()) { f.bitmap.close(); f.thumb.close(); }
    store.files.value = new Map();
    const roleOf = (n: string): Role => (n === pack.files.design ? 'design' : n === pack.files.background ? 'background' : 'sticker');
    await registerFiles([...files].map(([name, b]) => ({ name, bytes: b, role: roleOf(nfc(name)) })), { signal: ctl.signal, progress: ctl.progress });
    openDocument(pack, []);
    saveFilesNow();
  });
}

/** Belgeyi editöre açar (yerleştirme, içe aktarma, geri yükleme). */
export function openDocument(pack: Pack, initMessages: Message[], selection: string[] = []): void {
  resetHistory(pack, selection);
  batch(() => {
    store.doc.value = pack;
    store.docVersion.value++;
    store.initMessages.value = initMessages;
    store.selection.value = new Set(selection);
    store.cuts.clear();
    store.cutsVersion.value++;
    store.cutMessages.value = [];
    store.fitRequested.value++;
    store.pageSetup.value = { widthMm: pack.page.widthMm, heightMm: pack.page.heightMm };
  });
  syncRoles();
  void recomputeCuts();
  scheduleDocSave();
}

export async function newProject(): Promise<void> {
  if (busy.value) return;
  await runJob({ kind: 'reset', label: 'Yeni proje hazırlanıyor', cancellable: false }, async () => {
    cancelPendingSaves();
    cancelCuts();
    await engine.reset();
    await flushSaves();
    await storage.clear();
    for (const f of store.files.value.values()) { f.bitmap.close(); f.thumb.close(); }
    resetHistory(null);
    batch(() => {
      store.files.value = new Map(); store.doc.value = null; store.cuts.clear(); store.cutsVersion.value++;
      store.initMessages.value = []; store.cutMessages.value = []; store.selection.value = new Set();
      store.pageSetup.value = { widthMm: 80, heightMm: null }; store.presetId.value = 'snug'; store.dismissedMarkers.value = new Set();
      store.rolesLocked.value = false; store.notice.value = null; store.reference.value = null; store.compare.value = null;
    });
  });
}

/** Sayfa açılışında kaldığı yerden devam. */
export async function restore(): Promise<void> {
  const saved = await storage.load();
  if (!saved.files?.files.length) return;
  await runJob({ kind: 'restore', label: 'Kaldığın yerden açılıyor', cancellable: false }, async (ctl) => {
    await registerFiles(saved.files!.files, { signal: ctl.signal, progress: ctl.progress });
    const d = saved.doc;
    const pack = d?.packJson ? parsePack(d.packJson) : null;
    batch(() => {
      if (d) { store.pageSetup.value = d.page; store.presetId.value = d.presetId; store.dismissedMarkers.value = new Set(d.dismissed ?? []); }
      store.rolesLocked.value = true;
    });
    if (pack) openDocument(pack, d?.messages ?? [], d?.selection ?? []);
    else store.initMessages.value = d?.messages ?? [];
  });
}

/** Worker yeniden başladıysa dosyaları geri yükle. */
export async function reloadWorkerFiles(): Promise<void> {
  const entries = [...store.files.value.values()].map(({ name, bytes }) => ({ name, bytes }));
  if (!entries.length) return;
  await engine.addFiles(entries);
  if (store.doc.value) void recomputeCuts();
}
engine.onRespawn = () => { toast('Motor yeniden başlatıldı.', 'warning'); void reloadWorkerFiles(); };

/** Düzenleyiciden yeni bir PNG yükleyip sayfaya ekler. */
export async function addNewPng(file: File, at?: { x: number; y: number }): Promise<void> {
  await runJob({ kind: 'addFiles', label: 'PNG ekleniyor', cancellable: false }, async (ctl) => {
    await registerFiles([{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), role: 'sticker' }], { signal: ctl.signal, progress: ctl.progress });
    addStickerItem(nfc(file.name), at);
    saveFilesNow();
  });
}

export function visibleSetupMessages(): Message[] {
  const doc = store.doc.value;
  return doc ? reviewMessages(doc, store.initMessages.value, store.dismissedMarkers.value) : store.initMessages.value;
}

/** Belgede dosya adı değişince (editör) veya yeni commit sonrası roller. */
export function fileEntry(name: string | null): FileEntry | undefined {
  return name === null ? undefined : store.files.value.get(name);
}
