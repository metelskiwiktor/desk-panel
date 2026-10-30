import { z } from 'zod';
import { GoogleAuthError, type GoogleAccount } from './google-oauth';
import { MAIL_WINDOW_MS, mailSourceSchema, type MailAction, type MailSource, type MailThread } from '../src/mail-contract';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const MAIL_QUERY = 'in:inbox is:unread newer_than:30d';
const MAX_PER_ACCOUNT = 200;
const header = z.object({ name: z.string(), value: z.string() });
const threadList = z.object({ threads: z.array(z.object({ id: z.string(), historyId: z.string() })).optional(), nextPageToken: z.string().optional() });
interface MessagePart { mimeType?: string; body?: { data?: string; size?: number }; parts?: MessagePart[] }
const messagePartSchema: z.ZodType<MessagePart> = z.lazy(() => z.object({ mimeType: z.string().optional(), body: z.object({ data: z.string().optional(), size: z.number().optional() }).optional(), parts: z.array(messagePartSchema).optional() }));
const messageDetail = z.object({
  labelIds: z.array(z.string()).optional(), snippet: z.string().optional(), body: z.string().optional(), internalDate: z.string(),
  payload: z.object({ headers: z.array(header).optional(), mimeType: z.string().optional(), body: z.object({ data: z.string().optional(), size: z.number().optional() }).optional(), parts: z.array(messagePartSchema).optional() }).optional(),
});
const threadDetail = z.object({ id: z.string(), historyId: z.string(), messages: z.array(messageDetail).min(1) });

type Account = Pick<GoogleAccount, 'email' | 'request'>;
interface AccountState { status: MailSource['accounts'][number]['status']; observedAt: number | null; message?: string;
  retryAt: number; rateLimitFailures: number;
  threads: MailThread[]; partial: boolean; cache: Map<string, { historyId: string; thread: MailThread }> }

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => entities[e])
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

function decodeBody(data: string): string {
  if (/[\s<>]/.test(data) || !/^[A-Za-z0-9_-]+=*$/.test(data)) return data;
  try {
    const decoded = Buffer.from(data, 'base64url').toString('utf8');
    if (decoded && !decoded.includes('\ufffd')) return decoded;
  } catch {}
  return data;
}

function stripHtml(html: string): string {
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6])>/gi, '\n\n')
    .replace(/<\/(div|tr|li)>/gi, '\n')
    .replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
      const cleanContent = content.replace(/<[^>]+>/g, '').trim();
      const cleanHref = decode(href.trim());
      if (!cleanHref || /^(?:mailto|javascript|tel):/i.test(cleanHref)) {
        return cleanContent;
      }
      return cleanContent ? `${cleanContent} (${cleanHref})` : cleanHref;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return decode(text);
}

function findPart(parts: MessagePart[], mimeType?: string): MessagePart | undefined {
  for (const part of parts) {
    if ((!mimeType || part.mimeType === mimeType) && part.body?.data) return part;
    if (part.parts) {
      const found = findPart(part.parts, mimeType);
      if (found) return found;
    }
  }
  return undefined;
}

export function extractBody(msg: z.infer<typeof messageDetail>): string {
  if (msg.body && msg.body.trim()) return decode(msg.body);
  const payload = msg.payload;
  if (payload) {
    if (payload.parts && payload.parts.length > 0) {
      const plain = findPart(payload.parts, 'text/plain');
      if (plain?.body?.data) {
        const text = decodeBody(plain.body.data);
        if (text.trim()) return decode(text);
      }
      const html = findPart(payload.parts, 'text/html');
      if (html?.body?.data) {
        const text = decodeBody(html.body.data);
        const stripped = stripHtml(text);
        if (stripped.trim()) return stripped;
      }
    } else if (payload.body?.data && (!payload.mimeType || payload.mimeType.startsWith('text/'))) {
      const text = decodeBody(payload.body.data);
      const isHtml = payload.mimeType === 'text/html' || (!payload.mimeType && /<(p|div|html|body|br|span|table|h[1-6])[^>]*>/i.test(text));
      const clean = isHtml ? stripHtml(text) : decode(text);
      if (clean.trim()) return clean;
    }
  }
  return decode(msg.snippet ?? '');
}
/** `"Jan Kowalski" <jan@x.pl>` → `Jan Kowalski`; a bare address stays as is. */
export function sender(from: string) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return (match ? match[1].trim() || match[2] : from).trim() || 'Nieznany nadawca';
}
/** `"Jan Kowalski" <jan@x.pl>` → `jan@x.pl`; a bare address stays as is. */
export const address = (from: string) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
export function projectThread(email: string, raw: unknown): MailThread {
  const thread = threadDetail.parse(raw);
  const latest = [...thread.messages].reverse().find(m => m.labelIds?.includes('UNREAD')) ?? thread.messages.at(-1)!;
  const get = (name: string) => latest.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return { id: `${email}:${thread.id}`, account: email, threadId: thread.id, from: sender(get('From')), address: address(get('From')),
    unread: thread.messages.some(m => m.labelIds?.includes('UNREAD')),
    subject: get('Subject').trim() || '(bez tematu)', snippet: decode(latest.snippet ?? ''), body: extractBody(latest) || decode(latest.snippet ?? ''),
    receivedAt: Number(latest.internalDate), messages: thread.messages.length,
    sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(email)}/#inbox/${thread.id}` };
}

