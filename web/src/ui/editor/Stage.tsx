import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { effect } from '@preact/signals';
import { store, itemStatus, messages, busy, type ViewMode } from '../../app/store';
import { select, addStickerItem, itemBounds, approve, dismissMarker, placeInRegion } from '../../app/actions/edit';
import { addNewSticker } from '../../app/actions/files';
import { registerEditorApi } from '../../app/editor-api';
import { STATUS_LABEL } from '../../app/status';
import { readPalette } from '../../platform/theme';
import { Controller } from '../../editor/controller';
import { drawScene, drawOverlay, drawRulers, designToScreenMatrix, type Frame } from '../../editor/renderer';
import { fitCamera, zoomAt, zoomTo, zoomToBounds, type PageMm } from '../../editor/camera';
import { mmPerDesignPx, itemLabel } from '../../../../src/core/project';
import type { Coord } from '../../../../src/core/geometry';
import { Segmented, Select } from '../shared/controls';
import { Icon } from '../shared/Icon';
import { MOD } from '../../platform/env';

const RULER = 22;

function AddPopover({ at, screen, onClose }: { at: Coord; screen: Coord; onClose: () => void }) {
  const doc = store.doc.value!;
  const pick = useRef<HTMLInputElement>(null);
  const stickers = [...store.files.value.values()].filter((f) => f.name !== doc.files.design && f.name !== doc.files.background);
  return (
    <div class="hud-pop" style={{ left: `${screen.x}px`, top: `${screen.y}px` }} role="dialog" aria-label="Sticker ekle">
      <b>Buraya sticker ekle</b>
      {stickers.length ? <div class="row">{stickers.map((f) => <button key={f.name} type="button" class="btn sm" onClick={() => { addStickerItem(f.name, at); onClose(); }}>{f.name}</button>)}</div> : <p class="muted small">Yüklü sticker yok.</p>}
      <div class="row">
        <input ref={pick} type="file" accept=".png,.PNG,image/png,.pdf,application/pdf,.ai" hidden onChange={() => { const f = pick.current?.files?.[0]; if (pick.current) pick.current.value = ''; if (f) { void addNewSticker(f, at); onClose(); } }} />
        <button type="button" class="btn sm" onClick={() => pick.current?.click()}><Icon name="plus" size={14} /> PNG ya da PDF yükle</button>
        <button type="button" class="btn sm quiet" onClick={onClose}>Kapat</button>
      </div>
    </div>
  );
}

