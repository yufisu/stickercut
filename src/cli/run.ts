import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  initPack, computeCuts, computeCutsDetailed, buildPackPdf, renderPackPreview, formatMessage, packAssetNames, pdfAssetsFor,
  compareWithReference, createCutCache, type LoadedFile, type Message,
} from '../core/pipeline';
import { parsePack, serializePack, PackError, itemLabel, mmPerDesignPx, type Pack } from '../core/project';
import { packToZip, zipToPack } from '../core/zip';
import { buildSvg } from '../core/svg';
import { renderAllStickerPngs } from '../core/export-png';
import { encodePngRgba } from '../core/png-encode';
import { buildPrinterPackage } from '../core/package';
import { readPdfPaths, referenceForPack } from '../core/pdf-read';
import { checkLayout } from '../core/checks';
import { isG1 } from '../core/spline';
import { polygonBounds, polylineLength } from '../core/geometry';
import type { BuildPdfOptions } from '../core/pdf';
import { encodePng } from './png';
import { CliError, listPngs, loadFile, resolveOnDisk, toPackName } from './files';

export interface Io { out(s: string): void; err(s: string): void }
const consoleIo: Io = { out: (s) => console.log(s), err: (s) => console.error(s) };

const USAGE = `Kullanım:
  stickercut init <klasör> [--design dosya] [--background dosya] [--page 80x140] [--no-regions] [-o pack.json] [--json]
  stickercut build <pack.json> [--offset mm] [--white-border | --no-white-border] [--stroke pt] [--closing mm] [--corner-radius mm]
                   [--smooth mm] [--simplify mm] [--svg] [--print-svg] [--png-dir klasör] [--dpi 300] [--package]
                   [--cut-only] [--spot] [--spot-name CutContour] [--no-layers] [--bleed mm] [-o çıktı.pdf] [--json]
  stickercut preview <pack.json> [--no-cut] [-o önizleme.png]
  stickercut compare <pack.json> <referans.pdf> [--page N] [--mean 0.25] [--max 0.8] [--json]
  stickercut doctor <pack.json> [--min-gap mm] [--margin mm] [--strict] [--json]
  stickercut export <pack.json> -o paket.zip
  stickercut import <paket.zip> <klasör> [--force]`;

class UsageError extends Error {}

export async function run(argv: string[], io: Io = consoleIo): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'init': return await cmdInit(rest, io);
      case 'build': return await cmdBuild(rest, io);
      case 'preview': return cmdPreview(rest, io);
      case 'compare': return await cmdCompare(rest, io);
      case 'doctor': return cmdDoctor(rest, io);
      case 'export': return cmdExport(rest, io);
      case 'import': return cmdImport(rest, io);
      default: io.err(USAGE); return 2;
    }
  } catch (e) {
    if (e instanceof UsageError) { io.err(`${e.message}\n\n${USAGE}`); return 2; }
    if (e instanceof CliError || e instanceof PackError) { io.err(`HATA: ${e.message}`); return 1; }
    if (e instanceof TypeError && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS')) { io.err(`${e.message}\n\n${USAGE}`); return 2; }
    throw e;
  }
}

function parsePage(v: string): { widthMm: number; heightMm?: number } {
  const m = /^(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/i.exec(v.trim());
  if (!m) throw new UsageError(`--page "80x140" ya da "80" biçiminde olmalı, verilen: ${v}`);
  return { widthMm: Number(m[1]), heightMm: m[2] ? Number(m[2]) : undefined };
}

function num(v: string, flag: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`${flag} sıfır ya da pozitif bir sayı olmalı, verilen: ${v}`);
  return n;
}

function signedNum(v: string, flag: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UsageError(`${flag} bir sayı olmalı, verilen: ${v}`);
  return n;
}

function readPack(path: string): Pack {
  if (!existsSync(path)) throw new CliError(`pack.json bulunamadı: ${path}`);
  return parsePack(readFileSync(path, 'utf8'));
}

const packFiles = (pack: Pack, withDesign: boolean): string[] => packAssetNames(pack, withDesign);

function loadPackFiles(packPath: string, names: string[]): Map<string, LoadedFile> {
  const base = dirname(packPath);
  return new Map(names.map((n) => [n, loadFile(resolveOnDisk(base, n), n)]));
}

