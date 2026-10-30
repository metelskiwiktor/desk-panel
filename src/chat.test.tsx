import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHAT_SKILLS, type ChatMessage, type ChatPart, type ChatSummary } from './chat-contract';
import { ChatWindow, groupOf } from './ChatWindow';
import { contextFrom, ctx, markPicked, pickableAt } from './chat-context';
import { withMessage } from './useChat';
import { getChatDraft } from './chat-draft';
import { FakeSource, ID, NOW, chatHooks, detail, history, listed, mockServer, openConversation, summary, type Call } from './chat.test-kit';

describe('pointing at the dashboard', () => {
  const tile = () => {
    const root = document.createElement('div');
    root.innerHTML = `<section data-ctx-kind="tile" data-ctx-id="mail" data-ctx-title="Poczta"><h2>Poczta</h2>
      <ul><li data-ctx-kind="mail" data-ctx-id="t1" data-ctx-title="Anna: Spotkanie" data-ctx-text="Od: Anna\nTemat: Spotkanie"><span class="in">Anna <b>Spotkanie</b></span></li></ul></section>`;
    return root;
  };

  it('picks the nearest annotated element, so a row wins over its tile', () => {
    const root = tile();
    expect(pickableAt(root.querySelector('b'))?.dataset.ctxKind).toBe('mail');
    expect(pickableAt(root.querySelector('h2'))?.dataset.ctxKind).toBe('tile');
    expect(pickableAt(document.body)).toBeNull();
  });

  it('describes what was picked from its attributes, or else from what is written in it', () => {
    const root = tile();
    expect(contextFrom(root.querySelector('li')!)).toEqual({ kind: 'mail', id: 't1', title: 'Anna: Spotkanie', text: 'Od: Anna\nTemat: Spotkanie' });
    const bare = document.createElement('div');
    Object.entries(ctx('tile', 'system', 'Komputer')).forEach(([k, v]) => bare.setAttribute(k, v));
    bare.textContent = '  CPU   12%\n\n\n\nRAM 40%  ';
    expect(contextFrom(bare)).toEqual({ kind: 'tile', id: 'system', title: 'Komputer', text: 'CPU 12%\n\nRAM 40%' });
  });

  it('keeps what it sends within the limits of the server', () => {
    const el = document.createElement('div');
    Object.entries(ctx('task', 'x'.repeat(500), 'T'.repeat(500), 'a'.repeat(5000))).forEach(([k, v]) => el.setAttribute(k, v));
    const item = contextFrom(el)!;
    expect(item.id.length).toBeLessThanOrEqual(200);
    expect(item.title.length).toBeLessThanOrEqual(200);
    expect(item.text.length).toBeLessThanOrEqual(2000);
  });

  it('marks the picked elements and only those', () => {
    const root = tile();
    expect(markPicked(root, [{ kind: 'mail', id: 't1', title: 'x', text: '' }])).toBe(1);
    expect(root.querySelector('li')!.hasAttribute('data-ctx-picked')).toBe(true);
    expect(root.querySelector('section')!.hasAttribute('data-ctx-picked')).toBe(false);
    markPicked(root, []);
    expect(root.querySelector('li')!.hasAttribute('data-ctx-picked')).toBe(false);
  });
});

describe('helpers', () => {
  it('groups conversations by day', () => {
    const day = 86_400_000;
    expect([NOW, NOW - day, NOW - 3 * day, NOW - 20 * day].map(t => groupOf(t, NOW))).toEqual(['Dziś', 'Wczoraj', 'Ostatnie 7 dni', 'Starsze']);
  });
  it('replaces a message in place, or adds it', () => {
    const a = { id: 'a', role: 'user', at: 1, text: 'x' } as ChatMessage, b = { id: 'b', role: 'agent', at: 2 } as ChatMessage;
    expect(withMessage([a], b)).toEqual([a, b]);
    expect(withMessage([a, b], { ...b, status: 'done' }).map(m => m.status)).toEqual([undefined, 'done']);
  });
});

