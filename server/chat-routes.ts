import type { IncomingMessage, ServerResponse } from 'node:http';
import { z, type ZodType } from 'zod';
import { appointmentActionSchema, appointmentQuerySchema, appointmentReference, calendarChoiceSchema, calendarProposalSchema } from '../src/appointment-contract';
import { stableAppointmentCardId } from './appointment-cards';
import { AppointmentError } from './znanylekarz';
import type { AppointmentService } from './appointments';
import { chatApprovalSchema, chatEngineSchema, chatRenameSchema, chatSendSchema, type ChatDetail, type ChatPart } from '../src/chat-contract';
import { bankPlanDecisionSchema, bankPlanSchema } from '../src/bank-plan-contract';
import { bankAssignSchema } from '../src/bank-assign-contract';
import { smartRulePlanOf } from '../src/smart-rules-contract';
import { cardRefusal, cockpitDispatchSchema, type DispatchOutcome } from '../src/cockpit-contract';
import { ChatError, type ChatService } from './agent-chat';
import type { Cockpit } from './cockpit';
import { SourceError } from './sources';
import { SmartRuleError } from './smart-rules';
import { automationPlanSchema, automationDecisionSchema } from '../src/automation-contract';
import type { Automations } from './automations';
import { AutomationError } from './automations';

