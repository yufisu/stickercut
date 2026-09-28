import { describe, it, expect } from 'vitest';
import { legacyRegion, regionLocation, unmatchedRegionText } from '../../src/core/region-label';

describe('bölge uyarıları', () => {
  it('piksel koordinatı yerine sayfadaki konumu ve işaret numarasını anlatır', () => {
    const b = { x: 811, y: 1406, w: 205, h: 446 };
    expect(regionLocation(b, 1102, 1929)).toBe('sağ alt bölümündeki');
    const text = unmatchedRegionText(b, 1102, 1929, 2);
    expect(text).toContain('Bölge 2');
    expect(text).toContain('turuncu 2 işaretine');
    expect(text).not.toContain('x=');
  });

  it('eski projede saklı koordinatlı uyarıyı işaretlenebilir bölgeye çevirir', () => {
    expect(legacyRegion('Tasarımda eşleşmeyen bir bölge var (x=415, y=489, 119×124 px)')).toEqual({
      x: 415, y: 489, w: 119, h: 124,
    });
  });
});
