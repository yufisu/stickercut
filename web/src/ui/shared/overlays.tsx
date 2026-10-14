import { useEffect, useRef } from 'preact/hooks';
import { store } from '../../app/store';
import { phaseLabel, dismissToast } from '../../app/actions/jobs';
import { Icon } from './Icon';
import { Kbd } from './controls';
import { MOD, SHIFT, ALT } from '../../platform/env';

/** Kilitleyen işler için modal kart, kesim hesabı gibi arka plan işleri için küçük hap. */
export function JobOverlay() {
  const jobs = [...store.jobs.value.values()];
  const blocking = jobs.find((j) => j.blocking);
  const background = jobs.filter((j) => !j.blocking);
  return (
    <>
      {blocking ? (
        <div class="job-modal" role="dialog" aria-modal="true" aria-label={blocking.label}>
          <div class="job-card">
            <h2>{blocking.label}…</h2>
            <p class="muted small">{phaseLabel(blocking.phase)}{blocking.total ? ` · ${blocking.done}/${blocking.total}` : ''}</p>
            <div class={`progress${blocking.total ? '' : ' indeterminate'}`} role="progressbar" aria-valuemin={0} aria-valuemax={blocking.total || undefined} aria-valuenow={blocking.total ? blocking.done : undefined}>
              <div style={{ width: blocking.total ? `${(100 * blocking.done) / blocking.total}%` : undefined }} />
            </div>
            {blocking.cancellable ? <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" class="btn" onClick={blocking.cancel}>İptal</button></div> : null}
          </div>
        </div>
      ) : null}
      {!blocking && background.length ? (
        <div class="job-pill" role="status" aria-live="polite">
          <span class="progress" style={{ width: '60px' }}><span style={{ display: 'block', height: '100%', width: background[0].total ? `${(100 * background[0].done) / background[0].total}%` : '40%', background: 'var(--accent)' }} /></span>
          <span>{background[0].label}{background[0].total ? ` ${background[0].done}/${background[0].total}` : ''}</span>
        </div>
      ) : null}
    </>
  );
}

export function Toasts() {
  const toasts = store.toasts.value;
  if (!toasts.length) return null;
  return (
    <div class="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          <span class="text">{t.text}</span>
          {t.action ? <button type="button" class="btn" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button> : null}
          <button type="button" class="btn icon-btn" aria-label="Kapat" onClick={() => dismissToast(t.id)}><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Seç', 'V'], ['Gez (basılı tut)', 'H / Boşluk'], ['Sticker ekle', 'A'], ['Bölge', 'R'], ['Ölçü', 'M'],
  ['Geri al', `${MOD} Z`], ['Yinele', `${MOD} ${SHIFT} Z`], ['Tümünü seç', `${MOD} A`], ['Sil', 'Sil / Geri'],
  ['İt 0.1 mm', 'Ok tuşları'], ['İt 1 mm', `${SHIFT} Ok`], ['Çoğalt', `${MOD} D`], ['Öne / arkaya', `${MOD} ] / [`],
  ['Yakınlaştır / uzaklaştır', `${MOD} + / −`], ['Sığdır', `${MOD} 0`], ['Gerçek boyut', `${MOD} 1`], ['Seçime yaklaş', `${MOD} 2`],
  ['Düzenle / kesim / baskı görünümü', `${ALT} 1 / 2 / 3`], ['Izgara', 'G'], ['Cetveller', `${SHIFT} R`], ['Kesim çizgileri', `${SHIFT} C`],
  ['PDF dışa aktar', `${MOD} E`], ['Proje .zip', `${MOD} ${SHIFT} E`], ['Snap kapat (sürüklerken)', ALT], ['Eksene kilitle / 15°', `${SHIFT} (sürüklerken)`], ['Bu liste', '?'],
];

export function ShortcutsDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = store.shortcutsOpen.value;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class="dlg" onClose={() => { store.shortcutsOpen.value = false; }}>
      <div class="body">
        <h2>Klavye kısayolları</h2>
        <div class="shortcut-grid">
          {SHORTCUTS.map(([label, keys]) => <div key={label}><span>{label}</span><span>{keys.split(' / ').map((k, i) => <span key={i}>{i ? ' / ' : ''}<Kbd>{k}</Kbd></span>)}</span></div>)}
        </div>
      </div>
      <div class="foot"><button type="button" class="btn" onClick={() => { store.shortcutsOpen.value = false; }}>Kapat</button></div>
    </dialog>
  );
}
