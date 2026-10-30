import type { ChatNamer } from './chat-title';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PANEL_GUIDES } from '../src/chat-contract';
import { bankPlanSchema } from '../src/bank-plan-contract';
import { bankAssignSchema } from '../src/bank-assign-contract';
import { smartRulePlanOf } from '../src/smart-rules-contract';
import { stableAppointmentCardId } from './appointment-cards';
import { cardRefusal, COCKPIT_TOOLS } from '../src/cockpit-contract';
import { ChatError, type ChatService } from './agent-chat';
import { createChatLog, type ChatLog, type TurnTool } from './chat-log';
import { HermesError, UNFINISHED, type HermesClient, type HermesEvent, type HistoryMessage, type RunStatus } from './hermes-api';
import {
  automationPrompt, titleFrom, withContext,
  type ChatAutomation, type ChatAutomationInput, type ChatDetail, type ChatEvent, type ChatMessage, type ChatPart, type ChatSend, type ChatSummary, type ContextItem, type MessageStatus,
} from '../src/chat-contract';

/**
 * What Hermes is told once, at the start of a session. It reads the panel through the `desk-panel` MCP tools (narrow,
 * read-only adapters over `/api/agent/*`, plus the two writes the agy chat has), not through a shell and `curl`: no
 * command approval, no raw JSON, and nothing it can reach that the UI does not show.
 */
/** The cockpit contract for Hermes, line by line from the same table the MCP tools describe themselves with. */
export function cockpitRules(): string[] {
  return [
    'Obok czatu jest kokpit: pokazuje task Cezara, który obserwuje ta rozmowa (status, kroki, PR, checki CI). Kokpit niczego sam nie zgaduje: obserwuje task tylko po zleceniu z karty albo po Twoim panel_cezar_watch, a przestaje po panel_cockpit_clear. Narzędzia kokpitu i kiedy ich używać:',
    ...Object.entries(COCKPIT_TOOLS).map(([name, tool]) => `- ${name}: ${tool.purpose} Kiedy: ${tool.when} Skutek: ${tool.effect}`),
    'Poza tymi wywołaniami nie zmieniasz kokpitu i nie piszesz, że coś w nim ustawiłeś. Skill „Zaimplementuj zadanie” (zarówno faza analizy workflow: "analysis", jak i implementacji desk-panel-task): najpierw panel_cezar o wcześniejszą analizę, potem rekonesans, panel_recon_report sam (po wynikach wyszukiwań), krótki plan, panel_cezar_propose z recon z jego wyniku i koniec odpowiedzi; promptu nie powtarzasz tekstem i nie pytasz „Zlecić?” tekstem.',
  ];
}

/** The preamble's lines about the guides: that they exist and when to read one; the guides themselves come from `panel_guide`. */
export function guideRules(): string[] {
  return [
    'Przewodniki dziedzin: zasady rozmowy o danej dziedzinie czytasz narzędziem panel_guide (z tematem), a nie masz ich tutaj. Gdy rozmowa dochodzi do dziedziny z listy, wywołaj panel_guide z jej tematem, zanim użyjesz innych narzędzi tej dziedziny, i stosuj go do końca rozmowy; raz na rozmowę wystarczy.',
    ...Object.entries(PANEL_GUIDES).map(([topic, guide]) => `- ${topic}: ${guide.when}. Istota: ${guide.core}.`),
  ];
}

