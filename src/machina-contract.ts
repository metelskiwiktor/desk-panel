import { z } from 'zod';
import { actionDomainSchema, triggerSchema, type AutomationTrigger } from './automation-contract';

export type { MachinaEffect } from './automation-contract';

/**
 * Machina: what an automat does, kept in the Machina kit of its Fila thread (docs/automaty.md, „Machina”). The thread is
 * the source of identity, title, purpose, Stan, Moduł and Tagi; the four kit parts below hold only how it works. A
 * program is a list of blocks the panel runs itself, without a model turn; every change of it is a new version.
 */
export const MACHINA_LIMITS = {
  blocks: 30, versions: 200, domains: 10, resumeChats: 5, text: 2000, title: 160, marker: 200,
  /** Characters of an extract kept in the journal and handed to later blocks. */
  extract: 4000, links: 40, active: 50, reason: 80,
  /** The catalogue: situations of one automat, samples kept per situation (the newest stay), blocks of one reaction, cards waiting at once. */
  situations: 60, samples: 20, reaction: 10, pending: 20,
} as const;

/** Stage 1 runs on time only: once, daily or weekly, exactly as the old automations schedule them. */
export type MachinaTrigger = Extract<AutomationTrigger, { kind: 'once' | 'daily' | 'weekly' }>;
export const machinaTriggerSchema = triggerSchema.refine(t => t.kind === 'once' || t.kind === 'daily' || t.kind === 'weekly', 'Machina stage 1 has time triggers only') as unknown as z.ZodType<MachinaTrigger>;

const blockId = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/);
const chatId = z.string().uuid();
/** Text of an action; `{{id}}` puts in the text an earlier block gave, `{{id.link}}` its first link, `{{id.url}}` the address it read. */
const template = (max: number) => z.string().trim().min(1).max(max);
const publicUrl = z.string().max(2000).refine(value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port; } catch { return false; } }, 'A public https address without credentials or a port');
const link = { url: template(2000).optional(), domain: actionDomainSchema.optional() };

export const machinaBlockSchema = z.discriminatedUnion('kind', [
  /** A public GET without sign-in, only inside the approved domains (also after a redirect). The page is data. */
  z.object({ id: blockId, kind: z.literal('fetch'), url: publicUrl }).strict(),
  /** The part of an earlier read between two literal markers (either may be left out), as text with tidy spacing plus its links. */
  z.object({ id: blockId, kind: z.literal('extract'), from: blockId, after: z.string().min(1).max(MACHINA_LIMITS.marker).optional(), before: z.string().min(1).max(MACHINA_LIMITS.marker).optional() }).strict(),
  /** An entry of the panel in a conversation; it starts no turn. */
  z.object({ id: blockId, kind: z.literal('message'), text: template(MACHINA_LIMITS.text) }).strict(),
  /** Starts a turn in a conversation with this text; without `chat` it is the conversation the automat came from. */
  z.object({ id: blockId, kind: z.literal('resume'), text: template(MACHINA_LIMITS.text), chat: chatId.optional() }).strict(),
  z.object({ id: blockId, kind: z.literal('notify'), title: template(MACHINA_LIMITS.title), text: template(1000).optional(), ...link }).strict(),
  z.object({ id: blockId, kind: z.literal('calendarEvent'), title: template(MACHINA_LIMITS.title), when: template(60), text: template(1000).optional(), reminderMinutes: z.number().int().min(0).max(40320).optional(), allDay: z.boolean().optional(), ...link }).strict(),
  z.object({ id: blockId, kind: z.literal('smartAction'), title: template(MACHINA_LIMITS.title), text: template(1000).optional(), ...link }).strict(),
  /** The program says so itself: after this block the automat is Zakończony. */
  z.object({ id: blockId, kind: z.literal('finish') }).strict(),
  /**
   * Compares an extract with the automat's catalogue of situations: a known one runs its approved reaction without a
   * model, anything else wakes Wektor to assess it. The last block of a program that has it.
   */
  z.object({ id: blockId, kind: z.literal('compare'), from: blockId }).strict(),
]);
export type MachinaBlock = z.infer<typeof machinaBlockSchema>;
export const MACHINA_EFFECTS = ['message', 'resume', 'notify', 'calendarEvent', 'smartAction'] as const;
export const MACHINA_BLOCK_LABELS: Record<MachinaBlock['kind'], string> = {
  fetch: 'Odczyt strony', extract: 'Wycinek', message: 'Wiadomość', resume: 'Wznowienie rozmowy', notify: 'Powiadomienie',
  calendarEvent: 'Wydarzenie w kalendarzu', smartAction: 'Alert z linkiem', finish: 'Zakończenie', compare: 'Porównanie z sytuacjami',
};
export const isMachinaEffect = (kind: string): kind is (typeof MACHINA_EFFECTS)[number] => (MACHINA_EFFECTS as readonly string[]).includes(kind);

