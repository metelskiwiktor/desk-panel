import { useEffect, useRef } from 'react';
import { Check, ChevronRight, Mail, MailOpen, Trash2 } from 'lucide-react';
import { Card, Empty, SourceNote } from './components';
import { stamp } from './format';
import { MAX_AGE, type Detail } from './model';
import type { MailThread } from './mail-contract';
import type { MailState } from './useMail';
import { useSwipe } from './useSwipe';

/** Local part only: the two accounts differ there, and it keeps rows short. */
export const accountLabel = (email: string) => email.split('@')[0];

function MailRow({ thread, open, act, showAccount }: {
  thread: MailThread; open: (target: Detail) => void; act: MailState['act']; showAccount: boolean;
}) {
  // Left marks read (the frequent, harmless action); right moves to Trash.
  const { offset, handlers, isTap } = useSwipe(direction => act(thread, direction === 'left' ? 'read' : 'trash'));
  return <li className={`activity-swipe ${offset ? 'dragging' : ''}`}>
    {offset > 0 && <span className="activity-swipe-hint mail-hint-trash" aria-hidden="true"><Trash2 size={18} /> Do kosza</span>}
    {offset < 0 && <span className="activity-swipe-hint mail-hint-read" aria-hidden="true"><MailOpen size={18} /> Przeczytane</span>}
    <div className="activity-row" style={{ transform: `translateX(${offset}px)` }}>
      <button className="insight row mail-row" {...handlers} aria-label={`${thread.from}: ${thread.subject}`} onClick={event => { if (isTap(event)) open({ kind: 'mail', id: thread.id }); }}>
        <span className="row-body">
          <span className="mail-from">{thread.from}{thread.messages > 1 && <span className="mail-count"> {thread.messages}</span>}</span>
          <span className="row-title">{thread.subject}</span>
          <span className="meta mail-snippet">{thread.snippet}</span>
          <span className="meta activity-time">{stamp(thread.receivedAt)}{showAccount && ` · ${accountLabel(thread.account)}`}</span>
        </span>
        <ChevronRight size={16} />
      </button>
      <button className="activity-remove" aria-label={`Oznacz jako przeczytane: ${thread.subject}`} onClick={() => act(thread, 'read')}><Check size={17} /></button>
      <button className="activity-remove" aria-label={`Przenieś do kosza: ${thread.subject}`} onClick={() => act(thread, 'trash')}><Trash2 size={17} /></button>
    </div>
  </li>;
}

export function MailFeed({ mail, now, open, compact }: { mail: MailState; now: number; open: (target: Detail) => void; compact: boolean }) {
  const { source, threads, hasMore, loadMore, act, undo, restore, error } = mail;
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Infinite scroll inside the list; the button stays as the keyboard/no-observer path.
    const target = more.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMore(); });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, threads?.length, loadMore]);
  const showAccount = source.accounts.length > 1;
  const problems = source.accounts.filter(a => a.status !== 'connected' && a.status !== 'loading');
  return <Card title="Poczta" eyebrow="NIEPRZECZYTANE · GMAIL" icon={<Mail size={21} />}>
    <p className="card-intro">Przesuń w lewo — przeczytane, w prawo — do kosza.</p>
    {showAccount && <p className="meta mail-accounts">{source.accounts.map(a => `${accountLabel(a.email)}: ${a.unread ?? '—'}`).join(' · ')}</p>}
    {threads?.length ? <ul className={`activity-list mail-list ${compact ? 'compact' : ''}`} aria-label="Nieprzeczytane wiadomości">
      {threads.map(thread => <MailRow key={thread.id} thread={thread} open={open} act={act} showAccount={showAccount} />)}
      {hasMore && <li><button ref={more} className="button mail-more" onClick={loadMore}>Wczytaj więcej</button></li>}
    </ul> : <Empty>{source.status === 'loading' ? 'Ładowanie poczty…' : threads ? 'Brak nieprzeczytanych wiadomości.' : source.message || 'Poczta jest niedostępna.'}</Empty>}
    <div className="activity-undo" role="status">
      {undo && <><span>{undo === 'read' ? 'Oznaczono jako przeczytane.' : 'Przeniesiono do kosza.'}</span><button className="button" onClick={restore}>Cofnij</button></>}
      {error && <span className="warning">{error}</span>}
    </div>
    {problems.map(a => <p key={a.email} className="warning">{a.email}: {a.message || 'konto niedostępne.'}</p>)}
    <SourceNote source={source} now={now} maxAge={MAX_AGE.mail} refreshEveryMs={30000} />
  </Card>;
}
