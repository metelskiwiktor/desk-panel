import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { STORAGE_KEY } from './layout';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-14T10:00:00Z').getTime());
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const nav = (name: string) => within(screen.getByRole('navigation')).getByRole('button', { name });

describe('interaktywny panel', () => {
  it.each([
    ['loading', 'Ładowanie danych'],
    ['unavailable', 'Brak źródła danych'],
    ['offline', 'Offline · ostatni zapis'],
  ])('pokazuje stan %s i nie generuje Insights', async (scenario, label) => {
    const user = userEvent.setup();
    render(<App initialLive={false} />);
    await user.click(nav('Ustawienia'));
    await user.selectOptions(screen.getByLabelText('Zestaw danych'), scenario);
    await user.click(nav('Pulpit'));
    expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    expect(screen.getByText('Brak aktualnych sygnałów wymagających uwagi.')).toBeTruthy();
    const counts = screen
      .getAllByRole('button')
      .filter((button) => button.textContent?.includes('W kolejce'));
    expect(counts[0].textContent).toContain(scenario === 'offline' ? '2' : '—');
  });
  it('oznacza DEMO, otwiera zadanie z Insights i wraca do pulpitu', async () => {
    const user = userEvent.setup();
    render(<App initialLive={false} />);
    expect(screen.getAllByText(/Dane demonstracyjne/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /Cezar czeka na odpowiedź/ }));
    expect(
      screen.getByRole('heading', { name: 'Potwierdź zakres testów kalendarza' }),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Otwórz źródło/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Wróć/ }));
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeTruthy();
  });
  it('otwiera quota z timestampami, resetem i dyskretną historią', async () => {
    const user = userEvent.setup();
    render(<App initialLive={false} />);
    await user.click(screen.getByRole('button', { name: /^✳ Claude/ }));
    expect(screen.getByRole('heading', { name: 'Claude · limity konta' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Historia obserwacji' })).toBeTruthy();
    expect(screen.getAllByText('Reset według źródła')).toHaveLength(2);
    expect(screen.getByText('75% limitu')).toBeTruthy();
  });
  it('wszystkie zakładki działają; agenda prowadzi do szczegółów', async () => {
    const user = userEvent.setup();
    render(<App initialLive={false} />);
    await user.click(nav('Zadania'));
    expect(screen.getByRole('heading', { name: 'Wszystkie zadania' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Aktualizacja opisów testów/ })).toBeTruthy();
    await user.click(nav('Kalendarz'));
    await user.click(screen.getByRole('button', { name: /Planowanie Tabnote/ }));
    expect(screen.getByRole('heading', { name: 'Planowanie Tabnote' })).toBeTruthy();
    await user.click(nav('System'));
    expect(screen.getByText(/Backend Windows nie jest podłączony/)).toBeTruthy();
    await user.click(nav('Ustawienia'));
    expect(screen.getByRole('heading', { name: 'Twój układ' })).toBeTruthy();
  });
  it('zmienia widoczność, kolejność, wariant i odtwarza zapis po montażu', async () => {
    const user = userEvent.setup();
    const view = render(<App initialLive={false} />);
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('checkbox', { name: 'System' }));
    await user.click(screen.getByRole('button', { name: 'Insights w górę' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Wariant Cezar' }), 'compact');
    const config = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(config.widgets[1].visible).toBe(false);
    expect(config.widgets[3].id).toBe('insights');
    view.unmount();
    render(<App initialLive={false} />);
    expect(screen.queryByRole('heading', { name: 'System' })).toBeNull();
    // Compact Cezar shows just the first task (the additional Insights is still visible).
    expect(screen.queryByRole('button', { name: /Widok notatki gotowy do przeglądu/ })).toBeNull();
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('button', { name: 'Przywróć układ domyślny' }));
    await user.click(nav('Pulpit'));
    expect(screen.getByRole('heading', { name: 'System' })).toBeTruthy();
  });
  it('umożliwia sprawdzenie null, stale i pustych stanów bez fałszywych Insights', async () => {
    const user = userEvent.setup();
    render(<App initialLive={false} />);
    await user.click(nav('Ustawienia'));
    await user.selectOptions(screen.getByLabelText('Zestaw danych'), 'quota-missing');
    await user.click(nav('Pulpit'));
    expect(screen.getAllByText('Brak danych')).toHaveLength(4);
    expect(screen.queryByText('Claude: limit blisko wyczerpania')).toBeNull();
    await user.click(nav('Ustawienia'));
    await user.selectOptions(screen.getByLabelText('Zestaw danych'), 'stale');
    await user.click(nav('Pulpit'));
    expect(screen.getAllByText(/Nieaktualne/).length).toBeGreaterThan(0);
    expect(screen.getByText('Brak aktualnych sygnałów wymagających uwagi.')).toBeTruthy();
    await user.click(nav('Ustawienia'));
    await user.selectOptions(screen.getByLabelText('Zestaw danych'), 'empty');
    await user.click(nav('Pulpit'));
    expect(screen.getByText('Brak nadchodzących wydarzeń.')).toBeTruthy();
  });
  it('komunikuje brak możliwości zapisania ustawień', async () => {
    const user = userEvent.setup();
    render(<App initialLive={false} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('blocked');
    });
    await user.click(nav('Ustawienia'));
    await user.click(screen.getByRole('checkbox', { name: 'System' }));
    expect(screen.getByRole('status').textContent).toContain('Nie udało się zapisać');
  });
});