function report(io: Io, messages: Message[]): void {
  for (const m of messages) (m.level === 'error' ? io.err : io.out)(formatMessage(m));
}

const sibling = (packPath: string, ext: string) => packPath.replace(/\.json$/i, '') + ext;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

async function cmdInit(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, allowNegative: true,
    options: {
      design: { type: 'string' }, background: { type: 'string' }, page: { type: 'string' }, out: { type: 'string', short: 'o' },
      json: { type: 'boolean' }, regions: { type: 'boolean', default: true },
    },
  });
  if (positionals.length !== 1) throw new UsageError('init tek bir klasör bekler.');
  const dir = resolve(positionals[0]);
  if (!existsSync(dir)) throw new CliError(`Klasör bulunamadı: ${dir}`);
  const packPath = values.out ? resolve(values.out) : join(dir, 'pack.json');
  const base = dirname(packPath);
  const files = listPngs(dir).map((abs) => loadFile(abs, toPackName(base, abs)));
  const hint = (v?: string) => (v === undefined ? undefined : toPackName(base, resolveOnDisk(dir, v)));
  const res = initPack(files, {
    design: hint(values.design), background: hint(values.background),
    page: values.page ? parsePage(values.page) : undefined,
    regionItems: values.regions,
  });
  if (!res.pack) {
    if (values.json) io.out(JSON.stringify({ ok: false, messages: res.messages }, null, 2));
    else report(io, res.messages);
    return 1;
  }
  mkdirSync(base, { recursive: true });
  writeFileSync(packPath, serializePack(res.pack));
  const assets = new Map(files.map((f) => [f.name, f]));
  const { cuts, messages: cutMessages } = computeCuts(res.pack, assets);
  const previewPath = sibling(packPath, '.preview.png');
  writeFileSync(previewPath, encodePng(renderPackPreview(res.pack, assets, cuts)));
  const messages = [...res.messages, ...cutMessages];
  const needsReview = res.pack.items.filter((i) => i.needsReview).length;
  const regions = res.pack.items.filter((i) => i.file === null).length;
  if (values.json) {
    io.out(JSON.stringify({ ok: true, packPath, previewPath, items: res.pack.items.length, needsReview, regionItems: regions, messages }, null, 2));
  } else {
    io.out(`${res.pack.items.length} sticker yerleştirildi${needsReview ? `, ${needsReview} tanesi kontrol bekliyor` : ''}${regions ? `, ${regions} tanesi tasarımdan alınan bölge` : ''} → ${packPath}`);
    io.out(`Önizleme: ${previewPath}`);
    report(io, messages);
  }
  return messages.some((m) => m.level === 'error') ? 1 : 0;
}

