import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity, ArrowUp, Bot, CalendarDays, Check, ChevronLeft, Crosshair, LayoutGrid, ListTree, ListChecks, Mail, Maximize2, Minimize2, Pencil, Plus, Search, Sparkles, Square, SquareCheck, Trash2, Wrench, X,
  type LucideIcon,
} from 'lucide-react';
import { MAX_CONTEXT, type ChatMessage, type ChatPart, type ChatSummary, type ContextItem, type ContextKind } from './chat-contract';
import { contextFrom, markPicked, pickableAt, sameContext } from './chat-context';
import { Markdown } from './markdown-lite';
import { useChat, type ChatState } from './useChat';

const KINDS: Record<ContextKind, { label: string; icon: LucideIcon }> = {
  mail: { label: 'Mail', icon: Mail },
  event: { label: 'Spotkanie', icon: CalendarDays },
  task: { label: 'Task Cezara', icon: Bot },
  workout: { label: 'Trening', icon: Activity },
  tile: { label: 'Kafelek', icon: LayoutGrid },
  todoList: { label: 'Lista', icon: ListChecks },
  todo: { label: 'Zadanie', icon: SquareCheck },
};

const WIDE_KEY = 'desk-panel.chat-wide';
const readWide = () => { try { return localStorage.getItem(WIDE_KEY) === '1'; } catch { return false; } };
const saveWide = (wide: boolean) => { try { localStorage.setItem(WIDE_KEY, wide ? '1' : '0'); } catch { /* a per-viewer convenience, the chat works without it */ } };

/** A dashboard element in the conversation: the small label the user picked, with a remove button while it is still a draft. */
function Chip({ item, remove }: { item: ContextItem; remove?: () => void }) {
  const { label, icon: Icon } = KINDS[item.kind];
  return <span className={`chat-chip ${item.kind}`} title={item.text || item.title}>
    <Icon size={16} aria-hidden="true" />
    <span className="k">{label}</span>
    <span className="t">{item.title}</span>
    {remove && <button type="button" className="x" aria-label={`Usuń z kontekstu: ${item.title}`} onClick={remove}><X size={14} aria-hidden="true" /></button>}
  </span>;
}

/** The one line a tool step shows: its first string argument (a command, a path, a query). */
function toolSummary(input: string): string {
  try {
    const value = JSON.parse(input) as unknown;
    if (value && typeof value === 'object') {
      const first = Object.values(value).find(v => typeof v === 'string' && v.trim()) as string | undefined;
      if (first) return first.replace(/\s+/g, ' ').slice(0, 120);
    }
  } catch { /* plain text */ }
  return input.replace(/\s+/g, ' ').trim().slice(0, 120);
}
function pretty(input: string): string {
  try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; }
}
const clipOutput = (text: string) => text.length > 4000 ? `${text.slice(0, 4000)}\n… (skrócone)` : text;

function Tool({ part }: { part: Extract<ChatPart, { type: 'tool' }> }) {
  const running = part.state === 'running';
  return <details className="chat-tool" data-state={part.state}>
    <summary>
      <Wrench size={15} aria-hidden="true" />
      <b>{part.name}</b>
      <span className="sum">{toolSummary(part.input)}</span>
      <span className="state">{running ? <><i aria-hidden="true" />Działa</> : <><Check size={14} aria-hidden="true" />Gotowe</>}</span>
    </summary>
    <div className="body">
      {part.input && <pre>{pretty(part.input)}</pre>}
      {part.output && <pre className="out">{clipOutput(part.output)}</pre>}
    </div>
  </details>;
}

function AgentMessage({ message }: { message: ChatMessage }) {
  const parts = message.parts ?? [];
  const streaming = message.status === 'streaming';
  const last = parts.at(-1);
  return <div className="chat-agent">
    <div className="chat-avatar" aria-hidden="true"><Sparkles size={16} /></div>
    <div className="chat-agent-body">
      {parts.map((part, i) => part.type === 'tool' ? <Tool key={`tool:${part.id}`} part={part} /> : <Markdown key={`text:${i}`} text={part.text} />)}
      {streaming && (!last || last.type === 'tool' ? <p className="chat-wait" role="status">Pracuje<span aria-hidden="true">…</span></p> : <span className="chat-caret" aria-hidden="true" />)}
      {message.status === 'error' && <p className="chat-error" role="alert">{message.error || 'Agent nie odpowiedział.'}</p>}
      {message.status === 'stopped' && <p className="chat-stopped">Zatrzymano.</p>}
    </div>
  </div>;
}

