import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SourceError, type PanelSources } from './sources';
import type { TrainingStep } from '../src/training-contract';

/**
 * The panel's data as short plain text for the chat agent: local time instead of epoch milliseconds, only the fields a
 * question needs, and a date range where one makes sense. The agent pays for every character it reads, so this is the
 * view it is told to use (`/api/agent/<name>`); the JSON routes stay for the UI.
 */
export const DEFAULT_ZONE = 'Europe/Warsaw';
const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 42;
/** Finished Cezar tasks listed, each with its id for the archive and read actions; the rest is only counted. */
const FINISHED_SHOWN = 40;
/** The bank view reaches further back than the calendar: marks keep their operations after the bank's reading drops them. */
const BANK_MAX_DAYS = 400;
const BANK_SHOWN = 150;

export class AgentViewError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string }
const formatters = new Map<string, Intl.DateTimeFormat>();
function partsOf(at: number, zone: string): Parts {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('pl-PL', { timeZone: zone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(zone, format);
  }
  const p = Object.fromEntries(format.formatToParts(at).map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: p.weekday.replace('.', '') };
}
const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (at: number, zone: string) => { const p = partsOf(at, zone); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; };
const timeOf = (at: number, zone: string) => { const p = partsOf(at, zone); return `${pad(p.hour)}:${pad(p.minute)}`; };
const stamp = (at: number, zone: string) => `${dateOf(at, zone)} ${timeOf(at, zone)}`;
const dayName = (at: number, zone: string) => partsOf(at, zone).weekday;
const todayLabel = (now: number, zone: string) => `${dayName(now, zone)} ${dateOf(now, zone)}`;

/** Milliseconds since the epoch of 00:00 on a `YYYY-MM-DD` day in the zone. */
function midnight(date: string, zone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offset = (at: number) => { const p = partsOf(at, zone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000; };
  return guess - offset(guess - offset(guess));
}
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

interface Range { from: string; to: string; start: number; end: number }
/** `from`/`to` are inclusive days in the zone; by default today and the next six days, at most 42 days. */
function rangeOf(url: URL, now: number, zone: string): Range {
  const today = dateOf(now, zone);
  const from = url.searchParams.get('from') ?? today;
  if (!validDate(from)) throw new AgentViewError(400, 'from i to to daty RRRR-MM-DD.');
  const to = url.searchParams.get('to') ?? addDays(from, 6);
  if (!validDate(to)) throw new AgentViewError(400, 'from i to to daty RRRR-MM-DD.');
  if (to < from) throw new AgentViewError(400, 'to nie może być przed from.');
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) >= MAX_DAYS * DAY) throw new AgentViewError(400, `Zakres to najwyżej ${MAX_DAYS} dni.`);
  return { from, to, start: midnight(from, zone), end: midnight(addDays(to, 1), zone) };
}

const clip = (text: string, max: number) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };
const minutes = (seconds: number) => { const m = Math.round(seconds / 60); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; };

/** A Cezar run's own file next to its worktree: `<repo>/.ai/cezar/worktrees/<id>` → `<repo>/.ai/cezar/runs/<id><suffix>`. */
function runFile(worktreePath: unknown, suffix: string): string | null {
  if (typeof worktreePath !== 'string') return null;
  const file = worktreePath.replace(/[\\/]worktrees[\\/]([^\\/]+)[\\/]?$/, (_, id) => `${path.sep}runs${path.sep}${id}${suffix}`);
  return file === worktreePath ? null : file;
}
/** An agent step's report, whole: an analysis runs to ~19k characters, while the run's `summary` keeps only its last 4000. */
const AGENT_TEXT_MAX = 24_000;
/**
 * The last text an agent step wrote, from the run's log (one `{"type":"text","stepId":…}` event per step). Without it
 * the chat agent pieced an analysis together with five `node -e` reads of the log (28.10.2026). Null when unreadable.
 */
async function agentStepText(log: string | null, step: string): Promise<string | null> {
  if (!log) return null;
  let raw: string;
  try { raw = await readFile(log, 'utf8'); } catch { return null; }
  let text: string | null = null;
  for (const line of raw.split('\n')) {
    if (!line.includes('"type":"text"') || !line.includes(`"stepId":"${step}"`)) continue;
    try { const event = JSON.parse(line); if (event.type === 'text' && event.stepId === step && typeof event.text === 'string' && event.text.trim()) text = event.text.trim(); } catch { /* a cut line */ }
  }
  return text;
}

