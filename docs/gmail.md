# Poczta (Gmail)

Karta „Poczta” pokazuje nieprzeczytane wątki z Odebranych z ostatnich 30 dni (`in:inbox is:unread newer_than:30d`, wszystkie
karty, bez spamu i kosza) ze wszystkich kont z `DESK_MAIL_ACCOUNTS`, najnowsze na górze.
Liczniki obejmują pobrane wątki z tego okresu (do 200 na konto), przed podziałem listy na strony;
gdy Gmail ma ich więcej, licznik ma postać „200+”. Scenariusze stosują to samo 30-dniowe okno.
Przesunięcie w lewo oznacza wątek jako przeczytany, w prawo przenosi go do Kosza w Gmailu
(odwracalne przez 30 dni; trwałego usuwania nie ma). Te same akcje są pod przyciskami
✓ i kosza oraz w szczegółach wątku. Przez 6 sekund „Cofnij” wykonuje w Gmailu akcję
odwrotną (nieprzeczytane / przywróć z kosza). Gdy Gmail odmówi, wątek wraca na listę.

Lista przewija się wewnątrz karty o stałej wysokości (`--mail-list-height`), a kolejne
porcje po 30 wątków doczytuje się przy przewijaniu. Backend czyta tylko metadane (nadawca,
temat, podgląd Gmaila, data), nigdy treści ani załączników; niezmienione wątki (ten sam
`historyId`) bierze z pamięci. Odczyt co 30 s; po błędzie zostaje ostatnia lista i jej czas.

Zakres `gmail.modify` pozwala czytać, zmieniać etykiety i przenosić do kosza. Konto
kalendarza połączone przed dodaniem poczty dalej pokazuje kalendarz, a w Ustawieniach
prosi o ponowne połączenie, żeby dodać Gmail.
