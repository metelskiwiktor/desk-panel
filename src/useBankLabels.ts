import { useCallback, useEffect, useRef, useState } from 'react';
import { usePollingEnabled } from './polling';
import { bankLabelsSourceSchema, isDone, type BankLabelAction, type BankLabelResult, type BankLabelsData, type BankLabelsSource } from './bank-labels-contract';

/**
 * The user's marks change only by the user's own gestures, and the operations they mark come from the server's kept reading;
 * reading them is a local read of the server's memory, never of the bank.
 */
const POLL_MS = 60_000;

/**
 * Marks on bank operations: categories and sources, the other sides, the mark of each operation and the server's suggestions. An action is shown
 * at once (`optimistic`) and the server's answer replaces it right after, with suggestions worked out again.
 */
export function useBankLabels() {
  const [source, setSource] = useState<BankLabelsSource>({ live: true, name: 'Oznaczenia', status: 'loading', observedAt: null, data: null });
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const inFlight = useRef(0);
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
        const response = await fetch('/api/bank/labels', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = bankLabelsSourceSchema.parse(await response.json());
        if (!stopped && inFlight.current === 0) setSource(value);
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline', message: 'Nie można odczytać oznaczeń operacji.' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, POLL_MS);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [reload, pollingEnabled]);

  const act = useCallback(async (action: BankLabelAction, optimistic?: (data: BankLabelsData) => BankLabelsData): Promise<BankLabelResult | null> => {
    setError('');
    inFlight.current += 1;
    if (optimistic) setSource(previous => previous.data ? { ...previous, data: optimistic(previous.data) } : previous);
    try {
      const response = await fetch('/api/bank/labels/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action), signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        const reason = await response.json().then((body: { error?: unknown }) => typeof body.error === 'string' ? body.error : '', () => '');
        throw new Error(reason || 'Nie udało się zapisać oznaczenia.');
      }
      return await response.json() as BankLabelResult;
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Nie udało się zapisać oznaczenia.');
      return null;
    } finally {
      inFlight.current -= 1;
      setReload(n => n + 1);
    }
  }, []);
  const clearError = useCallback(() => setError(''), []);
  return { source, error, clearError, act };
}
export type BankLabelsHook = ReturnType<typeof useBankLabels>;

/** What marking an operation does to the data before the server answers: the mark is there and it is no longer to be marked. */
export function withLabel(data: BankLabelsData, tx: string, label: BankLabelsData['labels'][string] | null): BankLabelsData {
  const labels = { ...data.labels };
  if (label) labels[tx] = label; else delete labels[tx];
  const suggestions = { ...data.suggestions };
  delete suggestions[tx];
  return { ...data, labels, suggestions, pending: isDone(label) ? data.pending.filter(id => id !== tx) : data.pending };
}
