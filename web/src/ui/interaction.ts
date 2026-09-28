import { type Pt, apply, invert, itemMatrix } from '../../../src/core/geometry';

export interface Geom { x: number; y: number; scale: number; rotationDeg: number; w: number; h: number }

export function corners(g: Geom): Pt[] {
  const m = itemMatrix(g, g.w, g.h);
  return [apply(m, { x: 0, y: 0 }), apply(m, { x: g.w, y: 0 }), apply(m, { x: g.w, y: g.h }), apply(m, { x: 0, y: g.h })]
    .map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }));
}

export function containsPoint(g: Geom, p: Pt): boolean {
  const l = apply(invert(itemMatrix(g, g.w, g.h)), p);
  return l.x >= 0 && l.y >= 0 && l.x <= g.w && l.y <= g.h;
}

export function handles(g: Geom, rotateOffset: number): { scale: Pt; rotate: Pt } {
  const [tl, tr, br] = corners(g);
  const top = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const dx = top.x - g.x, dy = top.y - g.y, len = Math.hypot(dx, dy) || 1;
  return { scale: br, rotate: { x: top.x + (dx / len) * rotateOffset, y: top.y + (dy / len) * rotateOffset } };
}

export function hitHandle(g: Geom, p: Pt, radius: number, rotateOffset: number): 'scale' | 'rotate' | null {
  const h = handles(g, rotateOffset);
  if (Math.hypot(p.x - h.scale.x, p.y - h.scale.y) <= radius) return 'scale';
  if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) <= radius) return 'rotate';
  return null;
}

export function moved(orig: Geom, start: Pt, now: Pt): { x: number; y: number } {
  return { x: orig.x + now.x - start.x, y: orig.y + now.y - start.y };
}

export function scaled(orig: Geom, start: Pt, now: Pt): number {
  const d0 = Math.hypot(start.x - orig.x, start.y - orig.y);
  const d1 = Math.hypot(now.x - orig.x, now.y - orig.y);
  return d0 ? Math.max(0.005, (orig.scale * d1) / d0) : orig.scale;
}

export function rotated(orig: Geom, start: Pt, now: Pt): number {
  const a0 = Math.atan2(start.y - orig.y, start.x - orig.x), a1 = Math.atan2(now.y - orig.y, now.x - orig.x);
  let deg = orig.rotationDeg + ((a1 - a0) * 180) / Math.PI;
  deg = (((deg % 360) + 540) % 360) - 180;
  const snap = Math.round(deg / 90) * 90;
  if (Math.abs(deg - snap) < 3) deg = snap;
  return Math.round(deg * 10) / 10 || 0;
}
