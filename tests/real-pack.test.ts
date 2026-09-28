import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { run, type Io } from '../src/cli/run';

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
  });
});
