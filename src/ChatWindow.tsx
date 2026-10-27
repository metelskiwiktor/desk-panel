import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, MessageSquare, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { ContextItem } from './chat-contract';
import { Cockpit } from './cockpit/Cockpit';
import { useLiveCockpit } from './cockpit/live';
import { useMockCockpit } from './cockpit/mock';
import { Thread } from './cockpit/Thread';
import type { CockpitSource } from './cockpit/types';
import { usePointing } from './cockpit/usePointing';

// ── time ──
const clock = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
const dayName = new Intl.DateTimeFormat('pl-PL', { weekday: 'long' });
const shortDate = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' });
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 86_400_000;
export function groupOf(at: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  return days <= 0 ? 'Dziś' : days === 1 ? 'Wczoraj' : days < 7 ? 'Ostatnie 7 dni' : 'Starsze';
}
function whenOf(at: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  return days <= 0 ? clock.format(at) : days === 1 ? 'wczoraj' : days < 7 ? dayName.format(at) : shortDate.format(at);
}
export const messageCount = (n: number) => `${n} ${n === 1 ? 'wiadomość' : 'wiadomości'}`;

/** `?cockpit=mock` (scenarios, trying the window out) plays a scripted Wektor; `&hermes=down` shows it without Hermes. */
const mockOptions = () => {
  const query = new URLSearchParams(window.location.search);
  if (query.get('cockpit') !== 'mock') return null;
  return { hermesDown: query.get('hermes') === 'down', speed: Number(query.get('cockpitSpeed')) || 1 };
};

const icon = 'tw:grid tw:size-10 tw:place-items-center tw:rounded-xl tw:text-ck-muted tw:hover:bg-ck-surface-2 tw:hover:text-ck-text';

function Conversations({ source, close }: { source: CockpitSource; close: () => void }) {
  const [now] = useState(Date.now);
  return <div className="tw:absolute tw:left-0 tw:top-full tw:z-10 tw:mt-2 tw:w-[min(340px,86vw)] tw:rounded-2xl tw:border tw:border-ck-line-2 tw:bg-ck-side tw:p-2 tw:shadow-2xl" role="group" aria-label="Poprzednie rozmowy">
    <button type="button" className="tw:flex tw:min-h-11 tw:w-full tw:items-center tw:gap-2 tw:rounded-xl tw:px-3 tw:text-sm tw:font-medium tw:text-ck-agent tw:hover:bg-ck-agent/10" onClick={() => { source.open(null); close(); }}>
      <Plus size={16} aria-hidden="true" />Nowy czat
    </button>
    <div className="tw:max-h-[50vh] tw:overflow-y-auto">
      {source.chats === null && <p className="tw:m-0 tw:px-3 tw:py-2 tw:text-sm tw:text-ck-faint">Wczytuję rozmowy…</p>}
      {source.chats?.length === 0 && <p className="tw:m-0 tw:px-3 tw:py-2 tw:text-sm tw:text-ck-faint">Nie ma jeszcze rozmów.</p>}
      {source.chats?.map(c => <button key={c.id} type="button" aria-current={c.id === source.activeId ? 'true' : undefined} onClick={() => { source.open(c.id); close(); }}
        className={`tw:flex tw:w-full tw:flex-col tw:gap-0.5 tw:rounded-xl tw:px-3 tw:py-2 ${c.id === source.activeId ? 'tw:bg-ck-surface-2' : 'tw:hover:bg-ck-surface-2'}`}>
        <span className="tw:flex tw:items-center tw:gap-2 tw:truncate tw:text-sm tw:text-ck-text">{c.running && <i className="tw:size-2 tw:rounded-full tw:bg-ck-agent tw:animate-ck-pulse" aria-label="Agent odpowiada" />}{c.title}</span>
        <span className="tw:text-xs tw:text-ck-faint">{groupOf(c.updatedAt, now)} · {whenOf(c.updatedAt, now)}</span>
      </button>)}
    </div>
  </div>;
}

