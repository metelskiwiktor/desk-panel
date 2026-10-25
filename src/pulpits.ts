import { useCallback, useRef, useState } from 'react';
import { WORKSPACE_KEY, resetWorkspace, saveWorkspace } from './tile-grid';

/**
 * Virtual desktops ("pulpity"): each one is its own arrangement of the tile grid in the middle of the home page. The clock,
 * the day strip and the days zone are shared. The first desktop keeps the original workspace key, so a layout saved before
 * there were desktops is simply the "Główny" one.
 */
export const PULPITS_KEY = 'desk-panel.pulpits';
export const MAX_PULPITS = 8;
export const MAX_NAME = 40;
export const MAIN_PULPIT = 'main';

export type Pulpit = { id: string; name: string };
export type PulpitState = { items: Pulpit[]; active: string };

export const workspaceKey = (id: string) => (id === MAIN_PULPIT ? WORKSPACE_KEY : `${WORKSPACE_KEY}.${id}`);

export const defaultPulpits = (): PulpitState => ({ items: [{ id: MAIN_PULPIT, name: 'Główny' }], active: MAIN_PULPIT });

const ID = /^[a-z0-9-]{1,20}$/;

export function parsePulpits(raw: string | null): PulpitState {
  try {
    if (!raw) return defaultPulpits();
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.items) || saved.items.length < 1 || saved.items.length > MAX_PULPITS) return defaultPulpits();
    const items: Pulpit[] = saved.items.map((p: Record<string, unknown>) => ({ id: p?.id as string, name: p?.name as string }));
    const valid = items.every((p, i) =>
      typeof p.id === 'string' && ID.test(p.id) && typeof p.name === 'string' && p.name.trim().length >= 1 && p.name.length <= MAX_NAME &&
      items.findIndex(o => o.id === p.id) === i);
    if (!valid || !items.some(p => p.id === saved.active)) return defaultPulpits();
    return { items, active: saved.active };
  } catch {
    return defaultPulpits();
  }
}

export function readPulpits(): PulpitState {
  try { return parsePulpits(localStorage.getItem(PULPITS_KEY)); } catch { return defaultPulpits(); }
}

export function savePulpits(state: PulpitState): boolean {
  try { localStorage.setItem(PULPITS_KEY, JSON.stringify({ version: 1, ...state })); return true; } catch { return false; }
}

export function newPulpitId(state: PulpitState): string {
  let id = `p${Date.now().toString(36)}`;
  while (state.items.some(p => p.id === id)) id += 'x';
  return id.slice(0, 20);
}

/** "Pulpit 2", "Pulpit 3"…: the smallest number not taken yet. */
export function freeName(state: PulpitState): string {
  for (let n = 2; ; n++) if (!state.items.some(p => p.name === `Pulpit ${n}`)) return `Pulpit ${n}`;
}

/** Adds a desktop and makes it the open one; at the limit the state is returned as it was. */
export function addPulpit(state: PulpitState, id: string): PulpitState {
  if (state.items.length >= MAX_PULPITS || state.items.some(p => p.id === id)) return state;
  return { items: [...state.items, { id, name: freeName(state) }], active: id };
}

export function renamePulpit(state: PulpitState, id: string, name: string): PulpitState {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean || !state.items.some(p => p.id === id)) return state;
  return { ...state, items: state.items.map(p => (p.id === id ? { ...p, name: clean } : p)) };
}

/** The last desktop cannot be removed. When the open one goes, its left neighbour (or the first) takes over. */
export function removePulpit(state: PulpitState, id: string): PulpitState {
  const index = state.items.findIndex(p => p.id === id);
  if (index < 0 || state.items.length <= 1) return state;
  const items = state.items.filter(p => p.id !== id);
  return { items, active: state.active === id ? items[Math.max(0, index - 1)].id : state.active };
}

export function selectPulpit(state: PulpitState, id: string): PulpitState {
  return state.items.some(p => p.id === id) ? { ...state, active: id } : state;
}

export type Pulpits = ReturnType<typeof usePulpits>;

export function usePulpits() {
  const [state, setState] = useState(readPulpits);
  const current = useRef(state);
  const apply = useCallback((next: PulpitState) => {
    if (next === current.current) return;
    current.current = next;
    setState(next);
    savePulpits(next);
  }, []);
  const select = useCallback((id: string) => apply(selectPulpit(current.current, id)), [apply]);
  const rename = useCallback((id: string, name: string) => apply(renamePulpit(current.current, id, name)), [apply]);
  const add = useCallback(() => {
    const id = newPulpitId(current.current);
    const next = addPulpit(current.current, id);
    if (next === current.current) return;
    saveWorkspace([], workspaceKey(id)); // a new desktop starts empty, not with the automatic arrangement
    apply(next);
  }, [apply]);
  const remove = useCallback((id: string) => {
    const next = removePulpit(current.current, id);
    if (next === current.current) return;
    resetWorkspace(workspaceKey(id));
    apply(next);
  }, [apply]);
  /** Settings → "Przywróć domyślny układ": the first desktop returns to the automatic arrangement, the others to empty. */
  const resetActive = useCallback(() => {
    const id = current.current.active;
    return id === MAIN_PULPIT ? resetWorkspace() : saveWorkspace([], workspaceKey(id));
  }, []);
  return { ...state, select, rename, add, remove, resetActive };
}
