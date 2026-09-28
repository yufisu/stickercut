# stickercut — Tasarım (Spec)

Tarih: 2026-09-28
Durum: Onay bekliyor

## 1. Amaç

Sticker pack'lerinin baskı + kesim PDF'ini hazırlama işini otomatikleştirmek. Bugün
Illustrator'da elle yapılan akış (sticker'ları yerleştirme → her biri için Image Trace →
temizleme → Simplify → kırmızı stroke → ikinci artboard'a taşıma) tek adımda yapılmalı;
küçük ayarlar elle düzeltilebilmeli.

**Kullanıcılar**
- Yusuf (Mac, CLI + web arayüzü)
- Kız arkadaşı / çizer (iPad Safari, web arayüzü)
- AI agent'lar (Claude Code vb., CLI üzerinden)

**Başarı kriteri**
- Kahve pack'i (`~/Desktop/stickers/çay ve kahve`) için araç, elle hazırlanan
  `kahve pack.pdf` ile eşdeğer bir PDF'i dakikalar değil saniyeler içinde üretir.
- Kesim çizgileri elle yapılandan en az onun kadar temiz (baklavalardaki tırtık yok).
- iPad'den sunucusuz çalışır; agent'lar aynı sonucu CLI ile üretebilir.

**Kapsam dışı**
- 33×48 tabakaya dizme (imposition) — baskıcı yapıyor.
- Otomatik döndürme tespiti — döndürme elle yapılır.
- AI/LLM entegrasyonu (ör. Jev) — görev tamamen deterministik görüntü işleme.

## 2. Gözlemlenen girdi/çıktı (kahve pack'inden)

- **Girdi:**
  - Tam tasarım PNG'si (1600×2800) ve aynı boyutta, sticker'ları çıkarılmış arka plan PNG'si.
  - Her sticker için ayrı, şeffaf arka planlı PNG. Çözünürlükleri 2048–3543 px arasında, tasarımdaki hallerinden daha yüksek.
