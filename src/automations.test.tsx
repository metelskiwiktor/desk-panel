import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationsView } from './AutomationsView';
import { scenarioFetch } from './test-fixtures';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('Automaty view', () => {
  it('lists cyclic and one-shot automations with status dots and run dots', async () => {
    vi.stubGlobal('fetch', scenarioFetch('standard'));
    const user = userEvent.setup({ delay: null });
    const { container } = render(<AutomationsView />);
    await screen.findAllByText('Ceny prądu u dostawcy');
    expect(screen.getByText('Cykliczne')).toBeTruthy();
    expect(screen.getByText('Jednorazowe')).toBeTruthy();
    expect(screen.getByText('Treningi w planie Garmina')).toBeTruthy();
    expect(screen.getByText('Przypomnienie o rachunku')).toBeTruthy();
    const rows = screen.getAllByRole('button', { name: /Ceny prądu u dostawcy|Treningi|Przypomnienie/ });
    expect(rows.length).toBe(3);
    // The newest run of the first automation is expanded with its summary; older runs are one line each.
    const axis = container.querySelectorAll('.automation-runs > li');
    expect(axis.length).toBe(5);
    expect(axis[0].className).toContain('newest');
    expect(axis[0].textContent).toContain('Cennik bez zmian');
    expect(axis[0].textContent).toContain('notatnik bez zmian');
    expect(axis[1].textContent).toContain('Nowa promocja na 6 miesięcy');
    expect(axis[1].querySelector('.automation-run-card')).toBeNull();
    // The five run dots are the last runs, oldest first: four grey „not-yet” and no empty dots.
    const dots = container.querySelectorAll('.automation-row')[0].querySelectorAll('.automation-dots .automation-dot');
    expect(dots.length).toBe(5);
    expect([...dots].every(dot => dot.classList.contains('idle'))).toBe(true);
    const pausedDots = container.querySelectorAll('.automation-row')[1].querySelectorAll('.automation-dots .automation-dot');
    expect(pausedDots[0].classList.contains('bad')).toBe(true);
    expect(container.querySelectorAll('.automation-row')[2].querySelector('.automation-dots .automation-dot')!.classList.contains('ok')).toBe(true);
    expect(screen.getByText(/5 runów/)).toBeTruthy();
    expect(screen.getByText(/koszt łącznie/)).toBeTruthy();
    expect(screen.getByText('Wektor o tych runach')).toBeTruthy();
    expect(screen.getByText('Gdy cel zostanie osiągnięty')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Notatnik' }));
    expect((screen.getByLabelText('Notatnik automatu') as HTMLTextAreaElement).value).toContain('0,79 zł/kWh');
    await user.click(screen.getByRole('tab', { name: 'Cel i akcje' }));
    expect(screen.getByText(/Sprawdzaj codziennie rano/)).toBeTruthy();
    expect(screen.getAllByText('Wiadomość w tej rozmowie').length).toBeGreaterThan(0);
  });

  it('pauses and resumes through the Origin-checked action', async () => {
    vi.stubGlobal('fetch', scenarioFetch('standard'));
    const user = userEvent.setup({ delay: null });
    render(<AutomationsView />);
    await screen.findAllByText('Ceny prądu u dostawcy');
    await user.click(screen.getByRole('button', { name: /Wstrzymaj/ }));
    expect(await screen.findByRole('button', { name: /Wznów/ })).toBeTruthy();
  });
});
