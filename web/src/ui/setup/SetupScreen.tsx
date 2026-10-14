import { useRef, useState } from 'preact/hooks';
import { store, busy, type FileEntry, type Role } from '../../app/store';
import { addFiles, removeFile, setRole, newProject } from '../../app/actions/files';
import { place } from '../../app/actions/placement';
import { scheduleDocSave } from '../../app/actions/autosave';
import { loadSamplePack } from '../../app/sample-pack';
import { CUT_PRESETS } from '../../app/presets';
import { Icon } from '../shared/Icon';
import { IconButton, NumberField, Thumb } from '../shared/controls';
import { ThemeToggle } from '../shared/ThemeToggle';

const ROLE_LABELS: [Role, string][] = [['design', 'Tam tasarım'], ['background', 'Arka plan'], ['sticker', 'Sticker'], ['ignore', 'Yok say']];

function DropZone() {
  const [over, setOver] = useState(false);
  const files = useRef<HTMLInputElement>(null), photos = useRef<HTMLInputElement>(null);
  const disabled = busy.value;
  const pick = (input: HTMLInputElement | null) => { if (input?.files?.length) void addFiles([...input.files]); if (input) input.value = ''; };
  return (
    <div
      class={`drop${over ? ' over' : ''}`} aria-disabled={disabled}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer?.files.length) void addFiles([...e.dataTransfer.files]); }}
    >
      <input ref={files} type="file" multiple accept=".png,.PNG,image/png,.zip,application/zip" hidden onChange={() => pick(files.current)} id="picker" />
      <input ref={photos} type="file" multiple accept="image/png" hidden onChange={() => pick(photos.current)} />
      <div class="big">Tasarımı, arka planı ve sticker'ları bırak</div>
      <div class="row">
        <button type="button" class="btn" disabled={disabled} onClick={() => files.current?.click()}><Icon name="folder" /> Dosyalar'dan seç</button>
        <button type="button" class="btn" disabled={disabled} onClick={() => photos.current?.click()}><Icon name="photo" /> Fotoğraflar'dan</button>
      </div>
      <p class="hint">Tam tasarım ile stickersız arka plan aynı piksel boyutunda olmalı; sticker'lar şeffaf PNG. Daha önce dışa aktardığın bir proje .zip'ini de bırakabilirsin. Dosyalar cihazından çıkmaz.</p>
    </div>
  );
}

