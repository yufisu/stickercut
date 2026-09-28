# stickercut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sticker pack PNG'lerinden (tam tasarım + arka plan + tek tek sticker'lar) otomatik yerleşim ve kesim çizgisi çıkaran, 2 sayfalı (baskı + kesim) PDF üreten; iPad'de tarayıcıdan, Mac'te ve agent'larda CLI'dan çalışan araç.

**Architecture:** Saf TypeScript `src/core` (DOM/Node bağımsız) tüm işi yapar: rol tanıma, fark maskesiyle sticker bulma, alfadan kontur, pdf-lib ile PDF. `src/cli` (Node, pngjs) ve `web/` (Vite SPA, Web Worker) aynı core'u çağırır ve aynı `pack.json`'u okur/yazar. Web GitHub Pages'e statik olarak deploy edilir; sunucu yok.

**Tech Stack:** TypeScript 5, Node ≥22, Vite, vitest, pdf-lib, fflate, pngjs, idb-keyval, tsx.

**Spec:** `docs/superpowers/specs/2026-09-28-stickercut-design.md`

## Global Constraints

- `src/core/**` hiçbir DOM veya Node API'si import etmez (sadece `pdf-lib`, `fflate`).
- Kesim çizgisi: RGB(1,0,0) stroke, fill yok, varsayılan 1 pt; sadece dış silüet (iç boşluklar doldurulur).
- PDF: 2 sayfa, 1. baskı / 2. kesim, aynı koordinatlar; MediaBox = TrimBox = sayfa mm × 72/25.4.
- `pack.json` koordinatları tasarım pikselinde; `x,y` = sticker PNG'sinin **merkezi**; `scale` = tasarım px / **orijinal** sticker px.
- Uzun kenarı > 2048 px ve şeffaflık oranı ≥ %5 olan PNG'ler analiz için 2048 px'e küçültülür (web ve CLI aynı kural); PDF'e orijinal bytes gömülür.
- Dosya adları her yerde `String.prototype.normalize('NFC')` ile saklanır ve karşılaştırılır.
- Kullanıcıya görünen tüm metinler doğal Türkçe.
- Gerçek çizimler (PNG/PDF/zip) asla commit'lenmez; `.gitignore` zaten engelliyor. Testler gerçek pack'i yalnızca `STICKERS_DIR` ortam değişkeniyle okur.
- Web `base: './'` ile build edilir (GitHub Pages alt yolu). Service worker yok.
- Her task sonunda `npm test` ve `npm run typecheck` geçmeli.

## Review Focus

1. **Birbirine değen/örtüşen iki sticker** tasarımda tek bölge olarak çıkar → kullanıcı yanlış ama "emin" bir yerleşim değil, "eşleşmeyen bölge" uyarısı bekler. (Task 8'de test)
2. **macOS NFD dosya adları** ("çay ve kahve", "kahvee.png" gibi Türkçe karakterler) → pack.json NFC tutar, CLI Linux'ta bile diskteki NFD adı bulur, zip round-trip bozulmaz. (Task 11 ve 12'de test)
3. **Şeffaflığı olmayan sticker PNG'si** (beyaz zeminli export) → sessizce dikdörtgen kesim değil, açık "şeffaf alan yok" hatası. (Task 3 ve 9'da test)
4. **Tam tasarım PNG'sinde şeffaf alanlar** (alfa=0, RGB çöp) → beyaz üzerine birleştirildikten sonra karşılaştırılır; sahte bölge çıkmaz. (Task 8'de test)
5. **Offset sonrası kesim çizgilerinin çakışması veya sayfa dışına taşması** → baskıcıya bozuk dosya gitmeden uyarı. (Task 9'da test)

---

## File Structure

```
stickercut/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts, .gitignore
  bin/stickercut.mjs              CLI giriş noktası (tsx ile TS çalıştırır)
  src/core/
    raster.ts      Raster/Mask tipleri, alfa maskesi, bağlı bileşen, delik doldurma, morfoloji, küçültme
    distance.ts    Öklid distance transform, offset (dilate by radius)
    geometry.ts    Pt, Affine, itemMatrix, Catmull-Rom → SVG path, polygon yardımcıları
    contour.ts     Sticker alfasından tek kapalı kesim yolu (StickerError)
    render.ts      createRaster, compositeOverWhite, drawRaster, downscaleRaster, strokePolyline
    project.ts     Pack/Item/Settings tipleri, parse/serialize/doğrulama, nfc, birim dönüşümleri
    roles.ts       Dosyalara rol atama (tasarım / arka plan / sticker)
    match.ts       Fark maskesi → bölgeler → sticker + ölçek + konum
    checks.ts      Yerleşim uyarıları (oran, sayfa dışı, çakışma)
    pdf.ts         pdf-lib ile 2 sayfalı PDF
    zip.ts         pack.json + PNG'ler ↔ .zip
    pipeline.ts    LoadedFile, initPack, computeCuts, buildPackPdf, renderPackPreview
    index.ts       dışa aktarımlar
  src/cli/
    png.ts         pngjs decode/encode
    files.ts       PNG listeleme, NFC/NFD güvenli yol çözme, yükleme
    run.ts         komutlar: init, build, preview, export, import
    main.ts        process.argv → run
  web/
    index.html
    src/main.ts, state.ts, engine.ts, worker.ts, protocol.ts, decode.ts,
        project-io.ts, storage.ts, share.ts, style.css
    src/ui/files-screen.ts, editor-screen.ts, canvas-view.ts, interaction.ts, html.ts
  tests/
    helpers/scene.ts   sentetik sticker/tasarım üretici
    core/*.test.ts, cli/*.test.ts, web/interaction.test.ts, real-pack.test.ts
  .github/workflows/pages.yml
  AGENTS.md, README.md, .claude/skills/stickercut/SKILL.md
```

---

### Task 1: Proje iskeleti + raster temelleri

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vite.config.ts`
- Create: `src/core/raster.ts`
- Test: `tests/core/raster.test.ts`

**Interfaces:**
- Produces:
  - `interface Raster { width: number; height: number; data: Uint8Array | Uint8ClampedArray }` (RGBA)
  - `interface Mask { width: number; height: number; data: Uint8Array }` (0/1)
  - `interface BBox { x: number; y: number; w: number; h: number }`
  - `createMask(w, h): Mask`, `alphaMask(r, threshold=128): Mask`, `maskArea(m): number`, `bboxOf(m): BBox | null`
  - `labelComponents(m): { labels: Int32Array; areas: number[] }` (label 0 = arka plan, 8-komşuluk)
  - `largestComponent(m): { mask: Mask; area: number; otherAreas: number[] }`
  - `fillHoles(m): Mask`, `downscaleMask(m, f): Mask`, `padMask(m, pad): Mask`
  - `dilateSquare(m, r): Mask`, `erodeSquare(m, r): Mask`

- [ ] **Step 1: İskeleti kur ve bağımlılıkları yükle**

`package.json`:
```json
{
  "name": "stickercut",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "stickercut": "./bin/stickercut.mjs" },
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "dev": "vite",
    "build:web": "vite build",
    "cli": "tsx src/cli/main.ts"
  }
}
```

```bash
cd ~/Desktop/stickercut
npm install pdf-lib fflate pngjs tsx idb-keyval
npm install -D typescript vite vitest @types/node @types/pngjs
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src", "web", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true },
  worker: { format: 'es' },
});
```

- [ ] **Step 2: Failing testi yaz**

`tests/core/raster.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  createMask, alphaMask, maskArea, bboxOf, labelComponents, largestComponent,
  fillHoles, downscaleMask, padMask, dilateSquare, erodeSquare, type Mask,
} from '../../src/core/raster';

function maskFrom(rows: string[]): Mask {
  const m = createMask(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => { m.data[y * m.width + x] = c === '#' ? 1 : 0; }));
  return m;
}
function rowsOf(m: Mask): string[] {
  const out: string[] = [];
  for (let y = 0; y < m.height; y++) {
    let s = '';
    for (let x = 0; x < m.width; x++) s += m.data[y * m.width + x] ? '#' : '.';
    out.push(s);
  }
  return out;
}

describe('raster', () => {
  it('alphaMask alfa eşiğine göre maske çıkarır', () => {
    const r = { width: 3, height: 1, data: new Uint8Array([0,0,0,0, 0,0,0,127, 0,0,0,128]) };
    expect([...alphaMask(r).data]).toEqual([0, 0, 1]);
    expect([...alphaMask(r, 100).data]).toEqual([0, 1, 1]);
  });

  it('bboxOf sıkı sınır döner, boşsa null', () => {
    expect(bboxOf(maskFrom(['....', '.##.', '..#.']))).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(bboxOf(maskFrom(['...']))).toBeNull();
  });

  it('labelComponents 8-komşuluk kullanır', () => {
    const { areas } = labelComponents(maskFrom(['#...', '.#..', '...#']));
    expect(areas.slice(1).sort()).toEqual([1, 2]);
  });

  it('largestComponent en büyüğü tutar, diğerlerini raporlar', () => {
    const res = largestComponent(maskFrom(['##..#', '##...', '.....']));
    expect(res.area).toBe(4);
    expect(res.otherAreas).toEqual([1]);
    expect(rowsOf(res.mask)).toEqual(['##...', '##...', '.....']);
  });

  it('largestComponent boş maskede alan 0 döner', () => {
    expect(largestComponent(maskFrom(['...'])).area).toBe(0);
  });

  it('fillHoles kapalı boşlukları doldurur, kenara açılanları doldurmaz', () => {
    const m = maskFrom(['#####', '#...#', '#####', '#...#', '##.##']);
    expect(rowsOf(fillHoles(m))).toEqual(['#####', '#####', '#####', '#...#', '##.##']);
    expect(maskArea(m)).toBe(16);
  });

  it('downscaleMask blok merkezlerinden örnekler', () => {
    const m = maskFrom(['##..', '##..', '....', '....']);
    expect(rowsOf(downscaleMask(m, 0.5))).toEqual(['#.', '..']);
    expect(downscaleMask(m, 1).data).not.toBe(m.data);
  });

  it('padMask kenar ekler', () => {
    expect(rowsOf(padMask(maskFrom(['#']), 1))).toEqual(['...', '.#.', '...']);
  });

  it('dilateSquare ve erodeSquare kare yapısal elemanla çalışır', () => {
    const m = maskFrom(['.....', '.....', '..#..', '.....', '.....']);
    const d = dilateSquare(m, 1);
    expect(rowsOf(d)).toEqual(['.....', '.###.', '.###.', '.###.', '.....']);
    expect(rowsOf(erodeSquare(d, 1))).toEqual(['.....', '.....', '..#..', '.....', '.....']);
  });
});
```

- [ ] **Step 3: Testin fail ettiğini gör**

Run: `npx vitest run tests/core/raster.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/raster"`

- [ ] **Step 4: `src/core/raster.ts`'i yaz**

```ts
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
```

- [ ] **Step 5: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core/raster.test.ts && npm run typecheck`
Expected: 9 test PASS, typecheck hatasız.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts vite.config.ts src/core/raster.ts tests/core/raster.test.ts
git commit -m "feat(core): proje iskeleti ve raster temelleri"
```

---

### Task 2: Distance transform ve offset

**Files:**
- Create: `src/core/distance.ts`
- Test: `tests/core/distance.test.ts`

**Interfaces:**
- Consumes: `Mask`, `createMask`, `padMask`, `maskArea` (Task 1)
- Produces:
  - `squaredDistance(m: Mask): Float64Array` (her piksel için en yakın 1 pikseline kare mesafe)
  - `offsetMask(m: Mask, radius: number): { mask: Mask; pad: number }` (radius px kadar genişletilmiş, `pad` kadar kenar eklenmiş maske)

- [ ] **Step 1: Failing testi yaz**

`tests/core/distance.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createMask, maskArea } from '../../src/core/raster';
import { squaredDistance, offsetMask } from '../../src/core/distance';

function disc(size: number, r: number) {
  const m = createMask(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= r * r) m.data[y * size + x] = 1;
  }
  return m;
}

describe('distance', () => {
  it('squaredDistance tam Öklid kare mesafesini verir', () => {
    const m = createMask(21, 21);
    m.data[10 * 21 + 10] = 1;
    const d = squaredDistance(m);
    expect(d[10 * 21 + 10]).toBe(0);
    expect(d[14 * 21 + 13]).toBe(25);
    expect(d[0]).toBe(200);
  });

  it('offsetMask yarıçap kadar büyütür ve pad ekler', () => {
    const m = disc(40, 10);
    const { mask, pad } = offsetMask(m, 5);
    expect(pad).toBe(6);
    expect(mask.width).toBe(52);
    const expected = Math.PI * 15 * 15;
    expect(Math.abs(maskArea(mask) - expected) / expected).toBeLessThan(0.03);
  });

  it('offsetMask(0) sadece pad ekler', () => {
    const m = disc(20, 5);
    const { mask } = offsetMask(m, 0);
    expect(maskArea(mask)).toBe(maskArea(m));
  });
});
```

- [ ] **Step 2: Testin fail ettiğini gör**

Run: `npx vitest run tests/core/distance.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/distance"`

- [ ] **Step 3: `src/core/distance.ts`'i yaz**

