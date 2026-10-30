import { join, resolve } from 'node:path';
import type { Page } from 'playwright';

/** Fail immediately on an uncaught page exception. Expected HTTP/console errors in offline scenarios are separate. */
export async function withPageErrors<T>(page: Pick<Page, 'on' | 'off'>, work: () => Promise<T>): Promise<T> {
  let reject!: (error: Error) => void;
  const failure = new Promise<never>((_, fail) => { reject = fail; });
  const onError = (error: Error) => reject(new Error(`Błąd JavaScript strony: ${error.message}`, { cause: error }));
  page.on('pageerror', onError);
  try { return await Promise.race([Promise.resolve().then(work), failure]); }
  finally { page.off('pageerror', onError); }
}

const slug = (value: string) => value.replace(/[^a-z0-9_@.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'view';

export function screenshotPath(options: { out: string; file?: string; label: string; page: string; target: string; open?: string; query?: string; hermes?: string; stage?: string }) {
  if (options.file && !options.stage) return resolve(options.file);
  const name = [options.label, options.page, options.open, options.query, options.hermes === 'down' ? 'hermes-down' : undefined, options.stage, options.target].filter(Boolean).map(value => slug(value!)).join('-');
  return join(options.out, `${name}.png`);
}

export function validateSingleScreenshot(file: string | undefined, targets: number, pages: number) {
  if (file && targets * pages !== 1) throw new Error('--file wymaga jednej strony i jednego ekranu/skalowania. Dla wielu zrzutów użyj --out.');
}
