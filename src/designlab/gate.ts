/** DesignLab is on only when the scenario preview was started with it (`__DESIGNLAB__`, set in scripts/scenario-runtime.ts). */
export function designLabName(enabled: boolean, search: string): string | null {
  if (!enabled) return null;
  const name = new URLSearchParams(search).get('designlab');
  return name === null ? null : name.trim();
}
