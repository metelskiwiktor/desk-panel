import { appendFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Diagnostics of the chat, kept apart from the chats themselves so that reading a chat (the UI, an agent) never drags
 * them in. Two kinds of files in `<dir>/chat-logs`: `turns.jsonl`, one short summary line per finished turn (read this
 * first), and `<chat id>.jsonl`, the raw trace of one conversation (open it for a turn picked from the summary).
 * Nothing here may break the chat: every failure is swallowed.
 */
export interface TurnTool {
  name: string;
  /** What it was asked to run, shortened. */
  input: string;
  /** Exit code of a shell command as the agent printed it, null when there was none. */
  exitCode: number | null;
  /** Output size in characters; null when the tool gave no output at all. */
  outputChars: number | null;
  /** Why the tool failed, as agy reported it (shortened); null when it did not. */
  error: string | null;
}

export interface TurnSummary {
  at: number;
  chat: string;
  title: string;
  /** 1-based number of the user message in the conversation. */
  turn: number;
  model: string | null;
  /** Which engine ran the turn; missing on agy turns written before Hermes. */
  engine?: 'hermes' | 'agy';
  /** The user's message, shortened, and the kinds of the dashboard elements they pointed at. */
  ask: string;
  context: string[];
  status: 'done' | 'error' | 'stopped';
  error: string | null;
  /** What ended the turn: the agent's `result` event, the process exiting, the user stopping it, or a panel restart. */
  endedBy: 'result' | 'exit' | 'stop';
  /** The agent finished without a word to the user. */
  emptyAnswer: boolean;
  answerChars: number;
  seconds: number;
  /** The last streamed step, e.g. `tool:read_file:DONE`: where the agent was when it stopped. */
  lastStep: string | null;
  /** Tools agy refused to run because headless mode cannot ask for permission (`denied_actions` of its result). */
  denied: string[];
  /** The `result` event as agy sent it: its status and how long its `response` was. */
  result: { status: string | null; responseChars: number } | null;
  usage: { input: number; output: number; thinking: number; cached: number; calls: number; tools: number } | null;
  tools: TurnTool[];
}

export interface ChatLog {
  /** One line in the conversation's trace: a raw agy event or something the panel did. */
  trace(chat: string, entry: Record<string, unknown>): void;
  turn(summary: TurnSummary): void;
  /** Resolves once everything queued is on disk. */
  drain(): Promise<void>;
}

const LINE_LIMIT = 16_000;
const FILE_LIMIT = 4_000_000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const ID = /^[0-9a-f-]{36}$/;

export const LOG_README = `# Dziennik diagnostyczny czatu Desk Panel

Zapisuje go serwis czatu (\`server/chat-log.ts\`), osobno od rozmów w \`../chats\`, żeby czytanie rozmów nie ciągnęło diagnostyki.
Prywatne (zawiera treści poczty, kalendarza i poleceń agenta), poza Gitem. Pliki starsze niż 30 dni są usuwane przy starcie usługi.
Usunięcie rozmowy w panelu nie usuwa jej śladu tutaj.

## Jak analizować

1. Zacznij od \`turns.jsonl\`: jedna linia JSON na zakończoną turę (jedno pytanie użytkownika i odpowiedź agenta). Jest krótki i wystarcza do
   pytań typu: ile tur kończy się błędem lub bez odpowiedzi, które narzędzia zawodzą, ile kosztują tury, z czym użytkownik przychodzi.
2. Gdy jedna tura jest podejrzana, otwórz \`<id rozmowy>.jsonl\` (pole \`chat\` w turze) i czytaj tylko linie z jej numerem \`turn\`.
   Linie bywają długie (wyniki narzędzi): nie wypisuj całych plików, filtruj (\`jq\`, \`Select-String\`) i przycinaj.

## turns.jsonl (pola)

| Pole | Znaczenie |
| --- | --- |
| \`at\`, \`chat\`, \`title\`, \`turn\` | kiedy (ms epoki), której rozmowy, który raz użytkownik napisał (od 1) |
| \`model\` | wartość \`--model\`, z którą działał \`agy\` (\`hermes\` w turach Hermesa) |
| \`engine\` | \`hermes\` albo \`agy\` (brak w starszych liniach agy); tury Hermesa mają w \`result.status\` stan przebiegu (\`completed\`, \`failed\`, \`cancelled\`), a w śladzie rozmowy zdarzenia z \`src: "hermes"\` |
| \`ask\`, \`context\` | pytanie użytkownika (do 200 znaków) i rodzaje wskazanych elementów pulpitu |
| \`status\` | \`done\`, \`error\` albo \`stopped\` |
| \`error\` | komunikat pokazany użytkownikowi, gdy \`status\` to \`error\` |
| \`endedBy\` | \`result\` (agy dał wynik), \`exit\` (proces się skończył) albo \`stop\` (użytkownik zatrzymał) |
| \`emptyAnswer\` | agent skończył bez żadnego tekstu dla użytkownika (wtedy \`status\` to \`error\`) |
| \`answerChars\`, \`seconds\` | długość odpowiedzi i czas tury |
| \`lastStep\` | ostatni krok ze strumienia, np. \`tool:read_file:DONE\`: gdzie agent skończył |
| \`denied\` | narzędzia, których \`agy\` nie uruchomił, bo tryb bez interakcji nie może zapytać o zgodę (\`denied_actions\`); to częsta przyczyna pustej odpowiedzi |
| \`result\` | \`status\` i długość \`response\` z wyniku agy (null, gdy wyniku nie było) |
| \`usage\` | tokeny: \`input\` świeże, \`cached\` z cache'u, \`output\` (w tym \`thinking\`), \`calls\` wywołań modelu, \`tools\` poleceń |
| \`tools\` | każde narzędzie: \`name\`, \`input\` (przycięte), \`exitCode\` powłoki, \`outputChars\` (null: brak wyniku), \`error\` (powód porażki narzędzia lub null) |

## <id rozmowy>.jsonl (linie)

Każda linia: \`t\` (ms epoki), \`turn\`, \`src\` i \`kind\`.

- \`src: "agy"\`: surowe zdarzenie z \`agy\` w polu \`event\` (\`init\`, \`step_update\`, \`result\`); linia dłuższa niż ${LINE_LIMIT} znaków jest skrócona
  (\`truncated: true\`, \`bytes\`, \`head\`); wiersz, który nie jest JSON-em, ma \`kind: "raw"\`.
- \`src: "panel"\`: co zrobił serwis: \`spawn\` (argumenty i czy wznowiono rozmowę), \`sent\` (rozmiar wysłanego promptu, czy z instrukcją, wskazane elementy),
  \`stop\`, \`idle\` (zamknięcie po bezczynności), \`exit\` (proces się skończył i dlaczego), \`finish\` (jak turę zapisano).
- Plik jest ograniczony do ${FILE_LIMIT / 1_000_000} MB; po przekroczeniu dopisywane jest tylko \`truncated-log\`.
`;

export function createChatLog(dir: string, now: () => number = Date.now): ChatLog {
  const logDir = path.join(dir, 'chat-logs');
  const queues = new Map<string, Promise<void>>();
  const sizes = new Map<string, number>();
  const full = new Set<string>();
  const enqueue = (file: string, work: () => Promise<void>) => {
    const next = (queues.get(file) ?? Promise.resolve()).then(work).catch(() => { /* diagnostics never break the chat */ });
    queues.set(file, next);
    void next.then(() => { if (queues.get(file) === next) queues.delete(file); });
  };

  const append = (name: string, text: string, capped: boolean) => {
    const file = path.join(logDir, name);
    enqueue(file, async () => {
      await mkdir(logDir, { recursive: true });
      let size = sizes.get(file);
      if (size === undefined) size = (await stat(file).catch(() => ({ size: 0 }))).size;
      if (capped && size > FILE_LIMIT) {
        // One closing line says the trace stopped here; after it nothing more is written.
        if (full.has(file)) return;
        full.add(file);
        text = `${JSON.stringify({ t: now(), src: 'panel', kind: 'truncated-log' })}\n`;
      }
      await appendFile(file, text, 'utf8');
      sizes.set(file, size + Buffer.byteLength(text));
    });
  };

  // The explanation and the cleanup of old traces run once, when the log is created.
  enqueue(path.join(logDir, 'README.md'), async () => {
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, 'README.md'), LOG_README, 'utf8');
    for (const name of await readdir(logDir)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(logDir, name);
      if (name !== 'turns.jsonl' && !ID.test(name.slice(0, -'.jsonl'.length))) continue;
      const age = now() - (await stat(file)).mtimeMs;
      if (age > KEEP_MS && name !== 'turns.jsonl') await rm(file, { force: true });
    }
  });

  return {
    trace(chat, entry) {
      if (!ID.test(chat)) return;
      let line = JSON.stringify({ t: now(), ...entry });
      if (line.length > LINE_LIMIT) {
        const event = entry.event as { event?: unknown } | undefined;
        line = JSON.stringify({ t: now(), ...entry, event: { event: event?.event, truncated: true, bytes: line.length, head: line.slice(0, 2000) } });
      }
      append(`${chat}.jsonl`, `${line}\n`, true);
    },
    turn(summary) { append('turns.jsonl', `${JSON.stringify(summary)}\n`, false); },
    async drain() { while (queues.size) await Promise.all([...queues.values()]); },
  };
}