chatHooks();

describe('ChatWindow', () => {
  it('edits the title with Enter and cancels with Escape', async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    await user.click(await screen.findByRole('button', { name: 'Zmień nazwę rozmowy' }));
    const input = screen.getByLabelText('Nazwa rozmowy');
    await user.clear(input); await user.type(input, 'Nowa nazwa{Escape}');
    expect(screen.queryByLabelText('Nazwa rozmowy')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Zmień nazwę rozmowy' }));
    await user.clear(screen.getByLabelText('Nazwa rozmowy')); await user.type(screen.getByLabelText('Nazwa rozmowy'), 'Nowa nazwa{Enter}');
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH' && c.body?.title === 'Nowa nazwa')).toBe(true));
  });

  it('lists conversations and continues one with its history', async () => {
    mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila od Anny/);
    expect(FakeSource.instances.at(-1)!.url).toBe(`/api/chats/${ID}/events`);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    const log = await screen.findByRole('log', { name: 'Rozmowa' });
    expect(within(log).getByText('Anna Nowak')).toBeTruthy(); // the chip of the picked mail
    expect(within(log).getByText('Zrób z tego zadanie na jutro.')).toBeTruthy();
    // Plain tool steps fold into one row of assistant-ui's thread, opened on demand.
    await user.click(within(log).getByRole('button', { name: /1 narzędzie/ }));
    expect(await within(log).findByText('add_todo')).toBeTruthy();
    expect(within(log).getByText('zadanie').tagName).toBe('STRONG');
  });

  it('applies updates to the message that is being written', async () => {
    mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    const source = FakeSource.instances.at(-1)!;
    source.emit({ type: 'state', chat: detail(history) });
    const streaming: ChatMessage = { id: 'a2', role: 'agent', at: NOW, status: 'streaming', parts: [{ type: 'text', text: 'Pierwsza' }] };
    source.emit({ type: 'update', chat: summary({ messages: 3, running: true }), message: streaming });
    expect(await screen.findByText('Pierwsza')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zatrzymaj odpowiedź' })).toBeTruthy();
    source.emit({ type: 'update', chat: summary({ messages: 3 }), message: { ...streaming, status: 'done', parts: [{ type: 'text', text: 'Pierwsza i druga' }] } });
    expect(await screen.findByText('Pierwsza i druga')).toBeTruthy();
    expect(screen.queryByText('Pierwsza')).toBeNull();
    expect(screen.getByRole('button', { name: 'Wyślij' })).toBeTruthy();
  });

  it('starts a conversation with Enter and opens its stream', async () => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await listed();
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Cześć{Shift>}{Enter}{/Shift}druga linia{Enter}');
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ text: 'Cześć\ndruga linia', context: [], engine: 'hermes', nonce: expect.stringMatching(/^[0-9a-f-]{36}$/) }));
    await waitFor(() => expect(FakeSource.instances.at(-1)?.url).toBe(`/api/chats/${ID}/events`));
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('');
  });

  it('stops a running answer', async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, { id: 'a2', role: 'agent', at: NOW, status: 'streaming', parts: [] }], { running: true }) });
    await user.click(await screen.findByRole('button', { name: 'Zatrzymaj odpowiedź' }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.url === `/api/chats/${ID}/stop`)).toBe(true));
  });

  it('deletes only after a second tap', async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    await user.click(await screen.findByRole('button', { name: 'Usuń rozmowę' }));
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Usunąć?' }));
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url === `/api/chats/${ID}`)).toBe(true));
  });

  it('says so when the server has no agent', async () => {
    mockServer([], 503);
    render(<ChatWindow onClose={() => {}} />);
    expect(await screen.findByText(/Czat jest niedostępny/)).toBeTruthy();
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('closes with Escape', async () => {
    mockServer();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ChatWindow onClose={onClose} />);
    await listed();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('picks a skill with @ into a removable context chip and sends it', async () => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await listed();
    const input = screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement;
    await user.type(input, '@zaimp');
    const menu = await screen.findByRole('listbox', { name: 'Wybór skillów' });
    expect(within(menu).getByText('@Zaimplementuj zadanie')).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox', { name: 'Wybór skillów' })).toBeNull();
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Zaimplementuj zadanie' })).toBeTruthy();
    await user.type(input, 'Dodaj skrót klawiszowy{Enter}');
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toMatchObject({
      text: 'Dodaj skrót klawiszowy',
      context: [{ kind: 'skill', id: 'zaimplementuj-zadanie', title: 'Zaimplementuj zadanie' }],
    }));
  });

  it('displays detailed error message from server when message sending fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET';
      if (url === '/api/chats' && method === 'GET') return new Response(JSON.stringify({ chats: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/chats' && method === 'POST') {
        return new Response(JSON.stringify({ error: 'Nieprawidłowe dane (context.0.text: Too big)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await listed();
    const input = screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement;
    await user.type(input, 'Test błędu{Enter}');
    expect(await screen.findByText('Nieprawidłowe dane (context.0.text: Too big)')).toBeTruthy();
  });
});

describe('pointing while chatting', () => {
  function Dashboard({ onRow }: { onRow: () => void }) {
    return <div>
      <section {...ctx('tile', 'mail', 'Poczta')}>
        <h2>Poczta</h2>
        <button {...ctx('mail', 't1', 'Anna Nowak: Spotkanie', 'Od: Anna Nowak\nTemat: Spotkanie')} onClick={onRow}>Anna Nowak Spotkanie</button>
      </section>
      <button onClick={onRow}>Bez oznaczenia</button>
    </div>;
  }

  it('turns clicks on the dashboard into context chips, then sends them with the message', async () => {
    const calls = mockServer([]);
    const onRow = vi.fn();
    const user = userEvent.setup();
    render(<><Dashboard onRow={onRow} /><ChatWindow onClose={() => {}} /></>);
    await listed();

    await user.click(screen.getByRole('button', { name: /Wskaż element/ }));
    expect(document.body.hasAttribute('data-picking')).toBe(true);
    expect(document.body.hasAttribute('data-chat-dock')).toBe(true);

    await user.click(screen.getByText('Anna Nowak Spotkanie'));
    await user.click(screen.getByRole('heading', { name: 'Poczta' }));
    await user.click(screen.getByText('Bez oznaczenia'));
    expect(onRow).not.toHaveBeenCalled(); // pointing is not using
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Anna Nowak: Spotkanie' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Poczta' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-ctx-id="t1"]')!.hasAttribute('data-ctx-picked')).toBe(true));

    // pointing at a picked element again takes it back
    await user.click(screen.getByText('Anna Nowak Spotkanie'));
    expect(screen.queryByRole('button', { name: 'Usuń z kontekstu: Anna Nowak: Spotkanie' })).toBeNull();

    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Co tu jest?{Enter}');
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({
      text: 'Co tu jest?',
      context: [{ kind: 'tile', id: 'mail', title: 'Poczta', text: 'PocztaAnna Nowak Spotkanie' }],
      engine: 'hermes', nonce: expect.any(String),
    }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Usuń z kontekstu/ })).toBeNull());
  });

  it('ends pointing with Escape or Gotowe, and the dashboard works again', async () => {
    mockServer([]);
    const onRow = vi.fn();
    const user = userEvent.setup();
    render(<><Dashboard onRow={onRow} /><ChatWindow onClose={() => {}} /></>);
    await listed();
    await user.click(screen.getByRole('button', { name: /Wskaż element/ }));
    await user.keyboard('{Escape}');
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    expect(document.body.hasAttribute('data-chat-dock')).toBe(false);
    await user.click(screen.getByText('Bez oznaczenia'));
    expect(onRow).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Wskaż element/ }));
    await user.click(screen.getByRole('button', { name: 'Gotowe' }));
    expect(document.body.hasAttribute('data-picking')).toBe(false);
  });
});

