# stickercut

Tam tasarım, stickersız arka plan ve tek tek şeffaf sticker PNG'lerinden düzenlenebilir vektör kesim çizgileri olan iki sayfalı PDF üretir. İlk sayfa baskı, ikinci sayfa kesim içindir.

**Canlı uygulama:** https://yufisu.github.io/stickercut/

## Web

`npm ci && npm run dev` ile yerel arayüzü aç. iPad Safari ve Mac tarayıcısında PNG'leri seç, rolleri denetle, **Yerleştir**'e dokun; ardından sticker'ları taşı, ölçekle veya döndür. PDF ve proje ZIP'i arayüzden dışa aktar. İşleme tarayıcıda yapılır; dosyalar sunucuya yüklenmez. Proje aynı tarayıcıda otomatik kaydedilir.

Dosya seçimi ekranında yanlış yüklediğin PNG'yi **Kaldır** ile listeden çıkarabilir, **Baştan başla** ile tüm dosyaları ve otomatik kaydı temizleyebilirsin. Yeni dosyaları aynı alandan ekleyebilirsin; editöre geçmen gerekmez.

Sticker seçiliyken **Kesim ofseti (mm)** alanına `-0.5` girerek yalnızca o sticker'ın kesim çizgisini yarım milimetre içeri alabilirsin. Pozitif değer çizgiyi dışarı taşır; alanı boşaltmak genel ayara döner. **Nokta azaltma** kaydırıcısı çizgideki gereksiz noktaları azaltır ve seçili sticker'ın nokta sayısı anlık gösterilir. Birden fazla tam tasarım/arka plan adayı varsa dosya yükleme ekranındaki seçim alanlarını veya editördeki **Kaynak görseller** bölümünü kullan.

## CLI

Node 22 veya üstü gerekir.

```sh
npm ci
node bin/stickercut.mjs init "<pack klasörü>" --page 80x140
node bin/stickercut.mjs build "<pack klasörü>/pack.json"
```

Klasörde başka PNG'ler de varsa `init` için `--design`, `--background` ve `-o` kullan. Ayrıntılı agent akışı [AGENTS.md](AGENTS.md) içinde; tasarım kararları [spec](docs/superpowers/specs/2026-09-28-stickercut-design.md) içinde.

Gerçek kahve örneğinde üç baklava için ayrı kaynak PNG yok. Bu üç otomatik eşleşme inceleme gerektirir; doğru kaynak eklenmeden baskıya hazır kabul edilmemelidir.

## Yayınlama

Kaynak kod `main`, yayımlanan statik dosyalar `gh-pages` dalındadır. Yeni sürüm için `npm run publish:pages` çalıştır: önce tür denetimi, testler ve web build'i koşar; sonra yalnızca `dist/` çıktısını Pages dalına gönderir. GitHub Pages, bu dalın kökünden otomatik yayın yapar.
