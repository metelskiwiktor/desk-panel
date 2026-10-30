import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createAgyNamer } from './chat-title';
import type { AgentProcess, Launcher } from './agent-chat';

it('launches a single isolated stream-json run and cleans its result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'title-test-'));
  let args: string[] = [], cwd = '', prompt = '';
  const launch: Launcher = (a, c) => {
    args = a; cwd = c; let line: (s: string) => void = () => {}; let exit: (s: string | null) => void = () => {};
    return { onLine: f => { line = f; }, onExit: f => { exit = f; }, write: s => { prompt = s; }, kill() {}, end() { queueMicrotask(() => { line(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '„Jeden dwa trzy cztery pięć sześć siedem.”' } })); exit(null); }); } };
  };
  expect(await createAgyNamer({ dir, launch })('pytanie', 'odpowiedź')).toBe('Jeden dwa trzy cztery pięć sześć');
  expect(args).toEqual(['--output-format', 'stream-json', '--input-format', 'stream-json', '-p', '']);
  expect(cwd.startsWith(path.join(dir, 'chat-title'))).toBe(true);
  expect(prompt).toContain('Nie używaj narzędzi'); expect(prompt).toContain('pytanie'); expect(prompt).toContain('odpowiedź');
  await rm(dir, { recursive: true, force: true });
});

it('returns null on launch, exit, empty answer and timeout', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'title-test-'));
  expect(await createAgyNamer({ dir, launch: () => { throw Error('missing'); } })('a', 'b')).toBeNull();
  const fake = (reason: string | null, result = ''): Launcher => () => {
    let line: (s: string) => void = () => {}; let exit: (s: string | null) => void = () => {};
    return { onLine: f => { line = f; }, onExit: f => { exit = f; }, write() {}, kill() {}, end() { queueMicrotask(() => { if (result) line(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: result } })); exit(reason); }); } } as AgentProcess;
  };
  expect(await createAgyNamer({ dir, launch: fake('exit', 'Tytuł') })('a', 'b')).toBeNull();
  expect(await createAgyNamer({ dir, launch: fake(null) })('a', 'b')).toBeNull();
  const kill = vi.fn();
  expect(await createAgyNamer({ dir, timeoutMs: 5, launch: () => ({ onLine() {}, onExit() {}, write() {}, end() {}, kill }) })('a', 'b')).toBeNull();
  expect(kill).toHaveBeenCalledOnce();
  await rm(dir, { recursive: true, force: true });
});
