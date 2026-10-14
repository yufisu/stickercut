import { zlibSync } from 'fflate';
import type { Raster } from './raster';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** uzunluk + tür + veri + CRC(tür + veri) */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 8 bit RGBA PNG: filtresiz satırlar, tek IDAT (zlib seviye 6). */
export function encodePngRgba(r: Raster): Uint8Array {
  const stride = r.width * 4;
  const raw = new Uint8Array((stride + 1) * r.height); // her satırın başında filtre baytı 0
  for (let y = 0; y < r.height; y++) raw.set(r.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, r.width);
  view.setUint32(4, r.height);
  ihdr.set([8, 6, 0, 0, 0], 8); // bit derinliği 8, RGBA, deflate, filtre 0, taramasız
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
