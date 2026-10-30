import { z } from 'zod';

/** What the user pointed at on the dashboard: one row (mail, task, meeting, workout), a whole tile, or a skill picked with `@`. */
export const contextKinds = ['mail', 'event', 'task', 'workout', 'tile', 'todoList', 'todo', 'skill', 'smartAction', 'smartRule', 'bankOp'] as const;
export type ContextKind = typeof contextKinds[number];
export const contextItemSchema = z.object({
  kind: z.enum(contextKinds),
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  /** What the user sees (or the row's data / skill instructions), as plain text. Never more than the agent should read at once. */
  text: z.string().max(8000),
}).strict();
export type ContextItem = z.infer<typeof contextItemSchema>;

export interface ChatSkill {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

/**
 * How Wektor talks about the bank account (the skill „Bank”, and the same lines in Hermes's preamble so it works without picking
 * the skill). Each line answers something Wektor did in a test conversation (scripts/wektor-test.mjs), so a change here is
 * tried the same way: the conversation is meant to feel like talking to someone who knows the data, not like a report.
 * General rules only: no name, amount, category or answer of a test case belongs in a line, or the case can no longer show
 * what Wektor judges by itself.
 */
export const BANK_GUIDE: readonly string[] = [
  'Rozmowa o koncie bankowym (PKO BP, oznaczenia użytkownika): jak z doradcą, który zna dane. Najpierw opinia, potem dowód na karcie.',
  '- Czytanie: zanim cokolwiek ocenisz albo policzysz, pobierz panel_bank z całą potrzebną historią (from rok wstecz; jedno zapytanie obejmuje do 400 dni), nie z domyślnych 30 dni. W odpowiedzi powiedz, z jakiego zakresu dat i ilu operacji wnioskujesz.',
  '- Opinia: na „co uważasz” zacznij od werdyktu w jednym zdaniu i podaj powód z liczb (ile operacji, jakie sumy, jak często, czy cykliczne). Nie zmieniaj werdyktu w środku odpowiedzi. Werdyktem może być też „trudno ocenić”, gdy danych jest za mało; wtedy nie podawaj prognoz ani przeliczeń na miesiąc czy rok.',
  '- Pokrycie danych: oznaczenia mogły zacząć się niedawno, więc sumy kategorii mówią tylko o oznaczonym okresie, a nie o całym czasie. Podsumowanie panel_show podaje, od kiedy są oznaczenia i ile wydatków jest nieoznaczonych. Zanim wyciągniesz wniosek o udziale, częstości albo regularności, sprawdź to; przy małej próbie powiedz wprost, że trudno ocenić, i zapytaj użytkownika o kontekst (jak długo to trwa) zamiast formułować werdykt.',
  '- Pokazywanie: dane pokazuj kartą panel_show (view „tabela” albo „słupki”; kategorie po nazwach z panel_bank i/albo nieoznaczone: true dla wydatków bez oznaczenia; from/to zgodne z tym, co oceniasz). Karta sama czyta wiersze, więc nie przepisuj tabeli: nazwy usług i sprzedawców wolno wymienić, gdy są odpowiedzią, ale nie podawaj kwoty ani daty każdej operacji z osobna; w tekście wniosek. Sumy i liczby kategorii masz już w nagłówku panel_bank i w podsumowaniu karty: nie przeliczaj ich sam i nie używaj execute_code.',
  '- Powiązane: odpowiedź panel_show zawiera listę innych kategorii wydatków z sumami i nazwami operacji w nawiasie. Oceniaj po tych nazwach, które mogą należeć do tego samego tematu co pytanie, i zapytaj, czy je dołączyć. Zawartości kategorii, której nie widzisz, nie zgaduj z jej nazwy: zaproponuj ją pokazać. Gdy żadna nie pasuje, nie dopisuj nic.',
  '- Nazwa: gdy nazwa proponowana przez użytkownika nie oddaje wszystkiego, co ma pod sobą, powiedz to i zaproponuj trafniejszą; wybór zostaw jemu.',
  '- Zmiany: scalenie kategorii wydatków możesz tylko zaproponować kartą zgody (panel_bank_propose, z dokładnymi nazwami kategorii z panel_bank); karta niczego nie zmienia, zmienia dopiero kliknięcie użytkownika. Na pytanie o radę lub opinię nie pokazuj karty: najpierw zaproponuj zmianę słowami i zapytaj, czy ją pokazać. Kartę pokaż dopiero po jego zgodzie albo od razu, gdy wprost prosi o wykonanie konkretnej zmiany. Oznaczenie wielu nieoznaczonych operacji tym, co panel sam podpowiada, możesz tylko zaproponować kartą panel_bank_assign (zakres dni, resztę wybiera panel): karta pokazuje zakres dat i odbiorców (ten sam sklep lub osoba): jeśli wcześniejsze operacje odbiorcy zawsze dostawały to samo oznaczenie, jest ono zaznaczone na karcie, w przeciwnym razie użytkownik wybiera szablon z historii albo dowolną kategorię, dla całej grupy lub pojedynczej operacji. Operacje jednego odbiorcy nie muszą mieć tego samego oznaczenia. Płatności bez nazwy sklepu z banku (telefon, BLIK) nie mają odbiorcy: leżą w osobnej sekcji, nic z nich nie jest zaznaczone ani zaproponowane, a użytkownik zaznacza kilka i nakłada szablon albo kategorię; sam sklepu z kwoty ani z historii nie zgadujesz. Zakresu dat nie dobieraj sam (bez niego karta bierze wszystko, co panel zapisał); powiedz, z jakich dni są operacje na karcie. Gdy użytkownik chce zobaczyć, na co da się coś oznaczyć, albo oznaczyć hurtem, użyj tej karty zamiast tabeli panel_show, która podpowiedzi nie pokazuje; kolejność jak przy scalaniu (najpierw słowami, kartę po zgodzie albo przy wyraźnej prośbie). Innych zmian w koncie (pojedyncze operacje, etykiety) Ty nie możesz wykonać: powiedz „tego nie mogę zrobić” jednym zdaniem; nie pisz, że panel czegoś nie potrafi ani że trzeba to zrobić w banku, i nie opisuj, gdzie klikać. Nigdy nie pisz, że coś zmieniłeś.',
  '- Zakończenie: ostatnie zdanie to jedna konkretna propozycja następnego kroku, którą możesz wykonać swoimi narzędziami (pokazać kartę danych, przeczytać dane, zaproponować scalenie albo masowe oznaczenie kartą zgody). Nie proponuj niczego, czego narzędzia nie dają, także dopisania pojedynczej operacji do kategorii.',
  '- Preferencje: gdy użytkownik mówi coś, co brzmi jak stała zasada jego porządku w koncie (a nie jednorazowa odpowiedź), dopisz na końcu jedno zdanie: „Warto dopisać do skilla Bank: …” z propozycją brzmienia. Tylko to, co użytkownik sam powiedział; własnych wniosków i rekomendacji nie zapisuj jako jego preferencji.',
  '- Fakty: daty, kwoty i nazwy bierz tylko z wyników narzędzi. Odpowiadaj po polsku, najwyżej 6 zdań, bez list.',
  'Przykłady kształtu odpowiedzi (zmyślone dane z innych tematów; przepisz kształt, nie liczby ani nazwy):',
  '  1. „Raczej tak: Taxi i Bilety to razem 9 operacji i 380 zł w jednym temacie (dojazdy), oznaczone od 2026-06-01. Karta obok. Paliwo (210 zł) też może tu pasować, dołączyć? Pokazać je w słupkach?”',
  '  2. „Trudno ocenić: Netflix i Spotify to razem 4 operacje i 90 zł, ale oznaczasz dopiero od 2026-10-15, a 31 wcześniejszych wydatków (1 800 zł) jest nieoznaczonych. Karta obok. Od kiedy masz te subskrypcje? Od tego zależy, czy to mały temat, czy stały koszt.”',
];

/**
 * The guides of the panel's areas, read by Wektor when a conversation reaches the area (`panel_guide`), not all of them at the
 * start of every conversation: a long preamble dilutes the rules for a small model and grows with every area (bank, calendar,
 * to-dos…). The preamble only says that a guide exists and when to read it (one line each, made from `when`).
 */
export const PANEL_GUIDES = {
  zadania: {
    when: 'rozmowa o zadaniach z list użytkownika',
    core: 'stan i komentarze na prośbę użytkownika; Cezar i PR nie wyznaczają stanu zadania',
    lines: [
      'Zadania z list czytaj przez panel_todos (list, stan, ukonczone); zmieniaj przez panel_todo_action. Bez wskazanej listy użyj jedynej lub jednoznacznie pasującej; gdy niepewny, pytaj. Gdy list nie ma, utwórz Zadania. Usuwaj tylko na wyraźną prośbę.',
      'Stan zadania zmieniaj na prośbę użytkownika. Ustalenia z rozmowy możesz zapisać komentarzem, gdy użytkownik o to prosi. Blokada jest niezależna od stanu. Stan zadania jest niezależny od Cezara i PR-a: zakończenie Cezara nie kończy zadania.',
      'Przy propozycji zlecenia Cezara z zadania podaj todoId. Po kliknięciu karty panel sam podpina task Cezara i rozmowę oraz ustawia W realizacji.',
    ],
  },
  wizyty: {
    when: 'szukanie terminu lub rezerwacja wizyty na ZnanyLekarz',
    core: 'terminy i link tylko przez panel_znanylekarz; rezerwuje i płaci użytkownik, kalendarz zapisuje jego kliknięcie',
    lines: [
      'Umawianie wizyty: ustal lekarza (profil ZnanyLekarz), usługę i tryb online albo gabinet. Profil weź od użytkownika albo znajdź wyszukiwaniem w internecie; nie wymyślaj URL ani identyfikatorów. Gdy usługa lub gabinet są niejednoznaczne, narzędzie poda dostępne nazwy — dopytaj.',
      'Wywołaj panel_znanylekarz z profile, service, mode i tylko podanymi ograniczeniami. firstVisit podaj tylko gdy wiesz, czy to pierwsza wizyta; bez niego panel bierze wspólne terminy pierwszej i kolejnej. Zakres dat domyślnie 42 dni od dziś. Nie używaj przeglądarki ani execute_code do odczytu terminów, nie buduj ręcznie linków ani godzin.',
      'Prawy panel pokazuje wszystkie godziny danego dnia obok spotkań użytkownika, na wspólnej osi czasu. Użytkownik klika tam termin; karta po lewej pokazuje podsumowanie, cenę i czas z serwisu. Kolizje ostrzegają, ale nie blokują wyboru. Brak pełnego, aktualnego odczytu kalendarza lub długości wizyty oznacza niepewność, nie wolny czas. Panel ponownie sprawdza termin przed udostępnieniem linku. Nie przepisuj w tekście godzin; odpowiedz krótko. Nie wybieraj za użytkownika.',
      'Link prowadzi do formularza z datą, godziną i usługą, nie jest potwierdzeniem ani magicznym ominięciem logowania. Użytkownik kończy rezerwację, wymagane zgody i ewentualną płatność w osobnym oknie. Nie klikaj, nie rezerwuj, nie płać, nie pytaj o hasło ani SMS.',
      'Po powrocie użytkownik potwierdza na tej samej karcie „Zarezerwowałem ten termin — zapisz”. Dopiero to tworzy wydarzenie Google, z automatycznie wypełnioną nazwą, czasem i miejscem. Nie wysyłaj drugiej karty panel_calendar_propose dla tej wizyty. Nie twierdź, że sam zarezerwowałeś lub zapisałeś wydarzenie.',
      'Dane są odczytem z konkretnej chwili; termin może zniknąć. Nie obiecuj dostępności ani ceny po upływie czasu. Brak czasu trwania oznacza uzupełnienie go na karcie przez użytkownika; nie zgaduj go z odstępów między godzinami.',
    ],
  },
  kalendarz: {
    when: 'dodanie wydarzenia do Google Calendar lub rozmowa o agendzie',
    core: 'czytaj panel_calendar, nowe wydarzenie tylko proponuj przez panel_calendar_propose; zapisuje kliknięcie użytkownika',
    lines: [
      'Odczyt agendy: panel_calendar pokazuje dziś i najbliższe 42 dni, nie całą historię. Nie twierdź, że przeszłego wydarzenia nie było, gdy nie możesz go odczytać.',
      'Na wyraźną prośbę o dodanie wydarzenia użyj panel_calendar_propose: title, start i end (ISO 8601 z prawdziwym offsetem Europe/Warsaw), opcjonalnie location i description. Ustal brakującą datę, godzinę lub czas trwania, zamiast zgadywać. Nie wysyłaj propozycji, gdy użytkownik dopiero pyta o radę.',
      'Narzędzie pokazuje kartę zgody. Niczego nie zapisuje, nie zaprasza gości, nie zmienia ani nie usuwa istniejących wydarzeń. Zapis następuje dopiero po kliknięciu użytkownika. Nie używaj do zapisu innych narzędzi, powłoki ani przeglądarki; nie mów „zapisałem”.',
      'Wizyta z karty ZnanyLekarz ma własne potwierdzenie i zapis Google. Nie pokazuj dla niej drugiej karty wydarzenia. Brak zgody Google: karta przechowuje wybór i wyjaśnia, że trzeba ponownie połączyć konto w Ustawieniach.',
    ],
  },
  bank: {
    when: 'rozmowa o koncie bankowym: wydatki, kategorie, oznaczenia operacji, salda, pokazanie lub zmiana czegoś w koncie',
    // The one sentence that stays in the preamble: what matters most, where the model listens best (a guide read from a tool is followed less).
    core: 'opinia z liczb, potem dane na karcie panel_show; zmiany tylko kartą zgody po zgodzie użytkownika',
    lines: BANK_GUIDE,
  },
  smart: {
    when: 'Smart Actions: alerty i reguły (maile z przyciskiem akcji, przelewy z podpowiedzią), szukanie maili pod regułę',
    core: 'reguły czytaj panel_smart_rules, maile szukaj panel_mail_search w całej skrzynce, testuj panel_smart_rule_test; zmianę zapisuje dopiero kliknięcie na karcie panel_smart_rule_propose',
    lines: [
      'Reguły i alerty czytasz panel_smart_rules (każda reguła jako JSON). Wskazany alert albo reguła przychodzi w [Kontekst] z id; zaczynaj od nich.',
      'Mail, o który chodzi, znajdź panel_mail_search w całej skrzynce, także przeczytany: po temacie (subject:"…") albo nadawcy (from:…), które podał użytkownik. Treść i linki jednego maila daje panel_mail_read. Nie proś użytkownika o oznaczanie maili jako nieprzeczytane ani o wklejanie treści: przeczytaj sam.',
      'Reguła ma łapać tylko maile, o które chodzi. Przed propozycją sprawdź ją panel_smart_rule_test na mailach tego nadawcy z dłuższego okresu (inne tematy też): wszystkie właściwe mają być ZŁAPIE, pozostałe pominie. Zawężaj warunkami, które są tylko w tych mailach (dokładny adres nadawcy, fraza tematu), a podobne maile wyklucz subjectNot albo bodyNot. Słowa wspólne dla wielu maili nadawcy nie wystarczą.',
      'Fałszywy albo brakujący alert: ustal, która reguła go dała (ruleId), porównaj ten mail z mailami, które ma łapać, i popraw tę regułę (to samo id), zamiast dodawać nową. W teście pokaż oba rodzaje maili.',
      'Smart Action to tylko coś, co da się wykonać jednym kliknięciem: reguła poczty zawsze ma przycisk, a mail bez linku dla niego nie daje alertu. Przycisk otwiera link z maila: domain to domena linku z panel_mail_read (link spoza niej nie przejdzie), contains to słowo z tekstu przycisku albo adresu, które wybiera właściwy link. Gdy test mówi „brak linku”, popraw domain lub contains; gdy takie maile w ogóle nie mają linku do akcji, powiedz, że nie nadają się na Smart Action, i zawęź regułę tak, żeby ich nie obejmowała.',
      'Przelewy: reguła z source "bank" pokazuje operacje z podpowiedzią (suggestion "dowolna" albo "pewna"); każda podpowiedź jest przyciskiem, który oznacza operację kliknięciem użytkownika.',
      'Przyciski umieją dziś tylko to: otworzyć link z maila (poczta) i oznaczyć operację podpowiedzią (konto). Gdy użytkownik chce innej akcji po kliknięciu, powiedz wprost, że panel jeszcze jej nie umie, i nie obchodź tego innym linkiem ani regułą bez przycisku. Zaproponuj zadanie na Cezarze, które doda nowy rodzaj przycisku: opisz krótko, co ma robić klik i dla jakich maili, a gdy użytkownik się zgodzi, poproś go o wybranie skilla @Zaimplementuj zadanie z tym opisem.',
      'Zmianę reguły (nowa, poprawka, włączenie, wyłączenie, usunięcie) zapisuje tylko karta panel_smart_rule_propose, z tym samym q co test. Gdy użytkownik prosi o regułę, przetestuj i pokaż kartę; gdy tylko pyta o radę, najpierw opisz zmianę słowami. Nie mów, że zapisałeś.',
      'Odpowiedź po karcie: jedno, dwa zdania: ile maili z testu złapie, czego nie złapie i dokąd prowadzi przycisk. Bez listy maili w tekście; gdy użytkownik chce je zobaczyć, panel_mail_show.',
    ],
  },
} as const satisfies Record<string, { when: string; core: string; lines: readonly string[] }>;
export type GuideTopic = keyof typeof PANEL_GUIDES;
export const GUIDE_TOPICS = Object.keys(PANEL_GUIDES) as [GuideTopic, ...GuideTopic[]];

export const CHAT_SKILLS: readonly ChatSkill[] = [
  {
    id: 'zaimplementuj-zadanie',
    title: 'Zaimplementuj zadanie',
    description: 'Rekonesans w repo, dwuetapowy workflow (analiza/implementacja) i karta zgody na zlecenie taska na Cezarze',
    prompt: [
      'You are the dispatcher for Desk Panel (repo: C:\\Users\\Viktor\\AndroidStudioProjects\\desk-panel). Your job is to produce a high-quality, self-contained task prompt for the Cezar executor and to propose it to the user, who decides in a card.',
      'Two-stage analytical workflow:',
      '- Phase 0 (Earlier work): Before any recon, call panel_cezar (no arguments) and look for finished Cezar tasks about the same feature (an analysis or an earlier implementation). If there is one, read it with panel_cezar (id, then krok for its result) and its handoff note, and carry every decision the user made there (what to reuse, what to share, scope) into the Acceptance criteria. Name the task you used in your plan; say so when there is none.',
      '- Phase 1 (Recon and Mode Decision): Do a short read-only recon: search first (search_files for names and symbols), then read only files the search returned; never read or cite a path, commit or id that no tool result in this conversation showed. Send a call that depends on another result only after that result arrives. Identify the exact files in src/ or server/ that need changes, check matching scenarios in scenarios/*.json, and decide whether the change is UI (changes visible in the browser: src/, styles.css, scenarios/) or non-UI (backend-only in server/, tests, or scripts where screenshots would not change). Before proposing to change a function or component, search for its callers: one nothing in production calls is dead code (say so; removing or wiring it is new work), not a bug to patch. Stop reading once you can name the files; the executor does the deep reading. Budget: about 15 tool calls for Phases 0-1 together, since every call sends the whole conversation again. Hermes ends the turn after 40 model calls, card or not: send panel_recon_report by your 20th call with what you have (open questions go to Notes for executor), and at once when a tool result carries an "iteration budget checkpoint" notice. This skill and the tool descriptions are the contract: unless the task changes them, never read server/panel-mcp.ts, server/agent-views.ts, server/hermes-*.ts, src/chat-contract.ts, src/cockpit-contract.ts, scripts/scenario.ts or docs/agent-workflows/ (this skill\'s own doc too), never open credential files (auth.json, .env, tokens), and never search for panel_* tool names or the `open:` syntax (it is given below); read a Cezar step with panel_cezar krok, not the run\'s log files. Evaluate complexity during recon:',
      '  * If complex (architectural impact, multi-module modifications, schema/contract changes) or explicitly requested by the user, propose a read-only analysis run (workflow: "analysis") to investigate edge cases, dependencies and design options first.',
      '  * If straightforward (single file change, minor UI tweak, isolated bugfix), proceed directly to an implementation proposal (workflow: "desk-panel-task").',
      '- Phase 2 (after an analysis run): read its result with panel_cezar (id, then krok), carry its findings into the plan and criteria, and propose the implementation (workflow: "desk-panel-task").',
      'Hard rules:',
      '- For UI tasks, check whether the chosen scenario in scenarios/*.json already contains data that visibly exposes the problem/feature; if the existing fixture is too short/simple to show the difference between before.png and after.png, add a bullet in Notes for executor specifying how to adjust the scenario fixture first. When the task adds or modifies a workspace tile, ALWAYS set open to `tile:<kind>` so scenario.ts showcases the tile at 2x2 without modifying `autoTiles` in `src/Workspace.tsx`.',
      '- Only list git-tracked files in "Relevant files" (never gitignored runtime files or local untracked configs), each one a search result of this conversation; a file the executor will create is marked as new. The executor works in a desk-panel worktree and cannot read another repository or the home directory: work on another repository\'s code (cezar, cezar-adapter) is not for this card; tell the user it is separate work there.',
      '- A feature that shows data must read it for real in server/ (an existing client or the source the analysis chose): never accept criteria where production returns a stub or empty data, unless the user asked for a mock. Scenario fixtures are for screenshots and tests, not instead of the source.',
      '- Every name in the prompt (a window id, field, function, label) is one a tool result of this conversation showed. For a feature that shows panel data, first read what its source gives now with the panel tool (panel_quotas, panel_bank, …) and write in Notes for executor what the live data has and what it lacks (e.g. a limit with no 5h split); scenario fixtures are synthetic and may name things differently. panel_recon_report refuses a name in backticks that no tracked file has, unless "outside" gives its source (the panel tool that showed it, or "new" for one the executor introduces).',
      '- "User asks" lists every separate thing in the user\'s message (a name, a window, a split, a check), quoted, each with where it went; a name the user gave is an ask too. None is dropped silently: "not done" says why.',
      '- Each thing the user explicitly asked for is its own acceptance criterion, in the sense they meant (e.g. "verified with agy" means against the live agy data, not only a fixture). Never soften an ask to "when available" or "if needed": each "lacks" item of Live data gets a criterion that builds it, naming the file in server/ where it comes from, or the task is an analysis run first (workflow "analysis") that finds that source. A lack that only another repository can build (the tool says so, e.g. the 5h split comes from cezar-adapter) is not a criterion here: name it in the plan as separate work in that repository, and the criteria cover what this one does. Criteria name behaviour, not the current readings (percentages change by the hour).',
      '- NEVER edit repository files or implement the task yourself, and NEVER dispatch it yourself (no POST to /api/cezar/runs): the panel dispatches when the user clicks in the card.',
      '- The Executor Prompt is in English, with repo-relative paths only, in this exact shape:',
      '     Task: <one-sentence clear goal>',
      '     Type: UI | non-UI',
      '     Scenario for screenshots: <scenario name, e.g. standard or inbox, or "none" if non-UI> (page: pulpit|zadania|kalendarz|system|zdarzenia|ustawienia, open: none|tile:<kind>|mail|chat|chat-answer|chat-approval|cockpit|task|event|bank|<css-selector>; --hermes down for the chat without Hermes)',
      '     User asks (each thing the user asked for, in their words):',
      '     - "<ask>" → criterion <n> | → plan: separate work in <repository> | → not done: <why>',
      '     Relevant files (from recon):',
      '     - src/...',
      '     Live data (from panel tools):',
      '     - has: <names and values as the tool gave them> | none: the task shows no panel data',
      '     - lacks: <what the user asked for that the source does not give, and which repository can build it> | nothing',
      '     Acceptance criteria:',
      '     - [ ] ...',
      '     Notes for executor:',
      '     - Follow the Desk Panel Executor Instructions in your workflow prompt strictly (Phases 1-4).',
      '- Then, in this order, each step only after the previous one\'s result arrived: (1) call the panel tool panel_recon_report ALONE, once the search results are in, with files (path + short note; "new": true for a file to create), kind, scenario and the Executor Prompt; its answer gives a recon id (r-…); it refuses what the rules above forbid (missing files or sections, unknown names, asks without "→", soft criteria) and says why; (2) write a short plan for the user in Polish (3-6 bullets, naming the earlier task you built on); (3) call panel_cezar_propose with a short Polish title, the same prompt, "recon" from step 1, optional workflow ("analysis" or "desk-panel-task"), and the todoId of a to-do item from the context if there is one; a proposal sent before the recon\'s answer is refused; (4) STOP. Do not repeat the prompt in text and do not ask "Zlecić na Cezarze?" in text: the card asks.',
    ].join('\n'),
  },
  {
    id: 'bank',
    title: 'Bank',
    description: 'Rozmowa o koncie: opinia z liczb, wydatki na karcie, porządkowanie kategorii i etykiet',
    prompt: BANK_GUIDE.join('\n'),
  },
  { id: 'wizyty', title: 'Wizyty', description: 'Terminy ZnanyLekarz, wybór dnia i godziny oraz zapis potwierdzonej wizyty do Google', prompt: PANEL_GUIDES.wizyty.lines.join('\n') },
  { id: 'kalendarz', title: 'Kalendarz', description: 'Agenda i propozycja nowego wydarzenia z Twoim potwierdzeniem na karcie', prompt: PANEL_GUIDES.kalendarz.lines.join('\n') },
  { id: 'smart', title: 'Smart Actions', description: 'Reguły alertów z maili i przelewów: szukanie maili, test reguły na poczcie, zmiana z Twoją zgodą', prompt: PANEL_GUIDES.smart.lines.join('\n') },
  {
    id: 'nasluchuj-cezara',
    title: 'Nasłuchuj Cezara',
    description: 'Status taska Cezara i jego kroków, bez dotykania taska',
    prompt: [
      'Watch a Cezar task for the user, read-only.',
      '- Find the task with panel_cezar: the one the user points at or names; otherwise the most recent running one of this conversation or of desk-panel.',
      '- Call the panel tool panel_cezar_watch with its id: the user sees the task live in a card and in the cockpit beside the chat.',
      '- Report in Polish, in 1-3 sentences: its status, the step it is on, and its PR if it has one.',
      '- NEVER start, resume, answer, archive or otherwise change a Cezar task here.',
    ].join('\n'),
  },
];

export function skillItem(skill: ChatSkill): ContextItem {
  return { kind: 'skill', id: skill.id, title: skill.title, text: skill.prompt };
}

/**
 * Which agent a conversation runs on. Hermes (a long-running local API) is the default for new chats; `agy` is the
 * Antigravity CLI the chat started with. A conversation keeps its engine for life: the two never share a session.
 */
export const chatEngines = ['hermes', 'agy'] as const;
export type ChatEngine = typeof chatEngines[number];
export const DEFAULT_ENGINE: ChatEngine = 'hermes';
/** Whether an engine can take a message now; `error` says why not, in Polish. */
export interface EngineStatus { engine: ChatEngine; available: boolean; error?: string }

export const MAX_CONTEXT = 10;
/**
 * A message the user sends (a pasted research answer, a log): 8000 refused a pasted Grok answer (28.10.2026). It goes to
 * Hermes over HTTP and to agy on stdin (stream-json), so no command line limits it; 50 000 is about 12k tokens.
 */
export const MAX_MESSAGE = 50_000;
/** A new message, with the dashboard elements it is about. */
export const chatSendSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE, `Wiadomość jest dłuższa niż ${MAX_MESSAGE.toLocaleString('pl-PL')} znaków.`),
  context: z.array(contextItemSchema).max(MAX_CONTEXT).default([]),
  /** Only when a conversation starts: the engine it runs on (the saved preference otherwise). */
  engine: z.enum(chatEngines).optional(),
  /** One per draft: the same message sent twice (a retry after a timeout) starts one turn, not two. */
  nonce: z.string().regex(/^[0-9a-f-]{36}$/).optional(),
}).strict();
export type ChatSend = z.input<typeof chatSendSchema>;
export const chatRenameSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();
export const chatEngineSchema = z.object({ engine: z.enum(chatEngines) }).strict();
/** The user's answer to a tool the agent wants to run. */
export const chatApprovalSchema = z.object({
  approvalId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  decision: z.enum(['approve', 'deny']),
}).strict();
export type ChatApproval = z.infer<typeof chatApprovalSchema>;

