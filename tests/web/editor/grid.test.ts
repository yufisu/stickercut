import { describe, it, expect } from 'vitest';
import { gridStep, GRID_MAJOR_MM } from '../../../web/src/editor/grid';
import { PX_PER_MM_AT_1 } from '../../../web/src/editor/camera';

describe('grid', () => {
  it('ana çizgi 10 mm; ince 1 mm ≥ 8 px, yoksa 5 mm, o da yoksa null', () => {
    expect(GRID_MAJOR_MM).toBe(10);
    expect(gridStep(8)).toEqual({ major: 10, minor: 1 });
    expect(gridStep(20)).toEqual({ major: 10, minor: 1 });
    expect(gridStep(7.9)).toEqual({ major: 10, minor: 5 });
    expect(gridStep(PX_PER_MM_AT_1)).toEqual({ major: 10, minor: 5 }); // %100: 5 mm = 18.9 px
    expect(gridStep(1.6)).toEqual({ major: 10, minor: 5 }); // 5 mm = 8 px
    expect(gridStep(1.5)).toEqual({ major: 10, minor: null }); // 5 mm = 7.5 px, 10 mm = 15 px
    expect(gridStep(1.2)).toEqual({ major: 10, minor: null }); // 10 mm = 12 px
  });

  it('10 mm 12 px\'in altındaysa ızgara çizilmez', () => {
    expect(gridStep(1.19)).toBeNull();
    expect(gridStep(0.1 * PX_PER_MM_AT_1)).toBeNull();
    expect(gridStep(NaN)).toBeNull();
  });

  it('eşikler değiştirilebilir', () => {
    expect(gridStep(1, 4, 10)).toEqual({ major: 10, minor: 5 });
  });
});
