import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Card } from './components';
import { usePollingEnabled } from './polling';
import { stamp } from './format';
import { MAX_ACTIVE_OBSERVERS, OBSERVER_KIND_LABELS, observerListSchema, type ObserverView } from './observers-contract';

/**
 * The chat's one-shot observers in Ustawienia: what Wektor watches for the user (a Cezar task, a pull request, a moment),
 * with the moment each was created and expires, and a cancel button. A fired, expired or cancelled observer disappears.
 */
export function ObserversCard() {
  const polling = usePollingEnabled();
  const [rows, setRows] = useState<ObserverView[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const response = await fetch('/api/observers');
      if (!response.ok) throw new Error('offline');
      setRows(observerListSchema.parse(await response.json()).observers);
      setError(false);
    } catch { setError(true); }
  }, []);

  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await read();
      if (!stopped) timer = setTimeout(loop, 15000);
    };
    void loop();
    return () => { stopped = true; clearTimeout(timer); };
  }, [polling, read]);

  const cancel = async (id: string) => {
    setBusy(id);
    try {
      const response = await fetch('/api/observers/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error('refused');
      setRows(observerListSchema.parse(await response.json()).observers);
      setError(false);
    } catch { setError(true); }
    finally { setBusy(null); }
  };

  return (
    <Card title="Obserwatory" icon={<BellRing />}>
      <p className="card-intro">
        Jednorazowe obserwatory Wektora: task Cezara, PR na GitHubie albo moment w czasie. Po zadziałaniu Wektor dostaje w
        swojej rozmowie jedną turę automatyki z poleceniem zapisanym przy tworzeniu, a obserwator znika z listy. Najwyżej{' '}
        {MAX_ACTIVE_OBSERVERS} aktywnych; każdy wygasa najpóźniej po dobie. Wszystkie wyłącza <code>DESK_AUTOMATIONS=0</code>.
      </p>
      {error && <p className="warning" role="status">Nie udało się odczytać obserwatorów ani ich anulować.</p>}
      {!rows ? <p className="meta">Odczytuję obserwatory…</p> : rows.length === 0 ? (
        <p className="meta">Brak aktywnych obserwatorów. Poproś Wektora w rozmowie, żeby coś obserwował.</p>
      ) : (
        <ul className="observer-list" aria-label="Aktywne obserwatory">
          {rows.map(o => (
            <li className="observer-row" key={o.id}>
              <span className="observer-kind">{OBSERVER_KIND_LABELS[o.kind]}</span>
              <span className="observer-target">{o.target}</span>
              <span className="meta observer-times">utworzono {stamp(o.createdAt)} · wygasa {stamp(o.expiresAt)}</span>
              <button className="button observer-cancel" disabled={busy === o.id} onClick={() => void cancel(o.id)}>
                Anuluj
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
