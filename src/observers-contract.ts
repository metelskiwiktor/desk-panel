import { z } from 'zod';

/**
 * The one-shot observers of a conversation (`GET /api/observers`, `POST /api/observers/cancel`): things the chat agent
 * watches for the user — a Cezar task finishing or waiting for an answer, a pull request changing, a moment in time.
 * After one fires the panel sends exactly one automation turn with the instruction kept at creation, and the observer
 * leaves the active list. Everything stays on this computer (`~/.desk-panel/observers.json`, outside Git).
 */
export const observerKinds = ['cezar', 'pr', 'time'] as const;
export type ObserverKind = typeof observerKinds[number];

export const OBSERVER_KIND_LABELS: Record<ObserverKind, string> = {
  cezar: 'Task Cezara',
  pr: 'PR na GitHubie',
  time: 'Czas',
};

/** How many observers may be active at once; creating one above it is refused. */
export const MAX_ACTIVE_OBSERVERS = 10;
/** Every observer expires: a day after creation, and a time observer an hour after its moment. */
export const OBSERVER_TTL_MS = 24 * 60 * 60_000;
export const OBSERVER_TIME_EXTRA_MS = 60 * 60_000;

export const observerViewSchema = z.object({
  id: z.string().regex(/^o-[0-9a-f]{12}$/),
  kind: z.enum(observerKinds),
  /** A Cezar task (`projekt/uuid`), a PR URL, or the moment as the agent wrote it. */
  target: z.string().min(1).max(1000),
  /** What the automation turn says, verbatim. */
  instruction: z.string().min(1).max(2000),
  createdAt: z.number(),
  expiresAt: z.number(),
});
export type ObserverView = z.infer<typeof observerViewSchema>;

export const observerListSchema = z.object({ observers: z.array(observerViewSchema) });
export type ObserverList = z.infer<typeof observerListSchema>;

export const observerCancelSchema = z.object({ id: z.string().regex(/^o-[0-9a-f]{12}$/) }).strict();
