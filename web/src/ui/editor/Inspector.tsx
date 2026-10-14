import { useState } from 'preact/hooks';
import { store, primaryItem, selectedItems, itemStatus, messages, warningCount, busy, type InspectorTab } from '../../app/store';
import {
  history, setPlacement, setItemFields, setOverride, setDefaults, setPage, setBase, approve, deleteSelected, duplicateSelected,
  reorder, alignSelected, distributeSelected, itemBounds, applyPreset, placeInRegion, dismissMarker, addStickerItem, select,
} from '../../app/actions/edit';
import { newProject } from '../../app/actions/files';
import { savePrefs } from '../../app/actions/autosave';
import { exportPdf, exportCutOnlyPdf, exportZip, exportSvg, exportPngs, exportPackage } from '../../app/actions/export';
import { loadReference, clearReference } from '../../app/actions/reference';
import { editorApi } from '../../app/editor-api';
import { CUT_PRESETS, presetOf } from '../../app/presets';
import { groupMessages } from '../../app/messages';
import { STATUS_LABEL } from '../../app/status';
import { mmPerDesignPx, itemLabel, isRegionItem, DEFAULT_SETTINGS, type Settings, type Item } from '../../../../src/core/project';
import { NumberField, Slider, Segmented, Tabs, Check, Field, Select, IconButton } from '../shared/controls';
import { Icon } from '../shared/Icon';
import { ThemeToggle } from '../shared/ThemeToggle';
import { MOD } from '../../platform/env';

const f1 = (v: number) => Math.round(v * 10) / 10;
const same = <T,>(vals: T[]): T | null => (vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null);
const group = { onStart: () => history.beginGroup(), onEnd: () => history.endGroup() };

