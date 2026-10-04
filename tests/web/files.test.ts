import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../web/src/engine', () => ({ engine: {
  removeFiles: vi.fn().mockResolvedValue(null),
  reset: vi.fn().mockResolvedValue(null),
  addFiles: vi.fn().mockImplementation(async (files: { name: string }[]) =>
    files.map((f) => ({ name: f.name, width: 100, height: 100 }))),
  roles: vi.fn().mockResolvedValue({ design: null, background: null, stickers: ['sticker.png'] }),
} }));
vi.mock('../../web/src/storage', () => ({
  save: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  load: vi.fn(),
}));

import { engine } from '../../web/src/engine';
import * as storage from '../../web/src/storage';
import { state, type FileEntry, type Role } from '../../web/src/state';
import { addFiles, newProject, removeFile, restore, scheduleAutosave } from '../../web/src/project-io';

function entry(name: string, role: Role): FileEntry {
  return { name, role, width: 100, height: 100, bytes: new Uint8Array([1]),
    bitmap: { width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => entry('', 'ignore').bitmap));
  state.files = new Map([
    ['design.png', entry('design.png', 'design')],
    ['background.png', entry('background.png', 'background')],
    ['sticker.png', entry('sticker.png', 'sticker')],
  ]);
  state.screen = 'files'; state.pack = null; state.busy = null;
  state.messages = [{ level: 'warning', code: 'ROLES', text: 'Eski uyarı' }];
  state.page = { widthMm: 80, heightMm: null };
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dosya seçimini düzeltme', () => {
  it('yanlış dosyayı motordan, listeden ve otomatik kayıttan kaldırır; diğer rolleri korur', async () => {
    const removed = state.files.get('design.png')!;
    await removeFile(removed.name);
    expect(engine.removeFiles).toHaveBeenCalledWith(['design.png']);
    expect(removed.bitmap.close).toHaveBeenCalledOnce();
    expect([...state.files.values()].map((f) => [f.name, f.role])).toEqual([
      ['background.png', 'background'], ['sticker.png', 'sticker'],
    ]);
    expect(state.messages).toEqual([]);
    await vi.runAllTimersAsync();
    const saved = vi.mocked(storage.save).mock.calls.at(-1)![0];
    expect(saved.files.map((f) => f.name)).toEqual(['background.png', 'sticker.png']);
    vi.mocked(storage.load).mockResolvedValueOnce(saved);
    state.files.clear();
    await restore();
    expect(state.files.has('design.png')).toBe(false);
  });

  it('son dosyayı da kaldırıp boş seçimi kaydeder', async () => {
    for (const name of [...state.files.keys()]) await removeFile(name);
    await vi.runAllTimersAsync();
    expect(state.files.size).toBe(0);
    expect(vi.mocked(storage.save).mock.calls.at(-1)![0].files).toEqual([]);
  });

  it('yerleştirme gerektirmeden sıfırlar ve bekleyen kaydın eski dosyaları geri yazmasını önler', async () => {
    const oldFiles = [...state.files.values()];
    state.page = { widthMm: 120, heightMm: 180 };
    state.selectedId = 'old-item';
    scheduleAutosave();
    await newProject();
    await vi.runAllTimersAsync();
    expect(engine.reset).toHaveBeenCalledOnce();
    expect(storage.clear).toHaveBeenCalledOnce();
    expect(storage.save).not.toHaveBeenCalled();
    for (const f of oldFiles) expect(f.bitmap.close).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ screen: 'files', pack: null, selectedId: null, messages: [],
      busy: null, page: { widthMm: 80, heightMm: null } });
    expect(state.files.size).toBe(0);
  });

  it('devam eden otomatik kaydı bitirdikten sonra siler', async () => {
    let finishSave!: () => void;
    vi.mocked(storage.save).mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(500);
    const reset = newProject();
    await Promise.resolve();
    expect(storage.clear).not.toHaveBeenCalled();
    finishSave();
    await reset;
    expect(storage.clear).toHaveBeenCalledOnce();
    expect(state.files.size).toBe(0);
  });

  it('işlem sürerken dosya ekleme, kaldırma veya sıfırlamayı başlatmaz', async () => {
    state.busy = 'Dosyalar okunuyor…';
    await removeFile('design.png');
    await newProject();
    await addFiles([]);
    expect(engine.removeFiles).not.toHaveBeenCalled();
    expect(engine.reset).not.toHaveBeenCalled();
    expect(engine.addFiles).not.toHaveBeenCalled();
    expect(state.files.size).toBe(3);
  });

  it('kaldırma başarısızsa dosyayı tutar ve tekrar denemeye izin verir', async () => {
    vi.mocked(engine.removeFiles).mockRejectedValueOnce(new Error('Kaldırılamadı'));
    const file = state.files.get('sticker.png')!;
    await removeFile(file.name);
    expect(state.files.get(file.name)).toBe(file);
    expect(file.bitmap.close).not.toHaveBeenCalled();
    expect(state.busy).toBeNull();
    expect(state.messages[0].text).toBe('Kaldırılamadı');
    await removeFile(file.name);
    expect(state.files.has(file.name)).toBe(false);
  });

  it('aynı isimli dosyayı yeniden seçerken eski önizleme kaynağını serbest bırakır', async () => {
    const previous = state.files.get('sticker.png')!;
    await addFiles([new File([new Uint8Array([2])], 'sticker.png', { type: 'image/png' })]);
    expect(previous.bitmap.close).toHaveBeenCalledOnce();
    expect(state.files.get('sticker.png')?.bytes).toEqual(new Uint8Array([2]));
  });
});
