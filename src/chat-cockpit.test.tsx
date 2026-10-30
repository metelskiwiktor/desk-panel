import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage, ChatPart } from './chat-contract';
import { CARD_SHOWN } from './cockpit-contract';
import { ChatWindow } from './ChatWindow';
import { FakeSource, NOW, chatHooks, detail, history, openConversation, summary, type Call } from './chat.test-kit';

chatHooks();

describe('the cockpit on its mock (?cockpit=mock)', () => {
  beforeEach(() => {
    // The mock never talks to the server: any request fails the test.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('the mock must not call the server'); }));
    window.history.replaceState(null, '', '/?cockpit=mock&cockpitSpeed=0.01');
  });

  it('runs @Zaimplementuj zadanie: recon, the approval card, then Cezar watched up to a PR in review', async () => {
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    expect(screen.queryByRole('complementary', { name: 'Kokpit taska' })).toBeNull();
    await user.type(screen.getByLabelText('Wiadomość do agenta'), '@zaimpl{Enter}Dodaj chip statusu{Enter}');
    const recon = await screen.findByRole('region', { name: 'Rekonesans zadania' });
    const approval = await screen.findByRole('region', { name: 'Zgoda na zlecenie taska' });
    expect(approval.closest('.wektor-conversation')).toBeTruthy();
    expect(within(recon).getByText('src/ChatWindow.tsx')).toBeTruthy();
    expect(within(recon).getByText('UI')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Kokpit taska' })).toBeNull();

    // Correct the prompt, then dispatch the corrected one.
    await user.click(within(approval).getByRole('button', { name: 'Edytuj prompt' }));
    const prompt = within(approval).getByLabelText('Prompt dla executora');
    await user.clear(prompt);
    await user.type(prompt, 'Task: poprawiony prompt');
    await user.click(within(approval).getByRole('button', { name: 'Zleć z poprawkami' }));
    expect(await within(approval).findByText('Zlecono na Cezarze')).toBeTruthy();
    expect(within(approval).getByText('Task: poprawiony prompt')).toBeTruthy();

    expect(await screen.findByRole('region', { name: 'Nasłuchiwanie Cezara' })).toBeTruthy();
    const task = screen.getByRole('region', { name: 'Aktywny task Cezara' });
    await waitFor(() => expect(within(task).getByText('REVIEW')).toBeTruthy(), { timeout: 5000 });
    expect(within(task).getByText('cz-7f3a91')).toBeTruthy();
    expect(within(task).getByRole('link', { name: /Otwórz w Cezarze/ })).toBeTruthy();
    const pr = screen.getByRole('region', { name: 'Pull request' });
    expect(within(pr).getByText('#42')).toBeTruthy();
    expect(within(pr).getAllByLabelText('przeszedł')).toHaveLength(3);
    expect(screen.getByRole('progressbar', { name: 'Postęp taska' }).getAttribute('aria-valuenow')).toBe('100');
  });

  it('rejecting sends nothing to Cezar; a watched task goes through to review', async () => {
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Zaimplementuj chip statusu{Enter}');
    const approval = await screen.findByRole('region', { name: 'Zgoda na zlecenie taska' }, { timeout: 3000 });
    await user.click(within(approval).getByRole('button', { name: 'Odrzuć' }));
    expect(await screen.findByText('Odrzucone. Nic nie poszło do Cezara.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Nasłuchiwanie Cezara' })).toBeNull();

    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'nasłuchuj cezara{Enter}');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Aktywny task Cezara' }).textContent).toContain('REVIEW'), { timeout: 5000 });
    expect(screen.queryByRole('region', { name: 'Subtaski' })).toBeNull();
  });

  it('without Hermes shows the card, keeps the draft, and Ponów próbę brings it back', async () => {
    window.history.replaceState(null, '', '/?cockpit=mock&cockpitSpeed=0.01&hermes=down');
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    expect(screen.getByText('Hermes nie odpowiada.')).toBeTruthy();
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Halo{Enter}');
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('Halo');
    await user.click(screen.getByRole('button', { name: 'Ponów próbę' }));
    await waitFor(() => expect(screen.queryByText('Hermes nie odpowiada.')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Wyślij' }));
    expect(await screen.findByText(/To makieta Wektora/)).toBeTruthy();
  });
});

describe('the live cockpit (Hermes and the panel)', () => {
  const H = '1b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b22';
  const RUN = 'desk-panel/f2c9501e-7121-4746-8fc8-19ee3ee9d968';
  const prompt = 'Task: Paski\nAcceptance criteria:\n- [ ] Jedno';
  const turn: ChatMessage = { id: 'a2', role: 'agent', at: NOW, status: 'done', parts: [
    { type: 'tool', id: 'r1', name: 'mcp__desk_panel__panel_recon_report', input: JSON.stringify({ files: [{ path: 'src/zones.ts', note: 'rozmiary' }], kind: 'UI', scenario: 'standard', prompt }), output: JSON.stringify({ result: `${CARD_SHOWN.recon}. recon: r-0123456789ab.` }), state: 'done' },
    { type: 'text', text: 'Plan gotowy.' },
    { type: 'tool', id: 'p1', name: 'mcp__desk_panel__panel_cezar_propose', input: JSON.stringify({ title: 'Paski stref', prompt, workflow: 'analysis', recon: 'r-0123456789ab' }), output: JSON.stringify({ result: `${CARD_SHOWN.dispatch}: decyzja należy do niego.` }), state: 'done' },
  ] };
  const view = (over: Record<string, unknown> = {}) => ({ observedAt: NOW, task: null, pr: null, dispatches: {}, bankPlans: {}, ...over });
  const running = {
    id: RUN, title: 'Paski stref', status: 'RUNNING', repo: 'desk-panel', worktree: '.ai/cezar/worktrees/f2c9501e', tokens: 12_345,
    url: 'http://127.0.0.1:4321/p/desk-panel/tasks/f2c9501e', steps: [{ label: 'Implement', state: 'running' }, { label: 'Open PR', state: 'pending' }], progress: 0.5,
  };
  const planPreviewMock = {
        into: { name: 'Zdrowie', created: true, color: 'teal', icon: 'heart', before: { count: 0, spent: 0 }, after: { count: 4, spent: 540 } },
        sources: [
          { id: 'c-1', name: 'Psycholog', count: 2, spent: 300, color: 'violet', tag: 'psycholog', tagState: 'new', keeps: ['terapia'] },
          { id: 'c-2', name: 'Podolog', count: 1, spent: 120, color: 'brown', tag: 'podolog', tagState: 'new', keeps: [] },
          { id: 'c-3', name: 'Apteka', count: 1, spent: 120, color: 'red', tag: 'apteka', tagState: 'exists', keeps: [] },
        ],
        moved: 4, tagged: 3, noTag: 1, problems: [],
      };
  const mark = (id: string, name: string, color: string, icon: string) => ({ move: 'spend', category: { id, name, color, icon }, tags: [], recurring: false });
  const assignPreviewMock = {
    range: { from: '2026-09-24', to: null, first: '2026-10-02', last: '2026-10-05' },
    recipients: [
      { key: 'r-11111111', name: 'Społem', amount: null, count: 2, total: -51.36, certain: true, hidden: 0,
        templates: [{ key: 't-11111111', mark: mark('c-3', 'Sklep spożywczy', 'blue', 'cart'), count: 3, party: null }],
        items: [{ tx: 's1', day: '2026-10-03', name: 'Społem', amount: -28.87 }, { tx: 's2', day: '2026-10-02', name: 'Społem', amount: -22.49 }] },
      { key: 'r-22222222', name: 'Orlen', amount: null, count: 2, total: -218.55, certain: false, hidden: 0,
        templates: [{ key: 't-22222222', mark: mark('c-1', 'Paliwo', 'orange', 'fuel'), count: 4, party: null }, { key: 't-33333333', mark: mark('c-2', 'Jedzenie', 'green', 'utensils'), count: 1, party: null }],
        items: [{ tx: 'o1', day: '2026-10-05', name: 'Orlen', amount: -200.15 }, { tx: 'o2', day: '2026-10-04', name: 'Orlen', amount: -18.4 }] },
    ],
    pool: { count: 2, total: -161.18, rest: 4, hidden: 0,
      templates: [{ key: 't-44444444', mark: mark('c-2', 'Jedzenie', 'green', 'utensils'), count: 3, party: 'pyszne.pl' }],
      items: [
        { tx: 'p1', day: '2026-10-06', name: 'Płatność telefonem', amount: -80.59, hint: { template: 't-44444444', count: 3 } },
        { tx: 'p2', day: '2026-09-22', name: 'Płatność telefonem', amount: -80.59, hint: { template: 't-44444444', count: 3 } },
      ] },
    categories: [{ id: 'c-1', name: 'Paliwo', move: 'spend', color: 'orange', icon: 'fuel' }, { id: 'c-2', name: 'Jedzenie', move: 'spend', color: 'green', icon: 'utensils' }, { id: 'c-3', name: 'Sklep spożywczy', move: 'spend', color: 'blue', icon: 'cart' }],
    problems: [],
  };
  function liveServer() {
    const calls: Call[] = [];
    let cockpit: ReturnType<typeof view> & { dispatches: Record<string, unknown> } = view();
    const reply = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/chats' && method === 'GET') return reply({ chats: [summary({ id: H })] });
      if (url.startsWith('/api/cezar/dispatch-defaults')) return reply({ runner: 'codex', model: 'gpt-6.1-sol', models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }], catalogSource: 'live', modelsLocked: false, pinned: [{ id: 'implement', runner: 'codex', model: 'gpt-6.1-terra' }, { id: 'fix', runner: 'codex', model: 'gpt-6.1-terra', follows: 'implement' }, { id: 'review', runner: 'agy', model: 'claude-opus-5-5-low' }] });
      if (url.startsWith('/api/bank/plan')) return reply(planPreviewMock);
      if (url.startsWith('/api/bank/assign')) return reply(assignPreviewMock);
      if (url === `/api/chats/${H}/bank-plan` && body?.toolCallId === 'a9:b-1') {
        const { toolCallId: _id, decision: _decision, ...choice } = body;
        const outcome = { decision: 'applied', at: NOW, assigned: 5, choice, preview: assignPreviewMock };
        cockpit = view({ bankPlans: { 'a9:b-1': outcome } });
        return reply(outcome);
      }
      if (url === `/api/chats/${H}/bank-plan`) {
        const outcome = { decision: 'applied', at: NOW, into: 'Zdrowie', created: true, moved: 3, preview: planPreviewMock };
        cockpit = view({ bankPlans: { 'a8:b1': outcome } });
        return reply(outcome);
      }
      if (url.startsWith('/api/bank/show')) return reply({
        view: 'tabela', from: '2026-01-01', to: '2026-10-29', unknown: ['lekarz'], hidden: 0, observedAt: NOW, total: { count: 2, spent: 270 }, span: { first: '2026-09-20', last: '2026-10-20' },
        categories: [{ id: 'c-1', name: 'Psycholog', color: 'violet', count: 2, spent: 270 }],
        rows: [{ day: '2026-10-20', amount: -150, name: 'Gabinet Anna K.', category: 'Psycholog', tags: ['terapia'] }, { day: '2026-09-20', amount: -120, name: 'Gabinet Anna K.', category: 'Psycholog', tags: [] }],
      });
      if (url.startsWith(`/api/chats/${H}/cockpit`)) return reply(cockpit);
      if (url === `/api/chats/${H}/dispatch`) {
        cockpit = view({ task: running, dispatches: { p1: { decision: 'dispatched', taskId: RUN, prompt: body.prompt, url: running.url, at: NOW } } });
        return reply(cockpit.dispatches.p1);
      }
      return reply({ ok: true });
    }));
    return calls;
  }

  it('keeps automatic cockpit space during switches, restores the destination snapshot and waits for fresh consent state', async () => {
    const B = '2b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b22';
    const hold = new Set<string>([B]);
    const pending = new Map<string, ((value: Response) => void)[]>();
    const calls: Call[] = [];
    const reply = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url === '/api/chats') return reply({ chats: [summary({ id: H, title: 'Pierwszy czat' }), summary({ id: B, title: 'Drugi czat' })] });
      const id = /^\/api\/chats\/([^/]+)\/cockpit$/.exec(url)?.[1];
      if (id && hold.has(id)) return new Promise<Response>(resolve => pending.set(id, [...pending.get(id) ?? [], resolve]));
      if (id) return reply(view({ task: { ...running, title: id === H ? 'Zadanie A' : 'Zadanie B' } }));
      return reply({ ok: true });
    }));
    const approval: ChatMessage = { id: 'approval-message', role: 'agent', at: NOW, status: 'streaming', parts: [{ type: 'approval', id: 'approval-A', tool: 'terminal', detail: 'Odczyt syntetyczny', state: 'pending', at: NOW }] };
    const text = (value: string): ChatMessage => ({ id: 'answer', role: 'agent', at: NOW, status: 'done', parts: [{ type: 'text', text: value }] });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Pierwszy czat/);
    const streamA = FakeSource.instances.at(-1)!;
    streamA.emit({ type: 'state', chat: detail([text('Rozmowa A'), approval], { id: H, title: 'Pierwszy czat', running: true }) });
    await screen.findByText('Zadanie A');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Zezwól' }) as HTMLButtonElement).disabled).toBe(false));
    await openConversation(user, /Drugi czat/);
    expect(document.querySelector('.wektor-workspace')?.getAttribute('data-inspector')).toBe('full');
    expect(screen.queryByText('Zadanie A')).toBeNull();
    expect(screen.queryByText('Rozmowa A')).toBeNull();
    expect(screen.getByRole('status', { name: 'Wczytywanie kokpitu' })).toBeTruthy();
    const streamB = FakeSource.instances.at(-1)!;
    streamB.emit({ type: 'state', chat: detail([text('Rozmowa B')], { id: B, title: 'Drugi czat' }) });
    expect(document.querySelector('.wektor-workspace')?.getAttribute('data-inspector')).toBe('full');
    await act(async () => { for (const resolve of pending.get(B) ?? []) resolve(reply(view({ task: { ...running, title: 'Zadanie B' } }))); });
    await screen.findByText('Zadanie B');
    hold.add(H);
    await openConversation(user, /Pierwszy czat/);
    expect(screen.getByText('Rozmowa A')).toBeTruthy();
    expect(screen.getByText('Zadanie A')).toBeTruthy();
    expect(screen.queryByText('Zadanie B')).toBeNull();
    expect((screen.getByRole('button', { name: 'Zezwól' }) as HTMLButtonElement).disabled).toBe(true);
    streamB.emit({ type: 'state', chat: detail([text('Spóźniona rozmowa B')], { id: B, title: 'Drugi czat' }) });
    expect(screen.queryByText('Spóźniona rozmowa B')).toBeNull();
    await act(async () => { for (const resolve of pending.get(H) ?? []) resolve(reply(view({ task: { ...running, title: 'Zadanie A aktualne' } }))); });
    expect((screen.getByRole('button', { name: 'Zezwól' }) as HTMLButtonElement).disabled).toBe(true);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([text('Rozmowa A aktualna'), { ...approval, status: 'done', parts: [{ type: 'approval', id: 'approval-A', tool: 'terminal', detail: 'Odczyt syntetyczny', state: 'denied', at: NOW }] }], { id: H, title: 'Pierwszy czat' }) });
    expect(await screen.findByText('Odmówiono')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zezwól' })).toBeNull();
    expect(screen.getByText('Zadanie A aktualne')).toBeTruthy();
    // A → B → A before B's read finishes still needs a new authoritative cockpit read for A.
    await openConversation(user, /Drugi czat/);
    expect(screen.getByText('Rozmowa B')).toBeTruthy();
    expect(screen.getByText('Zadanie B')).toBeTruthy();
    await openConversation(user, /Pierwszy czat/);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([text('Rozmowa A'), approval], { id: H, title: 'Pierwszy czat', running: true }) });
    expect((screen.getByRole('button', { name: 'Zezwól' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { for (const resolve of pending.get(H) ?? []) resolve(reply(view({ task: { ...running, title: 'Zadanie A aktualne' } }))); });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Zezwól' }) as HTMLButtonElement).disabled).toBe(false));
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('shows the recon and dispatch cards of Hermes, and dispatches through the panel only when the user clicks', async () => {
    const calls = liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, turn], { id: H }) });
    const recon = await screen.findByRole('region', { name: 'Rekonesans zadania' });
    expect(within(recon).getByText('src/zones.ts')).toBeTruthy();
    expect(within(recon).getByText('Rekonesans gotowy')).toBeTruthy();
    const card = screen.getByRole('region', { name: 'Zgoda na zlecenie taska' });
    expect(within(card).getByText('Zlecić na Cezarze?')).toBeTruthy();
    expect(within(card).getByText('Workflow: analysis')).toBeTruthy();
    // Steps the workflow pins keep their runner unless the user moves them here; fix continues implement's session, so it follows.
    const pinnedRows = await within(card).findByTestId('pinned-steps');
    expect(within(pinnedRows).getByText('implement (z fix)')).toBeTruthy();
    expect((within(pinnedRows).getByLabelText('Wykonawca kroku implement') as HTMLSelectElement).value).toBe('codex');
    expect((within(pinnedRows).getByLabelText('Wykonawca kroku review') as HTMLSelectElement).value).toBe('agy');
    expect(within(pinnedRows).queryByLabelText('Wykonawca kroku fix')).toBeNull();
    expect(within(card).getByText(/^Pozostałe kroki według obecnych ustawień Cezara: codex · gpt-6\.1-sol\.$/)).toBeTruthy();
    expect(calls.some(c => c.url.endsWith('/dispatch') || c.url === '/api/cezar/runs')).toBe(false);

    await user.selectOptions(within(card).getByLabelText('Wykonawca Cezara'), 'codex');
    await user.selectOptions(await within(card).findByLabelText('Model Cezara'), 'gpt-6.1-sol');
    await user.selectOptions(within(card).getByLabelText('Wykonawca kroku implement'), 'opencode');
    await user.click(within(card).getByRole('button', { name: 'Zleć na Cezarze' }));
    await waitFor(() => expect(calls.find(c => c.url === `/api/chats/${H}/dispatch`)?.body).toEqual({ toolCallId: 'p1', decision: 'dispatch', title: 'Paski stref', prompt, workflow: 'analysis', runner: 'codex', model: 'gpt-6.1-sol', steps: { implement: { runner: 'opencode' }, fix: { runner: 'opencode' } } }));
    expect(await within(card).findByText('Zlecono na Cezarze')).toBeTruthy();
    const task = await screen.findByRole('region', { name: 'Aktywny task Cezara' });
    await waitFor(() => expect(within(task).getByText('RUNNING')).toBeTruthy());
    expect(within(task).getByText('12 345')).toBeTruthy();
    expect(screen.getByText('Wektor monitoruje task')).toBeTruthy();

  });

  it('fills a card when Hermes streamed its tool without arguments and the panel completes them after the answer', async () => {
    liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const streamed: ChatMessage = { id: 'a2', role: 'agent', at: NOW, status: 'streaming', parts: [
      { type: 'tool', id: 'p1', name: 'mcp__desk_panel__panel_cezar_propose', input: '{"title":"Pas', state: 'done' },
    ] };
    const source = FakeSource.instances.at(-1)!;
    source.emit({ type: 'state', chat: detail([...history, streamed], { id: H, running: true }) });
    const card = await screen.findByRole('region', { name: 'Zgoda na zlecenie taska' });
    expect(within(card).getByText('Czekam na prompt od Hermesa…')).toBeTruthy();
    expect((within(card).getByRole('button', { name: 'Zleć na Cezarze' }) as HTMLButtonElement).disabled).toBe(true);
    // The answer ends; the panel sends the step again, whole, from the session.
    source.emit({ type: 'update', chat: summary({ id: H }), message: { ...streamed, status: 'done', parts: [{ ...streamed.parts![0], input: JSON.stringify({ title: 'Paski stref', prompt }) } as ChatPart] } });
    expect(await within(card).findByText('Paski stref')).toBeTruthy();
    expect(within(card).queryByText('Czekam na prompt od Hermesa…')).toBeNull();
    expect((within(card).getByRole('button', { name: 'Zleć na Cezarze' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a proposal the panel refused (sent before its recon answered) without a way to dispatch it', async () => {
    const calls = liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const blind: ChatMessage = { id: 'a4', role: 'agent', at: NOW, status: 'done', parts: [
      { type: 'tool', id: 'r9', name: 'mcp__desk_panel__panel_recon_report', input: JSON.stringify({ files: [{ path: 'src/types.ts' }], kind: 'UI', prompt }), output: JSON.stringify({ result: 'Tych plików nie ma w repozytorium: src/types.ts.' }), state: 'done', error: true },
      { type: 'tool', id: 'p9', name: 'mcp__desk_panel__panel_cezar_propose', input: JSON.stringify({ title: 'Widget', prompt, recon: 'r-000000000000' }), output: JSON.stringify({ result: 'Panel nie zna tego recon. Najpierw wywołaj panel_recon_report i poczekaj na jego wynik.' }), state: 'done', error: true },
    ] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, blind], { id: H }) });
    const card = await screen.findByRole('region', { name: 'Zgoda na zlecenie taska' });
    expect(within(card).getByText('Propozycja odrzucona przez panel')).toBeTruthy();
    expect(within(card).getByRole('alert').textContent).toContain('Najpierw wywołaj panel_recon_report');
    expect(within(card).queryByRole('button', { name: 'Zleć na Cezarze' })).toBeNull();
    const recon = screen.getByRole('region', { name: 'Rekonesans zadania' });
    expect(within(recon).getByText('Rekonesans odrzucony')).toBeTruthy();
    expect(within(recon).getByRole('alert').textContent).toContain('src/types.ts');
    expect(calls.some(c => c.url.endsWith('/dispatch'))).toBe(false);
  });

  it('shows a recon whose arguments are not of the card\'s shape instead of blanking the chat', async () => {
    liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    // As DeepSeek sent it (28.10.2026), refused by Hermes's own argument check before it reached the panel.
    const odd: ChatMessage = { id: 'a5', role: 'agent', at: NOW, status: 'done', parts: [
      { type: 'tool', id: 'r5', name: 'mcp__desk_panel__panel_recon_report', state: 'done',
        input: JSON.stringify({ files: [{ path: 'src/Workspace.tsx', note: 'kafelek' }, { path: { bad: 1 } }, 'src/x.ts'], kind: 'UI', scenario: { page: 'pulpit', name: 'standard', open: 'tile:openrouter' }, prompt: { text: 'x' } }),
        output: JSON.stringify({ error: "arguments.scenario (type): {'page': 'pulpit'} is not of type 'string'. The tool was NOT invoked." }) },
      { type: 'text', text: 'Poprawiam rekonesans.' },
    ] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, odd], { id: H }) });
    const recon = await screen.findByRole('region', { name: 'Rekonesans zadania' });
    expect(within(recon).getByText('Rekonesans odrzucony')).toBeTruthy();
    expect(within(recon).getByText('src/Workspace.tsx')).toBeTruthy();
    expect(within(recon).queryByText(/scenariusz/)).toBeNull();
    expect(screen.getByText('Poprawiam rekonesans.')).toBeTruthy();
  });

  it('shows the data card: the rows are read from the panel, the arguments of the model only say what to show', async () => {
    const calls = liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const show: ChatMessage = { id: 'a9', role: 'agent', at: NOW, status: 'done', parts: [
      { type: 'tool', id: 's1', name: 'mcp__desk_panel__panel_show', input: JSON.stringify({ tytul: 'Psycholog', kategorie: ['psych', 'lekarz'], view: 'tabela' }), output: JSON.stringify({ result: `${CARD_SHOWN.show}. Pokazano: Psycholog 2 op.` }), state: 'done' },
      { type: 'tool', id: 's2', name: 'mcp__desk_panel__panel_show', input: JSON.stringify({ kategorie: 'nie lista' }), output: JSON.stringify({ result: 'Niepoprawne argumenty' }), state: 'done', error: true },
    ] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, show], { id: H }) });
    const cards = await screen.findAllByRole('region', { name: /^Karta:/ });
    const card = cards[0];
    expect(card.getAttribute('aria-label')).toBe('Karta: Psycholog');
    expect((await within(card).findAllByText('Gabinet Anna K.')).length).toBe(2);
    expect(within(card).getByText(/Bez dopasowania: lekarz/)).toBeTruthy();
    const request = calls.find(c => c.url.startsWith('/api/bank/show'))!;
    expect(request.method).toBe('GET');
    expect(request.url).toContain('kategorie=psych');
    expect(request.url).toContain('kategorie=lekarz');
    // A call with arguments of another shape says so in its place and fetches nothing.
    expect(await screen.findByText('Agent przysłał niepoprawne zapytanie karty.')).toBeTruthy();
    expect(calls.filter(c => c.url.startsWith('/api/bank/show'))).toHaveLength(1);
  });

  it('shows the consent card with the before and after, changes nothing until Wykonaj, and then shows what was done', async () => {
    const calls = liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const turnWithCard: ChatMessage = { id: 'a8', role: 'agent', at: NOW, status: 'done', parts: [
      { type: 'tool', id: 'a8:b1', name: 'mcp__desk_panel__panel_bank_propose', input: JSON.stringify({ tytul: 'Zdrowie', merge: ['Psycholog', 'Podolog'], into: 'Zdrowie', tags: true }), output: JSON.stringify({ result: `${CARD_SHOWN.bankPlan}: 3 operacji przejdzie.` }), state: 'done' },
    ] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, turnWithCard], { id: H }) });
    const card = await screen.findByRole('region', { name: 'Zgoda na zmianę kategorii' });
    expect(within(card).getByText('Wykonać zmianę?')).toBeTruthy();
    // The target and its rows: what each category is now, the tags it has, and what it ends with.
    expect(await within(card).findByText('Teraz')).toBeTruthy();
    expect(within(card).getAllByText('Zdrowie').length).toBeGreaterThan(0);
    expect(within(card).getByText('nowa')).toBeTruthy();
    const rows = within(card).getByTestId('merge-rows');
    expect(within(rows).getByText('Psycholog').className).toContain('line-through');
    expect(within(rows).getByText('2 ×')).toBeTruthy();
    expect(within(rows).getByText('+ #psycholog')).toBeTruthy();
    expect(within(rows).getAllByText('#terapia')).toHaveLength(2);
    expect(within(rows).getByText('#apteka')).toBeTruthy();
    expect(within(rows).getByText('już istnieje')).toBeTruthy();
    expect(within(rows).queryByText('+ #apteka')).toBeNull();
    expect(within(card).getAllByLabelText('kategoria zniknie')).toHaveLength(3);
    expect(within(card).getByText(/Zmieni 4 oznaczeń/)).toBeTruthy();
    expect(within(card).getByText(/1 oznaczenie ma już komplet etykiet/)).toBeTruthy();
    expect(calls.some(c => c.url.endsWith('/bank-plan'))).toBe(false);
    await user.click(within(card).getByRole('button', { name: 'Wykonaj' }));
    await waitFor(() => expect(within(card).getByText(/Przeniesiono 3 oznaczeń do „Zdrowie” \(nowa kategoria\)\./)).toBeTruthy());
    // What was proposed stays on the card after the answer (its categories are gone, so it is the preview kept with the answer).
    const after = within(card).getByTestId('merge-rows');
    expect(within(after).getByText('+ #psycholog')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Wykonaj' })).toBeNull();
    const answer = calls.find(c => c.url === `/api/chats/${H}/bank-plan`)!;
    expect(answer.method).toBe('POST');
    expect(answer.body).toEqual({ toolCallId: 'a8:b1', decision: 'apply' });
  });

  it('lists recipients with templates, lets a group or one operation take a template or any category, and sends only the choice with Wykonaj', async () => {
    const calls = liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const turnWithCard: ChatMessage = { id: 'a9', role: 'agent', at: NOW, status: 'done', parts: [
      { type: 'tool', id: 'a9:b-1', name: 'mcp__desk_panel__panel_bank_assign', input: JSON.stringify({ tytul: 'Podpowiedzi', from: '2026-09-24' }), output: JSON.stringify({ result: `${CARD_SHOWN.bankAssign}: 4 operacje.` }), state: 'done' },
    ] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, turnWithCard], { id: H }) });
    const card = await screen.findByRole('region', { name: 'Zgoda na masowe oznaczenie' });
    const certain = await within(card).findByTestId('assign-certain');
    const mixed = within(card).getByTestId('assign-mixed');
    expect(within(card).getByTestId('assign-range').textContent).toBe('Zakres: 2026-09-24 – do dziś · operacje z 2026-10-02 do 2026-10-05');
    // the recipient that always got one mark is ticked with it; the one that varied waits, with the history in words
    expect(within(certain).getByRole('button', { name: 'Wydatek · Sklep spożywczy' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(mixed).getByText('wcześniej: Wydatek · Paliwo 4 razy, Wydatek · Jedzenie 1 raz')).toBeTruthy();
    expect(within(mixed).getByRole('button', { name: 'Wydatek · Paliwo ×4' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(card).getByText(/Zaznaczone: 2 operacji, [-−]51,36/)).toBeTruthy();
    // a template for the whole recipient
    await user.click(within(mixed).getByRole('button', { name: 'Wydatek · Paliwo ×4' }));
    expect(within(card).getByText(/Zaznaczone: 4 operacji, [-−]269,91/)).toBeTruthy();
    // one operation takes any category of the user's, another is unticked
    await user.click(within(mixed).getByText('wcześniej: Wydatek · Paliwo 4 razy, Wydatek · Jedzenie 1 raz'));
    expect(within(mixed).getByText('oznacz jako')).toBeTruthy();
    await user.selectOptions(within(mixed).getByLabelText('Oznaczenie: 2026-10-04 Orlen'), 'c:c-2');
    await user.click(within(mixed).getByRole('checkbox', { name: 'Oznacz 2026-10-05 Orlen' }));
    expect(within(card).getByText(/Zaznaczone: 3 operacji, [-−]69,76/)).toBeTruthy();
    // payments with no shop name that have a lead: nothing is ticked for the user, the lead is written out in full, ticking takes it
    const pool = within(card).getByTestId('assign-pool');
    expect(within(pool).getAllByTestId('assign-hint').map(h => h.textContent)).toEqual(Array(2).fill('ta sama kwota: Wydatek · Jedzenie · pyszne.pl (notatka), 3 razy'));
    expect(within(pool).getByText(/Z tej sekcji do zapisu: 0 płatności\. Pominięto 4 bez tropu\./)).toBeTruthy();
    await user.click(within(pool).getByRole('checkbox', { name: /Przyjmij 2026-10-06 [-−]80,59 zł/ }));
    await user.click(within(pool).getByRole('checkbox', { name: /Przyjmij 2026-09-22 [-−]80,59 zł/ }));
    expect(within(pool).getByText(/Z tej sekcji do zapisu: 2 płatności, [-−]161,18/)).toBeTruthy();
    expect(within(card).getByText(/Zaznaczone: 5 operacji, [-−]230,94/)).toBeTruthy();
    expect(calls.some(c => c.url.endsWith('/bank-plan'))).toBe(false);
    await user.click(within(card).getByRole('button', { name: 'Wykonaj' }));
    await waitFor(() => expect(within(card).getByText('Oznaczono 5 operacji.')).toBeTruthy());
    expect(calls.find(c => c.url === `/api/chats/${H}/bank-plan`)!.body).toEqual({
      toolCallId: 'a9:b-1', decision: 'apply', skipOps: ['o1'], groupPicks: [{ group: 'r-22222222', template: 't-22222222' }],
      picks: [{ tx: 'o2', category: 'c-2' }, { tx: 'p1', template: 't-44444444' }, { tx: 'p2', template: 't-44444444' }],
    });
    expect(within(card).queryByRole('button', { name: 'Wykonaj' })).toBeNull();
  });

  it('makes a category from the card for a whole recipient: it shows as new, an existing name is not made twice, and only Wykonaj sends it', async () => {
    const calls = liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const turnWithCard: ChatMessage = { id: 'a9', role: 'agent', at: NOW, status: 'done', parts: [
      { type: 'tool', id: 'a9:b-1', name: 'mcp__desk_panel__panel_bank_assign', input: JSON.stringify({ tytul: 'Podpowiedzi', from: '2026-09-24' }), output: JSON.stringify({ result: `${CARD_SHOWN.bankAssign}: 4 operacje.` }), state: 'done' },
    ] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, turnWithCard], { id: H }) });
    const card = await screen.findByRole('region', { name: 'Zgoda na masowe oznaczenie' });
    const mixed = await within(card).findByTestId('assign-mixed');
    // the field asks for a name; a name that is a spending category already is taken as that one
    await user.selectOptions(within(mixed).getByLabelText('Inna kategoria dla Orlen'), '__new');
    await user.type(within(mixed).getByLabelText('Nazwa nowej kategorii'), 'paliwo{Enter}');
    expect(within(mixed).getByRole('button', { name: 'Wydatek · Paliwo' })).toBeTruthy();
    expect(within(card).getByText(/Zaznaczone: 4 operacji, [-−]269,91/)).toBeTruthy();
    // a name that is new: shown as new, offered in the lists of the other fields
    await user.selectOptions(within(mixed).getByLabelText('Inna kategoria dla Orlen'), '__new');
    await user.type(within(mixed).getByLabelText('Nazwa nowej kategorii'), 'Paliwo premium');
    await user.click(within(mixed).getByRole('button', { name: 'Dodaj' }));
    expect(within(mixed).getByRole('button', { name: 'Wydatek · Paliwo premium (nowa)' })).toBeTruthy();
    expect(within(mixed).getAllByRole('option', { name: 'Wydatek · Paliwo premium (nowa)' }).length).toBeGreaterThan(0);
    expect(calls.some(c => c.url.endsWith('/bank-plan'))).toBe(false);
    await user.click(within(card).getByRole('button', { name: 'Wykonaj' }));
    await waitFor(() => expect(within(card).getByText('Oznaczono 5 operacji.')).toBeTruthy());
    expect(calls.find(c => c.url === `/api/chats/${H}/bank-plan`)!.body).toEqual({
      toolCallId: 'a9:b-1', decision: 'apply', groupPicks: [{ group: 'r-22222222', newCategory: 'Paliwo premium' }], newCategories: ['Paliwo premium'],
    });
  });

  it('a choice for a whole recipient replaces what was picked for its single operations, so the card says what it saves', async () => {
    liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const turnWithCard: ChatMessage = { id: 'a9', role: 'agent', at: NOW, status: 'done', parts: [
      { type: 'tool', id: 'a9:b-1', name: 'mcp__desk_panel__panel_bank_assign', input: JSON.stringify({ tytul: 'Podpowiedzi', from: '2026-09-24' }), output: JSON.stringify({ result: `${CARD_SHOWN.bankAssign}: 4 operacje.` }), state: 'done' },
    ] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, turnWithCard], { id: H }) });
    const card = await screen.findByRole('region', { name: 'Zgoda na masowe oznaczenie' });
    const mixed = await within(card).findByTestId('assign-mixed');
    await user.click(within(mixed).getByText('wcześniej: Wydatek · Paliwo 4 razy, Wydatek · Jedzenie 1 raz'));
    const field = () => within(mixed).getByLabelText('Oznaczenie: 2026-10-05 Orlen') as HTMLSelectElement;
    // one operation is picked by hand, then the whole recipient: the operation follows the recipient again
    await user.selectOptions(field(), 'c:c-2');
    expect(field().value).toBe('c:c-2');
    await user.click(within(mixed).getByRole('button', { name: 'Wydatek · Paliwo ×4' }));
    expect(field().value).toBe('');
    expect(within(card).getByText(/Zaznaczone: 4 operacji, [-−]269,91/)).toBeTruthy();
  });

  it('watches the task the conversation names, and shows the watch card live', async () => {
    const calls = liveServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const watch: ChatMessage = { id: 'a3', role: 'agent', at: NOW, status: 'done', parts: [
      { type: 'tool', id: 'w1', name: 'mcp_desk-panel_panel_cezar_watch', input: JSON.stringify({ id: RUN }), output: JSON.stringify({ task: { ...running, status: 'QUEUED', steps: [] } }), state: 'done' },
    ] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, watch], { id: H }) });
    const card = await screen.findByRole('region', { name: 'Nasłuchiwanie Cezara' });
    expect(within(card).getByText(RUN)).toBeTruthy();
    // Which task is watched the server decides from the conversation: the window asks without a hint.
    await waitFor(() => expect(calls.some(c => c.url === `/api/chats/${H}/cockpit`)).toBe(true));
    expect(calls.some(c => c.url.includes('/cockpit?'))).toBe(false);
  });
});
