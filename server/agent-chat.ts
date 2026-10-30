import type { ChatNamer } from './chat-title';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createChatLog, type ChatLog, type TurnSummary, type TurnTool } from './chat-log';
import {
  automationPrompt, titleFrom, withContext,
  type ChatApproval, type ChatAutomation, type ChatAutomationInput, type ChatDetail, type ChatEngine, type ChatEvent, type ChatMessage, type ChatPart, type ChatSend, type ChatSummary, type ChatUsage,
  type EngineStatus,
} from '../src/chat-contract';

/** A failure the HTTP layer answers with this status. */
export class ChatError extends Error {
  constructor(readonly status: number, message = `chat failed with ${status}`) { super(message); }
}

export const DEFAULT_PANEL_URL = 'http://127.0.0.1:5174';

/**
 * What the agent is told once, when a conversation starts. The dashboard elements the user points at come with each
 * message; what they do not cover the agent reads itself from the panel's own read-only API at `panelUrl`.
 */
export function preamble(panelUrl: string = DEFAULT_PANEL_URL): string {
  return [
    'Jesteś agentem wbudowanym w Desk Panel: osobisty pulpit użytkownika z pocztą Gmail, kalendarzem Google, zadaniami Cezara, treningami Garmin, kontem bankowym, limitami AI i stanem komputera.',
    'Odpowiadasz po polsku, zwięźle i konkretnie.',
    'Użytkownik może wskazać elementy pulpitu. Dostajesz je w bloku [Kontekst] przed wiadomością: to podpowiedź, o co pyta, a nie wszystko, co możesz wiedzieć. Gdy pytanie wymaga danych, których tam nie ma (np. wydarzeń z przyszłego tygodnia), pobierz je sam i nie proś użytkownika o ich podanie.',
    `Masz powłokę i możesz uruchamiać polecenia. Dane panelu czytasz z jego lokalnego API (tylko GET), przez widoki dla agenta: krótki tekst po polsku, z czasem lokalnym (Europe/Warsaw), np. \`curl.exe -s "${panelUrl}/api/agent/calendar?from=2026-10-26&to=2026-10-30"\` (adres w cudzysłowie; w PowerShellu \`curl\` to alias, używaj \`curl.exe\`):`,
    '- /api/agent/calendar?from=RRRR-MM-DD&to=RRRR-MM-DD: wydarzenia Google (z opisami po dopisaniu &opisy=1). Zakres to dni włącznie, domyślnie dziś i sześć kolejnych, najwyżej 42 dni.',
    '- /api/agent/training?from=…&to=…: plan i zapisane aktywności Garmin w zakresie jak wyżej (kroki treningów po dopisaniu &kroki=1).',
    '- /api/agent/cezar: zadania Cezara (aktywne i zakończone, niezarchiwizowane); przy zakończonych jest id w postaci `projekt/uuid` (do akcji poniżej); dopisanie ?id=projekt/uuid zwraca pełne szczegóły, błąd i kroki zadania.',
    '- /api/agent/mail?limit=N: nieprzeczytane wątki Gmail z 30 dni (nadawca, temat, początek), bez treści wiadomości; N od 1 do 50, domyślnie 10.',
    '- /api/agent/quotas: limity AI. /api/agent/system: CPU i RAM komputera.',
    '- /api/agent/todos?list=id-lub-nazwa&ukonczone=1: listy zadań użytkownika (zadania do zrobienia) z id list (`l-…`) i zadań (`t-…`); oba parametry są opcjonalne, ukończone są domyślnie tylko policzone.',
    '- /api/agent/bank?from=…&to=…&ruch=…&kategoria=…&etykieta=…&strona=…&nieprzypisane=1: konto PKO BP (saldo, operacje z zakresu, domyślnie ostatnie 30 dni, najwyżej 400) z oznaczeniami użytkownika: ruch (wydatek z kategorią, przychód ze źródłem, rozliczenie, czyli pożyczka albo jej oddanie, z drugą stroną, przełożenie między własnymi kontami), druga strona, etykiety, cykliczne, opis, „do przypisania”; wydatki według kategorii, przychody według źródła, netto i salda rozliczeń z każdą stroną z całej zapisanej historii. Parametry są opcjonalne; ruch to wydatek, przychód, rozliczenie albo przełożenie, a kategoria (także źródło), etykieta i strona to fragment nazwy. Tylko do odczytu: oznaczeń nie zmieniasz, nawet na prośbę (powiedz, że użytkownik robi to w kafelku Konto).',
    'Słowo „zadanie” bez dopowiedzenia oznacza zadanie z list zadań użytkownika, nie zadanie Cezara. Zadania Cezara to tylko te, o których użytkownik mówi „Cezar” albo „task Cezara”, albo które wskazał na kafelku Cezara.',
    'Wskazana w bloku [Kontekst] „Lista zadań” podaje id listy (l-…) i jej zadania do zrobienia z id (t-…), a „Zadanie z listy” id zadania i listy. Używaj tych id wprost, bez ponownego czytania list: „dodaj tu zadanie” to addTask do wskazanej listy, „odhacz to” to updateTask wskazanego zadania, „przenieś to na listę X” to moveTask. Kontekst może być nieaktualny o kilka sekund; gdy ważne jest, co jest teraz na liście, odczytaj ją.',
    'Nagłówek widoku mówi, jaki jest dziś (kalendarz, trening) i z kiedy są dane; wiersz „brak danych” znaczy, że źródło milczy: powiedz to wprost. Czasy są już lokalne, nie przeliczaj ich.',
    'Oszczędzaj kontekst: wszystko, co wydrukujesz, zostaje w rozmowie do jej końca. Pobieraj tylko źródła potrzebne do pytania, jednym poleceniem na źródło, z zakresem dat dopasowanym do pytania, i nie pobieraj ponownie tego, co już jest w rozmowie. Surowy JSON panelu (/api/calendar, /api/mail itd.) jest długi i z czasem w milisekundach: nie używaj go, chyba że widoki nie mają potrzebnego pola.',
    `Do panelu wysyłaj tylko zapytania GET, z trzema wyjątkami. Wszystkie trzy to POST z nagłówkiem Origin równym ${panelUrl} i ciałem JSON, w PowerShellu np. \`Invoke-RestMethod -Method Post -Uri "<adres>" -Headers @{Origin="${panelUrl}"} -ContentType "application/json; charset=utf-8" -Body (@{...} | ConvertTo-Json -Compress)\`. Wywołuj to bezpośrednio w powłoce, nie przez zagnieżdżone \`powershell -Command "..."\`: ono psuje cudzysłowy i gubi polskie znaki w tytułach. Wiele zmian rób jednym poleceniem z pętlą. (1) Na prośbę użytkownika zakończone zadania Cezara: POST ${panelUrl}/api/cezar/action z {"id":"projekt/uuid","action":"archive"} (action: archive, unarchive, read albo unread; id z widoku cezar). (2) Listy zadań użytkownika: POST ${panelUrl}/api/todos/action z jednym z: {"action":"createList","name":"…"} (jeśli taka lista już jest, zwraca ją), {"action":"addTask","list":"l-…","title":"…","note":"…","by":"agent"}, {"action":"updateTask","task":"t-…","done":true} (też title i note), {"action":"moveTask","task":"t-…","list":"l-…"}, {"action":"renameList","list":"l-…","name":"…"}, {"action":"deleteTask","task":"t-…"}, {"action":"clearDone","list":"l-…"}, {"action":"deleteList","list":"l-…"}. Odpowiedź z "ok":true znaczy, że się udało, i zawiera id (np. nowego zadania); błąd ma pole "error" z powodem. Przy addTask zawsze dawaj "by":"agent". (3) Zlecenie wykonania zadania na Cezarze (tylko po potwierdzeniu przez użytkownika w skillu "Zaimplementuj zadanie" lub na wyraźne polecenie zlecenia na Cezarze): POST ${panelUrl}/api/cezar/runs z {"title":"Krótki tytuł","task":"Pełny Executor Prompt...","todoId":"t-…"} (domyślnie workflow desk-panel-task; runner i model według ustawień Cezara); odpowiedź zawiera {"ok":true,"id":"<uuid>","url":"http://127.0.0.1:4173/?project=desk-panel&run=<uuid>"}.`,
    'Dodając zadanie bez wskazanej listy użyj jedynej listy albo tej, której nazwa pasuje do prośby; gdy jest kilka i nie wiesz której, zapytaj; gdy nie ma żadnej, utwórz listę „Zadania”. Usuwaj (deleteTask, clearDone, deleteList) i archiwizuj zadania Cezara tylko na wyraźną prośbę, a na koniec napisz, co dokładnie zmieniłeś. Inne zapisy (poczta, czat) są zabronione bez wyraźnej prośby użytkownika, a oznaczeń operacji bankowych (/api/bank/labels/action) i czegokolwiek w banku nie zmieniasz wcale.',
    'Notatek panel jeszcze nie ma: gdy użytkownik o nie prosi, powiedz to wprost i zaproponuj, co zapisać jako zadanie na liście.',
    'Gdy w [Kontekst] jest „Skill: Zaimplementuj zadanie”, działasz jako dyspozytor: zrób szybki rekonesans tylko do odczytu w repozytorium C:\\Users\\Viktor\\AndroidStudioProjects\\desk-panel, wypisz krótki plan (3–6 punktów) oraz gotowy blok Executor Prompt po angielsku i zapytaj „Zlecić na Cezarze?”. Dopiero po potwierdzeniu („zleć”, „ok”, „tak”) wyślij POST /api/cezar/runs i podaj link z pola url.',
    'Katalog roboczy jest pusty i służy tylko tej rozmowie. Nie zmieniaj plików poza nim, jeśli użytkownik nie poprosi o to wprost. Gdy użytkownik poprosi o wdrożenie zmian lub restart panelu, uruchom `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "servy\\desk-panel.ps1" -Action RESTART`: skrypt automatycznie oddeleguje budowanie frontendu i restart do odpiętego procesu w tle, dzięki czemu tura czatu zakończy się czysto bez nagłego zerwania procesu.',
    'Tura automatyki: gdy wiadomość zaczyna się od „[Automatyka · Cezar]” albo „[Automatyka · Obserwator]” z powodem, to panel doniósł fakt, a nie użytkownik. Przejrzyj wynik i krótko go podsumuj, potem zaproponuj jeden następny krok. Niczego nie zlecaj, nie zapisuj ani nie zatwierdzaj sam: zlecenie Cezara i zmiany idą tylko kartą zgody po kliknięciu użytkownika.',
  ].join('\n');
}

