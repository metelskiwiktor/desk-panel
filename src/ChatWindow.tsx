import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, Columns2, Maximize2, MessageSquare, Minus, PanelLeft, PanelRight, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { ContextItem } from './chat-contract';
import { getChatDraft, setChatDraftContext } from './chat-draft';
import type { ChatView } from './useChatPresentation';
import { Cockpit } from './cockpit/Cockpit';
import { ConversationSidebar } from './cockpit/ConversationSidebar';
import { useLiveCockpit } from './cockpit/live';
import { useMockCockpit } from './cockpit/mock';
import { Thread } from './cockpit/Thread';
import type { CockpitSource } from './cockpit/types';
import { usePointing } from './cockpit/usePointing';
import { AppointmentWorkspace, useAppointmentWorkspace } from './cockpit/appointment-workspace';
import { AppointmentOrCockpit } from './cockpit/AppointmentPanel';
import './cockpit/wektor.css';
import { rememberSnapshot } from './chat-snapshots';
import { ConversationCacheContext, useConversationCache, type ConversationCache } from './cockpit/conversation-cache';
import { APPOINTMENT } from './cockpit/types';
import { LoadingSurface } from './cockpit/LoadingSurface';

export { groupOf } from './cockpit/ConversationSidebar';
type InspectorMode = 'auto' | 'full' | 'summary' | 'hidden';
interface WindowProps { onClose(): void; view?: ChatView; picking?: boolean; onPickingChange?(on: boolean): void; onViewChange?(view: ChatView): void }
const mockOptions = () => {
  const query = new URLSearchParams(window.location.search);
  return query.get('cockpit') === 'mock' ? { hermesDown: query.get('hermes') === 'down', speed: Number(query.get('cockpitSpeed')) || 1 } : null;
};
const readInspector = (): InspectorMode => {
  try { const mode = localStorage.getItem('desk-panel:wektor-inspector'); if (mode === 'full' || mode === 'summary' || mode === 'hidden') return mode; } catch { /* default */ }
  return 'auto';
};

