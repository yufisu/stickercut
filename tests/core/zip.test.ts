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
