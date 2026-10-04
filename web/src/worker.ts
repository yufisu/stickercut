import { decodePngBytes } from './decode';
import type { Envelope, Request } from './protocol';
import {
  prepareLoadedFile, initPack, computeCuts, buildPackPdf, type LoadedFile, type CutCache,
} from '../../src/core/pipeline';
import { assignRoles } from '../../src/core/roles';
import { parsePack } from '../../src/core/project';
import { packToZip } from '../../src/core/zip';

const files = new Map<string, LoadedFile>();
let cache: CutCache = new Map();
const ctx = self as unknown as {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Envelope>) => void) | null;
};

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'addFiles': {
      const out = [];
      for (const f of req.files) {
        const loaded = prepareLoadedFile(f.name, f.bytes, await decodePngBytes(f.bytes));
        files.set(loaded.name, loaded);
        out.push({ name: loaded.name, width: loaded.width, height: loaded.height });
      }
      return out;
    }
    case 'removeFiles':
      for (const name of req.names) files.delete(name);
      cache.clear();
      return null;
    case 'roles':
      return assignRoles([...files.values()].map((f) => ({ file: f.name, raster: f.raster })));
    case 'init':
      return initPack([...files.values()], req.options);
    case 'cuts': {
      const { cuts, messages } = computeCuts(parsePack(req.packJson), files, cache);
      return { cuts: [...cuts], messages };
    }
    case 'pdf':
      return buildPackPdf(parsePack(req.packJson), files, cache);
    case 'zip': {
      const pack = parsePack(req.packJson);
      const names = new Set([pack.files.design, pack.files.background, ...pack.items.map((i) => i.file)]);
      return packToZip(req.packJson, new Map([...names].filter((n) => files.has(n)).map((n) => [n, files.get(n)!.bytes])));
    }
    case 'reset':
      files.clear();
      cache = new Map();
      return null;
  }
}

ctx.onmessage = async (e) => {
  const { id, req } = e.data;
  try {
    ctx.postMessage({ id, ok: true, result: await handle(req) });
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
