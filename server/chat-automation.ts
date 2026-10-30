import { ChatError, type ChatService } from './agent-chat';
import type { Cockpit, DispatchedTask } from './cockpit';
import type { PanelSources } from './sources';
import type { CezarSnapshot, FinishedTask } from '../src/cezar-contract';

/**
 * The panel's own turns in a conversation: a message the user sends starts a turn, and so does an automation. An
 * automation turn is always marked (`automation` on the message, "Automatyka · Cezar" in the window), says why the panel
 * wrote it, and reaches the service log. `DESK_AUTOMATIONS=0` (or false/no/off) turns all of them off; they are on by default.
 *
 * The first automation watches Cezar. A task dispatched from a conversation is reported back to that conversation once,
 * when it starts waiting for the user or finishes. The events come from the Cezar reads the panel already makes: active
 * tasks from the snapshot, finished ones from `onFinished`. Nothing polls Cezar for this, and a restart does not flood
 * old conversations: only tasks this process saw as active after it started are reported, and every handled event
 * (`taskId|state`) is kept in `cockpit.json`, so the next start does not send it again.
 */

export type AutomationState = 'input' | 'done' | 'failed';
interface AutomationEvent { chatId: string; taskId: string; state: AutomationState; title?: string; prUrl?: string }

export interface ChatAutomationObserver {
  /** Active tasks of the latest Cezar read: a dispatched task waiting for the user is reported once. */
  active(tasks: readonly CezarSnapshot['tasks'][number][]): Promise<void>;
  /** Finished tasks of the latest Cezar read: a dispatched task done or failed is reported once, if it was seen active. */
  finished(tasks: readonly FinishedTask[]): Promise<void>;
}

export function automationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(0|false|no|off)$/i.test(env.DESK_AUTOMATIONS?.trim() ?? '');
}

const STATUS: Record<AutomationState, string> = {
  input: 'czeka na odpowiedź użytkownika',
  done: 'zakończone',
  failed: 'nieudane',
};
const REASON: Record<AutomationState, string> = {
  input: 'task Cezara czeka na odpowiedź',
  done: 'task Cezara zakończony',
  failed: 'task Cezara nieudany',
};

/** A step name without its parenthetical detail, as the cockpit shows it. */
const stepLabel = (step: Record<string, any>): string | undefined => {
  const name = step.name ?? step.id;
  return typeof name === 'string' && name ? name.replace(/\s*\([^)]*\)\s*$/, '').slice(0, 80) : undefined;
};

function stepOf(raw: Record<string, any> | null): string | undefined {
  if (!raw) return undefined;
  const steps = (Array.isArray(raw.steps) ? raw.steps : []) as Record<string, any>[];
  const current = raw.currentStepId ? steps.find(s => s.id === raw.currentStepId) : undefined;
  const failed = [...steps].reverse().find(s => String(s.status ?? '').toLowerCase() === 'failed');
  const running = [...steps].reverse().find(s => String(s.status ?? '').toLowerCase() === 'running');
  const chosen = current ?? failed ?? running ?? steps.at(-1);
  return chosen && stepLabel(chosen);
}

function errorOf(raw: Record<string, any> | null): string | undefined {
  if (!raw) return undefined;
  const direct = typeof raw.error === 'string' && raw.error ? raw.error : undefined;
  const steps = (Array.isArray(raw.steps) ? raw.steps : []) as Record<string, any>[];
  const stepError = [...steps].reverse().find(s => typeof s.error === 'string' && s.error)?.error;
  const text = direct ?? stepError;
  return typeof text === 'string' && text ? text.slice(0, 500) : undefined;
}