/** One running `agy` for one conversation. A test replaces it with a script of events. */
export interface AgentProcess {
  /** The full command line, for the diagnostic log. */
  readonly command?: readonly string[];
  write(line: string): void;
  /** Close stdin: the agent finishes the turn it is on and exits. */
  end(): void;
  /** Stop it now, with everything it started. */
  kill(): void;
  onLine(callback: (line: string) => void): void;
  onExit(callback: (reason: string | null) => void): void;
}
export type Launcher = (args: string[], cwd: string) => AgentProcess;

export function agyExecutable(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.DESK_AGY_BIN) return env.DESK_AGY_BIN;
  const bin = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const candidates = [
    path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'agy', 'bin', bin),
    path.join(home, '.agy', 'bin', bin),
    path.join(home, '.local', 'bin', bin),
  ];
  return candidates.find(existsSync) ?? bin;
}

/** The model every conversation runs on unless `DESK_AGY_MODEL` says otherwise (`agy models` lists the ids; the id carries the reasoning level). */
export const DEFAULT_AGY_MODEL = 'gemini-3.8-flash-medium';

/** `--model` from `DESK_AGY_MODEL`, and `--effort` (low|medium|high|xhigh|max) only when `DESK_AGY_EFFORT` is set, since a model id already has its level. */
/**
 * Headless `agy` cannot ask for permission, so a tool that needs it (reading a file outside the working directory) is
 * denied and the turn ends without an answer. The chat runs with `--dangerously-skip-permissions`, as `run_command`
 * already does, unless `DESK_AGY_SKIP_PERMISSIONS` is 0, false, no or off. Only the launch arguments change, never agy's own settings.
 */
