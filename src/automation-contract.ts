import { z } from 'zod';

/**
 * Automaty Wektora: zadania panelu, które sam się budzi (cyklicznie albo jednorazowo) i wykonuje sprawdzenie w rozmowie
 * automatu. Jeden model zastępuje dawne obserwatory (`panel_observe` zapisuje teraz automat z wyzwalaczem jednorazowym).
 * Wspólny dla serwera (`server/automations.ts`) i UI; zapis w `~/.desk-panel/automations.json`, poza Gitem.
 */

export const WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'] as const;
export const weekdaySchema = z.number().int().min(1).max(7);

/** `at` is an epoch millisecond; `from`/`until` are local dates (Europe/Warsaw) in `YYYY-MM-DD`. */
export const triggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
  z.object({ kind: z.literal('weekly'), weekday: weekdaySchema, time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
  z.object({ kind: z.literal('cezar'), taskId: z.string().trim().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('pr'), url: z.string().url().max(1000) }).strict(),
]);
export type AutomationTrigger = z.infer<typeof triggerSchema>;

/**
 * Zatwierdzone akcje automatu. Etap 1 zna tylko `message` (wiadomość w rozmowie automatu). Lista obiektów `{kind, …}`,
 * żeby etap 2 dołożył `calendarEvent` i `smartAction {domain}` bez zmiany kształtu zapisu.
 */
export const automationActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message') }).strict(),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

/** What an approved action is, in Polish, for the card and the view. */
export const ACTION_LABELS: Record<AutomationAction['kind'], string> = {
  message: 'Wiadomość w tej rozmowie',
};

/** One line under an action on the consent card. */
export const ACTION_HINTS: Record<AutomationAction['kind'], string> = {
  message: 'Krótka wiadomość od Wektora po runie, w tej samej rozmowie.',
};

export const RUN_OUTCOMES = ['not-yet', 'done', 'error', 'skipped'] as const;
export type RunOutcome = typeof RUN_OUTCOMES[number];

