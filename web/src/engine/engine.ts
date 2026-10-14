import type { FromWorker, JobId, Phase, Task, TaskResultMap, ToWorker, CutStats, ExportOptions } from './protocol';
import type { InitOptions } from '../../../src/core/pipeline';
import type { Pt } from '../../../src/core/geometry';
import type { BuildPdfOptions } from '../../../src/core/pdf';
import { serializePack, type Pack } from '../../../src/core/project';

export class JobCancelledError extends Error {
  constructor() { super('İşlem iptal edildi.'); this.name = 'JobCancelledError'; }
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (phase: Phase, done: number, total: number) => void;
  onCut?: (itemId: string, key: string, points: Pt[], stats: CutStats) => void;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; opts: RunOptions; cancelTimer?: number }

const CANCEL_ACK_MS = 2000;

/**
 * Worker istemcisi: iş kuyruğu, ilerleme/kesim akışı, iptal. İptal 2 s içinde onaylanmazsa worker yeniden
 * başlatılır ve `onRespawn` (dosyaları geri yüklemek için) çağrılır.
 */
export class Engine {
  private worker!: Worker;
  private pending = new Map<JobId, Pending>();
  private nextJob = 1;
  onRespawn: (() => void) | null = null;

  constructor(private spawn: () => Worker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })) {
    this.boot();
  }

  private boot(): void {
    this.worker = this.spawn();
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => {
      for (const [job, p] of this.pending) { this.pending.delete(job); p.reject(new Error(e.message || 'Motor hatası')); }
    };
  }

  private receive(m: FromWorker): void {
    const p = this.pending.get(m.job);
    if (!p) return;
    switch (m.kind) {
      case 'progress': p.opts.onProgress?.(m.phase, m.done, m.total); return;
      case 'cut': p.opts.onCut?.(m.itemId, m.key, m.points, m.stats); return;
      case 'done': this.settle(m.job); p.resolve(m.result); return;
      case 'error': this.settle(m.job); p.reject(Object.assign(new Error(m.message), { code: m.code })); return;
      case 'cancelled': this.settle(m.job); p.reject(new JobCancelledError()); return;
    }
  }

  private settle(job: JobId): void {
    const p = this.pending.get(job);
    if (p?.cancelTimer) clearTimeout(p.cancelTimer);
    this.pending.delete(job);
  }

  run<K extends Task['type']>(task: Extract<Task, { type: K }>, opts: RunOptions = {}, transfer: Transferable[] = []): Promise<TaskResultMap[K]> {
    const job = this.nextJob++;
    return new Promise<TaskResultMap[K]>((resolve, reject) => {
      const pending: Pending = { resolve: resolve as (v: unknown) => void, reject, opts };
      this.pending.set(job, pending);
      const msg: ToWorker = { kind: 'start', job, task };
      this.worker.postMessage(msg, transfer);
      opts.signal?.addEventListener('abort', () => this.cancel(job), { once: true });
    });
  }

  cancel(job: JobId): void {
    const p = this.pending.get(job);
    if (!p) return;
    this.worker.postMessage({ kind: 'cancel', job } satisfies ToWorker);
    p.cancelTimer = window.setTimeout(() => { if (this.pending.has(job)) this.respawn(); }, CANCEL_ACK_MS);
  }

  /** Worker'ı öldürüp yeniden kurar; bekleyen tüm işler iptal sayılır. */
  respawn(): void {
    this.worker.terminate();
    for (const [job, p] of this.pending) { if (p.cancelTimer) clearTimeout(p.cancelTimer); this.pending.delete(job); p.reject(new JobCancelledError()); }
    this.boot();
    this.onRespawn?.();
  }

  get busy(): boolean { return this.pending.size > 0; }

  // Tipli kısayollar
  addFiles(files: { name: string; bytes: Uint8Array }[], opts?: RunOptions) { return this.run({ type: 'addFiles', files }, opts); }
  removeFiles(names: string[]) { return this.run({ type: 'removeFiles', names }); }
  roles(hints?: { design?: string; background?: string }) { return this.run({ type: 'roles', hints }); }
  init(options: InitOptions, opts?: RunOptions) { return this.run({ type: 'init', options }, opts); }
  cuts(pack: Pack, opts?: RunOptions) { return this.run({ type: 'cuts', packJson: serializePack(pack) }, opts); }
  pdf(pack: Pack, options?: BuildPdfOptions, opts?: RunOptions) { return this.run({ type: 'pdf', packJson: serializePack(pack), options }, opts); }
  zip(pack: Pack, opts?: RunOptions) { return this.run({ type: 'zip', packJson: serializePack(pack) }, opts); }
  svg(pack: Pack, pages: 'cut' | 'print' | 'both', layers = true, opts?: RunOptions) { return this.run({ type: 'svg', packJson: serializePack(pack), pages, layers }, opts); }
  pngs(pack: Pack, dpi: number, opts?: RunOptions) { return this.run({ type: 'pngs', packJson: serializePack(pack), dpi }, opts); }
  package(pack: Pack, name: string, options: ExportOptions, opts?: RunOptions) { return this.run({ type: 'package', packJson: serializePack(pack), name, options }, opts); }
  reference(name: string, bytes: Uint8Array, opts?: RunOptions) { return this.run({ type: 'reference', name, bytes }, opts, [bytes.buffer]); }
  clearReference() { return this.run({ type: 'clearReference' }); }
  compare(pack: Pack, opts?: RunOptions) { return this.run({ type: 'compare', packJson: serializePack(pack) }, opts); }
  reset() { return this.run({ type: 'reset' }); }
}

export const engine = new Engine();
