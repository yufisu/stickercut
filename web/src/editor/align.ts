import type { Bounds } from './snap';
import { boundsCentre, groupBounds } from './transform';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export interface IdBounds { id: string; b: Bounds }
export interface Move { id: string; dx: number; dy: number }

/** Seçimin toplam kutusuna (ya da verilen hedefe, örn. sayfa) hizalar. */
export function alignItems(bounds: IdBounds[], mode: AlignMode, target: Bounds = groupBounds(bounds.map((x) => x.b))): Move[] {
  const tc = boundsCentre(target);
  return bounds.map(({ id, b }) => {
    const c = boundsCentre(b);
    switch (mode) {
      case 'left': return { id, dx: target.minX - b.minX, dy: 0 };
      case 'hcenter': return { id, dx: tc.x - c.x, dy: 0 };
      case 'right': return { id, dx: target.maxX - b.maxX, dy: 0 };
      case 'top': return { id, dx: 0, dy: target.minY - b.minY };
      case 'vcenter': return { id, dx: 0, dy: tc.y - c.y };
      case 'bottom': return { id, dx: 0, dy: target.maxY - b.maxY };
    }
  });
}

/** Eşit aralıklı dağıtım: öğeler eksendeki merkezlerine göre sıralanır, ilk ve son yerinde kalır. */
export function distributeItems(bounds: IdBounds[], axis: 'x' | 'y'): Move[] {
  const lo = axis === 'x' ? 'minX' : 'minY', hi = axis === 'x' ? 'maxX' : 'maxY';
  const moves = new Map(bounds.map(({ id }) => [id, 0]));
  if (bounds.length > 2) {
    const sorted = [...bounds].sort((a, b) => a.b[lo] + a.b[hi] - (b.b[lo] + b.b[hi]));
    const first = sorted[0].b, last = sorted[sorted.length - 1].b;
    const sizes = sorted.reduce((sum, { b }) => sum + b[hi] - b[lo], 0);
    const gap = (last[hi] - first[lo] - sizes) / (sorted.length - 1);
    let cursor = first[hi] + gap;
    for (const { id, b } of sorted.slice(1, -1)) { moves.set(id, cursor - b[lo]); cursor += b[hi] - b[lo] + gap; }
  }
  return bounds.map(({ id }) => ({ id, dx: axis === 'x' ? moves.get(id)! : 0, dy: axis === 'y' ? moves.get(id)! : 0 }));
}
