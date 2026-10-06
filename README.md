# Calmfox Watch – kontrola dostępności w GitHub Actions

Po wdrożeniu sprawdza dostępność cyfrową (WCAG, poziom A albo AA) wybranych podstron
i przerywa build, gdy wynik spadnie poniżej progu albo pojawi się **nowy** problem krytyczny.
Wynik i tabela najważniejszych problemów lądują w podsumowaniu joba; szczegóły i instrukcje
naprawy są w panelu.

Wymaga modułu **Dostępność cyfrowa** (Dostępność Pro albo pakiet Complete).

## Klucze

W panelu: **Integracje → Po wdrożeniu → Włącz webhook**. Dostaniesz token strony i sekret
(sekret pokazujemy raz). Zapisz oba w repozytorium jako sekrety Actions:
`CALMFOX_WATCH_TOKEN` i `CALMFOX_WATCH_SECRET`. To te same klucze, co przy webhooku
wdrożeniowym — jeśli już go używasz, wystarczy dodać token.

## Przykład

```yaml
name: Wdrożenie
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # … Twoje kroki wdrożenia …

      - name: Dostępność cyfrowa
        id: a11y
        uses: calmfoxpl/watch-a11y-action@v1
        with:
          token: ${{ secrets.CALMFOX_WATCH_TOKEN }}
          secret: ${{ secrets.CALMFOX_WATCH_SECRET }}
          threshold: 80
          level: AA
          urls: |
            /
            /koszyk
            /kontakt

      - name: Link do raportu
        if: always()
        run: echo "Raport: ${{ steps.a11y.outputs.report-url }}"
```

## Wejścia

| Wejście | Domyślnie | Opis |
|---|---|---|
| `token` | — | Token strony (wymagany). |
| `secret` | — | Sekret webhooka (wymagany). |
| `threshold` | `80` | Minimalny wynik 0–100. |
| `level` | `AA` | Poziom WCAG: `A` albo `AA`. |
| `urls` | adresy z panelu | Do 10 ścieżek na domenie strony. Puste = strona główna i adresy wskazane w kreatorze dostępności. |
| `timeout` | `300` | Ile sekund czekać na wynik. |
| `fail-on-error` | `true` | `false` = nie przerywaj builda, gdy kontrola się nie odbyła (limit, awaria, czas). |
| `api-url` | `https://watch.calmfox.net` | Adres usługi. |

## Wyjścia

`score`, `passed` (`true`/`false`), `report-url`, `check-id`.

## Kiedy kontrola „przechodzi”

- wynik na sprawdzonych adresach ≥ `threshold`, **oraz**
- brak nowych problemów krytycznych — takich, których panel nie zna jeszcze jako otwartych
  ani wyciszonych.

Wynik liczymy tym samym wzorem co w panelu, ale tylko z reguł WCAG do wybranego poziomu
(dobre praktyki i AAA nie przewracają builda), a reguły wyciszone w panelu nie odejmują
punktów. Znane problemy krytyczne obniżają wynik, ale same nie blokują wdrożenia.

Kontrola z CI **nie zmienia** stanu panelu (wykryć, wyniku, trendu) — to bramka dla
pipeline'u. Ocena obrazków przez AI jest w niej wyłączona; testy interakcji (klawiatura,
powiększenie, formularze) działają jak w zwykłej kontroli.

## Bez GitHub Actions (curl)

```bash
ID=$(curl -sS -X POST https://watch.calmfox.net/api/public/ci/a11y \
  -H "X-Calmfox-Hook: $CALMFOX_WATCH_TOKEN" \
  -H "X-Calmfox-Secret: $CALMFOX_WATCH_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 80, "level": "AA", "urls": ["/", "/koszyk"]}' | jq -r .id)

curl -sS https://watch.calmfox.net/api/public/ci/a11y/$ID \
  -H "X-Calmfox-Hook: $CALMFOX_WATCH_TOKEN" \
  -H "X-Calmfox-Secret: $CALMFOX_WATCH_SECRET"
```

Odpowiedź stanu: `status` (`queued` → `running` → `done`/`failed`), `score`, `passed`,
`critical`, `criticalNew`, `issues` (do 10: `rule`, `title`, `impact`, `count`, `pages`, `new`),
`pages`, `reportUrl`. Limit: 30 kontroli na godzinę na stronę.

Klucze podawaj wyłącznie w nagłówkach — żądanie z kluczem w adresie dostaje 400.

## Rozwój

Bez zależności (Node 20). Testy: `node --test integrations/github-action-a11y/index.test.js`.
