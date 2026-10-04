import { engine } from './engine';
import { state, update, type Role } from './state';
import * as storage from './storage';
import { shareOrDownload } from './share';
import { parsePack, serializePack, nextItemId, nfc, type Pack } from '../../src/core/project';
import { zipToPack } from '../../src/core/zip';
import type { Message } from '../../src/core/pipeline';
import { EditHistory } from './history';
import { legacyRegion, unmatchedRegionText } from '../../src/core/region-label';

const DISPLAY_MAX = 1600;
export const editHistory = new EditHistory();

export function syncBaseRoles(pack: Pack): void {
  for (const f of state.files.values()) {
    if (f.name === pack.files.design) f.role = 'design';
    else if (f.name === pack.files.background) f.role = 'background';
    else if (f.role === 'design' || f.role === 'background') f.role = pack.items.some((i) => i.file === f.name) ? 'sticker' : 'ignore';
  }
}

function restoreEdit(snapshot: { pack: Pack; selectedId: string | null } | null): void {
  if (!snapshot) return;
  syncBaseRoles(snapshot.pack);
  update((s) => {
    s.pack = snapshot.pack;
    s.selectedId = snapshot.selectedId;
    s.cuts = new Map();
    s.cutMessages = [];
  });
  scheduleCuts();
  scheduleAutosave();
}

export function undoEdit(): void { restoreEdit(editHistory.undo()); }
export function redoEdit(): void { restoreEdit(editHistory.redo()); }

function reviewMessages(pack: Pack, messages: Message[]): Message[] {
  const kept = messages.filter((m) => {
    if (m.code === 'ROLES') return false; // Pack'te iki kaynak zaten seçilmiş; eski aday uyarısı geçersiz.
    if (m.code === 'NEEDS_REVIEW') return pack.items.some((i) => i.id === m.itemId && i.needsReview);
    if (m.code === 'UNUSED_STICKER') return !pack.items.some((i) => i.file === m.file);
    return true;
  });
  for (const item of pack.items) {
    if (item.needsReview && !kept.some((m) => m.code === 'NEEDS_REVIEW' && m.itemId === item.id)) {
      kept.push({ level: 'warning', code: 'NEEDS_REVIEW', itemId: item.id, file: item.file,
        text: `"${item.file.split('/').pop()}" otomatik yerleşimi belirsiz. Önizlemedeki turuncu çerçeveye dokunup konumunu kontrol et.` });
    }
  }
  let marker = 0;
  return kept.map((m) => {
    if (m.code === 'NEEDS_REVIEW') return { ...m,
      text: `"${m.file?.split('/').pop() ?? m.itemId}" otomatik yerleşimi belirsiz. Önizlemedeki turuncu çerçeveye dokunup konumunu kontrol et.` };
    if (m.code !== 'UNMATCHED_REGION') return m;
    const region = m.region ?? legacyRegion(m.text);
    if (!region) return m;
    marker++;
    return { ...m, region, marker,
      text: unmatchedRegionText(region, pack.designSize.widthPx, pack.designSize.heightPx, marker) };
  });
}

export function visibleMessages(): Message[] {
  return state.pack ? reviewMessages(state.pack, state.messages) : state.messages;
}

async function makeBitmap(bytes: Uint8Array): Promise<ImageBitmap> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  const probe = await createImageBitmap(blob);
  const f = Math.min(1, DISPLAY_MAX / Math.max(probe.width, probe.height));
  if (f === 1) return probe;
  const [w, h] = [Math.round(probe.width * f), Math.round(probe.height * f)];
  probe.close();
  return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
}

function fail(e: unknown): void {
  update((s) => { s.messages = [{ level: 'error', code: 'APP', text: e instanceof Error ? e.message : String(e) }]; });
}

async function busy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  update((s) => { s.busy = label; });
  try { return await fn(); } catch (e) { fail(e); return undefined; } finally { update((s) => { s.busy = null; }); }
}

async function registerFiles(entries: { name: string; bytes: Uint8Array; role?: Role }[]): Promise<void> {
  const infos = await engine.addFiles(entries.map(({ name, bytes }) => ({ name: nfc(name), bytes })));
  for (const e of entries) {
    const info = infos.find((i) => i.name === nfc(e.name))!;
    const bitmap = await makeBitmap(e.bytes);
    state.files.get(info.name)?.bitmap.close();
    state.files.set(info.name, { name: info.name, bytes: e.bytes, width: info.width, height: info.height, bitmap, role: e.role ?? 'ignore' });
  }
}

let saveTimer = 0;
let saveQueue = Promise.resolve();
export function scheduleAutosave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const snapshot: storage.Saved = {
      packJson: state.pack ? serializePack(state.pack) : null,
      files: [...state.files.values()].map(({ name, bytes, role }) => ({ name, bytes, role })),
      page: { ...state.page },
      messages: state.pack ? reviewMessages(state.pack, state.messages) : [...state.messages],
    };
    saveQueue = saveQueue.then(() => storage.save(snapshot));
  }, 500);
}

