import { describe, it, expect } from 'vitest';
import { checkLayout, polylineDistance } from '../../src/core/checks';
import { parsePack } from '../../src/core/project';
import type { Pt } from '../../src/core/geometry';

const pack = () => parsePack(JSON.stringify({
  version: 3, page: { widthMm: 80, heightMm: 120 }, designSize: { widthPx: 800, heightPx: 1200 },
  files: { design: 'd.png', background: 'b.png' }, items: [],
}));
/** 1 tasarım px = 0.1 mm. */
const circle = (cx: number, cy: number, r: number, n = 72): Pt[] =>
  Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));
const codes = (cuts: [string, Pt[]][], opts?: Parameters<typeof checkLayout>[2]) => checkLayout(pack(), new Map(cuts), opts);

describe('polylineDistance', () => {
  it('kesişen poligonlarda 0, ayrık olanlarda kenar uzaklığı', () => {
    expect(polylineDistance(circle(100, 100, 50), circle(160, 100, 50))).toBe(0);
    expect(polylineDistance(circle(100, 100, 50), circle(230, 100, 50))).toBeCloseTo(30, 0);
  });
});

describe('checkLayout', () => {
  it('1 mm boşlukta MIN_GAP (iki id ve mm ile), 3 mm boşlukta sessiz', () => {
    const near = codes([['i1', circle(200, 300, 100)], ['i2', circle(410, 300, 100)]]);
    expect(near.map((m) => m.code)).toEqual(['MIN_GAP']);
    expect(near[0].text).toContain('i1 ile i2');
    expect(near[0].text).toContain('1.0 mm');
    expect(codes([['i1', circle(200, 300, 100)], ['i2', circle(430, 300, 100)]])).toEqual([]);
    expect(codes([['i1', circle(200, 300, 100)], ['i2', circle(410, 300, 100)]], { minGapMm: 0 })).toEqual([]);
  });
  it('çakışan ve iç içe yollar yalnızca OVERLAP verir', () => {
    expect(codes([['i1', circle(200, 300, 100)], ['i2', circle(350, 300, 100)]]).map((m) => m.code)).toEqual(['OVERLAP']);
    expect(codes([['i1', circle(200, 300, 100)], ['i2', circle(200, 300, 30)]]).map((m) => m.code)).toEqual(['OVERLAP']);
  });
  it('sayfa dışı ve kenara yakınlık', () => {
    expect(codes([['i1', circle(50, 300, 100)]]).map((m) => m.code)).toEqual(['OUTSIDE_PAGE']);
    const margin = codes([['i1', circle(110, 300, 100)]]);
    expect(margin.map((m) => m.code)).toEqual(['PAGE_MARGIN']);
    expect(margin[0].text).toContain('1.0 mm');
    expect(codes([['i1', circle(110, 300, 100)]], { marginMm: 0 })).toEqual([]);
  });
});
