import { get, set, del } from 'idb-keyval';
import type { Role } from '../app/store';
import type { Message } from '../../../src/core/pipeline';

/** Kaynak dosyalar: yalnızca dosya listesi değişince yazılır (büyük). */
export interface SavedFiles { files: { name: string; bytes: Uint8Array; role: Role }[] }
/** Belge ve kurulum: her düzenlemede yazılır (küçük). */
export interface SavedDoc {
  packJson: string | null;
  page: { widthMm: number; heightMm: number | null };
  presetId: string;
  messages: Message[];
  dismissed: number[];
  selection: string[];
}

const FILES_KEY = 'stickercut:files';
const DOC_KEY = 'stickercut:doc';
const LEGACY_KEY = 'stickercut:project';

export async function saveFiles(s: SavedFiles): Promise<void> {
  try { await set(FILES_KEY, s); } catch (e) { console.warn('Dosyalar kaydedilemedi', e); throw e; }
}
export async function saveDoc(s: SavedDoc): Promise<void> {
  try { await set(DOC_KEY, s); } catch (e) { console.warn('Belge kaydedilemedi', e); throw e; }
}
export async function load(): Promise<{ files: SavedFiles | undefined; doc: SavedDoc | undefined }> {
  try {
    const [files, doc, legacy] = await Promise.all([get<SavedFiles>(FILES_KEY), get<SavedDoc>(DOC_KEY), get<LegacySaved>(LEGACY_KEY)]);
    if (!files && legacy?.files?.length) return migrateLegacy(legacy);
    return { files, doc };
  } catch { return { files: undefined, doc: undefined }; }
}
export async function clear(): Promise<void> {
  try { await Promise.all([del(FILES_KEY), del(DOC_KEY), del(LEGACY_KEY)]); } catch { /* yok say */ }
}

interface LegacySaved { packJson: string | null; files: { name: string; bytes: Uint8Array; role: Role }[]; page: { widthMm: number; heightMm: number | null }; messages?: Message[] }
function migrateLegacy(l: LegacySaved): { files: SavedFiles; doc: SavedDoc } {
  return {
    files: { files: l.files },
    doc: { packJson: l.packJson, page: l.page, presetId: 'snug', messages: l.messages ?? [], dismissed: [], selection: [] },
  };
}

export function savePrefs(prefs: unknown): void {
  try { localStorage.setItem('stickercut:ui', JSON.stringify(prefs)); } catch { /* yok say */ }
}
