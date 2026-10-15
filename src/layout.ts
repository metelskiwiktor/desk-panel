export const widgetNames = {
  cezar: 'Cezar',
  system: 'System',
  calendar: 'Kalendarz Google',
  quotas: 'Limity AI',
  insights: 'Zdarzenia',
  mail: 'Poczta',
} as const;
export type WidgetId = keyof typeof widgetNames;
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
      parsed.order.every(
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
export function moveWidget(layout: Layout, id: WidgetId, direction: -1 | 1): Layout {
  const widgets = [...layout.widgets];
  const index = widgets.findIndex((w) => w.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= widgets.length) return layout;
  [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
  return { version: 2, widgets };
}
