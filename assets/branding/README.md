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

## Ausgerichtet wird an der Silhouette, nicht am Rahmen

Die Vorlagen tragen unterschiedlich viel transparenten Rand. Gemessen an der
Alphakante aller 14 Dateien (1536 x 1024):

    links   66 (feiern)   bis 326 (verwirrt) Quellpixel
    rechts  21 (verwirrt) bis 256 (verliebt) Quellpixel
    unten   bei allen 14 exakt 0 -- die Figur ist angeschnitten

Wer den RAHMEN an den Bildrand setzt, setzt damit bei jeder Variante etwas
anderes an den Rand. Bei Randabstand 0 endete der Rahmen zwar ueberall auf
x 1280, das aeusserste sichtbare Pixel aber:

    verwirrt      1273,4    Luecke  6,6 px   (der erhobene Arm fuellt den Rand)
    sensenmann    1225,6    Luecke 54,4 px
    neutral       1222,2    Luecke 57,8 px
    verliebt      1200,0    Luecke 80,0 px

`verwirrt` sass dadurch sichtbar weiter aussen als alle anderen -- im Betrieb
aufgefallen, nicht in der Theorie. Seit CO1 haengt der Randabstand deshalb am
aeussersten SICHTBAREN Pixel: bei allen 14 Varianten liegt es jetzt auf 1280,00
rechts und 0,00 links. Weil `drawEmblem()` auf der linken Seite um die
Rahmenmitte spiegelt, faellt dort die RECHTE Alphakante nach aussen -- beide
Seiten haengen an derselben Kante, der Randabstand wirkt seitengleich.

Senkrecht gilt dieselbe Regel, sie ist heute aber ein Nulldurchgang: alle 14
Vorlagen laufen unten bis zur letzten Zeile. Die Regel steht trotzdem im Code,
damit eine kuenftige Vorlage mit Luft unten nicht ueber der Kante schwebt.

Die Alphakanten werden zur Laufzeit je Bild einmal gemessen und
zwischengespeichert, nicht als Tabelle gepflegt -- eine Tabelle liefe
auseinander, sobald eine Vorlage nachgeschaerft wird. Ist das Canvas nicht
lesbar, faellt die Messung auf den vollen Rahmen zurueck, also auf das
Verhalten von vorher.

Dieselbe Silhouette speist auch die Sperrflaeche fuer die Auto-Platzierung, die
Seitenwahl in `freeSide()` und das Ausweichen des LIVE-Abzeichens. Vorher galt
dort bis zu 80 px transparenter Rand als belegte Flaeche.

## Randkonstanz und Kopfkonstanz sind nicht gleichzeitig erfuellbar

**Bitte nicht erneut versuchen.** Die Ausrichtung an der Silhouette kostet
Konstanz der Kopfposition, und das laesst sich nicht wegrechnen.

Gemessen ueber alle 14 Varianten per Schablonensuche nach der **Sonnenbrille**
-- normierte Kreuzkorrelation gegen die Brillenpartie aus `neutral`, zusaetzlich
ueber die Groesse, weil `sensenmann` ein kleineres Gesicht im Rahmen traegt und
eine starre Schablone dort um rund 200 px verrutscht. Schwellwert-Finder taugen
hier nicht: ein reiner Dunkelfilter faengt bei `cowboyhut` 295 796 Pixel
Kapuzenmasse, und eine Gesichts-Bounding-Box wird von `christkind`s Gewand
aufgeblaeht.

    am Rahmen ausgerichtet:      Streuung x 21,9 px
    an der Silhouette (heute):   Streuung x 69,8 px

Sechs Kriterienfamilien wurden durchgemessen, um beides zu bekommen. Keine hilft:

    Rahmen (frueher)                     21,9    Randluecke 6,6 - 80,0 px
    volle Bounding-Box (heute)           69,8    Randluecke 0
    Spaltenmasse > 5...60 % der Hoehe    70,8 - 85,8
    aeussere 0,5...5 % der Flaeche weg   70,2 - 71,7
    groesste Masse nach Erosion 10...60  71,4 - 81,1
    nur unterster Rumpf 30...50 %        69,8 - 73,0

Der Grund: wie weit der Kopf von der Silhouettenkante entfernt ist, ist eine
Eigenschaft der jeweiligen Zeichnung. Sie schwankt um genau die 73 px, um die
auch die transparenten Raender auseinanderliegen. Die frueheren 21,9 px waren
keine Systemeigenschaft, sondern ein Nebeneffekt des geteilten Rahmens --
erkauft mit der Randstreuung oben.

**Wo der Hebel sitzt, falls es doch stoert:** `verwirrt` traegt allein die
Haelfte. Sein Kopf liegt bei x 1012,5, alle uebrigen dreizehn zwischen 1049,8
und 1082,3 -- ohne diese eine Variante waeren es **32,5 px**. Automatisch ist
das nicht zu trennen: bei 40 px Erosion steht `verwirrt` immer noch bei 8,1 px
gegen 45 - 99 px bei allen anderen, der erhobene Arm ist kein duenner Fortsatz
und reicht bis in die untere Bildhaelfte.

**Warum trotzdem die Silhouette gewaehlt wurde (29.08.2026):** Die Randstreuung
ist im Betrieb aufgefallen, die Kopfstreuung nicht -- das sagt, was im fertigen
Bild zaehlt. Die Alternative waere eine von Hand gesetzte Ankerkante je Variante
gewesen (haette 32,5 px gebracht), aber jede neue Variante braeuchte dann eine
Entscheidung. Mit weiteren Jahreszeiten waere das dauerhafte Handarbeit -- genau
das, was die Laufzeitmessung abschafft.

Wer neue Varianten erzeugt, muss den Rahmen also NICHT mehr einhalten; der
transparente Rand darf beliebig sein. Ein gleicher Kopfmittelpunkt bleibt aber
wuenschenswert, denn nur die Vorlage selbst kann die Kopfstreuung senken.

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
