# stickercut v2 — yapılacaklar

Plan: `~/.claude/plans/noble-finding-aho.md` (onaylandı, 14 Ekim 2026). Kararlar: Atölye teması, sıfır ofset varsayılanı, uçtan uca, bitince gh-pages yayını.

## Faz 0 — Araç zinciri
- [x] tasks/todo.md + tasks/lessons.md
- [x] preact, @preact/signals, @playwright/test; JSX ayarı (tsconfig + vite)
- [x] Playwright smoke, `npm run test:e2e` — yeni arayüzde Chromium + iPad WebKit geçiyor

## Faz 1 — Kesim motoru v2
- [x] distance.ts: signedDistance / thresholdField / closeMask / openMask (Float32)
- [x] shape.ts: alphaCoverage, selectParts, bridgeParts, traceCrack, isoContour, roundedRect, RLE, regionOutline + testler
- [x] spline.ts: resample, gaussian, tangents, detectCorners, fitG1Closed, isG1 + testler
- [x] contour.ts: mm seçenekleri, pipeline sırası, clearance; contour testleri
- [x] project.ts v2 ayarlar + migrasyon; pipeline createCutCache + mesajlar; CLI bayrakları
- [x] Bölge öğeleri (file null + region rle), initPack REGION_ITEM, pdf clip, preview
- [x] checks.ts: MIN_GAP / OVERLAP (eğri) / PAGE_MARGIN; cut-stats script; gerçek pack iddiaları (kahve: 13/13 G1, 6–12 anchor, giriş ≤ 0.09 mm)

## Faz 2 — Araçlar
- [x] geometry helpers; pdf-read.ts + compare.ts + testler; pipeline.compareWithReference; CLI compare
- [x] pdf.ts seçenekleri (pages, OCG, labels, bleed, spot) + testler
- [x] svg.ts, png-encode.ts, export-png.ts, package.ts + testler; CLI build bayrakları; doctor
- [x] index.ts export'ları
- [x] AGENTS/README/skill

## Faz 3 — Web mimarisi
- [x] app/store + actions + cut-key + history (coalesce) + presets + sample-pack
- [x] engine v2 (kuyruk, ilerleme, iptal, akış) + core jeneratörler
- [x] storage anahtar ayrımı (eski kayıt taşınır); JobOverlay

## Faz 4 — Editör (Atölye)
- [x] EditorScreen: ToolRail, Inspector sekmeleri, LayersPanel, StatusBar, ViewModeSwitch, ZoomControls
- [x] editor/: camera, renderer, controller, hit, snap, rulers, grid, align (alt ajan + testler)
- [x] SetupScreen: DropZone, FileCard + rol seçimi, PageSetup, PresetPicker, örnek pack
- [x] iPad: BottomSheet, SlideOver, alt araç çubuğu, safe-area, paylaşım toast'u
- [x] Kontrol sekmesi + referans karşılaştırma + dışa aktarma menüsü

## Faz 5 — Cila ve yayın
- [x] Tema token'ları + koyu toggle, klavye haritası, kısayol yardımı, erişilebilirlik temelleri
- [x] e2e yeni akış; gerçek kahve pack'i tarayıcıda uçtan uca (PDF + baskıcı paketi); README/AGENTS
- [x] tests/web/actions.test.ts (eski files.test yerine)
- [x] publish:pages + main push

## Gözden geçirme (14 Ekim 2026)
- Motor: 13/13 kahve kesimi G1, 6–12 anchor, düz segment yok, çizime giriş ≤ 0.09 mm; sticker başına 80–520 ms (Mac, node).
- Araçlar: bölge öğeleri (PNG'siz), compare/doctor, OCG katmanlı/spot renkli PDF, SVG, sticker PNG zip, baskıcı paketi.
- Web: Preact + signals, worker v2 (ilerleme/iptal), Atölye editör; ana chunk 54 kB gz, worker 508 kB (pdf-lib).
- Açık noktalar: Illustrator'da OCG katmanlarının görünümü kullanıcı tarafından denenmeli; iPad'de gerçek cihaz süresi ölçülmedi (tahmin: 2× Mac); pinch zoom yalnızca kodla doğrulandı.