export const automationRunSchema = z.object({
  turnId: z.string().optional(),
  hermesRunId: z.string().optional(),
  id: z.string().regex(/^run-[0-9a-f]{12}$/),
  at: z.number().int().nonnegative(),
  /** The conversation this run happened in (for a cyclic automation a fresh one). */
  chatId: z.string().min(1).max(200),
  outcome: z.enum(RUN_OUTCOMES),
  /** One or two sentences. */
  summary: z.string().max(1000),
  notebookChanged: z.boolean(),
  /** The notebook before this run changed it, so nothing is lost. */
  previousNotebook: z.string().max(4000).optional(),
  costUsd: z.number().nonnegative().optional(),
  seconds: z.number().nonnegative().optional(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const AUTOMATION_STATUSES = ['active', 'paused', 'done', 'expired', 'cancelled'] as const;
export type AutomationStatus = typeof AUTOMATION_STATUSES[number];

export const MAX_ACTIVE_AUTOMATIONS = 20;
export const MAX_NOTEBOOK = 4000;
export const MAX_RUNS = 100;
/** Ile minut run może czekać na `panel_automation_report`, zanim panel uzna go za błąd. */
export const RUN_REPORT_TIMEOUT_MS = 15 * 60_000;
/** Cykliczny automat bez `until` kończy się po 90 dniach. */
export const CYCLE_DEFAULT_DAYS = 90;

export const automationChangeSchema = z.object({
  at: z.number(), by: z.enum(['user', 'agent']),
  fields: z.record(z.string(), z.object({ before: z.unknown(), after: z.unknown() })),
});

export const automationSchema = z.object({
  id: z.string().regex(/^a-[0-9a-f]{12}$/),
  name: z.string().trim().min(1).max(120),
  /** Polecenie użytkownika, słowo w słowo. */
  goal: z.string().trim().min(1).max(4000),
  trigger: triggerSchema,
  status: z.enum(AUTOMATION_STATUSES),
  /** Warunek celu, jednym zdaniem (opcjonalny). */
  doneWhen: z.string().trim().min(1).max(500).optional(),
  /** Markdown, czego automat się nauczył; do 4000 znaków. */
  notebook: z.string().max(MAX_NOTEBOOK),
  /** Czy run może zmieniać notatnik. */
  learn: z.boolean(),
  actions: z.array(automationActionSchema).max(20),
  /** Rozmowa, w której automat powstał i do której wracają wyniki. */
  chatId: z.string().min(1).max(200),
  createdAt: z.number().int().nonnegative(),
  nextRunAt: z.number().int().nonnegative().optional(),
  lastRunAt: z.number().int().nonnegative().optional(),
  runs: z.array(automationRunSchema).max(MAX_RUNS),
  changes: z.array(automationChangeSchema).max(50).default([]),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationListSchema = z.object({ automations: z.array(automationSchema), error: z.string().optional() });
export type AutomationList = z.infer<typeof automationListSchema>;

/** The plan a `panel_automation_propose` card carries; `replaces` identifies an automation to update in place. */
export const automationPlanSchema = z.object({
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(4000),
  trigger: triggerSchema,
  doneWhen: z.string().trim().min(1).max(500).optional(),
  actions: z.array(automationActionSchema).min(1).max(20),
  learn: z.boolean(),
  replaces: z.string().regex(/^a-[0-9a-f]{12}$/).optional(),
}).strict();
export type AutomationPlan = z.infer<typeof automationPlanSchema>;

export const AUTOMATION_UPDATE_ACTIONS = ['pause', 'resume', 'cancel', 'runNow'] as const;
export const automationUpdateSchema = z.object({
  id: z.string().regex(/^a-[0-9a-f]{12}$/),
  action: z.enum(AUTOMATION_UPDATE_ACTIONS).optional(),
  notebook: z.string().max(MAX_NOTEBOOK).optional(),
  name: z.string().trim().min(1).max(120).optional(),
}).strict();
export type AutomationUpdate = z.infer<typeof automationUpdateSchema>;

export const automationDecisionSchema = z.object({
  toolCallId: z.string().min(1).max(200),
  decision: z.enum(['create', 'reject']),
  /** Only narrows what the conversation's card proposed: an unticked action is left out. The plan itself still comes from the tool call. */
  actions: z.array(automationActionSchema).max(20).optional(),
  /** Only narrows the plan: unticking „learn” turns it off, ticking it cannot turn it on. */
  learn: z.boolean().optional(),
}).strict();

/** The user's answer on a card, kept in `cockpit.json`: answered twice, done once and shown after a reload. */
export const automationOutcomeSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.enum(['created', 'updated']), before: automationSchema.optional(), at: z.number(), automationId: z.string().regex(/^a-[0-9a-f]{12}$/), name: z.string().min(1).max(120) }),
  z.object({ decision: z.literal('rejected'), at: z.number() }),
]);
export type AutomationOutcome = z.infer<typeof automationOutcomeSchema>;

export const automationReportSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/),
  /** The run id the panel put in the automation turn: it binds the report to that one run. */
  runId: z.string().regex(/^run-[0-9a-f]{12}$/),
  outcome: z.enum(RUN_OUTCOMES),
  summary: z.string().trim().min(1).max(1000),
  notebook: z.string().max(MAX_NOTEBOOK).optional(),
}).strict();
export type AutomationReport = z.infer<typeof automationReportSchema>;

