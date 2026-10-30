import { Bike, CalendarDays, ListTodo, Mail } from 'lucide-react';
import { pixelShift, type AmbientLine } from './ambient-mode';
import { date, time } from './format';

const icons = { meeting: CalendarDays, training: Bike, cezar: ListTodo, mail: Mail } as const;

/**
 * The quiet clock the panel falls back to when nobody touches it: a big time, the date and at most four lines of what
 * matters. Black background and dim text, drifting a few pixels a minute. A tap anywhere wakes the panel.
 */
export function Ambient({ now, night, lines, wake }: { now: number; night: boolean; lines: AmbientLine[]; wake: () => void }) {
  const shift = pixelShift(now);
  return <div className={`ambient ${night ? 'night' : 'day'}`} role="button" tabIndex={0} aria-label="Wybudź panel"
    onClick={wake} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') { event.preventDefault(); wake(); } }}>
    <div className="ambient-content" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
      <time className="ambient-time" dateTime={new Date(now).toISOString()}>{time(now)}</time>
      <p className="ambient-date">{date(now)}</p>
      {lines.length > 0 && <ul className="ambient-lines">
        {lines.slice(0, 4).map(line => {
          const Icon = icons[line.kind];
          return <li key={line.kind}><Icon size={22} aria-hidden="true" /><strong>{line.strong}</strong><span>{line.text}</span></li>;
        })}
      </ul>}
    </div>
  </div>;
}
