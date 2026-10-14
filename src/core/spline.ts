import type { Coord, Pt } from './geometry';

/**
 * Vektör aşaması: ham kontur → eşit aralıklı örnekleme → Gauss yumuşatma → teğetler → (köşeler) → G1 kübik Bézier fit.
 * Tüm fonksiyonlar kapalı eğriler üzerinde, birim bağımsız çalışır.
 */

type Vec = Coord;
type Cubic = [Vec, Vec, Vec, Vec];
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const length = (v: Vec) => Math.hypot(v.x, v.y);
const unit = (v: Vec): Vec => {
  const d = length(v);
  return d ? { x: v.x / d, y: v.y / d } : { x: 0, y: 0 };
};
const shifted = (p: Vec, v: Vec, d: number): Vec => ({ x: p.x + v.x * d, y: p.y + v.y * d });
const mix = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function at(c: Cubic, t: number): Vec {
  const a = mix(c[0], c[1], t), b = mix(c[1], c[2], t), d = mix(c[2], c[3], t);
  return mix(mix(a, b, t), mix(b, d, t), t);
}

function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const d = sub(b, a), v = sub(p, a), d2 = dot(d, d);
  const t = d2 ? Math.max(0, Math.min(1, dot(v, d) / d2)) : 0;
  return length(sub(p, shifted(a, d, t)));
}

