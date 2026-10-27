import { z } from 'zod';
import { todoTaskId } from './todo-contract';

/**
 * The chat cockpit of a conversation (`GET /api/chats/:id/cockpit`): the Cezar task it watches, that task's pull request
 * with its CI checks, and the user's answers on the dispatch cards. Read-only; the only
 * write is the answer on a card (`POST /api/chats/:id/dispatch`), which is what dispatches a task to Cezar.
 */

export type CezarStatus = 'QUEUED' | 'RUNNING' | 'INPUT' | 'REVIEW' | 'DONE' | 'FAILED';
export type StepState = 'done' | 'running' | 'pending' | 'failed' | 'skipped';
export type CheckState = 'pass' | 'fail' | 'running' | 'pending';

export interface CockpitTaskView {
  /** `projekt/uuid`, as everywhere else in the panel. */
  id: string;
  title: string;
  status: CezarStatus;
  repo: string;
  worktree: string;
  /** Tokens the run used so far; null when Cezar does not say. */
  tokens: number | null;
  url: string;
  startedAt?: number;
  branch?: string;
  steps: { label: string; state: StepState }[];
  /** 0…1: the steps that are settled. */
  progress: number;
  prUrl?: string;
}
export interface CockpitPrView {
  number: number;
  title: string;
  branch: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN';
  checks: { name: string; state: CheckState }[];
  /** Why the checks are not known (GitHub CLI missing or refused), in Polish. */
  checksError?: string;
}
export type DispatchOutcome =
  | { decision: 'dispatched'; taskId: string; prompt: string; url: string; at: number }
  | { decision: 'rejected'; at: number };
export interface CockpitView {
  observedAt: number;
  task: CockpitTaskView | null;
  pr: CockpitPrView | null;
  /** The user's answer on each dispatch card of the conversation, by its tool call id. */
  dispatches: Record<string, DispatchOutcome>;
}

/** `projekt/uuid`: a project name that cannot be a path step (`..`), and a run id. */
export const cezarRunId = z.string().regex(/^[A-Za-z0-9][\w.-]{0,127}\/[0-9A-Za-z-]{1,128}$/);
export const cockpitDispatchSchema = z.object({
  toolCallId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  decision: z.enum(['dispatch', 'reject']),
  title: z.string().trim().min(1).max(120),
  /** What goes to the executor: the agent's prompt, or the user's correction of it. */
  prompt: z.string().trim().min(1).max(32_000),
  /** A to-do item the task implements (Cezar gets it with the run). */
  todoId: todoTaskId.optional(),
}).strict();
export type CockpitDispatch = z.infer<typeof cockpitDispatchSchema>;

// ── The contract between the cockpit and Hermes ──
//
// The cockpit never guesses which Cezar task a conversation is about. It watches a task only after one of these events,
// in the order they happened in the conversation (the last one counts):
//   - the user dispatched a task from a dispatch card (`panel_cezar_propose` + "Zleć na Cezarze"),
//   - Hermes called `panel_cezar_watch` with the task's id,
//   - Hermes called `panel_cockpit_clear` (the cockpit watches nothing again).
// Hermes learns what it may do and when from this table: the MCP tools take their descriptions from it and the preamble
// lists it, so the instructions and the behaviour cannot drift apart. A new cockpit tool is a new row here.

export interface CockpitTool {
  /** What the tool is, for Hermes (first sentence of its MCP description). */
  purpose: string;
  /** When Hermes calls it, and when it must not. */
  when: string;
  /** What the user sees and what the cockpit does after the call. */
  effect: string;
  /** The card the chat shows for the call, if any. */
  card?: 'recon' | 'dispatch' | 'watch';
}

