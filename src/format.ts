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

export interface ElapsedInfo {
  text: string;
  isLong: boolean;
  hours: number;
  minutes: number;
  seconds: number;
}

export function formatElapsed(startAt?: number, now = Date.now()): ElapsedInfo | null {
  if (!startAt) return null;
  const s = Math.max(0, Math.floor((now - startAt) / 1000));
  const remSec = s % 60;
  const m = Math.floor(s / 60);
  const remMin = m % 60;
  const h = Math.floor(m / 60);

  if (h > 0) {
    return {
      text: `${h} godz. ${remMin} min`,
      isLong: true,
      hours: h,
      minutes: remMin,
      seconds: remSec,
    };
  }
  if (m > 0) {
    return {
      text: `${m} min ${remSec} s`,
      isLong: false,
      hours: 0,
      minutes: m,
      seconds: remSec,
    };
  }
  return {
    text: `${s} s`,
    isLong: false,
    hours: 0,
    minutes: 0,
    seconds: s,
  };
}

export function cleanCommand(raw?: string): string {
  if (!raw) return '';
  let cmd = raw.trim();

  // Strip PowerShell execution wrappers (e.g. pwsh.exe -Command '...')
  const pwshPattern = /^(?:"[^"]*p(?:wsh|owershell)\.exe"|p(?:wsh|owershell)(?:\.exe)?)\s+.*-(?:Command|c)\s+(?:'([\s\S]*)'|"([\s\S]*)"|([\s\S]*))$/i;
  const match = cmd.match(pwshPattern);
  if (match) {
    cmd = (match[1] ?? match[2] ?? match[3] ?? cmd).trim();
  }

  // Clean quote concatenation artifacts like '"', '", "', or \"
  cmd = cmd.replace(/'"'/g, '"');
  cmd = cmd.replace(/'"|"'|\\"/g, '"');
  cmd = cmd.replace(/'(?=;)/g, '"');
  cmd = cmd.replace(/';\s*"?/g, '; ');
  cmd = cmd.replace(/;'\s*$/g, ';');
  cmd = cmd.replace(/'\s*$/g, '');

  // Collapse multiple newlines into single line
  cmd = cmd.replace(/\r?\n\s*/g, ' ; ');
  cmd = cmd.replace(/\s*;\s*/g, '; ').trim();

  return cmd;
}

export function formatModelName(model: string): string {
  if (!model) return '';
  const trimmed = model.trim();
  // Bare aliases always point at the newest model, so no version is claimed.
  if (trimmed === 'sonnet') return 'Claude Sonnet';
  if (trimmed === 'opus') return 'Claude Opus';
  if (trimmed === 'haiku') return 'Claude Haiku';
  if (trimmed === 'claude-3-7-sonnet' || trimmed === 'claude-3-7-sonnet-latest') {
    return 'Claude 3.7 Sonnet';
  }
  if (trimmed === 'claude-3-opus') return 'Claude 3 Opus';
  if (trimmed === 'claude-3-5-haiku') return 'Claude 3.5 Haiku';
  const claude = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?(?:-\d{8})?$/.exec(trimmed);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  if (trimmed.includes('gemini-3.8-flash') || trimmed.includes('gemini-2.5-flash')) {
    return 'Gemini 3.8 Flash';
  }
  return trimmed;
}

export function formatModelLabel(runner?: string, model?: string): string {
  if (!runner && !model) return '';
  if (!model) return runner || '';
  if (!runner) return formatModelName(model);

  const cleanModel = formatModelName(model);
  const lowerRunner = runner.toLowerCase();
  const lowerModel = cleanModel.toLowerCase();

  if (lowerModel.includes(lowerRunner)) {
    return cleanModel;
  }
  return `${runner} · ${cleanModel}`;
}


/** A running task's model: the real one, or an explicit "unknown" when the session never reported it. */
export function formatRunningModel(runner?: string, model?: string): string {
  if (model) return formatModelLabel(runner, model);
  return runner ? `${runner} · ? nieznany model` : '? nieznany model';
}

/** "przed chwilą", "5 min temu", "3 godz. temu" within a day; older than that "23 paź 15:47". */
export function agoOrDate(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1 && now >= at - 60_000) return 'przed chwilą';
  if (minutes < 60 && minutes >= 0) return `${minutes} min temu`;
  if (minutes < 24 * 60 && minutes >= 0) return `${Math.floor(minutes / 60)} godz. temu`;
  return `${new Date(at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} ${time(at)}`;
}
