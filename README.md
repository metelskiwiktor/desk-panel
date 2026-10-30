# Desk Panel

Lokalny panel React + TypeScript na poziomy ekran biurkowy (1280×720 CSS). **Cezar i Google Calendar korzystają
z rzeczywistych danych. CPU, RAM oraz bieżące limity AI również są rzeczywiste.**
Zegar korzysta z czasu przeglądarki.

## Uruchomienie

Wymagany Node.js 22.12+, npm i [just](https://github.com/casey/just). Uruchom Cezara, następnie w katalogu Desk Panelu:

```powershell
just setup
npm run dev
```

`just setup` instaluje zablokowane zależności (`npm ci`), Chromium dla Playwrighta i łączy `.claude/skills` oraz
`.agents/skills` z folderem `skills/` (skille agentów dla Claude Code i Codexa, zob. mapę w AGENTS.md). W istniejącym
checkoucie same dowiązania tworzy `node scripts/link-skills.mjs`.

To uruchamia lokalne API na `http://127.0.0.1:5174` i Vite (domyślnie port 5173).
Do zwykłego używania wystarczy jeden proces, serwujący również frontend:

```powershell
npm run build
npm start
```

Otwórz `http://127.0.0.1:5174`. Bez Cezara panel działa ze stanem niedostępności;
nie wstawia przykładowych zadań zamiast prawdziwych.

`just` wyświetla krótki zestaw komend; `just check` uruchamia testy, typy, knip i build, `just update`
wdraża do usługi Windows. Autostart, usługa i kiosk: [docs/system.md](docs/system.md).

## Dokumentacja

| Dokument | Zawartość |
| --- | --- |
| [docs/desk-panel.md](docs/desk-panel.md) | Zmienne środowiska (`panel.env`), podgląd pionowy, układ i zachowanie interfejsu |
| [docs/system.md](docs/system.md) | Uruchamianie i usługa Windows (Servy), CPU i RAM, tryb kiosku |
| [docs/cezar.md](docs/cezar.md) | Dane Cezara, limity AI, monitoring V2, warmup |
| [docs/gmail.md](docs/gmail.md) | Karta Poczta: zakres, akcje, odczyt |
| [docs/calendar.md](docs/calendar.md) | Google Calendar i OAuth (też dla Gmaila) |
| [docs/znanylekarz.md](docs/znanylekarz.md) | Wybór terminu wizyty w rozmowie Wektora i zapis do Google po potwierdzeniu |
| [docs/garmin.md](docs/garmin.md) | Plan treningowy z Garmin Connect; katalog danych w [docs/garmin-data.md](docs/garmin-data.md) |
| [docs/zdarzenia.md](docs/zdarzenia.md) | Reguły i historia zdarzeń panelu |
| [docs/zadania.md](docs/zadania.md) | Listy zadań: model, zapis, API zmian, dostęp agenta czatu |
| [docs/czat.md](docs/czat.md) | Wektor na Hermesie: rozmowy, wskazywanie, zgody, API i zgodność ze starszym silnikiem AGY |
| [docs/wektor-ui.md](docs/wektor-ui.md) | Mapa frontendu Wektora, style, stany ładowania i powtarzalne testy GUI (`just wektor-ui`) |
| [docs/hermes.md](docs/hermes.md) | Hermes Agent jako silnik czatu: instalacja na Windows, usługa, klucze, narzędzia MCP panelu, zgody, ograniczenia |
| [docs/diagnostyka-czatu-wektora.md](docs/diagnostyka-czatu-wektora.md) | Jak znaleźć i przeanalizować problem w rozmowie Wektora |
| [docs/bank.md](docs/bank.md) | Kafelek Konto: PKO BP przez Enable Banking, konfiguracja, zgoda, limity odczytów, własne kategorie, osoby i podpowiedzi |
| [docs/openrouter.md](docs/openrouter.md) | Kafelek OpenRouter: dzienny koszt modeli z logu Hermesa, budżet i wydatki z API |
| [docs/tailscale.md](docs/tailscale.md) | Dostęp z telefonu przez Tailscale |
| [docs/testowanie.md](docs/testowanie.md) | Scenariusze, zrzuty ekranu, testy i CI |
| [servy/README.md](servy/README.md) | Rejestracja usługi Servy i logi |
