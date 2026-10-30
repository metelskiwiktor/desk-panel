import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { SmartRuleOutcome, SmartRulePlan, SmartRulePreview } from '../src/smart-rules-contract';
import { previewPlan, SmartRuleError } from './smart-rules';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  watchedTask, type CezarStatus, type CockpitDispatch, type CockpitPrView, type CockpitTaskView, type CockpitView, type DispatchOutcome, type StepState,
} from '../src/cockpit-contract';
import { stepOverridesSchema } from '../src/cezar-contract';
import { type BankPlan, type BankPlanOutcome, type BankPlanPreview } from '../src/bank-plan-contract';
import { type AutomationOutcome, automationOutcomeSchema } from '../src/automation-contract';
import { BankPlanError, planPreview } from './bank-plan';
import { assignMarks, assignPreview } from './bank-assign';
import type { BankAssign, BankAssignChoice, BankAssignOutcome, BankAssignPreview } from '../src/bank-assign-contract';
import { SourceError, type PanelSources } from './sources';
import { PR_URL, type GhRunner, type PrReader, runGh, checkState, prFromGh, createPrReader } from './github';

export { PR_URL, type GhRunner, runGh, checkState, prFromGh };

/**
 * The chat cockpit on the server: which Cezar task a conversation watches, how that task is doing (read from Cezar), its
 * pull request and CI checks (read with the GitHub CLI, gently).
 *
 * The one write is the user's answer on a dispatch card. Hermes only proposes a task; the panel dispatches it to Cezar
 * when the user clicks "Zleć na Cezarze", with the prompt as the user left it, and keeps the answer so the card shows it
 * again later. What it keeps (`~/.desk-panel/cockpit.json`, outside Git) is ids and the dispatched prompts only.
 */

const outcomeSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('dispatched'), taskId: z.string(), prompt: z.string(), url: z.string(), at: z.number(), todoId: z.string().optional(), runner: z.string().optional(), model: z.string().optional(), steps: stepOverridesSchema.optional() }),
  z.object({ decision: z.literal('rejected'), at: z.number() }),
]);
const bankPlanOutcomeSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('applied'), at: z.number(), into: z.string().optional(), created: z.boolean().optional(), moved: z.number().optional(), assigned: z.number().optional(), choice: z.unknown().optional(), preview: z.unknown().optional() }),
  z.object({ decision: z.literal('rejected'), at: z.number(), preview: z.unknown().optional() }),
]);
const storeSchema = z.object({
  version: z.literal(1),
  chats: z.record(z.string(), z.object({
    /** Tasks dispatched from the conversation, oldest first: the last one is watched. */
    runs: z.array(z.string()).default([]),
    dispatches: z.record(z.string(), outcomeSchema).default({}),
    /** The user's answers on bank change cards, by tool call id: what was done, so the card shows it again. */
    bankPlans: z.record(z.string(), bankPlanOutcomeSchema).default({}),
    /** Automation turns already handled, by `taskId|state`: a restart never reports the same event twice. */
    automations: z.record(z.string(), z.number()).default({}),
    /** The user's answers on „Nowy automat” cards, by tool call id: a reload shows the decision, a second click does nothing. */
    automationCards: z.record(z.string(), automationOutcomeSchema).default({}),
    updatedAt: z.number().default(0),
  })),
});
type Store = z.infer<typeof storeSchema>;
const MAX_CHATS = 500;

// ── Cezar run → the task as the cockpit shows it ──

