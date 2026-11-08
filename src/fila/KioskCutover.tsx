import { useState } from 'react';
import { applyKiosk, planKiosk, restoreKiosk, type KioskExport, type KioskTilePlan } from './kiosk-migration';

export function KioskCutover() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/fila-cutover/kiosk', { cache: 'no-store' });
      if (!response.ok) throw new Error('Brak zatwierdzonego planu kiosku.');
      const bundle = await response.json() as { snapshot: KioskExport; rows: KioskTilePlan[] };
      const changes = planKiosk(localStorage, location.origin, bundle.snapshot, bundle.rows);
      applyKiosk(localStorage, changes);
      setMessage('Zastosowano plan. Odśwież panel, aby zobaczyć nowe kafelki.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zastosować planu.'); }
    finally { setBusy(false); }
  };
  const restore = () => {
    try { restoreKiosk(localStorage); setMessage('Odtworzono układ sprzed przełączenia. Odśwież panel.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się odtworzyć układu.'); }
  };
  return <section>
    <p className="card-intro">Zastosuj zatwierdzony plan kafelków w tej przeglądarce. Panel porówna cały wyeksportowany układ i zachowa kopię.</p>
    <button className="button" disabled={busy} onClick={() => void apply()}>Zastosuj plan kiosku</button>
    <button className="button" disabled={busy} onClick={restore}>Odtwórz układ kiosku</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
