import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { makeScene } from '../helpers/scene';
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

/** iPad (dokunmatik) projesinde paylaşım menüsü yerine navigator.share stub'ı dosyayı sayfada tutar. */
async function stubShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files: File[] }) => {
        const bytes = new Uint8Array(await data.files[0].arrayBuffer());
        (window as unknown as { __shared: unknown }).__shared = { name: data.files[0].name, bytes: Array.from(bytes) };
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
  // Dokunmatikte dosya hazır olunca "Paylaş" düğmeli bildirim çıkar.
  await page.getByRole('button', { name: 'Paylaş' }).click();
  await page.waitForFunction(() => (window as unknown as { __shared?: unknown }).__shared, null, { timeout: 60_000 });
  const shared = await page.evaluate(() => (window as unknown as { __shared: { bytes: number[] } }).__shared);
  return new Uint8Array(shared.bytes);
}

test('dosya yükle → yerleştir → sticker seç ve it → PDF al', async ({ page }, testInfo) => {
  const touch = testInfo.project.name === 'ipad';
  if (touch) await stubShare(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const paths = writeFixtures(testInfo.outputPath('fixtures'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'stickercut' })).toBeVisible();
  await page.locator('#picker').setInputFiles(paths);
  await expect(page.locator('.file-card')).toHaveCount(6);
  await expect(page.locator('.file-card.design .name')).toHaveText('tasarim.png');
  await expect(page.locator('.file-card.background .name')).toHaveText('arka.png');
  await expect(page.locator('#place')).toBeEnabled();

  await page.locator('#place').click();
  await expect(page.locator('.editor')).toBeVisible();
  if (touch) {
    // Alt sayfadaki katman listesi: soldan kayan panel
    await page.getByRole('button', { name: 'Katmanlar' }).click();
  }
  await expect(page.locator('.layer .badge.ok').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.layer')).toHaveCount(4);

  // Katman satırından seç → denetçide konum alanları; ok tuşuyla 0.1 mm it
  await page.locator('.layer').first().click();
  if (touch) {
    await page.locator('.scrim').click();
    await page.locator('.sheet .grip').dispatchEvent('pointerdown', { clientY: 900, pointerId: 1 });
    await page.locator('.sheet .grip').dispatchEvent('pointerup', { clientY: 700, pointerId: 1 });
  }
  const x = page.getByLabel('X konumu');
  await expect(x).toBeVisible();
  const before = Number(await x.inputValue());
  await page.locator('.stage-canvas').focus();
  await page.keyboard.press('ArrowRight');
  await expect(x).toHaveValue(String(Math.round((before + 0.1) * 10) / 10));

  const bytes = await exportedPdf(page, () => page.locator('#pdf').click(), touch);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(2);
  expect(errors).toEqual([]);
});

test('tek sayfa modu: yalnızca sticker sayfası → şekiller bulunur → PDF', async ({ page }, testInfo) => {
  const touch = testInfo.project.name === 'ipad';
  if (touch) await stubShare(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const dir = testInfo.outputPath('tek');
  mkdirSync(dir, { recursive: true });
  const sheet = join(dir, 'sayfa.png');
  writeFileSync(sheet, encodePng(makeScene().design));
  await page.goto('/');
  await page.locator('#picker').setInputFiles([sheet]);
  await expect(page.locator('.file-card')).toHaveCount(1);
  await expect(page.locator('.file-card.design .name')).toHaveText('sayfa.png');
  await expect(page.locator('.single-sheet')).toContainText('Tek sayfa modu');
  await expect(page.locator('.single-sheet')).toContainText('#c8dc8c');
  await expect(page.locator('#place')).toBeEnabled();

  await page.locator('#place').click();
  await expect(page.locator('.editor')).toBeVisible();
  if (touch) await page.getByRole('button', { name: 'Katmanlar' }).click();
  await expect(page.locator('.layer')).toHaveCount(4);
  await expect(page.locator('.layer .badge.ok')).toHaveCount(4, { timeout: 60_000 });
  if (touch) await page.locator('.scrim').click();

  const bytes = await exportedPdf(page, () => page.locator('#pdf').click(), touch);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(2);
  expect(errors).toEqual([]);
});
