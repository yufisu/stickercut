import type { Pack, Item } from '../../../src/core/project';
import { isRegionItem, mmPerDesignPx, effectiveSettings } from '../../../src/core/project';
import { closedPathSvg, itemMatrix, apply, polygonBounds, type Pt, type Coord, type Affine } from '../../../src/core/geometry';
import { regionOutline } from '../../../src/core/contour';
import type { Message } from '../../../src/core/pipeline';
import type { FileEntry, CutEntry, Gesture, Camera, ViewMode, Prefs, ReferenceState } from '../app/store';
import type { Palette } from '../platform/theme';
import { pageOrigin, scaleOf, type Viewport, type PageMm } from './camera';
import { tickStep, ticks, formatMm } from './rulers';
import { gridStep } from './grid';
import type { Guide } from './snap';

export interface Frame {
  pack: Pack;
  files: ReadonlyMap<string, FileEntry>;
  cuts: ReadonlyMap<string, CutEntry>;
  selection: ReadonlySet<string>;
  gesture: Gesture | null;
  marquee: { a: Coord; b: Coord } | null;
  measure: { a: Coord; b: Coord } | null;
  camera: Camera;
  viewport: Viewport;
  dpr: number;
  mode: ViewMode;
  prefs: Prefs;
  palette: Palette;
  hoverId: string | null;
  focusedMarker: number | null;
  messages: Message[];
  reference: ReferenceState | null;
  showReference: boolean;
  tool: string;
}

const pathCache = new WeakMap<Pt[], Path2D>();
export function pathOf(pts: Pt[]): Path2D {
  let p = pathCache.get(pts);
  if (!p) { p = new Path2D(closedPathSvg(pts)); pathCache.set(pts, p); }
  return p;
}
const outlineCache = new WeakMap<object, Path2D>();
function regionPath(item: Item & { region: NonNullable<Item['region']> }): Path2D {
  let p = outlineCache.get(item.region);
  if (!p) { p = new Path2D(closedPathSvg(regionOutline(item.region))); outlineCache.set(item.region, p); }
  return p;
}

export const HANDLE_PX = 10;
export const HANDLE_HIT_PX = 14;
export const ROTATE_OFFSET_PX = 34;

/** Tasarım px → ekran CSS px dönüşümü (x ve y mm çarpanları farklı olabilir). */
export function designToScreenMatrix(f: Pick<Frame, 'pack' | 'camera' | 'viewport'>): Affine {
  const mm = mmPerDesignPx(f.pack), s = scaleOf(f.camera);
  const page: PageMm = { w: f.pack.page.widthMm, h: f.pack.page.heightMm };
  const o = pageOrigin(f.camera, f.viewport, page);
  return [mm.x * s, 0, 0, mm.y * s, o.x, o.y];
}

/** Hareket önizlemesiyle (sürükleme) efektif yerleşim. */
export function placed(item: Item, gesture: Gesture | null): Item {
  const p = gesture?.preview.get(item.id);
  return p ? { ...item, ...p } : item;
}

export function itemSize(item: Item, files: ReadonlyMap<string, FileEntry>): { w: number; h: number } | null {
  if (isRegionItem(item)) return { w: item.region.bbox.w, h: item.region.bbox.h };
  const f = item.file === null ? undefined : files.get(item.file);
  return f ? { w: f.width, h: f.height } : null;
}

/** Öğenin ekranda kapladığı dikdörtgen (tasarım px): taze kesim varsa kesim sınırı, yoksa görsel köşeleri. */
export function itemBox(item: Item, f: Pick<Frame, 'files' | 'cuts' | 'gesture'>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const it = placed(item, f.gesture);
  const cut = f.cuts.get(item.id);
  if (cut && !item.printOnly && !f.gesture?.preview.has(item.id)) return polygonBounds(cut.points);
  const size = itemSize(item, f.files);
  if (!size) return null;
  const m = itemMatrix(it, size.w, size.h);
  return polygonBounds([apply(m, { x: 0, y: 0 }), apply(m, { x: size.w, y: 0 }), apply(m, { x: size.w, y: size.h }), apply(m, { x: 0, y: size.h })]);
}

