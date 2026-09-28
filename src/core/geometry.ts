export interface Pt { x: number; y: number }
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
  return pts.map((p) => apply(m, p));
}

/** Sticker px → tasarım px: merkez (x,y), ölçek, saat yönünde derece. */
export function itemMatrix(p: Placement, w: number, h: number): Affine {
  const t = (p.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t), s = p.scale;
  return multiply([cos, sin, -sin, cos, p.x, p.y], [s, 0, 0, s, (-s * w) / 2, (-s * h) / 2]);
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** Kapalı Catmull-Rom spline'ı kübik bezier SVG path'ine çevirir (affine dönüşüme göre değişmez). */
export function closedPathSvg(pts: Pt[]): string {
  const n = pts.length;
  if (n < 3) return '';
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return d + ' Z';
}

export function polygonBounds(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