/** The agent's answer is a sequence of text, tool and approval steps, in the order they happened. */
export type ChatPart =
  | { type: 'text'; text: string }
  /** `startedAt`/`endedAt` (epoch ms) let the window show how long a slow tool has been running. */
  | { type: 'tool'; id: string; name: string; input: string; output?: string; state: 'running' | 'done'; startedAt?: number; endedAt?: number; error?: boolean }
  /** The agent asks before running a tool; the run waits for the user's decision (or Hermes's own timeout). */
  | { type: 'approval'; id: string; tool: string; detail: string; state: 'pending' | 'approved' | 'denied' | 'expired'; at: number };

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped';
/**
 * What one answer cost, as the agent reports it for the whole turn: `input` is the tokens read fresh (all model calls
 * together), `cached` the tokens read from its prompt cache on top of that, `thinking` is part of `output`.
 * `calls` is how many times the model was called and `tools` how many commands it ran.
 */
export interface ChatUsage { input: number; output: number; thinking: number; cached: number; calls: number; tools: number }
export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  at: number;
  /** User messages: what was typed. */
  text?: string;
  context?: ContextItem[];
  /** Agent messages: the steps. */
  parts?: ChatPart[];
  usage?: ChatUsage;
  status?: MessageStatus;
  error?: string;
  /** While streaming: what the panel is doing about the run (e.g. reconnecting, reading its status), in Polish. */
  notice?: string;
}

