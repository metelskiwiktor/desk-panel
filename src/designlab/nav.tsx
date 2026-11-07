import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** In-mockup navigation without a document reload (docs/designlab.md): history API plus a subscription to the query string. */
const CHANGED = 'designlab-navigate';
const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  window.addEventListener(CHANGED, notify);
  return () => { window.removeEventListener('popstate', notify); window.removeEventListener(CHANGED, notify); };
};

/** The current query string; re-renders on navigation, Back and Forward. */
export const useSearch = () => useSyncExternalStore(subscribe, () => window.location.search);

function navigate(search: string) {
  if (search === window.location.search) return;
  window.history.pushState(null, '', search);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(CHANGED));
}

/** A link to another view of the same mockup (`?designlab=…`): a click navigates in place; modified clicks keep the browser default. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={click} {...rest} />;
}