async function cmdBuild(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, allowNegative: true,
    options: {
      offset: { type: 'string' }, 'white-border': { type: 'boolean' }, stroke: { type: 'string' }, closing: { type: 'string' },
      'corner-radius': { type: 'string' }, smooth: { type: 'string' }, simplify: { type: 'string' }, out: { type: 'string', short: 'o' }, json: { type: 'boolean' },
      svg: { type: 'boolean' }, 'print-svg': { type: 'boolean' }, 'png-dir': { type: 'string' }, dpi: { type: 'string' }, package: { type: 'boolean' },
      'cut-only': { type: 'boolean' }, spot: { type: 'boolean' }, 'spot-name': { type: 'string' }, layers: { type: 'boolean', default: true }, bleed: { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new UsageError('build tek bir pack.json bekler.');
  const packPath = resolve(positionals[0]);
  const pack = readPack(packPath);
  if (values.offset !== undefined) pack.defaults.offsetMm = signedNum(values.offset, '--offset');
  if (values['white-border'] !== undefined) pack.defaults.whiteBorder = values['white-border'];
  if (values.stroke !== undefined) pack.defaults.strokeWidthPt = num(values.stroke, '--stroke');
  if (values.closing !== undefined) pack.defaults.closingMm = num(values.closing, '--closing');
  if (values['corner-radius'] !== undefined) pack.defaults.cornerRadiusMm = num(values['corner-radius'], '--corner-radius');
  if (values.smooth !== undefined) pack.defaults.smoothMm = num(values.smooth, '--smooth');
  if (values.simplify !== undefined) pack.defaults.simplifyMm = num(values.simplify, '--simplify');
  const dpi = values.dpi !== undefined ? num(values.dpi, '--dpi') : 300;
  const pdfOpts: BuildPdfOptions = {
    pages: values['cut-only'] ? 'cut' : 'both', layers: values.layers, spotColor: values.spot === true, spotName: values['spot-name'],
    bleedMm: values.bleed !== undefined ? num(values.bleed, '--bleed') : 0,
  };
  const files = loadPackFiles(packPath, packFiles(pack, false));
  const cache = createCutCache();
  const { pdf, messages, cuts } = await buildPackPdf(pack, files, cache, pdfOpts);
  const outPath = values.out ? resolve(values.out) : sibling(packPath, '.pdf');
  const extra: Record<string, unknown> = {};
  if (pdf) {
    writeFileSync(outPath, pdf);
    const stem = outPath.replace(/\.pdf$/i, '');
    if (values.svg) {
      const p = `${stem}.kesim.svg`;
      writeFileSync(p, buildSvg(pack, cuts, { pages: 'cut', layers: values.layers }));
      extra.svgPath = p;
    }
    if (values['print-svg']) {
      const p = `${stem}.baski.svg`;
      writeFileSync(p, buildSvg(pack, cuts, { pages: 'both', assets: pdfAssetsFor(pack, files, []), layers: values.layers }));
      extra.printSvgPath = p;
    }
    if (values['png-dir'] !== undefined) {
      const dir = resolve(values['png-dir']);
      mkdirSync(dir, { recursive: true });
      const r = renderAllStickerPngs(pack, files, cuts, { dpi });
      messages.push(...r.messages);
      extra.pngDir = dir;
      extra.pngs = r.renders.map((s) => { const p = join(dir, s.name); writeFileSync(p, encodePngRgba(s.raster)); return p; });
    }
    if (values.package) {
      const r = await buildPrinterPackage(pack, files, cache, { name: basename(stem), pngDpi: dpi, spotColor: pdfOpts.spotColor, spotName: pdfOpts.spotName, layers: values.layers });
      if (r.zip) { const p = `${stem}.baskici.zip`; writeFileSync(p, r.zip); extra.packagePath = p; }
    }
  }
  const cutCount = pack.items.filter((i) => !i.printOnly).length;
  if (values.json) {
    io.out(JSON.stringify({ ok: !!pdf, pdfPath: pdf ? outPath : null, items: pack.items.length, cuts: cutCount, ...extra, options: pdfOpts, messages }, null, 2));
  } else {
    if (pdf) io.out(`PDF yazıldı: ${outPath} (${pack.items.length} öğe, ${cutCount} kesim çizgisi${pdfOpts.pages === 'cut' ? ', yalnızca kesim sayfası' : ''})`);
    for (const [k, v] of Object.entries(extra)) if (typeof v === 'string') io.out(`${k === 'svgPath' ? 'Kesim SVG' : k === 'printSvgPath' ? 'Baskı SVG' : k === 'pngDir' ? 'Sticker PNG klasörü' : 'Baskıcı paketi'}: ${v}`);
    report(io, messages);
  }
  return pdf ? 0 : 1;
}

function cmdPreview(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, allowNegative: true,
    options: { cut: { type: 'boolean', default: true }, out: { type: 'string', short: 'o' } },
  });
  if (positionals.length !== 1) throw new UsageError('preview tek bir pack.json bekler.');
  const packPath = resolve(positionals[0]);
  const pack = readPack(packPath);
  const assets = loadPackFiles(packPath, packFiles(pack, false));
  const cuts = values.cut ? computeCuts(pack, assets) : null;
  const outPath = values.out ? resolve(values.out) : sibling(packPath, '.preview.png');
  writeFileSync(outPath, encodePng(renderPackPreview(pack, assets, cuts?.cuts ?? null)));
  io.out(`Önizleme: ${outPath}`);
  if (cuts) report(io, cuts.messages);
  return 0;
}

