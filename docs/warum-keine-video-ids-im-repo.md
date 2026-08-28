# Warum keine videoIds im Quelltext stehen

**Kurzfassung: Dieses Repo ist öffentlich. Eine videoId eines ungelisteten Videos
ist ein Zugriffsschlüssel. Beides zusammen verträgt sich nicht.**

## Die Regel

Kein Quelltext, kein Kommentar, keine Beispieldatei und keine Doku in diesem Repo
enthält:

- videoIds nicht öffentlicher Videos (`unlisted`, `private`, members-only)
- Titel solcher Videos
- echte Playlist- oder Kanal-IDs (`UC…`, `UU…`, `PL…`)

Kuratierte Listen dieser Art gehören unter `data/` oder `fixtures/*.txt` — beides
steht in `.gitignore` — und werden **zur Laufzeit gelesen**, nie fest verdrahtet.
Gesichert werden sie im privaten State-Repo, nicht hier.

## Warum das keine Förmelei ist

„Ungelistet" ist keine Zugangsbeschränkung, sondern nur fehlende Auffindbarkeit.
Wer die ID hat, kommt rein — ohne Login, ohne Mitgliedschaft. Eine ID im
öffentlichen Repo hebt den Schutz also vollständig auf, und das dauerhaft: ein
einmal gepushter Commit bleibt über die Historie, Forks, Klone, Code-Suchen und
externe Spiegel abrufbar, auch wenn die Datei später geändert wird. Ein Rückbau
ist deshalb nie vollständig — nur das Nicht-Hineinschreiben wirkt zuverlässig.

## Was 2026-08-28 passiert ist

`scripts/build-livestream-proposals.cjs` trug die redaktionelle Headline-Tabelle
`H` als Konstante im Quelltext, mit **66 videoIds als Schlüsseln — davon 40
ungelistet**. Sie standen seit dem Commit `5a7c40f` („Initial public release",
22.07.2026) öffentlich auf GitHub.

Eingeordnet: Es handelte sich ausschließlich um alte Sonntags-Archivstreams
(LIVESTREAM #1–#40, 12/2024 bis 12/2025). Keine aktuellen Mitglieder-Meetings,
kein sponsors-only gesperrtes Material — der HTTP-Gate-Check war bei allen 40
negativ. Das Material ist über die öffentliche Archiv-Playlist ohnehin
erreichbar. Deshalb wurde bewusst **auf ein Umschreiben der Historie verzichtet**:
Das hätte die bekannten Klone nicht erreicht, alle Commit-SHAs gebrochen und den
lokalen Klon entwertet — bei einem Schaden, der das nicht rechtfertigt.

Stattdessen: Die Tabelle liegt jetzt in `data/livestream-headlines.json` und wird
zur Laufzeit gelesen, genau wie `data/livestream-catalog.json` es schon immer
wurde. Die IDs standen vorher doppelt da — einmal aus der Datei gelesen, einmal
im Code.

## Wenn du das Skript anfasst

Die Auslagerung ist verlustfrei: Der erzeugte `data/proposals.livestream.json` ist
vor und nach dem Umbau **byte-identisch** (SHA-256 geprüft). Falls du die Tabelle
je neu aufbauen musst, lässt sie sich vollständig aus diesem Output
rekonstruieren — `headline`, `stance`, `confidence.headline` und
`reasoning.headline` (→ `fl`) enthalten jedes Feld.

Was du **nicht** tun solltest: die Tabelle „der Einfachheit halber" wieder in den
Quelltext zurückholen. Genau so ist sie ursprünglich dorthin geraten.

## Der zweite Fund, am selben Tag (2026-08-28)

Es ist nicht bei dem einen Mal geblieben. Beim Freigabe-Check vor einem
unbeteiligten Commit — Thema war ein neues Thumbnail-Preset — fielen im
Arbeitsbaum zwei weitere Stellen auf, beide noch **ungetrackt** und damit knapp
vor dem ersten Push:

- `src/publish/unlist-old-member-recordings.js` führte **42 videoIds samt Titeln**
  („TPC Meeting", „TruthPill Meeting", „Deep Dive", „Alignment-Call") als
  Konstante `TARGETS`. Der Zweck des Skripts ist es, genau diese Videos auf
  `unlisted` zu setzen — sie sind es inzwischen alle. Jede dieser IDs ist damit
  ein Zugriffsschlüssel.
- `src/youtube/sync-livestream-archive.js` nannte zwei weitere ungelistete
  Mitglieder-Videos, eines in einer Konstante, eines in Kommentaren — obwohl die
  kuratierte Liste dazu längst korrekt unter `fixtures/members-only-exclude.txt`
  lag und gitignored war. Die IDs waren aus der Datei in den Quelltext gewandert.

Behoben nach demselben Muster wie beim ersten Mal: Die 42 liegen jetzt in
`fixtures/old-member-recordings.txt` (gitignored, im Sicherungsumfang von
`scripts/backup-state.cjs`) und werden zur Laufzeit gelesen; fehlt die Datei,
bricht das Skript ab, statt mit leerer Liste „nichts zu tun" zu melden. Die
Katalog-Ausnahme im Sync-Skript kommt jetzt aus `members-only-exclude.txt`.
Beide Skripte verhalten sich nachweislich unverändert: `--verify-unlisted` meldet
weiter 42/42, der Plausibilitäts-Check weiter 65/66 ohne unerwartete Abweichung.

**Was daraus folgt:** Der Fund war kein Einzelfall, und er wurde nicht durch
Aufmerksamkeit beim Schreiben verhindert, sondern durch einen Check unmittelbar
vor dem Commit. Beides gilt weiter:

1. **Vor jedem Commit prüfen** — nicht darauf vertrauen, dass beim Schreiben
   schon niemand eine ID einsetzt. Beide Fundstellen entstanden in gutem Glauben,
   die eine sogar mit dem ausdrücklichen Kommentar, die feste Liste sei ein
   Sicherheitsmerkmal. Das war sie auch — nur am falschen Ort.
2. **Gezielt stagen, nie `git add -A`.** Beide Male hätte ein pauschales Stagen
   die Dateien mitgenommen.

Ein brauchbarer Check: alle Kandidaten-Token aus den zu committenden Dateien
ziehen und gegen `data/inventory.json` prüfen — was dort mit einem anderen
`privacyStatus` als `public` steht, darf nicht in den Commit. Das findet nichts,
was das Inventar nicht kennt; es findet aber zuverlässig genau den Fehler, der
jetzt zweimal passiert ist.
