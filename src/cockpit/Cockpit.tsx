import { Check, CircleDashed, CircleX, ExternalLink, GitBranch, GitPullRequest, LoaderCircle, Radar } from 'lucide-react';
import type { CezarStatus, CheckState, CockpitSource } from './types';

const section = 'tw:rounded-2xl tw:border tw:border-ck-line tw:bg-ck-surface tw:p-4';
const eyebrow = 'tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.14em] tw:text-ck-muted';
const STATUS_LOOK: Record<CezarStatus, string> = {
  QUEUED: 'tw:bg-ck-faint/20 tw:text-ck-muted',
  RUNNING: 'tw:bg-ck-amber/15 tw:text-ck-amber',
  INPUT: 'tw:bg-ck-red/15 tw:text-ck-red',
  REVIEW: 'tw:bg-ck-agent/15 tw:text-ck-agent',
  DONE: 'tw:bg-ck-green/15 tw:text-ck-green',
  FAILED: 'tw:bg-ck-red/15 tw:text-ck-red',
};
const STATUS_TEXT: Partial<Record<CezarStatus, string>> = { INPUT: 'PYTANIE' };
const PR_STATE: Record<string, string> = { MERGED: 'scalony', CLOSED: 'zamknięty' };
const tokens = new Intl.NumberFormat('pl-PL');
const time = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });

function CheckIcon({ state }: { state: CheckState }) {
  if (state === 'pass') return <Check size={14} className="tw:text-ck-green" aria-label="przeszedł" />;
  if (state === 'fail') return <CircleX size={14} className="tw:text-ck-red" aria-label="nie przeszedł" />;
  if (state === 'running') return <LoaderCircle size={14} className="tw:animate-spin tw:text-ck-amber" aria-label="w toku" />;
  return <CircleDashed size={14} className="tw:text-ck-faint" aria-label="czeka" />;
}

/**
 * The right column: what Wektor is watching. The task in Cezar and its pull request with CI checks.
 */