const FINISHED = new Set(['done', 'completed', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled']);
function statusOf(raw: Record<string, any>, prState?: CockpitPrView['state']): CezarStatus {
  const s = String(raw.status ?? '').toLowerCase();
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'FAILED';
  if (FINISHED.has(s)) return raw.pullRequestUrl && prState !== 'MERGED' && prState !== 'CLOSED' ? 'REVIEW' : 'DONE';
  if (s === 'paused' || raw.waitingForInput || raw.currentStepId === 'ask') return 'INPUT';
  if (['queued', 'queue', 'pending', 'created', 'scheduled'].includes(s)) return 'QUEUED';
  return 'RUNNING';
}
function stepState(status: unknown, finished: boolean): StepState {
  const s = String(status ?? '').toLowerCase();
  if (['done', 'completed', 'succeeded', 'success', 'passed'].includes(s)) return 'done';
  if (['failed', 'error'].includes(s)) return 'failed';
  if (['skipped', 'cancelled', 'canceled'].includes(s)) return 'skipped';
  if (['running', 'active', 'in_progress', 'started'].includes(s)) return finished ? 'skipped' : 'running';
  // A step that never ran in a finished run was not needed (a fix after a clean check, say).
  return finished ? 'skipped' : 'pending';
}
/** "Prepare worktree (LF line endings, …)" → "Prepare worktree". */
const label = (name: unknown, id: unknown) => String(name || id || 'krok').replace(/\s*\([^)]*\)\s*$/, '').slice(0, 80);

/** The worktree as a path inside the project (`.ai/cezar/worktrees/…`), never the user's whole profile path. */
function worktreeOf(path: unknown, fallback: string): string {
  if (typeof path !== 'string' || !path) return fallback;
  const at = path.replace(/\\/g, '/').indexOf('/.ai/');
  return at >= 0 ? path.replace(/\\/g, '/').slice(at + 1) : path.replace(/\\/g, '/').split('/').slice(-3).join('/');
}

export function cezarTaskView(id: string, raw: Record<string, any>, cezarUrl: string, prState?: CockpitPrView['state']): CockpitTaskView {
  const [project, run] = id.includes('/') ? [id.slice(0, id.indexOf('/')), id.slice(id.indexOf('/') + 1)] : ['desk-panel', id];
  const finished = FINISHED.has(String(raw.status ?? '').toLowerCase());
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 30).map((s: any) => ({ label: label(s?.name, s?.id), state: stepState(s?.status, finished) }));
  const settled = steps.filter((s: { state: StepState }) => s.state !== 'pending' && s.state !== 'running').length;
  const tokens = typeof raw.tokensUsed === 'number' ? raw.tokensUsed
    : typeof raw.inputTokens === 'number' || typeof raw.outputTokens === 'number' ? (raw.inputTokens ?? 0) + (raw.outputTokens ?? 0) : null;
  const started = typeof raw.startedAt === 'string' ? Date.parse(raw.startedAt) : NaN;
  return {
    id: `${project}/${run}`,
    title: String(raw.titleSummary || raw.title || 'Task Cezara').slice(0, 200),
    status: statusOf(raw, prState),
    repo: project,
    worktree: worktreeOf(raw.worktreePath, `.ai/cezar/worktrees/${run.slice(0, 11)}`),
    tokens,
    url: new URL(`/p/${encodeURIComponent(project)}/tasks/${encodeURIComponent(run)}`, cezarUrl).href,
    ...(Number.isFinite(started) ? { startedAt: started } : {}),
    ...(typeof raw.branch === 'string' && raw.branch ? { branch: raw.branch } : {}),
    steps,
    progress: finished ? 1 : steps.length ? settled / steps.length : 0,
    ...(typeof raw.pullRequestUrl === 'string' && PR_URL.test(raw.pullRequestUrl) ? { prUrl: raw.pullRequestUrl } : {}),
  };
}

// ── The pull request and its CI checks, from the GitHub CLI (unified in server/github.ts) ──

export interface DispatchedTask { chatId: string; taskId: string; at: number; todoId?: string }

export interface Cockpit {
  /** `items`: the conversation as the chat has it; the watched task follows from it by the contract (`watchedTask`). */
  view(chatId: string, items: Parameters<typeof watchedTask>[0], decisions?: Record<string, DispatchOutcome>): Promise<CockpitView>;
  dispatch(chatId: string, input: CockpitDispatch): Promise<DispatchOutcome>;
  /** Every task the panel dispatched from a conversation, oldest first: what the automation observer follows. */
  dispatched(): DispatchedTask[];
  /** Whether an automation turn for this task and state was already sent (or deliberately skipped). */
  automationReported(chatId: string, taskId: string, state: string): boolean;
  /** Keeps the fact in `cockpit.json`, so a restart never sends the same automation turn twice. */
  markAutomationReported(chatId: string, taskId: string, state: string): void;
  /**
   * The PR of a finished Cezar task, linked once to the to-do item it was dispatched from (`link` is idempotent).
   * The to-do id comes from the kept dispatch, so this works after a restart and with no chat open.
   */
  linkPrs(tasks: readonly { id: string; pullRequestUrl?: string; title?: string }[]): Promise<void>;
  /** The user's answer on a bank change card; `plan` is the one the conversation's tool call holds. Answered twice: done once. */
  bankPlan(chatId: string, input: { toolCallId: string; decision: 'apply' | 'reject' }, plan: BankPlan): Promise<BankPlanOutcome>;
  /** The user's answer on a bulk-assign card; `skip` are the groups unticked. Answered twice: done once. */
  bankAssign(chatId: string, input: { toolCallId: string; decision: 'apply' | 'reject' } & BankAssignChoice, plan: BankAssign): Promise<BankAssignOutcome>;
  /** The user's answer on a Smart Actions rule card: the rule is saved (or removed) once, as worked out now. */
  smartRule(chatId: string, input: { toolCallId: string; decision: 'apply' | 'reject' }, plan: SmartRulePlan): Promise<SmartRuleOutcome>;
  /** The user's answer on a „Nowy automat” card; `work` creates (or rejects) it. Answered twice: done once, kept for a reload. */
  automation(chatId: string, input: { toolCallId: string; decision: 'create' | 'reject' }, work: () => Promise<AutomationOutcome>): Promise<AutomationOutcome>;
}

