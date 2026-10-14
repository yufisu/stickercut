import { batch } from '@preact/signals';
import { store, busy, type FileEntry, type Role } from '../store';
import { engine } from '../../engine/engine';
import * as storage from '../../platform/storage';
import { parsePack, nfc, type Pack } from '../../../../src/core/project';
import { zipToPack } from '../../../../src/core/zip';
import type { Message } from '../../../../src/core/pipeline';
import { runJob, toast, type JobControl } from './jobs';
import { isPdfFile, isPngFile, pdfPageFileName, uniqueFileName, pdfErrorText, pageSizeNotice, PDF_MAX_PAGES } from '../pdf-pages';
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

/** Worker'ın zaten bildiği bir dosyayı (ör. sayfadan üretilen arka plan) mağazaya ekler ve kaydeder. */
export async function adoptFile(name: string, bytes: Uint8Array, width: number, height: number, role: Role): Promise<void> {
  const { bitmap, thumb } = await makeBitmaps(bytes);
  const next = new Map(store.files.value);
  const old = next.get(name);
  old?.bitmap.close(); old?.thumb.close();
  next.set(name, { name, bytes, width, height, bitmap, thumb, role });
  store.files.value = next;
  saveFilesNow();
}

interface PdfPageEntry { name: string; bytes: Uint8Array; widthMm: number; heightMm: number }

/**
 * PDF'lerin çizimli sayfalarını PNG'ye çevirir (pdf.js yalnızca burada yüklenir).
 * Kesim çizgisi ve boş sayfalar atlanır; kullanıcıya nedeni söylenir. `taken`: bu partide kullanılan adlar.
 */
async function pdfPageEntries(pdfs: File[], taken: Set<string>, progress: JobControl['progress'], maxArtPages = PDF_MAX_PAGES): Promise<PdfPageEntry[]> {
  if (!pdfs.length) return [];
  const { rasterizePdf } = await import('../../platform/pdf-raster');
  const out: PdfPageEntry[] = [];
  for (const f of pdfs) {
    let pages;
    try {
      pages = await rasterizePdf(new Uint8Array(await f.arrayBuffer()), { maxArtPages, onProgress: (d, t) => progress('rasterize', d, t) });
    } catch (e) {
      toast(pdfErrorText(f.name, e), 'error');
      continue;
    }
    const art = pages.filter((p) => p.png);
    const cut = pages.filter((p) => p.kind === 'cut').length;
    const allArt = pages.filter((p) => p.kind === 'art').length;
    if (!art.length) {
      toast(cut
        ? `${f.name} yalnızca kesim çizgisi içeriyor. Çizimli sayfayı yükle; bu dosyayı editörde Kontrol sekmesinden referans olarak karşılaştırabilirsin.`
        : `${f.name} içinde çizim bulunamadı.`, 'warning');
      continue;
    }
    if (cut) toast(`${f.name}: kesim çizgisi sayfası atlandı, yalnızca çizim alındı.`);
    if (allArt > art.length) toast(maxArtPages === 1 ? `${f.name}: ilk çizimli sayfa eklendi.` : `${f.name}: ${allArt} çizimli sayfanın ilk ${art.length} tanesi alındı.`, 'warning');
    for (const p of art) {
      const name = uniqueFileName(nfc(pdfPageFileName(f.name, p.page, allArt)), taken);
      taken.add(name);
      out.push({ name, bytes: p.png!, widthMm: p.widthMm, heightMm: p.heightMm });
    }
  }
  return out;
}

/** Kurulum ekranı: PNG'leri, PDF'leri (veya bir proje .zip'ini) ekle. */
export async function addFiles(list: File[]): Promise<void> {
  if (busy.value) return;
  const zip = list.find((f) => /\.zip$/i.test(f.name));
  if (zip) { await importZip(new Uint8Array(await zip.arrayBuffer())); return; }
  const pngs = list.filter(isPngFile);
  const pdfs = list.filter(isPdfFile);
  if (!pngs.length && !pdfs.length) { toast('PNG, PDF ya da proje .zip dosyası seç.', 'warning'); return; }
  const generic = pngs.filter((f) => /^IMG_\d+\.png$/i.test(f.name));
  await runJob({ kind: 'addFiles', label: pdfs.length ? 'PDF okunuyor' : 'Dosyalar okunuyor', cancellable: false }, async (ctl) => {
    const entries: { name: string; bytes: Uint8Array }[] = await Promise.all(pngs.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    // Aynı partide "washi.png" ile "washi.pdf" çakışmasın; daha önce yüklenmiş aynı ad ise yenisiyle değişir (PNG'deki gibi).
    const fromPdf = await pdfPageEntries(pdfs, new Set(entries.map((e) => nfc(e.name))), ctl.progress);
    entries.push(...fromPdf.map(({ name, bytes }) => ({ name, bytes })));
    if (!entries.length) return;
    await registerFiles(entries, { signal: ctl.signal, progress: ctl.progress });
    const roles = await engine.roles();
    batch(() => {
      autoRoles(roles, store.rolesLocked.value ? new Set(entries.map((e) => nfc(e.name))) : null);
      store.sheetHint.value = roles.single && roles.design && roles.sheet ? { file: roles.design, ...roles.sheet } : null;
      store.notice.value = roles.reason && !store.rolesLocked.value ? { level: 'warning', code: 'ROLES', text: roles.reason } : null;
    });
    // PDF fiziksel ölçüyü taşır: tasarım PDF'ten geldiyse sayfa genişliği oradan alınır (yükseklik oranla gelir).
    const design = [...store.files.value.values()].find((f) => f.role === 'design');
    const designPage = design && fromPdf.find((p) => p.name === design.name);
    if (designPage && !store.doc.value) {
      const widthMm = Math.round(designPage.widthMm * 10) / 10;
      if (Math.abs(widthMm - store.pageSetup.value.widthMm) >= 0.05 || store.pageSetup.value.heightMm !== null) {
        store.pageSetup.value = { widthMm, heightMm: null };
        toast(pageSizeNotice(designPage.widthMm, designPage.heightMm));
      }
    }
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
      store.rolesLocked.value = false; store.sheetHint.value = null; store.notice.value = null; store.reference.value = null; store.compare.value = null;
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

/** Düzenleyiciden yeni bir PNG ya da PDF yükleyip sayfaya ekler. PDF'in fiziksel ölçüsü korunur. */
export async function addNewSticker(file: File, at?: { x: number; y: number }): Promise<void> {
  const pdf = isPdfFile(file);
  if (!pdf && !isPngFile(file)) { toast('PNG ya da PDF seç.', 'warning'); return; }
  await runJob({ kind: 'addFiles', label: pdf ? 'PDF ekleniyor' : 'PNG ekleniyor', cancellable: false }, async (ctl) => {
    const doc = store.doc.value;
    // Tasarım ve arka plan dosyasının üzerine yazılmasın.
    const reserved = new Set([doc?.files.design, doc?.files.background].filter((n): n is string => !!n));
    let name: string, bytes: Uint8Array, widthPx: number | undefined;
    if (pdf) {
      const [page] = await pdfPageEntries([file], reserved, ctl.progress, 1);
      if (!page) return;
      ({ name, bytes } = page);
      if (doc) widthPx = page.widthMm * (doc.designSize.widthPx / doc.page.widthMm);
    } else {
      name = uniqueFileName(nfc(file.name), reserved);
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    await registerFiles([{ name, bytes, role: 'sticker' }], { signal: ctl.signal, progress: ctl.progress });
    addStickerItem(name, at, widthPx);
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
