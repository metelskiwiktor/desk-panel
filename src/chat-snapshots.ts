/** Small, in-memory, conversation-scoped read snapshots; never persisted or shared between windows. */
export function rememberSnapshot<T>(cache: Map<string, T>, id: string, value: T, limit = 8) {
  cache.delete(id);
  cache.set(id, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value!);
}