export function agyPermissionArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  return /^(0|false|no|off)$/i.test(env.DESK_AGY_SKIP_PERMISSIONS?.trim() ?? '') ? [] : ['--dangerously-skip-permissions'];
}

export function agyModelArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const model = env.DESK_AGY_MODEL?.trim() || DEFAULT_AGY_MODEL;
  const effort = env.DESK_AGY_EFFORT?.trim();
  return ['--model', model, ...(effort ? ['--effort', effort] : [])];
}

/** Shell-free, as the adapter does it; the whole process tree goes with the kill. */
export function agyLauncher(env: NodeJS.ProcessEnv = process.env): Launcher {
  return (args, cwd) => {
    const argv = [...agyModelArgs(env), ...agyPermissionArgs(env), ...args];
    const child = spawn(agyExecutable(env), argv, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let exited = false, stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdin.on('error', () => { /* the exit handler tells what happened */ });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-600); });
    return {
      command: [path.basename(agyExecutable(env)), ...argv],
      write: line => { child.stdin.write(line); },
      end: () => { child.stdin.end(); },
      kill: () => {
        if (exited || !child.pid) return;
        if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
        else child.kill('SIGKILL');
      },
      onLine: callback => {
        let buffer = '';
        child.stdout.on('data', (chunk: string) => {
          buffer += chunk;
          let at: number;
          while ((at = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1); if (line) callback(line); }
        });
      },
      onExit: callback => {
        const done = (reason: string | null) => { if (!exited) { exited = true; callback(reason); } };
        child.on('error', (e: NodeJS.ErrnoException) => done(e.code === 'ENOENT' ? 'Nie znaleziono agy. Ustaw DESK_AGY_BIN albo zainstaluj Antigravity CLI.' : 'Nie udało się uruchomić agy.'));
        child.on('close', code => done(code === 0 ? null : stderr.trim().split('\n').pop() || `agy zakończył pracę kodem ${code}.`));
      },
    };
  };
}

