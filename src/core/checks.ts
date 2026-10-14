import type { Pack } from './project';
import { aspectMismatch, mmPerDesignPx } from './project';
import { type Pt, type Coord, polygonBounds, pointInPolygon, flattenClosedPath } from './geometry';
import type { Message } from './pipeline';

export interface CheckOptions {
  /** Komşu kesim çizgileri arasında istenen en az boşluk (mm); 0 = kontrol etme. */
  minGapMm?: number;
  /** Sayfa kenarına istenen en az uzaklık (mm); 0 = kontrol etme. */
  marginMm?: number;
}

const DEFAULT_CHECKS: Required<CheckOptions> = { minGapMm: 2, marginMm: 2 };

function segmentsIntersect(a: Coord, b: Coord, c: Coord, d: Coord): boolean {
  const o = (p: Coord, q: Coord, r: Coord) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function pointSegment2(p: Coord, a: Coord, b: Coord): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

/** İki kapalı poligonun kenarları arasındaki en küçük uzaklık (kesişiyorlarsa 0). */
export function polylineDistance(a: Coord[], b: Coord[]): number {
  let best = Infinity;
  const bb = polygonBounds(b);
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i], a1 = a[(i + 1) % a.length];
    const minX = Math.min(a0.x, a1.x), maxX = Math.max(a0.x, a1.x), minY = Math.min(a0.y, a1.y), maxY = Math.max(a0.y, a1.y);
    const reach = Math.sqrt(best);
    if (maxX < bb.minX - reach || minX > bb.maxX + reach || maxY < bb.minY - reach || minY > bb.maxY + reach) continue;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j], b1 = b[(j + 1) % b.length];
      if (Math.min(b0.x, b1.x) > maxX + reach || Math.max(b0.x, b1.x) < minX - reach
        || Math.min(b0.y, b1.y) > maxY + reach || Math.max(b0.y, b1.y) < minY - reach) continue;
      if (segmentsIntersect(a0, a1, b0, b1)) return 0;
      const d = Math.min(pointSegment2(a0, b0, b1), pointSegment2(a1, b0, b1), pointSegment2(b0, a0, a1), pointSegment2(b1, a0, a1));
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export function checkLayout(pack: Pack, cuts: Map<string, Pt[]>, opts: CheckOptions = {}): Message[] {
  const o = { ...DEFAULT_CHECKS, ...opts };
  const out: Message[] = [];
  const mismatch = aspectMismatch(pack);
  if (mismatch > 0.01) {
    const suggested = Math.round((pack.page.widthMm * pack.designSize.heightPx / pack.designSize.widthPx) * 10) / 10;
    out.push({
      level: 'warning', code: 'ASPECT',
      text: `Sayfa oranı tasarımla uyuşmuyor (%${(mismatch * 100).toFixed(1)} fark). ${pack.page.widthMm} mm genişlik için yükseklik ${suggested} mm olmalı.`,
    });
  }
  const { widthPx: W, heightPx: H } = pack.designSize;
  const mm = mmPerDesignPx(pack);
  const pxPerMm = 1 / Math.max(mm.x, mm.y);
  const entries = [...cuts.entries()].map(([id, pts]) => ({ id, pts: flattenClosedPath(pts, 2), b: polygonBounds(pts) }));
  const marginPx = o.marginMm * pxPerMm;
  for (const e of entries) {
    if (e.b.minX < 0 || e.b.minY < 0 || e.b.maxX > W || e.b.maxY > H) {
      out.push({ level: 'warning', code: 'OUTSIDE_PAGE', itemId: e.id, text: `${e.id} kesim çizgisi sayfanın dışına taşıyor.` });
    } else if (marginPx > 0 && (e.b.minX < marginPx || e.b.minY < marginPx || e.b.maxX > W - marginPx || e.b.maxY > H - marginPx)) {
      const d = Math.min(e.b.minX, e.b.minY, W - e.b.maxX, H - e.b.maxY) * mm.x;
      out.push({ level: 'warning', code: 'PAGE_MARGIN', itemId: e.id,
        text: `${e.id} kesim çizgisi sayfa kenarına ${d.toFixed(1)} mm yaklaşıyor (önerilen en az ${o.marginMm} mm).` });
    }
  }
  const gapPx = o.minGapMm * pxPerMm;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.b.maxX + gapPx < b.b.minX || b.b.maxX + gapPx < a.b.minX || a.b.maxY + gapPx < b.b.minY || b.b.maxY + gapPx < a.b.minY) continue;
      const d = polylineDistance(a.pts, b.pts);
      const nested = d > 0 && (pointInPolygon(a.pts[0], b.pts) || pointInPolygon(b.pts[0], a.pts));
      if (d === 0 || nested) {
        out.push({ level: 'warning', code: 'OVERLAP', itemId: a.id, text: `${a.id} ile ${b.id} kesim çizgileri çakışıyor.` });
      } else if (gapPx > 0 && d < gapPx) {
        out.push({ level: 'warning', code: 'MIN_GAP', itemId: a.id,
          text: `${a.id} ile ${b.id} arasındaki boşluk ${(d * mm.x).toFixed(1)} mm; en az ${o.minGapMm} mm önerilir.` });
      }
    }
  }
  return out;
}
