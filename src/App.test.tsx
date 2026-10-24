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
  it('nie oznacza danych jako demonstracyjne ani rzeczywiste', async () => {
    renderWith();
    await loaded();
    expect(screen.queryByText(/DEMO|demonstracyjn|DANE RZECZYWISTE/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Cezar · / })).toBeTruthy();
  });
  it('pokazuje dzisiejsze spotkania na osi i kolejne dni', async () => {
    const user = userEvent.setup();
    renderWith();
    const today = await screen.findByRole('region', { name: 'Dziś' });
    // Meetings as a list with a countdown to the first; today's workout in full beside them.
    expect(within(today).getByRole('heading', { name: /^Spotkania · 3$/ })).toBeTruthy();
    expect(within(today).getByText('12 min')).toBeTruthy();
    expect(within(today).getByText('do spotkania')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Trening: Długa jazda/ })).toBeTruthy();
    const week = screen.getByRole('region', { name: 'Najbliższe dni' });
    expect(within(week).getByRole('button', { name: /^Próg/ })).toBeTruthy();
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
    expect(await screen.findByText(/Cezar · nic nie czeka/)).toBeTruthy();
    // Overload is a red chip (it opens the details) and, when it lasts, a panel event; never a card of its own.
    expect(screen.queryByText('KOMPUTER')).toBeNull();
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
  it('rysuje limity jako paski 5h i 7d ze znacznikiem czasu i kolorem tempa', async () => {
    renderWith();
    const strip = await screen.findByRole('region', { name: 'Limity AI' });
    const claude = await within(strip).findByRole('button', { name: /^Claude: 5h \d+% · 7d \d+%/ });
    // Two bars (5h thick, 7d thin), each with the tick of how far its window has run; 92% used at 58% of the time is red.
    expect(claude.querySelectorAll('.p3-lbar')).toHaveLength(2);
    expect(claude.querySelectorAll('.p3-lbar u')).toHaveLength(2);
    expect(claude.querySelector('.p3-lrow.lead .p3-lbar[data-tone="red"]')).toBeTruthy();
    expect(claude.querySelectorAll('.p3-lrow.thin')).toHaveLength(1);
    expect(within(claude).getByText(/reset za/)).toBeTruthy();
  });
  it('pokazuje wszystkich dostawców, także Gemini', async () => {
    renderWith();
    const strip = await screen.findByRole('region', { name: 'Limity AI' });
    for (const name of ['Claude', 'Codex', 'Gemini']) expect(await within(strip).findByRole('button', { name: new RegExp(`^${name}: 5h \\d`) })).toBeTruthy();
  });
  it('otwiera podział zużycia AI z limitów', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: 'Podział zużycia' }));
    expect(screen.getByRole('heading', { name: 'Podział zużycia AI' })).toBeTruthy();
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
    expect(within(rules).getAllByRole('row')).toHaveLength(9);
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
    // One line per limit card (each of the two cards has two windows without a reading).
    await waitFor(() => expect(screen.getAllByText('brak pomiaru')).toHaveLength(2));
    expect(screen.queryByText(/Claude.*limit blisko wyczerpania/)).toBeNull();
  });
  it('oznacza nieaktualne zapisy i nie tworzy z nich zdarzeń', async () => {
    renderWith('stale');
    expect((await screen.findAllByText(/Nieaktualn/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Zdarzenia panelu: 0' })).toBeTruthy();
  });
  it('zwija puste źródła', async () => {
    renderWith('empty');
    expect(await screen.findByText(/Cezar · nic nie czeka/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Poczta' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Dziś' })).getByText('bez spotkań')).toBeTruthy();
  });
  it('dopasowuje tryb układu do tego, co się dzieje', async () => {
    const quiet = renderWith('empty');
    await screen.findByText(/Cezar · nic nie czeka/);
    // Nothing waits: the work area holds the limits alone.
    const work = document.querySelector('.p3-work')!;
    expect(work.children).toHaveLength(1);
    expect(within(work as HTMLElement).getByRole('region', { name: 'Limity AI' })).toBeTruthy();
    quiet.unmount();
    renderWith('standard');
    await screen.findByRole('region', { name: 'Poczta' });
    // Cezar and mail have something: they join the limits in the same area.
    expect(document.querySelector('.p3-work')!.children).toHaveLength(3);
  });
  it('jedno zadanie Cezara w toku to jedna linia obok poczty, bez nagłówka z licznikami', async () => {
    renderWith('inbox');
    const cezar = await screen.findByRole('region', { name: 'Cezar' });
    expect(within(cezar).getAllByRole('button')).toHaveLength(1);
    expect(within(cezar).getByRole('button', { name: /Poprawa wyszukiwania po etykietach/ })).toBeTruthy();
    expect(within(await screen.findByRole('region', { name: 'Poczta' })).getAllByRole('button', { name: /^(Anna|GitHub)/ }).length).toBeGreaterThan(0);
  });
  it('przycisk dzień/noc przyciemnia pulpit, a pełny ekran jest tylko tam, gdzie przeglądarka go ma', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: 'Przełącz na tryb nocny' }));
    expect(document.querySelector('.app-shell')!.getAttribute('data-night')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Przełącz na tryb dzienny' }));
    expect(document.querySelector('.app-shell')!.getAttribute('data-night')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Pełny ekran' })).toBeNull();
  });
  it('przycisk zegara od razu pokazuje tryb ambient, a dotknięcie go kończy', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: 'Pokaż zegar (tryb ambient)' }));
    await user.click(screen.getByRole('button', { name: 'Wybudź panel' }));
    expect(screen.queryByRole('button', { name: 'Wybudź panel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pokaż zegar (tryb ambient)' })).toBeTruthy();
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
  it('chip PC otwiera okno z wykresami CPU i RAM, a przycisk prowadzi do zakładki System', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: /^PC · CPU/ }));
    const dialog = screen.getByRole('dialog', { name: 'Komputer' });
    expect(within(dialog).getByRole('img', { name: /^CPU: teraz/ })).toBeTruthy();
    expect(within(dialog).getByRole('img', { name: /^RAM: teraz/ })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Otwórz zakładkę Komputer/ }));
    expect(screen.queryByRole('dialog', { name: 'Komputer' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'System' })).toBeTruthy();
  });
  it('zamyka się Escape i dotknięciem poza oknem', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: /^PC · CPU/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Komputer' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^PC · CPU/ }));
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    expect(screen.queryByRole('dialog', { name: 'Komputer' })).toBeNull();
  });
});
