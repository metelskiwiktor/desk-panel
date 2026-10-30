import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { systemAlert } from './Dashboard';
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
    expect(screen.getByRole('button', { name: 'Zdarzenia panelu: 0' })).toBeTruthy();
    expect(screen.queryByText(/^0 w toku/)).toBeNull();
  });
  // One render of the standard screen for what it shows before any tap; each test below taps through one flow.
  it('standardowy pulpit: oś dnia, tydzień, Cezar, limity w osobnych kafelkach i pełna siatka 4×2', async () => {
    const user = userEvent.setup();
    renderWith();
    const today = await screen.findByRole('region', { name: 'Dziś' });
    expect(within(today).getByRole('button', { name: /^Trening: Długa jazda/ })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Najbliższe dni' })).getAllByRole('button', { name: /^Pokaż dzień:/ })).toHaveLength(7);
    const cezar = await screen.findByRole('region', { name: 'Cezar' });
    expect(within(cezar).getByRole('button', { name: /Potwierdź zakres testów kalendarza/ })).toBeTruthy();
    expect(within(cezar).getByRole('button', { name: /Widok notatki gotowy do przeglądu/ })).toBeTruthy();
    expect(within(cezar).queryByRole('button', { name: /więcej$/ })).toBeNull();
    expect(screen.queryByText('KOMPUTER')).toBeNull();
    expect(screen.queryByText(/DEMO|demonstracyjn|DANE RZECZYWISTE/)).toBeNull();
    for (const name of ['Claude', 'Codex', 'Gemini']) {
      const limit = await screen.findByRole('button', { name: new RegExp(`^${name}: 5h \\d`) });
      expect(limit.closest('section')!.getAttribute('aria-label')).toBe(name);
    }
    const claude = screen.getByRole('button', { name: /^Claude: 5h \d+% · 7d \d+%/ });
    // Two bars (5h thick, 7d thin), each with the tick of how far its window has run; 92% used at 58% of the time is red.
    expect(claude.querySelectorAll('.p3-lbar')).toHaveLength(2);
    expect(claude.querySelectorAll('.p3-lbar u')).toHaveLength(2);
    expect(claude.querySelector('.p3-lrow.lead .p3-lbar[data-tone="red"]')).toBeTruthy();
    expect(claude.querySelectorAll('.p3-lrow.thin')).toHaveLength(1);
    expect(within(claude).getByText(/reset za/)).toBeTruthy();
    // Three limits and mail beside Cezar over the right half: nothing is left empty, and nothing is cut.
    const grid = document.querySelector('.wk-grid')!;
    expect(grid.querySelectorAll('.wk-cell')).toHaveLength(5);
    expect(grid.querySelectorAll('.wk-empty')).toHaveLength(0);
    expect(grid.querySelector('[data-kind="cezar"]')!.getAttribute('style')).toContain('--w: 2');
    expect(grid.querySelector('[data-kind="cezar"]')!.getAttribute('style')).toContain('--h: 2');
    await user.click(within(today).getByRole('button', { name: /Planowanie Tabnote/ }));
    expect(screen.getByRole('heading', { name: 'Planowanie Tabnote' })).toBeTruthy();
  });
  it('przy przeciążeniu Cezar się zwija, a komputer jest czerwonym chipem, nie kartą', async () => {
    renderWith('high-ram');
    expect(await screen.findByText(/Cezar · nic nie czeka/)).toBeTruthy();
    // Overload is a red chip (it opens the details) and, when it lasts, a panel event; never a card of its own.
    expect(screen.queryByText('KOMPUTER')).toBeNull();
    expect(screen.getByRole('button', { name: /^PC · RAM \d+%$/ })).toBeTruthy();
  });
  it('zdarzenia panelu: każde ze źródłem, lista się zwija, a zadanie otwiera się i wraca do pulpitu', async () => {
    const user = userEvent.setup();
    renderWith();
    await openEvents(user);
    let events = screen.getByRole('region', { name: 'Zdarzenia panelu' });
    expect(within(events).getAllByText('Kalendarz').length).toBeGreaterThan(0);
    expect(within(events).getAllByText('Limity AI').length).toBeGreaterThan(0);
    await user.click(within(events).getByRole('button', { name: 'Zwiń zdarzenia panelu' }));
    await openEvents(user);
    events = screen.getByRole('region', { name: 'Zdarzenia panelu' });
    await user.click(within(events).getByRole('button', { name: 'Cezar: Cezar czeka na odpowiedź' }));
    expect(screen.getByRole('heading', { name: 'Potwierdź zakres testów kalendarza' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Otwórz źródło/ }).getAttribute('href')).toBe(
      'http://127.0.0.1:4321/p/tabnote/tasks/decision',
    );
    await user.click(screen.getByRole('button', { name: /Wróć/ }));
    expect(screen.getByRole('region', { name: 'Dziś' })).toBeTruthy();
  });
  it('limit otwiera szczegóły z timestampami, resetem i historią, a podział zużycia swój widok', async () => {
    const user = userEvent.setup();
    renderWith();
    expect(screen.queryByRole('region', { name: 'Legenda wykresu limitów' })).toBeNull();
    // The tile first says it is loading; the button is there once the limits have been read.
    await user.click(await screen.findByRole('button', { name: /^Claude: 5h/ }));
    expect(screen.getByRole('heading', { name: 'Claude · limity konta' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Legenda wykresu limitów' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Historia obserwacji' })).toBeTruthy();
    expect(screen.getAllByText('Reset według źródła')).toHaveLength(2);
    expect(screen.getByText('75% limitu')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Przejdź do pulpitu' }));
    await user.click((await screen.findAllByRole('button', { name: 'Podział zużycia' }))[0]);
    expect(screen.getByRole('heading', { name: 'Podział zużycia AI' })).toBeTruthy();
  });
  it('wszystkie zakładki działają, agenda prowadzi do szczegółów, a przyciski u góry zastępują pasek na dole', async () => {
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
    expect(within(rules).getAllByRole('row')).toHaveLength(9);
    expect(within(rules).getByRole('columnheader', { name: 'Kiedy ponownie' })).toBeTruthy();
    expect(within(rules).getByText('Zużycie wyprzedza czas o ponad 5 do 15 p.p.')).toBeTruthy();
    expect(screen.getByText(/Restart serwera i odświeżenie strony zachowują historię/)).toBeTruthy();
    await user.click(nav('Ustawienia'));
    expect(screen.getByRole('heading', { name: 'Pulpit' })).toBeTruthy();
    expect(screen.queryByText(/Scenariusze|Rzeczywiste źródła danych/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Przejdź do pulpitu' }));
    await user.click(await screen.findByRole('button', { name: 'Otwórz kalendarz' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Kalendarz' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Ustawienia' })).toBeTruthy();
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
    // One line per limit card (each of the two cards has two windows without a reading).
    await waitFor(() => expect(screen.getAllByText('brak pomiaru')).toHaveLength(2));
    expect(screen.queryByText(/Claude.*limit blisko wyczerpania/)).toBeNull();
  });
  it('oznacza nieaktualne zapisy i nie tworzy z nich zdarzeń', async () => {
    renderWith('stale');
    expect((await screen.findAllByText(/Nieaktualn/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Zdarzenia panelu: 0' })).toBeTruthy();
  });
  it('puste źródła mówią to spokojnie w swoich kafelkach, zamiast znikać', async () => {
    renderWith('empty');
    expect(await screen.findByText(/Cezar · nic nie czeka/)).toBeTruthy();
    expect(within(await screen.findByRole('region', { name: 'Cezar' })).getByText('Nic nie czeka ani nie trwa.')).toBeTruthy();
    expect(within(await screen.findByRole('region', { name: 'Poczta' })).getByText('Brak nieprzeczytanych wiadomości.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Dziś' })).getByText('Dziś bez treningu i spotkań')).toBeTruthy();
  });
  it('jedno zadanie Cezara w toku to jedna linia obok poczty, bez nagłówka z licznikami', async () => {
    renderWith('inbox');
    const cezar = await screen.findByRole('region', { name: 'Cezar' });
    expect(within(cezar).getAllByRole('button')).toHaveLength(1);
    expect(within(cezar).getByRole('button', { name: /Poprawa wyszukiwania po etykietach/ })).toBeTruthy();
    expect(within(await screen.findByRole('region', { name: 'Poczta' })).getAllByRole('button', { name: /^(Anna|GitHub)/ }).length).toBeGreaterThan(0);
  });
  it('przycisk dzień/noc przyciemnia pulpit, zegar od razu pokazuje tryb ambient, a pełnego ekranu nie ma', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: 'Przełącz na tryb nocny' }));
    expect(document.querySelector('.app-shell')!.getAttribute('data-night')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Przełącz na tryb dzienny' }));
    expect(document.querySelector('.app-shell')!.getAttribute('data-night')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Pełny ekran' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pokaż zegar (tryb ambient)' }));
    await user.click(screen.getByRole('button', { name: 'Wybudź panel' }));
    expect(screen.queryByRole('button', { name: 'Wybudź panel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pokaż zegar (tryb ambient)' })).toBeTruthy();
  });
  it('prowadzi z Ustawień do widoku Automaty', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(nav('Ustawienia'));
    await user.click(await screen.findByRole('button', { name: 'Otwórz Automaty' }));
    expect((await screen.findAllByRole('heading', { name: 'Automaty' })).length).toBe(1);
    expect((await screen.findAllByText('Ceny prądu u dostawcy')).length).toBeGreaterThan(0);
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

describe('alarm obciążenia komputera', () => {
  const sample = (at: number, cpuPercent: number) => ({ at, cpuPercent, ramUsedGb: 10, ramTotalGb: 32 });
  const withSamples = (samples: ReturnType<typeof sample>[]) => ({ system: { status: 'connected' as const, observedAt: now, live: true, data: samples } }) as unknown as Parameters<typeof systemAlert>[0];
  it('czerwienieje dopiero po utrzymanym obciążeniu, nie od skoku', () => {
    const base = Array.from({ length: 11 }, (_, i) => sample(now - (10 - i) * 2000, 30));
    expect(systemAlert(withSamples([...base.slice(0, -1), sample(now, 100)]), now)).toBeNull();
    const held = Array.from({ length: 11 }, (_, i) => sample(now - (10 - i) * 2000, 97));
    expect(systemAlert(withSamples(held), now)).toMatchObject({ metric: 'CPU' });
    expect(systemAlert(withSamples(held.slice(-3)), now)).toBeNull(); // 4 s of history is not yet a trend
  });
});

describe('okno komputera', () => {
  it('chip PC otwiera okno z wykresami CPU i RAM; Escape i dotknięcie poza nim je zamykają, a przycisk prowadzi do zakładki System', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: /^PC · CPU/ }));
    let dialog = screen.getByRole('dialog', { name: 'Komputer' });
    expect(within(dialog).getByRole('img', { name: /^CPU: teraz/ })).toBeTruthy();
    expect(within(dialog).getByRole('img', { name: /^RAM: teraz/ })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Komputer' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^PC · CPU/ }));
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    expect(screen.queryByRole('dialog', { name: 'Komputer' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Przejdź do pulpitu' }));
    await user.click(await screen.findByRole('button', { name: /^PC · CPU/ }));
    dialog = screen.getByRole('dialog', { name: 'Komputer' });
    await user.click(within(dialog).getByRole('button', { name: /Otwórz zakładkę Komputer/ }));
    expect(screen.queryByRole('dialog', { name: 'Komputer' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'System' })).toBeTruthy();
  });
});
