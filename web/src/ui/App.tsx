import { screen } from '../app/store';
import { SetupScreen } from './setup/SetupScreen';
import { EditorScreen } from './editor/EditorScreen';
import { JobOverlay, Toasts, ShortcutsDialog } from './shared/overlays';

export function App() {
  return (
    <>
      {screen.value === 'setup' ? <SetupScreen /> : <EditorScreen />}
      <JobOverlay />
      <Toasts />
      <ShortcutsDialog />
    </>
  );
}
