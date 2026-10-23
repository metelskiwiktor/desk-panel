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

const openEvents = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole('button', { name: /^Zdarzenia panelu:/ }));

describe('interaktywny panel', () => {
  it.each([
    ['loading', /Cezar · ładowanie/],
    ['unavailable', /Cezar niedostępny/],
    ['offline', /Offline · ostatni zapis/],
  ] as const)('pokazuje stan %s i nie generuje zdarzeń', async (scenario, label) => {
    renderWith(scenario);
    expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Zdarzenia panelu/ })).toBeNull();
    expect(screen.queryByText(/^0 w toku/)).toBeNull();
  });
  it('nie oznacza danych jako demonstracyjne ani rzeczywiste', async () => {
    renderWith();
    await loaded();
    expect(screen.queryByText(/DEMO|demonstracyjn|DANE RZECZYWISTE/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Cezar' })).toBeTruthy();
  });
  it('pokazuje dzisiejsze spotkania na osi i kolejne dni', async () => {
    const user = userEvent.setup();
    renderWith();
    const today = await screen.findByRole('region', { name: 'Dziś' });
    expect(within(today).getByText(/3 spotkania · najbliższe za 12 min/)).toBeTruthy();
    expect(within(today).getByText('KOLEJNE DNI')).toBeTruthy();
    await user.click(within(today).getByRole('button', { name: /Planowanie Tabnote/ }));
    expect(screen.getByRole('heading', { name: 'Planowanie Tabnote' })).toBeTruthy();
  });
  it('otwiera zadanie ze zdarzeń panelu i wraca do pulpitu', async () => {
    const user = userEvent.setup();
    renderWith();
    await openEvents(user);
    const events = screen.getByRole('region', { name: 'Zdarzenia panelu' });
    await user.click(within(events).getByRole('button', { name: 'Cezar: Cezar czeka na odpowiedź' }));
    expect(screen.getByRole('heading', { name: 'Potwierdź zakres testów kalendarza' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Otwórz źródło/ }).getAttribute('href')).toBe(
      'http://127.0.0.1:4321/p/tabnote/tasks/decision',
    );
    await user.click(screen.getByRole('button', { name: /Wróć/ }));
    expect(screen.getByRole('region', { name: 'Dziś' })).toBeTruthy();
  });
  it('podpisuje każde zdarzenie jego źródłem i zwija listę', async () => {
    const user = userEvent.setup();
    renderWith();
    await openEvents(user);
    const events = screen.getByRole('region', { name: 'Zdarzenia panelu' });
    expect(within(events).getAllByText('Kalendarz').length).toBeGreaterThan(0);
    expect(within(events).getAllByText('Limity AI').length).toBeGreaterThan(0);
    await user.click(within(events).getByRole('button', { name: 'Zwiń zdarzenia panelu' }));
    expect(screen.getByRole('button', { name: /^Zdarzenia panelu:/ })).toBeTruthy();
  });
  it('rozwija Cezara tylko gdy coś czeka i pokazuje komputer tylko przy problemie', async () => {
    renderWith();
    const cezar = await screen.findByRole('region', { name: 'Cezar' });
    expect(within(cezar).getByRole('button', { name: /Potwierdź zakres testów kalendarza/ })).toBeTruthy();
    expect(within(cezar).getByRole('button', { name: /więcej$/ })).toBeTruthy();
    expect(screen.queryByText('KOMPUTER')).toBeNull();
    cleanup();
    renderWith('high-ram');
    expect(await screen.findByText(/Cezar · nic nie czeka na Ciebie/)).toBeTruthy();
    expect(await screen.findByText('KOMPUTER')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^PC · RAM \d+%$/ })).toBeTruthy();
  });
  it('otwiera quota z timestampami, resetem i dyskretną historią', async () => {
    const user = userEvent.setup();
    renderWith();
    expect(screen.queryByRole('region', { name: 'Legenda wykresu limitów' })).toBeNull();
    const strip = await screen.findByRole('region', { name: 'Limity AI' });
    await user.click(await within(strip).findByRole('button', { name: /^Claude/ }));
    expect(screen.getByRole('heading', { name: 'Claude · limity konta' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Legenda wykresu limitów' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Historia obserwacji' })).toBeTruthy();
    expect(screen.getAllByText('Reset według źródła')).toHaveLength(2);
    expect(screen.getByText('75% limitu')).toBeTruthy();
  });
  it('rysuje pasek 5h w kolorach źródeł, gdy jest podział, a 7d zostawia jednokolorowy', async () => {
    renderWith();
    const strip = await screen.findByRole('region', { name: 'Limity AI' });
    await waitFor(() => expect(strip.querySelector('.quota-split')).toBeTruthy());
    const split = strip.querySelector('.quota-split')!;
    expect(split.children.length).toBeGreaterThan(0);
    const bar = split.closest('.quota-bar')!;
    expect(within(bar as HTMLElement).getByRole('meter').getAttribute('aria-label')).toBe('Użycie limitu 5h');
    expect(strip.querySelectorAll('.quota-fill:not(.quota-split)').length).toBeGreaterThan(0);
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
    expect(screen.getByRole('heading', { name: 'Pulpit' })).toBeTruthy();
    expect(screen.queryByText(/Scenariusze|Rzeczywiste źródła danych/)).toBeNull();
  });
  it('ukrywa sekcje i odtwarza zapis po montażu', async () => {
    const user = userEvent.setup();
    const view = renderWith();
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('checkbox', { name: 'Poczta' }));
    const config = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(config.widgets.find((w: { id: string }) => w.id === 'mail').visible).toBe(false);
    view.unmount();
    render(<App />);
    await loaded();
    expect(screen.queryByRole('region', { name: 'Poczta' })).toBeNull();
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('button', { name: 'Pokaż wszystkie sekcje' }));
    await user.click(nav('Pulpit'));
    expect(screen.getByRole('region', { name: 'Poczta' })).toBeTruthy();
  });
  it('pokazuje brak pomiaru limitów bez fałszywych zdarzeń', async () => {
    renderWith('quota-missing');
    await waitFor(() => expect(screen.getAllByText('brak pomiaru')).toHaveLength(4));
    expect(screen.queryByText(/Claude.*limit blisko wyczerpania/)).toBeNull();
  });
  it('oznacza nieaktualne zapisy i nie tworzy z nich zdarzeń', async () => {
    renderWith('stale');
    expect((await screen.findAllByText(/Nieaktualn/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Zdarzenia panelu/ })).toBeNull();
  });
  it('zwija puste źródła', async () => {
    renderWith('empty');
    expect(await screen.findByText(/Cezar · nic nie czeka na Ciebie/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Poczta' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Dziś' })).getByText('bez spotkań')).toBeTruthy();
  });
  it('dopasowuje tryb układu do tego, co się dzieje', async () => {
    const quiet = renderWith('empty');
    await screen.findByText(/Cezar · nic nie czeka na Ciebie/);
    expect(document.querySelector('.pulpit')!.getAttribute('data-mode')).toBe('calm');
    quiet.unmount();
    renderWith('standard');
    await screen.findByRole('region', { name: 'Poczta' });
    expect(document.querySelector('.pulpit')!.getAttribute('data-mode')).toBe('full');
  });
  it('nawiguje dotknięciem paneli i przyciskami u góry zamiast paska na dole', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: 'Otwórz kalendarz' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Kalendarz' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Ustawienia' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Przejdź do pulpitu' }));
    expect(await screen.findByRole('region', { name: 'Dziś' })).toBeTruthy();
  });
  it('komunikuje brak możliwości zapisania ustawień', async () => {
    const user = userEvent.setup();
    renderWith();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('blocked');
    });
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('checkbox', { name: 'Poczta' }));
    expect(screen.getByText(/Nie udało się zapisać\. Ustawienia/)).toBeTruthy();
  });
});