```ts
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
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core/distance.test.ts && npm run typecheck`
Expected: 3 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/distance.ts tests/core/distance.test.ts
git commit -m "feat(core): distance transform ve offset"
```

---

### Task 3: Geometri ve kontur

**Files:**
- Create: `src/core/geometry.ts`, `src/core/contour.ts`
- Test: `tests/core/geometry.test.ts`, `tests/core/contour.test.ts`

**Interfaces:**
- Consumes: Task 1 raster fonksiyonları, `offsetMask` (Task 2)
- Produces (`geometry.ts`):
  - `interface Pt { x: number; y: number }`
  - `type Affine = [a, b, c, d, e, f]` — `x' = a·x + c·y + e`, `y' = b·x + d·y + f` (PDF/canvas sırası)
  - `multiply(m1, m2): Affine` (önce m2, sonra m1), `apply(m, p): Pt`, `invert(m): Affine`, `transformPoints(m, pts): Pt[]`
  - `interface Placement { x: number; y: number; scale: number; rotationDeg: number }`
  - `itemMatrix(p: Placement, w: number, h: number): Affine` — sticker px → tasarım px (merkez `x,y`, pozitif açı ekranda saat yönü)
  - `closedPathSvg(pts: Pt[]): string` — kapalı Catmull-Rom → `M … C … Z` (boşluklu sayılar)
  - `polygonBounds(pts): { minX; minY; maxX; maxY }`, `pointInPolygon(p, poly): boolean`
- Produces (`contour.ts`):
  - `interface CutShapeOptions { alphaThreshold: number; offsetPx: number; smoothing: number; maxWorkSize?: number }`
  - `interface CutShape { points: Pt[]; extraPartsRatio: number }` (points: raster px)
  - `class StickerError extends Error { code: 'NO_ALPHA' | 'EMPTY' }`
  - `isFullyOpaque(r): boolean`, `traceBoundary(m): Pt[]`, `smoothClosed(pts, window): Pt[]`, `simplifyClosed(pts, eps): Pt[]`
  - `stickerCutShape(r: Raster, o: CutShapeOptions): CutShape`

- [ ] **Step 1: Geometri için failing testi yaz**

`tests/core/geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  multiply, apply, invert, itemMatrix, transformPoints, closedPathSvg,
  polygonBounds, pointInPolygon, type Affine,
} from '../../src/core/geometry';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('geometry', () => {
  it('multiply önce sağdakini uygular', () => {
    const t: Affine = [1, 0, 0, 1, 10, 0];
    const s: Affine = [2, 0, 0, 2, 0, 0];
    close(apply(multiply(t, s), { x: 1, y: 1 }), { x: 12, y: 2 });
  });

  it('invert tersini verir', () => {
    const m: Affine = [2, 0.5, -0.3, 1.5, 7, -4];
    close(apply(multiply(invert(m), m), { x: 3, y: 5 }), { x: 3, y: 5 });
  });

  it('itemMatrix sticker merkezini x,y noktasına koyar', () => {
    const m = itemMatrix({ x: 100, y: 50, scale: 0.5, rotationDeg: 0 }, 200, 100);
    close(apply(m, { x: 100, y: 50 }), { x: 100, y: 50 });
    close(apply(m, { x: 0, y: 0 }), { x: 50, y: 25 });
  });

  it('itemMatrix 90° döndürmede sağ üst köşeyi sağ alta götürür', () => {
    const m = itemMatrix({ x: 0, y: 0, scale: 1, rotationDeg: 90 }, 20, 10);
    close(apply(m, { x: 20, y: 0 }), { x: 5, y: 10 });
  });

  it('closedPathSvg n nokta için n kübik segment üretir', () => {
    const d = closedPathSvg([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(4);
    expect(closedPathSvg([{ x: 0, y: 0 }])).toBe('');
  });

  it('transformPoints, polygonBounds, pointInPolygon', () => {
    const sq = transformPoints([1, 0, 0, 1, 5, 5], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(polygonBounds(sq)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
    expect(pointInPolygon({ x: 10, y: 10 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 1, y: 10 }, sq)).toBe(false);
  });
});
```

- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/core/geometry.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/geometry"`

- [ ] **Step 3: `src/core/geometry.ts`'i yaz**

```ts
export interface Pt { x: number; y: number }
/** x' = a·x + c·y + e, y' = b·x + d·y + f (PDF ve canvas ile aynı sıra) */
export type Affine = [number, number, number, number, number, number];
export interface Placement { x: number; y: number; scale: number; rotationDeg: number }

/** Önce m2, sonra m1 uygulanır. */
export function multiply(m1: Affine, m2: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

export function apply(m: Affine, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function transformPoints(m: Affine, pts: Pt[]): Pt[] {
  return pts.map((p) => apply(m, p));
}

/** Sticker px → tasarım px: merkez (x,y), ölçek, saat yönünde derece. */
export function itemMatrix(p: Placement, w: number, h: number): Affine {
  const t = (p.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t), s = p.scale;
  return multiply([cos, sin, -sin, cos, p.x, p.y], [s, 0, 0, s, (-s * w) / 2, (-s * h) / 2]);
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** Kapalı Catmull-Rom spline'ı kübik bezier SVG path'ine çevirir (affine dönüşüme göre değişmez). */
export function closedPathSvg(pts: Pt[]): string {
  const n = pts.length;
  if (n < 3) return '';
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return d + ' Z';
}

export function polygonBounds(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
```

- [ ] **Step 4: Geometri testlerinin geçtiğini gör**

Run: `npx vitest run tests/core/geometry.test.ts`
Expected: 6 test PASS.

- [ ] **Step 5: Kontur için failing testi yaz**

`tests/core/contour.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createMask, type Raster } from '../../src/core/raster';
import { traceBoundary, simplifyClosed, stickerCutShape, StickerError } from '../../src/core/contour';

function raster(size: number, fn: (x: number, y: number) => number): Raster {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    data[o] = 200; data[o + 1] = 50; data[o + 2] = 50; data[o + 3] = fn(x, y);
  }
  return { width: size, height: size, data };
}
const inCircle = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
const radii = (pts: { x: number; y: number }[], cx: number, cy: number) =>
  pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const opts = { alphaThreshold: 128, offsetPx: 0, smoothing: 0.5 };

describe('traceBoundary', () => {
  it('3x3 karenin 8 kenar pikselini sırayla verir', () => {
    const m = createMask(5, 5);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) m.data[y * 5 + x] = 1;
    const pts = traceBoundary(m);
    expect(pts).toHaveLength(8);
    expect(pts[0]).toEqual({ x: 1, y: 1 });
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(8);
  });

  it('tek piksel için tek nokta, boş maske için boş dizi', () => {
    const m = createMask(3, 3);
    expect(traceBoundary(m)).toEqual([]);
    m.data[4] = 1;
    expect(traceBoundary(m)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('simplifyClosed', () => {
  it('düz çizgi üzerindeki ara noktaları atar', () => {
    const pts = [];
    for (let x = 0; x < 10; x++) pts.push({ x, y: 0 });
    for (let y = 1; y < 10; y++) pts.push({ x: 9, y });
    for (let x = 8; x >= 0; x--) pts.push({ x, y: 9 });
    for (let y = 8; y > 0; y--) pts.push({ x: 0, y });
    expect(simplifyClosed(pts, 0.5)).toHaveLength(4);
  });
});

describe('stickerCutShape', () => {
  it('dairenin konturu yarıçapı korur', () => {
    const r = raster(400, (x, y) => (inCircle(x, y, 200, 200, 100) ? 255 : 0));
    const { points, extraPartsRatio } = stickerCutShape(r, opts);
    expect(Math.abs(mean(radii(points, 200, 200)) - 100)).toBeLessThan(1.5);
    expect(extraPartsRatio).toBe(0);
  });

  it('offset yarıçapı tam o kadar büyütür', () => {
    const r = raster(400, (x, y) => (inCircle(x, y, 200, 200, 100) ? 255 : 0));
    const { points } = stickerCutShape(r, { ...opts, offsetPx: 20 });
    expect(Math.abs(mean(radii(points, 200, 200)) - 120)).toBeLessThan(1.5);
  });

  it('kaçak lekeyi atar, iç boşluğu doldurur', () => {
    const r = raster(400, (x, y) => {
      if (x < 20 && y < 20) return 200; // leke
      const inRing = inCircle(x, y, 200, 200, 100) && !inCircle(x, y, 200, 200, 60);
      return inRing ? 255 : 0;
    });
    const { points, extraPartsRatio } = stickerCutShape(r, opts);
    const rs = radii(points, 200, 200);
    expect(Math.min(...rs)).toBeGreaterThan(95);
    expect(Math.max(...rs)).toBeLessThan(105);
    expect(extraPartsRatio).toBeGreaterThan(0);
    expect(extraPartsRatio).toBeLessThan(0.05);
  });

  it('büyük ikinci parçayı oranla raporlar', () => {
    const r = raster(400, (x, y) => (inCircle(x, y, 120, 200, 80) || inCircle(x, y, 320, 200, 50) ? 255 : 0));
    expect(stickerCutShape(r, opts).extraPartsRatio).toBeGreaterThan(0.3);
  });

  it('şeffaflığı olmayan PNG için NO_ALPHA hatası', () => {
    expect(() => stickerCutShape(raster(50, () => 255), opts)).toThrowError(StickerError);
    try { stickerCutShape(raster(50, () => 255), opts); } catch (e) { expect((e as StickerError).code).toBe('NO_ALPHA'); }
  });

  it('tamamen şeffaf PNG için EMPTY hatası', () => {
    try { stickerCutShape(raster(50, () => 0), opts); expect.unreachable(); }
    catch (e) { expect((e as StickerError).code).toBe('EMPTY'); }
  });

  it('büyük görüntüyü küçültüp orijinal koordinatlara geri ölçekler', () => {
    const r = raster(3000, (x, y) => (inCircle(x, y, 1500, 1500, 1000) ? 255 : 0));
    const { points } = stickerCutShape(r, opts);
    expect(Math.abs(mean(radii(points, 1500, 1500)) - 1000)).toBeLessThan(6);
  });
});
```

- [ ] **Step 6: Fail ettiğini gör**

Run: `npx vitest run tests/core/contour.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/contour"`

- [ ] **Step 7: `src/core/contour.ts`'i yaz**

```ts
import { type Mask, type Raster, alphaMask, downscaleMask, largestComponent, fillHoles, padMask } from './raster';
import { offsetMask } from './distance';
import type { Pt } from './geometry';

export interface CutShapeOptions {
  alphaThreshold: number;
  /** Raster pikseli cinsinden offset */
  offsetPx: number;
  /** 0 = ham, 1 = çok yumuşak */
  smoothing: number;
  maxWorkSize?: number;
}
export interface CutShape { points: Pt[]; extraPartsRatio: number }

export type StickerErrorCode = 'NO_ALPHA' | 'EMPTY';
export class StickerError extends Error {
  constructor(public code: StickerErrorCode, message: string) {
    super(message);
    this.name = 'StickerError';
  }
}

export function isFullyOpaque(r: Raster): boolean {
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] < 250) return false;
  return true;
}

// Saat yönünde 8 komşu (y aşağı): B, KB, K, KD, D, GD, G, GB
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
const dirIndex = (dx: number, dy: number) => {
  for (let d = 0; d < 8; d++) if (DX[d] === dx && DY[d] === dy) return d;
  return -1;
};

/** Moore komşuluk takibi (Jacob durdurma kuralı). Tek bileşenli, delikleri dolu maske beklenir. */
export function traceBoundary(m: Mask): Pt[] {
  const { width: w, height: h, data } = m;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < w * h; i++) if (data[i]) { start = i; break; }
  if (start < 0) return [];
  const sx = start % w, sy = (start / w) | 0;
  const pts: Pt[] = [];
  let x = sx, y = sy;
  let back = 0; // tarama sırası gereği batı komşusu boş
  const limit = 4 * w * h + 8;
  for (let iter = 0; iter < limit; iter++) {
    pts.push({ x, y });
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = x + DX[d], ny = y + DY[d];
      if (!on(nx, ny)) continue;
      const pd = (back + k - 1) % 8;
      const bx = x + DX[pd], by = y + DY[pd];
      x = nx;
      y = ny;
      back = dirIndex(bx - x, by - y);
      moved = true;
      break;
    }
    if (!moved) break;
    if (x === sx && y === sy && back === 0) break;
  }
  return pts;
}

export function smoothClosed(pts: Pt[], window: number): Pt[] {
  const n = pts.length;
  if (window <= 1 || n < window) return pts.slice();
  const half = window >> 1;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0;
    for (let k = -half; k <= half; k++) {
      const p = pts[(i + k + n) % n];
      sx += p.x;
      sy += p.y;
    }
    out.push({ x: sx / window, y: sy / window });
  }
  return out;
}

function douglasPeucker(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    let far = -1, fd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i].x - A.x) - dx * (pts[i].y - A.y)) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function simplifyClosed(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = douglasPeucker(pts.slice(0, far + 1), eps);
  const b = douglasPeucker([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

export function stickerCutShape(r: Raster, o: CutShapeOptions): CutShape {
  if (isFullyOpaque(r)) {
    throw new StickerError('NO_ALPHA', 'Bu PNG’de şeffaf alan yok, kesim çizgisi çıkarılamıyor.');
  }
  const f = Math.min(1, (o.maxWorkSize ?? 1024) / Math.max(r.width, r.height));
  const small = downscaleMask(alphaMask(r, o.alphaThreshold), f);
  const sx = r.width / small.width, sy = r.height / small.height;
  const { mask: main, area, otherAreas } = largestComponent(small);
  if (area === 0) throw new StickerError('EMPTY', 'Bu PNG tamamen şeffaf, kesilecek bir şekil yok.');
  const filled = fillHoles(main);
  const radius = o.offsetPx / sx;
  const { mask, pad } = radius > 0 ? offsetMask(filled, radius) : { mask: padMask(filled, 1), pad: 1 };
  const window = 1 + 2 * Math.round(Math.max(0, Math.min(1, o.smoothing)) * 6);
  const simplified = simplifyClosed(smoothClosed(traceBoundary(mask), window), 0.5);
  const maxOther = otherAreas.reduce((m, a) => Math.max(m, a), 0);
  return {
    points: simplified.map((p) => ({ x: (p.x - pad + 0.5) * sx, y: (p.y - pad + 0.5) * sy })),
    extraPartsRatio: maxOther / area,
  };
}
```

- [ ] **Step 8: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core && npm run typecheck`
Expected: Tüm core testleri PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/geometry.ts src/core/contour.ts tests/core/geometry.test.ts tests/core/contour.test.ts
git commit -m "feat(core): geometri ve alfadan kesim konturu"
```

---

### Task 4: Render yardımcıları ve sentetik sahne

**Files:**
- Create: `src/core/render.ts`, `tests/helpers/scene.ts`
- Test: `tests/core/render.test.ts`

**Interfaces:**
- Consumes: `Raster` (T1), `Affine`, `apply`, `invert`, `Pt` (T3)
- Produces (`render.ts`):
  - `createRaster(w, h): Raster` (Uint8ClampedArray, şeffaf)
  - `cloneRaster(r): Raster`
  - `compositeOverWhite(r): Raster` (opak kopya)
  - `drawRaster(dst, src, m: Affine): void` — m: src px → dst px, en yakın komşu, src-over
  - `downscaleRaster(r, f): Raster` — alfa ağırlıklı kutu filtresi
  - `strokePolyline(dst, pts, closed, color: [r,g,b], width): void`
- Produces (`tests/helpers/scene.ts`): `paint`, `STICKERS`, `background()`, `PLACEMENTS`, `makeScene(placements?)` → `{ design, background, stickers: {file, raster}[] }`

- [ ] **Step 1: Failing testi yaz**

`tests/core/render.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  createRaster, compositeOverWhite, drawRaster, downscaleRaster, strokePolyline,
} from '../../src/core/render';
import { itemMatrix } from '../../src/core/geometry';

const px = (r: { width: number; data: ArrayLike<number> }, x: number, y: number) =>
  Array.from({ length: 4 }, (_, c) => r.data[(y * r.width + x) * 4 + c]);

describe('render', () => {
  it('compositeOverWhite yarı saydamı beyazla karıştırır', () => {
    const r = createRaster(1, 1);
    r.data.set([0, 0, 0, 128]);
    expect(px(compositeOverWhite(r), 0, 0)).toEqual([127, 127, 127, 255]);
  });

  it('drawRaster sticker pikselini beklenen yere koyar', () => {
    const dst = createRaster(100, 100);
    dst.data.fill(255);
    const src = createRaster(10, 10);
    src.data.set([255, 0, 0, 255], (0 * 10 + 0) * 4); // sol üst köşe kırmızı
    drawRaster(dst, src, itemMatrix({ x: 50, y: 50, scale: 2, rotationDeg: 0 }, 10, 10));
    expect(px(dst, 40, 40)).toEqual([255, 0, 0, 255]);
    expect(px(dst, 41, 41)).toEqual([255, 0, 0, 255]);
    expect(px(dst, 42, 42)).toEqual([255, 255, 255, 255]);
  });

  it('downscaleRaster alfa ağırlıklı ortalar', () => {
    const r = createRaster(2, 2);
    r.data.set([255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0]);
    const d = downscaleRaster(r, 0.5);
    expect(d.width).toBe(1);
    expect(px(d, 0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('strokePolyline çizgi boyunca renk basar', () => {
    const r = createRaster(20, 20);
    strokePolyline(r, [{ x: 2, y: 10 }, { x: 18, y: 10 }], false, [255, 0, 0], 2);
    expect(px(r, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(px(r, 10, 15)[3]).toBe(0);
  });
});
```

- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/core/render.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/render"`

- [ ] **Step 3: `src/core/render.ts`'i yaz**

```ts
import type { Raster } from './raster';
import { type Affine, type Pt, apply, invert } from './geometry';

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
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core/render.test.ts`
Expected: 4 test PASS.

- [ ] **Step 5: Sentetik sahne yardımcısını yaz**

`tests/helpers/scene.ts`:
```ts
import type { Raster } from '../../src/core/raster';
import { createRaster, cloneRaster, drawRaster } from '../../src/core/render';
import { itemMatrix } from '../../src/core/geometry';

type RGBA = [number, number, number, number];

export function paint(w: number, h: number, fn: (x: number, y: number) => RGBA | null): Raster {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y);
    if (c) r.data.set(c, (y * w + x) * 4);
  }
  return r;
}

const inCircle = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;

/** Aynı daire silüetli iki sticker (çay/kahve) sadece renk deseniyle ayrışır — gerçek fincanlar gibi. */
export const STICKERS: Record<string, () => Raster> = {
  'cay.png': () => paint(400, 400, (x, y) =>
    inCircle(x, y, 200, 200, 180) ? ((((x >> 3) + (y >> 3)) & 1) ? [220, 40, 40, 255] : [255, 255, 255, 255]) : null),
  'kahve.png': () => paint(400, 400, (x, y) =>
    inCircle(x, y, 200, 200, 180) ? (((y / 10) | 0) & 1 ? [40, 60, 200, 255] : [250, 220, 40, 255]) : null),
  'baklava.png': () => paint(400, 400, (x, y) =>
    x >= 50 && x < 350 && y >= 80 && y < 320 ? (x % 24 < 6 && y % 24 < 6 ? [110, 60, 20, 255] : [240, 150, 40, 255]) : null),
  'kullanilmayan.png': () => paint(400, 400, (x, y) =>
    y > 40 && y < 360 && Math.abs(x - 200) < (y - 40) / 2 ? [130, 40, 160, 255] : null),
};

export const BG: RGBA = [200, 220, 140, 255];
export function background(w = 800, h = 1200): Raster {
  return paint(w, h, (x, y) => ((x * 7 + y * 13) % 97 === 0 ? [90, 120, 60, 255] : BG));
}

export interface ScenePlacement { file: string; x: number; y: number; scale: number }
export const PLACEMENTS: ScenePlacement[] = [
  { file: 'cay.png', x: 220, y: 260, scale: 0.5 },
  { file: 'kahve.png', x: 580, y: 280, scale: 0.6 },
  { file: 'baklava.png', x: 220, y: 880, scale: 0.5 },
  { file: 'cay.png', x: 560, y: 900, scale: 0.4 },
];

export function makeScene(placements: ScenePlacement[] = PLACEMENTS) {
  const stickers = Object.entries(STICKERS).map(([file, make]) => ({ file, raster: make() }));
  const bg = background();
  const design = cloneRaster(bg);
  for (const p of placements) {
    const s = stickers.find((st) => st.file === p.file)!.raster;
    drawRaster(design, s, itemMatrix({ ...p, rotationDeg: 0 }, s.width, s.height));
  }
  return { design, background: bg, stickers };
}
```

- [ ] **Step 6: Typecheck ve commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/core/render.ts tests/core/render.test.ts tests/helpers/scene.ts
git commit -m "feat(core): render yardımcıları ve sentetik test sahnesi"
```

---

### Task 5: Proje modeli (`pack.json`)

**Files:**
- Create: `src/core/project.ts`
- Test: `tests/core/project.test.ts`

**Interfaces:**
- Produces:
  - `interface Settings { offsetMm: number; whiteBorder: boolean; strokeWidthPt: number; smoothing: number; alphaThreshold: number }`
  - `const DEFAULT_SETTINGS: Settings` (`0, false, 1, 0.5, 128`)
  - `interface Item { id: string; file: string; x: number; y: number; scale: number; rotationDeg: number; printOnly: boolean; needsReview: boolean; matchScore: number | null; overrides: Partial<Settings> }`
  - `interface Pack { version: 1; page: { widthMm: number; heightMm: number }; designSize: { widthPx: number; heightPx: number }; files: { design: string; background: string }; defaults: Settings; items: Item[] }`
  - `const PT_PER_MM = 72 / 25.4`
  - `class PackError extends Error { problems: string[] }`
  - `nfc(s): string`, `effectiveSettings(pack, item): Settings`, `mmPerDesignPx(pack): { x: number; y: number }`, `aspectMismatch(pack): number`, `nextItemId(pack): string`, `parsePack(text): Pack`, `serializePack(pack): string`

- [ ] **Step 1: Failing testi yaz**

`tests/core/project.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  parsePack, serializePack, effectiveSettings, mmPerDesignPx, aspectMismatch,
  nextItemId, nfc, PackError, DEFAULT_SETTINGS,
} from '../../src/core/project';

const minimal = {
  version: 1,
  page: { widthMm: 80, heightMm: 140 },
  designSize: { widthPx: 1600, heightPx: 2800 },
  files: { design: 'tasarim.png', background: 'arka.png' },
  items: [{ id: 'i1', file: 'kahve.png', x: 100, y: 200, scale: 0.2 }],
};

describe('project', () => {
  it('eksik alanları varsayılanlarla doldurur', () => {
    const p = parsePack(JSON.stringify(minimal));
    expect(p.defaults).toEqual(DEFAULT_SETTINGS);
    expect(p.items[0]).toMatchObject({ rotationDeg: 0, printOnly: false, needsReview: false, matchScore: null, overrides: {} });
  });

  it('serialize → parse aynı paketi verir', () => {
    const p = parsePack(JSON.stringify(minimal));
    expect(parsePack(serializePack(p))).toEqual(p);
  });

  it('geçersiz paket için tüm sorunları Türkçe listeler', () => {
    const bad = { ...minimal, page: { widthMm: -1, heightMm: 140 }, items: [{ id: 'i1', file: 'x.png', x: 'a', y: 1, scale: 1 }] };
    try { parsePack(JSON.stringify(bad)); expect.unreachable(); }
    catch (e) {
      expect(e).toBeInstanceOf(PackError);
      expect((e as PackError).problems).toEqual([
        'page.widthMm pozitif bir sayı olmalı',
        'items[0].x sayı olmalı',
      ]);
    }
  });

  it('bozuk JSON için PackError', () => {
    expect(() => parsePack('{')).toThrowError(PackError);
  });

  it('dosya adlarını NFC’ye çevirir', () => {
    const nfd = 'çay.png'.normalize('NFD');
    const p = parsePack(JSON.stringify({ ...minimal, items: [{ ...minimal.items[0], file: nfd }] }));
    expect(p.items[0].file).toBe(nfc('çay.png'));
    expect(p.items[0].file).not.toBe(nfd);
  });

  it('effectiveSettings override’ları uygular', () => {
    const p = parsePack(JSON.stringify(minimal));
    p.items[0].overrides = { offsetMm: 1.5 };
    expect(effectiveSettings(p, p.items[0])).toEqual({ ...DEFAULT_SETTINGS, offsetMm: 1.5 });
  });

  it('birim dönüşümleri ve oran farkı', () => {
    const p = parsePack(JSON.stringify(minimal));
    expect(mmPerDesignPx(p)).toEqual({ x: 0.05, y: 0.05 });
    expect(aspectMismatch(p)).toBeCloseTo(0, 6);
    p.page.heightMm = 150;
    expect(aspectMismatch(p)).toBeGreaterThan(0.01);
  });

  it('nextItemId boştaki ilk id’yi verir', () => {
    const p = parsePack(JSON.stringify(minimal));
    expect(nextItemId(p)).toBe('i2');
  });
});
```

- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/core/project.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/project"`

- [ ] **Step 3: `src/core/project.ts`'i yaz**

```ts
export interface Settings {
  offsetMm: number;
  whiteBorder: boolean;
  strokeWidthPt: number;
  smoothing: number;
  alphaThreshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  offsetMm: 0,
  whiteBorder: false,
  strokeWidthPt: 1,
  smoothing: 0.5,
  alphaThreshold: 128,
};

export interface Item {
  id: string;
  file: string;
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  printOnly: boolean;
  needsReview: boolean;
  matchScore: number | null;
  overrides: Partial<Settings>;
}

export interface Pack {
  version: 1;
  page: { widthMm: number; heightMm: number };
  designSize: { widthPx: number; heightPx: number };
  files: { design: string; background: string };
  defaults: Settings;
  items: Item[];
}

export const PT_PER_MM = 72 / 25.4;

export class PackError extends Error {
  constructor(public problems: string[]) {
    super(`pack.json geçersiz:\n- ${problems.join('\n- ')}`);
    this.name = 'PackError';
  }
}

export const nfc = (s: string): string => s.normalize('NFC');

export function effectiveSettings(pack: Pack, item: Item): Settings {
  return { ...pack.defaults, ...item.overrides };
}

export function mmPerDesignPx(pack: Pack): { x: number; y: number } {
  return { x: pack.page.widthMm / pack.designSize.widthPx, y: pack.page.heightMm / pack.designSize.heightPx };
}

export function aspectMismatch(pack: Pack): number {
  const page = pack.page.widthMm / pack.page.heightMm;
  const design = pack.designSize.widthPx / pack.designSize.heightPx;
  return Math.abs(page - design) / design;
}

export function nextItemId(pack: Pack): string {
  const ids = new Set(pack.items.map((i) => i.id));
  let n = 1;
  while (ids.has(`i${n}`)) n++;
  return `i${n}`;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parsePack(text: string): Pack {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new PackError([`JSON okunamadı: ${(e as Error).message}`]); }
  const problems: string[] = [];
  if (!isObj(raw)) throw new PackError(['Kök bir nesne olmalı']);
  if (raw.version !== 1) problems.push('version 1 olmalı');
  const page = isObj(raw.page) ? raw.page : {};
  const size = isObj(raw.designSize) ? raw.designSize : {};
  const files = isObj(raw.files) ? raw.files : {};
  const positive = (v: unknown, name: string) => { if (!isNum(v) || v <= 0) problems.push(`${name} pozitif bir sayı olmalı`); };
  positive(page.widthMm, 'page.widthMm');
  positive(page.heightMm, 'page.heightMm');
  positive(size.widthPx, 'designSize.widthPx');
  positive(size.heightPx, 'designSize.heightPx');
  if (typeof files.design !== 'string') problems.push('files.design bir dosya adı olmalı');
  if (typeof files.background !== 'string') problems.push('files.background bir dosya adı olmalı');
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  if (!Array.isArray(raw.items)) problems.push('items bir dizi olmalı');
  const items: Item[] = rawItems.map((it: unknown, i: number) => {
    const o = isObj(it) ? it : {};
    if (typeof o.file !== 'string') problems.push(`items[${i}].file bir dosya adı olmalı`);
    for (const k of ['x', 'y', 'scale'] as const) if (!isNum(o[k])) problems.push(`items[${i}].${k} sayı olmalı`);
    return {
      id: typeof o.id === 'string' ? o.id : '',
      file: nfc(String(o.file ?? '')),
      x: o.x as number,
      y: o.y as number,
      scale: o.scale as number,
      rotationDeg: isNum(o.rotationDeg) ? o.rotationDeg : 0,
      printOnly: o.printOnly === true,
      needsReview: o.needsReview === true,
      matchScore: isNum(o.matchScore) ? o.matchScore : null,
      overrides: isObj(o.overrides) ? (o.overrides as Partial<Settings>) : {},
    };
  });
  if (problems.length) throw new PackError(problems);
  const pack: Pack = {
    version: 1,
    page: { widthMm: page.widthMm as number, heightMm: page.heightMm as number },
    designSize: { widthPx: size.widthPx as number, heightPx: size.heightPx as number },
    files: { design: nfc(files.design as string), background: nfc(files.background as string) },
    defaults: { ...DEFAULT_SETTINGS, ...(isObj(raw.defaults) ? (raw.defaults as Partial<Settings>) : {}) },
    items: [],
  };
  for (const item of items) {
    if (!item.id) item.id = nextItemId(pack);
    pack.items.push(item);
  }
  return pack;
}

export function serializePack(pack: Pack): string {
  return JSON.stringify(pack, null, 2) + '\n';
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core/project.test.ts && npm run typecheck`
Expected: 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/project.ts tests/core/project.test.ts
git commit -m "feat(core): pack.json modeli, doğrulama ve varsayılanlar"
```

---

### Task 6: Rol tanıma

**Files:**
- Create: `src/core/roles.ts`
- Test: `tests/core/roles.test.ts`

**Interfaces:**
- Consumes: `Raster` (T1), `nfc` (T5)
- Produces:
  - `interface RoleInput { file: string; raster: Raster }`
  - `interface RoleResult { design: string | null; background: string | null; stickers: string[]; ambiguous: boolean; reason?: string }`
  - `transparencyRatio(r): number`, `contentScore(r): number`
  - `assignRoles(inputs: RoleInput[], hints?: { design?: string; background?: string }): RoleResult`

- [ ] **Step 1: Failing testi yaz**

`tests/core/roles.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assignRoles, transparencyRatio, contentScore } from '../../src/core/roles';
import { makeScene, background } from '../helpers/scene';

const scene = makeScene();
const stickerInputs = scene.stickers.map((s) => ({ file: s.file, raster: s.raster }));

describe('roles', () => {
  it('şeffaflık oranı ve içerik skoru', () => {
    expect(transparencyRatio(scene.design)).toBe(0);
    expect(transparencyRatio(scene.stickers[0].raster)).toBeGreaterThan(0.2);
    expect(contentScore(scene.design)).toBeGreaterThan(contentScore(scene.background));
  });

  it('isim ipucuyla arka planı seçer', () => {
    const r = assignRoles([
      { file: 'tasarim.png', raster: scene.design },
      { file: 'bases/turk kahvesi arka.png', raster: scene.background },
      ...stickerInputs,
    ]);
    expect(r).toMatchObject({ design: 'tasarim.png', background: 'bases/turk kahvesi arka.png', ambiguous: false });
    expect(r.stickers.sort()).toEqual(['baklava.png', 'cay.png', 'kahve.png', 'kullanilmayan.png']);
  });

  it('ipucu yoksa içeriği fazla olanı tam tasarım sayar', () => {
    const r = assignRoles([{ file: 'b.png', raster: scene.background }, { file: 'a.png', raster: scene.design }]);
    expect(r.design).toBe('a.png');
    expect(r.background).toBe('b.png');
  });

  it('iki aday çift varsa belirsiz der', () => {
    const other = background(500, 700);
    const r = assignRoles([
      { file: 'a.png', raster: scene.design }, { file: 'b.png', raster: scene.background },
      { file: 'c.png', raster: other }, { file: 'd.png', raster: other },
    ]);
    expect(r.ambiguous).toBe(true);
    expect(r.design).toBeNull();
    expect(r.reason).toContain('Birden fazla');
  });

  it('sadece tasarım ipucu verilirse aynı boyuttaki diğer opak dosyayı arka plan yapar', () => {
    const other = background(500, 700);
    const r = assignRoles([
      { file: 'a.png', raster: scene.design }, { file: 'b.png', raster: scene.background },
      { file: 'c.png', raster: other }, { file: 'd.png', raster: other },
    ], { design: 'a.png' });
    expect(r).toMatchObject({ design: 'a.png', background: 'b.png', ambiguous: false });
  });

  it('hiç çift yoksa açıklayıcı neden verir', () => {
    const r = assignRoles(stickerInputs);
    expect(r.ambiguous).toBe(true);
    expect(r.reason).toContain('bulunamadı');
  });
});
```

- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/core/roles.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/roles"`

- [ ] **Step 3: `src/core/roles.ts`'i yaz**

```ts
import type { Raster } from './raster';
import { nfc } from './project';

export interface RoleInput { file: string; raster: Raster }
export interface RoleResult {
  design: string | null;
  background: string | null;
  stickers: string[];
  ambiguous: boolean;
  reason?: string;
}

const BG_HINT = /arka|background|\bbg\b|boş|bos\b|empty/i;

export function transparencyRatio(r: Raster): number {
  let t = 0, n = 0;
  for (let o = 3; o < r.data.length; o += 16) { n++; if (r.data[o] < 128) t++; }
  return n ? t / n : 0;
}

/** Baskın renk kovası dışındaki piksel oranı (arka plan düz, tam tasarım karmaşık). */
export function contentScore(r: Raster): number {
  const counts = new Map<number, number>();
  let total = 0;
  for (let o = 0; o < r.data.length; o += 28) {
    const key = ((r.data[o] >> 4) << 8) | ((r.data[o + 1] >> 4) << 4) | (r.data[o + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  let dominant = 0;
  for (const c of counts.values()) if (c > dominant) dominant = c;
  return total ? 1 - dominant / total : 0;
}

export function assignRoles(inputs: RoleInput[], hints: { design?: string; background?: string } = {}): RoleResult {
  const all = inputs.map((i) => ({ ...i, file: nfc(i.file) }));
  const transparent = new Set(all.filter((i) => transparencyRatio(i.raster) >= 0.05).map((i) => i.file));
  const opaque = all.filter((i) => !transparent.has(i.file));
  const stickersExcept = (...names: string[]) => [...transparent].filter((f) => !names.includes(f));
  const hd = hints.design && nfc(hints.design), hb = hints.background && nfc(hints.background);

  if (hd && hb) return { design: hd, background: hb, stickers: stickersExcept(hd, hb), ambiguous: false };

  const sizeKey = (r: Raster) => `${r.width}x${r.height}`;
  if (hd || hb) {
    const given = all.find((i) => i.file === (hd ?? hb));
    const partner = given && opaque.find((i) => i.file !== given.file && sizeKey(i.raster) === sizeKey(given.raster));
    if (given && partner) {
      const [design, background] = hd ? [given.file, partner.file] : [partner.file, given.file];
      return { design, background, stickers: stickersExcept(design, background), ambiguous: false };
    }
  }

  const groups = new Map<string, RoleInput[]>();
  for (const i of opaque) groups.set(sizeKey(i.raster), [...(groups.get(sizeKey(i.raster)) ?? []), i]);
  const pairs = [...groups.values()].filter((g) => g.length >= 2);
  if (pairs.length !== 1 || pairs[0].length !== 2) {
    return {
      design: null,
      background: null,
      stickers: [...transparent],
      ambiguous: true,
      reason: pairs.length === 0
        ? 'Aynı boyutta iki opak PNG (tam tasarım + arka plan) bulunamadı.'
        : 'Birden fazla tam tasarım/arka plan adayı var; hangisinin kullanılacağını seç.',
    };
  }
  const [a, b] = pairs[0];
  const aBg = BG_HINT.test(a.file), bBg = BG_HINT.test(b.file);
  let design: RoleInput, background: RoleInput;
  if (aBg !== bBg) [design, background] = aBg ? [b, a] : [a, b];
  else [design, background] = contentScore(a.raster) >= contentScore(b.raster) ? [a, b] : [b, a];
  return { design: design.file, background: background.file, stickers: [...transparent], ambiguous: false };
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core/roles.test.ts && npm run typecheck`
Expected: 6 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/roles.ts tests/core/roles.test.ts
git commit -m "feat(core): dosya rollerini tanıma"
```

---

### Task 7: Sticker eşleştirme

**Files:**
- Create: `src/core/match.ts`
- Test: `tests/core/match.test.ts`

**Interfaces:**
- Consumes: T1 raster fonksiyonları, `compositeOverWhite` (T4)
- Produces:
  - `interface MatchOptions { diffThreshold: number; minAreaRatio: number; reviewBelow: number; rejectBelow: number }`
  - `const DEFAULT_MATCH_OPTIONS` (`48, 0.001, 0.85, 0.5`)
  - `interface StickerInput { file: string; raster: Raster }`
  - `interface MatchedItem { file: string; x: number; y: number; scale: number; score: number; needsReview: boolean }` (scale: tasarım px / **raster** px)
  - `interface MatchResult { items: MatchedItem[]; unusedStickers: string[]; unmatchedRegions: BBox[] }`
  - `interface Region { bbox: BBox; mask: Mask }`
  - `diffMask(designOpaque, backgroundOpaque, threshold): Mask`, `findRegions(diff, minAreaRatio): Region[]`
  - `matchStickers(design, background, stickers, options?: Partial<MatchOptions>): MatchResult`

- [ ] **Step 1: Failing testi yaz**

`tests/core/match.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { matchStickers } from '../../src/core/match';
import { createRaster, cloneRaster } from '../../src/core/render';
import { makeScene, PLACEMENTS } from '../helpers/scene';

describe('matchStickers', () => {
  it('tüm kopyaları doğru sticker, konum (±1px) ve ölçekle (±%1) bulur', () => {
    const { design, background, stickers } = makeScene();
    const res = matchStickers(design, background, stickers);
    expect(res.items).toHaveLength(PLACEMENTS.length);
    expect(res.unmatchedRegions).toEqual([]);
    for (const p of PLACEMENTS) {
      const hit = res.items.find((i) => Math.hypot(i.x - p.x, i.y - p.y) < 3);
      expect(hit, `${p.file} @ ${p.x},${p.y}`).toBeDefined();
      expect(hit!.file).toBe(p.file);
      expect(Math.abs(hit!.x - p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(hit!.y - p.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(hit!.scale / p.scale - 1)).toBeLessThan(0.01);
      expect(hit!.needsReview).toBe(false);
    }
    expect(res.unusedStickers).toEqual(['kullanilmayan.png']);
  });

  it('birbirine değen iki sticker için emin olmadan yerleştirmez, eşleşmeyen bölge bildirir', () => {
    const { design, background, stickers } = makeScene([
      { file: 'cay.png', x: 300, y: 300, scale: 0.5 },
      { file: 'cay.png', x: 470, y: 300, scale: 0.5 },
    ]);
    const res = matchStickers(design, background, stickers);
    expect(res.items).toEqual([]);
    expect(res.unmatchedRegions).toHaveLength(1);
  });

  it('tasarımdaki şeffaf alanlar (RGB çöp) sahte bölge üretmez', () => {
    const { background, stickers } = makeScene([]);
    const design = cloneRaster(background);
    const bg = cloneRaster(background);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
      const o = (y * design.width + x) * 4;
      design.data.set([(x * 37) % 256, (y * 91) % 256, 17, 0], o);
      bg.data.set([0, 0, 0, 0], o);
    }
    const res = matchStickers(design, bg, stickers);
    expect(res.items).toEqual([]);
    expect(res.unmatchedRegions).toEqual([]);
  });

  it('farklı boyutlu tasarım ve arka planı reddeder', () => {
    const { design, stickers } = makeScene([]);
    expect(() => matchStickers(design, createRaster(10, 10), stickers)).toThrow('aynı boyutta');
  });
});
```

- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/core/match.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/match"`

- [ ] **Step 3: `src/core/match.ts`'i yaz**

```ts
import {
  type BBox, type Mask, type Raster, createMask, alphaMask, downscaleMask, largestComponent,
  labelComponents, fillHoles, dilateSquare, erodeSquare,
} from './raster';
import { compositeOverWhite } from './render';

export interface MatchOptions { diffThreshold: number; minAreaRatio: number; reviewBelow: number; rejectBelow: number }
export const DEFAULT_MATCH_OPTIONS: MatchOptions = { diffThreshold: 48, minAreaRatio: 0.001, reviewBelow: 0.85, rejectBelow: 0.5 };

export interface StickerInput { file: string; raster: Raster }
/** scale: tasarım px / raster px */
export interface MatchedItem { file: string; x: number; y: number; scale: number; score: number; needsReview: boolean }
export interface MatchResult { items: MatchedItem[]; unusedStickers: string[]; unmatchedRegions: BBox[] }
export interface Region { bbox: BBox; mask: Mask }

interface Prepared { file: string; raster: Raster; bbox: BBox }
/** tasarım = t + s·sticker */
interface Placement { s: number; tx: number; ty: number }

/** Girdiler opak (compositeOverWhite sonrası) olmalı. */
export function diffMask(design: Raster, background: Raster, threshold: number): Mask {
  const a = design.data, b = background.data;
  const m = createMask(design.width, design.height);
  for (let i = 0, o = 0; i < m.data.length; i++, o += 4) {
    const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
    m.data[i] = d > threshold ? 1 : 0;
  }
  return m;
}

export function findRegions(diff: Mask, minAreaRatio: number): Region[] {
  const opened = dilateSquare(erodeSquare(diff, 1), 1);
  const closed = erodeSquare(dilateSquare(opened, 4), 4);
  const { labels, areas } = labelComponents(closed);
  const w = closed.width;
  const box = areas.map(() => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1 }));
  for (let i = 0; i < labels.length; i++) {
    const k = labels[i];
    if (!k) continue;
    const x = i % w, y = (i / w) | 0, b = box[k];
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
  }
  const minArea = minAreaRatio * diff.width * diff.height;
  const regions: Region[] = [];
  for (let k = 1; k < areas.length; k++) {
    if (areas[k] < minArea) continue;
    const b = box[k];
    const bbox = { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
    const crop = createMask(bbox.w, bbox.h);
    for (let y = 0; y < bbox.h; y++) for (let x = 0; x < bbox.w; x++) {
      crop.data[y * bbox.w + x] = labels[(bbox.y + y) * w + bbox.x + x] === k ? 1 : 0;
    }
    regions.push({ bbox, mask: fillHoles(crop) });
  }
  return regions.sort((p, q) => p.bbox.y - q.bbox.y || p.bbox.x - q.bbox.x);
}

/** Kaçak lekeleri hariç tutan, en büyük parçanın tam çözünürlükte sıkı sınırı. */
function prepareSticker(s: StickerInput): Prepared | null {
  const r = s.raster;
  const full = alphaMask(r, 128);
  const small = downscaleMask(full, Math.min(1, 512 / Math.max(r.width, r.height)));
  const { mask: keep, area } = largestComponent(small);
  if (!area) return null;
  const keepD = dilateSquare(keep, 1);
  const sx = r.width / small.width, sy = r.height / small.height;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < r.height; y++) {
    const ky = Math.min(small.height - 1, Math.floor(y / sy));
    for (let x = 0; x < r.width; x++) {
      if (!full.data[y * r.width + x]) continue;
      if (!keepD.data[ky * small.width + Math.min(small.width - 1, Math.floor(x / sx))]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { file: s.file, raster: r, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

/** IoU(silüet) × renk benzerliği, bölge üzerinde n×n örnekle. */
function score(design: Raster, region: Region, st: Prepared, pl: Placement, n: number): number {
  const { bbox, mask } = region;
  const r = st.raster;
  let inter = 0, union = 0, diffSum = 0, diffCount = 0;
  for (let j = 0; j < n; j++) {
    const Y = Math.floor(bbox.y + ((j + 0.5) * bbox.h) / n);
    for (let i = 0; i < n; i++) {
      const X = Math.floor(bbox.x + ((i + 0.5) * bbox.w) / n);
      const regionOn = mask.data[(Y - bbox.y) * mask.width + (X - bbox.x)] === 1;
      const u = Math.floor((X + 0.5 - pl.tx) / pl.s), v = Math.floor((Y + 0.5 - pl.ty) / pl.s);
      const inside = u >= 0 && v >= 0 && u < r.width && v < r.height;
      const so = (v * r.width + u) * 4;
      const a = inside ? r.data[so + 3] : 0;
      const stOn = a >= 128;
      if (regionOn || stOn) union++;
      if (regionOn && stOn) inter++;
      if (a >= 250) {
        const d = (Y * design.width + X) * 4;
        diffSum += (Math.abs(r.data[so] - design.data[d]) + Math.abs(r.data[so + 1] - design.data[d + 1])
          + Math.abs(r.data[so + 2] - design.data[d + 2])) / 3;
        diffCount++;
      }
    }
  }
  if (!union || !diffCount) return 0;
  return (inter / union) * (1 - diffSum / diffCount / 255);
}

/** Merkez ve ölçek üzerinde tepe tırmanma. */
function refine(design: Raster, region: Region, st: Prepared, start: Placement): { pl: Placement; score: number } {
  const cu = st.bbox.x + st.bbox.w / 2, cv = st.bbox.y + st.bbox.h / 2;
  const at = (cx: number, cy: number, s: number): Placement => ({ s, tx: cx - s * cu, ty: cy - s * cv });
  let cx = start.tx + start.s * cu, cy = start.ty + start.s * cv, s = start.s;
  let best = score(design, region, st, start, 96);
  for (const step of [2, 1, 0.5]) {
    for (let iter = 0; iter < 10; iter++) {
      let improved = false;
      for (const ds of [1 - 0.005 * step, 1, 1 + 0.005 * step]) {
        for (const dx of [-step, 0, step]) {
          for (const dy of [-step, 0, step]) {
            if (ds === 1 && dx === 0 && dy === 0) continue;
            const cand = at(cx + dx, cy + dy, s * ds);
            const sc = score(design, region, st, cand, 96);
            if (sc > best) { best = sc; cx += dx; cy += dy; s *= ds; improved = true; }
          }
        }
      }
      if (!improved) break;
    }
  }
  return { pl: at(cx, cy, s), score: best };
}

export function matchStickers(
  design: Raster, background: Raster, stickers: StickerInput[], options: Partial<MatchOptions> = {},
): MatchResult {
  if (design.width !== background.width || design.height !== background.height) {
    throw new Error('Tam tasarım ve arka plan aynı boyutta olmalı.');
  }
  const o = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const dc = compositeOverWhite(design);
  const regions = findRegions(diffMask(dc, compositeOverWhite(background), o.diffThreshold), o.minAreaRatio);
  const prepared = stickers.map(prepareSticker).filter((p): p is Prepared => p !== null);
  const used = new Set<string>();
  const items: MatchedItem[] = [];
  const unmatchedRegions: BBox[] = [];
  for (const region of regions) {
    let best: { st: Prepared; pl: Placement; score: number } | null = null;
    for (const st of prepared) {
      const sx = region.bbox.w / st.bbox.w, sy = region.bbox.h / st.bbox.h;
      if (Math.abs(sx / sy - 1) > 0.1) continue;
      const s = (sx + sy) / 2;
      const pl = {
        s,
        tx: region.bbox.x + region.bbox.w / 2 - s * (st.bbox.x + st.bbox.w / 2),
        ty: region.bbox.y + region.bbox.h / 2 - s * (st.bbox.y + st.bbox.h / 2),
      };
      const sc = score(dc, region, st, pl, 48);
      if (!best || sc > best.score) best = { st, pl, score: sc };
    }
    if (!best || best.score < o.rejectBelow) { unmatchedRegions.push(region.bbox); continue; }
    const { pl, score: sc } = refine(dc, region, best.st, best.pl);
    used.add(best.st.file);
    items.push({
      file: best.st.file,
      x: pl.tx + (pl.s * best.st.raster.width) / 2,
      y: pl.ty + (pl.s * best.st.raster.height) / 2,
      scale: pl.s,
      score: sc,
      needsReview: sc < o.reviewBelow,
    });
  }
  return { items, unusedStickers: stickers.map((s) => s.file).filter((f) => !used.has(f)), unmatchedRegions };
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core/match.test.ts && npm run typecheck`
Expected: 4 test PASS. Konum/ölçek testi fail ederse: skorları `console.log` ile yazdırıp (global kural #6) hangi adımın (bölge bbox, ilk tahmin, refine) saptığını gör, sonra düzelt. Log'ları commit öncesi kaldır.

- [ ] **Step 5: Commit**

```bash
git add src/core/match.ts tests/core/match.test.ts
git commit -m "feat(core): fark maskesiyle sticker eşleştirme"
```

---

### Task 8: Pipeline ve yerleşim kontrolleri

**Files:**
- Create: `src/core/checks.ts`, `src/core/pipeline.ts`
- Test: `tests/core/pipeline.test.ts`

**Interfaces:**
- Consumes: T1–T7'deki her şey
- Produces (`pipeline.ts`):
  - `interface Asset { width: number; height: number; raster: Raster }` (width/height = **orijinal** boyut)
  - `interface LoadedFile extends Asset { name: string; bytes: Uint8Array }`
  - `type Level = 'error' | 'warning' | 'info'`
  - `interface Message { level: Level; code: string; text: string; itemId?: string; file?: string }`
  - `interface InitOptions { design?: string; background?: string; stickers?: string[]; page?: { widthMm: number; heightMm?: number }; match?: Partial<MatchOptions> }`
  - `interface InitResult { pack: Pack | null; roles: RoleResult; unmatchedRegions: BBox[]; messages: Message[] }`
  - `type CutCache = Map<string, CutShape>`
  - `prepareLoadedFile(name, bytes, raster): LoadedFile`
  - `initPack(files: LoadedFile[], opts?: InitOptions): InitResult`
  - `computeCuts(pack, assets: Map<string, Asset>, cache?: CutCache): { cuts: Map<string, Pt[]>; messages: Message[] }` (cuts: tasarım px)
  - `renderPackPreview(pack, assets: Map<string, Asset>, cuts: Map<string, Pt[]> | null): Raster`
  - `buildPackPdf(pack, files: Map<string, LoadedFile>, cache?): Promise<{ pdf: Uint8Array | null; messages: Message[] }>` — **Task 9'da** eklenir
  - `formatMessage(m: Message): string`
- Produces (`checks.ts`): `checkLayout(pack, cuts): Message[]` (kodlar `ASPECT`, `OUTSIDE_PAGE`, `OVERLAP`)

- [ ] **Step 1: Failing testi yaz**

`tests/core/pipeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initPack, computeCuts, prepareLoadedFile, renderPackPreview, type LoadedFile } from '../../src/core/pipeline';
import { checkLayout } from '../../src/core/checks';
import { createRaster } from '../../src/core/render';
import { makeScene, paint } from '../helpers/scene';

const EMPTY = new Uint8Array(0);
function sceneFiles(): LoadedFile[] {
  const s = makeScene();
  return [
    prepareLoadedFile('tasarim.png', EMPTY, s.design),
    prepareLoadedFile('arka.png', EMPTY, s.background),
    ...s.stickers.map((st) => prepareLoadedFile(st.file, EMPTY, st.raster)),
  ];
}
const assetsOf = (files: LoadedFile[]) => new Map(files.map((f) => [f.name, f]));

describe('prepareLoadedFile', () => {
  it('büyük şeffaf PNG’yi 2048’e küçültür, orijinal boyutu saklar', () => {
    const big = paint(3000, 3000, (x, y) => (x > 100 && y > 100 && x < 2900 && y < 2900 ? [1, 2, 3, 255] : null));
    const f = prepareLoadedFile('b.png', EMPTY, big);
    expect([f.width, f.height, f.raster.width]).toEqual([3000, 3000, 2048]);
  });
  it('opak büyük PNG’ye (tasarım) dokunmaz', () => {
    const opaque = { width: 3000, height: 10, data: new Uint8ClampedArray(3000 * 10 * 4).fill(255) };
    expect(prepareLoadedFile('d.png', EMPTY, opaque).raster.width).toBe(3000);
  });
  it('adı NFC yapar', () => {
    expect(prepareLoadedFile('ç.png'.normalize('NFD'), EMPTY, createRaster(1, 1)).name).toBe('ç.png'.normalize('NFC'));
  });
});

describe('initPack', () => {
  it('sahneden 4 öğeli paket kurar, kullanılmayanı bildirir', () => {
    const res = initPack(sceneFiles(), { page: { widthMm: 80 } });
    expect(res.pack!.items).toHaveLength(4);
    expect(res.pack!.page).toEqual({ widthMm: 80, heightMm: 120 });
    expect(res.pack!.files).toEqual({ design: 'tasarim.png', background: 'arka.png' });
    expect(res.messages.map((m) => m.code)).toContain('UNUSED_STICKER');
    expect(res.pack!.items.map((i) => i.id)).toEqual(['i1', 'i2', 'i3', 'i4']);
  });

  it('sayfa verilmezse 80 mm varsayar ve bilgi verir', () => {
    const res = initPack(sceneFiles());
    expect(res.pack!.page.widthMm).toBe(80);
    expect(res.messages.find((m) => m.code === 'PAGE_DEFAULT')?.level).toBe('info');
  });

  it('rol belirlenemezse pack null ve hata döner', () => {
    const res = initPack(sceneFiles().slice(2));
    expect(res.pack).toBeNull();
    expect(res.messages[0].level).toBe('error');
  });

  it('küçültülmüş raster’da scale’i orijinal boyuta göre verir', () => {
    const files = sceneFiles().map((f) => (f.name === 'cay.png'
      ? { ...f, width: 800, height: 800 } // raster 400 → orijinal 800 gibi davran
      : f));
    const res = initPack(files);
    const cays = res.pack!.items.filter((i) => i.file === 'cay.png').map((i) => i.scale).sort();
    expect(cays[0]).toBeCloseTo(0.2, 2);
    expect(cays[1]).toBeCloseTo(0.25, 2);
  });
});

describe('computeCuts', () => {
  it('her kesilen öğe için tasarım px’inde kontur üretir', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    const { cuts, messages } = computeCuts(pack!, assetsOf(files));
    expect(cuts.size).toBe(4);
    expect(messages.filter((m) => m.level === 'error')).toEqual([]);
    const cay = pack!.items.find((i) => i.file === 'cay.png' && i.scale > 0.45)!;
    const r = cuts.get(cay.id)!.map((p) => Math.hypot(p.x - cay.x, p.y - cay.y));
    expect(r.reduce((a, b) => a + b, 0) / r.length).toBeGreaterThan(88);
  });

  it('offset mm’yi öğe ölçeğine göre çevirir', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.defaults.offsetMm = 2; // 80mm / 800px → 1px = 0.1mm → 20 tasarım px
    const { cuts } = computeCuts(pack!, assetsOf(files));
    const cay = pack!.items.find((i) => i.file === 'cay.png' && i.scale > 0.45)!;
    const r = cuts.get(cay.id)!.map((p) => Math.hypot(p.x - cay.x, p.y - cay.y));
    expect(Math.abs(r.reduce((a, b) => a + b, 0) / r.length - 110)).toBeLessThan(2);
  });

  it('printOnly öğeleri kesmez; eksik dosya ve şeffafsız PNG için hata verir', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].printOnly = true;
    pack!.items[1].file = 'yok.png';
    const opaque = prepareLoadedFile('opak.png', EMPTY, { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) });
    pack!.items[2].file = 'opak.png';
    const { cuts, messages } = computeCuts(pack!, assetsOf([...files, opaque]));
    expect(cuts.has(pack!.items[0].id)).toBe(false);
    expect(messages.filter((m) => m.level === 'error').map((m) => m.code).sort()).toEqual(['MISSING_FILE', 'NO_ALPHA']);
  });
});

describe('checkLayout', () => {
  it('çakışan ve sayfa dışına taşan kesimleri uyarır', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[1].x = pack!.items[0].x + 30;
    pack!.items[1].y = pack!.items[0].y;
    pack!.items[2].x = 5;
    const { cuts } = computeCuts(pack!, assetsOf(files));
    const codes = checkLayout(pack!, cuts).map((m) => m.code);
    expect(codes).toContain('OVERLAP');
    expect(codes).toContain('OUTSIDE_PAGE');
  });

  it('sayfa oranı tasarımla uyuşmazsa uyarır', () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80, heightMm: 140 } });
    expect(checkLayout(pack!, new Map()).map((m) => m.code)).toEqual(['ASPECT']);
  });
});

describe('renderPackPreview', () => {
  it('arka plan boyutunda opak önizleme üretir', () => {
    const files = sceneFiles();
    const { pack } = initPack(files);
    const out = renderPackPreview(pack!, assetsOf(files), computeCuts(pack!, assetsOf(files)).cuts);
    expect([out.width, out.height]).toEqual([800, 1200]);
    expect(out.data[3]).toBe(255);
  });
});
```


- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/core/pipeline.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/pipeline"`

- [ ] **Step 3: `src/core/checks.ts`'i yaz**

```ts
import type { Pack } from './project';
import { aspectMismatch } from './project';
import { type Pt, polygonBounds, pointInPolygon } from './geometry';
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
  const entries = [...cuts.entries()].map(([id, pts]) => ({ id, pts, b: polygonBounds(pts) }));
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
```

- [ ] **Step 4: `src/core/pipeline.ts`'i yaz** (`buildPackPdf` Task 9'da eklenecek)

```ts
import { type BBox, type Raster } from './raster';
import { type Pt, itemMatrix, transformPoints, multiply, polygonBounds, apply } from './geometry';
import { type CutShape, StickerError, stickerCutShape } from './contour';
import { type Pack, DEFAULT_SETTINGS, effectiveSettings, mmPerDesignPx, nfc } from './project';
import { type RoleResult, assignRoles, transparencyRatio } from './roles';
import { type MatchOptions, matchStickers } from './match';
import { cloneRaster, compositeOverWhite, downscaleRaster, drawRaster, strokePolyline } from './render';
import { checkLayout } from './checks';

export interface Asset { width: number; height: number; raster: Raster }
export interface LoadedFile extends Asset { name: string; bytes: Uint8Array }
export type Level = 'error' | 'warning' | 'info';
export interface Message { level: Level; code: string; text: string; itemId?: string; file?: string }
export interface InitOptions {
  design?: string;
  background?: string;
  stickers?: string[];
  page?: { widthMm: number; heightMm?: number };
  match?: Partial<MatchOptions>;
}
export interface InitResult { pack: Pack | null; roles: RoleResult; unmatchedRegions: BBox[]; messages: Message[] }
export type CutCache = Map<string, CutShape>;

const ANALYSIS_MAX = 2048;
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function prepareLoadedFile(name: string, bytes: Uint8Array, raster: Raster): LoadedFile {
  const long = Math.max(raster.width, raster.height);
  const shrink = long > ANALYSIS_MAX && transparencyRatio(raster) >= 0.05;
  return {
    name: nfc(name),
    bytes,
    width: raster.width,
    height: raster.height,
    raster: shrink ? downscaleRaster(raster, ANALYSIS_MAX / long) : raster,
  };
}

export function formatMessage(m: Message): string {
  const prefix = m.level === 'error' ? 'HATA' : m.level === 'warning' ? 'UYARI' : 'BİLGİ';
  return `${prefix}: ${m.text}`;
}

export function initPack(files: LoadedFile[], opts: InitOptions = {}): InitResult {
  const byName = new Map(files.map((f) => [f.name, f]));
  const roles = assignRoles(files.map((f) => ({ file: f.name, raster: f.raster })), {
    design: opts.design && nfc(opts.design),
    background: opts.background && nfc(opts.background),
  });
  const fail = (text: string): InitResult => ({ pack: null, roles, unmatchedRegions: [], messages: [{ level: 'error', code: 'ROLES', text }] });
  if (!roles.design || !roles.background) return fail(roles.reason ?? 'Tam tasarım ve arka plan belirlenemedi.');
  const design = byName.get(roles.design), background = byName.get(roles.background);
  if (!design) return fail(`Tam tasarım dosyası bulunamadı: ${roles.design}`);
  if (!background) return fail(`Arka plan dosyası bulunamadı: ${roles.background}`);

  const stickerFiles = (opts.stickers?.map(nfc) ?? roles.stickers)
    .map((n) => byName.get(n))
    .filter((f): f is LoadedFile => f !== undefined);
  const result = matchStickers(design.raster, background.raster, stickerFiles.map((f) => ({ file: f.name, raster: f.raster })), opts.match);

  const messages: Message[] = [];
  const widthMm = opts.page?.widthMm ?? 80;
  const heightMm = opts.page?.heightMm ?? round((widthMm * design.height) / design.width, 1);
  if (!opts.page) {
    messages.push({ level: 'info', code: 'PAGE_DEFAULT', text: `Sayfa boyutu verilmedi; ${widthMm} × ${heightMm} mm varsayıldı.` });
  }
  const pack: Pack = {
    version: 1,
    page: { widthMm, heightMm },
    designSize: { widthPx: design.width, heightPx: design.height },
    files: { design: design.name, background: background.name },
    defaults: { ...DEFAULT_SETTINGS },
    items: result.items.map((m, i) => {
      const f = byName.get(m.file)!;
      return {
        id: `i${i + 1}`,
        file: m.file,
        x: round(m.x, 2),
        y: round(m.y, 2),
        scale: round((m.scale * f.raster.width) / f.width, 6),
        rotationDeg: 0,
        printOnly: false,
        needsReview: m.needsReview,
        matchScore: round(m.score, 3),
        overrides: {},
      };
    }),
  };
  for (const item of pack.items) {
    if (item.needsReview) {
      messages.push({ level: 'warning', code: 'NEEDS_REVIEW', itemId: item.id, file: item.file,
        text: `"${item.file}" (${item.id}) eşleşmesi zayıf (skor ${item.matchScore}); yerini kontrol et.` });
    }
  }
  for (const file of result.unusedStickers) {
    messages.push({ level: 'warning', code: 'UNUSED_STICKER', file, text: `"${file}" tasarımda bulunamadı (kullanılmıyor olabilir).` });
  }
  for (const b of result.unmatchedRegions) {
    messages.push({ level: 'warning', code: 'UNMATCHED_REGION',
      text: `Tasarımda eşleşmeyen bir bölge var (x=${b.x}, y=${b.y}, ${b.w}×${b.h} px); bu sticker’ın PNG’si eksik olabilir.` });
  }
  return { pack, roles, unmatchedRegions: result.unmatchedRegions, messages };
}

export function computeCuts(pack: Pack, assets: Map<string, Asset>, cache: CutCache = new Map()): { cuts: Map<string, Pt[]>; messages: Message[] } {
  const cuts = new Map<string, Pt[]>();
  const messages: Message[] = [];
  const warned = new Set<string>();
  const mm = mmPerDesignPx(pack).x;
  for (const item of pack.items) {
    if (item.printOnly) continue;
    const a = assets.get(item.file);
    if (!a) {
      messages.push({ level: 'error', code: 'MISSING_FILE', itemId: item.id, file: item.file, text: `"${item.file}" dosyası projede yok.` });
      continue;
    }
    const s = effectiveSettings(pack, item);
    const rasterPerOrig = a.raster.width / a.width;
    const offsetRasterPx = round((s.offsetMm / (mm * item.scale)) * rasterPerOrig, 1);
    const key = `${item.file}|${offsetRasterPx}|${s.smoothing}|${s.alphaThreshold}`;
    let shape = cache.get(key);
    if (!shape) {
      try {
        shape = stickerCutShape(a.raster, { alphaThreshold: s.alphaThreshold, offsetPx: offsetRasterPx, smoothing: s.smoothing });
      } catch (e) {
        if (!(e instanceof StickerError)) throw e;
        messages.push({ level: 'error', code: e.code, itemId: item.id, file: item.file, text: `"${item.file}": ${e.message}` });
        continue;
      }
      cache.set(key, shape);
    }
    if (shape.extraPartsRatio > 0.05 && !warned.has(item.file)) {
      warned.add(item.file);
      messages.push({ level: 'warning', code: 'EXTRA_PARTS', itemId: item.id, file: item.file,
        text: `"${item.file}" birden fazla parçadan oluşuyor; sadece en büyük parça kesilecek.` });
    }
    const toOrig: [number, number, number, number, number, number] = [1 / rasterPerOrig, 0, 0, 1 / rasterPerOrig, 0, 0];
    cuts.set(item.id, transformPoints(multiply(itemMatrix(item, a.width, a.height), toOrig), shape.points));
  }
  messages.push(...checkLayout(pack, cuts));
  return { cuts, messages };
}

export function renderPackPreview(pack: Pack, assets: Map<string, Asset>, cuts: Map<string, Pt[]> | null): Raster {
  const bg = assets.get(pack.files.background);
  if (!bg) throw new Error(`Arka plan dosyası yok: ${pack.files.background}`);
  const out = cloneRaster(compositeOverWhite(bg.raster));
  for (const item of pack.items) {
    const a = assets.get(item.file);
    if (!a) continue;
    const k = a.width / a.raster.width;
    drawRaster(out, a.raster, multiply(itemMatrix(item, a.width, a.height), [k, 0, 0, k, 0, 0]));
  }
  if (cuts) for (const pts of cuts.values()) strokePolyline(out, pts, true, [255, 0, 0], 3);
  for (const item of pack.items) {
    const a = assets.get(item.file);
    if (!item.needsReview || !a) continue;
    const m = itemMatrix(item, a.width, a.height);
    const corners = [apply(m, { x: 0, y: 0 }), apply(m, { x: a.width, y: 0 }), apply(m, { x: a.width, y: a.height }), apply(m, { x: 0, y: a.height })];
    const b = polygonBounds(corners);
    strokePolyline(out, [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }], true, [255, 140, 0], 4);
  }
  return out;
}
```

- [ ] **Step 5: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core && npm run typecheck`
Expected: Tüm core testleri PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/checks.ts src/core/pipeline.ts tests/core/pipeline.test.ts
git commit -m "feat(core): pipeline (init, kesim hesabı, önizleme) ve yerleşim kontrolleri"
```

---

### Task 9: PDF üretimi

**Files:**
- Create: `src/core/pdf.ts`, `src/cli/png.ts`
- Modify: `src/core/pipeline.ts` (sonuna `buildPackPdf` ekle)
- Test: `tests/core/pdf.test.ts`

**Interfaces:**
- Consumes: `Pack`, `effectiveSettings`, `PT_PER_MM` (T5); geometri (T3); `computeCuts`, `LoadedFile`, `Message` (T8)
- Produces:
  - `interface PdfAsset { bytes: Uint8Array; width: number; height: number }`
  - `buildPdf({ pack, assets: Map<string, PdfAsset>, cuts: Map<string, Pt[]> }): Promise<Uint8Array>`
  - `buildPackPdf(pack, files: Map<string, LoadedFile>, cache?: CutCache): Promise<{ pdf: Uint8Array | null; messages: Message[] }>`
  - `src/cli/png.ts`: `decodePng(bytes: Uint8Array): Raster`, `encodePng(r: Raster): Uint8Array`

- [ ] **Step 1: `src/cli/png.ts`'i yaz** (testlerde PNG bytes üretmek için gerekiyor)

```ts
import { PNG } from 'pngjs';
import type { Raster } from '../core/raster';

export function decodePng(bytes: Uint8Array): Raster {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
}

export function encodePng(r: Raster): Uint8Array {
  const png = new PNG({ width: r.width, height: r.height });
  png.data = Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  return new Uint8Array(PNG.sync.write(png));
}
```

- [ ] **Step 2: Failing testi yaz**

`tests/core/pdf.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { initPack, buildPackPdf, prepareLoadedFile, type LoadedFile } from '../../src/core/pipeline';
import { encodePng } from '../../src/cli/png';
import { makeScene } from '../helpers/scene';

function sceneFiles(): LoadedFile[] {
  const s = makeScene();
  const f = (name: string, r: Parameters<typeof encodePng>[0]) => prepareLoadedFile(name, encodePng(r), r);
  return [f('tasarim.png', s.design), f('arka.png', s.background), ...s.stickers.map((st) => f(st.file, st.raster))];
}

function pageContent(doc: PDFDocument, i: number): string {
  const c = doc.getPage(i).node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n');
}

describe('buildPackPdf', () => {
  it('2 sayfa, doğru mm boyutu, her kesilen öğe için bir kırmızı yol', async () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].printOnly = true;
    const { pdf, messages } = await buildPackPdf(pack!, new Map(files.map((f) => [f.name, f])));
    expect(messages.filter((m) => m.level === 'error')).toEqual([]);
    const doc = await PDFDocument.load(pdf!);
    expect(doc.getPageCount()).toBe(2);
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect(w).toBeCloseTo(226.772, 2);
    expect(h).toBeCloseTo(340.157, 2);
    expect(doc.getPage(1).getTrimBox()).toMatchObject({ width: w, height: h });

    const cut = pageContent(doc, 1);
    expect(cut.match(/\bh\b/g)).toHaveLength(3); // printOnly hariç 3 kapalı yol
    expect(cut).toMatch(/1 0 0 RG/);
    expect(cut).not.toMatch(/\bf\b/);

    const xobj = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const refs = new Set(xobj.values().map((v) => v.toString()));
    expect(refs.size).toBe(4); // arka plan + 3 benzersiz sticker (cay iki kez ama bir kez gömülü)
  });

  it('beyaz kenar açıksa 1. sayfaya beyaz dolgu ekler', async () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.defaults.whiteBorder = true;
    pack!.defaults.offsetMm = 1;
    const { pdf } = await buildPackPdf(pack!, new Map(files.map((f) => [f.name, f])));
    const print = pageContent(await PDFDocument.load(pdf!), 0);
    expect(print).toMatch(/1 1 1 rg/);
    expect(print.match(/\bf\b/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('hata varsa PDF üretmez', async () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].file = 'yok.png';
    const { pdf, messages } = await buildPackPdf(pack!, new Map(files.map((f) => [f.name, f])));
    expect(pdf).toBeNull();
    expect(messages.some((m) => m.code === 'MISSING_FILE')).toBe(true);
  });
});
```

- [ ] **Step 3: Fail ettiğini gör**

Run: `npx vitest run tests/core/pdf.test.ts`
Expected: FAIL — `buildPackPdf` export edilmiyor.

- [ ] **Step 4: `src/core/pdf.ts`'i yaz**

```ts
import {
  PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, type PDFImage,
} from 'pdf-lib';
import { type Pack, PT_PER_MM, effectiveSettings } from './project';
import { type Affine, type Pt, multiply, itemMatrix, transformPoints, closedPathSvg } from './geometry';

export interface PdfAsset { bytes: Uint8Array; width: number; height: number }
export interface BuildPdfInput { pack: Pack; assets: Map<string, PdfAsset>; cuts: Map<string, Pt[]> }

export async function buildPdf({ pack, assets, cuts }: BuildPdfInput): Promise<Uint8Array> {
  const W = pack.page.widthMm * PT_PER_MM, H = pack.page.heightMm * PT_PER_MM;
  const kx = W / pack.designSize.widthPx, ky = H / pack.designSize.heightPx;
  const toPt: Affine = [kx, 0, 0, ky, 0, 0];     // tasarım px → pt, y aşağı (drawSvgPath bunu bekler)
  const toPdf: Affine = [kx, 0, 0, -ky, 0, H];   // tasarım px → PDF koordinatı, y yukarı

  const doc = await PDFDocument.create();
  doc.setTitle('stickercut');
  doc.setCreator('stickercut');
  doc.setProducer('stickercut');

  const asset = (file: string) => {
    const a = assets.get(file);
    if (!a) throw new Error(`Dosya eksik: ${file}`);
    return a;
  };
  const images = new Map<string, PDFImage>();
  const image = async (file: string) => {
    let im = images.get(file);
    if (!im) { im = await doc.embedPng(asset(file).bytes); images.set(file, im); }
    return im;
  };

  const print = doc.addPage([W, H]);
  print.setTrimBox(0, 0, W, H);
  print.drawImage(await image(pack.files.background), { x: 0, y: 0, width: W, height: H });
  for (const item of pack.items) {
    const cut = cuts.get(item.id);
    if (cut && !item.printOnly && effectiveSettings(pack, item).whiteBorder) {
      print.drawSvgPath(closedPathSvg(transformPoints(toPt, cut)), { x: 0, y: H, color: rgb(1, 1, 1) });
    }
    const a = asset(item.file);
    const unitToSticker: Affine = [a.width, 0, 0, -a.height, 0, a.height];
    const m = multiply(toPdf, multiply(itemMatrix(item, a.width, a.height), unitToSticker));
    const name = print.node.newXObject('Image', (await image(item.file)).ref);
    print.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
  }

  const cutPage = doc.addPage([W, H]);
  cutPage.setTrimBox(0, 0, W, H);
  for (const item of pack.items) {
    const cut = cuts.get(item.id);
    if (!cut || item.printOnly) continue;
    cutPage.drawSvgPath(closedPathSvg(transformPoints(toPt, cut)), {
      x: 0, y: H, borderColor: rgb(1, 0, 0), borderWidth: effectiveSettings(pack, item).strokeWidthPt,
    });
  }
  return doc.save();
}
```

- [ ] **Step 5: `src/core/pipeline.ts` sonuna `buildPackPdf` ekle**

Dosyanın başındaki import'lara ekle:
```ts
import { buildPdf, type PdfAsset } from './pdf';
```
Dosyanın sonuna ekle:
```ts
export async function buildPackPdf(
  pack: Pack, files: Map<string, LoadedFile>, cache?: CutCache,
): Promise<{ pdf: Uint8Array | null; messages: Message[] }> {
  const { cuts, messages } = computeCuts(pack, files, cache);
  const needed = new Set([pack.files.background, ...pack.items.map((i) => i.file)]);
  const assets = new Map<string, PdfAsset>();
  for (const name of needed) {
    const f = files.get(name);
    if (f) assets.set(name, { bytes: f.bytes, width: f.width, height: f.height });
    else if (name === pack.files.background) {
      messages.push({ level: 'error', code: 'MISSING_FILE', file: name, text: `Arka plan dosyası "${name}" projede yok.` });
    }
  }
  if (messages.some((m) => m.level === 'error')) return { pdf: null, messages };
  return { pdf: await buildPdf({ pack, assets, cuts }), messages };
}
```

- [ ] **Step 6: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core && npm run typecheck`
Expected: PASS. `/\bh\b/` sayımı pdf-lib'in path çıktısına göre tutmazsa (ör. `Z` → `h` yerine başka operatör), `pageContent` çıktısını `console.log` ile yazdırıp gerçek operatörü gör ve testi o operatöre göre düzelt; sayının kesilen öğe sayısına eşit olması şartı değişmez.

- [ ] **Step 7: Commit**

```bash
git add src/core/pdf.ts src/core/pipeline.ts src/cli/png.ts tests/core/pdf.test.ts
git commit -m "feat(core): 2 sayfalı baskı + kesim PDF'i"
```

---

### Task 10: Proje zip'i ve core dışa aktarımı

**Files:**
- Create: `src/core/zip.ts`, `src/core/index.ts`
- Test: `tests/core/zip.test.ts`

**Interfaces:**
- Consumes: `nfc` (T5)
- Produces:
  - `packToZip(packJson: string, files: Map<string, Uint8Array>): Uint8Array`
  - `zipToPack(zip: Uint8Array): { packJson: string; files: Map<string, Uint8Array> }` (kökte `pack.json` yoksa `Error('Zip’te pack.json yok.')`; `__MACOSX/` ve dizin girdileri atlanır; adlar NFC)
  - `src/core/index.ts`: tüm core modüllerini yeniden dışa aktarır

- [ ] **Step 1: Failing testi yaz**

`tests/core/zip.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { packToZip, zipToPack } from '../../src/core/zip';

describe('zip', () => {
  it('Türkçe ve NFD adlarla round-trip', () => {
    const nfd = 'çay ve kahve/ğüşıöç.png'.normalize('NFD');
    const files = new Map([[nfd, new Uint8Array([1, 2, 3])], ['arka.png', new Uint8Array([4])]]);
    const out = zipToPack(packToZip('{"a":1}', files));
    expect(out.packJson).toBe('{"a":1}');
    expect([...out.files.keys()].sort()).toEqual(['arka.png', 'çay ve kahve/ğüşıöç.png'.normalize('NFC')]);
    expect([...out.files.get('çay ve kahve/ğüşıöç.png'.normalize('NFC'))!]).toEqual([1, 2, 3]);
  });

  it('pack.json yoksa hata, __MACOSX girdilerini atlar', () => {
    expect(() => zipToPack(zipSync({ 'a.png': strToU8('x') }))).toThrow('pack.json');
    const z = zipSync({ 'pack.json': strToU8('{}'), '__MACOSX/._a.png': strToU8('x'), 'a.png': strToU8('y') });
    expect([...zipToPack(z).files.keys()]).toEqual(['a.png']);
  });
});
```

- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/core/zip.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/zip"`

- [ ] **Step 3: `src/core/zip.ts` ve `src/core/index.ts`'i yaz**

`src/core/zip.ts`:
```ts
import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { nfc } from './project';

export function packToZip(packJson: string, files: Map<string, Uint8Array>): Uint8Array {
  const entries: Zippable = { 'pack.json': [strToU8(packJson), { level: 6 }] };
  for (const [name, bytes] of files) entries[nfc(name)] = [bytes, { level: 0 }];
  return zipSync(entries);
}

export function zipToPack(zip: Uint8Array): { packJson: string; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  let packJson: string | null = null;
  for (const [raw, bytes] of Object.entries(unzipSync(zip))) {
    const name = nfc(raw);
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    if (name === 'pack.json') packJson = strFromU8(bytes);
    else files.set(name, bytes);
  }
  if (packJson === null) throw new Error('Zip’te pack.json yok.');
  return { packJson, files };
}
```

`src/core/index.ts`:
```ts
export * from './raster';
export * from './distance';
export * from './geometry';
export * from './contour';
export * from './render';
export * from './project';
export * from './roles';
export * from './match';
export * from './checks';
export * from './pdf';
export * from './zip';
export * from './pipeline';
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/core && npm run typecheck`
Expected: PASS. fflate UTF-8 adları bozarsa (NFD testi fail), `zipSync` girdilerinde adın zaten NFC olduğunu doğrula; fflate EFS bayrağını kendisi koyar.

- [ ] **Step 5: Commit**

```bash
git add src/core/zip.ts src/core/index.ts tests/core/zip.test.ts
git commit -m "feat(core): proje zip'i ve core dışa aktarımı"
```

---

### Task 11: CLI

**Files:**
- Create: `src/cli/files.ts`, `src/cli/run.ts`, `src/cli/main.ts`, `bin/stickercut.mjs`
- Test: `tests/cli/cli.test.ts`

**Interfaces:**
- Consumes: T8–T10 (`initPack`, `computeCuts`, `buildPackPdf`, `renderPackPreview`, `formatMessage`, `parsePack`, `serializePack`, `packToZip`, `zipToPack`), `decodePng`/`encodePng` (T9)
- Produces:
  - `files.ts`: `class CliError extends Error`, `listPngs(dir): string[]` (mutlak yollar), `toPackName(baseDir, abs): string`, `resolveOnDisk(baseDir, name): string`, `loadFile(abs, name): LoadedFile`
  - `run.ts`: `interface Io { out(s: string): void; err(s: string): void }`, `run(argv: string[], io?: Io): Promise<number>` (0 başarı, 1 hata, 2 kullanım)

- [ ] **Step 1: Failing testi yaz**

`tests/cli/cli.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { run, type Io } from '../../src/cli/run';
import { encodePng } from '../../src/cli/png';
import { makeScene } from '../helpers/scene';

let dir: string;
let lines: string[];
const io: Io = { out: (s) => lines.push(s), err: (s) => lines.push(s) };

beforeEach(() => {
  lines = [];
  dir = join(mkdtempSync(join(tmpdir(), 'sc-')), 'çay ve kahve'.normalize('NFD'));
  mkdirSync(join(dir, 'bases'), { recursive: true });
  mkdirSync(join(dir, 'assets'));
  const s = makeScene();
  writeFileSync(join(dir, 'bases', 'turk kahvesi.png'), encodePng(s.design));
  writeFileSync(join(dir, 'bases', 'turk kahvesi arka.png'), encodePng(s.background));
  for (const st of s.stickers) {
    const name = st.file === 'cay.png' ? 'çay.png'.normalize('NFD') : st.file;
    writeFileSync(join(dir, 'assets', name), encodePng(st.raster));
  }
});

describe('cli', () => {
  it('init → build uçtan uca çalışır', async () => {
    expect(await run(['init', dir, '--page', '80x120', '--json'], io)).toBe(0);
    const out = JSON.parse(lines.join('\n'));
    expect(out.items).toBe(4);
    const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
    expect(pack.items.map((i: { file: string }) => i.file)).toContain('assets/çay.png'.normalize('NFC'));
    expect(existsSync(join(dir, 'pack.preview.png'))).toBe(true);

    lines = [];
    expect(await run(['build', join(dir, 'pack.json'), '--offset', '1', '--white-border'], io)).toBe(0);
    const doc = await PDFDocument.load(readFileSync(join(dir, 'pack.pdf')));
    expect(doc.getPageCount()).toBe(2);
    expect(JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')).defaults.offsetMm).toBe(0); // bayrak kalıcı değil
  });

  it('preview komutu önizleme yazar', async () => {
    await run(['init', dir, '--page', '80x120'], io);
    expect(await run(['preview', join(dir, 'pack.json'), '--no-cut', '-o', join(dir, 'p.png')], io)).toBe(0);
    expect(existsSync(join(dir, 'p.png'))).toBe(true);
  });

  it('export → import → build çalışır', async () => {
    await run(['init', dir, '--page', '80x120'], io);
    const zip = join(dir, '..', 'paket.zip');
    expect(await run(['export', join(dir, 'pack.json'), '-o', zip], io)).toBe(0);
    const target = join(dir, '..', 'acilan');
    expect(await run(['import', zip, target], io)).toBe(0);
    expect(await run(['build', join(target, 'pack.json')], io)).toBe(0);
    expect(await run(['import', zip, target], io)).toBe(1); // üzerine yazmaz
  });

  it('--out başka klasördeyse yollar göreli ve export yine çalışır', async () => {
    const other = mkdtempSync(join(tmpdir(), 'sc-out-'));
    expect(await run(['init', dir, '--page', '80x120', '-o', join(other, 'kahve.pack.json')], io)).toBe(0);
    expect(await run(['build', join(other, 'kahve.pack.json')], io)).toBe(0);
    expect(existsSync(join(other, 'kahve.pack.pdf'))).toBe(true);
    expect(await run(['export', join(other, 'kahve.pack.json'), '-o', join(other, 'k.zip')], io)).toBe(0);
  });

  it('belirsiz rollerde açık hata ve ipucuyla çözüm', async () => {
    const s = makeScene();
    writeFileSync(join(dir, 'bases', 'baska.png'), encodePng(s.design));
    writeFileSync(join(dir, 'bases', 'baska arka.png'), encodePng(s.background));
    expect(await run(['init', dir], io)).toBe(1);
    expect(lines.join('\n')).toContain('Birden fazla');
    expect(await run(['init', dir, '--design', 'bases/turk kahvesi.png', '--background', 'bases/turk kahvesi arka.png'], io)).toBe(0);
  });

  it('bilinmeyen komut kullanım metni ve 2 döner', async () => {
    expect(await run(['yok'], io)).toBe(2);
    expect(lines.join('\n')).toContain('Kullanım');
  });
});
```

- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/cli/run"`

- [ ] **Step 3: `src/cli/files.ts`'i yaz**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { decodePng } from './png';
import { prepareLoadedFile, type LoadedFile } from '../core/pipeline';
import { nfc } from '../core/project';

export class CliError extends Error {}

export function listPngs(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.png$/i.test(e.name) && !/\.preview\.png$/i.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

export function toPackName(baseDir: string, abs: string): string {
  return nfc(relative(baseDir, abs).split(sep).join('/'));
}

/** pack.json'daki (NFC) adı diskteki gerçek yola çevirir; macOS NFD adlarını Linux'ta da bulur. */
export function resolveOnDisk(baseDir: string, name: string): string {
  const direct = join(baseDir, name);
  if (existsSync(direct)) return direct;
  let cur = baseDir;
  for (const part of name.split('/')) {
    if (part === '.' || part === '..' || existsSync(join(cur, part))) { cur = join(cur, part); continue; }
    const hit = existsSync(cur) ? readdirSync(cur).find((e) => nfc(e) === nfc(part)) : undefined;
    if (!hit) throw new CliError(`Dosya bulunamadı: ${name}`);
    cur = join(cur, hit);
  }
  return cur;
}

export function loadFile(abs: string, name: string): LoadedFile {
  const bytes = new Uint8Array(readFileSync(abs));
  try {
    return prepareLoadedFile(name, bytes, decodePng(bytes));
  } catch (e) {
    throw new CliError(`PNG okunamadı: ${name} (${(e as Error).message})`);
  }
}
```

- [ ] **Step 4: `src/cli/run.ts`, `src/cli/main.ts`, `bin/stickercut.mjs`'i yaz**

`src/cli/run.ts`:
```ts
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  initPack, computeCuts, buildPackPdf, renderPackPreview, formatMessage, type LoadedFile, type Message,
} from '../core/pipeline';
import { parsePack, serializePack, PackError, type Pack } from '../core/project';
import { packToZip, zipToPack } from '../core/zip';
import { encodePng } from './png';
import { CliError, listPngs, loadFile, resolveOnDisk, toPackName } from './files';

export interface Io { out(s: string): void; err(s: string): void }
const consoleIo: Io = { out: (s) => console.log(s), err: (s) => console.error(s) };

const USAGE = `Kullanım:
  stickercut init <klasör> [--design dosya] [--background dosya] [--page 80x140] [-o pack.json] [--json]
  stickercut build <pack.json> [--offset mm] [--white-border | --no-white-border] [--stroke pt] [-o çıktı.pdf] [--json]
  stickercut preview <pack.json> [--no-cut] [-o önizleme.png]
  stickercut export <pack.json> -o paket.zip
  stickercut import <paket.zip> <klasör> [--force]`;

class UsageError extends Error {}

export async function run(argv: string[], io: Io = consoleIo): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'init': return await cmdInit(rest, io);
      case 'build': return await cmdBuild(rest, io);
      case 'preview': return cmdPreview(rest, io);
      case 'export': return cmdExport(rest, io);
      case 'import': return cmdImport(rest, io);
      default: io.err(USAGE); return 2;
    }
  } catch (e) {
    if (e instanceof UsageError) { io.err(`${e.message}\n\n${USAGE}`); return 2; }
    if (e instanceof CliError || e instanceof PackError) { io.err(`HATA: ${e.message}`); return 1; }
    if (e instanceof TypeError && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS')) { io.err(`${e.message}\n\n${USAGE}`); return 2; }
    throw e;
  }
}

function parsePage(v: string): { widthMm: number; heightMm?: number } {
  const m = /^(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/i.exec(v.trim());
  if (!m) throw new UsageError(`--page "80x140" ya da "80" biçiminde olmalı, verilen: ${v}`);
  return { widthMm: Number(m[1]), heightMm: m[2] ? Number(m[2]) : undefined };
}

function num(v: string, flag: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`${flag} sıfır ya da pozitif bir sayı olmalı, verilen: ${v}`);
  return n;
}

function readPack(path: string): Pack {
  if (!existsSync(path)) throw new CliError(`pack.json bulunamadı: ${path}`);
  return parsePack(readFileSync(path, 'utf8'));
}

function packFiles(pack: Pack, withDesign: boolean): string[] {
  return [...new Set([...(withDesign ? [pack.files.design] : []), pack.files.background, ...pack.items.map((i) => i.file)])];
}

function loadPackFiles(packPath: string, names: string[]): Map<string, LoadedFile> {
  const base = dirname(packPath);
  return new Map(names.map((n) => [n, loadFile(resolveOnDisk(base, n), n)]));
}

function report(io: Io, messages: Message[]): void {
  for (const m of messages) (m.level === 'error' ? io.err : io.out)(formatMessage(m));
}

const sibling = (packPath: string, ext: string) => packPath.replace(/\.json$/i, '') + ext;

async function cmdInit(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { design: { type: 'string' }, background: { type: 'string' }, page: { type: 'string' }, out: { type: 'string', short: 'o' }, json: { type: 'boolean' } },
  });
  if (positionals.length !== 1) throw new UsageError('init tek bir klasör bekler.');
  const dir = resolve(positionals[0]);
  if (!existsSync(dir)) throw new CliError(`Klasör bulunamadı: ${dir}`);
  const packPath = values.out ? resolve(values.out) : join(dir, 'pack.json');
  const base = dirname(packPath);
  const files = listPngs(dir).map((abs) => loadFile(abs, toPackName(base, abs)));
  const hint = (v?: string) => (v === undefined ? undefined : toPackName(base, resolveOnDisk(dir, v)));
  const res = initPack(files, {
    design: hint(values.design), background: hint(values.background),
    page: values.page ? parsePage(values.page) : undefined,
  });
  if (!res.pack) {
    if (values.json) io.out(JSON.stringify({ ok: false, messages: res.messages }, null, 2));
    else report(io, res.messages);
    return 1;
  }
  mkdirSync(base, { recursive: true });
  writeFileSync(packPath, serializePack(res.pack));
  const assets = new Map(files.map((f) => [f.name, f]));
  const { cuts, messages: cutMessages } = computeCuts(res.pack, assets);
  const previewPath = sibling(packPath, '.preview.png');
  writeFileSync(previewPath, encodePng(renderPackPreview(res.pack, assets, cuts)));
  const messages = [...res.messages, ...cutMessages];
  const needsReview = res.pack.items.filter((i) => i.needsReview).length;
  if (values.json) {
    io.out(JSON.stringify({ ok: true, packPath, previewPath, items: res.pack.items.length, needsReview, messages }, null, 2));
  } else {
    io.out(`${res.pack.items.length} sticker yerleştirildi${needsReview ? `, ${needsReview} tanesi kontrol bekliyor` : ''} → ${packPath}`);
    io.out(`Önizleme: ${previewPath}`);
    report(io, messages);
  }
  return messages.some((m) => m.level === 'error') ? 1 : 0;
}