/** Kapalı poligonu eşit yay uzunluğuyla yeniden örnekler (n = max(8, çevre/step)). */
export function resampleClosed(poly: Coord[], step: number): Pt[] {
  const n = poly.length;
  if (n < 2) return poly.map((p) => ({ x: p.x, y: p.y }));
  const edge: number[] = [];
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const d = length(sub(poly[(i + 1) % n], poly[i]));
    edge.push(d);
    perimeter += d;
  }
  if (perimeter === 0) return poly.map((p) => ({ x: p.x, y: p.y }));
  const count = Math.max(8, Math.round(perimeter / Math.max(step, 1e-9)));
  const spacing = perimeter / count;
  const out: Pt[] = [];
  let seg = 0, segStart = 0; // segStart: seg kenarının başladığı yay uzunluğu
  for (let k = 0; k < count; k++) {
    const target = k * spacing;
    while (seg < n - 1 && segStart + edge[seg] <= target) { segStart += edge[seg]; seg++; }
    const t = edge[seg] ? (target - segStart) / edge[seg] : 0;
    const a = poly[seg], b = poly[(seg + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Döngüsel Gauss yumuşatma; sigma örnek sayısı cinsinden, 6σ+1 ≤ n olacak şekilde kırpılır. */
export function gaussianClosed(pts: Coord[], sigma: number): Pt[] {
  const n = pts.length;
  if (sigma <= 0 || n < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const s = Math.min(sigma, (n - 1) / 6);
  const radius = Math.max(1, Math.ceil(3 * s));
  const weights: number[] = [];
  let total = 0;
  for (let k = -radius; k <= radius; k++) { const w = Math.exp(-(k * k) / (2 * s * s)); weights.push(w); total += w; }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let k = -radius; k <= radius; k++) {
      const p = pts[(i + k + n * 2) % n], w = weights[k + radius];
      x += p.x * w; y += p.y * w;
    }
    out.push({ x: x / total, y: y / total });
  }
  return out;
}

/** Birim teğetler: merkezi fark (5 nokta), kısa dizilerde 3 nokta. */
export function tangentsClosed(pts: Coord[]): Vec[] {
  const n = pts.length;
  return pts.map((_, i) => {
    if (n < 5) return unit(sub(pts[(i + 1) % n], pts[(i + n - 1) % n]));
    const a = pts[(i + 2) % n], b = pts[(i + 1) % n], c = pts[(i + n - 1) % n], d = pts[(i + n - 2) % n];
    return unit({ x: a.x + b.x - c.x - d.x, y: a.y + b.y - c.y - d.y });
  });
}

/** İşaretli eğrilik (sonlu farklar). */
export function curvatureClosed(pts: Coord[]): Float64Array {
  const n = pts.length, out = new Float64Array(n);
  if (n < 3) return out;
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    const d1 = { x: (q.x - p.x) / 2, y: (q.y - p.y) / 2 }, d2 = { x: q.x - 2 * c.x + p.x, y: q.y - 2 * c.y + p.y };
    const l = length(d1);
    out[i] = l ? cross(d1, d2) / (l * l * l) : 0;
  }
  return out;
}

export interface Corner { index: number; vertex: Pt; tIn: Vec; tOut: Vec; span: number }

/**
 * Kalıcı köşeler: reach örnek öncesi ve sonrası teğetler arasındaki dönüş açısı ≥ 180° − angleDeg olan noktalar.
 * Köşe noktası iki teğet doğrusunun kesişimidir (maxVertexDist'ten uzaksa örnek noktası kullanılır).
 */
export function detectCorners(pts: Coord[], t: Vec[], angleDeg: number, reach: number, maxVertexDist = Infinity): Corner[] {
  const n = pts.length;
  if (n < 8 || angleDeg <= 0) return [];
  const k = Math.max(1, Math.min(reach, Math.floor((n - 1) / 4)));
  const turn = (i: number) => {
    const a = t[(i - k + n) % n], b = t[(i + k) % n];
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
  };
  const threshold = 180 - angleDeg;
  const candidates: { i: number; angle: number }[] = [];
  for (let i = 0; i < n; i++) { const angle = turn(i); if (angle >= threshold) candidates.push({ i, angle }); }
  candidates.sort((p, q) => q.angle - p.angle || p.i - q.i);
  const kept: number[] = [];
  for (const { i } of candidates) {
    if (kept.every((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) > 2 * k)) kept.push(i);
  }
  return kept.sort((a, b) => a - b).map((i) => {
    const pa = pts[(i - k + n) % n], ta = t[(i - k + n) % n], pb = pts[(i + k) % n], tb = t[(i + k) % n];
    // (pa + ta·s) = (pb + tb·r) kesişimi
    const den = cross(ta, tb);
    let vertex: Pt = { x: pts[i].x, y: pts[i].y };
    if (Math.abs(den) > 1e-9) {
      const s = cross(sub(pb, pa), tb) / den;
      const v = shifted(pa, ta, s);
      if (length(sub(v, pts[i])) <= maxVertexDist) vertex = v;
    }
    return { index: i, vertex, tIn: ta, tOut: tb, span: k };
  });
}

/** Sabit uç teğetleriyle en küçük kareler kübik; tutamaç boyları (0, kiriş] aralığına sınırlanır. */
function generate(points: Vec[], u: number[], left: Vec, right: Vec): Cubic {
  const a = points[0], b = points[points.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < points.length; i++) {
    const t = u[i], s = 1 - t;
    const b0 = s ** 3, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t ** 3;
    const v0 = { x: left.x * b1, y: left.y * b1 }, v1 = { x: right.x * b2, y: right.y * b2 };
    const residual = { x: points[i].x - a.x * (b0 + b1) - b.x * (b2 + b3), y: points[i].y - a.y * (b0 + b1) - b.y * (b2 + b3) };
    c00 += dot(v0, v0); c01 += dot(v0, v1); c11 += dot(v1, v1);
    x0 += dot(v0, residual); x1 += dot(v1, residual);
  }
  const det = c00 * c11 - c01 * c01, chord = length(sub(b, a));
  let alpha = det ? (x0 * c11 - x1 * c01) / det : 0;
  let beta = det ? (c00 * x1 - c01 * x0) / det : 0;
  if (!(alpha > chord * 1e-6) || !(beta > chord * 1e-6) || alpha > chord || beta > chord) alpha = beta = chord / 3;
  return [a, shifted(a, left, alpha), shifted(b, right, beta), b];
}

interface SpanFit { curve: Cubic; error: number }

/** Bir örnek aralığına tek kübik uydurur; hata = örnek sapması ve örnekler arası şişme (en büyüğü). */
function fitSpan(points: Vec[], left: Vec, right: Vec, tolerance: number): SpanFit {
  const n = points.length;
  const u = [0];
  for (let i = 1; i < n; i++) u.push(u[i - 1] + length(sub(points[i], points[i - 1])));
  const total = u[n - 1] || 1;
  for (let i = 1; i < n; i++) u[i] /= total;
  let curve = generate(points, u, left, right);
  let best: SpanFit = { curve, error: Infinity };
  for (let iteration = 0; iteration < 5; iteration++) {
    let error = 0;
    for (let i = 1; i < n - 1; i++) error = Math.max(error, length(sub(at(curve, u[i]), points[i])));
    for (let i = 0; i < n - 1; i++) {
      for (const f of [0.25, 0.5, 0.75]) {
        error = Math.max(error, segmentDistance(at(curve, u[i] + (u[i + 1] - u[i]) * f), points[i], points[i + 1]));
      }
    }
    if (error < best.error) best = { curve, error };
    if (error <= tolerance || n < 3) break;
    // Newton ile parametre düzeltme (sırayı korur, bozulursa durur)
    const next = u.slice();
    const a = curve[0], b = curve[3];
    for (let i = 1; i < n - 1; i++) {
      const t = u[i], s = 1 - t, q = at(curve, t), delta = sub(q, points[i]);
      const d = { x: 3 * (s * s * (curve[1].x - a.x) + 2 * s * t * (curve[2].x - curve[1].x) + t * t * (b.x - curve[2].x)),
        y: 3 * (s * s * (curve[1].y - a.y) + 2 * s * t * (curve[2].y - curve[1].y) + t * t * (b.y - curve[2].y)) };
      const dd = { x: 6 * (s * (curve[2].x - 2 * curve[1].x + a.x) + t * (b.x - 2 * curve[2].x + curve[1].x)),
        y: 6 * (s * (curve[2].y - 2 * curve[1].y + a.y) + t * (b.y - 2 * curve[2].y + curve[1].y)) };
      const divisor = dot(d, d) + dot(delta, dd);
      if (divisor) next[i] = t - dot(delta, d) / divisor;
    }
    if (next.some((t, i) => !Number.isFinite(t) || t < 0 || t > 1 || (i > 0 && t <= next[i - 1]))) break;
    u.splice(0, u.length, ...next);
    curve = generate(points, u, left, right);
  }
  return best;
}

interface Node { p: Coord; tIn: Vec; tOut: Vec; corner: boolean }

/**
 * Köşeler arasında açgözlü en uzun aralık fit'i; her anchor'da teğet paylaşıldığı için eğri G1'dir.
 * Yalnızca iki köşe arasındaki, kirişine tolerans içinde yakın aralıklar düz çizgi (tutamaçsız) olur.
 */
export function fitG1Closed(pts: Coord[], t: Vec[], tolerance: number, corners: Corner[] = []): Pt[] {
  const n = pts.length;
  if (n < 4) return pts.map((p) => ({ x: p.x, y: p.y }));
  const tol = Math.max(tolerance, 1e-9);
  const skip = new Uint8Array(n), replace = new Map<number, Corner>();
  for (const c of corners) {
    replace.set(c.index, c);
    for (let d = 1; d < c.span; d++) { skip[(c.index + d) % n] = 1; skip[(c.index - d + n) % n] = 1; }
  }
  const nodes: Node[] = [];
  for (let i = 0; i < n; i++) {
    const c = replace.get(i);
    if (c) nodes.push({ p: c.vertex, tIn: c.tIn, tOut: c.tOut, corner: true });
    else if (!skip[i]) nodes.push({ p: pts[i], tIn: t[i], tOut: t[i], corner: false });
  }
  const N = nodes.length;
  if (N < 4) return nodes.map((nd) => ({ x: nd.p.x, y: nd.p.y }));
  const node = (i: number) => nodes[((i % N) + N) % N];
  const spanPoints = (i: number, j: number) => { const out: Vec[] = []; for (let k = i; k <= j; k++) out.push(node(k).p); return out; };
  const memo = new Map<string, SpanFit>();
  const fitted = (i: number, j: number): SpanFit => {
    const key = `${((i % N) + N) % N},${j - i}`;
    let f = memo.get(key);
    if (!f) {
      const end = node(j).tIn;
      f = fitSpan(spanPoints(i, j), node(i).tOut, { x: -end.x, y: -end.y }, tol);
      memo.set(key, f);
    }
    return f;
  };
  const fits = (i: number, j: number) => fitted(i, j).error <= tol;

  let starts = nodes.map((nd, i) => (nd.corner ? i : -1)).filter((i) => i >= 0);
  if (!starts.length) {
    const kappa = curvatureClosed(nodes.map((nd) => nd.p));
    let best = 0;
    for (let i = 1; i < N; i++) if (Math.abs(kappa[i]) > Math.abs(kappa[best])) best = i;
    starts = [best];
  }
  const segments: { i: number; j: number }[] = []; // mutlak düğüm indeksleri, j − i ≥ 1
  for (let s = 0; s < starts.length; s++) {
    const b = starts[s], bNext = s + 1 < starts.length ? starts[s + 1] : starts[0] + N;
    let i = b;
    while (i < bNext) {
      let j = Math.min(i + 1, bNext);
      let step = 4;
      let fail = -1;
      while (j < bNext) {
        const probe = Math.min(bNext, j + step);
        if (fits(i, probe)) { j = probe; step *= 2; } else { fail = probe; break; }
      }
      if (fail > 0) {
        let lo = j, hi = fail;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fits(i, mid)) lo = mid; else hi = mid; }
        j = lo;
      }
      if (bNext - j > 0 && bNext - j < 3 && fits(i, bNext)) j = bNext;
      segments.push({ i, j });
      i = j;
    }
  }
  // Gevşetme: köşe olmayan bir anchor'ı kaldırmak hâlâ tolerans içindeyse birleştir.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let k = 0; k < segments.length && segments.length > 1; k++) {
      const a = segments[k], b = segments[(k + 1) % segments.length];
      if (node(a.j).corner || a.j !== b.i && a.j !== b.i + N) continue;
      const j = b.j + (a.j === b.i ? 0 : N);
      if (j - a.i >= N) continue;
      if (fits(a.i, j)) {
        a.j = j;
        segments.splice((k + 1) % segments.length, 1);
        changed = true;
        k--;
      }
    }
    if (!changed) break;
  }
  const result: Pt[] = segments.map(({ i }) => ({ x: node(i).p.x, y: node(i).p.y }));
  for (let k = 0; k < segments.length; k++) {
    const { i, j } = segments[k], next = result[(k + 1) % result.length];
    const chordLine = node(i).corner && node(j).corner
      && spanPoints(i, j).every((p) => segmentDistance(p, node(i).p, node(j).p) <= tol);
    if (chordLine) continue;
    const { curve } = fitted(i, j);
    result[k].handleOut = { x: curve[1].x, y: curve[1].y };
    next.handleIn = { x: curve[2].x, y: curve[2].y };
  }
  return result;
}