describe('Hermes only', () => {
  const H = '1b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b22';
  type Engines = { engine: 'hermes' | 'agy'; available: boolean; error?: string }[];
  function engineServer({ chats = [], engines = [{ engine: 'hermes', available: true }, { engine: 'agy', available: true }], engine = 'hermes', failPost = false }: { chats?: ChatSummary[]; engines?: Engines; engine?: 'hermes' | 'agy'; failPost?: boolean } = {}) {
    const calls: Call[] = [];
    const reply = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url === '/api/chats' && method === 'GET') return reply({ chats, engines, engine });
      if (url === '/api/chats' && method === 'POST') return failPost ? reply({ error: 'Nie udało się: Hermes jest niedostępny (odmowa połączenia). Wiadomość nie została wysłana; możesz spróbować ponownie.' }, 503) : reply({ id: H }, 201);
      return reply({ ok: true });
    }));
    return calls;
  }

  it('has no engine switch, starts new chats on Hermes even when the server remembers AGY, and lists only Hermes chats', async () => {
    const calls = engineServer({ engine: 'agy', chats: [summary({ id: H, title: 'Hermesowa' }), summary({ title: 'Stara z agy', engine: undefined })] });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await listed();
    expect(screen.queryByRole('radiogroup', { name: 'Silnik czatu' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
    const list = screen.getByRole('tabpanel');
    expect(await within(list).findByRole('button', { name: /^(?!Archiwizuj rozmowę:|Przywróć rozmowę:).*Hermesowa/ })).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /Stara z agy/ })).toBeNull();
    await user.click(within(screen.getByRole('complementary', { name: 'Historia rozmów' })).getByRole('button', { name: /Nowy czat/ }));
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Cześć{Enter}');
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toMatchObject({ text: 'Cześć', engine: 'hermes' }));
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
  });

  it('Hermes unavailable: a card says so, keeps the draft, sends nothing, and Ponów próbę asks again', async () => {
    const calls = engineServer({ engines: [{ engine: 'hermes', available: false, error: 'Hermes jest niedostępny pod http://127.0.0.1:8642.' }, { engine: 'agy', available: true }] });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    const alert = await screen.findByText('Hermes nie odpowiada.');
    expect(alert.closest('[role="alert"]')!.textContent).toContain('szkic zostaje');
    expect(screen.queryByRole('button', { name: /Przełącz na AGY/ })).toBeNull();
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Ważne pytanie{Enter}');
    expect(calls.some(c => c.method === 'POST')).toBe(false);
    expect((screen.getByRole('button', { name: 'Wyślij' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('Ważne pytanie');
    const before = calls.filter(c => c.url === '/api/chats' && c.method === 'GET').length;
    await user.click(screen.getByRole('button', { name: 'Ponów próbę' }));
    await waitFor(() => expect(calls.filter(c => c.url === '/api/chats' && c.method === 'GET').length).toBe(before + 1));
  });

  it('a refused message keeps the draft, and the retry is the same message', async () => {
    const calls = engineServer({ failPost: true });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await listed();
    const input = screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement;
    await user.type(input, 'Pytanie{Enter}');
    expect(await screen.findByText(/Hermes jest niedostępny \(odmowa/)).toBeTruthy();
    await waitFor(() => expect(input.value).toBe('Pytanie'));
    await user.click(screen.getByRole('button', { name: 'Wyślij' }));
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(2));
    const [first, second] = calls.filter(c => c.method === 'POST');
    expect(second.body.nonce).toBe(first.body.nonce);
  });

  it('asks for approval with what will run and how long it waits, and sends the answer', async () => {
    const calls = engineServer({ chats: [summary({ id: H })] });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila od Anny/);
    const tool: ChatPart = { type: 'tool', id: 'c1', name: 'panel_calendar', input: '{"from":"2026-10-26"}', state: 'running', startedAt: Date.now() - 65_000 };
    const ask: Extract<ChatPart, { type: 'approval' }> = { type: 'approval', id: 'ap_1', tool: 'terminal', detail: 'Get-Process', state: 'pending', at: Date.now() - 42_000 };
    const asking: ChatMessage = { id: 'a2', role: 'agent', at: Date.now(), status: 'streaming', parts: [tool, ask] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, asking], { id: H, running: true }) });
    const card = await screen.findByRole('group', { name: 'Prośba o zgodę: terminal' });
    expect(within(card).getByText('Get-Process')).toBeTruthy();
    expect(within(card).getByText(/czeka na Twoją decyzję · 0:4\d/)).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /1 narzędzie/ }).at(-1)!);
    expect(await screen.findByText('panel_calendar')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Zezwól' }));
    await waitFor(() => expect(calls.find(c => c.url === `/api/chats/${H}/approval`)?.body).toEqual({ approvalId: 'ap_1', decision: 'approve' }));
    FakeSource.instances.at(-1)!.emit({ type: 'update', chat: summary({ id: H, running: true }), message: { ...asking, notice: 'Zgoda wysłana: Hermes uruchamia narzędzie…', parts: [tool, { ...ask, state: 'approved' }] } });
    expect(await screen.findByText('Zezwolono')).toBeTruthy();
    expect(screen.getByText('Zgoda wysłana: Hermes uruchamia narzędzie…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zezwól' })).toBeNull();
  });
});

