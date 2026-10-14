import { describe, it, expect } from 'vitest';
import { STEPS, tickStep, ticks, formatMm } from '../../../web/src/editor/rulers';
import { PX_PER_MM_AT_1 } from '../../../web/src/editor/camera';

describe('rulers', () => {
  it('tickStep: ince çizgi ≥ 6 px, etiket ≥ 40 px ve ince adımın katı', () => {
    expect(tickStep(PX_PER_MM_AT_1)).toEqual({ minor: 2, major: 20 }); // %100: 2 mm = 7.6 px, 10 mm = 37.8 px yetmez
    expect(tickStep(10)).toEqual({ minor: 1, major: 5 });
    expect(tickStep(30)).toEqual({ minor: 0.5, major: 2 });
    expect(tickStep(100)).toEqual({ minor: 0.5, major: 0.5 });
    expect(tickStep(1)).toEqual({ minor: 10, major: 50 });
    expect(tickStep(0.35)).toEqual({ minor: 20, major: 100 }); // 50 katı değil, 100 etikete yetmese de son çare
    expect(tickStep(0.01)).toEqual({ minor: 100, major: 100 });
    expect(tickStep(10, 12, 20)).toEqual({ minor: 2, major: 2 });
  });

  it('tickStep her zoom için tutarlı: major, minor\'ın katı ve eşiklerin üstünde', () => {
    for (let px = 0.35; px <= 130; px *= 1.17) {
      const { minor, major } = tickStep(px);
      expect(STEPS).toContain(minor);
      expect(STEPS).toContain(major);
      expect(major).toBeGreaterThanOrEqual(minor);
      expect(major / minor).toBeCloseTo(Math.round(major / minor), 9);
      if (minor * px < 6) expect(minor).toBe(100);
      if (major * px < 40) expect(major).toBe(100);
    }
  });

  it('ticks aralıktaki katları sınırlar dahil ve yuvarlama hatasız üretir', () => {
    expect(ticks(0, 10, 2)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks(-0.3, 1.2, 0.5)).toEqual([0, 0.5, 1]);
    expect(ticks(0.1, 0.9, 0.1)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(ticks(0.3 * 3, 1.8, 0.9)).toEqual([0.9, 1.8]);
    expect(ticks(-7, -2, 5)).toEqual([-5]);
    expect(ticks(3, 3, 1)).toEqual([3]);
    expect(ticks(5, 3, 1)).toEqual([]);
    expect(ticks(0, 10, 0)).toEqual([]);
  });

  it('formatMm sondaki sıfırları atar, nokta kullanır', () => {
    expect(formatMm(12.5)).toBe('12.5');
    expect(formatMm(10)).toBe('10');
    expect(formatMm(0.1 + 0.2)).toBe('0.3');
    expect(formatMm(2.346)).toBe('2.35');
    expect(formatMm(-0.001)).toBe('0');
    expect(formatMm(-4.5)).toBe('-4.5');
    expect(formatMm(1 / 3, 1)).toBe('0.3');
    expect(formatMm(1 / 3, 0)).toBe('0');
  });
});
