import { Check, Layers3, Settings2 } from 'lucide-react';
import { defaultLayout, widgetNames, type Layout } from './layout';
import { Card } from './components';
import { GoogleAccounts } from './GoogleAccounts';
import { ScreenCard } from './ScreenCard';

export function SettingsView({
  layout,
  configure,
  storageError,
  tabletPreview,
  onTabletPreviewChange,
}: {
  layout: Layout;
  configure: (next: Layout) => void;
  storageError: boolean;
  tabletPreview?: boolean;
  onTabletPreviewChange?: () => void;
}) {
  return (
    <div className="settings-stack">
      <Card title="Połączenia" icon={<Layers3 />}>
        <p className="card-intro">CPU i RAM co około 2 sekundy, Cezar co 5 sekund, kalendarz co minutę. Bieżące limity AI co około minutę, bez rozmów z modelem.</p>
      </Card>
      <ScreenCard />
      <Card title="Podgląd pionowy" icon={<Settings2 />}>
        <p className="card-intro">Ten sam panel w pionowym obszarze docelowego ekranu, bez pomniejszania tekstu. Podgląd można przewijać; powiększenie przeglądarki działa jak zwykle.</p>
        <button className="button" aria-pressed={!!tabletPreview} onClick={onTabletPreviewChange}>
          {tabletPreview ? 'Zamknij podgląd pionowy' : 'Otwórz podgląd pionowy'}
        </button>
      </Card>
      <GoogleAccounts />
      <Card title="Pulpit" icon={<Settings2 />}>
        <p className="card-intro">
          Które sekcje pokazuje Pulpit. Ich wielkość dopasowuje się do zawartości i ekranu; zapis dotyczy tylko tej przeglądarki.
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
      </Card>
      <Card title="Źródła danych" icon={<Layers3 />}>
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
    </div>
  );
}