/**
 * One agy conversation on disk. `engine` came with Hermes (schema 2): a file without it is an agy chat from before, and
 * is tagged on load, everything else in it kept as it was.
 */
interface Stored { id: string; engine?: 'agy'; title: string; userNamed?: boolean; titleAttempted?: boolean; createdAt: number; updatedAt: number; agy: string | null; items: ChatMessage[] }
/** What the diagnostic log needs to know about the turn that is running. */
interface TurnTrace {
  number: number; startedAt: number; ask: string; context: string[];
  lastStep: string | null; result: { status: string | null; responseChars: number } | null;
  /** True size of each tool's output (the stored part is shortened), by step id. */
  outputChars: Map<string, number>;
  /** Why a tool failed, by step id, and what agy refused to run for lack of permission. */
  toolErrors: Map<string, string>;
  denied: string[];
}
interface Session { proc: AgentProcess; agent: ChatMessage | null; steps: Map<number, number>; stopping: boolean; idle?: ReturnType<typeof setTimeout>; model: string | null; turn?: TurnTrace }

export interface ChatService {
  list(): Promise<ChatSummary[]>;
  get(id: string): Promise<ChatDetail>;
  create(input: ChatSend): Promise<{ id: string }>;
  send(id: string, input: ChatSend): Promise<void>;
  /** A turn the panel starts itself (never the user's message); the conversation marks it as automation. */
  automationTurn?(runId: string): { chatId: string; turnId: string; runId: string } | undefined;
  sendAutomation?(id: string, input: ChatAutomationInput): Promise<void>;
  /** A fresh conversation whose first turn the panel starts itself (a cyclic automation's run). */
  createAutomation?(input: ChatAutomationInput): Promise<{ id: string }>;
  /** The conversations with a turn running right now: a card-free panel tool belongs to the turn that called it. */
  activeTurns?(): string[];
  stop(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  update?(id: string, changes: { archived?: boolean; temporary?: false }): Promise<void>;
  remove(id: string): Promise<void>;
  /** The user's answer to a tool the agent asked about. Only engines that ask (Hermes) have it. */
  approve?(id: string, approval: ChatApproval): Promise<void>;
  /** Which engines can take a message, and the preferred one; only the router of both engines has them. */
  engines?(): Promise<EngineStatus[]>;
  preferred?(): Promise<ChatEngine>;
  prefer?(engine: ChatEngine): Promise<void>;
  /** Sends the whole chat at once, then every message that changes. Returns the way to stop listening. */
  subscribe(id: string, listener: (event: ChatEvent) => void): Promise<() => void>;
  close(): void;
  /** Resolves once everything that was to be saved is on disk. */
  drain(): Promise<void>;
}

export interface ChatOptions {
  /** Where chats and the agent's working directory live; `~/.desk-panel` by default. */
  dir?: string;
  launch?: Launcher;
  namer?: ChatNamer;
  /** Where the agent reads the panel's API from (the service's own loopback address); `DEFAULT_PANEL_URL` by default. */
  panelUrl?: string;
  /** Where raw events and per-turn summaries go for later analysis; `<dir>/chat-logs` by default. */
  log?: ChatLog;
  now?: () => number;
  /** How long an idle agent process is kept before it is closed. The next message resumes the conversation. */
  idleMs?: number;
}

const ID = /^[0-9a-f-]{36}$/;
/** `Command exited with code 1.` is how agy ends the output of a shell command. */
const exitCodeOf = (output: string | undefined) => { const code = /exited with code (-?\d+)/.exec(output ?? '')?.[1]; return code === undefined ? null : Number(code); };
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** The turn's cost from the `result` event's `usage`; `calls` and `tools` are the agent's streamed steps (read before empty ones are dropped). */
function usageOf(raw: unknown, parts: ChatPart[]): ChatUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const usage = raw as Record<string, unknown>;
  return {
    input: count(usage.input_tokens), output: count(usage.output_tokens), thinking: count(usage.thinking_tokens), cached: count(usage.cache_read_tokens),
    calls: parts.filter(p => p.type === 'text').length, tools: parts.filter(p => p.type === 'tool').length,
  };
}
const asRecord = (value: unknown): Record<string, any> => (value && typeof value === 'object' ? value as Record<string, any> : {});

