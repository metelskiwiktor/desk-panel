import { useEffect, useRef, useState } from 'react';
import { App } from './App';
import { devices, viewportsOf } from './devices';
import { PollingContext } from './polling';
import { setPreviewViewport } from './usage-dom';

const EXIT_MESSAGE = 'desk-panel:close-preview';
const FRAME_PARAM = 'panel-preview';
/** The host tells the frame which part of it its scroll box shows (usage areas are measured only there), in the frame's own pixels. */
const VIEWPORT_MESSAGE = 'desk-panel:preview-viewport';
const READY_MESSAGE = 'desk-panel:preview-ready';
const target = viewportsOf(Object.keys(devices)[0])[0];

/**
 * Preview owns the viewport. The embedded dashboard receives no layout overrides.
 * The host dashboard stays mounted underneath (hidden), so closing returns to the same
 * page with pending undo intact. Its polling is paused until the preview closes.
 */
export function TabletPreview() {
  const embedded = window.parent !== window && new URLSearchParams(window.location.search).get(FRAME_PARAM) === '1';
  const [enabled, setEnabled] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const scrollBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!embedded) return;
    const receive = (event: MessageEvent) => {
      const rect = event.data?.rect;
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.type !== VIEWPORT_MESSAGE) return;
      if (['left', 'top', 'right', 'bottom'].every(k => Number.isFinite(rect?.[k]))) setPreviewViewport({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    };
    window.addEventListener('message', receive);
    window.parent.postMessage(READY_MESSAGE, window.location.origin);
    return () => { window.removeEventListener('message', receive); setPreviewViewport(null); };
  }, [embedded]);
  useEffect(() => {
    if (!enabled) return;
    const post = () => {
      const box = scrollBox.current, inner = frame.current;
      if (!box || !inner?.contentWindow) return;
      const b = box.getBoundingClientRect(), f = inner.getBoundingClientRect();
      const rect = { left: Math.max(0, b.left - f.left), top: Math.max(0, b.top - f.top), right: Math.min(f.width, b.right - f.left), bottom: Math.min(f.height, b.bottom - f.top) };
      inner.contentWindow.postMessage({ type: VIEWPORT_MESSAGE, rect }, window.location.origin);
    };
    const ready = (event: MessageEvent) => { if (event.origin === window.location.origin && event.source === frame.current?.contentWindow && event.data === READY_MESSAGE) post(); };
    window.addEventListener('message', ready);
    window.addEventListener('resize', post);
    scrollBox.current?.addEventListener('scroll', post, { passive: true });
    const box = scrollBox.current;
    const timer = window.setInterval(post, 1000);
    post();
    return () => { window.removeEventListener('message', ready); window.removeEventListener('resize', post); box?.removeEventListener('scroll', post); window.clearInterval(timer); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === frame.current?.contentWindow && event.data === EXIT_MESSAGE) setEnabled(false);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [enabled]);
  if (embedded) return <App tabletPreview onTabletPreviewChange={() => window.parent.postMessage(EXIT_MESSAGE, window.location.origin)} />;
  const host = <div hidden={enabled}><PollingContext.Provider value={!enabled}>
    <App onTabletPreviewChange={() => setEnabled(true)} />
  </PollingContext.Provider></div>;
  if (!enabled) return host;
  const url = new URL(window.location.href);
  url.searchParams.set(FRAME_PARAM, '1');
  return <>{host}<div className="device-preview">
    <div className="device-preview-toolbar">
      <span>Podgląd pionowy · przewijaj, aby zobaczyć całość</span>
      <button className="button" onClick={() => setEnabled(false)}>Zamknij podgląd</button>
    </div>
    <div className="device-preview-window" ref={scrollBox} tabIndex={0} role="region" aria-label="Przewijany podgląd pionowy">
      <iframe ref={frame} title="Pionowy podgląd panelu" src={url.href} width={target.width} height={target.height} />
    </div>
  </div></>;
}
