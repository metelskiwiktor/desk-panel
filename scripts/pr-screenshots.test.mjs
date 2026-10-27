// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildComment,
  discoverScreenshotPairs,
  hasImage,
  parseScreenshotFilename,
  runPrScreenshots,
} from './pr-screenshots.mjs';

describe('pr-screenshots', () => {
  let tempDirs = [];

  function createTempShotDir() {
    const dir = mkdtempSync(join(tmpdir(), 'desk-shots-test-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tempDirs = [];
    vi.restoreAllMocks();
  });

  describe('parseScreenshotFilename', () => {
    it('parses default before and after filenames', () => {
      expect(parseScreenshotFilename('before.png')).toEqual({
        type: 'before',
        key: '',
        filename: 'before.png',
      });
      expect(parseScreenshotFilename('after.png')).toEqual({
        type: 'after',
        key: '',
        filename: 'after.png',
      });
    });

    it('parses hyphenated and underscored view suffixes', () => {
      expect(parseScreenshotFilename('before-pulpit.png')).toEqual({
        type: 'before',
        key: 'pulpit',
        filename: 'before-pulpit.png',
      });
      expect(parseScreenshotFilename('after-pulpit.png')).toEqual({
        type: 'after',
        key: 'pulpit',
        filename: 'after-pulpit.png',
      });
      expect(parseScreenshotFilename('before_mobile-14.png')).toEqual({
        type: 'before',
        key: 'mobile-14',
        filename: 'before_mobile-14.png',
      });
      expect(parseScreenshotFilename('after2.png')).toEqual({
        type: 'after',
        key: '2',
        filename: 'after2.png',
      });
    });

    it('returns null for non-matching files', () => {
      expect(parseScreenshotFilename('diff.patch')).toBeNull();
      expect(parseScreenshotFilename('screenshot.png')).toBeNull();
      expect(parseScreenshotFilename('before.jpg')).toBeNull();
      expect(parseScreenshotFilename('after.txt')).toBeNull();
    });
  });

  describe('buildComment', () => {
    it('returns null for empty pairs', () => {
      expect(buildComment([])).toEqual({ body: null, attachArgs: [] });
    });

    it('builds standard table for single default pair (backward compatibility)', () => {
      const pairs = [{ key: '', before: 'before.png', after: 'after.png' }];
      const result = buildComment(pairs);

      expect(result.body).toBe([
        '## Zrzuty ekranu (Przed / Po)',
        '',
        '| Przed (`before.png`) | Po (`after.png`) |',
        '| --- | --- |',
        '| ![before](./before.png) | ![after](./after.png) |',
      ].join('\n'));
      expect(result.attachArgs).toEqual(['--attach', './before.png', '--attach', './after.png']);
    });

    it('builds single after block for default pair with missing before', () => {
      const pairs = [{ key: '', before: null, after: 'after.png' }];
      const result = buildComment(pairs);

      expect(result.body).toBe([
        '## Zrzut ekranu (Po zmianie)',
        '',
        '![after](./after.png)',
      ].join('\n'));
      expect(result.attachArgs).toEqual(['--attach', './after.png']);
    });

    it('builds single before block for default pair with missing after', () => {
      const pairs = [{ key: '', before: 'before.png', after: null }];
      const result = buildComment(pairs);

      expect(result.body).toBe([
        '## Zrzut ekranu (Przed zmianą)',
        '',
        '![before](./before.png)',
      ].join('\n'));
      expect(result.attachArgs).toEqual(['--attach', './before.png']);
    });

    it('builds comparison table for a single named view', () => {
      const pairs = [{ key: 'pulpit', before: 'before-pulpit.png', after: 'after-pulpit.png' }];
      const result = buildComment(pairs);

      expect(result.body).toBe([
        '## Zrzuty ekranu (Przed / Po)',
        '',
        '| Widok | Przed | Po |',
        '| --- | --- | --- |',
        '| pulpit | ![before-pulpit](./before-pulpit.png) | ![after-pulpit](./after-pulpit.png) |',
      ].join('\n'));
      expect(result.attachArgs).toEqual(['--attach', './before-pulpit.png', '--attach', './after-pulpit.png']);
    });

    it('builds multi-view comparison table for multiple pairs with all image attachments', () => {
      const pairs = [
        { key: 'pulpit', before: 'before-pulpit.png', after: 'after-pulpit.png' },
        { key: 'zadania', before: 'before-zadania.png', after: 'after-zadania.png' },
      ];
      const result = buildComment(pairs);

      expect(result.body).toBe([
        '## Zrzuty ekranu (Przed / Po)',
        '',
        '| Widok | Przed | Po |',
        '| --- | --- | --- |',
        '| pulpit | ![before-pulpit](./before-pulpit.png) | ![after-pulpit](./after-pulpit.png) |',
        '| zadania | ![before-zadania](./before-zadania.png) | ![after-zadania](./after-zadania.png) |',
      ].join('\n'));
      expect(result.attachArgs).toEqual([
        '--attach', './before-pulpit.png',
        '--attach', './after-pulpit.png',
        '--attach', './before-zadania.png',
        '--attach', './after-zadania.png',
      ]);
    });

    it('handles multiple views when default pair is mixed with named pairs', () => {
      const pairs = [
        { key: '', before: 'before.png', after: 'after.png' },
        { key: 'mobile', before: 'before-mobile.png', after: 'after-mobile.png' },
      ];
      const result = buildComment(pairs);

      expect(result.body).toBe([
        '## Zrzuty ekranu (Przed / Po)',
        '',
        '| Widok | Przed | Po |',
        '| --- | --- | --- |',
        '| domyślny | ![before](./before.png) | ![after](./after.png) |',
        '| mobile | ![before-mobile](./before-mobile.png) | ![after-mobile](./after-mobile.png) |',
      ].join('\n'));
      expect(result.attachArgs).toEqual([
        '--attach', './before.png',
        '--attach', './after.png',
        '--attach', './before-mobile.png',
        '--attach', './after-mobile.png',
      ]);
    });

    it('handles missing images in multi-view scenarios cleanly (dash placeholder and only attaching existing files)', () => {
      const pairs = [
        { key: 'pulpit', before: 'before-pulpit.png', after: 'after-pulpit.png' },
        { key: 'smart-actions', before: null, after: 'after-smart-actions.png' },
        { key: 'stary-kafelek', before: 'before-stary-kafelek.png', after: null },
      ];
      const result = buildComment(pairs);

      expect(result.body).toBe([
        '## Zrzuty ekranu (Przed / Po)',
        '',
        '| Widok | Przed | Po |',
        '| --- | --- | --- |',
        '| pulpit | ![before-pulpit](./before-pulpit.png) | ![after-pulpit](./after-pulpit.png) |',
        '| smart-actions | — | ![after-smart-actions](./after-smart-actions.png) |',
        '| stary-kafelek | ![before-stary-kafelek](./before-stary-kafelek.png) | — |',
      ].join('\n'));
      expect(result.attachArgs).toEqual([
        '--attach', './before-pulpit.png',
        '--attach', './after-pulpit.png',
        '--attach', './after-smart-actions.png',
        '--attach', './before-stary-kafelek.png',
      ]);
    });
  });

  describe('discoverScreenshotPairs & hasImage', () => {
    it('discovers single pair, sorting and ignoring 0-byte or non-png files', () => {
      const dir = createTempShotDir();
      writeFileSync(join(dir, 'before.png'), 'fake-image-bytes');
      writeFileSync(join(dir, 'after.png'), 'fake-image-bytes-after');
      writeFileSync(join(dir, 'notes.txt'), 'not-an-image');
      writeFileSync(join(dir, 'before-empty.png'), ''); // 0-byte file

      const pairs = discoverScreenshotPairs(dir);
      expect(pairs).toEqual([
        { key: '', before: 'before.png', after: 'after.png' },
      ]);
    });

    it('discovers multiple pairs and sorts default first, then alphabetically', () => {
      const dir = createTempShotDir();
      writeFileSync(join(dir, 'after-zadania.png'), 'png');
      writeFileSync(join(dir, 'before-pulpit.png'), 'png');
      writeFileSync(join(dir, 'before.png'), 'png');
      writeFileSync(join(dir, 'after.png'), 'png');
      writeFileSync(join(dir, 'after-pulpit.png'), 'png');
      writeFileSync(join(dir, 'before-zadania.png'), 'png');

      const pairs = discoverScreenshotPairs(dir);
      expect(pairs).toEqual([
        { key: '', before: 'before.png', after: 'after.png' },
        { key: 'pulpit', before: 'before-pulpit.png', after: 'after-pulpit.png' },
        { key: 'zadania', before: 'before-zadania.png', after: 'after-zadania.png' },
      ]);
    });

    it('returns empty array when directory does not exist or has no images', () => {
      expect(discoverScreenshotPairs('/nonexistent-dir-123456')).toEqual([]);

      const dir = createTempShotDir();
      expect(discoverScreenshotPairs(dir)).toEqual([]);
    });
  });

  describe('runPrScreenshots execution and fail-soft behavior', () => {
    it('publishes comment with gh pr comment and cleans up shotDir', () => {
      const dir = createTempShotDir();
      writeFileSync(join(dir, 'before-pulpit.png'), 'img');
      writeFileSync(join(dir, 'after-pulpit.png'), 'img');

      const execMock = vi.fn();
      const ok = runPrScreenshots({ shotDir: dir, exec: execMock });

      expect(ok).toBe(true);
      expect(execMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = execMock.mock.calls[0];
      expect(cmd).toBe('gh');
      expect(args).toContain('pr');
      expect(args).toContain('comment');
      expect(args).toContain('--attach');
      expect(args).toContain('./before-pulpit.png');
      expect(args).toContain('./after-pulpit.png');
      expect(opts.cwd).toBe(dir);
      expect(existsSync(dir)).toBe(false); // cleaned up
    });

    it('skips comment if no images are found and exits soft without throwing', () => {
      const dir = createTempShotDir();
      const execMock = vi.fn();

      const ok = runPrScreenshots({ shotDir: dir, exec: execMock });
      expect(ok).toBe(false);
      expect(execMock).not.toHaveBeenCalled();
      expect(existsSync(dir)).toBe(true); // not cleaned up
    });

    it('catches gh execution failure, logs warning and returns false without rethrowing', () => {
      const dir = createTempShotDir();
      writeFileSync(join(dir, 'before.png'), 'img');
      writeFileSync(join(dir, 'after.png'), 'img');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const execMock = vi.fn(() => {
        throw new Error('gh: Could not resolve to a PullRequest');
      });

      const ok = runPrScreenshots({ shotDir: dir, exec: execMock });
      expect(ok).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not publish screenshot comment (non-fatal)'));
    });
  });
});
