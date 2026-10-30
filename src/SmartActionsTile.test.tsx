import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartActionsTile } from './SmartActionsTile';
import { contextFrom } from './chat-context';
import { loadDismissedActionIds } from './smart-actions';
import type { SmartActionsView } from './smart-rules-contract';

const VIEW: SmartActionsView = {
  problems: [],
  rules: [
    { id: 'inea-rachunek', name: 'Inea – rachunek', source: 'mail', enabled: true, category: 'payment', priority: 'high', badge: 'Inea',
      match: { from: ['e-rachunek@inea.com.pl'], subject: ['rachunek'] }, button: { label: 'Zapłać rachunek', domain: 'inea.com.pl' } },
    { id: 'przelewy', name: 'Przelewy z podpowiedzią', source: 'bank', suggestion: 'dowolna', enabled: true, category: 'payment', priority: 'medium', badge: 'Konto' },
  ],
  alerts: [
    { id: 'mail:me@x.pl:b1', ruleId: 'inea-rachunek', source: 'mail', badge: 'Inea', title: 'Twój rachunek', snippet: 'Faktura', category: 'payment', priority: 'high', at: 2,
      url: 'https://fakturowanie.inea.com.pl/pay', label: 'Zapłać rachunek', mail: { account: 'me@x.pl', threadId: 'b1', sourceUrl: 'https://mail.google.com/x' } },
    { id: 'bank:t2', ruleId: 'przelewy', source: 'bank', badge: 'Konto', title: 'A. Nowak', snippet: '', category: 'payment', priority: 'medium', at: 1,
      bank: { tx: 't2', amount: -120, currency: 'PLN', options: [{ index: 0, label: 'Rozliczenie: Ania', sure: false }, { index: 1, label: 'Prezenty', sure: false }] } },
  ],
};

describe('SmartActionsTile', () => {
  let calls: { url: string; body?: unknown }[];
  beforeEach(() => {
    localStorage.clear();
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(url === '/api/smart-actions' ? VIEW : { ok: true }), { status: 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows the server alerts: a checked link as the button, and every suggestion of an operation as a button of its own', async () => {
    render(<SmartActionsTile wide />);
    const pay = await screen.findByRole('link', { name: 'Zapłać rachunek: Twój rachunek' });
    expect(pay.getAttribute('href')).toBe('https://fakturowanie.inea.com.pl/pay');
    const marks = within(screen.getByRole('group', { name: 'Oznacz: A. Nowak' }));
    expect(marks.getAllByRole('button').map(b => b.textContent)).toEqual(['Rozliczenie: Ania', 'Prezenty']);
    await userEvent.click(marks.getByRole('button', { name: 'Prezenty' }));
    await waitFor(() => expect(calls).toContainEqual({ url: '/api/bank/labels/action', body: { action: 'accept', tx: 't2', option: 1 } }));
  });

  it('lets the user point at one alert and one rule', async () => {
    render(<SmartActionsTile />);
    const row = (await screen.findByText('Twój rachunek')).closest('li')!;
    expect(contextFrom(row)).toMatchObject({ kind: 'smartAction', id: 'mail:me@x.pl:b1', text: expect.stringContaining('z reguły inea-rachunek') });
    await userEvent.click(screen.getByRole('button', { name: 'Ustawienia reguł Smart Actions' }));
    const rule = within(screen.getByRole('dialog')).getAllByRole('listitem')[0];
    expect(contextFrom(rule)).toMatchObject({ kind: 'smartRule', id: 'inea-rachunek', text: expect.stringContaining('"e-rachunek@inea.com.pl"') });
  });

  it('dismisses in this browser and switches a rule on the server', async () => {
    render(<SmartActionsTile />);
    await userEvent.click(await screen.findByRole('button', { name: 'Odrzuć akcję: Twój rachunek' }));
    expect(screen.queryByText('Twój rachunek')).toBeNull();
    expect(loadDismissedActionIds().has('mail:me@x.pl:b1')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Ustawienia reguł Smart Actions' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Inea – rachunek/ }));
    await waitFor(() => expect(calls).toContainEqual({ url: '/api/smart-rules/toggle', body: { id: 'inea-rachunek', enabled: false } }));
  });
});
