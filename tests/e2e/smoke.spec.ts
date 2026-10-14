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

test('dosya yükle → yerleştir → sticker seç → PDF indir', async ({ page }, testInfo) => {
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

  const download = page.waitForEvent('download');
  await page.locator('#pdf').click();
  const file = await (await download).path();
  const doc = await PDFDocument.load(readFileSync(file!));
  expect(doc.getPageCount()).toBe(2);
  expect(errors).toEqual([]);
});
