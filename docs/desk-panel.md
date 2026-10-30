# Desk Panel: konfiguracja i interfejs

## Zmienne środowiska

Opcjonalne zmienne środowiska (nie trzeba tworzyć `.env`):

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `DESK_CEZAR_URL` | `http://127.0.0.1:4321` | Lokalny serwer Cezara; HTTP loopback, bez credentials |
| `DESK_PORT` | `5174` | Port serwera Desk Panelu; przy zmianie w development zmień również proxy Vite |
| `DESK_CALENDAR_ID` | `metelski.wiktor@gmail.com` | Konto Google i jego główny kalendarz; login jest sprawdzany |
| `DESK_EXTRA_CALENDARS` | brak | Dodatkowe kalendarze tego samego konta, rozdzielone przecinkami (identyfikator z ustawień kalendarza Google, np. zasubskrybowany plan Garmin `…@import.calendar.google.com`); ich zdarzenia trafiają do tej samej agendy |
| `DESK_MAIL_ACCOUNTS` | konto z `DESK_CALENDAR_ID` | Konta Gmail na liście poczty, rozdzielone przecinkami (np. `a@gmail.com,b@gmail.com`) |
| `DESK_GOOGLE_OAUTH_CLIENT_FILE` | `~/.desk-panel/google-oauth-client.json` | Pobrany klient OAuth Desktop lub Web, tylko backend |
| `DESK_BANK_APP_ID`, `DESK_BANK_KEY_FILE`, `DESK_BANK_REDIRECT_URL` | brak | Konto bankowe przez Enable Banking, zob. [bank.md](bank.md) |
| `DESK_ADAPTER_ENV_FILE` | `../cezar-adapter/.env` względem projektu | Backend odczytuje istniejący port i klucz właściciela adaptera |

Usługa Windows czyta dodatkowo opcjonalny plik `%USERPROFILE%\.desk-panel\panel.env`
(poza Gitem; linie `KLUCZ=wartość`, `#` to komentarz), np. z prywatnymi adresami:

```
DESK_MAIL_ACCOUNTS=pierwszy@gmail.com,drugi@gmail.com
```

Zmiany w nim działają po `just service RESTART`. Zobacz [servy/README.md](../servy/README.md).

## Podgląd pionowy

W Ustawieniach „Otwórz podgląd pionowy” osadza niezmieniony panel w osobnym obszarze
o wymiarach głównego ekranu z `devices.json`. Podgląd przewija się bez automatycznego
pomniejszania, a powiększenie przeglądarki działa jak zwykle. Jego style dotyczą tylko
zewnętrznej warstwy; dashboard używa tego samego układu co na docelowym ekranie.
Ukryty panel zachowuje stronę i stan, ale wstrzymuje odpytywanie API i anuluje
trwające odczyty. Po zamknięciu podglądu odczyty wznawiają się od razu.
Na wąskim ekranie kafelki obszaru roboczego stoją jeden pod drugim, a długie listy
(poczta, zadania Cezara) przewijają się wewnątrz kafelka.

## Interfejs

Pulpit mieści się na poziomym ekranie (1280×720 CSS) bez przewijania. Pod paskiem z zegarem są trzy strefy jedna
pod drugą, a układ nie zależy od urządzenia:

- **góra: wybrany dzień** (na początku dzisiejszy; zmienia go dotknięcie dnia na dole, nie ma strzałek). Kafelek daty
  (dla innego dnia niż dziś z niebieską obwódką i podpisem „jutro”, „pojutrze” lub miesiącem), kolumna **Trening**
  (nazwa, sport i czas, poziom z efektem treningowym, kształt interwałów albo, gdy trening jest zrobiony lub
  zaczęty, ile przejechano z planu; pod spodem uwaga o wczorajszym treningu zrobionym tylko częściowo), kolumna
  **Spotkania** (lista z godzinami, całodniowe jako „cały dzień”, najbliższe w ciągu 15 minut podświetlone, a dalsze
  jako „+N więcej”) i odliczenie do spotkania albo do jego końca. Dotknięcie treningu lub spotkania otwiera szczegóły.
  Rozmiary: **standard** i **zmniejszona** (jedna linia chipów). Rozmiar zmienia uchwyt na dolnej krawędzi paska, na środku: przeciągnięcie ciągnie krawędź, a widok już w trakcie przełącza się na rozmiar, na którym by się zatrzymał (zatrzaskuje się na najbliższym po puszczeniu); samo dotknięcie wybiera kolejny;
