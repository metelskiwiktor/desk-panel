import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { bankSourceSchema } from '../src/bank-contract';
import { bankLabelSeedSchema, createBankLabelStore, type BankLabelStore } from './bank-labels';
import { publicTransaction } from './bank-parties';
import { cezarSchema } from '../src/cezar-contract';
import { calendarSourceSchema } from '../src/calendar-contract';
import { googleAccountsSchema } from '../src/google-contract';
import { trainingSourceSchema } from '../src/training-contract';
import { MAIL_WINDOW_MS, mailSourceSchema, type MailThread } from '../src/mail-contract';
import { createSmartRuleStore } from './smart-rules';
import { systemSourceSchema } from '../src/system-contract';
import { quotaSourceSchema } from '../src/quota-contract';
import { todoSourceSchema } from '../src/todo-contract';
import { createTodoStore, type TodoStore } from './todos';
import { usageBreakdownSchema } from '../src/usage-breakdown-contract';
import { warmupStatusSchema,warmupEditFor,warmupRunResultSchema } from '../src/warmup-contract';
import { gitHubPrSourceSchema, type GitHubPrSource } from '../src/types';
import { openrouterUsageSchema } from '../src/openrouter-contract';
import { observerListSchema } from '../src/observers-contract';
import { SourceError, type PanelSources } from './sources';
import { appointmentPreviewSchema, calendarSavedSchema } from '../src/appointment-contract';
import { createAppointments } from './appointments';
import { calendarEventId } from './calendar-write';

/**
 * A scenario file holds one response per API endpoint, in exactly the shape the
 * real server returns. Instead of a body an endpoint may be `{ "$error": 502 }`
 * (HTTP failure) or `{ "$pending": true }` (never answers, the UI keeps loading).
 * Any string of the form `now`, `now-20m`, `now+2h30m` is a timestamp relative
 * to the moment of the request (units: ms, s, m, h, d). `today`, `today+2`, `today-1` are calendar
 * days (YYYY-MM-DD, local time) counted from the day of the request; `today-1@22:10` is that moment.
 */
const special = z.union([
  z.object({ $error: z.number().int().min(400).max(599) }).strict(),
  z.object({ $pending: z.literal(true) }).strict(),
]);
const endpoint = <T extends z.ZodType>(schema: T) => z.union([special, schema]).default({ $error: 503 });
export const scenarioSchema = z.object({
  $schema: z.string().optional(),
  description: z.string().optional(),
  cezar: endpoint(cezarSchema),
  calendar: endpoint(calendarSourceSchema),
  appointment: endpoint(appointmentPreviewSchema),
  training: endpoint(trainingSourceSchema),
  googleAccounts: endpoint(googleAccountsSchema),
  /** All listed conversations; the server applies `limit` and the actions taken in this session. */
  mail: endpoint(mailSourceSchema),
  system: endpoint(systemSourceSchema),
  quotas: endpoint(quotaSourceSchema),
  /** The lists the scenario starts with; the actions taken in this session are remembered in memory. Empty when left out. */
  todos: z.union([special, todoSourceSchema]).default({ live: true, name: 'Zadania', status: 'connected', observedAt: null, data: { lists: [] } }),
  /** The bank account; `now-…` and `today-…` give the day of each operation. */
  bank: endpoint(bankSourceSchema),
  /** The user's marks the scenario starts with (categories, people, marks by operation id); actions are remembered in memory. */
  bankLabels: bankLabelSeedSchema.optional(),
  warmup: endpoint(warmupStatusSchema),
  warmupRun: endpoint(z.object({Claude:warmupRunResultSchema,Codex:warmupRunResultSchema,Gemini:warmupRunResultSchema})),
  usageBreakdown: endpoint(usageBreakdownSchema),
  githubPr: endpoint(gitHubPrSourceSchema).default({ pullRequests: [] }),
  openrouterUsage: endpoint(openrouterUsageSchema),
  /** The chat's one-shot observers the scenario starts with; cancelling one removes it for the session. */
  observers: endpoint(observerListSchema).default({ observers: [] }),
}).strict();
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioEndpoint = Exclude<keyof Scenario, '$schema' | 'description' | 'bankLabels'>;

