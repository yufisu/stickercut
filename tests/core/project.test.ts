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

  it('v1 smoothing ayarını smoothMm’ye taşır, bilinmeyen alanları atar, sürümü 2 yapar', () => {
    const v1 = { ...minimal, defaults: { smoothing: 0.5, offsetMm: 1, junk: 3 }, items: [{ ...minimal.items[0], overrides: { smoothing: 1, simplifyMm: 0.1 } }] };
    const p = parsePack(JSON.stringify(v1));
    expect(p.version).toBe(2);
    expect(p.defaults.smoothMm).toBe(0.2);
    expect(p.defaults.offsetMm).toBe(1);
    expect(p.defaults.closingMm).toBe(DEFAULT_SETTINGS.closingMm);
    expect((p.defaults as unknown as Record<string, unknown>).junk).toBeUndefined();
    expect(p.items[0].overrides).toEqual({ smoothMm: 0.4, simplifyMm: 0.1 });
    expect(JSON.parse(serializePack(p)).version).toBe(2);
  });

  it('bölge öğesi: file null + geçerli region kabul edilir, bozuk rle reddedilir', () => {
    const region = { bbox: { x: 10, y: 20, w: 3, h: 2 }, rle: '1,4,1' };
    const p = parsePack(JSON.stringify({ ...minimal, items: [{ id: 'r1', file: null, region, x: 11.5, y: 21, scale: 1 }] }));
    expect(p.items[0].file).toBeNull();
    expect(p.items[0].region).toEqual(region);
    expect(parsePack(serializePack(p)).items[0]).toEqual(p.items[0]);
    const bad = { ...minimal, items: [{ id: 'r1', file: null, region: { ...region, rle: '1,4' }, x: 1, y: 1, scale: 1 }] };
    expect(() => parsePack(JSON.stringify(bad))).toThrow(/uyuşmuyor/);
    const none = { ...minimal, items: [{ id: 'r1', file: null, x: 1, y: 1, scale: 1 }] };
    expect(() => parsePack(JSON.stringify(none))).toThrow(/region/);
  });
});
