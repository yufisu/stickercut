import { decodePngBytes } from './decode';
import type { FromWorker, JobId, Phase, Task, ToWorker } from './protocol';
import {
  prepareLoadedFile, initPackSteps, cutSteps, buildPackPdf, pdfAssetsFor, compareWithReference, createCutCache, computeCuts,
  type LoadedFile, type CutCache, type Message,
} from '../../../src/core/pipeline';
import { assignRoles } from '../../../src/core/roles';
import { parsePack } from '../../../src/core/project';
import { packToZip } from '../../../src/core/zip';
import { buildSvg } from '../../../src/core/svg';
import { renderAllStickerPngs } from '../../../src/core/export-png';
import { encodePngRgba } from '../../../src/core/png-encode';
import { buildPrinterPackage } from '../../../src/core/package';
import { readPdfPaths, referenceForPack } from '../../../src/core/pdf-read';
import { zipSync } from 'fflate';
import { cutKey } from '../app/cut-key';
import type { Pt } from '../../../src/core/geometry';

const files = new Map<string, LoadedFile>();
let cache: CutCache = createCutCache();
let reference: { name: string; cuts: Pt[][]; borders: Pt[][] } | null = null;

const ctx = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

class Cancelled extends Error {}
const cancelled = new Set<JobId>();
const queue: { job: JobId; task: Task }[] = [];
let running = false;

// MessageChannel ping: olay döngüsüne dönüp iptal mesajını almayı sağlar (setTimeout'tan hızlı).
const channel = new MessageChannel();
let tick: (() => void) | null = null;
channel.port1.onmessage = () => { const t = tick; tick = null; t?.(); };
const yieldToLoop = () => new Promise<void>((resolve) => { tick = resolve; channel.port2.postMessage(null); });

const progress = (job: JobId, phase: Phase, done: number, total: number) => ctx.postMessage({ kind: 'progress', job, phase, done, total });
const check = (job: JobId) => { if (cancelled.has(job)) throw new Cancelled(); };

async function* paced<T, R>(job: JobId, gen: Generator<T, R>): AsyncGenerator<T, R> {
  let r = gen.next();
  while (!r.done) {
    yield r.value;
    await yieldToLoop();
    check(job);
    r = gen.next();
  }
  return r.value;
}

