import type { Request, Reply } from './protocol';
import type { InitOptions, InitResult, Message } from '../../src/core/pipeline';
import type { RoleResult } from '../../src/core/roles';
import type { Pt } from '../../src/core/geometry';
import { serializePack, type Pack } from '../../src/core/project';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextId = 1;
worker.onmessage = (e: MessageEvent<Reply>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.ok) p.resolve(e.data.result);
  else p.reject(new Error(e.data.error));
};

function call<T>(req: Request): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, req });
  });
}

export const engine = {
  addFiles: (files: { name: string; bytes: Uint8Array }[]) =>
    call<{ name: string; width: number; height: number }[]>({ type: 'addFiles', files }),
  roles: () => call<RoleResult>({ type: 'roles' }),
  init: (options: InitOptions) => call<InitResult>({ type: 'init', options }),
  cuts: async (pack: Pack) => {
    const r = await call<{ cuts: [string, Pt[]][]; messages: Message[] }>({ type: 'cuts', packJson: serializePack(pack) });
    return { cuts: new Map(r.cuts), messages: r.messages };
  },
  pdf: (pack: Pack) => call<{ pdf: Uint8Array | null; messages: Message[] }>({ type: 'pdf', packJson: serializePack(pack) }),
  zip: (pack: Pack) => call<Uint8Array>({ type: 'zip', packJson: serializePack(pack) }),
  reset: () => call<null>({ type: 'reset' }),
};
