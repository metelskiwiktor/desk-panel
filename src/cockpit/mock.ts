import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextItem } from '../chat-contract';
import {
  DISPATCH, RECON, WATCH,
  type CockpitMessage, type CockpitPart, type CockpitSource, type CockpitState, type DispatchArgs, type DispatchResult, type ReconArgs, type WatchArgs,
} from './types';

/**
 * A scripted Wektor for trying and photographing the cockpit without Hermes or Cezar (`?cockpit=mock`). Nothing here
 * talks to the server: every message, task, PR and subtask is made up and lives only in this window.
 *
 * - `@Zaimplementuj zadanie` (or a message about implementing) → recon card, plan, and the approval card.
 * - "Zleć na Cezarze" on it → a made-up Cezar task the agent watches step by step, then its PR and CI checks.
 * - `@Nasłuchuj Cezara` → watches the same made-up task straight away.
 * - Anything else → a short answer saying what the mock can show.
 */

const RECON_STEPS = ['Przeszukuję src/ i server/', 'Sprawdzam scenariusze', 'Ustalam typ zadania', 'Piszę prompt dla executora'];
const RECON_FILES = [
  { path: 'src/ChatWindow.tsx', note: 'okno czatu, układ dwóch kolumn' },
  { path: 'src/cockpit/cards.tsx', note: 'karty skilli w wątku' },
  { path: 'src/chat-contract.ts', note: 'lista skillów @' },
  { path: 'scenarios/standard.json', note: 'dane do zrzutów ekranu' },
];
const WATCH_STEPS = ['Worktree utworzony', 'Instalacja zależności', 'Implementacja', 'Testy i build', 'Zrzuty ekranu', 'Pull request'];
const TASK_ID = 'cz-7f3a91';
const PROMPT = [
  'Task: Show the Cezar task status chip in the chat cockpit header.',
  'Type: UI',
  'Scenario for screenshots: standard (page: pulpit, open: chat)',
  'Relevant files (from recon):',
  '- src/ChatWindow.tsx',
  '- src/cockpit/Cockpit.tsx',
  'Acceptance criteria:',
  '- [ ] The header shows RUNNING / REVIEW / DONE of the watched task',
  '- [ ] Screenshots before/after on the standard scenario',
].join('\n');

const IDLE: CockpitState = { watching: false, subtasks: [] };
const SUBTASKS = [
  { id: 't-0000a001', title: 'Chip statusu w nagłówku kokpitu', done: false },
  { id: 't-0000a002', title: 'Kolory RUNNING / REVIEW / DONE', done: false },
  { id: 't-0000a003', title: 'Zrzuty przed i po (standard)', done: false },
];

const wantsImplement = (text: string, context: ContextItem[]) => context.some(c => c.kind === 'skill' && c.id === 'zaimplementuj-zadanie') || /zaimplementuj|zleć|zlec/i.test(text);
const wantsWatch = (text: string, context: ContextItem[]) => context.some(c => c.kind === 'skill' && c.id === 'nasluchuj-cezara') || /nasłuchuj|nasluchuj|obserwuj/i.test(text);

