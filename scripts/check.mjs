// `just check` and the verify step of `just update`: tests, types, dead code and the frontend build side by side.
//   node scripts/check.mjs [--out DIR]   --out builds into DIR instead of dist
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/** Runs a command with its output held back, so parallel ones do not interleave; resolves to whether it passed. */
function quiet(label, command) {
  const started = Date.now();
  return new Promise(done => {
    const child = spawn(command, { shell: true, env: { ...process.env, FORCE_COLOR: '1' } });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', code => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) console.log(`✔ ${label} (${seconds} s)`);
      else console.log(`\n✖ ${label} (${seconds} s)\n${output.trimEnd()}\n`);
      done(code === 0);
    });
  });
}

/**
 * Tests, typecheck (incremental, cache in node_modules/.cache), dead code and the frontend build into `outDir`, all at
 * once since none waits for another; the caller serves the build only when every one passed.
 */
export async function verify(outDir = 'dist') {
  const results = await Promise.all([
    quiet('testy', 'npx vitest run'),
    quiet('typy', 'npx tsc --noEmit'),
    // Production mode: code that only tests use counts as dead too.
    quiet('martwy kod', 'npx knip --production --no-progress --no-config-hints'),
    quiet('build', `npx vite build --outDir ${outDir} --emptyOutDir`),
  ]);
  return results.every(Boolean);
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dist';
  const started = Date.now();
  const ok = await verify(out);
  console.log(ok ? `\n✔ Wszystko przeszło w ${((Date.now() - started) / 1000).toFixed(1)} s.` : '\n✖ Sprawdzenie nie przeszło.');
  process.exitCode = ok ? 0 : 1;
}
