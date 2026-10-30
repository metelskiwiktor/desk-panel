import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { cezarActionSchema, cezarCreateRunSchema } from '../src/cezar-contract';
import { mailActionSchema } from '../src/mail-contract';
import { warmupEditFor, warmupProviderSchema, warmupRunInputSchema } from '../src/warmup-contract';
import { jsonRoutes, SourceError, type PanelSources } from './sources';
import type { ChatService } from './agent-chat';
import { agentViews, serveAgentView } from './agent-views';
import { handleChatRoute } from './chat-routes';
import type { Cockpit } from './cockpit';
import { handleMcpRoute } from './panel-mcp';
import { todoActionSchema } from '../src/todo-contract';
import { TodoError } from './todos';
import { bankLabelActionSchema } from '../src/bank-labels-contract';
import { bankShowQuerySchema } from '../src/bank-show-contract';
import { bankPlanSchema } from '../src/bank-plan-contract';
import { smartRulePlanSchema, smartRuleToggleSchema } from '../src/smart-rules-contract';
import { mailRow, previewPlan, smartView, SmartRuleError, TEST_LIMIT } from './smart-rules';
import { planPreview } from './bank-plan';
import { bankAssignSchema } from '../src/bank-assign-contract';
import { assignPreview } from './bank-assign';
import { bankShow, BankShowError, dayIn } from './bank-show';
import { BankLabelError } from './bank-labels';
import { observerCancelSchema } from '../src/observers-contract';
import { automationUpdateSchema } from '../src/automation-contract';
import { AutomationError, type Automations } from './automations';

