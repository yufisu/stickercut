import type { Pt } from './geometry';

type Vec = { x: number; y: number };
type Cubic = [Vec, Vec, Vec, Vec];
interface Segment { start: Vec; end: Vec; controls?: [Vec, Vec] }
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
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

/** Least-squares cubic with fixed endpoint tangents and bounded, positive handle lengths. */
function generate(points: Vec[], u: number[], left: Vec, right: Vec): Cubic {
  const a = points[0], b = points.at(-1)!;
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < points.length; i++) {
    const t = u[i], s = 1 - t;
    const b0 = s ** 3, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t ** 3;
    const v0 = { x: left.x * b1, y: left.y * b1 }, v1 = { x: right.x * b2, y: right.y * b2 };
    const residual = { x: points[i].x - a.x * (b0 + b1) - b.x * (b2 + b3),
      y: points[i].y - a.y * (b0 + b1) - b.y * (b2 + b3) };
    c00 += dot(v0, v0); c01 += dot(v0, v1); c11 += dot(v1, v1);
    x0 += dot(v0, residual); x1 += dot(v1, residual);
  }
  const det = c00 * c11 - c01 * c01, chord = length(sub(b, a));
  let alpha = det ? (x0 * c11 - x1 * c01) / det : 0;
  let beta = det ? (c00 * x1 - c01 * x0) / det : 0;
  if (alpha < chord * 1e-6 || beta < chord * 1e-6 || alpha > chord * 3 || beta > chord * 3) {
    alpha = beta = chord / 3;
  }
  return [a, shifted(a, left, alpha), shifted(b, right, beta), b];
}

function fit(points: Vec[], tolerance: number, left: Vec, right: Vec, depth = 0): Segment[] {
  const a = points[0], b = points.at(-1)!;
  if (points.length === 2 || points.every((p) => segmentDistance(p, a, b) <= tolerance)) {
    return [{ start: a, end: b }];
  }
  const u = [0];
  for (let i = 1; i < points.length; i++) u.push(u[i - 1] + length(sub(points[i], points[i - 1])));
  const total = u.at(-1)!;
  for (let i = 1; i < u.length; i++) u[i] /= total;
  let curve = generate(points, u, left, right);
  let split = (points.length / 2) | 0;
  for (let iteration = 0; iteration < 5; iteration++) {
    let error = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const d = length(sub(at(curve, u[i]), points[i]));
      if (d > error) { error = d; split = i; }
    }
    // Also bound the fitted curve between source samples, so handles cannot bulge unnoticed.
    for (let i = 0; i < points.length - 1; i++) {
      for (const f of [0.25, 0.5, 0.75]) {
        const d = segmentDistance(at(curve, u[i] + (u[i + 1] - u[i]) * f), points[i], points[i + 1]);
        if (d > error) { error = d; split = Math.max(1, Math.min(points.length - 2, i)); }
      }
    }
    if (error <= tolerance) return [{ start: a, end: b, controls: [curve[1], curve[2]] }];
    if (depth >= 20) break;
    // Newton projection improves chord-length parameters without changing their order.
    const next = u.slice();
    for (let i = 1; i < u.length - 1; i++) {
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
  if (depth >= 20) return points.slice(1).map((end, i) => ({ start: points[i], end }));
  const tangent = unit(sub(points[split + 1], points[split - 1]));
  return [...fit(points.slice(0, split + 1), tolerance, left, { x: -tangent.x, y: -tangent.y }, depth + 1),
    ...fit(points.slice(split), tolerance, tangent, right, depth + 1)];
}

/** Detect persistent corners over a neighborhood, rather than every pixel-staircase turn. */
export function contourCorners(points: Vec[], thresholdDeg: number, reach: number): number[] {
  const n = points.length;
  if (n < 4 || thresholdDeg <= 0) return [];
  const candidates: { i: number; angle: number }[] = [];
  for (let i = 0; i < n; i++) {
    const neighbor = (step: number) => {
      let distance = 0, j = i;
      for (let k = 0; k < (n - 1) / 2 && distance < reach; k++) {
        const next = (j + step + n) % n;
        distance += length(sub(points[next], points[j])); j = next;
      }
      return points[j];
    };
    const before = unit(sub(neighbor(-1), points[i])), after = unit(sub(neighbor(1), points[i]));
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(before, after)))) * 180 / Math.PI;
    if (angle < thresholdDeg) candidates.push({ i, angle });
  }
  candidates.sort((a, b) => a.angle - b.angle || a.i - b.i);
  const kept: number[] = [];
  for (const { i } of candidates) {
    if (kept.every((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) > reach)) kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}

/** Fit independent corner-bounded spans; smooth spans share tangents at their seam. */
export function fitClosedCurves(points: Vec[], tolerance: number, corners: number[]): Pt[] {
  if (points.length < 4 || tolerance <= 0) return points.map((p) => ({ ...p }));
  const n = points.length, hard = new Set(corners);
  const breaks = new Set(corners);
  // Cornerless closed curves need several initial spans to keep fitting well-conditioned.
  if (breaks.size < 3) {
    for (const i of [0, (n / 4) | 0, (n / 2) | 0, (3 * n / 4) | 0]) breaks.add(i);
  }
  const indices = [...breaks].sort((a, b) => a - b), segments: Segment[] = [];
  for (let k = 0; k < indices.length; k++) {
    const start = indices[k], end = indices[(k + 1) % indices.length];
    const span = [points[start]];
    for (let i = (start + 1) % n; i !== end; i = (i + 1) % n) span.push(points[i]);
    span.push(points[end]);
    const tangent = (i: number, side: 'start' | 'end') => {
      if (hard.has(i)) return unit(sub(points[(i + (side === 'start' ? 1 : n - 1)) % n], points[i]));
      const v = sub(points[(i + 1) % n], points[(i + n - 1) % n]);
      return unit(side === 'start' ? v : { x: -v.x, y: -v.y });
    };
    segments.push(...fit(span, tolerance, tangent(start, 'start'), tangent(end, 'end')));
  }
  const result: Pt[] = segments.map((segment) => ({ ...segment.start }));
  for (let i = 0; i < segments.length; i++) {
    const controls = segments[i].controls;
    if (controls) { result[i].handleOut = controls[0]; result[(i + 1) % result.length].handleIn = controls[1]; }
  }
  return result;
}
