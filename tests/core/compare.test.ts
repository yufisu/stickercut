import { describe, it, expect } from 'vitest';
import { comparePaths, pathStats, pathDistance } from '../../src/core/compare';
import { readPdfPaths, referenceForPack } from '../../src/core/pdf-read';
import { transformPoints, type Pt } from '../../src/core/geometry';
import { DEFAULT_SETTINGS, type Pack } from '../../src/core/project';
import { initPack, buildPackPdf, computeCuts, prepareLoadedFile } from '../../src/core/pipeline';
import { encodePng } from '../../src/cli/png';
import { makeScene } from '../helpers/scene';

// 80 × 120 mm sayfa, 800 × 1200 px tasarım → 0.1 mm/px.
function makePack(ids: string[]): Pack {
  return {
    version: 2,
    page: { widthMm: 80, heightMm: 120 },
    designSize: { widthPx: 800, heightPx: 1200 },
    files: { design: 'tasarim.png', background: 'arka.png' },
    defaults: { ...DEFAULT_SETTINGS },
    items: ids.map((id, i) => ({
      id, file: `s${i + 1}.png`, x: 0, y: 0, scale: 1, rotationDeg: 0,
      printOnly: false, needsReview: false, matchScore: null, overrides: {},
    })),
  };
}

const K = 0.5522847498;
/** Dört kübik yaydan saat yönünde daire (y aşağı). */
function circle(cx: number, cy: number, r: number): Pt[] {
  const arcs: [number, number, number, number][] = [[cx + r, cy, 0, 1], [cx, cy + r, -1, 0], [cx - r, cy, 0, -1], [cx, cy - r, 1, 0]];
  return arcs.map(([x, y, tx, ty]) => ({
    x, y, handleIn: { x: x - tx * K * r, y: y - ty * K * r }, handleOut: { x: x + tx * K * r, y: y + ty * K * r },
  }));
}
const square = (x: number, y: number, w: number, h: number): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const cuts = (entries: [string, Pt[]][]) => new Map(entries);

