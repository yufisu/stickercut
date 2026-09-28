import './style.css';
import { state, subscribe } from './state';
import { restore } from './project-io';
import { mountFiles } from './ui/files-screen';
import { mountEditor } from './ui/editor-screen';

type AppScreen = typeof state.screen;
const app = document.getElementById('app')!;
let current: AppScreen | null = null;
let unmount: (() => void) | null = null;

function render(): void {
  if (state.screen === current) return;
  unmount?.();
  current = state.screen;
  unmount = current === 'files' ? mountFiles(app) : mountEditor(app);
}

subscribe(render);
void restore().finally(render);
