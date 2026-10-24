import { describe, expect, it } from 'vitest';
import { agoOrDate, cleanCommand, formatElapsed, formatModelLabel } from './format';

describe('formatElapsed', () => {
  it('formats short durations (< 60s)', () => {
    const now = 100000;
    expect(formatElapsed(now - 15000, now)).toEqual({
      text: '15 s',
      isLong: false,
      hours: 0,
      minutes: 0,
      seconds: 15,
    });
  });

  it('formats minute durations (< 60m)', () => {
    const now = 1000000;
    const res = formatElapsed(now - (5 * 60 + 15) * 1000, now);
    expect(res).toEqual({
      text: '5 min 15 s',
      isLong: false,
      hours: 0,
      minutes: 5,
      seconds: 15,
    });
  });

  it('formats long durations (>= 1h) with isLong: true', () => {
    const now = 20000000;
    const res = formatElapsed(now - (4 * 3600 + 32 * 60) * 1000, now);
    expect(res).toEqual({
      text: '4 godz. 32 min',
      isLong: true,
      hours: 4,
      minutes: 32,
      seconds: 0,
    });
  });
});

describe('cleanCommand', () => {
  it('unwraps powershell -Command invocations', () => {
    const raw = '"C:\\Users\\Viktor\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe" -Command \'$spike = Join-Path $env:LOCALAPPDATA \'\"\'t3code-spike\';\'';
    const cleaned = cleanCommand(raw);
    expect(cleaned).toBe('$spike = Join-Path $env:LOCALAPPDATA "t3code-spike";');
  });

  it('preserves simple commands', () => {
    expect(cleanCommand('just test file boardDrag.test.ts')).toBe('just test file boardDrag.test.ts');
  });
});

describe('formatModelLabel', () => {
  it('combines runner and model nicely', () => {
    expect(formatModelLabel('codex', 'gpt-6.1-sol')).toBe('codex · gpt-6.1-sol');
    expect(formatModelLabel('claude', 'sonnet')).toBe('Claude 3.7 Sonnet');
    expect(formatModelLabel('opencode', 'google/gemini-3.8-flash')).toBe('opencode · Gemini 3.8 Flash');
  });
  it('reads the version out of a Claude model id', () => {
    expect(formatModelLabel('Claude', 'claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(formatModelLabel('Claude', 'claude-sonnet-5-5-20260101')).toBe('Claude Sonnet 5.5');
    expect(formatModelLabel('Claude', 'claude-haiku-5')).toBe('Claude Haiku 5');
  });

  it('avoids repetition when model contains runner name', () => {
    expect(formatModelLabel('codex', 'gpt-5.1-codex')).toBe('gpt-5.1-codex');
  });

  it('handles missing runner or model gracefully', () => {
    expect(formatModelLabel('codex')).toBe('codex');
    expect(formatModelLabel(undefined, 'gpt-6.1-sol')).toBe('gpt-6.1-sol');
    expect(formatModelLabel()).toBe('');
  });
});


describe('agoOrDate', () => {
  const now = new Date('2026-10-24T20:00:00').getTime();
  const ago = (ms: number) => agoOrDate(now - ms, now);
  it('says how long ago within a day', () => {
    expect([ago(20_000), ago(60_000), ago(5 * 60_000), ago(59 * 60_000), ago(60 * 60_000), ago(5 * 3_600_000), ago(23.9 * 3_600_000)])
      .toEqual(['przed chwilą', '1 min temu', '5 min temu', '59 min temu', '1 godz. temu', '5 godz. temu', '23 godz. temu']);
  });
  it('gives the date and time once it is older than a day, and tolerates a clock a little behind', () => {
    expect(ago(24 * 3_600_000)).toMatch(/^23 paź 20:00$/);
    expect(ago(-30_000)).toBe('przed chwilą');
  });
});
