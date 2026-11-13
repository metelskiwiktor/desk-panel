import { useState } from 'react';
import { Bot, Check, Layers3, Settings2 } from 'lucide-react';
import { defaultLayout, widgetNames, type Layout } from './layout';
import { Card } from './components';
import { GoogleAccounts } from './GoogleAccounts';
import { ScreenCard } from './ScreenCard';
import { QuotaVisibilitySettings, WarmupHistoryCard, WarmupSettingsCard, useWarmupStatus } from './QuotaSettings';
import type { QuotaAccount } from './model';
import type { useQuotaVisibility } from './quota-visibility';
import { resetWorkspace } from './tile-grid';
import { downloadPulpits } from './pulpits';
import { KioskCutover } from './fila/KioskCutover';

export function SettingsView({
  layout,
  configure,
  storageError,
  tabletPreview,
  onTabletPreviewChange,
  onOpenAutomations,
  quotaAccounts,
  quotaVisibility,
  resetArrangement = resetWorkspace,
  cutoverLocked = false,
}: {
  layout: Layout;
  configure: (next: Layout) => void;
  storageError: boolean;
  tabletPreview?: boolean;
  onTabletPreviewChange?: () => void;
  onOpenAutomations?: () => void;
  quotaAccounts?:QuotaAccount[]|null;
  quotaVisibility?:ReturnType<typeof useQuotaVisibility>;
  /** Forgets the arrangement of the open virtual desktop; false when it could not be saved. */
  resetArrangement?: () => boolean;
  cutoverLocked?: boolean;
}) {
  const warmup = useWarmupStatus();
  const [arrangement, setArrangement] = useState<'kept' | 'reset' | 'failed'>('kept');
  const [exportError, setExportError] = useState(false);
  return (
    <div className="settings-stack">
      <Card title="Połączenia" icon={<Layers3 />} area="settings-connections">
        <p className="card-intro">CPU i RAM co około 2 sekundy, Cezar co 5 sekund, kalendarz co minutę. Bieżące limity AI co około minutę, bez rozmów z modelem.</p>
      </Card>
      <ScreenCard />
      {quotaVisibility && <QuotaVisibilitySettings accounts={quotaAccounts ?? null} value={quotaVisibility.value} change={quotaVisibility.set} error={quotaVisibility.error}/>}
      <WarmupSettingsCard warmup={warmup} />
      <Card title="Automaty" icon={<Bot />} area="settings-automations">
        <p className="card-intro">Automaty czasowe są w Machinie: każdy to wątek w projekcie MACH w Fili. Widok Automaty zostaje dla obserwatorów Cezara i PR oraz dla historii przeniesionych automatów.</p>
        <button className="button" onClick={onOpenAutomations}>Otwórz Automaty</button>
      </Card>
      <Card title="Podgląd pionowy" icon={<Settings2 />} area="settings-preview">
        <p className="card-intro">Ten sam panel w pionowym obszarze docelowego ekranu, bez pomniejszania tekstu. Podgląd można przewijać; powiększenie przeglądarki działa jak zwykle.</p>
        <button className="button" aria-pressed={!!tabletPreview} onClick={onTabletPreviewChange}>
          {tabletPreview ? 'Zamknij podgląd pionowy' : 'Otwórz podgląd pionowy'}
        </button>
      </Card>
      <GoogleAccounts />
      <Card title="Pulpit" icon={<Settings2 />} area="settings-desktop">
        {cutoverLocked && <KioskCutover />}
        <p className="card-intro">
          Co może pokazać Pulpit. Kafelki obszaru roboczego (limity, Cezar, poczta, komputer) wybierasz i rozmieszczasz na Pulpicie, przyciskiem układu w pasku u góry; tutaj wyłączasz to, czego nie chcesz tam widzieć. Zapis dotyczy tylko tej przeglądarki.
        </p>
        {layout.widgets.map((w) => (
          <div className="widget-setting" key={w.id}>
            <label className="visibility-toggle">
              <input
                type="checkbox"
                checked={w.visible}
                onChange={(e) =>
                  configure({
                    ...layout,
                    widgets: layout.widgets.map((c) => (c.id === w.id ? { ...c, visible: e.target.checked } : c)),
                  })
                }
              />
              <span>{widgetNames[w.id]}</span>
            </label>
          </div>
        ))}
        <p className={`save-status ${storageError ? 'warning' : ''}`} role="status">
          {storageError ? (
            'Nie udało się zapisać. Ustawienia działają w tej sesji.'
          ) : (
            <>
              <Check size={16} /> Zapisuje się automatycznie
            </>
          )}
        </p>
        <button className="button" onClick={() => configure(defaultLayout())}>
          Pokaż wszystkie sekcje
        </button>
        <button className="button" onClick={() => setArrangement(resetArrangement() ? 'reset' : 'failed')}>
          Przywróć domyślny układ kafelków
        </button>
        {arrangement !== 'kept' && <p className={arrangement === 'failed' ? 'warning' : 'meta'} role="status">
          {arrangement === 'failed' ? 'Nie udało się przywrócić układu.' : 'Układ kafelków wróci do domyślnego po powrocie na Pulpit.'}
        </p>}
        <p className="card-intro">Pobierz jeden plik z nazwami wszystkich pulpitów oraz zapisanym układem i ustawieniami ich kafelków w tej przeglądarce.</p>
        <button className="button" onClick={() => {
          try { downloadPulpits(); setExportError(false); } catch { setExportError(true); }
        }}>Eksportuj konfigurację pulpitów</button>
        {exportError && <p className="warning" role="alert">Nie udało się wyeksportować konfiguracji pulpitów. Sprawdź dostęp przeglądarki do zapisanych ustawień i spróbuj ponownie.</p>}
      </Card>
      <Card title="Źródła danych" icon={<Layers3 />} area="settings-sources">
        <p className="card-intro">
          Wszystkie źródła są podłączone przez lokalny serwer. Adapter odczytuje bieżące limity z loginów CLI; nie uruchamia generowania odpowiedzi.
        </p>
        {[
          'Cezar · workspace i zadania',
          'Claude / Codex / AGY · bieżące limity CLI',
          'Google Calendar · Twoje konto, tylko odczyt',
          'Windows · lokalny backend CPU i RAM',
        ].map((label) => (
          <div className="connection-row" key={label}>
            <span>{label}</span>
          </div>
        ))}
      </Card>
      <WarmupHistoryCard warmup={warmup} />
    </div>
  );
}
