import { createContext, useContext, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FilaRegistry, FilaThreadRow } from './api';
import { StatePicker, TypeIcon } from './ui';
import { ctx } from '../chat-context';

/**
 * One engine for lists, kanban cards and the tile (D-053): a thread row/card with its Stan picker. The ID is what opens
 * the thread (highlighted on hover); the title is plain text.
 */
export const tagsOf = (thread: FilaThreadRow) => Array.isArray(thread.fields.Tagi) ? thread.fields.Tagi : [];

/** Every subthread of every thread, by the parent's ID: what a board shows under a thread whatever its sections ask for. */
export const ChildrenContext = createContext<Map<string, FilaThreadRow[]>>(new Map());

/** One level of subthreads (D-051): a child whose parent is in the same result shows under it, not beside it. */
function nestChildren(threads: FilaThreadRow[]): { top: FilaThreadRow[]; children: Map<string, FilaThreadRow[]> } {
  const ids = new Set(threads.map(t => t.id));
  const children = new Map<string, FilaThreadRow[]>();
  for (const thread of threads) if (thread.parent && ids.has(thread.parent)) children.set(thread.parent, [...(children.get(thread.parent) ?? []), thread]);
  return { top: threads.filter(t => !t.parent || !ids.has(t.parent)), children };
}

function Progress({ children, open, toggle, id }: { children: FilaThreadRow[]; open: boolean; toggle: () => void; id: string }) {
  const closed = children.filter(c => c.closed).length;
  return <button type="button" className="fl-progress" aria-expanded={open} aria-label={`Podwątki ${id}: ${closed} z ${children.length} zamkniętych`} onClick={toggle}>
    {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{closed}/{children.length}
  </button>;
}

/** The ID of a thread: a button that opens it where a page for it exists, plain text where it does not. */
export function ThreadId({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  return onOpen
    ? <button type="button" className="fl-id open" aria-label={`Otwórz ${id}`} onClick={() => onOpen(id)}>{id}</button>
    : <span className="fl-id">{id}</span>;
}

export function ThreadList({ threads, registry, showProject = false, onError, compact = false, onOpen, flat = false }: {
  threads: FilaThreadRow[]; registry: FilaRegistry; showProject?: boolean; onError: (message: string) => void; compact?: boolean;
  onOpen?: (id: string) => void;
  /** No subthreads under the rows (the thread page lists the subthreads itself, one level). */
  flat?: boolean;
}) {
  const { top, children } = nestChildren(threads);
  const index = useContext(ChildrenContext);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const kidsOf = (thread: FilaThreadRow) => flat ? [] : index.get(thread.id) ?? children.get(thread.id) ?? [];
  const row = (thread: FilaThreadRow, nested = false) => {
    const kids = nested ? [] : kidsOf(thread);
    const open = !collapsed[thread.id];
    return <li key={thread.id} {...ctx('filaThread', thread.id, thread.title, `ID: ${thread.id}\nStan: ${thread.state}\nPełny wątek: fila_get.`)} className={`fl-row${thread.closed ? ' closed' : ''}${nested ? ' nested' : ''}${compact ? ' compact' : ''}`}>
      <div className="fl-row-line">
        <TypeIcon type={thread.type} />
        <ThreadId id={thread.id} onOpen={onOpen} />
        <div className="fl-row-main">
          <span className="fl-title">{thread.title}</span>
          {kids.length > 0 && <Progress id={thread.id} children={kids} open={open} toggle={() => setCollapsed(previous => ({ ...previous, [thread.id]: open }))} />}
          {tagsOf(thread).map(tag => <span key={tag} className="fl-tag">#{tag}</span>)}
        </div>
        {!compact && <span className="fl-module">{showProject ? `${thread.project}${thread.module ? ` · ${thread.module}` : ''}` : thread.module}</span>}
        <StatePicker thread={thread} registry={registry} onError={onError} compact={compact} />
      </div>
      {open && kids.length > 0 && <ul className="fl-subrows">{kids.map(kid => row(kid, true))}</ul>}
    </li>;
  };
  return <ul className="fl-list">{top.map(thread => row(thread))}</ul>;
}

export function ThreadCard({ thread, registry, onError, onOpen }: { thread: FilaThreadRow; registry: FilaRegistry; onError: (message: string) => void; onOpen?: (id: string) => void }) {
  const kids = useContext(ChildrenContext).get(thread.id) ?? [];
  const [collapsed, setCollapsed] = useState(false);
  return <li {...ctx('filaThread', thread.id, thread.title, `ID: ${thread.id}\nStan: ${thread.state}\nPełny wątek: fila_get.`)} className={`fl-card${thread.closed ? ' closed' : ''}`}>
    <div className="fl-card-top">
      <TypeIcon type={thread.type} size={15} /><ThreadId id={thread.id} onOpen={onOpen} /><span className="fl-module">{thread.module}</span>
      <StatePicker thread={thread} registry={registry} onError={onError} compact />
    </div>
    <span className="fl-title">{thread.title}</span>
    {(tagsOf(thread).length > 0 || kids.length > 0) && <div className="fl-card-meta">
      {kids.length > 0 && <Progress id={thread.id} children={kids} open={!collapsed} toggle={() => setCollapsed(!collapsed)} />}
      {tagsOf(thread).map(tag => <span key={tag} className="fl-tag">#{tag}</span>)}
    </div>}
    {!collapsed && kids.length > 0 && <ul className="fl-card-subs">{kids.map(kid => <li key={kid.id} className={kid.closed ? 'closed' : undefined}>
      <ThreadId id={kid.id} onOpen={onOpen} /><span>{kid.title}</span><StatePicker thread={kid} registry={registry} onError={onError} compact />
    </li>)}</ul>}
  </li>;
}
