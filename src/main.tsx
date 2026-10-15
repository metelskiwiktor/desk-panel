import React from 'react';
import { createRoot } from 'react-dom/client';
import { TabletPreview } from './TabletPreview';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TabletPreview />
  </React.StrictMode>,
);
