import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { initPack, buildPackPdf, prepareLoadedFile, type LoadedFile } from '../../src/core/pipeline';
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
