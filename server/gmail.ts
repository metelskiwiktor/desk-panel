import { z } from 'zod';
import { GoogleAuthError, type GoogleAccount } from './google-oauth';
import { mailSourceSchema, type MailAction, type MailSource, type MailThread } from '../src/mail-contract';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const MAIL_QUERY = 'in:inbox is:unread';
const MAX_PER_ACCOUNT = 200;
const header = z.object({ name: z.string(), value: z.string() });
const threadList = z.object({ threads: z.array(z.object({ id: z.string(), historyId: z.string() })).optional(), nextPageToken: z.string().optional() });
const threadDetail = z.object({ id: z.string(), historyId: z.string(), messages: z.array(z.object({
  labelIds: z.array(z.string()).optional(), snippet: z.string().optional(), internalDate: z.string(),
  payload: z.object({ headers: z.array(header).optional() }).optional(),
})).min(1) });
const label = z.object({ threadsUnread: z.number().int().nonnegative().optional() });

type Account = Pick<GoogleAccount, 'email' | 'request'>;
interface AccountState { status: MailSource['accounts'][number]['status']; observedAt: number | null; unread: number | null; message?: string;
  threads: MailThread[]; partial: boolean; cache: Map<string, { historyId: string; thread: MailThread }> }

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => entities[e])
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
/** `"Jan Kowalski" <jan@x.pl>` → `Jan Kowalski`; a bare address stays as is. */
export function sender(from: string) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return (match ? match[1].trim() || match[2] : from).trim() || 'Nieznany nadawca';
}
export function projectThread(email: string, raw: unknown): MailThread {
  const thread = threadDetail.parse(raw);
  const latest = [...thread.messages].reverse().find(m => m.labelIds?.includes('UNREAD')) ?? thread.messages.at(-1)!;
  const get = (name: string) => latest.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return { id: `${email}:${thread.id}`, account: email, threadId: thread.id, from: sender(get('From')),
    subject: get('Subject').trim() || '(bez tematu)', snippet: decode(latest.snippet ?? ''),
    receivedAt: Number(latest.internalDate), messages: thread.messages.length,
    sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(email)}/#inbox/${thread.id}` };
}

/** Unread inbox conversations of every account, merged newest first. Never sends or reads message bodies. */
export function createMailReader(accounts: Account[], now = Date.now) {
  const states = new Map<string, AccountState>(accounts.map(a => [a.email, { status: 'loading', observedAt: null, unread: null, threads: [], partial: false, cache: new Map() }]));
  let lastAttempt = -Infinity;
  let pending: Promise<void> | undefined;
  async function refresh(account: Account) {
    const state = states.get(account.email)!;
    try {
      const { threadsUnread } = label.parse(await account.request('mail', `${BASE}/labels/INBOX`));
      const listed: { id: string; historyId: string }[] = [];
      let pageToken: string | undefined;
      do {
        const page = threadList.parse(await account.request('mail', `${BASE}/threads`, { params: { q: MAIL_QUERY, maxResults: '100', ...(pageToken ? { pageToken } : {}) } }));
        listed.push(...(page.threads ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken && listed.length < MAX_PER_ACCOUNT);
      const threads: MailThread[] = [];
      for (let i = 0; i < Math.min(listed.length, MAX_PER_ACCOUNT); i += 10) {
        // Metadata only; unchanged conversations (same historyId) come from the cache.
        threads.push(...await Promise.all(listed.slice(i, i + 10).map(async ({ id, historyId }) => {
          const cached = state.cache.get(id);
          if (cached?.historyId === historyId) return cached.thread;
          const thread = projectThread(account.email, await account.request('mail', `${BASE}/threads/${id}`,
            { params: { format: 'metadata', metadataHeaders: ['From', 'Subject'] } }));
          state.cache.set(id, { historyId, thread });
          return thread;
        })));
      }
      const ids = new Set(listed.map(t => t.id));
      for (const id of state.cache.keys()) if (!ids.has(id)) state.cache.delete(id);
      Object.assign(state, { status: 'connected', observedAt: now(), unread: threadsUnread ?? listed.length, threads,
        partial: !!pageToken || listed.length > MAX_PER_ACCOUNT, message: undefined });
    } catch (error) {
      // Keep the last list and its observation time; never serialize auth errors (they may carry credentials).
      const auth = error instanceof GoogleAuthError;
      const failure = error as { response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } } };
      const disabled = failure.response?.data?.error?.errors?.some(e => e.reason === 'accessNotConfigured');
      state.status = auth || disabled ? 'unavailable' : 'offline';
      state.message = auth ? (error.reason === 'scopes_missing' ? 'Połącz konto ponownie, aby panel mógł obsługiwać Gmail.'
        : error.reason === 'client_missing' || error.reason === 'invalid_client' ? 'Dodaj klienta OAuth Google.' : 'Zaloguj się przez Google w Ustawieniach.')
        : disabled ? 'Włącz Gmail API w projekcie klienta OAuth Google.' : 'Nie udało się odczytać Gmaila. Ponowię połączenie.';
    }
  }
  return {
    async read(limit: number): Promise<MailSource> {
      if (now() - lastAttempt >= 30_000) {
        pending ??= (async () => { lastAttempt = now(); await Promise.all(accounts.map(refresh)); })().finally(() => { pending = undefined; });
      }
      await pending;
      const list = [...states.values()];
      const all = list.flatMap(s => s.threads).sort((a, b) => b.receivedAt - a.receivedAt);
      const withData = list.filter(s => s.observedAt !== null);
      const status = list.some(s => s.status === 'connected') ? 'connected' : list.some(s => s.status === 'loading') ? 'loading'
        : list.some(s => s.status === 'offline') ? 'offline' : 'unavailable';
      return mailSourceSchema.parse({ live: true, name: 'Gmail', status,
        observedAt: withData.length ? Math.min(...withData.map(s => s.observedAt!)) : null,
        data: withData.length ? all.slice(0, limit) : null, total: all.length, partial: list.some(s => s.partial || s.status !== 'connected'),
        accounts: [...states.entries()].map(([email, s]) => ({ email, status: s.status, observedAt: s.observedAt, unread: s.unread, ...(s.message ? { message: s.message } : {}) })),
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
        if (state.unread) state.unread -= 1;
      }
      lastAttempt = -Infinity; // Next read reconciles with Gmail.
    },
  };
}
