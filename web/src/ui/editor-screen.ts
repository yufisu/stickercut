import { state, subscribe, update } from '../state';
import { commit, addStickerItem, addNewPng, exportPdf, exportZip, newProject, visibleMessages } from '../project-io';
import { CanvasView } from './canvas-view';
import { esc } from './html';

export function mountEditor(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="editor">
      <div class="stage-wrap" id="stage"></div>
      <aside class="panel">
        <div id="settings"></div>
        <section><h2>Uyarılar</h2><ul id="warnings" class="msgs"></ul></section>
        <section class="actions">
          <button id="pdf" class="primary">PDF oluştur</button>
          <button id="zip">Projeyi dışa aktar (.zip)</button>
          <button id="new" class="danger">Yeni proje</button>
        </section>
      </aside>
    </div>
    <div class="busy-overlay" id="busy"></div>
    <input type="file" id="addPick" accept=".png,.PNG,image/png" hidden />`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const settings = $('#settings');
  const view = new CanvasView($('#stage'), () => { commit(); renderSettings(); }, () => renderSettings());

  function renderSettings(): void {
    const pack = state.pack;
    if (!pack) return;
    const d = pack.defaults;
    const item = pack.items.find((i) => i.id === state.selectedId);
    const stickers = [...state.files.values()].filter((f) => f.name !== pack.files.design && f.name !== pack.files.background);
    const opts = (sel?: string) => stickers.map((f) => `<option value="${esc(f.name)}"${f.name === sel ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
    const wb = item?.overrides.whiteBorder;
    settings.innerHTML = `
      <section><h2>Sayfa</h2><div class="grid2">
        <label>Genişlik (mm)<input data-k="page.widthMm" type="number" step="0.1" min="1" value="${pack.page.widthMm}"></label>
        <label>Yükseklik (mm)<input data-k="page.heightMm" type="number" step="0.1" min="1" value="${pack.page.heightMm}"></label>
      </div></section>
      <section><h2>Genel ayarlar</h2>
        <div class="grid2">
          <label>Offset (mm)<input data-k="d.offsetMm" type="number" step="0.1" min="0" value="${d.offsetMm}"></label>
          <label>Çizgi (pt)<input data-k="d.strokeWidthPt" type="number" step="0.05" min="0.05" value="${d.strokeWidthPt}"></label>
        </div>
        <label>Yumuşatma<input data-k="d.smoothing" type="range" min="0" max="1" step="0.05" value="${d.smoothing}"></label>
        <label class="check"><input data-k="d.whiteBorder" type="checkbox"${d.whiteBorder ? ' checked' : ''}> Beyaz kenar</label>
        <label class="check"><input data-k="showCuts" type="checkbox"${state.showCuts ? ' checked' : ''}> Kesim çizgilerini göster</label>
      </section>
      ${item ? `
      <section><h2>Seçili sticker (${esc(item.id)})</h2>
        <label>Dosya<select data-k="i.file">${opts(item.file)}</select></label>
        <div class="grid2">
          <label>Offset (mm)<input data-k="i.offsetMm" type="number" step="0.1" min="0" placeholder="varsayılan (${d.offsetMm})" value="${item.overrides.offsetMm ?? ''}"></label>
          <label>Döndürme (°)<input data-k="i.rotationDeg" type="number" step="1" value="${item.rotationDeg}"></label>
        </div>
        <label>Beyaz kenar<select data-k="i.whiteBorder">
          <option value=""${wb === undefined ? ' selected' : ''}>Varsayılan</option>
          <option value="1"${wb === true ? ' selected' : ''}>Açık</option>
          <option value="0"${wb === false ? ' selected' : ''}>Kapalı</option>
        </select></label>
        <label class="check"><input data-k="i.printOnly" type="checkbox"${item.printOnly ? ' checked' : ''}> Sadece baskı (kesim çizgisi yok)</label>
        ${item.needsReview ? '<button data-act="approve">Yeri doğru, onayla</button>' : ''}
        <button data-act="delete" class="danger">Sil</button>
      </section>` : '<p class="lead">Düzenlemek için bir sticker’a dokun.</p>'}
      <section><h2>Sticker ekle</h2>
        <select id="addFile">${opts()}</select>
        <button data-act="add">Seçili sticker’ı ekle</button>
        <button data-act="addNew">Yeni PNG yükle ve ekle</button>
      </section>`;
  }

  function renderStatus(): void {
    const all = [...visibleMessages(), ...state.cutMessages];
    $('#warnings').innerHTML = all.length
      ? all.map((m) => `<li class="${m.level}"${m.itemId ? ` data-item="${esc(m.itemId)}"` : ''}>${esc(m.text)}</li>`).join('')
      : '<li class="info">Sorun yok.</li>';
    $('#busy').textContent = state.busy ?? '';
    for (const b of root.querySelectorAll<HTMLButtonElement>('.actions button')) b.disabled = !!state.busy;
  }

  // root (#app) ekranlar arasında kalıcı; dinleyiciler unmount'ta kaldırılmalı
  const ac = new AbortController();
  function applySetting(el: HTMLInputElement | HTMLSelectElement, redrawFields: boolean): void {
    const k = el.dataset.k;
    const pack = state.pack;
    if (!k || !pack) return;
    const item = pack.items.find((i) => i.id === state.selectedId);
    const n = Number(el.value);
    switch (k) {
      case 'page.widthMm': if (n > 0) pack.page.widthMm = n; else return; break;
      case 'page.heightMm': if (n > 0) pack.page.heightMm = n; else return; break;
      case 'd.offsetMm': if (el.value !== '' && n >= 0) pack.defaults.offsetMm = n; else return; break;
      case 'd.strokeWidthPt': if (n > 0) pack.defaults.strokeWidthPt = n; else return; break;
      case 'd.smoothing': if (n >= 0 && n <= 1) pack.defaults.smoothing = n; else return; break;
      case 'd.whiteBorder': pack.defaults.whiteBorder = (el as HTMLInputElement).checked; break;
      case 'showCuts': update((s) => { s.showCuts = (el as HTMLInputElement).checked; }); return;
      case 'i.file': if (item) item.file = el.value; break;
      case 'i.offsetMm':
        if (item) { if (el.value === '') delete item.overrides.offsetMm; else item.overrides.offsetMm = Math.max(0, n || 0); }
        break;
      case 'i.rotationDeg': if (item && el.value !== '' && Number.isFinite(n)) item.rotationDeg = n; else return; break;
      case 'i.whiteBorder':
        if (item) { if (el.value === '') delete item.overrides.whiteBorder; else item.overrides.whiteBorder = el.value === '1'; }
        break;
      case 'i.printOnly': if (item) item.printOnly = (el as HTMLInputElement).checked; break;
      default: return;
    }
    commit();
    if (redrawFields) renderSettings();
  }

  // Number/range changes must update the preview while the user is typing or sliding.
  // Rebuilding the fields on each keystroke would discard focus and partially typed values.
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k && (el.type === 'number' || el.type === 'range')) applySetting(el, false);
  }, { signal: ac.signal });
  root.addEventListener('change', (e) => {
    applySetting(e.target as HTMLInputElement | HTMLSelectElement, true);
  }, { signal: ac.signal });

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pack = state.pack;
    if (!pack) return;
    const warning = t.closest<HTMLElement>('li[data-item]');
    if (warning) { state.selectedId = warning.dataset.item!; renderSettings(); view.draw(); return; }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const item = pack.items.find((i) => i.id === state.selectedId);
    if (act === 'approve' && item) { item.needsReview = false; commit(); renderSettings(); }
    if (act === 'delete' && item) { pack.items = pack.items.filter((i) => i !== item); state.selectedId = null; commit(); renderSettings(); }
    if (act === 'add') { const v = $<HTMLSelectElement>('#addFile').value; if (v) { addStickerItem(v); renderSettings(); } }
    if (act === 'addNew') $<HTMLInputElement>('#addPick').click();
  }, { signal: ac.signal });

  $<HTMLInputElement>('#addPick').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) { await addNewPng(f); renderSettings(); }
  });
  $('#pdf').addEventListener('click', () => void exportPdf());
  $('#zip').addEventListener('click', () => void exportZip());
  let armed = 0;
  $('#new').addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    if (Date.now() - armed < 3000) { void newProject(); return; }
    armed = Date.now();
    b.textContent = 'Emin misin? Tekrar dokun';
    setTimeout(() => { b.textContent = 'Yeni proje'; }, 3000);
  });

  renderSettings();
  renderStatus();
  view.draw();
  const unsub = subscribe(() => { renderStatus(); view.draw(); });
  return () => { ac.abort(); unsub(); view.destroy(); };
}
