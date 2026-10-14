import { type Mask, createMask, padMask } from './raster';

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

/** Her piksel için en yakın dolu piksele kare uzaklık (dolu pikselde 0). Tam sayılar Float32'de kesindir. */
export function squaredDistance(m: Mask): Float32Array {
  const { width: w, height: h } = m;
  const grid = new Float32Array(w * h);
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

export function invertMask(m: Mask): Mask {
  const out = createMask(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) out.data[i] = m.data[i] ? 0 : 1;
  return out;
}

/** İşaretli uzaklık alanı: dışarıda +d (en yakın dolu piksele), içeride −d (en yakın boş piksele). */
export function signedDistance(m: Mask): Float32Array {
  const outside = squaredDistance(m);
  const inside = squaredDistance(invertMask(m));
  for (let i = 0; i < outside.length; i++) {
    outside[i] = m.data[i] ? -Math.sqrt(inside[i]) : Math.sqrt(outside[i]);
  }
  return outside;
}

/** `field ≤ level` olan pikseller. */
export function thresholdField(field: ArrayLike<number>, width: number, height: number, level: number): Mask {
  const out = createMask(width, height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = field[i] <= level ? 1 : 0;
  return out;
}

/** Yarıçapı r olan disk ile genişletme (Öklid). Maske kenarına taşan kısım kırpılır; çağıran pad'ler. */
export function dilateMask(m: Mask, r: number): Mask {
  if (r <= 0) return { width: m.width, height: m.height, data: m.data.slice() };
  const d2 = squaredDistance(m), r2 = r * r;
  const out = createMask(m.width, m.height);
  for (let i = 0; i < d2.length; i++) out.data[i] = d2[i] <= r2 ? 1 : 0;
  return out;
}

/** Yarıçapı r olan disk ile aşındırma (Öklid). */
export function erodeMask(m: Mask, r: number): Mask {
  if (r <= 0) return { width: m.width, height: m.height, data: m.data.slice() };
  const d2 = squaredDistance(invertMask(m)), r2 = r * r;
  const out = createMask(m.width, m.height);
  for (let i = 0; i < d2.length; i++) out.data[i] = m.data[i] && d2[i] > r2 ? 1 : 0;
  return out;
}

/** Kapama: 2r'den dar girintileri doldurur, dış hattı korur. r < 0.5 → kopya. */
export function closeMask(m: Mask, r: number): Mask {
  if (r < 0.5) return { width: m.width, height: m.height, data: m.data.slice() };
  return erodeMask(dilateMask(m, r), r);
}

/** Açma: 2r'den ince çıkıntıları atar, dışbükey köşeleri r ile yuvarlar. */
export function openMask(m: Mask, r: number): Mask {
  if (r < 0.5) return { width: m.width, height: m.height, data: m.data.slice() };
  return dilateMask(erodeMask(m, r), r);
}

export function offsetMask(m: Mask, radius: number): { mask: Mask; pad: number } {
  const pad = Math.ceil(Math.max(0, radius)) + 1;
  const padded = padMask(m, pad);
  if (radius === 0) return { mask: padded, pad };
  return { mask: radius > 0 ? dilateMask(padded, radius) : erodeMask(padded, -radius), pad };
}
