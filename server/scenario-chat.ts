import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentChat, type AgentProcess, type ChatService, type Launcher } from './agent-chat';
import { createChatHub } from './chat-hub';
import { createHermesClient } from './hermes-api';
import { createHermesChat } from './hermes-chat';
import { startMockHermes, type MockHermesOptions } from './hermes-mock';

/**
 * An agent that answers from a script instead of `agy`, with the same events `agy` prints (a tool step, then the answer
 * word by word). The scenario mode and the screenshots use it, so the chat can be tried without spending any limit.
 */
export function scriptedAgent(): Launcher {
  return (): AgentProcess => {
    let print: (line: string) => void = () => {};
    let leave: (reason: string | null) => void = () => {};
    let closed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, work: () => void) => { const t = setTimeout(() => { timers.delete(t); if (!closed) work(); }, ms); timers.add(t); };
    const emit = (event: unknown) => print(JSON.stringify(event));
    const conversation = randomUUID();
    let index = 0, greeted = false;
    const step = (i: number, type: string, state: 'ACTIVE' | 'DONE', extra: object = {}) =>
      emit({ event: 'step_update', step_update: { conversation_id: conversation, step_index: i, state, step_type: type, ...extra } });
    const finish = (reason: string | null) => { if (closed) return; closed = true; for (const t of timers) clearTimeout(t); timers.clear(); queueMicrotask(() => leave(reason)); };
    return {
      write(input) {
        const prompt = (JSON.parse(input) as { message: { content: string } }).message.content;
        const picked = [...prompt.matchAll(/^\d+\. ([^:\n]+): (.+)$/gm)].map(m => `${m[1]}: „${m[2]}”`);
        const answer = picked.length
          ? `Widzę ${picked.length === 1 ? 'jeden wskazany element' : `${picked.length} wskazane elementy`}:\n\n${picked.map(p => `- ${p}`).join('\n')}\n\nTo **tryb scenariusza**: odpowiadam z gotowego skryptu, bez agy.`
          : 'To **tryb scenariusza**: odpowiadam z gotowego skryptu, bez agy. Wskaż element na pulpicie, a pokażę, co do mnie dotarło.';
        const base = index;
        index += 3;
        if (!greeted) { greeted = true; emit({ event: 'init', conversation_id: conversation, init: { cwd: 'C:\\agent', tools: ['run_command'], permission_mode: 'request-review' } }); }
        step(base, 'user_input', 'DONE');
        const params = { CommandLine: 'Get-Content kontekst.txt' };
        later(350, () => step(base + 1, 'tool', 'ACTIVE', { tool_name: 'run_command', tool_info: { name: 'run_command', parameters: params } }));
        later(1100, () => step(base + 1, 'tool', 'DONE', { tool_name: 'run_command', tool_info: { name: 'run_command', parameters: params, output: picked.length ? picked.join('\n') : '(brak wskazanych elementów)' } }));
        (answer.match(/\S+\s*/g) ?? []).forEach((word, n) => later(1300 + n * 70, () => step(base + 2, 'agent_response', 'ACTIVE', { text_delta: word })));
        const end = 1300 + (answer.match(/\S+\s*/g)?.length ?? 0) * 70 + 100;
        later(end, () => step(base + 2, 'agent_response', 'DONE', { text_delta: '\n' }));
        later(end + 50, () => emit({ event: 'result', result: { conversation_id: conversation, status: 'SUCCESS', response: `${answer}\n`, duration_seconds: 2, num_turns: 1 } }));
      },
      end() { finish(null); },
      kill() { finish('killed'); },
      onLine(callback) { print = callback; },
      onExit(callback) { leave = callback; },
    };
  };
}

/**
 * The chat service of the scenario mode: the real services and storage of both engines, a throwaway directory, agy
 * answering from a script and Hermes from a stand-in API server on a free loopback port. `hermes: 'down'` shows the
 * window as it is when Hermes is not running.
 */
export async function createScenarioChat(options: { hermes?: 'up' | 'down'; toolScript?: MockHermesOptions['toolScript'] } = {}): Promise<ChatService & { dispose(): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'desk-panel-scenario-chat-'));
  const mock = await startMockHermes({ stepMs: 60, toolScript: options.toolScript });
  if (options.hermes === 'down') mock.setDown(true);
  const agy = createAgentChat({ dir, launch: scriptedAgent() });
  const hermes = createHermesChat({ dir, client: createHermesClient({ url: mock.url }) });
  const chat = createChatHub({ dir, engines: { hermes, agy } });
  let disposing: Promise<void> | undefined;
  return Object.assign(chat, {
    dispose() {
      chat.close();
      return disposing ??= chat.drain().finally(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });
    },
  });
}