// ---------- Sticker ----------
function StickerTab() {
  const doc = store.doc.value!;
  const items = selectedItems.value;
  const primary = primaryItem.value;
  store.cutsVersion.value;
  if (!items.length) {
    return (
      <>
        <section>
          <h3>Sticker</h3>
          <p class="lead">Düzenlemek için tuvalde bir sticker'a dokun. Shift ile birden çok seç; sürükleyerek taşı, köşeden ölçekle, üstteki tutamaçla döndür.</p>
        </section>
        <section>
          <h3>Hizalama</h3>
          <p class="lead">İki veya daha çok sticker seçince hizalama ve dağıtma düğmeleri burada görünür.</p>
        </section>
      </>
    );
  }
  const ids = items.map((i) => i.id);
  const mm = mmPerDesignPx(doc);
  const d = doc.defaults;
  const bounds = items.map(itemBounds);
  const w = same(bounds.map((b) => (b ? f1((b.maxX - b.minX) * mm.x) : NaN)));
  const h = same(bounds.map((b) => (b ? f1((b.maxY - b.minY) * mm.y) : NaN)));
  const x = same(items.map((i) => f1(i.x * mm.x))), y = same(items.map((i) => f1(i.y * mm.y)));
  const rot = same(items.map((i) => i.rotationDeg));
  const printOnly = same(items.map((i) => i.printOnly));
  const review = items.some((i) => i.needsReview);
  const offset = same(items.map((i) => i.overrides.offsetMm ?? null));
  const closing = same(items.map((i) => i.overrides.closingMm ?? null));
  const corner = same(items.map((i) => i.overrides.cornerAngleDeg ?? null));
  const wb = same(items.map((i) => i.overrides.whiteBorder === undefined ? '' : i.overrides.whiteBorder ? '1' : '0'));
  const status = primary ? itemStatus.value.get(primary.id) ?? 'pending' : 'pending';
  const stat = primary ? store.cuts.get(primary.id)?.stats : undefined;
  const stickers = [...store.files.value.values()].filter((f) => f.name !== doc.files.design && f.name !== doc.files.background);
  const resize = (dim: 'w' | 'h', v: number) => {
    const updates = new Map<string, Partial<Item>>();
    items.forEach((i, k) => {
      const b = bounds[k];
      if (!b) return;
      const cur = dim === 'w' ? (b.maxX - b.minX) * mm.x : (b.maxY - b.minY) * mm.y;
      if (cur > 0) updates.set(i.id, { scale: i.scale * (v / cur) });
    });
    setPlacement(updates);
  };
  return (
    <>
      <section>
        <h3>
          <span>{items.length > 1 ? `${items.length} sticker` : primary ? itemLabel(primary) : ''}</span>
          <span class={`badge ${status}`}>{STATUS_LABEL[status]}</span>
        </h3>
        {primary && isRegionItem(primary) ? <p class="lead">Tasarımdan alınan bölge: PNG'si yok, görsel ve kesim tasarımın kendisinden geliyor.</p> : null}
        {review ? <div class="row"><button type="button" class="btn sm primary" onClick={() => approve(ids)}><Icon name="check" size={14} /> Yeri doğru, onayla</button></div> : null}
        <div class="grid2">
          <Field label="X (mm)"><NumberField value={x} unit="mm" step={0.1} digits={1} ariaLabel="X konumu" onCommit={(v) => setPlacement(new Map(items.map((i) => [i.id, { x: v / mm.x }])))} /></Field>
          <Field label="Y (mm)"><NumberField value={y} unit="mm" step={0.1} digits={1} ariaLabel="Y konumu" onCommit={(v) => setPlacement(new Map(items.map((i) => [i.id, { y: v / mm.y }])))} /></Field>
          <Field label="Genişlik"><NumberField value={w} unit="mm" step={0.5} min={1} digits={1} ariaLabel="Genişlik" onCommit={(v) => resize('w', v)} /></Field>
          <Field label="Yükseklik"><NumberField value={h} unit="mm" step={0.5} min={1} digits={1} ariaLabel="Yükseklik" onCommit={(v) => resize('h', v)} /></Field>
          <Field label="Döndürme"><NumberField value={rot} unit="°" step={1} digits={1} ariaLabel="Döndürme" onCommit={(v) => setItemFields(ids, { rotationDeg: v })} /></Field>
          {primary && !isRegionItem(primary) && items.length === 1 ? (
            <Field label="Dosya"><Select value={primary.file ?? ''} ariaLabel="Sticker dosyası" options={stickers.map((f) => ({ value: f.name, label: f.name }))} onChange={(v) => setItemFields(ids, { file: v })} /></Field>
          ) : null}
        </div>
        {items.length >= 2 ? (
          <div class="row">
            {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((m) => (
              <IconButton key={m} class="quiet" icon={({ left: 'alignLeft', hcenter: 'alignH', right: 'alignRight', top: 'alignTop', vcenter: 'alignV', bottom: 'alignBottom' } as const)[m]}
                label={({ left: 'Sola hizala', hcenter: 'Yatay ortala', right: 'Sağa hizala', top: 'Üste hizala', vcenter: 'Dikey ortala', bottom: 'Alta hizala' })[m]} onClick={() => alignSelected(m)} />
            ))}
            {items.length >= 3 ? <>
              <IconButton class="quiet" icon="distributeH" label="Yatay dağıt" onClick={() => distributeSelected('x')} />
              <IconButton class="quiet" icon="distributeV" label="Dikey dağıt" onClick={() => distributeSelected('y')} />
            </> : null}
          </div>
        ) : null}
      </section>
      <section>
        <h3>Bu sticker'ın kesimi</h3>
        <div class="grid2">
          <Field label="Kesim ofseti">
            <NumberField value={offset ?? d.offsetMm} unit="mm" step={0.1} digits={2} ariaLabel="Bu sticker için kesim ofseti" placeholder={`genel ${d.offsetMm}`}
              onCommit={(v) => setOverride(ids, 'offsetMm', v)} {...group} />
          </Field>
          <Field label="Beyaz kenar">
            <Select value={wb ?? ''} ariaLabel="Beyaz kenar" options={[{ value: '', label: `Genel (${d.whiteBorder ? 'açık' : 'kapalı'})` }, { value: '1', label: 'Açık' }, { value: '0', label: 'Kapalı' }]}
              onChange={(v) => setOverride(ids, 'whiteBorder', v === '' ? undefined : v === '1')} />
          </Field>
        </div>
        {offset !== null || items.some((i) => i.overrides.offsetMm !== undefined) ? <div class="override"><span class="small muted">Ofset bu sticker'a özel</span><button type="button" class="reset" onClick={() => setOverride(ids, 'offsetMm', undefined)}>Genel ayarı kullan</button></div> : null}
        <Slider label="Sıkılık (girinti köprüleme)" value={closing ?? d.closingMm} min={0} max={3} step={0.1} digits={1} {...group}
          onInput={(v) => setOverride(ids, 'closingMm', v, 'closing')} />
        {items.some((i) => i.overrides.closingMm !== undefined) ? <div class="override"><span class="small muted">Sıkılık bu sticker'a özel</span><button type="button" class="reset" onClick={() => setOverride(ids, 'closingMm', undefined)}>Genel ayarı kullan</button></div> : null}
        <Slider label="Köşe koruma" value={corner ?? d.cornerAngleDeg} min={0} max={180} step={5} unit="°" digits={0} {...group}
          onInput={(v) => setOverride(ids, 'cornerAngleDeg', v, 'corner')} hint="0° kapalı; yüksek değer daha fazla köşeyi sivri tutar." />
        {items.some((i) => i.overrides.cornerAngleDeg !== undefined) ? <div class="override"><span class="small muted">Köşe koruma bu sticker'a özel</span><button type="button" class="reset" onClick={() => setOverride(ids, 'cornerAngleDeg', undefined)}>Genel ayarı kullan</button></div> : null}
        <Check checked={printOnly === true} indeterminate={printOnly === null} onChange={(v) => setItemFields(ids, { printOnly: v })}>Sadece baskı (kesim çizgisi yok)</Check>
        {stat && items.length === 1 ? <p class="lead num">{stat.anchors} nokta · {stat.lines ? `${stat.lines} düz segment · ` : ''}çizime en yakın {Number.isFinite(stat.minMm) ? `${stat.minMm.toFixed(2)} mm` : '—'} · {stat.ms.toFixed(0)} ms</p> : null}
      </section>
      <section>
        <h3>İşlemler</h3>
        <div class="row">
          <button type="button" class="btn sm" onClick={duplicateSelected}><Icon name="duplicate" size={14} /> Çoğalt</button>
          <button type="button" class="btn sm" onClick={() => primary && reorder(primary.id, 'top')}><Icon name="up" size={14} /> En öne</button>
          <button type="button" class="btn sm" onClick={() => primary && reorder(primary.id, 'bottom')}><Icon name="down" size={14} /> En arkaya</button>
          <button type="button" class="btn sm danger" onClick={deleteSelected}><Icon name="trash" size={14} /> Sil</button>
        </div>
      </section>
    </>
  );
}

// ---------- Sayfa ----------
function PageTab() {
  const doc = store.doc.value!;
  const prefs = store.prefs.value;
  const bases = [...store.files.value.values()].filter((f) => f.width === doc.designSize.widthPx && f.height === doc.designSize.heightPx);
  const suggested = Math.round((doc.page.widthMm * doc.designSize.heightPx / doc.designSize.widthPx) * 10) / 10;
  const mismatch = Math.abs(doc.page.heightMm - suggested) > 0.15;
  const [armed, setArmed] = useState(false);
  return (
    <>
      <section>
        <h3>Sayfa</h3>
        <div class="grid2">
          <Field label="Genişlik"><NumberField value={doc.page.widthMm} unit="mm" step={1} min={10} max={1000} digits={1} ariaLabel="Sayfa genişliği" onCommit={(v) => setPage(v, doc.page.heightMm)} /></Field>
          <Field label="Yükseklik"><NumberField value={doc.page.heightMm} unit="mm" step={1} min={10} max={1000} digits={1} ariaLabel="Sayfa yüksekliği" onCommit={(v) => setPage(doc.page.widthMm, v)} /></Field>
        </div>
        {mismatch ? <div class="msg warning"><span class="dot" /><span>Sayfa oranı tasarımla uyuşmuyor; {doc.page.widthMm} mm genişlik için yükseklik {suggested} mm olmalı.</span><span class="actions"><button type="button" class="btn sm" onClick={() => setPage(doc.page.widthMm, suggested)}>Düzelt</button></span></div> : null}
        <p class="lead">Tasarım {doc.designSize.widthPx} × {doc.designSize.heightPx} px; 1 mm ≈ {(1 / mmPerDesignPx(doc).x).toFixed(1)} px.</p>
      </section>
      <section>
        <h3>Kaynak görseller</h3>
        <Field label="Tam tasarım"><Select value={doc.files.design} ariaLabel="Tam tasarım dosyası" options={bases.map((f) => ({ value: f.name, label: f.name }))} onChange={(v) => setBase('design', v)} /></Field>
        <Field label="Arka plan"><Select value={doc.files.background} ariaLabel="Arka plan dosyası" options={bases.map((f) => ({ value: f.name, label: f.name }))} onChange={(v) => setBase('background', v)} /></Field>
        <p class="lead">Aynı piksel boyutundaki PNG'ler arasından seç. Baskı sayfasının zemini arka plan görselidir.</p>
      </section>
      <section>
        <h3>Görünüm <ThemeToggle /></h3>
        <Check checked={prefs.showCuts} onChange={(v) => { store.prefs.value = { ...prefs, showCuts: v }; savePrefs(); }}>Kesim çizgilerini göster</Check>
        <Check checked={prefs.grid} onChange={(v) => { store.prefs.value = { ...prefs, grid: v }; savePrefs(); }}>Milimetre ızgarası</Check>
        <Check checked={prefs.rulers} onChange={(v) => { store.prefs.value = { ...prefs, rulers: v }; savePrefs(); }}>Cetveller</Check>
        <Check checked={prefs.snap} onChange={(v) => { store.prefs.value = { ...prefs, snap: v }; savePrefs(); }}>Hizalama kılavuzlarına yapış</Check>
        <Check checked={prefs.ghostInCutView} onChange={(v) => { store.prefs.value = { ...prefs, ghostInCutView: v }; savePrefs(); }}>Kesim görünümünde çizimi soluk göster</Check>
      </section>
      <section>
        <h3>Proje</h3>
        <div class="actions">
          <button type="button" class="btn" onClick={() => void exportZip()}><Icon name="zip" size={16} /> Projeyi dışa aktar (.zip)</button>
          <button type="button" class="btn danger" disabled={busy.value} onClick={() => { if (armed) void newProject(); else { setArmed(true); setTimeout(() => setArmed(false), 3000); } }}>
            <Icon name="restart" size={16} /> {armed ? 'Emin misin? Tekrar dokun' : 'Yeni proje (dosyaları temizle)'}
          </button>
        </div>
        <p class="lead">Proje bu tarayıcıda otomatik kaydedilir; başka cihaza taşımak için .zip dışa aktar.</p>
      </section>
    </>
  );
}

// ---------- Kesim ----------
function CutTab() {
  const doc = store.doc.value!;
  const d = doc.defaults;
  const preset = presetOf(d);
  const set = (k: keyof Settings) => (v: number) => setDefaults({ [k]: v }, String(k));
  return (
    <>
      <section>
        <h3>Kesim stili</h3>
        <Segmented value={preset} ariaLabel="Kesim stili" onChange={(v) => { if (v !== 'custom') applyPreset(v); }}
          options={[...CUT_PRESETS.map((p) => ({ value: p.id, label: p.name, title: p.blurb })), { value: 'custom', label: 'Özel' }]} />
        <div class="grid2">
          <Field label="Kesim ofseti"><NumberField value={d.offsetMm} unit="mm" step={0.1} min={-5} max={10} digits={2} ariaLabel="Genel kesim ofseti" onCommit={set('offsetMm')} {...group} /></Field>
          <Field label="Çizgi kalınlığı"><NumberField value={d.strokeWidthPt} unit="pt" step={0.25} min={0.1} max={5} digits={2} ariaLabel="Kesim çizgisi kalınlığı" onCommit={set('strokeWidthPt')} /></Field>
        </div>
        <Check checked={d.whiteBorder} onChange={(v) => setDefaults({ whiteBorder: v })}>Beyaz kenar (baskı sayfasına kesim şeklinde beyaz dolgu)</Check>
        <p class="lead">Pozitif ofset çizgiyi çizimin dışına taşır; beyaz kenar için ofseti kenar kalınlığı yap (ör. 1 mm).</p>
      </section>
      <section>
        <h3>Şekil</h3>
        <Slider label="Sıkılık (girinti köprüleme)" value={d.closingMm} min={0} max={3} step={0.1} digits={1} onInput={set('closingMm')} {...group} hint="Bu genişliğin iki katından dar girintiler düz geçilir; tırtıklı kenarlar yumuşar." />
        <Slider label="Yumuşatma" value={d.smoothMm} min={0} max={1} step={0.05} digits={2} onInput={set('smoothMm')} {...group} />
        <Slider label="Sadeleştirme (sapma toleransı)" value={d.simplifyMm} min={0} max={0.5} step={0.01} digits={2} onInput={set('simplifyMm')} {...group} hint="Düşük değer daha fazla nokta, daha sadık çizgi." />
        <Slider label="Köşe koruma" value={d.cornerAngleDeg} min={0} max={180} step={5} unit="°" digits={0} onInput={set('cornerAngleDeg')} {...group} hint="0° kapalı: her şey yumuşak eğri. Açınca bu açıdan sivri köşeler sivri kalır." />
        <Slider label="Dışbükey köşe yuvarlama" value={d.cornerRadiusMm} min={0} max={3} step={0.1} digits={1} onInput={set('cornerRadiusMm')} {...group} hint="Yalnızca ofsetten büyükse etkili; ince çıkıntıları da siler." />
        <Slider label="Dikdörtgen köşe yarıçapı" value={d.rectCornerRadiusMm} min={0} max={6} step={0.5} digits={1} onInput={set('rectCornerRadiusMm')} {...group} hint="Düz kenarlı dikdörtgen ve kareler (kart, fotoğraf, washi) 4 köşe noktasıyla kesilir. 0 = sivri köşe." />
        <Slider label="Parça köprüleme mesafesi" value={d.bridgeMm} min={0} max={10} step={0.5} digits={1} onInput={set('bridgeMm')} {...group} hint="Ana parçaya bu kadar yakın ayrı parçalar tek kesimde birleşir; 0 yalnızca en büyük parça." />
        <Slider label="Alfa eşiği" value={d.alphaThreshold} min={1} max={254} step={1} unit="" digits={0} onInput={set('alphaThreshold')} {...group} hint="Yarı saydam kenarların nereden kesileceği." />
      </section>
      <section>
        <h3>Kontroller</h3>
        <Slider label="Kesimler arası en az boşluk" value={d.minGapMm} min={0} max={6} step={0.5} digits={1} onInput={set('minGapMm')} {...group} hint="Daha yakın komşular Kontrol sekmesinde uyarılır." />
        <Slider label="Çizime yaklaşma uyarısı" value={d.tightMm} min={0} max={2} step={0.1} digits={1} onInput={set('tightMm')} {...group} hint="0 ölçmeyi kapatır." />
      </section>
    </>
  );
}

// ---------- Kontrol ----------
function QaTab() {
  const doc = store.doc.value!;
  const all = messages.value;
  const counts = warningCount.value;
  const groups = groupMessages(all);
  const ref = store.reference.value, cmp = store.compare.value;
  const primary = primaryItem.value;
  const stickers = [...store.files.value.values()].filter((f) => f.name !== doc.files.design && f.name !== doc.files.background);
  const [regionFile, setRegionFile] = useState('');
  const itemFor = (id?: string) => (id ? doc.items.find((i) => i.id === id) : undefined);
  return (
    <>
      <section>
        <h3>Durum</h3>
        {!counts.errors && !counts.warnings ? <div class="msg info"><span class="dot" /><span>Sorun görünmüyor; baskıya hazır.</span></div> : null}
        {groups.map((g) => (
          <div key={g.level} style={{ display: 'grid', gap: '6px' }}>
            <span class="small muted">{g.title}</span>
            {g.items.map((m, k) => {
              const it = itemFor(m.itemId);
              return (
                <div key={k} class={`msg ${m.level}`} data-clickable={it || m.marker ? '' : undefined}
                  onClick={() => { if (it) { select([it.id]); editorApi.focusItem(it.id); } else if (m.marker) editorApi.focusRegion(m.marker); }}>
                  <span class="dot" />
                  <span>{m.text}</span>
                  <span class="actions" onClick={(e) => e.stopPropagation()}>
                    {it?.needsReview ? <button type="button" class="btn sm" onClick={() => approve([it.id])}>Yeri doğru</button> : null}
                    {m.code === 'UNUSED_STICKER' && m.file ? <button type="button" class="btn sm" onClick={() => addStickerItem(m.file!)}>Ekle</button> : null}
                    {m.code === 'UNMATCHED_REGION' && m.marker ? <>
                      <select class="select" style={{ minHeight: '28px', width: '120px', fontSize: '12px' }} value={regionFile} aria-label="Bölgeye yerleştirilecek sticker" onChange={(e) => setRegionFile((e.target as HTMLSelectElement).value)}>
                        <option value="">Sticker seç…</option>{stickers.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                      </select>
                      <button type="button" class="btn sm" disabled={!regionFile} onClick={() => placeInRegion(m.marker!, regionFile)}>Yerleştir</button>
                      <button type="button" class="btn sm quiet" onClick={() => dismissMarker(m.marker!)}>Yok say</button>
                    </> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </section>
      <section>
        <h3>Illustrator referansı</h3>
        {!ref ? (
          <>
            <p class="lead">Elle hazırlanmış bir kesim PDF'ini yükle; aracın çizgileri referansla üst üste ve ölçülerle karşılaştırılır.</p>
            <label class="btn"><Icon name="compare" size={16} /> Referans PDF yükle<input type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void loadReference(f); }} /></label>
          </>
        ) : (
          <>
            <p class="lead">{ref.name} · sayfa {ref.cutPage + 1} · {ref.cuts.length} kesim yolu{ref.borders.length ? ` · ${ref.borders.length} beyaz kenar` : ''}</p>
            {cmp ? <p class="num small">{cmp.summary.matched}/{cmp.summary.items} eşleşiyor · ort {cmp.summary.meanMm?.toFixed(2) ?? '—'} mm · maks {cmp.summary.maxHausdorffMm?.toFixed(2) ?? '—'} mm{cmp.summary.suggestedOffsetMm !== null ? ` · önerilen ofset ${cmp.summary.suggestedOffsetMm.toFixed(2)} mm` : ''}</p> : null}
            {cmp && primary ? (() => { const r = cmp.items.find((i) => i.itemId === primary.id); return r ? <p class="num small">Seçili: {r.verdict} · ort {r.meanMm?.toFixed(2) ?? '—'} mm · maks {r.hausdorffMm?.toFixed(2) ?? '—'} mm · {r.tool.anchors}/{r.refStats?.anchors ?? '—'} nokta</p> : null; })() : null}
            <Check checked={store.showReference.value} onChange={(v) => { store.showReference.value = v; }}>Referansı tuvalde göster (mavi)</Check>
            <div class="row"><button type="button" class="btn sm" onClick={() => void clearReference()}>Kaldır</button></div>
            <p class="lead">Not: el çizimi referanslar ±1 mm salınabilir; "sapıyor" her zaman aracın hatası değildir.</p>
          </>
        )}
      </section>
    </>
  );
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const o = store.exportOptions.value;
  const setO = (patch: Partial<typeof o>) => { store.exportOptions.value = { ...o, ...patch }; };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" class="btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}><Icon name="more" size={16} /></button>
      {open ? (
        <div class="hud-pop" role="menu" style={{ position: 'absolute', right: '0', bottom: '100%', left: 'auto', transform: 'translateY(-8px)', width: '300px' }}>
          <button type="button" class="btn sm" role="menuitem" onClick={() => { setOpen(false); void exportCutOnlyPdf(); }}><Icon name="cut" size={14} /> Yalnızca kesim PDF'i</button>
          <button type="button" class="btn sm" role="menuitem" onClick={() => { setOpen(false); void exportSvg('cut'); }}><Icon name="svg" size={14} /> Kesim SVG</button>
          <button type="button" class="btn sm" role="menuitem" onClick={() => { setOpen(false); void exportSvg('both'); }}><Icon name="svg" size={14} /> Baskı + kesim SVG</button>
          <button type="button" class="btn sm" role="menuitem" onClick={() => { setOpen(false); void exportPngs(); }}><Icon name="image" size={14} /> Sticker PNG'leri (.zip, {o.pngDpi} dpi)</button>
          <button type="button" class="btn sm" role="menuitem" onClick={() => { setOpen(false); void exportPackage(); }}><Icon name="package" size={14} /> Baskıcı paketi (.zip)</button>
          <button type="button" class="btn sm" role="menuitem" onClick={() => { setOpen(false); void exportZip(); }}><Icon name="zip" size={14} /> Proje (.zip)</button>
          <hr style={{ border: '0', borderTop: '1px solid var(--line)', margin: '0' }} />
          <Check checked={o.layers} onChange={(v) => setO({ layers: v })}>PDF'de "Baskı / Kesim" katmanları</Check>
          <Check checked={o.spotColor} onChange={(v) => setO({ spotColor: v })}>Kesimi spot renkle yaz ({o.spotName})</Check>
          <div class="grid2">
            <Field label="Taşma payı"><NumberField value={o.bleedMm} unit="mm" step={0.5} min={0} max={10} digits={1} ariaLabel="Taşma payı" onCommit={(v) => setO({ bleedMm: v })} /></Field>
            <Field label="PNG çözünürlüğü"><NumberField value={o.pngDpi} unit="dpi" step={50} min={72} max={600} digits={0} ariaLabel="PNG çözünürlüğü" onCommit={(v) => setO({ pngDpi: v })} /></Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Inspector() {
  const tab = store.inspectorTab.value;
  const counts = warningCount.value;
  const sel = store.selection.value.size;
  const tabs: { value: InspectorTab; label: string; count?: number; countKind?: 'warn' | 'err' }[] = [
    { value: 'sticker', label: sel > 1 ? `Seçim (${sel})` : 'Sticker' },
    { value: 'page', label: 'Sayfa' },
    { value: 'cut', label: 'Kesim' },
    { value: 'qa', label: 'Kontrol', count: counts.errors + counts.warnings, countKind: counts.errors ? 'err' : 'warn' },
  ];
  return (
    <>
      <Tabs value={tab} tabs={tabs} onChange={(v) => { store.inspectorTab.value = v; }} />
      <div class="inspector" role="tabpanel">
        {tab === 'sticker' ? <StickerTab /> : tab === 'page' ? <PageTab /> : tab === 'cut' ? <CutTab /> : <QaTab />}
      </div>
      <div class="export-foot">
        <button id="pdf" type="button" class="btn primary block lg" disabled={busy.value} onClick={() => void exportPdf()} title={`PDF oluştur (${MOD} E)`}><Icon name="pdf" size={18} /> PDF oluştur</button>
        <ExportMenu />
      </div>
    </>
  );
}

export { DEFAULT_SETTINGS };
