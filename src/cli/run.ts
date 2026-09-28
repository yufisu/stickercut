import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  initPack, computeCuts, buildPackPdf, renderPackPreview, formatMessage, type LoadedFile, type Message,
} from '../core/pipeline';
import { parsePack, serializePack, PackError, type Pack } from '../core/project';
import { packToZip, zipToPack } from '../core/zip';
import { encodePng } from './png';
import { CliError, listPngs, loadFile, resolveOnDisk, toPackName } from './files';

export interface Io { out(s: string): void; err(s: string): void }
const consoleIo: Io = { out: (s) => console.log(s), err: (s) => console.error(s) };

const USAGE = `Kullanım:
  stickercut init <klasör> [--design dosya] [--background dosya] [--page 80x140] [-o pack.json] [--json]
  stickercut build <pack.json> [--offset mm] [--white-border | --no-white-border] [--stroke pt] [-o çıktı.pdf] [--json]
  stickercut preview <pack.json> [--no-cut] [-o önizleme.png]
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

function packFiles(pack: Pack, withDesign: boolean): string[] {
  return [...new Set([...(withDesign ? [pack.files.design] : []), pack.files.background, ...pack.items.map((i) => i.file)])];
}

function loadPackFiles(packPath: string, names: string[]): Map<string, LoadedFile> {
  const base = dirname(packPath);
  return new Map(names.map((n) => [n, loadFile(resolveOnDisk(base, n), n)]));
}

function report(io: Io, messages: Message[]): void {
  for (const m of messages) (m.level === 'error' ? io.err : io.out)(formatMessage(m));
}

const sibling = (packPath: string, ext: string) => packPath.replace(/\.json$/i, '') + ext;

async function cmdInit(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { design: { type: 'string' }, background: { type: 'string' }, page: { type: 'string' }, out: { type: 'string', short: 'o' }, json: { type: 'boolean' } },
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
  if (values.json) {
    io.out(JSON.stringify({ ok: true, packPath, previewPath, items: res.pack.items.length, needsReview, messages }, null, 2));
  } else {
    io.out(`${res.pack.items.length} sticker yerleştirildi${needsReview ? `, ${needsReview} tanesi kontrol bekliyor` : ''} → ${packPath}`);
    io.out(`Önizleme: ${previewPath}`);
    report(io, messages);
  }
  return messages.some((m) => m.level === 'error') ? 1 : 0;
}

async function cmdBuild(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, allowNegative: true,
    options: { offset: { type: 'string' }, 'white-border': { type: 'boolean' }, stroke: { type: 'string' }, out: { type: 'string', short: 'o' }, json: { type: 'boolean' } },
  });
  if (positionals.length !== 1) throw new UsageError('build tek bir pack.json bekler.');
  const packPath = resolve(positionals[0]);
  const pack = readPack(packPath);
  if (values.offset !== undefined) pack.defaults.offsetMm = signedNum(values.offset, '--offset');
  if (values['white-border'] !== undefined) pack.defaults.whiteBorder = values['white-border'];
  if (values.stroke !== undefined) pack.defaults.strokeWidthPt = num(values.stroke, '--stroke');
  const { pdf, messages } = await buildPackPdf(pack, loadPackFiles(packPath, packFiles(pack, false)));
  const outPath = values.out ? resolve(values.out) : sibling(packPath, '.pdf');
  if (pdf) writeFileSync(outPath, pdf);
  const cutCount = pack.items.filter((i) => !i.printOnly).length;
  if (values.json) io.out(JSON.stringify({ ok: !!pdf, pdfPath: pdf ? outPath : null, items: pack.items.length, cuts: cutCount, messages }, null, 2));
  else {
    if (pdf) io.out(`PDF yazıldı: ${outPath} (${pack.items.length} öğe, ${cutCount} kesim çizgisi)`);
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
    items: pack.items.map((i) => ({ ...i, file: rename.get(i.file)! })),
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
