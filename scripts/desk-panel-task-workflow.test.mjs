// @vitest-environment node
// The workflow file is the executor's contract: prepare owns dependencies, agent steps never publish, the review runs on
// another model and only an approved diff is committed (deterministically) before the PR. A hand edit that breaks one of
// these boundaries fails here, not in a run that already spent tokens.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const yaml = readFileSync(join(root, '.ai', 'cezar', 'workflows', 'desk-panel-task.yaml'), 'utf8');

describe('desk-panel-task workflow', () => {
  it('prepares through the executor script and stops when prepare fails', () => {
    expect(yaml).toContain('node scripts/executor-prepare.mjs');
    expect(yaml).toContain('- from: prepare.fail\n    to: prepare-failed');
    expect(yaml).toMatch(/- id: prepare-failed[\s\S]*?status: failed/);
    expect(yaml).not.toMatch(/git reset --hard|git rm --cached|symlinkSync/);
  });

  it('runs every writing step on opencode with the one DeepSeek model', () => {
    const models = [...yaml.matchAll(/^\s*model:\s*(\S+)\s*$/gm)].map(match => match[1]);
    expect(models).toContain('openrouter/deepseek/deepseek-v4.1-flash-1017');
    expect(new Set(models)).toEqual(new Set(['openrouter/deepseek/deepseek-v4.1-flash-1017', 'gemini-3.8-flash-high']));
    for (const id of ['implement', 'fix', 'address']) {
      const block = yaml.slice(yaml.indexOf(`- id: ${id}`), yaml.indexOf('\n  - id:', yaml.indexOf(`- id: ${id}`) + 1));
      expect(block).toContain('type: agent');
      expect(block).toContain('runner: opencode');
    }
  });

  it('keeps implement, fix and address from committing or pushing', () => {
    expect(yaml).not.toMatch(/git commit -m|git push origin|git add -A|gh pr create/);
    for (const marker of ['.ai/executor-summary.md', '.ai/commit-message.txt', '.ai/screenshots/before.png', 'scripts/scenario.ts', 'read_file']) {
      expect(yaml).toContain(marker);
    }
    expect(yaml).not.toContain('.ai/scenario.ts');
  });

  it('keeps fix and address self-contained on fresh OpenCode sessions', () => {
    const fix = yaml.slice(yaml.indexOf('- id: fix\n'), yaml.indexOf('\n  - id: changed'));
    const address = yaml.slice(yaml.indexOf('- id: address\n'), yaml.indexOf('\n  - id: commit'));
    for (const block of [fix, address]) {
      expect(block).toContain('fresh OpenCode session');
      expect(block).toContain('Original task: {{task}}');
      expect(block).toContain('.ai/executor-summary.md');
      expect(block).toContain('docs/agent-workflows/executor-brief.md');
      expect(block).toMatch(/no\s+widening/i);
      for (const forbidden of ['PANEL_GUIDES', 'CHAT_SKILLS', 'COCKPIT_TOOLS', 'preamble', 'Cezar checkout']) expect(block).toContain(forbidden);
      expect(block).toMatch(/npx vitest run/);
      expect(block).toMatch(/git commit/);
      expect(block).toMatch(/git push/);
      expect(block).toMatch(/CEZ:DONE/);
    }
    expect(fix).toContain('{{nodes.verify.output}}');
    expect(address).toContain('{{nodes.review.summary}}');
    // The prompts and comments must not claim that OpenCode resumes implement: it starts a new session every time.
    expect(yaml).not.toMatch(/continue (?:the )?implement(?:'s)? session/i);
  });

  it('pins the review to exactly the AGY read-only tools and forbids native terminals', () => {
    const review = yaml.slice(yaml.indexOf('- id: review\n'), yaml.indexOf('- id: review-retry'));
    expect(review).toMatch(/^ {4}allowedTools:\n {6}- Read\n {6}- Glob\n {6}- Grep$/m);
    expect(review).not.toMatch(/^ {4}review: true$/m);
    for (const tool of ['read_file', 'list_dir', 'grep_search', 'find_by_name']) expect(review).toContain(tool);
    for (const banned of ['run_command', 'terminal', 'node', 'PowerShell', 'bash']) expect(review).toContain(banned);
    expect(review.toLowerCase()).toContain('execution failure');
    expect(review).toContain('Do not run tests');
  });

  it('verifies with just check and the pinned-base diff', () => {
    const verify = yaml.slice(yaml.indexOf('- id: verify\n'), yaml.indexOf('- id: verify-retry'));
    expect(verify).toContain('just check');
    expect(verify).toContain('node scripts/executor-commit.mjs --diff');
    expect(verify).not.toContain('|| true');
  });

  it('reviews on agy, asks for scope and race checks, and fails when rounds are exhausted', () => {
    const review = yaml.slice(yaml.indexOf('- id: review\n'), yaml.indexOf('- id: review-retry'));
    expect(review).toContain('runner: agy');
    expect(review).toContain('model: gemini-3.8-flash-high');
    for (const word of ['scope', 'race', 'migration', 'idempotence', 'p2', 'cez:verdict']) expect(review.toLowerCase()).toContain(word);
    expect(yaml).toContain('- from: review-retry.exhausted\n    to: review-failed');
    expect(yaml).toMatch(/- id: review-failed[\s\S]*?status: failed/);
  });

  it('commits deterministically only after an approved review, then opens the PR', () => {
    expect(yaml).toContain('- from: review.approve\n    to: commit');
    expect(yaml).toContain('- from: commit.pass\n    to: pr');
    expect(yaml).toContain('- from: commit.fail\n    to: commit-failed');
    const commit = yaml.slice(yaml.indexOf('- id: commit\n'), yaml.indexOf('- id: pr\n'));
    expect(commit).toContain('type: check');
    expect(commit).toContain('node scripts/executor-commit.mjs');
    expect(commit).not.toContain('runner:');
    expect(yaml).toContain('- from: pr.created\n    to: screenshots-comment');
  });
});
