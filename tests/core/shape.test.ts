import { describe, it, expect } from 'vitest';
import { createMask, maskArea, labelComponents, type Mask } from '../../src/core/raster';
import { signedDistance, squaredDistance, closeMask, openMask } from '../../src/core/distance';
import {
  alphaCoverage, selectParts, bridgeParts, traceCrack, isoContour, roundedRect, encodeRle, decodeRle, fitRectangle, rectFitPath,
} from '../../src/core/shape';
import { flattenClosedPath, polygonBounds, type Pt } from '../../src/core/geometry';
import { paint } from '../helpers/scene';

function maskFrom(rows: string[]): Mask {
  const m = createMask(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => { m.data[y * m.width + x] = c === '#' ? 1 : 0; }));
  return m;
}

function disc(size: number, cx: number, cy: number, r: number, m = createMask(size, size)): Mask {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) m.data[y * size + x] = 1;
  }
  return m;
}

const components = (m: Mask) => labelComponents(m).areas.length - 1;

/** Her anchor'da giren ve çıkan tutamaç doğrultuları aynı mı (G1)? */
function isG1(path: Pt[], maxDeg = 0.5): boolean {
  for (let i = 0; i < path.length; i++) {
    const p = path[i], prev = path[(i + path.length - 1) % path.length], next = path[(i + 1) % path.length];
    const tin = p.handleIn ? { x: p.x - p.handleIn.x, y: p.y - p.handleIn.y } : { x: p.x - prev.x, y: p.y - prev.y };
    const tout = p.handleOut ? { x: p.handleOut.x - p.x, y: p.handleOut.y - p.y } : { x: next.x - p.x, y: next.y - p.y };
    const a = Math.atan2(tin.y, tin.x), b = Math.atan2(tout.y, tout.x);
    let d = Math.abs(a - b) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    if (d > maxDeg) return false;
  }
  return true;
}

describe('distance alanları', () => {
  it('signedDistance içeride negatif, dışarıda pozitif, kenarda ±1', () => {
    const m = disc(64, 32, 32, 10);
    const f = signedDistance(m);
    expect(f[32 * 64 + 32]).toBeLessThan(-9.3); // merkez: en yakın boş piksel ~9.4–10 px
    expect(f[32 * 64 + 32]).toBeGreaterThanOrEqual(-10);
    expect(f[0]).toBeGreaterThan(30);
    // Doğrudan sınır komşuları: içeride −1, dışarıda +1
    expect(f[32 * 64 + 41]).toBe(-1); // x=41.5 → r≈9.5 içeride
    expect(f[32 * 64 + 42]).toBe(1);
  });
  it('closeMask dar girintiyi köprüler, geniş olanı bırakır', () => {
    const m = disc(120, 60, 60, 40);
    for (let y = 0; y < 60; y++) for (let x = 55; x < 65; x++) m.data[y * 120 + x] = 0; // 10 px genişlik, üstten merkeze kadar
    expect(maskArea(closeMask(m, 6))).toBeGreaterThan(maskArea(m) + 200);
    expect(maskArea(closeMask(m, 4))).toBeLessThan(maskArea(m) + 60);
  });
  it('openMask ince çıkıntıyı atar', () => {
    const m = disc(120, 60, 60, 30);
    for (let y = 0; y < 30; y++) for (let x = 57; x < 63; x++) m.data[y * 120 + x] = 1; // 6 px genişlik
    const opened = openMask(m, 4);
    expect(opened.data[5 * 120 + 60]).toBe(0);
    expect(opened.data[60 * 120 + 60]).toBe(1);
  });
});

describe('alphaCoverage', () => {
  it('f=1 ve pad=0 iken alphaMask ile aynı', () => {
    const r = paint(10, 10, (x, y) => (x < 5 ? [0, 0, 0, 255] : y < 3 ? [0, 0, 0, 100] : null));
    const m = alphaCoverage(r, 128, 1, 0);
    expect(m.width).toBe(10);
    expect(maskArea(m)).toBe(50);
  });
  it('küçültürken blok ortalamasını eşikler ve pad ekler', () => {
    const r = paint(100, 100, (x, y) => (x < 50 ? [0, 0, 0, 255] : null));
    const m = alphaCoverage(r, 128, 0.1, 3);
    expect([m.width, m.height]).toEqual([16, 16]);
    expect(maskArea(m)).toBe(50);
    expect(m.data[3 * 16 + 3]).toBe(1);
    expect(m.data[3 * 16 + 8]).toBe(0);
  });
});

