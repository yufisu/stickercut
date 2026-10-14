import { store, busy } from '../store';
import { engine } from '../../engine/engine';
import { presetById } from '../presets';
import { runJob, toast } from './jobs';
import { openDocument } from './files';

/** Kurulum ekranındaki "Yerleştir": eşleştirme worker'da ilerlemeli çalışır. */
export async function place(): Promise<boolean> {
  if (busy.value) return false;
  const files = [...store.files.value.values()];
  const design = files.find((f) => f.role === 'design'), background = files.find((f) => f.role === 'background');
  if (!design || !background) { toast('Önce bir tam tasarım ve bir arka plan seç.', 'warning'); return false; }
  if (design.width !== background.width || design.height !== background.height) { toast('Tam tasarım ve arka plan aynı piksel boyutunda olmalı.', 'warning'); return false; }
  const res = await runJob({ kind: 'init', label: 'Sticker\'lar yerleştiriliyor' }, (ctl) => engine.init({
    design: design.name, background: background.name,
    stickers: files.filter((f) => f.role === 'sticker').map((f) => f.name),
    page: { widthMm: store.pageSetup.value.widthMm, heightMm: store.pageSetup.value.heightMm ?? undefined },
  }, { signal: ctl.signal, onProgress: ctl.progress }));
  if (!res) return false;
  if (!res.pack) {
    store.notice.value = res.messages[0] ?? null;
    return false;
  }
  const preset = presetById(store.presetId.value);
  if (preset) Object.assign(res.pack.defaults, preset.settings);
  openDocument(res.pack, res.messages);
  return true;
}
