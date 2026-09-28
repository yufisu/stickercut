import { type Mask, padMask } from './raster';

const INF = 1e20;

// Felzenszwalb & Huttenlocher 1D kare mesafe dönüşümü
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

export function squaredDistance(m: Mask): Float64Array {
  const { width: w, height: h } = m;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = m.data[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  return grid;
}

export function offsetMask(m: Mask, radius: number): { mask: Mask; pad: number } {
  const pad = Math.ceil(Math.max(0, radius)) + 1;
  const mask = padMask(m, pad);
  if (radius <= 0) return { mask, pad };
  const d2 = squaredDistance(mask);
  const r2 = radius * radius;
  for (let i = 0; i < d2.length; i++) mask.data[i] = d2[i] <= r2 ? 1 : 0;
  return { mask, pad };
}