export type EndpointResult<K extends ScenarioEndpoint> =
  K extends 'cezar' ? z.infer<typeof cezarSchema> :
  K extends 'calendar' ? z.infer<typeof calendarSourceSchema> :
  K extends 'appointment' ? z.infer<typeof appointmentPreviewSchema> :
  K extends 'training' ? z.infer<typeof trainingSourceSchema> :
  K extends 'googleAccounts' ? z.infer<typeof googleAccountsSchema> :
  K extends 'mail' ? z.infer<typeof mailSourceSchema> :
  K extends 'system' ? z.infer<typeof systemSourceSchema> :
  K extends 'quotas' ? z.infer<typeof quotaSourceSchema> :
  K extends 'todos' ? z.infer<typeof todoSourceSchema> :
  K extends 'bank' ? z.infer<typeof bankSourceSchema> :
  K extends 'warmup' ? z.infer<typeof warmupStatusSchema> :
  K extends 'warmupRun' ? { Claude: z.infer<typeof warmupRunResultSchema>; Codex: z.infer<typeof warmupRunResultSchema>; Gemini: z.infer<typeof warmupRunResultSchema> } :
  K extends 'usageBreakdown' ? z.infer<typeof usageBreakdownSchema> :
  K extends 'githubPr' ? GitHubPrSource :
  K extends 'openrouterUsage' ? z.infer<typeof openrouterUsageSchema> :
  K extends 'observers' ? z.infer<typeof observerListSchema> :
  never;

const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const AMOUNT = '\\d+(?:ms|s|m|h|d)';
const RELATIVE = new RegExp(`^now((?:[+-](?:${AMOUNT})+)*)$`);
const DAY = /^today([+-]\d+)?(?:@(\d{2}):(\d{2}))?$/;
function resolveTimes(value: unknown, now: number): unknown {
  if (typeof value === 'string') {
    const day = DAY.exec(value);
    if (day) {
      const d = new Date(now);
      d.setDate(d.getDate() + Number(day[1] ?? 0));
      // `today-1@22:10` is a moment (ms) of that local day; without a time it is the date.
      if (day[2]) return d.setHours(Number(day[2]), Number(day[3]), 0, 0);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const match = RELATIVE.exec(value);
    if (!match) return value;
    let at = now;
    for (const [, sign, amounts] of match[1].matchAll(new RegExp(`([+-])((?:${AMOUNT})+)`, 'g')))
      for (const [, amount, unit] of amounts.matchAll(/(\d+)(ms|s|m|h|d)/g))
        at += (sign === '-' ? -1 : 1) * Number(amount) * UNITS[unit as keyof typeof UNITS];
    return at;
  }
  if (Array.isArray(value)) return value.map(v => resolveTimes(v, now));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTimes(v, now)]));
  return value;
}

/** Parses a scenario relative to `now`; throws a readable error for invalid data. */
export function parseScenario(json: unknown, now: number): Scenario {
  const result = scenarioSchema.safeParse(resolveTimes(json, now));
  if (!result.success) throw new Error(z.prettifyError(result.error));
  return result.data;
}
export function loadScenario(file: string, now = Date.now()): Scenario {
  try { return parseScenario(JSON.parse(readFileSync(file, 'utf8')), now); }
  catch (error) { throw new Error(`Invalid scenario ${file}:\n${error instanceof Error ? error.message : error}`); }
}

/**
 * Serves a scenario file; it is re-read on every request so edits apply live.
 * Mail actions are remembered in memory, so swiping behaves like Gmail until restart.
 */
/** The steps of the desk-panel workflow, as Cezar names them. */
const SCENARIO_STEPS = ['Prepare worktree (LF line endings)', 'Implement', 'Verify (tests + build + clean commit)', 'Pre-PR Code Review', 'Open PR', 'Attach before/after screenshots to PR'];
export const SCENARIO_STEP_MS = 2500;
export const SCENARIO_PR = 'https://github.com/metelskiwiktor/desk-panel/pull/42';
/** A dispatched scenario run as Cezar would describe it `ms` after it started: one step every SCENARIO_STEP_MS. */
export function scenarioRun(id: string, made: { at: number; title: string; task: string }, now: number): Record<string, any> {
  const done = Math.floor((now - made.at) / SCENARIO_STEP_MS);
  const finished = done >= SCENARIO_STEPS.length;
  const run = id.slice(id.indexOf('/') + 1);
  return {
    id: run, title: made.title, titleSummary: made.title, task: made.task, status: finished ? 'done' : 'running',
    startedAt: new Date(made.at).toISOString(), branch: `cez/${run.slice(0, 8)}`,
    worktreePath: `C:\\repo\\desk-panel\\.ai\\cezar\\worktrees\\${run}`,
    tokensUsed: Math.min(done, SCENARIO_STEPS.length) * 21_400 + 3_200,
    steps: SCENARIO_STEPS.map((name, i) => ({ id: `s${i}`, name, status: i < done ? 'done' : i === done ? 'running' : 'pending' })),
    ...(done > 4 ? { pullRequestUrl: SCENARIO_PR, prNumber: 42 } : {}),
  };
}

