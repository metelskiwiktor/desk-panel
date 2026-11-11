import { useCallback, useEffect, useRef, useState } from 'react';
import { usePollingEnabled } from '../polling';
import type { FilaAction, FilaResult, FilaSection, FilaWorkflow } from '../fila-contract';

/** What `/api/fila` answers (docs/fila.md). The shapes are the server's; the UI reads them, never invents them. */
export interface FilaThreadRow {
  id: string; project: string; number: number; type: { key: string; label: string }; state: string; closed: boolean;
  title: string; parent: string | null; module: string | null; fields: Record<string, string | number | boolean | string[]>;
  archived: boolean; revision: number; updatedAt: number;
}
export interface FilaRegistry {
  projects: { key: string; name: string; modules: string[]; counts: { open: number; closed: number; archived: number }; board: string | null }[];
  boards: { id: string; name: string; views: { id: string; name: string }[] }[];
  workflows: FilaWorkflow[];
  fieldDefs: { name: string; kind: 'text' | 'number' | 'date' | 'bool' | 'multi' }[];
  types: { key: string; label: string; workflow: string; fields: string[]; spec: boolean; cezar: boolean }[];
  /** The states a thread may be dispatched to Cezar from (2.1). */
  cezarSettings: { readyStates: { workflow: string; state: string }[] };
  notice?: string;
}
/** One thread in full (GET /api/fila/threads/ID). */
export type FilaFieldValue = string | number | boolean | string[];
export interface FilaThreadDoc {
  id: string; uid: string; project: string; type: { key: string; label: string }; workflow: { id: string; name: string };
  state: string; closed: boolean; title: string; description: string; parent: string | null; children: string[];
  module: string | null; fields: Record<string, FilaFieldValue>; spec: { enabled: boolean; revision: number };
  /** The Cezar kit (1.4a): `enabled` false with empty values when it was never added; task and PR are links, not fields. */
  cezar: { enabled: boolean; executor: 'cezar' | 'lokalnie' | 'rozmowa' | null; repo: 'desk-panel' | null; mode: 'analiza' | 'implementacja' | null; links: { kind: 'cezar' | 'pr'; id: string; title?: string; at: number }[] };
  /** „Zablokowane” (2.3a): the thread's blocks; it is blocked while the list has an entry. */
  blockers: { id: string; reason: string; origin: { kind: string }; at: number; by: string }[];
  archived: boolean; revision: number; createdAt: number; updatedAt: number; createdBy: string;
  history: { at: number; by: string; kind: string; text?: string; changes?: { field: string; from: string | null; to: string | null }[] }[];
}
export interface FilaSpecDoc { thread: string; enabled: boolean; revision: number; text: string | null; by: string | null; at: number | null; latest: number }
export interface FilaBoardDoc {
  id: string; name: string; project: string | null;
  views: { id: string; name: string; sections: FilaSection[] }[];
  history: { at: number; by: string; kind: string; target: string; name: string; in?: string; changes?: { field: string; from: string | null; to: string | null }[] }[];
}
export interface FilaViewDoc {
  sections: (Omit<FilaSection, 'columns'> & {
    error?: string; total: number; threads: FilaThreadRow[];
    columns: (FilaSection['columns'][number] & { total: number; threads: FilaThreadRow[] })[];
  })[];
}

const POLL_MS = 5000;
const CHANGED = 'fila-changed';
/** Every reader refetches after any change, so a thread shown in several places is never stale in one of them. */
const announce = () => window.dispatchEvent(new Event(CHANGED));
/** For a change made outside an action (the Cezar dispatch, which the server writes as `panel`): every reader refetches. */
export const announceFilaChange = announce;

async function failure(response: Response): Promise<Error> {
  const reason = await response.json().then((body: { error?: unknown }) => typeof body.error === 'string' ? body.error : '', () => '');
  return new Error(reason || 'Nie udało się wykonać operacji.');
}

/** One GET, polled and refetched after every change. `url` null = nothing to read. */
export function useFilaGet<T>(url: string | null): { data: T | null; error: string; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string }>({ url, data: null, error: '' });
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!url || !pollingEnabled) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, controller: AbortController;
    const read = async () => {
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw await failure(response);
        const data = await response.json() as T;
        if (!stopped) setState({ url, data, error: '' });
      } catch (error) {
        if (!stopped && !controller.signal.aborted) setState(previous => ({ url, data: previous.url === url ? previous.data : null, error: (error as Error).message || 'Nie można połączyć się z lokalnym serwerem.' }));
      } finally {
        if (!stopped) timer = setTimeout(read, POLL_MS);
      }
    };
    void read();
    window.addEventListener(CHANGED, read);
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); window.removeEventListener(CHANGED, read); };
  }, [url, pollingEnabled]);
  const current = state.url === url;
  return { data: current ? state.data : null, error: current ? state.error : '', loading: !!url && (!current || (state.data === null && !state.error)) };
}

