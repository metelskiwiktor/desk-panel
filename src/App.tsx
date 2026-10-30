import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Cpu,
  House,
  Layers3,
  MessageSquare,
  ListTodo,
  ListChecks,
  MemoryStick,
  Monitor,
  Mail,
  MailOpen,
  Trash2,
  Settings2,
  Moon,
  Clock,
  Sun,
} from 'lucide-react';
import { useActivityLog } from './useActivityLog';
import { ActivityFeed } from './ActivityFeed';
import { EventRulesView } from './EventRulesView';
import { readLayout, saveLayout, type Layout, type WidgetId } from './layout';
import { MAX_AGE, fresh, orderedTasks, taskLabels, type Detail } from './model';
import { time, stamp, date, number, allDayDate } from './format';
import {
  SourceNote,
  Empty,
  Card,
  TaskRow,
  EventRow,
  Sparkline,
  QuotaWindow,
  QuotaLegend,
  SourceLink,
} from './components';
import { useCezar } from './useCezar';
import { useCalendar } from './useCalendar';
import { useSystem } from './useSystem';
import { useQuotas } from './useQuotas';
import { useUsageBreakdown } from './useUsageBreakdown';
import { useQuotaVisibility, filterQuotas } from './quota-visibility';
import { SettingsView } from './SettingsView';
import { Dashboard, StatusChips } from './Dashboard';
import { useMail } from './useMail';
import { useTodos } from './useTodos';
import { useTraining } from './useTraining';
import { useBank } from './useBank';
import { UsageBreakdownCard } from './UsageBreakdownCard';
import { WorkoutDetail } from './TrainingCard';
import { usePollingEnabled } from './polling';
import { Ambient } from './AmbientClock';
import { ambientLines, useAmbient, useNight } from './ambient-mode';
import { withoutPlanDuplicates } from './week';
import { sortSnapshots } from './quota-pace';
import { PulpitMenu } from './PulpitMenu';
import { usePulpits } from './pulpits';
import './chat.css';
import { useChatPresentation } from './useChatPresentation';

/** The chat (assistant-ui, its own bundle) loads the first time it opens, not with the dashboard. */
const ChatWindow = lazy(() => import('./ChatWindow').then(m => ({ default: m.ChatWindow })));

