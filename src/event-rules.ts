/** Shared by event detection and the read-only rules view. */
export const EVENT_RULES = {
  completedWithinMinutes: 10,
  meetingWithinMinutes: 15,
  quotaHighPercent: 90,
  ramHighPercent: 90,
  ramForMinutes: 1,
  cpuHighPercent: 90,
  cpuForMinutes: 2,
  undoSeconds: 6,
} as const;
