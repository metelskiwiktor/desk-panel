import { time } from './format';
import type { Detail } from './model';
import { countdown, meetingRange, type DayRibbon } from './day-ribbon';

/** The meeting on now or about to start takes the focus slot above the day. */
export function MeetingFocus({ ribbon, now, open }: { ribbon: DayRibbon; now: number; open: (d: Detail) => void }) {
  const focus = ribbon.focus;
  if (!focus) return null;
  const { event, ongoing } = { event: focus.block.event, ongoing: focus.block.ongoing };
  return <button className="p2-focus" onClick={() => open({ kind: 'event', id: event.id })}
    aria-label={`${ongoing ? 'Trwa' : `Za ${countdown(focus.startsIn)}`}: ${event.title}, ${meetingRange(event)}`}>
    <span className="p2-focus-count"><small>{ongoing ? 'ZOSTAŁO' : 'ZA'}</small>{countdown(ongoing ? event.endAt - now : focus.startsIn)}</span>
    <span className="p2-focus-body">
      <strong>{event.title}</strong>
      <span className="p2-meta">{meetingRange(event)}{event.location ? ` · ${event.location}` : ''}</span>
    </span>
  </button>;
}

/** Today as one horizontal ribbon: what is behind you hatched, the line for now, meetings as blocks. */
export function DayRibbonView({ ribbon, summary, known, now, open, showCalendar }: { ribbon: DayRibbon; summary: string; known: boolean; now: number; open: (d: Detail) => void; showCalendar: () => void }) {
  const focused = ribbon.focus?.block;
  return <section className="p2-day" aria-label="Dziś">
    <div className="p2-day-head"><h2 className="p2-eyebrow">Dziś</h2><span className="p2-meta">{summary}</span><button className="p2-link" aria-label="Otwórz kalendarz" onClick={showCalendar}>Kalendarz</button></div>
    {ribbon.allDay.length > 0 && <div className="p2-allday">
      {ribbon.allDay.map(e => <button key={e.id} onClick={() => open({ kind: 'event', id: e.id })}><span>Cały dzień · </span>{e.title}</button>)}
    </div>}
    <div className="p2-ribbon">
      <div className="p2-rbox">
        <div className="p2-rtrack">
          {ribbon.hours.slice(1, -1).map(h => <i key={h.label} className="p2-rhour" style={{ left: `${h.pct}%` }} />)}
          <div className="p2-rpast" style={{ width: `${ribbon.nowPct}%` }} />
          {ribbon.blocks.length === 0 && known && <span className="p2-rfree" style={{ left: `${Math.min(ribbon.nowPct + 3, 85)}%` }}>wolne</span>}
          {ribbon.blocks.map(b => <button key={b.event.id} className={`p2-block ${b.past ? 'past' : ''} ${b === focused ? 'focus' : ''}`}
            style={{ left: `${b.left}%`, width: `${b.width}%`, top: `${(b.lane / b.lanes) * 100}%`, height: `${100 / b.lanes}%` }}
            aria-label={`${b.event.title}, ${meetingRange(b.event)}`} onClick={() => open({ kind: 'event', id: b.event.id })}>
            {b.width >= 11 && <span>{b.event.title}</span>}
          </button>)}
        </div>
        {focused && <span className="p2-tag" style={{ left: `${focused.left}%` }}>{focused.event.title} · {time(focused.event.startAt)}</span>}
        <div className="p2-now" style={{ left: `${ribbon.nowPct}%` }}>{ribbon.nowPct >= 8 && <span>{time(now)}</span>}</div>
      </div>
      <div className="p2-hours" aria-hidden="true">{ribbon.hours.map(h => <span key={h.label} style={{ left: `${h.pct}%` }}>{h.label}</span>)}</div>
    </div>
  </section>;
}
