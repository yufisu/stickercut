export interface Coord { x: number; y: number }
/** Handles use absolute coordinates in the same space as their anchor. */
export interface Pt extends Coord { handleIn?: Coord; handleOut?: Coord }
/** x' = a·x + c·y + e, y' = b·x + d·y + f (PDF ve canvas ile aynı sıra) */
export type Affine = [number, number, number, number, number, number];
export interface Placement { x: number; y: number; scale: number; rotationDeg: number }

/** Önce m2, sonra m1 uygulanır. */
export function multiply(m1: Affine, m2: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

export function apply(m: Affine, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function transformPoints(m: Affine, pts: Pt[]): Pt[] {
  return pts.map((p) => ({
    ...apply(m, p),
    ...(p.handleIn ? { handleIn: apply(m, p.handleIn) } : {}),
    ...(p.handleOut ? { handleOut: apply(m, p.handleOut) } : {}),
  }));
}

/** Sticker px → tasarım px: merkez (x,y), ölçek, saat yönünde derece. */
export function itemMatrix(p: Placement, w: number, h: number): Affine {
  const t = (p.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t), s = p.scale;
  return multiply([cos, sin, -sin, cos, p.x, p.y], [s, 0, 0, s, (-s * w) / 2, (-s * h) / 2]);
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** Emit fitted handles only; ordinary polygon corners remain straight. */
export function closedPathSvg(pts: Pt[]): string {
  if (pts.length < 3) return '';
  const segment = (a: Pt, b: Pt) => {
    if (!a.handleOut && !b.handleIn) return ` L ${fmt(b.x)} ${fmt(b.y)}`;
    const c1 = a.handleOut ?? a, c2 = b.handleIn ?? b;
    return ` C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(b.x)} ${fmt(b.y)}`;
  };
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += segment(pts[i - 1], pts[i]);
  const last = pts[pts.length - 1];
  if (last.handleOut || pts[0].handleIn) d += segment(last, pts[0]);
  return d + ' Z';
}

const midpoint = (a: Coord, b: Coord): Coord => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function segmentDistanceSquared(p: Coord, a: Coord, b: Coord): number {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

/** Adaptive subdivision in path units, including the closing cubic when closed. */
export function flattenPath(pts: Pt[], closed: boolean, tolerance = 0.25): Pt[] {
  if (!pts.length) return [];
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  const toleranceSquared = Math.max(1e-6, tolerance) ** 2;
  const subdivide = (a: Coord, c1: Coord, c2: Coord, b: Coord, depth: number) => {
    if (depth >= 18 || Math.max(segmentDistanceSquared(c1, a, b), segmentDistanceSquared(c2, a, b)) <= toleranceSquared) {
      out.push({ x: b.x, y: b.y });
      return;
    }
    const ac = midpoint(a, c1), cc = midpoint(c1, c2), cb = midpoint(c2, b);
    const left = midpoint(ac, cc), right = midpoint(cc, cb), center = midpoint(left, right);
    subdivide(a, ac, left, center, depth + 1);
    subdivide(center, right, cb, b, depth + 1);
  };
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a.handleOut || b.handleIn) subdivide(a, a.handleOut ?? a, b.handleIn ?? b, b, 0);
    else out.push({ x: b.x, y: b.y });
  }
  if (closed) out.pop(); // The closing endpoint duplicates the first anchor.
  return out;
}

export function flattenClosedPath(pts: Pt[], tolerance = 0.25): Pt[] {
  return flattenPath(pts, true, tolerance);
}

function cubicAt(a: number, c1: number, c2: number, b: number, t: number): number {
  const u = 1 - t;
  return u ** 3 * a + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t ** 3 * b;
}

function cubicExtrema(a: number, c1: number, c2: number, b: number): number[] {
  const A = -a + 3 * c1 - 3 * c2 + b, B = 2 * (a - 2 * c1 + c2), C = c1 - a;
  const epsilon = 1e-12 * Math.max(1, Math.abs(A), Math.abs(B), Math.abs(C));
  if (Math.abs(A) <= epsilon) return Math.abs(B) <= epsilon ? [] : [-C / B];
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-B + root) / (2 * A), (-B - root) / (2 * A)];
}

export function polygonBounds(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (p: Coord) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    include(a);
    if (!a.handleOut && !b.handleIn) continue;
    const c1 = a.handleOut ?? a, c2 = b.handleIn ?? b;
    const ts = [...cubicExtrema(a.x, c1.x, c2.x, b.x), ...cubicExtrema(a.y, c1.y, c2.y, b.y)];
    for (const t of ts) if (t > 0 && t < 1) include({
      x: cubicAt(a.x, c1.x, c2.x, b.x, t), y: cubicAt(a.y, c1.y, c2.y, b.y, t),
    });
  }
  return { minX, minY, maxX, maxY };
}

const hitTestCache = new WeakMap<Pt[], { coordinates: number[]; flat: Pt[] }>();

function hitTestPolygon(poly: Pt[]): Pt[] {
  if (!poly.some((p) => p.handleIn || p.handleOut)) return poly;
  // Validate handles as well as anchors so edits cannot leave a stale cached outline.
  const coordinates = poly.flatMap((p) => [p.x, p.y, p.handleIn?.x ?? NaN, p.handleIn?.y ?? NaN, p.handleOut?.x ?? NaN, p.handleOut?.y ?? NaN]);
  const cached = hitTestCache.get(poly);
  if (cached && coordinates.length === cached.coordinates.length && coordinates.every((v, i) => Object.is(v, cached.coordinates[i]))) return cached.flat;
  const flat = flattenClosedPath(poly);
  hitTestCache.set(poly, { coordinates, flat });
  return flat;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  poly = hitTestPolygon(poly);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
