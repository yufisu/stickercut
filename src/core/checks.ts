import type { Pack } from './project';
import { aspectMismatch } from './project';
import { type Pt, polygonBounds, pointInPolygon, flattenClosedPath } from './geometry';
import type { Message } from './pipeline';

export function checkLayout(pack: Pack, cuts: Map<string, Pt[]>): Message[] {
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
  const entries = [...cuts.entries()].map(([id, pts]) => ({ id, pts: flattenClosedPath(pts), b: polygonBounds(pts) }));
  for (const e of entries) {
    if (e.b.minX < 0 || e.b.minY < 0 || e.b.maxX > W || e.b.maxY > H) {
      out.push({ level: 'warning', code: 'OUTSIDE_PAGE', itemId: e.id, text: `${e.id} kesim çizgisi sayfanın dışına taşıyor.` });
    }
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.b.maxX < b.b.minX || b.b.maxX < a.b.minX || a.b.maxY < b.b.minY || b.b.maxY < a.b.minY) continue;
      const hit = a.pts.some((p) => pointInPolygon(p, b.pts)) || b.pts.some((p) => pointInPolygon(p, a.pts));
      if (hit) out.push({ level: 'warning', code: 'OVERLAP', itemId: a.id, text: `${a.id} ile ${b.id} kesim çizgileri çakışıyor.` });
    }
  }
  return out;
}
