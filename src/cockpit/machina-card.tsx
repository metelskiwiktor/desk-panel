import { useContext, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { describeTriggerRange } from '../automation-contract';
import { MACHINA_BLOCK_LABELS, machinaCardSchema, machinaCorrectionSchema, machinaOutcomeSchema, machinaSituationCardSchema, type MachinaBlock } from '../machina-contract';
import { CardActions } from './cards';
import { ConsentShell } from './consent-card';

export type MachinaCardKind = 'machina' | 'machinaSituation' | 'machinaCorrection';
type Args = Record<string, unknown>;

function Blocks({ blocks }: { blocks: MachinaBlock[] }) {
  return blocks.length ? <ol className="tw:m-0 tw:grid tw:gap-2 tw:pl-5">{blocks.map(block => <li key={block.id}>
    <b>{MACHINA_BLOCK_LABELS[block.kind]}</b>
    <dl className="tw:m-0 tw:text-xs tw:whitespace-pre-wrap tw:break-all">{Object.entries(block).filter(([key]) => key !== 'id' && key !== 'kind').map(([key, value]) => <div key={key}><dt className="tw:inline tw:text-ck-muted">{FIELD_LABELS[key] ?? key}: </dt><dd className="tw:inline tw:m-0">{String(value)}</dd></div>)}</dl>
  </li>)}</ol> : <p className="tw:m-0">Bez działań.</p>;
}
const FIELD_LABELS: Record<string, string> = { url: 'Adres', domain: 'Domena linku', from: 'Z klocka', after: 'Po tekście', before: 'Przed tekstem', text: 'Treść', title: 'Tytuł', chat: 'Rozmowa', when: 'Termin', reminderMinutes: 'Przypomnienie (min)', allDay: 'Cały dzień' };

/** Every value rendered below has passed the same contract as the server; refusals are inert cards, not render errors. */
export function MachinaCard({ kind, toolCallId, args, result }: ToolCallMessagePartProps<Args, unknown> & { kind: MachinaCardKind }) {
  const { respond, running, superseded } = useContext(CardActions);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const { refused, ...raw } = args;
  const program = kind === 'machina' ? machinaCardSchema.safeParse(raw) : null;
  const situation = kind === 'machinaSituation' ? machinaSituationCardSchema.safeParse(raw) : null;
  const correction = kind === 'machinaCorrection' ? machinaCorrectionSchema.safeParse(raw) : null;
  const valid = !!(program?.success || situation?.success || correction?.success);
  const outcome = machinaOutcomeSchema.safeParse(result);
  const decided = outcome.success ? outcome.data : null;
  const refusal = typeof refused === 'string' ? refused : '';
  const identifiable = toolCallId.includes(':') && !toolCallId.startsWith('pending:');
  const answer = async (decision: 'accept' | 'reject') => {
    setSending(true); setError('');
    try { await respond(toolCallId, { kind: 'machina', decision }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  const label = kind === 'machina' ? 'Program Machiny' : kind === 'machinaSituation' ? 'Nowa sytuacja Machiny' : 'Poprawka oceny Machiny';
  return <ConsentShell label={label} heading={label}
    subtitle={program?.success ? program.data.title ?? program.data.automat ?? '' : situation?.success ? situation.data.name : correction?.success ? correction.data.automat : ''}
    notices={refusal ? <p role="alert">Panel nie przyjął propozycji: {refusal}</p> : !valid ? <p role="alert">Agent przysłał niepoprawną propozycję Machiny. Poproś o nową kartę.</p> : undefined}
    body={<>
      {program?.success && <div className="tw:grid tw:gap-3">
        {program.data.automat && <p className="tw:m-0">Nowa wersja programu: {program.data.automat} (także naprawa).</p>}
        {program.data.description && <p className="tw:m-0 tw:whitespace-pre-wrap">{program.data.description}</p>}
        {(program.data.module || program.data.tags?.length || program.data.parent) && <p className="tw:m-0">{program.data.module && `Moduł: ${program.data.module}. `}{program.data.tags?.length ? `Tagi: ${program.data.tags.join(', ')}. ` : ''}{program.data.parent && `Rodzic: ${program.data.parent}.`}</p>}
        <p className="tw:m-0">Kiedy: {describeTriggerRange(program.data.trigger)}</p>
        <p className="tw:m-0 tw:break-all">Domeny odczytu: {program.data.scope.domains.join(', ') || 'brak'}. Inne rozmowy do wznowienia: {program.data.scope.resumeChats.join(', ') || 'brak'}.</p>
        <Blocks blocks={program.data.blocks} />
        {program.data.situations.map(s => <div key={s.id}><b>{s.name}</b>{s.note && <p className="tw:m-0">{s.note}</p>}{s.samples?.map((sample, i) => <blockquote key={i}>{sample}</blockquote>)}</div>)}
        {Object.entries(program.data.reactions).map(([id, blocks]) => <div key={id}><b>Reakcja: {program.data.situations.find(s => s.id === id)?.name ?? id}</b><Blocks blocks={blocks} /></div>)}
      </div>}
      {situation?.success && <div className="tw:grid tw:gap-3"><p className="tw:m-0">{situation.data.note}</p><p className="tw:m-0">Po zgodzie reakcja wykona się w przebiegu {situation.data.runId}.</p><Blocks blocks={situation.data.reaction} /></div>}
      {correction?.success && <p className="tw:m-0">Przenieś próbkę przebiegu {correction.data.runId} z sytuacji {correction.data.from} do {correction.data.to}.{correction.data.withdraw && ' Wycofaj poprzednią sytuację.'}</p>}
    </>}
    footnote={!decided && valid && !refusal ? <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Zmiana nastąpi dopiero po zatwierdzeniu tej karty.</p> : undefined}
    outcome={decided ? <p role="status">{decided.decision === 'rejected' ? 'Odrzucono propozycję.' : `Zapisano decyzję${decided.thread ? ` · ${decided.thread}` : ''}${decided.version ? ` · wersja ${decided.version}` : ''}.`}</p> : undefined}
    applyLabel={kind === 'machina' ? 'Zatwierdź program' : kind === 'machinaSituation' ? 'Zatwierdź sytuację' : 'Zatwierdź poprawkę'}
    canApply={valid && !refusal && identifiable && !running} canReject={identifiable && !running}
    onApply={() => void answer('accept')} onReject={() => void answer('reject')} sending={sending} error={error}
    stale={!decided && superseded?.has(toolCallId)} />;
}
