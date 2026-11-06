import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { startScenario } from './scenario-runtime.ts';

// Without it the kept-alive test sockets hold the stop of the preview.
const close = { headers: { connection: 'close' } };

describe('DesignLab preview', () => {
  let preview;
  afterAll(async () => { await preview?.stop(); }, 60_000);
  it('is switched on by the scenario preview and reads scenario sources', async () => {
    preview = await startScenario(join(process.cwd(), 'scenarios', 'standard.json'), 'down');
    const env = await (await fetch(new URL('@vite/env', preview.url), close)).text();
    expect(env).toMatch(/__DESIGNLAB__["']?\s*[:=]\s*true/);
    const cezar = await (await fetch(new URL('api/cezar', preview.url), close)).json();
    expect(cezar.tasks.length).toBeGreaterThan(0);
    const mockup = await fetch(new URL('src/designlab/mockups/demo.tsx', preview.url), close);
    expect(mockup.status).toBe(200);
  }, 60_000);
});
