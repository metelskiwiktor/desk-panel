import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { calendarSourceSchema, type CalendarSource } from '../calendar-contract';
import { useAppointmentWorkspace, type VisitWorkspaceEntry } from './appointment-workspace';
import { calendarDay, dayBounds, lanes, slotConflicts, timeAxis, visitDay, visitTime, visitSlotTime } from './appointment-timeline';
import { btn } from './cards';
import './appointment-panel.css';

function useCalendar(enabled: boolean, savedId?: string) {
  const [source, setSource] = useState<CalendarSource | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setTick(t => t + 1);
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch('/api/calendar', { signal: controller.signal, cache: 'no-store' }).then(async r => {
      if (!r.ok) throw new Error('calendar');
      const value = calendarSourceSchema.parse(await r.json());
      if (!controller.signal.aborted) setSource(value);
    }).catch(() => { if (!controller.signal.aborted) setSource(previous => previous ? { ...previous, status: 'offline' } : { name: 'Google Calendar', live: true, calendarId: '', status: 'offline', observedAt: null, data: null }); });
    return () => controller.abort();
  }, [enabled, tick, savedId]);
  return source;
}

export function AppointmentPanel({ entry }: { entry: VisitWorkspaceEntry }) {
  const workspace = useAppointmentWorkspace();
  const source = useCalendar(true, entry.view.saved?.id);
  const { view, day, picked } = entry, p = view.preview, zone = p.timeZone;
  const selected = view.selection?.slot;
  const days = [...new Set([...p.slots, ...(selected ? [selected] : [])].map(s => visitDay(s.startAt, zone)))].sort();
  const active = days.includes(day) ? day : days[0];
  if (!active) return <div className="visit-panel"><h2>Terminy wizyty</h2><p>Brak terminów w tym zakresie.</p></div>;
  const calendar = calendarDay(source, active, zone, Date.now());
  const slots = [...p.slots, ...(selected && !p.slots.some(s => s.id === selected.id) ? [selected] : [])].filter(s => visitDay(s.startAt, zone) === active);
  const timed = calendar.events.filter(e => !e.allDay), allDay = calendar.events.filter(e => e.allDay);
  const durationFor = (s: { id: string; startAt: number }) => s.id === selected?.id ? (entry.endAt && entry.endAt > s.startAt ? (entry.endAt - s.startAt) / 60_000 : null) : p.durationMinutes;
  const slotRanges = slots.map(s => ({ ...s, endAt: s.startAt + (durationFor(s) ?? 0) * 60_000 }));
  const bounds = dayBounds(active, zone);
  // Unknown duration gets a start marker, not an invented visit interval. Reserve a
  // minute on the visual scale so the marker cannot cover a compressed gap.
  const axis = timeAxis([...timed, ...slotRanges.map(s => ({ ...s, endAt: durationFor(s) ? s.endAt : s.startAt + 60_000 }))], bounds, slots.map(s => s.startAt));
  const eventLanes = lanes(timed);
  const slotLanes = lanes(slotRanges);
  const locked = !!view.selection || !!view.saved || entry.disabled;
  const pickedSlot = selected && visitDay(selected.startAt, zone) === active ? selected : slots.find(s => s.id === picked);
  const calendarEvents = (source?.data ?? []).filter(e => e.id !== view.saved?.id);
  const duration = pickedSlot ? durationFor(pickedSlot) : null;
  const assess = (start: number, minutes: number | null) => calendar.reliable && minutes !== null && !!source?.coverage && start + minutes * 60_000 <= source.coverage.endAt;
  const conflicts = pickedSlot ? slotConflicts(pickedSlot.startAt, duration, calendarEvents) : [];
  const clock = (at: number) => visitTime(at, zone);
  const slotClock = (at: number) => visitSlotTime(at, zone);
  const dayLabel = (d: string, long = false) => new Intl.DateTimeFormat('pl-PL', { timeZone: zone, weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'short' }).format(dayBounds(d, zone).startAt);
  return <section className="visit-panel" aria-label="Terminy na tle kalendarza">
    <header className="visit-heading"><CalendarDays size={18} /><div><h2>Wybierz termin na osi dnia</h2><p>{p.doctor} · {p.service} · {zone}</p></div></header>
    <div className="visit-days" role="navigation" aria-label="Dzień wizyty">{days.map(d => <button key={d} type="button" aria-pressed={active === d} onClick={() => entry.chooseDay(d)}>{dayLabel(d)}</button>)}</div>
    <h3>{dayLabel(active, true)}</h3>
    {!calendar.reliable && <p className="visit-notice" role="status">{calendar.reason} Brak oznaczenia kolizji nie oznacza wolnego czasu.</p>}
    {source?.observedAt && <p className="visit-observed">Kalendarz: odczyt {new Intl.DateTimeFormat('pl-PL', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(source.observedAt)}</p>}
    {allDay.length > 0 && <div className="visit-all-day" aria-label="Wydarzenia całodniowe">{allDay.map(e => <div key={e.id}><b>{e.title}</b> · cały dzień{e.busy === false ? ' · informacyjnie' : ' · zajęty'}</div>)}</div>}
    <div className="visit-columns"><span /><b>Twój kalendarz</b><b>Dostępne wizyty</b></div>
    <div className="visit-timeline" style={{ height: axis.height }}>
      {axis.segments.map(s => s.collapsed ? <div key={s.startAt} className="visit-gap" style={{ top: s.top, height: s.height }}>{clock(s.startAt)}–{s.endAt === bounds.endAt ? '24:00' : clock(s.endAt)} · przerwa na osi</div> : <div key={s.startAt} className="visit-rule" style={{ top: s.top }}><time>{clock(s.startAt)}</time></div>)}
      <div className="visit-events">{eventLanes.items.map(({ range: e, lane, count }) => {
        const top = axis.y(Math.max(bounds.startAt, e.startAt)), height = axis.y(Math.min(bounds.endAt, e.endAt)) - top;
        return <div key={e.id} className={`visit-event ${conflicts.some(c => c.id === e.id) ? 'conflict' : ''} ${e.busy === false ? 'informational' : ''}`} style={{ top, height, left: `${lane / count * 100}%`, width: `${100 / count}%` }} title={`${e.title} · ${clock(e.startAt)}–${clock(e.endAt)}${e.busy === false ? ' · informacyjnie' : ''}`}><time>{clock(e.startAt)}–{clock(e.endAt)}</time><strong>{e.title}</strong>{e.busy === false && <small>informacyjnie</small>}</div>;
      })}</div>
      <div className="visit-slots">{slotLanes.items.map(({ range: s, lane, count }) => {
        const slotDuration = durationFor(s);
        const collisions = slotConflicts(s.startAt, slotDuration, calendarEvents);
        const top = axis.y(s.startAt), height = slotDuration ? axis.y(Math.min(bounds.endAt, s.endAt)) - top : 44;
        const chosen = (selected?.id ?? picked) === s.id;
        const label = `${slotClock(s.startAt)}${slotDuration ? `–${slotClock(s.endAt)}` : ' · czas niepodany'}`;
        return <button key={s.id} type="button" className={`visit-slot ${chosen ? 'chosen' : ''} ${collisions.length ? 'conflict' : ''}`} style={{ top, height: Math.max(44, height), left: `${lane / count * 100}%`, width: `${100 / count}%` }} disabled={locked} aria-pressed={chosen} aria-label={`${slotClock(s.startAt)}${collisions.length ? ' — kolizja' : ''}`} title={`${label}${collisions.length ? ` · Kolizja: ${collisions.map(e => e.title).join(', ')}` : !assess(s.startAt, slotDuration) ? ' · Dostępność kalendarza niepewna' : ' · Bez kolizji w odczytanym kalendarzu'}`} onClick={() => entry.chooseSlot(s.id)}><time>{label}</time>{collisions.length > 0 && <span className="visit-collision">Kolizja</span>}{chosen && <span className="visit-chosen">✓</span>}</button>;
      })}</div>
    </div>
    <footer className="visit-footer" aria-live="polite">
      {pickedSlot ? <><b>{slotClock(pickedSlot.startAt)}{duration ? `–${slotClock(pickedSlot.startAt + duration * 60_000)}` : ' · czas trwania niepodany'}</b><span>{conflicts.length ? `Kolizja: ${conflicts.map(e => e.title).join(', ')}` : !assess(pickedSlot.startAt, duration) ? 'Nie można potwierdzić braku kolizji.' : 'Bez kolizji w odczytanym kalendarzu.'}</span><button type="button" className={`${btn} tw:bg-ck-cal tw:text-ck-bg`} onClick={() => workspace?.openSummary()}>Przejdź do podsumowania</button></> : <span>Kliknij godzinę w kolumnie „Dostępne wizyty”.</span>}
      <small>Wybór godziny pokazuje podgląd. Rezerwację potwierdzisz na ZnanyLekarz.</small>
    </footer>
  </section>;
}

/** Calendar and Cezar remain accessible without changing the watched task. */
export function AppointmentOrCockpit({ children }: { children: React.ReactNode }) {
  const workspace = useAppointmentWorkspace();
  const entries = Object.entries(workspace?.entries ?? {});
  const active = workspace?.active ? workspace.entries[workspace.active] : null;
  if (!entries.length) return children;
  return <><div className="visit-workspaces" role="navigation" aria-label="Zawartość kokpitu">{entries.map(([id, e]) => <button key={id} type="button" aria-pressed={workspace?.active === id} onClick={() => workspace?.show(id)}>Wizyta · {e.view.preview.doctor}</button>)}<button type="button" aria-pressed={!active} onClick={() => workspace?.show(null)}>Cezar</button></div>{active ? <AppointmentPanel key={workspace!.active} entry={active} /> : children}</>;
}