describe('CHAT_SKILLS', () => {
  it('defines @Zaimplementuj zadanie with two-stage analytical workflow instructions', () => {
    const skill = CHAT_SKILLS.find(s => s.id === 'zaimplementuj-zadanie');
    expect(skill).toBeDefined();
    expect(skill!.title).toBe('Zaimplementuj zadanie');
    expect(skill!.prompt).toContain('Two-stage analytical workflow:');
    expect(skill!.prompt).toContain('Phase 1 (Recon and Mode Decision)');
    expect(skill!.prompt).toContain('workflow: "analysis"');
    expect(skill!.prompt).toContain('Phase 2 (after an analysis run)');
    // It travels as a context item (at most 8000 characters) with every message that picks it.
    expect(skill!.prompt.length).toBeLessThan(8000);
    expect(skill!.prompt).toContain('panel_cezar');
    expect(skill!.prompt).toContain('panel_cezar_propose');
  });
});

describe('chat presentation and drafts', () => {
  it('resizes history by dragging or keyboard and remembers its width after reopening', async () => {
    mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await listed();
    await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
    const handle = screen.getByRole('separator', { name: 'Szerokość historii' });
    fireEvent.pointerDown(handle, { clientX: 232, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 340 });
    fireEvent.pointerUp(handle, { clientX: 340 });
    expect(localStorage.getItem('desk-panel:wektor-history-width')).toBe('340');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(localStorage.getItem('desk-panel:wektor-history-width')).toBe('330');
    await user.click(screen.getByRole('button', { name: 'Ukryj historię' }));
    await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
    expect(screen.getByRole('separator', { name: 'Szerokość historii' }).getAttribute('aria-valuenow')).toBe('330');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Szerokość historii' }), { key: 'Home' });
    expect(localStorage.getItem('desk-panel:wektor-history-width')).toBe('200');
    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Szerokość historii' }));
    expect(localStorage.getItem('desk-panel:wektor-history-width')).toBe('232');
  });

  it('minimizes to a working conversation and maximizes without losing the draft', async () => {
    mockServer();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ChatWindow onClose={onClose} />);
    await listed();
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Szkic');
    await user.click(screen.getByRole('button', { name: 'Zminimalizuj czat' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Czat z agentem' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Czat z agentem' })).toBeTruthy();
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('Szkic');
    await user.click(screen.getByRole('button', { name: 'Maksymalizuj czat' }));
    expect(screen.getByRole('dialog', { name: 'Czat z agentem' })).toBeTruthy();
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('Szkic');
  });

  it('isolates drafts and picked skills per conversation, searches history by title and ID, and restores on return', async () => {
    const second = '2b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b22';
    const calls = mockServer([summary(), summary({ id: second, title: 'Plan tygodnia' })]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await listed();
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Nowa rozmowa');
    await openConversation(user, /Zadanie z maila/);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    await user.type(screen.getByLabelText('Wiadomość do agenta'), '@bank{Enter}Szkic dla Anny');
    expect(getChatDraft(ID).text).toBe('Szkic dla Anny');
    await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
    const search = screen.getByRole('textbox', { name: 'Szukaj rozmów' });
    await user.type(search, second);
    expect(screen.queryByRole('button', { name: /^(?!Archiwizuj rozmowę:|Przywróć rozmowę:).*Zadanie z maila/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^(?!Archiwizuj rozmowę:|Przywróć rozmowę:).*Plan tygodnia/ }));
    expect(screen.queryByText('Zrób z tego zadanie na jutro.')).toBeNull();
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([], { id: second, title: 'Plan tygodnia' }) });
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Usuń z kontekstu: Bank' })).toBeNull();
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Drugi szkic');
    await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
    await user.type(screen.getByRole('textbox', { name: 'Szukaj rozmów' }), 'anny');
    await user.click(screen.getByRole('button', { name: /^(?!Archiwizuj rozmowę:|Przywróć rozmowę:).*Zadanie z maila/ }));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('Szkic dla Anny');
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Bank' })).toBeTruthy();
    expect(getChatDraft(second).text).toBe('Drugi szkic');
    expect(getChatDraft().text).toBe('Nowa rozmowa');
    expect(calls.some(c => c.method !== 'GET')).toBe(false);
    await user.type(screen.getByLabelText('Wiadomość do agenta'), '{Enter}');
    await waitFor(() => expect(getChatDraft(ID).text).toBe(''));
    expect(getChatDraft(second).text).toBe('Drugi szkic');
    expect(getChatDraft().text).toBe('Nowa rozmowa');
  });

  it('keeps the unsent text and its context chips when the window closes and opens again', async () => {
    mockServer();
    const user = userEvent.setup();
    const { unmount } = render(<ChatWindow onClose={() => {}} />);
    await listed();
    const input = screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement;
    await user.type(input, '@zaimp');
    await user.keyboard('{Enter}');
    await user.type(input, 'Niewysłana wiadomość robocza');
    expect(input.value).toBe('Niewysłana wiadomość robocza');
    expect(getChatDraft().text).toBe('Niewysłana wiadomość robocza');

    unmount();

    render(<ChatWindow onClose={() => {}} />);
    await listed();
    const reopenedInput = screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement;
    expect(reopenedInput.value).toBe('Niewysłana wiadomość robocza');
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Zaimplementuj zadanie' })).toBeTruthy();
  });
});


