# Back-Catalog Thumbnail Agent — Implementierungsplan

*at dimension within · Handoff-Brief für ein Claude-Code-Projekt*

## Ziel

Alle Bestandsvideos mit neuen, markenkohärenten Thumbnails ausstatten — über den
bestehenden **Thumbnail Compositor** als Render-Engine, mit **generierten Charts**
als Hintergrund, automatisch aus den Video-Metadaten abgeleitet, und mit
**menschlicher Freigabe vor dem Publizieren**.

## Grundprinzip

Der Compositor wird *nicht* neu gebaut — er wird **ferngesteuert**. Drei Schichten:

1. **Render-Engine** — der vorhandene `thumbnail-compositor.html`, headless getrieben.
2. **Chart-Engine** — die aus dem Compositor entfernte Generator-Logik
   (Collapse / Expansion / Fractal), wiederbelebt und an die Video-Stance gekoppelt.
3. **Orchestrierung (der „Agent")** — Metadaten → Entscheidung → Render → Review → Publish.

Leitsatz: **Vorschläge, kein Blind-Publish.** Jede automatische Entscheidung ist
korrigierbar, und das Hochladen ist ein separater, bewusst bestätigter Schritt.

## Komponenten

### 1. chart-engine
- Wiederbelebung von `makeOHLC` / `ChartPanel` / `FractalPanel` aus der originalen `thumbnails.jsx`.
- **Deterministisch**: Seed aus der `videoId` → derselbe Chart bei jedem Lauf, reproduzierbar.
- Chart-Form an Stance gekoppelt: bearish → Collapse (Oxblood), bullish → Expansion (Sage),
  neutral/Theorie → Fractal (Brass). Die Silhouette encodiert damit die Aussage.
- Output: die Chart-Ebene, die der Compositor als Hintergrund einsetzt (nackt, auf Schwarz).

### 2. render-harness
- Headless Playwright lädt `thumbnail-compositor.html` und rendert aus einem Config-Objekt.
  *(In den Tests bereits bewiesen — offline, mit eingebetteten Fonts, Export @2x.)*
- **Nötige Compositor-Erweiterung**: Config-Injektion statt Klick-Simulation
  (z. B. `?config=…` oder `window.__config`) **und** Annahme einer generierten Chart-Ebene
  statt eines Bild-Uploads. Klein, aber Voraussetzung für die Automatisierung.

### 3. youtube-meta
- YouTube Data API: Uploads listen (`playlistItems`), pro Video Titel, `publishedAt`,
  `liveStreamingDetails`, Playlist-Zugehörigkeit ziehen.
- Format-Ableitung aus sicheren Signalen:
  - echter Livestream → `liveStreamingDetails` vorhanden → **livestream**
  - Inner-Circle-Playlist/Mitglieder-Kennung → **innercircle**
  - sonst → **standard**
- Episodennummer aus dem Titel parsen, Datum aus `publishedAt`.

### 4. decision (LLM-Vorschläge)
- **Headline**: langen Video-Titel zu 2–5 Worten + Akzentwort verdichten (`Der Markt *kippt.*`).
- **Stance**: bullish / bearish / neutral aus Titel + Beschreibung → Farbe + Chart-Form.
- Beides mit Konfidenz versehen; im Zweifel Default **Gold / Standard**.
- Ausgabe ist immer ein *Vorschlag*, den das Review überstimmt.

### 5. review
- Kontaktbogen-HTML: alle vorgeschlagenen Thumbnails + editierbare Config nebeneinander.
- Freigabe pro Video; Korrekturen (Headline, Farbe, Position) direkt möglich.
- Export einer Entscheidungs-JSON für die Publish-Stufe.

### 6. publish
- `thumbnails.set` pro freigegebenem Video.
- **Zuerst Backup aller Original-Thumbnails herunterladen** (kein einfaches Undo bei YouTube).
- In kleinen Batches, Quota/Rate-Limits respektieren.
- Voraussetzung: verifizierter Kanal + OAuth-Scope `youtube.force-ssl`.

## Config-Schema (pro Video)

Evolution des JSON-Render-Contracts aus der originalen `thumbnails.jsx`:

```json
{
  "videoId":    "abc123",
  "preset":     "standard | innercircle | livestream | nonchart | aiv | memberlive",
  "color":      "brass | sage | oxblood",
  "chartForm":  "collapse | expansion | fractal",
  "chartSeed":  918273,
  "headline":   "Der Markt *kippt.*",
  "episode":    "EP. 142",
  "date":       "2026-06-04",
  "position":   "auto | top | bottom | left | right",
  "titleScale": "auto",
  "approved":   false
}
```

## Build-Reihenfolge (Phasen)

- **P0 — Render aus Config.** Compositor-Erweiterung (Config-Injektion + generierte
  Chart-Ebene) + Harness. Beweisbar: ein Config-JSON → fertiges PNG. Risikoärmster Schritt,
  größter Hebel — die Engine steht ja schon.
- **P1 — Chart-Engine wiederbeleben** und an Stance/Form/Farbe koppeln.
- **P2 — YouTube-Inventar**: Metadaten → die *sicheren* Felder (Format, Episode, Datum).
- **P3 — Decision-Layer**: LLM-Vorschläge für Headline + Stance.
- **P4 — Kontaktbogen-Review**: Freigabe + manuelle Korrektur.
- **P5 — Publish**: Backup + Batches, als separater, bestätigter Schritt.

## Offene Entscheidungen

- **Inner-Circle-Erkennung**: über welche Playlist-ID / welches Signal? (Brauche ich von dir.)
- **Stance-Klassifikation**: rein LLM aus dem Titel, oder zusätzlich eine Keyword-/Mapping-Tabelle?
- **Umfang**: Anzahl der Videos → Batch-Größe und API-Quota.
- **Headline-Qualität**: der kreative Kern; die Review-Stufe fängt schwache Vorschläge ab.

## Wo was läuft

- **Hier im Chat** prototypbar (keine Secrets nötig): Chart-Engine-Wiederbelebung,
  Render-Harness, Config-Schema, Kontaktbogen.
- **Claude-Code-Projekt** (echtes Repo mit Secrets): YouTube-OAuth, Publish, Quota, Backups.

## Sicherheitshinweis

Bulk-Publizieren auf einen Live-Kanal ist ein hoch-wirksamer, schwer umkehrbarer Eingriff.
Reihenfolge ist nicht verhandelbar: **rendern → Review-Freigabe → Backup → in Batches publizieren.**
Kein Auto-Publish ohne ausdrückliche Bestätigung.
