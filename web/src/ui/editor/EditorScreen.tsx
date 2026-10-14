import { useEffect, useRef, useState } from 'preact/hooks';
import { store } from '../../app/store';
import { compactQuery } from '../../platform/env';
import { ToolRail } from './ToolRail';
import { Stage } from './Stage';
import { LayersPanel } from './LayersPanel';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** iPad: denetçi alt sayfa (peek / yarım / tam), katmanlar soldan kayan panel. */
function BottomSheet() {
  const detent = store.sheetDetent.value;
  const start = useRef<{ y: number; detent: typeof detent } | null>(null);
  const onDown = (e: PointerEvent) => { start.current = { y: e.clientY, detent }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dy = e.clientY - s.y;
    const order: (typeof detent)[] = ['peek', 'half', 'full'];
    let i = order.indexOf(s.detent);
    if (dy < -40) i = Math.min(2, i + 1); else if (dy > 40) i = Math.max(0, i - 1); else if (Math.abs(dy) < 6) i = i === 0 ? 1 : 0;
    store.sheetDetent.value = order[i];
  };
  return (
    <div class="sheet" data-detent={detent} role="region" aria-label="Denetçi">
      <div class="grip" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { start.current = null; }} />
      <Inspector />
    </div>
  );
}

export function EditorScreen() {
  const compact = useMedia(compactQuery);
  const layersOpen = store.layersOpen.value;
  useEffect(() => {
    // Klavye açılınca alt sayfa görünür kalsın (visualViewport).
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => document.documentElement.style.setProperty('--vv-h', `${vv.height}px`);
    vv.addEventListener('resize', onResize);
    onResize();
    return () => vv.removeEventListener('resize', onResize);
  }, []);
  return (
    <div class={`editor desk-bg${compact ? ' compact' : ''}`}>
      <ToolRail />
      <div class="stage-wrap" id="stage">
        <Stage />
        {compact ? <BottomSheet /> : null}
        {compact && layersOpen ? <div class="scrim" onClick={() => { store.layersOpen.value = false; }} /> : null}
        {compact ? <div class={`slideover${layersOpen ? ' open' : ''}`} aria-hidden={!layersOpen}><LayersPanel embedded /></div> : null}
      </div>
      {!compact ? <LayersPanel /> : null}
      {!compact ? <aside class="side"><Inspector /></aside> : null}
      {!compact ? <StatusBar /> : null}
    </div>
  );
}
