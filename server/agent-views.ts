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

    async cezar() {
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
      return [header, ...(lines.length ? lines : ['Brak odczytów.'])].join('\n');
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
