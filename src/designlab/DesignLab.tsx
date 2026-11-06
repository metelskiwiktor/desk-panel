import { Suspense, lazy, useMemo, type ComponentType } from 'react';
import { mockups } from './mockups';
import './designlab.css';

export default function DesignLab({ name }: { name: string }) {
  const Mockup = useMemo<ComponentType | null>(() => Object.hasOwn(mockups, name) ? lazy(mockups[name]) : null, [name]);
  return (
    <main className="designlab">
      {Mockup
        ? <Suspense fallback={<p className="meta">Ładowanie makiety…</p>}><Mockup /></Suspense>
        : <><p>Nie ma makiety „{name}”. Dostępne:</p><ul>{Object.keys(mockups).map(n => <li key={n}><a href={`?designlab=${n}`}>{n}</a></li>)}</ul></>}
    </main>
  );
}