async function run(job: JobId, task: Task): Promise<{ result: unknown; transfer?: Transferable[] }> {
  switch (task.type) {
    case 'addFiles': {
      const out = [];
      for (const [i, f] of task.files.entries()) {
        progress(job, 'decode', i, task.files.length);
        const loaded = prepareLoadedFile(f.name, f.bytes, await decodePngBytes(f.bytes));
        files.set(loaded.name, loaded);
        out.push({ name: loaded.name, width: loaded.width, height: loaded.height });
        await yieldToLoop();
        check(job);
      }
      return { result: out };
    }
    case 'removeFiles':
      for (const name of task.names) files.delete(name);
      cache = createCutCache();
      return { result: null };
    case 'roles':
      return { result: assignRoles([...files.values()].map((f) => ({ file: f.name, raster: f.raster })), task.hints) };
    case 'init': {
      const steps = paced(job, initPackSteps([...files.values()], task.options));
      let r = await steps.next();
      while (!r.done) { progress(job, r.value.phase, r.value.done, r.value.total); r = await steps.next(); }
      const { syntheticBackground: synthetic, ...rest } = r.value;
      if (!synthetic) return { result: rest };
      // Tek sayfa modu: sayfadan üretilen arka plan bu worker'ın dosyası olur (PDF, zip, önizleme için).
      files.set(synthetic.name, synthetic);
      return { result: { ...rest, syntheticBackground: { name: synthetic.name, bytes: synthetic.bytes, width: synthetic.width, height: synthetic.height } } };
    }
    case 'cuts': {
      const pack = parsePack(task.packJson);
      const total = pack.items.filter((i) => !i.printOnly).length;
      const byId = new Map(pack.items.map((i) => [i.id, i]));
      const steps = paced(job, cutSteps(pack, files, cache));
      let r = await steps.next(), done = 0;
      while (!r.done) {
        const { itemId, points, detail } = r.value;
        const item = byId.get(itemId)!;
        ctx.postMessage({ kind: 'cut', job, itemId, key: cutKey(pack, item), points,
          stats: { anchors: detail.shape.stats.anchors, lines: detail.shape.stats.lines, ms: detail.shape.stats.ms, minMm: detail.shape.clearance.minMm } });
        progress(job, 'cuts', ++done, total);
        r = await steps.next();
      }
      return { result: { messages: r.value.messages } };
    }
    case 'pdf': {
      progress(job, 'pdf', 0, 1);
      const out = await buildPackPdf(parsePack(task.packJson), files, cache, task.options);
      return { result: { pdf: out.pdf, messages: out.messages }, transfer: out.pdf ? [out.pdf.buffer] : [] };
    }
    case 'zip': {
      const pack = parsePack(task.packJson);
      const names = new Set([pack.files.design, pack.files.background, ...pack.items.map((i) => i.file).filter((f): f is string => f !== null)]);
      const zip = packToZip(task.packJson, new Map([...names].filter((n) => files.has(n)).map((n) => [n, files.get(n)!.bytes])));
      return { result: zip, transfer: [zip.buffer] };
    }
    case 'svg': {
      const pack = parsePack(task.packJson);
      const { cuts, messages } = computeCuts(pack, files, cache);
      const assets = task.pages === 'cut' ? undefined : pdfAssetsFor(pack, files, messages);
      if (messages.some((m) => m.level === 'error')) return { result: { svg: '', messages } };
      return { result: { svg: buildSvg(pack, cuts, { pages: task.pages, assets, layers: task.layers }), messages } };
    }
    case 'pngs': {
      const pack = parsePack(task.packJson);
      const { cuts, messages } = computeCuts(pack, files, cache);
      const r = renderAllStickerPngs(pack, files, cuts, { dpi: task.dpi });
      messages.push(...r.messages);
      const entries: Record<string, Uint8Array> = {};
      for (const [i, s] of r.renders.entries()) { progress(job, 'png', i + 1, r.renders.length); entries[s.name] = encodePngRgba(s.raster); await yieldToLoop(); check(job); }
      if (!r.renders.length) return { result: { zip: null, count: 0, messages } };
      const zip = zipSync(entries, { level: 0 });
      return { result: { zip, count: r.renders.length, messages }, transfer: [zip.buffer] };
    }
    case 'package': {
      progress(job, 'package', 0, 1);
      const out = await buildPrinterPackage(parsePack(task.packJson), files, cache, { name: task.name, ...task.options });
      return { result: out, transfer: out.zip ? [out.zip.buffer] : [] };
    }
    case 'reference': {
      progress(job, 'reference', 0, 1);
      const doc = await readPdfPaths(task.bytes);
      // Tasarım ölçüsü bilinmeden sayfa pt'leri saklanır; pack geldiğinde referenceForPack ile ölçeklenir.
      reference = { name: task.name, cuts: [], borders: [] };
      (reference as unknown as { doc: typeof doc }).doc = doc;
      const cutPage = doc.pages[doc.cutPage];
      return { result: { name: task.name, cuts: [], borders: [], pageMm: { w: cutPage ? cutPage.widthPt / 2.834645669 : 0, h: cutPage ? cutPage.heightPt / 2.834645669 : 0 }, cutPage: doc.cutPage, messages: doc.messages } };
    }
    case 'clearReference':
      reference = null;
      return { result: null };
    case 'compare': {
      const pack = parsePack(task.packJson);
      const doc = (reference as unknown as { doc?: Parameters<typeof referenceForPack>[0] } | null)?.doc;
      if (!doc) throw new Error('Önce bir referans PDF yükle.');
      progress(job, 'compare', 0, 1);
      const ref = referenceForPack(doc, pack);
      const out = compareWithReference(pack, files, { cuts: ref.cuts }, cache);
      const messages: Message[] = [...ref.messages, ...out.messages];
      return { result: { result: out.result, messages, refCuts: ref.cuts, refBorders: ref.borders } };
    }
    case 'reset':
      files.clear();
      cache = createCutCache();
      reference = null;
      return { result: null };
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length) {
    const { job, task } = queue.shift()!;
    if (cancelled.has(job)) { cancelled.delete(job); ctx.postMessage({ kind: 'cancelled', job }); continue; }
    try {
      const { result, transfer } = await run(job, task);
      ctx.postMessage({ kind: 'done', job, result }, transfer);
    } catch (err) {
      if (err instanceof Cancelled) ctx.postMessage({ kind: 'cancelled', job });
      else ctx.postMessage({ kind: 'error', job, message: err instanceof Error ? err.message : String(err), code: (err as { code?: string }).code });
    } finally {
      cancelled.delete(job);
    }
  }
  running = false;
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.kind === 'cancel') { cancelled.add(m.job); return; }
  queue.push({ job: m.job, task: m.task });
  void pump();
};
