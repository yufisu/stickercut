import { describe, it, expect } from 'vitest';
import {
  resampleClosed, gaussianClosed, tangentsClosed, curvatureClosed, detectCorners, fitG1Closed, isG1, selfIntersects,
} from '../../src/core/spline';
import { flattenClosedPath, type Pt, type Coord } from '../../src/core/geometry';

const circle = (n: number, r: number, cx = 0, cy = 0): Coord[] =>
  Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));

/** Düz kare: kenar başına m örnek. */
function square(size: number, m: number): Coord[] {
  const out: Coord[] = [];
  const corners = [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }];
  for (let c = 0; c < 4; c++) {
    const a = corners[c], b = corners[(c + 1) % 4];
    for (let k = 0; k < m; k++) out.push({ x: a.x + (b.x - a.x) * k / m, y: a.y + (b.y - a.y) * k / m });
  }
  return out;
}

/** Noktaların flatten edilmiş yola en büyük uzaklığı ve yolun noktalara en büyük uzaklığı. */
function deviation(samples: Coord[], path: Pt[]): number {
  const flat = flattenClosedPath(path, 0.02);
  const dist = (p: Coord, poly: Coord[]) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return best;
  };
  let worst = 0;
  for (const p of samples) worst = Math.max(worst, dist(p, flat));
  for (const p of flat) worst = Math.max(worst, dist(p, samples));
  return worst;
}

describe('resampleClosed / gaussianClosed', () => {
  it('eşit aralıklı örnekler, çevre korunur', () => {
    const out = resampleClosed(square(100, 7), 2.5);
    expect(out.length).toBe(160);
    const gaps = out.map((p, i) => Math.hypot(out[(i + 1) % out.length].x - p.x, out[(i + 1) % out.length].y - p.y));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    for (const g of gaps) expect(Math.abs(g - mean) / mean).toBeLessThan(0.01);
    expect(Math.abs(mean * out.length - 400)).toBeLessThan(0.5);
  });
  it('Gauss köşeleri yuvarlar, uzak kenarları değiştirmez, daireyi σ²/2R kadar küçültür', () => {
    const sq = resampleClosed(square(100, 10), 1);
    const smooth = gaussianClosed(sq, 4);
    const corner = smooth.reduce((b, p) => (Math.hypot(p.x, p.y) < Math.hypot(b.x, b.y) ? p : b), smooth[0]);
    expect(Math.hypot(corner.x, corner.y)).toBeGreaterThan(1.5);
    const mid = smooth.reduce((b, p) => (Math.abs(p.x - 50) + Math.abs(p.y) < Math.abs(b.x - 50) + Math.abs(b.y) ? p : b), smooth[0]);
    expect(Math.abs(mid.y)).toBeLessThan(1e-6);
    const c = gaussianClosed(circle(720, 100), 6);
    const r = c.map((p) => Math.hypot(p.x, p.y));
    const shrink = 100 - Math.max(...r);
    const sigmaUnits = 6 * (2 * Math.PI * 100 / 720); // σ, uzunluk biriminde
    expect(shrink).toBeGreaterThan(0);
    expect(shrink).toBeLessThan((sigmaUnits ** 2) / 200 * 1.1 + 1e-3);
  });
});

