import { makeScene } from '../../../src/core/sample-scene';
import { encodePngRgba } from '../../../src/core/png-encode';
import { store } from './store';
import { addFiles } from './actions/files';

/** "Örnek pack'i dene": sentetik tasarım + arka plan + 4 sticker'ı tarayıcıda üretip yükler. */
export async function loadSamplePack(): Promise<void> {
  const s = makeScene();
  const file = (name: string, raster: Parameters<typeof encodePngRgba>[0]) => new File([encodePngRgba(raster) as BlobPart], name, { type: 'image/png' });
  const files = [
    file('ornek-tasarim.png', s.design), file('ornek-arkaplan.png', s.background),
    ...s.stickers.map((st) => file(`ornek-${st.file}`, st.raster)),
  ];
  store.pageSetup.value = { widthMm: 80, heightMm: 120 };
  await addFiles(files);
}
