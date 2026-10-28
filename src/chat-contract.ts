import { z } from 'zod';

/** What the user pointed at on the dashboard: one row (mail, task, meeting, workout), a whole tile, or a skill picked with `@`. */
export const contextKinds = ['mail', 'event', 'task', 'workout', 'tile', 'todoList', 'todo', 'skill'] as const;
export type ContextKind = typeof contextKinds[number];
export const contextItemSchema = z.object({
  kind: z.enum(contextKinds),
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  /** What the user sees (or the row's data / skill instructions), as plain text. Never more than the agent should read at once. */
  text: z.string().max(8000),
}).strict();
export type ContextItem = z.infer<typeof contextItemSchema>;

export interface ChatSkill {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export const CHAT_SKILLS: readonly ChatSkill[] = [
  {
    id: 'zaimplementuj-zadanie',
    title: 'Zaimplementuj zadanie',
    description: 'Rekonesans w repo, dwuetapowy workflow (analiza/implementacja) i karta zgody na zlecenie taska na Cezarze',
    prompt: [
      'You are the dispatcher for Desk Panel (repo: C:\\Users\\Viktor\\AndroidStudioProjects\\desk-panel). Your job is to produce a high-quality, self-contained task prompt for the Cezar executor and to propose it to the user, who decides in a card.',
      'Two-stage analytical workflow:',
      '- Phase 0 (Earlier work): Before any recon, call panel_cezar (no arguments) and look for finished Cezar tasks about the same feature (an analysis or an earlier implementation). If there is one, read it with panel_cezar (id, then krok for its result) and its handoff note, and carry every decision the user made there (what to reuse, what to share, scope) into the Acceptance criteria. Name the task you used in your plan; say so when there is none.',
      '- Phase 1 (Recon and Mode Decision): Do a short read-only recon: search first (search_files for names and symbols), then read only files the search returned; never read or cite a path, commit or id that no tool result in this conversation showed. Send a call that depends on another result only after that result arrives. Identify the exact files in src/ or server/ that need changes, check matching scenarios in scenarios/*.json, and decide whether the change is UI (changes visible in the browser: src/, styles.css, scenarios/) or non-UI (backend-only in server/, tests, or scripts where screenshots would not change). Before proposing to change a function or component, search for its callers: one nothing in production calls is dead code (say so; removing or wiring it is new work), not a bug to patch. Stop reading once you can name the files; the executor does the deep reading. Budget: about 15 tool calls for Phases 0-1 together, since every call sends the whole conversation again. Hermes ends the turn after 40 model calls, card or not: send panel_recon_report by your 20th call with what you have (open questions go to Notes for executor), and at once when a tool result carries an "iteration budget checkpoint" notice. This skill and the tool descriptions are the contract: unless the task changes them, never read server/panel-mcp.ts, server/agent-views.ts, server/hermes-*.ts, src/chat-contract.ts, src/cockpit-contract.ts, scripts/scenario.ts or docs/agent-workflows/ (this skill\'s own doc too), never open credential files (auth.json, .env, tokens), and never search for panel_* tool names or the `open:` syntax (it is given below); read a Cezar step with panel_cezar krok, not the run\'s log files. Evaluate complexity during recon:',
      '  * If complex (architectural impact, multi-module modifications, schema/contract changes) or explicitly requested by the user, propose a read-only analysis run (workflow: "analysis") to investigate edge cases, dependencies and design options first.',
      '  * If straightforward (single file change, minor UI tweak, isolated bugfix), proceed directly to an implementation proposal (workflow: "desk-panel-task").',
      '- Phase 2 (after an analysis run): read its result with panel_cezar (id, then krok), carry its findings into the plan and criteria, and propose the implementation (workflow: "desk-panel-task").',
      'Hard rules:',
      '- For UI tasks, check whether the chosen scenario in scenarios/*.json already contains data that visibly exposes the problem/feature; if the existing fixture is too short/simple to show the difference between before.png and after.png, add a bullet in Notes for executor specifying how to adjust the scenario fixture first. When the task adds or modifies a workspace tile, ALWAYS set open to `tile:<kind>` so scenario.ts showcases the tile at 2x2 without modifying `autoTiles` in `src/Workspace.tsx`.',
      '- Only list git-tracked files in "Relevant files" (never gitignored runtime files or local untracked configs), each one a search result of this conversation; a file the executor will create is marked as new. The executor works in a desk-panel worktree and cannot read another repository or the home directory: work on another repository\'s code (cezar, cezar-adapter) is not for this card; tell the user it is separate work there.',
      '- A feature that shows data must read it for real in server/ (an existing client or the source the analysis chose): never accept criteria where production returns a stub or empty data, unless the user asked for a mock. Scenario fixtures are for screenshots and tests, not instead of the source.',
      '- Every name in the prompt (a window id, field, function, label) is one a tool result of this conversation showed. For a feature that shows panel data, first read what its source gives now with the panel tool (panel_quotas, panel_bank, …) and write in Notes for executor what the live data has and what it lacks (e.g. a limit with no 5h split); scenario fixtures are synthetic and may name things differently. panel_recon_report refuses a name in backticks that no tracked file has, unless "outside" gives its source (the panel tool that showed it, or "new" for one the executor introduces).',
      '- "User asks" lists every separate thing in the user\'s message (a name, a window, a split, a check), quoted, each with where it went; a name the user gave is an ask too. None is dropped silently: "not done" says why.',
      '- Each thing the user explicitly asked for is its own acceptance criterion, in the sense they meant (e.g. "verified with agy" means against the live agy data, not only a fixture). Never soften an ask to "when available" or "if needed": each "lacks" item of Live data gets a criterion that builds it, naming the file in server/ where it comes from, or the task is an analysis run first (workflow "analysis") that finds that source. A lack that only another repository can build (the tool says so, e.g. the 5h split comes from cezar-adapter) is not a criterion here: name it in the plan as separate work in that repository, and the criteria cover what this one does. Criteria name behaviour, not the current readings (percentages change by the hour).',
      '- NEVER edit repository files or implement the task yourself, and NEVER dispatch it yourself (no POST to /api/cezar/runs): the panel dispatches when the user clicks in the card.',
      '- The Executor Prompt is in English, with repo-relative paths only, in this exact shape:',
      '     Task: <one-sentence clear goal>',
      '     Type: UI | non-UI',
      '     Scenario for screenshots: <scenario name, e.g. standard or inbox, or "none" if non-UI> (page: pulpit|zadania|kalendarz|system|zdarzenia|ustawienia, open: none|tile:<kind>|mail|chat|chat-answer|chat-approval|cockpit|task|event|bank|<css-selector>; --hermes down for the chat without Hermes)',
      '     User asks (each thing the user asked for, in their words):',
      '     - "<ask>" → criterion <n> | → plan: separate work in <repository> | → not done: <why>',
      '     Relevant files (from recon):',
      '     - src/...',
      '     Live data (from panel tools):',
      '     - has: <names and values as the tool gave them> | none: the task shows no panel data',
      '     - lacks: <what the user asked for that the source does not give, and which repository can build it> | nothing',
      '     Acceptance criteria:',
      '     - [ ] ...',
      '     Notes for executor:',
      '     - Follow the Desk Panel Executor Instructions in your workflow prompt strictly (Phases 1-4).',
      '- Then, in this order, each step only after the previous one\'s result arrived: (1) call the panel tool panel_recon_report ALONE, once the search results are in, with files (path + short note; "new": true for a file to create), kind, scenario and the Executor Prompt; its answer gives a recon id (r-…); it refuses what the rules above forbid (missing files or sections, unknown names, asks without "→", soft criteria) and says why; (2) write a short plan for the user in Polish (3-6 bullets, naming the earlier task you built on); (3) call panel_cezar_propose with a short Polish title, the same prompt, "recon" from step 1, optional workflow ("analysis" or "desk-panel-task"), and the todoId of a to-do item from the context if there is one; a proposal sent before the recon\'s answer is refused; (4) STOP. Do not repeat the prompt in text and do not ask "Zlecić na Cezarze?" in text: the card asks.',
    ].join('\n'),
  },
  {
    id: 'nasluchuj-cezara',
    title: 'Nasłuchuj Cezara',
    description: 'Status taska Cezara i jego kroków, bez dotykania taska',
    prompt: [
      'Watch a Cezar task for the user, read-only.',
      '- Find the task with panel_cezar: the one the user points at or names; otherwise the most recent running one of this conversation or of desk-panel.',
      '- Call the panel tool panel_cezar_watch with its id: the user sees the task live in a card and in the cockpit beside the chat.',
      '- Report in Polish, in 1-3 sentences: its status, the step it is on, and its PR if it has one.',
      '- NEVER start, resume, answer, archive or otherwise change a Cezar task here.',
    ].join('\n'),
  },
];

export function skillItem(skill: ChatSkill): ContextItem {
  return { kind: 'skill', id: skill.id, title: skill.title, text: skill.prompt };
}

/**
 * Which agent a conversation runs on. Hermes (a long-running local API) is the default for new chats; `agy` is the
 * Antigravity CLI the chat started with. A conversation keeps its engine for life: the two never share a session.
 */
export const chatEngines = ['hermes', 'agy'] as const;
export type ChatEngine = typeof chatEngines[number];
export const DEFAULT_ENGINE: ChatEngine = 'hermes';
export const ENGINE_LABEL: Record<ChatEngine, string> = { hermes: 'Hermes', agy: 'AGY' };
/** Whether an engine can take a message now; `error` says why not, in Polish. */
export interface EngineStatus { engine: ChatEngine; available: boolean; error?: string }

export const MAX_CONTEXT = 10;
export const MAX_MESSAGE = 8000;
/** A new message, with the dashboard elements it is about. */
export const chatSendSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE),
  context: z.array(contextItemSchema).max(MAX_CONTEXT).default([]),
  /** Only when a conversation starts: the engine it runs on (the saved preference otherwise). */
  engine: z.enum(chatEngines).optional(),
  /** One per draft: the same message sent twice (a retry after a timeout) starts one turn, not two. */
  nonce: z.string().regex(/^[0-9a-f-]{36}$/).optional(),
}).strict();
export type ChatSend = z.input<typeof chatSendSchema>;
export const chatRenameSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();
export const chatEngineSchema = z.object({ engine: z.enum(chatEngines) }).strict();
/** The user's answer to a tool the agent wants to run. */
export const chatApprovalSchema = z.object({
  approvalId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  decision: z.enum(['approve', 'deny']),
}).strict();
export type ChatApproval = z.infer<typeof chatApprovalSchema>;