describe('teğet / eğrilik / köşe', () => {
  it('daire teğetleri yarıçapa dik, eğrilik 1/R', () => {
    const pts = circle(360, 50);
    const t = tangentsClosed(pts);
    for (let i = 0; i < pts.length; i += 30) expect(Math.abs(t[i].x * pts[i].x + t[i].y * pts[i].y)).toBeLessThan(1e-6);
    const k = curvatureClosed(pts);
    expect(Math.abs(k[10])).toBeCloseTo(1 / 50, 3);
  });
  it('yuvarlatılmış karede dört köşe bulunur, köşe noktası kesişimdir', () => {
    // 200×200 kare, köşeler r=10 yuvarlatılmış, 1 birim adımla örneklenmiş
    const pts: Coord[] = [];
    const r = 10, s = 200;
    const corners = [[s - r, r, -Math.PI / 2], [s - r, s - r, 0], [r, s - r, Math.PI / 2], [r, r, Math.PI]] as const;
    for (let c = 0; c < 4; c++) {
      const [cx, cy, a0] = corners[c];
      for (let k = 0; k <= 15; k++) {
        const a = a0 + (Math.PI / 2) * k / 15;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    }
    const rs = resampleClosed(pts, 1);
    const t = tangentsClosed(rs);
    const found = detectCorners(rs, t, 100, 20, 40);
    expect(found.length).toBe(4);
    const expected = [[s, 0], [s, s], [0, s], [0, 0]];
    for (const c of found) {
      const nearest = Math.min(...expected.map(([x, y]) => Math.hypot(c.vertex.x - x, c.vertex.y - y)));
      expect(nearest).toBeLessThan(0.5);
    }
    expect(detectCorners(resampleClosed(circle(360, 50), 1), tangentsClosed(resampleClosed(circle(360, 50), 1)), 100, 20)).toEqual([]);
  });
});

describe('fitG1Closed', () => {
  it('daire: ≤ 8 anchor, hepsi tutamaçlı, G1, yarıçap hatası < tolerans', () => {
    const pts = circle(360, 100);
    const path = fitG1Closed(pts, tangentsClosed(pts), 0.1);
    expect(path.length).toBeLessThanOrEqual(8);
    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path.every((p) => p.handleIn && p.handleOut)).toBe(true);
    expect(isG1(path)).toBe(true);
    for (const p of flattenClosedPath(path, 0.01)) expect(Math.abs(Math.hypot(p.x, p.y) - 100)).toBeLessThan(0.1);
  });
  it('organik şekil: iki yönlü sapma ≤ tolerans, az anchor, G1', () => {
    const pts = Array.from({ length: 720 }, (_, i) => {
      const a = (2 * Math.PI * i) / 720, r = 100 + 25 * Math.cos(5 * a);
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
    const tol = 0.25;
    const path = fitG1Closed(pts, tangentsClosed(pts), tol);
    expect(path.length).toBeLessThan(40);
    expect(path.every((p) => p.handleIn && p.handleOut)).toBe(true);
    expect(isG1(path)).toBe(true);
    expect(deviation(pts, path)).toBeLessThan(tol * 1.5);
  });
  it('dört köşeli kare: tam 4 anchor, tutamaçsız, köşeler tam yerinde', () => {
    const pts = resampleClosed(square(100, 10), 1);
    const t = tangentsClosed(pts);
    const corners = detectCorners(pts, t, 100, 3, 10);
    expect(corners.length).toBe(4);
    const path = fitG1Closed(pts, t, 5, corners);
    expect(path.length).toBe(4);
    expect(path.every((p) => !p.handleIn && !p.handleOut)).toBe(true);
    const xs = path.map((p) => Math.round(p.x)), ys = path.map((p) => Math.round(p.y));
    expect(xs.sort((a, b) => a - b)).toEqual([0, 0, 100, 100]);
    expect(ys.sort((a, b) => a - b)).toEqual([0, 0, 100, 100]);
  });
  it('sıkı tolerans tek kübik aralıkları kabul etmeye devam eder (sonsuz döngü yok)', () => {
    const pts = circle(64, 10);
    const path = fitG1Closed(pts, tangentsClosed(pts), 1e-6);
    expect(path.length).toBeGreaterThan(8);
    expect(path.length).toBeLessThanOrEqual(64);
    expect(isG1(path)).toBe(true);
  });
});

describe('selfIntersects', () => {
  it('sekiz şeklini yakalar, daireyi geçirir', () => {
    expect(selfIntersects(circle(50, 10))).toBe(false);
    const eight = Array.from({ length: 60 }, (_, i) => { const a = (2 * Math.PI * i) / 60; return { x: Math.sin(a), y: Math.sin(2 * a) }; });
    expect(selfIntersects(eight)).toBe(true);
  });
});