/** What the card approves beyond the blocks themselves: where a read may go and which other conversations may be resumed. */
const scopeSchema = z.object({
  domains: z.array(actionDomainSchema).max(MACHINA_LIMITS.domains).default([]),
  resumeChats: z.array(chatId).max(MACHINA_LIMITS.resumeChats).default([]),
}).strict();
export type MachinaScope = z.infer<typeof scopeSchema>;

/** `host` is `domain` itself or a subdomain of it (whole labels). */
export const hostInDomain = (host: string, domain: string) => { const h = host.toLowerCase().replace(/\.$/, ''); return h === domain || h.endsWith(`.${domain}`); };
const hostOf = (address: string) => { try { return new URL(address).hostname; } catch { return ''; } };
export const TEMPLATE_REF = /\{\{\s*([a-z][a-z0-9-]{0,23})(?:\.(text|link|url))?\s*\}\}/g;
const templatesOf = (block: MachinaBlock): string[] => Object.entries(block).filter(([key, value]) => typeof value === 'string' && !['id', 'kind', 'from', 'chat', 'domain', 'after', 'before'].includes(key)).map(([, value]) => value as string);

/** The id of the panel's own notice in a run that needs a repair; no block of a program takes it. */
export const MACHINA_REPAIR_NOTICE = 'naprawa';
const situationId = z.string().regex(/^s-[a-z0-9][a-z0-9-]{0,29}$/);
/** What follows a recognised situation: actions and, when the situation ends the automat, `finish`. No reads. */
const reactionKinds = new Set<string>([...MACHINA_EFFECTS, 'finish']);

