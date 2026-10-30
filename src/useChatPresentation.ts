import { useCallback, useEffect, useState } from 'react';

export type ChatView = 'hidden' | 'compact' | 'full';
const nextView: Record<ChatView, ChatView> = { hidden: 'compact', compact: 'full', full: 'hidden' };

/** Presentation never starts a turn. Physical left Ctrl+Alt toggles pointing without a hold timer. */
export function useChatPresentation() {
  const [view, setView] = useState<ChatView>('hidden');
  const [picking, setPicking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const show = useCallback((next: ChatView) => { setPicking(false); setLoaded(true); setView(next); }, []);
  const close = useCallback(() => show('hidden'), [show]);
  useEffect(() => {
    const pressed = new Set<string>();
    let chord = false;
    let usedAlt = false;
    const down = (e: KeyboardEvent) => {
      pressed.add(e.code);
      if (e.isComposing) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyW') {
        e.preventDefault();
        if (e.repeat) return;
        setPicking(false); setLoaded(true); setView(v => nextView[v]);
      } else if ((e.code === 'ControlLeft' || e.code === 'AltLeft') && pressed.has('ControlLeft') && pressed.has('AltLeft') && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (e.repeat || chord) return;
        chord = true; usedAlt = true;
        setLoaded(true); setView('compact'); setPicking(value => !value);
      }
    };
    const up = (e: KeyboardEvent) => {
      pressed.delete(e.code);
      if (e.code === 'AltLeft' && usedAlt) { e.preventDefault(); usedAlt = false; }
      if (e.code === 'ControlLeft' || e.code === 'AltLeft') chord = false;
    };
    const resetKeys = () => { pressed.clear(); chord = false; usedAlt = false; };
    const visibility = () => { if (document.hidden) resetKeys(); };
    document.addEventListener('keydown', down); document.addEventListener('keyup', up);
    window.addEventListener('blur', resetKeys); document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('keydown', down); document.removeEventListener('keyup', up);
      window.removeEventListener('blur', resetKeys); document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return { view, picking, setPicking, loaded, show, close };
}
