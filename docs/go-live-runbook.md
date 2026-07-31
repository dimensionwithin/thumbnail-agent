# Go-Live Runbook — Back-Catalog Thumbnail Agent

Der Code (P2–P5) ist fertig und credential-frei getestet. Dieses Dokument ist der
**scharfe Lauf** — hier kommen zum ersten Mal echte Credentials ins Spiel.

## Goldene Regel (Credential-Hygiene)

Alles ab hier passiert **auf deinem Rechner**. Niemals den Projektordner teilen,
zippen oder hochladen, sobald er `.env`, ein `*token*.json` oder echte `data/`-Inhalte
enthält. Vor jedem `git commit`/Push einmal `git status` prüfen — `.env` und
`*token*.json` dürfen **nicht** auftauchen. Output-Logs (z. B. `--inspect`) darfst du
teilen; Secrets und Tokens nie.

## Voraussetzungen (vorab besorgen)

- **Kanal verifiziert** — eigene Thumbnails brauchen einen verifizierten YouTube-Kanal,
  sonst schlägt `thumbnails.set` fehl.
- **Google-OAuth-Desktop-Client** (Cloud Console, YouTube Data API v3 aktiviert)
  → `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`.
- **`INNER_CIRCLE_PLAYLIST_ID`** der members-only Playlist.
- **`ANTHROPIC_API_KEY`** (für den echten Decision-Lauf).
- **Quota im Blick**: `thumbnails.set` kostet ~50 Units/Aufruf, Standard-Tageskontingent
  ~10.000 Units → ca. 200 Thumbnails/Tag. Großer Katalog → über mehrere Tage verteilen
  oder Quota-Erhöhung beantragen. Daher Batches.

`.env` aus `.env.example` füllen — nur lokal.

## Ablauf — drei Gates, der Reihe nach

### Gate 1 — Inventar gegen den echten Kanal verifizieren
```
npm run auth                      # OAuth-Consent, Token landet lokal (gitignored)
npm run inventory -- --inspect    # NUR Rohdaten anzeigen, schreibt nichts
```
Prüfen an echten Stichproben:
- Sonntags-Livestreams → `livestream`?
- **Donnerstags-IC-Folge, die live war → `innercircle`** (nicht `livestream`)?
- Episode/Datum plausibel?

Erst wenn das sitzt:
```
npm run inventory                 # schreibt data/inventory.json
```

### Decision-Lauf (echte Headline-/Stance-Qualität)
```
npm run decide                    # nutzt echten ANTHROPIC_API_KEY + echtes Inventar
```
→ `data/proposals.json`. Hier urteilt erstmals das echte Modell (Opus 4.8), nicht der
Mock. Besonders die mehrdeutigen Fälle ansehen (wörtlich vs. gemeint).

### Review — das menschliche Gate
```
npm run render                    # proposals -> data/thumbnails/*.png
npm run review                    # erzeugt review.html
```
`review.html` öffnen, **jedes** Video durchgehen — vor allem die gelb markierten
Low-Confidence-Karten. Korrigieren, freigeben → `decisions.json` exportieren.
Hier in Ruhe arbeiten; das ist die Stelle, die Qualität sichert.

### Gate 2 — Backup zuerst
```
npm run backup                    # lädt Original-Thumbnails nach backups/ + Manifest
```
Manifest auf Vollständigkeit prüfen (Anzahl = freigegebene Videos). Ohne vollständiges
Backup blockiert Publish — so soll es sein.

### Gate 3 — kleiner bestätigter Batch
```
npm run publish                              # Dry-Run: nur Plan, lädt nichts
npm run publish -- --execute --batch 3       # echter Upload, Bestätigung: PUBLISH
```
Danach **die 3 am Kanal sichtprüfen.** Sehen sie gut aus → Rest in Batches weiter
(Resume überspringt Erledigtes). Etwas falsch → sofort stoppen und zurückrollen:
```
npm run restore -- --execute      # spielt Originals aus backups/ zurück
```

## Reihenfolge auf einen Blick

`auth` → `inventory --inspect` (Gate 1) → `inventory` → `decide` → `render` → `review`
→ `backup` (Gate 2) → `publish --execute --batch klein` (Gate 3) → sichtprüfen → Rest.

Nichts überspringen. Die Gates existieren, weil das Publizieren der einzige
schwer umkehrbare Schritt ist.
