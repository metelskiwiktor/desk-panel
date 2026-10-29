import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { cezarActionSchema } from '../src/cezar-contract';
import { CARD_SHOWN, CEZAR_WORKFLOWS, cezarRunId, cockpitToolDescription } from '../src/cockpit-contract';
import { todoActionSchema } from '../src/todo-contract';
import { bankShowQuerySchema, BANK_SHOW_LIMITS, BANK_SHOW_VIEWS } from '../src/bank-show-contract';
import { bankShow, bankShowSummary, BankShowError, dayIn } from './bank-show';
import { AgentViewError, DEFAULT_ZONE, type AgentView } from './agent-views';
import { cezarTaskView } from './cockpit';
import { SourceError, type PanelSources } from './sources';
import { TodoError } from './todos';

/**
 * The panel's data as MCP tools for Hermes (`POST /api/mcp`, Streamable HTTP, JSON answers only). Each tool is a narrow
 * adapter over an agent view (`/api/agent/*`, the same short text the agy chat reads) or one of the two writes the chat
 * agent may make. Arguments are checked here before anything runs; nothing else of the panel is reachable through it.
 * Only a local caller with the token gets in (Hermes, configured by `just hermes-setup`): a browser cannot, because a
 * request with an Origin is refused, and the Tailscale name cannot, because only loopback hosts are served.
 */
export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const MAX_BODY = 64 * 1024;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const flag = z.boolean().optional();
const text = (max: number) => z.string().trim().min(1).max(max);

interface Tool {
  description: string;
  input: z.ZodType<Record<string, unknown>>;
  /** JSON Schema of the arguments as MCP lists it. */
  schema: Record<string, unknown>;
  run(args: Record<string, any>, ctx: { views: Record<string, AgentView>; sources: PanelSources; now: number; cezarUrl: string }): Promise<string>;
}

const view = (name: string, params: (args: Record<string, any>) => Record<string, string | undefined>) =>
  async (args: Record<string, any>, ctx: { views: Record<string, AgentView>; now: number }) => {
    const url = new URL(`http://panel/api/agent/${name}`);
    for (const [key, value] of Object.entries(params(args))) if (value !== undefined) url.searchParams.set(key, value);
    return ctx.views[name](url, ctx.now);
  };
