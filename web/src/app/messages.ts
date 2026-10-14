import type { Pack } from '../../../src/core/project';
import { itemLabel } from '../../../src/core/project';
import type { Message } from '../../../src/core/pipeline';
import { legacyRegion, unmatchedRegionText } from '../../../src/core/region-label';
import { regionItemText } from '../../../src/core/pipeline';

export const NEEDS_REVIEW_TEXT = (label: string) => `"${label}" otomatik yerleşimi belirsiz. Önizlemede turuncu çerçeveye dokunup konumunu kontrol et.`;

/**
 * Kurulum mesajlarını belgenin güncel haline göre süzer: silinen öğelerin uyarıları düşer, onaylananlar kalkar,
 * bölge işaretleri yeniden numaralanır, kullanıcı tarafından yok sayılan bölgeler gizlenir.
 */
export function reviewMessages(pack: Pack, initMessages: Message[], dismissed: ReadonlySet<number>): Message[] {
  const kept = initMessages.filter((m) => {
    if (m.code === 'ROLES') return false;
    if (m.code === 'NEEDS_REVIEW') return pack.items.some((i) => i.id === m.itemId && i.needsReview);
    if (m.code === 'UNUSED_STICKER') return !pack.items.some((i) => i.file === m.file);
    if (m.code === 'REGION_ITEM') return pack.items.some((i) => i.id === m.itemId && i.needsReview);
    if (m.code === 'UNMATCHED_REGION') return !(m.marker && dismissed.has(m.marker));
    return true;
  });
  for (const item of pack.items) {
    if (item.needsReview && !kept.some((m) => (m.code === 'NEEDS_REVIEW' || m.code === 'REGION_ITEM') && m.itemId === item.id)) {
      kept.push({ level: 'warning', code: 'NEEDS_REVIEW', itemId: item.id, file: item.file ?? undefined, text: NEEDS_REVIEW_TEXT(itemLabel(item)) });
    }
  }
  let marker = 0;
  return kept.map((m) => {
    if (m.code === 'NEEDS_REVIEW') {
      const item = pack.items.find((i) => i.id === m.itemId);
      return { ...m, text: NEEDS_REVIEW_TEXT(item ? itemLabel(item) : (m.itemId ?? '')) };
    }
    if (m.code === 'REGION_ITEM' && m.region) {
      marker++;
      return { ...m, marker, text: regionItemText(m.region, pack.designSize.widthPx, pack.designSize.heightPx, marker, true) };
    }
    if (m.code !== 'UNMATCHED_REGION') return m;
    const region = m.region ?? legacyRegion(m.text);
    if (!region) return m;
    marker++;
    return { ...m, region, marker, text: unmatchedRegionText(region, pack.designSize.widthPx, pack.designSize.heightPx, marker) };
  });
}

export interface MessageGroup { level: Message['level']; title: string; items: Message[] }

/** Kontrol sekmesi için gruplanmış liste. */
export function groupMessages(all: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [
    { level: 'error', title: 'Hatalar', items: [] },
    { level: 'warning', title: 'Kontrol et', items: [] },
    { level: 'info', title: 'Bilgi', items: [] },
  ];
  for (const m of all) groups.find((g) => g.level === m.level)!.items.push(m);
  return groups.filter((g) => g.items.length);
}