function RegionPopover({ rect, screen, onClose }: { rect: { x: number; y: number; w: number; h: number }; screen: Coord; onClose: () => void }) {
  const doc = store.doc.value!;
  const [file, setFile] = useState('');
  const stickers = [...store.files.value.values()].filter((f) => f.name !== doc.files.design && f.name !== doc.files.background);
  const mm = mmPerDesignPx(doc);
  return (
    <div class="hud-pop" style={{ left: `${screen.x}px`, top: `${screen.y}px` }} role="dialog" aria-label="Bölgeye yerleştir">
      <b>Bu bölgeye yerleştir <span class="muted small num">({(rect.w * mm.x).toFixed(1)} × {(rect.h * mm.y).toFixed(1)} mm)</span></b>
      <Select value={file} ariaLabel="Sticker" options={[{ value: '', label: 'Sticker seç…' }, ...stickers.map((f) => ({ value: f.name, label: f.name }))]} onChange={setFile} />
      <div class="row">
        <button type="button" class="btn sm primary" disabled={!file} onClick={() => {
          const f = store.files.value.get(file);
          if (f) { const k = Math.min(rect.w / f.width, rect.h / f.height); addStickerItem(file, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, f.width * k); }
          onClose();
        }}>Yerleştir</button>
        <button type="button" class="btn sm quiet" onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

export function Stage() {
  const wrap = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const rulerX = useRef<HTMLCanvasElement>(null);
  const rulerY = useRef<HTMLCanvasElement>(null);
  const [addAt, setAddAt] = useState<{ at: Coord; screen: Coord } | null>(null);
  const [regionAt, setRegionAt] = useState<{ rect: { x: number; y: number; w: number; h: number }; screen: Coord } | null>(null);
  const [markerPop, setMarkerPop] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const palette = { current: readPalette() };
    const page = (): PageMm => { const d = store.doc.value!; return { w: d.page.widthMm, h: d.page.heightMm }; };
    const viewport = () => ({ width: el.clientWidth, height: el.clientHeight });

    const frame = (): Frame | null => {
      const pack = store.doc.value;
      if (!pack) return null;
      return {
        pack, files: store.files.value, cuts: store.cuts, selection: store.selection.value, gesture: store.gesture.value,
        marquee: store.marquee.value, measure: store.measure.value, camera: store.camera.value, viewport: viewport(),
        dpr: devicePixelRatio || 1, mode: store.viewMode.value, prefs: store.prefs.value, palette: palette.current,
        hoverId: store.hoverId.value, focusedMarker: store.focusedMarker.value, messages: messages.value,
        reference: store.reference.value, showReference: store.showReference.value, tool: store.tool.value,
      };
    };
    let raf = 0;
    const draw = () => {
      raf = 0;
      const f = frame();
      if (!f) return;
      const dpr = f.dpr, w = Math.round(f.viewport.width * dpr), h = Math.round(f.viewport.height * dpr);
      for (const c of [scene.current!, overlay.current!]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      drawScene(scene.current!.getContext('2d')!, f);
      drawOverlay(overlay.current!.getContext('2d')!, f);
      if (f.prefs.rulers) {
        const rx = rulerX.current!, ry = rulerY.current!;
        if (rx.width !== w) { rx.width = w; rx.height = RULER * dpr; }
        if (ry.height !== h) { ry.width = RULER * dpr; ry.height = h; }
        drawRulers(rx.getContext('2d')!, ry.getContext('2d')!, f, store.cursorMm.value);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const stop = effect(() => {
      // İzlenen sinyaller: herhangi biri değişince bir kare çizilir.
      store.doc.value; store.docVersion.value; store.cutsVersion.value; store.selection.value; store.gesture.value; store.marquee.value;
      store.measure.value; store.camera.value; store.viewMode.value; store.prefs.value; store.hoverId.value; store.focusedMarker.value;
      messages.value; store.reference.value; store.showReference.value; store.cursorMm.value; store.stageSize.value;
      schedule();
    });
    const ro = new ResizeObserver(() => { store.stageSize.value = { width: el.clientWidth, height: el.clientHeight, dpr: devicePixelRatio || 1 }; });
    ro.observe(el);
    const themeObserver = new MutationObserver(() => { palette.current = readPalette(); schedule(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => { palette.current = readPalette(); schedule(); };
    mq.addEventListener('change', onScheme);

    const controller = new Controller({
      el,
      onRegion: (rect, screen) => setRegionAt({ rect, screen: { x: screen.x, y: Math.min(screen.y, el.clientHeight - 160) } }),
      onPlace: (at, screen) => setAddAt({ at, screen: { x: screen.x, y: Math.min(screen.y, el.clientHeight - 160) } }),
    });

    /** Sığdır: kompakt düzende alt sayfanın kapattığı alanı hesaba kat. */
    const fit = () => {
      const vp = viewport();
      const sheet = el.parentElement?.querySelector<HTMLElement>('.sheet');
      const covered = sheet ? Math.min(vp.height * 0.6, sheet.getBoundingClientRect().height) : 0;
      const cam = fitCamera({ width: vp.width, height: vp.height - covered }, page(), 28);
      store.camera.value = { ...cam, panY: cam.panY - covered / 2 };
    };
    const boundsMm = (ids: Iterable<string>) => {
      const doc = store.doc.value!, mm = mmPerDesignPx(doc);
      const bs = doc.items.filter((i) => new Set(ids).has(i.id)).map(itemBounds).filter((b): b is NonNullable<typeof b> => !!b);
      if (!bs.length) return null;
      return { minX: Math.min(...bs.map((b) => b.minX)) * mm.x, maxX: Math.max(...bs.map((b) => b.maxX)) * mm.x, minY: Math.min(...bs.map((b) => b.minY)) * mm.y, maxY: Math.max(...bs.map((b) => b.maxY)) * mm.y };
    };
    const unregister = registerEditorApi({
      fit,
      zoomBy: (k) => { store.camera.value = zoomAt(store.camera.value, viewport(), page(), { x: el.clientWidth / 2, y: el.clientHeight / 2 }, k); },
      zoomTo: (z) => { store.camera.value = zoomTo(store.camera.value, viewport(), page(), z, { x: el.clientWidth / 2, y: el.clientHeight / 2 }); },
      actualSize: () => { store.camera.value = zoomTo(store.camera.value, viewport(), page(), 1, { x: el.clientWidth / 2, y: el.clientHeight / 2 }); },
      zoomToSelection: () => { const b = boundsMm(store.selection.value); if (b) store.camera.value = zoomToBounds(viewport(), page(), b, 80); },
      focusItem: (id) => { select([id]); const b = boundsMm([id]); if (b) store.camera.value = zoomToBounds(viewport(), page(), b, 120); },
      focusRegion: (marker) => {
        store.focusedMarker.value = marker;
        const m = messages.value.find((x) => x.marker === marker && x.region);
        if (!m?.region) return;
        const mm = mmPerDesignPx(store.doc.value!);
        store.camera.value = zoomToBounds(viewport(), page(), { minX: m.region.x * mm.x, minY: m.region.y * mm.y, maxX: (m.region.x + m.region.w) * mm.x, maxY: (m.region.y + m.region.h) * mm.y }, 120);
      },
    });
    const onFit = () => fit();
    const onFocus = (e: Event) => { const id = (e as CustomEvent<string>).detail; const b = boundsMm([id]); if (b) store.camera.value = zoomToBounds(viewport(), page(), b, 120); };
    el.addEventListener('stage:fit', onFit);
    el.addEventListener('stage:focus', onFocus);
    const stopFit = effect(() => { store.fitRequested.value; requestAnimationFrame(fit); });

    return () => {
      stop(); stopFit(); ro.disconnect(); themeObserver.disconnect(); mq.removeEventListener('change', onScheme);
      controller.destroy(); unregister(); el.removeEventListener('stage:fit', onFit); el.removeEventListener('stage:focus', onFocus);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // HUD: rozetler ve bölge işaretleri (HTML; tipografi ve dokunma hedefleri için)
  const doc = store.doc.value;
  store.cutsVersion.value; store.camera.value; store.stageSize.value; store.gesture.value;
  const hud: JSX.Element[] = [];
  if (doc && wrap.current) {
    const f = { pack: doc, camera: store.camera.value, viewport: { width: wrap.current.clientWidth, height: wrap.current.clientHeight } };
    const M = designToScreenMatrix(f);
    const toScreen = (p: Coord) => ({ x: M[0] * p.x + M[4], y: M[3] * p.y + M[5] });
    const statuses = itemStatus.value;
    if (store.viewMode.value === 'edit' && !store.gesture.value) {
      for (const item of doc.items) {
        const st = statuses.get(item.id);
        if (!st || st === 'ok' || st === 'pending') continue;
        const b = itemBounds(item);
        if (!b) continue;
        const p = toScreen({ x: b.maxX, y: b.minY });
        hud.push(
          <button key={`b-${item.id}`} type="button" class={`hud-badge ${st}`} style={{ left: `${p.x - 8}px`, top: `${p.y - 6}px` }}
            title={`${itemLabel(item)}: ${STATUS_LABEL[st]}`} onClick={() => { select([item.id]); store.inspectorTab.value = st === 'review' ? 'sticker' : 'qa'; if (store.sheetDetent.value === 'peek') store.sheetDetent.value = 'half'; }}>
            {st === 'review' ? 'kontrol et' : st === 'printOnly' ? 'baskı' : STATUS_LABEL[st]}
          </button>,
        );
      }
      for (const m of messages.value) {
        if (m.code !== 'UNMATCHED_REGION' || !m.region || !m.marker) continue;
        const c = toScreen({ x: m.region.x + m.region.w / 2, y: m.region.y + m.region.h / 2 });
        hud.push(
          <button key={`m-${m.marker}`} type="button" class={`hud-marker${store.focusedMarker.value === m.marker ? ' focused' : ''}`} style={{ left: `${c.x}px`, top: `${c.y}px` }}
            aria-label={m.text} title={m.text} onClick={() => { store.focusedMarker.value = m.marker!; setMarkerPop(markerPop === m.marker ? null : m.marker!); }}>{m.marker}</button>,
        );
        if (markerPop === m.marker) {
          const stickers = [...store.files.value.values()].filter((x) => x.name !== doc.files.design && x.name !== doc.files.background);
          hud.push(
            <div key={`p-${m.marker}`} class="hud-pop" style={{ left: `${c.x}px`, top: `${c.y + 14}px` }}>
              <span>{m.text}</span>
              <div class="row">
                {stickers.map((s) => <button key={s.name} type="button" class="btn sm" onClick={() => { placeInRegion(m.marker!, s.name); setMarkerPop(null); }}>{s.name}</button>)}
                <button type="button" class="btn sm quiet" onClick={() => { dismissMarker(m.marker!); setMarkerPop(null); }}>Yok say</button>
              </div>
            </div>,
          );
        }
      }
      const sel = [...store.selection.value];
      if (sel.length === 1) {
        const item = doc.items.find((i) => i.id === sel[0]);
        if (item?.needsReview) {
          const b = itemBounds(item);
          if (b) {
            const p = toScreen({ x: (b.minX + b.maxX) / 2, y: b.maxY });
            hud.push(<button key="approve" type="button" class="hud-badge ok" style={{ left: `${p.x}px`, top: `${p.y + 26}px`, background: 'var(--ok)', color: '#fff' }} onClick={() => approve([item.id])}>✓ Yeri doğru</button>);
          }
        }
      }
    }
  }
  const rulers = store.prefs.value.rulers;
  const mode = store.viewMode.value;
  return (
    <>
      <div ref={wrap} class="stage-canvas" style={{ position: 'absolute', inset: '0' }} tabIndex={0} role="img" aria-label="Sticker sayfası tuvali">
        <canvas ref={scene} class="scene" />
        <canvas ref={overlay} class="overlay" />
        <div class="hud" aria-live="polite">
          {hud}
          {addAt ? <AddPopover at={addAt.at} screen={addAt.screen} onClose={() => setAddAt(null)} /> : null}
          {regionAt ? <RegionPopover rect={regionAt.rect} screen={regionAt.screen} onClose={() => setRegionAt(null)} /> : null}
        </div>
        {rulers ? <><canvas ref={rulerX} class="ruler x" /><canvas ref={rulerY} class="ruler y" /><div class="ruler corner" /></> : null}
      </div>
      <div class="stage-top" style={{ top: rulers ? '30px' : '12px', left: rulers ? '30px' : '12px' }}>
        <Segmented<ViewMode> value={mode} ariaLabel="Görünüm" onChange={(v) => { store.viewMode.value = v; }}
          options={[{ value: 'edit', label: 'Düzenle', title: '⌥1' }, { value: 'cut', label: 'Kesim sayfası', title: '⌥2' }, { value: 'print', label: 'Baskı önizleme', title: '⌥3' }]} />
        <span class="spacer" />
        {busy.value || mode === 'edit' ? null : <span class="small muted wide-only" style={{ background: 'var(--panel)', padding: '3px 8px', borderRadius: '6px' }}>{mode === 'cut' ? 'Baskıcının göreceği kesim sayfası' : 'Beyaz kenarlarla baskı sayfası'}</span>}
      </div>
      <div class="stage-bottom" style={{ left: rulers ? '30px' : '12px' }}>
        <div class="floating" role="group" aria-label="Yakınlaştırma">
          <button type="button" class="btn quiet icon-btn" aria-label="Uzaklaştır" onClick={() => { const api = require_api(); api.zoomBy(1 / 1.25); }}><Icon name="zoomOut" /></button>
          <output class="num">{Math.round(store.camera.value.zoom * 100)}%</output>
          <button type="button" class="btn quiet icon-btn" aria-label="Yakınlaştır" onClick={() => require_api().zoomBy(1.25)}><Icon name="zoomIn" /></button>
          <button type="button" class="btn quiet" onClick={() => require_api().fit()} title={`Sığdır (${MOD} 0)`}><Icon name="fit" /> Sığdır</button>
        </div>
      </div>
    </>
  );
}

import { editorApi } from '../../app/editor-api';
const require_api = () => editorApi;
