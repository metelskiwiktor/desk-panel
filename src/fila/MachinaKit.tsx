import { Cog, MessageSquare } from 'lucide-react';
import { z } from 'zod';
import { describeTrigger } from '../automation-contract';
import { MACHINA_BLOCK_LABELS, machinaConversationsSchema, machinaJournalSchema, machinaProgramSchema, type MachinaBlock } from '../machina-contract';
import { openChatConversation } from '../useChatPresentation';
import { useFilaGet, type FilaMachinaKitDoc, type FilaThreadDoc } from './api';

const when = (at: number) => new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const BY: Record<string, string> = { user: 'Ty', wektor: 'Wektor', panel: 'Panel' };
const RESULT: Record<string, string> = { ok: 'wykonany', error: 'błąd', pending: 'niepotwierdzony', waiting: 'czeka na rozmowę', skipped: 'pominięty' };
const RUN: Record<string, string> = { running: 'trwa', evaluating: 'ocena Wektora', waiting: 'czeka na kartę', ok: 'bez błędów', error: 'błąd' };
/** What a block does, in one line, from its own settings. */
const blockLine = (block: MachinaBlock) => {
  switch (block.kind) {
    case 'fetch': return block.url;
    case 'extract': return `z „${block.from}”${block.after ? `, po „${block.after}”` : ''}${block.before ? `, przed „${block.before}”` : ''}`;
    case 'message': case 'resume': return block.text;
    case 'finish': return 'po tym klocku automat jest zakończony';
    case 'compare': return `wycinek „${block.from}” z katalogiem sytuacji`;
    default: return [block.title, 'when' in block ? block.when : '', block.domain ? `linki: ${block.domain}` : ''].filter(Boolean).join(' · ');
  }
};
/** What this page shows of the catalogue; a part in another shape is said to be unreadable instead of breaking the page. */
const situationsView = z.object({ items: z.array(z.object({ id: z.string(), name: z.string().optional(), withdrawn: z.unknown().optional(), samples: z.array(z.unknown()).optional() }).passthrough()) });
const Missing = ({ children }: { children: string }) => <p className="fl-muted fl-machina-missing">Brak treści: {children}</p>;

/**
 * The Machina kit of an automat on its thread page: program, situations, journal and conversations, read by the thread's
 * ID (docs/fila.md, „Machina: dom automatu”). Read-only here: only Machina's card and the user's direct actions change it.
 */
export function MachinaKit({ thread }: { thread: FilaThreadDoc }) {
  const kit = useFilaGet<FilaMachinaKitDoc>(`/api/fila/threads/${thread.id}/machina`);
  const data = kit.data;
  const program = data?.program.available ? machinaProgramSchema.safeParse(data.program.content) : null;
  const journal = data?.journal.available ? machinaJournalSchema.safeParse(data.journal.content) : null;
  const conversations = data?.conversations.available ? machinaConversationsSchema.safeParse(data.conversations.content) : null;
  const current = program?.success ? program.data.versions.find(v => v.number === program.data.current) : undefined;
  const runs = journal?.success ? [...journal.data.runs].reverse() : [];
  const situations = data?.situations.available ? situationsView.safeParse(data.situations.content) : null;
  const unreadable = <p className="fl-error" role="alert">Tej części nie da się odczytać w znanym kształcie.</p>;

  return <section className="fl-block fl-machina" aria-label="Zestaw Machiny">
    <header className="fl-block-head"><Cog size={16} aria-hidden="true" /><h2>Zestaw Machiny</h2><span className="fl-count">tylko do odczytu{thread.machina?.builtIn ? ' · wbudowany' : ''}</span></header>
    {kit.error && <p className="fl-error" role="alert">{kit.error}</p>}
    {!data && !kit.error && <p className="fl-muted">Ładowanie zestawu…</p>}
    {data && <>
      <section className="fl-machina-part" aria-label="Program">
        <h3>Program</h3>
        {!data.program.available ? <Missing>program powstanie po zatwierdzeniu karty programu.</Missing> : !program?.success || !current ? unreadable : <>
          <p className="fl-byline">Wersja {current.number} z {program.data.versions.length} · {BY[current.by] ?? current.by} · {current.reason} · {when(current.at)}</p>
          <p>{describeTrigger(current.trigger)}{program.data.nextRunAt ? ` · następny run ${when(program.data.nextRunAt)}` : ' · nic nie jest zaplanowane'}</p>
          <ol className="fl-machina-blocks">{current.blocks.map(block => <li key={block.id}><b>{MACHINA_BLOCK_LABELS[block.kind]}</b> <code>{block.id}</code><span>{blockLine(block)}</span></li>)}</ol>
          {(current.scope.domains.length > 0 || current.scope.resumeChats.length > 0) && <p className="fl-muted">Zatwierdzony zakres: {[current.scope.domains.length ? `odczyt z ${current.scope.domains.join(', ')}` : '', current.scope.resumeChats.length ? `wznawianie ${current.scope.resumeChats.length} wskazanych rozmów` : ''].filter(Boolean).join('; ')}</p>}
        </>}
      </section>
      <section className="fl-machina-part" aria-label="Sytuacje">
        <h3>Sytuacje</h3>
        {!data.situations.available || (situations?.success && !situations.data.items.length) ? <Missing>ten automat nie ma jeszcze katalogu sytuacji.</Missing> : !situations?.success ? unreadable
          : <ul className="fl-machina-list">{situations.data.items.map(item => <li key={item.id}><b>{item.name ?? item.id}</b><span>{item.withdrawn ? 'wycofana' : `${item.samples?.length ?? 0} próbek`}</span></li>)}</ul>}
      </section>
      <section className="fl-machina-part" aria-label="Dziennik">
        <h3>Dziennik</h3>
        {!data.journal.available || (journal?.success && !runs.length) ? <Missing>żaden run jeszcze się nie odbył.</Missing> : !journal?.success ? unreadable
          : <ul className="fl-machina-list">{runs.slice(0, 30).map(run => <li key={run.id}>
            <b>{when(run.startedAt)}</b><span>{run.manual ? 'uruchomiony ręcznie' : 'według harmonogramu'} · wersja {run.version} · {RUN[run.state] ?? run.state}{run.error ? `: ${run.error}` : ''}</span>
            <ul>{run.blocks.map(block => <li key={block.id}><code>{block.id}</code> {RESULT[block.result] ?? block.result}{block.error ? `: ${block.error}` : block.title ? `: ${block.title}` : block.text ? `: ${block.text}` : ''}</li>)}</ul>
          </li>)}</ul>}
        {runs.length > 30 && <p className="fl-muted">Pokazano 30 najnowszych z {runs.length} runów.</p>}
      </section>
      <section className="fl-machina-part" aria-label="Rozmowy">
        <h3>Rozmowy</h3>
        {!data.conversations.available || (conversations?.success && !conversations.data.items.length) ? <Missing>z tym automatem nie jest powiązana żadna rozmowa.</Missing> : !conversations?.success ? unreadable
          : <ul className="fl-machina-list">{conversations.data.items.map(item => <li key={`${item.chatId}:${item.at}`}>
            <button type="button" className="fl-linkish" aria-label={`Otwórz rozmowę: ${item.reason}`} onClick={() => openChatConversation(item.chatId)}><MessageSquare size={14} aria-hidden="true" /> {item.reason}</button><span>{when(item.at)}</span>
          </li>)}</ul>}
      </section>
    </>}
  </section>;
}
