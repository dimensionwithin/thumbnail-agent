# Thumbnail Agent

Hat den kompletten YouTube-Back-Katalog eines Kanals neu bebildert: Metadaten je Video
auslesen, per Claude-API eine Schlagzeile und eine Markttendenz bestimmen, daraus ein
Thumbnail rendern, alles zur Sichtprüfung vorlegen und erst nach Freigabe hochladen.

**Status: abgeschlossen.** Die Migration war ein einmaliger Vorgang und ist erledigt.

Ein Teil davon läuft weiter: der **Thumbnail-Compositor** wird täglich für neue Videos
genutzt. Er hat unten einen eigenen Abschnitt.

## Was es löst

Ein gewachsener Kanal hat Thumbnails aus mehreren Jahren und in ebenso vielen Stilen.
Von Hand neu zu bebildern heißt: pro Video Titel lesen, Aussage erfassen, Bild bauen,
hochladen — bei einem dreistelligen Katalog Tagesarbeit ohne Erkenntnisgewinn.

Automatisieren allein löst das nicht, denn ein Skript, das massenhaft auf einen Live-Kanal
schreibt, kann in Minuten Schaden anrichten, den niemand rückgängig machen kann. Das
Projekt trennt deshalb sauber: die Maschine schlägt vor, der Mensch entscheidet, und jeder
Schreibvorgang ist vorher gesichert und danach umkehrbar.

## Ergebnis

Zwei mit dem Compositor gerenderte Thumbnails, 2560×1440, direkt aus der Pipeline:

<table>
  <tr>
    <td width="50%"><img src="adw-vid001.png" alt="Gerendertes Thumbnail, Beispiel 1" width="100%"></td>
    <td width="50%"><img src="adw-vid003.png" alt="Gerendertes Thumbnail, Beispiel 2" width="100%"></td>
  </tr>
</table>

## Wie es funktioniert

**Die Migration — vier Stufen, eine Freigabe**

- `youtube/` — OAuth-Desktop-Flow, Inventar des Back-Katalogs. `derive-format` leitet nur
  aus harten Signalen ab (Preset, Episodennummer, Datum), nicht aus Interpretation.
- `decision/` — ein Claude-API-Aufruf je Video bestimmt Schlagzeile und Tendenz
  (bullish / bearish / neutral). Die Tendenz ist fest auf Bildsprache abgebildet:
  bullish → Expansion/Salbeigrün, bearish → Kollaps/Ochsenblut, neutral → Fraktal/Messing.
- `render` — Playwright fährt den Compositor headless und schreibt PNGs.
- `review/` — Kontaktbogen aller Vorschläge als eine HTML-Seite zur Sichtprüfung.
- `publish/` — `backup` → `publish` → `restore`.

**Die Sicherheitslinie — überall dieselbe**

Jede Operation, die den Live-Kanal verändert, hält sich an denselben Satz Regeln:

- Ohne Flag passiert nichts. Der Default ist Dry-Run und gibt nur den Plan aus.
- Echtes Schreiben verlangt `--execute` **und** eine interaktiv getippte Bestätigung.
- Ohne vollständiges Backup kein Publish. Ein Video ohne Backup-Eintrag wird nie
  angefasst; fehlt das Manifest ganz, bricht der Lauf ab.
- Vor jeder Änderung wird der alte Zustand protokolliert — die Aktion bleibt umkehrbar.
- Kleine Batches mit Pause zwischen den Aufrufen (API-Quota) und ein Fortschrittslog:
  nach einem Abbruch werden erledigte Videos übersprungen.

Dieselbe Linie tragen auch die späteren Kanalarbeiten: das Unlisting alter Shorts
(`publish/unlist-shorts.js`, mit CSV-Log und eigenem Restore-Pfad) und der Aufbau der
Livestream-Playlist.

**Mock-Modus**

Die gesamte Pipeline läuft ohne Netzzugang und ohne Zugangsdaten durch: fehlt der
API-Key oder ist `--dry-run` gesetzt, liefern Entscheidungs- und Publish-Schicht
deterministische Beispieldaten. Damit ist der Ablauf prüfbar, bevor er echte Kanaldaten
berührt.

## Der Thumbnail-Compositor

`thumbnail-compositor.html` — eine einzelne Datei, die im Browser ein Thumbnail aus einer
Konfiguration rendert. Wird weiterhin täglich für neue Videos verwendet, unabhängig von
der abgeschlossenen Migration.

- **Vollständig eigenständig.** Keine externe Anfrage: kein CDN, kein Webfont-Dienst,
  keine Bild-URL. Die beiden Schriften (Newsreader, JetBrains Mono) liegen als
  eingebettete WOFF2-Daten in der Datei, die Chartgrafik wird zur Laufzeit gezeichnet.
  Das Render-Skript erzwingt das: der Browser läuft offline und blockt jede Anfrage,
  die nicht `file:`, `data:` oder `blob:` ist — ein versehentlich eingeschleppter
  CDN-Verweis fällt sofort auf.
- **Eine Schnittstelle.** `window.adwRender(config)` liefert das fertige Bild als
  Data-URL zurück. Deshalb ist dieselbe Datei sowohl manuelles Werkzeug im Browser als
  auch Renderer im Automatisierungslauf — es gibt keine zweite Implementierung, die
  auseinanderlaufen könnte.
- **Vier Presets** (Standard, Inner Circle, Livestream, ohne Chart), drei Farbwelten,
  drei Chartformen, dazu Episodennummer, Datum, Label und automatische Titelskalierung.
- `src/config-schema.js` hält den Vertrag zwischen Automatisierung und Renderer:
  validiert, setzt unbekannte Werte auf Defaults zurück und meldet das als Warnung,
  statt still etwas anderes zu zeichnen.

## Der Review-Harvester

Ein zweites, unabhängiges Feature im selben Repo (`src/reviews/`), das die bestehende
YouTube-Authentifizierung mitbenutzt: sammelt positive Kanalkommentare, filtert und
ranked sie, legt sie in einem lokalen HTML-Board zur Kuration vor und exportiert die
freigegebenen als `reviews.json` für die Website. Anonymisierung ist eingebaut — echte
Handles landen nicht im Export. Auch hier kein Auto-Publish: die Datei wird bewusst und
getrennt ausgespielt. Details in [src/reviews/README.md](src/reviews/README.md).

## Technik

- Node.js, CommonJS, keine Build-Stufe
- `@anthropic-ai/sdk` für die Entscheidungsschicht; der System-Prompt trägt die
  Marken- und Stilregeln und ist mit `cache_control` zum Zwischenspeichern markiert,
  damit der stabile Teil über einen ganzen Katalogdurchlauf nicht neu bezahlt wird
- `googleapis` + `google-auth-library` für YouTube Data API v3 (OAuth-Desktop-Flow)
- `playwright` (Chromium, headless) als Render-Antrieb
- Der Compositor ist reines HTML/CSS/JS ohne Framework und ohne Abhängigkeiten
- **Keine automatisierte Testsuite.** Es gibt drei einmalige Verifikationsskripte unter
  `scripts/`, die die Sicherheitsgarantien nachweisen — kein Upload ohne `--execute`,
  Backup-Pflicht, Manifest-Pflicht, Wiederaufnahme nach Abbruch. Sie sind nicht Teil
  der Pipeline und laufen nicht in CI.
- Keine Typisierung (kein TypeScript, keine JSDoc-Typen)
- Zugangsdaten ausschließlich über `.env`; `.env.example` liegt bei. Tokens und
  Schlüssel sind über `.gitignore` ausgeschlossen und waren nie im Repository.

Quellcode und Kommentare sind auf Deutsch.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
