import { type Affine, type Coord, invert } from '../../../src/core/geometry';
import type { Pack } from '../../../src/core/project';
import type { Bounds } from './snap';

/** zoom 1 = gerçek boyut (96 CSS px / inç); pan CSS px cinsinden. */
export interface Camera { zoom: number; panX: number; panY: number }
/** Sahnenin CSS px ölçüsü. */
export interface Viewport { width: number; height: number }
/** Sayfa ölçüsü (mm). */
export interface PageMm { w: number; h: number }
export type PackSize = Pick<Pack, 'page' | 'designSize'>;

export const PX_PER_MM_AT_1 = 96 / 25.4;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 32;

/** Sonlu olmayan değerler en küçük zoom'a düşer. */
export const clampZoom = (zoom: number): number => (zoom > MIN_ZOOM ? Math.min(zoom, MAX_ZOOM) : MIN_ZOOM);

/** mm başına CSS px. */
export const scaleOf = (cam: Camera): number => cam.zoom * PX_PER_MM_AT_1;

export const pageOf = (pack: PackSize): PageMm => ({ w: pack.page.widthMm, h: pack.page.heightMm });

/** Sayfanın (0,0) köşesinin ekran konumu; pan sıfırken sayfa görüntü alanında ortalanır. */
export function pageOrigin(cam: Camera, vp: Viewport, page: PageMm): Coord {
  const s = scaleOf(cam);
  return { x: (vp.width - page.w * s) / 2 + cam.panX, y: (vp.height - page.h * s) / 2 + cam.panY };
}

/** mm → ekran dönüşümü; canvas setTransform için (DPR hariç). */
export function mmToScreenMatrix(cam: Camera, vp: Viewport, page: PageMm): Affine {
  const s = scaleOf(cam), o = pageOrigin(cam, vp, page);
  return [s, 0, 0, s, o.x, o.y];
}

export function mmToScreen(cam: Camera, vp: Viewport, page: PageMm, p: Coord): Coord {
  const s = scaleOf(cam), o = pageOrigin(cam, vp, page);
  return { x: o.x + p.x * s, y: o.y + p.y * s };
}

export function screenToMm(cam: Camera, vp: Viewport, page: PageMm, p: Coord): Coord {
  const s = scaleOf(cam), o = pageOrigin(cam, vp, page);
  return { x: (p.x - o.x) / s, y: (p.y - o.y) / s };
}

/** Verilen mm kutusunu kenar payıyla sığdıran zoom. */
function zoomFor(vp: Viewport, wMm: number, hMm: number, paddingPx: number): number {
  const s = Math.min((vp.width - 2 * paddingPx) / wMm, (vp.height - 2 * paddingPx) / hMm);
  return clampZoom(s / PX_PER_MM_AT_1);
}

export function fitCamera(vp: Viewport, page: PageMm, paddingPx = 24): Camera {
  return { zoom: zoomFor(vp, page.w, page.h, paddingPx), panX: 0, panY: 0 };
}

/** screenPt altındaki mm noktası sabit kalacak şekilde zoom'u değiştirir (varsayılan: görüntü merkezi). */
export function zoomTo(cam: Camera, vp: Viewport, page: PageMm, zoom: number, screenPt?: Coord): Camera {
  const next = clampZoom(zoom);
  if (next === cam.zoom) return cam;
  const at = screenPt ?? { x: vp.width / 2, y: vp.height / 2 };
  const anchor = screenToMm(cam, vp, page, at);
  const moved = mmToScreen({ ...cam, zoom: next }, vp, page, anchor);
  return { zoom: next, panX: cam.panX + at.x - moved.x, panY: cam.panY + at.y - moved.y };
}

export function zoomAt(cam: Camera, vp: Viewport, page: PageMm, screenPt: Coord, factor: number): Camera {
  return zoomTo(cam, vp, page, cam.zoom * factor, screenPt);
}

export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, panX: cam.panX + dx, panY: cam.panY + dy };
}

/** Seçimi (mm) kenar payıyla sığdırıp görüntü alanında ortalar. */
export function zoomToBounds(vp: Viewport, page: PageMm, boundsMm: Bounds, paddingPx = 24): Camera {
  const zoom = zoomFor(vp, boundsMm.maxX - boundsMm.minX, boundsMm.maxY - boundsMm.minY, paddingPx);
  const cam = { zoom, panX: 0, panY: 0 };
  const centre = mmToScreen(cam, vp, page, { x: (boundsMm.minX + boundsMm.maxX) / 2, y: (boundsMm.minY + boundsMm.maxY) / 2 });
  return { zoom, panX: vp.width / 2 - centre.x, panY: vp.height / 2 - centre.y };
}

/** Tasarım px → mm; mmPerDesignPx ile aynı: x ve y çarpanları farklı olabilir. */
export function designToMm(pack: PackSize): Affine {
  return [pack.page.widthMm / pack.designSize.widthPx, 0, 0, pack.page.heightMm / pack.designSize.heightPx, 0, 0];
}

export const mmToDesign = (pack: PackSize): Affine => invert(designToMm(pack));