/**
 * The chat with Wektor (Hermes) as a cockpit: the conversation on the left (60%), what it is working on in Cezar on the
 * right (40%). While the user points at the dashboard, the window docks to the right edge as the conversation only and
 * the dashboard narrows beside it; what is pointed at becomes chips on the next message.
 */
function CockpitWindow({ source, onClose }: { source: CockpitSource; onClose: () => void }) {
  const [context, setContext] = useState<ContextItem[]>([]);
  const [picking, setPicking] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Narrow screens show one column at a time. */
  const [pane, setPane] = useState<'chat' | 'cockpit'>('chat');
  usePointing(picking, context, setContext as Dispatch<SetStateAction<ContextItem[]>>);

  useEffect(() => { setConfirmDelete(false); }, [source.activeId]);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (picking) setPicking(false);
      else if (listOpen) setListOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [picking, listOpen, onClose]);

  const empty = source.unavailable
    ? <p className="tw:m-0 tw:py-16 tw:text-center tw:text-ck-muted">Czat jest niedostępny: serwer panelu nie ma włączonego agenta.</p>
    : source.loading
      ? <p className="tw:m-0 tw:py-16 tw:text-center tw:text-ck-muted">Wczytuję rozmowę…</p>
      : <div className="tw:flex tw:flex-col tw:items-center tw:gap-3 tw:py-14 tw:text-center">
        <div className="tw:grid tw:size-12 tw:place-items-center tw:rounded-2xl tw:bg-ck-agent/15 tw:text-ck-agent"><Sparkles size={24} aria-hidden="true" /></div>
        <h2 className="tw:m-0 tw:text-xl tw:font-semibold tw:text-ck-text">Nowy czat z Wektorem</h2>
        <p className="tw:m-0 tw:max-w-md tw:text-sm tw:leading-relaxed tw:text-ck-muted">Napisz, wpisz <code className="tw:rounded tw:bg-ck-surface-2 tw:px-1.5 tw:font-ck-mono">@</code> aby wybrać skill, albo wskaż na pulpicie mail, spotkanie, zadanie lub cały kafelek.</p>
      </div>;

  const thread = <Thread source={source} context={context} setContext={setContext} picking={picking} setPicking={setPicking} empty={empty} />;
  const mode = picking ? 'dock' : 'window';
  return createPortal(
    <div className="chat-root ck-root tw:font-ck tw:text-ck-text" data-mode={mode}>
      {mode === 'window' && <div className="tw:fixed tw:inset-0 tw:z-[90] tw:bg-[rgba(6,9,15,0.62)]" aria-hidden="true" onClick={onClose} />}
      <section role={picking ? 'complementary' : 'dialog'} aria-modal={mode === 'window' ? true : undefined} aria-label="Czat z agentem"
        className={mode === 'window'
          ? 'tw:fixed tw:inset-0 tw:z-[91] tw:flex tw:flex-col tw:overflow-hidden tw:bg-ck-surface tw:min-[900px]:inset-x-8 tw:min-[900px]:inset-y-5 tw:min-[900px]:mx-auto tw:min-[900px]:max-w-[1440px] tw:min-[900px]:rounded-3xl tw:min-[900px]:border tw:min-[900px]:border-ck-line-2 tw:min-[900px]:shadow-[0_30px_80px_rgba(0,0,0,0.55)]'
          : 'tw:fixed tw:inset-x-0 tw:bottom-0 tw:z-[91] tw:flex tw:h-[52dvh] tw:flex-col tw:border-t tw:border-ck-line-2 tw:bg-ck-surface tw:min-[900px]:inset-y-0 tw:min-[900px]:left-auto tw:min-[900px]:h-auto tw:min-[900px]:w-[min(460px,100vw)] tw:min-[900px]:border-t-0 tw:min-[900px]:border-l tw:shadow-[-20px_0_50px_rgba(0,0,0,0.35)]'}>
        <header className="tw:flex tw:flex-none tw:items-center tw:gap-2 tw:border-b tw:border-ck-line tw:px-3 tw:py-2.5 tw:md:px-4">
          <div className="tw:relative tw:min-w-0">
            <button type="button" className="tw:flex tw:min-h-11 tw:min-w-0 tw:items-center tw:gap-2.5 tw:rounded-xl tw:px-2 tw:hover:bg-ck-surface-2" aria-label="Pokaż rozmowy" aria-expanded={listOpen} onClick={() => setListOpen(o => !o)} disabled={picking}>
              <span className="tw:grid tw:size-8 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-ck-agent/20 tw:text-ck-agent"><Sparkles size={16} aria-hidden="true" /></span>
              <span className="tw:flex tw:min-w-0 tw:flex-col">
                <span className="tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.14em] tw:text-ck-muted">Wektor{source.mode === 'mock' ? ' · makieta' : ''}</span>
                <h1 className="tw:m-0 tw:truncate tw:text-[15px] tw:font-semibold tw:text-ck-text">{source.title}</h1>
              </span>
              {!picking && <ChevronDown size={16} className="tw:text-ck-muted" aria-hidden="true" />}
            </button>
            {listOpen && !picking && <Conversations source={source} close={() => setListOpen(false)} />}
          </div>
          {!picking && <div className="tw:ml-2 tw:flex tw:rounded-xl tw:bg-ck-side tw:p-1 tw:min-[900px]:hidden" role="tablist" aria-label="Widok">
            {(['chat', 'cockpit'] as const).map(p => <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)}
              className={`tw:min-h-9 tw:rounded-lg tw:px-3 tw:text-sm ${pane === p ? 'tw:bg-ck-surface-2 tw:text-ck-text' : 'tw:text-ck-muted'}`}>{p === 'chat' ? 'Czat' : 'Kokpit'}</button>)}
          </div>}
          <div className="tw:ml-auto tw:flex tw:items-center tw:gap-1">
            {picking
              ? <button type="button" className={icon} aria-label="Rozwiń czat" onClick={() => setPicking(false)}><ChevronLeft size={20} aria-hidden="true" /></button>
              : <>
                <button type="button" className={icon} aria-label="Nowy czat" onClick={() => source.open(null)}><MessageSquare size={18} aria-hidden="true" /></button>
                {source.activeId && (confirmDelete
                  ? <button type="button" className="tw:min-h-10 tw:rounded-xl tw:bg-ck-red/15 tw:px-3 tw:text-sm tw:font-medium tw:text-ck-red" onClick={() => { setConfirmDelete(false); source.remove(); }}>Usunąć?</button>
                  : <button type="button" className={icon} aria-label="Usuń rozmowę" onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" /></button>)}
                <button type="button" className={icon} aria-label="Zamknij czat" onClick={onClose}><X size={20} aria-hidden="true" /></button>
              </>}
          </div>
        </header>
        {picking
          ? <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col">{thread}</div>
          : <div className="tw:flex tw:min-h-0 tw:flex-1 tw:min-[900px]:grid tw:min-[900px]:grid-cols-[3fr_2fr]">
            <div className={`tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col ${pane === 'chat' ? 'tw:flex' : 'tw:hidden'} tw:min-[900px]:flex`}>{thread}</div>
            <aside className={`tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:bg-ck-side tw:min-[900px]:border-l tw:min-[900px]:border-ck-line ${pane === 'cockpit' ? 'tw:flex' : 'tw:hidden'} tw:min-[900px]:flex`} aria-label="Kokpit taska">
              <Cockpit source={source} />
            </aside>
          </div>}
      </section>
    </div>,
    document.body,
  );
}

function LiveWindow({ onClose }: { onClose: () => void }) {
  return <CockpitWindow source={useLiveCockpit()} onClose={onClose} />;
}
function MockWindow({ onClose, options }: { onClose: () => void; options: { hermesDown: boolean; speed: number } }) {
  return <CockpitWindow source={useMockCockpit(options)} onClose={onClose} />;
}

/** The chat window: Hermes through the panel's API, or the scripted mock with `?cockpit=mock`. */
export function ChatWindow({ onClose }: { onClose: () => void }) {
  const [mock] = useState(mockOptions);
  return mock ? <MockWindow onClose={onClose} options={mock} /> : <LiveWindow onClose={onClose} />;
}
