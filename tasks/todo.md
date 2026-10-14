# stickercut v2 — yapılacaklar

Plan: `~/.claude/plans/noble-finding-aho.md` (onaylandı, 14 Ekim 2026). Kararlar: Atölye teması, sıfır ofset varsayılanı, uçtan uca, bitince gh-pages yayını.

## Faz 0 — Araç zinciri
- [x] tasks/todo.md + tasks/lessons.md
- [ ] preact, @preact/signals, @playwright/test; JSX ayarı (tsconfig + vite)
- [ ] Playwright smoke (mevcut UI'a karşı), `npm run test:e2e`

## Faz 1 — Kesim motoru v2
- [ ] distance.ts: signedDistance / thresholdField / closeMask / openMask (Float32)
- [ ] shape.ts: coverageMask, selectParts, bridgeParts, traceCrack, isoContour, roundedRect, RLE, regionOutline + testler
- [ ] spline.ts: resample, gaussian, tangents, detectCorners, fitG1Closed, isG1 + testler
- [ ] contour.ts: mm seçenekleri, pipeline sırası, clearance; contour testleri
- [ ] project.ts v2 ayarlar + migrasyon; pipeline createCutCache + mesajlar; CLI bayrakları
- [ ] Bölge öğeleri (file null + region rle), initPack REGION_ITEM, pdf clip, preview
- [ ] checks.ts: MIN_GAP / OVERLAP (eğri) / PAGE_MARGIN; cut-stats script; gerçek pack iddiaları

## Faz 2 — Araçlar
- [ ] geometry helpers; pdf-read.ts + compare.ts + testler; pipeline.compareWithReference; CLI compare
- [ ] pdf.ts seçenekleri (pages, OCG, labels, bleed, spot) + testler
- [ ] svg.ts, png-encode.ts, export-png.ts, package.ts + testler; CLI build bayrakları; doctor
- [ ] index.ts export'ları; AGENTS/README/skill

## Faz 3 — Web mimarisi
- [ ] app/store + actions + cut-key + history (coalesce) + presets + sample-pack
- [ ] engine v2 (kuyruk, ilerleme, iptal, akış) + core jeneratörler
- [ ] storage anahtar ayrımı; JobOverlay

## Faz 4 — Editör (Atölye)
- [ ] EditorScreen: ToolRail, Inspector sekmeleri, LayersPanel, StatusBar, ViewModeSwitch, ZoomControls
- [ ] editor/: camera, renderer, controller, hit, snap, rulers, grid, align
- [ ] SetupScreen: DropZone, FileCard + rol çipleri, PageSetup, PresetPicker, örnek pack, referans PDF
- [ ] iPad: BottomSheet, SlideOver, alt araç çubuğu, safe-area, paylaşım toast'u
- [ ] Kontrol sekmesi + referans karşılaştırma + dışa aktarma seçenekleri

## Faz 5 — Cila ve yayın
- [ ] Tema token'ları + koyu toggle, klavye haritası, kısayol yardımı, erişilebilirlik
- [ ] e2e genişletme; gerçek pack görsel doğrulama; README/AGENTS; publish:pages

## Gözden geçirme
(fazlar bitince doldurulacak)
