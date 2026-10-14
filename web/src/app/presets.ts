import { CUT_PRESETS, type CutPreset, type Settings } from '../../../src/core/project';

export { CUT_PRESETS };
export type { CutPreset };

export function presetById(id: string): CutPreset | undefined {
  return CUT_PRESETS.find((p) => p.id === id);
}

/** Ayarlar hangi preset'e denk geliyor? Hiçbirine değilse 'custom'. */
export function presetOf(settings: Settings): string {
  const hit = CUT_PRESETS.find((p) => Object.entries(p.settings).every(([k, v]) => settings[k as keyof Settings] === v));
  return hit?.id ?? 'custom';
}
