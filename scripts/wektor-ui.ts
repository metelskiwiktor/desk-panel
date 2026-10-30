import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser } from 'playwright';
import { z } from 'zod';
import { devices } from '../src/devices';
import { startScenario, launchChromium, selectViewports } from './scenario-runtime';
import { withPageErrors } from './browser-checks';
import { wektorFlows } from './wektor-ui-flows';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  device: { type: 'string', default: Object.keys(devices)[0] }, scale: { type: 'string', default: 'primary' },
  out: { type: 'string', default: 'output/wektor-ui' }, latency: { type: 'string', default: '240' }, help: { type: 'boolean', default: false },
} });
const names = Object.keys(wektorFlows) as (keyof typeof wektorFlows)[];
if (values.help) console.log(`just wektor-ui [all|${names.join('|')}] [--device ID|all] [--scale primary|all|N] [--latency MS] [--out DIR]`);
else await run().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });

async function run() {
  const name = positionals[0] ?? 'all';
  assert.ok(positionals.length <= 1 && (name === 'all' || names.includes(name as keyof typeof wektorFlows)), `Nieznany przypadek ${positionals.join(' ')}. Dostępne: all, ${names.join(', ')}.`);
  const latency = Number(values.latency);
  assert.ok(Number.isInteger(latency) && latency >= 0 && latency <= 5000, '--latency musi być całkowitą liczbą 0–5000 ms.');
  const targets = selectViewports(values.device, values.scale), selected = name === 'all' ? names : [name as keyof typeof wektorFlows];
  const fixtures = z.array(z.object({ title: z.string().min(1).max(80), message: z.string().min(1), doctor: z.string().min(1) }).strict()).length(2).parse(JSON.parse(readFileSync(new URL('../scenarios/wektor-ui/conversations.json', import.meta.url), 'utf8')));
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  const runtime = await startScenario(resolve('scenarios/wizyty.json'));
  let browser: Browser | undefined, stopping: Promise<void> | undefined;
  const cleanup = () => stopping ??= (async () => { try { await browser?.close(); } finally { await runtime.stop(); } })();
  const interrupt = () => { process.exitCode = 130; void cleanup(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const results: Record<string, unknown>[] = [];
  try {
    browser = await launchChromium();
    outer: for (const target of targets) for (const flow of selected) {
      const label = `${flow}-${target.label}`, started = Date.now();
      const context = await browser.newContext({ viewport: { width: target.width, height: target.height }, deviceScaleFactor: target.scale, hasTouch: target.device.touch, timezoneId: 'Europe/Warsaw' });
      const page = await context.newPage(), consoleErrors: string[] = [], writes: string[] = [], external: string[] = [];
      page.setDefaultTimeout(10_000);
      page.on('console', message => { if (message.type() === 'error' && consoleErrors.length < 100) consoleErrors.push(message.text()); });
      page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`); });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(runtime.url).origin) { external.push(url.origin); await route.abort('blockedbyclient'); }
        else await route.continue();
      });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const screenshot = async (stage: string) => { const path = join(out, `${label}-${stage}.png`); await page.screenshot({ path, animations: 'disabled' }); };
      let failed = false;
      try {
        const metrics = await withPageErrors(page, async () => {
          await page.goto(runtime.url);
          const metrics = await wektorFlows[flow]({ page, url: runtime.url, fixtures, latency, screenshot });
          assert.deepEqual(writes, [], 'Przepływ UI nie powinien wysyłać wiadomości ani zapisywać decyzji.');
          assert.deepEqual(external, [], 'Próba połączenia poza izolowane środowisko scenariusza.');
          return metrics;
        });
        results.push({ case: flow, target: target.label, status: 'passed', elapsedMs: Date.now() - started, metrics, consoleErrors });
        console.log(`✔ ${label} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      } catch (error) {
        failed = true;
        await screenshot('failure').catch(() => {});
        const trace = join(out, `${label}-failure.zip`);
        await context.tracing.stop({ path: trace }).catch(() => {});
        results.push({ case: flow, target: target.label, status: 'failed', elapsedMs: Date.now() - started, error: error instanceof Error ? error.stack : String(error), trace, consoleErrors, writes, external });
        console.error(`✖ ${label}: ${error instanceof Error ? error.message : error}`);
        if (!process.exitCode) process.exitCode = 1;
      } finally {
        if (!failed) await context.tracing.stop().catch(() => {});
        for (const key of ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Shift', 'Meta']) await page.keyboard.up(key).catch(() => {});
        await context.close();
        writeFileSync(join(out, 'report.json'), `${JSON.stringify({ scenario: 'wizyty', url: runtime.url, latencyMs: latency, results }, null, 2)}\n`);
      }
      if (failed || process.exitCode === 130) break outer;
    }
    console.log(`Raport: ${join(out, 'report.json')}`);
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    await cleanup();
  }
}
