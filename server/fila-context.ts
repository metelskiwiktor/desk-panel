import { filaSkillItem, type ContextItem } from '../src/chat-contract';
import { FilaError, type FilaStore } from './fila';

export async function resolveLegacyThread(id: string, fila: FilaStore) {
  if (!/^t-[0-9a-f]{8}$/.test(id)) return id;
  const projects = (await fila.registries()).projects.map(project => project.key);
  const found = (await Promise.all(projects.map(project => fila.query(`projekt = ${project} AND pole("Dawne ID") = ${JSON.stringify(id)} AND archiwum = włącz`)))).flatMap(result => result.threads);
  if (found.length !== 1) throw new FilaError(found.length ? 409 : 404, `Dawne ID ${id} nie wskazuje dokładnie jednego wątku.`);
  return found[0].id;
}

/** Resolve historical list references at send time; stored messages and their original context are untouched. */
export async function resolveFilaContext(items: ContextItem[], fila: FilaStore): Promise<ContextItem[]> {
  const projects = (await fila.registries()).projects.map(project => project.key);
  return Promise.all(items.map(async item => {
    if (item.kind === 'skill') return filaSkillItem(item);
    if (item.kind === 'todo' && /^t-[0-9a-f]{8}$/.test(item.id)) {
      const thread = await fila.thread(await resolveLegacyThread(item.id, fila));
      return { kind: 'filaThread' as const, id: thread.id, title: thread.title, text: `Dawne ID: ${item.id}\nID wątku: ${thread.id}\nStan: ${thread.state}\nPełny wątek: fila_get.` };
    }
    if (item.kind === 'todoList' && /^l-[0-9a-f]{8}$/.test(item.id)) {
      const queries = projects.map(project => `projekt = ${project} AND pole("Dawna lista") = ${JSON.stringify(item.id)} AND archiwum = włącz`);
      const results = await Promise.all(queries.map(query => fila.query(query, { limit: 1 })));
      const nonempty = queries.filter((_, index) => results[index].total > 0);
      return { kind: 'filaQuery' as const, id: item.id, title: item.title,
        text: nonempty.length ? `Dawna lista ${item.id}; zakresy w Fili:\n${nonempty.join('\n')}` : `Dawna lista ${item.id} nie ma obecnie wątków w Fili.` };
    }
    return item;
  }));
}
