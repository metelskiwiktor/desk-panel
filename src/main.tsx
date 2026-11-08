import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { TabletPreview } from './TabletPreview';
import { watchForNewBuild } from './auto-reload';
import { createUsageSink } from './usage-client';
import { UsageSinkContext } from './useUsageMeter';
import { designLabName } from './designlab/gate';
import './styles.css';
import './pulpit.css';
import './chat.css';
import './pulpits.css';
import './cockpit/cockpit.css';
import { recoverKiosk } from './fila/kiosk-migration';

// Replaced by scripts/scenario-runtime.ts only; the service, `just dev` and the production build get false and ignore ?designlab (docs/designlab.md).
const labName = __DESIGNLAB__ ? designLabName(true, window.location.search) : null;
const DesignLab = __DESIGNLAB__ && labName !== null ? lazy(() => import('./designlab/DesignLab')) : null;

let kioskError = false;
try { recoverKiosk(localStorage); } catch { kioskError = true; }
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {kioskError ? <p role="alert">Nie można bezpiecznie odtworzyć konfiguracji kiosku. Zachowaj dane przeglądarki i sprawdź procedurę przełączenia.</p>
      : DesignLab ? <Suspense fallback={null}><DesignLab name={labName!} /></Suspense>
      : <UsageSinkContext.Provider value={createUsageSink()}><TabletPreview /></UsageSinkContext.Provider>}
  </React.StrictMode>,
);

if (import.meta.env.PROD) watchForNewBuild();
