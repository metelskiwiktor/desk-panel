import { z } from 'zod';

export const calendarEventSchema = z.object({
  id: z.string(), title: z.string(), startAt: z.number().finite(), endAt: z.number().finite(),
  allDay: z.boolean(), startDate: z.string().optional(), endDate: z.string().optional(),
  description: z.string(), location: z.string().optional(), sourceUrl: z.url().optional(),
  /** Google transparency: informational events do not block time. */
  busy: z.boolean().optional(),
}).refine(e => e.endAt > e.startAt);
export const calendarSourceSchema = z.object({
  status: z.enum(['connected', 'offline', 'unavailable', 'loading']),
  observedAt: z.number().finite().nullable(), data: z.array(calendarEventSchema).nullable(),
  live: z.literal(true), name: z.literal('Google Calendar'),
  message: z.string().optional(), partial: z.boolean().optional(),
  calendarId: z.string(), timeZone: z.string().optional(),
  /** Half-open interval actually read, never inferred from an empty event list. */
  coverage: z.object({ startAt: z.number().finite(), endAt: z.number().finite() }).optional(),
});
export type CalendarSource = z.infer<typeof calendarSourceSchema>;
