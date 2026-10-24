import { useEffect, type RefObject } from 'react';

/** A popover folds on Escape and on a tap outside `root`, like any menu. */
export function useDismiss(isOpen: boolean, close: () => void, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [isOpen, close, root]);
}
