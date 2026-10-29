// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadScenario } from './scenario';
import { createAppointments, type AppointmentPersistence } from './appointments';
import { appointmentPreviewSchema, type AppointmentPreview } from '../src/appointment-contract';
const NOW = Date.parse('2026-10-29T12:00:00+01:00');
const preview = () => appointmentPreviewSchema.parse(loadScenario('scenarios/wizyty.json', NOW).appointment);
function setup(p = preview(), persistence?: AppointmentPersistence, allowed = true) {
  const read = vi.fn(async () => p);
  const writeCalendar = vi.fn(async (key, draft) => ({ id: key, url: 'https://calendar.google.com/calendar/event?eid=fixture', at: NOW, draft }));
  const options = { read, writeCalendar, canWriteCalendar: async () => allowed, persistence, now: () => NOW };
  return { service: createAppointments(options), read, writeCalendar, options };
}
describe('appointment and calendar user decisions', () => {
  it('proposes without writes, rechecks selected slot, restores after restart and confirms only the stored selection', async () => {
    let disk: unknown; const persistence = { read: async () => { if (!disk) throw Object.assign(new Error(), { code: 'ENOENT' }); return structuredClone(disk); }, write: async (v: unknown) => { disk = structuredClone(v); } };
    const p = preview(), { service, read, writeCalendar, options } = setup(p, persistence);
    await service.propose(p.query); expect(writeCalendar).not.toHaveBeenCalled();
    expect((await service.view('chat:card', p.id)).selection).toBeNull();
    const selected = await service.act('chat:card', p.id, { action: 'select', slotId: p.slots[0].id });
    expect(read).toHaveBeenLastCalledWith(p.query, true); expect(writeCalendar).not.toHaveBeenCalled();
    expect(selected.selection?.draft?.endAt).toBe(p.slots[0].startAt + 30 * 60_000);
    const restored = createAppointments(options);
    expect((await restored.view('chat:card', p.id)).selection?.id).toBe(selected.selection?.id);
    const input = { action: 'confirm' as const, selectionId: selected.selection!.id, choice: { title: 'Moja wizyta', endAt: p.slots[0].startAt + 45 * 60_000 } };
    const [a, b] = await Promise.all([restored.act('chat:card', p.id, input), restored.act('chat:card', p.id, input)]);
    expect(a.saved).toEqual(b.saved); expect(writeCalendar).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2); // no availability check after successful booking
    await expect(restored.act('chat:card', p.id, { action: 'reset', selectionId: selected.selection!.id })).rejects.toMatchObject({ status: 409 });
  });
  it('blocks wrong selection ids, unavailable slots, changed price, missing consent and malicious action fields', async () => {
    const p = preview(), x = setup(p); await x.service.propose(p.query);
    await expect(x.service.act('c', p.id, { action: 'select', slotId: 'invented' })).rejects.toMatchObject({ status: 409 });
    x.read.mockResolvedValueOnce({ ...p, slots: [] });
    await expect(x.service.act('c', p.id, { action: 'select', slotId: p.slots[0].id })).rejects.toMatchObject({ status: 409 });
    x.read.mockResolvedValueOnce({ ...p, price: 999 });
    await expect(x.service.act('c', p.id, { action: 'select', slotId: p.slots[0].id })).rejects.toMatchObject({ status: 409 });
    const selected = await x.service.act('c', p.id, { action: 'select', slotId: p.slots[0].id });
    await expect(x.service.act('c', p.id, { action: 'confirm', selectionId: 'wrong' })).rejects.toMatchObject({ status: 409 });
    await expect(x.service.act('other', p.id, { action: 'confirm', selectionId: selected.selection!.id })).rejects.toMatchObject({ status: 409 });
    await expect(x.service.act('c', p.id, { action: 'confirm', selectionId: selected.selection!.id, bookingUrl: 'https://evil.test' } as never)).rejects.toThrow();
    const denied = setup(p, undefined, false); await denied.service.propose(p.query);
    const d = await denied.service.act('c', p.id, { action: 'select', slotId: p.slots[0].id });
    await expect(denied.service.act('c', p.id, { action: 'confirm', selectionId: d.selection!.id })).rejects.toMatchObject({ status: 409 });
    expect(denied.writeCalendar).not.toHaveBeenCalled(); expect(x.writeCalendar).not.toHaveBeenCalled();
  });
  it('freezes a pending event before Google, so a retry after a save failure cannot create a different event', async () => {
    let disk: unknown; let saves = 0;
    const persistence = { read: async () => { if (!disk) throw Object.assign(new Error(), { code: 'ENOENT' }); return disk; }, write: async (v: unknown) => { if (++saves === 4) throw new Error('disk'); disk = structuredClone(v); } };
    const p = preview(), x = setup(p, persistence); await x.service.propose(p.query);
    const selected = await x.service.act('c', p.id, { action: 'select', slotId: p.slots[0].id });
    const input = { action: 'confirm' as const, selectionId: selected.selection!.id, choice: { title: 'Moja wizyta', endAt: p.slots[0].startAt + 45 * 60_000 } };
    await expect(x.service.act('c', p.id, input)).rejects.toMatchObject({ status: 503 });
    const restored = createAppointments(x.options);
    expect((await restored.view('c', p.id))).toMatchObject({ writeStarted: true, selection: { draft: { title: 'Moja wizyta', endAt: input.choice.endAt } } });
    await expect(restored.act('c', p.id, { ...input, choice: { title: 'Different' } })).rejects.toMatchObject({ status: 409 });
    await restored.act('c', p.id, input);
    expect(x.writeCalendar).toHaveBeenCalledTimes(2);
    expect(x.writeCalendar.mock.calls[0]).toEqual(x.writeCalendar.mock.calls[1]);
  });
  it('does not infer missing duration; accepts a valid end explicitly chosen by the user', async () => {
    const p: AppointmentPreview = { ...preview(), durationMinutes: null }; const x = setup(p); await x.service.propose(p.query);
    const view = await x.service.act('c', p.id, { action: 'select', slotId: p.slots[0].id }); expect(view.selection?.draft).toBeNull();
    await expect(x.service.act('c', p.id, { action: 'confirm', selectionId: view.selection!.id })).rejects.toMatchObject({ status: 400 });
    await x.service.act('c', p.id, { action: 'confirm', selectionId: view.selection!.id, choice: { endAt: p.slots[0].startAt + 45 * 60_000 } });
    expect(x.writeCalendar.mock.calls[0][1].endAt).toBe(p.slots[0].startAt + 45 * 60_000);
  });
  it('keeps a corrupted private store closed and applies a generic calendar proposal only once', async () => {
    const broken = setup(preview(), { read: async () => ({ broken: true }), write: vi.fn() });
    await expect(broken.service.propose(preview().query)).rejects.toMatchObject({ status: 503 }); expect(broken.writeCalendar).not.toHaveBeenCalled();
    const x = setup(), plan = { title: 'Przegląd roweru', start: '2026-11-05T16:00:00+01:00', end: '2026-11-05T17:00:00+01:00' };
    expect((await x.service.calendarView('chat:calendar', plan)).saved).toBeNull(); expect(x.writeCalendar).not.toHaveBeenCalled();
    await Promise.all([x.service.calendarConfirm('chat:calendar', plan), x.service.calendarConfirm('chat:calendar', plan)]);
    expect(x.writeCalendar).toHaveBeenCalledTimes(1);
  });
});
