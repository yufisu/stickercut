# stickercut

Sticker pack PNG'lerinden iki sayfalı baskı ve kesim PDF'i üretir. Gerçek çizimler `~/Desktop/stickers/` altında kalır; repo'ya eklenmez.

## Pack hazırlama

1. Girdileri incele: en iyisi aynı boyutta iki tasarım PNG'si (tam tasarım ve stickersız arka plan) ile şeffaf sticker PNG'leri. Sticker PNG'si eksikse eşleşmeyen çizimler tasarımdan kesilen *bölge öğesi* olur (`file: null`, `region` alanı). Klasörde yalnızca sticker sayfası varsa **tek sayfa modu** çalışır: arka plan sayfadan üretilip `<pack>.arkaplan.png` olarak yazılır (düz renk ya da şeffaf arka plan gerekir; desenliyse `SHEET_BUSY` hatası).
2. `node bin/stickercut.mjs init "<klasör>" --page 80x140 --json` çalıştır. Klasörde birden çok pack varsa `--design`, `--background` ve `-o` ile açık yollar ver.
3. Üretilen önizlemeyi görsel olarak kontrol et; `needsReview` öğelerini ve `REGION_ITEM` mesajlarını incele.
4. `node bin/stickercut.mjs doctor "<pack.json>" --json` ile kalite raporunu al: her kesim G1 ve `lines: 0` olmalı; `MIN_GAP`, `PAGE_MARGIN`, `OVERLAP`, `TIGHT_SPOT` uyarılarını kullanıcıya bildir. Gerekirse `pack.json`'da `x`, `y`, `scale`, `rotationDeg`, `printOnly`, `overrides.*` düzelt ve `preview` ile tekrar bak.
5. Elle hazırlanmış bir Illustrator PDF'i varsa `compare "<pack.json>" "<ref.pdf>" --json` ile ölçülü karşılaştır (el çizimi referanslar ±1 mm salınabilir; önerilen ofseti değerlendir).
6. `build "<pack.json>"` ile PDF üret; baskıcı paketi için `--package`, SVG için `--svg`, spot renk için `--spot`. Uyarıları ve eksik kaynakları kullanıcıya bildir.

Sayfa ölçüsü bilinmiyorsa mevcut baskı PDF'inin sayfa ölçüsünü incele veya kullanıcıya sor. Mevcut `.ai` ve `.pdf` dosyalarının üstüne yazma. Kesim çizgilerini gözle doğrulamadan işi tamamlanmış sayma.

## Ayarlar (pack.json `defaults`, öğe başına `overrides`)

`offsetMm` (işaretli), `closingMm` (sıkılık), `cornerRadiusMm`, `rectCornerRadiusMm`, `smoothMm`, `simplifyMm`, `cornerAngleDeg` (0 = kapalı), `bridgeMm`, `minPartRatio`, `minGapMm`, `tightMm`, `whiteBorder`, `strokeWidthPt`, `alphaThreshold`. v1 dosyalardaki `smoothing` otomatik taşınır.

## Geliştirme

`npm test`, `npm run typecheck`, `npm run build:web`, `npm run test:e2e`. Web (`web/`, Preact + signals, worker) ve CLI (`src/cli`) aynı `src/core` motorunu kullanır; core DOM/Node API'si içermez. Gerçek pack testi harici `STICKERS_DIR` ile çalışır; PNG/PDF/ZIP çıktıları Git'e eklenmez. `tasks/todo.md` ve `tasks/lessons.md` güncel tutulur.
