import { batch } from '@preact/signals';
import { store, type JobState, type Toast } from '../store';
import type { Phase } from '../../engine/protocol';
import { JobCancelledError } from '../../engine/engine';

let nextJob = 1;
let nextToast = 1;

export interface JobSpec { kind: string; label: string; blocking?: boolean; cancellable?: boolean }
export interface JobControl { signal: AbortSignal; abort: () => void; progress: (phase: Phase, done: number, total: number) => void }

const PHASE_LABEL: Record<Phase, string> = {
  decode: 'PNG\'ler çözülüyor', roles: 'Roller belirleniyor', regions: 'Bölgeler bulunuyor', match: 'Sticker\'lar eşleştiriliyor',
  cuts: 'Kesim çizgileri', layout: 'Yerleşim kontrolü', pdf: 'PDF yazılıyor', zip: 'Paketleniyor', svg: 'SVG yazılıyor',
  png: 'PNG\'ler çiziliyor', package: 'Baskıcı paketi', reference: 'Referans okunuyor', compare: 'Karşılaştırılıyor',
  rasterize: 'PDF sayfaları çiziliyor',
};
export const phaseLabel = (p: Phase | null) => (p ? PHASE_LABEL[p] : '');

function setJob(id: number, patch: Partial<JobState> | null): void {
  const next = new Map(store.jobs.value);
  if (patch === null) next.delete(id);
  else next.set(id, { ...next.get(id)!, ...patch });
  store.jobs.value = next;
}

/** Bir worker işini kaydeder; ilerlemeyi, iptali ve hatayı mağazaya yansıtır. İptal → undefined. */
export async function runJob<T>(spec: JobSpec, fn: (ctl: JobControl) => Promise<T>): Promise<T | undefined> {
  const id = nextJob++;
  const ac = new AbortController();
  const job: JobState = {
    id, kind: spec.kind, label: spec.label, phase: null, done: 0, total: 0,
    cancellable: spec.cancellable ?? true, blocking: spec.blocking ?? true, cancel: () => ac.abort(),
  };
  store.jobs.value = new Map(store.jobs.value).set(id, job);
  let lastTick = 0;
  try {
    return await fn({
      signal: ac.signal,
      abort: () => ac.abort(),
      progress: (phase, done, total) => {
        const now = performance.now();
        if (now - lastTick < 60 && done !== total) return; // 60 ms'den sık boyama
        lastTick = now;
        setJob(id, { phase, done, total });
      },
    });
  } catch (e) {
    if (e instanceof JobCancelledError || ac.signal.aborted) return undefined;
    toast(e instanceof Error ? e.message : String(e), 'error');
    return undefined;
  } finally {
    setJob(id, null);
  }
}

export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ttlMs = kind === 'error' ? 8000 : 4000): number {
  const id = nextToast++;
  batch(() => { store.toasts.value = [...store.toasts.value, { id, text, kind, action }]; });
  if (ttlMs > 0) setTimeout(() => dismissToast(id), ttlMs);
  return id;
}

export function dismissToast(id: number): void {
  store.toasts.value = store.toasts.value.filter((t) => t.id !== id);
}
