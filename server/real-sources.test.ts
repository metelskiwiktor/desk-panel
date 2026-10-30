// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
const { canWriteCalendar, insert } = vi.hoisted(() => ({ canWriteCalendar: vi.fn(), insert: vi.fn().mockResolvedValue({ id: 'saved' }) }));
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
vi.mock('./cezar-finished', () => ({ createFinishedReader: () => ({}) }));
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
