# Branding-Assets

## emblems/ — die Emblem-Varianten

Das Emblem ist das wiederkehrende Erkennungszeichen im Preset `aiv`. Es liegt
als zweite Bildebene über dem hochgeladenen Bild und wird nicht hochgeladen,
sondern ist fest hinterlegt.

    emblems/neutral.png

**Eine Variante ergänzen** (geplant sind verschiedene Stimmungen — nachdenklich,
skeptisch, triumphierend …):

1. PNG mit echtem Alpha in `emblems/` ablegen
2. `node scripts/embed-aiv-emblem.cjs`

Sonst nichts. Kein Manifest, keine Liste im Quelltext. Der Dateiname ohne
Endung ist der Schlüssel und liefert zugleich die Beschriftung im Auswahlfeld
des Compositors (`nachdenklich.png` → „Nachdenklich"). Erlaubt sind
Kleinbuchstaben, Ziffern und Bindestriche; das Skript bricht bei allem anderen
ab.

**Anforderungen an eine Datei:**

- PNG-32 mit echtem Alphakanal. Das Skript bricht bei fehlendem Alpha ab —
  ohne Transparenz landet ein deckender Kasten auf dem Thumbnail.
- Längere Kante mindestens 512 px, besser 640. Größere Dateien sind in Ordnung,
  das Skript verkleinert beim Einbetten auf 640 px.
- **Das Seitenverhältnis ist frei.** Quadrat ist nicht nötig und Auffüllen mit
  transparentem Rand wäre falsch: `drawEmblem()` skaliert über die längere Kante,
  und der Größenregler im UI meint genau diese. Ein aufgefülltes Quadrat würde
  das sichtbare Motiv kleiner machen als die eingestellte Zahl.
- **Der Anschnitt an der UNTERKANTE ist gewollt — bitte nicht „reparieren".**
  `neutral.png` läuft auf gut zwei Dritteln der Unterkante bis an den Bildrand.
  Das ist kein Zuschneidefehler: Das Emblem sitzt bündig am unteren Bildrand des
  Thumbnails, dort liest sich der Anschnitt so, als schaue die Figur ins Bild
  hinein. Wer die Figur freistellt und mit transparentem Rand versieht, bekommt
  eine frei schwebende Büste mit sichtbarer Kante — genau das sah beim ersten
  Render aus wie eine aufgeklebte Karte. Deshalb warnt das Einbett-Skript für die
  Unterkante auch nicht. Berührungen **oben, links oder rechts** sind dagegen
  echte Fehler und werden gemeldet: dort entstünde die gerade Kante mitten in der
  Fläche.

**Diese Dateien sind die Quelle der Wahrheit.** Der Compositor lädt sie NICHT
zur Laufzeit — weder der lokale Dienst noch die Render-Harness liefern statische
Dateien aus (der Dienst kennt nur vier API-Routen, die Harness läuft über
`file://` mit hartem Offline-Routing und würde das Canvas „tainten"). Stattdessen
stehen sie als `data:`-URIs in `thumbnail-compositor.html`. Jede Variante kostet
dort dauerhaft rund 250–330 KB; das Skript warnt, wenn es zu viel wird.

## _verworfen/

Nichts hier darf eingebunden werden.

- **`aiv-emblem-teufel.png`** — der rote Teufelskopf, bis 29.08.2026 im Einsatz.
  Ersetzt durch den Avatar in `emblems/neutral.png`. Wichtig für spätere
  Kalibrierungen: Der Teufel war blutrot und hob sich überall ab, deshalb stand
  hinter ihm ein *dunkler* Schein. Der Avatar ist fast schwarz (Median-Helligkeit
  15 von 255), seine Kontur löst sich auf dunklem Grund auf — der Schein wurde
  deshalb auf *hell* gedreht. Wer je wieder ein helles Motiv einsetzt, muss
  `EMBLEM_GLOW` in `thumbnail-compositor.html` neu bestimmen.
- **`aiv-mark-v1/v2/v3`** (je `.svg` und `.png`) — nachgebaute Annäherungen an
  den Teufel, nie im Einsatz gewesen.