export function createChatAutomation({ chat, cockpit, sources, enabled = true, now = Date.now, log }: {
  chat: ChatService;
  cockpit: Pick<Cockpit, 'dispatched' | 'automationReported' | 'markAutomationReported'>;
  sources: Pick<PanelSources, 'cezarRun'>;
  enabled?: boolean;
  now?: () => number;
  log?: (line: string) => void;
}): ChatAutomationObserver {
  const writeLog = log ?? (line => console.log(`${new Date(now()).toISOString()} automatyka: ${line}`));
  /** This process saw the task active: only then is its finish a fact worth reporting (no flood of old finished tasks). */
  const seenActive = new Set<string>();
  /** Events found but not handled yet (the conversation was in the middle of a turn). */
  const pending = new Map<string, AutomationEvent>();
  const sending = new Set<string>();
  const busyLogged = new Set<string>();
  let flushing: Promise<void> = Promise.resolve();

  const dispatched = (): Map<string, DispatchedTask> => {
    const out = new Map<string, DispatchedTask>();
    for (const dispatch of cockpit.dispatched()) out.set(dispatch.taskId, dispatch);
    return out;
  };
  const keyOf = (event: AutomationEvent) => `${event.taskId}|${event.state}`;

  const queue = (event: AutomationEvent) => {
    const key = keyOf(event);
    if (cockpit.automationReported(event.chatId, event.taskId, event.state)) return;
    if (pending.has(key)) return;
    pending.set(key, event);
  };

  async function facts(event: AutomationEvent): Promise<{ text: string; reason: string }> {
    const raw = sources.cezarRun ? await sources.cezarRun(event.taskId).catch(() => null) : null;
    const title = String(raw?.titleSummary || raw?.title || event.title || event.taskId).slice(0, 200);
    const prUrl = raw?.pullRequestUrl || event.prUrl;
    const lines = [
      `Powód: ${REASON[event.state]} (task zlecony z tej rozmowy).`,
      `Task Cezara: ${event.taskId} — ${title}`,
      `Stan: ${STATUS[event.state]}`,
    ];
    const step = stepOf(raw);
    if (step) lines.push(`Krok: ${step}`);
    if (event.state === 'input' && raw?.question) lines.push(`Pytanie: ${String(raw.question).slice(0, 300)}`);
    const error = errorOf(raw);
    if (event.state === 'failed' && error) lines.push(`Błąd: ${error}`);
    if (prUrl) lines.push(`PR: ${prUrl}`);
    lines.push('Przejrzyj wynik i krótko go podsumuj; zaproponuj jeden następny krok. Niczego nie zlecaj ani nie zapisuj bez karty zgody i kliknięcia użytkownika.');
    return { text: lines.join('\n'), reason: REASON[event.state] };
  }

  async function run(): Promise<void> {
    for (const [key, event] of [...pending]) {
      if (!enabled) { pending.delete(key); continue; }
      if (cockpit.automationReported(event.chatId, event.taskId, event.state)) { pending.delete(key); continue; }
      if (sending.has(key)) continue;
      if (!chat.sendAutomation) {
        cockpit.markAutomationReported(event.chatId, event.taskId, event.state);
        pending.delete(key);
        writeLog(`pominięto (${event.taskId}, ${event.state}): ten silnik nie przyjmuje tur automatyki.`);
        continue;
      }
      sending.add(key);
      try {
        const { text, reason } = await facts(event);
        await chat.sendAutomation(event.chatId, { text, automation: { source: 'cezar', reason } });
        cockpit.markAutomationReported(event.chatId, event.taskId, event.state);
        pending.delete(key);
        writeLog(`wysłano turę automatyki do rozmowy ${event.chatId} (${event.taskId}, ${event.state}).`);
      } catch (error) {
        if (error instanceof ChatError && error.status === 409) {
          if (!busyLogged.has(key)) {
            busyLogged.add(key);
            writeLog(`rozmowa ${event.chatId} jest w trakcie tury; ${event.taskId} (${event.state}) wyślę przy następnym odczycie.`);
          }
          continue;
        }
        cockpit.markAutomationReported(event.chatId, event.taskId, event.state);
        pending.delete(key);
        const why = error instanceof Error ? error.message : String(error);
        writeLog(`pominięto (${event.taskId}, ${event.state}): ${why}`);
      } finally {
        sending.delete(key);
      }
    }
  }

  const flush = () => {
    flushing = flushing.then(run).catch(error => writeLog(`błąd: ${error instanceof Error ? error.message : String(error)}`));
    return flushing;
  };

  return {
    async active(tasks) {
      if (!enabled) return;
      const byTask = dispatched();
      for (const task of tasks) {
        const dispatch = byTask.get(task.id);
        if (!dispatch) continue;
        seenActive.add(task.id);
        if (task.status === 'needs-input') queue({ chatId: dispatch.chatId, taskId: task.id, state: 'input', title: task.title });
      }
      await flush();
    },

    async finished(tasks) {
      if (!enabled) return;
      const byTask = dispatched();
      for (const task of tasks) {
        const dispatch = byTask.get(task.id);
        if (!dispatch || !seenActive.has(task.id)) continue;
        if (task.status !== 'done' && task.status !== 'failed') continue;
        queue({ chatId: dispatch.chatId, taskId: task.id, state: task.status, title: task.title, ...(task.pullRequestUrl ? { prUrl: task.pullRequestUrl } : {}) });
      }
      await flush();
    },
  };
}
