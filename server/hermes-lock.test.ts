import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The pinned Hermes install: `just hermes-setup` applies the patch and `just hermes CHECK` verifies it by these values.
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(readFileSync(path.join(root, 'servy/hermes.lock.json'), 'utf8'));
const commit = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;

describe('servy/hermes.lock.json', () => {
  it('pins exact Hermes and provider commits and the patch target hashes', () => {
    expect(lock.hermesRef).toMatch(commit);
    expect(lock.provider.name).toBe('antigravity-oauth');
    expect(lock.provider.ref).toMatch(commit);
    expect(lock.streamingPatch.required).toBe(true);
    for (const key of ['sha256', 'baseSha256', 'resultSha256']) expect(lock.streamingPatch[key]).toMatch(sha256);
    expect(lock.streamingPatch.baseSha256).not.toBe(lock.streamingPatch.resultSha256);
  });

  it('records the real SHA-256 of the streaming patch file', () => {
    const patch = readFileSync(path.join(root, lock.streamingPatch.file));
    expect(createHash('sha256').update(patch).digest('hex')).toBe(lock.streamingPatch.sha256);
  });

  it('patches only the stream gate of its target, for Antigravity API runs', () => {
    const patch = readFileSync(path.join(root, lock.streamingPatch.file), 'utf8');
    expect(patch).not.toContain('\r');
    const files = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    expect(files).toEqual([lock.streamingPatch.target]);
    const added = patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'));
    expect(added.join('\n')).toContain('agent.provider == "antigravity-oauth" and agent.platform == "api_server"');
    expect(added.at(-1)).toContain('_is_external_process_provider(agent.provider) and not antigravity_api');
  });
});
