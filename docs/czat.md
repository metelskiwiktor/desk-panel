# Czat z agentem

Okno rozmowy z agentem (Antigravity CLI, `agy`) otwierane przyciskiem w pasku u góry pulpitu. Agent wie, kim jest, czym jest
panel i skąd bierze dane, ale **nie dostaje całej poczty ani kalendarza**: dostaje to, co użytkownik sam wskaże na pulpicie.

## Jak się tego używa

- **Okno**: domyślnie małe, **pływające** przy prawej krawędzi, pod górnym paskiem. Zasłania część pulpitu, ale go nie
  blokuje i nie przyciemnia: można dalej klikać. Ikona rozmów w nagłówku wysuwa listę rozmów (grupy Dziś / Wczoraj / Ostatnie
  7 dni / Starsze, wyszukiwarka, „Nowy czat”). Ikona ze strzałkami **powiększa** okno do dużego, modalnego, z listą rozmów
  po lewej (i z powrotem); wybór jest pamiętany w przeglądarce (`desk-panel.chat-wide`). Przycisk czatu w górnym pasku
  otwiera i zamyka okno. `Esc` zamyka pływające okno tylko, gdy fokus jest w nim.
  Wybranie rozmowy z listy ją **kontynuuje**; agent pamięta wcześniejsze wiadomości, także po restarcie panelu.
- **Wskaż element**: okno przykleja się do prawej krawędzi na całą wysokość, a pulpit **zsuwa się w lewo** obok niego (tylko
  w tym trybie; górny pasek zawija się pod zegar). Każdy kliknięty element (mail, zadanie Cezara, spotkanie, trening albo cały
  kafelek: Poczta, Cezar, limity, pasek dnia, cała strefa „Najbliższe dni” i pojedynczy dzień w niej) trafia do wiadomości
  jako chip. Kliknięcie jeszcze raz zdejmuje go z kontekstu. W tym trybie kliknięcia **nie uruchamiają** niczego na pulpicie,
  z wyjątkiem elementów oznaczonych `data-pick-through` (menu pulpitów wirtualnych): można przełączyć pulpit i wskazać kafelek
  z innego. `Esc`, „Gotowe” lub strzałka w nagłówku kończą wskazywanie i wracają do okna sprzed niego.
- **Wysyłanie**: `Enter` wysyła, `Shift+Enter` to nowa linia. Podczas odpowiedzi przycisk wysyłania zamienia się w „Zatrzymaj”.
- Rozmowę można zmienić nazwę (ołówek) i usunąć (kosz, wymaga drugiego dotknięcia).
- Wąski ekran (telefon przez Tailscale): lista rozmów jest szufladą, okno zajmuje cały ekran (bez przycisku powiększania), a
  panel wskazywania jest u dołu.

## Co widzi agent

Pierwsza wiadomość rozmowy zaczyna się od instrukcji (`PREAMBLE` w `server/agent-chat.ts`: kim jest, czym jest Desk Panel,
źródła danych, że ma odpowiadać po polsku i zwięźle). Kolejne wiadomości jej nie powtarzają: ten sam proces `agy` pamięta rozmowę.
Wskazane elementy idą przed pytaniem:

```
[Kontekst: elementy pulpitu wskazane przez użytkownika]
1. Mail: Anna Nowak: Spotkanie w czwartek
   Od: Anna Nowak
   ...

[Wiadomość]
Zrób z tego zadanie na jutro.
```

### Co można wskazać

Element jest wskazywalny, jeśli ma atrybuty `data-ctx-*`. Dodaje je `ctx()` z `src/chat-context.ts`:

```tsx
<li {...ctx('mail', thread.id, `${thread.from}: ${thread.subject}`, 'Od: ...\nTemat: ...')}>
```

`ctx(kind, id, title, text?)`: `kind` to `mail | event | task | workout | tile`; bez `text` agent dostaje to, co użytkownik widzi
w elemencie (`innerText`). Wskazywany jest **najbliższy** oznaczony element, więc wiersz poczty wygrywa z kafelkiem Poczta,
a kliknięcie w nagłówek kafelka wskazuje cały kafelek. Nowy rodzaj elementu to jedno `ctx()` w komponencie (plus rodzaj w
`contextKinds` w `src/chat-contract.ts`, jeśli nie pasuje żaden istniejący). Limity: do 10 elementów na wiadomość, 2000 znaków
tekstu na element (UI skraca do 1800).

## Jak to działa

```
ChatWindow ── useChat ── /api/chats… ── ChatService (server/agent-chat.ts) ── agy (proces na rozmowę)
   │            │  SSE: /api/chats/<id>/events                                    stdin/stdout: stream-json
   chat-context (wskazywanie)
```

- **Identyfikator rozmowy należy do panelu** (uuid); identyfikator rozmowy `agy` jest zapisany obok jako `agy`. Dzięki temu
  inny silnik niż `agy` nie wymagałby zmian w UI: UI zna tylko `ChatMessage` z `src/chat-contract.ts` (tekst i kroki narzędzi
  w kolejności, status `streaming | done | error | stopped`).
