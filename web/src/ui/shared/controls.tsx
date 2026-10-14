import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon, type IconName } from './Icon';

export function IconButton({ icon, label, onClick, pressed, disabled, class: cls, size }: {
  icon: IconName; label: string; onClick?: (e: MouseEvent) => void; pressed?: boolean; disabled?: boolean; class?: string; size?: number;
}) {
  return (
    <button type="button" class={`btn icon-btn ${cls ?? ''}`} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}

const fmt = (v: number, digits: number) => {
  const s = v.toFixed(digits);
  return digits > 0 ? s.replace(/\.?0+$/, '') : s;
};

/**
 * Sayı alanı: yazarken anlık (`onInput`), bırakınca kesin (`onCommit`). Ok tuşları ± adım, Shift ile ×10.
 * `value === null` karışık seçim demektir ("—").
 */
export function NumberField({ value, unit, step = 1, min, max, digits = 2, placeholder, onInput, onCommit, onStart, onEnd, ariaLabel, disabled }: {
  value: number | null; unit?: string; step?: number; min?: number; max?: number; digits?: number; placeholder?: string;
  onInput?: (v: number) => void; onCommit: (v: number) => void; onStart?: () => void; onEnd?: () => void; ariaLabel: string; disabled?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : fmt(value, digits));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(value === null ? '' : fmt(value, digits)); }, [value, editing, digits]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const parse = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? clamp(n) : null; };
  const commit = (s: string) => { const n = parse(s); if (n !== null) { onCommit(n); setText(fmt(n, digits)); } else setText(value === null ? '' : fmt(value, digits)); };
  const bump = (dir: number, big: boolean) => {
    const base = parse(text) ?? value ?? 0;
    const n = clamp(Math.round((base + dir * step * (big ? 10 : 1)) / step) * step);
    setText(fmt(n, digits)); onInput?.(n); onCommit(n);
  };
  return (
    <div class={`numfield${value === null ? ' mixed' : ''}`}>
      <input
        type="text" inputMode="decimal" value={text} placeholder={value === null ? '—' : placeholder} aria-label={ariaLabel} disabled={disabled}
        onFocus={() => { setEditing(true); onStart?.(); }}
        onBlur={(e) => { setEditing(false); commit((e.target as HTMLInputElement).value); onEnd?.(); }}
        onInput={(e) => { const s = (e.target as HTMLInputElement).value; setText(s); const n = parse(s); if (n !== null) onInput?.(n); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { setText(value === null ? '' : fmt(value, digits)); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1, e.shiftKey); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1, e.shiftKey); }
        }}
      />
      {unit ? <span class="unit">{unit}</span> : null}
      <div class="steps" aria-hidden="true">
        <button type="button" tabIndex={-1} disabled={disabled} onClick={(e) => bump(1, e.shiftKey)}>▲</button>
        <button type="button" tabIndex={-1} disabled={disabled} onClick={(e) => bump(-1, e.shiftKey)}>▼</button>
      </div>
    </div>
  );
}

export function Slider({ label, value, min, max, step, unit = 'mm', digits = 2, onInput, onCommit, onStart, onEnd, hint }: {
  label: string; value: number | null; min: number; max: number; step: number; unit?: string; digits?: number;
  onInput: (v: number) => void; onCommit?: (v: number) => void; onStart?: () => void; onEnd?: () => void; hint?: string;
}) {
  return (
    <label class="slider">
      <span class="head"><span>{label}</span><output class="num">{value === null ? '—' : `${fmt(value, digits)} ${unit}`}</output></span>
      <input
        type="range" min={min} max={max} step={step} value={value ?? min} aria-label={label}
        onPointerDown={() => onStart?.()} onFocus={() => onStart?.()}
        onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => { onCommit?.(Number((e.target as HTMLInputElement).value)); onEnd?.(); }}
        onBlur={() => onEnd?.()}
      />
      {hint ? <span class="small muted">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T; options: { value: T; label: ComponentChildren; title?: string }[]; onChange: (v: T) => void; ariaLabel: string;
}) {
  return (
    <div class="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: {
  value: T; tabs: { value: T; label: string; count?: number; countKind?: 'warn' | 'err' }[]; onChange: (v: T) => void;
}) {
  return (
    <div class="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}{t.count ? <span class={`count${t.countKind === 'err' ? ' err' : ''}`}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; children: ComponentChildren; indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <label class="check">
      <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return <label class="field"><span class="label">{label}</span>{children}</label>;
}

export function Select({ value, options, onChange, ariaLabel, class: cls }: {
  value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; ariaLabel: string; class?: string;
}) {
  return (
    <select class={`select ${cls ?? ''}`} value={value} aria-label={ariaLabel} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Küçük resim tuvali: ImageBitmap'i sığdırarak çizer. */
export function Thumb({ bitmap, size = 96, class: cls }: { bitmap: ImageBitmap; size?: number; class?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = size * dpr; c.height = size * dpr;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / bitmap.width, c.height / bitmap.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, (c.width - bitmap.width * k) / 2, (c.height - bitmap.height * k) / 2, bitmap.width * k, bitmap.height * k);
  }, [bitmap, size]);
  return <canvas ref={ref} class={cls} style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Kbd({ children }: { children: ComponentChildren }) { return <kbd class="kbd">{children}</kbd>; }

export type Props<T extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[T];