describe('selectParts / bridgeParts', () => {
  it('küçük lekeleri atar, oranı bildirir', () => {
    const m = disc(100, 30, 50, 20);
    disc(100, 80, 50, 4, m); // alan ≈ 50 → %4
    disc(100, 80, 20, 2, m);
    const r = selectParts(m, 0.1);
    expect(r.kept).toBe(1);
    expect(r.droppedRatio).toBeGreaterThan(0.03);
    expect(r.droppedRatio).toBeLessThan(0.06);
    expect(components(r.mask)).toBe(1);
  });
  it('yakın parçayı boyun dolgusuyla bağlar, uzak olanı atar', () => {
    const m = createMask(300, 200);
    disc(300, 70, 100, 30, m);
    disc(300, 170, 100, 30, m); // aralık 40
    disc(300, 270, 100, 15, m); // aralık 55 (ikinci diske), ana diske 140
    const near = bridgeParts(m, 50);
    expect(near.bridged).toBe(1);
    expect(components(near.mask)).toBe(1);
    expect(near.droppedRatio).toBeGreaterThan(0.2);
    // Dolgu yalnızca iki disk arasındaki boyunda: alan artışı sınırlı
    const base = maskArea(m) - Math.round(Math.PI * 15 * 15);
    expect(maskArea(near.mask)).toBeGreaterThan(base + 500);
    expect(maskArea(near.mask)).toBeLessThan(base + 4000);
    const none = bridgeParts(m, 30);
    expect(none.bridged).toBe(0);
    expect(components(none.mask)).toBe(1);
  });
});

describe('traceCrack', () => {
  it('tek piksel 4, 2×2 blok 8, L şekli 10 kenar', () => {
    expect(traceCrack(maskFrom(['.#.', '...'])).length).toBe(4);
    expect(traceCrack(maskFrom(['##', '##'])).length).toBe(8);
    expect(traceCrack(maskFrom(['#.', '#.', '##'])).length).toBe(10);
  });
  it('kenarlarda dolu piksel sağda kalır ve çapraz boğaz tek döngüde izlenir', () => {
    const edges = traceCrack(maskFrom(['#.', '.#']));
    expect(edges.length).toBe(8);
    const m = maskFrom(['#.', '.#']);
    for (const e of edges) {
      expect(m.data[e.ay * 2 + e.ax]).toBe(1);
      const outside = e.bx < 0 || e.by < 0 || e.bx >= 2 || e.by >= 2 || m.data[e.by * 2 + e.bx] === 0;
      expect(outside).toBe(true);
    }
  });
});

describe('isoContour', () => {
  it('dairenin SDF seviye 0 konturu yarıçapı alt piksel hassasiyetle verir', () => {
    const m = disc(256, 128, 128, 100);
    const f = signedDistance(m);
    const { points, area } = isoContour(f, 256, 256, 0);
    expect(area).toBe(maskArea(m));
    expect(points.length).toBeGreaterThan(500);
    for (const p of points) expect(Math.abs(Math.hypot(p.x - 128, p.y - 128) - 100)).toBeLessThan(0.6);
  });
  it('seviye 20 ile 20 px büyür', () => {
    const f = signedDistance(disc(256, 128, 128, 100));
    for (const p of isoContour(f, 256, 256, 20).points) expect(Math.abs(Math.hypot(p.x - 128, p.y - 128) - 120)).toBeLessThan(0.6);
  });
  it('yalnızca en büyük parçayı izler, diğerlerini bildirir', () => {
    const m = disc(200, 60, 100, 40);
    disc(200, 160, 100, 10, m);
    const r = isoContour(squaredDistance(m), 200, 200, 0);
    expect(r.otherAreas.length).toBe(1);
    const b = polygonBounds(r.points);
    expect(b.maxX).toBeLessThan(110);
  });
});

describe('roundedRect', () => {
  it('yarıçap 0 → dört düz köşe, bugünkü çıktı', () => {
    expect(roundedRect(200, 100, 0, 0)).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]);
    expect(roundedRect(200, 100, -3, 0)[0]).toEqual({ x: 3, y: 3 });
    expect(roundedRect(10, 10, -6, 0)).toEqual([]);
  });
  it('yuvarlak köşeler: 8 anchor, G1, sınırlar ofsetli, yay noktası doğru yarıçapta', () => {
    const pts = roundedRect(200, 100, 5, 20);
    expect(pts.length).toBe(8);
    expect(isG1(pts)).toBe(true);
    const b = polygonBounds(pts);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([-5, -5, 205, 105]);
    // Sol üst yay (son → ilk anchor): orta noktası köşe merkezi (15,15)'e 20 uzaklıkta
    const flat = flattenClosedPath(pts, 0.01);
    const arcPoint = flat.reduce((best, p) => {
      const d = Math.abs(Math.atan2(p.y - 15, p.x - 15) + 3 * Math.PI / 4);
      return d < best.d ? { d, p } : best;
    }, { d: Infinity, p: flat[0] }).p;
    expect(Math.abs(Math.hypot(arcPoint.x - 15, arcPoint.y - 15) - 20)).toBeLessThan(0.05);
    // Yarıçap boyutla sınırlanır
    expect(polygonBounds(roundedRect(20, 10, 0, 50)).maxX).toBeCloseTo(20, 5);
  });
});