describe('pathStats', () => {
  it('daire ve karenin uzunluk, alan, köşe sayılarını mm cinsinden verir', () => {
    const c = pathStats(circle(20, 30, 10));
    expect(c.anchors).toBe(4);
    expect(c.curves).toBe(4);
    expect(c.lines).toBe(0);
    expect(c.lengthMm).toBeCloseTo(2 * Math.PI * 10, 0);
    expect(c.areaMm2).toBeCloseTo(Math.PI * 100, 0);
    expect(c.bboxMm.minX).toBeCloseTo(10, 2);
    expect(c.bboxMm.maxY).toBeCloseTo(40, 2);
    const s = pathStats(square(0, 0, 10, 10));
    expect(s).toMatchObject({ anchors: 4, curves: 0, lines: 4, lengthMm: 40, areaMm2: 100, bboxMm: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
  });
});

describe('pathDistance', () => {
  it('özdeş yollar sıfır, 1 mm kaymış kare Hausdorff 1 mm', () => {
    const a = square(0, 0, 10, 10);
    const same = pathDistance(a, square(0, 0, 10, 10));
    expect(same.meanMm).toBeCloseTo(0, 6);
    expect(same.hausdorffMm).toBeCloseTo(0, 6);
    const shifted = pathDistance(a, square(1, 0, 10, 10));
    expect(shifted.hausdorffMm).toBeCloseTo(1, 2);
    expect(shifted.meanMm).toBeGreaterThan(0.4);
    expect(shifted.meanMm).toBeLessThan(0.6);
  });

  it('dışarı şişirilmiş daire pozitif işaretli ortalama verir', () => {
    const { signedMeanMm, meanMm } = pathDistance(circle(20, 30, 10.3), circle(20, 30, 10));
    expect(meanMm).toBeCloseTo(0.3, 1);
    expect(signedMeanMm).toBeCloseTo(0.3, 1);
    expect(pathDistance(circle(20, 30, 9.7), circle(20, 30, 10)).signedMeanMm).toBeCloseTo(-0.3, 1);
  });
});

describe('comparePaths', () => {
  it('özdeş yollar eşleşiyor, sapma 0', () => {
    const pack = makePack(['i1']);
    const result = comparePaths(pack, cuts([['i1', circle(200, 300, 100)]]), [circle(200, 300, 100)]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ itemId: 'i1', file: 's1.png', ref: 0, verdict: 'eşleşiyor' });
    expect(result.items[0].meanMm).toBeCloseTo(0, 6);
    expect(result.items[0].hausdorffMm).toBeCloseTo(0, 6);
    expect(result.items[0].tool.lengthMm).toBeCloseTo(2 * Math.PI * 10, 0);
    expect(result.items[0].refStats?.areaMm2).toBeCloseTo(Math.PI * 100, 0);
    expect(result.summary).toMatchObject({ items: 1, matched: 1, deviating: 0, missing: 0, extraRefs: 0, suggestedOffsetMm: null });
    expect(result.unmatchedRefs).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it('0.3 mm şişirilmiş daire: ortalama ≈ 0.3, işaretli +0.3, önerilen offset −0.3', () => {
    const pack = makePack(['i1']);
    const result = comparePaths(pack, cuts([['i1', circle(200, 300, 103)]]), [circle(200, 300, 100)]);
    const item = result.items[0];
    expect(item.verdict).toBe('sapıyor');
    expect(item.meanMm).toBeCloseTo(0.3, 1);
    expect(item.signedMeanMm).toBeCloseTo(0.3, 1);
    expect(result.summary.suggestedOffsetMm).toBeCloseTo(-0.3, 1);
    expect(result.messages.map((m) => m.code)).toEqual(['REF_DEVIATION', 'REF_OFFSET_HINT']);
    expect(result.messages[1].text).toMatch(/0\.3 mm/);
  });

  it('2 mm kaymış yol sapıyor ve REF_DEVIATION üretir', () => {
    const pack = makePack(['i1']);
    const result = comparePaths(pack, cuts([['i1', circle(220, 300, 100)]]), [circle(200, 300, 100)]);
    expect(result.items[0].verdict).toBe('sapıyor');
    expect(result.items[0].hausdorffMm).toBeCloseTo(2, 1);
    expect(result.summary.deviating).toBe(1);
    const warn = result.messages.find((m) => m.code === 'REF_DEVIATION');
    expect(warn).toMatchObject({ level: 'warning', itemId: 'i1', file: 's1.png' });
    expect(warn!.text).toMatch(/i1 kesim çizgisi referanstan sapıyor/);
  });

  it('fazladan referans yolu unmatchedRefs ve REF_EXTRA olarak bildirilir', () => {
    const pack = makePack(['i1']);
    const result = comparePaths(pack, cuts([['i1', circle(200, 300, 100)]]), [circle(200, 300, 100), circle(600, 900, 80)]);
    expect(result.items[0].verdict).toBe('eşleşiyor');
    expect(result.unmatchedRefs).toHaveLength(1);
    expect(result.unmatchedRefs[0].index).toBe(1);
    expect(result.unmatchedRefs[0].stats.areaMm2).toBeCloseTo(Math.PI * 64, 0);
    expect(result.summary.extraRefs).toBe(1);
    expect(result.messages).toEqual([{ level: 'info', code: 'REF_EXTRA', text: 'Referansta aracın üretmediği 1 kesim yolu var.' }]);
  });

  it('referansı olmayan öğe eşleşme yok ve REF_MISSING', () => {
    const pack = makePack(['i1', 'i2']);
    const result = comparePaths(pack, cuts([['i1', circle(200, 300, 100)], ['i2', circle(600, 900, 100)]]), [circle(200, 300, 100)]);
    const missing = result.items.find((i) => i.itemId === 'i2')!;
    expect(missing).toMatchObject({ verdict: 'eşleşme yok', ref: null, meanMm: null, hausdorffMm: null, signedMeanMm: null, refStats: null });
    expect(result.summary).toMatchObject({ items: 2, matched: 1, missing: 1 });
    expect(result.messages).toEqual([{ level: 'warning', code: 'REF_MISSING', itemId: 'i2', file: 's2.png', text: 'i2 kesim çizgisinin referansta karşılığı yok.' }]);
  });

  it('açgözlü eşleme en yakın referansı seçer, sıraya bakmaz', () => {
    const pack = makePack(['i1', 'i2']);
    const refs = [circle(600, 300, 100), circle(205, 300, 100), circle(200, 300, 100)];
    const result = comparePaths(pack, cuts([['i1', circle(200, 300, 100)], ['i2', circle(600, 300, 100)]]), refs);
    expect(result.items.find((i) => i.itemId === 'i1')!.ref).toBe(2);
    expect(result.items.find((i) => i.itemId === 'i2')!.ref).toBe(0);
    expect(result.unmatchedRefs.map((r) => r.index)).toEqual([1]);
  });

  it('stickercut’ın kendi PDF çıktısı referans alınınca her öğe eşleşir, beyaz kenarlar kenar olur', async () => {
    const s = makeScene();
    const file = (name: string, r: Parameters<typeof encodePng>[0]) => prepareLoadedFile(name, encodePng(r), r);
    const files = [file('tasarim.png', s.design), file('arka.png', s.background), ...s.stickers.map((st) => file(st.file, st.raster))];
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.defaults.whiteBorder = true;
    pack!.defaults.offsetMm = 1;
    const map = new Map(files.map((f) => [f.name, f]));
    const { pdf } = await buildPackPdf(pack!, map);
    const doc = await readPdfPaths(pdf!);
    expect(doc.cutPage).toBe(1);
    const ref = referenceForPack(doc, pack!);
    expect(ref.messages).toEqual([]);
    const { cuts } = computeCuts(pack!, map);
    expect(ref.cuts).toHaveLength(cuts.size);
    expect(ref.borders).toHaveLength(cuts.size);
    const result = comparePaths(pack!, cuts, ref.cuts);
    expect(result.items.map((i) => i.verdict)).toEqual(Array(cuts.size).fill('eşleşiyor'));
    expect(result.summary.maxHausdorffMm).toBeLessThan(0.05);
    expect(result.unmatchedRefs).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it('mm dönüşümü sayfa ölçeğini kullanır', () => {
    const pack = makePack(['i1']);
    pack.page = { widthMm: 160, heightMm: 240 }; // 0.2 mm/px
    const tool = circle(200, 300, 101), ref = circle(200, 300, 100);
    const result = comparePaths(pack, cuts([['i1', tool]]), [ref]);
    expect(result.items[0].meanMm).toBeCloseTo(0.2, 1);
    expect(result.items[0].tool.bboxMm.minX).toBeCloseTo(19.8, 6);
    expect(result.items[0].tool.bboxMm.maxX).toBeCloseTo(60.2, 6);
    expect(pathStats(transformPoints([0.2, 0, 0, 0.2, 0, 0], ref)).lengthMm).toBeCloseTo(2 * Math.PI * 20, 0);
  });
});
