import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { decodePng } from './png';
import { prepareLoadedFile, type LoadedFile } from '../core/pipeline';
import { nfc } from '../core/project';

export class CliError extends Error {}

export function listPngs(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.png$/i.test(e.name) && !/\.preview\.png$/i.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

export function toPackName(baseDir: string, abs: string): string {
  return nfc(relative(baseDir, abs).split(sep).join('/'));
}

/** pack.json'daki (NFC) adı diskteki gerçek yola çevirir; macOS NFD adlarını Linux'ta da bulur. */
export function resolveOnDisk(baseDir: string, name: string): string {
  const direct = join(baseDir, name);
  if (existsSync(direct)) return direct;
  let cur = baseDir;
  for (const part of name.split('/')) {
    if (part === '.' || part === '..' || existsSync(join(cur, part))) { cur = join(cur, part); continue; }
    const hit = existsSync(cur) ? readdirSync(cur).find((e) => nfc(e) === nfc(part)) : undefined;
    if (!hit) throw new CliError(`Dosya bulunamadı: ${name}`);
    cur = join(cur, hit);
  }
  return cur;
}

export function loadFile(abs: string, name: string): LoadedFile {
  const bytes = new Uint8Array(readFileSync(abs));
  try {
    return prepareLoadedFile(name, bytes, decodePng(bytes));
  } catch (e) {
    throw new CliError(`PNG okunamadı: ${name} (${(e as Error).message})`);
  }
}
