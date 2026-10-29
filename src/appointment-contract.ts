import { z } from 'zod';

const short = z.string().trim().min(1).max(200);
const day = z.iso.date();
export const appointmentQuerySchema = z.object({
  profile: z.string().max(500).refine(value => {
    try { const u = new URL(value); return u.protocol === 'https:' && ['www.znanylekarz.pl', 'znanylekarz.pl'].includes(u.hostname) && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/(?:profil\/[\w-]+|[\w-]+\/[\w-]+\/[\w-]+)\/?$/.test(u.pathname); } catch { return false; }
  }, 'Podaj adres profilu lekarza na https://www.znanylekarz.pl, bez parametrów.'),
  service: short,
  mode: z.enum(['online', 'gabinet', 'dowolnie']).default('dowolnie'),
  address: short.optional(),
  firstVisit: z.boolean().optional(),
  from: day.optional(), to: day.optional(),
}).strict();
export type AppointmentQuery = z.infer<typeof appointmentQuerySchema>;

export const calendarDraftSchema = z.object({
  title: z.string().trim().min(1).max(160), startAt: z.number().finite(), endAt: z.number().finite(),
  timeZone: z.string().min(1).max(80).default('Europe/Warsaw'),
  location: z.string().trim().max(300).default(''), description: z.string().trim().max(2000).default(''),
}).strict().refine(v => v.endAt > v.startAt && v.endAt - v.startAt <= 24 * 60 * 60_000, 'Koniec musi być po początku, najwyżej 24 h później.');
export type CalendarDraft = z.infer<typeof calendarDraftSchema>;
export const calendarProposalSchema = z.object({
  title: z.string().trim().min(1).max(160),
  start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }),
  location: z.string().trim().max(300).optional(), description: z.string().trim().max(2000).optional(),
}).strict().refine(v => Date.parse(v.end) > Date.parse(v.start) && Date.parse(v.end) - Date.parse(v.start) <= 24 * 60 * 60_000, 'Podaj początek i koniec, do 24 h.');
export type CalendarProposal = z.infer<typeof calendarProposalSchema>;

export const appointmentSlotSchema = z.object({ id: short, startAt: z.number().finite(), bookingUrl: z.url() });
export const appointmentPreviewSchema = z.object({
  id: z.string().regex(/^a-[a-f0-9]{32}$/), query: appointmentQuerySchema, observedAt: z.number().finite(),
  doctorId: z.string().regex(/^\d+$/), doctor: short, profileUrl: z.url(),
  addressId: z.string().regex(/^\d+$/), location: z.string().min(1).max(300), online: z.boolean(),
  serviceId: z.string().regex(/^\d+$/), service: short, price: z.number().nonnegative().nullable(), priceFrom: z.boolean(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(), timeZone: z.string().min(1).max(80),
  from: day, to: day, slots: z.array(appointmentSlotSchema).max(1500),
});
export type AppointmentPreview = z.infer<typeof appointmentPreviewSchema>;
export const isGoogleCalendarEventUrl = (value: string) => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['calendar.google.com', 'www.google.com'].includes(u.hostname) && u.pathname === '/calendar/event'; } catch { return false; }
};
export const calendarSavedSchema = z.object({ id: short, url: z.url().refine(isGoogleCalendarEventUrl), at: z.number().finite(), draft: calendarDraftSchema });
export type CalendarSaved = z.infer<typeof calendarSavedSchema>;
export const appointmentSelectionSchema = z.object({
  id: z.string().regex(/^s-[a-f0-9]{32}$/), slot: appointmentSlotSchema, draft: calendarDraftSchema.nullable(), at: z.number().finite(),
});
export type AppointmentSelection = z.infer<typeof appointmentSelectionSchema>;
export const appointmentViewSchema = z.object({
  preview: appointmentPreviewSchema, selection: appointmentSelectionSchema.nullable(),
  saved: calendarSavedSchema.nullable(), canWriteCalendar: z.boolean(),
  writeStarted: z.boolean().default(false),
});
export type AppointmentView = z.infer<typeof appointmentViewSchema>;
export const calendarPlanViewSchema = z.object({ draft: calendarDraftSchema, saved: calendarSavedSchema.nullable(), canWriteCalendar: z.boolean(), writeStarted: z.boolean().default(false) });
export type CalendarPlanView = z.infer<typeof calendarPlanViewSchema>;
export const calendarChoiceSchema = z.object({ title: z.string().trim().min(1).max(160).optional(), endAt: z.number().finite().optional() }).strict();
export const appointmentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('select'), slotId: short }).strict(),
  z.object({ action: z.literal('reset'), selectionId: short }).strict(),
  z.object({ action: z.literal('confirm'), selectionId: short, choice: calendarChoiceSchema.optional() }).strict(),
]);
export type AppointmentAction = z.infer<typeof appointmentActionSchema>;

/** The reference comes from the panel's tool answer, never from the model's arguments. */
export function appointmentReference(answer: unknown): string | null {
  let value = answer;
  for (let n = 0; n < 3; n++) {
    if (typeof value === 'string') { try { value = JSON.parse(value); continue; } catch { break; } }
    if (value && typeof value === 'object' && 'result' in value) { value = (value as { result: unknown }).result; continue; }
    break;
  }
  return typeof value === 'string' ? /\bref=(a-[a-f0-9]{32})\b/.exec(value)?.[1] ?? null : null;
}
