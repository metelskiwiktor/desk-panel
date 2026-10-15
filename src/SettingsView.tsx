import { ArrowDown, ArrowUp, Check, Layers3, Settings2 } from 'lucide-react';
import { defaultLayout, moveWidget, widgetNames, type Layout } from './layout';
import { Card } from './components';
import { CalendarConnection } from './CalendarConnection';

export function SettingsView({
  layout,
  configure,
  storageError,
}: {
  layout: Layout;
  configure: (next: Layout) => void;
  storageError: boolean;
}) {
  return (
    <div className="settings-stack">
      <Card title="Połączenia" icon={<Layers3 />}>
        <p className="card-intro">CPU i RAM co około 2 sekundy, Cezar co 5 sekund, kalendarz co minutę. Bieżące limity AI co około minutę, bez rozmów z modelem.</p>
      </Card>
      <CalendarConnection />
      <Card title="Twój układ" icon={<Settings2 />}>
        <p className="card-intro">
          Widoczność, kolejność i gęstość kart. Ustawienia są zapisywane tylko w tej przeglądarce.
        </p>
        {layout.widgets.map((w, i) => (
          <div className="widget-setting" key={w.id}>
            <label className="visibility-toggle">
              <input
                type="checkbox"
                checked={w.visible}
                onChange={(e) =>
                  configure({
                    ...layout,
                    widgets: layout.widgets.map((c) =>
                      c.id === w.id ? { ...c, visible: e.target.checked } : c,
                    ),
                  })
                }
              />
              <span>{widgetNames[w.id]}</span>
            </label>
            <div className="setting-controls">
              {['cezar', 'calendar'].includes(w.id) && (
                <label className="mode-control">
                  <span className="sr-only">Wariant {widgetNames[w.id]}</span>
                  <select
                    value={w.displayMode}
                    onChange={(e) =>
                      configure({
                        ...layout,
                        widgets: layout.widgets.map((c) =>
                          c.id === w.id
                            ? {
                                ...c,
                                displayMode: e.target.value as 'compact' | 'expanded',
                              }
                            : c,
                        ),
                      })
                    }
                  >
                    <option value="expanded">Pełny</option>
                    <option value="compact">Zwięzły</option>
                  </select>
                </label>
              )}
              <button
                className="icon-button"
                disabled={i === 0}
                aria-label={`${widgetNames[w.id]} w górę`}
                onClick={() => configure(moveWidget(layout, w.id, -1))}
              >
                <ArrowUp size={20} />
              </button>
              <button
                className="icon-button"
                disabled={i === layout.widgets.length - 1}
                aria-label={`${widgetNames[w.id]} w dół`}
                onClick={() => configure(moveWidget(layout, w.id, 1))}
              >
                <ArrowDown size={20} />
              </button>
            </div>
          </div>
        ))}
        <p className={`save-status ${storageError ? 'warning' : ''}`} role="status">
          {storageError ? (
            'Nie udało się zapisać. Układ działa w tej sesji.'
          ) : (
            <>
              <Check size={16} /> Układ zapisuje się automatycznie
            </>
          )}
        </p>
        <button className="button" onClick={() => configure(defaultLayout())}>
          Przywróć układ domyślny
        </button>
        <p className="footnote">
          Skalowanie kart według kontekstu: kolejny etap. W MVP rozmiar zmieniasz ręcznie; zadania
          wymagające odpowiedzi mają wyróżnienie.
        </p>
      </Card>
      <Card title="Źródła danych" icon={<Layers3 />}>
        <p className="card-intro">
          Wszystkie źródła są podłączone przez lokalny serwer. Adapter odczytuje bieżące limity z loginów CLI; nie uruchamia generowania odpowiedzi.
        </p>
        {[
          'Cezar · workspace i zadania',
          'Claude / Codex · bieżące limity CLI',
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
