# stickercut

Tam tasarım, stickersız arka plan ve tek tek şeffaf sticker PNG'lerinden, Illustrator kalitesinde (tamamen kübik Bézier, G1 sürekli) kesim çizgileri olan iki sayfalı PDF üretir. İlk sayfa baskı, ikinci sayfa kesim içindir. Her şey tarayıcıda (ya da CLI'da) çalışır; dosyalar cihazdan çıkmaz.

**Canlı uygulama:** https://yufisu.github.io/stickercut/

## Web atölyesi

`npm ci && npm run dev` ile yerel arayüzü aç (`http://localhost:5173`). iPad Safari ve Mac tarayıcısında çalışır.

1. **Kurulum:** En kısa yol: yalnızca sticker dolu sayfayı bırak (**tek sayfa modu**, aşağıya bak). Daha kesin sonuç için sticker'sız arka planı ve tek tek sticker PNG'lerini de ekle. PNG'leri bırak ya da *Dosyalar'dan seç* (iPad'de *Fotoğraflar'dan* seçersen dosya adları `IMG_…` olur; rolleri kartlardan düzelt). Aynı boyutlu iki opak PNG tam tasarım ve arka plan olarak otomatik tanınır. Sayfa ölçüsünü ve kesim stilini (**Yapışık**, **0.5 mm pay**, **Beyaz kenar 1 mm**) seç, **Yerleştir**'e dokun. İlk kez deniyorsan *Örnek pack'i dene*.
2. **Editör:** Sol araç çubuğu (seç, gez, sticker ekle, bölge, ölçü), mm cetvelli tuval, altta katman listesi, sağda sekmeli denetçi (*Sticker · Sayfa · Kesim · Kontrol*), altta durum çubuğu. Sürükle-taşı, köşeden ölçekle, üst tutamaçla döndür; Shift ile çoklu seçim, ok tuşlarıyla 0.1 mm it, hizalama/dağıtma düğmeleri. Hizalama kılavuzlarına yapışır (Alt kapatır). Görünüm: *Düzenle · Kesim sayfası · Baskı önizleme*. iPad'de denetçi alt sayfa, katmanlar soldan kayan panel; iki parmakla yakınlaştır.
3. **Kesim ayarları:** Ofset (mm, işaretli), sıkılık (dar girintileri köprüler), yumuşatma, sadeleştirme toleransı, köşe koruma, dışbükey köşe yuvarlama, opak PNG köşe yarıçapı, parça köprüleme, alfa eşiği. Her ayar sticker başına da ezilebilir.
4. **Kontrol:** Belirsiz yerleşimler, eşleşmeyen bölgeler (tuvalde numaralı işaret; *Bu bölgeye yerleştir* ya da *Yok say*), kullanılmayan PNG'ler, kesimler arası en az boşluk, sayfa kenarı, çakışma ve çizime girme uyarıları. Elle hazırlanmış bir Illustrator PDF'ini **referans** olarak yükleyip çizgileri üst üste ve ölçülerle karşılaştırabilirsin.
5. **Dışa aktarma:** PDF (Baskı/Kesim OCG katmanlı, isteğe bağlı spot renk `CutContour` ve taşma payı), yalnızca kesim PDF'i, SVG (mm), kesim silüetine göre kırpılmış sticker PNG'leri (.zip), baskıcı paketi (.zip + Türkçe README) ve proje .zip'i. Proje bu tarayıcıda otomatik kaydedilir; `?` ile kısayol listesi.

**PNG'si olmayan çizimler:** Tasarımda olup sticker PNG'si verilmeyen her çizim, tasarımın kendisinden kesilen bir *bölge öğesi* olur. Yalnızca tam tasarım + arka plan ile de çalışır.

**Tek sayfa modu:** Yalnızca sticker sayfası yüklenirse arka plan sayfanın kendisinden çıkarılır. Baskın düz renk ya da şeffaf alanlar arka plan sayılır, ondan ayrışan her ada bir şekil olur. Sticker'sız arka plan, şekillerin yeri çevre rengiyle doldurularak üretilir; böylece baskı sayfası yüklenen sayfanın birebir aynısı kalır, küçük süsler ve yazılar yerinde durur. Sayfa kenarına dayanan alanlar (başlık bandı, çerçeve, köşe süsü) kesilmez. Başlık ve yazılar da şekil sayılabilir; kesilmesin istediklerini katman listesinde makasla "sadece baskı" yap (silme: silinen şekil baskıdan da kalkar). Arka plan desenli, ızgaralı ya da resimliyse şekiller ayrılamaz; uygulama bunu söyler ve sticker'sız arka planı istemeyi önerir.

## CLI

Node 22 veya üstü gerekir.

```sh
npm ci
node bin/stickercut.mjs init "<pack klasörü>" --page 80x140          # pack.json + önizleme (tek sayfa varsa <pack>.arkaplan.png üretir)
node bin/stickercut.mjs build "<pack klasörü>/pack.json"              # 2 sayfalı PDF
node bin/stickercut.mjs doctor "<pack.json>" --strict                 # kalite raporu, hata varsa 1 döner
node bin/stickercut.mjs compare "<pack.json>" "<illustrator.pdf>"      # referansla ölçülü karşılaştırma
```

`build` bayrakları: `--offset mm`, `--white-border`, `--stroke pt`, `--closing mm`, `--corner-radius mm`, `--smooth mm`, `--simplify mm`, `--svg`, `--print-svg`, `--png-dir klasör --dpi 300`, `--package`, `--cut-only`, `--spot [--spot-name CutContour]`, `--no-layers`, `--bleed mm`. `init --no-regions` bölge öğelerini kapatır. Tüm komutlar `--json` ile makine okunur çıktı verir. Kalite istatistikleri için `npm run cut:stats -- pack.json`.

Klasörde birden çok pack varsa `init` için `--design`, `--background` ve `-o` kullan. Agent akışı [AGENTS.md](AGENTS.md) içinde; tasarım kararları [spec](docs/superpowers/specs/2026-09-28-stickercut-design.md) ve v2 planında.

## Kalite notları

- Kesim yolları alt piksel hassasiyetli iso-konturdan (işaretli uzaklık alanı) çıkar, ardından Gauss yumuşatma ve sabit teğetli en küçük kareler kübik Bézier fit ile tamamen eğri, G1 sürekli ve az anchor'lı hale gelir (fincan ≈ 10 anchor). Düz segment yalnızca köşe koruma açıkken üretilir.
- Varsayılan ofset 0 mm'dir: çizgi çizimin alfa kenarını izler ve ölçümlerde çizime en fazla ~0.1 mm girer. Elle hazırlanmış Illustrator referansları ±1 mm salınır; `compare` bu farkı ölçer.
- Şeffaflığı olmayan PNG'ler (fotoğraf/washi) yuvarlak köşeli dikdörtgen kesilir.

## Geliştirme

`npm test` (vitest), `npm run typecheck`, `npm run build:web`, `npm run test:e2e` (Playwright, Chromium + iPad WebKit; `npx playwright install chromium webkit`). Gerçek pack testi: `STICKERS_DIR=~/Desktop/stickers npx vitest run tests/real-pack.test.ts`. Web, Preact + signals; `src/core` saf TypeScript olup web worker ve CLI tarafından paylaşılır.

## Yayınlama

Kaynak kod `main`, yayımlanan statik dosyalar `gh-pages` dalındadır. `npm run publish:pages` tür denetimi, testler ve build'den sonra `dist/` çıktısını Pages dalına gönderir.
