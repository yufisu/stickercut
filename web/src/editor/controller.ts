import { batch } from '@preact/signals';
import { store, type Gesture } from '../app/store';
import { select, setPlacement, itemOutline, itemBounds, addStickerItem } from '../app/actions/edit';
import { savePrefs } from '../app/actions/autosave';
import { mmPerDesignPx, type Item } from '../../../src/core/project';
import { pointInPolygon, type Coord } from '../../../src/core/geometry';
import { screenToMm, zoomAt, panBy, type Viewport, type PageMm } from './camera';
import { snapCandidates, snapDelta, type Bounds } from './snap';
import { selectionHandles, itemBox, HANDLE_HIT_PX, designToScreenMatrix } from './renderer';
import { isTouch } from '../platform/env';

type Mode =
  | { kind: 'idle' }
  | { kind: 'pressed'; id: string | null; start: Coord; screen: Coord; additive: boolean; wasSelected: boolean }
  | { kind: 'moving'; start: Coord; orig: Map<string, Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg'>> }
  | { kind: 'scaling' | 'rotating'; start: Coord; orig: Map<string, Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg'>>; centre: Coord; startAngle: number; startDist: number }
  | { kind: 'marquee'; start: Coord; additive: boolean }
  | { kind: 'panning'; last: Coord; returnTo: typeof store.tool.value | null }
  | { kind: 'pinching'; dist: number; centre: Coord }
  | { kind: 'measuring'; start: Coord }
  | { kind: 'region'; start: Coord }
  | { kind: 'placing'; start: Coord };

export interface ControllerHost {
  el: HTMLElement;
  /** Bölge aracı bir dikdörtgen çizince (tasarım px). */
  onRegion(rect: { x: number; y: number; w: number; h: number }, screen: Coord): void;
  /** Ekle aracıyla boş yere dokununca (tasarım px). */
  onPlace(at: Coord, screen: Coord): void;
}

const DRAG_PX = () => (isTouch ? 8 : 4);

/** İşaretçi/klavye durum makinesi: seçim, taşıma, ölçek, döndürme, gez, pinch, ölçü, bölge, ekleme. */
export class Controller {
  private mode: Mode = { kind: 'idle' };
  private pointers = new Map<number, Coord>();
  private spaceDown = false;
  private ac = new AbortController();

  constructor(private host: ControllerHost) {
    const el = host.el, s = this.ac.signal;
    el.addEventListener('pointerdown', this.down, { signal: s });
    el.addEventListener('pointermove', this.move, { signal: s });
    el.addEventListener('pointerup', this.up, { signal: s });
    el.addEventListener('pointercancel', this.cancel, { signal: s });
    el.addEventListener('lostpointercapture', this.lost, { signal: s });
    el.addEventListener('wheel', this.wheel, { passive: false, signal: s });
    el.addEventListener('dblclick', this.dblclick, { signal: s });
    el.addEventListener('contextmenu', (e) => { if (this.mode.kind !== 'idle') e.preventDefault(); }, { signal: s });
    el.addEventListener('pointerleave', () => { store.cursorMm.value = null; store.hoverId.value = null; }, { signal: s });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(t, (e) => e.preventDefault(), { signal: s });
    window.addEventListener('keydown', this.key, { signal: s });
    window.addEventListener('keyup', this.key, { signal: s });
  }

  destroy(): void { this.ac.abort(); }

  // --- yardımcılar ---
  private get frame() {
    const pack = store.doc.value!;
    return { pack, files: store.files.value, cuts: store.cuts, gesture: store.gesture.value, selection: store.selection.value, camera: store.camera.value, viewport: this.viewport };
  }
  private get viewport(): Viewport { const r = this.host.el.getBoundingClientRect(); return { width: r.width, height: r.height }; }
  private get page(): PageMm { const d = store.doc.value!; return { w: d.page.widthMm, h: d.page.heightMm }; }
  private screenOf(e: PointerEvent | MouseEvent): Coord { const r = this.host.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private toDesign(screen: Coord): Coord {
    const M = designToScreenMatrix(this.frame);
    return { x: (screen.x - M[4]) / M[0], y: (screen.y - M[5]) / M[3] };
  }
  private toMm(screen: Coord): Coord { return screenToMm(store.camera.value, this.viewport, this.page, screen); }

  private hit(p: Coord): string | null {
    const doc = store.doc.value!;
    const M = designToScreenMatrix(this.frame);
    const inflate = 12 / Math.min(M[0], M[3]);
    for (let i = doc.items.length - 1; i >= 0; i--) {
      const item = doc.items[i];
      const outline = itemOutline(item);
      if (!outline) continue;
      const b = itemBounds(item);
      const tiny = b && (b.maxX - b.minX < 2 * inflate || b.maxY - b.minY < 2 * inflate);
      if (tiny && b) { if (p.x >= b.minX - inflate && p.x <= b.maxX + inflate && p.y >= b.minY - inflate && p.y <= b.maxY + inflate) return item.id; continue; }
      if (pointInPolygon(p, outline)) return item.id;
    }
    return null;
  }

  private handleAt(screen: Coord): 'scale' | 'rotate' | null {
    const h = selectionHandles(this.frame);
    if (!h) return null;
    const r = isTouch ? HANDLE_HIT_PX + 8 : HANDLE_HIT_PX;
    if (Math.hypot(screen.x - h.rotate.x, screen.y - h.rotate.y) <= r) return 'rotate';
    for (const c of h.corners) if (Math.hypot(screen.x - c.x, screen.y - c.y) <= r) return 'scale';
    return null;
  }

  private snapshot(): Map<string, Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg'>> {
    const doc = store.doc.value!;
    return new Map(doc.items.filter((i) => store.selection.value.has(i.id)).map((i) => [i.id, { x: i.x, y: i.y, scale: i.scale, rotationDeg: i.rotationDeg }]));
  }

  private preview(g: Gesture | null): void { store.gesture.value = g; }

  private commitGesture(): void {
    const g = store.gesture.value;
    store.gesture.value = null;
    store.marquee.value = null;
    if (!g) return;
    setPlacement(g.preview);
  }

  // --- olaylar ---
  private down = (e: PointerEvent): void => {
    if (!store.doc.value) return;
    const screen = this.screenOf(e);
    this.pointers.set(e.pointerId, screen);
    this.host.el.setPointerCapture(e.pointerId);
    (this.host.el as HTMLElement).focus?.({ preventScroll: true });
    if (this.pointers.size === 2) {
      // İkinci parmak: süren hareketi iptal et, pinch'e geç
      this.preview(null); store.marquee.value = null;
      const [a, b] = [...this.pointers.values()];
      this.mode = { kind: 'pinching', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (this.pointers.size > 2) return;
    const tool = store.tool.value;
    const p = this.toDesign(screen);
    const panTrigger = e.button === 1 || this.spaceDown || tool === 'pan' || (e.shiftKey && tool === 'select' && e.pointerType !== 'touch' && !this.hit(p) && !this.handleAt(screen));
    if (panTrigger) { e.preventDefault(); this.mode = { kind: 'panning', last: screen, returnTo: null }; return; }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    store.focusedMarker.value = null;
    if (tool === 'measure') { this.mode = { kind: 'measuring', start: p }; store.measure.value = { a: p, b: p }; return; }
    if (tool === 'region') { this.mode = { kind: 'region', start: p }; store.marquee.value = { a: p, b: p }; return; }
    if (tool === 'add') { this.mode = { kind: 'placing', start: p }; return; }
    const handle = this.handleAt(screen);
    if (handle) {
      const h = selectionHandles(this.frame)!;
      const centreDesign = this.toDesign(h.centre);
      this.mode = { kind: handle === 'scale' ? 'scaling' : 'rotating', start: p, orig: this.snapshot(), centre: centreDesign,
        startAngle: Math.atan2(screen.y - h.centre.y, screen.x - h.centre.x), startDist: Math.hypot(screen.x - h.centre.x, screen.y - h.centre.y) || 1 };
      return;
    }
    const id = this.hit(p);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const wasSelected = !!id && store.selection.value.has(id);
    if (id && !wasSelected) select([id], additive ? 'add' : 'replace');
    this.mode = { kind: 'pressed', id, start: p, screen, additive, wasSelected };
  };

  private move = (e: PointerEvent): void => {
    if (!store.doc.value) return;
    const screen = this.screenOf(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, screen);
    const mmPt = this.toMm(screen);
    store.cursorMm.value = mmPt;
    const m = this.mode;
    if (m.kind === 'idle') {
      if (e.pointerType !== 'touch' && store.tool.value === 'select') {
        const id = this.hit(this.toDesign(screen));
        if (id !== store.hoverId.value) store.hoverId.value = id;
      }
      return;
    }
    if (m.kind === 'pinching') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let cam = zoomAt(store.camera.value, this.viewport, this.page, m.centre, dist / m.dist);
      cam = panBy(cam, centre.x - m.centre.x, centre.y - m.centre.y);
      store.camera.value = cam;
      this.mode = { kind: 'pinching', dist, centre };
      return;
    }
    if (m.kind === 'panning') {
      store.camera.value = panBy(store.camera.value, screen.x - m.last.x, screen.y - m.last.y);
      this.mode = { ...m, last: screen };
      return;
    }
    const p = this.toDesign(screen);
    if (m.kind === 'pressed') {
      if (Math.hypot(screen.x - m.screen.x, screen.y - m.screen.y) < DRAG_PX()) return;
      if (m.id) { this.mode = { kind: 'moving', start: m.start, orig: this.snapshot() }; this.moveTo(p, e); }
      else { this.mode = { kind: 'marquee', start: m.start, additive: m.additive }; store.marquee.value = { a: m.start, b: p }; }
      return;
    }
    if (m.kind === 'moving') { this.moveTo(p, e); return; }
    if (m.kind === 'scaling') {
      const h = selectionHandles({ ...this.frame, gesture: null });
      const centreScreen = h?.centre ?? screen;
      const k = Math.max(0.05, (Math.hypot(screen.x - centreScreen.x, screen.y - centreScreen.y) || 1) / m.startDist);
      const preview = new Map<string, Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg'>>();
      for (const [id, o] of m.orig) preview.set(id, { ...o, scale: o.scale * k, x: m.centre.x + (o.x - m.centre.x) * k, y: m.centre.y + (o.y - m.centre.y) * k });
      this.preview({ kind: 'scale', preview, guides: [] });
      return;
    }
    if (m.kind === 'rotating') {
      const h = selectionHandles({ ...this.frame, gesture: null });
      const c = h?.centre ?? screen;
      let delta = (Math.atan2(screen.y - c.y, screen.x - c.x) - m.startAngle) * 180 / Math.PI;
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;
      const preview = new Map<string, Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg'>>();
      const rad = delta * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      for (const [id, o] of m.orig) {
        let deg = o.rotationDeg + delta;
        deg = ((deg % 360) + 540) % 360 - 180;
        const snap = Math.round(deg / 90) * 90;
        if (Math.abs(deg - snap) < 3 && m.orig.size === 1) deg = snap;
        const dx = o.x - m.centre.x, dy = o.y - m.centre.y;
        preview.set(id, { ...o, rotationDeg: Math.round(deg * 10) / 10 || 0, x: m.orig.size === 1 ? o.x : m.centre.x + dx * cos - dy * sin, y: m.orig.size === 1 ? o.y : m.centre.y + dx * sin + dy * cos });
      }
      this.preview({ kind: 'rotate', preview, guides: [] });
      return;
    }
    if (m.kind === 'marquee') { store.marquee.value = { a: m.start, b: p }; return; }
    if (m.kind === 'measuring') { store.measure.value = { a: m.start, b: p }; return; }
    if (m.kind === 'region') { store.marquee.value = { a: m.start, b: p }; return; }
  };

  private moveTo(p: Coord, e: PointerEvent): void {
    const m = this.mode;
    if (m.kind !== 'moving') return;
    const doc = store.doc.value!, mm = mmPerDesignPx(doc);
    let dx = p.x - m.start.x, dy = p.y - m.start.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    let guides: Gesture['guides'] = [];
    if (store.prefs.value.snap && !e.altKey) {
      const movingIds = new Set(m.orig.keys());
      const boxes = doc.items.filter((i) => movingIds.has(i.id)).map((i) => itemBox(i, { files: store.files.value, cuts: store.cuts, gesture: null })).filter((b): b is NonNullable<typeof b> => !!b);
      if (boxes.length) {
        const moving: Bounds = {
          minX: Math.min(...boxes.map((b) => b.minX)) * mm.x, maxX: Math.max(...boxes.map((b) => b.maxX)) * mm.x,
          minY: Math.min(...boxes.map((b) => b.minY)) * mm.y, maxY: Math.max(...boxes.map((b) => b.maxY)) * mm.y,
        };
        const others = doc.items.filter((i) => !movingIds.has(i.id)).map((i) => itemBox(i, { files: store.files.value, cuts: store.cuts, gesture: null }))
          .filter((b): b is NonNullable<typeof b> => !!b).map((b) => ({ minX: b.minX * mm.x, maxX: b.maxX * mm.x, minY: b.minY * mm.y, maxY: b.maxY * mm.y }));
        const grid = store.prefs.value.grid ? 1 : null;
        const M = designToScreenMatrix(this.frame);
        const thresholdMm = 6 / (M[0] / mm.x);
        const r = snapDelta(moving, dx * mm.x, dy * mm.y, snapCandidates(this.page, others), grid, thresholdMm);
        dx = r.dx / mm.x; dy = r.dy / mm.y; guides = r.guides;
      }
    }
    const preview = new Map<string, Pick<Item, 'x' | 'y' | 'scale' | 'rotationDeg'>>();
    for (const [id, o] of m.orig) preview.set(id, { ...o, x: o.x + dx, y: o.y + dy });
    this.preview({ kind: 'move', preview, guides });
  }

  private up = (e: PointerEvent): void => {
    const screen = this.screenOf(e);
    this.pointers.delete(e.pointerId);
    const m = this.mode;
    if (m.kind === 'pinching') {
      if (this.pointers.size === 1) { const [last] = [...this.pointers.values()]; this.mode = { kind: 'panning', last, returnTo: null }; }
      else this.mode = { kind: 'idle' };
      return;
    }
    if (!store.doc.value) { this.mode = { kind: 'idle' }; return; }
    const p = this.toDesign(screen);
    if (m.kind === 'pressed') {
      if (m.id) { if (m.additive && m.wasSelected) select([m.id], 'toggle'); else if (!m.additive && m.wasSelected) select([m.id]); }
      else if (!m.additive) select([]);
    } else if (m.kind === 'moving' || m.kind === 'scaling' || m.kind === 'rotating') {
      this.commitGesture();
    } else if (m.kind === 'marquee') {
      const a = store.marquee.value?.a ?? m.start, b = p;
      const rect = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
      const hits = store.doc.value.items.filter((i) => { const bb = itemBounds(i); return bb && bb.minX < rect.maxX && bb.maxX > rect.minX && bb.minY < rect.maxY && bb.maxY > rect.minY; }).map((i) => i.id);
      select(hits, m.additive ? 'add' : 'replace');
      store.marquee.value = null;
    } else if (m.kind === 'measuring') {
      if (Math.hypot(p.x - m.start.x, p.y - m.start.y) < 2) store.measure.value = null;
    } else if (m.kind === 'region') {
      const a = m.start, rect = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) };
      store.marquee.value = null;
      const mm = mmPerDesignPx(store.doc.value);
      if (rect.w * mm.x >= 2 && rect.h * mm.y >= 2) this.host.onRegion(rect, screen);
    } else if (m.kind === 'placing') {
      if (Math.hypot(p.x - m.start.x, p.y - m.start.y) < DRAG_PX()) this.host.onPlace(p, screen);
    }
    this.mode = { kind: 'idle' };
  };

  private cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.abortGesture();
  };
  private lost = (): void => { if (this.pointers.size === 0 && this.mode.kind !== 'idle') this.abortGesture(); };

  /** Esc / iptal: önizlemeyi at, geçmişe hiçbir şey yazma. */
  abortGesture(): void {
    batch(() => { store.gesture.value = null; store.marquee.value = null; });
    if (this.mode.kind === 'measuring') store.measure.value = null;
    this.mode = { kind: 'idle' };
  }

  private wheel = (e: WheelEvent): void => {
    if (!store.doc.value) return;
    e.preventDefault();
    const k = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.viewport.height : 1;
    if (e.ctrlKey || e.metaKey) {
      store.camera.value = zoomAt(store.camera.value, this.viewport, this.page, this.screenOf(e), Math.exp(-e.deltaY * k * 0.0025));
    } else {
      store.camera.value = panBy(store.camera.value, -e.deltaX * k, -e.deltaY * k);
    }
  };

  private dblclick = (e: MouseEvent): void => {
    if (!store.doc.value || store.tool.value !== 'select') return;
    const id = this.hit(this.toDesign(this.screenOf(e)));
    if (!id) { this.host.el.dispatchEvent(new CustomEvent('stage:fit')); return; }
    this.host.el.dispatchEvent(new CustomEvent('stage:focus', { detail: id }));
  };

  private key = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      if (e.type === 'keydown' && !e.repeat) { this.spaceDown = true; this.host.el.style.cursor = 'grab'; }
      if (e.type === 'keyup') { this.spaceDown = false; this.host.el.style.cursor = ''; }
      if (e.type === 'keydown' && this.mode.kind !== 'idle') return;
      e.preventDefault();
    }
    if (e.type === 'keydown' && e.key === 'Escape' && this.mode.kind !== 'idle') { this.abortGesture(); e.stopPropagation(); }
    if (e.type === 'keydown' && e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey && this.mode.kind === 'moving') { /* ızgara anahtarı kısayolda */ savePrefs(); }
  };
}
