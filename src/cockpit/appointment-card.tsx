import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { CalendarCheck, CalendarDays, Check, ExternalLink, RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { appointmentViewSchema, calendarPlanViewSchema, type AppointmentView, type CalendarDraft, type CalendarSaved } from '../appointment-contract';
import { CardActions, btn, card, head, refusedNote } from './cards';
import { useAppointmentWorkspace } from './appointment-workspace';
import { useConversationCache } from './conversation-cache';
import { rememberSnapshot } from '../chat-snapshots';

export interface AppointmentArgs { refused?: string }
const money = (p: AppointmentView['preview']) => p.price === null ? 'Cena niepodana' : `${p.priceFrom ? 'od ' : ''}${p.price.toLocaleString('pl-PL')} zł`;
const format = (at: number, zone: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pl-PL', { timeZone: zone, ...options }).format(at);
const time = (at: number, zone: string) => format(at, zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayKey = (at: number, zone: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
export function safeBookingUrl(value: string): string | null {
  try { const u = new URL(value); return u.origin === 'https://www.znanylekarz.pl' && !u.username && !u.password && /^\/booking\/wybierz-wizyte\/\d+\/\d+\//.test(u.pathname) ? u.href : null; } catch { return null; }
}
async function json(path: string, schema: z.ZodType, signal?: AbortSignal) {
  const r = await fetch(path, { signal, cache: 'no-store' });
  const data = await r.json().catch(() => null) as { error?: string } | null;
  if (!r.ok) throw new Error(data?.error || 'Nie udało się odczytać karty.');
  return schema.parse(data);
}
function useCard<T>(suffix: string, toolCallId: string, schema: z.ZodType<T>, ready: boolean) {
  const { chatId } = useContext(CardActions);
  const cache = useConversationCache()?.cards;
  const path = chatId ? `/api/chats/${chatId}/${suffix}?toolCallId=${encodeURIComponent(toolCallId)}` : '';
  const [value, setValue] = useState<T | null>(() => ready ? cache?.get(path) as T ?? null : null), [error, setError] = useState(''), [tick, setTick] = useState(0);
  const [fresh, setFresh] = useState(false);
  const refresh = useCallback(() => { setError(''); setFresh(false); setTick(n => n + 1); }, []);
  useEffect(() => { setValue(ready ? cache?.get(path) as T ?? null : null); setError(''); setFresh(false); }, [path, ready, cache]);
  useEffect(() => {
    if (!path || !ready) return;
    const controller = new AbortController();
    json(path, schema, controller.signal).then(v => {
      if (controller.signal.aborted) return;
      if (cache) rememberSnapshot(cache, path, v, 32);
      setValue(v as T); setFresh(true);
    }, e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Nie udało się odczytać karty.'); setFresh(true); } });
    return () => controller.abort();
  }, [path, schema, ready, tick, cache]);
  useEffect(() => {
    if (!ready) return;
    const focus = () => refresh(); window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus);
  }, [ready, refresh]);
  return { value, error, setError, refresh, chatId, refreshing: !!path && ready && !fresh };
}
function Saved({ saved }: { saved: CalendarSaved }) {
  return <div className="tw:grid tw:gap-2 tw:rounded-xl tw:border tw:border-ck-green/40 tw:bg-ck-green/10 tw:p-3" role="status">
    <span className="tw:flex tw:items-center tw:gap-2 tw:font-medium tw:text-ck-green"><Check size={16} />Zapisano w Google Calendar</span>
    <span className="tw:text-sm">{saved.draft.title} · {format(saved.draft.startAt, saved.draft.timeZone, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}–{time(saved.draft.endAt, saved.draft.timeZone)}</span>
    <a className={`${btn} tw:w-fit tw:bg-ck-surface-2`} href={saved.url} target="_blank" rel="noopener noreferrer">Otwórz wydarzenie <ExternalLink size={14} /></a>
  </div>;
}
/** An optional correction of the automatically filled fields; no date/doctor/service comes back from the browser. */
function CalendarFields({ draft, startAt, zone, title, setTitle, end, setEnd, locked = false }: { draft: CalendarDraft | null; startAt: number; zone: string; title: string; setTitle(v: string): void; end: string; setEnd(v: string): void; locked?: boolean }) {
  return <>
    <div className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-medium"><CalendarCheck size={16} className="tw:text-ck-cal" />Zapis w Google Calendar</div>
    <div className="tw:grid tw:grid-cols-1 tw:gap-3 tw:sm:grid-cols-[minmax(0,1fr)_160px]">
      <label className="tw:grid tw:gap-1.5 tw:text-xs tw:text-ck-muted">Nazwa wydarzenia<input maxLength={160} readOnly={locked} className="tw:w-full tw:min-w-0 tw:rounded-lg tw:border tw:border-ck-line-2 tw:bg-ck-surface-2 tw:px-3 tw:py-2 tw:text-sm tw:text-ck-text" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="tw:grid tw:gap-1.5 tw:text-xs tw:text-ck-muted">Godzina zakończenia<input type="time" readOnly={locked} className="tw:w-full tw:min-w-0 tw:rounded-lg tw:border tw:border-ck-line-2 tw:bg-ck-surface-2 tw:px-3 tw:py-2 tw:text-sm tw:text-ck-text tw:[color-scheme:dark]" value={end} onChange={e => setEnd(e.target.value)} required /></label>
    </div>
    <p className="tw:m-0 tw:text-xs tw:text-ck-muted">{locked ? 'Zapis już rozpoczęto. Ponów z zachowanymi danymi; nie powstanie drugie wydarzenie.' : draft ? `Uzupełnione automatycznie · ${time(startAt, zone)}–${time(draft.endAt, zone)} · ${Math.round((draft.endAt - startAt) / 60_000)} minut. Możesz poprawić przed zapisem.` : 'ZnanyLekarz nie podał czasu trwania. Uzupełnij godzinę zakończenia, aby zapisać wydarzenie.'}</p>
  </>;
}
/** Resolve a user's wall-clock correction relative to the original end. Preserve an overnight event's actual end date. */
export function endFromTime(value: string, base: number, zone: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number); if (h > 23 || m > 59) return null;
  // Try offsets around the base to handle the repeated autumn hour. Prefer the offset of the original end.
  const baseTime = time(base, zone), [bh, bm] = baseTime.split(':').map(Number);
  const guess = base + ((h - bh) * 60 + m - bm) * 60_000;
  const desiredDay = dayKey(base, zone);
  return [guess, guess - 3_600_000, guess + 3_600_000].find(v => time(v, zone) === value && dayKey(v, zone) === desiredDay) ?? null;
}
function GoogleConsent({ available, refresh }: { available: boolean; refresh(): void }) {
  if (available) return null;
  return <div className="tw:grid tw:gap-2 tw:rounded-lg tw:bg-ck-amber/10 tw:p-3 tw:text-sm" role="status"><p className="tw:m-0 tw:text-ck-amber">Połącz ponownie konto Google w Ustawieniach → Konta Google i zezwól na tworzenie wydarzeń. Wybrany termin zostaje na karcie.</p><button type="button" className={`${btn} tw:w-fit tw:bg-ck-surface-2`} onClick={refresh}><RefreshCw size={14} />Sprawdź zgodę</button></div>;
}

export function AppointmentCard({ args, toolCallId, status }: ToolCallMessagePartProps<AppointmentArgs, unknown>) {
  const { respond, running } = useContext(CardActions);
  const workspace = useAppointmentWorkspace();
  const summary = useRef<HTMLElement>(null);
  const openSummary = workspace?.openSummary;
  const ready = status.type !== 'running' && !args.refused && toolCallId.includes(':v-');
  const { value: view, error, setError, refresh, refreshing } = useCard('appointment', toolCallId, appointmentViewSchema, !!ready);
  const [day, setDay] = useState(''), [picked, setPicked] = useState(''), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(''), [end, setEnd] = useState('');
  const initializedSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!view?.selection) { initializedSelection.current = null; return; }
    if (refreshing || initializedSelection.current === view.selection.id) return;
    initializedSelection.current = view.selection.id;
    setTitle(view.selection.draft?.title ?? `Wizyta — ${view.preview.doctor}`);
    setEnd(view.selection.draft ? time(view.selection.draft.endAt, view.preview.timeZone) : '');
  }, [view?.selection?.id, refreshing]);
  const answer = async (action: unknown) => { setBusy(true); setError(''); try { await respond(toolCallId, { kind: 'appointment', action }); refresh(); } catch (e) { refresh(); setError(e instanceof Error ? e.message : 'Nie udało się zapisać decyzji.'); } finally { setBusy(false); } };
  const p = view?.preview, selection = view?.selection;
  const days = p ? [...new Set(p.slots.map(s => dayKey(s.startAt, p.timeZone)))] : [];
  const active = day && days.includes(day) ? day : days[0];
  const slot = p?.slots.find(s => s.id === picked && dayKey(s.startAt, p.timeZone) === active);
  const url = selection ? safeBookingUrl(selection.slot.bookingUrl) : null;
  const endAt = selection && p ? endFromTime(end, selection.draft?.endAt ?? selection.slot.startAt, p.timeZone) : null;
  const put = workspace?.put, remove = workspace?.remove, show = workspace?.show, offer = workspace?.offer;
  const settle = workspace?.settle;
  useEffect(() => { if (view || error || args.refused) settle?.(toolCallId); }, [view, error, args.refused, settle, toolCallId]);
  const locked = busy || running || refreshing || !!error;
  useEffect(() => {
    if (!view) { remove?.(toolCallId); return; }
    put?.(toolCallId, { view, day: day || (selection ? dayKey(selection.slot.startAt, view.preview.timeZone) : active), picked, disabled: locked, endAt,
      chooseDay: d => { setDay(d); setPicked(''); }, chooseSlot: setPicked,
      review: () => {
        openSummary?.();
        // Wait for the chat pane to become visible on narrow windows, then find
        // this card's action even when another card is further down the thread.
        window.setTimeout(() => {
          const target = summary.current?.querySelector<HTMLElement>('[data-visit-summary-action]') ?? summary.current;
          target?.focus({ preventScroll: true });
          target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 0);
      } });
  }, [put, remove, toolCallId, view, active, day, picked, locked, selection, endAt, openSummary]);
  useEffect(() => { if (view) offer?.(toolCallId, view.preview.observedAt); }, [!!view, offer, toolCallId]);
  useEffect(() => () => remove?.(toolCallId), [remove, toolCallId]);
  return <section ref={summary} tabIndex={-1} className={card} aria-label="Umów wizytę">
    <div className={head}><CalendarDays size={16} className="tw:text-ck-cal" /><b className="tw:font-medium">Umów wizytę</b><span className="tw:ml-auto tw:text-xs tw:text-ck-muted">ZnanyLekarz</span></div>
    <div className="tw:grid tw:gap-4 tw:p-4">
      {args.refused ? <p className={refusedNote} role="alert">{args.refused}</p> : null}
      {!args.refused && !view && !error && <p className="tw:m-0 tw:text-sm tw:text-ck-muted" role="status">{ready ? 'Wczytuję terminy…' : 'Czekam na gotową kartę…'}</p>}
      {p && <>
        <div><p className="tw:m-0 tw:text-base tw:font-medium tw:text-ck-text">{p.doctor}</p><p className="tw:m-0 tw:text-sm tw:text-ck-muted">{p.service}</p><p className="tw:mt-1 tw:mb-0 tw:text-sm">{p.location} · {money(p)}{p.durationMinutes ? ` · ${p.durationMinutes} min` : ''}</p></div>
        {view.saved ? <Saved saved={view.saved} /> : selection ? <>
          <div className="tw:border-l-[3px] tw:border-ck-cal tw:pl-3"><p className="tw:m-0 tw:text-xs tw:text-ck-muted">Wybrany termin</p><p className="tw:my-1 tw:text-base tw:font-medium">{format(selection.slot.startAt, p.timeZone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p><p className="tw:m-0 tw:text-sm">{time(selection.slot.startAt, p.timeZone)} · {p.location} · {money(p)}</p></div>
          <div className="tw:flex tw:flex-wrap tw:gap-2">{url && <a className={`${btn} tw:bg-ck-cal tw:text-ck-bg`} data-visit-summary-action href={url} target="_blank" rel="noopener noreferrer">Otwórz ZnanyLekarz <ExternalLink size={14} /></a>}<button type="button" className={`${btn} tw:border tw:border-ck-line-2`} disabled={locked || view.writeStarted} onClick={() => void answer({ action: 'reset', selectionId: selection.id })}>Zmień termin</button></div>
          <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Dokończ rezerwację i ewentualną płatność na stronie lekarza, a potem wróć do tej karty. Samo otwarcie linku nie potwierdza wizyty.</p>
          <hr className="tw:m-0 tw:border-ck-line" />
          <CalendarFields draft={selection.draft} startAt={selection.slot.startAt} zone={p.timeZone} title={title} setTitle={setTitle} end={end} setEnd={setEnd} locked={view.writeStarted || refreshing} />
          <GoogleConsent available={view.canWriteCalendar} refresh={refresh} />
          <button type="button" className={`${btn} tw:justify-center tw:bg-ck-cal tw:text-ck-bg`} disabled={locked || !view.canWriteCalendar || !url || !title.trim() || !endAt || endAt <= selection.slot.startAt} onClick={() => void answer({ action: 'confirm', selectionId: selection.id, choice: { title, endAt } })}><CalendarCheck size={16} />{busy ? 'Zapisuję…' : 'Zarezerwowałem ten termin — zapisz'}</button>
        </> : <>
          {!!days.length && <div className="tw:grid tw:gap-2 tw:rounded-xl tw:border tw:border-ck-cal/30 tw:bg-ck-cal/5 tw:p-3"><span className="tw:text-xs tw:text-ck-muted">{slot ? 'Podgląd wybranego terminu' : 'Terminy i Twój kalendarz'}</span><b className="tw:text-base tw:font-medium">{slot ? `${format(slot.startAt, p.timeZone, { weekday: 'long', day: 'numeric', month: 'long' })} · ${time(slot.startAt, p.timeZone)}${p.durationMinutes ? `–${time(slot.startAt + p.durationMinutes * 60_000, p.timeZone)}` : ''}` : 'Wybierz godzinę na osi dnia'}</b><button type="button" className={`${btn} tw:w-fit tw:bg-ck-surface-2`} onClick={() => { show?.(toolCallId); workspace?.openTimeline(); }}>Pokaż terminy i kalendarz</button></div>}
          {!days.length && <p className="tw:m-0 tw:text-sm">Brak wspólnych dostępnych terminów w tym zakresie.{p.query.firstVisit === undefined ? ' Powiedz Wektorowi, czy to pierwsza czy kolejna wizyta — dostępność może się różnić.' : ''}</p>}
          <p className="tw:m-0 tw:text-xs tw:text-ck-muted">{p.slots.length} terminów · {p.from} – {p.to}. Odczyt {format(p.observedAt, p.timeZone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.{p.query.firstVisit === undefined ? ' Wspólne dla pierwszej i kolejnej wizyty.' : p.query.firstVisit ? ' Pierwsza wizyta.' : ' Kolejna wizyta.'}</p>
          <button type="button" className={`${btn} tw:justify-center tw:bg-ck-cal tw:text-ck-bg`} data-visit-summary-action disabled={!slot || locked} onClick={() => slot && void answer({ action: 'select', slotId: slot.id })}>{busy ? 'Sprawdzam dostępność…' : `Wybieram ${slot ? time(slot.startAt, p.timeZone) : 'termin'}`}</button>
          <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Wybór w panelu nie rezerwuje wizyty. Dostępność sprawdzimy ponownie.</p>
        </>}
      </>}
      {error && <p className="tw:m-0 tw:rounded-lg tw:bg-ck-red/10 tw:p-3 tw:text-sm tw:text-ck-red" role="alert">{error}</p>}
    </div>
  </section>;
}

export function CalendarPlanCard({ args, toolCallId, status }: ToolCallMessagePartProps<AppointmentArgs, unknown>) {
  const { respond, running } = useContext(CardActions);
  const ready = status.type !== 'running' && !args.refused && toolCallId.includes(':v-');
  const { value: view, error, setError, refresh, refreshing } = useCard('calendar-plan', toolCallId, calendarPlanViewSchema, !!ready);
  const [title, setTitle] = useState(''), [end, setEnd] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (view) { setTitle(view.draft.title); setEnd(time(view.draft.endAt, view.draft.timeZone)); } }, [view?.draft.title, view?.draft.endAt]);
  const draft = view?.draft;
  const endAt = draft ? endFromTime(end, draft.endAt, draft.timeZone) : null;
  const confirm = async () => { setBusy(true); setError(''); try { await respond(toolCallId, { kind: 'calendarPlan', action: { action: 'confirm', choice: { title, endAt } } }); refresh(); } catch (e) { refresh(); setError(e instanceof Error ? e.message : 'Nie udało się zapisać.'); } finally { setBusy(false); } };
  return <section className={card} aria-label="Dodaj wydarzenie"><div className={head}><CalendarDays size={16} className="tw:text-ck-cal" /><b className="tw:font-medium">Dodać wydarzenie?</b><span className="tw:ml-auto tw:text-xs tw:text-ck-muted">Google Calendar</span></div><div className="tw:grid tw:gap-4 tw:p-4">
    {args.refused ? <p className={refusedNote} role="alert">{args.refused}</p> : null}
    {!args.refused && !view && !error && <p role="status" className="tw:m-0 tw:text-sm tw:text-ck-muted">Wczytuję propozycję…</p>}
    {view?.saved ? <Saved saved={view.saved} /> : draft && <>
      <p className="tw:m-0 tw:text-sm">{format(draft.startAt, draft.timeZone, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · {time(draft.startAt, draft.timeZone)}–{time(draft.endAt, draft.timeZone)} · {draft.timeZone}</p>
      {draft.location && <p className="tw:m-0 tw:text-sm">{draft.location}</p>}{draft.description && <p className="tw:m-0 tw:whitespace-pre-wrap tw:text-sm tw:text-ck-muted">{draft.description}</p>}
      <CalendarFields draft={draft} startAt={draft.startAt} zone={draft.timeZone} title={title} setTitle={setTitle} end={end} setEnd={setEnd} locked={view!.writeStarted || refreshing} />
      <GoogleConsent available={view!.canWriteCalendar} refresh={refresh} />
      <button type="button" className={`${btn} tw:justify-center tw:bg-ck-cal tw:text-ck-bg`} disabled={busy || running || refreshing || !!error || !view!.canWriteCalendar || !title.trim() || !endAt || endAt <= draft.startAt} onClick={() => void confirm()}><CalendarCheck size={16} />{busy ? 'Zapisuję…' : 'Dodaj do Google Calendar'}</button>
      <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Wydarzenie zapisze się dopiero po Twoim kliknięciu.</p>
    </>}
    {error && <p className="tw:m-0 tw:rounded-lg tw:bg-ck-red/10 tw:p-3 tw:text-sm tw:text-ck-red" role="alert">{error}</p>}
  </div></section>;
}
