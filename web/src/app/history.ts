import { parsePack, serializePack, type Pack } from '../../../src/core/project';

interface Snapshot { json: string; selection: string[]; coalesce?: string; at: number }

/** Düzenleyicinin pack değişiklikleri için sınırlı geri/ileri alma geçmişi (JSON anlık görüntüleri). */
export class EditHistory {
  private entries: Snapshot[] = [];
  private index = -1;
  private grouped = false;
  private groupHasChange = false;
  readonly limit: number;

  constructor(limit = 80) { this.limit = limit; }

  reset(pack: Pack | null, selection: string[] = []): void {
    this.entries = pack ? [{ json: serializePack(pack), selection, at: Date.now() }] : [];
    this.index = this.entries.length - 1;
    this.grouped = false;
    this.groupHasChange = false;
  }

  /** Kaydırıcı sürüklemesi gibi ardışık değişiklikleri tek adımda toplar. */
  beginGroup(): void { this.grouped = true; this.groupHasChange = false; }
  endGroup(): void { this.grouped = false; this.groupHasChange = false; }

  select(selection: string[]): void {
    if (this.index >= 0) this.entries[this.index].selection = selection;
  }

  /** `coalesce` aynı anahtarla 600 ms içinde gelen değişiklikleri (ok tuşuyla itme gibi) tek adımda birleştirir. */
  record(pack: Pack, selection: string[], coalesce?: string): void {
    const now = Date.now();
    const next: Snapshot = { json: serializePack(pack), selection, coalesce, at: now };
    if (this.index < 0) { this.reset(pack, selection); return; }
    const current = this.entries[this.index];
    if (next.json === current.json) { this.select(selection); return; }
    const merge = (this.grouped && this.groupHasChange)
      || (coalesce !== undefined && current.coalesce === coalesce && now - current.at < 600 && this.index > 0);
    if (merge) {
      this.entries[this.index] = next;
      this.entries.length = this.index + 1;
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(next);
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    if (this.grouped) this.groupHasChange = true;
  }

  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index >= 0 && this.index < this.entries.length - 1; }

  undo(): { pack: Pack; selection: string[] } | null {
    this.endGroup();
    return this.canUndo ? this.restore(--this.index) : null;
  }

  redo(): { pack: Pack; selection: string[] } | null {
    this.endGroup();
    return this.canRedo ? this.restore(++this.index) : null;
  }

  private restore(index: number): { pack: Pack; selection: string[] } {
    const snapshot = this.entries[index];
    return { pack: parsePack(snapshot.json), selection: snapshot.selection };
  }
}
