import { isTimeTrigger } from '../src/automation-contract';
import type { Automations } from './automations';
import type { Machina } from './machina';

/**
 * DESK-87: moves the old time automations (`once`, `daily`, `weekly`, closed ones too) to Machina, one thread each. The
 * thread is made first and found again by the old id (`journal.legacy.id`), then the old record is marked moved: a crash
 * between the two, a retry or a restart makes nothing twice. Runs only where Machina exists (the active, unlocked Fila);
 * the old automations stop starting time runs there at once, so a time is never done by both.
 */
export async function moveTimeAutomations({ automations, machina }: { automations: Automations; machina: Machina }) {
  if (automations.error()) throw new Error(automations.error());
  const time = (await automations.list()).filter(a => isTimeTrigger(a.trigger));
  const moved = await machina.adopt(time);
  for (const item of moved) await automations.markMoved(item.id, item.thread);
  return moved;
}

/** Tries the move at start and again every minute until it went through once (a locked or unreadable store waits). */
export function startTimeMove(input: { automations: Automations; machina: Machina; log?: (line: string) => void }) {
  const log = input.log ?? (line => console.warn(`[machina] ${line}`));
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const attempt = async () => {
    if (running) return;
    running = true;
    try {
      const moved = await moveTimeAutomations(input);
      const made = moved.filter(item => item.created).length;
      if (made) log(`przeniesiono ${made} automatów czasowych do Machiny.`);
      if (timer) clearInterval(timer);
      timer = undefined;
    } catch (error) { log(`przeniesienie automatów czasowych się nie udało (ponowię): ${error instanceof Error ? error.message : 'błąd'}`); }
    finally { running = false; }
  };
  timer = setInterval(() => { void attempt(); }, 60_000);
  timer.unref();
  void attempt();
  return () => { if (timer) clearInterval(timer); };
}
