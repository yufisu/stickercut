import {
  PDFDocument, PDFDict, PDFName, PDFNumber, PDFHexString, PDFOperator, PDFOperatorNames, type PDFImage, type PDFPage, type PDFRef,
  rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject,
  translate, scale, setLineWidth, moveTo, lineTo, appendBezierCurve, closePath, stroke, clip, endPath,
} from 'pdf-lib';
import { type Pack, type RegionItem, PT_PER_MM, effectiveSettings, isRegionItem } from './project';
import { type Affine, type Pt, multiply, itemMatrix, transformPoints, closedPathSvg } from './geometry';
import { regionOutline } from './contour';

export interface PdfAsset { bytes: Uint8Array; width: number; height: number }
export interface BuildPdfInput { pack: Pack; assets: Map<string, PdfAsset>; cuts: Map<string, Pt[]> }
export interface BuildPdfOptions {
  /** Yazılacak sayfalar; varsayılan ikisi de (1. baskı, 2. kesim). */
  pages?: 'both' | 'print' | 'cut';
  /** "Baskı" ve "Kesim" adlı OCG katmanları (varsayılan açık). */
  layers?: boolean;
  /** Sayfa etiketleri Baskı / Kesim (varsayılan açık). */
  labels?: boolean;
  /** Kesim çizgisi RGB kırmızı yerine Separation spot rengiyle çizilir. */
  spotColor?: boolean;
  /** Spot rengin adı (varsayılan CutContour). */
  spotName?: string;
  /** Taşma payı: MediaBox/BleedBox/CropBox bu kadar büyür, TrimBox/ArtBox sayfa kalır. */
  bleedMm?: number;
}

const LAYER = { print: { name: 'Baskı', key: 'oc0' }, cut: { name: 'Kesim', key: 'oc1' } };