- **Sticker PNG'lerinin özellikleri:**
  - Kaçak yarı saydam lekeler olabiliyor (ör. `kahvee.png` sol üst köşe).
  - Aynı sticker farklı ölçeklerde birden fazla kez kullanılabiliyor (3 baklava, 2'şer fincan).
- **Son PDF tam tasarımdan farklı olabiliyor.** Kahve pack'inde bir sticker değiştirilmiş, "yonbuki" imzası eklenmiş, yani elle düzenleme şart.
- **Çıktı:**
  - PDF, 80×140 mm (sayfa boyutu pack'e göre değişir), 2 sayfa.
  - 1. sayfa baskı, 2. sayfa kesim çizgileri.
  - Kesim çizgisi RGB kırmızı (1,0,0) stroke, 1 pt, fill yok. Spot renk ve katman yok.
  - Sadece dış silüet kesilir, iç boşluklar (fincan kulpu) kesilmez.
- **Klasör yapıları pack'ten pack'e değişiyor.** Araç belirli bir düzen beklemez.

## 3. Mimari

Tek TypeScript motoru, iki kabuk:

```
stickercut/
  core/   saf TS — DOM/Node bağımlılığı yok; girdi/çıktı: RGBA raster + JSON + PDF bytes
  web/    Vite SPA — GitHub Pages'e deploy (public repo), tamamen istemci tarafı
  cli/    Node komutu — PNG decode/encode + dosya sistemi, core'u çağırır
```

Web ve CLI aynı `core` fonksiyonlarını çağırır, aynı `pack.json`'dan aynı PDF çıkar.
Sunucu yok. Dosyalar cihazdan çıkmaz.

### 3.1 Core modülleri

Her modül bağımsız test edilebilir.

1. **`roles`** — girdi dosyalarına rol atar.
   - Aynı boyutlu iki büyük görüntü tam tasarım ve arka plan olarak alınır. İçerik farkı (opak/renkli piksel) fazla olan tam tasarımdır.
   - Geri kalanlar `sticker` rolü alır.
   - Belirsizse rolsüz bırakır, kullanıcı atar.
2. **`match`** — sticker kopyalarını bulur.
   1. Tam tasarım ile arka planın piksel farkından bir maske çıkarılır.
   2. Morfolojik temizlemeden sonra bağlı bileşenlere ayrılır. Her bileşen bir kopya adayıdır.
   3. Her aday için her sticker denenir. Ölçek, adayın bounding box'ı ile sticker'ın alfa bounding box'ının oranıdır.
   4. Sticker o ölçekte adayın üzerine konup maske IoU'su ve renk benzerliği (NCC) hesaplanır. En iyi sticker seçilir, konum ±birkaç px'lik lokal aramayla hassaslaştırılır.
   5. Skor eşiğin altındaysa kopya `needsReview: true` olarak işaretlenir.
   - Hesaplamalar küçültülmüş kopyalar üzerinde yapılır (ör. uzun kenar ≤ 1200 px). iPad'de birkaç saniyede bitmesi hedeflenir.
3. **`contour`** — sticker alfasından kesim yolu üretir.
   1. Alfa eşiklenir (varsayılan 128).
   2. En büyük bağlı bileşen tutulur (kaçak lekeler atılır).
   3. İç boşluklar doldurulur.
   4. Offset mm cinsinden uygulanır (distance transform ile).
   5. Marching squares ile kontur çıkarılır.
   6. Douglas-Peucker ile sadeleştirilir, ardından kübik bezier'e fit edilir.
   - Sonuç sticker'ın yerel koordinatlarında kapalı tek bir yoldur. Sticker bazında cache'lenir, ölçek ve döndürme transform ile uygulanır.
4. **`pdf`** — pdf-lib ile 2 sayfalı PDF yazar.
   - **1. sayfa:**
     - Arka plan tüm sayfayı kaplar.
     - Sticker'lar orijinal çözünürlükte eklenir. Her sticker dosyası bir kez gömülür, kopyalar aynı nesneye referans verir.
     - `whiteBorder` açık olan kopyaların altına kesim yolu beyaz fill ile çizilir.
   - **2. sayfa:** Tüm kesim yolları, stroke RGB(1,0,0), `strokeWidthPt`, fill yok.
   - `printOnly` öğeler sadece 1. sayfaya gider.
   - px→mm dönüşümü: `page.widthMm / design.widthPx`.
5. **`project`** — `pack.json` okuma, yazma, doğrulama ve varsayılanlar. `.zip` export/import: `pack.json` ile referans verilen PNG'ler.

### 3.2 `pack.json` şeması

```jsonc
{
  "version": 1,
  "page": { "widthMm": 80, "heightMm": 140 },
  "files": {
    "design": "turk kahvesi.png",          // tam tasarım (yerleştirme referansı)
    "background": "turk kahvesi arka.png"  // 1. sayfanın zemini
  },
  "defaults": {
    "offsetMm": 0,
    "whiteBorder": false,
    "strokeWidthPt": 1,
    "smoothing": 0.5,        // 0 = ham kontur, 1 = çok yumuşak
    "alphaThreshold": 128
  },
  "items": [
    {
      "id": "i1",
      "file": "kahvee.png",
      "x": 812.4, "y": 250.1,   // merkez, tasarım px koordinatında
      "scale": 0.176,            // sticker px → tasarım px
      "rotationDeg": 0,
      "printOnly": false,        // true: kesim çizgisi yok (imza vb.)
      "needsReview": false,
      "matchScore": 0.94,
      "overrides": { "offsetMm": 1.5 }  // opsiyonel, defaults'u ezer
    }
  ]
}
```

Dosya yolları `pack.json`'a göre görecelidir. Konumlar tasarım pikseli cinsindendir.
Böylece sayfa boyutu değişirse yerleşim bozulmaz.

## 4. Web arayüzü (iPad + Mac)

1. **Dosyalar:**
   - iPad'de Dosyalar'dan çoklu seçim, Mac'te sürükle-bırak.
   - `roles` sonucu bir listede gösterilir, yanlışsa açılır menüden değiştirilir.
   - "Yerleştir" butonu motoru çalıştırır.
   - `.zip` proje de açılabilir.
2. **Düzenleyici:**
   - **Önizleme:** Arka plan, sticker'lar ve kesim çizgileri (aç/kapa).
   - **Dokunmatik kontroller:** Seç, sürükle, köşe tutamacıyla ölçekle ve döndür, sil.
   - **Kontrol listesi:** `needsReview` kopyalar turuncu çerçeveli.
   - **"Sticker ekle":** Yüklenen sticker'lardan birini sayfaya koyar.
   - **"Sadece baskı" seçeneği:** İmza gibi kesilmeyecek öğeler için.
   - **Yan panel:** Genel ayarlar (sayfa mm, offset, beyaz kenar, çizgi kalınlığı, yumuşatma) ve seçili öğeye özel override'lar.
3. **Çıktı:**
   - "PDF oluştur" PDF'i indirir. iPad'de paylaşım menüsü açılır (Dosyalar, AirDrop, WhatsApp).
   - "Projeyi dışa aktar" `.zip` üretir.
4. **Otomatik kayıt:** Çalışma IndexedDB'ye kaydedilir. Sayfa kapansa da kaldığı yerden devam edilir.

Dokunmatik öncelikli tasarlanır: büyük tutamaçlar, hover'a bağlı etkileşim yok.
Kesim önizlemesi ayar değiştikçe canlı güncellenir. Kontur hesabı Web Worker'da yapılır, arayüz donmaz.

## 5. CLI

```
stickercut init <klasör> [--design f] [--background f] [--page 80x140]
    → rolleri tanır, yerleştirir, <klasör>/pack.json + preview.png yazar
stickercut build <klasör> [--offset 1.5] [--white-border] [--stroke 1] [-o out.pdf]
    → pack.json'dan PDF üretir (bayraklar defaults'u o çalıştırma için ezer)
stickercut preview <klasör> [--cut]   → preview.png (agent'ın görsel kontrolü için)
stickercut export <klasör> -o pack.zip / stickercut import pack.zip <klasör>
```

- Çıktı insan tarafından okunabilir (Türkçe). `--json` bayrağıyla makine tarafından okunabilir.
- Hata varsa çıkış kodu 0 olmaz.
- Repo'da `AGENTS.md` ve bir Claude Code skill'i bulunur. "Şu pack'in kesim dosyasını hazırla" isteğinde agent'ın izleyeceği adımlar: init → preview'e bak → gerekirse `pack.json`'u düzelt → build.

## 6. Hata durumları

Hiçbiri sessiz geçmez. Her biri açık bir Türkçe mesaj üretir.

| Durum | Davranış |
|---|---|
| Tam tasarım veya arka plan yok / belirsiz | Rol atanmasını ister (web) / `--design --background` ister (CLI) |
| Bir sticker tasarımda bulunamadı | "Kullanılmayan sticker" uyarısı, iş devam eder |
| Tasarımda eşleşmeyen bölge kaldı | "Eşleşmeyen bölge (sticker PNG'si eksik mi?)" + önizlemede işaret |
| Düşük eşleşme skoru | `needsReview`, önizlemede turuncu |
| Sayfa oranı ≠ tasarım oranı (>%1) | Uyarı, en yakın oranı öner |
| Sticker'da şeffaflık yok / maske boş | O sticker için hata, kesim çizgisi üretilmez |
| Sticker şekli birden çok parçalı | En büyük parça kesilir, diğer parça büyükse (>%5 alan) uyarı |

## 7. Test

- **Birim testleri (vitest, sentetik veri, repo'da):**
  - `contour`: Yarıçapı r olan dairenin konturu ≈ r olur. `offsetMm` = 2 verilince yarıçap tam 2 mm büyür. Kaçak leke atılır, iç boşluk doldurulur.
  - `match`: Bilinen sticker'lar bilinen konum ve ölçekte sentetik bir arka plana basılır. Motor bunları ±1 px ve ±%1 ölçek içinde bulur. Tekrarlı kopyalar ayrı ayrı bulunur.
  - `pdf`: Çıktı 2 sayfalıdır, MediaBox mm'ye göre doğrudur, 2. sayfadaki yol sayısı kesilen öğe sayısına eşittir, gömülü görüntü sayısı benzersiz dosya sayısına eşittir.
  - `project`: Şema doğrulama ve zip round-trip.
- **Gerçek pack testi (sadece yerelde):** `STICKERS_DIR` ortam değişkeni verilirse kahve pack'i üzerinde uçtan uca çalışır. 13 kopya (10 fincan, 3 baklava) bulunmalı. Gerçek çizimler repo'ya **asla** girmez (`.gitignore` + testte sadece harici yol).
- **Manuel doğrulama:**
  - Üretilen PDF Illustrator'da açılıp iki sayfanın düzgün geldiği kontrol edilir.
  - Web arayüzü iPad Safari'de denenir.

## 8. Teknoloji

- TypeScript, Vite (web), Node 20+ (CLI), vitest.
- `pdf-lib` (PDF), `fflate` (zip), `pngjs` (CLI'da saf JS PNG decode/encode). Web'de tarayıcının kendi decoder'ı kullanılır.
- Görüntü işleme (fark maskesi, bağlı bileşen, distance transform, marching squares, NCC) core'da el yazımı saf TS. OpenCV.js'in ~8 MB'lık wasm'ı gerekmez. Performans yetmezse sonradan eklenebilir.
- Deploy: GitHub Actions → GitHub Pages (public repo).
