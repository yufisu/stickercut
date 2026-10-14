import { batch } from '@preact/signals';
import { store } from '../store';
import { engine, JobCancelledError } from '../../engine/engine';
import { cutKey } from '../cut-key';
import { runJob } from './jobs';

let timer = 0;
let inFlight: (() => void) | null = null; // uçuştaki işi iptal eder
let raf = 0;
let dirty = false;
let afterSettle: (() => void) | null = null;

function bump(): void {
  dirty = true;
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; if (dirty) { dirty = false; store.cutsVersion.value++; } });
}

/** Belge değişince çağrılır: uçuştaki işi iptal eder, 120 ms sonra yalnızca bayat kesimleri ister. */
export function scheduleCuts(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void recomputeCuts(), 120);
}

export function onCutsSettled(fn: (() => void) | null): void { afterSettle = fn; }

export async function recomputeCuts(): Promise<void> {
  const doc = store.doc.value;
  if (!doc) return;
  inFlight?.();
  inFlight = null;
  // Taze olmayan girdileri at (bayat çizgi çizilmesin), silinen öğelerin kesimlerini temizle.
  const ids = new Set(doc.items.map((i) => i.id));
  for (const [id, entry] of store.cuts) {
    const item = doc.items.find((i) => i.id === id);
    if (!item || item.printOnly || entry.key !== cutKey(doc, item)) store.cuts.delete(id);
  }
  for (const id of [...store.cuts.keys()]) if (!ids.has(id)) store.cuts.delete(id);
  bump();
  const snapshot = doc;
  let mine = false;
  await runJob({ kind: 'cuts', label: 'Kesim çizgileri hesaplanıyor', blocking: false }, async (ctl) => {
    inFlight = ctl.abort;
    mine = true;
    try {
      const res = await engine.cuts(snapshot, {
        signal: ctl.signal,
        onProgress: ctl.progress,
        onCut: (itemId, key, points, stats) => {
          const current = store.doc.value, item = current?.items.find((i) => i.id === itemId);
          // Bayat iş bile olsa anahtar güncel öğeyle eşleşiyorsa sonuç kullanılabilir.
          if (!current || !item || key !== cutKey(current, item)) return;
          store.cuts.set(itemId, { key, points, stats });
          bump();
        },
      });
      if (!ctl.signal.aborted) batch(() => { store.cutMessages.value = res.messages; });
      afterSettle?.();
    } catch (e) {
      if (!(e instanceof JobCancelledError)) throw e;
    } finally {
      if (mine && inFlight === ctl.abort) inFlight = null;
    }
  });
}

export function cancelCuts(): void { clearTimeout(timer); inFlight?.(); inFlight = null; }