function FileCard({ f }: { f: FileEntry }) {
  const disabled = busy.value;
  return (
    <div class={`file-card ${f.role}`}>
      <Thumb bitmap={f.thumb} size={96} />
      <div class="name" title={f.name}>{f.name}</div>
      <div class="dim num">{f.width} × {f.height} px</div>
      <div class="role">
        <select class="select" aria-label={`${f.name} rolü`} value={f.role} disabled={disabled} onChange={(e) => setRole(f.name, (e.target as HTMLSelectElement).value as Role)}>
          {ROLE_LABELS.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
        </select>
      </div>
      <IconButton class="remove quiet" icon="close" label={`${f.name} dosyasını kaldır`} size={14} disabled={disabled} onClick={() => void removeFile(f.name)} />
    </div>
  );
}

function PresetPicker() {
  const current = store.presetId.value;
  return (
    <div class="presets" role="radiogroup" aria-label="Kesim stili">
      {CUT_PRESETS.map((p) => (
        <button key={p.id} type="button" class="preset" role="radio" aria-checked={p.id === current} aria-pressed={p.id === current}
          onClick={() => { store.presetId.value = p.id; scheduleDocSave(); }}>
          <span class={`swatch${p.settings.whiteBorder ? ' white' : ''}`} style={{ '--inset': `${6 - Math.min(5, (p.settings.offsetMm ?? 0) * 3)}px` } as Record<string, string>} aria-hidden="true" />
          <span><span class="name">{p.name}</span><br /><span class="blurb">{p.blurb}</span></span>
        </button>
      ))}
    </div>
  );
}

export function SetupScreen() {
  const files = [...store.files.value.values()];
  const design = files.find((f) => f.role === 'design'), background = files.find((f) => f.role === 'background');
  const sameSize = !!design && !!background && design.width === background.width && design.height === background.height;
  const stickers = files.filter((f) => f.role === 'sticker').length;
  const page = store.pageSetup.value;
  const notice = store.notice.value;
  const disabled = busy.value;
  const canPlace = !disabled && sameSize;
  const autoHeight = design ? Math.round((page.widthMm * design.height / design.width) * 10) / 10 : null;
  return (
    <div class="setup desk-bg">
      <header class="setup-head">
        <div class="wordmark"><h1>stickercut</h1><span class="tag">kesim çizgisi atölyesi</span></div>
        <div class="row" style={{ display: 'flex', gap: 6 }}>
          {!files.length ? <button type="button" class="btn quiet" disabled={disabled} onClick={() => void loadSamplePack()}><Icon name="sparkle" /> Örnek pack'i dene</button> : null}
          {files.length ? <button type="button" class="btn quiet danger" disabled={disabled} onClick={() => void newProject()}><Icon name="restart" /> Baştan başla</button> : null}
          <ThemeToggle />
        </div>
      </header>
      <div class="setup-body">
        <div class="setup-main">
          <DropZone />
          {files.length ? (
            <section class="panel">
              <h2>Dosyalar <span class="hint num">{files.length} dosya · {stickers} sticker</span></h2>
              <div class="file-grid">{files.map((f) => <FileCard key={f.name} f={f} />)}</div>
              {design && background && !sameSize ? <p class="msg warning"><span class="dot" /><span>Tam tasarım ({design.width}×{design.height}) ile arka plan ({background.width}×{background.height}) aynı boyutta değil.</span></p> : null}
              {!design || !background ? <p class="hint">Tam tasarım ve arka plan rollerini kartlardan seç. Aynı boyutlu iki opak PNG otomatik tanınır.</p> : null}
              {design && background && !stickers ? <p class="hint">Sticker PNG'si yoksa sorun değil: her çizim tasarımdan bölge olarak kesilir.</p> : null}
            </section>
          ) : null}
          {notice ? <div class="notice"><p class={`msg ${notice.level}`}><span class="dot" /><span>{notice.text}</span></p></div> : null}
        </div>
        <aside class="setup-side">
          <section class="panel">
            <h2>Sayfa</h2>
            <div class="page-fields">
              <label class="field"><span class="label">Genişlik</span>
                <NumberField value={page.widthMm} unit="mm" step={1} min={10} max={1000} digits={1} ariaLabel="Sayfa genişliği (mm)"
                  onCommit={(v) => { store.pageSetup.value = { ...page, widthMm: v }; scheduleDocSave(); }} />
              </label>
              <label class="field"><span class="label">Yükseklik</span>
                <NumberField value={page.heightMm} unit="mm" step={1} min={10} max={1000} digits={1} placeholder={autoHeight ? `oto ${autoHeight}` : 'otomatik'} ariaLabel="Sayfa yüksekliği (mm)"
                  onCommit={(v) => { store.pageSetup.value = { ...page, heightMm: v > 0 ? v : null }; scheduleDocSave(); }} />
              </label>
            </div>
            <p class="hint">Yükseklik boşsa tasarımın oranından hesaplanır{autoHeight ? ` (${page.widthMm} × ${autoHeight} mm)` : ''}.</p>
          </section>
          <section class="panel">
            <h2>Kesim stili</h2>
            <PresetPicker />
            <p class="hint">Sonradan her sticker için ayrı ayrı değiştirilebilir.</p>
          </section>
          <button id="place" type="button" class="btn primary lg block" disabled={!canPlace} onClick={() => void place()}>
            <Icon name="cut" /> Yerleştir ve kesimleri çıkar
          </button>
          <p class="hint">Sticker'lar tasarımdaki yerlerinde bulunur, her biri için kesim çizgisi hesaplanır. Sonra taşı, ölçekle, döndür; PDF'i indir.</p>
        </aside>
      </div>
    </div>
  );
}
