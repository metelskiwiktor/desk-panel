// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatSendSchema, type ChatAutomationInput } from '../src/chat-contract';
import { ChatError, createAgentChat, type AgentProcess, type ChatService, type Launcher } from './agent-chat';
import { automationsEnabled, createChatAutomation } from './chat-automation';
import { createCockpit, type Cockpit } from './cockpit';
import type { PanelSources } from './sources';
import type { FinishedTask } from '../src/cezar-contract';

const CHAT = '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d';
const TASK = 'desk-panel/f2c9501e-7121-4746-8fc8-19ee3ee9d968';
const PR = 'https://github.com/metelskiwiktor/desk-panel/pull/42';
const CEZAR = 'http://127.0.0.1:4321/';

let dir: string;
let file: string;
let services: ChatService[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'desk-automation-'));
  file = join(dir, 'cockpit.json');
  services = [];
});
afterEach(async () => {
  for (const service of services) { service.close(); await service.drain().catch(() => {}); }
  rmSync(dir, { recursive: true, force: true });
});

const finished = (over: Partial<FinishedTask> = {}): FinishedTask => ({
  id: TASK, title: 'Paski stref', project: 'desk-panel', status: 'done', checkedAt: 1, completedAt: 2,
  description: 'Paski stref', sourceUrl: 'http://127.0.0.1:4321/p/desk-panel/tasks/f2c9501e', ...over,
});
const active = (status: string) => [{ id: TASK, title: 'Paski stref', status } as never];

function fakeSources(raw: Record<string, unknown> = {}) {
  return {
    cezarRun: async () => ({ id: 'f2c9501e', title: 'Paski stref', titleSummary: 'Paski stref', status: 'done',
      steps: [{ id: 'implement', name: 'Implement (LF)', status: 'done' }, { id: 'verify', name: 'Verify', status: 'done' }],
      pullRequestUrl: PR, ...raw }),
    cezarCreateRun: async () => ({ ok: true, id: TASK, project: 'desk-panel', url: `${CEZAR}p/desk-panel/tasks/f2c9501e`, workflow: 'desk-panel-task' }),
    todoAction: async () => ({ ok: true }),
  } as unknown as Pick<PanelSources, 'cezarRun' | 'cezarCreateRun' | 'todoAction'>;
}

async function setup(raw: Record<string, unknown> = {}) {
  const sources = fakeSources(raw);
  const cockpit = createCockpit({ sources: sources as unknown as PanelSources, file, cezarUrl: CEZAR });
  await cockpit.dispatch(CHAT, { toolCallId: 'card-1', decision: 'dispatch', title: 'Paski stref', prompt: 'Task: paski' });
  return { sources, cockpit };
}

function fakeChat() {
  const sent: { id: string; input: ChatAutomationInput }[] = [];
  let busy = false;
  const service = {
    async sendAutomation(id: string, input: ChatAutomationInput) {
      if (busy) throw new ChatError(409, 'Agent jeszcze odpowiada.');
      sent.push({ id, input });
    },
  } as unknown as ChatService;
  return { service, sent, setBusy: (value: boolean) => { busy = value; } };
}

const observerFor = (chat: ChatService, cockpit: Cockpit, sources: ReturnType<typeof fakeSources>, enabled = true) =>
  createChatAutomation({ chat, cockpit, sources, enabled, log: () => {} });

