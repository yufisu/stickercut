import { state, subscribe, update, type Role } from '../state';
import { addFiles, place, scheduleAutosave } from '../project-io';
import { esc } from './html';

const ROLE_LABELS: [Role, string][] = [['design', 'Tam tasarım'], ['background', 'Arka plan'], ['sticker', 'Sticker'], ['ignore', 'Yok say']];

export function mountFiles(root: HTMLElement): () => void {
  root.innerHTML = `
    <main class="files">
      <h1>stickercut</h1>
      <p class="lead">Tam tasarım, arka plan ve sticker PNG’lerini seç. Daha önce dışa aktardığın bir proje .zip’ini de açabilirsin.</p>
      <label class="drop" id="drop">
        <input type="file" id="picker" multiple accept=".png,.PNG,image/png,.zip,application/zip" hidden />
        <span>Dosya seç ya da buraya sürükle</span>
      </label>
      <section id="list" class="list"></section>
      <section class="page">
        <label>Sayfa genişliği (mm)<input id="pw" type="number" step="0.1" min="1" /></label>
        <label>Sayfa yüksekliği (mm)<input id="ph" type="number" step="0.1" min="1" placeholder="otomatik" /></label>
      </section>
      <ul id="msgs" class="msgs"></ul>
      <button id="place" class="primary">Yerleştir</button>
      <p id="busy" class="busy"></p>
    </main>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const drop = $('#drop'), picker = $<HTMLInputElement>('#picker'), list = $('#list');
  const pw = $<HTMLInputElement>('#pw'), ph = $<HTMLInputElement>('#ph');
  pw.value = String(state.page.widthMm);
  ph.value = state.page.heightMm ? String(state.page.heightMm) : '';

  picker.addEventListener('change', () => { if (picker.files?.length) void addFiles([...picker.files]); picker.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files.length) void addFiles([...e.dataTransfer.files]);
  });
  pw.addEventListener('change', () => { if (Number(pw.value) > 0) { state.page.widthMm = Number(pw.value); scheduleAutosave(); } });
  ph.addEventListener('change', () => { state.page.heightMm = Number(ph.value) > 0 ? Number(ph.value) : null; scheduleAutosave(); });
  list.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    const f = state.files.get(sel.dataset.name ?? '');
    if (!f) return;
    const role = sel.value as Role;
    update((s) => {
      if (role === 'design' || role === 'background') for (const o of s.files.values()) if (o.role === role) o.role = 'ignore';
      f.role = role;
    });
    scheduleAutosave();
  });
  $('#place').addEventListener('click', () => void place());

  const render = () => {
    // update() snapshots listeners before calling them; if an earlier listener in the same
    // batch (main.ts's screen router) already unmounted this screen, our cached elements are
    // detached and must not be touched.
    if (!list.isConnected) return;
    const files = [...state.files.values()];
    list.innerHTML = files.map((f) => `
      <div class="row">
        <canvas width="112" height="112" data-thumb="${esc(f.name)}"></canvas>
        <span class="name">${esc(f.name)}</span>
        <span class="dim">${f.width}×${f.height}</span>
        <select data-name="${esc(f.name)}">${ROLE_LABELS.map(([r, l]) => `<option value="${r}"${r === f.role ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </div>`).join('');
    for (const c of list.querySelectorAll<HTMLCanvasElement>('canvas[data-thumb]')) {
      const f = state.files.get(c.dataset.thumb!);
      if (!f) continue;
      const g = c.getContext('2d')!;
      const k = Math.min(112 / f.bitmap.width, 112 / f.bitmap.height);
      g.drawImage(f.bitmap, (112 - f.bitmap.width * k) / 2, (112 - f.bitmap.height * k) / 2, f.bitmap.width * k, f.bitmap.height * k);
    }
    $('#msgs').innerHTML = state.messages.map((m) => `<li class="${m.level}">${esc(m.text)}</li>`).join('');
    $('#busy').textContent = state.busy ?? '';
    $<HTMLButtonElement>('#place').disabled = !!state.busy || !files.some((f) => f.role === 'design') || !files.some((f) => f.role === 'background');
  };
  render();
  return subscribe(render);
}
