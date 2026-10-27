// Attaches before/after screenshots in `.ai/screenshots/` as a comment on the current branch's PR.
// Supports single default pair (`before.png` / `after.png`) as well as multiple view pairs
// (e.g. `before-<name>.png` / `after-<name>.png` or single `after*.png`).
// Fail-soft by design: if there are no screenshots (non-UI task) or `gh pr comment` fails, prints a message and exits 0.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function hasImage(path) {
  try {
    return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
  } catch {
    return false;
  }
}

export function parseScreenshotFilename(filename) {
  const match = filename.match(/^(before|after)(?:[-_](.*)|(.*))?\.png$/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const key = (match[2] ?? match[3] ?? '').trim();
  return { type, key, filename };
}

export function discoverScreenshotPairs(shotDir) {
  if (!existsSync(shotDir)) return [];
  let entries;
  try {
    entries = readdirSync(shotDir);
  } catch {
    return [];
  }

  const pairsByKey = new Map();

  for (const filename of entries) {
    const fullPath = join(shotDir, filename);
    if (!hasImage(fullPath)) continue;

    const parsed = parseScreenshotFilename(filename);
    if (!parsed) continue;

    const { type, key } = parsed;
    if (!pairsByKey.has(key)) {
      pairsByKey.set(key, { key, before: null, after: null });
    }
    const pair = pairsByKey.get(key);
    if (type === 'before') {
      pair.before = filename;
    } else if (type === 'after') {
      pair.after = filename;
    }
  }

  const pairs = Array.from(pairsByKey.values()).filter(p => p.before || p.after);

  pairs.sort((a, b) => {
    if (a.key === '' && b.key !== '') return -1;
    if (a.key !== '' && b.key === '') return 1;
    return a.key.localeCompare(b.key);
  });

  return pairs;
}

export function buildComment(pairs) {
  if (!pairs || pairs.length === 0) {
    return { body: null, attachArgs: [] };
  }

  // Backward compatibility: single pair without a key (default `before.png` / `after.png`)
  if (pairs.length === 1 && pairs[0].key === '') {
    const { before, after } = pairs[0];
    const attachArgs = [];
    let body;

    if (before && after) {
      body = [
        '## Zrzuty ekranu (Przed / Po)',
        '',
        '| Przed (`before.png`) | Po (`after.png`) |',
        '| --- | --- |',
        '| ![before](./before.png) | ![after](./after.png) |',
      ].join('\n');
      attachArgs.push('--attach', './before.png', '--attach', './after.png');
    } else if (after) {
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

    return { body, attachArgs };
  }

  // Multiple pairs or named pairs
  const lines = [
    '## Zrzuty ekranu (Przed / Po)',
    '',
    '| Widok | Przed | Po |',
    '| --- | --- | --- |',
  ];
  const attachArgs = [];

  for (const pair of pairs) {
    const label = pair.key ? pair.key : 'domyślny';
    const beforeCell = pair.before ? `![${pair.before.replace(/\.png$/i, '')}](./${pair.before})` : '—';
    const afterCell = pair.after ? `![${pair.after.replace(/\.png$/i, '')}](./${pair.after})` : '—';
    lines.push(`| ${label} | ${beforeCell} | ${afterCell} |`);

    if (pair.before) {
      attachArgs.push('--attach', `./${pair.before}`);
    }
    if (pair.after) {
      attachArgs.push('--attach', `./${pair.after}`);
    }
  }

  return { body: lines.join('\n'), attachArgs };
}

export function runPrScreenshots({
  shotDir = resolve(process.cwd(), '.ai', 'screenshots'),
  exec = execFileSync,
} = {}) {
  try {
    const pairs = discoverScreenshotPairs(shotDir);

    if (pairs.length === 0) {
      console.log('pr-screenshots: no .ai/screenshots/{before,after}*.png found — skipping PR screenshot comment.');
      return false;
    }

    const { body, attachArgs } = buildComment(pairs);

    exec('gh', ['pr', 'comment', '--body', body, ...attachArgs], {
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
    return true;
  } catch (error) {
    console.warn(`pr-screenshots: could not publish screenshot comment (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

if (process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(process.argv[1]).href.toLowerCase()) {
  runPrScreenshots();
  process.exit(0);
}
