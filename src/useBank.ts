import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { usePollingEnabled } from './polling';
import { bankSourceSchema, type BankSource } from './bank-contract';

export type BankState = BankSource & { loadedAt?: number };
/** The server reads the bank at most every few hours and keeps the answer; the panel only has to notice a change promptly. */
const POLL_MS = 60_000;
const authorizationSchema = z.object({ authorizationUrl: z.url() });

/** The bank account and the consent flow: `connect` asks the server to start it and gives the bank's sign-in address. */
export function useBank() {
  const [source, setSource] = useState<BankState>({ name: 'PKO BP', live: true, status: 'loading', observedAt: null, data: null });
  const [signIn, setSignIn] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!pollingEnabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch('/api/bank', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = bankSourceSchema.parse(await response.json());
        if (!stopped) setSource(previous => ({ ...value, loadedAt: value.status === 'connected' ? Date.now() : previous.loadedAt }));
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline', message: 'Nie można połączyć się z lokalnym serwerem.' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, POLL_MS);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [pollingEnabled, reload]);

  // Back from the bank's sign-in: the server already has the consent, so do not wait for the next poll.
  const waiting = !!source.loginRequired;
  useEffect(() => {
    if (!waiting) return;
    const back = () => setReload(n => n + 1);
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [waiting]);

  const connect = useCallback(async () => {
    setBusy(true); setError(''); setSignIn(null);
    try {
      const response = await fetch('/api/bank/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('refused');
      const url = new URL(authorizationSchema.parse(await response.json()).authorizationUrl);
      if (url.protocol !== 'https:') throw new Error('invalid URL');
      setSignIn(url.href);
    } catch { setError('Nie można rozpocząć łączenia z bankiem. Sprawdź konfigurację konta bankowego.'); }
    finally { setBusy(false); }
  }, []);
  /** Read again at once, e.g. when the user comes back from the bank. */
  const refresh = useCallback(() => setReload(n => n + 1), []);
  return { source, signIn, error, busy, connect, refresh };
}
export type BankHook = ReturnType<typeof useBank>;
