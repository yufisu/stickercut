import type { PageMm } from './camera';

/** Eksenlere hizalı kutu (mm ya da çağıranın uzayı). */
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** axis 'x': x = atMm dikey çizgi (from/to y aralığı); 'y': y = atMm yatay çizgi (from/to x aralığı). */
export interface Guide { axis: 'x' | 'y'; atMm: number; fromMm: number; toMm: number; kind: 'page' | 'item' | 'grid' }

export interface SnapResult { dx: number; dy: number; guides: Guide[] }

const lines = (axis: Guide['axis'], kind: Guide['kind'], lo: number, hi: number, fromMm: number, toMm: number): Guide[] =>
  [lo, (lo + hi) / 2, hi].map((atMm) => ({ axis, atMm, fromMm, toMm, kind }));

const shift = (b: Bounds, dx: number, dy: number): Bounds => ({ minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy });

/** Sayfa kenarları + orta çizgileri ve diğer öğelerin kenar + merkezleri. Izgara çizgileri snapDelta'da gridMm ile tembel üretilir. */
export function snapCandidates(page: PageMm, others: Bounds[]): Guide[] {
  const out = [...lines('x', 'page', 0, page.w, 0, page.h), ...lines('y', 'page', 0, page.h, 0, page.w)];
  for (const b of others) out.push(...lines('x', 'item', b.minX, b.maxX, b.minY, b.maxY), ...lines('y', 'item', b.minY, b.maxY, b.minX, b.maxX));
  return out;
}

interface Match { correction: number; guide: Guide }

/** min, merkez ve max konumlarını adaylarla ve en yakın ızgara çizgisiyle karşılaştırır; eşik içindeki en küçük düzeltme kazanır, eşitlikte aday ızgaradan önce gelir. */
function snapAxis(axis: Guide['axis'], positions: number[], candidates: Guide[], gridMm: number | null, thresholdMm: number): Match | null {
  const matches: Match[] = [];
  for (const guide of candidates) if (guide.axis === axis) for (const p of positions) matches.push({ correction: guide.atMm - p, guide });
  if (gridMm && gridMm > 0) for (const p of positions) {
    const atMm = Math.round(p / gridMm) * gridMm;
    matches.push({ correction: atMm - p, guide: { axis, atMm, fromMm: 0, toMm: 0, kind: 'grid' } });
  }
  let best: Match | null = null;
  for (const m of matches) if (Math.abs(m.correction) <= thresholdMm && (!best || Math.abs(m.correction) < Math.abs(best.correction))) best = m;
  return best;
}

/** Kılavuzun uzanımı: ızgara için taşınan kutu, diğerleri için kutu ile eşleşen sayfa/öğe uzanımının birleşimi. */
const span = (g: Guide, lo: number, hi: number): Guide =>
  g.kind === 'grid' ? { ...g, fromMm: lo, toMm: hi } : { ...g, fromMm: Math.min(g.fromMm, lo), toMm: Math.max(g.toMm, hi) };

/** (dx, dy) ile taşınan kutuyu eksen eksen yapıştırır; düzeltilmiş deltaları ve kullanılan kılavuzları döndürür. */
export function snapDelta(moving: Bounds, dx: number, dy: number, candidates: Guide[], gridMm: number | null, thresholdMm: number): SnapResult {
  const moved = shift(moving, dx, dy);
  const x = snapAxis('x', [moved.minX, (moved.minX + moved.maxX) / 2, moved.maxX], candidates, gridMm, thresholdMm);
  const y = snapAxis('y', [moved.minY, (moved.minY + moved.maxY) / 2, moved.maxY], candidates, gridMm, thresholdMm);
  const cx = x?.correction ?? 0, cy = y?.correction ?? 0;
  const final = shift(moved, cx, cy);
  const guides: Guide[] = [];
  if (x) guides.push(span(x.guide, final.minY, final.maxY));
  if (y) guides.push(span(y.guide, final.minX, final.maxX));
  return { dx: dx + cx, dy: dy + cy, guides };
}
