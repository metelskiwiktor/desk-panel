import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatDetail, ChatEvent, ChatMessage, ChatPart, ChatSummary } from './chat-contract';
import { ChatWindow, groupOf, messageCount } from './ChatWindow';
import { contextFrom, ctx, markPicked, pickableAt } from './chat-context';
import { Markdown } from './markdown-lite';
import { withMessage } from './useChat';

const ID = '0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b11';
const NOW = new Date('2026-10-25T12:00:00').getTime();

describe('Markdown', () => {
  it('renders the parts an answer uses, as elements', () => {
    const { container } = render(<Markdown text={'## Plan\n\nTo jest **ważne** i `kod`.\n\n- jeden\n- dwa\n\n1. pierwszy\n\n```\nnpm test\n```\n\n[strona](https://example.com/a)'} />);
    expect(container.querySelector('.md-h')?.textContent).toBe('Plan');
    expect(container.querySelector('strong')?.textContent).toBe('ważne');
    expect(container.querySelector('p code')?.textContent).toBe('kod');
    expect([...container.querySelectorAll('ul li')].map(li => li.textContent)).toEqual(['jeden', 'dwa']);
    expect(container.querySelector('ol li')?.textContent).toBe('pierwszy');
    expect(container.querySelector('pre code')?.textContent).toBe('npm test');
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.com/a');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('never turns text into markup or a script link', () => {
    const { container } = render(<Markdown text={'<img src=x onerror=alert(1)> <script>alert(2)</script> [zły](javascript:alert(3))'} />);
    expect(container.querySelector('img, script, a')).toBeNull();
    expect(container.textContent).toContain('<script>alert(2)</script>');
  });

  it('shows a code block that is still being written', () => {
    const { container } = render(<Markdown text={'```ts\nconst a = 1;'} />);
    expect(container.querySelector('pre code')?.textContent).toBe('const a = 1;');
  });
});

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

const summary = (over: Partial<ChatSummary> = {}): ChatSummary => ({ id: ID, title: 'Zadanie z maila od Anny', createdAt: NOW - 3600_000, updatedAt: NOW - 1800_000, messages: 2, running: false, ...over });
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
  vi.useRealTimers();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.removeAttribute('data-picking'); document.body.removeAttribute('data-chat-dock'); });