function UserMessage({ message }: { message: ChatMessage }) {
  return <div className="chat-user">
    {!!message.context?.length && <div className="chat-user-chips">{message.context.map((item, i) => <Chip key={`${item.kind}:${item.id}:${i}`} item={item} />)}</div>}
    <div className="chat-bubble">{message.text}</div>
  </div>;
}

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

function Sidebar({ chat, now, query, setQuery, choose }: { chat: ChatState; now: number; query: string; setQuery: (q: string) => void; choose: (id: string | null) => void }) {
  const needle = query.trim().toLowerCase();
  const shown = (chat.chats ?? []).filter(c => !needle || c.title.toLowerCase().includes(needle));
  const groups: { name: string; items: ChatSummary[] }[] = [];
  for (const c of shown) {
    const name = groupOf(c.updatedAt, now);
    (groups.at(-1)?.name === name ? groups.at(-1)! : groups[groups.push({ name, items: [] }) - 1]).items.push(c);
  }
  return <aside className="chat-side">
    <div className="chat-side-head">
      <div className="chat-side-title"><span className="chat-eyebrow">Rozmowy</span><span className="chat-count">{chat.chats?.length ?? ''}</span></div>
      <button type="button" className="chat-new" onClick={() => choose(null)}><Plus size={18} aria-hidden="true" />Nowy czat</button>
      <label className="chat-search">
        <Search size={18} aria-hidden="true" />
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} aria-label="Szukaj w rozmowach" placeholder="Szukaj w rozmowach" />
      </label>
    </div>
    {/* Not a <nav>: the stylesheet hides every nav that has no focus (the dashboard is the navigation). */}
    <div role="group" aria-label="Poprzednie rozmowy" className="chat-list">
      {chat.chats === null && <p className="chat-note">Wczytuję rozmowy…</p>}
      {chat.chats !== null && !shown.length && <p className="chat-note">{needle ? 'Nic nie pasuje.' : 'Nie ma jeszcze rozmów.'}</p>}
      {groups.map(group => <div key={group.name}>
        <div className="chat-group chat-eyebrow">{group.name}</div>
        {group.items.map(c => <button key={c.id} type="button" className={`chat-sess ${c.id === chat.activeId ? 'on' : ''}`} aria-current={c.id === chat.activeId ? 'true' : undefined} onClick={() => choose(c.id)}>
          <span className="t">{c.running && <i className="chat-pulse" aria-label="Agent odpowiada" />}{c.title}</span>
          <span className="m">{whenOf(c.updatedAt, now)} · {messageCount(c.messages)}</span>
        </button>)}
      </div>)}
    </div>
  </aside>;
}

/** Keeps the end of the conversation in view while it grows, unless the user has scrolled up to read. */
function useStickToEnd(dep: unknown) {
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useLayoutEffect(() => { const el = box.current; if (el && stuck.current) el.scrollTop = el.scrollHeight; }, [dep]);
  return { ref: box, onScroll: () => { const el = box.current; if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; } };
}

/**
 * The chat with the agent. By default a small window floating at the right, under the top bar: it covers part of the
 * dashboard, which stays usable. The button in its header widens it into a big window with the list of conversations
 * beside it. While the user points at elements it docks to the right edge and the dashboard narrows beside it, so all of
 * it can be clicked. What is pointed at becomes chips on the next message.
 */
