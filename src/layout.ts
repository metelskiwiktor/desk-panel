export const widgetNames = {
  cezar: 'Cezar',
  system: 'Komputer · kafelek oraz CPU i RAM w pasku',
  calendar: 'Kalendarz · dziś i kolejne dni',
  training: 'Trening (Garmin Connect)',
  quotas: 'Limity AI · kafelki (które, wybierasz niżej)',
  breakdown: 'Podział zużycia AI',
  insights: 'Zdarzenia panelu',
  mail: 'Poczta',
  todo: 'Zadania · listy do zrobienia (kafelków może być kilka)',
  bank: 'Konto bankowe · saldo i ostatnie operacje',
  'smart-actions': 'Smart Actions · szybkie akcje z poczty i alertów',
  automations: 'Automaty',
} as const;
export type WidgetId = keyof typeof widgetNames;
/** Order, displayMode and priority are kept from earlier layouts; the dashboard sizes sections by content. */
export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  displayMode: 'compact' | 'expanded';
  priority: 'normal' | 'high';
}
export interface Layout {
  version: 2;
  widgets: WidgetConfig[];
}
export const STORAGE_KEY = 'desk-panel.layout';
/** Cards that no longer exist; a layout saved with them still loads, without them. */
const RETIRED_WIDGETS = ['ambient'];
export function defaultLayout(): Layout {
  return {
    version: 2,
    widgets: (Object.keys(widgetNames) as WidgetId[]).map((id) => ({
      id,
      visible: true,
      displayMode: 'expanded',
      priority: id === 'cezar' ? 'high' : 'normal',
    })),
  };
}
export function parseLayout(raw: string | null): Layout {
  try {
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw);
    // v1 stored the ordered visible IDs only. Missing IDs migrate as hidden.
    if (
      parsed.version === 1 &&
      Array.isArray(parsed.order) &&
      (parsed.order = parsed.order.filter((id: unknown) => !RETIRED_WIDGETS.includes(id as string))).every(
        (id: unknown) => typeof id === 'string' && Object.hasOwn(widgetNames, id),
      ) &&
      new Set(parsed.order).size === parsed.order.length
    ) {
      const defaults = defaultLayout().widgets;
      return {
        version: 2,
        widgets: [
          ...parsed.order.map((id: WidgetId) => defaults.find((w) => w.id === id)!),
          ...defaults
            .filter((w) => !parsed.order.includes(w.id))
            .map((w) => ({ ...w, visible: false })),
        ],
      };
    }
    if (parsed.version !== 2 || !Array.isArray(parsed.widgets)) return defaultLayout();
    parsed.widgets = parsed.widgets.filter((w: WidgetConfig) => !RETIRED_WIDGETS.includes(w?.id));
    const valid = parsed.widgets.every(
      (w: WidgetConfig) =>
        w &&
        Object.hasOwn(widgetNames, w.id) &&
        typeof w.visible === 'boolean' &&
        ['compact', 'expanded'].includes(w.displayMode) &&
        ['normal', 'high'].includes(w.priority),
    );
    if (!valid || new Set(parsed.widgets.map((w: WidgetConfig) => w.id)).size !== parsed.widgets.length)
      return defaultLayout();
    // Cards added after the layout was saved are appended, visible, keeping the user's order.
    const saved = new Set(parsed.widgets.map((w: WidgetConfig) => w.id));
    return {
      version: 2,
      widgets: [
        ...parsed.widgets.map((w: WidgetConfig) => ({
          id: w.id,
          visible: w.visible,
          displayMode: w.displayMode,
          priority: w.priority,
        })),
        ...defaultLayout().widgets.filter((w) => !saved.has(w.id)),
      ],
    };
  } catch {
    return defaultLayout();
  }
}
export function readLayout(): Layout {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultLayout();
  }
}
export function saveLayout(layout: Layout): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}
