import type { Pack } from '../../src/core/project';
import type { Message } from '../../src/core/pipeline';
import type { Pt } from '../../src/core/geometry';

export type Role = 'design' | 'background' | 'sticker' | 'ignore';
export interface FileEntry { name: string; bytes: Uint8Array; width: number; height: number; bitmap: ImageBitmap; role: Role }
export interface AppState {
  screen: 'files' | 'editor';
  files: Map<string, FileEntry>;
  pack: Pack | null;
  cuts: Map<string, Pt[]>;
  messages: Message[];
  cutMessages: Message[];
  selectedId: string | null;
  showCuts: boolean;
  busy: string | null;
  page: { widthMm: number; heightMm: number | null };
}

export const state: AppState = {
  screen: 'files', files: new Map(), pack: null, cuts: new Map(), messages: [], cutMessages: [],
  selectedId: null, showCuts: true, busy: null, page: { widthMm: 80, heightMm: null },
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function update(mut?: (s: AppState) => void): void {
  mut?.(state);
  for (const l of [...listeners]) l();
}
