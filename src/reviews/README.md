# Review-Harvester

Zweites, eigenständiges Feature in diesem Projekt (komplett getrennt vom Thumbnail-System).
Sammelt positive YouTube-Kommentare des Kanals, ranked sie, lässt sie kuratieren und
exportiert die freigegebenen als **`reviews.json`** — die Datei, die die Review-Webseite
direkt konsumiert.

> Nutzt die bestehende YouTube-Auth (`src/youtube/auth.js`) und die Video-IDs aus
> `data/inventory.json`. Keine zweite Auth-Schicht. Secrets nur über `.env`.

---

## Pipeline (4 Phasen)

| Phase | Befehl | Eingabe | Ausgabe |
|------|--------|---------|---------|
| P1 Fetch | `npm run reviews:fetch` | `data/inventory.json` | `data/comments-raw.json` |
| P2 Rank | `npm run reviews:rank` | `data/comments-raw.json` | `data/comments-ranked.json` (Top 50) |
| P3 Review | `npm run reviews:board` | `data/comments-ranked.json` | `review.comments.html` → `data/decisions.json` |
| P4 Export | `npm run reviews:export` | `data/decisions.json` | **`reviews.json`** |

Alle Zwischendateien liegen unter `data/` (gitignored). `review.comments.html` und
`reviews.json` liegen im Projekt-Root.

---

## Das Deploy-Artefakt: `reviews.json`

**Das ist die EINZIGE Datei, die die Webseite braucht.** Reines statisches JSON, keine
Secrets, keine Rohdaten, nur freigegebene Einträge.

```jsonc
{
  "generatedAt": "2026-06-12T...Z",
  "count": 42,
  "reviews": [
    {
      "quote": "Wow, das war sehr gut erklärt! ...",
      "author": "@example_viewer_1",          // echtes Handle, falls NICHT anonymisiert
      "authorAnonymized": "Example_viewer_1",  // anonyme Form (Vorname/Initialen)
      "likes": 5,
      "videoTitle": "XRP wird komplett Ausrasten...",
      "videoUrl": "https://www.youtube.com/watch?v=EXAMPLE0000",
      "date": "2024-12-08"
    }
    // ...
  ]
}
```

Die Webseite liest das Array unter **`.reviews`**.

### Datenschutz / Anonymisierung
- `author` ist **immer gefahrlos anzeigbar**: bei anonymisierten Einträgen steht dort der
  anonyme Name, das echte `@Handle` taucht im Export **nirgends** auf.
- Bei nicht-anonymisierten Einträgen ist `author` das echte Handle, `authorAnonymized`
  die anonyme Alternative.
- `npm run reviews:export` warnt, falls ein Handle mal anonym, mal offen exportiert wird.

---

## reviews.json aktualisieren (für den Update-Weg beim Deploy)

Neue Testimonials kuratieren und neu exportieren:

```bash
# 1. (nur falls neue Kommentare gezogen werden sollen)
npm run reviews:fetch        # inkrementell, cached; --refresh erzwingt Neuziehen

# 2. Ranking (siehe Hinweis zur Klassifikation unten)
npm run reviews:rank

# 3. Board im Browser öffnen, freigeben/ablehnen/anonymisieren,
#    "decisions.json exportieren" -> Download nach data/decisions.json legen
npm run reviews:board

# 4. Web-Datei neu schreiben
npm run reviews:export       # -> reviews.json
```

Danach nur noch die neue `reviews.json` auf den Server schieben (siehe Deploy-Projekt).
**Der Rest der Webseite bleibt unverändert** — es wird ausschließlich diese eine Datei
ersetzt.

---

## Hinweis: P2-Klassifikation läuft über das Max-Abo, nicht über einen API-Key

`rank.js` kann auf drei Wegen bewerten:

1. **`--classifications=<map.json>`** (genutzt): Eine Bewertungs-Map (pro Kommentar-`id`)
   wird eingelesen — erzeugt von Claude in der Claude-Code-Sitzung (Max-Abo), nicht über
   die kostenpflichtige API. Modus `external`.
2. **Live-API**: nur wenn `ANTHROPIC_API_KEY` in `.env` gesetzt ist (separate Abrechnung).
3. **Mock** (`--dry-run` oder kein Key): reine Heuristik, **keine** zuverlässige Ironie-/
   Scam-Erkennung — nur für Tests.

Kandidaten für eine erneute Bewertung rausschreiben:
`npm run reviews:rank -- --dump-candidates=data/_candidates.json`

---

## Wichtige Defaults
- Scope: `public` + `unlisted`. `private` und members-only (Inner Circle) werden
  übersprungen und im Report gelistet.
- Vorfilter `--min-words=6` (echte Kurzlober bleiben erhalten), Deutsch bevorzugt,
  Spam/Scam und reine Emojis raus.
- Scam wird **hart** aus der Top-Liste entfernt.
- **Kein Auto-Publish.** `reviews.json` ist eine lokale Datei; Veröffentlichung passiert
  bewusst und separat im Deploy-Projekt.
