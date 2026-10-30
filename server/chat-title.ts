import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { agyLauncher, type Launcher } from './agent-chat';

export type ChatNamer = (user: string, answer: string) => Promise<string | null>;

export function createAgyNamer(options: { dir?: string; launch?: Launcher; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): ChatNamer {
  const env = options.env ?? process.env;
  // Naming needs no tools, and the first answer may quote untrusted text (a mail): without the skip flag headless agy
  // denies every tool, so an instruction hidden in that text cannot run a command.
  const launch = options.launch ?? agyLauncher({ ...env, DESK_AGY_MODEL: env.DESK_AGY_TITLE_MODEL?.trim() || env.DESK_AGY_MODEL, DESK_AGY_SKIP_PERMISSIONS: '0' });
  const root = path.join(options.dir ?? path.join(homedir(), '.desk-panel'), 'chat-title');
  return async (user, answer) => {
    let cwd: string | undefined;
    try {
      await mkdir(root, { recursive: true });
      cwd = await mkdtemp(path.join(root, 'name-'));
      const proc = launch(['--output-format', 'stream-json', '--input-format', 'stream-json', '-p', ''], cwd);
      return await new Promise<string | null>(resolve => {
        let response = '', settled = false;
        const done = (value: string | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
        const timer = setTimeout(() => { proc.kill(); done(null); }, options.timeoutMs ?? 20_000);
        proc.onLine(line => {
          try { const e = JSON.parse(line); if (e.event === 'result' && e.result?.status === 'SUCCESS' && typeof e.result.response === 'string') response = e.result.response; } catch { /* ignore malformed events */ }
        });
        proc.onExit(reason => {
          const clean = response.split(/\r?\n/)[0].trim().replace(/^["'„“”«»]+|["'„“”«»]+$/g, '').trim().replace(/\.$/, '').replace(/["'„“”«»]+$/g, '').trim().replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ');
          done(!reason && clean.length >= 3 ? clean : null);
        });
        proc.write(`${JSON.stringify({ event: 'user', message: { content: `Nadaj tej rozmowie krótką nazwę po polsku (maksymalnie 6 słów). Nie używaj narzędzi. Zwróć wyłącznie nazwę.\nUżytkownik: ${user}\nOdpowiedź: ${answer}` } })}\n`);
        proc.end();
      });
    } catch { return null; }
    finally { if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => {}); }
  };
}