async function cmdBuild(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, allowNegative: true,
    options: { offset: { type: 'string' }, 'white-border': { type: 'boolean' }, stroke: { type: 'string' }, out: { type: 'string', short: 'o' }, json: { type: 'boolean' } },
  });
  if (positionals.length !== 1) throw new UsageError('build tek bir pack.json bekler.');
  const packPath = resolve(positionals[0]);
  const pack = readPack(packPath);
  if (values.offset !== undefined) pack.defaults.offsetMm = num(values.offset, '--offset');
  if (values['white-border'] !== undefined) pack.defaults.whiteBorder = values['white-border'];
  if (values.stroke !== undefined) pack.defaults.strokeWidthPt = num(values.stroke, '--stroke');
  const { pdf, messages } = await buildPackPdf(pack, loadPackFiles(packPath, packFiles(pack, false)));
  const outPath = values.out ? resolve(values.out) : sibling(packPath, '.pdf');
  if (pdf) writeFileSync(outPath, pdf);
  const cutCount = pack.items.filter((i) => !i.printOnly).length;
  if (values.json) io.out(JSON.stringify({ ok: !!pdf, pdfPath: pdf ? outPath : null, items: pack.items.length, cuts: cutCount, messages }, null, 2));
  else {
    if (pdf) io.out(`PDF yazıldı: ${outPath} (${pack.items.length} öğe, ${cutCount} kesim çizgisi)`);
    report(io, messages);
  }
  return pdf ? 0 : 1;
}

