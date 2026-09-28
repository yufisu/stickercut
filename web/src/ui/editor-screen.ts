import { state } from '../state';

export function mountEditor(root: HTMLElement): () => void {
  root.innerHTML = `<p style="padding:16px">${state.pack?.items.length ?? 0} sticker yerleştirildi.</p>`;
  return () => {};
}
