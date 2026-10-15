export const time = (n: number) =>
  new Date(n).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false });
export const stamp = (n: number) =>
  new Date(n).toLocaleString('pl-PL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export const date = (n: number) =>
  new Date(n).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
export const number = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
export const preciseStamp = (n: number) => new Date(n).toLocaleString('pl-PL', {
  day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
});

/** Google all-day end dates are exclusive; present inclusive dates to the user. */
export function allDayDate(start: string, end: string): string {
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`) - 86_400_000;
  const format = (n: number) => new Date(n).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return first === last ? format(first) : `${format(first)} — ${format(last)}`;
}
