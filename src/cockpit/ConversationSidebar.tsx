import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MessageSquare, Plus, Search, X } from 'lucide-react';
import type { CockpitSource } from './types';

const clock = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' });
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export function groupOf(at: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  return days <= 0 ? 'Dziś' : days === 1 ? 'Wczoraj' : days < 7 ? 'Ostatnie 7 dni' : 'Starsze';
}
const fold = (s: string) => s.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const WIDTH_KEY = 'desk-panel:wektor-history-width';
const DEFAULT_WIDTH = 232;
const readWidth = () => {
  try { const value = Number(localStorage.getItem(WIDTH_KEY)); if (Number.isFinite(value) && value >= 200) return Math.min(480, value); } catch { /* default */ }
  return DEFAULT_WIDTH;
};

export function ConversationSidebar({ source, close }: { source: CockpitSource; close(): void }) {
  const [query, setQuery] = useState('');
  const [width, setWidth] = useState(readWidth);
  const sidebar = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  useEffect(() => { try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* optional preference */ } }, [width]);
  const bounds = () => {
    const available = sidebar.current?.parentElement?.clientWidth || window.innerWidth;
    const drawer = window.innerWidth < 1100 || sidebar.current?.closest('.wektor-root')?.getAttribute('data-mode') !== 'window';
    const max = Math.min(480, available * (drawer ? .85 : .4));
    return { min: Math.min(200, max), max };
  };
  const resize = (value: number) => { const { min, max } = bounds(); setWidth(Math.round(Math.max(min, Math.min(max, value)))); };
  const now = Date.now();
  const chats = source.chats?.filter(c => fold(`${c.title} ${c.id}`).includes(fold(query)));
  let group = '';
  const open = (id: string | null) => { source.open(id); if (window.innerWidth < 1100) close(); };
  return <aside ref={sidebar} className="wektor-history" aria-label="Historia rozmów" style={{ '--wk-history-width': `${width}px` } as CSSProperties}>
    <header><span>Twoje rozmowy</span><button type="button" className="wektor-icon" aria-label="Ukryj historię" title="Ukryj historię" onClick={close}><X size={16} /></button></header>
    <button type="button" className="wektor-new" onClick={() => open(null)}><Plus size={17} />Nowy czat</button>
    <label className="wektor-search"><Search size={15} /><input aria-label="Szukaj rozmów" placeholder="Szukaj po nazwie lub ID" value={query} onChange={e => setQuery(e.target.value)} />{query && <button type="button" className="wektor-icon" aria-label="Wyczyść wyszukiwanie" onClick={() => setQuery('')}><X size={14} /></button>}</label>
    <div className="wektor-history-list" role="group" aria-label="Poprzednie rozmowy">
      {chats === undefined && <p className="wektor-hint">Wczytuję rozmowy…</p>}
      {chats?.length === 0 && <p className="wektor-hint">{query ? 'Nie znaleziono rozmów.' : 'Tutaj pojawią się Twoje rozmowy.'}</p>}
      {chats?.map(c => {
        const next = groupOf(c.updatedAt, now), heading = group !== next;
        group = next;
        return <div key={c.id}>{heading && <h2>{next}</h2>}<button type="button" className="wektor-history-item" aria-current={c.id === source.activeId ? 'true' : undefined} onClick={() => open(c.id)} title={c.title}>
          <MessageSquare size={15} aria-hidden="true" /><span><strong>{c.title}</strong><small>{groupOf(c.updatedAt, now) === 'Dziś' ? clock.format(c.updatedAt) : date.format(c.updatedAt)}</small></span>{c.running && <i className="wektor-live-dot" aria-label="Agent odpowiada" />}
        </button></div>;
      })}
    </div>
    <div className="wektor-history-resize" role="separator" aria-label="Szerokość historii" aria-orientation="vertical" aria-valuemin={bounds().min} aria-valuemax={bounds().max} aria-valuenow={Math.min(width, bounds().max)} tabIndex={0} title="Przeciągnij, aby zmienić szerokość historii. Dwuklik przywraca domyślną."
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); }}
      onPointerMove={e => { if (dragging.current) { e.preventDefault(); resize(e.clientX - (sidebar.current?.getBoundingClientRect().left ?? 0)); } }}
      onPointerUp={e => { dragging.current = false; if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { dragging.current = false; }} onLostPointerCapture={() => { dragging.current = false; }}
      onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
      onKeyDown={e => {
        const current = sidebar.current?.getBoundingClientRect().width || width;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); resize(current + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 40 : 10)); }
        if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); resize(e.key === 'Home' ? bounds().min : bounds().max); }
      }} />
  </aside>;
}
