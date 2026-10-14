import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../web/src/engine/engine', () => {
  const engine = {
    onRespawn: null as (() => void) | null,
    addFiles: vi.fn().mockImplementation(async (files: { name: string }[]) => files.map((f) => ({ name: f.name, width: 100, height: 100 }))),
    removeFiles: vi.fn().mockResolvedValue(null),
    roles: vi.fn().mockResolvedValue({ design: 'design.png', background: 'background.png', stickers: ['sticker.png'], ambiguous: false }),
    reset: vi.fn().mockResolvedValue(null),
    cuts: vi.fn().mockResolvedValue({ messages: [] }),
    init: vi.fn(),
  };
  class JobCancelledError extends Error {}
  return { engine, JobCancelledError };
});
vi.mock('../../web/src/platform/storage', () => ({
  saveFiles: vi.fn().mockResolvedValue(undefined),
  saveDoc: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue({ files: undefined, doc: undefined }),
  savePrefs: vi.fn(),
}));

import { engine } from '../../web/src/engine/engine';
import * as storage from '../../web/src/platform/storage';
import { store, busy } from '../../web/src/app/store';
import { addFiles, removeFile, setRole, newProject, restore } from '../../web/src/app/actions/files';
import { place } from '../../web/src/app/actions/placement';
import { flushSaves } from '../../web/src/app/actions/autosave';
import type { FileEntry, Role } from '../../web/src/app/store';

