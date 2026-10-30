import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { ChatError, type ChatService } from './agent-chat';
import { PR_URL, type PrReader } from './github';
import type { CezarSnapshot, FinishedTask } from '../src/cezar-contract';
import type { CockpitPrView } from '../src/cockpit-contract';
import {
  MAX_ACTIVE_OBSERVERS, OBSERVER_TIME_EXTRA_MS, OBSERVER_TTL_MS, observerKinds,
  type ObserverKind, type ObserverView,
} from '../src/observers-contract';

/**
 * The chat agent's one-shot observers (`panel_observe`). A conversation asks to be told once about one thing: a Cezar
 * task finishing or waiting for an answer, a pull request changing, or a moment in time. When it happens the panel sends
 * exactly one automation turn — headed as an observer of its kind, carrying the instruction stored at creation — back to
 * the conversation that created it, and the observer leaves the active list.
 *
 * Kept in `~/.desk-panel/observers.json` (outside Git), statuses rather than deletions, so a restart never sends the
 * same observer twice. Every observer expires (a day, or an hour after its moment); creating one above
 * `MAX_ACTIVE_OBSERVERS` is refused. `DESK_AUTOMATIONS=0` stops creation and firing; the list stays readable.
 *
 * Cezar observers ride the reads the panel already makes (`active`/`finished`, the same hooks as the dispatch report):
 * nothing here polls Cezar. Time and PR observers are checked by a one-minute clock that exists only while such an
 * observer is active, and PR state comes from the cached per-PR reader (`server/github.ts`), never a fresh `gh` call per
 * observer.
 */

const ZONE = 'Europe/Warsaw';
const CLOCK_MS = 60_000;
const MAX_STORED = 1000;

const recordSchema = z.object({
  id: z.string().regex(/^o-[0-9a-f]{12}$/),
  chatId: z.string().min(1).max(200),
  kind: z.enum(observerKinds),
  target: z.string().min(1).max(1000),
  instruction: z.string().min(1).max(2000),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: z.enum(['active', 'fired', 'cancelled', 'expired']).default('active'),
  firedAt: z.number().optional(),
  /** What the watched thing looked like at creation: a Cezar task's state, a PR's signature, a moment. */
  snapshot: z.record(z.string(), z.unknown()).default({}),
});
type StoredObserver = z.infer<typeof recordSchema>;
const storeSchema = z.object({ version: z.literal(1), observers: z.array(recordSchema).default([]) });
type Store = z.infer<typeof storeSchema>;

export class ObserverError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const FINISHED = new Set(['done', 'completed', 'succeeded', 'success']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled']);
/** A Cezar run's state as the observer watches it: the two states the user asked about, and everything else. */
export function cezarStateOf(raw: Record<string, any> | null): string {
  if (!raw) return 'unknown';
  const status = String(raw.status ?? '').toLowerCase();
  if (FAILED.has(status)) return 'failed';
  if (FINISHED.has(status)) return 'done';
  if (status === 'paused' || raw.waitingForInput || raw.currentStepId === 'ask') return 'needs-input';
  return 'running';
}
/** What a changed PR looks like: its state (merged is MERGED), whether it merged, and its CI rollup. */
export function prSignature(pr: CockpitPrView): string {
  return `${pr.state}|merged:${pr.state === 'MERGED'}|${pr.checks.map(c => `${c.name}:${c.state}`).join(',')}`;
}

const local = (at: number) => DateTime.fromMillis(at, { zone: ZONE }).toFormat('yyyy-LL-dd HH:mm');

/**
 * A time observer's moment: an ISO timestamp (with or without an offset, read in Europe/Warsaw) or a Polish phrase —
 * `za N minut`, `za N godzin`, `za N dni`, `jutro o H`, `dzisiaj o H` (an optional `:MM`). Null when it cannot be read.
 */
export function resolveObserverTime(input: string, now: number, zone = ZONE): number | null {
  const text = input.trim();
  if (!text) return null;
  const iso = DateTime.fromISO(text, { zone });
  if (iso.isValid) return iso.toMillis();
  const relative = /^za\s+(\d+)\s*(minut\S*|godzin\S*|godz\S*|dni\S*|dzie\S*)$/i.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms = unit.startsWith('min') ? 60_000 : unit.startsWith('godz') ? 3_600_000 : 86_400_000;
    return now + amount * ms;
  }
  const day = /^(jutro|dzisiaj|dziś)\s+o\s+(\d{1,2})(?::(\d{2}))?$/i.exec(text);
  if (day) {
    const hour = Number(day[2]);
    const minute = Number(day[3] ?? 0);
    if (hour > 23 || minute > 59) return null;
    const base = DateTime.fromMillis(now, { zone }).startOf('day');
    return (day[1].toLowerCase() === 'jutro' ? base.plus({ days: 1 }) : base).set({ hour, minute }).toMillis();
  }
  return null;
}

