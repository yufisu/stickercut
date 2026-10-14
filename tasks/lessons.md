# Dersler (stickercut)

Format: **Hata** → **Neden** → **Kural**. Her kullanıcı düzeltmesinden sonra hemen güncellenir.

## 2026-10-14
- **Hata:** Kesim yolu düz çizgi + eğri karışık üretiliyordu (birleşimlerde kırılma). **Neden:** fit fonksiyonu tolerans içindeki aralıkları düz segmente düşürüyordu; teğet sürekliliği yoktu. **Kural:** Kesim yolu üretiminde G1 sürekliliği testle (`isG1`) zorunlu; düz segment yalnızca köşe koruması açıkken.
- **Hata:** CLI `init` çok pack'li klasörde (çay + kahve) rol bulamadı. **Neden:** aynı boyutta birden çok opak çift. **Kural:** Gerçek pack testlerinde `--design/--background` açık ver; UI'da seçim alanı göster.
