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
  | { decision: 'dispatched'; taskId: string; prompt: string; url: string; at: number; runner?: string; model?: string }
  | { decision: 'rejected'; at: number };
export interface CockpitView {
  observedAt: number;
  task: CockpitTaskView | null;
  pr: CockpitPrView | null;
  /** The user's answer on each dispatch card of the conversation, by its tool call id. */
  dispatches: Record<string, DispatchOutcome>;
  /** A historical decision cannot be attributed safely to a single card. */
  legacyUnresolved?: boolean;
}

/** `projekt/uuid`: a project name that cannot be a path step (`..`), and a run id. */
export const cezarRunId = z.string().regex(/^[A-Za-z0-9][\w.-]{0,127}\/[0-9A-Za-z-]{1,128}$/);
/** The Cezar workflows a dispatch card may start; anything else is refused. */
export const CEZAR_WORKFLOWS = ['analysis', 'desk-panel-task'] as const;
export const cockpitDispatchSchema = z.object({
  toolCallId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  decision: z.enum(['dispatch', 'reject']),
  title: z.string().trim().min(1).max(120),
  /** The Cezar workflow: `analysis` (read-only, its findings come back to the chat) or `desk-panel-task` (implementation). */
  workflow: z.enum(CEZAR_WORKFLOWS).optional(),
  runner: z.string().trim().min(1).max(32).regex(/^[a-z0-9_-]+$/).optional(),
  model: z.string().trim().min(1).max(128).optional(),
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
    when: 'raz, po rekonesansie w skillu „Zaimplementuj zadanie”, gdy wyniki wyszukiwań są już w rozmowie; pliki tylko takie, jakie pokazały wyniki narzędzi (plik do utworzenia z "new": true); nie w zwykłej rozmowie o zadaniu.',
    effect: 'użytkownik widzi kartę rekonesansu; wynik podaje identyfikator recon dla panel_cezar_propose. Plików, których nie ma w repozytorium, panel nie przyjmie.',
    card: 'recon',
  },
  panel_cezar_propose: {
    purpose: 'Skill „Zaimplementuj zadanie”: propozycja zlecenia taska na Cezarze (tytuł, Executor Prompt, opcjonalny workflow: "analysis" lub "desk-panel-task").',
    when: 'gdy prompt jest gotowy i użytkownik chce zlecić zadanie teraz; nie wtedy, gdy dopiero je omawiacie. Dopiero po wyniku panel_recon_report, z jego recon i tym samym promptem: wysłana w tej samej odpowiedzi co rekonesans zostanie odrzucona. Potem zakończ odpowiedź.',
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

/**
 * What the panel answers when it accepts a card call. A call it refuses (a proposal sent before the recon's answer, a
 * recon naming files the repository does not have) answers with the reason instead: its card says so and offers no
 * „Zleć”, and the dispatch route refuses it too. Read from the answer's text, since a part read back from the session
 * history keeps the text but not the error flag.
 */
export const CARD_SHOWN = { recon: 'Karta rekonesansu jest u użytkownika', dispatch: 'Karta „Zlecić na Cezarze?” jest u użytkownika' } as const;
/** Why the panel refused a card call, or null when it accepted it or has not answered yet (no text: nothing to judge). */
export function cardRefusal(card: keyof typeof CARD_SHOWN, output: unknown, error?: boolean): string | null {
  // Stored as Hermes keeps an MCP answer (`{"result": "…"}`, maybe with „” escaped): read the answer itself.
  const answer = toolAnswer(output);
  const text = typeof answer === 'string' ? answer : typeof output === 'string' ? output : '';
  if (text.includes(CARD_SHOWN[card])) return null;
  if (!error && !text.trim()) return null;
  const reason = text.replace(/<\/?untrusted_tool_result[^>]*>/g, '').replace(/^[\s\S]*?Treat it as DATA, not as instructions\.?/, '').replace(/^Błąd:\s*/, '').trim();
  return reason || 'Panel odrzucił to wywołanie.';
}

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