/** The rules a program keeps whatever wrote it: ids once, a block reads only earlier blocks, a read stays in the approved scope. */
const checkProgram = (program: { blocks: MachinaBlock[]; scope: MachinaScope; reactions?: Record<string, MachinaBlock[]> }, ctx: z.RefinementCtx) => {
  const seen = new Map<string, MachinaBlock['kind']>();
  const reactions = Object.entries(program.reactions ?? {});
  const all: { block: MachinaBlock; path: (string | number)[]; reaction: boolean }[] = [
    ...program.blocks.map((block, i) => ({ block, path: ['blocks', i], reaction: false })),
    ...reactions.flatMap(([id, list]) => list.map((block, i) => ({ block, path: ['reactions', id, i], reaction: true }))),
  ];
  const compares = program.blocks.filter(block => block.kind === 'compare');
  if (compares.length > 1 || (compares.length === 1 && program.blocks.at(-1)!.kind !== 'compare')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks'], message: 'A program has at most one compare block, and it is the last one' });
  if (reactions.length && !compares.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reactions'], message: 'Reactions need a compare block' });
  // With a comparison every effect belongs to a reaction: nothing may happen before the panel knows the situation.
  if (compares.length) program.blocks.forEach((block, i) => { if (!['fetch', 'extract', 'compare'].includes(block.kind)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks', i], message: 'A program with a comparison reads only; its actions go into reactions' }); });
  all.forEach(({ block, path, reaction }) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (block.id === MACHINA_REPAIR_NOTICE) issue(`The id ${MACHINA_REPAIR_NOTICE} is the panel's own`);
    if (reaction && !reactionKinds.has(block.kind)) issue('A reaction has actions and finish only');
    if (block.kind === 'compare' && seen.get(block.from) !== 'extract') issue('A comparison reads an earlier extract');
    if (block.kind === 'fetch' && !program.scope.domains.some(domain => hostInDomain(hostOf(block.url), domain))) issue('The address is outside the approved domains');
    // A link needs the domain the user approves for it; without one the action could never use the link.
    if ('url' in block && block.url && block.kind !== 'fetch' && !block.domain) issue('An action link needs its approved domain');
    if (block.kind === 'extract' && !['fetch', 'extract'].includes(seen.get(block.from) ?? '')) issue('An extract reads an earlier read or extract');
    if (block.kind === 'resume' && block.chat && !program.scope.resumeChats.includes(block.chat)) issue('The conversation to resume is outside the approved scope');
    if (block.kind !== 'fetch') for (const text of templatesOf(block)) for (const ref of text.matchAll(TEMPLATE_REF)) {
      if (!['fetch', 'extract'].includes(seen.get(ref[1]!) ?? '')) issue(`{{${ref[1]}}} is not an earlier read or extract`);
      // A reaction may run later than its reads (after a card): the journal keeps extracts and addresses, not whole pages.
      else if (reaction && seen.get(ref[1]!) === 'fetch' && ref[2] !== 'url') issue(`A reaction takes only the address of a page: {{${ref[1]}.url}}`);
    }
    if (!reaction) seen.set(block.id, block.kind);
  });
  // Ids are unique across the program and all its reactions: a run's results are kept by block id.
  const ids = all.map(item => item.block.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks'], message: 'Block ids repeat across the program and its reactions' });
};
const blocks = z.array(machinaBlockSchema).min(1).max(MACHINA_LIMITS.blocks);
const reaction = z.array(machinaBlockSchema).max(MACHINA_LIMITS.reaction);
/** Situation id → what the panel does when a run recognises it (may be nothing: „bez zmian”). Changed only by a program card. */
const reactions = z.record(situationId, reaction).default({});

export const machinaVersionSchema = z.object({
  number: z.number().int().min(1), at: z.number().finite(),
  /** Whose decision made it: the user's card or direct restore, Wektor's card-free reminder, or the panel's own move from the old store. */
  by: z.enum(['user', 'wektor', 'panel']), reason: z.string().trim().min(1).max(MACHINA_LIMITS.reason),
  trigger: machinaTriggerSchema, blocks, scope: scopeSchema, reactions,
  restoredFrom: z.number().int().min(1).optional(),
  /** The chat card (`chatId:toolCallId`) this version came from: an answer applied twice makes it once. */
  card: z.string().max(300).optional(),
}).strict().superRefine(checkProgram);
export type MachinaVersion = z.infer<typeof machinaVersionSchema>;

export const machinaProgramSchema = z.object({
  current: z.number().int().min(1),
  versions: z.array(machinaVersionSchema).min(1).max(MACHINA_LIMITS.versions),
  /** The next time the clock runs it; null = nothing scheduled. */
  nextRunAt: z.number().finite().nullable(),
  /** The conversation the automat came from: where `message` writes and a bare `resume` goes. */
  chatId: chatId.nullable(),
  /** Set while Wstrzymany: the Stan to return to. */
  paused: z.object({ from: z.string().min(1).max(60) }).strict().optional(),
}).strict();
export type MachinaProgram = z.infer<typeof machinaProgramSchema>;

const blockResultSchema = z.object({
  id: blockId, kind: z.string().max(30), at: z.number().finite(),
  /** `pending`: reserved before the effect; after a crash it means "not confirmed". `waiting`: the conversation was busy, tried again at the next tick. */
  result: z.enum(['ok', 'error', 'pending', 'waiting', 'skipped']),
  /** A compare block: the situation the extract was recognised as, or the card it waits on (or joined). */
  situation: z.string().max(40).optional(), card: z.string().max(40).optional(),
  error: z.string().max(500).optional(),
  text: z.string().max(MACHINA_LIMITS.extract).optional(), links: z.array(z.string().max(2000)).max(MACHINA_LIMITS.links).optional(),
  url: z.string().max(2000).optional(), title: z.string().max(MACHINA_LIMITS.title).optional(), ref: z.string().max(500).optional(),
  /** The time of a calendar event as it was worked out when the effect was reserved. */
  when: z.string().max(60).optional(),
}).strict();
export type MachinaBlockResult = z.infer<typeof blockResultSchema>;
export const machinaRunSchema = z.object({
  id: z.string().regex(/^mr-[0-9a-f]{12}$/),
  /** The scheduled time this run is for (one run per time), or the moment of „uruchom teraz”. */
  slot: z.number().finite(), manual: z.boolean(),
  version: z.number().int().min(1), startedAt: z.number().finite(), endedAt: z.number().finite().optional(),
  /** `evaluating`: Wektor's turn is assessing the extract. `waiting`: a card waits for the user; the decision and the reaction are written into this same run later. */
  state: z.enum(['running', 'evaluating', 'waiting', 'ok', 'error']), error: z.string().max(500).optional(),
  blocks: z.array(blockResultSchema).max(MACHINA_LIMITS.blocks + MACHINA_LIMITS.reaction + 1),
  /** The conversation of this run's assessment or repair (at most one per run), and what that turn really cost when Hermes said so. */
  chatId: chatId.optional(), costUsd: z.number().nonnegative().optional(),
}).strict();
export type MachinaRun = z.infer<typeof machinaRunSchema>;
/**
 * The history of an old automation this automat was moved from (DESK-87): read-only, outside the runs, and never material
 * for a program. `id` (a-…) is how a repeated move finds the thread it already made.
 */
const legacySchema = z.object({
  id: z.string().regex(/^a-[0-9a-f]{12}$/), name: z.string().max(120), goal: z.string().max(4000), trigger: triggerSchema,
  status: z.enum(['active', 'paused', 'done', 'expired', 'cancelled']), actions: z.array(z.string().max(30)).max(20),
  notebook: z.string().max(4000), createdAt: z.number(), movedAt: z.number(),
  runs: z.array(z.object({ at: z.number(), outcome: z.string().max(20), summary: z.string().max(1000), chatId: z.string().max(200), costUsd: z.number().nonnegative().optional() }).strict()).max(100),
}).strict();
/** Append-only: a run is added and filled in, never removed or rewritten once it ended. */
export const machinaJournalSchema = z.object({ runs: z.array(machinaRunSchema), legacy: legacySchema.optional() }).strict();
export type MachinaJournal = z.infer<typeof machinaJournalSchema>;

/** An extract of a run that confirmed a situation: text with tidy spacing and its links, compared exactly. */
const sampleSchema = z.object({ runId: z.string().max(40), at: z.number().finite(), text: z.string().max(MACHINA_LIMITS.extract), links: z.array(z.string().max(2000)).max(MACHINA_LIMITS.links) }).strict();
/**
 * A recognised look of the watched source. It belongs to the automat and outlives program versions; the catalogue only
 * grows. Without a sample it is a predicted situation (its reaction was approved in advance); a withdrawn one stays in
 * the catalogue with its history and never matches again.
 */
const situationSchema = z.object({
  id: situationId, name: z.string().trim().min(1).max(MACHINA_LIMITS.title), note: z.string().max(1000).optional(), createdAt: z.number().finite(),
  samples: z.array(sampleSchema).max(MACHINA_LIMITS.samples).default([]),
  withdrawn: z.object({ at: z.number().finite() }).strict().optional(),
}).strict();
/** A new situation Wektor proposed from a run's extract, waiting for the user: later runs with the same extract join it instead of asking again. */
const pendingSituationSchema = z.object({
  id: z.string().regex(/^mc-[0-9a-f]{12}$/), at: z.number().finite(),
  /** The run the reaction will be done in, and the later runs that saw the same extract. */
  runId: z.string().max(40), runs: z.array(z.string().max(40)).max(500),
  text: z.string().max(MACHINA_LIMITS.extract), links: z.array(z.string().max(2000)).max(MACHINA_LIMITS.links),
  name: z.string().trim().min(1).max(MACHINA_LIMITS.title), note: z.string().max(1000).optional(), reaction,
  chatId: chatId.optional(),
}).strict();
export type MachinaPendingSituation = z.infer<typeof pendingSituationSchema>;
export const machinaSituationsSchema = z.object({
  items: z.array(situationSchema).max(MACHINA_LIMITS.situations).default([]),
  pending: z.array(pendingSituationSchema).max(MACHINA_LIMITS.pending).default([]),
}).strict();
export type MachinaSituations = z.infer<typeof machinaSituationsSchema>;
/** How two extracts are compared: text and links, spacing made even. */
export const sampleKey = (text: string, links: readonly string[]) => `${text.replace(/\s+/gu, ' ').trim()}\n${links.map(link => link.trim()).join('\n')}`;
export const machinaConversationsSchema = z.object({
  items: z.array(z.object({ chatId, reason: z.string().min(1).max(MACHINA_LIMITS.reason), at: z.number().finite(), runId: z.string().max(40).optional() }).strict()),
}).strict();
export type MachinaConversations = z.infer<typeof machinaConversationsSchema>;

/** What a program card asks the user to approve: a new automat (thread + first version), or a new version of an existing one. */
export const machinaCardSchema = z.object({
  /** The thread of the automat to change; without it the card makes a new one. */
  automat: z.string().trim().regex(/^[A-Za-z]{4}-[1-9][0-9]*$/).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  /** The purpose, in the user's words; it becomes the thread's description. */
  description: z.string().max(20_000).optional(),
  module: z.string().trim().min(1).max(60).optional(), tags: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  parent: z.string().trim().regex(/^[A-Za-z]{4}-[1-9][0-9]*$/).optional(),
  trigger: machinaTriggerSchema, blocks, scope: scopeSchema.default({ domains: [], resumeChats: [] }), reactions,
  /**
   * Situations the card speaks of: new predicted ones (an id the catalogue does not have yet; no sample), and, when it
   * wants to say so, which known sample texts it takes for which situation. A sample the catalogue keeps under another
   * situation makes the card contradictory: it is refused.
   */
  situations: z.array(z.object({ id: situationId, name: z.string().trim().min(1).max(MACHINA_LIMITS.title), note: z.string().max(1000).optional(), samples: z.array(z.string().max(MACHINA_LIMITS.extract)).max(MACHINA_LIMITS.samples).optional() }).strict()).max(MACHINA_LIMITS.situations).default([]),
}).strict().superRefine((card, ctx) => {
  checkProgram(card, ctx);
  if (!card.automat && !card.title) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'A new automat needs a title' });
});
export type MachinaCard = z.input<typeof machinaCardSchema>;

/** Wektor's verdict on an extract no known sample matches, given inside its own assessment turn (`runId` and `token` come from that turn's text). */
const verdict = { runId: z.string().regex(/^mr-[0-9a-f]{12}$/), token: z.string().regex(/^[0-9a-f]{32}$/) };
/** It is a known (or predicted) situation: no card; the panel adds the sample and does that situation's reaction in this run. */
export const machinaAssessSchema = z.object({ ...verdict, situation: situationId }).strict();
/** It is a new situation: a card for the user with its name and the reaction to approve; the reaction is done in this run after a yes. */
export const machinaSituationCardSchema = z.object({ ...verdict, name: z.string().trim().min(1).max(MACHINA_LIMITS.title), note: z.string().max(1000).optional(), reaction }).strict();
/** A correction of an assessment: the sample of `runId` moves from one situation to another, and the wrong situation may be withdrawn. Always a card. */
export const machinaCorrectionSchema = z.object({
  automat: z.string().trim().regex(/^[A-Za-z]{4}-[1-9][0-9]*$/), from: situationId, runId: z.string().regex(/^mr-[0-9a-f]{12}$/), to: situationId, withdraw: z.boolean().optional(),
}).strict().refine(c => c.from !== c.to, { message: 'The sample already is in that situation' });
export type MachinaCorrection = z.infer<typeof machinaCorrectionSchema>;

/** Wektor's one card-free automat: a one-shot that writes to, or resumes, the conversation of the turn it is made in. */
export const machinaReminderSchema = z.object({
  title: z.string().trim().min(1).max(200), at: z.number().int().positive(), kind: z.enum(['message', 'resume']), text: template(MACHINA_LIMITS.text),
}).strict();

/** The user's answer on a Machina card in a conversation; what it approves is the conversation's own tool call, never the request. */
export const machinaDecisionSchema = z.object({ toolCallId: z.string().min(1).max(200), decision: z.enum(['accept', 'reject']) }).strict();
/** What came of an answered card, kept per tool call: a second click gets the same answer and changes nothing. */
export const machinaOutcomeSchema = z.object({
  /** created/updated: a program card; accepted: a new situation; applied: a correction; rejected: any of them. */
  decision: z.enum(['created', 'updated', 'accepted', 'applied', 'rejected']), at: z.number(),
  thread: z.string().max(40).optional(), version: z.number().int().min(1).optional(), situation: z.string().max(40).optional(),
}).strict();
export type MachinaOutcome = z.infer<typeof machinaOutcomeSchema>;

/** What the user does directly, without a card. */
export const MACHINA_ACTIONS = ['pause', 'resume', 'cancel', 'runNow', 'restore'] as const;
export const machinaActionSchema = z.object({
  thread: z.string().trim().regex(/^[A-Za-z]{4}-[1-9][0-9]*$/), action: z.enum(MACHINA_ACTIONS),
  /** `restore`: the older version whose blocks and scope become a new version. */
  version: z.number().int().min(1).optional(),
}).strict().refine(a => (a.action === 'restore') === (a.version !== undefined), { message: 'version belongs to restore' });
export type MachinaAction = z.infer<typeof machinaActionSchema>;