async function cmdCompare(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { page: { type: 'string' }, mean: { type: 'string' }, max: { type: 'string' }, json: { type: 'boolean' } },
  });
  if (positionals.length !== 2) throw new UsageError('compare bir pack.json ve bir referans PDF bekler.');
  const packPath = resolve(positionals[0]), refPath = resolve(positionals[1]);
  if (!existsSync(refPath)) throw new CliError(`Referans PDF bulunamadı: ${refPath}`);
  const pack = readPack(packPath);
  const files = loadPackFiles(packPath, packFiles(pack, false));
  const page = values.page !== undefined ? Math.round(num(values.page, '--page')) : undefined;
  const doc = await readPdfPaths(new Uint8Array(readFileSync(refPath)), page ? { cutPage: page - 1 } : undefined);
  const ref = referenceForPack(doc, pack);
  const compareOpts: { meanMm?: number; maxMm?: number } = {};
  if (values.mean !== undefined) compareOpts.meanMm = num(values.mean, '--mean');
  if (values.max !== undefined) compareOpts.maxMm = num(values.max, '--max');
  const { result, messages } = compareWithReference(pack, files, { cuts: ref.cuts }, undefined, compareOpts);
  const all = [...doc.messages, ...ref.messages, ...messages];
  const ok = result.summary.deviating + result.summary.missing === 0 && ref.cuts.length > 0;
  if (values.json) {
    io.out(JSON.stringify({
      ok, refPath, cutPage: doc.cutPage + 1, refCount: ref.cuts.length, borderCount: ref.borders.length, pageMm: ref.pageMm,
      summary: result.summary, items: result.items, unmatchedRefs: result.unmatchedRefs, messages: all,
    }, null, 2));
    return ok ? 0 : 1;
  }
  const fmt = (v: number | null) => (v === null ? '-' : v.toFixed(2));
  for (const item of result.items) {
    const label = itemLabel(pack.items.find((i) => i.id === item.itemId) ?? { id: item.itemId, file: item.file } as Pack['items'][number]);
    io.out(`${item.itemId.padEnd(4)} ${label.slice(0, 22).padEnd(22)} ort ${fmt(item.meanMm)} mm  maks ${fmt(item.hausdorffMm)} mm  ${item.tool.anchors}/${item.refStats?.anchors ?? '-'} nokta  ${item.verdict.toUpperCase()}`);
  }
  const s = result.summary;
  io.out(`${s.matched}/${s.items} eşleşiyor · ort ${fmt(s.meanMm)} mm · maks ${fmt(s.maxHausdorffMm)} mm` + (s.suggestedOffsetMm !== null ? ` · önerilen ofset ${s.suggestedOffsetMm.toFixed(2)} mm` : '') + ` · referans ${ref.cuts.length} kesim yolu (sayfa ${doc.cutPage + 1})`);
  report(io, all);
  return ok ? 0 : 1;
}

const LAYOUT_CODES = new Set(['ASPECT', 'OUTSIDE_PAGE', 'PAGE_MARGIN', 'OVERLAP', 'MIN_GAP']);

