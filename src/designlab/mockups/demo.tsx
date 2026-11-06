import { useState } from 'react';
import { ListTodo } from 'lucide-react';
import { Card, Empty, SourceLink, SourceNote, TaskRow } from '../../components';
import { MAX_AGE, taskLabels, type Detail } from '../../model';
import { stamp } from '../../format';
import { useCezar } from '../../useCezar';

/** Demo: a list card beside a detail card, built only from the app's own components, on scenario data. */
export default function Demo() {
  const cezar = useCezar();
  const tasks = cezar.source.data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const open = (detail: Detail) => { if (detail.kind === 'task') setSelected(detail.id); };
  const task = tasks.find(t => t.id === selected);
  return (
    <div className="designlab-demo">
      <Card title="Zadania Cezara" eyebrow="DEMO" icon={<ListTodo />}>
        {tasks.length ? tasks.map(t => <TaskRow key={t.id} task={t} open={open} />) : <Empty>Brak zadań w scenariuszu.</Empty>}
      </Card>
      <Card title={task?.title ?? 'Szczegół'} icon={<ListTodo />}>
        {task ? <>
          <span className={`badge ${task.status}`}>{taskLabels[task.status]}</span>
          <p className="detail-copy">{task.description}</p>
          <dl>
            <dt>Projekt</dt><dd>{task.project}</dd>
            <dt>Stan sprawdzony</dt><dd>{stamp(task.checkedAt)}</dd>
          </dl>
          <SourceLink url={task.sourceUrl} />
        </> : <Empty>Wybierz zadanie z listy.</Empty>}
        <SourceNote source={cezar.source} now={Date.now()} maxAge={MAX_AGE.tasks} />
      </Card>
    </div>
  );
}