export async function addFiles(list: File[]): Promise<void> {
  if (state.busy) return;
  await busy('Dosyalar okunuyor…', async () => {
    const zip = list.find((f) => /\.zip$/i.test(f.name));
    if (zip) return importZip(new Uint8Array(await zip.arrayBuffer()));
    const pngs = list.filter((f) => /\.png$/i.test(f.name));
    await registerFiles(await Promise.all(pngs.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    const roles = await engine.roles();
    update((s) => {
      for (const f of s.files.values()) {
        f.role = f.name === roles.design ? 'design' : f.name === roles.background ? 'background' : roles.stickers.includes(f.name) ? 'sticker' : 'ignore';
      }
      s.messages = roles.reason ? [{ level: 'warning', code: 'ROLES', text: roles.reason }] : [];
    });
    scheduleAutosave();
  });
}

export async function removeFile(name: string): Promise<void> {
  const file = state.files.get(name);
  if (!file || state.screen !== 'files' || state.busy) return;
  await busy('Dosya kaldırılıyor…', async () => {
    await engine.removeFiles([name]);
    file.bitmap.close();
    update((s) => {
      s.files.delete(name);
      s.messages = [];
    });
    scheduleAutosave();
  });
}

export async function place(): Promise<void> {
  const files = [...state.files.values()];
  const design = files.find((f) => f.role === 'design'), background = files.find((f) => f.role === 'background');
  if (!design || !background) return fail(new Error('Önce bir tam tasarım ve bir arka plan seç.'));
  const res = await busy('Sticker’lar yerleştiriliyor…', () => engine.init({
    design: design.name, background: background.name,
    stickers: files.filter((f) => f.role === 'sticker').map((f) => f.name),
    page: { widthMm: state.page.widthMm, heightMm: state.page.heightMm ?? undefined },
  }));
  if (!res) return;
  if (res.pack) editHistory.reset(res.pack);
  update((s) => {
    s.messages = res.messages;
    if (res.pack) { s.pack = res.pack; s.screen = 'editor'; s.selectedId = null; s.cuts = new Map(); }
  });
  if (res.pack) { await recomputeCuts(); scheduleAutosave(); }
}

let cutTimer = 0;
let cutSeq = 0;
export function scheduleCuts(): void {
  clearTimeout(cutTimer);
  ++cutSeq; // Önceki hesaplamanın sonucu yeni düzenlemeyi geçersiz kılamaz.
  cutTimer = window.setTimeout(() => void recomputeCuts(), 150);
}
export async function recomputeCuts(): Promise<void> {
  if (!state.pack) return;
  const seq = ++cutSeq;
  try {
    const res = await engine.cuts(state.pack);
    if (seq === cutSeq) update((s) => { s.cuts = res.cuts; s.cutMessages = res.messages; });
  } catch (e) { fail(e); }
}

/** Pack değiştiğinde çağrılır. */
export function commit(): void {
  if (state.pack) editHistory.record(state.pack, state.selectedId);
  update((s) => { s.cutMessages = []; });
  scheduleCuts();
  scheduleAutosave();
}

export function addStickerItem(file: string): void {
  const pack = state.pack, f = state.files.get(file);
  if (!pack || !f) return;
  const id = nextItemId(pack);
  pack.items.push({
    id, file, x: pack.designSize.widthPx / 2, y: pack.designSize.heightPx / 2,
    scale: (pack.designSize.widthPx * 0.25) / f.width, rotationDeg: 0,
    printOnly: false, needsReview: false, matchScore: null, overrides: {},
  });
  state.selectedId = id;
  commit();
}

export async function addNewPng(file: File): Promise<void> {
  await busy('PNG ekleniyor…', async () => {
    await registerFiles([{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), role: 'sticker' }]);
    addStickerItem(nfc(file.name));
  });
}

async function importZip(bytes: Uint8Array): Promise<void> {
  const { packJson, files } = zipToPack(bytes);
  const pack = parsePack(packJson);
  await engine.reset();
  state.files.clear();
  const roleOf = (n: string): Role => (n === pack.files.design ? 'design' : n === pack.files.background ? 'background' : 'sticker');
  await registerFiles([...files].map(([name, b]) => ({ name, bytes: b, role: roleOf(nfc(name)) })));
  editHistory.reset(pack);
  update((s) => { s.pack = pack; s.screen = 'editor'; s.selectedId = null; s.messages = reviewMessages(pack, []); });
  await recomputeCuts();
  scheduleAutosave();
}

const baseName = (pack: Pack) => (pack.files.design.split('/').pop() ?? 'pack').replace(/\.png$/i, '');

export async function exportPdf(): Promise<void> {
  const pack = state.pack;
  if (!pack) return;
  const res = await busy('PDF hazırlanıyor…', () => engine.pdf(pack));
  if (!res) return;
  update((s) => { s.cutMessages = res.messages; });
  if (res.pdf) await shareOrDownload(res.pdf, `${baseName(pack)}.pdf`, 'application/pdf');
}

export async function exportZip(): Promise<void> {
  const pack = state.pack;
  if (!pack) return;
  const zip = await busy('Proje paketleniyor…', () => engine.zip(pack));
  if (zip) await shareOrDownload(zip, `${baseName(pack)}.zip`, 'application/zip');
}

export async function newProject(): Promise<void> {
  if (state.busy) return;
  await busy('Yeni proje hazırlanıyor…', async () => {
    clearTimeout(saveTimer);
    clearTimeout(cutTimer);
    ++cutSeq;
    await engine.reset();
    await saveQueue;
    await storage.clear();
    for (const f of state.files.values()) f.bitmap.close();
    editHistory.reset(null);
    update((s) => {
      s.files = new Map(); s.pack = null; s.cuts = new Map(); s.messages = []; s.cutMessages = [];
      s.selectedId = null; s.screen = 'files'; s.showCuts = true;
      s.page = { widthMm: 80, heightMm: null };
    });
  });
}

export async function restore(): Promise<void> {
  const saved = await storage.load();
  if (!saved?.files.length) return;
  await busy('Kaldığın yerden açılıyor…', async () => {
    await registerFiles(saved.files);
    const pack = saved.packJson ? parsePack(saved.packJson) : null;
    editHistory.reset(pack);
    update((s) => { s.page = saved.page; s.pack = pack; s.screen = pack ? 'editor' : 'files';
      s.messages = pack ? reviewMessages(pack, saved.messages ?? []) : saved.messages ?? []; });
    if (pack) await recomputeCuts();
  });
}