/** Small JSON request bodies only (actions), validated by the caller's schema. */
async function readJson<T>(req: IncomingMessage, schema: z.ZodType<T>, maxBytes = 4096): Promise<T> {
  let body = '';
  req.setEncoding('utf8'); // a Polish letter split between two chunks must not break
  for await (const chunk of req) { body += chunk; if (body.length > maxBytes) throw new SourceError(413); }
  const parsed = schema.safeParse(JSON.parse(body || 'null'));
  if (!parsed.success) throw new SourceError(400);
  return parsed.data;
}
const connectSchema = z.object({ email: z.string() }).strict();
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Loopback-only panel API (and built frontend from `root`) over any PanelSources. */
export function createPanelServer(sources: PanelSources, root: string, allowedHost?: string, chat?: ChatService, options: { mcpToken?: string; cockpit?: Cockpit; cezarUrl?: string; automations?: Automations } = {}) {
  const routes = jsonRoutes(sources);
  const agent = agentViews(sources);
  return createServer(async (req, res) => {
    const host = req.headers.host;
    // `allowedHost` is the one extra name (Tailscale Serve, HTTPS) that reaches this loopback listener through a local proxy.
    const proxied = !!allowedHost && host === allowedHost;
    if (!host || !(proxied || /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host))) { res.writeHead(403).end(); return; }
    const ownOrigin = `${proxied ? 'https' : 'http'}://${host}`;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url || '/', `http://${host}`);
    if (req.method === 'GET' && url.pathname === '/api/cezar/dispatch-defaults') {
      const workflow = url.searchParams.get('workflow') || 'desk-panel-task';
      const runner = url.searchParams.get('runner') || undefined;
      if (!/^[a-z0-9_-]{1,64}$/.test(workflow) || (runner && !/^[a-z0-9_-]{1,32}$/.test(runner))) { res.writeHead(400).end(); return; }
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
      try { if (!sources.cezarDefaults) throw new SourceError(503); res.end(JSON.stringify(await sources.cezarDefaults(workflow, runner))); }
      catch { res.writeHead(503).end(JSON.stringify({ error: 'Nie udało się odczytać ustawień Cezara.' })); }
      return;
    }
    if (url.pathname.startsWith('/api/chats') && await handleChatRoute(req, res, url, ownOrigin, chat, options.cockpit, sources.appointments, options.automations)) return;
    // The panel's tools for Hermes (MCP): local callers with the token only, never through the Tailscale name.
    if (url.pathname === '/api/mcp') { await handleMcpRoute(req, res, { views: agent, sources, token: options.mcpToken, loopback: !proxied, cezarUrl: options.cezarUrl, automations: options.automations, automationTurn: runId => chat?.automationTurn?.(runId), activeChats: () => chat?.activeTurns?.() ?? [] }); return; }
    if(req.method==='POST' && url.pathname.startsWith('/api/quotas/warmup/')) {
      if(req.headers.origin!==ownOrigin){res.writeHead(403).end();return;}
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
      try{
        const action=url.pathname.slice('/api/quotas/warmup/'.length).split('/');
        const manual=action.length===2 && action[1]==='run';
        const provider=warmupProviderSchema.safeParse(action.length===1 || manual ? action[0] : undefined);
        if(!provider.success)throw new SourceError(400);
        if(manual){
          await readJson(req,warmupRunInputSchema);
          if(!sources.runWarmup)throw new SourceError(503);
          res.end(JSON.stringify(await sources.runWarmup(provider.data)));return;
        }
        const input=await readJson(req,warmupEditFor(provider.data));
        if(!sources.saveWarmup)throw new SourceError(503);
        res.end(JSON.stringify(await sources.saveWarmup(provider.data,input)));
      }catch(error){res.writeHead(error instanceof SourceError ? error.status : error instanceof SyntaxError ? 400 : 502).end(JSON.stringify({error:'Nie udało się wykonać operacji warmupu.'}));}
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/google/connect' || url.pathname === '/api/bank/connect' || url.pathname === '/api/mail/action' || url.pathname === '/api/cezar/action' || url.pathname === '/api/cezar/runs' || url.pathname === '/api/todos/action' || url.pathname === '/api/bank/labels/action' || url.pathname === '/api/smart-rules/toggle' || url.pathname === '/api/observers/cancel' || url.pathname === '/api/automations/action')) {
      // Actions change state (or Gmail), so only the panel's own page may call them.
      if (req.headers.origin !== ownOrigin) { res.writeHead(403).end(); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try {
        if (url.pathname === '/api/google/connect') {
          const { email } = await readJson(req, connectSchema);
          res.end(JSON.stringify({ authorizationUrl: await sources.googleConnect(email) }));
        } else if (url.pathname === '/api/bank/connect') {
          res.end(JSON.stringify({ authorizationUrl: await sources.bankConnect() }));
        } else if (url.pathname === '/api/cezar/runs') {
          if (!sources.cezarCreateRun) throw new SourceError(503);
          const input = await readJson(req, cezarCreateRunSchema, 65_536);
          res.writeHead(201).end(JSON.stringify(await sources.cezarCreateRun(input)));
        } else if (url.pathname === '/api/cezar/action') {
          const { id, action } = await readJson(req, cezarActionSchema);
          await sources.cezarAction(id, action);
          res.end(JSON.stringify({ ok: true }));
        } else if (url.pathname === '/api/todos/action') {
          res.end(JSON.stringify(await sources.todoAction(await readJson(req, todoActionSchema))));
        } else if (url.pathname === '/api/automations/action') {
          // The Automaty view's buttons: pause, resume, cancel, run now and the notebook, local only.
          if (!sources.automationAction) throw new SourceError(503);
          res.end(JSON.stringify(await sources.automationAction(await readJson(req, automationUpdateSchema))));
        } else if (url.pathname === '/api/observers/cancel') {
          // The user's cancel on the settings card: local only, the observer never fires.
          if (!sources.observerCancel) throw new SourceError(503);
          res.end(JSON.stringify(await sources.observerCancel((await readJson(req, observerCancelSchema)).id)));
        } else if (url.pathname === '/api/smart-rules/toggle') {
          // The tile's switch: on or off, nothing else of a rule changes without the chat's card.
          if (!sources.smartRules) throw new SourceError(503);
          const { id, enabled } = await readJson(req, smartRuleToggleSchema);
          res.end(JSON.stringify({ rules: sources.smartRules.toggle(id, enabled) }));
        } else if (url.pathname === '/api/bank/labels/action') {
          // The user's marks only, kept on this computer: nothing here reaches the bank.
          res.end(JSON.stringify(await sources.bankLabelAction(await readJson(req, bankLabelActionSchema))));
        } else {
          const { account, threadId, action } = await readJson(req, mailActionSchema);
          await sources.mailAction(account, threadId, action);
          res.end(JSON.stringify({ ok: true }));
        }
      } catch (error) {
        const status = error instanceof SourceError || error instanceof SmartRuleError || error instanceof AutomationError ? error.status : error instanceof SyntaxError ? 400 : url.pathname === '/api/google/connect' || url.pathname === '/api/bank/connect' ? 409 : 502;
        // A refused to-do action says why (the agent reads it); the other actions keep to a general sentence.
        const reason = error instanceof TodoError || error instanceof BankLabelError || error instanceof SmartRuleError ? error.message
          : url.pathname === '/api/todos/action' && status === 400 ? 'Niepoprawna akcja: sprawdź nazwę akcji i pola; lista i zadanie to identyfikatory w postaci l-… i t-….'
          : status === 409 && url.pathname === '/api/google/connect' ? 'Dodaj plik klienta OAuth Google.'
          : status === 409 && url.pathname === '/api/bank/connect' ? 'Konto bankowe nie jest skonfigurowane albo bank odmówił rozpoczęcia zgody.' : 'Nie udało się wykonać akcji.';
        res.writeHead(status).end(JSON.stringify({ error: reason }));
      }
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (url.pathname.startsWith('/api/agent/')) {
      const answer = await serveAgentView(agent, url, Date.now());
      if (answer) {
        res.setHeader('Cache-Control', 'no-store');
        res.writeHead(answer.status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(answer.body);
        return;
      }
    }
    if (url.pathname === '/api/bank/plan') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try {
        const plan = bankPlanSchema.safeParse({ merge: url.searchParams.getAll('merge'), into: url.searchParams.get('into') ?? '', tags: url.searchParams.get('tags') !== '0' });
        if (!plan.success) { res.writeHead(400).end(JSON.stringify({ error: 'Niepoprawne zapytanie karty.' })); return; }
        res.end(JSON.stringify(planPreview(await sources.bankLedger(), plan.data)));
      } catch (error) {
        res.writeHead(error instanceof SourceError ? error.status : 502).end(JSON.stringify({ error: 'Nie udało się pobrać podglądu zmiany.' }));
      }
      return;
    }
    if (url.pathname === '/api/bank/assign') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try {
        const plan = bankAssignSchema.safeParse({ from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined });
        if (!plan.success) { res.writeHead(400).end(JSON.stringify({ error: 'Niepoprawne zapytanie karty.' })); return; }
        res.end(JSON.stringify(assignPreview(await sources.bankLedger(), plan.data)));
      } catch (error) {
        res.writeHead(error instanceof SourceError ? error.status : 502).end(JSON.stringify({ error: 'Nie udało się pobrać podglądu oznaczeń.' }));
      }
      return;
    }
    if (url.pathname === '/api/bank/show') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try {
        const query = bankShowQuerySchema.safeParse({ view: url.searchParams.get('view') ?? undefined, kategorie: url.searchParams.getAll('kategorie'), nieoznaczone: url.searchParams.get('nieoznaczone') === '1', from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined });
        if (!query.success) { res.writeHead(400).end(JSON.stringify({ error: 'Niepoprawne zapytanie karty.' })); return; }
        res.end(JSON.stringify(bankShow(await sources.bankLedger(), query.data, dayIn(Date.now(), 'Europe/Warsaw'))));
      } catch (error) {
        const status = error instanceof BankShowError ? error.status : error instanceof SourceError ? error.status : 502;
        res.writeHead(status).end(JSON.stringify({ error: error instanceof BankShowError ? error.message : 'Nie udało się pobrać danych karty.' }));
      }
      return;
    }
    if (url.pathname === '/api/smart-actions' || url.pathname === '/api/smart-rules/preview' || url.pathname === '/api/mail/search') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try {
        if (url.pathname === '/api/smart-actions') { res.end(JSON.stringify(await smartView(sources))); return; }
        if (url.pathname === '/api/mail/search') {
          // Read-only: the mail list card of the chat (`panel_mail_show`) reads its rows itself.
          const q = url.searchParams.get('q')?.trim() ?? '';
          if (!q || q.length > 300 || !sources.mailSearch) { res.writeHead(q ? 503 : 400).end(JSON.stringify({ error: 'Niepoprawne zapytanie.' })); return; }
          const limit = Math.min(TEST_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || 20));
          res.end(JSON.stringify({ query: q, rows: (await sources.mailSearch(q, limit)).map(mailRow) }));
          return;
        }
        let plan;
        try { plan = smartRulePlanSchema.parse(JSON.parse(url.searchParams.get('plan') ?? '')); }
        catch { res.writeHead(400).end(JSON.stringify({ error: 'Niepoprawna propozycja reguły.' })); return; }
        res.end(JSON.stringify(await previewPlan(sources, plan)));
      } catch (error) {
        const status = error instanceof SmartRuleError || error instanceof SourceError ? error.status : 502;
        res.writeHead(status).end(JSON.stringify({ error: error instanceof SmartRuleError ? error.message
          : error instanceof SourceError && error.status === 429 ? 'Gmail chwilowo ogranicza liczbę zapytań. Odśwież kartę za pół minuty.'
          : 'Nie udało się odczytać poczty ani reguł.' }));
      }
      return;
    }
    const route = routes[url.pathname];
    if (route) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try { res.end(JSON.stringify(await route(url))); }
      catch (error) { res.writeHead(error instanceof SourceError ? error.status : 502).end(JSON.stringify({ error: 'Nie udało się pobrać danych źródła.' })); }
      return;
    }
    if (url.pathname === '/api/calendar/callback') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const { ok, message } = await sources.googleCallback(url.searchParams);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(ok ? 200 : 400).end(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Desk Panel · Google</title><body style="background:#10151f;color:#eee;font:20px system-ui;padding:40px"><h1>Konto Google</h1><p>${message}</p><a style="color:#8bf" href="/">Wróć do panelu</a></body></html>`);
      return;
    }
    if (url.pathname === '/api/bank/callback') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const { ok, message } = await sources.bankCallback(url.searchParams);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(ok ? 200 : 400).end(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Desk Panel · Bank</title><body style="background:#10151f;color:#eee;font:20px system-ui;padding:40px"><h1>Konto bankowe</h1><p>${message}</p><a style="color:#8bf" href="/">Wróć do panelu</a></body></html>`);
      return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404).end(); return; }
    try {
      const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root + sep) && path !== resolve(root, 'index.html')) { res.writeHead(403).end(); return; }
      const file = await readFile(path);
      res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
      res.end(file);
    } catch { res.writeHead(404).end(); }
  });
}