/** Unread inbox conversations of every account, merged newest first. Never sends or permanently deletes messages. */
export function createMailReader(accounts: Account[], now = Date.now) {
  const states = new Map<string, AccountState>(accounts.map(a => [a.email, { status: 'loading', observedAt: null, threads: [], partial: false, cache: new Map(), retryAt: 0, rateLimitFailures: 0 }]));
  let lastAttempt = -Infinity;
  let pending: Promise<void> | undefined;
  async function refresh(account: Account) {
    const state = states.get(account.email)!;
    if (now() < state.retryAt) return;
    try {
      const listed: { id: string; historyId: string }[] = [];
      let pageToken: string | undefined;
      do {
        const page = threadList.parse(await account.request('mail', `${BASE}/threads`, { params: { q: MAIL_QUERY, maxResults: '100', ...(pageToken ? { pageToken } : {}) } }));
        listed.push(...(page.threads ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken && listed.length < MAX_PER_ACCOUNT);
      const threads: MailThread[] = [];
      for (let i = 0; i < Math.min(listed.length, MAX_PER_ACCOUNT); i += 10) {
        // Unchanged conversations (same historyId) come from the cache.
        threads.push(...await Promise.all(listed.slice(i, i + 10).map(async ({ id, historyId }) => {
          const cached = state.cache.get(id);
          if (cached?.historyId === historyId) return cached.thread;
          const thread = projectThread(account.email, await account.request('mail', `${BASE}/threads/${id}`,
            { params: { format: 'full' } }));
          state.cache.set(id, { historyId, thread });
          return thread;
        })));
      }
      const ids = new Set(listed.map(t => t.id));
      for (const id of state.cache.keys()) if (!ids.has(id)) state.cache.delete(id);
      Object.assign(state, { status: 'connected', observedAt: now(), threads,
        partial: !!pageToken || listed.length > MAX_PER_ACCOUNT, message: undefined, retryAt: 0, rateLimitFailures: 0 });
    } catch (error) {
      // Keep the last list and its observation time; never serialize auth errors (they may carry credentials).
      const auth = error instanceof GoogleAuthError;
      const failure = error as { response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } } };
      const disabled = failure.response?.data?.error?.errors?.some(e => e.reason === 'accessNotConfigured');
      const limited = failure.response?.status === 429 || failure.response?.data?.error?.errors?.some(e =>
        e.reason === 'rateLimitExceeded' || e.reason === 'userRateLimitExceeded' || e.reason === 'quotaExceeded');
      if (limited) {
        state.rateLimitFailures += 1;
        state.retryAt = now() + Math.min(60_000 * 2 ** Math.min(state.rateLimitFailures - 1, 4), 15 * 60_000);
      }
      state.status = auth || disabled ? 'unavailable' : 'offline';
      state.message = auth ? (error.reason === 'scopes_missing' ? 'Połącz konto ponownie, aby panel mógł obsługiwać Gmail.'
        : error.reason === 'client_missing' || error.reason === 'invalid_client' ? 'Dodaj klienta OAuth Google.'
        : error.reason === 'token_expired' ? 'Google odrzucił zapisane logowanie (wygasło lub zostało cofnięte). Zaloguj się ponownie w Ustawieniach.'
        : error.reason === 'storage_failed' ? 'Nie udało się odczytać zapisanego logowania z dysku. Zaloguj się ponownie w Ustawieniach.'
        : 'Zaloguj się przez Google w Ustawieniach.')
        : disabled ? 'Włącz Gmail API w projekcie klienta OAuth Google.'
        : limited ? 'Konto jest połączone. Gmail ograniczył liczbę zapytań. Ponowię odczyt automatycznie po przerwie.'
        : 'Nie udało się odczytać Gmaila. Ponowię połączenie.';
    }
  }
  /** Conversations a search read, by `email:threadId` (same historyId: no new request), and recent answers by query. */
  const found = new Map<string, { historyId: string; thread: MailThread }>();
  const searches = new Map<string, { at: number; threads: MailThread[] }>();
  /**
   * Searches run one at a time and the same one asked twice is one: three rule cards of one chat loading together read
   * 30 conversations each in parallel and Gmail refused them (its per-user rate, 30.10.2026).
   */
  const running = new Map<string, Promise<MailThread[]>>();
  let queue: Promise<unknown> = Promise.resolve();
  const limited = (error: unknown) => {
    const failure = error as { response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } } };
    return failure.response?.status === 429 || !!failure.response?.data?.error?.errors?.some(e => /rateLimitExceeded|userRateLimitExceeded/.test(e.reason ?? ''));
  };
  /** A request Gmail refused for its rate is tried once more after a second. */
  async function get(account: Account, url: string, params: Record<string, string>): Promise<unknown> {
    try { return await account.request('mail', url, { params }); }
    catch (error) {
      if (!limited(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 1_000));
      return account.request('mail', url, { params });
    }
  }
  async function full(account: Account, id: string, historyId?: string): Promise<MailThread> {
    const key = `${account.email}:${id}`, known = found.get(key);
    if (known && historyId && known.historyId === historyId) return known.thread;
    const raw = await get(account, `${BASE}/threads/${id}`, { format: 'full' });
    const thread = projectThread(account.email, raw);
    if (found.size > 500) found.clear();
    found.set(key, { historyId: threadDetail.parse(raw).historyId, thread });
    return thread;
  }
  return {
    /**
     * Conversations of the whole mailbox (read or not) matching a Gmail query, newest first, at most `limit` per account.
     * Read-only: Wektor uses it to see what a Smart Actions rule would catch. Answers are kept for two minutes.
     */
    async search(q: string, limit: number): Promise<MailThread[]> {
      const key = `${limit}:${q}`, known = searches.get(key);
      if (known && now() - known.at < 120_000) return known.threads;
      const pending = running.get(key);
      if (pending) return pending;
      const work = queue.catch(() => {}).then(async () => {
        const threads: MailThread[] = [];
        for (const account of accounts) {
          const page = threadList.parse(await get(account, `${BASE}/threads`, { q, maxResults: String(limit) }));
          const listed = page.threads ?? [];
          for (let i = 0; i < listed.length; i += 5) threads.push(...await Promise.all(listed.slice(i, i + 5).map(t => full(account, t.id, t.historyId))));
        }
        threads.sort((a, b) => b.receivedAt - a.receivedAt);
        if (searches.size > 50) searches.clear();
        searches.set(key, { at: now(), threads });
        return threads;
      });
      queue = work;
      running.set(key, work);
      try { return await work; } finally { running.delete(key); }
    },
    /** One conversation by account and id, read or not. */
    async thread(email: string, threadId: string): Promise<MailThread> {
      const account = accounts.find(a => a.email === email);
      if (!account || !/^[0-9a-f]+$/i.test(threadId)) throw new Error('Unknown conversation');
      return full(account, threadId);
    },
    /** Drop a pre-login failure immediately after successful consent. Keep quota backoff. */
    invalidate() { lastAttempt = -Infinity; },
    async read(limit: number): Promise<MailSource> {
      if (now() - lastAttempt >= 30_000) {
        pending ??= (async () => { lastAttempt = now(); await Promise.all(accounts.map(refresh)); })().finally(() => { pending = undefined; });
      }
      await pending;
      const list = [...states.values()];
      // Also age cached/failure-retained data out of the rolling window.
      const cutoff = now() - MAIL_WINDOW_MS;
      const recent = (state: AccountState) => state.threads.filter(t => t.receivedAt >= cutoff);
      const all = list.flatMap(recent).sort((a, b) => b.receivedAt - a.receivedAt);
      const withData = list.filter(s => s.observedAt !== null);
      const status = list.some(s => s.status === 'connected') ? 'connected' : list.some(s => s.status === 'loading') ? 'loading'
        : list.some(s => s.status === 'offline') ? 'offline' : 'unavailable';
      return mailSourceSchema.parse({ live: true, name: 'Gmail', status,
        observedAt: withData.length ? Math.min(...withData.map(s => s.observedAt!)) : null,
        data: withData.length ? all.slice(0, limit) : null, total: all.length, partial: list.some(s => s.partial || s.status !== 'connected'),
        accounts: [...states.entries()].map(([email, s]) => ({ email, status: s.status, observedAt: s.observedAt,
          unread: s.observedAt === null ? null : recent(s).length,
          ...(s.partial ? { partial: true } : {}), ...(s.message ? { message: s.message } : {}) })),
        ...(list.find(s => s.message)?.message ? { message: list.find(s => s.message)!.message } : {}),
      });
    },
    async act(email: string, threadId: string, action: MailAction) {
      const account = accounts.find(a => a.email === email);
      if (!account || !/^[0-9a-f]+$/i.test(threadId)) throw new Error('Unknown conversation');
      const url = `${BASE}/threads/${threadId}`;
      if (action === 'read' || action === 'unread')
        await account.request('mail', `${url}/modify`, { method: 'POST', data: action === 'read' ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] } });
      else await account.request('mail', `${url}/${action}`, { method: 'POST' });
      const state = states.get(email)!;
      if (action === 'read' || action === 'trash') {
        state.threads = state.threads.filter(t => t.threadId !== threadId);
      }
      lastAttempt = -Infinity; // Next read reconciles with Gmail.
    },
  };
}