type Page = 'home' | 'tasks' | 'calendar' | 'system' | 'events' | 'settings';
const pageNames: Record<Page, string> = {
  home: 'Pulpit',
  tasks: 'Zadania',
  calendar: 'Kalendarz',
  system: 'System',
  events: 'Zdarzenia',
  settings: 'Ustawienia',
};
const navIcons = {
  home: House,
  tasks: ListTodo,
  calendar: CalendarDays,
  system: Monitor,
  events: ListChecks,
  settings: Settings2,
};
export function App({ tabletPreview = false, onTabletPreviewChange }: { tabletPreview?: boolean; onTabletPreviewChange?: () => void } = {}) {
  const pollingEnabled = usePollingEnabled();
  const cezar = useCezar();
  const calendar = useCalendar();
  const system = useSystem();
  const quotas = useQuotas();
  const usageBreakdown = useUsageBreakdown();
  const quotaVisibility=useQuotaVisibility();
  const mail = useMail();
  const todos = useTodos();
  const bank = useBank();
  const training = useTraining();
  const [clockNow, setNow] = useState(Date.now);
  // Data can arrive between clock ticks; compare to wall time on every render.
  const now = Math.max(clockNow, Date.now());
  const [layout, setLayout] = useState(readLayout);
  const [storageError, setStorageError] = useState(false);
  const [page, setPage] = useState<Page>('home');
  const [detail, setDetail] = useState<Detail | null>(null);
  const chat = useChatPresentation();
  const chatOpen = chat.view !== 'hidden' || chat.picking;
  const pulpits = usePulpits();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!pollingEnabled) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pollingEnabled]);
  useEffect(() => {
    main.current?.focus();
    window.scrollTo?.(0, 0);
  }, [page, detail]);
  const open = (target: Detail) => setDetail(target);
  const navigate = (target: Page) => {
    setDetail(null);
    setPage(target);
  };
  const configure = (next: Layout) => {
    setLayout(next);
    setStorageError(!saveLayout(next));
  };
  const data = { tasks: cezar.source, calendar, system, quotas:{...quotas,data:filterQuotas(quotas.data,quotaVisibility.value)} };
  const tasks = orderedTasks(data.tasks.data ?? []);
  const events = [...(data.calendar.data ?? [])]
    .filter((e) => e.endAt >= now)
    .sort((a, b) => a.startAt - b.startAt);
  const samples = data.system.data ?? [];
  const latest = samples.at(-1);
  const activity = useActivityLog(data, now);
  const summary = (
    <div className="task-counts">
      {(['running', 'queue', 'needs-input', 'review'] as const).map((status) => (
        <button key={status} className={status} onClick={() => navigate('tasks')}>
          <strong>
            {data.tasks.data === null ? '—' : cezar.snapshot?.counts[status] ?? '—'}
          </strong>
          <span>{taskLabels[status]}</span>
        </button>
      ))}
    </div>
  );
  const systemContent = (
    <>
      {latest ? (
        <>
          <div className="metric">
            <div className="metric-heading">
              <span>
                <Cpu size={17} />
                CPU
              </span>
              <strong>
                {number(latest.cpuPercent)}
                <small>%</small>
              </strong>
            </div>
            <Sparkline
              values={samples.map((s) => s.cpuPercent)}
              label="Ostatnie próbki CPU w procentach"
            />
            <span className="meta">Ostatnie {samples.length} próbek · co około 2 s</span>
          </div>
          <div className="metric">
            <div className="metric-heading">
              <span>
                <MemoryStick size={17} />
                RAM
              </span>
              <strong>
                {number((latest.ramUsedGb / latest.ramTotalGb) * 100)}
                <small>%</small>
              </strong>
            </div>
            <Sparkline
              tone="green"
              values={samples.map((s) => (s.ramUsedGb / s.ramTotalGb) * 100)}
              label="Ostatnie próbki wykorzystania RAM w procentach"
            />
            <span className="meta">
                {number(latest.ramUsedGb)} GiB / {number(latest.ramTotalGb)} GiB
            </span>
          </div>
        </>
      ) : (
        <Empty>
          {data.system.status === 'loading'
            ? 'Ładowanie próbek systemu…'
            : 'Brak próbek CPU i RAM.'}
        </Empty>
      )}
      <SourceNote source={data.system} now={now} maxAge={MAX_AGE.system} refreshEveryMs={2000} />
    </>
  );
  const systemCard = (
    <Card
      title="System"
      eyebrow="KOMPUTER"
      icon={<Monitor size={21} />}
      action={
        <button className="icon-button" aria-label="Szczegóły systemu" onClick={() => open({ kind: 'system' })}>
          <ArrowUpRight size={21} />
        </button>
      }
    >
      {systemContent}
    </Card>
  );
  const visible = (id: WidgetId) => layout.widgets.find((w) => w.id === id)?.visible ?? true;
  const dayNight = useNight(now);
  const ambient = useAmbient(now, dayNight.night);
  function renderDetail() {
    if (!detail) return null;
    if (detail.kind === 'system')
      return (
        <Card title="CPU i pamięć RAM" icon={<Monitor />}>
          <p className="card-intro">
            CPU całego komputera — średnia zajętość wszystkich rdzeni. RAM to zajęta pamięć fizyczna. Historia obejmuje do 5 minut próbek.
          </p>
          {systemContent}
          {samples.length > 0 && (
            <div className="snapshot-list">
              <h3>Ostatnie próbki</h3>
              {samples
                .slice(-6)
                .reverse()
                .map((s) => (
                  <div className="snapshot" key={s.at}>
                    <span>{stamp(s.at)}</span>
                    <span>
                      CPU {number(s.cpuPercent)}% · RAM {number(s.ramUsedGb)} / {number(s.ramTotalGb)} GiB
                    </span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      );
    if (detail.kind === 'task') {
      const task = tasks.find((t) => t.id === detail.id) ?? cezar.finished.find((t) => t.id === detail.id);
      return task ? (
        <Card title={task.title} icon={<ListTodo />}>
          <span className={`badge ${task.status}`}>{taskLabels[task.status]}</span>
          <p className="detail-copy">{task.description}</p>
          <dl>
            <dt>Projekt</dt>
            <dd>{task.project}</dd>
            {task.runner && (
              <>
                <dt>Runner / provider</dt>
                <dd>{task.runner}</dd>
              </>
            )}
            {task.startedAt && (
              <>
                <dt>Rozpoczęcie</dt>
                <dd>{stamp(task.startedAt)}</dd>
              </>
            )}
            <dt>Stan sprawdzony</dt>
            <dd>{stamp(task.checkedAt)}</dd>
            {task.completedAt && (
              <>
                <dt>Zakończenie</dt>
                <dd>{stamp(task.completedAt)}</dd>
              </>
            )}
          </dl>
          <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={5000} />
            {cezar.snapshot?.partial && <p className="warning">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
            {!!cezar.snapshot?.scheduled && <p className="meta">Zaplanowane wznowienia: {cezar.snapshot.scheduled}</p>}
          <SourceLink url={task.sourceUrl} />
        </Card>
      ) : (
        <Empty>Zadanie jest niedostępne.</Empty>
      );
    }
    if (detail.kind === 'mail') {
      const thread = mail.threads?.find((t) => t.id === detail.id);
      return thread ? (
        <Card title={thread.subject} icon={<Mail />}>
          <p className="detail-copy">{thread.body || thread.snippet}</p>
          <dl>
            <dt>Od</dt>
            <dd>{thread.from}</dd>
            <dt>Skrzynka</dt>
            <dd>{thread.account}</dd>
            <dt>Otrzymano</dt>
            <dd>{stamp(thread.receivedAt)}</dd>
            {thread.messages > 1 && (
              <>
                <dt>Wiadomości w wątku</dt>
                <dd>{thread.messages}</dd>
              </>
            )}
          </dl>
          <div className="detail-actions">
            <button className="button" onClick={() => { void mail.act(thread, 'read'); setDetail(null); }}>
              <MailOpen size={18} /> Oznacz jako przeczytane
            </button>
            <button className="button" onClick={() => { void mail.act(thread, 'trash'); setDetail(null); }}>
              <Trash2 size={18} /> Do kosza
            </button>
          </div>
          <SourceLink url={thread.sourceUrl} />
        </Card>
      ) : (
        <Empty>Wiadomość jest już przeczytana albo usunięta.</Empty>
      );
    }
    if (detail.kind === 'event') {
      const event = data.calendar.data?.find((e) => e.id === detail.id);
      return event ? (
        <Card title={event.title} icon={<CalendarDays />}>
          <p className="event-detail-time">
            {event.allDay ? 'Cały dzień' : <>{time(event.startAt)} — {time(event.endAt)}</>}
          </p>
          <p>{event.allDay && event.startDate && event.endDate ? allDayDate(event.startDate, event.endDate) : `${date(event.startAt)}${new Date(event.startAt).toDateString() !== new Date(event.endAt).toDateString() ? ` — ${date(event.endAt)}` : ''}`}</p>
          <p className="detail-copy">{event.description}</p>
          {event.location && <p>{event.location}</p>}
          <SourceNote source={data.calendar} now={now} maxAge={MAX_AGE.calendar} refreshEveryMs={60000} />
          <SourceLink url={event.sourceUrl} />
        </Card>
      ) : (
        <Empty>Wydarzenie jest niedostępne.</Empty>
      );
    }
    if (detail.kind === 'workout') {
      const workout = training.data?.workouts.find((w) => w.id === detail.id);
      return workout ? <WorkoutDetail workout={workout} training={training} now={now} /> : <Empty>Trening jest niedostępny.</Empty>;
    }
    if (detail.kind === 'breakdown') return <UsageBreakdownCard usage={usageBreakdown} />;
    const account = data.quotas.data?.find((a) => a.provider === detail.provider);
    return account ? (
      <Card title={`${account.provider === 'AGY' ? 'Gemini & Modele CLI · limity konta' : `${account.provider} · limity konta`}`} icon={<Layers3 />}>
        <p className="card-intro">
          Procent wykorzystania limitu konta lub grupy modeli. Każde okno jest oddzielną obserwacją.
        </p>
        <p className="meta">Bieżący odczyt limitów kont zalogowanych w lokalnych CLI. Odświeżanie co około minutę nie uruchamia rozmów z modelem. Przy błędzie pozostaje ostatni pomiar z oznaczeniem nieaktualności.</p>
        {sortSnapshots(account.snapshots).map((s) => (
          <div className="quota-detail" key={`${s.model || ""}:${s.window}`}>
            <QuotaWindow
              snapshot={s}
              now={now}
              sourceConnected={fresh(data.quotas, now, MAX_AGE.quotas)}
              showPaceDetails
            />
            <dl>
              <dt>Zaobserwowano</dt>
              <dd>{s.observedAt === null ? 'Brak danych' : stamp(s.observedAt)}</dd>
              <dt>Reset według źródła</dt>
              <dd>{s.resetAt === null ? 'Brak danych' : stamp(s.resetAt)}</dd>
            </dl>
          </div>
        ))}
        <QuotaLegend />
        {account.provider === 'AGY' && <p className="meta">Limity subskrypcji Gemini / Antigravity; modele w grupie dzielą limit. To nie są kwoty Gemini Developer API ani Vertex AI.</p>}
        <SourceNote source={data.quotas} now={now} maxAge={MAX_AGE.quotas} refreshEveryMs={60000} />
        <h3>{account.history.length ? 'Historia obserwacji' : 'Ostatni odczyt'}</h3>
        <p className="meta">Bez interpolacji i szacowania wartości po resecie.</p>
        {[...account.snapshots, ...account.history]
          .sort((a, b) => (b.observedAt ?? 0) - (a.observedAt ?? 0))
          .map((s, i) => (
            <div className="snapshot" key={i}>
              <span>
                {s.observedAt === null ? 'Brak pomiaru' : stamp(s.observedAt)} · {s.model || ''} {s.label || s.window}
              </span>
              <strong>{s.usedPercent === null ? 'Brak danych' : `${s.usedPercent}% limitu`}</strong>
            </div>
          ))}
        {!account.snapshots.length && !account.history.length && (
          <Empty>Brak historii snapshotów.</Empty>
        )}
      </Card>
    ) : (
      <Empty>Brak danych tego konta.</Empty>
    );
  }
  const ambientView = ambient.ambient && <Ambient now={now} night={ambient.night} wake={ambient.wake} lines={ambientLines({
    now, timeZone: training.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    events: withoutPlanDuplicates(data.calendar.data ?? [], training.data?.workouts ?? []),
    workouts: training.data?.workouts ?? [], activities: training.data?.activities ?? [],
    tasks: data.tasks.data, unreadMail: mail.source.status === 'connected' ? mail.source.total : null,
  })} />;
  return (
    <div className={`app-shell ${page === 'home' && !detail ? 'is-home' : ''}`} data-night={dayNight.night}>
      {ambientView}
      <header className="top-bar">
        <div className="top-clock">
          <time dateTime={new Date(now).toISOString()}>{time(now)}</time>
          <span className="clock-seconds">{new Date(now).getSeconds().toString().padStart(2, '0')}</span>
          <span className="today">{date(now)}</span>
        </div>
        <div className="top-right">
          {page === 'home' && !detail && visible('insights') && (
            <div className="events-slot">
              <ActivityFeed entries={activity.entries} open={open} dismiss={activity.dismiss}
                restore={activity.restore} canUndo={activity.canUndo} storageError={activity.storageError} showRules={() => navigate('events')} />
            </div>
          )}
          <StatusChips data={data} mail={mail} now={now} open={open} navigate={navigate} showPc={visible('system')} />
          {(page !== 'home' || detail) && <button className="top-button" aria-label="Przejdź do pulpitu" onClick={() => navigate('home')}><House size={20} /></button>}
          {page === 'home' && !detail && <PulpitMenu pulpits={pulpits} />}
          <button className="top-button" aria-label={dayNight.night ? 'Przełącz na tryb dzienny' : 'Przełącz na tryb nocny'} aria-pressed={dayNight.night} onClick={dayNight.toggle}>
            {dayNight.night ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button className="top-button" aria-label="Pokaż zegar (tryb ambient)" onClick={ambient.enter}><Clock size={20} /></button>
          <button className="top-button" aria-label="Otwórz ustawienia" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><Settings2 size={20} /></button>
        </div>
      </header>
      <main ref={main} tabIndex={-1} id="main-content">
        {detail ? (
          <>
            <button className="back-button" onClick={() => setDetail(null)}>
              <ArrowLeft size={22} />
              Wróć · {pageNames[page]}
            </button>
            {renderDetail()}
          </>
        ) : (
          <>
            {page === 'home' ? (
              <>
                <Dashboard data={data} training={training} snapshot={cezar.snapshot} cezar={cezar} mail={mail} todos={todos} bank={bank} now={now} open={open}
                  showTasks={() => navigate('tasks')} showCalendar={() => navigate('calendar')} showBreakdown={() => open({ kind: 'breakdown' })} visible={visible} quotaHidden={quotaVisibility.value} resetSignal={ambient.ambient} pulpit={pulpits.active} />
              </>
            ) : (
              <>
                <div className="page-heading">
                  <p className="eyebrow">DESK PANEL</p>
                  <h1>{pageNames[page]}</h1>
                </div>
                {page === 'tasks' && (
                  <Card title="Aktywne zadania Cezara" icon={<ListTodo />}>
                    {summary}
                    {tasks.length ? (
                      tasks.map((task) => <TaskRow key={task.id} task={task} open={open} />)
                    ) : (
                      <Empty>
                        {data.tasks.status === 'loading' ? 'Ładowanie zadań…' : 'Brak zadań.'}
                      </Empty>
                    )}
                    <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={5000} />
            {cezar.snapshot?.partial && <p className="warning">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
            {!!cezar.snapshot?.scheduled && <p className="meta">Zaplanowane wznowienia: {cezar.snapshot.scheduled}</p>}
                  </Card>
                )}
                {page === 'calendar' && (
                  <Card title="Nadchodząca agenda" icon={<CalendarDays />}>
                    {events.length ? (
                      events.map((event, i) => (
                        <EventRow key={event.id} event={event} first={i === 0} open={open} />
                      ))
                    ) : (
                      <Empty>
                        {data.calendar.status === 'loading'
                          ? 'Ładowanie wydarzeń…'
                          : data.calendar.status === 'connected' ? 'Brak nadchodzących wydarzeń.' : 'Kalendarz jest niedostępny.'}
                      </Empty>
                    )}
                    <SourceNote source={data.calendar} now={now} maxAge={MAX_AGE.calendar} refreshEveryMs={60000} />
                  </Card>
                )}
                {page === 'system' && (
                  <>
                    {systemCard}
                    <p className="footnote">
                      CPU i RAM całego komputera · lokalny pomiar co około 2 sekundy. Historia zeruje się po dłuższej przerwie.
                    </p>
                  </>
                )}
                {page === 'events' && <EventRulesView />}
                {page === 'settings' && (
                  <SettingsView
                    quotaAccounts={quotas.data}
                    quotaVisibility={quotaVisibility}
                    tabletPreview={tabletPreview}
                    onTabletPreviewChange={onTabletPreviewChange}
                    layout={layout}
                    configure={configure}
                    resetArrangement={pulpits.resetActive}
                    storageError={storageError}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
      {page !== 'home' && (
        <footer className="app-footer">
          DESK PANEL <span>Limity AI bez wywołań modelu</span>
        </footer>
      )}
      {chat.loaded && <Suspense fallback={null}><ChatWindow requestedChat={chat.requestedChat} view={chat.view} picking={chat.picking} onPickingChange={chat.setPicking} onViewChange={chat.show} onClose={chat.close} /></Suspense>}
      <button
        type="button"
        className="chat-toggle-fab"
        data-pick-through
        aria-label="Otwórz czat z agentem"
        aria-haspopup="dialog"
        aria-expanded={chatOpen}
        title="Wektor · Alt+W"
        onClick={() => chat.show(chatOpen ? 'hidden' : 'full')}
      >
        <MessageSquare size={22} aria-hidden="true" />
      </button>
      <nav aria-label="Główna nawigacja">
        {(Object.keys(pageNames) as Page[]).map((id) => {
          const Icon = navIcons[id];
          return (
            <button
              key={id}
              aria-current={page === id ? 'page' : undefined}
              className={page === id ? 'active' : ''}
              onClick={() => navigate(id)}
            >
              <Icon size={22} />
              <span>{pageNames[id]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