export function ChatWindow({ onClose }: { onClose: () => void }) {
  const chat = useChat();
  const [context, setContext] = useState<ContextItem[]>([]);
  const [picking, setPicking] = useState(false);
  const [wide, setWide] = useState(readWide);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now, setNow] = useState(Date.now);
  const text = useRef<HTMLTextAreaElement>(null);
  const running = chat.active?.running ?? false;
  const items = chat.active?.items;
  const scroll = useStickToEnd(items);

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  useEffect(() => { text.current?.focus(); }, [picking, chat.activeId]);
  useLayoutEffect(() => {
    const el = text.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; }
  }, [draft, picking]);
  useEffect(() => { setConfirmDelete(false); setRenaming(null); }, [chat.activeId]);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  // Docked: the dashboard makes room (the stylesheet reads this attribute).
  useEffect(() => {
    if (!picking) return;
    document.body.setAttribute('data-chat-dock', '');
    return () => document.body.removeAttribute('data-chat-dock');
  }, [picking]);

  // Pointing: every click outside the chat picks the element under it instead of using it.
  useEffect(() => {
    if (!picking) return;
    document.body.setAttribute('data-picking', '');
    // The chat itself and whatever is marked data-pick-through (the menu of virtual desktops) keep working while pointing.
    const outside = (target: EventTarget | null) => !(target instanceof Element && target.closest('.chat-root, [data-pick-through]'));
    let hot: HTMLElement | null = null;
    const heat = (el: HTMLElement | null) => { if (el === hot) return; hot?.removeAttribute('data-ctx-hot'); hot = el; hot?.setAttribute('data-ctx-hot', ''); };
    const click = (e: MouseEvent) => {
      if (!outside(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      const el = pickableAt(e.target), item = el && contextFrom(el);
      if (!item) return;
      setContext(list => list.some(x => sameContext(x, item)) ? list.filter(x => !sameContext(x, item)) : list.length < MAX_CONTEXT ? [...list, item] : list);
    };
    const hold = (e: Event) => { if (outside(e.target)) e.stopPropagation(); };
    const over = (e: MouseEvent) => heat(outside(e.target) ? pickableAt(e.target) : null);
    const press = ['pointerdown', 'mousedown', 'touchstart'] as const;
    document.addEventListener('click', click, true);
    document.addEventListener('pointerover', over, true);
    for (const name of press) document.addEventListener(name, hold, true);
    return () => {
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointerover', over, true);
      for (const name of press) document.removeEventListener(name, hold, true);
      heat(null);
      document.body.removeAttribute('data-picking');
    };
  }, [picking]);

  // Elements already picked are marked on the dashboard, also after it redraws.
  useEffect(() => {
    if (!picking) return;
    markPicked(document, context);
    let frame = 0;
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => markPicked(document, context)); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); markPicked(document, []); };
  }, [picking, context]);

  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (picking) { setPicking(false); return; }
      // The floating chat does not own the keyboard: Esc closes it from inside it (the dashboard's popovers use Esc too).
      if (wide || (e.target instanceof Element && e.target.closest('.chat-root'))) onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [picking, wide, onClose]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || running || chat.busy || chat.unavailable) return;
    if (await chat.send(body, context)) { setDraft(''); setContext([]); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
  };
  const choose = (id: string | null) => { setListOpen(false); if (id) chat.open(id); else chat.startNew(); };
  const title = chat.active?.title ?? 'Nowy czat';
  const commitRename = (value: string) => {
    setRenaming(null);
    const next = value.trim();
    if (next && next !== chat.active?.title) void chat.rename(next);
  };
  const pickToggle = () => setPicking(on => !on);
  const toggleWide = () => { const next = !wide; setWide(next); saveWide(next); setListOpen(false); };
  const mode = picking ? 'dock' : wide ? 'window' : 'float';

  const composer = <div className="chat-composer">
    {(context.length > 0 || picking) && <div className="chat-chips">
      {context.map(item => <Chip key={`${item.kind}:${item.id}`} item={item} remove={() => setContext(list => list.filter(x => !sameContext(x, item)))} />)}
      {picking && <span className="chat-hint"><Crosshair size={16} aria-hidden="true" />{context.length ? 'Kliknij kolejny element na pulpicie' : 'Kliknij element na pulpicie'}</span>}
    </div>}
    <textarea ref={text} rows={picking ? 2 : 1} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} disabled={chat.unavailable}
      aria-label="Wiadomość do agenta" placeholder={picking ? 'Co z tym zrobić?' : 'Napisz wiadomość… (Enter wysyła, Shift+Enter nowa linia)'} />
    <div className="chat-tools">
      {picking
        ? <><button type="button" className="chat-done" onClick={() => setPicking(false)}>Gotowe</button><span className="chat-tools-note">Kończy wskazywanie (Esc)</span></>
        : <button type="button" className="chat-pick" onClick={pickToggle}><Crosshair size={18} aria-hidden="true" />Wskaż element</button>}
      <span className="chat-agy" title="Agent: agy"><i className={running ? 'run' : ''} aria-hidden="true" />agy</span>
      {running
        ? <button type="button" className="chat-round stop" aria-label="Zatrzymaj odpowiedź" onClick={() => void chat.stop()}><Square size={16} fill="currentColor" aria-hidden="true" /></button>
        : <button type="button" className="chat-round" aria-label="Wyślij" disabled={!draft.trim() || chat.busy || chat.unavailable} onClick={() => void submit()}><ArrowUp size={20} aria-hidden="true" /></button>}
    </div>
  </div>;

  const conversation: ReactNode = chat.unavailable
    ? <p className="chat-empty">Czat jest niedostępny: serwer panelu nie ma włączonego agenta.</p>
    : !chat.activeId
      ? <div className="chat-empty">
        <Sparkles size={26} aria-hidden="true" />
        <h2>Nowy czat</h2>
        <p>Napisz do agenta albo wskaż na pulpicie mail, spotkanie, zadanie Cezara, trening lub cały kafelek, a od razu będzie wiedział, o czym mowa.</p>
      </div>
      : !chat.active
        ? <p className="chat-empty">Wczytuję rozmowę…</p>
        : chat.active.items.map(m => m.role === 'user' ? <UserMessage key={m.id} message={m} /> : <AgentMessage key={m.id} message={m} />);

  const meta = chat.active ? `${running ? 'agent odpowiada' : 'agy'} · ${messageCount(chat.active.messages)}` : 'agy';
  return createPortal(
    <div className="chat-root" data-mode={mode} data-compact={wide && !picking ? undefined : ''} data-list={listOpen ? 'open' : undefined}>
      {mode === 'window' && <div className="chat-scrim" aria-hidden="true" />}
      <section className="chat-panel" role={picking ? 'complementary' : 'dialog'} aria-modal={mode === 'window' ? true : undefined} aria-label="Czat z agentem">
        {!picking && <Sidebar chat={chat} now={now} query={query} setQuery={setQuery} choose={choose} />}
        <div className="chat-main">
          <header className="chat-head">
            {!picking && <button type="button" className="chat-icon chat-list-toggle" aria-label="Pokaż rozmowy" aria-expanded={listOpen} onClick={() => setListOpen(o => !o)}><ListTree size={20} aria-hidden="true" /></button>}
            <div className="chat-head-title">
              {renaming !== null
                ? <input className="chat-rename" autoFocus value={renaming} maxLength={120} aria-label="Nazwa rozmowy" onChange={e => setRenaming(e.target.value)} onBlur={e => commitRename(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(e.currentTarget.value); if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); } }} />
                : <h1>{title}</h1>}
              <div className="chat-meta">{picking ? 'Zwinięty widok · tryb wskazywania' : meta}</div>
            </div>
            {picking
              ? <button type="button" className="chat-icon" aria-label="Rozwiń czat" onClick={() => setPicking(false)}><ChevronLeft size={20} aria-hidden="true" /></button>
              : <>
                {chat.active && <>
                  <button type="button" className="chat-icon" aria-label="Zmień nazwę rozmowy" onClick={() => setRenaming(title)}><Pencil size={18} aria-hidden="true" /></button>
                  {confirmDelete
                    ? <button type="button" className="chat-confirm" onClick={() => { setConfirmDelete(false); void chat.remove(); }}>Usunąć?</button>
                    : <button type="button" className="chat-icon" aria-label="Usuń rozmowę" onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" /></button>}
                </>}
                <button type="button" className="chat-icon chat-size-toggle" aria-label={wide ? 'Zmniejsz okno czatu' : 'Powiększ okno czatu'} onClick={toggleWide}>
                  {wide ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
                </button>
                <button type="button" className="chat-icon" aria-label="Zamknij czat" onClick={onClose}><X size={20} aria-hidden="true" /></button>
              </>}
          </header>
          <div className="chat-scroll" ref={scroll.ref} onScroll={scroll.onScroll} role="log" aria-live="polite" aria-label="Rozmowa">
            <div className="chat-thread">{conversation}</div>
          </div>
          {chat.error && <p className="chat-banner" role="alert">{chat.error}<button type="button" aria-label="Zamknij komunikat" onClick={chat.clearError}><X size={14} aria-hidden="true" /></button></p>}
          {composer}
        </div>
      </section>
    </div>,
    document.body,
  );
}
