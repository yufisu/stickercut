import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { makeScene, PLACEMENTS } from '../helpers/scene';
import { encodePng } from '../../src/cli/png';

/** Sentetik pack: tasarım + arka plan + 4 sticker PNG'si test anında üretilir (repo'ya PNG girmez). */
function writeFixtures(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const s = makeScene();
  const files: [string, Parameters<typeof encodePng>[0]][] = [
    ['tasarim.png', s.design], ['arka.png', s.background],
    ...s.stickers.map((st): [string, typeof st.raster] => [st.file, st.raster]),
  ];
  return files.map(([name, raster]) => {
    const p = join(dir, name);
    writeFileSync(p, encodePng(raster));
    return p;
  });
}

async function designToScreen(page: Page, x: number, y: number, designW: number, designH: number) {
  const box = await page.locator('canvas.stage').boundingBox();
  if (!box) throw new Error('tuval yok');
  const pad = 16, s = Math.min((box.width - 2 * pad) / designW, (box.height - 2 * pad) / designH);
  const ox = (box.width - s * designW) / 2, oy = (box.height - s * designH) / 2;
  return { x: box.x + ox + x * s, y: box.y + oy + y * s };
}

/** iPad (dokunmatik) projesinde paylaşım menüsü yerine navigator.share stub'ı dosyayı sayfada tutar. */
async function stubShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nav = navigator as Navigator & { __shared?: unknown };
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files: File[] }) => {
        const bytes = new Uint8Array(await data.files[0].arrayBuffer());
        (window as unknown as { __shared: unknown }).__shared = { name: data.files[0].name, bytes: Array.from(bytes) };
        void nav;
      },
    });
  });
}

async function exportedPdf(page: Page, trigger: () => Promise<void>, touch: boolean): Promise<Uint8Array> {
  if (!touch) {
    const download = page.waitForEvent('download');
    await trigger();
    return readFileSync((await (await download).path())!);
  }
  await trigger();
  await page.waitForFunction(() => (window as unknown as { __shared?: unknown }).__shared, null, { timeout: 60_000 });
  const shared = await page.evaluate(() => (window as unknown as { __shared: { bytes: number[] } }).__shared);
  return new Uint8Array(shared.bytes);
}

test('dosya yükle → yerleştir → sticker seç → PDF indir', async ({ page }, testInfo) => {
  const touch = testInfo.project.name === 'ipad';
  if (touch) await stubShare(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });

  const paths = writeFixtures(testInfo.outputPath('fixtures'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'stickercut' })).toBeVisible();
  await page.locator('#picker').setInputFiles(paths);
  await expect(page.locator('.row')).toHaveCount(6);
  await expect(page.locator('#designPick')).toHaveValue('tasarim.png');
  await expect(page.locator('#backgroundPick')).toHaveValue('arka.png');
  await expect(page.locator('#place')).toBeEnabled();

  await page.locator('#place').click();
  await expect(page.locator('.editor')).toBeVisible();
  await expect(page.locator('#warnings li')).not.toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('#busy')).toBeEmpty();

  // İlk yerleşim (çay fincanı) tasarım koordinatında bilinir; tuvalde ona dokun.
  const p = await designToScreen(page, PLACEMENTS[0].x, PLACEMENTS[0].y, 800, 1200);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole('heading', { name: /Seçili sticker/ })).toBeVisible();

  const bytes = await exportedPdf(page, () => page.locator('#pdf').click(), touch);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(2);
  expect(errors).toEqual([]);
});