export function useMockCockpit({ hermesDown = false, speed = 1 }: { hermesDown?: boolean; speed?: number } = {}): CockpitSource {
  const [messages, setMessages] = useState<CockpitMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [hermes, setHermes] = useState(() => ({ up: !hermesDown, checking: false, error: hermesDown ? 'Serwer API Hermesa nie odpowiada (127.0.0.1:8642).' : undefined }));
  const [cockpit, setCockpit] = useState<CockpitState>(IDLE);
  const timers = useRef<number[]>([]);
  const seq = useRef(0);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const id = (prefix: string) => `${prefix}-${++seq.current}`;
  /** Runs the steps one after another, each `ms` after the previous one. */
  const play = (steps: [ms: number, run: () => void][]) => {
    let total = 0;
    for (const [ms, run] of steps) { total += ms * speed; timers.current.push(window.setTimeout(run, total)); }
  };
  const patch = (messageId: string, fn: (m: CockpitMessage) => CockpitMessage) => setMessages(list => list.map(m => m.id === messageId ? fn(m) : m));
  const addPart = (messageId: string, part: CockpitPart) => patch(messageId, m => ({ ...m, parts: [...m.parts, part] }));
  const say = (messageId: string, text: string) => patch(messageId, m => {
    const last = m.parts.at(-1);
    return last?.type === 'text' ? { ...m, parts: [...m.parts.slice(0, -1), { type: 'text', text: last.text + text }] } : { ...m, parts: [...m.parts, { type: 'text', text }] };
  });
  const tool = <T,>(messageId: string, toolId: string, fn: (args: T, part: Extract<CockpitPart, { type: 'tool' }>) => Partial<Extract<CockpitPart, { type: 'tool' }>>) => patch(messageId, m => ({
    ...m, parts: m.parts.map(p => p.type === 'tool' && p.id === toolId ? { ...p, ...fn(p.args as T, p) } : p),
  }));
  const startAnswer = () => {
    const messageId = id('a');
    setMessages(list => [...list, { id: messageId, role: 'assistant', at: Date.now(), parts: [], status: 'running' }]);
    setRunning(true);
    return messageId;
  };
  const finish = (messageId: string) => { patch(messageId, m => ({ ...m, status: 'done' })); setRunning(false); };

  const implement = () => {
    const a = startAnswer(), recon = id('recon');
    const reconStep = (i: number, extra: Partial<ReconArgs> = {}) => tool<ReconArgs>(a, recon, args => ({
      args: { ...args, ...extra, steps: args.steps.map((s, j) => j === i ? { ...s, done: true } : s) },
      ...(i === RECON_STEPS.length - 1 ? { running: false, result: 'ok' } : {}),
    }));
    play([
      [300, () => say(a, 'Robię szybki rekonesans w repo, tylko do odczytu.')],
      [300, () => addPart(a, { type: 'tool', id: recon, name: RECON, running: true, args: { steps: RECON_STEPS.map(label => ({ label, done: false })), files: [] } satisfies ReconArgs })],
      [600, () => reconStep(0, { files: RECON_FILES.slice(0, 3) })],
      [600, () => reconStep(1, { files: RECON_FILES })],
      [500, () => reconStep(2, { kind: 'UI', scenario: 'standard' })],
      [600, () => reconStep(3, { prompt: PROMPT })],
      [300, () => say(a, '\n\n**Plan**\n\n- chip statusu taska obok tytułu kokpitu,\n')],
      [150, () => say(a, '- kolory z palety panelu,\n')],
      [150, () => say(a, '- zrzuty przed i po na scenariuszu `standard`.')],
      [400, () => {
        addPart(a, { type: 'tool', id: id('dispatch'), name: DISPATCH, running: false, args: { title: 'Chip statusu taska w kokpicie', repo: 'desk-panel', prompt: PROMPT } satisfies DispatchArgs });
        finish(a);
      }],
    ]);
  };

  const watch = (taskId: string) => {
    const a = startAnswer(), w = id('watch');
    const n = WATCH_STEPS.length;
    const set = (i: number, state: 'running' | 'done') => tool<WatchArgs>(a, w, args => ({
      args: { ...args, progress: state === 'done' ? (i + 1) / n : (i + 0.4) / n, steps: args.steps.map((s, j) => j === i ? { ...s, state } : s) },
    }));
    setCockpit(c => ({
      watching: true, since: Date.now(),
      task: { id: taskId, title: 'Chip statusu taska w kokpicie', status: 'QUEUED', repo: 'desk-panel', worktree: `.ai/${taskId}`, tokens: 0, url: `#cezar/${taskId}` },
      list: { id: 'l-0000a000', name: 'Wektor · chip statusu' },
      subtasks: c.subtasks.length ? c.subtasks : SUBTASKS,
    }));
    const task = (patchTask: Partial<NonNullable<CockpitState['task']>>) => setCockpit(c => c.task ? { ...c, task: { ...c.task, ...patchTask } } : c);
    const tick = (i: number) => (done: boolean) => setCockpit(c => ({ ...c, subtasks: c.subtasks.map((s, j) => j === i ? { ...s, done } : s) }));
    play([
      [200, () => {
        say(a, `Nasłuchuję Cezara: **${taskId}**. Dam znać, gdy będzie co przejrzeć.`);
        addPart(a, { type: 'tool', id: w, name: WATCH, running: true, args: { taskId, progress: 0, steps: WATCH_STEPS.map(label => ({ label, state: 'pending' })) } satisfies WatchArgs });
      }],
      ...WATCH_STEPS.flatMap((_, i): [number, () => void][] => [
        [500, () => { set(i, 'running'); task({ status: 'RUNNING', tokens: 4_200 + i * 18_500 }); }],
        [900, () => {
          set(i, 'done');
          if (i === 2) tick(0)(true);
          if (i === 3) tick(1)(true);
          if (i === 4) tick(2)(true);
          if (i === n - 1) setCockpit(c => ({ ...c, pr: { number: 42, title: 'Chip statusu taska w kokpicie', branch: `cez/${taskId}`, url: '#pr/42', checks: [{ name: 'test', state: 'running' }, { name: 'typecheck', state: 'running' }, { name: 'build', state: 'pending' }] } }));
        }],
      ]),
      [900, () => setCockpit(c => c.pr ? { ...c, pr: { ...c.pr, checks: [{ name: 'test', state: 'pass' }, { name: 'typecheck', state: 'pass' }, { name: 'build', state: 'running' }] } } : c)],
      [900, () => {
        setCockpit(c => ({ ...c, watching: false, task: c.task && { ...c.task, status: 'REVIEW', tokens: 118_400 }, pr: c.pr && { ...c.pr, checks: c.pr.checks.map(x => ({ ...x, state: 'pass' })) } }));
        tool<WatchArgs>(a, w, args => ({ running: false, result: 'review', args: { ...args, progress: 1 } }));
        say(a, '\n\nGotowe do przeglądu: **PR #42**, wszystkie checki CI przeszły.');
        finish(a);
      }],
    ]);
  };

  const send = useCallback(async (text: string, context: ContextItem[]) => {
    if (!hermes.up || running) return false;
    setMessages(list => [...list, { id: id('u'), role: 'user', at: Date.now(), parts: [{ type: 'text', text }], context, status: 'done' }]);
    if (wantsImplement(text, context)) implement();
    else if (wantsWatch(text, context)) watch(TASK_ID);
    else {
      const a = startAnswer();
      play([
        [400, () => say(a, 'To makieta Wektora, nic nie idzie do Hermesa. ')],
        [300, () => say(a, 'Wpisz `@` i wybierz **Zaimplementuj zadanie**, żeby zobaczyć rekonesans i kartę zgody, albo **Nasłuchuj Cezara** dla podglądu taska.')],
        [200, () => finish(a)],
      ]);
    }
    return true;
  }, [hermes.up, running]);

  const respond = useCallback((toolCallId: string, response: unknown) => {
    const r = response as { decision: 'dispatch' | 'reject'; prompt?: string };
    const owner = messages.find(m => m.parts.some(p => p.type === 'tool' && p.id === toolCallId && p.name === DISPATCH));
    if (!owner || running) return;
    const result: DispatchResult = r.decision === 'dispatch' ? { decision: 'dispatched', taskId: TASK_ID, prompt: r.prompt ?? PROMPT } : { decision: 'rejected' };
    tool(owner.id, toolCallId, () => ({ result }));
    if (result.decision === 'dispatched') watch(TASK_ID);
    else {
      const a = startAnswer();
      play([[300, () => { say(a, 'Odrzucone. Nic nie poszło do Cezara.'); finish(a); }]]);
    }
  }, [messages, running]);

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setMessages(list => list.map(m => m.status !== 'running' ? m : { ...m, status: 'stopped', parts: m.parts.map(p => p.type === 'tool' && p.running ? { ...p, running: false } : p) }));
    setCockpit(c => ({ ...c, watching: false }));
    setRunning(false);
  }, []);

  const retry = useCallback(() => {
    setHermes(h => ({ ...h, checking: true }));
    timers.current.push(window.setTimeout(() => setHermes({ up: true, checking: false, error: undefined }), 800 * speed));
  }, [speed]);

  return {
    mode: 'mock', title: messages.length ? 'Makieta · chip statusu' : 'Nowy czat', messages, running, hermes, unavailable: false, loading: false,
    error: '', clearError: () => {},
    send, stop, retry, respond,
    chats: [], activeId: null,
    open: () => { stop(); setMessages([]); setCockpit(IDLE); },
    remove: () => {},
    cockpit,
    toggleSubtask: (subtaskId: string) => setCockpit(c => ({ ...c, subtasks: c.subtasks.map(s => s.id === subtaskId ? { ...s, done: !s.done } : s) })),
  };
}
