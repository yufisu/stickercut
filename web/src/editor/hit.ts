import { type Coord, type Pt, pointInPolygon } from '../../../src/core/geometry';
import type { Bounds } from './snap';

/** outline ve bounds tasarım px; outline tutamaç taşıyabilir (pointInPolygon düzleştirir). */
export interface HitItem { id: string; outline: Pt[]; bounds: Bounds }

export interface Handle<K extends string = string> { kind: K; at: Coord }

const contains = (b: Bounds, p: Coord): boolean => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const intersects = (a: Bounds, b: Bounds): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const normalized = (r: Bounds): Bounds =>
  ({ minX: Math.min(r.minX, r.maxX), minY: Math.min(r.minY, r.maxY), maxX: Math.max(r.minX, r.maxX), maxY: Math.max(r.minY, r.maxY) });

/** En üstteki (dizinin sonu) önce. Bir kenarı 2·inflatePx'ten dar olan küçük öğeler şişirilmiş kutularıyla da yakalanır. */
export function hitTest(items: HitItem[], p: Coord, inflatePx: number): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const { id, outline, bounds: b } = items[i];
    if (pointInPolygon(p, outline)) return id;
    const tiny = b.maxX - b.minX < 2 * inflatePx || b.maxY - b.minY < 2 * inflatePx;
    if (tiny && contains({ minX: b.minX - inflatePx, minY: b.minY - inflatePx, maxX: b.maxX + inflatePx, maxY: b.maxY + inflatePx }, p)) return id;
  }
  return null;
}

/** Kutusu seçim dikdörtgeniyle kesişen öğeler, dizi (z) sırasıyla; ters çizilmiş dikdörtgen düzeltilir. */
export function marqueeHits(items: HitItem[], rect: Bounds): string[] {
  const r = normalized(rect);
  return items.filter((it) => intersects(it.bounds, r)).map((it) => it.id);
}

/** Yarıçap içindeki en yakın tutamaç; eşitlikte ilk. */
export function handleHit<K extends string>(handles: Handle<K>[], p: Coord, radiusPx: number): K | null {
  let best: K | null = null, bestD = radiusPx;
  for (const h of handles) {
    const d = Math.hypot(p.x - h.at.x, p.y - h.at.y);
    if (best === null ? d <= bestD : d < bestD) { best = h.kind; bestD = d; }
  }
  return best;
}
