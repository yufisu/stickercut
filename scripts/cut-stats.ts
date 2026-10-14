// Kullanım: npm run cut:stats -- <pack.json>
// Her öğe için anchor sayısı, düz segment, G1, çizime yakınlık ve süre yazdırır (kalite ayarı için).
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parsePack, itemLabel } from '../src/core/project';
import { computeCutsDetailed, packAssetNames, type LoadedFile } from '../src/core/pipeline';
import { loadFile, resolveOnDisk } from '../src/cli/files';
import { isG1 } from '../src/core/spline';

const packPath = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('Kullanım: npm run cut:stats -- <pack.json>'); process.exit(2); }
const pack = parsePack(readFileSync(packPath, 'utf8'));
const base = dirname(packPath);
const assets = new Map<string, LoadedFile>(packAssetNames(pack, true).map((n) => [n, loadFile(resolveOnDisk(base, n), n)]));
const started = performance.now();
const { cuts, messages, details } = computeCutsDetailed(pack, assets);
const total = performance.now() - started;
const row = (c: (string | number)[]) => c.map((v, i) => String(v).padEnd([5, 22, 7, 6, 4, 9, 7, 7][i] ?? 8)).join(' ');
console.log(row(['id', 'kaynak', 'anchor', 'düz', 'G1', 'min mm', 'içeri', 'ms']));
let ok = true;
for (const item of pack.items) {
  const d = details.get(item.id), pts = cuts.get(item.id);
  if (!d || !pts) { console.log(row([item.id, itemLabel(item), '-', '-', '-', '-', '-', '-'])); continue; }
  const g1 = isG1(pts);
  const c = d.shape.clearance;
  if (!g1 || d.shape.stats.lines > 0 || c.minMm < d.options.offsetMm - 0.1) ok = false;
  console.log(row([item.id, itemLabel(item).slice(0, 22), d.shape.stats.anchors, d.shape.stats.lines, g1 ? 'ok' : 'HAYIR',
    Number.isFinite(c.minMm) ? c.minMm.toFixed(2) : '-', `%${Math.round(c.insideRatio * 100)}`, d.shape.stats.ms.toFixed(0)]));
}
console.log(`toplam ${total.toFixed(0)} ms, ${cuts.size} kesim`);
for (const m of messages) console.log(`${m.level.toUpperCase()}: ${m.text}`);
process.exit(ok ? 0 : 1);
