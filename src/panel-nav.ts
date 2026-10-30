/** Ask the panel to open one of its pages (a card's link, without reloading the window). */
export const PANEL_NAVIGATE = 'desk-panel:navigate';
export type PanelPage = 'home' | 'tasks' | 'calendar' | 'system' | 'events' | 'automations' | 'settings';

export function openPanelPage(page: PanelPage) {
  window.dispatchEvent(new CustomEvent(PANEL_NAVIGATE, { detail: page }));
}