describe('a finished Cezar task in the chat that dispatched it', () => {
  it('sends exactly one automation turn with its id, title, state, step, error and PR', async () => {
    const { sources, cockpit } = await setup({ status: 'failed', error: 'verify: 1 test failed' });
    const chat = fakeChat();
    const observer = observerFor(chat.service, cockpit, sources);

    await observer.active(active('running'));
    expect(chat.sent).toHaveLength(0);
    await observer.finished([finished({ status: 'failed' })]);
    await observer.finished([finished({ status: 'failed' })]);

    expect(chat.sent).toHaveLength(1);
    expect(chat.sent[0].id).toBe(CHAT);
    expect(chat.sent[0].input.automation).toEqual({ source: 'cezar', reason: 'task Cezara nieudany' });
    expect(chat.sent[0].input.text).toContain(TASK);
    expect(chat.sent[0].input.text).toContain('Paski stref');
    expect(chat.sent[0].input.text).toContain('Stan: nieudane');
    expect(chat.sent[0].input.text).toContain('Krok: Verify');
    expect(chat.sent[0].input.text).toContain('Błąd: verify: 1 test failed');
    expect(chat.sent[0].input.text).toContain(`PR: ${PR}`);
    expect(chat.sent[0].input.text).toContain('Niczego nie zlecaj');
  });

  it('reports a task waiting for the user once, also after a restart', async () => {
    const { sources, cockpit } = await setup();
    const chat = fakeChat();
    const observer = observerFor(chat.service, cockpit, sources);
    await observer.active(active('needs-input'));
    expect(chat.sent).toHaveLength(1);
    expect(chat.sent[0].input.automation.reason).toBe('task Cezara czeka na odpowiedź');

    // A restart reads the same waiting task and the kept marker: no second turn.
    const restartedCockpit = createCockpit({ sources: sources as unknown as PanelSources, file, cezarUrl: CEZAR });
    const restartedChat = fakeChat();
    const restarted = observerFor(restartedChat.service, restartedCockpit, sources);
    await restarted.active(active('needs-input'));
    expect(restartedChat.sent).toHaveLength(0);
  });

  it('does not resend a finish after a restart, even though the task is active again', async () => {
    const { sources, cockpit } = await setup();
    const chat = fakeChat();
    const observer = observerFor(chat.service, cockpit, sources);
    await observer.active(active('running'));
    await observer.finished([finished()]);
    expect(chat.sent).toHaveLength(1);

    const restartedCockpit = createCockpit({ sources: sources as unknown as PanelSources, file, cezarUrl: CEZAR });
    const restartedChat = fakeChat();
    const restarted = observerFor(restartedChat.service, restartedCockpit, sources);
    await restarted.active(active('running'));
    await restarted.finished([finished()]);
    expect(restartedChat.sent).toHaveLength(0);
  });

  it('waits while the conversation is in a turn, then sends on the next read', async () => {
    const { sources, cockpit } = await setup();
    const chat = fakeChat();
    const observer = observerFor(chat.service, cockpit, sources);
    await observer.active(active('running'));

    chat.setBusy(true);
    await observer.finished([finished()]);
    expect(chat.sent).toHaveLength(0);

    chat.setBusy(false);
    await observer.finished([finished()]);
    expect(chat.sent).toHaveLength(1);
  });

  it('sends nothing when automations are off, when no task was dispatched, or after an old finish', async () => {
    const { sources, cockpit } = await setup();
    const off = fakeChat();
    await observerFor(off.service, cockpit, sources, false).active(active('running'));
    await observerFor(off.service, cockpit, sources, false).finished([finished()]);
    expect(off.sent).toHaveLength(0);

    const noDispatch = createCockpit({ sources: sources as unknown as PanelSources, file: join(dir, 'empty.json'), cezarUrl: CEZAR });
    const empty = fakeChat();
    const observer = observerFor(empty.service, noDispatch, sources);
    await observer.active(active('running'));
    await observer.finished([finished()]);
    expect(empty.sent).toHaveLength(0);

    // Finished before the panel saw it active: not reported (that is what keeps a restart from flooding old tasks).
    const old = fakeChat();
    const oldObserver = observerFor(old.service, cockpit, sources);
    await oldObserver.finished([finished()]);
    expect(old.sent).toHaveLength(0);
  });
});

describe('the automation marker', () => {
  it('is never accepted from an HTTP message, and the stored turn keeps it', async () => {
    expect(chatSendSchema.safeParse({ text: 'x', automation: { source: 'cezar', reason: 'r' } }).success).toBe(false);

    class Scripted implements AgentProcess {
      written: string[] = [];
      private line?: (line: string) => void;
      write(line: string) {
        this.written.push(line);
        const content = JSON.parse(line).message.content;
        setTimeout(() => {
          this.line?.(JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c1', step_index: 0, state: 'DONE', step_type: 'user_input' } }));
          this.line?.(JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: content.includes('Automatyka') ? 'Podsumowanie gotowe.' : 'Odpowiedź.' } }));
        }, 0);
      }
      end() {}
      kill() {}
      onLine(callback: (line: string) => void) { this.line = callback; }
      onExit() {}
    }
    const agents: Scripted[] = [];
    const launch: Launcher = () => { const agent = new Scripted(); agents.push(agent); return agent; };
    const service = createAgentChat({ dir, launch, idleMs: 60_000 });
    services.push(service);
    const { id } = await service.create({ text: 'Pierwsze pytanie' });
    await vi.waitFor(async () => expect((await service.get(id)).running).toBe(false));

    await service.sendAutomation!(id, { text: 'Task Cezara: x\nStan: zakończone', automation: { source: 'cezar', reason: 'task Cezara zakończony' } });
    await vi.waitFor(async () => expect((await service.get(id)).running).toBe(false));
    const chat = await service.get(id);
    expect(chat.items[2]).toMatchObject({ role: 'user', text: 'Task Cezara: x\nStan: zakończone', automation: { source: 'cezar', reason: 'task Cezara zakończony' } });
    const prompt = JSON.parse(agents[0].written[1]).message.content as string;
    expect(prompt).toContain('[Automatyka · Cezar] task Cezara zakończony\nTask Cezara: x');
  });

  it('reads the switch from the environment', () => {
    expect(automationsEnabled({})).toBe(true);
    for (const value of ['0', 'false', 'no', 'off', ' OFF ']) expect(automationsEnabled({ DESK_AUTOMATIONS: value })).toBe(false);
    expect(automationsEnabled({ DESK_AUTOMATIONS: '1' })).toBe(true);
  });
});
