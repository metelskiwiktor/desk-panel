# GUI Wektora — mapa i praca nad zmianami

Ten dokument dotyczy frontendu rozmowy. Zachowanie produktu i API opisuje [czat.md](czat.md), a integracje mają własne dokumenty.
Nowe narzędzie lub umiejętność agenta wymaga także procedury `skills/wektor-capabilities`; sama zmiana GUI jej nie uruchamia.
Zmiana GUI nie wymaga restartu Hermesa, dopóki nie zmienia narzędzi ani ich schematów.

Powiązanie rozmowy w oknie zadania otwiera pełny czat przez `openChatConversation` (`src/useChatPresentation.ts`),
które przekazuje żądanie do `ChatWindow` i istniejącego `source.open(id)`. Samo otwarcie nie wysyła wiadomości ani nie zaczyna tury.

## Gdzie zmieniać kod

| Odpowiedzialność | Pliki |
| --- | --- |
| Włączenie Wektora, pełny/kompaktowy/ukryty, skróty | `src/App.tsx`, `src/useChatPresentation.ts` |
| Powłoka, historia, zakładki, automatyczny kokpit | `src/ChatWindow.tsx`, `src/cockpit/ConversationSidebar.tsx` |
| Wskazywanie elementów pulpitu | `src/cockpit/usePointing.ts`, `src/chat-context.ts` |
| Tekst i kontekst niewysłanej wiadomości, osobno dla rozmowy | `src/chat-draft.ts` |
| Lista rozmów, SSE, snapshoty ostatnich rozmów | `src/useChat.ts` |
| Mapowanie wiadomości na assistant-ui, odczyt kokpitu i decyzje | `src/cockpit/live.ts`, `src/cockpit/types.ts` |
| Kompozytor, komendy `/`, skille `@`, kontekst, rejestracja kart narzędzi | `src/cockpit/Thread.tsx` |
| Komponenty assistant-ui skopiowane i zmodyfikowane w repo | `src/components/thread.aui.tsx`, pozostałe `src/components/*` |
| Task i PR w kokpicie | `src/cockpit/Cockpit.tsx` |
| Wizyty: karta, wspólny stan, oś kalendarza | `src/cockpit/appointment-card.tsx`, `appointment-workspace.tsx`, `AppointmentPanel.tsx` |
| Pozostałe karty zgody i danych | `src/cockpit/cards.tsx`, `consent-card.tsx`, `assign-card.tsx`, `smart-cards.tsx` |
| Pamięć podglądów i układu bieżącego okna | `src/chat-snapshots.ts`, `src/cockpit/conversation-cache.ts` |

Nie aktualizuj komponentów assistant-ui z rejestru bez ponownego naniesienia lokalnych zmian. `thread.aui.tsx` ma polskie
etykiety, ograniczony zestaw akcji, sloty panelu oraz korekty układu i autosizingu. To kod współdzielony przez karty i kompozytor.

## Style

| Plik | Zakres |
| --- | --- |
| `src/styles.css` | Globalne reguły całego panelu; mogą wpływać na elementy czatu. |
| `src/chat.css` | Wskazywanie pulpitu, miejsce obok kompaktowego czatu, przycisk otwierania. |
| `src/cockpit/wektor.css` | Powłoka Wektora, historia, kokpit, przewijanie, menu skillów i wspólne reguły wyglądu. |
| `src/cockpit/cockpit.css` | Tailwind v4 z prefiksem `tw:`, tokeny shadcn/assistant-ui, bez preflight. Utilities są `!important`. |
| `src/cockpit/appointment-panel.css` | Oś terminów i kalendarza. |

Najpierw sprawdź właściciela reguły i computed styles. Zmiana globalnego resetu dla jednego przycisku Wektora może zmienić cały pulpit.

## Stany i granice