function cmdDoctor(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { 'min-gap': { type: 'string' }, margin: { type: 'string' }, strict: { type: 'boolean' }, json: { type: 'boolean' } },
  });
  if (positionals.length !== 1) throw new UsageError('doctor tek bir pack.json bekler.');
  const packPath = resolve(positionals[0]);
  const pack = readPack(packPath);
  if (values['min-gap'] !== undefined) pack.defaults.minGapMm = num(values['min-gap'], '--min-gap');
  const files = loadPackFiles(packPath, packFiles(pack, false));
  const detailed = computeCutsDetailed(pack, files);
  let messages = detailed.messages;
  if (values.margin !== undefined) {
    messages = [...messages.filter((m) => !LAYOUT_CODES.has(m.code)),
      ...checkLayout(pack, detailed.cuts, { minGapMm: pack.defaults.minGapMm, marginMm: num(values.margin, '--margin') })];
  }
  const mm = mmPerDesignPx(pack);
  const items = pack.items.map((item) => {
    const d = detailed.details.get(item.id), pts = detailed.cuts.get(item.id);
    const base = { id: item.id, file: itemLabel(item), printOnly: item.printOnly, needsReview: item.needsReview };
    if (!d || !pts) return { ...base, cut: false as const };
    const b = polygonBounds(pts);
    return {
      ...base, cut: true as const, anchors: d.shape.stats.anchors, lines: d.shape.stats.lines, g1: isG1(pts),
      perimeterMm: r1(polylineLength(pts) * mm.x),
      bboxMm: { x: r1(b.minX * mm.x), y: r1(b.minY * mm.y), w: r1((b.maxX - b.minX) * mm.x), h: r1((b.maxY - b.minY) * mm.y) },
      clearanceMm: Number.isFinite(d.shape.clearance.minMm) ? r2(d.shape.clearance.minMm) : null,
    };
  });
  const errors = messages.filter((m) => m.level === 'error').length, warnings = messages.filter((m) => m.level === 'warning').length;
  const ok = errors === 0 && (!values.strict || warnings === 0);
  if (values.json) {
    io.out(JSON.stringify({ ok, errors, warnings, items, messages }, null, 2));
    return ok ? 0 : 1;
  }
  io.out(['id', 'kaynak', 'anchor', 'düz', 'G1', 'çevre mm', 'boyut mm', 'yakınlık mm'].map((h, i) => h.padEnd([5, 22, 7, 4, 6, 9, 14, 11][i])).join(''));
  for (const it of items) {
    if (!it.cut) { io.out(`${it.id.padEnd(5)}${it.file.slice(0, 21).padEnd(22)}${it.printOnly ? 'sadece baskı' : 'kesim yok'}`); continue; }
    io.out([it.id, it.file.slice(0, 21), it.anchors, it.lines, it.g1 ? 'ok' : 'HAYIR', it.perimeterMm, `${it.bboxMm.w}×${it.bboxMm.h}`, it.clearanceMm ?? '-']
      .map((v, i) => String(v).padEnd([5, 22, 7, 4, 6, 9, 14, 11][i])).join(''));
  }
  io.out(`${errors} hata, ${warnings} uyarı${ok ? ' — baskıya hazır' : ''}`);
  report(io, messages);
  return ok ? 0 : 1;
}

function cmdExport(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { out: { type: 'string', short: 'o' } } });
  if (positionals.length !== 1 || !values.out) throw new UsageError('export bir pack.json ve -o paket.zip bekler.');
  const packPath = resolve(positionals[0]);
  const pack = readPack(packPath);
  const base = dirname(packPath);
  const rename = new Map<string, string>();
  const taken = new Set<string>();
  for (const n of packFiles(pack, true)) {
    let z = n.startsWith('../') || n.startsWith('/') ? `files/${n.split('/').pop()}` : n;
    for (let i = 2; taken.has(z); i++) z = z.replace(/(\.png)$/i, `-${i}$1`);
    taken.add(z);
    rename.set(n, z);
  }
  const files = new Map([...rename].map(([n, z]) => [z, new Uint8Array(readFileSync(resolveOnDisk(base, n)))]));
  const out: Pack = {
    ...pack,
    files: { design: rename.get(pack.files.design)!, background: rename.get(pack.files.background)! },
    items: pack.items.map((i) => ({ ...i, file: i.file === null ? null : rename.get(i.file)! })),
  };
  const zipPath = resolve(values.out);
  writeFileSync(zipPath, packToZip(serializePack(out), files));
  io.out(`Proje dışa aktarıldı: ${zipPath} (${files.size} dosya)`);
  return 0;
}

function cmdImport(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { force: { type: 'boolean' } } });
  if (positionals.length !== 2) throw new UsageError('import bir zip ve hedef klasör bekler.');
  const [zipPath, dir] = positionals.map((p) => resolve(p));
  const { packJson, files } = zipToPack(new Uint8Array(readFileSync(zipPath)));
  parsePack(packJson);
  const packPath = join(dir, 'pack.json');
  if (existsSync(packPath) && !values.force) throw new CliError(`${packPath} zaten var; üzerine yazmak için --force kullan.`);
  for (const [name, bytes] of files) {
    if (name.includes('\\') || name.split('/').includes('..')) throw new CliError(`Zip’te güvensiz yol var: ${name}`);
    const p = join(dir, ...name.split('/'));
    if (p !== dir && relative(dir, p).startsWith('..')) throw new CliError(`Zip’te güvensiz yol var: ${name}`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(packPath, packJson);
  io.out(`Proje açıldı: ${packPath} (${files.size} dosya)`);
  return 0;
}
