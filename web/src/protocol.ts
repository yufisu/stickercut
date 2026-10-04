import type { InitOptions } from '../../src/core/pipeline';

export type Request =
  | { type: 'addFiles'; files: { name: string; bytes: Uint8Array }[] }
  | { type: 'removeFiles'; names: string[] }
  | { type: 'roles' }
  | { type: 'init'; options: InitOptions }
  | { type: 'cuts'; packJson: string }
  | { type: 'pdf'; packJson: string }
  | { type: 'zip'; packJson: string }
  | { type: 'reset' };

export interface Envelope { id: number; req: Request }
export type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
