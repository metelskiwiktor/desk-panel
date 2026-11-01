// Shared verification for just check, the executor workflow and just update.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, relative } from 'node:path';

function run(label, command) {
  const start = Date.now();
  return new Promise(done => {
    const child = spawn(command, { shell: true, env: { ...process.env, FORCE_COLOR: '1' } });
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    child.on('error', e => { output += e.message; });
    child.on('close', code => done({ label, code, output, seconds: ((Date.now()-start)/1000).toFixed(1) }));
  });
}

export async function verify(outDir = 'dist') {
  mkdirSync('.ai', { recursive: true });
  rmSync('.ai/check-tests.json', { force: true });
  const results = await Promise.all([
    run('testy', 'npx vitest run --reporter=json --outputFile=.ai/check-tests.json'),
    run('typy', 'npx tsc --noEmit'), run('martwy kod', 'npx knip --production --no-progress --no-config-hints'),
    run('build', `npx vite build --outDir ${outDir} --emptyOutDir`),
  ]);
  let tests;
  try { tests = JSON.parse(readFileSync('.ai/check-tests.json', 'utf8')); } catch { /* report failure below */ }
  const failures = [];
  const first = text => String(text || '').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find(l => l.trim()) || 'Brak szczegółów błędu';
  for (const file of tests?.testResults || []) {
    if (file.status !== 'failed') continue;
    const path = relative(process.cwd(), file.name).replaceAll('\\', '/');
    const failed = file.assertionResults.filter(t => t.status === 'failed');
    if (!failed.length) failures.push({ path, test: '(suite)', error: first(file.message) });
    for (const t of failed) failures.push({ path, test: t.fullName, error: first(t.failureMessages?.[0]) });
  }
  writeFileSync('.ai/check-failures.json', JSON.stringify({ failures }, null, 2));
  writeFileSync('.ai/check.log', results.map(r => `=== ${r.label} ===\n${r.output}`).join('\n') +
    (tests ? '\n=== Vitest full results ===\n' + JSON.stringify(tests, null, 2) : ''));
  for (const r of results) {
    console.log(`${r.code === 0 ? '✔' : '✖'} ${r.label} (${r.seconds} s)`);
    if (r.code !== 0 && (r.label !== 'testy' || !failures.length)) console.log(`Error: ${r.label}: ${first(r.output)}`);
  }
  for (const f of failures) console.log(`FAIL ${f.path} > ${f.test}\nError: ${f.error}`);
  if (results.some(r => r.code !== 0)) console.log('Pełny log: .ai/check.log; dane testów: .ai/check-tests.json');
  return results.every(r => r.code === 0);
}
if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out')+1] : 'dist';
  process.exitCode = await verify(out) ? 0 : 1;
}
