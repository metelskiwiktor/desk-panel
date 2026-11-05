import { z } from 'zod';

/**
 * Usage measurement (docs/uzycie.md): one *slice* is a stretch of time in which one main view was on screen and
 * observed without a break. The browser cuts slices at view changes, at every clock hour (epoch hours are whole hours in
 * Europe/Warsaw too), at gaps in observation and at every flush; the server only adds them up. Only fixed enums, ids made
 * of random characters and numbers are accepted: nothing the user typed and no content can be written.
 */
export const USAGE_VIEWS = ['ambient', 'chat', 'detail', 'page'] as const;
export const USAGE_PAGES = ['home', 'tasks', 'calendar', 'system', 'events', 'automations', 'settings'] as const;
export const USAGE_DETAILS = ['task', 'event', 'quota', 'mail', 'workout', 'breakdown', 'system'] as const;
export const HOUR_MS = 3_600_000;
export const USAGE_TIME_ZONE = 'Europe/Warsaw';

const random = z.string().regex(/^[a-z0-9]{8,32}$/);
export const usageSliceSchema = z.object({
  /** Unique per slice (session + sequence): sending it again changes nothing. */
  id: z.string().regex(/^[a-z0-9]{8,32}:[0-9]{1,9}$/),
  browser: random,
  session: random,
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  view: z.enum(USAGE_VIEWS),
  /** The page when the view is a page. */
  page: z.enum(USAGE_PAGES).optional(),
  /** The kind of details when the view is `detail`. */
  detail: z.enum(USAGE_DETAILS).optional(),
  /** The desktop id (never its name), only on the home page. */
  pulpit: z.string().regex(/^[a-z0-9-]{1,20}$/).optional(),
  /** Window size rounded to 50 px. */
  width: z.number().int().min(0).max(20_000),
  height: z.number().int().min(0).max(20_000),
  /** The view was entered at the start of this slice (not just continued after a flush or an hour change). */
  entry: z.boolean(),
  /** The visit (entry … change of view, hidden tab or gap) ends with this slice; `touched` tells if it had any interaction. */
  visitEnd: z.boolean(),
  touched: z.boolean(),
  /** Time of the slice before the first interaction of the tab session. */
  noInteractionMs: z.number().int().min(0),
  /** Integral of "seconds since the last interaction" over the part of the slice after the first interaction, in s·s. */
  ageIntegral: z.number().min(0),
  /** The longest time since the last interaction reached in the slice. */
  maxAgeMs: z.number().int().min(0),
}).strict().superRefine((s, ctx) => {
  const ms = s.end - s.start;
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (ms <= 0 || ms > HOUR_MS) fail('slice length');
  else if (Math.floor(s.start / HOUR_MS) !== Math.floor((s.end - 1) / HOUR_MS)) fail('slice crosses an hour');
  if (s.noInteractionMs > ms) fail('no-interaction time over the slice');
  if ((s.view === 'page') !== (s.page !== undefined)) fail('page only on a page view');
  if ((s.view === 'detail') !== (s.detail !== undefined)) fail('detail kind only on a detail view');
  if (s.pulpit !== undefined && !(s.view === 'page' && s.page === 'home')) fail('desktop only on the home page');
});
export type UsageSlice = z.infer<typeof usageSliceSchema>;
