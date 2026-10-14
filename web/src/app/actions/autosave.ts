import { store, busy } from '../store';
import * as storage from '../../platform/storage';
import { serializePack } from '../../../../src/core/project';
import { reviewMessages } from '../messages';
import { toast } from './jobs';

let docTimer = 0;
let queue = Promise.resolve();
let quotaWarned = false;

const enqueue = (fn: () => Promise<void>) => { queue = queue.then(fn).catch((e) => {
  if (!quotaWarned && String((e as Error)?.name).includes('Quota')) { quotaWarned = true; toast('Tarayıcı depolama alanı dolu; projeyi .zip olarak dışa aktar.', 'warning'); }
}); };

export function docSnapshot(): storage.SavedDoc {
  const doc = store.doc.value;
  return {
    packJson: doc ? serializePack(doc) : null,
    page: { ...store.pageSetup.value },
    presetId: store.presetId.value,
    messages: doc ? reviewMessages(doc, store.initMessages.value, store.dismissedMarkers.value) : [...store.initMessages.value],
    dismissed: [...store.dismissedMarkers.value],
    selection: [...store.selection.value],
  };
}

/** Belge/kurulum kaydı: 500 ms sonra, sıralı. */
export function scheduleDocSave(): void {
  clearTimeout(docTimer);
  docTimer = window.setTimeout(() => enqueue(() => storage.saveDoc(docSnapshot())), 500);
}

/** Dosya listesi kaydı: yalnızca dosyalar değişince (büyük veri). */
export function saveFilesNow(): void {
  const files = [...store.files.value.values()].map(({ name, bytes, role }) => ({ name, bytes, role }));
  enqueue(() => storage.saveFiles({ files }));
}

export function cancelPendingSaves(): void { clearTimeout(docTimer); }
export function flushSaves(): Promise<void> { return queue; }

export function savePrefs(): void { storage.savePrefs(store.prefs.value); }

export function isBusy(): boolean { return busy.value; }
