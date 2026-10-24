import { ListChecks } from 'lucide-react';
import { Card } from './components';
import { EVENT_RULES } from './event-rules';
import { ACTIVITY_LIMIT } from './activity-log';
import { QUOTA_PACE_TOLERANCE, QUOTA_PACE_WARNING } from './quota-pace';

export function EventRulesView() {
  const rules = [
    ['Cezar · pytanie', 'Zadanie wymaga Twojej odpowiedzi.', 'Po ustąpieniu i ponownym wystąpieniu.'],
    ['Cezar · zakończenie', `Wykryto zadanie zakończone w ostatnich ${EVENT_RULES.completedWithinMinutes} minutach.`, 'Raz na dane zakończenie zadania.'],
    ['Kalendarz · spotkanie', `Spotkanie zaczyna się za 0–${EVENT_RULES.meetingWithinMinutes} minut. Bez wydarzeń całodniowych.`, 'Raz na termin spotkania.'],
    ['AI · żółte tempo', `Zużycie wyprzedza czas o ponad ${QUOTA_PACE_TOLERANCE} do ${QUOTA_PACE_WARNING} p.p.`, 'Raz w oknie resetu; spadek z czerwonego nie tworzy wpisu.'],
    ['AI · czerwone tempo', `Zużycie wyprzedza czas o ponad ${QUOTA_PACE_WARNING} p.p.`, 'Raz w oknie resetu, także po usuniętym żółtym.'],
    ['AI · mało limitu', `Wykorzystano co najmniej ${EVENT_RULES.quotaHighPercent}% limitu, niezależnie od koloru tempa.`, 'Raz w oknie resetu.'],
    ['System · RAM', `RAM ≥${EVENT_RULES.ramHighPercent}% przez co najmniej ${EVENT_RULES.ramForMinutes} minutę.`, `Po spadku poniżej ${EVENT_RULES.ramHighPercent}% i kolejnym utrzymaniu progu.`],
    ['System · CPU', `CPU ≥${EVENT_RULES.cpuHighPercent}% przez co najmniej ${EVENT_RULES.cpuForMinutes} minuty. Krótki skok nie tworzy wpisu.`, `Po spadku poniżej ${EVENT_RULES.cpuHighPercent}% i kolejnym utrzymaniu progu.`],
  ];
  return <Card title="Reguły tworzenia" eyebrow="AKTUALNE ZASADY" icon={<ListChecks />}>
    <p className="card-intro">Wpis powstaje po wykryciu warunku w świeżych danych. Limity AI liczymy osobno dla Claude i Codex oraz okien 5h i 7d.</p>
    <table className="event-rules-table">
      <caption className="sr-only">Aktualne reguły tworzenia zdarzeń</caption>
      <thead><tr><th scope="col">Zdarzenie</th><th scope="col">Kiedy powstaje</th><th scope="col">Kiedy ponownie</th></tr></thead>
      <tbody>{rules.map(([name, condition, repeat]) => <tr key={name}>
        <th scope="row">{name}</th><td>{condition}</td><td>{repeat}</td>
      </tr>)}</tbody>
    </table>
    <div className="event-rules-notes">
      <h3>Historia i usuwanie</h3>
      <p className="meta">Ostatnie {ACTIVITY_LIMIT} wpisów zapisujemy w tej przeglądarce. Restart serwera i odświeżenie strony zachowują historię oraz pamięć zgłoszonych alertów.</p>
      <p className="meta">Przesunięcie wpisu w bok usuwa go. „Cofnij” działa przez {EVENT_RULES.undoSeconds} sekund. Usunięcie wpisu nie ponawia alertu.</p>
      <p className="meta">Panel wykrywa zdarzenia tylko podczas działania. Stare dane i utrata połączenia nie tworzą nowych wpisów ani nie potwierdzają ustąpienia problemu.</p>
    </div>
  </Card>;
}
