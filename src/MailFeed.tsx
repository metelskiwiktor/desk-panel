import { useEffect, useRef } from 'react';
import { Check, MailOpen, Trash2 } from 'lucide-react';
import { Empty, SourceNote } from './components';
import { stamp } from './format';
import { MAX_AGE, fresh, type Detail } from './model';
import type { MailThread } from './mail-contract';
import type { MailState } from './useMail';
import { useSwipe } from './useSwipe';

/** Local part only: the two accounts differ there, and it keeps rows short. */
export const accountLabel = (email: string) => email.split('@')[0];
/** Mailboxes are told apart by colour (hue and lightness), in the order they are configured. */
const ACCOUNT_TONES = 3;
const toneOf = (accounts: { email: string }[], email: string) => `account-${Math.max(0, accounts.findIndex(a => a.email === email)) % ACCOUNT_TONES}`;

function MailRow({ thread, open, act, tone }: {
  thread: MailThread; open: (target: Detail) => void; act: MailState['act']; tone: string | null;
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
        </span>
        <span className="mail-side">
          <span className="meta">{stamp(thread.receivedAt)}</span>
          {tone && <span className={`account-tag ${tone}`}>{accountLabel(thread.account)}</span>}
        </span>
      </button>
      <button className="activity-remove" aria-label={`Oznacz jako przeczytane: ${thread.subject}`} onClick={() => act(thread, 'read')}><Check size={17} /></button>
      <button className="activity-remove" aria-label={`Przenieś do kosza: ${thread.subject}`} onClick={() => act(thread, 'trash')}><Trash2 size={17} /></button>
    </div>
  </li>;
}

/** Unread inbox conversations; the list scrolls inside the space the dashboard leaves it. */
export function MailFeed({ mail, now, open }: { mail: MailState; now: number; open: (target: Detail) => void }) {
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
  const many = source.accounts.length > 1;
  const problems = source.accounts.filter(a => a.status !== 'connected' && a.status !== 'loading');
  return <section className="pulpit-card mail-card" aria-labelledby="mail-title">
    <div className="pulpit-card-head">
      <h2 id="mail-title">Poczta</h2>
      {many && <span className="mail-accounts">{source.accounts.map(a =>
        <span key={a.email} className={`account-tag ${toneOf(source.accounts, a.email)}`}>{accountLabel(a.email)} {a.unread ?? '—'}</span>)}</span>}
    </div>
    {problems.map(a => <p key={a.email} className="mail-problem">{a.email} · {a.message || 'konto niedostępne.'}</p>)}
    {threads?.length ? <ul className="activity-list mail-list" aria-label="Nieprzeczytane wiadomości">
      {threads.map(thread => <MailRow key={thread.id} thread={thread} open={open} act={act} tone={many ? toneOf(source.accounts, thread.account) : null} />)}
      {hasMore && <li><button ref={more} className="button mail-more" onClick={loadMore}>Wczytaj więcej</button></li>}
    </ul> : <Empty>{source.status === 'loading' ? 'Ładowanie poczty…' : threads ? 'Brak nieprzeczytanych wiadomości.' : source.message || 'Poczta jest niedostępna.'}</Empty>}
    <div className="activity-undo" role="status">
      {undo && <><span>{undo === 'read' ? 'Oznaczono jako przeczytane.' : 'Przeniesiono do kosza.'}</span><button className="button" onClick={restore}>Cofnij</button></>}
      {error && <span className="warning">{error}</span>}
      {!undo && !error && threads?.length ? <span className="meta">← przeczytane · do kosza →</span> : null}
    </div>
    {!fresh(source, now, MAX_AGE.mail) && <SourceNote source={source} now={now} maxAge={MAX_AGE.mail} refreshEveryMs={30000} />}
  </section>;
}
