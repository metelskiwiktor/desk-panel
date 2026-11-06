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
/** The timing fields every slice has, whatever it measures. */
const timing = {
  /** Unique per slice (session + sequence): sending it again changes nothing. */
  id: z.string().regex(/^[a-z0-9]{8,32}:[0-9]{1,9}$/),
  browser: random,
  session: random,
  start: z.number().int().positive(),
  end: z.number().int().positive(),
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
};
type Timing = { start: number; end: number; noInteractionMs: number };
function checkTiming(s: Timing, fail: (message: string) => void) {
  const ms = s.end - s.start;
  if (ms <= 0 || ms > HOUR_MS) fail('slice length');
  else if (Math.floor(s.start / HOUR_MS) !== Math.floor((s.end - 1) / HOUR_MS)) fail('slice crosses an hour');
  if (s.noInteractionMs > ms) fail('no-interaction time over the slice');
}
const desktop = z.string().regex(/^[a-z0-9-]{1,20}$/);

export const usageSliceSchema = z.object({
  ...timing,
  view: z.enum(USAGE_VIEWS),
  /** The page when the view is a page. */
  page: z.enum(USAGE_PAGES).optional(),
  /** The kind of details when the view is `detail`. */
  detail: z.enum(USAGE_DETAILS).optional(),
  /** The desktop id (never its name), only on the home page. */
  pulpit: desktop.optional(),
}).strict().superRefine((s, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  checkTiming(s, fail);
  if ((s.view === 'page') !== (s.page !== undefined)) fail('page only on a page view');
  if ((s.view === 'detail') !== (s.detail !== undefined)) fail('detail kind only on a detail view');
  if (s.pulpit !== undefined && !(s.view === 'page' && s.page === 'home')) fail('desktop only on the home page');
});
export type UsageSlice = z.infer<typeof usageSliceSchema>;

/**
 * Exposure of one *area* (t-01c8aa59): a part of the panel that is on screen next to others. The closed list below is the
 * catalogue (docs/uzycie.md); an area is measured while any of it is visible and not wholly covered, in parallel with the other
 * areas and apart from the main views above. `tile` areas are the placed tiles of the work area (`kind` + `tile`);
 * `detail-*` areas may remember the tile they were opened from (`source`).
 */
export const USAGE_AREAS = [
  'clock', 'ambient', 'day-date', 'day-training', 'day-meetings', 'day-countdown', 'days',
  'chip-pc', 'chip-cezar', 'chip-gmail', 'bell', 'notifications', 'nav', 'pulpits',
  'page-tasks', 'page-calendar', 'page-system', 'page-events', 'page-automations',
  'settings-connections', 'settings-screen', 'settings-google', 'settings-limits', 'settings-warmup', 'settings-automations', 'settings-preview', 'settings-desktop', 'settings-sources', 'settings-warmup-history',
  'detail-task', 'detail-event', 'detail-quota', 'detail-mail', 'detail-workout', 'detail-breakdown', 'detail-system',
  'tile', 'wektor',
] as const;
export const USAGE_CHAT_MODES = ['full', 'compact', 'pointing'] as const;
const slug = z.string().regex(/^[a-z0-9-]{1,30}$/);
export const areaSliceSchema = z.object({
  ...timing,
  area: z.enum(USAGE_AREAS),
  /** The main page under the area (always present: an area is never outside a page). */
  page: z.enum(USAGE_PAGES),
  /** The desktop id (never its name), only on the home page. */
  pulpit: desktop.optional(),
  /** Widget kind of a tile (a technical id: `claude`, `agy-3fa9c1`, `mail`) and the id of the placed tile. */
  kind: slug.optional(),
  tile: z.string().regex(/^[a-z0-9#-]{1,40}$/).optional(),
  /** The kind of the tile a detail was opened from, when known. */
  source: slug.optional(),
  /** The state of the chat window, only on `wektor`. */
  chat: z.enum(USAGE_CHAT_MODES).optional(),
}).strict().superRefine((s, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  checkTiming(s, fail);
  if ((s.area === 'tile') !== (s.kind !== undefined && s.tile !== undefined)) fail('kind and tile only on a tile');
  if ((s.kind === undefined) !== (s.tile === undefined)) fail('kind and tile come together');
  if (s.source !== undefined && !s.area.startsWith('detail-')) fail('source only on details');
  if ((s.area === 'wektor') !== (s.chat !== undefined)) fail('chat mode only on the chat');
  if (s.pulpit !== undefined && s.page !== 'home') fail('desktop only on the home page');
  if (s.area === 'tile' && (s.page !== 'home' || s.pulpit === undefined)) fail('a tile stands on a desktop of the home page');
});
export type AreaSlice = z.infer<typeof areaSliceSchema>;
