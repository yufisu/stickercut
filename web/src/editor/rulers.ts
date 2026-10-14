/** Cetvel adımları (mm). */
export const STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];

const isMultiple = (a: number, b: number): boolean => Math.abs(a / b - Math.round(a / b)) < 1e-9;

/**
 * minor: ekranda en az minMinorPx tutan en küçük adım; major: minor'ın katı olup en az minLabelPx tutan en küçük adım.
 * Hiçbiri yetmezse en büyük adım (100 mm) kullanılır.
 */
export function tickStep(pxPerMm: number, minMinorPx = 6, minLabelPx = 40): { minor: number; major: number } {
  const last = STEPS[STEPS.length - 1];
  const minor = STEPS.find((s) => s * pxPerMm >= minMinorPx) ?? last;
  const major = STEPS.find((s) => s >= minor && s * pxPerMm >= minLabelPx && isMultiple(s, minor)) ?? last;
  return { minor, major };
}

/** [fromMm, toMm] içindeki step katları (sınırlar dahil); i·step ile üretilir, biriken hata yok. */
export function ticks(fromMm: number, toMm: number, step: number): number[] {
  if (!(step > 0) || !(toMm >= fromMm)) return [];
  const out: number[] = [];
  const first = Math.ceil(fromMm / step - 1e-9), last = Math.floor(toMm / step + 1e-9);
  for (let i = first; i <= last; i++) out.push(Math.round(i * step * 1e6) / 1e6 || 0);
  return out;
}

/** Sondaki sıfırlar olmadan, nokta ayraçlı: 12.5 */
export function formatMm(v: number, decimals = 2): string {
  const k = 10 ** decimals;
  return String(Math.round(v * k) / k || 0);
}