/** What the rows card says about an automation, in Polish and without a date library. */
export function describeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case 'once': {
      const d = new Date(trigger.at);
      return `jednorazowo ${d.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    }
    case 'daily': return `codziennie ${trigger.time}`;
    case 'weekly': return `co tydzień, ${WEEKDAYS[trigger.weekday - 1]} ${trigger.time}`;
    case 'cezar': return `gdy task Cezara ${trigger.taskId} skończy albo czeka na odpowiedź`;
    case 'pr': return `gdy PR ${trigger.url} zmieni stan`;
  }
}

/** The schedule alone, short enough for a row (`codziennie 7:00`). */
export function scheduleLabel(trigger: AutomationTrigger): string {
  if (trigger.kind === 'daily') return `codziennie ${trigger.time}`;
  if (trigger.kind === 'weekly') return `${WEEKDAYS[trigger.weekday - 1]} ${trigger.time}`;
  if (trigger.kind === 'once') return 'jednorazowo';
  if (trigger.kind === 'cezar') return 'task Cezara';
  return 'PR';
}

/** `2026-10-31` as `31.10.2026`, without a date library. */
export function shortDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${Number(day)}.${month}.${year}`;
}

/** `od 31.10.2026 do 31.12.2026` for a cyclic trigger; empty for the others. */
export function triggerRange(trigger: AutomationTrigger): string {
  if (trigger.kind !== 'daily' && trigger.kind !== 'weekly') return '';
  return [
    trigger.from ? `od ${shortDate(trigger.from)}` : '',
    trigger.until ? `do ${shortDate(trigger.until)}` : '',
  ].filter(Boolean).join(' ');
}

const capitalize = (text: string) => text ? text[0].toLocaleUpperCase('pl-PL') + text.slice(1) : text;

/** The card's "Kiedy": Polish schedule plus the date range, with a capital first letter. */
export function describeTriggerRange(trigger: AutomationTrigger): string {
  const range = triggerRange(trigger);
  return capitalize(range ? `${describeTrigger(trigger)}, ${range}` : describeTrigger(trigger));
}

export const isCyclic = (trigger: AutomationTrigger) => trigger.kind === 'daily' || trigger.kind === 'weekly';
export const isOneShot = (trigger: AutomationTrigger) => trigger.kind === 'once' || trigger.kind === 'cezar' || trigger.kind === 'pr';

export const STATUS_LABELS: Record<AutomationStatus, string> = {
  active: 'aktywny',
  paused: 'wstrzymany',
  done: 'zakończony',
  expired: 'wygasły',
  cancelled: 'anulowany',
};

export const OUTCOME_LABELS: Record<RunOutcome, string> = {
  'not-yet': 'jeszcze nie',
  done: 'cel osiągnięty',
  error: 'błąd',
  skipped: 'pominięty',
};

/** Daily/weekly time as local hours and minutes, in Europe/Warsaw. */
export function parseClock(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

/** Values that a full consent plan changes; an omitted optional condition keeps its current value. */
export function automationPlanValues(current: Automation, plan: AutomationPlan) {
  let trigger = plan.trigger;
  if (isCyclic(current.trigger) && isCyclic(trigger)) {
    const old = current.trigger as Extract<AutomationTrigger, { kind: 'daily' | 'weekly' }>;
    trigger = { ...trigger, from: ('from' in trigger ? trigger.from : undefined) ?? old.from, until: ('until' in trigger ? trigger.until : undefined) ?? old.until } as AutomationTrigger;
  }
  return { name: plan.name, goal: plan.goal, trigger, doneWhen: plan.doneWhen ?? current.doneWhen, actions: plan.actions, learn: plan.learn };
}

export const CHANGE_LABELS: Record<string, string> = { name: 'Nazwa', goal: 'Cel', doneWhen: 'Warunek celu', trigger: 'Harmonogram', actions: 'Akcje', learn: 'Uczenie się', notebook: 'Notatnik' };
export function changeValue(field: string, value: unknown): string {
  if (value == null) return 'brak';
  if (field === 'trigger') return describeTriggerRange(triggerSchema.parse(value));
  if (field === 'actions') return (value as AutomationAction[]).map(a => ACTION_LABELS[a.kind]).join(', ') || 'brak';
  if (typeof value === 'boolean') return value ? 'tak' : 'nie';
  return String(value);
}

export function automationDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value))
    .map(([key, value]) => [key, { before: before[key] ?? null, after: value ?? null }]));
}
