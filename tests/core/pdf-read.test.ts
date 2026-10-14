import { describe, it, expect } from 'vitest';
import {
  PDFDocument, PDFName, PDFString, PDFHexString, rgb, degrees,
  setStrokingRgbColor, moveTo, lineTo, closePath, stroke, drawObject, type PDFPage,
} from 'pdf-lib';
import { readPdfPaths, tokenizeContent, refToDesign, referenceForPack, type RefPage, type RefPath } from '../../src/core/pdf-read';
import { DEFAULT_SETTINGS, PT_PER_MM, type Pack } from '../../src/core/project';

type Content = string | Uint8Array;
interface PageSpec { content?: Content | Content[]; setup?: (doc: PDFDocument, page: PDFPage) => void; size?: [number, number] }

const bytes = (s: string) => new TextEncoder().encode(s);
/** Baytları karakter karakter taşıyan PDF literal string (ham UTF-8 başlık gibi). */
const rawString = (s: string) => PDFString.of(String.fromCharCode(...bytes(s)));
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

async function buildPdf(specs: PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const spec of specs) {
    const page = doc.addPage(spec.size ?? [200, 300]);
    spec.setup?.(doc, page);
    const chunks = spec.content === undefined ? [] : Array.isArray(spec.content) ? spec.content : [spec.content];
    const refs = chunks.map((c) => doc.context.register(doc.context.stream(c)));
    if (refs.length) page.node.set(PDFName.of('Contents'), refs.length === 1 ? refs[0] : doc.context.obj(refs));
  }
  return doc.save();
}
const readOne = async (content: PageSpec['content'], setup?: PageSpec['setup'], size?: [number, number]) => readPdfPaths(await buildPdf([{ content, setup, size }]));
const paths = async (...args: Parameters<typeof readOne>) => (await readOne(...args)).pages[0].paths;

const makePack = (widthMm: number, heightMm: number): Pack => ({
  version: 1, page: { widthMm, heightMm }, designSize: { widthPx: 800, heightPx: 1200 },
  files: { design: 'tasarim.png', background: 'arka.png' }, defaults: { ...DEFAULT_SETTINGS }, items: [],
});
const TRI = '10 10 m 50 10 l 50 50 l h S';
const closeTo = (p: { x: number; y: number }, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 3); expect(p.y).toBeCloseTo(y, 3); };

describe('tokenizeContent', () => {
  it('sayılar, adlar, sözlükler, diziler, yorumlar ve yıldızlı işleçler', () => {
    const tokens = tokenizeContent(bytes('6. -.5 +3 -0 /A#20B << /K [1 2] /S (x\\)y) >> [ (a(b)c) <41 42> ] % yorum\nW* f* T* BX'));
    expect(tokens).toEqual([
      { t: 'num', v: 6 }, { t: 'num', v: -0.5 }, { t: 'num', v: 3 }, { t: 'num', v: -0 }, { t: 'name', v: 'A B' }, { t: 'dict' },
      { t: 'arr', v: [{ t: 'str' }, { t: 'str' }] }, { t: 'op', v: 'W*' }, { t: 'op', v: 'f*' }, { t: 'op', v: 'T*' }, { t: 'op', v: 'BX' },
    ]);
  });

  it('satır içi görüntünün ikili verisini EI’ye kadar atlar', () => {
    const tokens = tokenizeContent(concat(bytes('BI /W 2 /H 2 ID '), new Uint8Array([0x31, 0x20, 0x6c, 0x20, 0x53, 0x0a]), bytes(' EI Q')));
    expect(tokens.filter((t) => t.t === 'op').map((t) => t.v)).toEqual(['BI', 'ID', 'EI', 'Q']);
  });
});

