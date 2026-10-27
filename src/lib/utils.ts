import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** Tailwind classes of the cockpit carry the `tw:` prefix (src/cockpit/cockpit.css): merge them knowing that. */
const merge = extendTailwindMerge({ prefix: 'tw' });

/** shadcn's class helper: joins conditional classes, later Tailwind utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
