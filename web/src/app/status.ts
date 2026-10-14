import type { Pack } from '../../../src/core/project';
import type { Message } from '../../../src/core/pipeline';
import { cutKey } from './cut-key';
import type { CutEntry } from './store';

export type ItemStatus = 'ok' | 'review' | 'warning' | 'error' | 'printOnly' | 'pending';

export const STATUS_LABEL: Record<ItemStatus, string> = {
  ok: 'hazır', review: 'kontrol et', warning: 'uyarı', error: 'hata', printOnly: 'sadece baskı', pending: 'hesaplanıyor',
};

/** Öğe başına rozet durumu: hata > kontrol > uyarı > hesaplanıyor > sadece baskı > hazır. */
export function itemStatuses(pack: Pack, messages: Message[], cuts: ReadonlyMap<string, CutEntry>): Map<string, ItemStatus> {
  const out = new Map<string, ItemStatus>();
  const byItem = new Map<string, Message['level'][]>();
  for (const m of messages) if (m.itemId) byItem.set(m.itemId, [...(byItem.get(m.itemId) ?? []), m.level]);
  for (const item of pack.items) {
    const levels = byItem.get(item.id) ?? [];
    if (levels.includes('error')) { out.set(item.id, 'error'); continue; }
    if (item.needsReview) { out.set(item.id, 'review'); continue; }
    if (levels.includes('warning')) { out.set(item.id, 'warning'); continue; }
    if (item.printOnly) { out.set(item.id, 'printOnly'); continue; }
    const cut = cuts.get(item.id);
    out.set(item.id, cut && cut.key === cutKey(pack, item) ? 'ok' : 'pending');
  }
  return out;
}

/** Kesim güncel mi? (anahtar eşleşmesi) */
export function isFresh(pack: Pack, itemId: string, cuts: ReadonlyMap<string, CutEntry>): boolean {
  const item = pack.items.find((i) => i.id === itemId), cut = cuts.get(itemId);
  return !!item && !!cut && cut.key === cutKey(pack, item);
}