- **środek: obszar roboczy**, siatka 4 kolumn × 2 wierszy kafelków. Kafelek zajmuje jedną komórkę albo kilka i jest jedną rzeczą:
  jednym limitem AI (osobny kafelek dla Claude, Codex, Gemini i każdej grupy Antigravity, np. „Claude & GPT” czy frontier;
  okno 5h jako gruby pasek, 7d jako cienki, biała kreska pokazuje, ile czasu okna już upłynęło, a kolor mówi tylko, czy
  zużycie wyprzedza czas; przycisk w rogu otwiera podział zużycia), Cezarem (najpierw zadania czekające na Ciebie, potem
  te w toku i zakończone), pocztą (lista nadawca / temat / początek wiadomości, w lewo przeczytane, w prawo kosz; w
  kafelku jednokomórkowym tylko nadawca i temat) albo komputerem (CPU i RAM jako dwa paski, od dwóch komórek jako wykresy
  z ostatnich 5 minut), albo kontem bankowym (saldo, sumy 30 dni i ostatnie operacje, zob. [bank.md](bank.md)). Kafelek zawsze rysuje się w całości: jeśli źródło milczy, mówi to spokojnie, zamiast znikać.
  Cały obszar to jedna karta, a kafelki dzielą tylko cienkie linie. Komórka bez kafelka to pusty kafelek z ikonami tego, co można w niej postawić (bez tego, co już stoi na siatce i co
  wyłączono w Ustawieniach); dotknięcie ikony stawia kafelek 1×1.
  Dopóki niczego nie ułożysz, układ jest automatyczny: limity i poczta po lewej, Cezar po prawej na dwa wiersze, a przy
  większej liczbie limitów na jeden wiersz, żeby wszystko się zmieściło. Kafelki układa się od razu, bez trybu edycji:
  uchwyt u góry kafelka przesuwa go (kafelek upuszczony na inny odsuwa go do najbliższych wolnych komórek, a gdy to właśnie
  jego dawne miejsce, kafelki się zamieniają; zielona obwódka pokazuje, gdzie wylądują, czerwona, że nie ma miejsca),
  prawa i dolna krawędź oraz róg zmieniają rozmiar (w trakcie kafelek pokazuje swój rozmiar), a X w rogu wyłącza kafelek
  i zwalnia komórki. Rosnący kafelek sam odsuwa sąsiadów na wolne komórki; gdy nie mają dokąd, rośnie tylko
  tak daleko, jak się da, i mówi, dlaczego dalej nie. Układ jest zapamiętany w przeglądarce (`desk-panel.workspace`; telefon
  i kiosk mają osobne), a Ustawienia → Pulpit przywracają automatyczny układ otwartego pulpitu wirtualnego (na dodatkowym: pusty). Poniżej 900 CSS px kafelki stoją jeden pod drugim
  w kolejności czytania, bez pustych kafelków i edycji. Obszar bierze to, co zostawią pozostałe strefy, a przy miesiącu
  płynnie się zwija do zera. **Widget i kafelek**: widget to rodzaj (Poczta, Komputer, limit, Cezar, Zadania), kafelek to jego egzemplarz na siatce (`src/tile-grid.ts`). Kafelek ma `id`, `kind` (który to widget) i opcjonalną `config` (krótkie ustawienia tego jednego kafelka, np. którą listę pokazuje). Przeciąganie, zmiana rozmiaru i wyłączanie działają po `id`. Dziś każdy widget stoi na pulpicie raz (`id` równe rodzajowi), a rodzaje wymienione w `MULTI_KINDS` (`src/workspace-kinds.ts`; dziś `todo`, czyli [Zadania](zadania.md)) mogą stać wiele razy, mają własne `id` (`rodzaj#1`, `rodzaj#2`) i są oferowane w pustych komórkach zawsze. Zapisane wcześniej układy bez `id` dostają je przy odczycie (rodzaj), więc nic nie trzeba przenosić. **Pulpity wirtualne**: ta siatka ma kilka stron (do 8), np. jedną o AI, drugą o poczcie i Cezarze. Przycisk z ikoną pulpitów w górnym pasku (tylko na stronie głównej) otwiera menu: wybór pulpitu, ołówek zmienia nazwę (Enter zapisuje, Esc odrzuca), kosz usuwa po drugim dotknięciu (nigdy ostatni), „Nowy pulpit” dodaje pusty i od razu go otwiera. Przy więcej niż jednym pulpicie przycisk pokazuje nazwę otwartego. Tylko siatka jest osobna: zegar, górny pasek dnia i dolna strefa dni są wspólne, a ten sam kafelek może stać na kilku pulpitach. Pulpity i otwarty pulpit pamięta przeglądarka (`desk-panel.pulpits`; układ pierwszego, „Główny”, jest w dawnym `desk-panel.workspace`, więc zapisany wcześniej układ po prostu jest pierwszym pulpitem, a pozostałych w `desk-panel.workspace.<id>`). Na wąskim ekranie menu otwiera się u dołu ekranu (kod: `src/pulpits.ts`, `src/PulpitMenu.tsx`);