const bitmap = () => ({ width: 100, height: 100, close: vi.fn() }) as unknown as ImageBitmap;
function entry(name: string, role: Role): FileEntry {
  return { name, role, width: 100, height: 100, bytes: new Uint8Array([1]), bitmap: bitmap(), thumb: bitmap() };
}
const file = (name: string) => ({ name, type: name.endsWith('.png') ? 'image/png' : 'text/plain', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as File);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => bitmap()));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, clear: () => undefined });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 1; });
  vi.stubGlobal('window', globalThis);
  store.files.value = new Map([
    ['design.png', entry('design.png', 'design')],
    ['background.png', entry('background.png', 'background')],
    ['sticker.png', entry('sticker.png', 'sticker')],
  ]);
  store.doc.value = null;
  store.jobs.value = new Map();
  store.notice.value = null;
  store.rolesLocked.value = false;
  store.pageSetup.value = { widthMm: 80, heightMm: null };
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('dosya aksiyonları', () => {
  it('addFiles PNG’leri motora ekler, rolleri otomatik atar ve dosya kaydını yazar', async () => {
    store.files.value = new Map();
    await addFiles([file('design.png'), file('background.png'), file('sticker.png'), file('not.txt')]);
    expect(engine.addFiles).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'design.png' })]), expect.anything());
    expect([...store.files.value.values()].map((f) => f.role)).toEqual(['design', 'background', 'sticker']);
    expect(storage.saveFiles).toHaveBeenCalled();
    expect(busy.value).toBe(false);
  });

  it('kullanıcı rolü elle değiştirdiyse yeni dosyalar mevcut rolleri bozmaz', async () => {
    setRole('sticker.png', 'design');
    expect(store.files.value.get('design.png')!.role).toBe('ignore'); // tek tam tasarım olabilir
    expect(store.rolesLocked.value).toBe(true);
    vi.mocked(engine.roles).mockResolvedValueOnce({ design: 'design.png', background: 'background.png', stickers: ['sticker.png', 'yeni.png'], ambiguous: false });
    await addFiles([file('yeni.png')]);
    expect(store.files.value.get('sticker.png')!.role).toBe('design');
    expect(store.files.value.get('yeni.png')!.role).toBe('sticker');
  });

  it('removeFile belge yokken dosyayı motor ve mağazadan siler, bitmap’leri kapatır', async () => {
    const f = store.files.value.get('sticker.png')!;
    await removeFile('sticker.png');
    expect(engine.removeFiles).toHaveBeenCalledWith(['sticker.png']);
    expect(store.files.value.has('sticker.png')).toBe(false);
    expect(f.bitmap.close).toHaveBeenCalled();
  });

  it('place: tam tasarım yoksa uyarır, varsa motoru çağırıp belgeyi açar', async () => {
    store.files.value.get('design.png')!.role = 'ignore';
    expect(await place()).toBe(false);
    expect(engine.init).not.toHaveBeenCalled();
    store.files.value.get('design.png')!.role = 'design';
    const pack = {
      version: 2, page: { widthMm: 80, heightMm: 80 }, designSize: { widthPx: 100, heightPx: 100 },
      files: { design: 'design.png', background: 'background.png' }, defaults: {} as never,
      items: [{ id: 'i1', file: 'sticker.png', x: 50, y: 50, scale: 0.5, rotationDeg: 0, printOnly: false, needsReview: false, matchScore: 0.9, overrides: {} }],
    };
    vi.mocked(engine.init).mockResolvedValue({ pack, roles: { design: 'design.png', background: 'background.png', stickers: [], ambiguous: false }, unmatchedRegions: [], messages: [] } as never);
    expect(await place()).toBe(true);
    expect(store.doc.value?.items).toHaveLength(1);
    expect(engine.cuts).toHaveBeenCalled();
  });

  it('place: arka plan yoksa tek sayfa modunda çalışır ve üretilen arka planı mağazaya ekler', async () => {
    store.files.value = new Map([['sayfa.png', entry('sayfa.png', 'design')]]);
    const pack = {
      version: 2, page: { widthMm: 80, heightMm: 80 }, designSize: { widthPx: 100, heightPx: 100 },
      files: { design: 'sayfa.png', background: 'otomatik arka plan.png' }, defaults: {} as never, items: [],
    };
    vi.mocked(engine.init).mockResolvedValue({
      pack, roles: { design: 'sayfa.png', background: null, stickers: [], ambiguous: false, single: true }, unmatchedRegions: [],
      messages: [{ level: 'info', code: 'SINGLE_SHEET', text: '…' }],
      syntheticBackground: { name: 'otomatik arka plan.png', bytes: new Uint8Array([9]), width: 100, height: 100 },
    } as never);
    expect(await place()).toBe(true);
    expect(vi.mocked(engine.init).mock.calls.at(-1)![0]).toMatchObject({ design: 'sayfa.png', background: null });
    const bg = store.files.value.get('otomatik arka plan.png');
    expect(bg).toMatchObject({ role: 'background', width: 100, height: 100 });
    expect(store.files.value.get('sayfa.png')!.role).toBe('design');
    expect(store.doc.value?.files.background).toBe('otomatik arka plan.png');
    expect(storage.saveFiles).toHaveBeenCalled();
  });

  it('addFiles tek sayfa kestirimini kurulum ekranı için saklar', async () => {
    store.files.value = new Map();
    vi.mocked(engine.roles).mockResolvedValueOnce({
      design: 'sayfa.png', background: null, stickers: [], ambiguous: false, single: true,
      sheet: { kind: 'flat', rgb: [200, 220, 140], transparentRatio: 0, coverage: 0.7, edgeCoverage: 0.98 },
    });
    await addFiles([file('sayfa.png')]);
    expect(store.files.value.get('sayfa.png')!.role).toBe('design');
    expect(store.sheetHint.value).toMatchObject({ file: 'sayfa.png', kind: 'flat', rgb: [200, 220, 140] });
    expect(store.notice.value).toBeNull();
  });

  it('newProject bekleyen kaydı bitirir, depoyu temizler ve mağazayı sıfırlar', async () => {
    const f = store.files.value.get('design.png')!;
    await newProject();
    await flushSaves();
    expect(engine.reset).toHaveBeenCalled();
    expect(storage.clear).toHaveBeenCalled();
    expect(store.files.value.size).toBe(0);
    expect(store.doc.value).toBeNull();
    expect(f.bitmap.close).toHaveBeenCalled();
  });

  it('restore kayıtlı dosyaları ve belgeyi geri yükler', async () => {
    const packJson = JSON.stringify({
      version: 2, page: { widthMm: 80, heightMm: 80 }, designSize: { widthPx: 100, heightPx: 100 },
      files: { design: 'design.png', background: 'background.png' }, items: [],
    });
    vi.mocked(storage.load).mockResolvedValueOnce({
      files: { files: [{ name: 'design.png', bytes: new Uint8Array([1]), role: 'design' }, { name: 'background.png', bytes: new Uint8Array([1]), role: 'background' }] },
      doc: { packJson, page: { widthMm: 80, heightMm: 80 }, presetId: 'white', messages: [], dismissed: [], selection: [] },
    });
    store.files.value = new Map();
    await restore();
    expect(store.files.value.size).toBe(2);
    expect(store.doc.value?.page.heightMm).toBe(80);
    expect(store.presetId.value).toBe('white');
    expect(store.rolesLocked.value).toBe(true);
  });
});
