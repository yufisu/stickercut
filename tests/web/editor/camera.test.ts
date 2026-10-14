import { describe, it, expect } from 'vitest';
import {
  PX_PER_MM_AT_1, MIN_ZOOM, MAX_ZOOM, clampZoom, scaleOf, pageOf, pageOrigin, mmToScreenMatrix, mmToScreen, screenToMm,
  fitCamera, zoomTo, zoomAt, panBy, zoomToBounds, designToMm, mmToDesign, type Camera,
} from '../../../web/src/editor/camera';
import { apply } from '../../../src/core/geometry';
import { DEFAULT_SETTINGS, mmPerDesignPx, type Pack } from '../../../src/core/project';

const vp = { width: 800, height: 600 };
const page = { w: 80, h: 140 };
const cam1: Camera = { zoom: 1, panX: 0, panY: 0 };

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('camera', () => {
  it('zoom 1 gerçek boyut; pan 0 sayfayı ortalar, pan kaydırır', () => {
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.1, 32]);
    expect(scaleOf(cam1)).toBeCloseTo(96 / 25.4, 12);
    expect(scaleOf({ ...cam1, zoom: 2 })).toBeCloseTo(2 * PX_PER_MM_AT_1, 12);
    close(mmToScreen(cam1, vp, page, { x: 40, y: 70 }), { x: 400, y: 300 });
    close(pageOrigin({ zoom: 1, panX: 10, panY: -5 }, vp, page), { x: 400 - 40 * PX_PER_MM_AT_1 + 10, y: 300 - 70 * PX_PER_MM_AT_1 - 5 });
    expect(pageOf({ page: { widthMm: 80, heightMm: 140 }, designSize: { widthPx: 1, heightPx: 1 } })).toEqual({ w: 80, h: 140 });
  });

  it('mmToScreen ∘ screenToMm birim dönüşümdür; matris aynı sonucu verir', () => {
    for (const cam of [cam1, { zoom: 0.37, panX: -120, panY: 33 }, { zoom: 7.5, panX: 1234.5, panY: -987 }]) {
      for (const p of [{ x: 0, y: 0 }, { x: 12.5, y: 99 }, { x: -3, y: 250 }]) {
        close(screenToMm(cam, vp, page, mmToScreen(cam, vp, page, p)), p);
        close(mmToScreen(cam, vp, page, screenToMm(cam, vp, page, p)), p);
        close(apply(mmToScreenMatrix(cam, vp, page), p), mmToScreen(cam, vp, page, p));
      }
    }
  });

  it('fitCamera sayfayı kenar payıyla sığdırır ve sınırlar', () => {
    const cam = fitCamera(vp, page); // 80x140 sayfada yükseklik belirler: (600-48)/140 px/mm
    expect(cam.panX).toBe(0);
    expect(cam.panY).toBe(0);
    expect(scaleOf(cam) * page.h).toBeCloseTo(vp.height - 48, 9);
    expect(scaleOf(cam) * page.w).toBeLessThan(vp.width - 48);
    close(mmToScreen(cam, vp, page, { x: 0, y: 0 }), { x: (800 - 80 * scaleOf(cam)) / 2, y: 24 });
    expect(scaleOf(fitCamera(vp, page, 0)) * page.h).toBeCloseTo(600, 9);
    expect(fitCamera({ width: 30, height: 30 }, page).zoom).toBe(MIN_ZOOM);
    expect(fitCamera({ width: 100000, height: 100000 }, { w: 1, h: 1 }).zoom).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
  });

  it('zoomAt imlecin altındaki mm noktasını sabit tutar', () => {
    const pt = { x: 123, y: 456 };
    let cam: Camera = { zoom: 1.3, panX: 20, panY: -40 };
    const anchor = screenToMm(cam, vp, page, pt);
    for (const f of [1.25, 1.25, 0.5, 3, 0.1]) {
      cam = zoomAt(cam, vp, page, pt, f);
      const now = screenToMm(cam, vp, page, pt);
      expect(Math.abs(now.x - anchor.x)).toBeLessThan(1e-9);
      expect(Math.abs(now.y - anchor.y)).toBeLessThan(1e-9);
    }
    expect(cam.zoom).toBeCloseTo(1.3 * 1.25 * 1.25 * 0.5 * 3 * 0.1, 12);
  });

  it('zoomAt ve zoomTo [MIN_ZOOM, MAX_ZOOM] içinde kalır; değişmeyen zoom aynı kamerayı döndürür', () => {
    const pt = { x: 50, y: 50 };
    const big = zoomAt(cam1, vp, page, pt, 1000);
    expect(big.zoom).toBe(MAX_ZOOM);
    close(screenToMm(big, vp, page, pt), screenToMm(cam1, vp, page, pt));
    const small = zoomAt(cam1, vp, page, pt, 1e-6);
    expect(small.zoom).toBe(MIN_ZOOM);
    close(screenToMm(small, vp, page, pt), screenToMm(cam1, vp, page, pt));
    expect(zoomAt(big, vp, page, pt, 2)).toBe(big);
    expect(zoomTo(cam1, vp, page, 1, pt)).toBe(cam1);
  });

  it('zoomTo nokta verilmezse görüntü merkezini sabit tutar', () => {
    const cam: Camera = { zoom: 2, panX: 15, panY: -30 };
    const centre = { x: vp.width / 2, y: vp.height / 2 };
    const next = zoomTo(cam, vp, page, 4);
    expect(next.zoom).toBe(4);
    close(screenToMm(next, vp, page, centre), screenToMm(cam, vp, page, centre));
  });

  it('panBy pan ekler', () => {
    expect(panBy({ zoom: 2, panX: 1, panY: 2 }, 10, -5)).toEqual({ zoom: 2, panX: 11, panY: -3 });
  });

  it('zoomToBounds seçimi sığdırıp ortalar', () => {
    const b = { minX: 10, minY: 20, maxX: 50, maxY: 40 }; // 40 x 20 mm: genişlik belirler, (800-48)/40 px/mm
    const cam = zoomToBounds(vp, page, b, 24);
    expect(scaleOf(cam) * 40).toBeCloseTo(752, 9);
    close(mmToScreen(cam, vp, page, { x: 30, y: 30 }), { x: 400, y: 300 });
    close(mmToScreen(cam, vp, page, { x: 10, y: 20 }), { x: 24, y: 300 - 10 * scaleOf(cam) });
    expect(zoomToBounds(vp, page, { minX: 5, minY: 5, maxX: 5, maxY: 5 }).zoom).toBe(MAX_ZOOM);
  });

  it('designToMm, mmPerDesignPx ile aynı çarpanları kullanır; mmToDesign tersidir', () => {
    const pack: Pack = {
      version: 3, page: { widthMm: 80, heightMm: 140 }, designSize: { widthPx: 1000, heightPx: 2000 },
      files: { design: 'd.png', background: 'b.png' }, defaults: DEFAULT_SETTINGS, items: [],
    };
    const m = designToMm(pack), k = mmPerDesignPx(pack);
    expect(m).toEqual([k.x, 0, 0, k.y, 0, 0]);
    expect(k.x).not.toBeCloseTo(k.y, 6);
    close(apply(m, { x: 500, y: 500 }), { x: 40, y: 35 });
    close(apply(mmToDesign(pack), { x: 40, y: 35 }), { x: 500, y: 500 });
  });
});
