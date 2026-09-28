import { state } from '../state';
import { itemMatrix, closedPathSvg, pointInPolygon, type Pt } from '../../../src/core/geometry';
import { effectiveSettings, type Item } from '../../../src/core/project';
import { corners, containsPoint, handles, hitHandle, moved, scaled, rotated, type Geom } from './interaction';

type Mode = 'move' | 'scale' | 'rotate';
const HANDLE_PX = 22;
const ROTATE_OFFSET_PX = 36;

export class CanvasView {
  private focusedRegion: number | null = null;
  readonly el: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private s = 1;
  private ox = 0;
  private oy = 0;
  private drag: { id: string; mode: Mode; start: Pt; orig: Geom } | null = null;
  private ro: ResizeObserver;

  constructor(private parent: HTMLElement, private onCommit: () => void, private onSelect: () => void) {
    this.el = document.createElement('canvas');
    this.el.className = 'stage';
    parent.append(this.el);
    this.g = this.el.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(parent);
    this.el.addEventListener('pointerdown', this.down);
    this.el.addEventListener('pointermove', this.move);
    this.el.addEventListener('pointerup', this.up);
    this.el.addEventListener('pointercancel', this.up);
  }

  destroy(): void { this.ro.disconnect(); this.el.remove(); }

  private geom(item: Item): Geom | null {
    const f = state.files.get(item.file);
    return f ? { x: item.x, y: item.y, scale: item.scale, rotationDeg: item.rotationDeg, w: f.width, h: f.height } : null;
  }