/** Her anchor'da giren ve çıkan yön aynı mı? Tutamaçsız kenarlar düz çizgi yönüyle değerlendirilir. */
export function isG1(path: Pt[], maxAngleDeg = 0.5): boolean {
  const n = path.length;
  if (n < 3) return true;
  for (let i = 0; i < n; i++) {
    const p = path[i], prev = path[(i + n - 1) % n], next = path[(i + 1) % n];
    const tin = p.handleIn ? sub(p, p.handleIn) : sub(p, prev);
    const tout = p.handleOut ? sub(p.handleOut, p) : sub(next, p);
    if (!length(tin) || !length(tout)) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(unit(tin), unit(tout))))) * 180 / Math.PI;
    if (angle > maxAngleDeg) return false;
  }
  return true;
}

/** Kapalı poligonda komşu olmayan kenarlar kesişiyor mu? (bbox ön elemeli O(n²)) */
export function selfIntersects(poly: Coord[]): boolean {
  const n = poly.length;
  if (n < 4) return false;
  const seg = (i: number) => [poly[i], poly[(i + 1) % n]] as const;
  const orient = (a: Vec, b: Vec, c: Vec) => cross(sub(b, a), sub(c, a));
  for (let i = 0; i < n; i++) {
    const [a, b] = seg(i);
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [c, d] = seg(j);
      if (Math.max(c.x, d.x) < minX || Math.min(c.x, d.x) > maxX || Math.max(c.y, d.y) < minY || Math.min(c.y, d.y) > maxY) continue;
      const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
      if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    }
  }
  return false;
}
