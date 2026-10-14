import type { Coord, Placement } from '../../../src/core/geometry';
import type { Bounds } from './snap';

export type { Placement };

export interface GroupTransform { dx?: number; dy?: number; k?: number; deg?: number }

/** (-180, 180] aralığına indirger. */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d || 0;
}

/** Kutuların birleşimi; boş liste için ters sonsuz kutu (polygonBounds ile aynı). */
export function groupBounds(bounds: Bounds[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of bounds) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

export const boundsCentre = (b: Bounds): Coord => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/**
 * Grubu pivot etrafında k ile ölçekler, deg (saat yönü) kadar döndürür, sonra (dx, dy) taşır:
 * merkez' = pivot + R(deg)·k·(merkez − pivot) + (dx, dy); scale k ile çarpılır, rotationDeg deg kadar artar.
 * Fazladan alanlar (örn. Item) korunur.
 */
export function transformGroup<P extends Placement>(items: P[], pivot: Coord, t: GroupTransform): P[] {
  const { dx = 0, dy = 0, k = 1, deg = 0 } = t;
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  return items.map((it) => {
    const vx = (it.x - pivot.x) * k, vy = (it.y - pivot.y) * k;
    return {
      ...it,
      x: pivot.x + cos * vx - sin * vy + dx,
      y: pivot.y + sin * vx + cos * vy + dy,
      scale: it.scale * k,
      rotationDeg: normalizeDeg(it.rotationDeg + deg),
    };
  });
}