describe('rle', () => {
  it('gidiş dönüş ve doğrulama', () => {
    const m = maskFrom(['..##.', '#####', '.....', '#..#.']);
    const rle = encodeRle(m);
    expect(rle).toBe('2,2,1,5,5,1,2,1,1');
    expect(decodeRle(rle, 5, 4).data).toEqual(m.data);
    expect(encodeRle(createMask(3, 2))).toBe('6');
    expect(() => decodeRle('5', 5, 4)).toThrow(/uyuşmuyor/);
    expect(() => decodeRle('!,1', 1, 1)).toThrow(/bozuk/);
  });
});

describe('fitRectangle', () => {
  /** Merkez (cx, cy), w×h, derece cinsinden dönük dikdörtgen; köşe yarıçapı r. */
  function rectMask(W: number, H: number, cx: number, cy: number, w: number, h: number, deg = 0, r = 0) {
    const m = createMask(W, H);
    const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = Math.abs(dx * c + dy * s) - (w / 2 - r), v = Math.abs(-dx * s + dy * c) - (h / 2 - r);
      if (Math.hypot(Math.max(u, 0), Math.max(v, 0)) <= r && u <= r && v <= r) m.data[y * W + x] = 1;
    }
    return m;
  }
  const size = (f: NonNullable<ReturnType<typeof fitRectangle>>) => [f.umax - f.umin, f.vmax - f.vmin].sort((a, b) => a - b);

  it('eksene paralel dikdörtgeni tam piksel kenarlarıyla bulur ve 4 düz köşeye çevirir', () => {
    const f = fitRectangle(rectMask(300, 200, 150, 100, 200, 120), 2)!;
    expect(f).not.toBeNull();
    expect(size(f)).toEqual([120, 200]);
    const path = rectFitPath(f, 0, 0);
    expect(path).toHaveLength(4);
    expect(path.every((p) => !p.handleIn && !p.handleOut)).toBe(true);
    const b = polygonBounds(path);
    expect([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v))).toEqual([50, 40, 250, 160]);
    const grown = polygonBounds(rectFitPath(f, 5, 0));
    expect([grown.minX, grown.maxY].map((v) => Math.round(v))).toEqual([45, 165]);
    expect(rectFitPath(f, 0, 10)).toHaveLength(8);
  });

  it('döndürülmüş dikdörtgeni de bulur', () => {
    const f = fitRectangle(rectMask(400, 400, 200, 200, 220, 140, 17), 2)!;
    expect(f).not.toBeNull();
    const [a, b] = size(f);
    expect(a).toBeCloseTo(140, -0.5);
    expect(b).toBeCloseTo(220, -0.5);
    const angle = (Math.atan2(f.uy, f.ux) * 180) / Math.PI;
    expect(Math.min(...[17, 107, -73, -163, 197].map((d) => Math.abs(((angle - d + 540) % 360) - 180)))).toBeLessThan(1.5);
  });

  it('yuvarlak köşeli kart, daire, girintili ve çıkıntılı şekil dikdörtgen sayılmaz', () => {
    expect(fitRectangle(rectMask(300, 200, 150, 100, 200, 120, 0, 20), 2)).toBeNull();
    const disc = createMask(200, 200);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) if (Math.hypot(x - 100, y - 100) < 80) disc.data[y * 200 + x] = 1;
    expect(fitRectangle(disc, 2)).toBeNull();
    const notch = rectMask(300, 200, 150, 100, 200, 120);
    for (let y = 40; y < 52; y++) for (let x = 140; x < 160; x++) notch.data[y * 300 + x] = 0;
    expect(fitRectangle(notch, 2)).toBeNull();
    const bump = rectMask(300, 200, 150, 100, 200, 120);
    for (let y = 30; y < 40; y++) for (let x = 140; x < 160; x++) bump.data[y * 300 + x] = 1;
    expect(fitRectangle(bump, 2)).toBeNull();
  });
});
