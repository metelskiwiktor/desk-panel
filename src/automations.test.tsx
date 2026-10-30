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
    render(<AutomationsView />);
    await screen.findAllByText('Ceny prądu u dostawcy');
    expect(screen.getByText('Cykliczne')).toBeTruthy();
    expect(screen.getByText('Jednorazowe')).toBeTruthy();
    expect(screen.getByText('Treningi w planie Garmina')).toBeTruthy();
    expect(screen.getByText('Przypomnienie o rachunku')).toBeTruthy();
    const rows = screen.getAllByRole('button', { name: /Ceny prądu u dostawcy|Treningi|Przypomnienie/ });
    expect(rows.length).toBe(3);
    // The newest run of the first automation is expanded with its summary.
    expect(screen.getByText(/Cennik bez zmian/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Notatnik' }));
    expect((screen.getByLabelText('Notatnik automatu') as HTMLTextAreaElement).value).toContain('0,79 zł/kWh');
    await user.click(screen.getByRole('tab', { name: 'Cel i akcje' }));
    expect(screen.getByText(/Sprawdzaj codziennie rano/)).toBeTruthy();
    expect(screen.getAllByText('message').length).toBeGreaterThan(0);
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