/** Sayfa kaynaklarındaki (Resources) alt sözlüğü döndürür, yoksa oluşturur. */
function resourceDict(page: PDFPage, name: string): PDFDict {
  const res = page.node.normalizedEntries().Resources, key = PDFName.of(name);
  let dict = res.lookupMaybe(key, PDFDict);
  if (!dict) { dict = page.doc.context.obj({}); res.set(key, dict); }
  return dict;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** closedPathSvg ile aynı yol: sadece uydurulmuş tutamaçlar eğri, diğer köşeler düz. */
function pathOperators(pts: Pt[]): PDFOperator[] {
  const segment = (a: Pt, b: Pt) => {
    if (!a.handleOut && !b.handleIn) return lineTo(r3(b.x), r3(b.y));
    const c1 = a.handleOut ?? a, c2 = b.handleIn ?? b;
    return appendBezierCurve(r3(c1.x), r3(c1.y), r3(c2.x), r3(c2.y), r3(b.x), r3(b.y));
  };
  const ops = [moveTo(r3(pts[0].x), r3(pts[0].y))];
  for (let i = 1; i < pts.length; i++) ops.push(segment(pts[i - 1], pts[i]));
  const last = pts[pts.length - 1];
  if (last.handleOut || pts[0].handleIn) ops.push(segment(last, pts[0]));
  return [...ops, closePath()];
}

export async function buildPdf({ pack, assets, cuts }: BuildPdfInput, opts: BuildPdfOptions = {}): Promise<Uint8Array> {
  const { pages = 'both', layers = true, labels = true, spotColor = false, spotName = 'CutContour', bleedMm = 0 } = opts;
  const W = pack.page.widthMm * PT_PER_MM, H = pack.page.heightMm * PT_PER_MM, b = bleedMm * PT_PER_MM;
  const kx = W / pack.designSize.widthPx, ky = H / pack.designSize.heightPx;
  const toPt: Affine = [kx, 0, 0, ky, 0, 0];         // tasarım px → pt, y aşağı (drawSvgPath bunu bekler)
  const toPdf: Affine = [kx, 0, 0, -ky, b, H + b];   // tasarım px → PDF koordinatı, y yukarı

  const doc = await PDFDocument.create();
  doc.setTitle('stickercut');
  doc.setCreator('stickercut');
  doc.setProducer('stickercut');

  const asset = (file: string) => {
    const a = assets.get(file);
    if (!a) throw new Error(`Dosya eksik: ${file}`);
    return a;
  };
  const images = new Map<string, PDFImage>();
  const image = async (file: string) => {
    let im = images.get(file);
    if (!im) { im = await doc.embedPng(asset(file).bytes); images.set(file, im); }
    return im;
  };

  const ocgs: PDFRef[] = [];
  const nums: (number | { P: PDFHexString })[] = [];
  const addPage = (layer: { name: string; key: string }) => {
    const page = doc.addPage([W + 2 * b, H + 2 * b]);
    page.setBleedBox(0, 0, W + 2 * b, H + 2 * b);
    page.setCropBox(0, 0, W + 2 * b, H + 2 * b);
    page.setTrimBox(b, b, W, H);
    page.setArtBox(b, b, W, H);
    nums.push(doc.getPageCount() - 1, { P: PDFHexString.fromText(layer.name) });
    if (layers) {
      const ocg = doc.context.register(doc.context.obj({
        Type: 'OCG', Name: PDFHexString.fromText(layer.name), Usage: { Print: { PrintState: 'ON' }, View: { ViewState: 'ON' } },
      }));
      ocgs.push(ocg);
      resourceDict(page, 'Properties').set(PDFName.of(layer.key), ocg);
      page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of(layer.key)]));
    }
    return page;
  };
  const endPage = (page: PDFPage) => { if (layers) page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent)); };

  if (pages !== 'cut') {
    const print = addPage(LAYER.print);
    print.drawImage(await image(pack.files.background), { x: 0, y: 0, width: W + 2 * b, height: H + 2 * b });
    for (const item of pack.items) {
      const cut = cuts.get(item.id);
      if (cut && !item.printOnly && effectiveSettings(pack, item).whiteBorder) {
        print.drawSvgPath(closedPathSvg(transformPoints(toPt, cut)), { x: b, y: H + b, color: rgb(1, 1, 1) });
      }
      if (isRegionItem(item)) {
        drawRegionItem(print, item, asset(pack.files.design), print.node.newXObject('Image', (await image(pack.files.design)).ref), toPdf);
        continue;
      }
      if (item.file === null) continue;
      const a = asset(item.file);
      const unitToSticker: Affine = [a.width, 0, 0, -a.height, 0, a.height];
      const m = multiply(toPdf, multiply(itemMatrix(item, a.width, a.height), unitToSticker));
      const name = print.node.newXObject('Image', (await image(item.file)).ref);
      print.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
    }
    endPage(print);
  }

  if (pages !== 'print') {
    const cutPage = addPage(LAYER.cut);
    if (spotColor) {
      // Separation → DeviceCMYK (0,1,1,0): spot renk görüntüleyicide kırmızı görünür.
      const sep = doc.context.register(doc.context.obj([
        'Separation', spotName, 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 1, 1, 0], N: 1 },
      ]));
      resourceDict(cutPage, 'ColorSpace').set(PDFName.of('CS1'), sep);
      cutPage.pushOperators(
        pushGraphicsState(),
        PDFOperator.of(PDFOperatorNames.StrokingColorspace, [PDFName.of('CS1')]),
        PDFOperator.of(PDFOperatorNames.StrokingColorN, [PDFNumber.of(1)]),
      );
    }
    for (const item of pack.items) {
      const cut = cuts.get(item.id);
      if (!cut || item.printOnly) continue;
      const pts = transformPoints(toPt, cut), borderWidth = effectiveSettings(pack, item).strokeWidthPt;
      // drawSvgPath renk verilmeden boyamaz (S yerine h ile biter); spot renk dıştaki q…Q'dan miras alınır.
      if (spotColor) {
        cutPage.pushOperators(pushGraphicsState(), translate(b, H + b), scale(1, -1), setLineWidth(borderWidth), ...pathOperators(pts), stroke(), popGraphicsState());
      } else {
        cutPage.drawSvgPath(closedPathSvg(pts), { x: b, y: H + b, borderColor: rgb(1, 0, 0), borderWidth });
      }
    }
    if (spotColor) cutPage.pushOperators(popGraphicsState());
    endPage(cutPage);
  }

  if (ocgs.length) {
    doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: ocgs, D: { BaseState: 'ON', Order: ocgs, ON: ocgs } }));
  }
  if (labels) doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: nums }));
  return doc.save();
}

/** Bölge öğesi: tasarım görselini bölge dış hattıyla kırparak öğe dönüşümüyle çizer. */
function drawRegionItem(page: PDFPage, item: RegionItem, design: PdfAsset, image: ReturnType<PDFPage['node']['newXObject']>, toPdf: Affine): void {
  const { bbox } = item.region;
  const local = multiply(toPdf, itemMatrix(item, bbox.w, bbox.h)); // bbox-yerel px → PDF pt
  const outline = transformPoints(local, regionOutline(item.region));
  if (outline.length < 3) return;
  const unitToLocal: Affine = [design.width, 0, 0, -design.height, -bbox.x, -bbox.y + design.height];
  const m = multiply(local, unitToLocal);
  page.pushOperators(
    pushGraphicsState(),
    moveTo(outline[0].x, outline[0].y),
    ...outline.slice(1).map((p) => lineTo(p.x, p.y)),
    closePath(), clip(), endPath(),
    concatTransformationMatrix(...m), drawObject(image), popGraphicsState(),
  );
}