export function hermesPreamble(): string {
  return [
    'Jesteś agentem wbudowanym w Desk Panel: osobisty pulpit użytkownika z pocztą Gmail, kalendarzem Google, zadaniami Cezara, treningami Garmin, kontem bankowym, limitami AI i stanem komputera.',
    'Odpowiadasz po polsku, zwięźle i konkretnie.',
    'Użytkownik może wskazać elementy pulpitu. Dostajesz je w bloku [Kontekst] przed wiadomością: to podpowiedź, o co pyta, a nie wszystko, co możesz wiedzieć. Gdy pytanie wymaga danych, których tam nie ma, pobierz je sam i nie proś użytkownika o ich podanie.',
    'Dane panelu czytasz wyłącznie narzędziami serwera MCP `desk-panel` (nazwy kończą się na `panel_…`, w Hermesie z przedrostkiem serwera, np. mcp_desk-panel_panel_calendar): panel_calendar, panel_training, panel_cezar, panel_mail, panel_mail_search, panel_mail_read, panel_smart_rules, panel_smart_rule_test, panel_quotas, panel_system, panel_todos, panel_bank, panel_time. Zwracają krótki tekst po polsku z czasem lokalnym (Europe/Warsaw); nie przeliczaj czasów. Nie używaj do tego powłoki, curl ani przeglądarki: narzędzia panelu są szybsze i nie wymagają zgody. panel_cezar bez argumentów zwraca listę zadań; z argumentem {"id":"projekt/uuid"} zwraca szczegóły, kroki i błędy wskazanego zadania, a z {"id":…,"krok":"verify"} wycinek wyniku jednego kroku. Wyniki Cezara czytaj tak, nie z plików .ai/cezar/runs.',
    'Nagłówek widoku mówi, jaki jest dziś i z kiedy są dane; wiersz „brak danych” znaczy, że źródło milczy: powiedz to wprost. Pobieraj tylko źródła potrzebne do pytania, z zakresem dat dopasowanym do pytania, i nie pobieraj ponownie tego, co już jest w rozmowie.',
    'Słowo „zadanie” bez dopowiedzenia oznacza zadanie z list zadań użytkownika, nie zadanie Cezara. Zadania Cezara to tylko te, o których użytkownik mówi „Cezar” albo „task Cezara”, albo które wskazał na kafelku Cezara. Gdy w [Kontekst] jest „Zadanie Cezara” (lub użytkownik pyta o zadanie/błąd Cezara), zawsze najpierw wywołaj panel_cezar z id tego zadania, aby poznać status kroków, błąd i worktree.',
    'Wskazana w bloku [Kontekst] „Lista zadań” podaje id listy (l-…) i jej zadania z id (t-…), a „Zadanie z listy” id zadania i listy: używaj tych id wprost.',
    'Stan zadania i komentarze zmieniaj na prośbę użytkownika; przy propozycji Cezara z zadania podaj todoId — panel sam podepnie i ustawi W realizacji po kliknięciu karty.',
    'Topologia środowiska: repozytoria projektów użytkownika znajdują się w C:\\Users\\Viktor\\AndroidStudioProjects\\<projekt>. Artefakty zadań Cezara (logi, worktree) żyją wewnątrz danego projektu pod .ai/cezar/runs/<uuid>.* oraz .ai/cezar/worktrees/<uuid>. Nigdy nie przeszukuj całego profilu C:\\Users\\Viktor ani folderów chmury (OneDrive); operuj wyłącznie na konkretnym projekcie. Terminal startuje w ~/.desk-panel/agent, poza repozytoriami: podawaj ścieżki bezwzględne (git -C <repo>, workdir).',
    'Plikami i powłoką pracujesz z dowodów, nie z pamięci. Ścieżki, nazwy plików, hashe commitów i identyfikatory bierz tylko z wyników narzędzi tej rozmowy: gdy nie znasz ścieżki, najpierw ją wyszukaj (search_files), potem czytaj to, co wyszło. Wywołanie, które zależy od wyniku innego, wysyłaj dopiero po jego otrzymaniu; razem tylko wywołania od siebie niezależne. Zawężaj wyniki (git log -n 10 --oneline, wyszukiwanie w konkretnym katalogu, ogon logu), bo każdy znak wyniku zostaje w rozmowie.',
    'Przyczynę błędu podajesz tylko taką, jaką widać w wyniku narzędzia; gdy wynik jest ucięty albo go brak, napisz to i nie dopowiadaj szczegółów (nazwy testu, asercji, wartości). Gdy polecenie pada przez środowisko (brak programu albo zależności, np. „is not recognized”, brak node_modules), zgłoś to użytkownikowi jako problem środowiska i nie obchodź go.',
    'Kodu w repozytoriach (desk-panel, Cezar ani innych) nie zmieniasz sam, nawet na prośbę: dla desk-panel proponujesz task Cezara kartą (skill „Zaimplementuj zadanie”), dla innego projektu opisujesz zmianę i proponujesz, by użytkownik zlecił ją w Cezarze.',
    'Bezpośrednie zmiany są możliwe tylko dwoma narzędziami: panel_todo_action (listy zadań użytkownika; przy addTask zawsze "by":"agent") i panel_cezar_action (archive, unarchive, read, unread zakończonego zadania Cezara, na prośbę użytkownika). Usuwaj i archiwizuj tylko na wyraźną prośbę i napisz potem, co zmieniłeś. Pozostałe obsługiwane zmiany tylko proponujesz kartami z tabeli narzędzi: oznaczenia banku, reguły Smart Actions, zlecenie Cezara i utworzenie wydarzenia Google (panel_calendar_propose albo potwierdzenie wizyty z panel_znanylekarz). Wykonuje je panel po kliknięciu użytkownika. Nie zapisujesz kalendarza ani rezerwacji sam, nie wysyłasz maili i nie ustawiasz przypomnień. Nie proponuj operacji, których narzędzia nie dają.',
    'Jeśli narzędzia panelu nie są dostępne albo karta działa nieprawidłowo, powiedz co się nie udało i zaproponuj diagnostykę. Nie naprawiaj własnej infrastruktury, nie zmieniaj plików stanu ani konfiguracji i nie restartuj usług. Nigdy nie twierdź, że operacja się powiodła, bez potwierdzenia jej wynikiem; po błędzie lub niejednoznacznym wyniku opisz niepewność.',
    ...cockpitRules(),
    ...guideRules(),
    'Tura automatyki: gdy wiadomość zaczyna się od „[Automatyka · Cezar]” z powodem, to panel doniósł fakt, a nie użytkownik. Przejrzyj wynik i krótko go podsumuj, potem zaproponuj jeden następny krok. Niczego nie zlecaj, nie zapisuj ani nie zatwierdzaj sam: zlecenie Cezara i zmiany idą tylko kartą zgody po kliknięciu użytkownika.',
    'Notatek panel jeszcze nie ma: gdy użytkownik o nie prosi, powiedz to wprost i zaproponuj, co zapisać jako zadanie na liście.',
  ].join('\n');
}

/**
 * One Hermes conversation as the panel keeps it: only the mapping to the Hermes session and what the window needs
 * around it. The answers and tool steps live in the Hermes session (canonical) and are read back from it; the panel
 * keeps per turn what the user typed and pointed at (the chips), the run id, and how the turn ended.
 */
interface Turn {
  id: string;
  /** Id of the agent message of this turn in the window. */
  agent: string;
  at: number;
  text: string;
  /** Set only when the panel started this turn itself, never the user. */
  automation?: ChatAutomation;
  context?: ContextItem[];
  nonce?: string;
  run: string | null;
  status: MessageStatus;
  error?: string;
}
interface Stored { schema: 1; id: string; engine: 'hermes'; title: string; userNamed?: boolean; titleAttempted?: boolean; createdAt: number; updatedAt: number; session: string; turns: Turn[] }

interface Live {
  record: Stored;
  turn: Turn;
  message: ChatMessage;
  abort: AbortController;
  lastEventId: string | null;
  seen: Set<string>;
  lastEventAt: number;
  stopping: boolean;
  done: boolean;
  /** Hermes's own id of each approval part (null when it gave none: the run has one pending approval at a time). */
  approvals: Map<string, string | null>;
  watchdog?: ReturnType<typeof setInterval>;
  polling: boolean;
  deltas: number;
  endedBy: 'result' | 'exit' | 'stop';
}

interface History { at: number; groups?: { user: string; parts: ChatPart[] }[]; error?: string }

