import { createHash, randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  appointmentActionSchema, appointmentPreviewSchema, appointmentSelectionSchema, appointmentViewSchema, calendarChoiceSchema,
  calendarDraftSchema, calendarPlanViewSchema, calendarProposalSchema, calendarSavedSchema,
  type AppointmentAction, type AppointmentPreview, type AppointmentQuery, type AppointmentView, type CalendarDraft, type CalendarPlanView, type CalendarProposal, type CalendarSaved,
} from '../src/appointment-contract';
import { AppointmentError } from './znanylekarz';
import { calendarDraftHash } from './calendar-write';

const choiceSchema = z.object({ ref: z.string(), selection: appointmentSelectionSchema });
const writeSchema = z.object({ key: z.string(), draft: calendarDraftSchema, saved: calendarSavedSchema.nullable() });
const storeSchema = z.object({ version: z.literal(1), previews: z.record(z.string(), appointmentPreviewSchema), choices: z.record(z.string(), choiceSchema), writes: z.record(z.string(), writeSchema) });
type Store = z.infer<typeof storeSchema>;
const empty = (): Store => ({ version: 1, previews: {}, choices: {}, writes: {} });
export interface AppointmentService {
  propose(query: AppointmentQuery): Promise<AppointmentPreview>;
  view(binding: string, ref: string): Promise<AppointmentView>;
  act(binding: string, ref: string, action: AppointmentAction): Promise<AppointmentView>;
  calendarView(binding: string, plan: CalendarProposal): Promise<CalendarPlanView>;
  calendarConfirm(binding: string, plan: CalendarProposal, choice?: z.infer<typeof calendarChoiceSchema>): Promise<CalendarPlanView>;
}
export interface AppointmentPersistence { read(): Promise<unknown>; write(value: unknown): Promise<void> }
/** A durable user decision, kept privately. Reads never book or write to Google. Only a browser's confirmed action writes. */
export function createAppointments({ read, writeCalendar, canWriteCalendar, persistence, now = Date.now }: {
  read(query: AppointmentQuery, fresh?: boolean): Promise<AppointmentPreview>;
  writeCalendar(key: string, draft: CalendarDraft): Promise<CalendarSaved>;
  canWriteCalendar(): Promise<boolean>;
  persistence?: AppointmentPersistence; now?: () => number;
}): AppointmentService {
  let store: Store | undefined;
  let queue = Promise.resolve();
  async function load() {
    if (store) return store;
    try { store = persistence ? storeSchema.parse(await persistence.read()) : empty(); }
    catch (error) { if ((error as { code?: string }).code === 'ENOENT') store = empty(); else throw new AppointmentError(503, 'Nie można bezpiecznie odczytać zapisanych kart wizyt. Nie zmieniono danych.'); }
    return store;
  }
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run); queue = next.then(() => {}, () => {}); return next;
  }
  async function save(next: Store) {
    try { await persistence?.write(next); store = next; }
    catch { throw new AppointmentError(503, 'Nie udało się bezpiecznie zapisać stanu karty. Ponów tę samą operację.'); }
  }
  const previewOf = (s: Store, ref: string) => { const preview = s.previews[ref]; if (!preview) throw new AppointmentError(409, 'Nie ma już tego odczytu terminów. Poproś Wektora o nową kartę.'); return preview; };
  const bindingKey = (binding: string) => createHash('sha256').update(binding).digest('hex');
  function draftOf(preview: AppointmentPreview, startAt: number): CalendarDraft | null {
    return preview.durationMinutes === null ? null : calendarDraftSchema.parse({ title: `Wizyta — ${preview.doctor}`.slice(0, 160), startAt, endAt: startAt + preview.durationMinutes * 60_000, timeZone: preview.timeZone,
      location: preview.location, description: `${preview.service}\n${preview.profileUrl}\nRezerwację na ZnanyLekarz potwierdził użytkownik w Desk Panelu.` });
  }
  async function view(binding: string, ref: string): Promise<AppointmentView> {
    const s = await load(), preview = previewOf(s, ref), key = bindingKey(binding);
    const choice = s.choices[key];
    if (choice && choice.ref !== ref) throw new AppointmentError(409, 'Karta dotyczy innego odczytu terminów. Odśwież rozmowę.');
    const write = s.writes[key];
    return appointmentViewSchema.parse({ preview, selection: choice ? { ...choice.selection, draft: write?.draft ?? choice.selection.draft } : null, saved: write?.saved ?? null, writeStarted: !!write, canWriteCalendar: await canWriteCalendar() });
  }
  async function commit(key: string, eventKey: string, raw: CalendarDraft) {
    const s = await load(), known = s.writes[key];
    if (known?.saved) return known.saved;
    const draft = calendarDraftSchema.parse(raw);
    if (known && (known.key !== eventKey || calendarDraftHash(known.draft) !== calendarDraftHash(draft))) throw new AppointmentError(409, 'Zapis tego wydarzenia już rozpoczęto. Ponów z tymi samymi danymi.');
    if (!DateTime.fromMillis(draft.startAt, { zone: draft.timeZone }).isValid || (!known && draft.startAt <= now())) throw new AppointmentError(409, 'Termin minął lub ma nieprawidłową strefę. Poproś o nową propozycję.');
    if (!await canWriteCalendar()) throw new AppointmentError(409, 'Połącz ponownie konto Google w Ustawieniach i zezwól na tworzenie wydarzeń.');
    // Freeze the event before sending it. A failure after insert retries exactly the same Google id and payload.
    if (!known) await save({ ...s, writes: { ...s.writes, [key]: { key: eventKey, draft, saved: null } } });
    const saved = await writeCalendar(eventKey, draft);
    const current = await load();
    await save({ ...current, writes: { ...current.writes, [key]: { key: eventKey, draft, saved } } });
    return saved;
  }
  const fromPlan = (raw: CalendarProposal) => { const p = calendarProposalSchema.parse(raw); return calendarDraftSchema.parse({ title: p.title, startAt: Date.parse(p.start), endAt: Date.parse(p.end), location: p.location ?? '', description: p.description ?? '', timeZone: 'Europe/Warsaw' }); };
  const planView = async (binding: string, plan: CalendarProposal): Promise<CalendarPlanView> => {
    const s = await load(), write = s.writes[bindingKey(binding)];
    return calendarPlanViewSchema.parse({ draft: write?.draft ?? fromPlan(plan), saved: write?.saved ?? null, writeStarted: !!write, canWriteCalendar: await canWriteCalendar() });
  };
  return {
    propose(query) { return serial(async () => {
      const preview = appointmentPreviewSchema.parse(await read(query));
      const s = await load();
      const retained = Object.values(s.previews).sort((a, b) => b.observedAt - a.observedAt);
      const selected = new Set(Object.values(s.choices).map(c => c.ref));
      const previews = Object.fromEntries(retained.filter((p, i) => i < 100 || selected.has(p.id)).map(p => [p.id, p]));
      await save({ ...s, previews: { ...previews, [preview.id]: preview } });
      return preview;
    }); },
    view: (binding, ref) => serial(() => view(binding, ref)),
    act(binding, ref, raw) { return serial(async () => {
      const action = appointmentActionSchema.parse(raw), s = await load(), preview = previewOf(s, ref), key = bindingKey(binding);
      const known = s.choices[key];
      if (known && known.ref !== ref) throw new AppointmentError(409, 'Karta dotyczy innego odczytu terminów.');
      if (action.action === 'select') {
        if (s.writes[key]) throw new AppointmentError(409, 'Zapis wydarzenia już rozpoczęto. Nie można zmienić terminu tej karty.');
        const slot = preview.slots.find(v => v.id === action.slotId);
        if (!slot || slot.startAt <= now()) throw new AppointmentError(409, 'Nie ma takiego przyszłego terminu na tej karcie.');
        const current = await read(preview.query, true);
        const sameService = current.doctorId === preview.doctorId && current.addressId === preview.addressId && current.serviceId === preview.serviceId;
        const freshSlot = current.slots.find(v => v.id === action.slotId && v.startAt === slot.startAt);
        if (!sameService || !freshSlot) throw new AppointmentError(409, 'Ten termin nie jest już dostępny. Poproś Wektora o aktualną kartę.');
        if (current.durationMinutes !== preview.durationMinutes || current.price !== preview.price || current.priceFrom !== preview.priceFrom) throw new AppointmentError(409, 'Cena lub czas wizyty zmieniły się. Poproś Wektora o aktualną kartę przed rezerwacją.');
        const selection = { id: `s-${randomBytes(16).toString('hex')}`, slot: freshSlot, draft: draftOf(preview, slot.startAt), at: now() };
        await save({ ...s, choices: { ...s.choices, [key]: { ref, selection } } });
      } else {
        if (!known || known.selection.id !== action.selectionId) throw new AppointmentError(409, 'Wybrany termin zmienił się. Odśwież kartę i sprawdź go ponownie.');
        if (action.action === 'reset') {
          if (s.writes[key]) throw new AppointmentError(409, 'Zapis wydarzenia już rozpoczęto. Nie można zmienić terminu tej karty.');
          const choices = { ...s.choices }; delete choices[key]; await save({ ...s, choices });
        } else {
          // Never recheck availability after booking: a correctly booked slot is supposed to disappear.
          const original = known.selection.draft;
          if (!original && action.choice?.endAt === undefined) throw new AppointmentError(400, 'ZnanyLekarz nie podał czasu trwania. Uzupełnij godzinę zakończenia przed zapisem.');
          const draft = calendarDraftSchema.parse({ ...(original ?? { title: `Wizyta — ${preview.doctor}`.slice(0, 160), startAt: known.selection.slot.startAt, timeZone: preview.timeZone, location: preview.location, description: `${preview.service}\n${preview.profileUrl}` }), ...action.choice });
          await commit(key, `znanylekarz:${preview.doctorId}:${preview.addressId}:${preview.serviceId}:${draft.startAt}`, draft);
        }
      }
      return view(binding, ref);
    }); },
    calendarView: (binding, plan) => serial(() => planView(binding, plan)),
    calendarConfirm(binding, plan, choice) { return serial(async () => {
      const parsed = calendarChoiceSchema.parse(choice ?? {});
      const draft = calendarDraftSchema.parse({ ...fromPlan(plan), ...parsed });
      await commit(bindingKey(binding), `calendar:${binding}`, draft);
      return planView(binding, plan);
    }); },
  };
}
