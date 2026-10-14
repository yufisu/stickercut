import { describe, it, expect } from 'vitest';
import { createMask, type Raster } from '../../src/core/raster';
import {
  traceBoundary, simplifyClosed, stickerCutShape, cutShapeFromMask, regionOutline, StickerError, type CutShapeOptions,
} from '../../src/core/contour';
import { flattenClosedPath, polygonBounds, pointInPolygon, type Pt } from '../../src/core/geometry';
import { isG1 } from '../../src/core/spline';
import { encodeRle } from '../../src/core/shape';

function raster(w: number, h: number, fn: (x: number, y: number) => number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    data[o] = 200; data[o + 1] = 50; data[o + 2] = 50; data[o + 3] = fn(x, y);
  }
  return { width: w, height: h, data };
}
const square = (size: number, fn: (x: number, y: number) => number) => raster(size, size, fn);
const inCircle = (x: number, y: number, cx: number, cy: number, r: number) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
const radii = (pts: Pt[], cx: number, cy: number) => flattenClosedPath(pts, 0.05).map((p) => Math.hypot(p.x - cx, p.y - cy));
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const lines = (pts: Pt[]) => pts.filter((p, i) => !p.handleOut && !pts[(i + 1) % pts.length].handleIn).length;

/** 10 px = 1 mm. Varsayılan testlerde kapama/yumuşatma kapalıya yakın. */
const base: CutShapeOptions = {
  pxPerMm: 10, alphaThreshold: 128, offsetMm: 0, closingMm: 0, cornerRadiusMm: 0, rectCornerRadiusMm: 0,
  smoothMm: 0.1, simplifyMm: 0.05, cornerAngleDeg: 0, bridgeMm: 0, minPartRatio: 0.01, tightMm: 0,
};

describe('traceBoundary / simplifyClosed', () => {
  it('3x3 karenin 8 kenar pikselini sırayla verir; tek piksel tek nokta; boş maske boş', () => {
    const m = createMask(5, 5);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) m.data[y * 5 + x] = 1;
    const pts = traceBoundary(m);
    expect(pts).toHaveLength(8);
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(8);
    const one = createMask(3, 3);
    expect(traceBoundary(one)).toEqual([]);
    one.data[4] = 1;
    expect(traceBoundary(one)).toEqual([{ x: 1, y: 1 }]);
  });
  it('simplifyClosed düz çizgi üzerindeki ara noktaları atar', () => {
    const pts: Pt[] = [];
    for (let x = 0; x < 10; x++) pts.push({ x, y: 0 });
    for (let y = 1; y < 10; y++) pts.push({ x: 9, y });
    for (let x = 8; x >= 0; x--) pts.push({ x, y: 9 });
    for (let y = 8; y > 0; y--) pts.push({ x: 0, y });
    expect(simplifyClosed(pts, 0.5)).toHaveLength(4);
  });
});

describe('stickerCutShape — daire ve ofset', () => {
  const disc = square(400, (x, y) => (inCircle(x, y, 200, 200, 100) ? 255 : 0));
  it('sıfır ofsette yarıçapı 0.05 mm içinde korur, tamamen kübik ve G1', () => {
    const s = stickerCutShape(disc, base);
    const rs = radii(s.points, 200, 200);
    expect(Math.abs(mean(rs) - 100)).toBeLessThan(0.5);
    expect(Math.max(...rs.map((r) => Math.abs(r - 100)))).toBeLessThan(1);
    expect(lines(s.points)).toBe(0);
    expect(isG1(s.points)).toBe(true);
    expect(s.points.length).toBeLessThanOrEqual(12);
    expect(s.extraPartsRatio).toBe(0);
    expect(s.stats.anchors).toBe(s.points.length);
  });
  it('+2 mm ofset yarıçapı tam 2 mm büyütür, −2 mm küçültür, aşırı içe ofset hata verir', () => {
    expect(Math.abs(mean(radii(stickerCutShape(disc, { ...base, offsetMm: 2 }).points, 200, 200)) - 120)).toBeLessThan(0.5);
    expect(Math.abs(mean(radii(stickerCutShape(disc, { ...base, offsetMm: -2 }).points, 200, 200)) - 80)).toBeLessThan(0.5);
    expect(() => stickerCutShape(disc, { ...base, offsetMm: -15 })).toThrow('İçe ofset');
  });
});

