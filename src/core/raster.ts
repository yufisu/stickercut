export interface Raster { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export interface Mask { width: number; height: number; data: Uint8Array }
export interface BBox { x: number; y: number; w: number; h: number }

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

export function alphaMask(r: Raster, threshold = 128): Mask {
  const m = createMask(r.width, r.height);
  for (let i = 0, n = r.width * r.height; i < n; i++) m.data[i] = r.data[i * 4 + 3] >= threshold ? 1 : 0;
  return m;
}

export function maskArea(m: Mask): number {
  let a = 0;
  for (let i = 0; i < m.data.length; i++) a += m.data[i];
  return a;
}

export function bboxOf(m: Mask): BBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (!m.data[y * m.width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function labelComponents(m: Mask): { labels: Int32Array; areas: number[] } {
  const { width: w, height: h, data } = m;
  const labels = new Int32Array(w * h);
  const areas = [0];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let i = 0; i < w * h; i++) {
    if (!data[i] || labels[i]) continue;
    let sp = 0;
    let area = 0;
    stack[sp++] = i;
    labels[i] = next;
    while (sp) {
      const p = stack[--sp];
      area++;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (data[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; }
        }
      }
    }
    areas.push(area);
    next++;
  }
  return { labels, areas };
}

export function largestComponent(m: Mask): { mask: Mask; area: number; otherAreas: number[] } {
  const { labels, areas } = labelComponents(m);
  let best = 0;
  for (let k = 1; k < areas.length; k++) if (areas[k] > (best ? areas[best] : 0)) best = k;
  const mask = createMask(m.width, m.height);
  if (best) for (let i = 0; i < labels.length; i++) mask.data[i] = labels[i] === best ? 1 : 0;
  const otherAreas = areas.filter((_, k) => k !== 0 && k !== best);
  return { mask, area: best ? areas[best] : 0, otherAreas };
}

/** Kenara 4-komşulukla ulaşamayan arka plan pikselleri (delikler) doldurulur. */
export function fillHoles(m: Mask): Mask {
  const { width: w, height: h, data } = m;
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p: number) => { if (!data[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = createMask(w, h);
  for (let i = 0; i < w * h; i++) out.data[i] = outside[i] ? 0 : 1;
  return out;
}

/** f ≤ 1; hedef piksel, kaynaktaki blok merkezinden örneklenir. */
export function downscaleMask(m: Mask, f: number): Mask {
  if (f >= 1) return { width: m.width, height: m.height, data: m.data.slice() };
  const w2 = Math.max(1, Math.round(m.width * f)), h2 = Math.max(1, Math.round(m.height * f));
  const sx = m.width / w2, sy = m.height / h2;
  const out = createMask(w2, h2);
  for (let y = 0; y < h2; y++) {
    const srcY = Math.min(m.height - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < w2; x++) {
      const srcX = Math.min(m.width - 1, Math.floor((x + 0.5) * sx));
      out.data[y * w2 + x] = m.data[srcY * m.width + srcX];
    }
  }
  return out;
}

export function padMask(m: Mask, pad: number): Mask {
  const out = createMask(m.width + 2 * pad, m.height + 2 * pad);
  for (let y = 0; y < m.height; y++) {
    out.data.set(m.data.subarray(y * m.width, (y + 1) * m.width), (y + pad) * out.width + pad);
  }
  return out;
}

function morph(m: Mask, r: number, dilate: boolean): Mask {
  const { width: w, height: h } = m;
  if (r <= 0) return { width: w, height: h, data: m.data.slice() };
  const pass = (src: Uint8Array, len: number, count: number, idx: (line: number, i: number) => number) => {
    const out = new Uint8Array(w * h);
    const ps = new Int32Array(len + 1);
    for (let line = 0; line < count; line++) {
      for (let i = 0; i < len; i++) ps[i + 1] = ps[i] + src[idx(line, i)];
      for (let i = 0; i < len; i++) {
        const lo = Math.max(0, i - r), hi = Math.min(len - 1, i + r);
        const ones = ps[hi + 1] - ps[lo];
        out[idx(line, i)] = dilate ? (ones > 0 ? 1 : 0) : (ones === hi - lo + 1 ? 1 : 0);
      }
    }
    return out;
  };
  const horiz = pass(m.data, w, h, (y, x) => y * w + x);
  return { width: w, height: h, data: pass(horiz, h, w, (x, y) => y * w + x) };
}

export const dilateSquare = (m: Mask, r: number): Mask => morph(m, r, true);
export const erodeSquare = (m: Mask, r: number): Mask => morph(m, r, false);
