import { createHash, randomBytes } from 'node:crypto';
import type { AutomationAct } from '../src/automation-contract';
import type { ChatAutomation, ChatAutomationInput } from '../src/chat-contract';
import {
  MACHINA_LIMITS, TEMPLATE_REF, hostInDomain, isMachinaEffect, machinaActionSchema, machinaCardSchema, machinaConversationsSchema, machinaJournalSchema,
  machinaProgramSchema, machinaSituationsSchema, machinaVersionSchema,
  type MachinaAction, type MachinaBlock, type MachinaBlockResult, type MachinaCard, type MachinaConversations, type MachinaEffect, type MachinaJournal,
  type MachinaProgram, type MachinaRun, type MachinaTrigger, type MachinaVersion,
} from '../src/machina-contract';
import { ChatError } from './agent-chat';
import type { createAutomationExecutor } from './automation-actions';
import { nextRunFor } from './automations';
import { FilaError, type FilaAutomat, type FilaStore } from './fila';
import { MachinaFetchError, createMachinaReader, cutBetween, pageText, type MachinaReader } from './machina-fetch';

/** A refusal the HTTP layer answers with this status. */
export class MachinaError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export interface MachinaChat {
  note?(id: string, input: { text: string; automation: ChatAutomation; key: string }): Promise<void>;
  sendAutomation?(id: string, input: ChatAutomationInput): Promise<void>;
}
export interface MachinaOptions {
  fila: FilaStore;
  /** False while the panel is not on an active, unlocked Fila: Machina then neither runs nor writes. */
  filaActive?: () => boolean;
  /** `DESK_AUTOMATIONS`: off = the clock starts nothing and creating, changing and „uruchom teraz” refuse. */
  enabled?: boolean;
  chat?: MachinaChat;
  /** The same executor the old automations use for calendar, alert and phone notification. */
  executeAction?: ReturnType<typeof createAutomationExecutor>;
  read?: MachinaReader;
  /** The old automations hold the panel's one run slot (a Hermes turn of theirs is pending or running). */
  busy?: () => boolean;
  now?: () => number;
  log?: (message: string) => void;
}
/** An automat with its kit parsed by Machina's own contract. */
export interface MachinaAutomat { thread: string; uid: string; title: string; state: string; closed: boolean; archived: boolean; program: MachinaProgram; journal: MachinaJournal; conversations: MachinaConversations; samples: number }
export interface Machina {
  /** The user's decision on a program card: accepted, it makes the automat or its next version; rejected, nothing changes. */
  decideCard(card: MachinaCard, decision: { accept: boolean; chatId?: string }): Promise<{ decision: 'created' | 'updated' | 'rejected'; thread?: string; version?: number }>;
  /** Wektor's one card-free case: a one-shot automat that only writes to, or resumes, the conversation it was made in. */
  createReminder(input: { chatId: string; title: string; at: number; kind: 'message' | 'resume'; text: string }): Promise<{ thread: string }>;
  /** What the user does directly: pause, resume, cancel, run now, restore an older version. */
  action(input: MachinaAction): Promise<MachinaAutomat>;
  get(thread: string): Promise<MachinaAutomat>;
  effects(): Promise<MachinaEffect[]>;
  /** A run is being executed right now (the old automations wait for it). */
  running(): boolean;
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

const CLOCK_MS = 60_000;
/** A `resume` that keeps finding its conversation busy gives up after this long (own value: an hour-old reminder is still worth a turn, a day-old one is not). */
const WAITING_MS = 60 * 60_000;
const ACTIVE = 'Aktywny', PAUSED = 'Wstrzymany', DONE = 'Zakończony', EXPIRED = 'Wygasł', CANCELLED = 'Anulowany', WAITS_FOR_CARD = 'Czeka na kartę programu';
const uuidOf = (key: string) => { const h = createHash('sha256').update(key).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const currentOf = (program: MachinaProgram): MachinaVersion => program.versions.find(v => v.number === program.current)!;
const isCyclic = (trigger: MachinaTrigger) => trigger.kind !== 'once';

export function createMachina(options: MachinaOptions): Machina {
  const { fila } = options;
  const now = options.now ?? Date.now;
  const enabled = options.enabled ?? true;
  const read = options.read ?? createMachinaReader();
  const log = options.log ?? (message => console.warn(`[machina] ${message}`));
  const live = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let pumping: Promise<void> | undefined;

  const filaActive = () => options.filaActive?.() ?? true;
  const assertWritable = () => {
    if (!filaActive()) throw new MachinaError(409, 'Machina działa tylko na aktywnej, odblokowanej Fili.');
  };
  const assertEnabled = () => {
    assertWritable();
    if (!enabled) throw new MachinaError(409, 'Automaty są wyłączone (DESK_AUTOMATIONS=0).');
  };
  /** Every read-change-write of a kit goes through here, one at a time: Machina is the kit's only writer, so nothing is lost between its own steps. */
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.catch(() => undefined);
    return run;
  };
  const refusal = (error: unknown) => error instanceof FilaError ? new MachinaError(error.status, error.message) : error;

  const parse = (a: FilaAutomat): MachinaAutomat | null => {
    const program = machinaProgramSchema.safeParse(a.program);
    if (!program.success) return null;
    const journal = machinaJournalSchema.safeParse(a.journal ?? { runs: [] });
    const conversations = machinaConversationsSchema.safeParse(a.conversations ?? { items: [] });
    const situations = machinaSituationsSchema.safeParse(a.situations ?? { items: [] });
    if (!journal.success || !conversations.success || !situations.success) return null;
    return {
      thread: a.id, uid: a.uid, title: a.title, state: a.state, closed: a.closed, archived: a.archived, program: program.data, journal: journal.data,
      conversations: conversations.data, samples: situations.data.items.reduce((sum, item) => sum + item.samples.length, 0),
    };
  };
  const all = async () => (await fila.machina.list()).flatMap(a => { const parsed = a.program === null ? null : parse(a); if (a.program !== null && !parsed) log(`${a.id}: zestaw Machiny nie pasuje do kontraktu, pomijam.`); return parsed ? [parsed] : []; });
  const byUid = async (uid: string) => { const a = await fila.machina.read(uid); const parsed = a && parse(a); if (!parsed) throw new MachinaError(404, 'Nie ma automatu z programem o tej tożsamości.'); return parsed; };
  const byThread = async (thread: string) => {
    const view = await fila.thread(thread).catch(error => { throw refusal(error); });
    if (!view.machina) throw new MachinaError(404, `Wątek ${view.id} nie jest automatem.`);
    return byUid(view.uid);
  };
  /** One change of an automat: read it fresh, let `work` change the parsed kit and name the Stan, write both at once. */
  const change = <T>(uid: string, work: (a: MachinaAutomat) => { state?: string; result: T }) => serial(async () => {
    const a = await byUid(uid);
    const before = JSON.stringify([a.program, a.journal, a.conversations]);
    const { state, result } = work(a);
    const program = machinaProgramSchema.parse(a.program), journal = machinaJournalSchema.parse(a.journal), conversations = machinaConversationsSchema.parse(a.conversations);
    const kitChanged = JSON.stringify([program, journal, conversations]) !== before;
    if (kitChanged || (state !== undefined && state !== a.state)) {
      await fila.machina.update(uid, { ...(state !== undefined ? { state } : {}), ...(kitChanged ? { kit: { program, journal, conversations } } : {}) }).catch(error => { throw refusal(error); });
    }
    return result;
  });

  /** The Stan a program without anything left to run ends in: a one-shot did its work, a cycle ran out of time. */
  const endState = (program: MachinaProgram) => isCyclic(currentOf(program).trigger) ? EXPIRED : DONE;
  /** Sets a Stan the engine worked out, unless the user's pause holds: then it is kept for the resume (Wstrzymany comes first). */
  const settle = (a: MachinaAutomat, wanted: string): string | undefined => {
    if (a.closed) return undefined;
    if (a.state === PAUSED) { a.program.paused = { from: wanted }; return undefined; }
    return wanted;
  };

  const versionFrom = (a: MachinaAutomat | undefined, content: Pick<MachinaVersion, 'trigger' | 'blocks' | 'scope'>, by: MachinaVersion['by'], reason: string, restoredFrom?: number): MachinaVersion =>
    machinaVersionSchema.parse({ number: (a?.program.versions.at(-1)?.number ?? 0) + 1, at: now(), by, reason, ...content, ...(restoredFrom ? { restoredFrom } : {}) });
  const firstRun = (trigger: MachinaTrigger) => nextRunFor(trigger, now()) ?? null;
  const create = async (input: { title: string; description?: string; module?: string; tags?: string[]; parent?: string; chatId?: string; version: MachinaVersion; reason: string }) => {
    const open = (await fila.machina.list()).filter(a => !a.closed).length;
    if (open >= MACHINA_LIMITS.active) throw new MachinaError(409, `Może być najwyżej ${MACHINA_LIMITS.active} niezamkniętych automatów.`);
    const program: MachinaProgram = { current: input.version.number, versions: [input.version], nextRunAt: firstRun(input.version.trigger), chatId: input.chatId ?? null };
    const conversations: MachinaConversations = { items: input.chatId ? [{ chatId: input.chatId, reason: input.reason, at: now() }] : [] };
    return fila.machina.create({
      title: input.title, description: input.description, module: input.module, tags: input.tags, parent: input.parent, state: ACTIVE,
      kit: { program, journal: { runs: [] }, conversations },
    }).catch(error => { throw refusal(error); });
  };

  /** `{{id}}` and friends, from what earlier blocks gave. */
  const render = (text: string, outputs: Map<string, { text: string; links: string[]; url: string }>) => text.replace(TEMPLATE_REF, (_whole, id: string, field?: string) => {
    const out = outputs.get(id);
    if (!out) return '';
    return field === 'link' ? out.links[0] ?? '' : field === 'url' ? out.url : out.text;
  }).trim();
  /** The link of an action: https, no credentials or port, on the block's own approved domain; without a domain there is no link. */
  const linkOf = (block: { url?: string; domain?: string }, outputs: Parameters<typeof render>[1]): string | undefined => {
    if (!block.url) return undefined;
    const raw = render(block.url, outputs);
    if (!raw) return undefined;
    if (!block.domain) throw new MachinaError(400, 'Akcja nie ma zatwierdzonej domeny linku.');
    let url: URL;
    try { url = new URL(raw); } catch { throw new MachinaError(400, 'Niepoprawny link.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hostInDomain(url.hostname, block.domain)) throw new MachinaError(400, 'Link jest poza zatwierdzoną domeną akcji.');
    return url.href;
  };

  const saveRun = (uid: string, runId: string, patch: (run: MachinaRun, a: MachinaAutomat) => string | undefined | void) => change(uid, a => {
    const run = a.journal.runs.find(r => r.id === runId);
    if (!run) throw new MachinaError(404, 'Nie ma takiego runu.');
    return { state: patch(run, a) ?? undefined, result: undefined };
  });
  const record = (uid: string, runId: string, result: MachinaBlockResult) => saveRun(uid, runId, run => { run.blocks = [...run.blocks.filter(b => b.id !== result.id), result]; });

  /** Runs what is left of one reserved run. Reads are done again after a restart; an effect that was reserved is never sent twice. */
  const execute = async (uid: string, runId: string) => {
    live.add(runId);
    try {
      const start = await byUid(uid);
      const run = start.journal.runs.find(r => r.id === runId);
      if (!run || run.state !== 'running') return;
      const version = start.program.versions.find(v => v.number === run.version);
      if (!version) { await saveRun(uid, runId, r => { r.state = 'error'; r.error = 'Brak wersji programu tego runu.'; r.endedAt = now(); }); return; }
      // What a restart leaves: reads are repeated, a busy conversation is tried again, an effect whose key makes it safe is repeated, the rest stays "not confirmed".
      const results = new Map<string, MachinaBlockResult>();
      for (const kept of run.blocks) {
        if (kept.kind === 'fetch' || kept.kind === 'extract' || kept.result === 'waiting') continue;
        if (kept.result === 'pending') {
          if (kept.kind === 'notify') results.set(kept.id, { ...kept, result: 'error', error: 'Wynik niepotwierdzony po przerwaniu; nie ponawiam.' });
          continue;
        }
        results.set(kept.id, kept);
      }
      const outputs = new Map<string, { text: string; links: string[]; url: string }>();
      let aborted: string | undefined, finished = false, waiting = false;
      for (const block of version.blocks) {
        const done = results.get(block.id);
        if (done) { if (done.result !== run.blocks.find(b => b.id === block.id)?.result) await record(uid, runId, done); if (block.kind === 'finish' && done.result === 'ok') finished = true; continue; }
        const base = { id: block.id, kind: block.kind, at: now() };
        const put = async (result: MachinaBlockResult) => { results.set(block.id, result); await record(uid, runId, result); };
        if (aborted) { await put({ ...base, result: 'skipped', error: 'Pominięto: wcześniejszy odczyt się nie udał.' }); continue; }
        if (block.kind === 'fetch') {
          try {
            const page = await read(block.url, version.scope.domains);
            outputs.set(block.id, { text: pageText(page.text, page.url), links: [], url: page.url });
            await put({ ...base, result: 'ok', url: page.url });
          } catch (error) {
            aborted = error instanceof MachinaFetchError ? error.message : 'Nie udało się odczytać strony.';
            await put({ ...base, result: 'error', error: aborted });
          }
          continue;
        }
        if (block.kind === 'extract') {
          const source = outputs.get(block.from)!;
          const cut = cutBetween(source.text, block.after, block.before);
          if (!cut) { aborted = 'Brak wycinka: nie znaleziono fragmentu.'; await put({ ...base, result: 'error', error: aborted }); continue; }
          const text = cut.text.slice(0, MACHINA_LIMITS.extract), links = cut.links.slice(0, MACHINA_LIMITS.links);
          outputs.set(block.id, { text, links, url: source.url });
          await put({ ...base, result: 'ok', text, links, url: source.url });
          continue;
        }
        if (block.kind === 'finish') { finished = true; await put({ ...base, result: 'ok' }); continue; }
        // An effect needs the consent that holds now: a pause, a cancel or the switch stop it before it is reserved.
        const fresh = await byUid(uid);
        if (fresh.state !== ACTIVE || !enabled || !filaActive()) { await put({ ...base, result: 'skipped', error: 'Pominięto: automat nie jest aktywny.' }); continue; }
        const key = `${runId}:${block.id}`;
        const automation: ChatAutomation = { source: 'machina', reason: fresh.title.slice(0, 120) };
        try {
          const text = 'text' in block && block.text ? render(block.text, outputs) : undefined;
          if (block.kind === 'message' || block.kind === 'resume') {
            const chatId = block.kind === 'resume' && block.chat ? block.chat : fresh.program.chatId;
            if (!chatId) throw new MachinaError(409, 'Automat nie ma rozmowy.');
            if (!text) throw new MachinaError(400, 'Pusta treść.');
            await put({ ...base, result: 'pending' });
            if (block.kind === 'message') {
              if (!options.chat?.note) throw new MachinaError(503, 'Czat nie przyjmuje wpisów panelu.');
              await options.chat.note(chatId, { text, automation, key });
            } else {
              if (!options.chat?.sendAutomation) throw new MachinaError(503, 'Czat nie przyjmuje tur automatyki.');
              await options.chat.sendAutomation(chatId, { text, nonce: uuidOf(key), automation });
            }
            await put({ ...base, at: now(), result: 'ok', ref: chatId, text: text.slice(0, MACHINA_LIMITS.extract) });
            continue;
          }
          const title = render(block.title, outputs);
          if (!title) throw new MachinaError(400, 'Pusty tytuł.');
          const url = linkOf(block, outputs);
          const when = block.kind === 'calendarEvent' ? render(block.when, outputs) : undefined;
          if (!options.executeAction) throw new MachinaError(503, 'Akcje automatów są niedostępne.');
          await put({ ...base, result: 'pending', title: title.slice(0, MACHINA_LIMITS.title) });
          const approved = block.kind === 'calendarEvent' ? { kind: block.kind, domain: block.domain, reminderMinutes: block.reminderMinutes, allDay: block.allDay } : { kind: block.kind, domain: block.domain };
          const act = { runId: 'run-000000000000', token: '0'.repeat(32), action: block.kind, title: title.slice(0, MACHINA_LIMITS.title), ...(when ? { when } : {}), ...(url ? { url } : {}), ...(text ? { text: text.slice(0, 1000) } : {}) } as AutomationAct;
          const ref = await options.executeAction(act, approved, key, fresh.title);
          await put({ ...base, at: now(), result: 'ok', ref: ref ?? key, title: act.title, ...(act.text ? { text: act.text } : {}), ...(url ? { url } : {}) });
        } catch (error) {
          // A busy conversation is not a failure of the program: the same turn (same key) is tried again at the next tick.
          if (block.kind === 'resume' && error instanceof ChatError && (error.status === 409 || error.status >= 500) && now() - run.startedAt < WAITING_MS) {
            await put({ ...base, result: 'waiting', error: 'Rozmowa jest zajęta; ponowię.' });
            waiting = true;
            break;
          }
          const kept = results.get(block.id);
          await put({ ...base, ...(kept?.title ? { title: kept.title } : {}), result: 'error', error: (error instanceof Error ? error.message : 'Nie udało się.').slice(0, 500) || 'Nie udało się.' });
        }
      }
      if (waiting) return;
      await saveRun(uid, runId, (r, a) => {
        const failed = [...results.values()].find(b => b.result === 'error');
        r.state = failed ? 'error' : 'ok';
        if (failed) r.error = failed.error;
        r.endedAt = now();
        if (finished) return settle(a, DONE);
        if (a.program.nextRunAt === null && !a.journal.runs.some(other => other.state === 'running' && other.id !== r.id)) return settle(a, endState(a.program));
        return undefined;
      });
    } catch (error) {
      log(`run ${runId}: ${error instanceof Error ? error.message : 'błąd'}`);
    } finally {
      live.delete(runId);
    }
  };

  /** Writes the run down before anything of it happens, and moves the schedule on in the same write: one time, at most one run. */
  const reserve = (uid: string, slot: number, manual: boolean) => change(uid, a => {
    if (a.state !== ACTIVE || a.archived) throw new MachinaError(409, 'Uruchomić można tylko aktywny automat.');
    if (!manual && a.journal.runs.some(r => !r.manual && r.slot === slot)) return { result: null };
    const id = `mr-${randomBytes(6).toString('hex')}`;
    a.journal.runs.push({ id, slot, manual, version: a.program.current, startedAt: now(), state: 'running', blocks: [] });
    // A one-shot has only this one time; a cycle moves to its next time after this one (missed times do not pile up).
    if (!manual) { const trigger = currentOf(a.program).trigger; a.program.nextRunAt = isCyclic(trigger) ? nextRunFor(trigger, Math.max(slot, now())) ?? null : null; }
    return { result: id };
  });

  /** The one place runs are executed, one after another: first what was reserved and left (a restart, a busy conversation, „uruchom teraz”), then what the clock says is due. */
  const pump = () => pumping ??= (async () => {
    try {
      if (!enabled || !filaActive()) return;
      for (const a of await all()) {
        for (const run of a.journal.runs.filter(r => r.state === 'running' && !live.has(r.id))) {
          if (options.busy?.()) return;
          await execute(a.uid, run.id);
        }
      }
      for (const a of await all()) {
        if (a.state !== ACTIVE || a.archived) continue;
        if (a.program.nextRunAt === null) {
          // Nothing left to run and nothing running: the cycle ran out of time (or a one-shot was left behind by an old crash).
          if (!a.journal.runs.some(r => r.state === 'running')) await change(a.uid, fresh => ({ state: fresh.state === ACTIVE && fresh.program.nextRunAt === null ? endState(fresh.program) : undefined, result: undefined }));
          continue;
        }
        if (a.program.nextRunAt > now()) continue;
        if (options.busy?.()) return;
        const runId = await reserve(a.uid, a.program.nextRunAt, false).catch(error => { log(`${a.thread}: ${error instanceof Error ? error.message : 'błąd'}`); return null; });
        if (runId) await execute(a.uid, runId);
      }
    } catch (error) {
      log(`tick: ${error instanceof Error ? error.message : 'błąd'}`);
    } finally {
      pumping = undefined;
    }
  })();

  return {
    async decideCard(input, decision) {
      const parsed = machinaCardSchema.safeParse(input);
      if (!parsed.success) throw new MachinaError(400, `Niepoprawna karta programu (${parsed.error.issues[0]?.path.join('.') || 'karta'}: ${parsed.error.issues[0]?.message ?? 'błąd'}).`);
      const card = parsed.data;
      if (!decision.accept) return { decision: 'rejected' };
      assertEnabled();
      const content = { trigger: card.trigger, blocks: card.blocks, scope: card.scope };
      if (!card.automat) {
        const made = await create({ title: card.title!, description: card.description, module: card.module, tags: card.tags, parent: card.parent, chatId: decision.chatId, version: versionFrom(undefined, content, 'user', 'karta programu'), reason: 'projektowanie' });
        void pump();
        return { decision: 'created', thread: made.id, version: 1 };
      }
      const target = await byThread(card.automat);
      const version = await change(target.uid, a => {
        if (a.closed) throw new MachinaError(409, 'Zamkniętego automatu nie zmienia się: zaproponuj nowy.');
        const next = versionFrom(a, content, 'user', 'karta programu');
        if (a.program.versions.length >= MACHINA_LIMITS.versions) throw new MachinaError(409, `Program może mieć najwyżej ${MACHINA_LIMITS.versions} wersji.`);
        a.program.versions.push(next);
        a.program.current = next.number;
        a.program.nextRunAt = firstRun(next.trigger);
        if (decision.chatId && !a.conversations.items.some(item => item.chatId === decision.chatId)) a.conversations.items.push({ chatId: decision.chatId, reason: 'zmiana programu', at: now() });
        // A card is the consent a waiting automat needed; a paused one stays paused.
        return { state: a.state === WAITS_FOR_CARD ? ACTIVE : a.state === PAUSED ? (a.program.paused = { from: ACTIVE }, undefined) : undefined, result: next.number };
      });
      return { decision: 'updated', thread: target.thread, version };
    },

    async createReminder(input) {
      assertEnabled();
      const version = versionFrom(undefined, { trigger: { kind: 'once', at: input.at }, blocks: [{ id: 'b1', kind: input.kind, text: input.text }], scope: { domains: [], resumeChats: [] } }, 'wektor', 'bez karty');
      const made = await create({ title: input.title, description: input.text, module: 'Przypomnienia', chatId: input.chatId, version, reason: 'utworzenie bez karty' });
      return { thread: made.id };
    },

    async action(raw) {
      const parsed = machinaActionSchema.safeParse(raw);
      if (!parsed.success) throw new MachinaError(400, 'Niepoprawna akcja Machiny.');
      const input = parsed.data;
      assertWritable();
      const target = await byThread(input.thread);
      if (input.action === 'runNow') {
        assertEnabled();
        await reserve(target.uid, now(), true);
        void pump();
        return byUid(target.uid);
      }
      if (input.action === 'restore') assertEnabled();
      await change(target.uid, a => {
        if (a.closed) throw new MachinaError(409, 'Automat jest już zamknięty.');
        switch (input.action) {
          case 'pause':
            if (a.state === PAUSED) return { result: undefined };
            a.program.paused = { from: a.state };
            return { state: PAUSED, result: undefined };
          case 'resume': {
            if (a.state !== PAUSED) return { result: undefined };
            const back = a.program.paused?.from ?? ACTIVE;
            delete a.program.paused;
            // A cycle picks up from now; a one-shot whose time passed while it was paused still runs once.
            if (back === ACTIVE && isCyclic(currentOf(a.program).trigger)) a.program.nextRunAt = firstRun(currentOf(a.program).trigger);
            return { state: back, result: undefined };
          }
          case 'cancel':
            a.program.nextRunAt = null;
            delete a.program.paused;
            return { state: CANCELLED, result: undefined };
          default: {
            const old = a.program.versions.find(v => v.number === input.version);
            if (!old) throw new MachinaError(404, `Program nie ma wersji ${input.version}.`);
            if (old.number === a.program.current) throw new MachinaError(409, 'To jest bieżąca wersja programu.');
            // Stage 1b.2 checks a restored version against the samples; until it does, a program with samples is not restored.
            if (a.samples > 0) throw new MachinaError(409, 'Program ma próbki: przywrócenie wymaga kontroli zgodności próbek.');
            if (a.program.versions.length >= MACHINA_LIMITS.versions) throw new MachinaError(409, `Program może mieć najwyżej ${MACHINA_LIMITS.versions} wersji.`);
            const trigger = currentOf(a.program).trigger;
            const next = versionFrom(a, { trigger, blocks: old.blocks, scope: old.scope }, 'user', `przywrócenie wersji ${old.number}`, old.number);
            a.program.versions.push(next);
            a.program.current = next.number;
            return { result: undefined };
          }
        }
      });
      if (input.action === 'resume') void pump();
      return byUid(target.uid);
    },

    get: byThread,

    async effects() {
      const out: MachinaEffect[] = [];
      for (const a of await all()) for (const run of a.journal.runs) for (const block of run.blocks) {
        if ((block.kind !== 'smartAction' && block.kind !== 'notify') || (block.result !== 'ok' && block.result !== 'error') || !isMachinaEffect(block.kind)) continue;
        out.push({ thread: a.thread, name: a.title, cancelled: a.state === CANCELLED, runId: run.id, block: block.id, kind: block.kind, at: block.at, result: block.result, ref: block.ref ?? `${run.id}:${block.id}`, title: block.title ?? a.title, ...(block.text ? { text: block.text } : {}), ...(block.url ? { url: block.url } : {}) });
      }
      return out;
    },

    running: () => live.size > 0,
    tick: () => pump(),
    start() {
      if (timer || !enabled) return;
      timer = setInterval(() => { void pump(); }, CLOCK_MS);
      timer.unref();
      void pump();
    },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
  };
}
