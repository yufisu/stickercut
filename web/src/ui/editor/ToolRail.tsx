import { store, type Tool } from '../../app/store';
import { undo, redo } from '../../app/actions/edit';
import { savePrefs } from '../../app/actions/autosave';
import { Icon, type IconName } from '../shared/Icon';
import { MOD, SHIFT } from '../../platform/env';

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'select', icon: 'select', label: 'Seç ve taşı', key: 'V' },
  { id: 'pan', icon: 'pan', label: 'Gez', key: 'H' },
  { id: 'add', icon: 'add', label: 'Sticker ekle (tuvale dokun)', key: 'A' },
  { id: 'region', icon: 'region', label: 'Bölge çiz (eşleşmeyen çizim için)', key: 'R' },
  { id: 'measure', icon: 'measure', label: 'Ölçü', key: 'M' },
];

export function ToolRail() {
  const tool = store.tool.value, prefs = store.prefs.value;
  const toggle = (k: 'grid' | 'rulers' | 'showCuts') => { store.prefs.value = { ...prefs, [k]: !prefs[k] }; savePrefs(); };
  return (
    <div class="rail" role="toolbar" aria-label="Araçlar" aria-orientation="vertical">
      <div class="brand" aria-hidden="true">S</div>
      {TOOLS.map((t) => (
        <button key={t.id} type="button" class="tool" aria-pressed={tool === t.id} aria-label={t.label} title={`${t.label} (${t.key})`} onClick={() => { store.tool.value = t.id; }}>
          <Icon name={t.icon} size={20} />
        </button>
      ))}
      <div class="sep" />
      <button type="button" class="tool" aria-label="Geri al" title={`Geri al (${MOD} Z)`} disabled={!store.canUndo.value} onClick={undo}><Icon name="undo" size={20} /></button>
      <button type="button" class="tool" aria-label="Yinele" title={`Yinele (${MOD} ${SHIFT} Z)`} disabled={!store.canRedo.value} onClick={redo}><Icon name="redo" size={20} /></button>
      <div class="sep" />
      <button type="button" class="tool" aria-pressed={prefs.showCuts} aria-label="Kesim çizgilerini göster" title={`Kesim çizgileri (${SHIFT} C)`} onClick={() => toggle('showCuts')}><Icon name="cut" size={20} /></button>
      <button type="button" class="tool" aria-pressed={prefs.grid} aria-label="Izgara" title="Izgara (G)" onClick={() => toggle('grid')}><Icon name="grid" size={20} /></button>
      <button type="button" class="tool wide-only" aria-pressed={prefs.rulers} aria-label="Cetveller" title={`Cetveller (${SHIFT} R)`} onClick={() => toggle('rulers')}><Icon name="ruler" size={20} /></button>
      <div class="spacer" />
      <button type="button" class="tool compact-only" aria-pressed={store.layersOpen.value} aria-label="Katmanlar" title="Katmanlar" onClick={() => { store.layersOpen.value = !store.layersOpen.value; }}><Icon name="layers" size={20} /></button>
      <button type="button" class="tool compact-only" aria-label="Denetçi" title="Ayarlar" onClick={() => { store.sheetDetent.value = store.sheetDetent.value === 'peek' ? 'half' : 'peek'; }}><Icon name="more" size={20} /></button>
      <button type="button" class="tool wide-only" aria-label="Klavye kısayolları" title="Kısayollar (?)" onClick={() => { store.shortcutsOpen.value = true; }}><Icon name="keyboard" size={20} /></button>
    </div>
  );
}