/** A message (`MAX_MESSAGE`) plus up to ten context items of 8000 characters each, with room for JSON escaping. */
const MAX_BODY = 512 * 1024;
/** Old decisions used unstable stream ids. Resolve only a unique exact prompt; otherwise block new decisions. */
export function resolveLegacyDecisions(conversation: ChatDetail, dispatches: Record<string, DispatchOutcome>) {
  const resolved = { ...dispatches };
  const cards = conversation.items.flatMap(m => m.role === 'agent' ? (m.parts ?? []).flatMap(p => {
    if (p.type !== 'tool' || !p.name.includes('panel_cezar_propose') || !p.id.startsWith(`${m.id}:`)) return [];
    try { const args = JSON.parse(p.input) as { prompt?: unknown }; return typeof args.prompt === 'string' ? [{ id: p.id, prompt: args.prompt }] : []; } catch { return []; }
  }) : []);
  let unresolved = false;
  for (const [key, decision] of Object.entries(dispatches)) {
    if (cards.some(card => card.id === key)) continue;
    const matches = decision.decision === 'dispatched' ? cards.filter(card => card.prompt === decision.prompt) : [];
    if (matches.length !== 1 || resolved[matches[0].id]) { unresolved = true; continue; }
    resolved[matches[0].id] = decision;
  }
  return { dispatches: resolved, unresolved };
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) throw new ChatError(413, 'Zbyt duże ciało żądania (>512 KB)'); }
  return JSON.parse(body || 'null');
}
const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map(i => {
      const field = i.path.join('.') || ('keys' in i && Array.isArray((i as { keys?: unknown[] }).keys) ? (i as { keys: unknown[] }).keys.join(', ') : 'body');
      return `${field}: ${i.message}`;
    }).join(', ');
    throw new ChatError(400, `Nieprawidłowe dane (${issues})`);
  }
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
export async function handleChatRoute(req: IncomingMessage, res: ServerResponse, url: URL, ownOrigin: string, chat?: ChatService, cockpit?: Cockpit, appointments?: AppointmentService, automations?: Automations): Promise<boolean> {
  const match = /^\/api\/chats(?:\/([0-9a-f-]{36}|engine)(?:\/(messages|stop|events|approval|cockpit|dispatch|bank-plan|smart-rule|automation|appointment|calendar-plan))?)?\/?$/.exec(url.pathname);
  if (!match) return false;
  if (!chat) { json(res, 503, { error: 'Czat jest niedostępny.' }); return true; }
  const [, id, action] = match;
  const write = req.method !== 'GET';
  if (write && req.headers.origin !== ownOrigin) { res.writeHead(403).end(); return true; }
  try {
    if (id && id !== 'engine' && (action === 'appointment' || action === 'calendar-plan') && (req.method === 'GET' || req.method === 'POST')) {
      if (!appointments) throw new ChatError(503, 'Karty wizyt i wydarzeń są niedostępne.');
      const body = req.method === 'POST' ? parse(z.object({ toolCallId: z.string().min(1).max(200), action: z.unknown() }).strict(), await readBody(req)) : null;
      const toolCallId = body?.toolCallId ?? url.searchParams.get('toolCallId');
      const conversation = await chat.get(id);
      const tool = action === 'appointment' ? 'panel_znanylekarz' : 'panel_calendar_propose';
      const matches = conversation.engine === 'hermes' ? conversation.items.flatMap(m => m.role === 'agent' && m.status === 'done' ? (m.parts ?? []).flatMap(p =>
        p.type === 'tool' && p.id === toolCallId && p.name.endsWith(tool) && stableAppointmentCardId(m.id, p.name, p.input, p.output) === toolCallId ? [p] : []) : []) : [];
      if (!matches.length) throw new ChatError(409, 'Nie można potwierdzić tożsamości gotowej karty. Odśwież rozmowę.');
      const card = matches[0];
      if (cardRefusal(action === 'appointment' ? 'appointment' : 'calendarPlan', card.output, card.error)) throw new ChatError(409, 'Panel odrzucił tę kartę. Poproś Wektora o nową.');
      const binding = `${id}:${toolCallId}`;
      if (action === 'appointment') {
        const ref = appointmentReference(card.output);
        if (!ref) throw new ChatError(409, 'Karta nie ma zapisanego odczytu terminów.');
        const query = parse(appointmentQuerySchema, JSON.parse(card.input));
        const view = await appointments.view(binding, ref);
        if (JSON.stringify(query) !== JSON.stringify(view.preview.query)) throw new ChatError(409, 'Odczyt terminów nie pasuje do tej karty. Poproś Wektora o nową.');
        return json(res, 200, body ? await appointments.act(binding, ref, parse(appointmentActionSchema, body.action)) : view), true;
      }
      const plan = parse(calendarProposalSchema, JSON.parse(card.input));
      if (body) {
        const decision = parse(z.object({ action: z.literal('confirm'), choice: calendarChoiceSchema.optional() }).strict(), body.action);
        return json(res, 200, await appointments.calendarConfirm(binding, plan, decision.choice)), true;
      }
      return json(res, 200, await appointments.calendarView(binding, plan)), true;
    }
    if (id === 'engine') {
      // The engine new conversations start on, remembered for every screen of the panel.
      if (action || req.method !== 'PUT' || !chat.prefer) { res.writeHead(405).end(); return true; }
      await chat.prefer(parse(chatEngineSchema, await readBody(req)).engine);
      return json(res, 200, { ok: true }), true;
    }
    if (!id) {
      if (req.method === 'GET') {
        const [chats, engines, engine] = await Promise.all([chat.list(), chat.engines?.(), chat.preferred?.()]);
        return json(res, 200, { chats, ...(engines ? { engines } : {}), ...(engine ? { engine } : {}) }), true;
      }
      if (req.method === 'POST') return json(res, 201, await chat.create(parse(chatSendSchema, await readBody(req)))), true;
    } else if (!action) {
      if (req.method === 'GET') return json(res, 200, await chat.get(id)), true;
      if (req.method === 'PATCH') { await chat.rename(id, parse(chatRenameSchema, await readBody(req)).title); return json(res, 200, { ok: true }), true; }
      if (req.method === 'DELETE') { await chat.remove(id); return json(res, 200, { ok: true }), true; }
    } else if (action === 'messages' && req.method === 'POST') {
      await chat.send(id, parse(chatSendSchema, await readBody(req)));
      return json(res, 202, { ok: true }), true;
    } else if (action === 'approval' && req.method === 'POST') {
      if (!chat.approve) throw new ChatError(409, 'Ten silnik nie pyta o zgodę.');
      await chat.approve(id, parse(chatApprovalSchema, await readBody(req)));
      return json(res, 200, { ok: true }), true;
    } else if (action === 'cockpit' && req.method === 'GET') {
      // What the conversation's cockpit shows: read-only (Cezar, GitHub CLI, the to-do lists).
      if (!cockpit || id === 'engine') { res.writeHead(503).end(); return true; }
      // Which task follows from the conversation itself (the cockpit contract), never from the request.
      const conversation = await chat.get(id);
      const view = await cockpit.view(id, conversation.items);
      if (conversation.engine === 'hermes') {
        const legacy = resolveLegacyDecisions(conversation, view.dispatches);
        const resolvedView = Object.keys(legacy.dispatches).length > Object.keys(view.dispatches).length
          ? await cockpit.view(id, conversation.items, legacy.dispatches) : view;
        return json(res, 200, { ...resolvedView, dispatches: legacy.dispatches, legacyUnresolved: legacy.unresolved }), true;
      }
      return json(res, 200, view), true;
    } else if (action === 'dispatch' && req.method === 'POST') {
      // The user's answer on a dispatch card: the only way the chat dispatches a task to Cezar.
      if (!cockpit || id === 'engine') { res.writeHead(503).end(); return true; }
      const input = parse(cockpitDispatchSchema, await readBody(req));
      const conversation = await chat.get(id);
      if (conversation.engine === 'hermes') {
        const matches = conversation.items.flatMap(m => m.role === 'agent' && m.status === 'done'
          ? (m.parts ?? []).filter(p => p.type === 'tool' && p.name.includes('panel_cezar_propose') && p.id === input.toolCallId && p.id.startsWith(`${m.id}:`))
          : []);
        if (matches.length !== 1) throw new ChatError(409, 'Nie można potwierdzić tożsamości karty. Odśwież rozmowę i sprawdź historię.');
        const card = matches[0] as Extract<ChatPart, { type: 'tool' }>;
        if (cardRefusal('dispatch', card.output, card.error)) throw new ChatError(409, 'Panel odrzucił tę propozycję, więc nie można jej zlecić. Poproś Wektora o nową.');
        const view = await cockpit.view(id, conversation.items);
        const legacy = resolveLegacyDecisions(conversation, view.dispatches);
        if (legacy.dispatches[input.toolCallId]) return json(res, 200, legacy.dispatches[input.toolCallId]), true;
        if (legacy.unresolved) throw new ChatError(409, 'Nie można jednoznacznie przypisać wcześniejszej decyzji do karty. Potrzebna jest diagnostyka tej rozmowy przed zleceniem.');
      }
      return json(res, 200, await cockpit.dispatch(id, input)), true;
    } else if (action === 'bank-plan' && req.method === 'POST') {
      // The user's answer on a bank change card: the only way the chat changes the account's categories. Which change it is
      // comes from the conversation's own tool call, never from the request.
      if (!cockpit || id === 'engine') { res.writeHead(503).end(); return true; }
      const input = parse(bankPlanDecisionSchema, await readBody(req));
      const conversation = await chat.get(id);
      const matches = conversation.engine === 'hermes' ? conversation.items.flatMap(m => m.role === 'agent' && m.status === 'done'
        ? (m.parts ?? []).filter(p => p.type === 'tool' && (p.name.includes('panel_bank_propose') || p.name.includes('panel_bank_assign')) && p.id === input.toolCallId && p.id.startsWith(`${m.id}:`))
        : []) : [];
      // The id comes from the plan, so the same plan twice in one answer is one card.
      if (!matches.length) throw new ChatError(409, 'Nie można potwierdzić tożsamości karty. Odśwież rozmowę i sprawdź historię.');
      const card = matches[0] as Extract<ChatPart, { type: 'tool' }>;
      if (cardRefusal(card.name.includes('panel_bank_assign') ? 'bankAssign' : 'bankPlan', card.output, card.error)) throw new ChatError(409, 'Panel odrzucił tę propozycję, więc nie można jej wykonać. Poproś Wektora o nową.');
      const bad = () => new ChatError(409, 'Propozycja ma niepoprawny kształt. Poproś Wektora o nową.');
      if (card.name.includes('panel_bank_assign')) {
        let plan;
        try { plan = bankAssignSchema.parse(JSON.parse(card.input)); } catch { throw bad(); }
        return json(res, 200, await cockpit.bankAssign(id, input, plan)), true;
      }
      let plan;
      try { plan = bankPlanSchema.parse(JSON.parse(card.input)); } catch { throw bad(); }
      return json(res, 200, await cockpit.bankPlan(id, input, plan)), true;
    } else if (action === 'smart-rule' && req.method === 'POST') {
      // The user's answer on a Smart Actions rule card: the only way the chat changes the rules. The rule comes from the
      // conversation's own tool call, never from the request.
      if (!cockpit || id === 'engine') { res.writeHead(503).end(); return true; }
      const input = parse(bankPlanDecisionSchema.pick({ toolCallId: true, decision: true }).strict(), await readBody(req));
      const conversation = await chat.get(id);
      const card = conversation.engine === 'hermes' ? conversation.items.flatMap(m => m.role === 'agent' && m.status === 'done'
        ? (m.parts ?? []).filter(p => p.type === 'tool' && p.name.includes('panel_smart_rule_propose') && p.id === input.toolCallId && p.id.startsWith(`${m.id}:`))
        : [])[0] as Extract<ChatPart, { type: 'tool' }> | undefined : undefined;
      if (!card) throw new ChatError(409, 'Nie można potwierdzić tożsamości karty. Odśwież rozmowę i sprawdź historię.');
      if (cardRefusal('smartRule', card.output, card.error)) throw new ChatError(409, 'Panel odrzucił tę propozycję, więc nie można jej wykonać. Poproś Wektora o nową.');
      const plan = smartRulePlanOf(card.input);
      if (!plan) throw new ChatError(409, 'Propozycja ma niepoprawny kształt. Poproś Wektora o nową.');
      return json(res, 200, await cockpit.smartRule(id, input, plan)), true;
    } else if (action === 'automation' && req.method === 'POST') {
      // The user's answer on a „Nowy automat” card: the only way the chat creates an automation. Its plan comes from the
      // conversation's own tool call, never from the request.
      if (!automations || id === 'engine') { res.writeHead(503).end(); return true; }
      const input = parse(automationDecisionSchema, await readBody(req));
      const conversation = await chat.get(id);
      const card = conversation.engine === 'hermes' ? conversation.items.flatMap(m => m.role === 'agent' && m.status === 'done'
        ? (m.parts ?? []).filter(p => p.type === 'tool' && p.name.includes('panel_automation_propose') && p.id === input.toolCallId && p.id.startsWith(`${m.id}:`))
        : [])[0] as Extract<ChatPart, { type: 'tool' }> | undefined : undefined;
      if (!card) throw new ChatError(409, 'Nie można potwierdzić tożsamości karty. Odśwież rozmowę i sprawdź historię.');
      if (input.decision === 'reject') return json(res, 200, { decision: 'rejected', at: Date.now() }), true;
      if (cardRefusal('automation', card.output, card.error)) throw new ChatError(409, 'Panel odrzucił tę propozycję, więc nie można jej utworzyć. Poproś Wektora o nową.');
      let plan;
      try { plan = automationPlanSchema.parse(JSON.parse(card.input)); } catch { throw new ChatError(409, 'Propozycja ma niepoprawny kształt. Poproś Wektora o nową.'); }
      if (input.actions) {
        const allowed = new Set(plan.actions.map(a => a.kind));
        plan = { ...plan, actions: input.actions.filter(a => allowed.has(a.kind)) };
        if (!plan.actions.length) throw new ChatError(409, 'Nie zaznaczono żadnej akcji, więc automat nie powstał.');
      }
      return json(res, 200, { decision: 'created', at: Date.now(), automation: await automations.createFromPlan(id, plan) }), true;
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
    const status = error instanceof ChatError || error instanceof SourceError || error instanceof AppointmentError || error instanceof SmartRuleError || error instanceof AutomationError ? error.status : error instanceof SyntaxError ? 400 : 500;
    const msg = error instanceof SourceError && error.detail
      ? error.detail
      : error instanceof Error && error.message && !error.message.startsWith('chat failed with ')
      ? error.message
      : undefined;
    if (res.headersSent) res.end();
    else json(res, status, {
      error: status === 409
        ? (msg && msg !== 'Agent jeszcze odpowiada.' ? msg : 'Agent jeszcze odpowiada.')
        : status === 404
        ? 'Nie ma takiej rozmowy.'
        : msg
        ? (msg.startsWith('Nie udało się') ? msg : `Nie udało się wykonać operacji czatu: ${msg}`)
        : 'Nie udało się wykonać operacji czatu.',
      detail: msg,
    });
  }
  return true;
}