/** Sürükleme sırasında kesim yolunu yeniden hesaplamadan taşır: eski matris⁻¹ ∘ yeni matris. */
function previewCutPath(item: Item, f: Frame, size: { w: number; h: number }): { path: Path2D; m: Affine } | null {
  const cut = f.cuts.get(item.id);
  if (!cut) return null;
  const p = f.gesture?.preview.get(item.id);
  if (!p) return { path: pathOf(cut.points), m: [1, 0, 0, 1, 0, 0] };
  const from = itemMatrix(item, size.w, size.h), to = itemMatrix({ ...item, ...p }, size.w, size.h);
  const inv = invert(from);
  return { path: pathOf(cut.points), m: multiply(to, inv) };
}
function invert(m: Affine): Affine {
  const [a, b, c, d, e, g] = m, det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * g - d * e) / det, (b * e - a * g) / det];
}
function multiply(m1: Affine, m2: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

export function drawScene(g: CanvasRenderingContext2D, f: Frame): void {
  const { pack, files, palette } = f;
  const dpr = f.dpr, W = f.viewport.width, H = f.viewport.height;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const M = designToScreenMatrix(f);
  const { widthPx: dw, heightPx: dh } = pack.designSize;
  const scaleX = M[0], scaleY = M[3];
  // Sayfa gölgesi
  g.save();
  g.shadowColor = palette.pageShadow; g.shadowBlur = 22; g.shadowOffsetY = 8;
  g.fillStyle = palette.page;
  g.fillRect(M[4], M[5], dw * scaleX, dh * scaleY);
  g.restore();
  g.save();
  g.beginPath(); g.rect(M[4], M[5], dw * scaleX, dh * scaleY); g.clip();
  g.setTransform(dpr * M[0], 0, 0, dpr * M[3], dpr * M[4], dpr * M[5]);
  g.imageSmoothingQuality = 'high';
  const bg = files.get(pack.files.background), design = files.get(pack.files.design);
  const lineW = 1 / Math.max(scaleX, scaleY);

  if (f.mode !== 'cut') {
    if (bg) g.drawImage(bg.bitmap, 0, 0, dw, dh);
    // Beyaz kenar dolguları (baskı sayfasındaki gibi)
    for (const item of pack.items) {
      const cut = f.cuts.get(item.id);
      if (!cut || item.printOnly || !effectiveSettings(pack, item).whiteBorder) continue;
      const size = itemSize(item, files);
      if (!size) continue;
      const pc = previewCutPath(item, f, size);
      if (!pc) continue;
      g.save(); g.transform(...pc.m); g.fillStyle = '#fff'; g.fill(pc.path); g.restore();
    }
    for (const item of pack.items) {
      const it = placed(item, f.gesture);
      if (isRegionItem(item)) {
        if (!design) continue;
        const { bbox } = item.region;
        g.save(); g.transform(...itemMatrix(it, bbox.w, bbox.h)); g.clip(regionPath(item));
        g.drawImage(design.bitmap, -bbox.x, -bbox.y, dw, dh); g.restore();
        continue;
      }
      const file = item.file === null ? undefined : files.get(item.file);
      if (!file) continue;
      g.save(); g.transform(...itemMatrix(it, file.width, file.height));
      g.drawImage(file.bitmap, 0, 0, file.width, file.height); g.restore();
    }
  } else if (f.prefs.ghostInCutView) {
    g.save(); g.globalAlpha = 0.18;
    if (bg) g.drawImage(bg.bitmap, 0, 0, dw, dh);
    for (const item of pack.items) {
      const it = placed(item, f.gesture);
      const size = itemSize(item, files);
      if (!size) continue;
      if (isRegionItem(item)) { if (!design) continue; g.save(); g.transform(...itemMatrix(it, size.w, size.h)); g.clip(regionPath(item)); g.drawImage(design.bitmap, -item.region.bbox.x, -item.region.bbox.y, dw, dh); g.restore(); continue; }
      const file = files.get(item.file!)!;
      g.save(); g.transform(...itemMatrix(it, size.w, size.h)); g.drawImage(file.bitmap, 0, 0, size.w, size.h); g.restore();
    }
    g.restore();
  }

  // Kesim çizgileri
  const showCuts = f.mode === 'cut' || (f.mode === 'edit' && f.prefs.showCuts);
  if (showCuts) {
    g.save();
    g.strokeStyle = palette.cut;
    g.lineJoin = 'round';
    for (const item of pack.items) {
      if (item.printOnly) continue;
      const size = itemSize(item, files);
      if (!size) continue;
      const pc = previewCutPath(item, f, size);
      if (!pc) continue;
      const pt = effectiveSettings(pack, item).strokeWidthPt;
      g.lineWidth = f.mode === 'cut' ? Math.max(lineW, (pt / 2.834645669) / (mmPerDesignPx(pack).x)) : 1.5 * lineW;
      g.save(); g.transform(...pc.m); g.stroke(pc.path); g.restore();
    }
    g.restore();
  }
  // Referans (Illustrator) yolları
  if (f.reference && f.showReference && f.mode !== 'print') {
    g.save();
    g.fillStyle = palette.referenceFill;
    for (const b of f.reference.borders) g.fill(pathOf(b));
    g.strokeStyle = palette.reference; g.lineWidth = 2 * lineW; g.setLineDash([8 * lineW, 5 * lineW]); g.lineJoin = 'round';
    for (const c of f.reference.cuts) g.stroke(pathOf(c));
    g.restore();
  }

  g.restore();
}

export function drawOverlay(g: CanvasRenderingContext2D, f: Frame): void {
  const { pack, palette } = f;
  const dpr = f.dpr, W = f.viewport.width, H = f.viewport.height;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const M = designToScreenMatrix(f);
  const mm = mmPerDesignPx(pack);
  const s = scaleOf(f.camera); // css px / mm
  const toScreen = (p: Coord) => ({ x: M[0] * p.x + M[4], y: M[3] * p.y + M[5] });
  const page = { x: M[4], y: M[5], w: pack.designSize.widthPx * M[0], h: pack.designSize.heightPx * M[3] };

  // Izgara (mm)
  if (f.prefs.grid && f.mode === 'edit') {
    const step = gridStep(s);
    if (step) {
      g.save(); g.beginPath(); g.rect(page.x, page.y, page.w, page.h); g.clip();
      for (const [stepMm, color] of [[step.minor, palette.grid], [step.major, palette.gridMajor]] as const) {
        if (!stepMm) continue;
        g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
        for (let x = 0; x <= pack.page.widthMm + 1e-6; x += stepMm) { const sx = Math.round(page.x + x * s) + 0.5; g.moveTo(sx, page.y); g.lineTo(sx, page.y + page.h); }
        for (let y = 0; y <= pack.page.heightMm + 1e-6; y += stepMm) { const sy = Math.round(page.y + y * s) + 0.5; g.moveTo(page.x, sy); g.lineTo(page.x + page.w, sy); }
        g.stroke();
      }
      g.restore();
    }
  }

  // Bölge işaretleri (eşleşmeyen çizimler)
  for (const m of f.messages) {
    if ((m.code !== 'UNMATCHED_REGION' && m.code !== 'REGION_ITEM') || !m.region || !m.marker) continue;
    const a = toScreen({ x: m.region.x, y: m.region.y }), b = toScreen({ x: m.region.x + m.region.w, y: m.region.y + m.region.h });
    const focused = m.marker === f.focusedMarker;
    g.save();
    g.fillStyle = focused ? 'rgba(224,108,37,.22)' : 'rgba(224,108,37,.10)';
    g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    g.strokeStyle = palette.review; g.lineWidth = focused ? 2 : 1.5; g.setLineDash(focused ? [] : [6, 4]);
    g.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
    g.restore();
  }

  // Hover
  if (f.hoverId && !f.selection.has(f.hoverId) && !f.gesture) {
    const item = pack.items.find((i) => i.id === f.hoverId);
    const b = item && itemBox(item, f);
    if (b) { const a = toScreen({ x: b.minX, y: b.minY }), c = toScreen({ x: b.maxX, y: b.maxY }); g.save(); g.strokeStyle = palette.selection; g.globalAlpha = 0.5; g.lineWidth = 1; g.strokeRect(a.x + 0.5, a.y + 0.5, c.x - a.x, c.y - a.y); g.restore(); }
  }

  // Seçim: tek öğe → öğe çerçevesi (döndürülmüş) + tutamaçlar; çoklu → ortak bbox
  const selected = pack.items.filter((i) => f.selection.has(i.id));
  for (const item of selected) {
    const size = itemSize(item, f.files);
    if (!size) continue;
    const it = placed(item, f.gesture);
    const m = itemMatrix(it, size.w, size.h);
    const corners = [apply(m, { x: 0, y: 0 }), apply(m, { x: size.w, y: 0 }), apply(m, { x: size.w, y: size.h }), apply(m, { x: 0, y: size.h })].map(toScreen);
    g.save();
    g.strokeStyle = palette.selection; g.lineWidth = 1.5; g.setLineDash(selected.length > 1 ? [5, 4] : []);
    g.beginPath(); corners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
    g.restore();
  }
  if (selected.length) {
    const h = selectionHandles(f);
    if (h) {
      g.save();
      g.strokeStyle = palette.selection; g.lineWidth = 1.5; g.fillStyle = palette.page;
      if (selected.length > 1) { g.setLineDash([]); g.strokeRect(h.box.x + 0.5, h.box.y + 0.5, h.box.w, h.box.h); }
      g.beginPath(); g.moveTo(h.top.x, h.top.y); g.lineTo(h.rotate.x, h.rotate.y); g.stroke();
      for (const p of h.corners) { g.beginPath(); g.rect(p.x - HANDLE_PX / 2, p.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX); g.fill(); g.stroke(); }
      g.beginPath(); g.arc(h.rotate.x, h.rotate.y, HANDLE_PX / 2 + 1, 0, Math.PI * 2); g.fill(); g.stroke();
      g.restore();
    }
  }

  // Kılavuzlar
  if (f.gesture?.guides.length) {
    g.save(); g.strokeStyle = palette.guide; g.lineWidth = 1; g.setLineDash([4, 3]);
    for (const gd of f.gesture.guides) {
      const a = gd.axis === 'x' ? toScreen({ x: gd.atMm / mm.x, y: gd.fromMm / mm.y }) : toScreen({ x: gd.fromMm / mm.x, y: gd.atMm / mm.y });
      const b = gd.axis === 'x' ? toScreen({ x: gd.atMm / mm.x, y: gd.toMm / mm.y }) : toScreen({ x: gd.toMm / mm.x, y: gd.atMm / mm.y });
      g.beginPath(); g.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5); g.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5); g.stroke();
    }
    g.restore();
  }

  // Seçim dikdörtgeni (marquee)
  if (f.marquee) {
    const a = toScreen(f.marquee.a), b = toScreen(f.marquee.b);
    g.save(); g.fillStyle = 'rgba(45,107,208,.08)'; g.strokeStyle = palette.selection; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y); g.restore();
  }

  // Ölçü
  if (f.measure) {
    const a = toScreen(f.measure.a), b = toScreen(f.measure.b);
    const dx = (f.measure.b.x - f.measure.a.x) * mm.x, dy = (f.measure.b.y - f.measure.a.y) * mm.y;
    g.save(); g.strokeStyle = palette.ink; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    for (const p of [a, b]) { g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2); g.fillStyle = palette.ink; g.fill(); }
    const label = `${Math.hypot(dx, dy).toFixed(1)} mm  (${Math.abs(dx).toFixed(1)} × ${Math.abs(dy).toFixed(1)})`;
    g.font = '12px ' + getComputedStyle(document.body).fontFamily;
    const tw = g.measureText(label).width + 12, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 14;
    g.fillStyle = palette.panel; g.strokeStyle = palette.line; g.lineWidth = 1;
    g.beginPath(); roundRect(g, mx - tw / 2, my - 10, tw, 20, 6); g.fill(); g.stroke();
    g.fillStyle = palette.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, mx, my);
    g.restore();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
}

