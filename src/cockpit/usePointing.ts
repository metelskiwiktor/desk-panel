import { useEffect } from 'react';
import { MAX_CONTEXT, type ContextItem } from '../chat-contract';
import { contextFrom, markPicked, pickableAt, sameContext } from '../chat-context';

/**
 * Pointing at the dashboard: while `picking`, the chat docks to the right edge (the dashboard makes room, see chat.css)
 * and every click outside it picks the element under it instead of using it. Picked elements are marked on the
 * dashboard, also after it redraws.
 */
export function usePointing(picking: boolean, context: ContextItem[], setContext: (fn: (list: ContextItem[]) => ContextItem[]) => void) {
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
  }, [picking, setContext]);

  useEffect(() => {
    if (!picking) return;
    markPicked(document, context);
    let frame = 0;
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => markPicked(document, context)); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); markPicked(document, []); };
  }, [picking, context]);
}
