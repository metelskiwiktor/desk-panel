import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FilaRegistry, FilaThreadRow } from './api';
import { StatePicker, TypeIcon } from './ui';

/**
 * One engine for lists, kanban cards and the tile (D-053): a thread row/card with its Stan picker. Opening a thread is
 * not available before the thread page (part 2): the title is text, not a link.
 */
export const tagsOf = (thread: FilaThreadRow) => Array.isArray(thread.fields.Tagi) ? thread.fields.Tagi : [];

/** One level of subthreads (D-051): a child whose parent is in the same result shows under it. */
export function nestChildren(threads: FilaThreadRow[]): { top: FilaThreadRow[]; children: Map<string, FilaThreadRow[]> } {
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

export function ThreadList({ threads, registry, showProject = false, onError, compact = false }: { threads: FilaThreadRow[]; registry: FilaRegistry; showProject?: boolean; onError: (message: string) => void; compact?: boolean }) {
  const { top, children } = nestChildren(threads);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const row = (thread: FilaThreadRow, nested = false) => {
    const kids = children.get(thread.id) ?? [];
    return <li key={thread.id} className={`fl-row${thread.closed ? ' closed' : ''}${nested ? ' nested' : ''}${compact ? ' compact' : ''}`}>
      <div className="fl-row-line">
        <TypeIcon type={thread.type} />
        <span className="fl-id">{thread.id}</span>
        <div className="fl-row-main">
          <span className="fl-title">{thread.title}</span>
          {!nested && kids.length > 0 && <Progress id={thread.id} children={kids} open={!!open[thread.id]} toggle={() => setOpen(previous => ({ ...previous, [thread.id]: !previous[thread.id] }))} />}
          {tagsOf(thread).map(tag => <span key={tag} className="fl-tag">#{tag}</span>)}
        </div>
        {!compact && <span className="fl-module">{showProject ? `${thread.project}${thread.module ? ` · ${thread.module}` : ''}` : thread.module}</span>}
        <StatePicker thread={thread} registry={registry} onError={onError} compact={compact} />
      </div>
      {!nested && open[thread.id] && kids.length > 0 && <ul className="fl-subrows">{kids.map(kid => row(kid, true))}</ul>}
    </li>;
  };
  return <ul className="fl-list">{top.map(thread => row(thread))}</ul>;
}

export function ThreadCard({ thread, registry, onError }: { thread: FilaThreadRow; registry: FilaRegistry; onError: (message: string) => void }) {
  return <li className={`fl-card${thread.closed ? ' closed' : ''}`}>
    <div className="fl-card-top">
      <TypeIcon type={thread.type} size={15} /><span className="fl-id">{thread.id}</span><span className="fl-module">{thread.module}</span>
      <StatePicker thread={thread} registry={registry} onError={onError} compact />
    </div>
    <span className="fl-title">{thread.title}</span>
    {tagsOf(thread).length > 0 && <div className="fl-card-meta">{tagsOf(thread).map(tag => <span key={tag} className="fl-tag">#{tag}</span>)}</div>}
  </li>;
}
