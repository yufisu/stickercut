import {
  PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, moveTo, lineTo, closePath, clip, endPath,
  type PDFImage, type PDFPage,
} from 'pdf-lib';
import { type Pack, type RegionItem, PT_PER_MM, effectiveSettings, isRegionItem } from './project';
import { type Affine, type Pt, multiply, itemMatrix, transformPoints, closedPathSvg } from './geometry';
import { regionOutline } from './contour';

export interface PdfAsset { bytes: Uint8Array; width: number; height: number }
export interface BuildPdfInput { pack: Pack; assets: Map<string, PdfAsset>; cuts: Map<string, Pt[]> }

export async function buildPdf({ pack, assets, cuts }: BuildPdfInput): Promise<Uint8Array> {
  const W = pack.page.widthMm * PT_PER_MM, H = pack.page.heightMm * PT_PER_MM;
  const kx = W / pack.designSize.widthPx, ky = H / pack.designSize.heightPx;
  const toPt: Affine = [kx, 0, 0, ky, 0, 0];     // tasarım px → pt, y aşağı (drawSvgPath bunu bekler)
  const toPdf: Affine = [kx, 0, 0, -ky, 0, H];   // tasarım px → PDF koordinatı, y yukarı

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

  const print = doc.addPage([W, H]);
  print.setTrimBox(0, 0, W, H);
  print.drawImage(await image(pack.files.background), { x: 0, y: 0, width: W, height: H });
  for (const item of pack.items) {
    const cut = cuts.get(item.id);
    if (cut && !item.printOnly && effectiveSettings(pack, item).whiteBorder) {
      print.drawSvgPath(closedPathSvg(transformPoints(toPt, cut)), { x: 0, y: H, color: rgb(1, 1, 1) });
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

  const cutPage = doc.addPage([W, H]);
  cutPage.setTrimBox(0, 0, W, H);
  for (const item of pack.items) {
    const cut = cuts.get(item.id);
    if (!cut || item.printOnly) continue;
    cutPage.drawSvgPath(closedPathSvg(transformPoints(toPt, cut)), {
      x: 0, y: H, borderColor: rgb(1, 0, 0), borderWidth: effectiveSettings(pack, item).strokeWidthPt,
    });
  }
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
