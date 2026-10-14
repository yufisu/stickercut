import { store, screen } from '../app/store';
import { undo, redo, selectAll, clearSelection, deleteSelected, duplicateSelected, nudge, reorder } from '../app/actions/edit';
import { exportPdf, exportZip } from '../app/actions/export';
import { savePrefs } from '../app/actions/autosave';
import { editorApi } from '../app/editor-api';
import type { Tool, ViewMode } from '../app/store';

const inField = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, select, textarea, [contenteditable="true"]');

/** Küresel klavye kısayolları; giriş alanlarında yalnızca Esc çalışır. */
export function bindShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (store.shortcutsOpen.value) { store.shortcutsOpen.value = false; return; }
      if (store.layersOpen.value) { store.layersOpen.value = false; return; }
      if (inField(e.target)) { (e.target as HTMLElement).blur(); return; }
      if (store.gesture.value) return; // denetleyici kendisi iptal eder
      if (store.measure.value) { store.measure.value = null; return; }
      if (store.selection.value.size) clearSelection();
      return;
    }
    if (inField(e.target)) return;
    if (e.key === '?' ) { e.preventDefault(); store.shortcutsOpen.value = !store.shortcutsOpen.value; return; }
    if (screen.value !== 'editor' || !store.doc.value) return;
    const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
    if (mod && !e.altKey) {
      if (key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (key === 'y' && !e.metaKey) { e.preventDefault(); redo(); return; }
      if (key === 'a') { e.preventDefault(); selectAll(); return; }
      if (key === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (key === 'e') { e.preventDefault(); void (e.shiftKey ? exportZip() : exportPdf()); return; }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') { e.preventDefault(); editorApi.zoomBy(1.25); return; }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') { e.preventDefault(); editorApi.zoomBy(1 / 1.25); return; }
      if (e.code === 'Digit0') { e.preventDefault(); editorApi.fit(); return; }
      if (e.code === 'Digit1') { e.preventDefault(); editorApi.actualSize(); return; }
      if (e.code === 'Digit2') { e.preventDefault(); editorApi.zoomToSelection(); return; }
      if (e.code === 'BracketRight' || e.code === 'BracketLeft') {
        e.preventDefault();
        const id = [...store.selection.value].pop();
        if (id) reorder(id, e.code === 'BracketRight' ? (e.shiftKey ? 'top' : 'up') : (e.shiftKey ? 'bottom' : 'down'));
        return;
      }
      return;
    }
    if (e.altKey && !mod && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
      e.preventDefault();
      store.viewMode.value = ({ Digit1: 'edit', Digit2: 'cut', Digit3: 'print' } as Record<string, ViewMode>)[e.code];
      return;
    }
    if (e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { if (store.selection.value.size) { e.preventDefault(); deleteSelected(); } return; }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 1 : 0.1;
      nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
      return;
    }
    const tools: Record<string, Tool> = { v: 'select', h: 'pan', a: 'add', r: 'region', m: 'measure' };
    if (!e.shiftKey && tools[key]) { store.tool.value = tools[key]; return; }
    const prefs = store.prefs.value;
    if (key === 'g' && !e.shiftKey) { store.prefs.value = { ...prefs, grid: !prefs.grid }; savePrefs(); return; }
    if (key === 'r' && e.shiftKey) { store.prefs.value = { ...prefs, rulers: !prefs.rulers }; savePrefs(); return; }
    if (key === 'c' && e.shiftKey) { store.prefs.value = { ...prefs, showCuts: !prefs.showCuts }; savePrefs(); return; }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
