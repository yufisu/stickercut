import { describe, expect, it, vi } from 'vitest';
import { parsePack } from '../../src/core/project';
import { EditHistory } from '../../web/src/app/history';

const makePack = () => parsePack(JSON.stringify({
  version: 2,
  page: { widthMm: 80, heightMm: 120 },
  designSize: { widthPx: 800, heightPx: 1200 },
  files: { design: 'pack.png', background: 'background.png' },
  items: [{ id: 'i1', file: 'sticker.png', x: 100, y: 200, scale: 1 }],
}));

describe('EditHistory', () => {
  it('taşıma ve silme adımlarını geri alıp yeniden uygular, seçimi geri getirir', () => {
    const pack = makePack();
    const history = new EditHistory();
    history.reset(pack, ['i1']);
    pack.items[0].x = 150;
    history.record(pack, ['i1']);
    pack.items = [];
    history.record(pack, []);

    const restored = history.undo();
    expect(restored?.pack.items[0].x).toBe(150);
    expect(restored?.selection).toEqual(['i1']);
    expect(history.undo()?.pack.items[0].x).toBe(100);
    expect(history.redo()?.pack.items[0].x).toBe(150);
    expect(history.redo()?.pack.items).toHaveLength(0);
  });

  it('gruplanmış ardışık girişleri tek geri alma adımına toplar', () => {
    const pack = makePack();
    const history = new EditHistory();
    history.reset(pack);
    history.beginGroup();
    for (const widthMm of [8, 85, 87]) {
      pack.page.widthMm = widthMm;
      history.record(pack, []);
    }
    history.endGroup();
    expect(history.undo()?.pack.page.widthMm).toBe(80);
    expect(history.canUndo).toBe(false);
  });

  it('aynı anahtarla 600 ms içinde gelen değişiklikleri (ok tuşuyla itme) birleştirir', () => {
    vi.useFakeTimers();
    const pack = makePack();
    const history = new EditHistory();
    history.reset(pack);
    for (const x of [101, 102, 103]) { pack.items[0].x = x; history.record(pack, ['i1'], 'nudge'); vi.advanceTimersByTime(100); }
    expect(history.undo()?.pack.items[0].x).toBe(100);
    expect(history.canUndo).toBe(false);
    history.redo();
    vi.advanceTimersByTime(1000);
    pack.items[0].x = 110;
    history.record(pack, ['i1'], 'nudge'); // 600 ms geçti: yeni adım
    expect(history.undo()?.pack.items[0].x).toBe(103);
    vi.useRealTimers();
  });

  it('geri almadan sonra yeni düzenleme yapılırsa ileri alma geçmişini bırakır', () => {
    const pack = makePack();
    const history = new EditHistory();
    history.reset(pack);
    pack.items[0].x = 150;
    history.record(pack, []);
    const previous = history.undo()!;
    previous.pack.items[0].y = 250;
    history.record(previous.pack, []);
    expect(history.canRedo).toBe(false);
    expect(history.undo()?.pack.items[0]).toMatchObject({ x: 100, y: 200 });
  });
});
