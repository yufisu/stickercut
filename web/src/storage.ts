import { get, set, del } from 'idb-keyval';
import type { Role } from './state';
import type { Message } from '../../src/core/pipeline';

export interface Saved {
  packJson: string | null;
  files: { name: string; bytes: Uint8Array; role: Role }[];
  page: { widthMm: number; heightMm: number | null };
  messages?: Message[];
}
const KEY = 'stickercut:project';

export async function save(s: Saved): Promise<void> {
  try { await set(KEY, s); } catch (e) { console.warn('Otomatik kayıt başarısız', e); }
}
export async function load(): Promise<Saved | undefined> {
  try { return await get<Saved>(KEY); } catch { return undefined; }
}
export async function clear(): Promise<void> {
  try { await del(KEY); } catch { /* yok say */ }
}
