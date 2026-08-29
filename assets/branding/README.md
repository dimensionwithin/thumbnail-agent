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

**Diese Dateien sind die Quelle der Wahrheit — und werden zur Laufzeit gelesen.**

Bis 29.08.2026 lagen alle Varianten als `data:`-URIs in
`thumbnail-compositor.html`. Bei 14 Stück wären das ~4,7 MB base64 in einer
Datei, die bei jedem Start komplett geparst wird, und die Bibliothek wächst
weiter. Heruntersskalieren wäre nur ein Aufschub gewesen: selbst bei 448 px
blieben ~2,5 MB, und wir skalieren beim Zeichnen ohnehin schon um Faktor 1,5
hoch (Quelle 640 px, gezeichnet auf 960 Gerätepixel).

Stattdessen gilt jetzt:

- **Mit Dienst:** Der Compositor holt jede Variante über `GET /api/emblem?slug=…`.
  Der Sitzungstoken geht als **Kopfzeile** mit, nicht in der URL — deshalb
  `fetch()` statt `<img src>`; aus der Antwort wird eine `blob:`-URL, die die CSP
  erlaubt und die das Canvas nicht „tainted" (gleicher Ursprung).
- **Ohne Dienst** (`file://`, Render-Harness): Eine einzige Variante — `neutral` —
  ist als `data:`-URI eingebettet und wird IMMER zuerst geladen. Fällt der Dienst
  aus oder fehlt er, zeichnet der Compositor sie statt gar nichts.
- **Render-Harness:** bekommt die gewählte Variante als `cfg.emblemDataUri`
  durchgereicht (siehe `render-harness.cjs`) und ist damit unabhängig von beidem.

Der Slug in der Route wird gegen `^[a-z0-9][a-z0-9-]{0,63}$` geprüft, und der
aufgelöste Pfad muss im Emblem-Ordner liegen — beides zusammen, damit auch eine
spätere Lockerung des Musters nicht aus dem Ordner hinausführt.

## Die Scheinfarbe folgt der Helligkeit

Ein dunkles Motiv braucht einen hellen Schein, ein helles einen dunklen. Das
Einbett-Skript misst je Variante den Median der Helligkeit über die deckenden
Pixel und schreibt ihn in die HTML; ab **90** gilt ein Motiv als hell und bekommt
den dunklen Schein.

Die Schwelle liegt weit von beiden Gruppen entfernt: die Graustufen-Varianten
messen 13–21, `christkind` misst 221. Gemessene Wirkung im transparenten Saum:

| | heller Grund | dunkler Grund |
|---|---|---|
| `neutral` (heller Schein) | +0,5 | +3,5 |
| `christkind` (dunkler Schein) | −4,5 | −0,2 |

`christkind` verlor auf hellem Grund vorher seine Kontur — weißes Gewand auf
hellem Hintergrund, und ein heller Schein kann dagegen nichts ausrichten. Mit
dem dunklen steht es in beiden Fällen.

## Seitenwechsel und Spiegelung

Das Emblem steht auf der dem Titel gegenüberliegenden Seite (Automatik, im
Compositor auf links/rechts übersteuerbar). Auf der linken Seite wird es
waagerecht **gespiegelt**.

**Die Spiegelung dient dem Kapuzengewicht, NICHT einer Blickrichtung.** Das ist
wichtig, weil es naheliegt, es andersherum zu vermuten: Der Avatar trägt eine
vollständig deckende Sonnenbrille, es sind keine Augen sichtbar, und der Kopf ist
nahezu frontal — es gibt schlicht nichts, was in eine Richtung zeigen könnte. An
einer Vergleichsreihe geprüft: weder liest sich die ungespiegelte Fassung links
als „abgewandt", noch die gespiegelte als „schaut zum Titel".

Was die Spiegelung dagegen tatsächlich leistet: Die Kapuze ist asymmetrisch
(27,5 % der sichtbaren Pixel weichen von der Spiegelung um mehr als 25/255 ab, im
Kopfbereich 38 %). Gespiegelt liegt die schwere Kapuzenmasse zur äußeren
Bildkante und das Gesicht öffnet sich zur Bildmitte. Ein kleiner, aber echter
kompositorischer Gewinn.

Sollte je eine Variante mit gedrehtem Kopf oder sichtbaren Augen dazukommen,
liefert dieselbe Mechanik dann auch eine echte Blickrichtung — geändert werden
muss dafür nichts.

## Die Varianten sitzen im selben Rahmen

Gemessen an den fertigen Renders aller sechs Varianten (identische Einstellungen,
nur die Datei getauscht) liegt die Kopfmitte innerhalb von **x 10,1 px und
y 10,4 px** — 0,8 % der Bildbreite. Der Avatar springt zwischen den Thumbnails
also nicht, auch nicht bei `verwirrt`, obwohl deren erhobener Arm die Silhouette
deutlich verbreitert (deckende Bounding-Box bis x 1508 statt ~1345).

Eine Verankerung am Kopf statt am Bildrahmen ist deshalb nicht nötig. Wer neue
Varianten erzeugt, sollte den Rahmen aber beibehalten — der Wert oben ist der
Maßstab, an dem sich eine neue Datei messen lassen muss.

## Kopfposition: 25 × 33 px Streuung, kein Handlungsbedarf

Gemessen über alle 14 Varianten per Schablonensuche nach der **Sonnenbrille**
(die alle tragen — der frühere Finder „größter heller Fleck" hätte bei
`christkind` das Gewand und bei `weihnachtsmann` den Bart als Gesicht gezählt):

    Streuung ueber alle 14: x 25,0 px, y 32,5 px   (fruehere sechs: 10 x 10)

    weihnachtsmann  dy +21,6     Muetze drueckt das Gesicht nach unten
    cowboyhut       dy +21,6     Hutkrempe, dasselbe
    feiern          dx +19,7     erhobenes Glas verschiebt die Figur
    lachen          dx +19,1
    christkind      dx +16,6  dy +12,2   Heiligenschein oben, Gewand breiter
    die uebrigen neun            unter 9 px

**Das ist kein Fehler und keine Vorlage muss nachgeschnitten werden.** 22 px
senkrecht sind 3 % der Bildhöhe — im direkten A/B sichtbar, beim normalen
Durchscrollen nicht. Und es ist bauartbedingt: eine Mütze muss irgendwo hin, ein
Heiligenschein auch. Wer es enger will, muss die Vorlagen mit gleichem
Kopfmittelpunkt erzeugen; am Code ist nichts zu ändern.

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