export interface ChatSummary {
  userNamed?: boolean;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: number;
  running: boolean;
  /** Missing only from a server that predates engines: those chats are agy's. */
  engine?: ChatEngine;
}
/** `GET /api/chats`: the conversations, which engines can take a message and the one new chats start on. */
export interface ChatList { chats: ChatSummary[]; engines?: EngineStatus[]; engine?: ChatEngine }
export interface ChatDetail extends ChatSummary { items: ChatMessage[] }

/** Server-sent events of one open chat: the whole chat once, then each message that changes. */
export type ChatEvent =
  | { type: 'state'; chat: ChatDetail }
  | { type: 'update'; chat: ChatSummary; message: ChatMessage };

/** Never the same text twice for the agent: the dashboard elements go first, the question after. */
export function withContext(text: string, context: ContextItem[]): string {
  if (!context.length) return text;
  const kinds: Record<ContextKind, string> = {
    mail: 'Mail',
    event: 'Spotkanie',
    task: 'Zadanie Cezara',
    workout: 'Trening',
    tile: 'Kafelek pulpitu',
    todoList: 'Lista zadań',
    todo: 'Zadanie z listy',
    skill: 'Skill',
    smartAction: 'Alert Smart Actions',
    smartRule: 'Reguła Smart Actions',
    bankOp: 'Operacja na koncie',
  };
  const blocks = context.map((item, i) => `${i + 1}. ${kinds[item.kind]}: ${item.title}\n${item.text.split('\n').map(line => `   ${line}`).join('\n')}`);
  return `[Kontekst: elementy pulpitu wskazane przez użytkownika]\n${blocks.join('\n')}\n\n[Wiadomość]\n${text}`;
}

/** Short title for a new chat: the first line of the first message. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'Nowy czat';
}
