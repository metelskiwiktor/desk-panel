import { useEffect, useState } from 'react';
import { z } from 'zod';
import { CalendarDays } from 'lucide-react';
import { Card } from './components';
import { calendarConnectionSchema as connectionSchema } from './calendar-contract';
export function CalendarConnection() {
  const [connection, setConnection] = useState<z.infer<typeof connectionSchema> | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/calendar/connection', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = connectionSchema.parse(await response.json());
        if (!stopped) setConnection(value);
      } catch { if (!stopped) setMessage('Nie można odczytać stanu połączenia.'); }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(read, 15000); }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  async function begin() {
    setBusy(true); setMessage(''); setAuthorizationUrl(undefined);
    try {
      const response = await fetch('/api/calendar/connect', { method: 'POST', signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('configuration');
      const value = z.object({ authorizationUrl: z.url() }).parse(await response.json());
      const url = new URL(value.authorizationUrl);
      if (url.origin !== 'https://accounts.google.com') throw new Error('invalid URL');
      setAuthorizationUrl(url.href);
    } catch { setMessage('Nie można rozpocząć logowania. Sprawdź, czy dodano plik klienta OAuth Google.'); }
    finally { setBusy(false); }
  }
  const missing = connection?.reason === 'client_missing' || connection?.reason === 'invalid_client';
  return <Card title="Twoje konto Google" icon={<CalendarDays />}>
    <p className="card-intro">{connection?.email || 'Google Calendar'} · tylko odczyt. Logujesz się na własne konto, bez udostępniania kalendarza innemu użytkownikowi.</p>
    <p className="meta">{connection?.status === 'connected' ? 'Zapisano połączenie z Twoim kontem.' : missing ? 'Najpierw dodaj pobrany plik klienta OAuth Google do lokalnego serwera.' : 'Kalendarz czeka na Twoją zgodę Google.'}</p>
    <button className="button" onClick={begin} disabled={busy}>{busy ? 'Przygotowuję logowanie…' : 'Połącz przez Google'}</button>
    {authorizationUrl && <p><a className="button" href={authorizationUrl} target="_blank" rel="noopener noreferrer">Otwórz logowanie Google</a></p>}
    {authorizationUrl && <p className="meta">Wybierz swoje konto i zatwierdź odczyt kalendarza. Jeśli Google nie pozwoli zalogować się w panelu, otwórz ten link w zwykłej przeglądarce Chrome lub Edge.</p>}
    {message && <p className="warning" role="status">{message}</p>}
    <p className="meta">Po powrocie agenda odświeży się automatycznie. Poświadczenia są przechowywane wyłącznie na tym komputerze i szyfrowane dla Twojego konta Windows.</p>
  </Card>;
}