describe('stickerCutShape — sıkılık, parçalar, köşeler', () => {
  it('1 mm girintiyi closingMm 1 köprüler, closingMm 0 izler; ikisi de G1', () => {
    const notched = square(400, (x, y) => (inCircle(x, y, 200, 200, 100) && !(Math.abs(x + 0.5 - 200) < 5 && y < 140) ? 255 : 0));
    const closed = stickerCutShape(notched, { ...base, closingMm: 1 });
    const open = stickerCutShape(notched, { ...base, closingMm: 0 });
    // Kapama köprüsü ağız genişliğine göre hafif sarkar (10 − √(10²−5²) ≈ 1.3 px); girinti yine de dolu.
    expect(Math.min(...radii(closed.points, 200, 200))).toBeGreaterThan(98);
    expect(Math.min(...radii(open.points, 200, 200))).toBeLessThan(65);
    expect(isG1(closed.points)).toBe(true);
    expect(isG1(open.points)).toBe(true);
  });
  it('tırtıklı kenar: düz segment yok, G1, az anchor', () => {
    const rippled = square(400, (x, y) => {
      const a = Math.atan2(y + 0.5 - 200, x + 0.5 - 200);
      return inCircle(x, y, 200, 200, 100 + 3 * Math.cos(40 * a)) ? 255 : 0;
    });
    const s = stickerCutShape(rippled, { ...base, closingMm: 1, smoothMm: 0.2, simplifyMm: 0.06 });
    expect(lines(s.points)).toBe(0);
    expect(isG1(s.points)).toBe(true);
    expect(s.points.length).toBeLessThanOrEqual(60);
    const tight = stickerCutShape(rippled, { ...base, closingMm: 0, smoothMm: 0.1, simplifyMm: 0 });
    expect(tight.points.length).toBeGreaterThan(s.points.length);
    expect(lines(tight.points)).toBe(0);
  });
  it('iki disk: bridgeMm 0 büyüğü keser ve oranı bildirir, bridgeMm 8 ikisini tek yolda birleştirir', () => {
    const two = raster(400, 300, (x, y) => (inCircle(x, y, 100, 150, 60) || inCircle(x, y, 290, 150, 60) ? 255 : 0));
    const single = stickerCutShape(two, base);
    expect(single.extraPartsRatio).toBeGreaterThan(0.3);
    expect(single.partsBridged).toBe(0);
    expect(pointInPolygon({ x: 290, y: 150 }, single.points)).toBe(false);
    const joined = stickerCutShape(two, { ...base, bridgeMm: 8 });
    expect(joined.partsBridged).toBe(1);
    expect(joined.extraPartsRatio).toBe(0);
    expect(pointInPolygon({ x: 100, y: 150 }, joined.points)).toBe(true);
    expect(pointInPolygon({ x: 290, y: 150 }, joined.points)).toBe(true);
    expect(isG1(joined.points)).toBe(true);
  });
  it('köşe koruma açıkken kare 4 köşeli düz yol olur', () => {
    const sq = square(300, (x, y) => (x >= 50 && x < 250 && y >= 50 && y < 250 ? 255 : 0));
    const s = stickerCutShape(sq, { ...base, cornerAngleDeg: 100, simplifyMm: 0.3 });
    expect(s.points.length).toBe(4);
    expect(lines(s.points)).toBe(4);
    const b = polygonBounds(s.points);
    expect(Math.abs(b.minX - 50)).toBeLessThan(0.6);
    expect(Math.abs(b.maxX - 250)).toBeLessThan(0.6);
  });
  it('ince çıkıntı: cornerRadius > offset çıkıntıyı siler ve çizime girer; cornerRadius 0 dışarıda kalır', () => {
    const spiky = square(400, (x, y) => (inCircle(x, y, 200, 200, 100) || (Math.abs(x + 0.5 - 200) < 1.5 && y >= 70 && y < 110) ? 255 : 0));
    const rounded = stickerCutShape(spiky, { ...base, offsetMm: 0.5, cornerRadiusMm: 1, tightMm: 0.3 });
    expect(rounded.clearance.minMm).toBeLessThan(-0.05); // çıkıntı 2 px: iç uzaklık 1 px = 0.1 mm
    expect(rounded.clearance.insideRatio).toBeGreaterThan(0);
    const plain = stickerCutShape(spiky, { ...base, offsetMm: 0.5, cornerRadiusMm: 0, tightMm: 0.3 });
    expect(plain.clearance.minMm).toBeGreaterThan(0.35);
  });
});

