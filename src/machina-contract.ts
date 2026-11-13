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
]);
export type MachinaBlock = z.infer<typeof machinaBlockSchema>;
export const MACHINA_EFFECTS = ['message', 'resume', 'notify', 'calendarEvent', 'smartAction'] as const;
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

/** The rules a program keeps whatever wrote it: ids once, a block reads only earlier blocks, a read stays in the approved scope. */
const checkProgram = (program: { blocks: MachinaBlock[]; scope: MachinaScope }, ctx: z.RefinementCtx) => {
  const seen = new Map<string, MachinaBlock['kind']>();
  program.blocks.forEach((block, i) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks', i], message });
    if (seen.has(block.id)) issue(`Duplicate block id ${block.id}`);
    if (block.kind === 'fetch' && !program.scope.domains.some(domain => hostInDomain(hostOf(block.url), domain))) issue('The address is outside the approved domains');
    // A link needs the domain the user approves for it; without one the action could never use the link.
    if ('url' in block && block.url && block.kind !== 'fetch' && !block.domain) issue('An action link needs its approved domain');
    if (block.kind === 'extract' && !['fetch', 'extract'].includes(seen.get(block.from) ?? '')) issue('An extract reads an earlier read or extract');
    if (block.kind === 'resume' && block.chat && !program.scope.resumeChats.includes(block.chat)) issue('The conversation to resume is outside the approved scope');
    if (block.kind !== 'fetch') for (const text of templatesOf(block)) for (const ref of text.matchAll(TEMPLATE_REF)) {
      if (!['fetch', 'extract'].includes(seen.get(ref[1]!) ?? '')) issue(`{{${ref[1]}}} is not an earlier read or extract`);
    }
    seen.set(block.id, block.kind);
  });
};
const blocks = z.array(machinaBlockSchema).min(1).max(MACHINA_LIMITS.blocks);

export const machinaVersionSchema = z.object({
  number: z.number().int().min(1), at: z.number().finite(),
  /** Whose decision made it: the user's card or direct restore, Wektor's card-free reminder, or the panel's own move from the old store. */
  by: z.enum(['user', 'wektor', 'panel']), reason: z.string().trim().min(1).max(MACHINA_LIMITS.reason),
  trigger: machinaTriggerSchema, blocks, scope: scopeSchema,
  restoredFrom: z.number().int().min(1).optional(),
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
  state: z.enum(['running', 'ok', 'error']), error: z.string().max(500).optional(),
  blocks: z.array(blockResultSchema).max(MACHINA_LIMITS.blocks),
}).strict();
export type MachinaRun = z.infer<typeof machinaRunSchema>;
/** Append-only: a run is added and filled in, never removed or rewritten once it ended. */
export const machinaJournalSchema = z.object({ runs: z.array(machinaRunSchema) }).strict();
export type MachinaJournal = z.infer<typeof machinaJournalSchema>;

/** Stage 1b.2 fills the catalogue; here it only says whether a situation has samples (a restore must then be checked against them). */
export const machinaSituationsSchema = z.object({ items: z.array(z.object({ id: z.string().min(1).max(40), samples: z.array(z.unknown()).default([]) }).passthrough()) }).strict();
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
  trigger: machinaTriggerSchema, blocks, scope: scopeSchema.default({ domains: [], resumeChats: [] }),
}).strict().superRefine((card, ctx) => {
  checkProgram(card, ctx);
  if (!card.automat && !card.title) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'A new automat needs a title' });
});
export type MachinaCard = z.input<typeof machinaCardSchema>;

/** What the user does directly, without a card. */
export const MACHINA_ACTIONS = ['pause', 'resume', 'cancel', 'runNow', 'restore'] as const;
export const machinaActionSchema = z.object({
  thread: z.string().trim().regex(/^[A-Za-z]{4}-[1-9][0-9]*$/), action: z.enum(MACHINA_ACTIONS),
  /** `restore`: the older version whose blocks and scope become a new version. */
  version: z.number().int().min(1).optional(),
}).strict().refine(a => (a.action === 'restore') === (a.version !== undefined), { message: 'version belongs to restore' });
export type MachinaAction = z.infer<typeof machinaActionSchema>;
