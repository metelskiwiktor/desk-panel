import { EventEmitter } from 'node:events';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { screenshotPath, validateSingleScreenshot, withPageErrors } from './browser-checks.ts';

describe('browser verification', () => {
  it('rejects a page exception immediately, even if the flow is still waiting, and detaches its listener', async () => {
    const page = new EventEmitter();
    await expect(withPageErrors(page, async () => {
      page.emit('pageerror', new Error('synthetic render failure'));
      await new Promise(() => {});
    })).rejects.toThrow('Błąd JavaScript strony: synthetic render failure');
    expect(page.listenerCount('pageerror')).toBe(0);
  });

  it('does not confuse an expected offline console error with an uncaught exception; flow failures still propagate', async () => {
    const page = new EventEmitter();
    await expect(withPageErrors(page, async () => { page.emit('console', { type: () => 'error', text: () => '503' }); return 'offline shown'; })).resolves.toBe('offline shown');
    await expect(withPageErrors(page, async () => { throw new Error('missing card'); })).rejects.toThrow('missing card');
    expect(page.listenerCount('pageerror')).toBe(0);
  });
});

describe('screenshot destinations', () => {
  const base = { out: 'output/screenshots', label: 'standard', page: 'pulpit', target: 'medialove-14@1.5x' };
  it('keeps different views, query states, engine states and scales in separate files', () => {
    const paths = [{}, { open: 'chat-skills' }, { open: 'chat-compact' }, { query: 'ambient=night' }, { open: 'chat', hermes: 'down' }, { open: 'chat', hermes: 'up' }, { open: 'chat-skills', target: 'medialove-14@1x' }].map(change => screenshotPath({ ...base, ...change }));
    expect(new Set(paths).size).toBe(paths.length);
    expect(basename(paths[0])).toBe('standard-pulpit-medialove-14@1.5x.png');
    expect(basename(screenshotPath({ ...base, open: 'tile:github-pr' }))).not.toMatch(/[:<>]/);
  });
  it('separates intermediate states and prevents explicit files from being overwritten by a matrix', () => {
    expect(screenshotPath({ ...base, file: 'output/before.png' })).toBe(resolve('output/before.png'));
    expect(screenshotPath({ ...base, stage: 'axis-wide' })).not.toBe(screenshotPath({ ...base, stage: 'axis-narrow-calendar' }));
    expect(() => validateSingleScreenshot('output/before.png', 3, 1)).toThrow('--out');
    expect(() => validateSingleScreenshot('output/before.png', 1, 2)).toThrow('--out');
    expect(() => validateSingleScreenshot('output/before.png', 1, 1)).not.toThrow();
    expect(() => validateSingleScreenshot(undefined, 3, 6)).not.toThrow();
  });
});