export interface HermesChatOptions {
  client: HermesClient;
  namer?: ChatNamer;
  /** Where the mapping lives (`<dir>/hermes-chats`); `~/.desk-panel` by default. */
  dir?: string;
  log?: ChatLog;
  now?: () => number;
  /** Silence on the event stream after which the run's status is read instead (missing deltas, a dead stream). */
  stallMs?: number;
  /** A turn that has not ended after this long is cancelled and reported. */
  turnTimeoutMs?: number;
  /**
   * Silence (no event, no running tool, no pending approval) after which the turn is cancelled: longer than one model
   * call may take (antigravity-oauth gives up after 300 s), so the call hung. Hermes retries a hung call twice more,
   * each hanging as long (28.10.2026), which used to spend the whole turn limit in silence.
   */
  silenceMs?: number;
  /** First wait before reconnecting to the event stream; doubles up to 10 s. */
  retryMs?: number;
  /** After a stop, how long to wait for Hermes to confirm before the panel ends the turn by itself. */
  cancelGraceMs?: number;
}

const ID = /^[0-9a-f-]{36}$/;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const CONTEXT_BLOCK = /^[\s\S]*?\[Wiadomość\]\n/;

/** Hermes keeps an MCP tool's answer as `{"result": "<text>"}`: the text is the answer. */
const unwrapResult = (content: string): string => {
  if (!content.startsWith('{"result"')) return content;
  try {
    const value = JSON.parse(content) as { result?: unknown };
    return typeof value.result === 'string' && Object.keys(value).length === 1 ? value.result : content;
  } catch { return content; }
};

/**
 * Hermes puts a tool's answer in an envelope (`<untrusted_tool_result source="…">`, a warning paragraph, the answer),
 * one per call: the answers by source, in order, without it. Text without an envelope is one answer, as it is.
 */
export function enveloped(content: string): { source?: string; text: string }[] {
  const blocks = [...content.matchAll(/<untrusted_tool_result source="([^"]*)">\n([\s\S]*?)\n<\/untrusted_tool_result>/g)];
  if (!blocks.length) return [{ text: content }];
  // The first paragraph is Hermes's warning to itself, not the tool's answer.
  return blocks.map(m => ({ source: m[1], text: m[2].replace(/^[^\n]*\n\n/, '') }));
}

/**
 * Hermes calls MCP tools through its `tool_call` tool (`{"calls":[{"name","arguments"}]}`): in the window each call is
 * the step it is, with its own name, arguments and answer, as the live stream shows it.
 */
function expandToolCalls(parts: ChatPart[]): ChatPart[] {
  return parts.flatMap(p => {
    if (p.type !== 'tool' || p.name !== 'tool_call') return [p];
    let calls: { name?: unknown; arguments?: unknown }[] = [];
    try { const parsed = JSON.parse(p.input) as { calls?: unknown }; if (Array.isArray(parsed.calls)) calls = parsed.calls as typeof calls; } catch { return [p]; }
    if (!calls.length || calls.some(c => typeof c.name !== 'string')) return [p];
    const answers = enveloped(p.output ?? '');
    return calls.map((c, i) => {
      const answer = answers.find(a => a.source === c.name && !(a as { used?: boolean }).used) ?? (calls.length === 1 ? answers[0] : undefined);
      if (answer) (answer as { used?: boolean }).used = true;
      return { ...p, id: calls.length === 1 ? p.id : `${p.id}:${i}`, name: String(c.name).slice(0, 120), input: JSON.stringify(c.arguments ?? {}), output: answer ? unwrapResult(answer.text).slice(0, 4000) : p.output };
    });
  });
}

