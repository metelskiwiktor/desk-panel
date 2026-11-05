import React from 'react';
import { createRoot } from 'react-dom/client';
import { TabletPreview } from './TabletPreview';
import { watchForNewBuild } from './auto-reload';
import { createUsageSink } from './usage-client';
import { UsageSinkContext } from './useUsageMeter';
import './styles.css';
import './pulpit.css';
import './chat.css';
import './pulpits.css';
import './cockpit/cockpit.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UsageSinkContext.Provider value={createUsageSink()}><TabletPreview /></UsageSinkContext.Provider>
  </React.StrictMode>,
);

if (import.meta.env.PROD) watchForNewBuild();
