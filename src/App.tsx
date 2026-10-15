import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  Cpu,
  House,
  Layers3,
  ListTodo,
  MemoryStick,
  Monitor,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { createDemo, type DemoCase } from './demo';
import { deriveInsights } from './insights';
import { readLayout, saveLayout, type Layout, type WidgetId } from './layout';
import { MAX_AGE, fresh, orderedTasks, sourceLabel, taskLabels, type Detail } from './model';
import { time, stamp, date, number, allDayDate } from './format';
import {
  SourceNote,
  Empty,
  Card,
  TaskRow,
  EventRow,
  Sparkline,
  QuotaWindow,
  QuotaCard,
  SourceLink,
} from './components';
import { useCezar } from './useCezar';
import { useCalendar } from './useCalendar';
import { useSystem } from './useSystem';
import { useQuotas } from './useQuotas';
import { SettingsView } from './SettingsView';

type Page = 'home' | 'tasks' | 'calendar' | 'system' | 'settings';
const pageNames: Record<Page, string> = {
  home: 'Pulpit',
  tasks: 'Zadania',
  calendar: 'Kalendarz',
  system: 'System',
  settings: 'Ustawienia',
};
const navIcons = {
  home: House,
  tasks: ListTodo,
  calendar: CalendarDays,
  system: Monitor,
  settings: Settings2,
};
export function App({ initialLive = true }: { initialLive?: boolean }) {
  const [live, setLive] = useState(initialLive);
  const cezar = useCezar(live);
  const calendar = useCalendar(live);
  const system = useSystem(live);
  const quotas = useQuotas(live);
  const [clockNow, setNow] = useState(Date.now);
  // Data can arrive between clock ticks; compare to wall time on every render.
  const now = Math.max(clockNow, Date.now());
  const [scenario, setScenario] = useState<DemoCase>('standard');
  const [demoData, setData] = useState(() => createDemo(Date.now()));
  const [layout, setLayout] = useState(readLayout);
  const [storageError, setStorageError] = useState(false);
  const [page, setPage] = useState<Page>('home');
  const [detail, setDetail] = useState<Detail | null>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
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
  const refresh = (next: DemoCase) => {
    const at = Date.now();
    setScenario(next);
    setNow(at);
    setData(createDemo(at, next));
  };
  const data = live ? { ...demoData, tasks: cezar.source, calendar, system, quotas } : demoData;
  const tasks = orderedTasks(data.tasks.data ?? []);
  const activeTasks = tasks.filter((task) => task.status !== 'done');
  const events = [...(data.calendar.data ?? [])]
    .filter((e) => e.endAt >= now)
    .sort((a, b) => a.startAt - b.startAt);
  const samples = data.system.data ?? [];
  const latest = samples.at(-1);
  const insights = deriveInsights(data, now);
  const summary = (
    <div className="task-counts">
      {(['running', 'queue', 'needs-input', 'review'] as const).map((status) => (
        <button key={status} className={status} onClick={() => navigate('tasks')}>
          <strong>
            {data.tasks.data === null ? '—' : (live ? cezar.snapshot?.counts[status] ?? '—' : tasks.filter((t) => t.status === status).length)}
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
            <span className="meta">{live ? `Ostatnie ${samples.length} próbek · co około 2 s` : `Ostatnie ${samples.length} próbek · co 10 s (DEMO)`}</span>
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
                {number(latest.ramUsedGb)} {live ? 'GiB' : 'GB'} / {number(latest.ramTotalGb)} {live ? 'GiB' : 'GB'}
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
      <SourceNote source={data.system} now={now} maxAge={MAX_AGE.system} refreshEveryMs={live ? 2000 : undefined} />
    </>
  );
  function renderWidget(id: WidgetId, compact: boolean) {
    switch (id) {
      case 'cezar':
        return (
          <Card
            title="Cezar"
            eyebrow={live ? 'WORKSPACE · DANE RZECZYWISTE' : 'WORKSPACE DEMO'}
            icon={<Layers3 size={22} />}
            action={
              <button
                className="icon-button"
                aria-label="Wszystkie zadania"
                onClick={() => navigate('tasks')}
              >
                <ArrowUpRight size={22} />
              </button>
            }
            className="cezar-card"
          >
            {summary}
            <div className="task-list">
              {activeTasks.length ? (
                activeTasks
                  .slice(0, compact ? 1 : 3)
                  .map((task) => <TaskRow key={task.id} task={task} open={open} />)
              ) : (
                <Empty>
                  {data.tasks.status === 'loading'
                    ? 'Ładowanie zadań…'
                    : 'Brak zadań do pokazania.'}
                </Empty>
              )}
            </div>
            <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={live ? 5000 : undefined} />
            {live && cezar.snapshot?.partial && <p className="warning">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
            {live && !!cezar.snapshot?.scheduled && <p className="meta">Zaplanowane wznowienia: {cezar.snapshot.scheduled}</p>}
          </Card>
        );
      case 'system':
        return (
          <Card
            title="System"
            eyebrow={live ? 'KOMPUTER · DANE RZECZYWISTE' : 'KOMPUTER DEMO'}
            icon={<Monitor size={21} />}
            action={
              <button
                className="icon-button"
                aria-label="Szczegóły systemu"
                onClick={() => open({ kind: 'system' })}
              >
                <ArrowUpRight size={21} />
              </button>
            }
          >
            {systemContent}
          </Card>
        );
      case 'calendar':
        return (
          <Card title="Kalendarz Google" eyebrow={live ? 'AGENDA · DANE RZECZYWISTE' : 'AGENDA DEMO'} icon={<CalendarDays size={21} />}>
            {live && <p className="meta">{calendar.calendarId || 'Łączenie z Google…'} · najbliższe 7 dni</p>}
            {events.length ? (
              events
                .slice(0, compact ? 1 : 3)
                .map((event, i) => (
                  <EventRow key={event.id} event={event} first={i === 0} open={open} />
                ))
            ) : (
              <Empty>
                {data.calendar.status === 'loading'
                  ? 'Ładowanie wydarzeń…'
                  : data.calendar.status === 'connected' ? 'Brak nadchodzących wydarzeń.' : 'Kalendarz jest niedostępny.'}
              </Empty>
            )}
            <SourceNote source={data.calendar} now={now} maxAge={MAX_AGE.calendar} refreshEveryMs={live ? 60000 : undefined} />
            {data.calendar.partial && <p className="warning">Agenda częściowa — osiągnięto limit odczytu.</p>}
          </Card>
        );
      case 'quotas':
        return (
          <Card title="Limity AI" eyebrow={live ? 'BIEŻĄCE LIMITY · ODCZYT BEZ MODELU' : 'SNAPSHOTY DEMO'} icon={<Layers3 size={21} />}>
            {data.quotas.data?.length ? (
              data.quotas.data.map((account) => (
                <QuotaCard
                  key={account.provider}
                  account={account}
                  now={now}
                  open={open}
                  sourceConnected={
                    fresh(data.quotas, now, MAX_AGE.quotas)
                  }
                />
              ))
            ) : (
              <Empty>
                {data.quotas.status === 'loading'
                  ? 'Ładowanie limitów…'
                  : 'Brak snapshotów limitów.'}
              </Empty>
            )}
            <SourceNote source={data.quotas} now={now} maxAge={MAX_AGE.quotas} refreshEveryMs={live ? 60000 : undefined} />
          </Card>
        );
      case 'insights':
        return (
          <Card title="Insights" eyebrow="TERAZ ISTOTNE" icon={<Sparkles size={21} />}>
            <p className="card-intro">{live ? 'Sygnały z rzeczywistych danych panelu' : 'Sygnały z danych DEMO'}</p>
            {insights.length ? (
              insights.map((fact) => (
                <button
                  key={fact.id}
                  className={`insight row ${fact.tone}`}
                  onClick={() => open(fact.target)}
                >
                  <span className="insight-dot" />
                  <span className="row-body">
                    <span className="row-title">{fact.title}</span>
                    <span className="meta">{fact.context}</span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <Empty>Brak aktualnych sygnałów wymagających uwagi.</Empty>
            )}
            <p className="source-note">Reguły deterministyczne · maks. 3 fakty</p>
          </Card>
        );
    }
  }
  function renderDetail() {
    if (!detail) return null;
    if (detail.kind === 'system')
      return (
        <Card title="CPU i pamięć RAM" icon={<Monitor />}>
          <p className="card-intro">
            {live ? 'CPU całego komputera — średnia zajętość wszystkich rdzeni. RAM to zajęta pamięć fizyczna. Historia obejmuje do 5 minut rzeczywistych próbek.' : 'Zapis demonstracyjny, bez połączenia z komputerem. Wykresy pokazują procent wykorzystania, od 0 do 100%.'}
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
                      CPU {number(s.cpuPercent)}% · RAM {number(s.ramUsedGb)} / {number(s.ramTotalGb)} {live ? 'GiB' : 'GB'}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      );
    if (detail.kind === 'task') {
      const task = tasks.find((t) => t.id === detail.id);
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
          <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={live ? 5000 : undefined} />
            {live && cezar.snapshot?.partial && <p className="warning">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
            {live && !!cezar.snapshot?.scheduled && <p className="meta">Zaplanowane wznowienia: {cezar.snapshot.scheduled}</p>}
          <SourceLink url={task.sourceUrl} />
        </Card>
      ) : (
        <Empty>Zadanie jest niedostępne.</Empty>
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
          <SourceNote source={data.calendar} now={now} maxAge={MAX_AGE.calendar} refreshEveryMs={live ? 60000 : undefined} />
          <SourceLink url={event.sourceUrl} />
        </Card>
      ) : (
        <Empty>Wydarzenie jest niedostępne.</Empty>
      );
    }
    const account = data.quotas.data?.find((a) => a.provider === detail.provider);
    return account ? (
      <Card title={`${account.provider} · limity konta`} icon={<Layers3 />}>
        <p className="card-intro">
          Procent wykorzystania limitu konta w oknie 5h lub 7d. Snapshoty są oddzielnymi
          obserwacjami.
        </p>
        {live && <p className="meta">Bieżący odczyt limitów kont zalogowanych w lokalnych CLI. Odświeżanie co około minutę nie uruchamia rozmów z modelem. Przy błędzie pozostaje ostatni pomiar z oznaczeniem nieaktualności.</p>}
        {account.snapshots.map((s) => (
          <div className="quota-detail" key={s.window}>
            <QuotaWindow
              snapshot={s}
              now={now}
              sourceConnected={fresh(data.quotas, now, MAX_AGE.quotas)}
            />
            <dl>
              <dt>Zaobserwowano</dt>
              <dd>{s.observedAt === null ? 'Brak danych' : stamp(s.observedAt)}</dd>
              <dt>Reset według źródła</dt>
              <dd>{s.resetAt === null ? 'Brak danych' : stamp(s.resetAt)}</dd>
            </dl>
          </div>
        ))}
        <SourceNote source={data.quotas} now={now} maxAge={MAX_AGE.quotas} refreshEveryMs={live ? 60000 : undefined} />
        <h3>{live ? 'Ostatni odczyt' : 'Historia obserwacji'}</h3>
        <p className="meta">Bez interpolacji i szacowania wartości po resecie.</p>
        {[...account.snapshots, ...account.history]
          .sort((a, b) => (b.observedAt ?? 0) - (a.observedAt ?? 0))
          .map((s, i) => (
            <div className="snapshot" key={i}>
              <span>
                {s.observedAt === null ? 'Brak pomiaru' : stamp(s.observedAt)} · {s.window}
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
  return (
    <div className="app-shell">
      <header>
        <div className="brand">
          <span className="brand-icon">
            <Layers3 size={24} />
          </span>
          <span>
            Desk Panel<span className="brand-sub">LOKALNY PANEL ROBOCZY</span>
          </span>
        </div>
        <div className="service-status">
          <span>
            <i
              className={`dot ${['Zapis DEMO', 'Połączono · Komputer'].includes(sourceLabel(data.system, now, MAX_AGE.system)) ? 'green-dot' : 'amber-dot'}`}
            />
            PC ·{' '}
            {sourceLabel(data.system, now, MAX_AGE.system) === 'Zapis DEMO'
              ? 'DEMO'
              : sourceLabel(data.system, now, MAX_AGE.system)}
          </span>
          <span>
            <i
              className={`dot ${['Zapis DEMO', 'Połączono z Cezarem'].includes(sourceLabel(data.tasks, now, MAX_AGE.tasks)) ? 'green-dot' : 'amber-dot'}`}
            />
            Cezar ·{' '}
            {sourceLabel(data.tasks, now, MAX_AGE.tasks) === 'Zapis DEMO'
              ? 'DEMO'
              : sourceLabel(data.tasks, now, MAX_AGE.tasks)}
          </span>
        </div>
      </header>
      <div className="demo-banner">
        <span className="demo-chip">{live ? 'DANE RZECZYWISTE' : 'DEMO'}</span>
        <span>
          {live ? 'Cezar · kalendarz · komputer · bieżące limity AI' : 'Dane demonstracyjne'}
        </span>
      </div>
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
                <div className="clock-area">
                  <div>
                    <p className="eyebrow">PULPIT / CZAS LOKALNY</p>
                    <h1>
                      <time dateTime={new Date(now).toISOString()}>{time(now)}</time>
                      <span className="clock-seconds">
                        {new Date(now).getSeconds().toString().padStart(2, '0')}
                      </span>
                    </h1>
                    <p className="today">{date(now)}</p>
                  </div>
                  <div className="clock-decoration">
                    <Clock3 size={28} />
                    <span>CZAS LOKALNY</span>
                  </div>
                </div>
                <div className="dashboard-grid">
                  {layout.widgets
                    .filter((w) => w.visible)
                    .map((w) => (
                      <div
                        key={w.id}
                        className={`widget widget-${w.id} mode-${w.displayMode}`}
                        data-priority={w.priority}
                      >
                        {renderWidget(w.id, w.displayMode === 'compact')}
                      </div>
                    ))}
                </div>
                {layout.widgets.every((w) => !w.visible) && (
                  <Empty>Wszystkie karty są ukryte. Włącz je w Ustawieniach.</Empty>
                )}
              </>
            ) : (
              <>
                <div className="page-heading">
                  <p className="eyebrow">DESK PANEL</p>
                  <h1>{pageNames[page]}</h1>
                </div>
                {page === 'tasks' && (
                  <Card title={live ? 'Aktywne zadania Cezara' : 'Wszystkie zadania'} icon={<ListTodo />}>
                    {summary}
                    {tasks.length ? (
                      tasks.map((task) => <TaskRow key={task.id} task={task} open={open} />)
                    ) : (
                      <Empty>
                        {data.tasks.status === 'loading' ? 'Ładowanie zadań…' : 'Brak zadań.'}
                      </Empty>
                    )}
                    <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={live ? 5000 : undefined} />
            {live && cezar.snapshot?.partial && <p className="warning">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
            {live && !!cezar.snapshot?.scheduled && <p className="meta">Zaplanowane wznowienia: {cezar.snapshot.scheduled}</p>}
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
                    <SourceNote source={data.calendar} now={now} maxAge={MAX_AGE.calendar} refreshEveryMs={live ? 60000 : undefined} />
                  </Card>
                )}
                {page === 'system' && (
                  <>
                    {renderWidget('system', false)}
                    <p className="footnote">
                      {live ? 'CPU i RAM całego komputera · lokalny pomiar co około 2 sekundy. Historia zeruje się po dłuższej przerwie.' : 'CPU i RAM z fixture DEMO. Backend Windows nie jest podłączony.'}
                    </p>
                  </>
                )}
                {page === 'settings' && (
                  <SettingsView
                    layout={layout}
                    configure={configure}
                    storageError={storageError}
                    live={live}
                    setLive={setLive}
                    scenario={scenario}
                    refresh={refresh}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
      <footer className="demo-footer">
        DESK PANEL <span>{live ? 'Rzeczywiste dane · limity AI bez wywołań modelu' : 'Dane demonstracyjne'}</span>
      </footer>
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
