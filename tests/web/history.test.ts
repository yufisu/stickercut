import { describe, expect, it } from 'vitest';
import { parsePack } from '../../src/core/project';
import { EditHistory } from '../../web/src/history';

const makePack = () => parsePack(JSON.stringify({
  version: 1,
  page: { widthMm: 80, heightMm: 120 },
  designSize: { widthPx: 800, heightPx: 1200 },
  files: { design: 'pack.png', background: 'background.png' },
  items: [{ id: 'i1', file: 'sticker.png', x: 100, y: 200, scale: 1 }],
}));

describe('EditHistory', () => {
  it('taşıma ve silme adımlarını geri alıp yeniden uygular', () => {
    const pack = makePack();
    const history = new EditHistory();
    history.reset(pack, 'i1');
    pack.items[0].x = 150;
    history.record(pack, 'i1');
    pack.items = [];
    history.record(pack, null);

    const restored = history.undo();
    expect(restored?.pack.items[0].x).toBe(150);
    expect(restored?.selectedId).toBe('i1');
    expect(history.undo()?.pack.items[0].x).toBe(100);
    expect(history.redo()?.pack.items[0].x).toBe(150);
    expect(history.redo()?.pack.items).toHaveLength(0);
  });

  it('aynı alandaki ardışık girişleri tek geri alma adımına toplar', () => {
    const pack = makePack();
    const history = new EditHistory();
    history.reset(pack);
    history.beginGroup();
    for (const widthMm of [8, 85, 87]) {
      pack.page.widthMm = widthMm;
      history.record(pack, null);
    }
    history.endGroup();
    expect(history.undo()?.pack.page.widthMm).toBe(80);
    expect(history.canUndo).toBe(false);
  });

  it('geri almadan sonra yeni düzenleme yapılırsa ileri alma geçmişini bırakır', () => {
    const pack = makePack();
    const history = new EditHistory();
    history.reset(pack);
    pack.items[0].x = 150;
    history.record(pack, null);
    const previous = history.undo()!;
    previous.pack.items[0].y = 250;
    history.record(previous.pack, null);
    expect(history.canRedo).toBe(false);
    expect(history.undo()?.pack.items[0]).toMatchObject({ x: 100, y: 200 });
  });
});
