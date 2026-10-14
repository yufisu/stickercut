import type { ThemePref } from '../app/store';

const META = () => document.querySelector<HTMLMetaElement>('meta[name=theme-color]');

/** data-theme özniteliğini ve tarayıcı çubuğu rengini uygular. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  META()?.setAttribute('content', dark ? '#1f1c18' : '#f4efe6');
}

/** Tuval için CSS değişkenlerinden okunan renk paleti. */
export interface Palette {
  desk: string; page: string; panel: string; pageShadow: string; ink: string; muted: string; line: string;
  cut: string; selection: string; warning: string; review: string; guide: string; grid: string; gridMajor: string;
  ruler: string; rulerInk: string; reference: string; referenceFill: string;
}
export function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    desk: v('--desk'), page: v('--page'), panel: v('--panel'), pageShadow: v('--page-shadow'), ink: v('--ink'), muted: v('--muted'), line: v('--line'),
    cut: v('--cut'), selection: v('--sel'), warning: v('--warn'), review: v('--review'), guide: v('--guide'), grid: v('--grid'), gridMajor: v('--grid-major'),
    ruler: v('--ruler'), rulerInk: v('--ruler-ink'), reference: v('--reference'), referenceFill: v('--reference-fill'),
  };
}
