import { store, warningCount, selectedItems } from '../../app/store';
import { itemBounds } from '../../app/actions/edit';
import { mmPerDesignPx } from '../../../../src/core/project';

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

export function StatusBar() {
  const doc = store.doc.value;
  if (!doc) return null;
  const mm = mmPerDesignPx(doc);
  const cursor = store.cursorMm.value;
  const sel = selectedItems.value;
  const counts = warningCount.value;
  store.cutsVersion.value;
  let selText = '';
  if (sel.length) {
    const bs = sel.map(itemBounds).filter((b): b is NonNullable<typeof b> => !!b);
    if (bs.length) {
      const minX = Math.min(...bs.map((b) => b.minX)), maxX = Math.max(...bs.map((b) => b.maxX)), minY = Math.min(...bs.map((b) => b.minY)), maxY = Math.max(...bs.map((b) => b.maxY));
      selText = `${sel.length > 1 ? `${sel.length} öğe · ` : ''}${f1((maxX - minX) * mm.x)} × ${f1((maxY - minY) * mm.y)} mm`;
    }
  }
  const cutCount = doc.items.filter((i) => !i.printOnly).length;
  const pending = doc.items.filter((i) => !i.printOnly && !store.cuts.has(i.id)).length;
  return (
    <div class="status" role="status" aria-live="off">
      <span><b class="num">{Math.round(store.camera.value.zoom * 100)}%</b></span>
      <span class="num">{cursor ? `x ${f1(cursor.x)}  y ${f1(cursor.y)} mm` : ''}</span>
      {selText ? <span class="num">{selText}</span> : null}
      <span class="spacer" />
      <span class="num">{doc.page.widthMm} × {doc.page.heightMm} mm · {cutCount} kesim{pending ? ` · ${pending} hesaplanıyor` : ''}</span>
      {counts.errors ? <span class="err">{counts.errors} hata</span> : null}
      {counts.warnings ? <span class="warn">{counts.warnings} kontrol</span> : null}
      {!counts.errors && !counts.warnings && !pending ? <span class="ok">Baskıya hazır</span> : null}
    </div>
  );
}
