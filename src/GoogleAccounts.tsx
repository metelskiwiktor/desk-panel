import { usePollingEnabled } from './polling';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { CalendarDays } from 'lucide-react';
import { Card } from './components';
import { googleAccountsSchema, type GoogleAccountStatus } from './google-contract';

const serviceNames = { calendar: 'Kalendarz', mail: 'Poczta' } as const;
const names = (services: GoogleAccountStatus['services']) => services.map(s => serviceNames[s]).join(', ');
function describe(account: GoogleAccountStatus) {
  if (account.status === 'connected') return 'Połączono z Twoim kontem.';
  if (account.reason === 'client_missing' || account.reason === 'invalid_client') return 'Najpierw dodaj pobrany plik klienta OAuth Google do lokalnego serwera.';
  if (account.reason === 'scopes_missing') return `Połącz ponownie, aby panel mógł obsługiwać: ${names(account.missing)}.`;
  if (account.reason === 'token_expired') return 'Google odrzucił zapisane logowanie (wygasło lub zostało cofnięte). Połącz ponownie.';
  if (account.reason === 'storage_failed') return 'Nie udało się odczytać zapisanego logowania z dysku. Połącz ponownie.';
  return 'Konto czeka na Twoją zgodę Google.';
}

/** Sign-in state of every configured Google account; each one is connected separately. */
export function GoogleAccounts() {
  const [accounts, setAccounts] = useState<GoogleAccountStatus[] | null>(null);
  const [authorization, setAuthorization] = useState<{ email: string; url: string }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string>();
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!pollingEnabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/google/accounts', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = googleAccountsSchema.parse(await response.json());
        if (!stopped) setAccounts(value);
      } catch { if (!stopped) setMessage('Nie można odczytać stanu kont Google.'); }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(read, 15000); }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [pollingEnabled]);
  async function begin(email: string) {
    setBusy(email); setMessage(''); setAuthorization(undefined);
    try {
      const response = await fetch('/api/google/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }), signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('configuration');
      const value = z.object({ authorizationUrl: z.url() }).parse(await response.json());
      const url = new URL(value.authorizationUrl);
      if (url.origin !== 'https://accounts.google.com') throw new Error('invalid URL');
      setAuthorization({ email, url: url.href });
    } catch { setMessage('Nie można rozpocząć logowania. Sprawdź, czy dodano plik klienta OAuth Google.'); }
    finally { setBusy(undefined); }
  }
  return <Card title="Konta Google" icon={<CalendarDays />}>
    <p className="card-intro">Logujesz się na własne konta: kalendarz tylko do odczytu, poczta z prawem oznaczania jako przeczytane i przenoszenia do kosza (nigdy trwałego usuwania).</p>
    {accounts?.map(account => <div className="google-account" key={account.email}>
      <p><strong>{account.email}</strong> · {names(account.services)}</p>
      <p className="meta">{describe(account)}</p>
      <button className="button" onClick={() => begin(account.email)} disabled={!!busy}>
        {busy === account.email ? 'Przygotowuję logowanie…' : account.status === 'connected' ? 'Połącz ponownie' : 'Połącz przez Google'}
      </button>
      {authorization?.email === account.email && <>
        <p><a className="button" href={authorization.url} target="_blank" rel="noopener noreferrer">Otwórz logowanie Google</a></p>
        <p className="meta">Wybierz konto {account.email} i zaznacz wszystkie uprawnienia. Jeśli Google nie pozwoli zalogować się w panelu, otwórz ten link w zwykłej przeglądarce Chrome lub Edge.</p>
      </>}
    </div>)}
    {message && <p className="warning" role="status">{message}</p>}
    <p className="meta">Po powrocie dane odświeżą się automatycznie. Poświadczenia są przechowywane wyłącznie na tym komputerze i szyfrowane dla Twojego konta Windows.</p>
  </Card>;
}
