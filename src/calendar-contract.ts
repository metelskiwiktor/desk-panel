import { z } from 'zod';

export const calendarEventSchema = z.object({
  id: z.string(), title: z.string(), startAt: z.number().finite(), endAt: z.number().finite(),
  allDay: z.boolean(), startDate: z.string().optional(), endDate: z.string().optional(),
  description: z.string(), location: z.string().optional(), sourceUrl: z.url().optional(),
}).refine(e => e.endAt > e.startAt);
export const calendarSourceSchema = z.object({
  status: z.enum(['connected', 'offline', 'unavailable', 'loading']),
  observedAt: z.number().finite().nullable(), data: z.array(calendarEventSchema).nullable(),
  live: z.literal(true), name: z.literal('Google Calendar'),
  message: z.string().optional(), partial: z.boolean().optional(),
  calendarId: z.string(), timeZone: z.string().optional(),
});
export type CalendarSource = z.infer<typeof calendarSourceSchema>;
export const calendarConnectionSchema = z.object({
  status: z.enum(['connected', 'unavailable']), email: z.string(), reason: z.string().optional(),
});
export type CalendarConnection = z.infer<typeof calendarConnectionSchema>;
