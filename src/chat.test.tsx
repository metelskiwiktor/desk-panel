import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHAT_SKILLS, type ChatDetail, type ChatEvent, type ChatMessage, type ChatPart, type ChatSummary } from './chat-contract';
import { CARD_SHOWN } from './cockpit-contract';
import { ChatWindow, groupOf, messageCount } from './ChatWindow';
import { contextFrom, ctx, markPicked, pickableAt } from './chat-context';
import { withMessage } from './useChat';
import { clearChatDraft, getChatDraft } from './chat-draft';

const ID = '0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b11';
const NOW = new Date('2026-10-25T12:00:00').getTime();

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
  it('counts messages in Polish', () => {
    expect([1, 2, 5].map(messageCount)).toEqual(['1 wiadomość', '2 wiadomości', '5 wiadomości']);
  });
  it('replaces a message in place, or adds it', () => {
    const a = { id: 'a', role: 'user', at: 1, text: 'x' } as ChatMessage, b = { id: 'b', role: 'agent', at: 2 } as ChatMessage;
    expect(withMessage([a], b)).toEqual([a, b]);
    expect(withMessage([a, b], { ...b, status: 'done' }).map(m => m.status)).toEqual([undefined, 'done']);
  });
});

// ── the window ──
class FakeSource {
  static CLOSED = 2;
  static instances: FakeSource[] = [];
  readyState = 1;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSource.instances.push(this); }
  close() { this.readyState = 2; }
  emit(event: ChatEvent) { act(() => this.onmessage?.({ data: JSON.stringify(event) })); }
}

const summary = (over: Partial<ChatSummary> = {}): ChatSummary => ({ id: ID, title: 'Zadanie z maila od Anny', createdAt: NOW - 3600_000, updatedAt: NOW - 1800_000, messages: 2, running: false, engine: 'hermes', ...over });
const detail = (items: ChatMessage[], over: Partial<ChatSummary> = {}): ChatDetail => ({ ...summary({ messages: items.length, ...over }), items });
const mailChip = { kind: 'mail' as const, id: 't1', title: 'Anna Nowak', text: 'Od: Anna' };
const history: ChatMessage[] = [
  { id: 'u1', role: 'user', at: NOW - 3000_000, text: 'Zrób z tego zadanie na jutro.', context: [mailChip] },
  { id: 'a1', role: 'agent', at: NOW - 2900_000, status: 'done', parts: [
    { type: 'tool', id: 's1', name: 'add_todo', input: '{"title":"Odpowiedzieć Annie"}', output: 'ok', state: 'done' },
    { type: 'text', text: 'Dodałem **zadanie** na jutro.' },
  ] },
];

interface Call { url: string; method: string; body?: any }
function mockServer(chats: ChatSummary[] = [summary()], status = 200) {
  const calls: Call[] = [];
  const reply = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (status !== 200) return reply({ error: 'x' }, status);
    if (url === '/api/chats' && method === 'GET') return reply({ chats });
    if (url === '/api/chats' && method === 'POST') return reply({ id: ID }, 201);
    return reply({ ok: true }, method === 'POST' ? 202 : 200);
  }));
  return calls;
}

beforeEach(() => {
  FakeSource.instances = [];
  vi.stubGlobal('EventSource', FakeSource);
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; });
  vi.useRealTimers();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearChatDraft(); localStorage.clear(); document.body.removeAttribute('data-picking'); document.body.removeAttribute('data-chat-dock'); window.history.replaceState(null, '', '/'); });

/** The conversations sit behind the title of the window. */
async function openConversation(user: ReturnType<typeof userEvent.setup>, title: RegExp) {
  await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
  await user.click(await within(screen.getByRole('group', { name: 'Poprzednie rozmowy' })).findByRole('button', { name: title }));
}
/** The list has loaded (the window asks for it when it opens). */
const listed = () => waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/chats')).toBe(true));

describe('ChatWindow', () => {
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
    const list = screen.getByRole('group', { name: 'Poprzednie rozmowy' });
    expect(await within(list).findByRole('button', { name: /Hermesowa/ })).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /Stara z agy/ })).toBeNull();
    await user.click(within(list).getByRole('button', { name: /Nowy czat/ }));
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

describe('the cockpit on its mock (?cockpit=mock)', () => {
  beforeEach(() => {
    // The mock never talks to the server: any request fails the test.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('the mock must not call the server'); }));
    window.history.replaceState(null, '', '/?cockpit=mock&cockpitSpeed=0.01');
  });

  it('runs @Zaimplementuj zadanie: recon, the approval card, then Cezar watched up to a PR in review', async () => {
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    expect(screen.getByText('Brak aktywnego monitorowania')).toBeTruthy();
    await user.type(screen.getByLabelText('Wiadomość do agenta'), '@zaimpl{Enter}Dodaj chip statusu{Enter}');
    const recon = await screen.findByRole('region', { name: 'Rekonesans zadania' });
    const approval = await screen.findByRole('region', { name: 'Zgoda na zlecenie taska' });
    expect(within(recon).getByText('src/ChatWindow.tsx')).toBeTruthy();
    expect(within(recon).getByText('UI')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Aktywny task Cezara' }).textContent).toContain('Żaden task');

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
    expect(within(pool).getAllByTestId('assign-hint').map(h => h.textContent)).toEqual(Array(2).fill('ta sama kwota: Wydatek · Jedzenie · pyszne.pl, 3 razy'));
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

describe('chat resizing, minimizing, and draft preservation', () => {
  it('minimizes the chat window via minimize button', async () => {
    mockServer();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ChatWindow onClose={onClose} />);
    await listed();
    await user.click(screen.getByRole('button', { name: 'Zminimalizuj czat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders interactive resize handle and supports dragging to resize', async () => {
    mockServer();
    render(<ChatWindow onClose={() => {}} />);
    await listed();
    const handle = screen.getByTestId('chat-resize-handle');
    expect(handle).toBeTruthy();
    const dialog = screen.getByRole('dialog', { name: 'Czat z agentem' });
    expect(dialog).toBeTruthy();

    fireEvent.pointerDown(handle, { clientX: 500, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 450 });
    fireEvent.pointerUp(window, { clientX: 600, clientY: 450 });

    const saved = JSON.parse(localStorage.getItem('desk-panel:chat-size') || '{}');
    expect(saved.width).toBeGreaterThanOrEqual(400);
    expect(saved.height).toBeGreaterThanOrEqual(300);
  });

  it('preserves unsent draft text in the chat input when re-rendering', async () => {
    mockServer();
    const user = userEvent.setup();
    const { unmount } = render(<ChatWindow onClose={() => {}} />);
    await listed();
    const input = screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement;
    await user.type(input, 'Niewysłana wiadomość robocza');
    expect(input.value).toBe('Niewysłana wiadomość robocza');
    expect(getChatDraft().text).toBe('Niewysłana wiadomość robocza');

    unmount();

    render(<ChatWindow onClose={() => {}} />);
    await listed();
    const reopenedInput = screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement;
    expect(reopenedInput.value).toBe('Niewysłana wiadomość robocza');
  });
});
