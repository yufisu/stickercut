import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFHexString, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { initPack, computeCuts, buildPackPdf, prepareLoadedFile, type LoadedFile } from '../../src/core/pipeline';
import { buildPdf, type BuildPdfOptions } from '../../src/core/pdf';
import { encodePng } from '../../src/cli/png';
import { makeScene } from '../helpers/scene';

function sceneFiles(): LoadedFile[] {
  const s = makeScene();
  const f = (name: string, r: Parameters<typeof encodePng>[0]) => prepareLoadedFile(name, encodePng(r), r);
  return [f('tasarim.png', s.design), f('arka.png', s.background), ...s.stickers.map((st) => f(st.file, st.raster))];
}

function pageContent(doc: PDFDocument, i: number): string {
  const c = doc.getPage(i).node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n');
}

describe('buildPackPdf', () => {
  it('2 sayfa, doğru mm boyutu, her kesilen öğe için bir kırmızı yol', async () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].printOnly = true;
    const { pdf, messages } = await buildPackPdf(pack!, new Map(files.map((f) => [f.name, f])));
    expect(messages.filter((m) => m.level === 'error')).toEqual([]);
    const doc = await PDFDocument.load(pdf!);
    expect(doc.getPageCount()).toBe(2);
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect(w).toBeCloseTo(226.772, 2);
    expect(h).toBeCloseTo(340.157, 2);
    expect(doc.getPage(1).getTrimBox()).toMatchObject({ width: w, height: h });

    const cut = pageContent(doc, 1);
    expect(cut.match(/\bh\b/g)).toHaveLength(3); // printOnly hariç 3 kapalı yol
    expect(cut).toMatch(/1 0 0 RG/);
    expect(cut).not.toMatch(/\bf\b/);
    expect(cut).toMatch(/\bc\b/); // Simplify eğrileri PDF'de gerçek Bézier olarak kalır.

    const xobj = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const refs = new Set(xobj.values().map((v) => v.toString()));
    expect(refs.size).toBe(4); // arka plan + 3 benzersiz sticker (cay iki kez ama bir kez gömülü)
  });

  it('beyaz kenar açıksa 1. sayfaya beyaz dolgu ekler', async () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.defaults.whiteBorder = true;
    pack!.defaults.offsetMm = 1;
    const { pdf } = await buildPackPdf(pack!, new Map(files.map((f) => [f.name, f])));
    const print = pageContent(await PDFDocument.load(pdf!), 0);
    expect(print).toMatch(/1 1 1 rg/);
    expect(print.match(/\bf\b/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('hata varsa PDF üretmez', async () => {
    const files = sceneFiles();
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].file = 'yok.png';
    const { pdf, messages } = await buildPackPdf(pack!, new Map(files.map((f) => [f.name, f])));
    expect(pdf).toBeNull();
    expect(messages.some((m) => m.code === 'MISSING_FILE')).toBe(true);
  });

  it('tam opak sticker için PDF kesim sayfasına kapalı yol ekler', async () => {
    const files = sceneFiles();
    const opaque = { width: 20, height: 30, data: new Uint8ClampedArray(20 * 30 * 4).fill(255) };
    files.push(prepareLoadedFile('opak.png', encodePng(opaque), opaque));
    const { pack } = initPack(files, { page: { widthMm: 80 } });
    pack!.items[0].file = 'opak.png';
    const { pdf, messages } = await buildPackPdf(pack!, new Map(files.map((f) => [f.name, f])));
    expect(messages.some((m) => m.code === 'NO_ALPHA')).toBe(false);
    expect(pdf).not.toBeNull();
    const cut = pageContent(await PDFDocument.load(pdf!), 1);
    expect(cut.match(/\bh\b/g)).toHaveLength(4);
  });
});

/** Sahneyi kurar, kesimleri hesaplar ve buildPdf'i seçeneklerle çağırır. */
async function buildWith(opts: BuildPdfOptions): Promise<PDFDocument> {
  const files = sceneFiles();
  const { pack } = initPack(files, { page: { widthMm: 80 } });
  const assets = new Map(files.map((f) => [f.name, f]));
  const { cuts } = computeCuts(pack!, assets);
  return PDFDocument.load(await buildPdf({ pack: pack!, assets, cuts }, opts));
}

const catalogDict = (doc: PDFDocument, key: string) => doc.catalog.lookupMaybe(PDFName.of(key), PDFDict);
const hexText = (dict: PDFDict, key: string) => dict.lookup(PDFName.of(key), PDFHexString).decodeText();
const refs = (dict: PDFDict, key: string) => dict.lookup(PDFName.of(key), PDFArray).asArray();
const box = (b: { x: number; y: number; width: number; height: number }) => [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 1000) / 1000);

