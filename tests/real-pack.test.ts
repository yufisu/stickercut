import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { run, type Io } from '../src/cli/run';
import { parsePack } from '../src/core/project';
import { computeCutsDetailed, packAssetNames, type LoadedFile } from '../src/core/pipeline';
import { loadFile, resolveOnDisk } from '../src/cli/files';
import { isG1 } from '../src/core/spline';

const root = process.env.STICKERS_DIR;

describe.skipIf(!root)('gerçek pack: Türk kahvesi', () => {
  it('13 kopyayı bulur ve 2 sayfalı PDF üretir', async () => {
    const lines: string[] = [];
    const io: Io = { out: (s) => lines.push(s), err: (s) => lines.push(s) };
    const out = mkdtempSync(join(tmpdir(), 'sc-real-'));
    const packPath = join(out, 'kahve.pack.json');
    const code = await run([
      'init', join(root!, 'çay ve kahve'),
      '--design', 'bases/turk kahvesi.png', '--background', 'bases/turk kahvesi arka.png',
      '--page', '80x140', '-o', packPath, '--json',
    ], io);
    console.log(lines.join('\n'));
    expect(code).toBe(0);
    const pack = JSON.parse(readFileSync(packPath, 'utf8'));
    console.log(pack.items.map((i: { id: string; file: string; matchScore: number }) => `${i.id} ${i.file} ${i.matchScore}`).join('\n'));
    expect(pack.items).toHaveLength(13);
    const counts = (Object.values(pack.items.reduce((m: Record<string, number>, i: { file: string }) => ({ ...m, [i.file]: (m[i.file] ?? 0) + 1 }), {})) as number[]).sort((a, b) => a - b);
    // assets/ klasöründe baklava.png yok: tasarımdaki 3 baklava, en yakın (yanlış) cup sticker'ına
    // düşük skorla eşleşiyor ve needsReview=true oluyor — bu doğru davranış (spec: düşük skor → review).
    // 10 gerçek fincan: kahve3×3, kahvee×3, kahve×2, finncan×2 (doğru) + finncan×3 (baklava, needsReview).
    expect(counts).toEqual([2, 3, 3, 5]);
    const needsReview = pack.items.filter((i: { needsReview: boolean }) => i.needsReview);
    expect(needsReview).toHaveLength(3);
    expect(needsReview.every((i: { matchScore: number }) => i.matchScore < 0.7)).toBe(true);

    expect(await run(['build', packPath], io)).toBe(0);
    const doc = await PDFDocument.load(readFileSync(join(out, 'kahve.pack.pdf')));
    expect(doc.getPageCount()).toBe(2);
    console.log('çıktı klasörü:', out);

    // Kesim kalitesi: tamamen kübik, G1, makul anchor sayısı, çizime girmiyor.
    const parsed = parsePack(readFileSync(packPath, 'utf8'));
    const assets = new Map<string, LoadedFile>(packAssetNames(parsed, true).map((n) => [n, loadFile(resolveOnDisk(dirname(packPath), n), n)]));
    const { cuts, details } = computeCutsDetailed(parsed, assets);
    const rows: string[] = [];
    for (const item of parsed.items) {
      const d = details.get(item.id)!, pts = cuts.get(item.id)!;
      rows.push(`${item.id} anchors=${d.shape.stats.anchors} lines=${d.shape.stats.lines} G1=${isG1(pts)} min=${d.shape.clearance.minMm.toFixed(2)}mm ms=${d.shape.stats.ms.toFixed(0)}`);
      expect(d.shape.stats.lines, item.id).toBe(0);
      expect(isG1(pts), item.id).toBe(true);
      expect(d.shape.stats.anchors, item.id).toBeGreaterThanOrEqual(6);
      expect(d.shape.stats.anchors, item.id).toBeLessThanOrEqual(150);
      expect(d.shape.clearance.minMm, item.id).toBeGreaterThanOrEqual(d.options.offsetMm - 0.1);
    }
    console.log(rows.join('\n'));
  });
});