/** The agent's answer is a sequence of text, tool and approval steps, in the order they happened. */
export type ChatPart =
  | { type: 'text'; text: string }
  /** `startedAt`/`endedAt` (epoch ms) let the window show how long a slow tool has been running. */
  | { type: 'tool'; id: string; name: string; input: string; output?: string; state: 'running' | 'done'; startedAt?: number; endedAt?: number; error?: boolean }
  /** The agent asks before running a tool; the run waits for the user's decision (or Hermes's own timeout). */
  | { type: 'approval'; id: string; tool: string; detail: string; state: 'pending' | 'approved' | 'denied' | 'expired'; at: number };

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped';
/**
 * What one answer cost, as the agent reports it for the whole turn: `input` is the tokens read fresh (all model calls
 * together), `cached` the tokens read from its prompt cache on top of that, `thinking` is part of `output`.
 * `calls` is how many times the model was called and `tools` how many commands it ran.
 */
export interface ChatUsage { input: number; output: number; thinking: number; cached: number; calls: number; tools: number }
export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  at: number;
  /** User messages: what was typed. */
  text?: string;
  context?: ContextItem[];
  /** Agent messages: the steps. */
  parts?: ChatPart[];
  usage?: ChatUsage;
  status?: MessageStatus;
  error?: string;
  /** While streaming: what the panel is doing about the run (e.g. reconnecting, reading its status), in Polish. */
  notice?: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: number;
  running: boolean;
  /** Missing only from a server that predates engines: those chats are agy's. */
  engine?: ChatEngine;
}
/** `GET /api/chats`: the conversations, which engines can take a message and the one new chats start on. */
export interface ChatList { chats: ChatSummary[]; engines?: EngineStatus[]; engine?: ChatEngine }
export interface ChatDetail extends ChatSummary { items: ChatMessage[] }

/** Server-sent events of one open chat: the whole chat once, then each message that changes. */
export type ChatEvent =
  | { type: 'state'; chat: ChatDetail }
  | { type: 'update'; chat: ChatSummary; message: ChatMessage };

/** Never the same text twice for the agent: the dashboard elements go first, the question after. */
export function withContext(text: string, context: ContextItem[]): string {
  if (!context.length) return text;
  const kinds: Record<ContextKind, string> = {
    mail: 'Mail',
    event: 'Spotkanie',
    task: 'Zadanie Cezara',
    workout: 'Trening',
    tile: 'Kafelek pulpitu',
    todoList: 'Lista zadań',
    todo: 'Zadanie z listy',
    skill: 'Skill',
  };
  const blocks = context.map((item, i) => `${i + 1}. ${kinds[item.kind]}: ${item.title}\n${item.text.split('\n').map(line => `   ${line}`).join('\n')}`);
  return `[Kontekst: elementy pulpitu wskazane przez użytkownika]\n${blocks.join('\n')}\n\n[Wiadomość]\n${text}`;
}

/** Short title for a new chat: the first line of the first message. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'Nowy czat';
}