export interface Handles { box: { x: number; y: number; w: number; h: number }; corners: Coord[]; top: Coord; rotate: Coord; centre: Coord; rotationDeg: number }

/** Seçimin tutamaçları ekran px'inde: tek öğede döndürülmüş köşeler, çoklu seçimde ortak dikdörtgen. */
export function selectionHandles(f: Pick<Frame, 'pack' | 'files' | 'cuts' | 'gesture' | 'selection' | 'camera' | 'viewport'>): Handles | null {
  const M = designToScreenMatrix(f);
  const toScreen = (p: Coord) => ({ x: M[0] * p.x + M[4], y: M[3] * p.y + M[5] });
  const selected = f.pack.items.filter((i) => f.selection.has(i.id));
  if (!selected.length) return null;
  if (selected.length === 1) {
    const item = selected[0], size = itemSize(item, f.files);
    if (!size) return null;
    const it = placed(item, f.gesture);
    const m = itemMatrix(it, size.w, size.h);
    const corners = [apply(m, { x: 0, y: 0 }), apply(m, { x: size.w, y: 0 }), apply(m, { x: size.w, y: size.h }), apply(m, { x: 0, y: size.h })].map(toScreen);
    const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const centre = toScreen({ x: it.x, y: it.y });
    const d = Math.hypot(top.x - centre.x, top.y - centre.y) || 1;
    const rotate = { x: top.x + ((top.x - centre.x) / d) * ROTATE_OFFSET_PX, y: top.y + ((top.y - centre.y) / d) * ROTATE_OFFSET_PX };
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    return { box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, corners, top, rotate, centre, rotationDeg: it.rotationDeg };
  }
  const boxes = selected.map((i) => itemBox(i, f)).filter((b): b is NonNullable<typeof b> => !!b);
  if (!boxes.length) return null;
  const a = toScreen({ x: Math.min(...boxes.map((b) => b.minX)), y: Math.min(...boxes.map((b) => b.minY)) });
  const b = toScreen({ x: Math.max(...boxes.map((b) => b.maxX)), y: Math.max(...boxes.map((b) => b.maxY)) });
  const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  const top = { x: (a.x + b.x) / 2, y: a.y };
  return { box: { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, corners, top, rotate: { x: top.x, y: top.y - ROTATE_OFFSET_PX }, centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, rotationDeg: 0 };
}

/** Cetveller: mm cinsinden, tuval üstü ve solu. */
export function drawRulers(gx: CanvasRenderingContext2D, gy: CanvasRenderingContext2D, f: Frame, cursorMm: Coord | null): void {
  const dpr = f.dpr, W = f.viewport.width, H = f.viewport.height, T = 22;
  const s = scaleOf(f.camera);
  const M = designToScreenMatrix(f);
  const ox = M[4], oy = M[5];
  const step = tickStep(s);
  const font = `10px ${getComputedStyle(document.body).fontFamily}`;
  for (const [g, horizontal] of [[gx, true], [gy, false]] as const) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const len = horizontal ? W : H;
    g.clearRect(0, 0, horizontal ? W : T, horizontal ? T : H);
    g.fillStyle = f.palette.ruler; g.fillRect(0, 0, horizontal ? W : T, horizontal ? T : H);
    g.strokeStyle = f.palette.rulerInk; g.fillStyle = f.palette.rulerInk; g.lineWidth = 1; g.font = font;
    const origin = horizontal ? ox : oy;
    const fromMm = (T - origin) / s, toMm = (len - origin) / s;
    g.beginPath();
    for (const v of ticks(Math.floor(fromMm / step.minor) * step.minor, toMm, step.minor)) {
      const p = Math.round(origin + v * s) + 0.5;
      const major = Math.abs(v / step.major - Math.round(v / step.major)) < 1e-6;
      const h = major ? 9 : 4;
      if (horizontal) { g.moveTo(p, T); g.lineTo(p, T - h); } else { g.moveTo(T, p); g.lineTo(T - h, p); }
    }
    g.stroke();
    g.textBaseline = 'top'; g.textAlign = 'left';
    for (const v of ticks(Math.floor(fromMm / step.major) * step.major, toMm, step.major)) {
      const p = origin + v * s;
      if (horizontal) g.fillText(formatMm(v), p + 3, 2);
      else { g.save(); g.translate(2, p + 3); g.rotate(Math.PI / 2); g.fillText(formatMm(v), 0, -12); g.restore(); }
    }
    if (cursorMm) {
      const p = origin + (horizontal ? cursorMm.x : cursorMm.y) * s;
      g.fillStyle = f.palette.cut;
      if (horizontal) g.fillRect(p - 0.5, 0, 1.5, T); else g.fillRect(0, p - 0.5, T, 1.5);
    }
  }
}