describe('stickerCutShape — temizlik, dikdörtgen, uç durumlar', () => {
  it('kaçak lekeyi atar, iç boşluğu doldurur', () => {
    const r = square(400, (x, y) => {
      if (x < 20 && y < 20) return 200;
      return inCircle(x, y, 200, 200, 100) && !inCircle(x, y, 200, 200, 60) ? 255 : 0;
    });
    const { points, extraPartsRatio } = stickerCutShape(r, base);
    const rs = radii(points, 200, 200);
    expect(Math.min(...rs)).toBeGreaterThan(98);
    expect(Math.max(...rs)).toBeLessThan(102);
    expect(pointInPolygon({ x: 200, y: 200 }, points)).toBe(true);
    expect(extraPartsRatio).toBeGreaterThan(0);
    expect(extraPartsRatio).toBeLessThan(0.05);
  });
  it('tam opak PNG: dikdörtgen, ofset ve yuvarlak köşe', () => {
    const solid = raster(200, 100, () => 255);
    expect(stickerCutShape(solid, base).points).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]);
    const rounded = stickerCutShape(solid, { ...base, offsetMm: 0.5, rectCornerRadiusMm: 2 });
    expect(rounded.points.length).toBe(8);
    expect(isG1(rounded.points)).toBe(true);
    const b = polygonBounds(rounded.points);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([-5, -5, 205, 105]);
    expect(stickerCutShape(solid, { ...base, offsetMm: -0.5 }).points[0]).toEqual({ x: 5, y: 5 });
    expect(() => stickerCutShape(solid, { ...base, offsetMm: -6 })).toThrow('İçe ofset');
  });
  it('tamamen şeffaf PNG için EMPTY', () => {
    try { stickerCutShape(square(50, () => 0), base); expect.unreachable(); }
    catch (e) { expect((e as StickerError).code).toBe('EMPTY'); }
  });
  it('2–3 px minik şekiller piksel kenarı dikdörtgenine yakın kalır', () => {
    for (const size of [2, 3]) {
      const r = square(12, (x, y) => (x >= 4 && x < 4 + size && y >= 4 && y < 4 + size ? 255 : 0));
      const b = polygonBounds(stickerCutShape(r, { ...base, smoothMm: 0.3 }).points);
      expect(Math.abs(b.minX - 4)).toBeLessThan(0.7);
      expect(Math.abs(b.maxX - (4 + size))).toBeLessThan(0.7);
      expect(Math.abs(b.minY - 4)).toBeLessThan(0.7);
    }
  });
  it('3000 px görüntüyü küçültüp orijinal koordinatlara 0.05 mm içinde geri ölçekler', () => {
    const r = square(3000, (x, y) => (inCircle(x, y, 1500, 1500, 1000) ? 255 : 0));
    const s = stickerCutShape(r, { ...base, pxPerMm: 100 });
    const rs = radii(s.points, 1500, 1500);
    expect(Math.abs(mean(rs) - 1000)).toBeLessThan(5);
    expect(s.stats.workSize).toBeLessThanOrEqual(1024);
    expect(s.stats.ms).toBeLessThan(2000);
  });
});

describe('cutShapeFromMask / regionOutline', () => {
  it('bölge maskesinden kesim üretir; bbox\'ı dolduran maske dikdörtgen olur', () => {
    const m = createMask(120, 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 120; x++) if (inCircle(x, y, 60, 50, 40)) m.data[y * 120 + x] = 1;
    const s = cutShapeFromMask(m, { ...base, pxPerMm: 20 });
    expect(Math.abs(mean(radii(s.points, 60, 50)) - 40)).toBeLessThan(0.5);
    expect(isG1(s.points)).toBe(true);
    const full = createMask(50, 30);
    full.data.fill(1);
    expect(cutShapeFromMask(full, { ...base, rectCornerRadiusMm: 0 }).points).toHaveLength(4);
    expect(() => cutShapeFromMask(createMask(5, 5), base)).toThrow(/boş/i);
  });
  it('regionOutline kare maskeyi 4 köşeye indirir', () => {
    const m = createMask(10, 10);
    m.data.fill(1);
    const outline = regionOutline({ bbox: { x: 0, y: 0, w: 10, h: 10 }, rle: encodeRle(m) });
    expect(outline).toHaveLength(4);
    const b = polygonBounds(outline);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 10, 10]);
  });
});
