import { store } from '../../app/store';
import { savePrefs } from '../../app/actions/autosave';
import { IconButton } from './controls';

/** sistem → açık → koyu döngüsü. */
export function ThemeToggle() {
  const theme = store.prefs.value.theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const label = theme === 'system' ? 'Tema: sistem' : theme === 'light' ? 'Tema: açık' : 'Tema: koyu';
  return <IconButton class="quiet" icon={dark ? 'moon' : 'sun'} label={`${label} (değiştir)`} onClick={() => { store.prefs.value = { ...store.prefs.value, theme: next }; savePrefs(); }} />;
}
