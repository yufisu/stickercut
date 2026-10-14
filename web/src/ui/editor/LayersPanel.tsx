import { useEffect, useRef, useState } from 'preact/hooks';
import { store, itemStatus, busy } from '../../app/store';
import { select, reorder, setItemFields, itemBounds, addStickerItem } from '../../app/actions/edit';
import { addNewPng } from '../../app/actions/files';
import { editorApi } from '../../app/editor-api';
import { STATUS_LABEL } from '../../app/status';
import { itemLabel, mmPerDesignPx, isRegionItem, type Item } from '../../../../src/core/project';
import { Icon } from '../shared/Icon';
import { Thumb, Select } from '../shared/controls';

function RegionThumb({ item }: { item: Item }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const design = store.doc.value ? store.files.value.get(store.doc.value.files.design) : undefined;
  useEffect(() => {
    const c = ref.current;
    if (!c || !design || !isRegionItem(item)) return;
    const { bbox } = item.region, doc = store.doc.value!;
    const k = design.bitmap.width / doc.designSize.widthPx;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = 36 * dpr; c.height = 36 * dpr;
    const g = c.getContext('2d')!;
    const s = Math.min(c.width / (bbox.w * k), c.height / (bbox.h * k));
    g.drawImage(design.bitmap, bbox.x * k, bbox.y * k, bbox.w * k, bbox.h * k, (c.width - bbox.w * k * s) / 2, (c.height - bbox.h * k * s) / 2, bbox.w * k * s, bbox.h * k * s);
  }, [item, design]);
  return <canvas ref={ref} style={{ width: '36px', height: '36px' }} aria-hidden="true" />;
}

function LayerRow({ item, index, total }: { item: Item; index: number; total: number }) {
  const doc = store.doc.value!;
  const selected = store.selection.value.has(item.id);
  const status = itemStatus.value.get(item.id) ?? 'pending';
  const file = item.file === null ? undefined : store.files.value.get(item.file);
  const mm = mmPerDesignPx(doc);
  const b = itemBounds(item);
  const size = b ? `${((b.maxX - b.minX) * mm.x).toFixed(1)} × ${((b.maxY - b.minY) * mm.y).toFixed(1)} mm` : '';
  return (
    <div
      class="layer" role="option" aria-selected={selected} tabIndex={0}
      onClick={(e) => select([item.id], e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace')}
      onDblClick={() => editorApi.focusItem(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') editorApi.focusItem(item.id); }}
    >
      {file ? <Thumb bitmap={file.thumb} size={36} /> : <RegionThumb item={item} />}
      <div>
        <div class="name">{itemLabel(item)}</div>
        <div class="size num">{size}</div>
      </div>
      <span class={`badge ${status}`}>{STATUS_LABEL[status]}</span>
      <div class="tools">
        <button type="button" class="btn quiet" title={item.printOnly ? 'Kesim çizgisi ekle' : 'Sadece baskı (kesim yok)'} aria-label={item.printOnly ? 'Kesim çizgisi ekle' : 'Sadece baskı'} onClick={(e) => { e.stopPropagation(); setItemFields([item.id], { printOnly: !item.printOnly }); }}>
          <Icon name={item.printOnly ? 'eyeOff' : 'cut'} size={15} />
        </button>
        <button type="button" class="btn quiet" title="Öne" aria-label="Öne" disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); reorder(item.id, 'up'); }}><Icon name="up" size={15} /></button>
        <button type="button" class="btn quiet" title="Arkaya" aria-label="Arkaya" disabled={index === 0} onClick={(e) => { e.stopPropagation(); reorder(item.id, 'down'); }}><Icon name="down" size={15} /></button>
      </div>
    </div>
  );
}

export function AddStickerControl() {
  const doc = store.doc.value;
  const pick = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState('');
  if (!doc) return null;
  const stickers = [...store.files.value.values()].filter((f) => f.name !== doc.files.design && f.name !== doc.files.background);
  const options = [{ value: '', label: 'Yüklü sticker seç…' }, ...stickers.map((f) => ({ value: f.name, label: f.name }))];
  return (
    <div class="row" style={{ display: 'flex', gap: '6px' }}>
      <Select class="sm" value={file} options={options} ariaLabel="Eklenecek sticker" onChange={setFile} />
      <button type="button" class="btn sm" disabled={!file || busy.value} onClick={() => { if (file) addStickerItem(file); }}>Ekle</button>
      <input ref={pick} type="file" accept=".png,.PNG,image/png" hidden onChange={() => { const f = pick.current?.files?.[0]; if (pick.current) pick.current.value = ''; if (f) void addNewPng(f); }} />
      <button type="button" class="btn sm" disabled={busy.value} onClick={() => pick.current?.click()} title="Yeni PNG yükle ve ekle"><Icon name="plus" size={14} /> Yeni PNG</button>
    </div>
  );
}

export function LayersPanel({ embedded }: { embedded?: boolean }) {
  const doc = store.doc.value;
  const [collapsed, setCollapsed] = useState(false);
  if (!doc) return null;
  store.cutsVersion.value;
  const items = [...doc.items].reverse(); // üstteki en önde
  return (
    <section class={`layers${collapsed && !embedded ? ' collapsed' : ''}`} aria-label="Katmanlar">
      <div class="layers-head">
        <h2>Katmanlar <span class="muted small num">{doc.items.length}</span></h2>
        <AddStickerControl />
        {!embedded ? <button type="button" class="btn quiet icon-btn" aria-label={collapsed ? 'Katmanları aç' : 'Katmanları daralt'} onClick={() => setCollapsed(!collapsed)}><Icon name={collapsed ? 'chevronUp' : 'chevronDown'} size={16} /></button> : null}
        {embedded ? <button type="button" class="btn quiet icon-btn" aria-label="Kapat" onClick={() => { store.layersOpen.value = false; }}><Icon name="close" size={16} /></button> : null}
      </div>
      {!collapsed || embedded ? (
        <div class="layers-list" role="listbox" aria-multiselectable="true" aria-label="Sticker listesi">
          {items.map((item, i) => <LayerRow key={item.id} item={item} index={doc.items.length - 1 - i} total={doc.items.length} />)}
        </div>
      ) : null}
    </section>
  );
}