export function Cockpit({ source }: { source: CockpitSource }) {
  const { cockpit } = source;
  const { task, pr } = cockpit;
  return <div className="tw:flex tw:flex-col tw:gap-3 tw:p-4">
    {task && <div className={`tw:flex tw:items-center tw:gap-3 tw:rounded-2xl tw:border tw:px-4 tw:py-3 ${cockpit.watching ? 'tw:border-ck-amber/40 tw:bg-ck-amber/10' : 'tw:border-ck-line tw:bg-ck-surface'}`} role="status">
      <Radar size={18} className={cockpit.watching ? 'tw:text-ck-amber tw:animate-ck-pulse' : 'tw:text-ck-faint'} aria-hidden="true" />
      <div className="tw:min-w-0">
        <div className="tw:text-sm tw:font-semibold tw:text-ck-text">{cockpit.watching ? 'Wektor monitoruje task' : task ? 'Wektor nie monitoruje teraz' : 'Brak aktywnego monitorowania'}</div>
        <div className="tw:text-xs tw:text-ck-muted">{cockpit.watching ? `${cockpit.since ? `od ${time.format(cockpit.since)} · ` : ''}odświeża co kilka sekund`
          : task ? (task.status === 'REVIEW' ? 'Task czeka na Twój przegląd.' : task.status === 'FAILED' ? 'Task się nie udał: szczegóły w Cezarze.' : 'Task jest zakończony.')
          : 'Zleć zadanie przez @Zaimplementuj zadanie albo wskaż task Cezara, a tu pojawi się jego postęp.'}</div>
      </div>
    </div>}

    <section className={section} aria-label="Aktywny task Cezara">
      <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2"><span className={eyebrow}>Task Cezara</span>
        {task && <span className={`tw:ml-auto tw:rounded-full tw:px-2.5 tw:py-0.5 tw:text-[11px] tw:font-bold tw:tracking-wide ${STATUS_LOOK[task.status]}`}>{STATUS_TEXT[task.status] ?? task.status}</span>}
      </div>
      {source.cockpitError && <p className="tw:m-0 tw:mb-3 tw:text-xs tw:text-ck-red" role="alert">{source.cockpitError}</p>}
      {task ? <>
        <div className="tw:mb-3 tw:font-medium tw:text-ck-text">{task.title}</div>
        <dl className="tw:m-0 tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-4 tw:gap-y-1.5 tw:text-[13px]">
          <dt className="tw:text-ck-muted">ID</dt><dd className="tw:m-0 tw:font-ck-mono tw:text-ck-text">{task.id}</dd>
          <dt className="tw:text-ck-muted">Repo</dt><dd className="tw:m-0 tw:text-ck-text">{task.repo}</dd>
          <dt className="tw:text-ck-muted">Worktree</dt><dd className="tw:m-0 tw:truncate tw:font-ck-mono tw:text-ck-text">{task.worktree}</dd>
          <dt className="tw:text-ck-muted">Tokeny</dt><dd className="tw:m-0 tw:tabular-nums tw:text-ck-text">{task.tokens === null ? '—' : tokens.format(task.tokens)}</dd>
        </dl>
        <a href={task.url} target="_blank" rel="noopener noreferrer" className="tw:mt-4 tw:inline-flex tw:min-h-10 tw:items-center tw:gap-2 tw:rounded-xl tw:bg-ck-surface-2 tw:px-4 tw:text-sm tw:font-medium tw:text-ck-text tw:no-underline tw:hover:bg-ck-line">
          <ExternalLink size={15} aria-hidden="true" />Otwórz w Cezarze
        </a>
      </> : <p className="tw:m-0 tw:text-sm tw:text-ck-faint">Żaden task nie jest teraz obserwowany.</p>}
    </section>

    {pr && <section className={section} aria-label="Pull request">
      <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2"><GitPullRequest size={15} className="tw:text-ck-green" aria-hidden="true" /><span className={eyebrow}>Pull request</span>
        {pr?.state && PR_STATE[pr.state] && <span className="tw:ml-auto tw:rounded-full tw:bg-ck-agent/15 tw:px-2 tw:py-0.5 tw:text-[11px] tw:font-semibold tw:text-ck-agent">{PR_STATE[pr.state]}</span>}
        {pr && <a href={pr.url} target="_blank" rel="noopener noreferrer" className={`${pr.state && PR_STATE[pr.state] ? '' : 'tw:ml-auto '}tw:text-sm tw:font-semibold tw:text-ck-cal tw:no-underline`}>#{pr.number}</a>}
      </div>
      {pr ? <>
        <div className="tw:mb-1 tw:font-medium tw:text-ck-text">{pr.title}</div>
        <div className="tw:mb-3 tw:flex tw:items-center tw:gap-1.5 tw:font-ck-mono tw:text-xs tw:text-ck-muted"><GitBranch size={13} aria-hidden="true" />{pr.branch}</div>
        {pr.checksError && <p className="tw:m-0 tw:mb-2 tw:text-xs tw:text-ck-amber">{pr.checksError}</p>}
        {!pr.checks.length && !pr.checksError && <p className="tw:m-0 tw:text-xs tw:text-ck-faint">Ten PR nie ma checków CI.</p>}
        <ul className="tw:m-0 tw:flex tw:list-none tw:flex-wrap tw:gap-2 tw:p-0" aria-label="Checki CI">
          {pr.checks.map(c => <li key={c.name} className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-lg tw:border tw:border-ck-line tw:bg-ck-side tw:px-2.5 tw:py-1 tw:text-xs tw:text-ck-text"><CheckIcon state={c.state} />{c.name}</li>)}
        </ul>
      </> : <p className="tw:m-0 tw:text-sm tw:text-ck-faint">PR pojawi się, gdy Cezar go otworzy.</p>}
    </section>}

  </div>;
}