- **Wczytywanie nie oznacza pustej rozmowy ani pustego kokpitu.** Przy zmianie rozmowy zachowujemy miejsce dla podglądu,
  a nie dane poprzedniej rozmowy. Gdy znamy już pusty wynik, kokpit automatyczny może się schować.
- Snapshot musi należeć do bieżącej rozmowy. Szybkie A → B → A nadal wymaga świeżego SSE i odczytu kokpitu dla ostatniego wyboru.
  Spóźniona odpowiedź B nie może zastąpić A. Cache jest w pamięci okna, bez dodatkowego zapisu rozmów do localStorage.
- Podgląd można pokazać przed odświeżeniem, ale zgody i wysyłanie czekają na aktualny stan. Karta wizyty dodatkowo czeka na
  własny świeży odczyt. Cache kalendarza zachowuje rzeczywisty `observedAt`, status i coverage; błąd nie odmładza danych.
- Widok kompaktowy i wskazywanie mają ten sam rozmiar i położenie. Zmiana etykiety przycisku lub pustego pola nie powinna
  zmieniać wysokości kompozytora. Pusty element w układzie flex nadal może dodawać `gap`.
- Pole rośnie dla wielowierszowej wiadomości. Musi też przeliczać wysokość po zmianie szerokości przez animację powłoki lub
  przeciągnięcie historii, nawet bez zdarzenia `window.resize`.
- Lewy Ctrl+lewy Alt przełącza wskazywanie; puszczenie klawiszy go nie kończy. Ctrl+V, Ctrl+A, AltGr i Alt+W mają osobne
  zachowania. Szczegóły i sposób zakończenia trybu są w [czat.md](czat.md).
- Renderowanie, przełączenie rozmowy i wskazanie elementu nie mogą same wysyłać wiadomości ani zatwierdzać kart.
  Ostateczny zapis nadal sprawdza backend, z planem z tej samej rozmowy.

## Krótki cykl pracy

1. Dobierz scenariusz z `scenarios/`, który pokazuje problem. Zrób zrzut przed zmianą dla dotkniętego widoku.
2. Zmieniaj kod i uruchamiaj właściwy test plikowy (`npx vitest run …`) lub `just test-fast`, plus `npm run typecheck`.
3. Sprawdź interakcje w przeglądarce. jsdom nie sprawdza rzeczywistej geometrii, animacji ani natywnych skrótów.
4. Porównaj zrzuty przed/po i oceń czytelność. Pomiar geometrii nie zastępuje oceny wyglądu.
5. Po zakończeniu uruchom `just check`. Nie powtarzaj pełnego zestawu po każdej drobnej poprawce, gdy wystarcza sprawdzenie dotkniętego obszaru.

Zrzuty: `just screenshots standard --pages pulpit --open chat-skills` oraz `--open chat-compact`.
Użyj osobnych katalogów `--out` dla materiału przed i po zmianie. `--file` jest dla jednego widoku i jednego skalowania.
Ekrany i skalowania pochodzą wyłącznie z `devices.json`.

## Powtarzalne przepływy GUI

```powershell
just wektor-ui all
just wektor-ui composer
just wektor-ui commands
just wektor-ui keyboard
just wektor-ui history
just wektor-ui switching --latency 240
just wektor-ui all --scale all --out output/wektor-ui-after
```

Runner korzysta z tego samego izolowanego API, atrapy Hermesa i Vite co `just scenario`, przez `scripts/scenario-runtime.ts`.
Wszystkie serwery dostają wolne porty na loopback. Nie łączy się z usługą panelu, prawdziwym Hermesem, bankiem ani Google.
Provider danych to `scenarios/wizyty.json`, a rozróżniające rozmowy dane są w `scenarios/wektor-ui/conversations.json`.
Rozmowy przygotowuje przez syntetyczne API. W przepływie przełączania etykiety lekarzy z fixture są podmieniane tylko
w odczytach przeglądarki, walidowanych kontraktem, aby wykrywać pomieszanie rozmów.

