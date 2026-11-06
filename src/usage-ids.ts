/**
 * Technical ids for the usage store (docs/uzycie.md): lower-case letters, digits and dashes only. A limit is `claude` or
 * `codex`; an Antigravity model group is `agy-` and a hash, so no name taken from the provider is written. Other kinds
 * (`mail`, `todo`, `github-pr`) are already such ids.
 */
const SLUG = /^[a-z0-9-]{1,30}$/;
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}
export function usageKind(kind: string): string {
  if (kind === 'quota:Claude') return 'claude';
  if (kind === 'quota:Codex') return 'codex';
  if (kind.startsWith('quota:agy:')) return `agy-${hash(kind.slice('quota:agy:'.length))}`;
  if (SLUG.test(kind)) return kind;
  return `other-${hash(kind)}`;
}
/** The id of a placed tile: its kind's id, with the `#n` of a repeating widget (`todo#2`) kept. */
export function usageTile(id: string): string {
  const cut = id.indexOf('#');
  return cut < 0 ? usageKind(id) : `${usageKind(id.slice(0, cut))}${id.slice(cut).replace(/[^0-9#]/g, '').slice(0, 8)}`;
}