describe('conversation commands and archive', () => {
  chatHooks();
  it('filters commands, navigates by keyboard, keeps @ skills, and shows local cost without a model turn', async () => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    const input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.type(input, '/');
    expect(screen.getAllByRole('option')).toHaveLength(7);
    expect((screen.getByRole('option', { name: /notatka/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.clear(input); await user.type(input, '/koszt');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Brak danych o tokenach i koszcie tej rozmowy.')).not.toBeNull();
    expect(calls.filter(c => c.method === 'POST')).toEqual([]);
    await user.type(input, '/'); await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    expect((input as HTMLTextAreaElement).value).toBe('');
    await user.type(input, '/tymczasowa'); await user.keyboard('{Enter}');
    expect(await screen.findByText('Rozmowa tymczasowa')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Zachowaj rozmowę' }));
    await waitFor(() => expect(screen.queryByText('Rozmowa tymczasowa')).toBeNull());
    await user.type(input, '@');
    expect(screen.getByRole('listbox', { name: 'Wybór skillów' })).not.toBeNull();
  });

  it.each([
    ['/zadanie', 'Załóż zadanie z ustaleń tej rozmowy'],
    ['/automat', 'Zaproponuj automat z ustaleń tej rozmowy'],
  ])('sends %s as an expanded user request only on selection', async (command, request) => {
    const calls = mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    await user.type(screen.getByRole('combobox', { name: 'Wiadomość do agenta' }), command);
    expect(calls.filter(c => c.method === 'POST')).toEqual([]);
    await user.click(screen.getByRole('option', { name: new RegExp(command) }));
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body.text).toContain(request));
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });

  it('searches only the selected history tab and archives the active conversation from /', async () => {
    const archived = summary({ id: '11111111-1111-4111-8111-111111111111', title: 'Dawna rozmowa', archived: true });
    const calls = mockServer([summary(), archived]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await openConversation(user, /Zadanie z maila/);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    const input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.type(input, '/archiwizuj'); await user.keyboard('{Enter}');
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH' && c.body.archived === true)).toBe(true));
    expect(screen.queryByRole('button', { name: /^(?!Archiwizuj rozmowę:|Przywróć rozmowę:).*Dawna rozmowa/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
    await user.click(screen.getByRole('tab', { name: 'Archiwum · 1' }));
    expect(screen.getByRole('button', { name: /^(?!Archiwizuj rozmowę:|Przywróć rozmowę:).*Dawna rozmowa/ })).not.toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Szukaj rozmów' }), 'Zadanie');
    expect(screen.queryByRole('button', { name: /^(?!Archiwizuj rozmowę:|Przywróć rozmowę:).*Zadanie z maila/ })).toBeNull();
    await user.clear(screen.getByRole('textbox', { name: 'Szukaj rozmów' }));
    await user.click(screen.getByRole('button', { name: /^Przywróć rozmowę:/ }));
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH' && c.body.archived === false)).toBe(true));
  });

  it('filters slash by id prefix, requires exact text or arrow choice and respects Escape', async () => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    let input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.type(input, '/z');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /zadanie/ })).not.toBeNull();
    await user.clear(input); await user.type(input, '/'); await user.keyboard('{Enter}');
    expect((input as HTMLTextAreaElement).value).toBe('/');
    await user.clear(input); await user.type(input, '/tym'); await user.keyboard('{Enter}');
    expect(screen.queryByText('Rozmowa tymczasowa')).toBeNull();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByText('Rozmowa tymczasowa')).not.toBeNull();
    input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.type(input, '/nowa'); await user.keyboard('{Escape}{Enter}');
    await waitFor(() => expect(calls.some(c => c.body?.text === '/nowa')).toBe(true));
  });

  it.each(['/nowa', '/tymczasowa'])('confirms %s inline before leaving temporary content', async command => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    const input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.type(input, '/tymczasowa'); await user.keyboard('{Enter}');
    await user.type(input, 'private'); await user.keyboard('{Enter}');
    await waitFor(() => expect(FakeSource.instances.length).toBeGreaterThan(0));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history, { temporary: true }) });
    await user.type(screen.getByRole('combobox', { name: 'Wiadomość do agenta' }), command); await user.keyboard('{Enter}');
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Opuść rozmowę tymczasową' }));
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith('?temporary=1'))).toBe(true));
  });

  it('disables todo and automation commands without a saved current conversation', async () => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    let input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    for (const command of ['/zadanie', '/automat']) {
      await user.clear(input); await user.type(input, command);
      expect((screen.getByRole('option') as HTMLButtonElement).disabled).toBe(true);
    }
    await user.clear(input); await user.type(input, '/tymczasowa'); await user.keyboard('{Enter}');
    await user.type(input, 'private'); await user.keyboard('{Enter}');
    await waitFor(() => expect(FakeSource.instances.length).toBeGreaterThan(0));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history, { temporary: true }) });
    input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    for (const command of ['/zadanie', '/automat']) {
      await user.clear(input); await user.type(input, command); await user.keyboard('{Enter}');
      expect((screen.getByRole('option') as HTMLButtonElement).disabled).toBe(true);
    }
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });

  it('supports roving history tabs, panel associations and titled archive actions', async () => {
    mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
    const chats = await screen.findByRole('tab', { name: 'Rozmowy' });
    expect(chats.tabIndex).toBe(0);
    expect(screen.getByRole('button', { name: 'Archiwizuj rozmowę: Zadanie z maila od Anny' })).not.toBeNull();
    chats.focus(); await user.keyboard('{ArrowRight}');
    const archive = screen.getByRole('tab', { name: 'Archiwum · 0' });
    expect(document.activeElement).toBe(archive);
    expect(chats.tabIndex).toBe(-1);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(archive.id);
    await user.keyboard('{Home}'); expect(document.activeElement).toBe(chats);
    await user.keyboard('{End}'); expect(document.activeElement).toBe(archive);
  });

  it('saves an active temporary chat and keeps it after switching', async () => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    let input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.type(input, '/tymczasowa'); await user.keyboard('{Enter}');
    input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.type(input, 'Zachowaj ustalenia'); await user.keyboard('{Enter}');
    await waitFor(() => expect(FakeSource.instances.length).toBeGreaterThan(0));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history, { temporary: true }) });
    await user.click(screen.getByRole('button', { name: 'Zachowaj rozmowę' }));
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH' && c.body.temporary === false)).toBe(true));
    await waitFor(() => expect(screen.queryByText('Rozmowa tymczasowa')).toBeNull());
    expect(localStorage.getItem('desk-panel:last-hermes-chat')).toBe(ID);
    await user.type(screen.getByRole('combobox', { name: 'Wiadomość do agenta' }), '/nowa'); await user.keyboard('{Enter}');
    expect(calls.filter(c => c.method === 'DELETE')).toEqual([]);
  });

  it('deletes an active temporary conversation when the window closes', async () => {
    const calls = mockServer([]), close = vi.fn();
    const user = userEvent.setup();
    render(<ChatWindow onClose={close} />);
    await user.type(screen.getByRole('combobox', { name: 'Wiadomość do agenta' }), '/tymczasowa'); await user.keyboard('{Enter}');
    await user.type(screen.getByRole('combobox', { name: 'Wiadomość do agenta' }), 'Tylko na chwilę'); await user.keyboard('{Enter}');
    await waitFor(() => expect(FakeSource.instances.length).toBeGreaterThan(0));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history, { temporary: true }) });
    await user.click(screen.getByRole('button', { name: 'Zamknij czat' }));
    expect(close).toHaveBeenCalledOnce();
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith(`${ID}?temporary=1`))).toBe(true));
  });

  it('removes a temporary conversation on switching', async () => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    let input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.type(input, '/tymczasowa'); await user.keyboard('{Enter}');
    await user.type(input, 'Sekret na chwilę'); await user.keyboard('{Enter}');
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.body.temporary === true)).toBe(true));
    await waitFor(() => expect(FakeSource.instances.length).toBeGreaterThan(0));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history, { temporary: true }) });
    expect(screen.queryByRole('button', { name: /^(?!Archiwizuj rozmowę:|Przywróć rozmowę:).*Zadanie z maila/ })).toBeNull();
    await user.type(screen.getByRole('combobox', { name: 'Wiadomość do agenta' }), 'Szkic tymczasowy');
    expect(localStorage.getItem(`desk-panel:chat-draft:${ID}`)).toBeNull();
    input = screen.getByRole('combobox', { name: 'Wiadomość do agenta' });
    await user.clear(input); await user.type(input, '/nowa'); await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Opuść rozmowę tymczasową' }));
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith(`${ID}?temporary=1`))).toBe(true));
    expect(localStorage.getItem('desk-panel:last-hermes-chat')).toBeNull();
  });
});
