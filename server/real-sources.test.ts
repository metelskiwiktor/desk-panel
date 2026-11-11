// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
const { canWriteCalendar, insert, finishedRead } = vi.hoisted(() => ({ canWriteCalendar: vi.fn(), insert: vi.fn().mockResolvedValue({ id: 'saved' }), finishedRead: vi.fn() }));
vi.mock('./google-oauth', () => ({ createGoogleAccount: () => ({ canWriteCalendar, services: [] }), GoogleAuthError: class extends Error {} }));
vi.mock('./calendar-write', () => ({ createCalendarWriter: () => insert }));
vi.mock('./calendar', () => ({ createCalendarReader: () => Object.assign(vi.fn(), { invalidate: vi.fn() }) }));
// Isolate every provider/store constructor: this test never opens the user's private state.
vi.mock('./bank', () => ({ createBank: () => ({}) }));
vi.mock('./bank-labels', () => ({ createBankLabelStore: () => ({}), privateFile: () => ({}) }));
vi.mock('./appointments', () => ({ createAppointments: () => ({}) }));
vi.mock('./znanylekarz', () => ({ createZnanyLekarzReader: () => ({}) }));
vi.mock('./garmin', () => ({ createGarminApi: () => ({}), createGarminReader: () => ({}) }));
vi.mock('./garmin-tokens', () => ({ garminTokenFile: () => ({}) }));
vi.mock('./gmail', () => ({ createMailReader: () => ({}) }));
vi.mock('./smart-rules', () => ({ createSmartRuleStore: () => ({}) }));
vi.mock('./system', () => ({ createSystemReader: () => ({}) }));
vi.mock('./todos', () => ({ createTodoStore: () => ({}) }));
vi.mock('./quotas', () => ({ createQuotaReader: () => ({}) }));
vi.mock('./usageBreakdown', () => ({ createUsageBreakdownReader: () => ({}) }));
vi.mock('./warmup', () => ({ createWarmupClient: () => ({}) }));
vi.mock('./github', () => ({ createGitHubClient: () => ({}) }));
vi.mock('./openrouter', () => ({ createOpenRouterClient: () => ({}) }));
vi.mock('./cezar-finished', () => ({ createFinishedReader: () => ({ read: finishedRead, expect: vi.fn() }) }));
vi.mock('./cezar', () => ({ readCezar: async () => ({ observedAt: 1, tasks: [], counts: { running: 0, queue: 0, 'needs-input': 0, review: 0 }, partial: false, scheduled: 0 }) }));
import { createRealSources } from './real-sources';
import { calendarDraftSchema } from '../src/appointment-contract';
describe('automation Calendar scope guard', () => {
  it('awaits the scope check and never calls Google when consent is missing', async () => {
    const sources = createRealSources({ port: 0, cezarUrl: '', calendarId: 'fixture@example.com', mailAccounts: [], env: {} });
    const draft = calendarDraftSchema.parse({ title: 'Fixture', startAt: 1000, endAt: 3601000 });
    canWriteCalendar.mockResolvedValue(false);
    await expect(sources.automationCalendarWrite!('key', draft)).rejects.toThrow('calendar.events.owned');
    expect(insert).not.toHaveBeenCalled();
    canWriteCalendar.mockResolvedValue(true);
    await expect(sources.automationCalendarWrite!('key', draft)).resolves.toMatchObject({ id: 'saved' });
    expect(insert).toHaveBeenCalledOnce();
  });
});

describe('the finished list handed to onFinished', () => {
  it('says complete only when the list was really read: a failed read keeps the last list for the screen and is marked incomplete', async () => {
    const seen: [string[], boolean][] = [];
    const sources = createRealSources({ port: 0, cezarUrl: 'http://127.0.0.1:1/', calendarId: 'fixture@example.com', mailAccounts: [], env: {}, onFinished: (tasks, complete) => { seen.push([tasks.map(t => t.id), complete]); } });
    const task = { id: 'p/a', title: 'A', project: 'p', status: 'failed' as const, checkedAt: 1, description: 'A', sourceUrl: 'http://127.0.0.1:1/p/p/tasks/a' };
    finishedRead.mockRejectedValueOnce(new Error('Cezar HTTP 500'));
    expect((await sources.cezar()).finished).toEqual([]);
    finishedRead.mockResolvedValueOnce([task]);
    expect((await sources.cezar()).finished).toEqual([task]);
    finishedRead.mockRejectedValueOnce(new Error('timeout'));
    expect((await sources.cezar()).finished).toEqual([task]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen).toEqual([[[], false], [['p/a'], true], [['p/a'], false]]);
  });
});
