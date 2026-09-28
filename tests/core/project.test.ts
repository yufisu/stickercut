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
