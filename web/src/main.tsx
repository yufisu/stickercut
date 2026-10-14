import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import { render } from 'preact';
import { effect } from '@preact/signals';
import { App } from './ui/App';
import { store } from './app/store';
import { applyTheme } from './platform/theme';
import { bindShortcuts } from './platform/shortcuts';
import { restore } from './app/actions/files';

if (import.meta.env.DEV) (window as unknown as { __store: typeof store }).__store = store; // geliştirme: konsoldan mağazaya bak
effect(() => applyTheme(store.prefs.value.theme));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.prefs.value.theme));
bindShortcuts();
render(<App />, document.getElementById('app')!);
void restore();
