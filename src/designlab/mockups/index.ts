import type { ComponentType } from 'react';

/** Named mockups: a file in this folder plus one line here. They read the scenario API like the real screens. */
export const mockups: Record<string, () => Promise<{ default: ComponentType }>> = {
  demo: () => import('./demo'),
  fila: () => import('./fila'),
  machina: () => import('./machina'),
};