- **Proces na rozmowę**: `agy --output-format stream-json --input-format stream-json [--conversation <id>] -p ''`. Wiadomość to
  linia `{"event":"user","message":{"content":"…"}}` na stdin. Proces obsługuje wiele tur. Po 10 minutach bezczynności
  serwis zamyka stdin (proces kończy się sam); kolejna wiadomość uruchamia `agy --conversation <id>`, a rozmowa toczy się dalej
  z pamięcią (sprawdzone na prawdziwym `agy`).
- **Zdarzenia z `agy`** (jedna linia JSON na zdarzenie): `init` (daje `conversation_id`), `step_update` (`step_type`:
  `user_input | agent_response | tool | system_message`, `state`: `ACTIVE | DONE`, `text_delta`, `tool_name`,
  `tool_info.{name,parameters,output}`) i `result` (`status`: `SUCCESS | ERROR`, `response`, `error`). Odpowiedź składa się
  ze strumienia; puste kroki „myślenia” znikają; `result.response` wypełnia odpowiedź, gdy strumień nie dał tekstu.
- **Strumień do przeglądarki**: `GET /api/chats/<id>/events` (SSE). Najpierw jedno zdarzenie `state` (cała rozmowa), potem
  `update` (podsumowanie i zmieniona wiadomość), łączone co ok. 40 ms. `EventSource` sam się łączy ponownie i dostaje `state`
  od nowa, więc nic nie ginie po przerwie.
- **Zapis**: `~/.desk-panel/chats/<id>.json` (zapisy jednej rozmowy są szeregowane). Wiadomość „w trakcie” z poprzedniego
  uruchomienia panelu jest po starcie oznaczana jako przerwana. Katalog roboczy agenta: `~/.desk-panel/agent`.
- `agy` jest szukany w `DESK_AGY_BIN`, potem w `%LOCALAPPDATA%\agy\bin\agy.exe`, `~/.agy/bin`, `~/.local/bin`. Przy zatrzymaniu
  lub zamknięciu serwisu proces i jego dzieci są kończone (`taskkill /T` na Windows).

### Znane właściwości `agy`

- W trybie `-p` agent ma powłokę (`run_command`) i **nie pyta o zgodę**. Katalog roboczy to `~/.desk-panel/agent`, ale to nie jest
  piaskownica. Projekt jest hobbystyczny i zabezpieczenia świadomie odłożono; zmieni się to, gdy panel wyjdzie poza własny komputer.
- `-p` zjada następny token, stąd `-p ''` na końcu argumentów. Pomoc drukuje na stderr. Zamknięcie stdin kończy proces.
- Każda wiadomość zużywa limit konta `agy`; nie ma tu żadnych odczytów w tle.

## API

Wszystko poza odczytem wymaga nagłówka `Origin` równego adresowi panelu (jak akcje Gmaila i Cezara), inaczej `403`.

| Trasa | Działanie |
| --- | --- |
| `GET /api/chats` | `{ chats: ChatSummary[] }` |
| `POST /api/chats` | nowa rozmowa z pierwszą wiadomością `{ text, context }` → `201 { id }` |
| `GET /api/chats/<id>` | cała rozmowa |
| `PATCH /api/chats/<id>` | `{ title }` |
| `DELETE /api/chats/<id>` | usuwa rozmowę i kończy jej proces |
| `POST /api/chats/<id>/messages` | `{ text, context }` → `202`; `409`, gdy agent jeszcze odpowiada |
| `POST /api/chats/<id>/stop` | zatrzymuje odpowiedź |
| `GET /api/chats/<id>/events` | strumień SSE |

Bez usługi czatu (np. testy serwera bez `agy`) trasy odpowiadają `503`, a UI pokazuje „Czat jest niedostępny”.

## Próbowanie bez `agy`

`just scenario NAME` uruchamia czat ze **skryptowym agentem** (`server/scenario-chat.ts`): te same zdarzenia co `agy`
(krok narzędzia, potem odpowiedź słowo po słowie), odpowiedź wypisuje wskazane elementy. Nie zużywa limitu, a rozmowy trafiają do
katalogu tymczasowego, który znika razem ze scenariuszem. Dev server proxy (`vite.config.ts`) zachowuje nagłówek `Host`
strony, żeby sprawdzanie `Origin` działało też w trybie deweloperskim.

## Testy

- `server/agent-chat.test.ts`: serwis i trasy na zdarzeniach w kształcie prawdziwego `agy` (fałszywy proces).
- `src/chat.test.tsx`: renderer Markdown, wskazywanie (najbliższy element, limity, znaczniki), okno, strumień, zatrzymanie,
  usuwanie, brak usługi.

## Dalsze kroki (jeszcze nie zrobione)

Własne skille w czacie (menu po `/`; natywne skille `agy` leżą w `<katalog roboczy>/.agents/skills/<nazwa>/SKILL.md` i rozwijają
się przez `/nazwa`), lokalne zadania dnia i notatki z narzędziami panelu dla agenta, wirtualne pulpity.