/** The repository the skill's recon names files in (the panel's own checkout; the service runs in it, so does vitest). */
const REPO_ROOT = (() => { try { return fileURLToPath(new URL('..', import.meta.url)); } catch { return process.cwd(); } })();
const repoPath = z.string().trim().min(1).max(300).refine(p => !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..'), 'ścieżka względem repo, bez ..');
/**
 * Recons the user has seen, by the id their answer gave. A proposal must name one and carry its prompt: a model that
 * sends the proposal in the same answer as its searches (gemini flash did, 28.10.2026: 21 calls at once, the card among
 * them) cannot know the id yet, so it waits for its recon. In memory: after a panel restart the recon is simply redone.
 */
const RECON_TTL_MS = 6 * 60 * 60_000, RECONS_KEPT = 100;
const recons = new Map<string, { prompt: string; at: number }>();
export function forgetRecons() { recons.clear(); }

/**
 * Names the prompt puts in backticks (a window id, a function, a field) that no tracked file of the repository mentions
 * and the dispatcher did not declare with their source: flash made up a 5h window id of the Claude and GPT group beside
 * the real 3p-5h (28.10.2026), and the executor takes the prompt as fact.
 */
export function unknownNames(prompt: string, repoText: string, declared: string[] = []): string[] {
  const names = new Set<string>();
  for (const [, span] of prompt.matchAll(/`([^`\n]{1,160})`/g)) {
    for (const word of span.split(/[^\w.-]+/)) {
      const name = word.replace(/^[.-]+|[.-]+$/g, '');
      if (name.length < 3 || !/[a-z]/i.test(name) || repoText.includes(name) || declared.some(d => d.includes(name))) continue;
      names.add(name);
    }
  }
  return [...names];
}
/**
 * Paths in the prompt (a file with an extension, `~/…`, `C:\…`) that no tracked file of this repository mentions and the
 * recon does not create. The executor works in a desk-panel worktree and cannot read another checkout: an analysis of
 * Cezar's runners was to read six files of the cezar checkout (28.10.2026), declared in "outside" as from another
 * repository; a path written here would pass, as this file is tracked text too. Work in another repository is the plan's separate work, not this prompt.
 */
const PATH = /(?<![\w.])(?:~|[A-Za-z]:)?[\\/]?(?:\.?[\w-]+[\\/])+[\w.-]*\.[A-Za-z]{1,6}\b/g;
export function foreignPaths(prompt: string, repoText: string, created: string[] = []): string[] {
  const norm = (p: string) => p.replace(/\\/g, '/');
  return [...new Set([...prompt.matchAll(PATH)].map(([p]) => norm(p)))]
    .filter(p => !repoText.includes(p) && !created.some(c => norm(c) === p));
}
/**
 * The sections of the Executor Prompt the skill gives. "Live data" says what the panel's sources have and lack: without
 * it a split the source does not have became "when breakdown data is available" (28.10.2026), a criterion nothing fails.
 * "User asks" lists each thing the user asked for and where it went: the fifth try of that day dropped the tile's new
 * name, asked in so many words, from its criteria.
 */
export const PROMPT_SECTIONS = ['Task:', 'Type:', 'Scenario for screenshots:', 'User asks', 'Relevant files', 'Live data', 'Acceptance criteria:', 'Notes for executor:'] as const;
const isHeader = (line: string) => PROMPT_SECTIONS.some(section => line.trimStart().startsWith(section));
export const missingSections = (prompt: string) => PROMPT_SECTIONS.filter(section => !prompt.split('\n').some(line => line.trimStart().startsWith(section)));
/** The bullet lines of one section, up to the next section's header. */
function bullets(prompt: string, section: string): string[] {
  const lines = prompt.split('\n');
  const start = lines.findIndex(line => line.trimStart().startsWith(section));
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && isHeader(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).filter(line => /^\s*[-*]\s*\S/.test(line)).map(line => line.trim());
}
/** Asks with no destination: each one names the criterion it became, or the plan's separate work, or why not. */
export const unplacedAsks = (prompt: string) => {
  const asks = bullets(prompt, 'User asks');
  return asks.length ? asks.filter(line => !/→|->/.test(line)) : ['(sekcja jest pusta)'];
};
/**
 * Criteria that pass whatever the executor does: "…when breakdown segments are available" was written twice
 * (28.10.2026) for a split the source does not have. A lack is built, named as follow-up, or analysed instead.
 */
const SOFT = /\b(?:when|if|where|once|as long as)\b[^.;\n]{0,40}\b(?:available|possible|present|exists?|supported|provided)\b|\bif (?:needed|applicable|any)\b/i;
export function softCriteria(prompt: string): string[] {
  // "…an empty state when no data is available" says what to show without it: a requirement, not an escape.
  const soft = (line: string) => SOFT.test(line) && !/\b(?:no|not|none|without|unavailable|missing)\b/i.test(SOFT.exec(line)![0]);
  return bullets(prompt, 'Acceptance criteria:').filter(soft);
}
/** The text of the repository's tracked files (no binaries, none over 1 MB), read again after a minute; null without git. */
let tracked: { at: number; text: string } | undefined;
function trackedText(now: number): string | null {
  if (tracked && now - tracked.at >= 0 && now - tracked.at < 60_000) return tracked.text;
  let files: string[];
  try { files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 << 20, windowsHide: true }).split('\0').filter(Boolean); }
  catch { return null; }
  const texts: string[] = [];
  for (const file of files) {
    try { const bytes = readFileSync(path.join(REPO_ROOT, file)); if (bytes.length < 1 << 20 && !bytes.includes(0)) texts.push(bytes.toString('utf8')); }
    catch { /* deleted in the working tree */ }
  }
  tracked = { at: now, text: [files.join('\n'), ...texts].join('\n') };
  return tracked.text;
}

/**
 * The fields of each to-do action, read from the contract. The tool once answered every mistake with "check the action and
 * its fields": the agent then tried `due` and `date`, sent `list` to updateTask three times, hit Hermes's loop guard, slept
 * 60 s and read the panel's source to learn the shape (28.10.2026). The description and the error now name the fields.
 */
const TODO_FIELDS: Record<string, string[]> = Object.fromEntries(todoActionSchema.options.map(option =>
  [String((option.shape.action as z.ZodLiteral<string>).value), Object.keys(option.shape).filter(key => key !== 'action')]));
const NO_DUE = 'Zadania nie mają terminu ani przypomnienia: datę wpisz w tytuł lub notatkę.';
function todoActionError(raw: unknown, issues: z.core.$ZodIssue[]): string {
  const action = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const fields = typeof action.action === 'string' ? TODO_FIELDS[action.action] : undefined;
  if (!fields) return `Nieznana akcja ${JSON.stringify(action.action ?? null)}. Akcje: ${Object.keys(TODO_FIELDS).join(', ')}.`;
  const unknown = Object.keys(action).filter(key => key !== 'action' && !fields.includes(key));
  const wrong = issues.filter(issue => issue.code !== 'unrecognized_keys').map(issue => `${issue.path.join('.') || 'akcja'}: ${issue.message}`).slice(0, 3);
  return [
    `${action.action} przyjmuje tylko pola: ${fields.join(', ')}.`,
    unknown.length ? `Tych pól nie ma: ${unknown.join(', ')}.` : '',
    wrong.length ? `Do poprawy: ${wrong.join('; ')}.` : '',
    'list to id l-…, task to id t-….', unknown.some(key => /due|date|time|remind|deadline|termin/i.test(key)) ? NO_DUE : '',
  ].filter(Boolean).join(' ');
}

const range = { from: { type: 'string', description: 'Pierwszy dzień RRRR-MM-DD (domyślnie dziś)' }, to: { type: 'string', description: 'Ostatni dzień RRRR-MM-DD, włącznie (domyślnie from + 6 dni, najwyżej 42 dni)' } };
const schema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

export const PANEL_TOOLS: Record<string, Tool> = {
  panel_calendar: {
    description: 'Wydarzenia kalendarza Google użytkownika w zakresie dni (czas lokalny Europe/Warsaw).',
    input: z.object({ from: date.optional(), to: date.optional(), opisy: flag }).strict(),
    schema: schema({ ...range, opisy: { type: 'boolean', description: 'Dołącz opisy wydarzeń' } }),
    run: view('calendar', a => ({ from: a.from, to: a.to, opisy: a.opisy ? '1' : undefined })),
  },
  panel_training: {
    description: 'Plan treningowy Garmin, zaplanowane treningi i zapisane aktywności w zakresie dni.',
    input: z.object({ from: date.optional(), to: date.optional(), kroki: flag }).strict(),
    schema: schema({ ...range, kroki: { type: 'boolean', description: 'Dołącz kroki treningów' } }),
    run: view('training', a => ({ from: a.from, to: a.to, kroki: a.kroki ? '1' : undefined })),
  },
  panel_cezar: {
    description: 'Zadania Cezara (aktywne i zakończone, niezarchiwizowane). Z parametrem id (projekt/uuid): szczegóły, kroki i błędy wskazanego zadania. Z id i krok: wynik tego kroku (dla testów i typów linie błędów, dla kroku agenta, np. analysis, cały jego raport); używaj tego zamiast czytania plików .ai/cezar/runs.',
    input: z.object({ id: text(200).optional(), krok: z.string().trim().regex(/^[\w-]{1,60}$/).optional() }).strict()
      .refine(a => !a.krok || a.id, { message: 'krok wymaga id' }),
    schema: schema({
      id: { type: 'string', description: 'Id zadania projekt/uuid (np. desk-panel/cb2f59e7-...)' },
      krok: { type: 'string', description: 'Id kroku z listy kroków, np. verify, implement, fix (wymaga id)' },
    }),
    run: view('cezar', a => ({ id: a.id, krok: a.krok })),
  },
  panel_mail: {
    description: 'Nieprzeczytane wątki Gmail z 30 dni: nadawca, temat, początek (bez treści).',
    input: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
    schema: schema({ limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Ile wątków (domyślnie 10)' } }),
    run: view('mail', a => ({ limit: a.limit === undefined ? undefined : String(a.limit) })),
  },
  panel_quotas: { description: 'Limity AI użytkownika z resetami w czasie lokalnym.', input: z.object({}).strict(), schema: schema(), run: view('quotas', () => ({})) },
  panel_system: { description: 'CPU i RAM komputera użytkownika.', input: z.object({}).strict(), schema: schema(), run: view('system', () => ({})) },
  panel_todos: {
    description: 'Listy zadań użytkownika z id list (l-…) i zadań (t-…).',
    input: z.object({ list: text(200).optional(), ukonczone: flag }).strict(),
    schema: schema({ list: { type: 'string', description: 'Id listy albo fragment nazwy' }, ukonczone: { type: 'boolean', description: 'Pokaż też ukończone' } }),
    run: view('todos', a => ({ list: a.list, ukonczone: a.ukonczone ? '1' : undefined })),
  },
  panel_bank: {
    description: 'Konto PKO BP tylko do odczytu: saldo, operacje z zakresu (domyślnie 30 dni, najwyżej 400) z oznaczeniami użytkownika. Numery rachunków i telefonów są zamaskowane.',
    input: z.object({
      from: date.optional(), to: date.optional(),
      ruch: z.enum(['wydatek', 'przychód', 'rozliczenie', 'przełożenie']).optional(),
      kategoria: text(100).optional(), etykieta: text(100).optional(), strona: text(100).optional(), nieprzypisane: flag,
    }).strict(),
    schema: schema({
      from: { type: 'string', description: 'Pierwszy dzień RRRR-MM-DD (domyślnie 30 dni wstecz)' },
      to: { type: 'string', description: 'Ostatni dzień RRRR-MM-DD, włącznie (domyślnie dziś); zakres do 400 dni, więc cała zapisana historia mieści się w jednym zapytaniu' },
      ruch: { type: 'string', enum: ['wydatek', 'przychód', 'rozliczenie', 'przełożenie'] },
      kategoria: { type: 'string', description: 'Fragment nazwy kategorii albo źródła' },
      etykieta: { type: 'string' }, strona: { type: 'string', description: 'Fragment nazwy drugiej strony' },
      nieprzypisane: { type: 'boolean', description: 'Tylko operacje do przypisania' },
    }),
    run: view('bank', a => ({ from: a.from, to: a.to, ruch: a.ruch, kategoria: a.kategoria, etykieta: a.etykieta, strona: a.strona, nieprzypisane: a.nieprzypisane ? '1' : undefined })),
  },
  panel_time: {
    description: 'Bieżąca data i godzina użytkownika (Europe/Warsaw).',
    input: z.object({}).strict(), schema: schema(),
    async run(_args, { now }) {
      const format = new Intl.DateTimeFormat('pl-PL', { timeZone: DEFAULT_ZONE, dateStyle: 'full', timeStyle: 'short' });
      return `Teraz: ${format.format(now)} (${DEFAULT_ZONE}).`;
    },
  },
  panel_todo_action: {
    description: `Zmiana list zadań użytkownika. Akcje i jedyne pola, jakie przyjmują: ${Object.entries(TODO_FIELDS).map(([action, fields]) => `${action} {${fields.join(', ')}}`).join('; ')}. list to id l-…, task to id t-…; przy addTask zawsze "by":"agent". ${NO_DUE} Usuwaj tylko na wyraźną prośbę.`,
    input: z.object({ action: z.record(z.string(), z.unknown()) }).strict(),
    schema: schema({ action: { type: 'object', description: 'Np. {"action":"addTask","list":"l-…","title":"…","by":"agent"} albo {"action":"updateTask","task":"t-…","note":"…"}' } }, ['action']),
    async run(args, { sources }) {
      const parsed = todoActionSchema.safeParse(args.action);
      if (!parsed.success) throw new AgentViewError(400, todoActionError(args.action, parsed.error.issues));
      return JSON.stringify(await sources.todoAction(parsed.data));
    },
  },
  // ── Cards of the chat cockpit: what these tools get is shown to the user as a card, by the tool's name. ──
  panel_recon_report: {
    description: cockpitToolDescription('panel_recon_report'),
    input: z.object({
      files: z.array(z.object({ path: repoPath, note: z.string().max(200).optional(), new: z.boolean().optional() }).strict()).max(30),
      kind: z.enum(['UI', 'non-UI']),
      scenario: text(80).optional(),
      prompt: text(32_000),
      outside: z.array(z.object({ name: text(120), source: text(160) }).strict()).max(30).optional(),
    }).strict(),
    schema: schema({
      outside: { type: 'array', description: 'Nazwy z promptu (w `…`), których nie ma w plikach repo, z ich źródłem: dane panelu z wyniku narzędzia (np. "panel_quotas") albo "nowa" dla nazwy, którą wprowadzi executor', items: { type: 'object', properties: {
        name: { type: 'string' }, source: { type: 'string' },
      }, required: ['name', 'source'], additionalProperties: false } },
      files: { type: 'array', items: { type: 'object', properties: {
        path: { type: 'string', description: 'Ścieżka względem repo z wyników wyszukiwania, np. src/App.tsx' },
        note: { type: 'string', description: 'Po co ten plik' },
        new: { type: 'boolean', description: 'true: plik, który executor dopiero utworzy' },
      }, required: ['path'], additionalProperties: false } },
      kind: { type: 'string', enum: ['UI', 'non-UI'] },
      scenario: { type: 'string', description: 'Scenariusz zrzutów, np. standard (dla UI)' },
      prompt: { type: 'string', description: 'Pełny Executor Prompt po angielsku' },
    }, ['files', 'kind', 'prompt']),
    async run(args, { now }) {
      const missing = (args.files as { path: string; new?: boolean }[]).filter(f => !f.new && !existsSync(path.join(REPO_ROOT, f.path))).map(f => f.path);
      if (missing.length) throw new AgentViewError(400, `Tych plików nie ma w repozytorium: ${missing.join(', ')}. Wymień tylko pliki z wyników wyszukiwania; plik, który executor utworzy, oznacz "new": true.`);
      const sections = missingSections(String(args.prompt));
      if (sections.length) throw new AgentViewError(400, `W prompcie brakuje sekcji: ${sections.join(', ')}. Użyj dokładnie kształtu Executor Prompt ze skilla, każda sekcja od nowej linii.`);
      const unplaced = unplacedAsks(String(args.prompt));
      if (unplaced.length) throw new AgentViewError(400, `W "User asks" każda prośba użytkownika (jego słowami) mówi, dokąd trafiła: "→ criterion N", "→ plan: osobna praca w <repo>" albo "→ not done: <powód>". Bez tego: ${unplaced.join(' | ')}.`);
      const soft = softCriteria(String(args.prompt));
      if (soft.length) throw new AgentViewError(400, `Te kryteria przejdą, cokolwiek executor zrobi: ${soft.join(' | ')}. Kryterium mówi, co ma działać; brak z "Live data" executor buduje (plik w server/), a gdy trzeba go zbudować poza tym repozytorium, usuń go z kryteriów i nazwij w planie dla użytkownika jako osobną pracę.`);
      const repoText = trackedText(now);
      const foreign = repoText === null ? [] : foreignPaths(String(args.prompt), repoText, (args.files as { path: string; new?: boolean }[]).filter(f => f.new).map(f => f.path));
      if (foreign.length) throw new AgentViewError(400, `Tych ścieżek nie ma w tym repozytorium: ${foreign.join(', ')}. Ścieżka z wyników wyszukiwania (z wielkością liter jak tam) przejdzie; plik, który executor utworzy, dodaj do files z "new": true. Executor pracuje w worktree desk-panelu i nie przeczyta innego repozytorium ani katalogu domowego: praca w kodzie innego repozytorium nie jest zadaniem tej karty, powiedz użytkownikowi, że to osobna praca tam (w "User asks": "→ plan: osobna praca w <repo>").`);
      const unknown = repoText === null ? [] : unknownNames(String(args.prompt), repoText, ((args.outside ?? []) as { name: string }[]).map(o => o.name));
      if (unknown.length) throw new AgentViewError(400, `Tych nazw z promptu nie ma w żadnym pliku repozytorium: ${unknown.map(n => `\`${n}\``).join(', ')}. Nazwę, którą pokazał wynik narzędzia panelu (np. panel_quotas), albo nową, którą wprowadzi executor, podaj w "outside" z jej źródłem; nazwę, której nie pokazał żaden wynik narzędzia, usuń z promptu.`);
      for (const [id, recon] of recons) if (now - recon.at > RECON_TTL_MS || recons.size >= RECONS_KEPT) recons.delete(id);
      const id = `r-${randomBytes(6).toString('hex')}`;
      recons.set(id, { prompt: String(args.prompt).trim(), at: now });
      return `${CARD_SHOWN.recon}. recon: ${id}. Teraz napisz użytkownikowi krótki plan po polsku, a potem wywołaj panel_cezar_propose z tym samym promptem i "recon":"${id}".`;
    },
  },
  panel_cezar_propose: {
    description: cockpitToolDescription('panel_cezar_propose'),
    input: z.object({
      title: text(120),
      prompt: text(32_000),
      recon: z.string().regex(/^r-[0-9a-f]{12}$/),
      workflow: z.enum(CEZAR_WORKFLOWS).optional(),
      todoId: z.string().regex(/^t-[0-9a-f]{8}$/).optional(),
    }).strict(),
    schema: schema({
      title: { type: 'string', description: 'Krótki tytuł taska po polsku' },
      prompt: { type: 'string', description: 'Pełny Executor Prompt (ten sam co w panel_recon_report)' },
      recon: { type: 'string', description: 'Identyfikator z wyniku panel_recon_report (r-…)' },
      workflow: { type: 'string', enum: [...CEZAR_WORKFLOWS], description: 'Workflow na Cezarze: "analysis" (analiza) lub "desk-panel-task" (implementacja, domyślnie)' },
      todoId: { type: 'string', description: 'Id zadania z list (t-…), gdy task je realizuje' },
    }, ['title', 'prompt', 'recon']),
    async run(args) {
      const recon = recons.get(args.recon);
      if (!recon) throw new AgentViewError(409, 'Panel nie zna tego recon. Najpierw wywołaj panel_recon_report i poczekaj na jego wynik: podaje recon, którego tu potrzeba. Propozycji nie wysyłaj w tej samej odpowiedzi co rekonesans.');
      if (recon.prompt !== String(args.prompt).trim()) throw new AgentViewError(409, 'Prompt różni się od tego z panel_recon_report. Wyślij ten sam prompt albo zrób rekonesans od nowa.');
      return `${CARD_SHOWN.dispatch}: decyzja należy do niego, a zleca panel. Nie wysyłaj niczego do Cezara. Zakończ odpowiedź jednym zdaniem.`;
    },
  },
  panel_cezar_watch: {
    description: cockpitToolDescription('panel_cezar_watch'),
    input: z.object({ id: cezarRunId }).strict(),
    schema: schema({ id: { type: 'string', description: 'Id taska projekt/uuid (z panel_cezar)' } }, ['id']),
    async run(args, { sources, cezarUrl }) {
      const raw = sources.cezarRun ? await sources.cezarRun(args.id) : null;
      if (!raw) throw new AgentViewError(404, `Cezar nie zna taska ${args.id}.`);
      const task = cezarTaskView(args.id, raw, cezarUrl);
      return JSON.stringify({ task: { id: task.id, title: task.title, status: task.status, progress: Math.round(task.progress * 100) / 100, tokens: task.tokens, steps: task.steps, pr: task.prUrl ?? null, url: task.url } });
    },
  },
  panel_show: {
    description: cockpitToolDescription('panel_show'),
    input: bankShowQuerySchema.extend({ tytul: text(80).optional() }).strict(),
    schema: schema({
      tytul: { type: 'string', description: 'Krótki tytuł karty po polsku, np. „Psycholog, fizjoterapeuta, podolog”' },
      widok: { type: 'string', enum: [...BANK_SHOW_VIEWS], description: '"tabela": operacje z sumami kategorii; "słupki": porównanie sum kategorii' },
      kategorie: { type: 'array', maxItems: BANK_SHOW_LIMITS.categories, items: { type: 'string' }, description: 'Nazwy kategorii wydatków (wystarczy ich część), z panel_bank' },
      from: { type: 'string', description: 'Pierwszy dzień RRRR-MM-DD (domyślnie 365 dni wstecz)' },
      to: { type: 'string', description: 'Ostatni dzień RRRR-MM-DD (domyślnie dziś)' },
    }, ['kategorie']),
    async run(args, { sources, now }) {
      try {
        const query = bankShowQuerySchema.parse(args);
        const ledger = await sources.bankLedger();
        const data = bankShow(ledger, query, dayIn(now, DEFAULT_ZONE));
        return `${CARD_SHOWN.show}. ${bankShowSummary(ledger, data)} Wiersze są na karcie: nie wypisuj ich ponownie. Napisz krótko, co o tym sądzisz.`;
      } catch (error) {
        if (error instanceof BankShowError) throw new AgentViewError(error.status, error.message);
        throw error;
      }
    },
  },
  panel_cockpit_clear: {
    description: cockpitToolDescription('panel_cockpit_clear'),
    input: z.object({}).strict(), schema: schema(),
    // What it does follows from the call itself: the cockpit reads the conversation (src/cockpit-contract.ts).
    async run() { return 'Kokpit tej rozmowy nie obserwuje już taska.'; },
  },
  panel_cezar_action: {
    description: 'Na prośbę użytkownika: archive, unarchive, read albo unread jednego zakończonego zadania Cezara (id projekt/uuid z panel_cezar).',
    input: z.object({ id: text(200), action: z.enum(['archive', 'unarchive', 'read', 'unread']) }).strict(),
    schema: schema({ id: { type: 'string' }, action: { type: 'string', enum: ['archive', 'unarchive', 'read', 'unread'] } }, ['id', 'action']),
    async run(args, { sources }) {
      const parsed = cezarActionSchema.safeParse(args);
      if (!parsed.success) throw new AgentViewError(400, 'Niepoprawne id albo akcja.');
      await sources.cezarAction(parsed.data.id, parsed.data.action);
      return '{"ok":true}';
    },
  },
};

/** The token Hermes sends: `DESK_MCP_TOKEN`, or a random one kept in `<dir>/mcp-token` (outside Git), made on first start. */
export function mcpToken(env: NodeJS.ProcessEnv = process.env, dir = path.join(homedir(), '.desk-panel')): string {
  const fromEnv = env.DESK_MCP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(dir, 'mcp-token');
  if (existsSync(file)) { const saved = readFileSync(file, 'utf8').trim(); if (saved.length >= 32) return saved; }
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: unknown };
const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export async function answerRpc(message: Rpc, ctx: { views: Record<string, AgentView>; sources: PanelSources; now: () => number; cezarUrl?: string }): Promise<unknown | null> {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message?.id, -32600, 'Invalid Request');
  const notification = message.id === undefined;
  if (notification) return null;
  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, any>;
  switch (message.method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '');
      return { jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: (MCP_PROTOCOLS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'desk-panel', version: '1.0.0' },
        instructions: 'Dane Desk Panelu użytkownika: krótki tekst po polsku z czasem lokalnym. Tylko odczyt, poza panel_todo_action i panel_cezar_action. Narzędzia kokpitu (panel_recon_report, panel_cezar_propose, panel_cezar_watch, panel_show, panel_cockpit_clear) mówią w opisie, kiedy ich używać i co się po nich dzieje.',
      } };
    }
    case 'ping': return { jsonrpc: '2.0', id: message.id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id: message.id, result: { tools: Object.entries(PANEL_TOOLS).map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.schema })) } };
    case 'tools/call': {
      const name = String(params.name ?? '');
      const tool = Object.hasOwn(PANEL_TOOLS, name) ? PANEL_TOOLS[name] : undefined;
      if (!tool) return rpcError(message.id, -32602, `Unknown tool: ${name.slice(0, 60)}`);
      const args = tool.input.safeParse(params.arguments ?? {});
      if (!args.success) return { jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: `Niepoprawne argumenty: ${args.error.issues.map(i => `${i.path.join('.') || 'argumenty'}: ${i.message}`).join(', ')}` }] } };
      try {
        const out = await tool.run(args.data, { views: ctx.views, sources: ctx.sources, now: ctx.now(), cezarUrl: ctx.cezarUrl ?? 'http://127.0.0.1:4321/' });
        return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: out }] } };
      } catch (error) {
        const reason = error instanceof AgentViewError || error instanceof TodoError ? error.message
          : error instanceof SourceError ? `Nie udało się pobrać danych źródła (${error.status}).` : 'Nie udało się wykonać narzędzia.';
        return { jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: reason }] } };
      }
    }
    default: return rpcError(message.id, -32601, 'Method not found');
  }
}

const sameToken = (given: string, expected: string) => {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** `/api/mcp`. `loopback` is false for a request that came through the Tailscale name: refused. */
export async function handleMcpRoute(req: IncomingMessage, res: ServerResponse, ctx: { views: Record<string, AgentView>; sources: PanelSources; token?: string; loopback: boolean; now?: () => number; cezarUrl?: string }): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (!ctx.loopback || req.headers.origin) { res.writeHead(403).end(); return; }
  if (!ctx.token) { res.writeHead(503).end(); return; }
  const auth = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
  if (!sameToken(auth, ctx.token)) { res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) { res.writeHead(413).end(); return; } }
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(rpcError(null, -32700, 'Parse error'))); return; }
  const run = { views: ctx.views, sources: ctx.sources, now: ctx.now ?? Date.now, cezarUrl: ctx.cezarUrl };
  const batch = Array.isArray(parsed);
  const answers = (await Promise.all((batch ? parsed as Rpc[] : [parsed as Rpc]).map(m => answerRpc(m, run)))).filter(a => a !== null);
  if (!answers.length) { res.writeHead(202).end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(batch ? answers : answers[0]));
}