export const COCKPIT_TOOLS = {
  panel_recon_report: {
    purpose: 'Skill „Zaimplementuj zadanie”: wynik rekonesansu (przeszukane pliki, typ UI/non-UI, scenariusz zrzutów, Executor Prompt).',
    when: 'raz, po rekonesansie w skillu „Zaimplementuj zadanie”, przed panel_cezar_propose; nie w zwykłej rozmowie o zadaniu.',
    effect: 'użytkownik widzi kartę rekonesansu; kokpit bez zmian.',
    card: 'recon',
  },
  panel_cezar_propose: {
    purpose: 'Skill „Zaimplementuj zadanie”: propozycja zlecenia taska na Cezarze (tytuł i Executor Prompt).',
    when: 'gdy prompt jest gotowy i użytkownik chce zlecić zadanie teraz; nie wtedy, gdy dopiero je omawiacie. Potem zakończ odpowiedź.',
    effect: 'użytkownik widzi kartę „Zlecić na Cezarze?”; task zleca panel dopiero po kliknięciu „Zleć”, i od tej chwili kokpit go obserwuje. Ty niczego nie zlecasz.',
    card: 'dispatch',
  },
  panel_cezar_watch: {
    purpose: 'Stan jednego taska Cezara (status, kroki worktree, postęp, tokeny, PR) jako JSON; tylko odczyt.',
    when: 'gdy rozmowa dotyczy konkretnego taska Cezara: użytkownik go wskazał („Zadanie Cezara” w [Kontekst]) albo nazwał, pyta o jego stan, albo prosi o nasłuchiwanie. Nie dla tasków znalezionych przy okazji, np. w plikach repozytorium.',
    effect: 'użytkownik widzi kartę taska na żywo, a kokpit obok czatu obserwuje ten task (status, kroki, PR, checki CI).',
    card: 'watch',
  },
  panel_cockpit_clear: {
    purpose: 'Kokpit tej rozmowy przestaje obserwować task Cezara.',
    when: 'gdy użytkownik prosi, by przestać obserwować task, albo wyraźnie zmienia temat na coś niezwiązanego z obserwowanym taskiem.',
    effect: 'kokpit pokazuje, że nic nie jest obserwowane; task w Cezarze bez zmian.',
  },
} as const satisfies Record<string, CockpitTool>;
export type CockpitToolName = keyof typeof COCKPIT_TOOLS;

/** The MCP description of a cockpit tool: what it is, when, and what follows. */
export const cockpitToolDescription = (name: CockpitToolName) => {
  const tool: CockpitTool = COCKPIT_TOOLS[name];
  return `${tool.purpose} Kiedy: ${tool.when} Skutek: ${tool.effect}`;
};

/** A panel tool as Hermes names it (`mcp__desk_panel__panel_cezar_watch`, `mcp_desk-panel_…`), without the server prefix. */
export const panelToolName = (name: string) => name.replace(/^mcp_+desk[-_]panel_+/i, '');

/** A tool's answer as the panel wrote it: Hermes wraps an MCP answer as `{"result": "<text>"}`. */
export function toolAnswer(output: unknown): unknown {
  let value: unknown = output;
  for (let n = 0; n < 2 && typeof value === 'string'; n++) {
    try { value = JSON.parse(value); } catch { return value; }
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { result?: unknown }).result === 'string' && Object.keys(value).length === 1) value = (value as { result: string }).result;
  }
  return value;
}
/** The task in a `panel_cezar_watch` answer (`{"task":{"id":…}}`), if the answer has one. */
export function watchAnswerTask<T = { id: string }>(output: unknown): (T & { id: string }) | undefined {
  const task = (toolAnswer(output) as { task?: { id?: unknown } } | undefined)?.task;
  return task && typeof task.id === 'string' ? task as T & { id: string } : undefined;
}

/** What the cockpit needs of a conversation: its agent steps, in order. */
type Step = { type: string; id?: string; name?: string; input?: string; output?: string; error?: boolean };
type Turn = { role: string; parts?: Step[] };

/**
 * The task a conversation's cockpit watches: the last contract event wins (see above). `dispatches` are the user's
 * answers on dispatch cards, by tool call id. Null: nothing to watch.
 */
export function watchedTask(items: readonly Turn[], dispatches: Record<string, DispatchOutcome>): string | null {
  let watched: string | null = null;
  for (const m of items) for (const p of m.parts ?? []) {
    if (p.type !== 'tool' || !p.name || p.error) continue;
    const name = panelToolName(p.name);
    if (name === 'panel_cezar_propose') {
      const outcome = p.id ? dispatches[p.id] : undefined;
      if (outcome?.decision === 'dispatched') watched = outcome.taskId;
    } else if (name === 'panel_cezar_watch') {
      // The arguments when Hermes gives them; otherwise the task the tool answered with (the panel's own answer).
      let id: unknown;
      try { id = (JSON.parse(p.input ?? '') as { id?: unknown }).id; } catch { /* not this tool's arguments */ }
      if (typeof id !== 'string') id = watchAnswerTask(p.output)?.id;
      if (typeof id === 'string' && cezarRunId.safeParse(id).success) watched = id;
    } else if (name === 'panel_cockpit_clear') watched = null;
  }
  return watched;
}
