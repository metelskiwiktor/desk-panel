import { useEffect, useRef, useState } from 'react';
import { App } from './App';
import { devices, viewportsOf } from './devices';

const EXIT_MESSAGE = 'desk-panel:close-preview';
const FRAME_PARAM = 'panel-preview';
const target = viewportsOf(Object.keys(devices)[0])[0];

/**
 * Preview owns the viewport. The embedded dashboard receives no layout overrides.
 * The host dashboard stays mounted underneath (hidden), so closing returns to the same
 * page with pending undo intact; its API reads are served from the backend caches.
 */
export function TabletPreview() {
  const embedded = window.parent !== window && new URLSearchParams(window.location.search).get(FRAME_PARAM) === '1';
  const [enabled, setEnabled] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!enabled) return;
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === frame.current?.contentWindow && event.data === EXIT_MESSAGE) setEnabled(false);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [enabled]);
  if (embedded) return <App tabletPreview onTabletPreviewChange={() => window.parent.postMessage(EXIT_MESSAGE, window.location.origin)} />;
  const host = <div hidden={enabled}><App onTabletPreviewChange={() => setEnabled(true)} /></div>;
  if (!enabled) return host;
  const url = new URL(window.location.href);
  url.searchParams.set(FRAME_PARAM, '1');
  return <>{host}<div className="device-preview">
    <div className="device-preview-toolbar">
      <span>Podgląd pionowy · przewijaj, aby zobaczyć całość</span>
      <button className="button" onClick={() => setEnabled(false)}>Zamknij podgląd</button>
    </div>
    <div className="device-preview-window" tabIndex={0} role="region" aria-label="Przewijany podgląd pionowy">
      <iframe ref={frame} title="Pionowy podgląd panelu" src={url.href} width={target.width} height={target.height} />
    </div>
  </div></>;
}
