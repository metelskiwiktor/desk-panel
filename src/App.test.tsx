import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { STORAGE_KEY } from './layout';
import { scenarioFetch, type ScenarioName } from './test-fixtures';

const now = new Date('2026-10-14T10:00:00Z').getTime();
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const nav = (name: string) => within(screen.getByRole('navigation')).getByRole('button', { name });

function renderWith(scenario: ScenarioName = 'standard') {
  vi.stubGlobal('fetch', vi.fn(scenarioFetch(scenario)));
  return render(<App />);
}
const loaded = () => screen.findAllByText(/Potwierdź zakres testów kalendarza/);

describe('interaktywny panel', () => {
  it.each([
    ['loading', 'Ładowanie danych'],
    ['unavailable', 'Brak źródła danych'],
    ['offline', 'Offline · ostatni zapis'],
  ] as const)('pokazuje stan %s i nie generuje zdarzeń', async (scenario, label) => {
    renderWith(scenario);
    expect((await screen.findAllByText(new RegExp(label))).length).toBeGreaterThan(0);
    expect(screen.getByText('Brak zapisanych zdarzeń.')).toBeTruthy();
    const counts = screen
      .getAllByRole('button')
      .filter((button) => button.textContent?.includes('W kolejce'));
    expect(counts[0].textContent).toContain('—');
  });
  it('nie oznacza danych jako demonstracyjne ani rzeczywiste', async () => {
    renderWith();
    await loaded();
    expect(screen.queryByText(/DEMO|demonstracyjn|DANE RZECZYWISTE/)).toBeNull();
    expect(screen.getAllByText(/Połączono z Cezarem/).length).toBeGreaterThan(0);
  });
  it('otwiera zadanie ze zdarzeń i wraca do pulpitu', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: /^Cezar czeka na odpowiedź/ }));
    expect(
      screen.getByRole('heading', { name: 'Potwierdź zakres testów kalendarza' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /Otwórz źródło/ }).getAttribute('href')).toBe(
      'http://127.0.0.1:4321/p/tabnote/tasks/decision',
    );
    await user.click(screen.getByRole('button', { name: /Wróć/ }));
    expect(screen.getByRole('heading', { name: 'Zdarzenia' })).toBeTruthy();
  });
  it('otwiera quota z timestampami, resetem i dyskretną historią', async () => {
    const user = userEvent.setup();
    renderWith();
    expect(screen.queryByRole('region', { name: 'Legenda wykresu limitów' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: /^✳ Claude/ }));
    expect(screen.getByRole('heading', { name: 'Claude · limity konta' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Legenda wykresu limitów' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Historia obserwacji' })).toBeTruthy();
    expect(screen.getAllByText('Reset według źródła')).toHaveLength(2);
    expect(screen.getByText('75% limitu')).toBeTruthy();
  });
  it('wszystkie zakładki działają; agenda prowadzi do szczegółów', async () => {
    const user = userEvent.setup();
    renderWith();
    await loaded();
    await user.click(nav('Zadania'));
    expect(screen.getByRole('heading', { name: 'Aktywne zadania Cezara' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Aktualizacja opisów testów/ })).toBeTruthy();
    await user.click(nav('Kalendarz'));
    await user.click(screen.getByRole('button', { name: /Planowanie Tabnote/ }));
    expect(screen.getByRole('heading', { name: 'Planowanie Tabnote' })).toBeTruthy();
    await user.click(nav('System'));
    expect(screen.getByText(/lokalny pomiar co około 2 sekundy/)).toBeTruthy();
    await user.click(nav('Zdarzenia'));
    expect(screen.getByRole('heading', { level: 1, name: 'Zdarzenia' })).toBeTruthy();
    const rules = screen.getByRole('table', { name: 'Aktualne reguły tworzenia zdarzeń' });
    expect(within(rules).getAllByRole('row')).toHaveLength(8);
    expect(within(rules).getByRole('columnheader', { name: 'Kiedy ponownie' })).toBeTruthy();
    expect(within(rules).getByText('Zużycie wyprzedza czas o ponad 5 do 15 p.p.')).toBeTruthy();
    expect(screen.getByText(/Restart serwera i odświeżenie strony zachowują historię/)).toBeTruthy();
    await user.click(nav('Ustawienia'));
    expect(screen.getByRole('heading', { name: 'Twój układ' })).toBeTruthy();
    expect(screen.queryByText(/Scenariusze|Rzeczywiste źródła danych/)).toBeNull();
  });
  it('zmienia widoczność, kolejność, wariant i odtwarza zapis po montażu', async () => {
    const user = userEvent.setup();
    const view = renderWith();
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('checkbox', { name: 'System' }));
    await user.click(screen.getByRole('button', { name: 'Zdarzenia w górę' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Wariant Cezar' }), 'compact');
    const config = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(config.widgets[1].visible).toBe(false);
    expect(config.widgets[3].id).toBe('insights');
    view.unmount();
    render(<App />);
    await loaded();
    expect(screen.queryByRole('heading', { name: 'System' })).toBeNull();
    // Compact Cezar shows just the first task (the additional Insights is still visible).
    expect(screen.queryByRole('button', { name: /Widok notatki gotowy do przeglądu/ })).toBeNull();
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('button', { name: 'Przywróć układ domyślny' }));
    await user.click(nav('Pulpit'));
    expect(screen.getByRole('heading', { name: 'System' })).toBeTruthy();
  });
  it('pokazuje brak pomiaru limitów bez fałszywych zdarzeń', async () => {
    renderWith('quota-missing');
    await waitFor(() => expect(screen.getAllByText('Brak danych')).toHaveLength(4));
    expect(screen.queryByText(/Claude.*limit blisko wyczerpania/)).toBeNull();
  });
  it('oznacza nieaktualne zapisy i nie tworzy z nich zdarzeń', async () => {
    renderWith('stale');
    expect((await screen.findAllByText(/Nieaktualn/)).length).toBeGreaterThan(0);
    expect(screen.getByText('Brak zapisanych zdarzeń.')).toBeTruthy();
  });
  it('pokazuje puste źródła', async () => {
    renderWith('empty');
    expect(await screen.findByText('Brak nadchodzących wydarzeń.')).toBeTruthy();
  });
  it('komunikuje brak możliwości zapisania ustawień', async () => {
    const user = userEvent.setup();
    renderWith();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('blocked');
    });
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('checkbox', { name: 'System' }));
    expect(screen.getByText(/Nie udało się zapisać\. Układ/)).toBeTruthy();
  });
});
