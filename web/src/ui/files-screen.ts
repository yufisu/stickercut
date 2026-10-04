import { state, subscribe, update, type Role } from '../state';
import { addFiles, removeFile, newProject, place, scheduleAutosave } from '../project-io';
import { esc } from './html';

const ROLE_LABELS: [Role, string][] = [['design', 'Tam tasarım'], ['background', 'Arka plan'], ['sticker', 'Sticker'], ['ignore', 'Yok say']];

export function mountFiles(root: HTMLElement): () => void {
  root.innerHTML = `
    <main class="files">
      <header class="files-header">
        <h1>stickercut</h1>
        <button id="restart" type="button" class="danger">Baştan başla</button>
      </header>
      <p class="lead">Tam tasarım, arka plan ve sticker PNG’lerini seç. Daha önce dışa aktardığın bir proje .zip’ini de açabilirsin.</p>
      <div class="drop" id="drop">
        <input type="file" id="picker" multiple accept=".png,.PNG,image/png,.zip,application/zip" hidden />
        <button id="browse" type="button">Dosya seç</button>
        <span>ya da buraya sürükle</span>
      </div>
      <p id="fileSummary" class="file-summary" aria-live="polite"></p>
      <section class="page">
        <label>Tam tasarım<select id="designPick" aria-label="Tam tasarım dosyası"></select></label>
        <label>Arka plan<select id="backgroundPick" aria-label="Arka plan dosyası"></select></label>
      </section>
      <section id="list" class="list"></section>
      <section class="page">
        <label>Sayfa genişliği (mm)<input id="pw" type="number" step="0.1" min="1" /></label>
        <label>Sayfa yüksekliği (mm)<input id="ph" type="number" step="0.1" min="1" placeholder="otomatik" /></label>
      </section>
      <ul id="msgs" class="msgs"></ul>
      <button id="place" class="primary">Yerleştir</button>
      <p id="busy" class="busy" role="status"></p>
    </main>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const drop = $('#drop'), picker = $<HTMLInputElement>('#picker'), list = $('#list');
  const pw = $<HTMLInputElement>('#pw'), ph = $<HTMLInputElement>('#ph');
  pw.value = String(state.page.widthMm);
  ph.value = state.page.heightMm ? String(state.page.heightMm) : '';

  const rolesResolved = () => {
    const files = [...state.files.values()];
    const design = files.find((f) => f.role === 'design');
    const background = files.find((f) => f.role === 'background');
    if (design && background && design.name !== background.name && design.width === background.width && design.height === background.height) {
      state.messages = state.messages.filter((m) => m.code !== 'ROLES');
    }
  };

  for (const [id, role] of [['designPick', 'design'], ['backgroundPick', 'background']] as const) {
    $<HTMLSelectElement>(`#${id}`).addEventListener('change', (e) => {
      const name = (e.target as HTMLSelectElement).value;
      const selected = state.files.get(name);
      if (state.busy) return;
      update((s) => {
        const former = [...s.files.values()].find((f) => f.role === role);
        if (!selected) {
          if (former) former.role = 'ignore';
          rolesResolved();
          return;
        }
        const opposite = role === 'design' ? 'background' : 'design';
        if (former) former.role = selected.role === opposite ? opposite : 'ignore';
        selected.role = role;
        rolesResolved();
      });
      scheduleAutosave();
    });
  }

  $('#browse').addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => { if (picker.files?.length) void addFiles([...picker.files]); picker.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (!state.busy && e.dataTransfer?.files.length) void addFiles([...e.dataTransfer.files]);
  });
  pw.addEventListener('change', () => { if (Number(pw.value) > 0) { state.page.widthMm = Number(pw.value); scheduleAutosave(); } });
  ph.addEventListener('change', () => { state.page.heightMm = Number(ph.value) > 0 ? Number(ph.value) : null; scheduleAutosave(); });
  list.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    const f = state.files.get(sel.dataset.name ?? '');
    if (!f || state.busy) return;
    const role = sel.value as Role;
    update((s) => {
      if (role === 'design' || role === 'background') for (const o of s.files.values()) if (o.role === role) o.role = 'ignore';
      f.role = role;
      rolesResolved();
    });
    scheduleAutosave();
  });
  list.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
    if (button) void removeFile(button.dataset.remove!);
  });
  $('#restart').addEventListener('click', () => void newProject());
  $('#place').addEventListener('click', () => void place());

  const render = () => {
    // update() snapshots listeners before calling them; if an earlier listener in the same
    // batch (main.ts's screen router) already unmounted this screen, our cached elements are
    // detached and must not be touched.
    if (!list.isConnected) return;
    const files = [...state.files.values()];
    pw.value = String(state.page.widthMm);
    ph.value = state.page.heightMm ? String(state.page.heightMm) : '';
    $('#fileSummary').textContent = files.length ? `${files.length} dosya seçildi. Yanlış dosyaları kaldırabilir veya baştan başlayabilirsin.` : '';
    $('#browse').textContent = files.length ? 'Dosya ekle' : 'Dosya seç';
    const choices = `<option value="">Seç</option>${files.map((f) => `<option value="${esc(f.name)}">${esc(f.name)} (${f.width}×${f.height})</option>`).join('')}`;
    for (const [id, role] of [['designPick', 'design'], ['backgroundPick', 'background']] as const) {
      const select = $<HTMLSelectElement>(`#${id}`);
      select.innerHTML = choices;
      select.value = files.find((f) => f.role === role)?.name ?? '';
    }
    list.innerHTML = files.map((f) => `
      <div class="row">
        <canvas width="112" height="112" data-thumb="${esc(f.name)}"></canvas>
        <span class="name">${esc(f.name)}</span>
        <span class="dim">${f.width}×${f.height}</span>
        <select data-name="${esc(f.name)}" aria-label="${esc(f.name)} dosyasının rolü">${ROLE_LABELS.map(([r, l]) => `<option value="${r}"${r === f.role ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="danger" data-remove="${esc(f.name)}" aria-label="${esc(f.name)} dosyasını kaldır">Kaldır</button>
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
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')) {
      control.disabled = !!state.busy;
    }
    drop.setAttribute('aria-disabled', String(!!state.busy));
    $<HTMLButtonElement>('#restart').disabled = !!state.busy || !files.length;
    const design = files.find((f) => f.role === 'design'), background = files.find((f) => f.role === 'background');
    $<HTMLButtonElement>('#place').disabled = !!state.busy || !design || !background || design.width !== background.width || design.height !== background.height;
  };
  render();
  return subscribe(render);
}