describe('ChatWindow', () => {
  it('lists conversations and continues one with its history', async () => {
    mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Zadanie z maila od Anny/ }));
    expect(FakeSource.instances.at(-1)!.url).toBe(`/api/chats/${ID}/events`);
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    const log = await screen.findByRole('log', { name: 'Rozmowa' });
    expect(within(log).getByText('Anna Nowak')).toBeTruthy(); // the chip of the picked mail
    expect(within(log).getByText('Zrób z tego zadanie na jutro.')).toBeTruthy();
    expect(within(log).getByText('add_todo')).toBeTruthy();
    expect(within(log).getByText('zadanie').tagName).toBe('STRONG');
  });

  it('applies updates to the message that is being written', async () => {
    mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Zadanie z maila/ }));
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
    await screen.findByText('Nie ma jeszcze rozmów.');
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Cześć{Shift>}{Enter}{/Shift}druga linia{Enter}');
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ text: 'Cześć\ndruga linia', context: [], engine: 'hermes', nonce: expect.stringMatching(/^[0-9a-f-]{36}$/) }));
    await waitFor(() => expect(FakeSource.instances.at(-1)?.url).toBe(`/api/chats/${ID}/events`));
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('');
  });

  it('stops a running answer', async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Zadanie z maila/ }));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, { id: 'a2', role: 'agent', at: NOW, status: 'streaming', parts: [] }], { running: true }) });
    await user.click(await screen.findByRole('button', { name: 'Zatrzymaj odpowiedź' }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.url === `/api/chats/${ID}/stop`)).toBe(true));
  });

  it('deletes only after a second tap, and renames', async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Zadanie z maila/ }));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history) });
    await user.click(await screen.findByRole('button', { name: 'Zmień nazwę rozmowy' }));
    const input = screen.getByLabelText('Nazwa rozmowy');
    await user.clear(input);
    await user.type(input, 'Nowa nazwa{Enter}');
    await waitFor(() => expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ title: 'Nowa nazwa' }));
    await user.click(screen.getByRole('button', { name: 'Usuń rozmowę' }));
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
    await screen.findByText('Zadanie z maila od Anny');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('picks a skill with @ into a removable context chip and sends it', async () => {
    const calls = mockServer([]);
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await screen.findByText('Nie ma jeszcze rozmów.');
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
    await screen.findByText('Nie ma jeszcze rozmów.');
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
    await screen.findByText('Nie ma jeszcze rozmów.');

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
    await screen.findByText('Nie ma jeszcze rozmów.');
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

describe('chat engines', () => {
  const H = '1b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b22';
  type Engines = { engine: 'hermes' | 'agy'; available: boolean; error?: string }[];
  function engineServer({ chats = [], engines = [{ engine: 'hermes', available: true }, { engine: 'agy', available: true }], engine = 'hermes', failPost = false }: { chats?: ChatSummary[]; engines?: Engines; engine?: 'hermes' | 'agy'; failPost?: boolean } = {}) {
    const calls: Call[] = [];
    const reply = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url === '/api/chats' && method === 'GET') return reply({ chats, engines, engine });
      if (url === '/api/chats' && method === 'POST') return failPost ? reply({ error: 'Nie udało się: Hermes jest niedostępny (odmowa połączenia). Wiadomość nie została wysłana; możesz spróbować ponownie albo wybrać AGY.' }, 503) : reply({ id: H }, 201);
      return reply({ ok: true });
    }));
    return calls;
  }

  it('starts new chats on Hermes by default and shows each chat engine; old chats without one are AGY', async () => {
    engineServer({ chats: [summary({ id: H, title: 'Hermesowa', engine: 'hermes' }), summary({ title: 'Stara z agy' })] });
    render(<ChatWindow onClose={() => {}} />);
    const list = await screen.findByRole('group', { name: 'Poprzednie rozmowy' });
    expect(within(await within(list).findByRole('button', { name: /Hermesowa/ })).getByText('Hermes')).toBeTruthy();
    expect(within(within(list).getByRole('button', { name: /Stara z agy/ })).getByText('AGY')).toBeTruthy();
    const engine = screen.getByRole('radiogroup', { name: 'Silnik czatu' });
    expect(within(engine).getByRole('radio', { name: 'Hermes' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Nowy czat · Hermes' })).toBeTruthy();
  });

  it('remembers AGY as the choice and starts the next chat on it', async () => {
    const calls = engineServer();
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await screen.findByText('Nie ma jeszcze rozmów.');
    await user.click(screen.getByRole('radio', { name: 'AGY' }));
    expect(calls.find(c => c.method === 'PUT')).toEqual({ url: '/api/chats/engine', method: 'PUT', body: { engine: 'agy' } });
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Cześć{Enter}');
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toMatchObject({ text: 'Cześć', engine: 'agy' }));
  });

  it('switching engine in an open chat goes to a new chat of that engine, keeping the draft', async () => {
    engineServer({ chats: [summary({ engine: 'agy' })] });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Zadanie z maila od Anny/ }));
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail(history, { engine: 'agy' }) });
    expect(screen.getByRole('radio', { name: 'AGY' }).getAttribute('aria-checked')).toBe('true');
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'szkic');
    await user.click(screen.getByRole('radio', { name: 'Hermes' }));
    expect(await screen.findByText(/zostaje w AGY.*nową rozmowę w Hermes/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nowy czat · Hermes' })).toBeTruthy();
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('szkic');
  });

  it('Hermes unavailable: says so, keeps the draft and offers AGY by hand, without sending anywhere', async () => {
    const calls = engineServer({ engines: [{ engine: 'hermes', available: false, error: 'Hermes jest niedostępny pod http://127.0.0.1:8642.' }, { engine: 'agy', available: true }] });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    const alert = await screen.findByText('Hermes nie odpowiada.');
    expect(alert.closest('[role="alert"]')!.textContent).toContain('szkic zostaje');
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Ważne pytanie{Enter}');
    expect(calls.some(c => c.method === 'POST')).toBe(false);
    expect((screen.getByRole('button', { name: 'Wyślij' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Przełącz na AGY' }));
    expect(screen.getByRole('radio', { name: 'AGY' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('Ważne pytanie');
    await user.click(screen.getByRole('button', { name: 'Wyślij' }));
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toMatchObject({ text: 'Ważne pytanie', engine: 'agy' }));
  });

  it('a refused message keeps the draft, and the retry is the same message', async () => {
    const calls = engineServer({ failPost: true });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await screen.findByText('Nie ma jeszcze rozmów.');
    const input = screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement;
    await user.type(input, 'Pytanie{Enter}');
    expect(await screen.findByText(/Hermes jest niedostępny \(odmowa/)).toBeTruthy();
    expect(input.value).toBe('Pytanie');
    await user.click(screen.getByRole('button', { name: 'Wyślij' }));
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(2));
    const [first, second] = calls.filter(c => c.method === 'POST');
    expect(second.body.nonce).toBe(first.body.nonce);
  });

  it('asks for approval with what will run and how long it waits, and sends the answer', async () => {
    const calls = engineServer({ chats: [summary({ id: H, engine: 'hermes' })] });
    const user = userEvent.setup();
    render(<ChatWindow onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Zadanie z maila od Anny/ }));
    const tool: ChatPart = { type: 'tool', id: 'c1', name: 'panel_calendar', input: '{"from":"2026-10-26"}', state: 'running', startedAt: Date.now() - 65_000 };
    const ask: Extract<ChatPart, { type: 'approval' }> = { type: 'approval', id: 'ap_1', tool: 'terminal', detail: 'Get-Process', state: 'pending', at: Date.now() - 42_000 };
    const asking: ChatMessage = { id: 'a2', role: 'agent', at: Date.now(), status: 'streaming', parts: [tool, ask] };
    FakeSource.instances.at(-1)!.emit({ type: 'state', chat: detail([...history, asking], { id: H, engine: 'hermes', running: true }) });
    const card = await screen.findByRole('group', { name: 'Prośba o zgodę: terminal' });
    expect(within(card).getByText('Get-Process')).toBeTruthy();
    expect(within(card).getByText(/czeka na Twoją decyzję · 0:4\d/)).toBeTruthy();
    expect(screen.getByText(/Działa 1:0\d/)).toBeTruthy();
    expect(screen.getByText(/Trwa dłużej niż zwykle/)).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Zezwól' }));
    await waitFor(() => expect(calls.find(c => c.url === `/api/chats/${H}/approval`)?.body).toEqual({ approvalId: 'ap_1', decision: 'approve' }));
    FakeSource.instances.at(-1)!.emit({ type: 'update', chat: summary({ id: H, engine: 'hermes', running: true }), message: { ...asking, notice: 'Zgoda wysłana: Hermes uruchamia narzędzie…', parts: [tool, { ...ask, state: 'approved' }] } });
    expect(await screen.findByText('Zezwolono')).toBeTruthy();
    expect(screen.getByText('Zgoda wysłana: Hermes uruchamia narzędzie…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zezwól' })).toBeNull();
  });
});
