# GitHub: kafelek PR i kokpit

Kafelek **GitHub PR** (`github-pr`, `src/tiles/GitHubPrTile.tsx`; w pustym miejscu pulpitu ikona pull requesta) pokazuje otwarte pull requesty z kilku repozytoriów: numer,
tytuł, repozytorium, autora, stan review, etykiety i zbiorczy stan CI, z linkiem do PR. Kokpit czatu (Wektor) pokazuje PR
obserwowanego taska Cezara i jego checki. Oba czytają GitHub przez jeden moduł, `server/github.ts`.

## Źródło

- Tylko odczyt, przez lokalne `gh` zalogowane jako użytkownik (`gh auth status`): `gh pr list -R <repo> --state open --json …`
  dla kafelka i `gh pr view` dla kokpitu. Bez powłoki, z limitem 10 s, bez tokenów w panelu: uwierzytelnienie zostaje w `gh`.
  Panel niczego w GitHubie nie zmienia (bez merge, komentarzy, review).
- Repozytoria: `DESK_GITHUB_REPOS` w `%USERPROFILE%\.desk-panel\panel.env` (lista `właściciel/repo` po przecinku). Bez niej:
  `metelskiwiktor/desk-panel`, `cezar-adapter`, `cezar`, `tabnote` (`DEFAULT_GITHUB_REPOS`).
- `GET /api/github/prs` zwraca `GitHubPrSource` (`src/types.ts`): `pullRequests`, `repositories`, `totalCount`, `status`,
  `observedAt`. Najnowsze zmiany pierwsze.

## Odpytywanie

- Serwer trzyma wynik 30 s, gdy któryś PR ma trwające checki albo czeka na review, inaczej 90 s; równoczesne żądania czekają
  na ten sam odczyt. Repozytoria są czytane równolegle (`Promise.allSettled`): błąd jednego nie ukrywa pozostałych.
- Gdy nie odpowie żadne, źródło ma `status: "offline"` i zachowuje ostatnią listę, jeśli była.
- Kafelek czyta trasę co minutę, tylko gdy pulpit jest widoczny (`usePollingEnabled`), więc `gh` jest pytane najwyżej co 30–90 s.
- Kokpit i obserwatory PR dzielą jedną wstrzykniętą instancję `createPrReader`: `gh pr view` jednego PR-a jest pamiętany
  30 s, gdy checki trwają, a 90 s po ich ustabilizowaniu; równoczesne odczyty tego samego URL-a czekają na jedno żądanie.
  To ten sam limit 30–90 s co kafelka, a nie osobny krótszy cache kokpitu.

## Scenariusze i zrzuty

`scenarios/standard.json` ma przykładowe PR-y (różne stany review i CI). Kafelek pokazuje
`just screenshots standard --pages pulpit --open tile:github-pr` (tak samo zadanie Cezara z `open: tile:github-pr`); nie ma go
w domyślnym `autoTiles`.