| Przypadek | Co sprawdza |
| --- | --- |
| `commands` | Filtrowanie `/`, Esc, ↑↓/Enter, nowa rozmowa, tymczasowa, zachowanie przed wysłaniem i zakładka archiwum; bez tury modelu. |
| `composer` | Pierwszy znak i usunięcie tekstu bez przesunięcia pola; menu skillów i brak poziomego przepełnienia. |
| `keyboard` | Ctrl+Alt w obu kolejnościach, wskazanie kontekstu, Ctrl+V/A po przytrzymaniu Ctrl, AltGr, Esc/Gotowe, Alt+W i stały rozmiar. |
| `history` | Osobne szkice i skille, wyszukiwanie po ID, przeciąganie historii, pamięć szerokości i obsługa separatora klawiaturą. |
| `switching` | Sześć zmian rozmowy przy opóźnionym API, poprawny właściciel danych, stała szerokość i blokada działań przed świeżym odczytem. |

Każdy przypadek ma nowy kontekst przeglądarki. Runner zwalnia modyfikatory, zamyka kontekst, serwery i katalogi tymczasowe.
Zatrzymuje się przy pierwszym błędzie i zwraca niezerowy kod. Nie klika potwierdzeń zapisu ani nie wysyła wiadomości z UI;
próba takiego żądania powoduje błąd. Jedynie przygotowanie fixture tworzy i nazywa rozmowy w tymczasowym API.

W `output/wektor-ui` powstają zrzuty rozróżniające przypadek, ekran, skalowanie i stan oraz `report.json` z pomiarami i logami
konsoli. Przy błędzie powstaje zrzut `*-failure.png` i trace `*-failure.zip` (`npx playwright show-trace …`).
Oczekiwane HTTP 503 źródeł nieobecnych w scenariuszu są logowane; nieobsłużony wyjątek JS zawsze przerywa przebieg.
Trace i logi są poza Gitem. Dla archiwum kolejnego porównania podaj inny `--out`.

Przy dopisywaniu przepływu używaj warunku gotowości i stabilnej geometrii, nie stałego opóźnienia „na animację”. Kod
przesyłany do przeglądarki nie może zależeć od helperów wstrzykiwanych przez transpiler Node (`tsx`), np. `__name`.
Testy przeglądarkowe mają sprawdzać trwałe zachowania i granice, zgodnie z [testowanie.md](testowanie.md).


Komendy, lokalny komunikat `/koszt` i baner trybu tymczasowego należą do `src/cockpit/Thread.tsx`; zakładki (strzałki, Home/End, roving tabindex i tabpanel), licznik i
akcje wiersza do `ConversationSidebar.tsx`; wybór/opuszczenie/zachowanie do `useChat.ts` przez `cockpit/live.ts`.
Powłoka `ChatWindow.tsx` sprząta tryb tymczasowy również przy ukryciu skrótem Alt+W i dostaje `data-temporary` do ramek.
`wektor.css` używa istniejących tokenów `--wk-*`; nie kopiuje stylów statycznych makiet.

Zrzuty na syntetycznym Hermesie, bez usługi i danych użytkownika:

```powershell
just screenshots standard --pages pulpit --open chat-commands
just screenshots standard --pages pulpit --open chat-archive
just screenshots standard --pages pulpit --open chat-temporary
```

Pełne zachowanie i ograniczenia pamięci opisuje [czat.md](czat.md#komendy-archiwum-i-rozmowy-tymczasowe).

Pole kompozytora ma rolę combobox z aria-controls/expanded/activedescendant dla menu komend i skillów.
Enter bez dokładnej nazwy ani jawnego wyboru strzałką niczego nie wykonuje; Esc pozwala wysłać komendę jako tekst.
Nagłówki i kontenery listbox są prezentacyjne. Zakładki historii mają te same boczne marginesy 14 px co „Nowy czat” i wyszukiwarka.