function cmdPreview(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, allowNegative: true,
    options: { cut: { type: 'boolean', default: true }, out: { type: 'string', short: 'o' } },
  });
  if (positionals.length !== 1) throw new UsageError('preview tek bir pack.json bekler.');
  const packPath = resolve(positionals[0]);
  const pack = readPack(packPath);
  const assets = loadPackFiles(packPath, packFiles(pack, false));
  const cuts = values.cut ? computeCuts(pack, assets) : null;
  const outPath = values.out ? resolve(values.out) : sibling(packPath, '.preview.png');
  writeFileSync(outPath, encodePng(renderPackPreview(pack, assets, cuts?.cuts ?? null)));
  io.out(`Önizleme: ${outPath}`);
  if (cuts) report(io, cuts.messages);
  return 0;
}

function cmdExport(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { out: { type: 'string', short: 'o' } } });
  if (positionals.length !== 1 || !values.out) throw new UsageError('export bir pack.json ve -o paket.zip bekler.');
  const packPath = resolve(positionals[0]);
  const pack = readPack(packPath);
  const base = dirname(packPath);
  const rename = new Map<string, string>();
  const taken = new Set<string>();
  for (const n of packFiles(pack, true)) {
    let z = n.startsWith('../') || n.startsWith('/') ? `files/${n.split('/').pop()}` : n;
    for (let i = 2; taken.has(z); i++) z = z.replace(/(\.png)$/i, `-${i}$1`);
    taken.add(z);
    rename.set(n, z);
  }
  const files = new Map([...rename].map(([n, z]) => [z, new Uint8Array(readFileSync(resolveOnDisk(base, n)))]));
  const out: Pack = {
    ...pack,
    files: { design: rename.get(pack.files.design)!, background: rename.get(pack.files.background)! },
    items: pack.items.map((i) => ({ ...i, file: rename.get(i.file)! })),
  };
  const zipPath = resolve(values.out);
  writeFileSync(zipPath, packToZip(serializePack(out), files));
  io.out(`Proje dışa aktarıldı: ${zipPath} (${files.size} dosya)`);
  return 0;
}

