import { parsePack, serializePack, type Pack } from '../../src/core/project';

interface Snapshot { json: string; selectedId: string | null }

/** Düzenleyicinin pack değişiklikleri için sınırlı geri/ileri alma geçmişi. */
export class EditHistory {
  private entries: Snapshot[] = [];
  private index = -1;
  private grouped = false;
  private groupHasChange = false;

  reset(pack: Pack | null, selectedId: string | null = null): void {
    this.entries = pack ? [{ json: serializePack(pack), selectedId }] : [];
    this.index = this.entries.length - 1;
    this.grouped = false;
    this.groupHasChange = false;
  }

  beginGroup(): void { this.grouped = true; this.groupHasChange = false; }
  endGroup(): void { this.grouped = false; this.groupHasChange = false; }

  select(selectedId: string | null): void {
    if (this.index >= 0) this.entries[this.index].selectedId = selectedId;
  }

  record(pack: Pack, selectedId: string | null): void {
    const next = { json: serializePack(pack), selectedId };
    if (this.index < 0) { this.reset(pack, selectedId); return; }
    if (next.json === this.entries[this.index].json) { this.select(selectedId); return; }
    if (this.grouped && this.groupHasChange) {
      this.entries[this.index] = next;
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(next);
    if (this.entries.length > 61) this.entries.shift();
    this.index = this.entries.length - 1;
    if (this.grouped) this.groupHasChange = true;
  }

  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index >= 0 && this.index < this.entries.length - 1; }

  undo(): { pack: Pack; selectedId: string | null } | null {
    this.endGroup();
    return this.canUndo ? this.restore(--this.index) : null;
  }

  redo(): { pack: Pack; selectedId: string | null } | null {
    this.endGroup();
    return this.canRedo ? this.restore(++this.index) : null;
  }

  private restore(index: number): { pack: Pack; selectedId: string | null } {
    const snapshot = this.entries[index];
    return { pack: parsePack(snapshot.json), selectedId: snapshot.selectedId };
  }
}