  private toDesign(e: PointerEvent): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.ox) / this.s, y: (e.clientY - r.top - this.oy) / this.s };
  }

  private layout(): void {
    const pack = state.pack!;
    const r = this.parent.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const [cw, ch] = [Math.round(r.width * dpr), Math.round(r.height * dpr)];
    if (this.el.width !== cw || this.el.height !== ch) { this.el.width = cw; this.el.height = ch; }
    const pad = 16, { widthPx: dw, heightPx: dh } = pack.designSize;
    this.s = Math.max(0.01, Math.min((r.width - 2 * pad) / dw, (r.height - 2 * pad) / dh));
    this.ox = (r.width - this.s * dw) / 2;
    this.oy = (r.height - this.s * dh) / 2;
  }

  draw(): void {
    const pack = state.pack;
    if (!pack) return;
    this.layout();
    const g = this.g, dpr = devicePixelRatio || 1, { widthPx: dw, heightPx: dh } = pack.designSize;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.el.width, this.el.height);
    g.setTransform(dpr * this.s, 0, 0, dpr * this.s, dpr * this.ox, dpr * this.oy);
    const bg = state.files.get(pack.files.background);
    if (bg) g.drawImage(bg.bitmap, 0, 0, dw, dh);
    for (const item of pack.items) {
      const cut = state.cuts.get(item.id);
      if (cut && !item.printOnly && effectiveSettings(pack, item).whiteBorder) {
        g.fillStyle = '#fff';
        g.fill(new Path2D(closedPathSvg(cut)));
      }
    }
    for (const item of pack.items) {
      const f = state.files.get(item.file);
      if (!f) continue;
      g.save();
      g.transform(...itemMatrix(item, f.width, f.height));
      g.drawImage(f.bitmap, 0, 0, f.width, f.height);
      g.restore();
    }
    if (state.showCuts) {
      g.lineWidth = 1.5 / this.s;
      g.strokeStyle = '#e00000';
      for (const [id, pts] of state.cuts) if (!this.drag || this.drag.id !== id) g.stroke(new Path2D(closedPathSvg(pts)));
    }
    const focusedRegion = state.messages.find((m) => m.code === 'UNMATCHED_REGION' && m.marker === this.focusedRegion)?.region;
    if (focusedRegion) {
      g.save();
      g.fillStyle = 'rgba(28, 25, 20, .42)';
      g.beginPath();
      g.rect(0, 0, dw, dh);
      g.rect(focusedRegion.x, focusedRegion.y, focusedRegion.w, focusedRegion.h);
      g.fill('evenodd');
      g.restore();
    }
    for (const m of state.messages) {
      if (m.code !== 'UNMATCHED_REGION' || !m.region || !m.marker) continue;
      const { x, y, w, h } = m.region;
      const focused = m.marker === this.focusedRegion;
      g.save();
      g.fillStyle = focused ? 'rgba(255, 140, 0, .28)' : 'rgba(255, 140, 0, .14)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = focused ? '#bd5100' : '#e08a00';
      g.lineWidth = (focused ? 3 : 2) / this.s;
      g.setLineDash(focused ? [] : [7 / this.s, 4 / this.s]);
      g.strokeRect(x, y, w, h);
      g.setLineDash([]);
      const cx = x + w / 2, cy = y + h / 2, radius = 13 / this.s;
      g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2);
      g.fillStyle = focused ? '#bd5100' : '#e08a00'; g.fill();
      g.fillStyle = '#fff'; g.font = `bold ${14 / this.s}px system-ui`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(m.marker), cx, cy);
      g.restore();
    }
    for (const item of pack.items) {
      const geo = this.geom(item);
      if (!geo) continue;
      const selected = item.id === state.selectedId;
      if (!item.needsReview && !selected) continue;
      const c = corners(geo);
      g.setLineDash(selected ? [] : [8 / this.s, 6 / this.s]);
      g.lineWidth = 2 / this.s;
      g.strokeStyle = selected ? '#2f6fd6' : '#e08a00';
      g.beginPath();
      c.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      if (selected) {
        const h = handles(geo, ROTATE_OFFSET_PX / this.s);
        for (const p of [h.scale, h.rotate]) {
          g.beginPath();
          g.arc(p.x, p.y, HANDLE_PX / 2 / this.s, 0, Math.PI * 2);
          g.fillStyle = '#fff';
          g.fill();
          g.stroke();
        }
      }
    }
  }

  focusRegion(marker: number): void {
    this.focusedRegion = marker;
    this.draw();
  }

  private hit(p: Pt): string | null {
    const items = state.pack!.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i], cut = state.cuts.get(it.id), geo = this.geom(it);
      if (cut ? pointInPolygon(p, cut) : geo && containsPoint(geo, p)) return it.id;
    }
    return null;
  }

  private startDrag(e: PointerEvent, item: Item, mode: Mode, p: Pt): void {
    const geo = this.geom(item);
    if (!geo) return;
    this.drag = { id: item.id, mode, start: p, orig: geo };
    this.el.setPointerCapture(e.pointerId);
  }

  private down = (e: PointerEvent): void => {
    if (!state.pack) return;
    this.focusedRegion = null;
    const p = this.toDesign(e);
    const sel = state.pack.items.find((i) => i.id === state.selectedId);
    const selGeo = sel && this.geom(sel);
    if (sel && selGeo) {
      const h = hitHandle(selGeo, p, HANDLE_PX / this.s, ROTATE_OFFSET_PX / this.s);
      if (h) { this.startDrag(e, sel, h, p); return; }
    }
    const id = this.hit(p);
    state.selectedId = id;
    this.onSelect();
    if (id) this.startDrag(e, state.pack.items.find((i) => i.id === id)!, 'move', p);
    this.draw();
  };

  private move = (e: PointerEvent): void => {
    if (!this.drag || !state.pack) return;
    const item = state.pack.items.find((i) => i.id === this.drag!.id);
    if (!item) return;
    const p = this.toDesign(e), { mode, orig, start } = this.drag;
    if (mode === 'move') Object.assign(item, moved(orig, start, p));
    else if (mode === 'scale') item.scale = scaled(orig, start, p);
    else item.rotationDeg = rotated(orig, start, p);
    this.draw();
  };

  private up = (): void => {
    if (!this.drag || !state.pack) return;
    const item = state.pack.items.find((i) => i.id === this.drag!.id);
    const changed = item && (item.x !== this.drag.orig.x || item.y !== this.drag.orig.y || item.scale !== this.drag.orig.scale || item.rotationDeg !== this.drag.orig.rotationDeg);
    this.drag = null;
    if (item && changed) {
      item.x = Math.round(item.x * 100) / 100;
      item.y = Math.round(item.y * 100) / 100;
      item.scale = Math.round(item.scale * 1e6) / 1e6;
      state.cuts.delete(item.id);
      this.onCommit();
    } else this.draw();
  };
}