function CockpitWindow({ source, onClose, view: controlledView, picking: controlledPicking, onPickingChange, onViewChange }: WindowProps & { source: CockpitSource }) {
  const [ownView, setOwnView] = useState<ChatView>('full');
  const view = controlledView ?? ownView;
  const [ownPicking, setOwnPicking] = useState(false);
  const picking = controlledPicking ?? ownPicking;
  const visible = view !== 'hidden' || picking;
  const mode = picking ? 'dock' : view === 'full' ? 'window' : 'compact';
  const [history, setHistory] = useState(() => window.innerWidth >= 1100);
  const [compactHistory, setCompactHistory] = useState(false);
  const historyShown = mode === 'window' ? history : compactHistory;
  const toggleHistory = () => mode === 'window' ? setHistory(v => !v) : setCompactHistory(v => !v);
  const closeHistory = () => { setHistory(false); setCompactHistory(false); };
  const [inspector, setInspector] = useState<InspectorMode>(readInspector);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const section = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLElement | null>(null);
  const setPicking = (on: boolean) => { setOwnPicking(on); onPickingChange?.(on); };
  const setView = (next: ChatView) => { setPicking(false); setOwnView(next); onViewChange?.(next); };
  const close = () => { setPicking(false); onClose(); };
  useEffect(() => { if (view === 'hidden') setOwnPicking(false); }, [view]);
  useEffect(() => { setConfirmDelete(false); }, [source.activeId]);
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);
  useEffect(() => { try { localStorage.setItem('desk-panel:wektor-inspector', inspector); } catch { /* optional preference */ } }, [inspector]);

  // Capture the opener once, restore it on hide; fullscreen also contains keyboard focus.
  useEffect(() => {
    if (!visible) return;
    launcher.current = document.activeElement as HTMLElement | null;
    if (!picking) section.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    return () => { if (launcher.current?.isConnected) launcher.current.focus({ preventScroll: true }); };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (picking) setPicking(false);
        else if (historyShown && (mode !== 'window' || window.innerWidth < 1100)) closeHistory();
        else close();
      }
      if (e.key === 'Tab' && mode === 'window') {
        const nodes = [...(section.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea:not(:disabled), select, [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0);
        const first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && (document.activeElement === first || !section.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !section.current?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  useEffect(() => {
    if (!visible || mode !== 'window') return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [visible, mode]);

  return createPortal(<div className="chat-root ck-root wektor-root tw:font-ck tw:text-ck-text" data-mode={mode} hidden={!visible}>
    <section ref={section} className="wektor-shell" role={mode === 'window' ? 'dialog' : 'complementary'} aria-modal={mode === 'window' ? true : undefined} aria-label="Czat z agentem">
      <header className="wektor-header">
        {!picking && <button type="button" className="wektor-icon" aria-label="Pokaż rozmowy" title="Historia rozmów" aria-expanded={historyShown} onClick={toggleHistory}><PanelLeft size={19} /></button>}
        <span className="wektor-brand"><Sparkles size={18} aria-hidden="true" /></span>
        <div className="wektor-heading"><span>WEKTOR{source.mode === 'mock' ? ' · makieta' : ''}</span><h1>{source.title}</h1></div>
        <div className="wektor-header-actions">
          {picking ? <button type="button" className="wektor-icon" aria-label="Rozwiń czat" title="Zakończ wskazywanie" onClick={() => setPicking(false)}><ChevronLeft size={20} /></button> : <>
            <button type="button" className="wektor-icon" aria-label="Nowy czat" title="Nowy czat" onClick={() => source.open(null)}><Plus size={19} /></button>
            {source.activeId && (confirmDelete ? <button type="button" className="wektor-delete-confirm" onClick={() => { setConfirmDelete(false); source.remove(); }}>Usunąć?</button> : <button type="button" className="wektor-icon wektor-delete" aria-label="Usuń rozmowę" title="Usuń rozmowę" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></button>)}
            <span className="wektor-header-divider" />
            {view === 'full' ? <button type="button" className="wektor-icon" aria-label="Zminimalizuj czat" title="Widok kompaktowy · Alt+W zmienia widok" onClick={() => setView('compact')}><Minus size={19} /></button> : <button type="button" className="wektor-icon" aria-label="Maksymalizuj czat" title="Pełny ekran" onClick={() => setView('full')}><Maximize2 size={17} /></button>}
          </>}
          <button type="button" className="wektor-icon" aria-label="Zamknij czat" title="Ukryj · Esc" onClick={close}><X size={20} /></button>
        </div>
      </header>
      <div className="wektor-body">
        {historyShown && !picking && <><button type="button" className="wektor-history-backdrop" aria-label="Zamknij historię" onClick={closeHistory} /><ConversationSidebar source={source} close={closeHistory} /></>}
        <ConversationWorkspace key={source.activeId ?? 'new'} source={source} picking={visible && picking} setPicking={setPicking} compact={mode !== 'window'} visible={visible} inspector={inspector} setInspector={setInspector} />
      </div>
    </section>
  </div>, document.body);
}

/** Keyed by conversation: switching never reuses another chat's composer, context or appointment selection. */
function ConversationWorkspace({ source, picking, setPicking, compact, visible, inspector, setInspector }: { source: CockpitSource; picking: boolean; setPicking(on: boolean): void; compact: boolean; visible: boolean; inspector: InspectorMode; setInspector(mode: InspectorMode): void }) {
  const cache = useConversationCache();
  const [context, updateContext] = useState<ContextItem[]>(() => getChatDraft(source.activeId).context);
  const setContext = useCallback((update: (items: ContextItem[]) => ContextItem[]) => {
    updateContext(previous => {
      const next = update(previous);
      setChatDraftContext(next, source.activeId);
      return next;
    });
  }, [source.activeId]);
  usePointing(picking, context, setContext);
  useEffect(() => {
    if (!visible || !compact) return;
    document.body.setAttribute('data-chat-dock', '');
    return () => document.body.removeAttribute('data-chat-dock');
  }, [visible, compact]);
  const [pane, setPane] = useState<'chat' | 'cockpit'>(() => cache?.layouts.get(source.activeId ?? '')?.pane ?? 'chat');
  const openTimeline = useCallback(() => { setInspector('full'); setPane('cockpit'); }, [setInspector]);
  const openSummary = useCallback(() => { setPane('chat'); }, []);
  const empty = source.unavailable ? <p className="wektor-empty-note">Czat jest niedostępny: serwer panelu nie ma włączonego agenta.</p>
    : source.loading ? <LoadingSurface kind="chat" />
      : <div className="wektor-welcome"><span className="wektor-welcome-mark"><Sparkles size={30} /></span><span className="wektor-eyebrow">TWÓJ PULPIT. JEDNA ROZMOWA.</span><h2>Nad czym pracujemy?</h2><p>Napisz do Wektora, wybierz umiejętność przez <kbd>@</kbd><br />lub włącz wskazywanie przez <kbd>Ctrl + Alt</kbd>.</p><div className="wektor-welcome-topics"><span><MessageSquare size={14} />Rozmawiaj</span><span><CalendarDays size={14} />Planuj</span><span><Columns2 size={14} />Porządkuj</span></div></div>;
  return <AppointmentWorkspace openTimeline={openTimeline} openSummary={openSummary}>
    <WorkspaceColumns source={source} compact={compact} picking={picking} inspector={inspector} setInspector={setInspector} pane={pane} setPane={setPane}>
      <Thread source={source} context={context} setContext={setContext} picking={picking} setPicking={setPicking} empty={empty} />
    </WorkspaceColumns>
  </AppointmentWorkspace>;
}

function WorkspaceColumns({ children, source, compact, picking, inspector, setInspector, pane, setPane }: { children: ReactNode; source: CockpitSource; compact: boolean; picking: boolean; inspector: InspectorMode; setInspector(mode: InspectorMode): void; pane: 'chat' | 'cockpit'; setPane(pane: 'chat' | 'cockpit'): void }) {
  const workspace = useAppointmentWorkspace();
  const cache = useConversationCache();
  const visit = !!workspace?.active && !!workspace.entries[workspace.active];
  const hasWork = !!Object.keys(workspace?.entries ?? {}).length || !!source.cockpit.task || !!source.cockpit.pr || !!source.cockpitError;
  const pendingVisit = source.messages.some(m => m.parts.some(p => p.type === 'tool' && p.name === APPOINTMENT && p.id.includes(':v-') && !p.args.refused && !workspace?.settled.has(p.id)));
  const pending = !!source.activeId && (source.loading || source.refreshing || pendingVisit);
  const hint = cache?.layouts.get(source.activeId ?? '') ?? cache?.last;
  const presentedWork = hasWork || !!(pending && (hint?.work || pendingVisit));
  const presentedVisit = visit || !!(pending && (hint?.visit || pendingVisit));
  useLayoutEffect(() => {
    if (!cache || !source.activeId || pending) return;
    const layout = { work: hasWork, visit, pane };
    rememberSnapshot(cache.layouts, source.activeId, layout);
    cache.last = layout;
  }, [cache, source.activeId, pending, hasWork, visit, pane]);
  const preferred = inspector === 'auto' ? (presentedWork ? 'full' : 'hidden') : inspector;
  const effective = picking ? 'hidden' : preferred;
  const show = effective !== 'hidden';
  return <div className="wektor-workspace" data-inspector={effective} data-visit={presentedVisit} data-compact={compact} data-pane={pane} aria-busy={pending}>
    {(show || picking && preferred !== 'hidden') && <div className="wektor-pane-tabs" role="tablist" aria-label="Widok">{(['chat', 'cockpit'] as const).map(p => <button key={p} type="button" role="tab" aria-selected={(picking ? 'chat' : pane) === p} disabled={picking} onClick={() => setPane(p)}>{p === 'chat' ? 'Czat' : 'Kokpit'}</button>)}</div>}
    <div className="wektor-conversation" data-loading={source.loading}>{children}</div>
    {show && <aside className="wektor-inspector" aria-label="Kokpit taska"><div className="wektor-inspector-heading"><span>Kokpit</span><InspectorControls mode={inspector} setMode={setInspector} /></div>
      {pending && !hasWork ? <LoadingSurface kind="cockpit" /> : effective === 'summary' ? <div className="wektor-inspector-summary"><p>{visit ? 'Wybór terminu wizyty' : source.cockpit.task?.title ?? 'Szczegóły rozmowy'}</p>{source.cockpit.task && <b>{source.cockpit.task.status}</b>}<button type="button" className="wektor-text-button" onClick={() => setInspector('full')}>Rozwiń szczegóły</button></div> : <AppointmentOrCockpit><Cockpit source={source} /></AppointmentOrCockpit>}
      <ConversationDetails source={source} collapsed={presentedWork && effective !== 'summary'} />
    </aside>}
    {!show && !picking && <button type="button" className="wektor-reveal-inspector" aria-label="Pokaż szczegóły rozmowy" title="Szczegóły rozmowy i kokpit" onClick={() => setInspector('full')}><PanelRight size={17} /></button>}
  </div>;
}

function InspectorControls({ mode, setMode }: { mode: InspectorMode; setMode(mode: InspectorMode): void }) {
  return <select aria-label="Widok kokpitu" value={mode} onChange={e => setMode(e.target.value as InspectorMode)}><option value="auto">Automatyczny</option><option value="full">Pełny</option><option value="summary">Skrócony</option><option value="hidden">Ukryty</option></select>;
}
const timestamp = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
function ConversationDetails({ source, collapsed }: { source: CockpitSource; collapsed: boolean }) {
  const chat = source.chats?.find(c => c.id === source.activeId);
  const created = source.createdAt ?? chat?.createdAt ?? source.messages[0]?.at;
  const updated = source.messages.at(-1)?.at ?? chat?.updatedAt;
  return <details className="wektor-metadata" open={!collapsed}><summary>Szczegóły rozmowy</summary><dl><dt>ID konwersacji</dt><dd className="wektor-conversation-id">{source.activeId ?? 'Pojawi się po wysłaniu wiadomości'}</dd><dt>Rozpoczęta</dt><dd>{created ? timestamp.format(created) : 'Jeszcze nie rozpoczęta'}</dd><dt>Ostatnia wiadomość</dt><dd>{updated ? timestamp.format(updated) : '—'}</dd></dl></details>;
}
function LiveWindow(props: WindowProps) { return <CockpitWindow source={useLiveCockpit()} {...props} />; }
function MockWindow({ options, ...props }: WindowProps & { options: { hermesDown: boolean; speed: number } }) { return <CockpitWindow source={useMockCockpit(options)} {...props} />; }
export function ChatWindow(props: WindowProps) {
  const [mock] = useState(mockOptions);
  const [cache] = useState<ConversationCache>(() => ({ cards: new Map(), layouts: new Map(), last: { work: false, visit: false, pane: 'chat' } }));
  return <ConversationCacheContext.Provider value={cache}>{mock ? <MockWindow {...props} options={mock} /> : <LiveWindow {...props} />}</ConversationCacheContext.Provider>;
}
