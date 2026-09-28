# stickercut

Sticker pack PNG'lerinden iki sayfalı baskı ve kesim PDF'i üretir. Gerçek çizimler `~/Desktop/stickers/` altında kalır; repo'ya eklenmez.

## Pack hazırlama

1. Girdileri incele: aynı boyutta iki tasarım PNG'si (tam tasarım ve stickersız arka plan) ile şeffaf sticker PNG'leri gerekir.
2. CLI ile `node bin/stickercut.mjs init "<klasör>" --page 80x140 --json` çalıştır. Klasörde birden çok pack varsa `--design`, `--background` ve `-o` ile açık yollar ver.
3. Üretilen önizlemeyi görsel olarak kontrol et. Her sticker'ın konumunu, kesim silüetini ve `needsReview` işaretlerini incele.
4. Gerekiyorsa proje JSON'unda `x`, `y`, `scale`, `rotationDeg`, `printOnly` ve `overrides.offsetMm` değerlerini düzelt; `preview` komutuyla tekrar kontrol et.
5. `node bin/stickercut.mjs build "<pack.json>"` ile PDF üret. Uyarıları ve eksik sticker kaynaklarını kullanıcıya bildir.

Sayfa ölçüsü bilinmiyorsa mevcut baskı PDF'inin sayfa ölçüsünü incele veya kullanıcıya sor. Mevcut `.ai` ve `.pdf` dosyalarının üstüne yazma. Kesim çizgilerini gözle doğrulamadan işi tamamlanmış sayma.

## Geliştirme

`npm test`, `npm run typecheck` ve `npm run build:web` komutlarını çalıştır. Web ve CLI aynı `src/core` motorunu kullanır. Her gerçek pack testi harici `STICKERS_DIR` ile çalışır; PNG/PDF/ZIP çıktıları Git'e eklenmez.