/** Cezar keeps only the head of a check's output (`CHECK_OUTPUT_CAP`); a test runner prints its failures at the end. */
const CHECK_TRUNCATED = '… (output truncated)';
const FAILURE_LINE = /^\s*(?:❯|×|FAIL\b)|AssertionError|\bError:|error TS\d|^\s*(?:Expected|Received)\b|^\s*[-+] |^\s*(?:Test Files|Tests)\s+\d|exited non-zero/;
/**
 * The lines of a Cezar check (`npm test`, typecheck, build) that say what failed, without stack frames and passing
 * tests, and a warning when Cezar cut the output: the agent must not fill in failures it cannot see (it once did).
 */
function checkExcerpt(output: string, maxLines: number): string[] {
  const text = output.replace(/\u001b\[[0-9;]*m/g, '');
  const lines = text.split('\n').filter(l => l.trim() && l.trim() !== CHECK_TRUNCATED);
  const failing = lines.filter(l => FAILURE_LINE.test(l) && !/^\s+at /.test(l));
  const shown = (failing.length ? failing : lines.slice(-maxLines)).slice(0, maxLines).map(l => `  ${clip(l, 160)}`);
  if (!text.includes(CHECK_TRUNCATED)) return shown;
  return [...shown, '  Uwaga: Cezar zapisał tylko początek wyjścia; szczegóły błędów (asercje, diff) mogły się nie zmieścić. Nie dopowiadaj ich: powiedz, że ich nie widać, albo uruchom ten jeden plik testu w worktree.'];
}

/** One line saying why there is no data, or null when the source answered. */
function unavailable(name: string, status: string, hasData: boolean, message?: string): string | null {
  if (status === 'connected' && hasData) return null;
  return `${name}: brak danych (status: ${status}${message ? `, ${clip(message, 120)}` : ''}).`;
}

function stepText(step: TrainingStep): string {
  const target = step.target && (step.target.low !== null || step.target.high !== null)
    ? ` ${step.target.low ?? '?'}–${step.target.high ?? '?'} ${({ power: 'W', heartRate: 'bpm', cadence: 'rpm', speed: 'm/s', other: '' } as const)[step.target.type]}`.trimEnd() : '';
  const names: Record<string, string> = { warmup: 'rozgrzewka', interval: 'interwał', recovery: 'przerwa', cooldown: 'schłodzenie', rest: 'odpoczynek', repeat: 'powtórz', other: 'krok' };
  const duration = step.durationSec ? ` ${minutes(step.durationSec)}` : '';
  if (step.kind === 'repeat') return `${step.iterations ?? '?'}× (${(step.children ?? []).map(stepText).join('; ')})`;
  return `${names[step.kind]}${duration}${target}`;
}

export type AgentView = (url: URL, now: number) => Promise<string>;

export function agentViews(sources: PanelSources): Record<string, AgentView> {
  return {
    async calendar(url, now) {
      const source = await sources.calendar();
      const zone = source.timeZone ?? DEFAULT_ZONE;
      const range = rangeOf(url, now, zone);
      const header = `Kalendarz Google, ${range.from} – ${range.to} (${zone}). Dziś: ${todayLabel(now, zone)}. Stan z ${source.observedAt ? stamp(source.observedAt, zone) : 'nieznany'}.`;
      const none = unavailable('Kalendarz', source.status, !!source.data, source.message);
      if (none) return `${header}\n${none}`;
      const withDescription = url.searchParams.get('opisy') === '1';
      const lines = source.data!.filter(e => e.endAt > range.start && e.startAt < range.end).sort((a, b) => a.startAt - b.startAt).map(e => {
        let when: string;
        if (e.allDay) {
          const last = e.endDate ? addDays(e.endDate, -1) : dateOf(e.endAt - 1, zone);
          const first = e.startDate ?? dateOf(e.startAt, zone);
          when = `${dayName(e.startAt, zone)} ${first}${last > first ? ` – ${last}` : ''} cały dzień`;
        } else {
          const sameDay = dateOf(e.startAt, zone) === dateOf(e.endAt, zone);
          when = `${dayName(e.startAt, zone)} ${dateOf(e.startAt, zone)} ${timeOf(e.startAt, zone)}–${sameDay ? timeOf(e.endAt, zone) : stamp(e.endAt, zone)}`;
        }
        return `${when}  ${e.title}${e.location ? ` [${clip(e.location, 80)}]` : ''}${withDescription && e.description ? ` — ${clip(e.description, 300)}` : ''}`;
      });
      return [header, ...(lines.length ? lines : ['Brak wydarzeń w tym zakresie.']), ...(source.partial ? ['Uwaga: agenda może być niepełna.'] : [])].join('\n');
    },

    async training(url, now) {
      const source = await sources.training();
      const zone = source.timeZone ?? DEFAULT_ZONE;
      const range = rangeOf(url, now, zone);
      const header = `Garmin Connect, ${range.from} – ${range.to} (${zone}). Dziś: ${todayLabel(now, zone)}. Stan z ${source.observedAt ? stamp(source.observedAt, zone) : 'nieznany'}.`;
      const none = unavailable('Garmin', source.status, !!source.data, source.message);
      if (none) return `${header}\n${none}`;
      const { plan, workouts, activities } = source.data!;
      const withSteps = url.searchParams.get('kroki') === '1';
      const out = [header, plan ? `Plan: ${plan.name ?? 'bez nazwy'}${plan.workoutsPerWeek ? `, ${plan.workoutsPerWeek} treningów tygodniowo` : ''}${plan.targetDate ? `, do ${plan.targetDate}` : ''}.` : 'Brak aktywnego planu.'];
      const planned = workouts.filter(w => w.date >= range.from && w.date <= range.to).sort((a, b) => a.date.localeCompare(b.date));
      out.push('Zaplanowane:');
      out.push(...(planned.length ? planned.map(w => {
        const flags = [w.restDay && 'dzień odpoczynku', w.race && 'zawody', w.keyWorkout && 'kluczowy'].filter(Boolean).join(', ');
        const steps = withSteps && w.steps?.length ? `\n    kroki: ${w.steps.map(stepText).join('; ')}` : '';
        return `${dayName(midnight(w.date, zone), zone)} ${w.date}  ${w.name} (${w.sport}${w.durationSec ? `, ${minutes(w.durationSec)}` : ''}${w.trainingEffectLabel ? `, efekt: ${w.trainingEffectLabel}` : ''}${flags ? `; ${flags}` : ''})${steps}`;
      }) : ['  brak']));
      const done = activities.filter(a => a.startAt >= range.start && a.startAt < range.end).sort((a, b) => a.startAt - b.startAt);
      out.push('Zapisane aktywności:');
      out.push(...(done.length ? done.map(a => `${stamp(a.startAt, zone)}  ${a.sport}, ${minutes(a.durationSec)}${a.avgPower ? `, śr. moc ${a.avgPower} W` : ''}${a.avgHeartRate ? `, śr. tętno ${a.avgHeartRate}` : ''}${a.trainingStress ? `, TSS ${Math.round(a.trainingStress * 10) / 10}` : ''}`) : ['  brak']));
      return out.join('\n');
    },

    async cezar(url) {
      const id = url.searchParams.get('id')?.trim();
      if (id && sources.cezarRun) {
        const run = await sources.cezarRun(id);
        if (!run) return `Zadanie Cezara „${clip(id, 80)}”: brak danych lub zadanie nie istnieje.`;
        const state: Record<string, string> = { 'needs-input': 'czeka na odpowiedź', review: 'do przeglądu', running: 'w toku', queue: 'w kolejce', done: 'zakończone', completed: 'zakończone', failed: 'nieudane' };
        const statusText = state[run.status] ?? run.status;
        const out = [
          `Zadanie Cezara ${run.project ? `${run.project}/` : ''}${run.id ?? id}: ${clip(run.titleSummary || run.title || '', 120)} [${statusText}]`,
        ];
        if (run.error) out.push(`Błąd główny: ${clip(String(run.error), 300)}`);
        const outputs: Record<string, any> = run.graphState?.outputs ?? {};
        const step = url.searchParams.get('krok')?.trim();
        if (step) {
          const result = outputs[step];
          if (!result) return [...out, `Krok „${clip(step, 40)}”: brak zapisanego wyniku. Kroki z wynikiem: ${Object.keys(outputs).join(', ') || 'brak'}.`].join('\n');
          out.push(`Krok ${step}${typeof result.exitCode === 'number' ? `, kod wyjścia ${result.exitCode}` : ''}${result.verdict ? `, werdykt ${clip(String(result.verdict), 40)}` : ''}:`);
          if (typeof result.output === 'string' && result.output.trim()) { out.push(...checkExcerpt(result.output, 40)); return out.join('\n'); }
          const full = await agentStepText(runFile(run.worktreePath, '.ndjson'), step);
          if (full) out.push(full.length > AGENT_TEXT_MAX ? `${full.slice(0, AGENT_TEXT_MAX)}\n… (ucięto ${full.length - AGENT_TEXT_MAX} znaków z końca)` : full);
          else if (result.summary) out.push(`  (koniec raportu, ostatnie ${String(result.summary).length} znaków, jak zapisał je Cezar)`, String(result.summary));
          else out.push('  (krok nie zapisał wyjścia ani podsumowania)');
          return out.join('\n');
        }
        if (run.worktreePath) {
          out.push(`Worktree: ${run.worktreePath}`);
          const handoff = runFile(run.worktreePath, '.handoff.md');
          if (handoff && existsSync(handoff)) out.push(`Notatka przekazania: ${handoff}`);
        }
        if (run.branch) out.push(`Gałąź: ${run.branch}`);
        if (Array.isArray(run.steps) && run.steps.length) {
          out.push('Kroki:');
          for (const s of run.steps) {
            const stepStatus = state[s.status] ?? s.status ?? 'nieznany';
            const err = s.error ? ` — błąd: ${clip(String(s.error), 200)}` : '';
            out.push(`  - ${s.id ?? s.name ?? 'krok'}: ${stepStatus}${err}`);
          }
        }
        const verifyOutput = outputs.verify?.output;
        if (typeof verifyOutput === 'string' && verifyOutput.trim()) {
          out.push('Wyjście weryfikacji (błędy):', ...checkExcerpt(verifyOutput, 12));
        }
        const withResult = Object.keys(outputs).filter(k => outputs[k]?.output || outputs[k]?.summary);
        if (withResult.length) out.push(`Wynik kroku: panel_cezar z id i krok (${withResult.join(', ')}).`);
        if (run.task) {
          out.push(`Zlecenie (początek): ${clip(String(run.task), 250)}`);
        }
        return out.join('\n');
      }
      const snapshot = await sources.cezar();
      const zone = DEFAULT_ZONE;
      const out = [`Cezar, stan z ${stamp(snapshot.observedAt, zone)} (${zone}): w toku ${snapshot.counts.running}, w kolejce ${snapshot.counts.queue}, czeka na użytkownika ${snapshot.counts['needs-input']}, do przeglądu ${snapshot.counts.review}.`];
      const state: Record<string, string> = { 'needs-input': 'czeka na odpowiedź', review: 'do przeglądu', running: 'w toku', queue: 'w kolejce', done: 'zakończone', failed: 'nieudane' };
      out.push('Aktywne:');
      out.push(...(snapshot.tasks.length ? snapshot.tasks.map(t => `${t.project}: ${clip(t.title, 120)} [${state[t.status]}]${t.question ? ` pytanie: ${clip(t.question, 160)}` : t.activity ? ` — ${clip(t.activity, 120)}` : ''}`) : ['  brak']));
      out.push('Zakończone, niezarchiwizowane:');
      out.push(...(snapshot.finished.length ? snapshot.finished.slice(0, FINISHED_SHOWN).map(t => `${t.completedAt ? stamp(t.completedAt, zone) : '?'}  ${t.project}: ${clip(t.title, 120)} [${state[t.status]}${t.unread ? ', nieprzeczytane' : ''}] id=${t.id}${t.pullRequestUrl ? ` ${t.pullRequestUrl}` : ''}`) : ['  brak']));
      if (snapshot.finished.length > FINISHED_SHOWN) out.push(`… i ${snapshot.finished.length - FINISHED_SHOWN} starszych zakończonych (nie pokazano).`);
      return out.join('\n');
    },

    async mail(url) {
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
      const source = await sources.mail(limit);
      const zone = DEFAULT_ZONE;
      const header = `Gmail (tylko nieprzeczytane z ostatnich 30 dni, bez treści wiadomości), stan z ${source.observedAt ? stamp(source.observedAt, zone) : 'nieznany'} (${zone}); łącznie ${source.total}, poniżej najnowsze ${Math.min(limit, source.data?.length ?? 0)}.`;
      const none = unavailable('Gmail', source.status, !!source.data, source.message);
      if (none) return `${header}\n${none}`;
      const multi = source.accounts.length > 1;
      return [header, ...(source.data!.length ? source.data!.map(m => `${stamp(m.receivedAt, zone)}${multi ? ` [${m.account}]` : ''}  ${clip(m.from, 60)} — ${clip(m.subject, 100)}${m.messages > 1 ? ` (${m.messages} wiad.)` : ''} · ${clip(m.snippet, 100)}`) : ['Brak nieprzeczytanych.'])].join('\n');
    },

    async quotas() {
      const source = await sources.quotas();
      const zone = DEFAULT_ZONE;
      const header = `Limity AI, stan z ${source.observedAt ? stamp(source.observedAt, zone) : 'nieznany'} (${zone}).`;
      const none = unavailable('Limity', source.status, !!source.data, source.message);
      if (none) return `${header}\n${none}`;
      const lines = source.data!.flatMap(account => account.snapshots.map(s => {
        // `label` is left out: Google words it as remaining while `usedPercent` is the used share.
        const label = [account.provider, s.model, s.window].filter(Boolean).join(' / ');
        return `${label}: ${s.usedPercent === null ? 'brak odczytu' : `${Math.round(s.usedPercent)}% zużyte`}${s.resetAt ? `, reset ${stamp(s.resetAt, zone)}` : ''}${s.stale ? ' (nieaktualne)' : ''}`;
      }));
      // The split of the 5h bars exists for a few providers only: without this line a task asking it for another group
      // (Agy Claude & GPT, 28.10.2026) was dispatched as if the data were there.
      const usage = await sources.usageBreakdown?.().catch(() => undefined);
      const split = !usage ? null : usage.status !== 'connected' ? `Podział zużycia okna 5h na źródła: niedostępny (${usage.status}).`
        : `Podział zużycia okna 5h na źródła (części paska): ${usage.providers.map(p => `${p.provider === 'Gemini' ? 'AGY / Gemini Models' : p.provider} (${p.segments.length} części)`).join(', ') || 'brak'}; inne limity go nie mają. Podział liczy cezar-adapter (osobne repozytorium, /panel/v2/usage/breakdown): nowy limit w podziale to zmiana w adapterze, nie w desk-panel.`;
      return [header, ...(lines.length ? lines : ['Brak odczytów.']), ...(split ? [split] : [])].join('\n');
    },

    async todos(url) {
      const source = await sources.todos();
      const zone = DEFAULT_ZONE;
      const withDone = url.searchParams.get('ukonczone') === '1';
      const header = `Listy zadań użytkownika (zadania do zrobienia, nie zadania Cezara), stan z ${source.observedAt ? stamp(source.observedAt, zone) : 'nieznany'} (${zone}). ${withDone ? 'Ukończone są pokazane.' : 'Ukończone są tylko policzone; ukonczone=1 je pokazuje.'}`;
      const none = unavailable('Zadania', source.status, !!source.data, source.message);
      if (none) return `${header}\n${none}`;
      const wanted = url.searchParams.get('list')?.trim().toLowerCase();
      const lists = source.data!.lists.filter(l => !wanted || l.id === wanted || l.name.toLowerCase().includes(wanted));
      if (!lists.length) return `${header}\n${wanted ? `Nie ma listy „${clip(wanted, 60)}”.` : 'Brak list. Utwórz listę akcją createList.'}${source.data!.lists.length ? ` Są: ${source.data!.lists.map(l => `„${l.name}” (${l.id})`).join(', ')}.` : ''}`;
      const task = (t: (typeof lists)[number]['tasks'][number]) => {
        const meta = [t.by === 'agent' ? 'dodał agent' : null, dateOf(t.createdAt, zone), t.done && t.completedAt ? `ukończone ${stamp(t.completedAt, zone)}` : null].filter(Boolean).join(', ');
        return `  [${t.done ? 'x' : ' '}] ${t.id}  ${clip(t.title, 200)} (${meta})${t.note ? ` — ${clip(t.note, 300)}` : ''}`;
      };
      return [header, ...lists.flatMap(list => {
        const open = list.tasks.filter(t => !t.done), done = list.tasks.filter(t => t.done);
        return [`Lista „${list.name}” (id=${list.id}): do zrobienia ${open.length}, ukończonych ${done.length}`, ...(open.length ? open.map(task) : ['  (brak zadań do zrobienia)']), ...(withDone ? done.map(task) : [])];
      })].join('\n');
    },

    async bank(url, now) {
      const zone = DEFAULT_ZONE;
      const [source, ledger] = await Promise.all([sources.bank(), sources.bankLedger()]);
      const today = dateOf(now, zone);
      const from = url.searchParams.get('from') ?? addDays(today, -30);
      const to = url.searchParams.get('to') ?? today;
      if (!validDate(from) || !validDate(to)) throw new AgentViewError(400, 'from i to to daty RRRR-MM-DD.');
      if (to < from) throw new AgentViewError(400, 'to nie może być przed from.');
      if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) >= BANK_MAX_DAYS * DAY) throw new AgentViewError(400, `Zakres to najwyżej ${BANK_MAX_DAYS} dni.`);
      const categories = new Map(ledger.categories.map(c => [c.id, c.name]));
      const parties = new Map(ledger.parties.map(p => [p.id, p]));
      const moveName = { spend: 'wydatek', income: 'przychód', settle: 'rozliczenie', move: 'przełożenie' } as const;
      const find = (wanted: string | null, names: Map<string, string>) => {
        const w = wanted?.trim().toLowerCase();
        return w ? [...names].filter(([id, name]) => id === w || name.toLowerCase().includes(w)).map(([id]) => id) : null;
      };
      const wantCategory = find(url.searchParams.get('kategoria') ?? url.searchParams.get('źródło') ?? url.searchParams.get('zrodlo'), categories);
      // `osoba` and `sprzedawca` are older names of the same filter.
      const wantParty = find(url.searchParams.get('strona') ?? url.searchParams.get('osoba') ?? url.searchParams.get('sprzedawca'), new Map(ledger.parties.map(p => [p.id, p.name])));
      const wantTag = url.searchParams.get('etykieta')?.replace(/^#/, '').trim().toLowerCase() || null;
      const ruch = url.searchParams.get('ruch')?.trim().toLowerCase() || null;
      // "przychody", "przelozenie" and "rozliczenia" are the same as the names: compared without diacritics, by their start.
      const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').toLowerCase().slice(0, 5);
      const wantMove = ruch ? Object.entries(moveName).find(([id, name]) => id === ruch || plain(name) === plain(ruch))?.[0] ?? 'none' : null;
      const onlyPending = url.searchParams.get('nieprzypisane') === '1';
      // A booking day is noon UTC of that date.
      const booked = (at: number) => new Date(at).toISOString().slice(0, 10);
      const pln = (amount: number, currency = 'PLN') => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
      const accounts = source.data?.accounts ?? [];
      const balance = accounts.length ? accounts.map(a => `${a.name}${a.last4 ? ` ··${a.last4}` : ''}: ${a.balance === null ? '?' : pln(a.balance, a.currency).replace(/^\+/, '')}`).join('; ') : 'brak';
      const out = [
        `Konto PKO BP (tylko odczyt; dane z banku i oznaczenia użytkownika), stan banku z ${source.observedAt ? stamp(source.observedAt, zone) : 'nieznany'} (${zone}). Dziś: ${todayLabel(now, zone)}. Saldo: ${balance}.`,
        `Zakres ${from} – ${to}. Oznaczenia nadaje użytkownik. Najpierw ruch, czyli co zrobiły pieniądze: wydatek (kategoria: na co; wpływ oznaczony jako wydatek to zwrot i zmniejsza kategorię), przychód (źródło: skąd), rozliczenie (pożyczka albo jej oddanie z drugą stroną; liczy się tylko do salda z nią, nie do wydatków ani przychodów), przełożenie (między własnymi kontami; nie liczy się nigdzie). Do tego druga strona, etykiety, cykliczność, opis. Operacja bez ruchu jest nieoznaczona i liczy się jako wydatek albo wpływ według znaku. Do przypisania są operacje od ${ledger.since} bez ruchu albo wydatki i przychody bez kategorii.`,
      ];
      const none = unavailable('Bank', source.status, !!source.data, source.message);
      if (none) out.push(none);
      const inRange = ledger.entries.filter(e => booked(e.op.at) >= from && booked(e.op.at) <= to);
      const flows = inRange.filter(e => e.op.currency === 'PLN');
      // An unmarked operation counts by its sign; a settlement and a move between own accounts count in neither sum.
      const spendOf = (e: (typeof flows)[number]) => e.label?.move === 'spend' || (!e.label?.move && e.op.amount < 0);
      const incomeOf = (e: (typeof flows)[number]) => e.label?.move === 'income' || (!e.label?.move && e.op.amount > 0);
      const spentTotal = -flows.filter(spendOf).reduce((s, e) => s + e.op.amount, 0);
      const earned = flows.filter(incomeOf).reduce((s, e) => s + e.op.amount, 0);
      const aside = (move: 'settle' | 'move') => flows.filter(e => e.label?.move === move).reduce((s, e) => s + e.op.amount, 0);
      out.push(`Przychody ${pln(earned)}, wydatki ${pln(-spentTotal)}, netto ${pln(earned - spentTotal)}. Poza tymi sumami: rozliczenia ${pln(aside('settle'))}, przełożenia ${pln(aside('move'))}.`);
      const byAxis = (pick: (e: (typeof flows)[number]) => boolean, sign: number, none: string) => {
        const sums = new Map<string, number>();
        for (const e of flows.filter(pick)) {
          const name = e.label?.category ? categories.get(e.label.category) ?? none : e.label?.move ? none : 'nieoznaczone';
          sums.set(name, (sums.get(name) ?? 0) + sign * e.op.amount);
        }
        return sums.size ? [...sums].sort((a, b) => b[1] - a[1]).map(([name, sum]) => `${name} ${pln(sum).replace(/^\+/, '')}`).join('; ') : 'brak';
      };
      out.push(`Wydatki według kategorii: ${byAxis(spendOf, -1, 'bez kategorii')}.`);
      out.push(`Przychody według źródła: ${byAxis(incomeOf, 1, 'bez źródła')}.`);
      // Balances over everything kept, not only the range: who owes whom needs the whole story.
      out.push(ledger.balances.length ? 'Salda rozliczeń (cała zapisana historia):' : 'Salda rozliczeń: wszyscy rozliczeni albo brak rozliczeń.');
      for (const b of ledger.balances) {
        const name = parties.get(b.party)?.name ?? '?';
        const sum = pln(Math.abs(b.amount), b.currency).replace(/^\+/, '');
        out.push(b.amount > 0 ? `  ${name}: do oddania użytkownikowi ${sum}` : `  ${name}: użytkownik ma do oddania ${sum}`);
      }
      const pending = ledger.entries.filter(e => e.pending);
      out.push(`Do przypisania: ${pending.length}.`);
      const shown = inRange.filter(e => (!onlyPending || e.pending)
        && (!wantMove || e.label?.move === wantMove)
        && (!wantCategory || (!!e.label?.category && wantCategory.includes(e.label.category)))
        && (!wantParty || wantParty.includes(e.label?.party ?? e.known ?? ''))
        && (!wantTag || !!e.label?.tags.some(t => t.toLowerCase().includes(wantTag))));
      out.push(`Operacje${onlyPending ? ' do przypisania' : ''}${wantMove ? ` o ruchu ${moveName[wantMove as keyof typeof moveName] ?? '(brak takiego)'}` : ''}${wantCategory ? ` w kategorii ${wantCategory.map(id => categories.get(id)).join('/') || '(brak takiej)'}` : ''}${wantParty ? ` z drugą stroną ${wantParty.map(id => parties.get(id)?.name).join('/') || '(brak takiej)'}` : ''}${wantTag ? ` z etykietą #${wantTag}` : ''}, najnowsze pierwsze:`);
      const method: Record<string, string> = { card: 'karta', phone: 'telefon, bez nazwy sklepu', blik: 'BLIK, bez nazwy sklepu', cardTransfer: 'przelew z karty', atm: 'bankomat', transfer: 'przelew', other: '' };
      const optionWords = (o: NonNullable<(typeof ledger.entries)[number]['suggestion']>['options'][number]) =>
        [o.move && moveName[o.move], o.party && parties.get(o.party)?.name, o.category && categories.get(o.category), ...(o.tags ?? []).map(t => `#${t}`)].filter(Boolean).join(', ');
      out.push(...(shown.length ? shown.slice(0, BANK_SHOWN).map(e => {
        const party = parties.get(e.label?.party ?? e.known ?? '');
        const move = e.label?.move;
        const marks = [
          move ? `ruch: ${moveName[move]}` : 'nieoznaczona',
          e.label?.category ? `${move === 'income' ? 'źródło' : move === 'move' ? 'kieszeń' : 'kategoria'}: ${categories.get(e.label.category) ?? '?'}` : null,
          party ? `strona: ${party.name}${e.label?.party ? '' : ' (rozpoznana, nieoznaczona)'}` : null,
          e.label?.tags.length ? `etykiety: ${e.label.tags.map(t => `#${t}`).join(' ')}` : null,
          e.label?.recurring ? 'cykliczne' : null,
          e.label?.comment ? `opis: „${clip(e.label.comment, 160)}”` : null,
          e.pending ? 'DO PRZYPISANIA' : null,
          e.suggestion ? `${e.suggestion.sure ? 'podpowiedź' : 'do wyboru'}: ${e.suggestion.options.map(optionWords).join(' albo ')}` : null,
        ].filter(Boolean).join('; ');
        return `${dayName(midnight(booked(e.op.at), zone), zone)} ${booked(e.op.at)}  ${pln(e.op.amount, e.op.currency)}  ${clip(e.op.name, 60)}${method[e.op.method] ? ` (${method[e.op.method]})` : ''}${e.op.detail ? ` — ${clip(e.op.detail, 60)}` : ''}  [${marks}]`;
      }) : ['  brak']));
      if (shown.length > BANK_SHOWN) out.push(`… i ${shown.length - BANK_SHOWN} starszych (zawęź zakres from/to).`);
      // Whatever slipped through, no long run of digits (an account or a phone number) leaves this view.
      return out.join('\n').replace(/\d{9,}/g, run => `${'*'.repeat(run.length - 3)}${run.slice(-3)}`);
    },

    async system() {
      const source = await sources.system();
      const none = unavailable('Komputer', source.status, !!source.data?.length, source.message);
      if (none) return none;
      const last = source.data!.at(-1)!;
      const recent = source.data!.filter(s => s.at >= last.at - 5 * 60_000);
      const avg = recent.reduce((sum, s) => sum + s.cpuPercent, 0) / recent.length;
      return `Komputer, stan z ${stamp(last.at, DEFAULT_ZONE)} (${DEFAULT_ZONE}): CPU ${Math.round(last.cpuPercent)}% (średnio ${Math.round(avg)}% z ostatnich 5 minut), RAM ${last.ramUsedGb.toFixed(1)} z ${last.ramTotalGb.toFixed(1)} GB.`;
    },
  };
}

/** Answers `/api/agent/<name>`; null when there is no such view. Errors are the same as the JSON routes' (`SourceError`) or a 400. */
export async function serveAgentView(views: Record<string, AgentView>, url: URL, now: number): Promise<{ status: number; body: string } | null> {
  const name = url.pathname.slice('/api/agent/'.length);
  if (!Object.hasOwn(views, name)) return null;
  try { return { status: 200, body: await views[name](url, now) }; }
  catch (error) {
    if (error instanceof AgentViewError) return { status: error.status, body: error.message };
    if (error instanceof SourceError) return { status: error.status, body: 'Nie udało się pobrać danych źródła.' };
    return { status: 502, body: 'Nie udało się pobrać danych źródła.' };
  }
}
