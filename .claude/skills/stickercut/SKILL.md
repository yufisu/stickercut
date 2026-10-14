---
name: stickercut
description: Bir sticker pack klasöründen baskı ve kesim çizgisi PDF'i hazırlar; kaliteyi doctor/compare ile doğrular.
---

Repo kökündeki `AGENTS.md` dosyasının "Pack hazırlama" adımlarını uygula: `init` → önizlemeyi aç ve gözle kontrol et → `doctor --json` → gerekirse `pack.json` düzelt → `build`. Illustrator referansı varsa `compare` çalıştır. Eksik veya belirsiz sticker eşleşmelerini, bölge öğelerini ve doctor uyarılarını kullanıcıya bildir.
