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
