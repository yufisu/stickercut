import type { Raster } from './raster';
import { type Affine, type Pt, apply, invert, flattenPath } from './geometry';

export function createRaster(w: number, h: number): Raster {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

export function cloneRaster(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

export function compositeOverWhite(r: Raster): Raster {
  const out = createRaster(r.width, r.height);
  const s = r.data, d = out.data;
  for (let o = 0; o < s.length; o += 4) {
    const a = s[o + 3] / 255;
    d[o] = s[o] * a + 255 * (1 - a);
    d[o + 1] = s[o + 1] * a + 255 * (1 - a);
    d[o + 2] = s[o + 2] * a + 255 * (1 - a);
    d[o + 3] = 255;
  }
  return out;
}

/** m: src px → dst px. En yakın komşu örnekleme, src-over karışım. */
export function drawRaster(dst: Raster, src: Raster, m: Affine): void {
  const inv = invert(m);
  const corners = [
    apply(m, { x: 0, y: 0 }), apply(m, { x: src.width, y: 0 }),
    apply(m, { x: 0, y: src.height }), apply(m, { x: src.width, y: src.height }),
  ];
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))));
  const x1 = Math.min(dst.width, Math.ceil(Math.max(...corners.map((c) => c.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))));
  const y1 = Math.min(dst.height, Math.ceil(Math.max(...corners.map((c) => c.y))));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = apply(inv, { x: x + 0.5, y: y + 0.5 });
      const u = Math.floor(p.x), v = Math.floor(p.y);
      if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
      const so = (v * src.width + u) * 4;
      const sa = src.data[so + 3] / 255;
      if (!sa) continue;
      const doff = (y * dst.width + x) * 4;
      const da = dst.data[doff + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst.data[doff + c] = (src.data[so + c] * sa + dst.data[doff + c] * da * (1 - sa)) / oa;
      }
      dst.data[doff + 3] = oa * 255;
    }
  }
}

/** f < 1; alfa ağırlıklı kutu filtresi. */
export function downscaleRaster(r: Raster, f: number): Raster {
  const w2 = Math.max(1, Math.round(r.width * f)), h2 = Math.max(1, Math.round(r.height * f));
  const out = createRaster(w2, h2);
  const sx = r.width / w2, sy = r.height / h2;
  for (let y = 0; y < h2; y++) {
    const v0 = Math.floor(y * sy), v1 = Math.max(v0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w2; x++) {
      const u0 = Math.floor(x * sx), u1 = Math.max(u0 + 1, Math.floor((x + 1) * sx));
      let R = 0, G = 0, B = 0, A = 0, n = 0;
      for (let v = v0; v < v1; v++) {
        for (let u = u0; u < u1; u++) {
          const o = (v * r.width + u) * 4, a = r.data[o + 3];
          R += r.data[o] * a;
          G += r.data[o + 1] * a;
          B += r.data[o + 2] * a;
          A += a;
          n++;
        }
      }
      const o = (y * w2 + x) * 4;
      if (A) {
        out.data[o] = R / A;
        out.data[o + 1] = G / A;
        out.data[o + 2] = B / A;
      }
      out.data[o + 3] = A / n;
    }
  }
  return out;
}

export function strokePolyline(
  dst: Raster, pts: Pt[], closed: boolean, color: [number, number, number], width: number,
): void {
  if (pts.some((p) => p.handleIn || p.handleOut)) pts = flattenPath(pts, closed);
  const r = width / 2, r2 = r * r;
  const stamp = (cx: number, cy: number) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) continue;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r2) continue;
        const o = (y * dst.width + x) * 4;
        dst.data[o] = color[0];
        dst.data[o + 1] = color[1];
        dst.data[o + 2] = color[2];
        dst.data[o + 3] = 255;
      }
    }
  };
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
    for (let s = 0; s <= steps; s++) stamp(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
  }
}