describe('buildPdf seçenekleri', () => {
  it('varsayılanda Baskı/Kesim OCG katmanları ve sayfa etiketleri ekler', async () => {
    const doc = await buildWith({});
    const oc = catalogDict(doc, 'OCProperties')!;
    const ocgs = refs(oc, 'OCGs').map((r) => doc.context.lookup(r, PDFDict));
    expect(ocgs.map((g) => hexText(g, 'Name'))).toEqual(['Baskı', 'Kesim']);
    expect(refs(oc.lookup(PDFName.of('D'), PDFDict), 'Order')).toHaveLength(2);

    const print = pageContent(doc, 0), cut = pageContent(doc, 1);
    expect(print.trimStart().startsWith('/OC /oc0 BDC')).toBe(true);
    expect(cut.trimStart().startsWith('/OC /oc1 BDC')).toBe(true);
    expect(print.trimEnd().endsWith('EMC')).toBe(true);
    expect(cut.trimEnd().endsWith('EMC')).toBe(true);
    const props = doc.getPage(1).node.Resources()!.lookup(PDFName.of('Properties'), PDFDict);
    expect(props.get(PDFName.of('oc1'))?.toString()).toBe(refs(oc, 'OCGs')[1].toString());

    const nums = refs(catalogDict(doc, 'PageLabels')!, 'Nums');
    expect(nums.map((n) => (n instanceof PDFDict ? hexText(n, 'P') : n.toString()))).toEqual(['0', 'Baskı', '1', 'Kesim']);
  });

  it('layers:false ve labels:false meta veri eklemez', async () => {
    const doc = await buildWith({ layers: false, labels: false });
    expect(catalogDict(doc, 'OCProperties')).toBeUndefined();
    expect(catalogDict(doc, 'PageLabels')).toBeUndefined();
    expect(pageContent(doc, 1)).not.toMatch(/BDC|EMC/);
    expect(pageContent(doc, 1)).toMatch(/1 0 0 RG/);
  });

  it('spot renk: CS1 Separation kaynağı ve SCN ile çizer, kırmızı RG yok', async () => {
    const doc = await buildWith({ spotColor: true });
    const cs = doc.getPage(1).node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict);
    const sep = cs.lookup(PDFName.of('CS1'), PDFArray).asArray();
    expect(sep[0]).toBe(PDFName.of('Separation'));
    expect(sep[1]).toBe(PDFName.of('CutContour'));
    expect(sep[2]).toBe(PDFName.of('DeviceCMYK'));
    const cut = pageContent(doc, 1);
    expect(cut).toMatch(/\/CS1 CS/);
    expect(cut).toMatch(/\b1 SCN\b/);
    expect(cut).not.toMatch(/\bRG\b/);
    expect(cut.match(/\bS\b/g)).toHaveLength(4);
    expect(cut.match(/\bh\b/g)).toHaveLength(4);
    expect(cut).toMatch(/\bc\b/);
    expect(cut).not.toMatch(/\bf\b/);
    expect(cut).toMatch(/\/OC \/oc1 BDC/);

    const named = await buildWith({ spotColor: true, spotName: 'KissCut' });
    const cs2 = named.getPage(1).node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict);
    expect(cs2.lookup(PDFName.of('CS1'), PDFArray).asArray()[1]).toBe(PDFName.of('KissCut'));
  });

  it('taşma payı: 0’da tüm kutular sayfa, 2 mm’de MediaBox büyür ve TrimBox içeri kayar', async () => {
    const PT = 72 / 25.4, W = 80 * PT, H = 120 * PT;
    const plain = await buildWith({});
    for (const i of [0, 1]) {
      const p = plain.getPage(i);
      for (const b of [p.getMediaBox(), p.getCropBox(), p.getBleedBox(), p.getTrimBox(), p.getArtBox()]) {
        expect(box(b)).toEqual(box({ x: 0, y: 0, width: W, height: H }));
      }
    }
    const bled = await buildWith({ bleedMm: 2 });
    const b = 2 * PT;
    for (const i of [0, 1]) {
      const p = bled.getPage(i);
      expect(box(p.getMediaBox())).toEqual(box({ x: 0, y: 0, width: W + 2 * b, height: H + 2 * b }));
      expect(box(p.getBleedBox())).toEqual(box(p.getMediaBox()));
      expect(box(p.getCropBox())).toEqual(box(p.getMediaBox()));
      expect(box(p.getTrimBox())).toEqual(box({ x: b, y: b, width: W, height: H }));
      expect(box(p.getArtBox())).toEqual(box(p.getTrimBox()));
    }
    // Kesim yolları ve arka plan taşma payı kadar kayar / büyür.
    expect(pageContent(bled, 1)).toContain(`1 0 0 1 ${b} ${H + b} cm`);
    expect(pageContent(bled, 0)).toContain(`${W + 2 * b} 0 0 ${H + 2 * b} 0 0 cm`);
  });

  it('pages:"cut" yalnız kesim sayfasını, pages:"print" yalnız baskı sayfasını yazar', async () => {
    const cutOnly = await buildWith({ pages: 'cut' });
    expect(cutOnly.getPageCount()).toBe(1);
    const cut = pageContent(cutOnly, 0);
    expect(cut).toMatch(/1 0 0 RG/);
    expect(cut).not.toMatch(/\bDo\b/);
    expect(cut).toMatch(/\/OC \/oc1 BDC/);
    const oc = catalogDict(cutOnly, 'OCProperties')!;
    expect(refs(oc, 'OCGs').map((r) => hexText(cutOnly.context.lookup(r, PDFDict), 'Name'))).toEqual(['Kesim']);
    const nums = refs(catalogDict(cutOnly, 'PageLabels')!, 'Nums');
    expect(nums.map((n) => (n instanceof PDFDict ? hexText(n, 'P') : n.toString()))).toEqual(['0', 'Kesim']);

    const printOnly = await buildWith({ pages: 'print' });
    expect(printOnly.getPageCount()).toBe(1);
    expect(pageContent(printOnly, 0)).toMatch(/\bDo\b/);
    expect(pageContent(printOnly, 0)).not.toMatch(/\bRG\b/);
  });
});