export function createCockpit({ sources, file, cezarUrl, gh = runGh, now = Date.now, reader: injectedReader }: {
  sources: PanelSources; file: string; cezarUrl: string; gh?: GhRunner; now?: () => number; reader?: PrReader;
}): Cockpit {
  const load = (): Store => {
    try { if (existsSync(file)) return storeSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* a broken file starts over */ }
    return { version: 1, chats: {} };
  };
  let store = load();
  const save = () => {
    const ids = Object.keys(store.chats);
    if (ids.length > MAX_CHATS) for (const id of ids.sort((a, b) => store.chats[a].updatedAt - store.chats[b].updatedAt).slice(0, ids.length - MAX_CHATS)) delete store.chats[id];
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(store, null, 2), 'utf8');
    renameSync(`${file}.tmp`, file);
  };
  const chatOf = (id: string) => store.chats[id] ??= { runs: [], dispatches: {}, bankPlans: {}, automations: {}, automationCards: {}, updatedAt: now() };
  /** PR links already tried, so a read every few seconds does not write the same link again (the action itself is idempotent). */
  const linkedPrs = new Set<string>();
  /** The to-do a run was dispatched from, kept with the dispatch: it survives a restart and needs no open chat. */
  const todoIdOf = (taskId: string) => {
    for (const chat of Object.values(store.chats))
      for (const outcome of Object.values(chat.dispatches))
        if (outcome.decision === 'dispatched' && outcome.taskId === taskId && outcome.todoId) return outcome.todoId;
    return undefined;
  };
  async function linkPr(taskId: string, prUrl: string, title?: string) {
    if (!PR_URL.test(prUrl)) return;
    const todoId = todoIdOf(taskId);
    if (!todoId) return;
    const key = `${todoId}|${taskId}|${prUrl}`;
    if (linkedPrs.has(key)) return;
    linkedPrs.add(key);
    try {
      await sources.todoAction({ action: 'link', task: todoId, kind: 'pr', id: prUrl, ...(title ? { title } : {}), by: 'panel' });
    } catch {
      // The task may be gone or already hold 20 links: the PR is still shown, linking is best-effort.
      console.warn(`todos: nie udało się powiązać PR ${prUrl} z ${todoId}.`);
    }
  }
  const pendingDispatches = new Map<string, Promise<DispatchOutcome>>();
  const pendingBankPlans = new Map<string, Promise<BankPlanOutcome>>();
  const pendingAssigns = new Map<string, Promise<BankAssignOutcome | SmartRuleOutcome>>();
  const pendingAutomations = new Map<string, Promise<AutomationOutcome>>();
  /** A bank card is answered once: the kept answer, one still being worked, or the work (kept when it finishes). */
  async function decideBankCard<T extends BankAssignOutcome | SmartRuleOutcome>(chatId: string, toolCallId: string, work: () => Promise<T>): Promise<T> {
    const chat = chatOf(chatId);
    const known = chat.bankPlans[toolCallId];
    if (known) return known as unknown as T;
    const key = `${chatId}:${toolCallId}`;
    const pending = pendingAssigns.get(key);
    if (pending) return pending as Promise<T>;
    const operation = (async () => {
      const outcome = await work();
      chat.bankPlans[toolCallId] = outcome as unknown as typeof chat.bankPlans[string];
      chat.updatedAt = now();
      save();
      return outcome;
    })();
    pendingAssigns.set(key, operation);
    try { return await operation; } finally { pendingAssigns.delete(key); }
  }

  // The same cached read the PR observers use (`server/github.ts`): GitHub is asked gently, never once per card.
  const reader = injectedReader ?? createPrReader({ gh, now });
  const prOf = (url: string, fallback: { title: string; branch?: string }) => reader.read(url, fallback);

  return {
    async view(chatId, items, decisions) {
      const chat = store.chats[chatId];
      const id = watchedTask(items, decisions ?? chat?.dispatches ?? {}) ?? undefined;
      let task: CockpitTaskView | null = null, pr: CockpitPrView | null = null;
      if (id && sources.cezarRun) {
        const raw = await sources.cezarRun(id).catch(() => null);
        if (raw) {
          task = cezarTaskView(id, raw, cezarUrl);
          if (task.prUrl) {
            const prUrl = task.prUrl;
            pr = await prOf(prUrl, { title: task.title, branch: task.branch });
            task = cezarTaskView(id, raw, cezarUrl, pr.state);
            await linkPr(task.id, prUrl, pr.title);
          }
        }
      }
      return { observedAt: now(), task, pr, dispatches: { ...chat?.dispatches }, bankPlans: { ...chat?.bankPlans } as CockpitView['bankPlans'], automationCards: { ...chat?.automationCards } };
    },

    async dispatch(chatId, input) {
      const chat = chatOf(chatId);
      // The same answer twice (a double click, a retry after a timeout) dispatches once.
      const known = chat.dispatches[input.toolCallId];
      if (known) return known;
      const key = `${chatId}:${input.toolCallId}`;
      const pending = pendingDispatches.get(key);
      if (pending) return pending;
      const operation = (async (): Promise<DispatchOutcome> => {
      if (input.decision === 'reject') {
        const outcome: DispatchOutcome = { decision: 'rejected', at: now() };
        chat.dispatches[input.toolCallId] = outcome;
        chat.updatedAt = now();
        save();
        return outcome;
      }
      if (!sources.cezarCreateRun) throw new SourceError(503);
      const created = await sources.cezarCreateRun({
        task: input.prompt,
        title: input.title,
        ...(input.workflow ? { workflow: input.workflow } : {}),
        ...(input.runner ? { runner: input.runner } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.steps && Object.keys(input.steps).length ? { steps: input.steps } : {}),
        ...(input.todoId ? { todoId: input.todoId } : {}),
      });
      const outcome: DispatchOutcome = { decision: 'dispatched', taskId: created.id, prompt: input.prompt, url: created.url, at: now(), ...(input.todoId ? { todoId: input.todoId } : {}), ...(input.runner ? { runner: input.runner } : {}), ...(input.model ? { model: input.model } : {}), ...(input.steps && Object.keys(input.steps).length ? { steps: input.steps } : {}) };
      chat.dispatches[input.toolCallId] = outcome;
      chat.runs = [...chat.runs.filter(r => r !== created.id), created.id].slice(-20);
      chat.updatedAt = now();
      save();
      if (input.todoId) {
        try {
          await sources.todoAction({ action: 'link', task: input.todoId, kind: 'cezar', id: created.id, title: input.title, by: 'panel' });
          await sources.todoAction({ action: 'link', task: input.todoId, kind: 'chat', id: chatId, by: 'panel' });
          await sources.todoAction({ action: 'setStatus', task: input.todoId, status: 'realizacja', by: 'panel' });
        } catch { console.warn(`todos: nie udało się powiązać ${input.todoId} po zleceniu Cezara ${created.id}.`); }
      }
      return outcome;
      })();
      pendingDispatches.set(key, operation);
      try { return await operation; } finally { pendingDispatches.delete(key); }
    },

    async linkPrs(tasks) {
      for (const task of tasks) if (task.pullRequestUrl) await linkPr(task.id, task.pullRequestUrl, task.title);
    },

    dispatched() {
      const out: DispatchedTask[] = [];
      for (const [chatId, chat] of Object.entries(store.chats))
        for (const outcome of Object.values(chat.dispatches))
          if (outcome.decision === 'dispatched') out.push({ chatId, taskId: outcome.taskId, at: outcome.at, ...(outcome.todoId ? { todoId: outcome.todoId } : {}) });
      return out.sort((a, b) => a.at - b.at);
    },

    automationReported(chatId, taskId, state) {
      return !!store.chats[chatId]?.automations[`${taskId}|${state}`];
    },

    markAutomationReported(chatId, taskId, state) {
      const chat = chatOf(chatId);
      chat.automations[`${taskId}|${state}`] = now();
      chat.updatedAt = now();
      save();
    },

    async bankAssign(chatId, input, plan) {
      return decideBankCard<BankAssignOutcome>(chatId, input.toolCallId, async () => {
        if (input.decision === 'reject') {
          let preview: BankAssignPreview | undefined;
          try { const worked = assignPreview(await sources.bankLedger(), plan); if (!worked.problems.length) preview = worked; } catch { /* the card then works it out anew */ }
          return { decision: 'rejected', at: now(), ...(preview ? { preview } : {}) };
        }
        if (!sources.bankLedger || !sources.bankLabelAction) throw new SourceError(503);
        // Worked out again now, from what is kept now: the card's preview may be old, and the request can only untick groups.
        const ledger = await sources.bankLedger();
        const preview = assignPreview(ledger, plan);
        if (preview.problems.length) throw new BankPlanError(409, preview.problems.join(' '));
        const { toolCallId: _id, decision: _decision, ...choice } = input;
        const { items, create } = assignMarks(ledger, plan, choice);
        if (!items.length) throw new BankPlanError(409, 'Nic nie jest zaznaczone ani wybrane: nie ma czego oznaczyć.');
        const result = await sources.bankLabelAction({ action: 'markMany', create, items });
        return { decision: 'applied', at: now(), assigned: result.assigned ?? items.length, choice, preview };
      });
    },

    async smartRule(chatId, input, plan) {
      return decideBankCard<SmartRuleOutcome>(chatId, input.toolCallId, async () => {
        if (!sources.smartRules) throw new SourceError(503);
        // Worked out again now: the card shows the outcome with the test it had, and the rules may have changed meanwhile.
        let preview: SmartRulePreview | undefined;
        try { preview = await previewPlan(sources, plan); } catch { /* Gmail unreachable: the decision stands without the test */ }
        if (input.decision === 'reject') return { decision: 'rejected', at: now(), ...(preview ? { preview } : {}) };
        if (preview?.problems.length) throw new SmartRuleError(409, preview.problems.join(' '));
        sources.smartRules.apply(plan);
        return { decision: 'applied', at: now(), ...(preview ? { preview } : {}) };
      });
    },

    async automation(chatId, input, work) {
      const chat = chatOf(chatId);
      const known = chat.automationCards[input.toolCallId];
      if (known) return known;
      const key = `${chatId}:${input.toolCallId}`;
      const pending = pendingAutomations.get(key);
      if (pending) return pending;
      const operation = (async (): Promise<AutomationOutcome> => {
        const outcome = await work();
        chat.automationCards[input.toolCallId] = outcome;
        chat.updatedAt = now();
        save();
        return outcome;
      })();
      pendingAutomations.set(key, operation);
      try { return await operation; } finally { pendingAutomations.delete(key); }
    },

    async bankPlan(chatId, input, plan) {
      const chat = chatOf(chatId);
      const known = chat.bankPlans[input.toolCallId];
      if (known) return known as BankPlanOutcome;
      const key = `${chatId}:${input.toolCallId}`;
      const pending = pendingBankPlans.get(key);
      if (pending) return pending;
      const operation = (async (): Promise<BankPlanOutcome> => {
        let outcome: BankPlanOutcome;
        if (input.decision === 'reject') {
          // What was proposed stays on the card: worked out as it was when the user said no (it may not be possible any more).
          let preview: BankPlanPreview | undefined;
          try { const worked = planPreview(await sources.bankLedger(), plan); if (!worked.problems.length) preview = worked; } catch { /* the card then works it out anew */ }
          outcome = { decision: 'rejected', at: now(), ...(preview ? { preview } : {}) };
        }
        else {
          if (!sources.bankLedger || !sources.bankLabelAction) throw new SourceError(503);
          // Worked out again now, from what is kept now: the card's preview may be old.
          const preview = planPreview(await sources.bankLedger(), plan);
          if (preview.problems.length) throw new BankPlanError(409, preview.problems.join(' '));
          const result = await sources.bankLabelAction({ action: 'mergeInto', from: preview.sources.map(s => s.id), into: plan.into, tags: plan.tags });
          outcome = { decision: 'applied', at: now(), into: preview.into.name, created: !!result.category?.created, moved: result.removed ?? preview.moved, preview };
        }
        chat.bankPlans[input.toolCallId] = outcome as typeof chat.bankPlans[string];
        chat.updatedAt = now();
        save();
        return outcome;
      })();
      pendingBankPlans.set(key, operation);
      try { return await operation; } finally { pendingBankPlans.delete(key); }
    },
  };
}
