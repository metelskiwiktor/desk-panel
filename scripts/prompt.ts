import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';

/** Terminal prompts where the answer to a hidden one is never echoed. The prompt text goes through readline, which redraws the line. */
export function createPrompter() {
  const state = { muted: false };
  const output = new Writable({ write(chunk, encoding, done) { if (!state.muted) process.stdout.write(chunk, encoding); done(); } });
  const rl: Interface = createInterface({ input: process.stdin, output, terminal: true });
  return {
    ask: (label: string, hidden = false) => new Promise<string>(resolve => {
      rl.question(label, answer => { state.muted = false; if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
      state.muted = hidden;
    }),
    close: () => rl.close(),
  };
}
