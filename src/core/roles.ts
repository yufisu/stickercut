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