function cmdImport(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { force: { type: 'boolean' } } });
  if (positionals.length !== 2) throw new UsageError('import bir zip ve hedef klasör bekler.');
  const [zipPath, dir] = positionals.map((p) => resolve(p));
  const { packJson, files } = zipToPack(new Uint8Array(readFileSync(zipPath)));
  parsePack(packJson);
  const packPath = join(dir, 'pack.json');
  if (existsSync(packPath) && !values.force) throw new CliError(`${packPath} zaten var; üzerine yazmak için --force kullan.`);
  for (const [name, bytes] of files) {
    if (name.split('/').includes('..')) throw new CliError(`Zip’te güvensiz yol var: ${name}`);
    const p = join(dir, ...name.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(packPath, packJson);
  io.out(`Proje açıldı: ${packPath} (${files.size} dosya)`);
  return 0;
}
```

`src/cli/main.ts`:
```ts
import { run } from './run';

process.exitCode = await run(process.argv.slice(2));
```

`bin/stickercut.mjs`:
```js
#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
await import('../src/cli/main.ts');
```

```bash
chmod +x bin/stickercut.mjs
```

- [ ] **Step 5: Testlerin geçtiğini gör**

Run: `npx vitest run tests/cli && npm run typecheck`
Expected: 6 test PASS.

- [ ] **Step 6: Gerçek komutu dene**

Run: `node bin/stickercut.mjs yok; echo "exit=$?"`
Expected: Kullanım metni, `exit=2`.

- [ ] **Step 7: Commit**

```bash
git add src/cli bin tests/cli
git commit -m "feat(cli): init, build, preview, export, import komutları"
```

---

### Task 12: Gerçek pack doğrulaması ve kalibrasyon (sadece yerel)

**Files:**
- Create: `tests/real-pack.test.ts`
- Modify (gerekirse): `src/core/match.ts` → `DEFAULT_MATCH_OPTIONS` eşikleri

**Interfaces:**
- Consumes: `run` (T11)

- [ ] **Step 1: Testi yaz**

`tests/real-pack.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { run, type Io } from '../src/cli/run';

const root = process.env.STICKERS_DIR;

describe.skipIf(!root)('gerçek pack: Türk kahvesi', () => {
  it('13 kopyayı bulur ve 2 sayfalı PDF üretir', async () => {
    const lines: string[] = [];
    const io: Io = { out: (s) => lines.push(s), err: (s) => lines.push(s) };
    const out = mkdtempSync(join(tmpdir(), 'sc-real-'));
    const packPath = join(out, 'kahve.pack.json');
    const code = await run([
      'init', join(root!, 'çay ve kahve'),
      '--design', 'bases/turk kahvesi.png', '--background', 'bases/turk kahvesi arka.png',
      '--page', '80x140', '-o', packPath, '--json',
    ], io);
    console.log(lines.join('\n'));
    expect(code).toBe(0);
    const pack = JSON.parse(readFileSync(packPath, 'utf8'));
    console.log(pack.items.map((i: { id: string; file: string; matchScore: number }) => `${i.id} ${i.file} ${i.matchScore}`).join('\n'));
    expect(pack.items).toHaveLength(13);
    const counts = Object.values(pack.items.reduce((m: Record<string, number>, i: { file: string }) => ({ ...m, [i.file]: (m[i.file] ?? 0) + 1 }), {})).sort();
    expect(counts).toEqual([2, 2, 3, 3, 3]);
    expect(pack.items.filter((i: { needsReview: boolean }) => i.needsReview)).toEqual([]);

    expect(await run(['build', packPath], io)).toBe(0);
    const doc = await PDFDocument.load(readFileSync(join(out, 'kahve.pack.pdf')));
    expect(doc.getPageCount()).toBe(2);
    console.log('çıktı klasörü:', out);
  });
});
```

- [ ] **Step 2: Çalıştır**

Run: `STICKERS_DIR=~/Desktop/stickers npx vitest run tests/real-pack.test.ts`
Expected: PASS. Ayrıca `npx vitest run` (STICKERS_DIR olmadan) bu testi **skip** etmeli.

- [ ] **Step 3: Önizlemeyi gözle kontrol et**

Log'daki çıktı klasöründeki `kahve.pack.preview.png` dosyasını Read aracıyla aç. Kontrol listesi:
- 13 sticker'ın her biri tam tasarımdaki yerinde ve doğru desende (kırmızı/mavi/turuncu/patchwork fincan, baklava).
- Kırmızı kesim çizgileri silüeti sarıyor; kulp içi kesilmemiş; baklava çizgileri tırtıksız.
- Turuncu "kontrol et" çerçevesi yok.

- [ ] **Step 4: Gerekirse kalibre et**

Test ya da gözle kontrol fail ederse (global kural #6): log'daki `matchScore` değerlerine bak.
- Doğru eşleşmelerin skoru 0.85'in altındaysa, doğru eşleşmelerin en düşük skoru ile yanlış adayların en yüksek skorunun ortasına `reviewBelow`'u çek (ör. doğrular ≥0.78, yanlışlar ≤0.55 → 0.7).
- Sayı 13 değilse: `findRegions` sonucunu (bbox listesi) `console.log` ile yazdır. Bölgeler birleşiyorsa kapama yarıçapını (4) düşür; parçalanıyorsa artır.
- Sayılar `[2,2,3,3,3]` değilse ama önizleme doğruysa, testteki beklentiyi önizlemede gördüğün gerçek dağılıma göre güncelle.
- Değişiklikten sonra `npm test` (sentetik testler) hâlâ geçmeli. Log'ları kaldır.

- [ ] **Step 5: Illustrator kontrolü için PDF yolunu Yusuf'a ver**

`kahve.pack.pdf`'in yolunu kullanıcıya ver: Illustrator'da açıp 2 sayfanın düzgün geldiğini (ve mümkünse çok sayfalı PDF'i artboard olarak içe aktarmayı) denemesini iste. Bu adımın sonucu Task 16 tamamlanmadan önce alınmış olmalı; beklerken Task 13'e geç.

- [ ] **Step 6: Commit**

```bash
git add tests/real-pack.test.ts src/core/match.ts
git commit -m "test: gerçek kahve pack'i ile uçtan uca doğrulama"
```

---

### Task 13: Web — iskelet, worker ve dosya ekranı

**Files:**
- Create: `web/index.html`, `web/src/style.css`, `web/src/main.ts`, `web/src/state.ts`, `web/src/protocol.ts`, `web/src/decode.ts`, `web/src/worker.ts`, `web/src/engine.ts`, `web/src/storage.ts`, `web/src/share.ts`, `web/src/project-io.ts`, `web/src/ui/html.ts`, `web/src/ui/files-screen.ts`
- Create (geçici, Task 14'te dolar): `web/src/ui/editor-screen.ts`

**Interfaces:**
- Consumes: core (`initPack`, `computeCuts`, `buildPackPdf`, `prepareLoadedFile`, `assignRoles`, `packToZip`, `zipToPack`, `parsePack`, `serializePack`, `nextItemId`)
- Produces:
  - `state.ts`: `type Role = 'design' | 'background' | 'sticker' | 'ignore'`; `interface FileEntry { name; bytes; width; height; bitmap: ImageBitmap; role: Role }`; `interface AppState { screen: 'files' | 'editor'; files: Map<string, FileEntry>; pack: Pack | null; cuts: Map<string, Pt[]>; messages: Message[]; cutMessages: Message[]; selectedId: string | null; showCuts: boolean; busy: string | null; page: { widthMm: number; heightMm: number | null } }`; `state`, `subscribe(fn): () => void`, `update(mut?)`
  - `engine.ts`: `engine.addFiles(files) → {name,width,height}[]`, `engine.roles() → RoleResult`, `engine.init(opts) → InitResult`, `engine.cuts(pack) → { cuts: Map<string, Pt[]>; messages }`, `engine.pdf(pack) → { pdf; messages }`, `engine.zip(pack) → Uint8Array`, `engine.reset()`
  - `project-io.ts`: `addFiles(list: File[])`, `place()`, `scheduleAutosave()`, `scheduleCuts()`, `recomputeCuts()`, `commit()`, `addStickerItem(file)`, `addNewPng(file: File)`, `exportPdf()`, `exportZip()`, `newProject()`, `restore()`
  - `ui/html.ts`: `esc(s): string`

- [ ] **Step 1: HTML, stil ve durum**

`web/index.html`:
```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="stickercut" />
    <meta name="theme-color" content="#f6f3ee" />
    <title>stickercut</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

`web/src/style.css`:
```css
:root {
  --bg: #f6f3ee; --panel: #ffffff; --ink: #27231f; --muted: #7a7168; --line: #e3ddd4;
  --accent: #d6452f; --accent-ink: #fff; --warn: #e08a00; --sel: #2f6fd6;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--ink); background: var(--bg);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); }
#app { height: 100%; }
button, select, input { font: inherit; }
button { min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
button.danger { color: var(--accent); }
button:disabled { opacity: .45; cursor: default; }
input[type=number], select { min-height: 40px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; width: 100%; }
label { display: grid; gap: 4px; font-size: 14px; color: var(--muted); }
label.check { display: flex; align-items: center; gap: 8px; color: var(--ink); }
label.check input { width: 22px; height: 22px; }

.files { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; display: grid; gap: 16px; }
.files h1 { margin: 0; font-size: 28px; }
.lead { margin: 0; color: var(--muted); }
.drop { display: grid; place-items: center; min-height: 120px; border: 2px dashed var(--line); border-radius: 16px; background: var(--panel); cursor: pointer; text-align: center; padding: 16px; }
.drop.over { border-color: var(--accent); }
.row { display: grid; grid-template-columns: 56px 1fr auto 150px; gap: 12px; align-items: center; padding: 8px; background: var(--panel); border-radius: 12px; }
.row canvas { width: 56px; height: 56px; border-radius: 8px; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 12px 12px; }
.row .name { overflow-wrap: anywhere; }
.row .dim { color: var(--muted); font-size: 13px; }
.page { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.msgs { display: grid; gap: 6px; padding: 0; margin: 0; list-style: none; }
.msgs li { padding: 8px 10px; border-radius: 8px; background: #fff7e8; font-size: 14px; }
.msgs li.error { background: #fde8e5; }
.msgs li.info { background: #eef3fb; }
.msgs li[data-item] { cursor: pointer; }
.busy { color: var(--muted); min-height: 1.2em; margin: 0; }

.editor { display: grid; grid-template-columns: 1fr 340px; height: 100%; }
.stage-wrap { position: relative; overflow: hidden; }
.stage { position: absolute; inset: 0; touch-action: none; }
.panel { overflow-y: auto; background: var(--panel); border-left: 1px solid var(--line); padding: 16px; display: grid; gap: 20px; align-content: start; }
.panel section { display: grid; gap: 10px; }
.panel h2 { margin: 0; font-size: 15px; }
.panel .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.actions { display: grid; gap: 8px; }
.busy-overlay { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--ink); color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 14px; }
.busy-overlay:empty { display: none; }

@media (max-width: 900px), (orientation: portrait) {
  .editor { grid-template-columns: 1fr; grid-template-rows: 58vh 1fr; }
  .panel { border-left: 0; border-top: 1px solid var(--line); }
}
```

`web/src/state.ts`:
```ts
import type { Pack } from '../../src/core/project';
import type { Message } from '../../src/core/pipeline';
import type { Pt } from '../../src/core/geometry';

export type Role = 'design' | 'background' | 'sticker' | 'ignore';
export interface FileEntry { name: string; bytes: Uint8Array; width: number; height: number; bitmap: ImageBitmap; role: Role }
export interface AppState {
  screen: 'files' | 'editor';
  files: Map<string, FileEntry>;
  pack: Pack | null;
  cuts: Map<string, Pt[]>;
  messages: Message[];
  cutMessages: Message[];
  selectedId: string | null;
  showCuts: boolean;
  busy: string | null;
  page: { widthMm: number; heightMm: number | null };
}

export const state: AppState = {
  screen: 'files', files: new Map(), pack: null, cuts: new Map(), messages: [], cutMessages: [],
  selectedId: null, showCuts: true, busy: null, page: { widthMm: 80, heightMm: null },
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function update(mut?: (s: AppState) => void): void {
  mut?.(state);
  for (const l of [...listeners]) l();
}
```

`web/src/ui/html.ts`:
```ts
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
```

- [ ] **Step 2: Worker protokolü, decode, worker ve engine**

`web/src/protocol.ts`:
```ts
import type { InitOptions } from '../../src/core/pipeline';

export type Request =
  | { type: 'addFiles'; files: { name: string; bytes: Uint8Array }[] }
  | { type: 'roles' }
  | { type: 'init'; options: InitOptions }
  | { type: 'cuts'; packJson: string }
  | { type: 'pdf'; packJson: string }
  | { type: 'zip'; packJson: string }
  | { type: 'reset' };

export interface Envelope { id: number; req: Request }
export type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
```

`web/src/decode.ts`:
```ts
import type { Raster } from '../../src/core/raster';

/** Worker içinde çalışır (OffscreenCanvas, iPadOS 16.4+). */
export async function decodePngBytes(bytes: Uint8Array): Promise<Raster> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }), {
    premultiplyAlpha: 'none', colorSpaceConversion: 'none',
  });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { width: img.width, height: img.height, data: img.data };
}
```

`web/src/worker.ts`:
```ts
import { decodePngBytes } from './decode';
import type { Envelope, Request } from './protocol';
import {
  prepareLoadedFile, initPack, computeCuts, buildPackPdf, type LoadedFile, type CutCache,
} from '../../src/core/pipeline';
import { assignRoles } from '../../src/core/roles';
import { parsePack } from '../../src/core/project';
import { packToZip } from '../../src/core/zip';

const files = new Map<string, LoadedFile>();
let cache: CutCache = new Map();
const ctx = self as unknown as {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Envelope>) => void) | null;
};

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'addFiles': {
      const out = [];
      for (const f of req.files) {
        const loaded = prepareLoadedFile(f.name, f.bytes, await decodePngBytes(f.bytes));
        files.set(loaded.name, loaded);
        out.push({ name: loaded.name, width: loaded.width, height: loaded.height });
      }
      return out;
    }
    case 'roles':
      return assignRoles([...files.values()].map((f) => ({ file: f.name, raster: f.raster })));
    case 'init':
      return initPack([...files.values()], req.options);
    case 'cuts': {
      const { cuts, messages } = computeCuts(parsePack(req.packJson), files, cache);
      return { cuts: [...cuts], messages };
    }
    case 'pdf':
      return buildPackPdf(parsePack(req.packJson), files, cache);
    case 'zip': {
      const pack = parsePack(req.packJson);
      const names = new Set([pack.files.design, pack.files.background, ...pack.items.map((i) => i.file)]);
      return packToZip(req.packJson, new Map([...names].filter((n) => files.has(n)).map((n) => [n, files.get(n)!.bytes])));
    }
    case 'reset':
      files.clear();
      cache = new Map();
      return null;
  }
}

ctx.onmessage = async (e) => {
  const { id, req } = e.data;
  try {
    ctx.postMessage({ id, ok: true, result: await handle(req) });
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
```

`web/src/engine.ts`:
```ts
import type { Request, Reply } from './protocol';
import type { InitOptions, InitResult, Message } from '../../src/core/pipeline';
import type { RoleResult } from '../../src/core/roles';
import type { Pt } from '../../src/core/geometry';
import { serializePack, type Pack } from '../../src/core/project';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextId = 1;
worker.onmessage = (e: MessageEvent<Reply>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.ok) p.resolve(e.data.result);
  else p.reject(new Error(e.data.error));
};

function call<T>(req: Request): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, req });
  });
}

export const engine = {
  addFiles: (files: { name: string; bytes: Uint8Array }[]) =>
    call<{ name: string; width: number; height: number }[]>({ type: 'addFiles', files }),
  roles: () => call<RoleResult>({ type: 'roles' }),
  init: (options: InitOptions) => call<InitResult>({ type: 'init', options }),
  cuts: async (pack: Pack) => {
    const r = await call<{ cuts: [string, Pt[]][]; messages: Message[] }>({ type: 'cuts', packJson: serializePack(pack) });
    return { cuts: new Map(r.cuts), messages: r.messages };
  },
  pdf: (pack: Pack) => call<{ pdf: Uint8Array | null; messages: Message[] }>({ type: 'pdf', packJson: serializePack(pack) }),
  zip: (pack: Pack) => call<Uint8Array>({ type: 'zip', packJson: serializePack(pack) }),
  reset: () => call<null>({ type: 'reset' }),
};
```

- [ ] **Step 3: Kayıt, paylaşım ve proje işlemleri**

`web/src/storage.ts`:
```ts
import { get, set, del } from 'idb-keyval';
import type { Role } from './state';

export interface Saved {
  packJson: string | null;
  files: { name: string; bytes: Uint8Array; role: Role }[];
  page: { widthMm: number; heightMm: number | null };
}
const KEY = 'stickercut:project';

export async function save(s: Saved): Promise<void> {
  try { await set(KEY, s); } catch (e) { console.warn('Otomatik kayıt başarısız', e); }
}
export async function load(): Promise<Saved | undefined> {
  try { return await get<Saved>(KEY); } catch { return undefined; }
}
export async function clear(): Promise<void> {
  try { await del(KEY); } catch { /* yok say */ }
}
```

`web/src/share.ts`:
```ts
export async function shareOrDownload(bytes: Uint8Array, name: string, type: string): Promise<void> {
  const file = new File([bytes as BlobPart], name, { type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
```

`web/src/project-io.ts`:
```ts
import { engine } from './engine';
import { state, update, type Role } from './state';
import * as storage from './storage';
import { shareOrDownload } from './share';
import { parsePack, serializePack, nextItemId, nfc, type Pack } from '../../src/core/project';
import { zipToPack } from '../../src/core/zip';

const DISPLAY_MAX = 1600;

async function makeBitmap(bytes: Uint8Array): Promise<ImageBitmap> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  const probe = await createImageBitmap(blob);
  const f = Math.min(1, DISPLAY_MAX / Math.max(probe.width, probe.height));
  if (f === 1) return probe;
  const [w, h] = [Math.round(probe.width * f), Math.round(probe.height * f)];
  probe.close();
  return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
}

function fail(e: unknown): void {
  update((s) => { s.messages = [{ level: 'error', code: 'APP', text: e instanceof Error ? e.message : String(e) }]; });
}

async function busy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  update((s) => { s.busy = label; });
  try { return await fn(); } catch (e) { fail(e); return undefined; } finally { update((s) => { s.busy = null; }); }
}

async function registerFiles(entries: { name: string; bytes: Uint8Array; role?: Role }[]): Promise<void> {
  const infos = await engine.addFiles(entries.map(({ name, bytes }) => ({ name: nfc(name), bytes })));
  for (const e of entries) {
    const info = infos.find((i) => i.name === nfc(e.name))!;
    state.files.set(info.name, { name: info.name, bytes: e.bytes, width: info.width, height: info.height, bitmap: await makeBitmap(e.bytes), role: e.role ?? 'ignore' });
  }
}

let saveTimer = 0;
export function scheduleAutosave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void storage.save({
    packJson: state.pack ? serializePack(state.pack) : null,
    files: [...state.files.values()].map(({ name, bytes, role }) => ({ name, bytes, role })),
    page: state.page,
  }), 500);
}

export async function addFiles(list: File[]): Promise<void> {
  await busy('Dosyalar okunuyor…', async () => {
    const zip = list.find((f) => /\.zip$/i.test(f.name));
    if (zip) return importZip(new Uint8Array(await zip.arrayBuffer()));
    const pngs = list.filter((f) => /\.png$/i.test(f.name));
    await registerFiles(await Promise.all(pngs.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    const roles = await engine.roles();
    update((s) => {
      for (const f of s.files.values()) {
        f.role = f.name === roles.design ? 'design' : f.name === roles.background ? 'background' : roles.stickers.includes(f.name) ? 'sticker' : 'ignore';
      }
      s.messages = roles.reason ? [{ level: 'warning', code: 'ROLES', text: roles.reason }] : [];
    });
    scheduleAutosave();
  });
}

export async function place(): Promise<void> {
  const files = [...state.files.values()];
  const design = files.find((f) => f.role === 'design'), background = files.find((f) => f.role === 'background');
  if (!design || !background) return fail(new Error('Önce bir tam tasarım ve bir arka plan seç.'));
  const res = await busy('Sticker’lar yerleştiriliyor…', () => engine.init({
    design: design.name, background: background.name,
    stickers: files.filter((f) => f.role === 'sticker').map((f) => f.name),
    page: { widthMm: state.page.widthMm, heightMm: state.page.heightMm ?? undefined },
  }));
  if (!res) return;
  update((s) => {
    s.messages = res.messages;
    if (res.pack) { s.pack = res.pack; s.screen = 'editor'; s.selectedId = null; s.cuts = new Map(); }
  });
  if (res.pack) { await recomputeCuts(); scheduleAutosave(); }
}

let cutTimer = 0;
let cutSeq = 0;
export function scheduleCuts(): void {
  clearTimeout(cutTimer);
  cutTimer = window.setTimeout(() => void recomputeCuts(), 150);
}
export async function recomputeCuts(): Promise<void> {
  if (!state.pack) return;
  const seq = ++cutSeq;
  try {
    const res = await engine.cuts(state.pack);
    if (seq === cutSeq) update((s) => { s.cuts = res.cuts; s.cutMessages = res.messages; });
  } catch (e) { fail(e); }
}

/** Pack değiştiğinde çağrılır. */
export function commit(): void {
  update();
  scheduleCuts();
  scheduleAutosave();
}

export function addStickerItem(file: string): void {
  const pack = state.pack, f = state.files.get(file);
  if (!pack || !f) return;
  const id = nextItemId(pack);
  pack.items.push({
    id, file, x: pack.designSize.widthPx / 2, y: pack.designSize.heightPx / 2,
    scale: (pack.designSize.widthPx * 0.25) / f.width, rotationDeg: 0,
    printOnly: false, needsReview: false, matchScore: null, overrides: {},
  });
  state.selectedId = id;
  commit();
}

export async function addNewPng(file: File): Promise<void> {
  await busy('PNG ekleniyor…', async () => {
    await registerFiles([{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), role: 'sticker' }]);
    addStickerItem(nfc(file.name));
  });
}

async function importZip(bytes: Uint8Array): Promise<void> {
  const { packJson, files } = zipToPack(bytes);
  const pack = parsePack(packJson);
  await engine.reset();
  state.files.clear();
  const roleOf = (n: string): Role => (n === pack.files.design ? 'design' : n === pack.files.background ? 'background' : 'sticker');
  await registerFiles([...files].map(([name, b]) => ({ name, bytes: b, role: roleOf(nfc(name)) })));
  update((s) => { s.pack = pack; s.screen = 'editor'; s.selectedId = null; s.messages = []; });
  await recomputeCuts();
  scheduleAutosave();
}

const baseName = (pack: Pack) => (pack.files.design.split('/').pop() ?? 'pack').replace(/\.png$/i, '');

export async function exportPdf(): Promise<void> {
  const pack = state.pack;
  if (!pack) return;
  const res = await busy('PDF hazırlanıyor…', () => engine.pdf(pack));
  if (!res) return;
  update((s) => { s.cutMessages = res.messages; });
  if (res.pdf) await shareOrDownload(res.pdf, `${baseName(pack)}.pdf`, 'application/pdf');
}

export async function exportZip(): Promise<void> {
  const pack = state.pack;
  if (!pack) return;
  const zip = await busy('Proje paketleniyor…', () => engine.zip(pack));
  if (zip) await shareOrDownload(zip, `${baseName(pack)}.zip`, 'application/zip');
}

export async function newProject(): Promise<void> {
  await engine.reset();
  await storage.clear();
  for (const f of state.files.values()) f.bitmap.close();
  update((s) => {
    s.files = new Map(); s.pack = null; s.cuts = new Map(); s.messages = []; s.cutMessages = [];
    s.selectedId = null; s.screen = 'files';
  });
}

export async function restore(): Promise<void> {
  const saved = await storage.load();
  if (!saved?.files.length) return;
  await busy('Kaldığın yerden açılıyor…', async () => {
    await registerFiles(saved.files);
    const pack = saved.packJson ? parsePack(saved.packJson) : null;
    update((s) => { s.page = saved.page; s.pack = pack; s.screen = pack ? 'editor' : 'files'; });
    if (pack) await recomputeCuts();
  });
}
```

- [ ] **Step 4: Dosya ekranı, geçici editör ve main**

`web/src/ui/files-screen.ts`:
```ts
import { state, subscribe, update, type Role } from '../state';
import { addFiles, place, scheduleAutosave } from '../project-io';
import { esc } from './html';

const ROLE_LABELS: [Role, string][] = [['design', 'Tam tasarım'], ['background', 'Arka plan'], ['sticker', 'Sticker'], ['ignore', 'Yok say']];

export function mountFiles(root: HTMLElement): () => void {
  root.innerHTML = `
    <main class="files">
      <h1>stickercut</h1>
      <p class="lead">Tam tasarım, arka plan ve sticker PNG’lerini seç. Daha önce dışa aktardığın bir proje .zip’ini de açabilirsin.</p>
      <label class="drop" id="drop">
        <input type="file" id="picker" multiple accept=".png,.PNG,image/png,.zip,application/zip" hidden />
        <span>Dosya seç ya da buraya sürükle</span>
      </label>
      <section id="list" class="list"></section>
      <section class="page">
        <label>Sayfa genişliği (mm)<input id="pw" type="number" step="0.1" min="1" /></label>
        <label>Sayfa yüksekliği (mm)<input id="ph" type="number" step="0.1" min="1" placeholder="otomatik" /></label>
      </section>
      <ul id="msgs" class="msgs"></ul>
      <button id="place" class="primary">Yerleştir</button>
      <p id="busy" class="busy"></p>
    </main>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const drop = $('#drop'), picker = $<HTMLInputElement>('#picker'), list = $('#list');
  const pw = $<HTMLInputElement>('#pw'), ph = $<HTMLInputElement>('#ph');
  pw.value = String(state.page.widthMm);
  ph.value = state.page.heightMm ? String(state.page.heightMm) : '';

  picker.addEventListener('change', () => { if (picker.files?.length) void addFiles([...picker.files]); picker.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files.length) void addFiles([...e.dataTransfer.files]);
  });
  pw.addEventListener('change', () => { if (Number(pw.value) > 0) { state.page.widthMm = Number(pw.value); scheduleAutosave(); } });
  ph.addEventListener('change', () => { state.page.heightMm = Number(ph.value) > 0 ? Number(ph.value) : null; scheduleAutosave(); });
  list.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    const f = state.files.get(sel.dataset.name ?? '');
    if (!f) return;
    const role = sel.value as Role;
    update((s) => {
      if (role === 'design' || role === 'background') for (const o of s.files.values()) if (o.role === role) o.role = 'ignore';
      f.role = role;
    });
    scheduleAutosave();
  });
  $('#place').addEventListener('click', () => void place());

  const render = () => {
    const files = [...state.files.values()];
    list.innerHTML = files.map((f) => `
      <div class="row">
        <canvas width="112" height="112" data-thumb="${esc(f.name)}"></canvas>
        <span class="name">${esc(f.name)}</span>
        <span class="dim">${f.width}×${f.height}</span>
        <select data-name="${esc(f.name)}">${ROLE_LABELS.map(([r, l]) => `<option value="${r}"${r === f.role ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </div>`).join('');
    for (const c of list.querySelectorAll<HTMLCanvasElement>('canvas[data-thumb]')) {
      const f = state.files.get(c.dataset.thumb!);
      if (!f) continue;
      const g = c.getContext('2d')!;
      const k = Math.min(112 / f.bitmap.width, 112 / f.bitmap.height);
      g.drawImage(f.bitmap, (112 - f.bitmap.width * k) / 2, (112 - f.bitmap.height * k) / 2, f.bitmap.width * k, f.bitmap.height * k);
    }
    $('#msgs').innerHTML = state.messages.map((m) => `<li class="${m.level}">${esc(m.text)}</li>`).join('');
    $('#busy').textContent = state.busy ?? '';
    $<HTMLButtonElement>('#place').disabled = !!state.busy || !files.some((f) => f.role === 'design') || !files.some((f) => f.role === 'background');
  };
  render();
  return subscribe(render);
}
```

`web/src/ui/editor-screen.ts` (geçici; Task 14'te gerçek hali yazılır):
```ts
import { state } from '../state';

export function mountEditor(root: HTMLElement): () => void {
  root.innerHTML = `<p style="padding:16px">${state.pack?.items.length ?? 0} sticker yerleştirildi.</p>`;
  return () => {};
}
```

`web/src/main.ts`:
```ts
import './style.css';
import { state, subscribe } from './state';
import { restore } from './project-io';
import { mountFiles } from './ui/files-screen';
import { mountEditor } from './ui/editor-screen';

type AppScreen = typeof state.screen;
const app = document.getElementById('app')!;
let current: AppScreen | null = null;
let unmount: (() => void) | null = null;

function render(): void {
  if (state.screen === current) return;
  unmount?.();
  current = state.screen;
  unmount = current === 'files' ? mountFiles(app) : mountEditor(app);
}

subscribe(render);
void restore().finally(render);
```

- [ ] **Step 5: Build ve tarayıcıda doğrula**

Run: `npm run typecheck && npm run build:web`
Expected: Hatasız, `dist/index.html` ve worker chunk'ı oluşur.

Run (arka planda): `npm run dev -- --port 5173`
Playwright MCP ile: `http://localhost:5173/` aç → `browser_file_upload` ile `~/Desktop/stickers/çay ve kahve/bases/turk kahvesi.png`, `turk kahvesi arka.png` ve `assets/*.png` yükle → rollerin doğru atandığını snapshot'ta gör (tam tasarım / arka plan / 6 sticker) → sayfa 80 × 140 gir → "Yerleştir" → "13 sticker yerleştirildi." metnini gör → `browser_console_messages` hatasız.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): iskelet, worker motoru ve dosya ekranı"
```

---

### Task 14: Web — düzenleyici (canvas, dokunmatik etkileşim, panel)

**Files:**
- Create: `web/src/ui/interaction.ts`, `web/src/ui/canvas-view.ts`
- Modify: `web/src/ui/editor-screen.ts` (tamamen yeniden yaz)
- Test: `tests/web/interaction.test.ts`

**Interfaces:**
- Consumes: `state`, `subscribe`, `update` (T13); `commit`, `addStickerItem`, `addNewPng`, `exportPdf`, `exportZip`, `newProject` (T13); geometri (T3)
- Produces (`interaction.ts`):
  - `interface Geom { x: number; y: number; scale: number; rotationDeg: number; w: number; h: number }`
  - `corners(g): Pt[]` (sol üst, sağ üst, sağ alt, sol alt), `containsPoint(g, p): boolean`
  - `handles(g, rotateOffset): { scale: Pt; rotate: Pt }`, `hitHandle(g, p, radius, rotateOffset): 'scale' | 'rotate' | null`
  - `moved(orig, start, now): { x; y }`, `scaled(orig, start, now): number`, `rotated(orig, start, now): number`

- [ ] **Step 1: Failing testi yaz**

`tests/web/interaction.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { corners, containsPoint, handles, hitHandle, moved, scaled, rotated } from '../../web/src/ui/interaction';

const g = { x: 100, y: 100, scale: 0.5, rotationDeg: 0, w: 200, h: 100 };

describe('interaction', () => {
  it('corners ve containsPoint', () => {
    expect(corners(g)).toEqual([{ x: 50, y: 75 }, { x: 150, y: 75 }, { x: 150, y: 125 }, { x: 50, y: 125 }]);
    expect(containsPoint(g, { x: 60, y: 80 })).toBe(true);
    expect(containsPoint(g, { x: 40, y: 80 })).toBe(false);
    expect(containsPoint({ ...g, rotationDeg: 90 }, { x: 110, y: 145 })).toBe(true);
  });

  it('handles ve hitHandle', () => {
    const h = handles(g, 20);
    expect(h.scale).toEqual({ x: 150, y: 125 });
    expect(h.rotate.x).toBeCloseTo(100);
    expect(h.rotate.y).toBeCloseTo(55);
    expect(hitHandle(g, { x: 148, y: 124 }, 10, 20)).toBe('scale');
    expect(hitHandle(g, { x: 100, y: 57 }, 10, 20)).toBe('rotate');
    expect(hitHandle(g, { x: 100, y: 100 }, 10, 20)).toBeNull();
  });

  it('moved, scaled, rotated', () => {
    expect(moved(g, { x: 0, y: 0 }, { x: 5, y: -3 })).toEqual({ x: 105, y: 97 });
    expect(scaled(g, { x: 150, y: 100 }, { x: 200, y: 100 })).toBeCloseTo(1);
    expect(rotated(g, { x: 200, y: 100 }, { x: 100, y: 200 })).toBe(90);
    expect(rotated(g, { x: 200, y: 100 }, { x: 200, y: 104 })).toBe(0); // 3°'nin altı 0'a yapışır
  });
});
```

- [ ] **Step 2: Fail ettiğini gör**

Run: `npx vitest run tests/web/interaction.test.ts`
Expected: FAIL — `Failed to resolve import "../../web/src/ui/interaction"`

- [ ] **Step 3: `web/src/ui/interaction.ts`'i yaz**

```ts
import { type Pt, apply, invert, itemMatrix } from '../../../src/core/geometry';

export interface Geom { x: number; y: number; scale: number; rotationDeg: number; w: number; h: number }

export function corners(g: Geom): Pt[] {
  const m = itemMatrix(g, g.w, g.h);
  return [apply(m, { x: 0, y: 0 }), apply(m, { x: g.w, y: 0 }), apply(m, { x: g.w, y: g.h }), apply(m, { x: 0, y: g.h })]
    .map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }));
}

export function containsPoint(g: Geom, p: Pt): boolean {
  const l = apply(invert(itemMatrix(g, g.w, g.h)), p);
  return l.x >= 0 && l.y >= 0 && l.x <= g.w && l.y <= g.h;
}

export function handles(g: Geom, rotateOffset: number): { scale: Pt; rotate: Pt } {
  const [tl, tr, br] = corners(g);
  const top = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const dx = top.x - g.x, dy = top.y - g.y, len = Math.hypot(dx, dy) || 1;
  return { scale: br, rotate: { x: top.x + (dx / len) * rotateOffset, y: top.y + (dy / len) * rotateOffset } };
}

export function hitHandle(g: Geom, p: Pt, radius: number, rotateOffset: number): 'scale' | 'rotate' | null {
  const h = handles(g, rotateOffset);
  if (Math.hypot(p.x - h.scale.x, p.y - h.scale.y) <= radius) return 'scale';
  if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) <= radius) return 'rotate';
  return null;
}

