import type { Detail } from './model';
import { SizeGrip } from './SizeGrip';
import { MonthGrid, WeekChips, WeekStrip } from './WeekStrip';
import type { WeekDay } from './week';
import { BOTTOM_SIZES, bottomHeights, type BottomSize } from './zones';

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const monthOf = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1];

/** "Październik 2026", or "Październik – listopad 2026" when the five weeks cross a month. */
export function monthTitle(days: WeekDay[]): string {
  if (!days.length) return 'Kalendarz';
  const first = days[0].date, last = days.at(-1)!.date;
  const title = monthOf(first) === monthOf(last) ? monthOf(first) : `${monthOf(first)} – ${monthOf(last)}`;
  const year = first.slice(0, 4) === last.slice(0, 4) ? first.slice(0, 4) : `${first.slice(0, 4)}/${last.slice(2, 4)}`;
  return `${title[0].toUpperCase()}${title.slice(1)} ${year}`;
}

/**
 * The bottom zone: the days ahead. Short is a chip per day, medium (the default) is a card per day, and the month takes
 * the whole screen below today (the zone grows and the work area folds away, both eased). A tap on a day selects it; the top zone then shows that day.
 */
export function DaysZone({ week, month, size, known, selected, select, open, cycle, resize, preview, showCalendar }: {
  week: WeekDay[]; month: WeekDay[]; size: BottomSize; known: boolean; selected: string; select: (date: string) => void;
  open: (d: Detail) => void; cycle: () => void; resize: (size: BottomSize) => void; preview: (size: BottomSize | null) => void; showCalendar: () => void;
}) {
  const zone = { known, selected, select, open };
  return <section className={`p3-days ${size}`} aria-label="Najbliższe dni">
    <div className="p3-days-head">
      <h2 className="p2-eyebrow">{size === 'month' ? monthTitle(month) : 'Najbliższe dni'}</h2>
      <button className="p3-cal" aria-label="Otwórz kalendarz" onClick={showCalendar}>Kalendarz</button>
    </div>
    {size === 'short' && <WeekChips days={week} {...zone} />}
    {size === 'mid' && <WeekStrip days={week} {...zone} />}
    {size === 'month' && <MonthGrid days={month} {...zone} />}
    <SizeGrip label="Zmień rozmiar kalendarza dni" edge="top" order={BOTTOM_SIZES} current={size} heights={bottomHeights} cssVar="--p3-bottom" onChange={resize} onPreview={preview} onTap={cycle} />
  </section>;
}
