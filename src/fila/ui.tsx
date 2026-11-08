import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Bug, CalendarDays, Check, ChevronDown, CircleDot, Ellipsis, Lightbulb, SlidersHorizontal, StickyNote } from 'lucide-react';
import { useDismiss } from '../popover';
import { checkFilaQuery, useFilaActions, type FilaRegistry, type FilaThreadRow } from './api';
import './fila.css';

/** Type → icon and tone (colour carries the type in lists and cards). */
const TYPE_ICON: Record<string, (size: number) => ReactNode> = {
  blad: size => <Bug size={size} />, funkcja: size => <Lightbulb size={size} />, sprawa: size => <CircleDot size={size} />,
  spotkanie: size => <CalendarDays size={size} />, notatka: size => <StickyNote size={size} />,
};
export const TypeIcon = ({ type, size = 16 }: { type: FilaThreadRow['type']; size?: number }) =>
  <span className={`fl-type tone-${type.key}`} title={type.label} role="img" aria-label={type.label}>{(TYPE_ICON[type.key] ?? TYPE_ICON.sprawa)(size)}</span>;

/** The workflow that holds the state; with one workflow (stage 1) it is that one. */
export const workflowOf = (registry: FilaRegistry, state: string) =>
  registry.workflows.find(w => w.states.some(s => s.name === state)) ?? registry.workflows[0];
export const stateTone = (state: string, closing: boolean) => closing ? 'closed' : ({ 'Pomysł': 'idea', 'Do przygotowania': 'prep', 'Gotowe do realizacji': 'ready', 'W realizacji': 'doing', 'Do sprawdzenia': 'review' } as Record<string, string>)[state] ?? 'idea';

/**
 * A button that opens a list of choices: arrows move, Enter chooses, Escape closes and gives focus back to the button.
 * `render` draws the items; `choose` closes the list after an item is picked.
 */
