import React from 'react';
import { createRoot } from 'react-dom/client';
import { TabletPreview } from './TabletPreview';
import { watchForNewBuild } from './auto-reload';
import './styles.css';
import './pulpit.css';
import './chat.css';
import './pulpits.css';
import './cockpit/cockpit.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TabletPreview />
  </React.StrictMode>,
);

if (import.meta.env.PROD) watchForNewBuild();
