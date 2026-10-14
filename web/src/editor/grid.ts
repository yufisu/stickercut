export const GRID_MAJOR_MM = 10;

/** minor null = yalnızca ana çizgiler. */
export interface GridStep { major: number; minor: number | null }

/** Ana ızgara 10 mm; ince 1 mm (≥ minMinorPx), yoksa 5 mm, o da sığmazsa null. Ana çizgi minMajorPx'ten dar kalırsa ızgara çizilmez. */
export function gridStep(pxPerMm: number, minMinorPx = 8, minMajorPx = 12): GridStep | null {
  if (!(GRID_MAJOR_MM * pxPerMm >= minMajorPx)) return null;
  const minor = pxPerMm >= minMinorPx ? 1 : 5 * pxPerMm >= minMinorPx ? 5 : null;
  return { major: GRID_MAJOR_MM, minor };
}
