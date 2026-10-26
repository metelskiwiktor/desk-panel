// Attaches `.ai/screenshots/before.png` and/or `.ai/screenshots/after.png` as a comment on the current branch's PR.
// Fail-soft by design: if there are no screenshots (non-UI task) or `gh pr comment` fails, prints a message and exits 0.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function hasImage(path) {
  try {
    return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
  } catch {
    return false;
  }
}

try {
  const shotDir = resolve(process.cwd(), '.ai', 'screenshots');
  const beforePath = join(shotDir, 'before.png');
  const afterPath = join(shotDir, 'after.png');
  const hasBefore = hasImage(beforePath);
  const hasAfter = hasImage(afterPath);

  if (!hasBefore && !hasAfter) {
    console.log('pr-screenshots: no .ai/screenshots/{before,after}.png found — skipping PR screenshot comment.');
    process.exit(0);
  }

  let body;
  const attachArgs = [];
  if (hasBefore && hasAfter) {
    body = [
      '## Zrzuty ekranu (Przed / Po)',
      '',
      '| Przed (`before.png`) | Po (`after.png`) |',
      '| --- | --- |',
      '| ![before](./before.png) | ![after](./after.png) |',
    ].join('\n');
    attachArgs.push('--attach', './before.png', '--attach', './after.png');
  } else if (hasAfter) {
    body = [
      '## Zrzut ekranu (Po zmianie)',
      '',
      '![after](./after.png)',
    ].join('\n');
    attachArgs.push('--attach', './after.png');
  } else {
    body = [
      '## Zrzut ekranu (Przed zmianą)',
      '',
      '![before](./before.png)',
    ].join('\n');
    attachArgs.push('--attach', './before.png');
  }

  execFileSync('gh', ['pr', 'comment', '--body', body, ...attachArgs], {
    cwd: shotDir,
    stdio: 'inherit',
    timeout: 60_000,
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
    },
  });
  console.log('pr-screenshots: published screenshot comment to PR.');
  try {
    rmSync(shotDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
} catch (error) {
  console.warn(`pr-screenshots: could not publish screenshot comment (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0);
}