export function createScenarioSources(file: string): PanelSources {
  const handled = new Set<string>();
  /** What the panel changed on finished Cezar tasks, so a scenario answers like Cezar would. */
  const finishedChanges = new Map<string, { archived?: boolean; unread?: boolean }>();
  /** Runs dispatched in this scenario: each walks through its steps, then opens a made-up PR. */
  const created = new Map<string, { at: number; title: string; task: string }>();
  let warmup:import('../src/warmup-contract').WarmupStatus|undefined;
  /** Made from the scenario the first time the lists are asked for, so they stay as the session changed them. */
  let todoStore: TodoStore | undefined;
  /** Observers cancelled in this session: the settings card behaves as the real one, without a service or a clock. */
  const cancelledObservers = new Set<string>();
  async function observerRows() {
    const source = await serve('observers');
    return { observers: source.observers.filter(o => !cancelledObservers.has(o.id)) };
  }
  /** Like the lists: made once, from the scenario's bank reading (raw numbers whole, as the service keeps them) and its marks. */
  let labelStore: BankLabelStore | undefined;
  const labels = () => labelStore ??= createBankLabelStore({
    seed: loadScenario(file).bankLabels,
    operations: async () => { const source = await serve('bank'); return source.data && { observedAt: source.observedAt ?? Date.now(), ...source.data }; },
  });
  const todos = async () => {
    const source = await serve('todos');
    todoStore ??= createTodoStore({ initial: source.data ?? { lists: [] } });
    return todoStore;
  };
  async function serve<K extends ScenarioEndpoint>(key: K): Promise<EndpointResult<K>> {
    const value = loadScenario(file)[key];
    if (value && typeof value === 'object' && '$error' in value) throw new SourceError((value as any).$error);
    if (value && typeof value === 'object' && '$pending' in value) return new Promise<never>(() => {});
    return value as unknown as EndpointResult<K>;
  }
  return {
    appointments: createAppointments({
      read: async query => ({ ...await serve('appointment'), query }),
      canWriteCalendar: async () => (await serve('googleAccounts')).some(a => a.canCreateEvents === true),
      writeCalendar: async (key, draft) => calendarSavedSchema.parse({ id: calendarEventId(key), url: `https://calendar.google.com/calendar/event?eid=scenario-${calendarEventId(key)}`, at: Date.now(), draft }),
    }),
    async cezar() {
      const source = await serve('cezar');
      if (!('finished' in source)) return source;
      const finished = source.finished.flatMap(task => {
        const change = finishedChanges.get(task.id);
        return change?.archived ? [] : [change?.unread === undefined ? task : { ...task, unread: change.unread }];
      });
      return { ...source, finished };
    },
    async cezarRun(id) {
      const made = created.get(id);
      if (made) return scenarioRun(id, made, Date.now());
      const source = await serve('cezar');
      if (!('finished' in source)) return null;
      const found = source.finished.find(t => t.id === id);
      if (!found) return null;
      return { id: found.id, title: found.title, status: found.status, project: found.project };
    },
    async cezarAction(id, action) {
      const source = await serve('cezar');
      if (!('finished' in source) || !source.finished.some(t => t.id === id)) throw new SourceError(404);
      const change = finishedChanges.get(id) ?? {};
      if (action === 'archive') change.archived = true;
      else if (action === 'unarchive') change.archived = false;
      else change.unread = action === 'unread';
      finishedChanges.set(id, change);
    },
    async cezarCreateRun(input) {
      const project = input.project || 'desk-panel';
      const id = `00000000-0000-4000-8000-${String(created.size + 1).padStart(12, '0')}`;
      created.set(`${project}/${id}`, { at: Date.now(), title: input.title ?? 'Task', task: input.task });
      return {
        ok: true,
        id: `${project}/${id}`,
        project,
        url: `http://127.0.0.1:4321/p/${encodeURIComponent(project)}/tasks/${id}`,
        workflow: input.workflow || 'desk-panel-task',
        runner: input.runner || 'agy',
        model: input.model || 'gemini-3.8-flash-medium',
      };
    },
    async cezarDefaults(_workflow, runner) {
      const selected = runner || 'agy';
      return { runner: selected, model: selected === 'agy' ? 'gemini-3.8-flash-medium' : null, models: selected === 'agy' ? ['low', 'medium', 'high'].map(level => ({ id: `gemini-3.8-flash-${level}`, label: `gemini-3.8-flash-${level}` })) : [], catalogSource: 'scenario', modelsLocked: false };
    },
    calendar: () => serve('calendar'),
    training: () => serve('training'),
    googleAccounts: () => serve('googleAccounts'),
    async mail(limit) {
      const source = await serve('mail');
      // Same rolling window as Gmail, so a scenario cannot show what the service would not.
      const cutoff = Date.now() - MAIL_WINDOW_MS;
      const all = source.data?.filter(t => t.receivedAt >= cutoff && !handled.has(t.id)) ?? null;
      return { ...source, data: all && all.slice(0, limit), total: all?.length ?? 0 };
    },
    /** A scenario's search: every word of the query (Gmail operators dropped) in the sender, subject or text. */
    async mailSearch(q, limit) {
      const words = q.toLowerCase().replace(/\b(?:newer_than|older_than|in|is|label):\S+/g, ' ').replace(/\b(?:from|subject):/g, ' ').split(/[\s()"]+/).filter(w => w && w !== 'or');
      const text = (t: MailThread) => `${t.from} ${t.address ?? ''} ${t.subject} ${t.body ?? t.snippet}`.toLowerCase();
      return ((await serve('mail')).data ?? []).filter(t => !words.length || words.some(w => text(t).includes(w))).slice(0, limit);
    },
    async mailThread(account, threadId) {
      const thread = (await serve('mail')).data?.find(t => t.id === `${account}:${threadId}`);
      if (!thread) throw new SourceError(404);
      return thread;
    },
    smartRules: createSmartRuleStore(null),
    async mailAction(account, threadId, action) {
      const id = `${account}:${threadId}`;
      if (!(await serve('mail')).data?.some(t => t.id === id)) throw new SourceError(404);
      if (action === 'read' || action === 'trash') handled.add(id); else handled.delete(id);
    },
    system: () => serve('system'),
    quotas: () => serve('quotas'),
    async todos() { const source = await serve('todos'); return { ...source, ...(await (await todos()).read()), status: source.status, message: source.message }; },
    async todoAction(action) { return (await todos()).apply(action); },
    usageBreakdown: () => serve('usageBreakdown'),
    observers: observerRows,
    async observerCancel(id) { cancelledObservers.add(id); return observerRows(); },
    githubPr: async () => serve('githubPr') as Promise<GitHubPrSource>,
    openrouterUsage: () => serve('openrouterUsage'),
    async bank() { const source = await serve('bank'); return source.data ? { ...source, data: { ...source.data, transactions: source.data.transactions.map(publicTransaction) } } : source; },
    bankLabels: () => labels().read(),
    bankLabelAction: action => labels().apply(action),
    bankLedger: () => labels().ledger(),
    bankConnect: async () => { throw new SourceError(409); },
    bankCallback: async () => ({ ok: false, message: 'Scenariusz nie obsługuje łączenia z bankiem.' }),
    warmup:async()=>warmup ?? serve('warmup'),
    runWarmup:async(provider)=>(await serve('warmupRun'))[provider],
    saveWarmup:async(provider,value)=>{
      const current=warmup ?? await serve('warmup');
      warmup={...current,settings:{...current.settings,[provider]:warmupEditFor(provider).parse(value)}};return warmup;
    },
    googleConnect: async () => { throw new SourceError(409); },
    googleCallback: async () => ({ ok: false, message: 'Scenariusz nie obsługuje logowania Google.' }),
  };
}
