#!/usr/bin/env node
// Runs a conversation case against the live panel's Wektor (Hermes) and checks what it did: which tools it called, what
// it said, how many calls it took. Reads only what the case's tools read; a case must never make Wektor write.
//   node scripts/wektor-test.mjs <case> [--runs N] [--delete] [--base http://127.0.0.1:5174]
// A case is scripts/wektor-cases/<case>.json: { description, turns: [{ say, expect: { calls, notCalls, text, textNot, maxTools, maxSeconds }, soft: [{ name, text }] }] }.
// `expect` fails the run, `soft` is only reported (judgement we watch, not yet a rule). The chats stay (titled "[test] <case> #<run>"):
// the user reads them; `--delete` removes them.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--runs' && args[args.indexOf(a) - 1] !== '--base');
const flag = (f, fallback) => { const i = args.indexOf(f); return i < 0 ? fallback : args[i + 1]; };
if (!name) { console.error('Użycie: node scripts/wektor-test.mjs <przypadek> [--runs N] [--delete] [--base URL]'); process.exit(2); }
const runs = Number(flag('--runs', 1));
const base = new URL(flag('--base', 'http://127.0.0.1:5174'));
const del = args.includes('--delete');
const kase = JSON.parse(readFileSync(join(root, 'scripts', 'wektor-cases', `${name}.json`), 'utf8'));

const call = (method, path, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const headers = { Origin: base.origin };
  if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
  const req = request({ host: base.hostname, port: base.port, path, method, headers }, res => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', c => { text += c; });
    res.on('end', () => { try { resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); } catch { resolve({ status: res.statusCode, body: text }); } });
  });
  req.on('error', reject);
  req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
  if (data) req.write(data);
  req.end();
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tool = n => String(n).replace(/^mcp_+desk[-_]panel_+/i, '').replace(/^mcp__desk_panel__/, '');

/** Waits until the chat has `answers` answers of the agent and the last one is not streaming any more. */
async function waitAnswer(id, answers, seconds = 300) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const { body } = await call('GET', `/api/chats/${id}`);
    const agent = (body?.items ?? []).filter(m => m.role === 'agent');
    if (agent.length >= answers && agent[answers - 1].status !== 'streaming') return agent[answers - 1];
    await sleep(1500);
  }
  throw new Error('Wektor nie skończył w czasie');
}

function judge(turn, message, seconds) {
  const parts = message.parts ?? [];
  const tools = parts.filter(p => p.type === 'tool').map(p => ({ name: tool(p.name), input: p.input, error: !!p.error, output: String(p.output ?? '').slice(0, 300) }));
  const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n').trim() || message.text || '';
  const names = tools.map(t => t.name);
  const e = turn.expect ?? {};
  const checks = [];
  const check = (label, ok) => checks.push({ label, ok });
  for (const n of e.calls ?? []) check(`woła ${n}`, names.includes(n));
  for (const n of e.notCalls ?? []) check(`nie woła ${n}`, !names.includes(n));
  for (const r of e.text ?? []) check(`tekst pasuje do /${r}/i`, new RegExp(r, 'i').test(text));
  for (const r of e.textNot ?? []) check(`tekst nie pasuje do /${r}/i`, !new RegExp(r, 'i').test(text));
  if (e.maxTools !== undefined) check(`najwyżej ${e.maxTools} wywołań narzędzi (jest ${tools.length})`, tools.length <= e.maxTools);
  if (e.maxSeconds !== undefined) check(`w ${e.maxSeconds} s (jest ${Math.round(seconds)})`, seconds <= e.maxSeconds);
  check('tura bez błędu', message.status === 'done' && !message.error);
  const soft = (turn.soft ?? []).map(s => ({ label: s.name, ok: new RegExp(s.text, 'i').test(text) }));
  return { tools, text, checks, soft, usage: message.usage ?? null, status: message.status, seconds: Math.round(seconds) };
}

const report = [];
for (let run = 1; run <= runs; run++) {
  const result = { run, turns: [], id: null };
  report.push(result);
  try {
    let id = null;
    for (const [i, turn] of kase.turns.entries()) {
      const started = Date.now();
      if (!id) {
        const created = await call('POST', '/api/chats', { text: turn.say, engine: 'hermes' });
        if (created.status !== 201) throw new Error(`POST /api/chats: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
        id = created.body.id;
        result.id = id;
      } else {
        const sent = await call('POST', `/api/chats/${id}/messages`, { text: turn.say });
        if (sent.status !== 202) throw new Error(`POST messages: ${sent.status}`);
      }
      const message = await waitAnswer(id, i + 1);
      result.turns.push(judge(turn, message, (Date.now() - started) / 1000));
    }
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
  if (result.id && del) await call('DELETE', `/api/chats/${result.id}`).catch(() => {});
  else if (result.id) await call('PATCH', `/api/chats/${result.id}`, { title: `[test] ${name} #${run} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` }).catch(() => {});
  const failed = result.error || result.turns.some(t => t.checks.some(c => !c.ok));
  console.log(`\n── przebieg ${run}/${runs}: ${failed ? 'NIEZALICZONY' : 'zaliczony'}${result.error ? ` (${result.error})` : ''}`);
  for (const [i, t] of result.turns.entries()) {
    const usage = t.usage ? `  [${t.usage.calls} wywołań modelu, ${t.usage.input + (t.usage.cached ?? 0)} tok. wejścia, ${t.usage.output} wyjścia, ${t.seconds} s]` : `  [${t.seconds} s]`;
    console.log(`  tura ${i + 1}: ${t.tools.map(x => x.name + (x.error ? '!' : '')).join(' → ') || '(bez narzędzi)'}${usage}`);
    for (const x of t.tools) if (x.name === 'panel_bank_propose') console.log(`    karta zgody: ${x.input}${x.error ? ' (błąd)' : ''}`);
    for (const c of t.checks) if (!c.ok) console.log(`    ✗ ${c.label}`);
    for (const s of t.soft) console.log(`    ${s.ok ? '+' : '–'} ${s.label}`);
    console.log(`    odpowiedź:\n${t.text.split('\n').map(l => `      ${l}`).join('\n')}`);
  }
}
const ok = report.filter(r => !r.error && r.turns.every(t => t.checks.every(c => c.ok))).length;
console.log(`\nZaliczone ${ok}/${runs}.`);
mkdirSync(join(root, 'output', 'wektor'), { recursive: true });
const file = join(root, 'output', 'wektor', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ case: name, at: new Date().toISOString(), runs: report }, null, 2));
console.log(`Raport: ${file}`);
process.exit(ok === runs ? 0 : 1);
