import type { ContextItem, ContextKind } from './chat-contract';

/** Never more than the agent should read at once (the server accepts 2000). */
export const MAX_CONTEXT_TEXT = 1800;
const MAX_TITLE = 120;

/** Attributes that make an element pickable: spread them on the row or tile, `{...ctx('mail', id, title, text)}`. */
export function ctx(kind: ContextKind, id: string, title: string, text?: string): Record<string, string> {
  return { 'data-ctx-kind': kind, 'data-ctx-id': id, 'data-ctx-title': title, ...(text === undefined ? {} : { 'data-ctx-text': text }) };
}

const tidy = (text: string) => text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** The nearest pickable element at or above `target`, so a row wins over the tile it stands in. */
export function pickableAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-ctx-kind]') : null;
}

/** What the agent is told about a pickable element: its attributes, else what is written in it. */
export function contextFrom(el: HTMLElement): ContextItem | null {
  const kind = el.dataset.ctxKind as ContextKind | undefined;
  if (!kind) return null;
  // `innerText` is what the user sees (hidden parts left out); jsdom has none, so the text content stands in.
  const visible = tidy(el.dataset.ctxText ?? (el.innerText || el.textContent || ''));
  const title = clip(tidy((el.dataset.ctxTitle ?? visible.split('\n')[0]) || 'Element pulpitu').replace(/\n/g, ' '), MAX_TITLE);
  return { kind, id: clip(el.dataset.ctxId || title, 200), title, text: clip(visible, MAX_CONTEXT_TEXT) };
}

export const sameContext = (a: ContextItem, b: ContextItem) => a.kind === b.kind && a.id === b.id;

/** Marks the elements already picked, so they show it on the dashboard. Returns how many were marked. */
export function markPicked(root: ParentNode, picked: ContextItem[]): number {
  let count = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[data-ctx-kind]')) {
    const on = picked.some(item => item.kind === el.dataset.ctxKind && item.id === el.dataset.ctxId);
    if (on) { count++; el.setAttribute('data-ctx-picked', ''); } else el.removeAttribute('data-ctx-picked');
  }
  return count;
}
