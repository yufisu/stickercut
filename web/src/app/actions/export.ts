import { batch } from '@preact/signals';
import { store } from '../store';
import { engine } from '../../engine/engine';
import { shareOrDownload } from '../../platform/share';
import { isTouch } from '../../platform/env';
import { runJob, toast } from './jobs';
import type { Message } from '../../../../src/core/pipeline';

const baseName = () => {
  const doc = store.doc.value;
  return (doc?.files.design.split('/').pop() ?? 'pack').replace(/\.png$/i, '');
};

/** Dokunmatikte paylaşım menüsü kullanıcı hareketi ister: dosya hazır olunca "Paylaş" düğmeli bildirim göster. */
async function deliver(bytes: Uint8Array, name: string, type: string): Promise<void> {
  if (isTouch) {
    toast(`${name} hazır.`, 'success', { label: 'Paylaş', run: () => void shareOrDownload(bytes, name, type) }, 0);
    return;
  }
  await shareOrDownload(bytes, name, type);
}

function noteMessages(messages: Message[]): void {
  batch(() => { store.cutMessages.value = messages; });
}

export async function exportPdf(): Promise<void> {
  const doc = store.doc.value;
  if (!doc) return;
  const o = store.exportOptions.value;
  const res = await runJob({ kind: 'pdf', label: 'PDF hazırlanıyor' }, (ctl) =>
    engine.pdf(doc, { layers: o.layers, spotColor: o.spotColor, spotName: o.spotName, bleedMm: o.bleedMm }, { signal: ctl.signal, onProgress: ctl.progress }));
  if (!res) return;
  noteMessages(res.messages);
  if (res.pdf) await deliver(res.pdf, `${baseName()}.pdf`, 'application/pdf');
  else toast('PDF üretilemedi; hataları Kontrol sekmesinde gör.', 'error');
}

export async function exportCutOnlyPdf(): Promise<void> {
  const doc = store.doc.value;
  if (!doc) return;
  const o = store.exportOptions.value;
  const res = await runJob({ kind: 'pdf', label: 'Kesim PDF\'i hazırlanıyor' }, (ctl) =>
    engine.pdf(doc, { pages: 'cut', layers: o.layers, spotColor: o.spotColor, spotName: o.spotName, bleedMm: o.bleedMm }, { signal: ctl.signal, onProgress: ctl.progress }));
  if (res?.pdf) await deliver(res.pdf, `${baseName()}-kesim.pdf`, 'application/pdf');
}

export async function exportZip(): Promise<void> {
  const doc = store.doc.value;
  if (!doc) return;
  const zip = await runJob({ kind: 'zip', label: 'Proje paketleniyor' }, (ctl) => engine.zip(doc, { signal: ctl.signal, onProgress: ctl.progress }));
  if (zip) await deliver(zip, `${baseName()}.zip`, 'application/zip');
}

export async function exportSvg(pages: 'cut' | 'both'): Promise<void> {
  const doc = store.doc.value;
  if (!doc) return;
  const res = await runJob({ kind: 'svg', label: 'SVG hazırlanıyor' }, (ctl) => engine.svg(doc, pages, store.exportOptions.value.layers, { signal: ctl.signal, onProgress: ctl.progress }));
  if (!res) return;
  if (!res.svg) { toast('SVG üretilemedi; hataları Kontrol sekmesinde gör.', 'error'); return; }
  await deliver(new TextEncoder().encode(res.svg), `${baseName()}${pages === 'cut' ? '-kesim' : ''}.svg`, 'image/svg+xml');
}

export async function exportPngs(): Promise<void> {
  const doc = store.doc.value;
  if (!doc) return;
  const res = await runJob({ kind: 'png', label: 'Sticker PNG\'leri çiziliyor' }, (ctl) => engine.pngs(doc, store.exportOptions.value.pngDpi, { signal: ctl.signal, onProgress: ctl.progress }));
  if (!res) return;
  if (!res.zip) { toast('Kesilecek sticker yok.', 'warning'); return; }
  await deliver(res.zip, `${baseName()}-stickerlar.zip`, 'application/zip');
}

export async function exportPackage(): Promise<void> {
  const doc = store.doc.value;
  if (!doc) return;
  const o = store.exportOptions.value;
  const res = await runJob({ kind: 'package', label: 'Baskıcı paketi hazırlanıyor' }, (ctl) =>
    engine.package(doc, baseName(), { layers: o.layers, spotColor: o.spotColor, spotName: o.spotName, bleedMm: o.bleedMm, pngDpi: o.pngDpi }, { signal: ctl.signal, onProgress: ctl.progress }));
  if (!res) return;
  if (!res.zip) { toast('Paket üretilemedi; hataları Kontrol sekmesinde gör.', 'error'); return; }
  await deliver(res.zip, `${baseName()}-baskici.zip`, 'application/zip');
}