export const useFilaRegistry = () => useFilaGet<FilaRegistry>('/api/fila');
export const useFilaBoard = (id: string | null) => useFilaGet<FilaBoardDoc>(id ? `/api/fila/boards/${id}` : null);
/**
 * Every subthread of the given projects by the parent's ID (one query per project, polled and refetched after a change):
 * a board shows a thread's subthreads under it whatever its sections select. A subthread in another project than its parent is found with its own project.
 */
export function useFilaChildIndex(keys: string[]): Map<string, FilaThreadRow[]> {
  const [index, setIndex] = useState<Map<string, FilaThreadRow[]>>(new Map());
  const signature = keys.join(',');
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!signature || !pollingEnabled) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      clearTimeout(timer);
      try {
        const lists = await Promise.all(signature.split(',').map(async key => {
          const response = await fetch(`/api/fila/query?q=${encodeURIComponent(`projekt = ${key} AND rodzic istnieje`)}&limit=5000`);
          if (!response.ok) throw await failure(response);
          return (await response.json() as { threads: FilaThreadRow[] }).threads;
        }));
        const next = new Map<string, FilaThreadRow[]>();
        for (const thread of lists.flat()) if (thread.parent) next.set(thread.parent, [...(next.get(thread.parent) ?? []), thread]);
        if (!stopped) setIndex(next);
      } catch { /* the board still shows what its sections select */ }
      finally { if (!stopped) timer = setTimeout(read, POLL_MS); }
    };
    void read();
    window.addEventListener(CHANGED, read);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener(CHANGED, read); };
  }, [signature, pollingEnabled]);
  return index;
}

/** The branch above a thread: its parent, the parent's parent and so on up to the root, root first (at most 12 levels). */
export function useFilaAncestors(thread: Pick<FilaThreadDoc, 'id' | 'parent' | 'revision'> | null): { id: string; title: string }[] {
  const [branch, setBranch] = useState<{ id: string; title: string }[]>([]);
  const parent = thread?.parent ?? null, revision = thread?.revision;
  useEffect(() => {
    if (!parent) { setBranch([]); return; }
    let stopped = false;
    const read = async () => {
      const chain: { id: string; title: string }[] = [];
      for (let id: string | null = parent; id && chain.length < 12 && !chain.some(item => item.id === id);) {
        const response = await fetch(`/api/fila/threads/${id}`).catch(() => null);
        if (!response?.ok) break;
        const doc = await response.json() as FilaThreadDoc;
        chain.unshift({ id: doc.id, title: doc.title });
        id = doc.parent;
      }
      if (!stopped) setBranch(chain);
    };
    void read();
    window.addEventListener(CHANGED, read);
    return () => { stopped = true; window.removeEventListener(CHANGED, read); };
  }, [parent, revision]);
  return branch;
}

export const useFilaThread = (id: string | null) => useFilaGet<FilaThreadDoc>(id ? `/api/fila/threads/${id}` : null);
/** The Specyfikacja text: the newest revision, or a numbered one. Needs the thread to have the field (else 404, shown as no text). */
export const useFilaSpec = (id: string | null, revision?: number) =>
  useFilaGet<FilaSpecDoc>(id ? `/api/fila/threads/${id}/spec${revision ? `/${revision}` : ''}` : null);
export const useFilaView = (board: string | null, view: string | null) =>
  useFilaGet<FilaViewDoc>(board && view ? `/api/fila/boards/${board}/views/${view}` : null);

/** Sends one action as the user (the panel's own page, D-006). Throws the server's one-sentence reason. */
export async function sendFilaAction(action: FilaAction): Promise<FilaResult> {
  const response = await fetch('/api/fila/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw await failure(response);
  const result = await response.json() as FilaResult;
  announce();
  return result;
}

/** Actions with the last refusal kept for the caller to show; `act` answers null when refused. */
export function useFilaActions() {
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const act = useCallback(async (action: FilaAction): Promise<FilaResult | null> => {
    setError('');
    try { return await sendFilaAction(action); }
    catch (failed) { if (mounted.current) setError((failed as Error).message || 'Nie udało się zapisać zmiany.'); return null; }
  }, []);
  return { act, error, clear: () => setError('') };
}

/** The server's verdict on a query text, without running or storing it: null when it is fine, else the sentence to show. */
export async function checkFilaQuery(text: string, column: boolean): Promise<string | null> {
  try {
    const response = await fetch(`/api/fila/query/check?q=${encodeURIComponent(text)}${column ? '&kind=column' : ''}`);
    if (response.ok) return null;
    return (await failure(response)).message;
  } catch { return 'Nie można sprawdzić zapytania: brak połączenia z serwerem.'; }
}