- **dół: dni** (z linkiem „Kalendarz” do pełnej agendy). Rozmiary: **krótki** (chip na dzień: etykieta i kropki treningów i spotkań), **średni** (domyślny: karta
  na dzień z planem, czasem i poziomem, ✓ przy wykonanym) i **miesiąc** (pięć tygodni od poniedziałku tego tygodnia,
  zajmuje cały ekran pod górą, a zmiany rozmiaru (także górnego paska) są płynne; dni, które minęły, są wygaszone, bo źródła czytamy od dziś). Dotknięcie dnia wybiera go
  i góra pokazuje jego plan. Wydarzenia całodniowe z zasubskrybowanego kalendarza Garmin, które dublują trening, są
  pomijane (dotyczy tylko takich, które mają tę samą nazwę i dzień).

Rozmiary góry i dołu zmienia uchwyt przy tej strefie (przeciągnięcie albo dotknięcie: kolejny rozmiar, po ostatnim pierwszy), są zapamiętane w przeglądarce, a po
bezczynności (zegar) wracają do domyślnych razem z wybranym dniem. Kalendarz Google jest czytany na sześć tygodni
naprzód, plan Garmin na pięć; dalej jest pusto.

Status treningu (wykonany / częściowo / nie zrobiony) wynika z nagrań z danego dnia, patrz [Garmin](garmin.md). Dopóki źródło nie odpowie, dni pokazują kreskę zamiast „wolne”.
Przycisk zegara w pasku włącza ciemny zegar (tryb ambient): duża godzina, data i do czterech linii tego, co się liczy
(najbliższe spotkanie, trening, Cezar czeka, nieprzeczytana poczta). Panel nie przechodzi w niego sam po bezczynności.
Obraz dryfuje o kilka pikseli na minutę, a dotknięcie dowolnego miejsca budzi panel bez klikania w to, co pod spodem;
`?ambient=day|night` w adresie pokazuje zegar od razu.
W pasku u góry są trzy przyciski: księżyc / słońce przełącza dzień i noc (noc przyciemnia cały pulpit i zegar; bez
wyboru decyduje godzina 23–6, a ręczny wybór trwa do najbliższego świtu lub zmierzchu) oraz przycisk zegara, który pokazuje tryb ambient. Pełnoekranowe okno daje `just kiosk`.
Obciążenie komputera nie ma własnej karty: chip „PC” w pasku czerwieni się dopiero po 20 s ≥90% (krótki skok go nie rusza),
dotknięcie otwiera okno (jak lista zdarzeń: Esc lub dotknięcie poza nim zamyka) z wykresami CPU i RAM z ostatnich 5 minut,
progiem 90% i przyciskiem do zakładki Komputer, a utrzymany stan zostawia wpis w zdarzeniach. Dzień bez spotkań i wydarzeń całodniowych
nie rysuje już niczego osobnego: dzień jest po prostu pusty („Dziś bez treningu i spotkań”).
Poniżej 900 CSS px Pulpit przechodzi do jednej kolumny i przewija się jak strona. Zdarzenia panelu
(dzwonek z liczbą wszystkich, także przy zerze; dotknięcie rozwija listę, albo „Brak zdarzeń”, z przyciskiem do zasad;
Esc lub dotknięcie poza nią zwija) stoją w pasku u góry. Lista nie otwiera się sama: zdarzenia wykryte od ostatniego jej
otwarcia dzwonek zgłasza plakietką „+N” i rzadkim, spokojnym podskokiem (co 14 s, wyłączonym przy „zmniejsz ruch”), a w
otwartej liście są oznaczone „nowe”. Czas ostatniego otwarcia jest zapamiętany w przeglądarce.

Gdy źródło nie jest świeże, sekcja pokazuje częstotliwość odświeżania, czas danych i osobno czas ostatniego
poprawnego pobrania przez panel, z dokładnością do sekund. Błąd nie przesuwa daty
ostatniego sukcesu. Świeżość jest sprawdzana względem bieżącego czasu renderu,
również gdy pomiar nadejdzie pomiędzy jednosekundowymi tickami zegara interfejsu.

Dotknięcie wiersza otwiera szczegół; osobny przycisk otwiera źródło. Widoczność sekcji
Pulpitu zapisuje się w localStorage (Ustawienia → Pulpit); wyłączona sekcja (albo limit w „Widoczności limitów AI”)
znika też z kafelków i z ikon w pustych kafelkach. Brak procentów postępu, ETA i danych dysku.

W usłudze wszystkie karty korzystają z podłączonych źródeł; nie podstawiają danych demonstracyjnych przy błędzie.
Osobny `just scenario` uruchamia syntetyczne źródła do pracy nad UI, zob. [testowanie.md](testowanie.md).
Null oznacza brak pomiaru; historia to dyskretne obserwacje.
Zdarzenia korzystają z tych samych źródeł co karty. Offline lub stare dane nie
tworzą nowych alertów.
