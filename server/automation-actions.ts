import { DateTime } from 'luxon';
import type { Automation, AutomationAct } from '../src/automation-contract';
import type { CalendarDraft, CalendarSaved } from '../src/appointment-contract';
import { AutomationError } from './automations';

/** Backend-only executor. No user environment or network is read until an authorized run invokes it. */
export function createAutomationExecutor({ writeCalendar, ntfyUrl, fetcher = fetch }: {
  writeCalendar?: (key: string, draft: CalendarDraft) => Promise<CalendarSaved>;
  ntfyUrl?: string; fetcher?: typeof fetch;
}) {
  return async (input: AutomationAct, approved: Automation['actions'][number], key: string, _name: string): Promise<string | undefined> => {
    if (input.action === 'smartAction') return key;
    if (input.action === 'calendarEvent' && approved.kind === 'calendarEvent') {
      const format = approved.allDay ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
      const start = DateTime.fromISO(input.when ?? '', { zone: 'Europe/Warsaw' });
      if (!format.test(input.when ?? '') || !start.isValid || start.toFormat(approved.allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm") !== input.when) throw new AutomationError(400, 'Podaj prawidłową datę/godzinę Europe/Warsaw; dla całodniowego samą datę.');
      if (!writeCalendar) throw new AutomationError(409, 'Połącz ponownie konto Google i zezwól na tworzenie wydarzeń (calendar.events.owned).');
      try {
        const saved = await writeCalendar(key, { title: input.title, startAt: start.toMillis(), endAt: (approved.allDay ? start.plus({ days: 1 }) : start.plus({ hours: 1 })).toMillis(), timeZone: 'Europe/Warsaw', location: '', description: [input.text, input.url].filter(Boolean).join('\n'), allDay: approved.allDay ?? false, reminderMinutes: approved.reminderMinutes ?? 60 });
        return saved.id;
      } catch { throw new AutomationError(409, 'Nie potwierdzono zapisu Google Calendar. Sprawdź połączenie i zgodę calendar.events.owned w Ustawieniach.'); }
    }
    if (input.action === 'notify' && ntfyUrl) {
      try {
        const url = new URL(ntfyUrl);
        if (url.protocol !== 'https:' || url.pathname === '/' || url.username || url.password || url.hash || url.search) throw new Error();
        const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: `=?UTF-8?B?${Buffer.from(input.title).toString('base64')}?=`, ...(input.url ? { Click: input.url } : {}) }, body: (input.text || input.title).split(/(?<=[.!?])\s/)[0].slice(0, 300) });
        if (!response.ok) throw new Error();
      } catch { throw new AutomationError(502, 'Powiadomienie jest w dzwonku; nie udało się wysłać na telefon.'); }
    }
    return key;
  };
}
