/** Neutral space for the destination conversation; never displays the previous chat's task or cards. */
export function LoadingSurface({ kind }: { kind: 'chat' | 'cockpit' }) {
  return <div className={`wektor-loading wektor-loading-${kind}`} role="status" aria-label={kind === 'chat' ? 'Wczytywanie rozmowy' : 'Wczytywanie kokpitu'}>
    <span className="tw:sr-only">{kind === 'chat' ? 'Wczytuję rozmowę…' : 'Wczytuję kokpit…'}</span>
    <div className="wektor-loading-block"><i /><i /><i /></div>
    <div className="wektor-loading-block"><i /><i /><i /></div>
  </div>;
}