describe('readPdfPaths', () => {
  it('drawSvgPath ile yazılan yolu tutamaçlarıyla geri okur', async () => {
    const [p] = await paths(undefined, (_, page) => {
      page.drawSvgPath('M 10 10 C 20 0 40 0 50 10 L 50 50 Z', { x: 0, y: 300, borderColor: rgb(1, 0, 0), borderWidth: 1 });
    });
    expect(p.closed).toBe(true);
    expect(p.strokeRgb).toEqual([1, 0, 0]);
    expect(p.fillRgb).toBeNull();
    expect(p.role).toBe('cut');
    expect(p.confidence).toBe('high');
    expect(p.lineWidthPt).toBeCloseTo(1, 6);
    expect(p).toMatchObject({ anchors: 3, curves: 1, lines: 2 });
    closeTo(p.points[0], 10, 290);
    closeTo(p.points[0].handleOut!, 20, 300);
    expect(p.points[0].handleIn).toBeUndefined();
    closeTo(p.points[1], 50, 290);
    closeTo(p.points[1].handleIn!, 40, 300);
    expect(p.points[1].handleOut).toBeUndefined();
    closeTo(p.points[2], 50, 250);
  });

  it('Contents dizisi parça sınırında bölünse de tek yol okunur', async () => {
    const list = await paths(['1 0 0 RG 10 10 m 50 10 l', '50 50 l h S']);
    expect(list).toHaveLength(1);
    expect(list[0].points).toEqual([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }]);
    expect(list[0].closed).toBe(true);
  });

  it('sadece kırpma (re W n) yol üretmez', async () => {
    expect(await paths('0 300 200 -300 re W n')).toEqual([]);
  });

  it('metin ve dizgi işleçlerini yok sayar', async () => {
    const list = await paths(`BT /F1 12 Tf (a\\(b)c) Tj <414243> Tj [(x) -20 (y)] TJ ET 1 0 0 RG ${TRI}`);
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe('cut');
  });

  it('/Span << /MCID 0 >> BDC katman adı vermez ama yolu okur', async () => {
    const list = await paths(`/Span << /MCID 0 >> BDC 1 0 0 RG ${TRI} EMC`);
    expect(list).toHaveLength(1);
    expect(list[0].layer).toBeNull();
  });

  it('/Layer /MC0 BDC Properties başlığını (ham UTF-8) katman olarak verir', async () => {
    const doc = await readOne(`/Layer /MC0 BDC 1 0 0 RG ${TRI} EMC 10 10 m 20 20 l S`, (doc, page) => {
      page.node.Resources()!.set(PDFName.of('Properties'), doc.context.obj({ MC0: { Title: rawString('kesim çizgileri'), Visible: true } }));
    });
    expect(doc.pages[0].paths.map((p) => p.layer)).toEqual(['kesim çizgileri', null]);
    expect(doc.pages[0].layers).toEqual(['kesim çizgileri']);
  });

  it('/OC /oc1 BDC OCG adını (UTF-16) katman olarak verir', async () => {
    const doc = await readOne(`/OC /oc1 BDC 1 0 0 RG ${TRI} EMC`, (doc, page) => {
      const ocg = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText('Kesim') }));
      page.node.Resources()!.set(PDFName.of('Properties'), doc.context.obj({ oc1: ocg }));
    });
    expect(doc.pages[0].paths[0].layer).toBe('Kesim');
    expect(doc.pages[0].layers).toEqual(['Kesim']);
  });

  it('satır içi görüntüyü atlar', async () => {
    const content = concat(bytes('q 10 0 0 10 0 0 cm BI /W 2 /H 2 /CS /G /BPC 8 ID '), new Uint8Array([0x31, 0x20, 0x6c, 0x20, 0x53, 0x0a]), bytes(` EI Q 1 0 0 RG ${TRI}`));
    const list = await paths(content);
    expect(list).toHaveLength(1);
    expect(list[0].points[0]).toEqual({ x: 10, y: 10 });
  });

  it('v, y, re, s ve B işleçleri', async () => {
    const list = await paths([
      '1 0 0 RG',
      '10 10 m 40 0 50 10 v S',
      '10 10 m 20 0 50 10 y S',
      '10 10 100 50 re S',
      '10 10 m 50 10 l 50 50 l s',
      '1 1 1 rg 10 10 m 50 10 l 50 50 l B',
    ].join('\n'));
    expect(list).toHaveLength(5);
    expect(list[0].points).toEqual([{ x: 10, y: 10 }, { x: 50, y: 10, handleIn: { x: 40, y: 0 } }]);
    expect(list[0]).toMatchObject({ closed: false, curves: 1, lines: 0 });
    expect(list[1].points).toEqual([{ x: 10, y: 10, handleOut: { x: 20, y: 0 } }, { x: 50, y: 10 }]);
    expect(list[2].points).toEqual([{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }, { x: 10, y: 60 }]);
    expect(list[2]).toMatchObject({ closed: true, lines: 4, curves: 0 });
    expect(list[3]).toMatchObject({ closed: true, strokeRgb: [1, 0, 0], fillRgb: null });
    expect(list[4]).toMatchObject({ strokeRgb: [1, 0, 0], fillRgb: [1, 1, 1], role: 'cut' });
  });

  it('kapanış eğrisi başlangıca dönen yinelenen noktayı birleştirir', async () => {
    const [p] = await paths('1 0 0 RG 0 0 m 10 0 l 10 10 l 5 15 0 10 0 0 c h S');
    expect(p.anchors).toBe(3);
    expect(p.points[0]).toEqual({ x: 0, y: 0, handleIn: { x: 0, y: 10 } });
    expect(p.points[2]).toEqual({ x: 10, y: 10, handleOut: { x: 5, y: 15 } });
    expect(p).toMatchObject({ closed: true, curves: 1, lines: 2 });
  });

  it('iç içe q … cm … Q dönüşümleri', async () => {
    const list = await paths('1 0 0 RG q 1 0 0 1 100 100 cm q 2 0 0 2 0 0 cm 0 0 m 10 0 l 10 10 l h S Q 0 0 m 5 0 l 5 5 l h S Q 0 0 m 1 0 l 1 1 l h S');
    expect(list.map((p) => p.points)).toEqual([
      [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 120 }],
      [{ x: 100, y: 100 }, { x: 105, y: 100 }, { x: 105, y: 105 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    ]);
  });

  it('çizgi kalınlığı CTM ölçeğiyle, CMYK ve gri renkler', async () => {
    const list = await paths(`2.5 w 0 1 1 0 K ${TRI} q 2 0 0 2 0 0 cm 1 w 0.3 G ${TRI} Q`);
    expect(list[0].lineWidthPt).toBeCloseTo(2.5, 6);
    expect(list[0].strokeRgb).toEqual([1, 0, 0]);
    expect(list[0].role).toBe('cut');
    expect(list[1].lineWidthPt).toBeCloseTo(2, 6);
    expect(list[1].strokeRgb!.map((v) => Math.round(v * 10) / 10)).toEqual([0.3, 0.3, 0.3]);
    expect(list[1].role).toBe('other');
  });

  it('ICCBased N=3 ile /CS0 CS 1 0 0 SCN kırmızı kesim sayılır', async () => {
    const [p] = await paths(`/CS0 CS 1 0 0 SCN ${TRI}`, (doc, page) => {
      const icc = doc.context.register(doc.context.stream(new Uint8Array(), { N: 3 }));
      page.node.Resources()!.set(PDFName.of('ColorSpace'), doc.context.obj({ CS0: ['ICCBased', icc] }));
    });
    expect(p.strokeRgb).toEqual([1, 0, 0]);
    expect(p.spotName).toBeNull();
    expect(p).toMatchObject({ role: 'cut', confidence: 'high' });
  });

  it('CutContour adlı Separation: spotName ve kesim rolü', async () => {
    const list = await paths(`/CS1 CS 1 SCN ${TRI} 0.5 SCN ${TRI}`, (doc, page) => {
      page.node.Resources()!.set(PDFName.of('ColorSpace'), doc.context.obj({
        CS1: ['Separation', 'CutContour', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 1, 1, 0], N: 1 }],
      }));
    });
    expect(list[0].spotName).toBe('CutContour');
    expect(list[0].strokeRgb).toEqual([1, 0, 0]);
    expect(list[0].role).toBe('cut');
    expect(list[1].strokeRgb).toEqual([1, 0.5, 0.5]);
    expect(list[1].role).toBe('cut'); // ad eşleşmesi tona bakmaz
  });

  it('Form XObject Matrix [2 0 0 2 5 5] ile iner', async () => {
    const [p] = await paths(undefined, (doc, page) => {
      const form = doc.context.formXObject(
        [setStrokingRgbColor(1, 0, 0), moveTo(0, 0), lineTo(10, 0), lineTo(10, 10), closePath(), stroke()],
        { BBox: [0, 0, 100, 100], Matrix: [2, 0, 0, 2, 5, 5] },
      );
      page.pushOperators(drawObject(page.node.newXObject('Form', doc.context.register(form))));
    });
    expect(p.points).toEqual([{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 25 }]);
    expect(p.role).toBe('cut');
  });

  it('descendForms: false form içeriğini atlar', async () => {
    const pdf = await buildPdf([{ setup: (doc, page) => {
      const form = doc.context.formXObject([moveTo(0, 0), lineTo(10, 0), lineTo(10, 10), stroke()]);
      page.pushOperators(drawObject(page.node.newXObject('Form', doc.context.register(form))));
    } }]);
    expect((await readPdfPaths(pdf, { descendForms: false })).pages[0].paths).toEqual([]);
    expect((await readPdfPaths(pdf)).pages[0].paths).toHaveLength(1);
  });

  it('kırmızı yoksa gri konturlar düşük güvenle kesim olur ve REF_NO_RED uyarır', async () => {
    const doc = await readOne(`0.3 G ${TRI} 1 1 1 rg 0 0 50 50 re f`);
    expect(doc.pages[0].paths[0]).toMatchObject({ role: 'cut', confidence: 'low' });
    expect(doc.pages[0].paths[1]).toMatchObject({ role: 'border', confidence: 'high' });
    expect(doc.messages.map((m) => m.code)).toEqual(['REF_NO_RED']);
    expect(doc.messages[0].text).toBe('Referansta kırmızı kesim çizgisi yok; gri/siyah konturlar kesim olarak alındı.');
  });

  it('iki sayfalı belgede kırmızı 1. sayfadaysa cutPage 0, gri çizgiler terfi etmez', async () => {
    const doc = await readPdfPaths(await buildPdf([{ content: `1 0 0 RG ${TRI}` }, { content: `0 G ${TRI} ${TRI}` }]));
    expect(doc.pages).toHaveLength(2);
    expect(doc.cutPage).toBe(0);
    expect(doc.pages[1].paths.every((p) => p.role === 'other')).toBe(true);
    expect(doc.messages).toEqual([]);
    const forced = await readPdfPaths(await buildPdf([{ content: `1 0 0 RG ${TRI}` }, { content: `0 G ${TRI}` }]), { cutPage: 1 });
    expect(forced.cutPage).toBe(1);
  });

  it('en çok kesim yolu olan sayfa seçilir, eşitlikte sonuncusu', async () => {
    const doc = await readPdfPaths(await buildPdf([{ content: `1 0 0 RG ${TRI}` }, { content: `1 0 0 RG ${TRI} ${TRI}` }]));
    expect(doc.cutPage).toBe(1);
    const tie = await readPdfPaths(await buildPdf([{ content: `1 0 0 RG ${TRI}` }, { content: `1 0 0 RG ${TRI}` }]));
    expect(tie.cutPage).toBe(1);
  });

  it('/Rotate 90 ve kaydırılmış MediaBox sayfa koordinatlarına uygulanır', async () => {
    const rotated = await readOne(`1 0 0 RG ${TRI}`, (_, page) => page.setRotation(degrees(90)));
    expect(rotated.pages[0]).toMatchObject({ widthPt: 300, heightPt: 200, rotate: 90 });
    expect(rotated.pages[0].paths[0].points).toEqual([{ x: 10, y: 190 }, { x: 10, y: 150 }, { x: 50, y: 150 }]);
    const offset = await readOne(`1 0 0 RG ${TRI}`, (_, page) => page.setMediaBox(10, 20, 200, 300));
    expect(offset.pages[0]).toMatchObject({ widthPt: 200, heightPt: 300 });
    expect(offset.pages[0].paths[0].points[0]).toEqual({ x: 0, y: -10 });
  });

  it('desteklenmeyen filtre uyarı verir ve o akışı atlar', async () => {
    const pdf = await buildPdf([{ setup: (doc, page) => {
      page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(`1 0 0 RG ${TRI}`, { Filter: 'DCTDecode' })));
    } }]);
    const doc = await readPdfPaths(pdf);
    expect(doc.pages[0].paths).toEqual([]);
    expect(doc.messages.map((m) => m.code)).toEqual(['REF_UNSUPPORTED_FILTER']);
  });

  it('şifreli belge REF_ENCRYPTED ile boş döner', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }));
    const result = await readPdfPaths(await doc.save());
    expect(result.pages).toEqual([]);
    expect(result.messages).toEqual([{ level: 'error', code: 'REF_ENCRYPTED', text: 'Referans PDF şifreli; kesim çizgileri okunamadı.' }]);
  });

  it('pages seçeneği yalnızca istenen sayfaları okur', async () => {
    const doc = await readPdfPaths(await buildPdf([{ content: `1 0 0 RG ${TRI}` }, { content: `1 0 0 RG ${TRI}` }]), { pages: [1] });
    expect(doc.pages.map((p) => p.index)).toEqual([1]);
    expect(doc.cutPage).toBe(1);
  });
});

