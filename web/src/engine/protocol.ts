import type { InitOptions, InitResult, Message } from '../../../src/core/pipeline';
import type { RoleResult } from '../../../src/core/roles';
import type { Pt } from '../../../src/core/geometry';
import type { BuildPdfOptions } from '../../../src/core/pdf';
import type { CompareResult } from '../../../src/core/compare';

export type JobId = number;
export type Phase =
  | 'decode' | 'roles' | 'regions' | 'match' | 'cuts' | 'layout' | 'pdf' | 'zip' | 'svg' | 'png' | 'package' | 'reference' | 'compare' | 'rasterize';

export interface ExportOptions extends BuildPdfOptions { pngDpi?: number; mockups?: boolean; printSvg?: boolean }

export type Task =
  | { type: 'addFiles'; files: { name: string; bytes: Uint8Array }[] }
  | { type: 'removeFiles'; names: string[] }
  | { type: 'roles'; hints?: { design?: string; background?: string } }
  | { type: 'init'; options: InitOptions }
  | { type: 'cuts'; packJson: string }
  | { type: 'pdf'; packJson: string; options?: BuildPdfOptions }
  | { type: 'zip'; packJson: string }
  | { type: 'svg'; packJson: string; pages: 'cut' | 'print' | 'both'; layers?: boolean }
  | { type: 'pngs'; packJson: string; dpi: number }
  | { type: 'package'; packJson: string; name: string; options: ExportOptions }
  | { type: 'reference'; name: string; bytes: Uint8Array }
  | { type: 'clearReference' }
  | { type: 'compare'; packJson: string }
  | { type: 'reset' };

export interface FileInfo { name: string; width: number; height: number }
/** Tek sayfa modunda sayfadan üretilen arka plan (raster olmadan; ana iş parçacığı bitmap'ini kendi üretir). */
export interface SyntheticFile extends FileInfo { bytes: Uint8Array }
export type InitReply = Omit<InitResult, 'syntheticBackground'> & { syntheticBackground?: SyntheticFile };
export interface ReferenceInfo { name: string; cuts: Pt[][]; borders: Pt[][]; pageMm: { w: number; h: number }; cutPage: number; messages: Message[] }
export interface CutStats { anchors: number; lines: number; ms: number; minMm: number }

export interface TaskResultMap {
  addFiles: FileInfo[];
  removeFiles: null;
  roles: RoleResult;
  init: InitReply;
  cuts: { messages: Message[] };
  pdf: { pdf: Uint8Array | null; messages: Message[] };
  zip: Uint8Array;
  svg: { svg: string; messages: Message[] };
  pngs: { zip: Uint8Array | null; count: number; messages: Message[] };
  package: { zip: Uint8Array | null; entries: string[]; messages: Message[] };
  reference: ReferenceInfo;
  clearReference: null;
  compare: { result: CompareResult; messages: Message[] };
  reset: null;
}

export type ToWorker = { kind: 'start'; job: JobId; task: Task } | { kind: 'cancel'; job: JobId };
export type FromWorker =
  | { kind: 'progress'; job: JobId; phase: Phase; done: number; total: number }
  | { kind: 'cut'; job: JobId; itemId: string; key: string; points: Pt[]; stats: CutStats }
  | { kind: 'done'; job: JobId; result: unknown }
  | { kind: 'error'; job: JobId; message: string; code?: string }
  | { kind: 'cancelled'; job: JobId };