export function createAgentChat(options: ChatOptions = {}): ChatService {
  const dir = options.dir ?? path.join(homedir(), '.desk-panel');
  const launch = options.launch ?? agyLauncher();
  const intro = preamble(options.panelUrl);
  const now = options.now ?? Date.now;
  const log = options.log ?? createChatLog(dir, now);
  const idleMs = options.idleMs ?? 10 * 60_000;
  const chatsDir = path.join(dir, 'chats'), agentDir = path.join(dir, 'agent');
  const chats = new Map<string, Stored>();
  const sessions = new Map<string, Session>();
  const listeners = new Map<string, Set<(event: ChatEvent) => void>>();
  const flushes = new Map<string, { timer: ReturnType<typeof setTimeout>; messages: Set<ChatMessage> }>();
  let loading: Promise<void> | undefined;

  const file = (id: string) => path.join(chatsDir, `${id}.json`);
  const persist = async (chat: Stored) => {
    await mkdir(chatsDir, { recursive: true });
    const temp = `${file(chat.id)}.tmp`;
    await writeFile(temp, JSON.stringify(chat), 'utf8');
    await rename(temp, file(chat.id));
  };
  // Writes of one chat go one after another, each with the chat as it is when its turn comes; a chat deleted in the
  // meantime is not written back by a process that is still finishing.
  const writes = new Map<string, Promise<void>>();
  const save = (chat: Stored) => {
    const turn = (writes.get(chat.id) ?? Promise.resolve())
      .then(() => (chats.get(chat.id) === chat ? persist(chat) : undefined))
      .catch(() => { /* the chat lives on in memory; the next save tries again */ });
    writes.set(chat.id, turn);
    void turn.then(() => { if (writes.get(chat.id) === turn) writes.delete(chat.id); });
  };

  const load = () => loading ??= (async () => {
    await mkdir(chatsDir, { recursive: true });
    for (const name of await readdir(chatsDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(await readFile(path.join(chatsDir, name), 'utf8')) as Stored;
        if (typeof value.id !== 'string' || !ID.test(value.id) || !Array.isArray(value.items)) continue;
        // A turn that was running when the panel stopped cannot go on: say so instead of showing it as alive.
        for (const message of value.items) if (message.status === 'streaming') { message.status = 'error'; message.error = 'Przerwano: panel został uruchomiony ponownie.'; }
        const legacy = value.engine !== 'agy';
        if (legacy) value.engine = 'agy';
        chats.set(value.id, value);
        if (legacy) save(value);
      } catch { /* a damaged file is not a chat */ }
    }
  })();
  const need = async (id: string) => {
    await load();
    const chat = ID.test(id) ? chats.get(id) : undefined;
    if (!chat) throw new ChatError(404);
    return chat;
  };

  const summary = (chat: Stored): ChatSummary => ({
    id: chat.id, title: chat.title, ...( chat.userNamed ? { userNamed: true } : {} ), createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.items.length,
    running: !!sessions.get(chat.id)?.agent, engine: 'agy',
  });
  const detail = (chat: Stored): ChatDetail => ({ ...summary(chat), items: chat.items });
  const emit = (id: string, event: ChatEvent) => { for (const listener of listeners.get(id) ?? []) listener(event); };
  /** Text arrives in many small pieces; the screen gets the message a few times a second, not on every piece. */
  const touch = (chat: Stored, message: ChatMessage, immediate = false) => {
    let pending = flushes.get(chat.id);
    if (!pending) {
      pending = { messages: new Set(), timer: setTimeout(() => flush(chat), 40) };
      flushes.set(chat.id, pending);
    }
    pending.messages.add(message);
    if (immediate) flush(chat);
  };
  const flush = (chat: Stored) => {
    const pending = flushes.get(chat.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    flushes.delete(chat.id);
    for (const message of pending.messages) emit(chat.id, { type: 'update', chat: summary(chat), message });
  };

  const armIdle = (chat: Stored, session: Session) => {
    clearTimeout(session.idle);
    session.idle = setTimeout(() => { if (!session.agent) { log.trace(chat.id, { turn: session.turn?.number ?? 0, src: 'panel', kind: 'idle' }); session.proc.end(); } }, idleMs);
    session.idle.unref?.();
  };

  /** One summary line per finished turn and the closing line of its trace (see chat-log.ts). */
  const record = (chat: Stored, session: Session, agent: ChatMessage, status: ChatMessage['status'], error: string | undefined, emptyAnswer: boolean, answerChars: number, calls: number, endedBy: TurnSummary['endedBy']) => {
    const trace = session.turn;
    if (!trace || (status !== 'done' && status !== 'error' && status !== 'stopped')) return;
    const tools: TurnTool[] = (agent.parts ?? []).filter((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool').slice(0, 30).map(p => ({
      name: p.name, input: p.input.slice(0, 200),
      exitCode: exitCodeOf(p.output),
      outputChars: trace.outputChars.get(p.id) ?? null,
      error: trace.toolErrors.get(p.id) ?? null,
    }));
    log.trace(chat.id, { turn: trace.number, src: 'panel', kind: 'finish', status, error: error ?? null, emptyAnswer, endedBy });
    log.turn({
      at: now(), chat: chat.id, title: chat.title, turn: trace.number, model: session.model, engine: 'agy', ask: trace.ask, context: trace.context,
      status, error: error ?? null, endedBy, emptyAnswer, answerChars, seconds: Math.round((now() - trace.startedAt) / 100) / 10,
      lastStep: trace.lastStep, denied: trace.denied, result: trace.result,
      usage: agent.usage ? { ...agent.usage, calls: agent.usage.calls || calls } : null, tools,
    });
  };

  const finish = (chat: Stored, session: Session, status: ChatMessage['status'], error: string | undefined, response: string | undefined, endedBy: TurnSummary['endedBy']) => {
    const agent = session.agent;
    if (!agent) return;
    const parts = agent.parts ?? [];
    // Text the agent only gave as the final result (no streamed steps) still belongs in the answer.
    if (response?.trim() && !parts.some(p => p.type === 'text' && p.text.trim())) parts.push({ type: 'text', text: response });
    const calls = parts.filter(p => p.type === 'text').length;
    agent.parts = parts.filter(p => p.type !== 'text' || p.text.trim());
    for (const part of agent.parts) if (part.type === 'tool' && part.state === 'running') part.state = 'done';
    // A turn the agent ended without a word is not a finished answer: say so instead of leaving the message blank.
    const answerChars = agent.parts.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : 0), 0);
    const emptyAnswer = status === 'done' && answerChars === 0;
    if (emptyAnswer) {
      status = 'error';
      const denied = session.turn?.denied ?? [];
      error = denied.length ? `Agent zakończył bez odpowiedzi: narzędzie ${denied.join(', ')} zostało zablokowane, bo tryb bez interakcji nie może pytać o zgodę.` : 'Agent zakończył bez odpowiedzi.';
    }
    agent.status = status;
    if (error) agent.error = error;
    record(chat, session, agent, status, error, emptyAnswer, answerChars, calls, endedBy);
    session.agent = null;
    chat.updatedAt = now();
    save(chat);
    touch(chat, agent, true);
    if (status === 'done' && chat.items.length === 2 && !chat.items[0]?.automation && !chat.userNamed && !chat.titleAttempted && options.namer) {
      chat.titleAttempted = true;
      save(chat);
      const text = agent.parts.filter(p => p.type === 'text').map(p => p.text).join(' ');
      void Promise.resolve().then(() => options.namer!(chat.items[0].text ?? '', text)).then(title => {
        if (!title || chats.get(chat.id) !== chat || chat.userNamed) return;
        chat.title = title; save(chat); touch(chat, agent, true);
      }).catch(() => {});
    }
    if (sessions.get(chat.id) === session) armIdle(chat, session);
  };

  const onEvent = (chat: Stored, session: Session, event: unknown) => {
    const ev = asRecord(event);
    if (ev.event === 'init') {
      const id = asRecord(ev).conversation_id;
      if (typeof id === 'string' && id && chat.agy !== id) { chat.agy = id; save(chat); }
      return;
    }
    const agent = session.agent;
    if (!agent) return;
    if (ev.event === 'step_update') {
      const step = asRecord(ev.step_update);
      const parts = (agent.parts ??= []);
      const index = Number(step.step_index);
      if (session.turn && step.step_type !== 'user_input') session.turn.lastStep = `${step.step_type}${step.tool_name ? `:${step.tool_name}` : ''}:${step.state}`;
      if (step.step_type === 'agent_response') {
        let at = session.steps.get(index);
        if (at === undefined) { parts.push({ type: 'text', text: '' }); at = parts.length - 1; session.steps.set(index, at); }
        const part = parts[at] as Extract<ChatPart, { type: 'text' }>;
        if (typeof step.text_delta === 'string') part.text += step.text_delta;
      } else if (step.step_type === 'tool') {
        const info = asRecord(step.tool_info), id = String(index);
        let part = parts.find((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool' && p.id === id);
        if (!part) {
          part = { type: 'tool', id, name: String(step.tool_name ?? info.name ?? 'narzędzie'), input: JSON.stringify(info.parameters ?? {}).slice(0, 600), state: 'running' };
          parts.push(part);
        }
        if (step.state === 'ERROR') {
          // A tool that failed (e.g. denied for lack of permission) is over, and the user sees why.
          const raw = asRecord(info.error).message;
          const message = typeof raw === 'string' && raw ? raw.split('\n')[0] : 'Narzędzie zakończyło się błędem.';
          part.state = 'done';
          part.output = `Błąd: ${message}`.slice(0, 600);
          session.turn?.toolErrors.set(id, message.slice(0, 300));
        }
        if (step.state === 'DONE') {
          part.state = 'done';
          if (typeof info.output === 'string') { part.output = info.output.slice(0, 4000); session.turn?.outputChars.set(id, info.output.length); }
        }
      } else return;
      touch(chat, agent);
    } else if (ev.event === 'result') {
      const result = asRecord(ev.result);
      const usage = usageOf(result.usage, agent.parts ?? []);
      if (usage) agent.usage = usage;
      if (session.turn && Array.isArray(result.denied_actions)) session.turn.denied = result.denied_actions.map((d: unknown) => String(asRecord(d).action ?? '')).filter(Boolean);
      if (session.turn) session.turn.result = { status: typeof result.status === 'string' ? result.status : null, responseChars: typeof result.response === 'string' ? result.response.length : 0 };
      if (result.status === 'SUCCESS') finish(chat, session, 'done', undefined, typeof result.response === 'string' ? result.response : undefined, 'result');
      else finish(chat, session, 'error', typeof result.error === 'string' && result.error ? result.error : 'Agent nie dokończył odpowiedzi.', undefined, 'result');
    }
  };

  const open = (chat: Stored): Session => {
    const args = ['--output-format', 'stream-json', '--input-format', 'stream-json', ...(chat.agy ? ['--conversation', chat.agy] : []), '-p', ''];
    const proc = launch(args, agentDir);
    const command = proc.command ?? args;
    const modelAt = command.indexOf('--model');
    const session: Session = { proc, agent: null, steps: new Map(), stopping: false, model: modelAt >= 0 ? command[modelAt + 1] ?? null : null };
    sessions.set(chat.id, session);
    log.trace(chat.id, { turn: 0, src: 'panel', kind: 'spawn', command, resumed: !!chat.agy });
    proc.onLine(line => {
      const turn = session.turn?.number ?? 0;
      let event: unknown;
      try { event = JSON.parse(line); } catch { log.trace(chat.id, { turn, src: 'agy', kind: 'raw', line: line.slice(0, 500) }); return; }
      log.trace(chat.id, { turn, src: 'agy', kind: String(asRecord(event).event ?? 'event'), event });
      try { onEvent(chat, session, event); } catch { /* an event the service cannot use: ignore */ }
    });
    proc.onExit(reason => {
      clearTimeout(session.idle);
      if (sessions.get(chat.id) === session) sessions.delete(chat.id);
      log.trace(chat.id, { turn: session.turn?.number ?? 0, src: 'panel', kind: 'exit', reason, duringTurn: !!session.agent });
      if (session.agent) finish(chat, session, session.stopping ? 'stopped' : 'error', session.stopping ? undefined : reason ?? 'Agent zakończył pracę przed odpowiedzią.', undefined, session.stopping ? 'stop' : 'exit');
    });
    return session;
  };

  /** One turn for either the user or the panel (an automation): the same storage, with the marker when it is not the user. */
  const deliver = async (id: string, input: ChatSend | ChatAutomationInput, automation?: ChatAutomation) => {
    const chat = await need(id);
    if (sessions.get(id)?.agent) throw new ChatError(409, 'Agent jeszcze odpowiada.');
    const at = now();
    const context = input.context ?? [];
    const user: ChatMessage = { id: randomUUID(), role: 'user', at, text: input.text, ...(automation ? { automation } : {}), ...(context.length ? { context } : {}) };
    const agent: ChatMessage = { id: randomUUID(), role: 'agent', at, parts: [], status: 'streaming' };
    chat.items.push(user, agent);
    chat.updatedAt = at;
    await mkdir(agentDir, { recursive: true });
    const session = sessions.get(id) ?? open(chat);
    clearTimeout(session.idle);
    session.agent = agent;
    session.stopping = false;
    session.steps.clear();
    save(chat);
    touch(chat, user);
    touch(chat, agent, true);
    const prompt = withContext(automation ? automationPrompt(input.text, automation) : input.text, context);
    const content = chat.agy ? prompt : `${intro}\n\n${prompt}`;
    session.turn = { number: chat.items.filter(m => m.role === 'user').length, startedAt: at, ask: input.text.replace(/\s+/g, ' ').slice(0, 200), context: context.map(c => c.kind), lastStep: null, result: null, outputChars: new Map(), toolErrors: new Map(), denied: [] };
    log.trace(id, { turn: session.turn.number, src: 'panel', kind: 'sent', chars: content.length, preamble: !chat.agy, contextItems: context.length, ask: session.turn.ask, ...(automation ? { automation: automation.source } : {}) });
    session.proc.write(`${JSON.stringify({ event: 'user', message: { content } })}\n`);
  };

  const service: ChatService = {
    async list() { await load(); return [...chats.values()].map(summary).sort((a, b) => b.updatedAt - a.updatedAt); },
    async get(id) { return detail(await need(id)); },
    async create(input) {
      await load();
      const at = now();
      const chat: Stored = { id: randomUUID(), engine: 'agy', title: titleFrom(input.text), createdAt: at, updatedAt: at, agy: null, items: [] };
      chats.set(chat.id, chat);
      await service.send(chat.id, input);
      return { id: chat.id };
    },
    async send(id, input) {
      await deliver(id, input);
    },
    async sendAutomation(id, input) {
      await deliver(id, input, input.automation);
    },
    activeTurns() { return [...sessions.entries()].filter(([, session]) => !!session.agent).map(([id]) => id); },
    async stop(id) {
      await need(id);
      const session = sessions.get(id);
      if (!session?.agent) return;
      session.stopping = true;
      log.trace(id, { turn: session.turn?.number ?? 0, src: 'panel', kind: 'stop' });
      session.proc.kill();
    },
    async rename(id, title) {
      const chat = await need(id);
      chat.title = title;
      chat.userNamed = true;
      save(chat);
      const last = chat.items.at(-1);
      if (last) emit(id, { type: 'update', chat: summary(chat), message: last });
    },
    async remove(id) {
      const chat = await need(id);
      const session = sessions.get(id);
      if (session) { session.stopping = true; session.proc.kill(); }
      log.trace(id, { turn: session?.turn?.number ?? 0, src: 'panel', kind: 'chat-deleted' });
      chats.delete(chat.id);
      await writes.get(chat.id);
      await rm(file(chat.id), { force: true });
    },
    async drain() { while (writes.size) await Promise.all([...writes.values()]); await log.drain(); },
    async subscribe(id, listener) {
      const chat = await need(id);
      let set = listeners.get(id);
      if (!set) listeners.set(id, set = new Set());
      set.add(listener);
      listener({ type: 'state', chat: detail(chat) });
      return () => { set.delete(listener); if (!set.size) listeners.delete(id); };
    },
    close() {
      for (const pending of flushes.values()) clearTimeout(pending.timer);
      flushes.clear();
      for (const session of sessions.values()) { clearTimeout(session.idle); session.stopping = true; session.proc.kill(); }
    },
  };
  return service;
}