export function moved(orig: Geom, start: Pt, now: Pt): { x: number; y: number } {
  return { x: orig.x + now.x - start.x, y: orig.y + now.y - start.y };
}

export function scaled(orig: Geom, start: Pt, now: Pt): number {
  const d0 = Math.hypot(start.x - orig.x, start.y - orig.y);
  const d1 = Math.hypot(now.x - orig.x, now.y - orig.y);
  return d0 ? Math.max(0.005, (orig.scale * d1) / d0) : orig.scale;
}

export function rotated(orig: Geom, start: Pt, now: Pt): number {
  const a0 = Math.atan2(start.y - orig.y, start.x - orig.x), a1 = Math.atan2(now.y - orig.y, now.x - orig.x);
  let deg = orig.rotationDeg + ((a1 - a0) * 180) / Math.PI;
  deg = (((deg % 360) + 540) % 360) - 180;
  const snap = Math.round(deg / 90) * 90;
  if (Math.abs(deg - snap) < 3) deg = snap;
  return Math.round(deg * 10) / 10 || 0;
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/web/interaction.test.ts`
Expected: 3 test PASS.

- [ ] **Step 5: `web/src/ui/canvas-view.ts`'i yaz**

```ts
import { state } from '../state';
import { itemMatrix, closedPathSvg, pointInPolygon, type Pt } from '../../../src/core/geometry';
import { effectiveSettings, type Item } from '../../../src/core/project';
import { corners, containsPoint, handles, hitHandle, moved, scaled, rotated, type Geom } from './interaction';

type Mode = 'move' | 'scale' | 'rotate';
const HANDLE_PX = 22;
const ROTATE_OFFSET_PX = 36;

export class CanvasView {
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
```

- [ ] **Step 6: `web/src/ui/editor-screen.ts`'i gerçek haliyle yaz**

```ts
import { state, subscribe, update } from '../state';
import { commit, addStickerItem, addNewPng, exportPdf, exportZip, newProject } from '../project-io';
import { CanvasView } from './canvas-view';
import { esc } from './html';

export function mountEditor(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="editor">
      <div class="stage-wrap" id="stage"></div>
      <aside class="panel">
        <div id="settings"></div>
        <section><h2>Uyarılar</h2><ul id="warnings" class="msgs"></ul></section>
        <section class="actions">
          <button id="pdf" class="primary">PDF oluştur</button>
          <button id="zip">Projeyi dışa aktar (.zip)</button>
          <button id="new" class="danger">Yeni proje</button>
        </section>
      </aside>
    </div>
    <div class="busy-overlay" id="busy"></div>
    <input type="file" id="addPick" accept=".png,.PNG,image/png" hidden />`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const settings = $('#settings');
  const view = new CanvasView($('#stage'), () => { commit(); renderSettings(); }, () => renderSettings());

  function renderSettings(): void {
    const pack = state.pack;
    if (!pack) return;
    const d = pack.defaults;
    const item = pack.items.find((i) => i.id === state.selectedId);
    const stickers = [...state.files.values()].filter((f) => f.name !== pack.files.design && f.name !== pack.files.background);
    const opts = (sel?: string) => stickers.map((f) => `<option value="${esc(f.name)}"${f.name === sel ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
    const wb = item?.overrides.whiteBorder;
    settings.innerHTML = `
      <section><h2>Sayfa</h2><div class="grid2">
        <label>Genişlik (mm)<input data-k="page.widthMm" type="number" step="0.1" min="1" value="${pack.page.widthMm}"></label>
        <label>Yükseklik (mm)<input data-k="page.heightMm" type="number" step="0.1" min="1" value="${pack.page.heightMm}"></label>
      </div></section>
      <section><h2>Genel ayarlar</h2>
        <div class="grid2">
          <label>Offset (mm)<input data-k="d.offsetMm" type="number" step="0.1" min="0" value="${d.offsetMm}"></label>
          <label>Çizgi (pt)<input data-k="d.strokeWidthPt" type="number" step="0.05" min="0.05" value="${d.strokeWidthPt}"></label>
        </div>
        <label>Yumuşatma<input data-k="d.smoothing" type="range" min="0" max="1" step="0.05" value="${d.smoothing}"></label>
        <label class="check"><input data-k="d.whiteBorder" type="checkbox"${d.whiteBorder ? ' checked' : ''}> Beyaz kenar</label>
        <label class="check"><input data-k="showCuts" type="checkbox"${state.showCuts ? ' checked' : ''}> Kesim çizgilerini göster</label>
      </section>
      ${item ? `
      <section><h2>Seçili sticker (${esc(item.id)})</h2>
        <label>Dosya<select data-k="i.file">${opts(item.file)}</select></label>
        <div class="grid2">
          <label>Offset (mm)<input data-k="i.offsetMm" type="number" step="0.1" min="0" placeholder="varsayılan (${d.offsetMm})" value="${item.overrides.offsetMm ?? ''}"></label>
          <label>Döndürme (°)<input data-k="i.rotationDeg" type="number" step="1" value="${item.rotationDeg}"></label>
        </div>
        <label>Beyaz kenar<select data-k="i.whiteBorder">
          <option value=""${wb === undefined ? ' selected' : ''}>Varsayılan</option>
          <option value="1"${wb === true ? ' selected' : ''}>Açık</option>
          <option value="0"${wb === false ? ' selected' : ''}>Kapalı</option>
        </select></label>
        <label class="check"><input data-k="i.printOnly" type="checkbox"${item.printOnly ? ' checked' : ''}> Sadece baskı (kesim çizgisi yok)</label>
        ${item.needsReview ? '<button data-act="approve">Yeri doğru, onayla</button>' : ''}
        <button data-act="delete" class="danger">Sil</button>
      </section>` : '<p class="lead">Düzenlemek için bir sticker’a dokun.</p>'}
      <section><h2>Sticker ekle</h2>
        <select id="addFile">${opts()}</select>
        <button data-act="add">Seçili sticker’ı ekle</button>
        <button data-act="addNew">Yeni PNG yükle ve ekle</button>
      </section>`;
  }

  function renderStatus(): void {
    const all = [...state.messages, ...state.cutMessages];
    $('#warnings').innerHTML = all.length
      ? all.map((m) => `<li class="${m.level}"${m.itemId ? ` data-item="${esc(m.itemId)}"` : ''}>${esc(m.text)}</li>`).join('')
      : '<li class="info">Sorun yok.</li>';
    $('#busy').textContent = state.busy ?? '';
    for (const b of root.querySelectorAll<HTMLButtonElement>('.actions button')) b.disabled = !!state.busy;
  }

  // root (#app) ekranlar arasında kalıcı; dinleyiciler unmount'ta kaldırılmalı
  const ac = new AbortController();
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement & HTMLSelectElement;
    const k = el.dataset.k;
    const pack = state.pack;
    if (!k || !pack) return;
    const item = pack.items.find((i) => i.id === state.selectedId);
    const n = Number(el.value);
    switch (k) {
      case 'page.widthMm': if (n > 0) pack.page.widthMm = n; break;
      case 'page.heightMm': if (n > 0) pack.page.heightMm = n; break;
      case 'd.offsetMm': pack.defaults.offsetMm = Math.max(0, n || 0); break;
      case 'd.strokeWidthPt': if (n > 0) pack.defaults.strokeWidthPt = n; break;
      case 'd.smoothing': pack.defaults.smoothing = n; break;
      case 'd.whiteBorder': pack.defaults.whiteBorder = el.checked; break;
      case 'showCuts': update((s) => { s.showCuts = el.checked; }); return;
      case 'i.file': if (item) item.file = el.value; break;
      case 'i.offsetMm':
        if (item) { if (el.value === '') delete item.overrides.offsetMm; else item.overrides.offsetMm = Math.max(0, n || 0); }
        break;
      case 'i.rotationDeg': if (item && Number.isFinite(n)) item.rotationDeg = n; break;
      case 'i.whiteBorder':
        if (item) { if (el.value === '') delete item.overrides.whiteBorder; else item.overrides.whiteBorder = el.value === '1'; }
        break;
      case 'i.printOnly': if (item) item.printOnly = el.checked; break;
      default: return;
    }
    commit();
    renderSettings();
  }, { signal: ac.signal });

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pack = state.pack;
    if (!pack) return;
    const warning = t.closest<HTMLElement>('li[data-item]');
    if (warning) { state.selectedId = warning.dataset.item!; renderSettings(); view.draw(); return; }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const item = pack.items.find((i) => i.id === state.selectedId);
    if (act === 'approve' && item) { item.needsReview = false; commit(); renderSettings(); }
    if (act === 'delete' && item) { pack.items = pack.items.filter((i) => i !== item); state.selectedId = null; commit(); renderSettings(); }
    if (act === 'add') { const v = $<HTMLSelectElement>('#addFile').value; if (v) { addStickerItem(v); renderSettings(); } }
    if (act === 'addNew') $<HTMLInputElement>('#addPick').click();
  }, { signal: ac.signal });

  $<HTMLInputElement>('#addPick').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) { await addNewPng(f); renderSettings(); }
  });
  $('#pdf').addEventListener('click', () => void exportPdf());
  $('#zip').addEventListener('click', () => void exportZip());
  let armed = 0;
  $('#new').addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    if (Date.now() - armed < 3000) { void newProject(); return; }
    armed = Date.now();
    b.textContent = 'Emin misin? Tekrar dokun';
    setTimeout(() => { b.textContent = 'Yeni proje'; }, 3000);
  });

  renderSettings();
  renderStatus();
  view.draw();
  const unsub = subscribe(() => { renderStatus(); view.draw(); });
  return () => { ac.abort(); unsub(); view.destroy(); };
}
```

- [ ] **Step 7: Build ve tarayıcıda doğrula**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: PASS.

Dev sunucusu açıkken Playwright MCP ile (kahve dosyalarını yükleyip "Yerleştir"den sonra):
1. Ekran görüntüsü al: 13 sticker yerinde, kırmızı kesim çizgileri görünür.
2. Bir sticker'a tıkla → mavi çerçeve ve tutamaçlar; panelde "Seçili sticker (iX)".
3. Sürükle (`browser_drag` ya da `browser_run_code_unsafe` ile pointer olayları) → konum değişir, ~150 ms sonra kesim çizgisi yeni yerde yeniden çizilir.
4. Genel offset'i 1.5 yap → tüm çizgiler dışa açılır; "Beyaz kenar"ı aç → beyaz dolgu görünür.
5. "Kesim çizgilerini göster"i kapat → çizgiler kaybolur.
6. `browser_resize` ile 820×1180 (iPad dikey) → panel alta geçer, canvas sığar.
7. `browser_console_messages`: hata yok.

- [ ] **Step 8: Commit**

```bash
git add web tests/web
git commit -m "feat(web): dokunmatik düzenleyici, canvas ve ayar paneli"
```

---

### Task 15: Web — çıktı, otomatik kayıt ve uçtan uca tarayıcı doğrulaması

**Files:**
- Modify: yalnızca doğrulamada bulunan hataları düzeltmek için ilgili `web/src/**` dosyaları

**Interfaces:**
- Consumes: T13–T14

- [ ] **Step 1: PDF indirmeyi doğrula**

Dev sunucusunda (Playwright, masaüstü görünümü): "PDF oluştur" → indirme olur (`turk kahvesi.pdf`). İndirilen dosyayı `node -e` ile pdf-lib'le aç: 2 sayfa, 226.77 × 396.85 pt.

```bash
node --input-type=module -e "import {PDFDocument} from 'pdf-lib'; import {readFileSync} from 'fs'; const d=await PDFDocument.load(readFileSync(process.argv[1])); console.log(d.getPageCount(), d.getPage(0).getSize())" <indirilen-yol>
```
Expected: `2 { width: 226.77…, height: 396.85… }`

- [ ] **Step 2: Zip round-trip'i doğrula**

"Projeyi dışa aktar (.zip)" → indir → CLI ile aç: `node bin/stickercut.mjs import <zip> $TMPDIR/sc-web && node bin/stickercut.mjs build $TMPDIR/sc-web/pack.json` → `PDF yazıldı`. Sonra web'de "Yeni proje" (iki kez dokun) → dosya ekranı boş → aynı zip'i yükle → düzenleyici aynı yerleşimle açılır.

- [ ] **Step 3: Otomatik kaydı doğrula**

Bir sticker'ı taşı → 1 sn bekle → sayfayı yenile → "Kaldığın yerden açılıyor…" sonrası düzenleyici taşınmış konumla gelir.

- [ ] **Step 4: Hata durumlarını doğrula**

- Yeni projede sadece sticker PNG'leri yükle → "Yerleştir" pasif, rol uyarısı görünür.
- Düzenleyicide opak bir PNG'yi (ör. `bases/turk kahvesi arka.png`) "Yeni PNG yükle ve ekle" ile ekle → uyarılarda "şeffaf alan yok" hatası; "PDF oluştur" PDF üretmez ve hatayı listeler. Öğeyi sil → PDF üretilir.

- [ ] **Step 5: Bulunan hataları düzelt ve commit**

Her bulguda global kural #6: önce `console.log` ile gerçek veriyi gör, sonra düzelt, log'ları kaldır.

```bash
git add web
git commit -m "fix(web): uçtan uca doğrulamada bulunan sorunlar"
```
(Hiç hata çıkmadıysa commit yok; bunu raporda belirt.)

---

### Task 16: Deploy, agent belgeleri ve kullanıcı doğrulaması

**Files:**
- Create: `.github/workflows/pages.yml`, `AGENTS.md`, `README.md`, `.claude/skills/stickercut/SKILL.md`

**Interfaces:**
- Consumes: CLI komutları (T11), web build (T13)

- [ ] **Step 1: GitHub Actions workflow'u**

`.github/workflows/pages.yml`:
```yaml
name: Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build:web
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: `AGENTS.md`, skill ve README**

`AGENTS.md`:
````markdown
# stickercut — agent rehberi

Sticker pack PNG'lerinden baskı + kesim PDF'i üretir. Çizimler `~/Desktop/stickers/<pack>/` altında durur; bu repo'ya asla kopyalanmaz.

## Bir pack'in kesim dosyasını hazırlama

1. Klasöre bak: aynı boyutta iki opak PNG (tam tasarım + arka plan) ve şeffaf sticker PNG'leri olmalı.
2. `node bin/stickercut.mjs init "<klasör>" --page <genişlik>x<yükseklik> --json`
   - Klasörde birden fazla pack varsa: `--design <yol> --background <yol>` ve `-o "<klasör>/<ad>.pack.json"`.
   - Sayfa ölçüsü bilinmiyorsa kullanıcıya sor; önceki PDF'in MediaBox'ından da okunabilir.
3. `<ad>.preview.png`'yi aç ve kontrol et: her sticker doğru yerde mi, kesim çizgisi silüeti sarıyor mu, turuncu çerçeveli (needsReview) öğe var mı?
4. Sorun varsa `pack.json`'daki ilgili öğeyi düzelt (`x`, `y` merkez tasarım pikseli; `scale`; `rotationDeg`; `printOnly`; `overrides.offsetMm`), sonra `node bin/stickercut.mjs preview <pack.json>` ile tekrar bak.
5. `node bin/stickercut.mjs build <pack.json> [--offset mm] [--white-border]` → PDF.
6. Kullanıcıya PDF yolunu, uyarıları ve düzeltmeleri raporla.

## Kurallar
- Uyarıları (UNMATCHED_REGION, NEEDS_REVIEW, OVERLAP, OUTSIDE_PAGE) asla sessizce geçme; kullanıcıya bildir.
- Çıktılar pack klasörüne yazılır; mevcut `.ai`/`.pdf` dosyalarına dokunma.
````

`.claude/skills/stickercut/SKILL.md`:
```markdown
---
name: stickercut
description: Bir sticker pack klasöründen baskı + kesim çizgisi PDF'i hazırlar (stickercut CLI). "şu pack'in kesim dosyasını hazırla", "kesim çizgisi çıkar", "sticker pdf'i yap" gibi isteklerde kullan.
---

`AGENTS.md`'deki "Bir pack'in kesim dosyasını hazırlama" adımlarını sırayla uygula. Komutları repo kökünden çalıştır. Önizleme PNG'sini mutlaka Read aracıyla açıp gözle kontrol et; kontrol etmeden "hazır" deme.
```

`README.md`:
````markdown
# stickercut

Sticker pack'leri için otomatik yerleşim ve kesim çizgisi. Tam tasarım + arka plan + tek tek sticker PNG'lerinden 2 sayfalı (baskı + kesim) PDF üretir.

- **Web (iPad/Mac):** https://yufisu.github.io/stickercut/ (işlemler tamamen cihazda yapılır, dosyalar hiçbir yere yüklenmez)
- **CLI:** `npm install && npm link`, sonra `stickercut init <klasör> --page 80x140` → `stickercut build <klasör>/pack.json`

Ayrıntılar: `AGENTS.md`, `docs/superpowers/specs/2026-09-28-stickercut-design.md`.
````

- [ ] **Step 3: Doğrula ve commit**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: PASS.

```bash
git add .github AGENTS.md README.md .claude
git commit -m "docs: agent rehberi, skill, README ve Pages workflow'u"
```

- [ ] **Step 4: GitHub'a gönder (kullanıcı onayıyla)**

Bu adım dışa dönük; çalıştırmadan önce Yusuf'a repo adını (`yufisu/stickercut`, public) teyit ettir. Onaydan sonra:
```bash
gh repo create yufisu/stickercut --public --source . --remote origin --push
gh api -X POST repos/yufisu/stickercut/pages -f build_type=workflow
gh workflow run pages.yml && sleep 5 && gh run watch --exit-status
```
Expected: Workflow yeşil; `https://yufisu.github.io/stickercut/` açılır.

- [ ] **Step 5: Canlı sürümü doğrula**

Playwright ile canlı URL'yi aç, kahve dosyalarını yükle, "Yerleştir" → 13 sticker, console hatasız.

- [ ] **Step 6: Kullanıcı doğrulaması**

Yusuf'tan iste:
1. Task 12'deki `kahve.pack.pdf`'i (ya da web'den indirileni) Illustrator'da açsın: iki sayfa düzgün mü, sticker'lar yüksek çözünürlüklü mü, kesim çizgisi düzenlenebilir vektör mü?
2. Kız arkadaşının iPad'inde canlı URL'yi Safari'de açsın, Dosyalar'dan bir pack seçip yerleştirsin, bir sticker'ı parmakla taşısın, PDF'i paylaşım menüsüyle kaydetsin.
3. Bulgular olursa: Illustrator uyumsuzluğu → `pdf.ts`; iPad hafıza/performans → `ANALYSIS_MAX` ve `DISPLAY_MAX`; dokunmatik → `canvas-view.ts`. Her düzeltme kendi testiyle ayrı commit.

Global CLAUDE.md gereği: düzeltmeler kullanıcıdan gelirse `tasks/lessons.md`'ye Hata + Neden + Kural ekle.
````