function useChoiceList() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useDismiss(open, () => close(false), root);
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[aria-selected="true"], [role^="menuitem"]:not(:disabled)')?.focus();
  }, [open]);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); close(); return; }
    if (!open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const items = [...root.current!.querySelectorAll<HTMLElement>('ul button:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return { open, setOpen, root, trigger, close, keys };
}

/** Changes the Stan of a thread: the values of its workflow, the closing ones apart (D-070, D-075). No checkbox. */
export function StatePicker({ thread, registry, compact = false, onError }: { thread: FilaThreadRow; registry: FilaRegistry; compact?: boolean; onError: (message: string) => void }) {
  const list = useChoiceList();
  const { act, error, clear } = useFilaActions();
  useEffect(() => { if (error) { onError(error); clear(); } }, [error, onError, clear]);
  const workflow = workflowOf(registry, thread.state);
  const pick = async (state: string) => {
    list.close();
    if (state !== thread.state) await act({ action: 'updateThread', thread: thread.id, state, expectedRevision: thread.revision });
  };
  const item = (state: { name: string; closing: boolean }) => <li key={state.name}>
    <button type="button" role="option" aria-selected={state.name === thread.state} className={`fl-st-${stateTone(state.name, state.closing)}`} onClick={() => void pick(state.name)}>
      <i className="fl-dot" />{state.name}{state.name === thread.state && <Check size={14} aria-hidden="true" />}
    </button>
  </li>;
  const closing = workflow?.states.find(s => s.name === thread.state)?.closing ?? thread.closed;
  return <div className="fl-anchor" ref={list.root} onKeyDown={list.keys}>
    <button type="button" ref={list.trigger} className={`fl-state fl-st-${stateTone(thread.state, closing)}${compact ? ' compact' : ''}`} aria-haspopup="listbox" aria-expanded={list.open}
      aria-label={`Stan ${thread.id}: ${thread.state}`} onClick={() => list.setOpen(!list.open)}>
      <i className="fl-dot" />{!compact && <span>{thread.state}</span>}<ChevronDown size={13} aria-hidden="true" />
    </button>
    {list.open && workflow && <ul className="fl-pop" role="listbox" aria-label={`Workflow ${workflow.name}`}>
      {workflow.states.filter(s => !s.closing).map(item)}
      <li className="fl-pop-label" role="presentation">Zamyka wątek</li>
      {workflow.states.filter(s => s.closing).map(item)}
    </ul>}
  </div>;
}

export interface MenuEntry { label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean }
/** A “⋯” menu: the entries are commands, none of them stays on screen as a button of its own (D-069, D-076). */
export function Menu({ label, entries, trigger = <Ellipsis size={18} aria-hidden="true" />, align = 'right' }: { label: string; entries: MenuEntry[]; trigger?: ReactNode; align?: 'left' | 'right' }) {
  const list = useChoiceList();
  return <div className="fl-anchor" ref={list.root} onKeyDown={list.keys}>
    <button type="button" ref={list.trigger} className="fl-icon" aria-label={label} aria-haspopup="menu" aria-expanded={list.open} onClick={() => list.setOpen(!list.open)}>{trigger}</button>
    {list.open && <ul className={`fl-pop ${align}`} role="menu" aria-label={label}>
      {entries.map(entry => <li key={entry.label}>
        <button type="button" role="menuitem" disabled={entry.disabled} className={entry.danger ? 'danger' : undefined} onClick={() => { list.close(); entry.onSelect(); }}>{entry.icon}{entry.label}</button>
      </li>)}
    </ul>}
  </div>;
}

/** A modal form: Escape or a press outside closes it and gives focus back to the control that opened it. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const opener = useRef<Element | null>(document.activeElement);
  const heading = useId();
  const box = useRef<HTMLFormElement | HTMLDivElement>(null);
  useEffect(() => {
    const previous = opener.current as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => previous?.focus?.();
  }, []);
  return <div className="fl-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="fl-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} ref={box as React.RefObject<HTMLDivElement>}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <h2 id={heading}>{title}</h2>
      {children}
    </div>
  </div>;
}

/** One text asked of the user (a name): used to create and rename boards, views, sections and columns. */
export function NameDialog({ title, label, initial = '', submit = 'Zapisz', onSubmit, onClose, error }: {
  title: string; label: string; initial?: string; submit?: string; onSubmit: (value: string) => void; onClose: () => void; error?: string;
}) {
  const [value, setValue] = useState(initial);
  const send = (event: FormEvent) => { event.preventDefault(); if (value.trim()) onSubmit(value.trim()); };
  return <Dialog title={title} onClose={onClose}>
    <form onSubmit={send}>
      <label>{label}<input value={value} maxLength={80} onChange={event => setValue(event.target.value)} /></label>
      {error && <p className="fl-error" role="alert">{error}</p>}
      <div className="fl-actions"><button type="button" className="fl-text" onClick={onClose}>Anuluj</button><button type="submit" className="fl-primary" disabled={!value.trim()}>{submit}</button></div>
    </form>
  </Dialog>;
}

export function ConfirmDialog({ title, text, confirm, onConfirm, onClose, error }: { title: string; text: string; confirm: string; onConfirm: () => void; onClose: () => void; error?: string }) {
  return <Dialog title={title} onClose={onClose}>
    <p className="fl-muted">{text}</p>
    {error && <p className="fl-error" role="alert">{error}</p>}
    <div className="fl-actions"><button type="button" className="fl-text" onClick={onClose}>Anuluj</button><button type="button" className="fl-primary danger" onClick={onConfirm}>{confirm}</button></div>
  </Dialog>;
}

/** The conditions of a query as pills: `projekt = DESK`, `otwarte`, …, `SORTUJ …`. The text stays the source (D-060). */
export function pillsOf(text: string): string[] {
  const [conditions, ...sorting] = text.split(/\s+SORTUJ\s+/i);
  const parts = conditions.split(/\s+(?:AND|i)\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/i).map(part => part.trim()).filter(Boolean);
  return sorting.length ? [...parts, `sortuj ${sorting.join(' ')}`] : parts;
}

/**
 * Pills of a section or a column; a press opens the query text right below them (D-067). The text is checked by the
 * server while it is typed and the server's sentence is shown; saving a refused text keeps the editor open.
 */
export function QueryEditor({ id, text, column = false, compact = false, onSave, control }: {
  id: string; text: string; column?: boolean; compact?: boolean; onSave: (text: string) => Promise<string | null>;
  /** Opened from outside (a column's menu): no pills are drawn, only the editor while it is open. */
  control?: { open: boolean; setOpen: (open: boolean) => void };
}) {
  const [own, setOwn] = useState(false);
  const open = control ? control.open : own, setOpen = control ? control.setOpen : setOwn;
  const [draft, setDraft] = useState(text);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const area = `fl-query-${id}`;
  useEffect(() => { if (!open) setDraft(text); }, [text, open]);
  useEffect(() => {
    if (!open || !draft.trim()) { setProblem(draft.trim() || !open ? null : 'Zapytanie nie może być puste.'); return; }
    let live = true;
    const timer = setTimeout(() => void checkFilaQuery(draft, column).then(result => { if (live) setProblem(result); }), 250);
    return () => { live = false; clearTimeout(timer); };
  }, [draft, open, column]);
  const close = () => { setOpen(false); setDraft(text); setProblem(null); toggle.current?.focus(); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const failure = await onSave(draft);
    setBusy(false);
    if (failure) setProblem(failure); else { setOpen(false); toggle.current?.focus(); }
  };
  return <>
    {!control && <button type="button" ref={toggle} className={`fl-pills${compact ? ' compact' : ''}`} aria-expanded={open} aria-controls={area} aria-label={`Zapytanie: ${text}`} onClick={() => open ? close() : setOpen(true)}>
      {pillsOf(text).map((pill, index) => <span key={index} className="fl-pill">{pill}</span>)}<SlidersHorizontal size={13} aria-hidden="true" />
    </button>}
    {open && <form className="fl-query" id={area} onSubmit={save} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <textarea aria-label="Tekst zapytania" autoFocus aria-invalid={!!problem} value={draft} spellCheck={false} rows={Math.min(6, Math.max(2, draft.split('\n').length))} onChange={event => setDraft(event.target.value)} />
      {problem && <p className="fl-error" role="alert">{problem}</p>}
      <div className="fl-actions"><button type="button" className="fl-text" onClick={close}>Anuluj</button><button type="submit" className="fl-primary small" disabled={busy || !!problem || draft === text || !draft.trim()}>Zapisz zapytanie</button></div>
    </form>}
  </>;
}
