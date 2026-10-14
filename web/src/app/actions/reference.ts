import { batch } from '@preact/signals';
import { store } from '../store';
import { engine } from '../../engine/engine';
import { runJob, toast } from './jobs';
import { onCutsSettled } from './cuts';
import type { CompareResult } from '../../../../src/core/compare';
import type { Pt } from '../../../../src/core/geometry';

/** Illustrator'dan çıkan referans PDF'i yükler; kesimler her yenilendiğinde karşılaştırma koşar. */
export async function loadReference(file: File): Promise<void> {
  if (file.size > 25 * 1024 * 1024) toast('Referans PDF 25 MB\'tan büyük; yalnızca kesim sayfasını içeren PDF daha hızlı olur.', 'warning');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = await runJob({ kind: 'reference', label: 'Referans PDF okunuyor' }, (ctl) => engine.reference(file.name, bytes, { signal: ctl.signal, onProgress: ctl.progress }));
  if (!info) return;
  batch(() => {
    store.reference.value = { name: file.name, cuts: [], borders: [], pageMm: info.pageMm, cutPage: info.cutPage };
    store.compare.value = null;
    store.showReference.value = true;
  });
  for (const m of info.messages) if (m.level !== 'info') toast(m.text, m.level);
  onCutsSettled(() => void runCompare());
  await runCompare();
}

export async function clearReference(): Promise<void> {
  onCutsSettled(null);
  await engine.clearReference();
  batch(() => { store.reference.value = null; store.compare.value = null; });
}

export async function runCompare(): Promise<void> {
  const doc = store.doc.value;
  if (!doc || !store.reference.value) return;
  const res = await runJob({ kind: 'compare', label: 'Referansla karşılaştırılıyor', blocking: false }, (ctl) => engine.compare(doc, { signal: ctl.signal, onProgress: ctl.progress }));
  if (!res) return;
  const r = res as { result: CompareResult; messages: { level: string; text: string }[]; refCuts?: Pt[][]; refBorders?: Pt[][] };
  batch(() => {
    const ref = store.reference.value;
    if (ref) store.reference.value = { ...ref, cuts: r.refCuts ?? ref.cuts, borders: r.refBorders ?? ref.borders };
    store.compare.value = r.result;
  });
}