/** A history of Hermes messages as the window's turns: each user message and what the agent did after it. */
export function groupsOf(messages: HistoryMessage[]): { user: string; parts: ChatPart[] }[] {
  const groups: { user: string; parts: ChatPart[] }[] = [];
  for (const m of messages) {
    if (m.role === 'user') { groups.push({ user: m.content.replace(CONTEXT_BLOCK, ''), parts: [] }); continue; }
    const group = groups.at(-1);
    if (!group) continue;
    if (m.role === 'assistant') {
      if (m.content.trim()) group.parts.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls ?? []) group.parts.push({ type: 'tool', id: call.id || `h${group.parts.length}`, name: call.name, input: call.arguments, state: 'done' });
    } else if (m.role === 'tool') {
      const tool = group.parts.find((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool' && p.id === m.toolCallId)
        ?? [...group.parts].reverse().find((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool' && p.output === undefined);
      // One answer: without its envelope; several (one `tool_call` of many calls): split by expandToolCalls below.
      const answers = enveloped(m.content);
      if (tool) tool.output = (answers.length === 1 ? unwrapResult(answers[0].text) : m.content).slice(0, answers.length === 1 ? 4000 : 64_000);
    }
  }
  for (const group of groups) group.parts = expandToolCalls(group.parts);
  return groups;
}

/**
 * Hermes streams a run's tools trimmed (`/v1/runs`: no arguments, answers cut at 500 characters); its session keeps
 * them whole. Fills a finished answer's tool steps from the session's group of that turn, matching them by name and
 * order (the stream gives no call ids). True when something changed.
 */
/**
 * A bank change card has no id of Hermes's to stand on (the stream gives only the tool's name, or a call id the history may
 * not repeat), and two cards of one answer cannot be told apart by order. Its identity is what it proposes: the message and
 * a hash of the plan (the names, the target, the tags flag; the title is only a label). The same answer read live, kept, or
 * from Hermes's history gives the same id, so the user's decision stays with the card, and two different plans never share one.
 */
export const isBankCard = (name: string) => name.includes('panel_bank_propose') || name.includes('panel_bank_assign') || name.includes('panel_smart_rule_propose');
export function stableBankCardId(messageId: string, input: string, name = 'panel_bank_propose'): string | null {
  if (name.includes('panel_smart_rule_propose')) {
    const plan = smartRulePlanOf(input);
    return plan && `${messageId}:s-${createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16)}`;
  }
  if (name.includes('panel_bank_assign')) {
    let assign;
    try { assign = bankAssignSchema.parse(JSON.parse(input)); } catch { return null; }
    return `${messageId}:b-${createHash('sha256').update(JSON.stringify({ assign: true, from: assign.from ?? null, to: assign.to ?? null })).digest('hex').slice(0, 16)}`;
  }
  let plan;
  try { plan = bankPlanSchema.parse(JSON.parse(input)); } catch { return null; }
  const key = JSON.stringify({ merge: plan.merge.map(n => n.toLowerCase()), into: plan.into.toLowerCase(), tags: plan.tags });
  return `${messageId}:b-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}
/** Gives consent cards stable ids from their arguments (and, for visits, the persisted reading's reference). */
export function stabilizeBankCards(message: ChatMessage): boolean {
  let changed = false;
  for (const p of message.parts ?? []) {
    if (p.type !== 'tool') continue;
    const id = isBankCard(p.name) ? stableBankCardId(message.id, p.input, p.name) : stableAppointmentCardId(message.id, p.name, p.input, p.output);
    if (id && p.id !== id) { p.id = id; changed = true; }
  }
  return changed;
}

export function fillFromHistory(message: ChatMessage, group: { parts: ChatPart[] } | undefined): boolean {
  if (!group) return false;
  const seen = new Map<string, number>();
  const whole = new Map<string, Extract<ChatPart, { type: 'tool' }>[]>();
  for (const p of group.parts) if (p.type === 'tool') whole.set(p.name, [...(whole.get(p.name) ?? []), p]);
  // A proposal the panel refused (sent before its recon, say) shows no „Zleć” and needs no id: of the rest, only one
  // card per side can be bound safely.
  const accepted = (parts: ChatPart[], name: string) =>
    parts.filter((s): s is Extract<ChatPart, { type: 'tool' }> => s.type === 'tool' && s.name === name && !cardRefusal('dispatch', s.output, s.error));
  let changed = false;
  for (const p of message.parts ?? []) {
    if (p.type !== 'tool') continue;
    const n = seen.get(p.name) ?? 0;
    seen.set(p.name, n + 1);
    let full = whole.get(p.name)?.[n];
    if (!full) continue;
    // Never bind a dispatch card to a name-only streaming id. Session history supplies the real call id.
    if (p.name.includes('panel_cezar_propose')) {
      const streamed = accepted(message.parts ?? [], p.name), recorded = accepted(group.parts, p.name);
      // The stream has no reliable call ids. Order alone cannot disambiguate multiple identical tools.
      if (streamed.length !== 1 || recorded.length !== 1 || streamed[0] !== p) continue;
      full = recorded[0];
      const stableId = `${message.id}:${full.id}`;
      if (p.id !== stableId) { p.id = stableId; changed = true; }
    }
    if (full.input && full.input.length > p.input.length) { p.input = full.input; changed = true; }
    if (full.output && full.output.length > (p.output?.length ?? 0)) { p.output = full.output; changed = true; }
  }
  return changed;
}

export function createHermesChat(options: HermesChatOptions): ChatService & { status(): Promise<{ available: boolean; error?: string }> } {
  const client = options.client;
  const dir = options.dir ?? path.join(homedir(), '.desk-panel');
  const now = options.now ?? Date.now;
  const log = options.log ?? createChatLog(dir, now);
  const stallMs = options.stallMs ?? 25_000;
  const turnTimeoutMs = options.turnTimeoutMs ?? 15 * 60_000;
  const silenceMs = options.silenceMs ?? 6 * 60_000;
  const retryMs = options.retryMs ?? 1000;
  const cancelGraceMs = options.cancelGraceMs ?? 10_000;
  const intro = hermesPreamble();
  const chatsDir = path.join(dir, 'hermes-chats');
  const records = new Map<string, Stored>();
  const lives = new Map<string, Live>();
  /** Answers of turns that ended while the panel ran: shown until the session's history is read (and if it cannot be). */
  const finished = new Map<string, ChatMessage>();
  const histories = new Map<string, History>();
  const listeners = new Map<string, Set<(event: ChatEvent) => void>>();
  const flushes = new Map<string, { timer: ReturnType<typeof setTimeout>; messages: Set<ChatMessage> }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  let loading: Promise<void> | undefined;
  let health: { at: number; value: { available: boolean; error?: string } } | undefined;

  const later = (ms: number, work: () => void) => { const t = setTimeout(() => { timers.delete(t); if (!closed) work(); }, ms); t.unref?.(); timers.add(t); return t; };
  const sleep = (ms: number) => new Promise<void>(resolve => later(ms, resolve));

  // ── storage ──
  const file = (id: string) => path.join(chatsDir, `${id}.json`);
  const writes = new Map<string, Promise<void>>();
  const save = (record: Stored) => {
    const turn = (writes.get(record.id) ?? Promise.resolve())
      .then(async () => {
        if (records.get(record.id) !== record || !record.turns.length) return;
        await mkdir(chatsDir, { recursive: true });
        const temp = `${file(record.id)}.tmp`;
        await writeFile(temp, JSON.stringify(record), 'utf8');
        await rename(temp, file(record.id));
      })
      .catch(() => { /* kept in memory; the next save tries again */ });
    writes.set(record.id, turn);
    void turn.then(() => { if (writes.get(record.id) === turn) writes.delete(record.id); });
  };
  const load = () => loading ??= (async () => {
    await mkdir(chatsDir, { recursive: true });
    for (const name of await readdir(chatsDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(await readFile(path.join(chatsDir, name), 'utf8')) as Stored;
        if (value.engine !== 'hermes' || typeof value.id !== 'string' || !ID.test(value.id) || !Array.isArray(value.turns) || typeof value.session !== 'string') continue;
        records.set(value.id, value);
      } catch { /* a damaged file is not a chat */ }
    }
    // A turn that was running when the panel stopped goes on in Hermes: follow it again (or say it never got there).
    for (const record of records.values()) {
      const turn = record.turns.at(-1);
      if (!turn || turn.status !== 'streaming') continue;
      if (!turn.run) { turn.status = 'error'; turn.error = 'Przerwano przed wysłaniem do Hermesa: panel został uruchomiony ponownie.'; save(record); continue; }
      const live = begin(record, turn);
      live.message.notice = 'Panel uruchomiono ponownie: wznawiam odczyt odpowiedzi z Hermesa…';
      log.trace(record.id, { turn: record.turns.length, src: 'panel', kind: 'resume', run: turn.run });
      void follow(live);
    }
  })();
  const need = async (id: string) => {
    await load();
    const record = ID.test(id) ? records.get(id) : undefined;
    if (!record) throw new ChatError(404);
    return record;
  };

  // ── what the window sees ──
  const summary = (record: Stored): ChatSummary => ({
    id: record.id, title: record.title, ...( record.userNamed ? { userNamed: true } : {} ), createdAt: record.createdAt, updatedAt: record.updatedAt,
    messages: record.turns.length * 2, running: lives.has(record.id), engine: 'hermes',
  });
  const items = (record: Stored): ChatMessage[] => {
    const history = histories.get(record.id);
    const groups = history?.groups ?? [];
    const out: ChatMessage[] = [];
    let g = 0;
    for (const turn of record.turns) {
      out.push({ id: turn.id, role: 'user', at: turn.at, text: turn.text, ...(turn.automation ? { automation: turn.automation } : {}), ...(turn.context?.length ? { context: turn.context } : {}) });
      const group = turn.run ? groups[g++] : undefined;
      const live = lives.get(record.id);
      if (live?.turn === turn) { out.push(live.message); continue; }
      // What this panel saw live (approvals and timings included, text checked against Hermes's final output) is
      // shown as it was; after a restart the session's history is the answer.
      const kept = finished.get(turn.agent);
      if (kept) { fillFromHistory(kept, group); stabilizeBankCards(kept); out.push(kept); }
      else if (group && group.parts.length) {
        const answered = group.parts.some(p => p.type === 'text');
        const status = answered && turn.status === 'error' ? 'done' : turn.status;
        const parts = group.parts.map(p => p.type === 'tool' && p.name.includes('panel_cezar_propose') ? { ...p, id: `${turn.agent}:${p.id}` } : { ...p });
        const restored: ChatMessage = { id: turn.agent, role: 'agent', at: turn.at, parts, status, ...(status === 'error' ? { error: turn.error } : {}) };
        stabilizeBankCards(restored);
        out.push(restored);
      } else {
        const missing = turn.run && turn.status !== 'error' && history?.error;
        out.push({
          id: turn.agent, role: 'agent', at: turn.at, parts: [],
          status: missing ? 'error' : turn.status,
          error: missing ? `Nie można teraz wczytać odpowiedzi z sesji Hermesa (${history!.error}). Zostaje w Hermesie i wróci, gdy będzie dostępny.` : turn.error,
        });
      }
    }
    // Turns of the same session written outside the panel (e.g. the Hermes CLI) are shown too: the session is the history.
    for (const group of groups.slice(g)) {
      out.push({ id: `${record.id}:h${g}:u`, role: 'user', at: record.updatedAt, text: group.user });
      out.push({ id: `${record.id}:h${g++}:a`, role: 'agent', at: record.updatedAt, parts: group.parts, status: 'done' });
    }
    return out;
  };
  const detail = (record: Stored): ChatDetail => ({ ...summary(record), items: items(record) });
  /** The session's history, read once per finished turn; a failed read is retried after 10 s. */
  const ensureHistory = async (record: Stored) => {
    // Also while a turn runs (e.g. one resumed after a restart): the earlier turns come from the history.
    if (!record.turns.some(t => t.run)) return;
    const known = histories.get(record.id);
    if (known && (known.groups || now() - known.at < 10_000)) return;
    try { histories.set(record.id, { at: now(), groups: groupsOf(await client.history(record.session)) }); }
    catch (error) { histories.set(record.id, { at: now(), error: error instanceof Error ? error.message : 'błąd' }); }
  };

  const emit = (id: string, event: ChatEvent) => { for (const listener of listeners.get(id) ?? []) listener(event); };
  const touch = (record: Stored, message: ChatMessage, immediate = false) => {
    let pending = flushes.get(record.id);
    if (!pending) { pending = { messages: new Set(), timer: setTimeout(() => flush(record), 40) }; flushes.set(record.id, pending); }
    pending.messages.add(message);
    if (immediate) flush(record);
  };
  const flush = (record: Stored) => {
    const pending = flushes.get(record.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    flushes.delete(record.id);
    for (const message of pending.messages) emit(record.id, { type: 'update', chat: summary(record), message: { ...message, parts: message.parts?.map(p => ({ ...p })) } });
  };
  const sendState = (record: Stored) => { for (const listener of listeners.get(record.id) ?? []) listener({ type: 'state', chat: detail(record) }); };

  // ── one run ──
  const begin = (record: Stored, turn: Turn): Live => {
    const live: Live = {
      record, turn, message: { id: turn.agent, role: 'agent', at: turn.at, parts: [], status: 'streaming' },
      abort: new AbortController(), lastEventId: null, seen: new Set(), lastEventAt: now(), stopping: false, done: false,
      approvals: new Map(), polling: false, deltas: 0, endedBy: 'result',
    };
    lives.set(record.id, live);
    return live;
  };
  const tools = (live: Live) => (live.message.parts ?? []).filter((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool');

  const apply = (live: Live, event: HermesEvent, id: string | null) => {
    if (live.done) return;
    // A stream resumed with Last-Event-ID (or replayed from the start) must not add a step twice.
    if (id) { if (live.seen.has(id)) return; live.seen.add(id); live.lastEventId = id; }
    live.lastEventAt = now();
    const parts = (live.message.parts ??= []);
    const record = live.record;
    log.trace(record.id, { turn: record.turns.length, src: 'hermes', kind: event.kind, id, ...(event.kind === 'delta' ? { chars: event.text.length } : { event }) });
    switch (event.kind) {
      case 'delta': {
        if (!event.text) return;
        live.deltas++;
        const last = parts.at(-1);
        if (last?.type === 'text') last.text += event.text; else parts.push({ type: 'text', text: event.text });
        if (live.message.notice) live.message.notice = undefined;
        break;
      }
      case 'tool-start': {
        // A tool with this id is already there: the same event again (a replayed stream).
        if (event.id !== event.name && tools(live).some(t => t.id === event.id)) return;
        const toolId = event.id === event.name || event.name.includes('panel_cezar_propose') ? `pending:${live.turn.agent}:${id ?? parts.length}` : event.id;
        parts.push({ type: 'tool', id: toolId, name: event.name, input: event.input, state: 'running', startedAt: now() });
        live.message.notice = undefined;
        break;
      }
      case 'tool-end': {
        const running = tools(live).filter(t => t.state === 'running');
        const tool = running.find(t => t.id === event.id) ?? [...running].reverse().find(t => t.name === event.name) ?? running.at(-1);
        if (!tool) return;
        tool.state = 'done';
        tool.endedAt = now();
        if (event.error) { tool.error = true; tool.output = `Błąd: ${event.output || event.error}`.slice(0, 600); }
        else if (event.output) tool.output = event.output.slice(0, 4000);
        stabilizeBankCards(live.message);
        break;
      }
      case 'progress':
        if (!event.text || live.message.notice === event.text) return;
        live.message.notice = event.text;
        break;
      case 'approval': {
        const local = event.id || `approval-${live.approvals.size + 1}`;
        if (live.approvals.has(local)) return;
        live.approvals.set(local, event.id || null);
        parts.push({ type: 'approval', id: local, tool: event.tool, detail: event.detail, state: 'pending', at: now() });
        live.message.notice = undefined;
        break;
      }
      case 'approval-resolved': {
        const pending = parts.filter((p): p is Extract<ChatPart, { type: 'approval' }> => p.type === 'approval' && p.state === 'pending');
        const part = pending.find(p => p.id === event.id || live.approvals.get(p.id) === event.id) ?? pending.at(-1);
        if (!part) return;
        part.state = event.approved === true ? 'approved' : event.approved === false ? 'denied' : 'expired';
        break;
      }
      case 'completed': void finalize(live, { state: 'completed', output: event.output, session: event.session }, 'result', event.usage); return;
      case 'failed': void finalize(live, { state: 'failed', error: event.error, output: event.output }, 'result'); return;
      case 'cancelled': void finalize(live, { state: 'cancelled' }, live.stopping ? 'stop' : 'result'); return;
      default: return;
    }
    touch(record, live.message);
  };

  /** Reads the run's status when the stream says nothing; ends the turn when Hermes says the run is over. */
  const reconcile = async (live: Live, reason: string): Promise<boolean> => {
    if (live.done || live.polling || !live.turn.run) return live.done;
    live.polling = true;
    try {
      const status = await client.status(live.turn.run);
      log.trace(live.record.id, { turn: live.record.turns.length, src: 'panel', kind: 'status', reason, state: status.state });
      if (status.state === 'completed' || status.state === 'failed' || status.state === 'cancelled') {
        await finalize(live, status, live.stopping ? 'stop' : 'result');
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof HermesError && error.status === 404) {
        // Hermes no longer knows the run (it was restarted): whatever it wrote is in the session.
        await finalize(live, { state: 'failed', error: 'Hermes nie zna już tego przebiegu (został uruchomiony ponownie?). Zapisana część odpowiedzi jest w historii sesji.' }, 'exit');
        return true;
      }
      return false;
    } finally { live.polling = false; }
  };

  const follow = async (live: Live) => {
    const run = live.turn.run!;
    const deadline = live.turn.at + turnTimeoutMs;
    live.watchdog = setInterval(() => {
      if (live.done) return;
      if (now() > deadline) { void timeout(live); return; }
      const silent = now() - live.lastEventAt;
      if (silent >= stallMs) {
        // A pending approval or a running tool already says what is going on (with its time).
        const busy = (live.message.parts ?? []).some(p => (p.type === 'approval' && p.state === 'pending') || (p.type === 'tool' && p.state === 'running'));
        if (!busy && silent >= silenceMs) { void timeout(live, `Model nie odpowiedział przez ${Math.round(silent / 60_000)} min (wywołanie zawisło), więc tura została przerwana. Wyślij wiadomość ponownie; jeśli to się powtarza, zacznij nową rozmowę.`); return; }
        const notice = silent >= 60_000
          ? `Model nie odpowiada od ${Math.floor(silent / 60_000)} min; po ${Math.round(silenceMs / 60_000)} min ciszy panel przerwie turę.`
          : 'Hermes milczy: sprawdzam stan przebiegu…';
        if (!busy && live.message.notice !== notice && (!live.message.notice || live.message.notice.startsWith('Hermes milczy') || live.message.notice.startsWith('Model nie odpowiada'))) {
          live.message.notice = notice;
          touch(live.record, live.message);
        }
        void reconcile(live, 'stall');
      }
    }, Math.max(50, Math.min(stallMs, 5000)));
    live.watchdog.unref?.();
    let wait = retryMs;
    while (!live.done && !closed) {
      let failure: string | null = null;
      try { await client.events(run, (event, id) => apply(live, event, id), { signal: live.abort.signal, lastEventId: live.lastEventId }); }
      catch (error) { failure = error instanceof Error ? error.message : 'błąd strumienia'; }
      if (live.done || closed) return;
      log.trace(live.record.id, { turn: live.record.turns.length, src: 'panel', kind: 'stream-ended', error: failure });
      // The stream ended without the end of the run (Hermes restarted, the connection dropped, or it gave no events):
      // the run's status decides.
      if (await reconcile(live, failure ? 'stream-error' : 'stream-ended')) return;
      if (live.done) return;
      // Without event ids the stream cannot resume where it was: it starts again from the run's beginning, so what was
      // shown is cleared instead of shown twice (a pending approval stays; its replay is recognised by id).
      if (!live.lastEventId) live.message.parts = (live.message.parts ?? []).filter(p => p.type === 'approval' && p.state === 'pending');
      live.message.notice = failure ? `Połączenie z Hermesem przerwane, łączę ponownie… (${failure})` : 'Łączę ponownie ze strumieniem Hermesa…';
      touch(live.record, live.message);
      if (now() > deadline) { await timeout(live); return; }
      await sleep(wait);
      wait = Math.min(wait * 2, 10_000);
    }
  };

  const timeout = async (live: Live, error = `Przekroczono limit czasu tury (${Math.round(turnTimeoutMs / 60_000)} min). Przebieg w Hermesie został przerwany.`) => {
    if (live.done) return;
    // Ended first, so the cancelled event the cancel brings does not turn a timeout into a stop.
    const run = live.turn.run;
    const ended = finalize(live, { state: 'failed', error }, 'exit');
    if (run) await client.cancel(run).catch(() => {});
    await ended;
  };

  const finalize = async (live: Live, status: RunStatus, endedBy: Live['endedBy'], usage?: Record<string, unknown>) => {
    if (live.done) return;
    live.done = true;
    live.endedBy = endedBy;
    clearInterval(live.watchdog);
    live.abort.abort();
    const { record, turn, message } = live;
    if (status.session && status.session !== record.session) record.session = status.session;
    let parts = message.parts ?? [];
    const streamed = parts.filter((p): p is Extract<ChatPart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('');
    let answer: MessageStatus = 'done', error: string | undefined;
    if (status.state === 'completed') {
      const output = status.output ?? '';
      // Hermes's final output is the answer: it fills a stream that gave no deltas and replaces one that did not add up.
      // It is only the last message, so text written between tools (the plan before a card) stays when the stream ends with it.
      if (output.trim() && !streamed.trim()) parts.push({ type: 'text', text: output });
      else if (output.trim() && !norm(streamed).endsWith(norm(output))) parts = [...parts.filter(p => p.type !== 'text'), { type: 'text', text: output }];
      if (!parts.some(p => p.type === 'text' && p.text.trim())) {
        // No output in the event either: the session has the answer, if anything does.
        try {
          const groups = groupsOf(await client.history(record.session));
          const group = groups[record.turns.filter(t => t.run).indexOf(turn)];
          if (group?.parts.some(p => p.type === 'text')) parts = group.parts;
        } catch { /* the error below says it */ }
      }
      if (!parts.some(p => p.type === 'text' && p.text.trim())) { answer = 'error'; error = 'Hermes zakończył bez odpowiedzi.'; }
    } else if (status.state === 'cancelled') answer = 'stopped';
    else {
      answer = 'error';
      // Ended early (Hermes's limit of model calls): what it found is still the answer, and the error says what happened.
      const output = status.output?.trim() ? status.output : '';
      if (output && !streamed.trim()) parts.push({ type: 'text', text: output });
      error = !output ? status.error || UNFINISHED
        : `Hermes przerwał turę przed końcem${status.error && status.error !== UNFINISHED ? ` (${status.error})` : ', zwykle po limicie wywołań modelu'}. Powyżej to, co zdążył napisać; napisz „dalej”, a dokończy.`;
    }
    for (const part of parts) {
      if (part.type === 'tool' && part.state === 'running') { part.state = 'done'; part.endedAt = now(); }
      if (part.type === 'approval' && part.state === 'pending') part.state = 'expired';
    }
    message.parts = parts.filter(p => p.type !== 'text' || p.text.trim());
    message.status = answer;
    message.notice = undefined;
    if (error) message.error = error; else delete message.error;
    if (usage) {
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
      message.usage = { input: n(usage.input_tokens ?? usage.prompt_tokens), output: n(usage.output_tokens ?? usage.completion_tokens), thinking: n(usage.reasoning_tokens), cached: n(usage.cache_read_tokens ?? usage.cached_tokens), calls: n(usage.api_calls), tools: tools(live).length };
    }
    turn.status = answer;
    if (error) turn.error = error; else delete turn.error;
    record.updatedAt = now();
    if (lives.get(record.id) === live) lives.delete(record.id);
    finished.set(turn.agent, message);
    histories.delete(record.id);
    save(record);
    touch(record, message, true);
    if (answer === 'done' && record.turns.length === 1 && !turn.automation && !record.userNamed && !record.titleAttempted && options.namer) {
      record.titleAttempted = true;
      save(record);
      const text = message.parts.filter(p => p.type === 'text').map(p => p.text).join(' ');
      void Promise.resolve().then(() => options.namer!(turn.text, text)).then(title => {
        if (!title || records.get(record.id) !== record || record.userNamed) return;
        record.title = title; save(record); sendState(record);
      }).catch(() => {});
    }
    // The steps as the session has them, whole (cards need a tool's arguments): the window gets the answer once more.
    void ensureHistory(record).then(() => {
      const groups = histories.get(record.id)?.groups;
      const index = record.turns.filter(t => t.run).indexOf(turn);
      if (groups && index >= 0) {
        const filled = fillFromHistory(message, groups[index]);
        const stabilized = stabilizeBankCards(message);
        if (filled || stabilized) touch(record, message, true);
      }
    }).catch(() => { /* the live answer stays */ });
    const answerChars = message.parts.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : 0), 0);
    const toolList: TurnTool[] = tools(live).slice(0, 30).map(t => ({ name: t.name, input: t.input.slice(0, 200), exitCode: null, outputChars: t.output?.length ?? null, error: t.error ? t.output ?? 'błąd' : null }));
    log.trace(record.id, { turn: record.turns.length, src: 'panel', kind: 'finish', status: answer, error: error ?? null, endedBy, deltas: live.deltas });
    log.turn({
      at: now(), chat: record.id, title: record.title, turn: record.turns.length, model: 'hermes', engine: 'hermes', ask: turn.text.replace(/\s+/g, ' ').slice(0, 200),
      context: (turn.context ?? []).map(c => c.kind), status: answer as 'done' | 'error' | 'stopped', error: error ?? null, endedBy,
      emptyAnswer: answer === 'error' && !answerChars && status.state === 'completed', answerChars, seconds: Math.round((now() - turn.at) / 100) / 10,
      lastStep: null, denied: [], result: { status: status.state, responseChars: status.output?.length ?? 0 },
      usage: message.usage ?? null, tools: toolList,
    });
  };

  const unavailable = (error: unknown) => {
    const reason = error instanceof Error ? error.message : 'Hermes nie odpowiada.';
    health = { at: now(), value: { available: false, error: reason } };
    return new ChatError(error instanceof HermesError && !error.unreachable && error.status !== 401 && error.status !== 403 ? 502 : 503,
      `Nie udało się: Hermes jest niedostępny (${reason}). Wiadomość nie została wysłana; możesz spróbować ponownie albo wybrać AGY.`);
  };

  /** One turn for either the user or the panel (an automation): the same session and storage, with the marker kept. */
  const deliver = async (id: string, input: ChatSend | ChatAutomationInput, automation?: ChatAutomation) => {
    const record = await need(id);
    const nonce = 'nonce' in input ? input.nonce : undefined;
    if (nonce && record.turns.some(t => t.nonce === nonce)) return;
    if (lives.has(id)) throw new ChatError(409, 'Agent jeszcze odpowiada.');
    const at = now();
    const context = input.context ?? [];
    const turn: Turn = { id: randomUUID(), agent: randomUUID(), at, text: input.text, ...(automation ? { automation } : {}), ...(context.length ? { context } : {}), ...(nonce ? { nonce } : {}), run: null, status: 'streaming' };
    const live = begin(record, turn); // holds the chat: a second message waits for this one (409)
    const first = !record.turns.some(t => t.run);
    const prompt = withContext(automation ? automationPrompt(input.text, automation) : input.text, context);
    let started: { run: string; session?: string };
    try { started = await client.startRun({ input: first ? `${intro}\n\n${prompt}` : prompt, session: record.session }); }
    catch (error) {
      lives.delete(id);
      log.trace(id, { turn: record.turns.length + 1, src: 'panel', kind: 'start-failed', error: error instanceof Error ? error.message : null });
      throw unavailable(error);
    }
    health = { at: now(), value: { available: true } };
    turn.run = started.run;
    if (started.session && started.session !== record.session) record.session = started.session;
    record.turns.push(turn);
    record.updatedAt = at;
    save(record);
    log.trace(id, { turn: record.turns.length, src: 'panel', kind: 'sent', run: started.run, preamble: first, contextItems: context.length, chars: prompt.length, ...(automation ? { automation: automation.source } : {}) });
    sendState(record);
    if (live.stopping) void client.cancel(started.run).catch(() => {});
    void follow(live);
  };

  const service: ChatService & { status(): Promise<{ available: boolean; error?: string }> } = {
    async status() {
      if (health && now() - health.at < 5000) return health.value;
      try { await client.health(); health = { at: now(), value: { available: true } }; }
      catch (error) { health = { at: now(), value: { available: false, error: error instanceof Error ? error.message : 'Hermes nie odpowiada.' } }; }
      return health.value;
    },
    async list() { await load(); return [...records.values()].filter(r => r.turns.length).map(summary).sort((a, b) => b.updatedAt - a.updatedAt); },
    async get(id) { const record = await need(id); await ensureHistory(record); return detail(record); },
    async create(input) {
      await load();
      const at = now();
      const id = randomUUID();
      // The session is named after the chat, so a run that reached Hermes before the panel saved the mapping is still found.
      const record: Stored = { schema: 1, id, engine: 'hermes', title: titleFrom(input.text), createdAt: at, updatedAt: at, session: `desk-panel-${id}`, turns: [] };
      records.set(id, record);
      try { await service.send(id, input); }
      catch (error) { records.delete(id); throw error; }
      return { id };
    },
    async send(id, input) { await deliver(id, input); },
    async sendAutomation(id, input) { await deliver(id, input, input.automation); },
    async stop(id) {
      await need(id);
      const live = lives.get(id);
      if (!live || live.stopping) return;
      live.stopping = true;
      live.message.notice = 'Zatrzymuję…';
      touch(live.record, live.message, true);
      log.trace(id, { turn: live.record.turns.length, src: 'panel', kind: 'stop' });
      if (live.turn.run) await client.cancel(live.turn.run).catch(() => {});
      // Hermes confirms with a cancelled event or status; without it the panel ends the turn itself.
      later(cancelGraceMs, () => { void reconcile(live, 'stop').then(over => { if (!over) void finalize(live, { state: 'cancelled' }, 'stop'); }); });
    },
    async approve(id, { approvalId, decision }) {
      await need(id);
      const live = lives.get(id);
      const part = live?.message.parts?.find((p): p is Extract<ChatPart, { type: 'approval' }> => p.type === 'approval' && p.id === approvalId);
      if (!live || !part || !live.turn.run) throw new ChatError(409, 'Ta prośba o zgodę nie jest już aktualna.');
      if (part.state !== 'pending') throw new ChatError(409, 'Ta prośba o zgodę jest już rozstrzygnięta.');
      try { await client.approve(live.turn.run, live.approvals.get(approvalId) ?? approvalId, decision === 'approve'); }
      catch (error) {
        if (error instanceof HermesError && (error.status === 404 || error.status === 409)) { part.state = 'expired'; touch(live.record, live.message, true); throw new ChatError(409, 'Hermes nie czeka już na tę zgodę.'); }
        throw unavailable(error);
      }
      part.state = decision === 'approve' ? 'approved' : 'denied';
      live.lastEventAt = now();
      live.message.notice = decision === 'approve' ? 'Zgoda wysłana: Hermes uruchamia narzędzie (to bywa wolne, nawet ponad minutę)…' : 'Odmowa wysłana: Hermes kontynuuje bez tego narzędzia…';
      log.trace(id, { turn: live.record.turns.length, src: 'panel', kind: 'approval', decision });
      touch(live.record, live.message, true);
    },
    async rename(id, title) {
      const record = await need(id);
      record.title = title;
      record.userNamed = true;
      save(record);
      sendState(record);
    },
    async remove(id) {
      const record = await need(id);
      const live = lives.get(id);
      if (live) {
        live.done = true;
        clearInterval(live.watchdog);
        live.abort.abort();
        lives.delete(id);
        if (live.turn.run) void client.cancel(live.turn.run).catch(() => {});
      }
      log.trace(id, { turn: record.turns.length, src: 'panel', kind: 'chat-deleted' });
      records.delete(id);
      histories.delete(id);
      for (const turn of record.turns) finished.delete(turn.agent);
      await writes.get(id);
      await rm(file(id), { force: true });
    },
    async subscribe(id, listener) {
      const record = await need(id);
      await ensureHistory(record);
      let set = listeners.get(id);
      if (!set) listeners.set(id, set = new Set());
      set.add(listener);
      listener({ type: 'state', chat: detail(record) });
      return () => { set.delete(listener); if (!set.size) listeners.delete(id); };
    },
    async drain() { while (writes.size) await Promise.all([...writes.values()]); await log.drain(); },
    close() {
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const pending of flushes.values()) clearTimeout(pending.timer);
      flushes.clear();
      // Runs go on in Hermes; the next start of the panel follows them again (the mapping says they were streaming).
      for (const live of lives.values()) { clearInterval(live.watchdog); live.abort.abort(); }
    },
  };
  return service;
}
