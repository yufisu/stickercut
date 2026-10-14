# Dersler (stickercut)

Format: **Hata** → **Neden** → **Kural**. Her kullanıcı düzeltmesinden sonra hemen güncellenir.

## 2026-10-14
- **Hata:** Kesim yolu düz çizgi + eğri karışık üretiliyordu (birleşimlerde kırılma). **Neden:** fit fonksiyonu tolerans içindeki aralıkları düz segmente düşürüyordu; teğet sürekliliği yoktu. **Kural:** Kesim yolu üretiminde G1 sürekliliği testle (`isG1`) zorunlu; düz segment yalnızca köşe koruması açıkken.
- **Hata:** CLI `init` çok pack'li klasörde (çay + kahve) rol bulamadı. **Neden:** aynı boyutta birden çok opak çift. **Kural:** Gerçek pack testlerinde `--design/--background` açık ver; UI'da seçim alanı göster.
- **Hata:** Tuval rozetleri (HUD) `left: NaN` gibi görünmez konumlandı. **Neden:** Preact 11 sayısal `style` değerlerine otomatik `px` eklemiyor. **Kural:** Inline style'da her zaman birimli string kullan (`\`${x}px\``); sayısal değer yok.
- **Hata:** `git add -A` alt ajan worktree'lerini (`.claude/worktrees/*`) gitlink olarak commit'e soktu. **Neden:** worktree'ler repo içinde ve ignore edilmemişti. **Kural:** Worktree ile ajan kullanırken önce `.claude/worktrees/` ignore et; commit öncesi `git status` çıktısında `.claude/` görünmemeli.
- **Hata:** Ana web bundle'ı pdf-lib'i yükledi (573 kB). **Neden:** `pipeline.ts`'ten tek bir yardımcı (`regionItemText`) import edilince tüm pipeline ve pdf-lib ana iş parçacığına geldi. **Kural:** Ana iş parçacığı yalnızca hafif core modülleri import eder; ağır işler worker'da. Build boyutunu her UI değişikliğinde kontrol et (hedef ana chunk ≤ 70 kB gz).
- **Hata:** Playwright strict mode aynı denetçi DOM'unu iki kez buldu. **Neden:** Kompakt alt sayfa CSS ile gizlenmişti ama DOM'da duruyordu. **Kural:** Düzene bağlı panelleri CSS'le gizleme, JS media query ile koşullu render et.
