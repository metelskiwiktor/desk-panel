import type { IncomingMessage, ServerResponse } from 'node:http';
import { chatRenameSchema, chatSendSchema } from '../src/chat-contract';
import { ChatError, type ChatService } from './agent-chat';

const MAX_BODY = 64 * 1024;
async function readBody(req: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) throw new ChatError(413); }
  return JSON.parse(body || 'null');
}
const parse = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ChatError(400);
  return result.data;
};
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status).end(JSON.stringify(value));
};

/**
 * The chat API (`/api/chats…`). Everything that starts or changes a conversation is a write: only the panel's own page
 * may call it (Origin check), like the Gmail and Cezar actions. Returns false for a path that is not a chat route.
 */
export async function handleChatRoute(req: IncomingMessage, res: ServerResponse, url: URL, ownOrigin: string, chat?: ChatService): Promise<boolean> {
  const match = /^\/api\/chats(?:\/([0-9a-f-]{36})(?:\/(messages|stop|events))?)?\/?$/.exec(url.pathname);
  if (!match) return false;
  if (!chat) { json(res, 503, { error: 'Czat jest niedostępny.' }); return true; }
  const [, id, action] = match;
  const write = req.method !== 'GET';
  if (write && req.headers.origin !== ownOrigin) { res.writeHead(403).end(); return true; }
  try {
    if (!id) {
      if (req.method === 'GET') return json(res, 200, { chats: await chat.list() }), true;
      if (req.method === 'POST') return json(res, 201, await chat.create(parse(chatSendSchema, await readBody(req)))), true;
    } else if (!action) {
      if (req.method === 'GET') return json(res, 200, await chat.get(id)), true;
      if (req.method === 'PATCH') { await chat.rename(id, parse(chatRenameSchema, await readBody(req)).title); return json(res, 200, { ok: true }), true; }
      if (req.method === 'DELETE') { await chat.remove(id); return json(res, 200, { ok: true }), true; }
    } else if (action === 'messages' && req.method === 'POST') {
      await chat.send(id, parse(chatSendSchema, await readBody(req)));
      return json(res, 202, { ok: true }), true;
    } else if (action === 'stop' && req.method === 'POST') {
      await chat.stop(id);
      return json(res, 200, { ok: true }), true;
    } else if (action === 'events' && req.method === 'GET') {
      await chat.get(id); // a chat that does not exist answers 404 before the stream starts
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('X-Accel-Buffering', 'no');
      res.writeHead(200);
      res.write('retry: 3000\n\n');
      let stop: (() => void) | undefined, closed = false;
      const beat = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => { closed = true; clearInterval(beat); stop?.(); });
      stop = await chat.subscribe(id, event => { res.write(`data: ${JSON.stringify(event)}\n\n`); });
      if (closed) stop();
      return true;
    }
    res.writeHead(405).end();
  } catch (error) {
    const status = error instanceof ChatError ? error.status : error instanceof SyntaxError ? 400 : 500;
    if (res.headersSent) res.end();
    else json(res, status, { error: status === 409 ? 'Agent jeszcze odpowiada.' : status === 404 ? 'Nie ma takiej rozmowy.' : 'Nie udało się wykonać operacji czatu.' });
  }
  return true;
}
