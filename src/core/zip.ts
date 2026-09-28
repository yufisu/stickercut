import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { nfc } from './project';

export function packToZip(packJson: string, files: Map<string, Uint8Array>): Uint8Array {
  const entries: Zippable = { 'pack.json': [strToU8(packJson), { level: 6 }] };
  for (const [name, bytes] of files) entries[nfc(name)] = [bytes, { level: 0 }];
  return zipSync(entries);
}

export function zipToPack(zip: Uint8Array): { packJson: string; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  let packJson: string | null = null;
  for (const [raw, bytes] of Object.entries(unzipSync(zip))) {
    const name = nfc(raw);
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    if (name === 'pack.json') packJson = strFromU8(bytes);
    else files.set(name, bytes);
  }
  if (packJson === null) throw new Error('Zip’te pack.json yok.');
  return { packJson, files };
}