describe('refToDesign / referenceForPack', () => {
  const page: RefPage = { index: 0, widthPt: 200, heightPt: 300, rotate: 0, paths: [], layers: [] };
  const refPath = (points: RefPath['points']): RefPath => ({
    points, closed: true, strokeRgb: [1, 0, 0], fillRgb: null, spotName: null, lineWidthPt: 1, layer: null,
    anchors: points.length, curves: 0, lines: points.length, role: 'cut', confidence: 'high',
  });

  it('refToDesign sayfa köşelerini tasarım köşelerine götürür', () => {
    const out = refToDesign(refPath([{ x: 0, y: 300 }, { x: 200, y: 0, handleIn: { x: 100, y: 150 } }]), page, makePack(80, 120));
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 800, y: 1200, handleIn: { x: 400, y: 600 } }]);
  });

  it('referenceForPack kesim ve kenarları tasarım px olarak verir, boyut farkında uyarır', async () => {
    const W = 80 * PT_PER_MM, H = 120 * PT_PER_MM;
    const doc = await readPdfPaths(await buildPdf([{
      size: [W, H],
      content: `1 1 1 rg 0 0 ${W} ${H} re f 10 10 20 20 re f 1 0 0 RG 0 ${H} m ${W} 0 l S`,
    }]));
    const ref = referenceForPack(doc, makePack(80, 120));
    expect(ref.messages).toEqual([]);
    expect(ref.pageMm.w).toBeCloseTo(80, 6);
    expect(ref.pageMm.h).toBeCloseTo(120, 6);
    expect(ref.cuts).toHaveLength(1);
    closeTo(ref.cuts[0][0], 0, 0);
    closeTo(ref.cuts[0][1], 800, 1200);
    expect(ref.borders).toHaveLength(1); // sayfa boyu beyaz zemin kenar sayılmaz
    const mismatch = referenceForPack(doc, makePack(100, 150));
    expect(mismatch.messages.map((m) => m.code)).toEqual(['REF_PAGE_SIZE']);
    expect(mismatch.messages[0].level).toBe('warning');
    expect(mismatch.messages[0].text).toMatch(/80 × 120 mm/);
    expect(mismatch.messages[0].text).toMatch(/100 × 150 mm/);
  });

  it('boş belge için boş sonuç', () => {
    expect(referenceForPack({ pages: [], cutPage: 0, messages: [] }, makePack(80, 120))).toEqual({ cuts: [], borders: [], pageMm: { w: 0, h: 0 }, messages: [] });
  });
});