export interface Observers {
  create(input: { chatId: string; kind: ObserverKind; target: string; instruction: string }): Promise<ObserverView>;
  /** The active observers; expired ones are dropped first (and never sent). */
  list(): Promise<ObserverView[]>;
  /** Cancels one observer (it never fires); answers with the active list. */
  cancel(id: string): Promise<ObserverView[]>;
  /** The panel's existing Cezar reads: a watched task waiting for the user. */
  active(tasks: readonly CezarSnapshot['tasks'][number][]): Promise<void>;
  /** The panel's existing Cezar reads: a watched task done. */
  finished(tasks: readonly FinishedTask[]): Promise<void>;
  /** Checks the time and PR observers once: the minute clock calls it, tests call it directly. */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createObservers({ file, chat, readTask, readPr, enabled = true, now = Date.now, zone = ZONE, log }: {
  file: string;
  chat: Pick<ChatService, 'sendAutomation'>;
  /** One Cezar run as Cezar answers it (the panel's own `cezarRun`); null when Cezar does not know it. */
  readTask?: (id: string) => Promise<Record<string, any> | null>;
  /** The cached single-PR read (`createPrReader` in server/github.ts): never a fresh `gh` call per observer. */
  readPr?: PrReader['read'];
  enabled?: boolean;
  now?: () => number;
  zone?: string;
  log?: (line: string) => void;
}): Observers {
  const writeLog = log ?? (line => console.log(`${new Date(now()).toISOString()} obserwatory: ${line}`));
  const load = (): Store => {
    try { if (existsSync(file)) return storeSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* a broken file starts over */ }
    return { version: 1, observers: [] };
  };
  const store = load();
  const save = () => {
    if (store.observers.length > MAX_STORED) {
      const drop = store.observers.filter(o => o.status !== 'active').slice(0, store.observers.length - MAX_STORED);
      const gone = new Set(drop.map(o => o.id));
      store.observers = store.observers.filter(o => !gone.has(o.id));
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(store, null, 2), 'utf8');
    renameSync(`${file}.tmp`, file);
  };
  const view = (o: StoredObserver): ObserverView => ({ id: o.id, kind: o.kind, target: o.target, instruction: o.instruction, createdAt: o.createdAt, expiresAt: o.expiresAt });
  const active = () => store.observers.filter(o => o.status === 'active');
  const pending = new Map<string, { chatId: string; text: string; reason: string }>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let flushing: Promise<void> = Promise.resolve();

  /** Drops what is past its expiry: no turn, and it disappears from the list. */
  function dropExpired(): boolean {
    const at = now();
    let changed = false;
    for (const o of store.observers) if (o.status === 'active' && at >= o.expiresAt) { o.status = 'expired'; changed = true; }
    if (changed) save();
    return changed;
  }

  const needsClock = () => enabled && (active().some(o => o.kind === 'time' || o.kind === 'pr') || pending.size > 0);
  function ensureClock() {
    if (!needsClock()) { stop(); return; }
    if (timer) return;
    timer = setInterval(() => { tick().catch(error => writeLog(`błąd zegara: ${error instanceof Error ? error.message : String(error)}`)); }, CLOCK_MS);
    timer.unref?.();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  async function sendPending(): Promise<void> {
    for (const [id, delivery] of [...pending]) {
      if (!enabled) { pending.delete(id); continue; }
      if (!chat.sendAutomation) {
        pending.delete(id);
        writeLog(`pominięto ${id}: ten silnik nie przyjmuje tur automatyki.`);
        continue;
      }
      try {
        await chat.sendAutomation(delivery.chatId, { text: delivery.text, automation: { source: 'observer', reason: delivery.reason } });
        pending.delete(id);
        writeLog(`wysłano turę automatyki do rozmowy ${delivery.chatId} (${id}).`);
      } catch (error) {
        if (error instanceof ChatError && error.status === 409) continue; // the conversation is mid-turn: at the next flush, once
        pending.delete(id);
        writeLog(`pominięto ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const flush = () => {
    flushing = flushing.then(sendPending).catch(error => writeLog(`błąd: ${error instanceof Error ? error.message : String(error)}`));
    return flushing;
  };

  /** One turn: the instruction exactly as stored, plus the fact that made the observer fire. */
  function fire(o: StoredObserver, detail: string, reason: string) {
    o.status = 'fired';
    o.firedAt = now();
    save();
    pending.set(o.id, { chatId: o.chatId, text: `${o.instruction}\n\n${detail}`, reason });
    writeLog(`zadziałał ${o.id} (${o.kind}: ${o.target}).`);
    ensureClock();
  }

  async function tick(): Promise<void> {
    if (!enabled) return;
    dropExpired();
    const at = now();
    for (const o of active()) if (o.kind === 'time') {
      const moment = Number(o.snapshot.at);
      if (!Number.isFinite(moment) || at < moment) continue;
      fire(o, `Minął moment obserwatora: ${local(moment)} (${zone}).`, `obserwator czasu: ${local(moment)}`);
    }
    for (const o of active()) if (o.kind === 'pr' && readPr) {
      let pr: CockpitPrView;
      try { pr = await readPr(o.target); }
      catch (error) { writeLog(`nie udało się odczytać PR ${o.target}: ${error instanceof Error ? error.message : String(error)}`); continue; }
      // GitHub unreachable or refused: not a change of the PR.
      if (pr.state === 'UNKNOWN') continue;
      const signature = prSignature(pr);
      if (typeof o.snapshot.signature !== 'string') { o.snapshot = { signature }; save(); continue; }
      if (o.snapshot.signature === signature) continue;
      o.snapshot = { signature };
      const checks = pr.checks.length ? pr.checks.map(c => `${c.name}: ${c.state}`).join(', ') : pr.checksError ?? 'brak checków';
      fire(o, `PR ${o.target}: stan ${pr.state}${pr.state === 'MERGED' ? ' (scalony)' : pr.state === 'CLOSED' ? ' (zamknięty bez scalenia)' : ''}, CI: ${checks}.`, `obserwator PR: ${o.target}`);
    }
    await flush();
    ensureClock();
  }

  function assertEnabled() {
    if (!enabled) throw new ObserverError(409, 'Automatyki panelu są wyłączone (DESK_AUTOMATIONS=0), więc obserwator nie powstanie.');
  }

  return {
    async create({ chatId, kind, target, instruction }) {
      assertEnabled();
      dropExpired();
      if (active().length >= MAX_ACTIVE_OBSERVERS) {
        throw new ObserverError(409, `Limit aktywnych obserwatorów to ${MAX_ACTIVE_OBSERVERS}. Anuluj któryś w Ustawieniach i spróbuj ponownie.`);
      }
      const at = now();
      const snapshot: Record<string, unknown> = {};
      let expiresAt = at + OBSERVER_TTL_MS;
      if (kind === 'cezar') {
        if (!readTask) throw new ObserverError(503, 'Odczyt Cezara nie jest dostępny.');
        const raw = await readTask(target).catch(() => null);
        if (!raw) throw new ObserverError(404, `Cezar nie zna taska ${target}.`);
        snapshot.state = cezarStateOf(raw);
      } else if (kind === 'pr') {
        if (!PR_URL.test(target)) throw new ObserverError(400, 'target to pełny adres PR: https://github.com/owner/repo/pull/n.');
        if (!readPr) throw new ObserverError(503, 'Odczyt PR nie jest dostępny.');
        try {
          // An unreadable PR (UNKNOWN) is no baseline: the first real read becomes one, not a change.
          const first = await readPr(target);
          if (first.state !== 'UNKNOWN') snapshot.signature = prSignature(first);
        } catch { /* GitHub missing: the first successful read becomes the baseline */ }
      } else {
        const moment = resolveObserverTime(target, at, zone);
        if (moment === null) throw new ObserverError(400, 'Nie rozumiem tego momentu: podaj ISO 8601 albo „za 10 minut”, „za 2 godziny”, „za 3 dni”, „jutro o 9”, „dzisiaj o 15:30”.');
        if (moment < at) throw new ObserverError(400, 'Ten moment już minął: podaj przyszły czas.');
        snapshot.at = moment;
        expiresAt = moment + OBSERVER_TIME_EXTRA_MS;
        target = DateTime.fromMillis(moment, { zone }).toFormat("yyyy-LL-dd'T'HH:mm ZZ");
      }
      const record: StoredObserver = { id: `o-${randomBytes(6).toString('hex')}`, chatId, kind, target, instruction, createdAt: at, expiresAt, status: 'active', snapshot };
      store.observers.push(record);
      save();
      writeLog(`utworzono ${record.id} (${kind}: ${target}) w rozmowie ${chatId}.`);
      ensureClock();
      return view(record);
    },

    async list() {
      dropExpired();
      return active().map(view);
    },

    async cancel(id) {
      const found = store.observers.find(o => o.id === id);
      if (found?.status === 'active') {
        found.status = 'cancelled';
        save();
        writeLog(`anulowano ${id}.`);
      }
      ensureClock();
      return active().map(view);
    },

    async active(tasks) {
      if (!enabled) return;
      dropExpired();
      for (const o of active()) {
        if (o.kind !== 'cezar') continue;
        const task = tasks.find(t => t.id === o.target);
        if (!task) continue;
        const state = String(task.status ?? '').toLowerCase();
        if (state !== 'needs-input' || o.snapshot.state === 'needs-input') continue;
        o.snapshot = { state };
        fire(o, `Task Cezara ${o.target} czeka na odpowiedź użytkownika.`, `obserwator taska Cezara: ${o.target}`);
      }
      await flush();
    },

    async finished(tasks) {
      if (!enabled) return;
      dropExpired();
      for (const o of active()) {
        if (o.kind !== 'cezar') continue;
        const task = tasks.find(t => t.id === o.target);
        if (!task) continue;
        const state = String(task.status ?? '').toLowerCase();
        if (!FINISHED.has(state) || o.snapshot.state === 'done') continue;
        o.snapshot = { state };
        fire(o, `Task Cezara ${o.target} (${task.title ?? o.target}) jest zakończony${task.pullRequestUrl ? `; PR: ${task.pullRequestUrl}` : ''}.`, `obserwator taska Cezara: ${o.target}`);
      }
      await flush();
    },

    tick,
    start() { ensureClock(); },
    stop,
  };
}

