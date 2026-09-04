'use strict';

// ---------------------------------------------------------------------------
// DER LONGFORM-ARBEITER, LESENDE HAELFTE (EK)
// ---------------------------------------------------------------------------
//
// Er bestimmt aus EINEM Aufnahmenamen alles, was ein Mensch sehen muss, bevor
// er das erste Mal ja sagt -- und zeigt es. Mehr tut er heute nicht.
//
// Eingabe:  --aufnahme=<JJJJ-MM-TT HH-MM-SS>, dazu die Einstellungen
//           LONGFORM_RENDER_WURZEL (3.2) und THUMBNAIL_EXPORT_DIR (3.3).
// Ausgabe:  EIN Befund und daraus eine Vorschau auf stdout, woertlich
//           (Vertrag 4, Schritt 6).
//
// Vertragsstellen, die dieses Modul traegt: 2.7 (ueber den Beipackzettel-Leser),
// 2.8, 2.9, 2.11, 3.2, 3.3, 4 (Schritte 2, 3, 5, 6), 6, 7.
//
// WAS DIESES MODUL NICHT TUT, UND ZWAR MIT ABSICHT:
//
//   - Es SCHREIBT nichts. Nicht in den Export-Ordner (Vertrag 7), nicht in den
//     Render-Ordner (7), nicht nach data/, nirgends.
//     tests/longform-arbeiter.test.cjs stellt die schreibenden fs-Funktionen
//     scharf und laesst den vollen Durchlauf dagegen laufen.
//   - Es geht NICHT ins Netz. Keine Bibliothek fuer den Kanal wird geladen,
//     kein Aufruf gemacht, keine Kennung eines Videos kommt vor. Der Test
//     zaehlt die verbotenen Woerter im Quelltext nach und prueft zusaetzlich,
//     dass keine geliehene Kette die Netzbibliothek hereinzieht.
//   - Es kennt KEINE Ermaechtigung und KEIN Gedaechtnis. Beides gehoert zur
//     schreibenden Haelfte, und die ist nicht gebaut. Ein Modul, das die
//     Ermaechtigung schon pruefte, ohne dass etwas darauf folgt, waere eine
//     halbe Sicherung -- und eine halbe Sicherung sieht aus wie eine ganze.
//   - Es FUELLT KEINE OFFENE STELLE. Die vier offenen Punkte aus Abschnitt 11
//     bleiben vier. Insbesondere: die erste Zeile der Beschreibung ist der
//     Titel, und die Vorschau SAGT, dass das von der Kanalvorlage abweicht
//     (11.2). Sie erfindet keine Hook-Zeile und schlaegt auch keine vor.
//   - Es setzt keinen Rueckgabewert im Modul. Wo der Vertrag "Abbruch (1)"
//     sagt, traegt der Befund ein Feld `abbruch`; die Zahl setzt main().
//     Dieselbe Trennung wie im Beipackzettel-Leser.
//
// GELIEHEN STATT NACHGEBAUT (Vertrag 2.1: "Leihen heisst importieren, nicht
// kopieren"):
//
//   zettel-leser.js      befundeKandidaten   die GANZE Thumbnail-Bestimmung aus
//                                            2.7: Matrix, Rangfolge, Fenster,
//                                            Bildpruefung, Vorschauzeilen. Sie
//                                            wird hier nicht nachgebaut und
//                                            nicht nachgeprueft, sondern
//                                            benutzt.
//   uebergabe-leser.js   AUFNAHME_FORM       die Form des Aufnahmenamens
//                        EXIT                die EINE Rueckgabewerttabelle
//                        pruefeKeineFreien-  der zerfallene Aufnahmename
//                          Argumente
//                        pfadLiegtUnter      ein Pfad darf nicht aus dem
//                                            eingestellten Ordner hinauszeigen
//   uploader.js          ladeKonfiguration   Vorlage, Zuordnung, Kanalfelder
//                        zuordneHashtags     die Hashtag-Zuordnung OHNE die
//                                            Shorts-Liste (2.9)
//                        fuelleBeschreibung  {titel} und {hashtags} einsetzen
//                        pruefeGrenzen       Titel, Beschreibung, Platzhalter,
//                                            Hashtag-Zahl
//                        zaehleTitelZeichen  Codepunkte, die EINE Zaehlstelle
//                        sha256Datei         die sha256 einer Datei
//                        GESPERRTE_AUFNAHMEN die Sperren des Uploaders
//   planer.js            GESPERRTE_AUFNAHMEN die Sperren des Planers
//   cli-args.js          pruefeArgumenteStrikt
//
// Was NICHT geliehen wurde, samt Grund, steht im Bericht EK.
// ---------------------------------------------------------------------------

// Die Argumentpruefung ist die ERSTE Anweisung des Programms -- vor jedem
// Lesen, vor dotenv, vor jedem require, das eine Platte anfasst (Vertrag 3.1:
// "Die Argumentpruefung ist die erste Anweisung des Programms, vor jedem
// Lesen"). Dieselbe Bauart wie im Leser und im Planer.
const { pruefeArgumenteStrikt, EXIT_ARGUMENTFEHLER } = require('../publish/cli-args');

// Was dieser Aufruf heute kennt. --bestaetigt-durch= und --execute stehen hier
// ABSICHTLICH NICHT: sie gehoeren zur schreibenden Haelfte (Vertrag 3.1), und
// die ist nicht gebaut. Sie stillschweigend zu erlauben hiesse, sie wirkungslos
// entgegenzunehmen -- die Fehlerform, gegen die dieses Projekt seit ED F2
// baut. Sie bekommen darum unten ihre EIGENE Meldung: erkannt, benannt, nicht
// gebaut. Das ist etwas anderes als "unbekanntes Argument", und es soll auch
// anders aussehen.
const ERLAUBTE_ARGUMENTE = ['--aufnahme=', '--zettel='];
const NOCH_NICHT_GEBAUTE_ARGUMENTE = ['--bestaetigt-durch=', '--execute'];

if (require.main === module) {
  pruefeNochNichtGebauteArgumente(process.argv);
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/upload/longform-arbeiter.js');
}

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const {
  AUFNAHME_FORM, EXIT, pruefeKeineFreienArgumente, pfadLiegtUnter,
} = require('./uebergabe-leser');
const U = require('./uploader');
const P = require('./planer');
const Z = require('./zettel-leser');

const EXIT_OK = EXIT.OK;
const EXIT_BEFUND = EXIT.BEFUND;
const EXIT_AUFRUFFEHLER = EXIT.AUFRUF;
const EXIT_GESPERRT = EXIT.GESPERRT;

// ---------------------------------------------------------------------------
// DIE EINSTELLUNGEN UND DIE FORMEN (Vertrag 3.2, 3.3)
// ---------------------------------------------------------------------------

// Beides sind EINSTELLUNGEN, keine Argumente (Vertrag 3.1: "Der Arbeiter kennt
// KEIN Wurzelargument"). Es gibt keinen eingebauten Wert: die Gegenseite gibt
// auf ihre Wurzel ausdruecklich keine Zusage, und ein Laufwerkspfad im
// Quelltext waere ausserdem am Commit-Gate gescheitert.
const RENDER_WURZEL_SCHLUESSEL = 'LONGFORM_RENDER_WURZEL';
const EXPORT_ORDNER_SCHLUESSEL = 'THUMBNAIL_EXPORT_DIR';

// Der fertige Schnitt. Daneben liegen Dateien, die NIE genommen werden:
// .render-attempt-<hex>.<encoder>.partial.mp4 (abgebrochene Renderversuche),
// .upload.mp4 und .upload2.mp4 (Handarbeit von Anfang August). Es wird genau
// die EINE Datei genommen, die der Aufnahmename benennt -- kein Absuchen des
// Ordners nach Videos, nie "die neueste MP4" (Vertrag 7).
const VIDEO_ENDUNG = '.matrix-cut.mp4';

// Die uebrigen Dateien DERSELBEN ART, fuer den Groessenvergleich (3.2). Der
// Aufnahmeteil wird vollstaendig verlangt, damit `x.upload.matrix-cut.mp4`
// oder ein `.partial` nicht mitzaehlt.
const RENDER_NAME_FORM = /^(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})\.matrix-cut\.mp4$/;

// Die Warnschwelle des Groessenvergleichs: mehr als die HAELFTE des Mittels
// nach oben oder unten. Keine feste Groessengrenze (Vertrag 7) -- die Warnung
// bricht nichts ab, sie sagt es und der Mensch entscheidet.
const GROESSE_ABWEICHUNG_ANTEIL = 0.5;
const GROESSE_MINDESTENS_ANDERE = 2;

// Das Thumbnail (Vertrag 2.10): hoechstens 2 MiB. 2.095.928 B wurden
// angenommen, 2.121.384 B mit 400 abgewiesen -- gemessen am 29.08.
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

// Der Typ kommt aus der DATEIENDUNG, nicht aus einer Konstante (2.10). Die
// Vorschau nennt ihn, weil er zu dem gehoert, was beim Ja geschaehe.
const BILDTYP_JE_ENDUNG = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
});

// Die Tags (Vertrag 2.9). Grenze laut Dokumentation: "maximum length of 500
// characters", die Kommas zwischen den Tags zaehlen mit.
const TAGS_MAX_ZEICHEN = 500;

// DIE SECHS FESTEN HASHTAGS DER KANALVORLAGE.
//
// Sie stehen hier woertlich, weil der Vertrag sie woertlich nennt (2.9, gemessen
// in ED F3 gegen youtube-beschreibungen.md, Teil 2). Sie sind zeichengleich die
// ersten sechs Eintraege der Liste `immer` in config/shorts-hashtags.json --
// aber das ist eine gemessene Tatsache und keine Regel: wer die Konfiguration
// pflegt, aendert dort etwas und nicht die Kanalvorlage. Darum ist diese Liste
// eine eigene und kein Ausschnitt der anderen.
const FESTE_KANAL_HASHTAGS = Object.freeze([
  'krypto', 'bitcoin', 'xrp', 'polymarket', 'okkulteskrypto', 'finanzen',
]);

// ---------------------------------------------------------------------------
// DIE SPERRLISTE (Vertrag 2.11)
// ---------------------------------------------------------------------------
//
// Eigene Liste, dieselbe Bauart wie in Planer und Uploader: Aufnahme,
// Begruendung von mindestens zwanzig Zeichen, keine Doppelten, kein Argument,
// das sie umgeht. Und die Selbstpruefung verlangt, dass JEDE Sperre des
// Planers UND des Uploaders auch hier steht.
//
// Grund fuer die dritte Liste statt eines Imports: die Sperre sagt "aus dieser
// Aufnahme darf nichts veroeffentlicht werden". Ob das Langformvideo denselben
// Mangel traegt wie die Shorts, ist am Inhalt der Datei nicht zu sehen; und wer
// die Sperre aufheben will, aendert die Liste mit Begruendung, an jeder Stelle
// einzeln. Eine Sperre, die fuer die Ausschnitte gilt und fuer das Ganze nicht,
// waere eine halbe Sperre -- und ein blosser Import waere eine Liste, die
// jemand an einer Stelle leert und die dann ueberall leer ist.
const GESPERRTE_AUFNAHMEN = [
  {
    aufnahme: '2026-08-29 18-18-19',
    grund:
      'Diese Aufnahme stammt aus der Zeit VOR dem Korrekturlauf der Shorts-Linie. ' +
      'Planer und Uploader sperren sie bereits, weil ihre Shorts fehlerhaft ' +
      'geschnitten sind. Fuer das Langformvideo gilt sie ebenso: ob der Schnitt ' +
      'des Ganzen denselben Mangel traegt wie der der Ausschnitte, ist der Datei ' +
      'nicht anzusehen, und eine Sperre, die nur die Ausschnitte trifft, waere ' +
      'eine halbe. Wer sie aufheben will, nimmt sie an allen drei Stellen ' +
      'heraus, jede mit Begruendung.',
  },
];

function pruefeSperrliste() {
  const fehler = [];
  const gesehen = new Set();
  for (const s of GESPERRTE_AUFNAHMEN) {
    if (typeof s.aufnahme !== 'string' || !AUFNAHME_FORM.test(s.aufnahme)) {
      fehler.push('Sperreintrag ' + JSON.stringify(s.aufnahme) +
        ' hat nicht die Form JJJJ-MM-TT HH-MM-SS');
    }
    if (typeof s.grund !== 'string' || s.grund.trim().length < 20) {
      fehler.push('Sperreintrag ' + JSON.stringify(s.aufnahme) +
        ' hat keine brauchbare Begruendung');
    }
    if (gesehen.has(s.aufnahme)) {
      fehler.push('Sperreintrag ' + JSON.stringify(s.aufnahme) + ' steht doppelt');
    }
    gesehen.add(s.aufnahme);
  }
  for (const [wo, liste] of [['Der Planer', P.GESPERRTE_AUFNAHMEN],
    ['Der Shorts-Uploader', U.GESPERRTE_AUFNAHMEN]]) {
    for (const s of liste) {
      if (!gesehen.has(s.aufnahme)) {
        fehler.push(wo + ' sperrt ' + JSON.stringify(s.aufnahme) +
          ', der Longform-Arbeiter nicht. Die Sperre gehoert an alle Stellen; bis sie ' +
          'hier steht, tut dieser Arbeiter gar nichts.');
      }
    }
  }
  return fehler;
}

function sperreFuer(aufnahme) {
  return GESPERRTE_AUFNAHMEN.find((s) => s.aufnahme === aufnahme) || null;
}

// ---------------------------------------------------------------------------
// DIE VIDEODATEI (Vertrag 3.2)
// ---------------------------------------------------------------------------
//
// DER PFAD WIRD ZUSAMMENGEBAUT, und das ist ein Bruch mit der Regel des
// Shorts-Vertrags, in dem der Pfad woertlich in einer Datei steht, die der
// Erzeuger schreibt. Fuer Longform gibt es eine solche Datei heute nicht.
// Ersatzweise gilt (3.2): der Pfad wird in der Vorschau WOERTLICH angezeigt,
// mit Groesse, mtime und sha256, und der Mensch sieht ihn, bevor er ja sagt.
// Legt die Shorts-Linie spaeter die Beipackdatei zum Render, faellt das hier
// weg und die alte Regel gilt wieder (Vertrag 8, 9).

function videoDateiname(aufnahme) {
  return aufnahme + VIDEO_ENDUNG;
}

function befundeVideodatei(renderWurzel, aufnahme) {
  const dateiname = videoDateiname(aufnahme);
  const voll = path.join(renderWurzel, dateiname);
  const b = {
    dateiname,
    pfad: voll,
    zusammengebaut: true,
    stand: null, satz: null,
    bytes: null, mtime: null, sha256: null,
    vergleich: null,
  };

  // Der zusammengebaute Pfad darf nicht aus dem eingestellten Ordner
  // hinauszeigen. Er kann es heute nicht -- der Aufnahmename hat die Form
  // geprueft --, und die Sperre bleibt trotzdem stehen.
  if (!pfadLiegtUnter(renderWurzel, voll)) {
    b.stand = 'ausserhalb';
    b.satz = 'Die Videodatei ' + dateiname + ' laege nicht unter dem eingestellten ' +
      'Render-Ordner. Der Lauf fasst sie nicht an.';
    return b;
  }
  let st;
  try {
    st = fs.statSync(voll);
  } catch (e) {
    b.stand = 'fehlt';
    b.satz = 'Die Videodatei ' + dateiname + ' liegt nicht im Render-Ordner (' +
      (e.code || e.message) + '). Der Pfad ist aus ' + RENDER_WURZEL_SCHLUESSEL +
      ' und dem Aufnahmenamen zusammengebaut; er steht in der Vorschau woertlich.';
    return b;
  }
  if (!st.isFile()) {
    b.stand = 'kein_file';
    b.satz = 'Die Videodatei ' + dateiname + ' ist keine regulaere Datei.';
    return b;
  }
  b.bytes = st.size;
  b.mtime_ms = st.mtimeMs;
  b.mtime = Z.zeitVonInstant(st.mtimeMs);
  b.sha256 = U.sha256Datei(voll);
  b.stand = 'da';
  b.satz = 'Die Videodatei ' + dateiname + ' liegt da: ' + st.size + ' Bytes, zuletzt ' +
    'geaendert ' + b.mtime + '.';
  b.vergleich = vergleicheGroesse(renderWurzel, dateiname, st.size);
  return b;
}

// KEINE FESTE GROESSENGRENZE, SONDERN EINE WARNUNG (Vertrag 3.2).
//
// Ob der 16-MB-Render vom 20.08. ein Probelauf war, weiss niemand; eine
// erfundene Grenze waere eine stillschweigend gefuellte Luecke. Das Lesen der
// uebrigen Groessen ist KEIN Absuchen nach Videos (7): es waehlt keine Datei,
// es vergleicht eine.
function vergleicheGroesse(renderWurzel, eigenerName, eigeneBytes) {
  let namen;
  try {
    namen = fs.readdirSync(renderWurzel, { withFileTypes: true })
      .filter((d) => d.isFile()).map((d) => d.name);
  } catch (e) {
    return {
      andere: 0, mittel: null,
      satz: 'Der Render-Ordner liess sich fuer den Groessenvergleich nicht lesen (' +
        (e.code || e.message) + '). Es gibt darum kein Mittel, gegen das sich diese ' +
        'Datei halten liesse.',
    };
  }
  const andere = [];
  for (const n of namen) {
    if (n === eigenerName) continue;
    if (!RENDER_NAME_FORM.test(n)) continue;
    try {
      const st = fs.statSync(path.join(renderWurzel, n));
      if (st.isFile()) andere.push({ name: n, bytes: st.size });
    } catch (e) { /* zwischen readdir und stat verschwunden -- zaehlt nicht mit */ }
  }
  if (andere.length < GROESSE_MINDESTENS_ANDERE) {
    return {
      andere: andere.length, mittel: null,
      satz: 'Groessenvergleich: es liegen nur ' + andere.length + ' andere Datei(en) der Form ' +
        '<aufnahme>' + VIDEO_ENDUNG + ' im Render-Ordner. Unter ' + GROESSE_MINDESTENS_ANDERE +
        ' gibt es kein Mittel; diese Datei laesst sich gegen nichts halten. Das steht ' +
        'hier, statt zu schweigen.',
    };
  }
  const summe = andere.reduce((a, x) => a + x.bytes, 0);
  const mittel = summe / andere.length;
  const abstand = Math.abs(eigeneBytes - mittel);
  const auffaellig = abstand > mittel * GROESSE_ABWEICHUNG_ANTEIL;
  return {
    andere: andere.length,
    mittel: Math.round(mittel),
    auffaellig,
    satz: auffaellig
      ? 'ACHTUNG, Groessenvergleich: diese Datei hat ' + eigeneBytes + ' Bytes, das Mittel ' +
        'der ' + andere.length + ' uebrigen Renders ist ' + Math.round(mittel) + ' Bytes. Das ' +
        'ist mehr als die Haelfte davon Abstand. Die Warnung bricht nichts ab -- sie sagt ' +
        'beide Zahlen, und der Mensch entscheidet.'
      : 'Groessenvergleich: ' + eigeneBytes + ' Bytes gegen ein Mittel von ' +
        Math.round(mittel) + ' Bytes aus ' + andere.length + ' uebrigen Renders. Unauffaellig.',
  };
}

// ---------------------------------------------------------------------------
// TITEL, BESCHREIBUNG, HASHTAGS UND TAGS (Vertrag 2.8, 2.9)
// ---------------------------------------------------------------------------

// DIE SCHRITTFOLGE IST TEIL DER ZUSAGE, WEIL SIE DAS ERGEBNIS AENDERT (2.9):
//
//   1. die Hashtag-Woerter ableiten, genau wie fuer die Hashtag-Zeile:
//      Gruppen in Dateireihenfolge, dann `immer`, Doppelte ohne Ruecksicht auf
//      Gross-/Kleinschreibung entfernt, die zuerst genannte Schreibung
//      gewinnt -- und NIE die Shorts-Liste;
//   2. DANACH die sechs festen Woerter der Kanalvorlage entfernen;
//   3. die Raute weglassen.
//
// WER DIE SCHRITTE VERTAUSCHT, BEKOMMT `Krypto` ALS TAG. Die Liste `immer`
// traegt `krypto` (klein, vorn) und `Krypto` (gross, weiter hinten). Schritt 1
// wirft `Krypto` als Dublette weg, bevor Schritt 2 `krypto` entfernt -- uebrig
// bleibt keins von beiden. Vertauscht man: Schritt 2 entfernt zeichengleich nur
// `krypto`, `Krypto` ueberlebt, und Schritt 1 findet danach keine Dublette mehr.
// tests/longform-arbeiter.test.cjs fuehrt beide Reihenfolgen vor.
//
// SCHRITT 2 ENTFERNT ZEICHENGLEICH, nicht ohne Ruecksicht auf Gross- und
// Kleinschreibung. Das ist keine Nachlaessigkeit, sondern genau die Stelle, an
// der die zugesagte Reihenfolge ueberhaupt einen Unterschied macht: entfernte
// Schritt 2 auch Schreibvarianten, waeren beide Reihenfolgen gleich, und die
// Zusage haette keinen Gegenstand. Der Preis steht unten und wird GESAGT, nicht
// verschwiegen: wer in `immer` die Schreibung `Krypto` nach vorn zieht, bekommt
// sie als Tag. Dafuer gibt es den Hinweis aus `hinweiseZuTags`.
function leiteTagsAb(titel, hashtagKonfig) {
  // Schritt 1: dieselbe Zuordnung wie fuer die Hashtag-Zeile -- und
  // ausdruecklich die Fassung OHNE die Shorts-Liste. Kein Tag "Shorts"
  // (Vertrag 7).
  const z = U.zuordneHashtags(titel, hashtagKonfig);
  const schritt1 = z.hashtags.slice();
  // Schritt 2: die sechs festen der Kanalvorlage heraus.
  const entfernt = [];
  const schritt2 = schritt1.filter((h) => {
    if (FESTE_KANAL_HASHTAGS.includes(h)) { entfernt.push(h); return false; }
    return true;
  });
  // Schritt 3: die Raute weglassen. Sie steht in der Konfiguration ohnehin
  // nicht (der Uploader lehnt ein fuehrendes # dort ab); der Schritt steht
  // trotzdem hier, damit die drei Schritte des Vertrags im Quelltext
  // wiederzufinden sind.
  const tags = schritt2.map((h) => h.replace(/^#/, ''));
  return {
    tags,
    herleitung: z.herleitung.filter((h) => tags.includes(h.hashtag)),
    schritt1,
    entfernt,
    zeichen: tags.join(',').length,
  };
}

// Die umgekehrte Reihenfolge -- NUR fuer den Nachweis. Sie wird von nichts
// aufgerufen ausser dem Test; sie steht hier, damit der Unterschied an EINER
// Stelle steht und nicht im Test nachgebaut wird. Ein im Test nachgebauter
// Gegenspieler prueft den Nachbau, nicht den Bau.
function leiteTagsAbVertauscht(titel, hashtagKonfig) {
  const tw = U.woerter(titel);
  const roh = [];
  for (const g of hashtagKonfig.gruppen) {
    const treffer = g.stichwoerter.find((s) => U.stichwortTrifft(tw, s));
    if (treffer === undefined) continue;
    for (const h of g.hashtags) roh.push(h);
  }
  for (const h of hashtagKonfig.immer) roh.push(h);
  // ZUERST die sechs festen (Schritt 2), DANN die Dubletten (Schritt 1).
  const ohneFeste = roh.filter((h) => !FESTE_KANAL_HASHTAGS.includes(h));
  const gesehen = new Set();
  const tags = [];
  for (const h of ohneFeste) {
    const k = h.toLocaleLowerCase('de');
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    tags.push(h);
  }
  return { tags };
}

// Der Preis der zeichengleichen Entfernung, laut gesagt.
//
// Bleibt nach Schritt 2 ein Tag AUS DER LISTE `immer` stehen, der bis auf die
// Gross-/Kleinschreibung einem der sechs festen gleicht, dann hat jemand die
// Reihenfolge in `immer` gedreht -- so wie es vor DPa einmal war, als 'Krypto'
// vor 'krypto' stand und unter dem Short '#Krypto' erschien. Das ist kein
// Fehler dieses Moduls und wird darum nicht stillschweigend geheilt, sondern
// genannt.
//
// GRUPPENTREFFER SIND AUSGENOMMEN, und das ist keine Nachlaessigkeit: der
// Vertrag zaehlt sie ausdruecklich zu den erwarteten Tags auf ("dazu die
// Gruppentreffer am Titel: Bitcoin, BTC, XRP, Ripple, Hyperliquid, HYPE,
// Wyckoff", 2.9). Ein Hinweis, der vor genau dem warnt, was zugesagt ist,
// stuende bei jedem Lauf da und waere nach drei Laeufen unsichtbar.
function hinweiseZuTags(tags, herleitung) {
  const ausImmer = new Set((herleitung || [])
    .filter((h) => h.quelle === 'immer').map((h) => h.hashtag));
  const hinweise = [];
  for (const t of tags) {
    if (!ausImmer.has(t)) continue;
    const fest = FESTE_KANAL_HASHTAGS.find(
      (f) => f.toLocaleLowerCase('de') === t.toLocaleLowerCase('de'));
    if (fest !== undefined) {
      hinweise.push('Der Tag ' + JSON.stringify(t) + ' kommt aus der Liste "immer" und ' +
        'gleicht bis auf die Gross- und Kleinschreibung dem festen Kanal-Hashtag ' +
        JSON.stringify(fest) + '. Er bleibt stehen, weil Schritt 2 zeichengleich entfernt ' +
        '(Vertrag 2.9). Das ist der Fall aus DPa. Wer ihn nicht will, aendert die ZUERST ' +
        'genannte Schreibweise in ' + U.HASHTAGS_DATEI + ' -- eine spaetere zu aendern ' +
        'bewirkt nichts.');
    }
  }
  return hinweise;
}

// Alles, was fuer dieses eine Video an den Kanal ginge -- aus Zettel und
// Konfiguration. Der Shorts-Weg hat dafuer baueMetadaten(); der hier ist ein
// anderer, weil er die Shorts-Liste nicht nimmt und Tags dazu bildet.
function baueLongformMetadaten(titel, konfig) {
  const z = U.zuordneHashtags(titel, konfig.hashtags);   // OHNE die Shorts-Liste
  const beschreibung = U.fuelleBeschreibung(konfig.beschreibung.vorlage, titel, z.hashtags);
  const t = leiteTagsAb(titel, konfig.hashtags);
  const verstoesse = U.pruefeGrenzen({ kennung: 'Longform', titel, beschreibung });
  if (t.zeichen > TAGS_MAX_ZEICHEN) {
    verstoesse.push('Longform: die Tags sind zusammen ' + t.zeichen + ' Zeichen lang ' +
      '(die Kommas dazwischen zaehlen mit), erlaubt sind hoechstens ' + TAGS_MAX_ZEICHEN + '.');
  }
  return {
    titel,
    titelZeichen: U.zaehleTitelZeichen(titel),
    beschreibung,
    hashtags: z.hashtags,
    herleitung: z.herleitung,
    tags: t.tags,
    tagHerleitung: t.herleitung,
    tagsEntfernt: t.entfernt,
    tagsZeichen: t.zeichen,
    tagHinweise: hinweiseZuTags(t.tags, t.herleitung),
    verstoesse,
    veroeffentlichung: konfig.veroeffentlichung,
  };
}

// ---------------------------------------------------------------------------
// DER TROCKENLAUF
// ---------------------------------------------------------------------------
//
// Die Reihenfolge ist die aus Vertrag 4, und sie ist keine Geschmacksfrage:
// alles, was zu einem Abbruch fuehren kann, laeuft VOR dem ersten schreibenden
// Aufruf. Heute laeuft ohnehin nur diese Haelfte -- die Reihenfolge steht
// trotzdem so, damit die zweite Haelfte sie nicht neu erfinden muss.
//
//   Schritt 2  Sperrliste (2.11), Konfiguration (3.4), Vorlagen-Marker
//   Schritt 3  Videodatei finden, pruefen, sha256, Groessenvergleich (3.2)
//   Schritt 4  Gedaechtnis lesen (5)  -- NICHT GEBAUT, wird gesagt
//   Schritt 5  Zettel einordnen (2.7), Titel (2.8), Metadaten (2.9), Bild
//   Schritt 6  Vorschau, Ende mit 0
//
// EIN MANGEL BEENDET DEN LAUF NICHT SOFORT. Gesammelt wird, was sich noch
// sammeln laesst; der ERSTE Abbruchgrund bestimmt Code und Vertragsstelle, die
// weiteren stehen daneben. Grund: ein Mensch, der zwei Dinge zu tun hat, soll
// sie in einem Lauf sehen und nicht in zweien. Was voneinander abhaengt, haengt
// weiter voneinander ab -- ohne Zettel kein Titel, ohne Titel keine
// Beschreibung; dann steht dort, dass es nicht gerechnet werden konnte, und
// nicht ein erfundener Wert.
const ERLAUBTE_ANGABEN = Object.freeze([
  'aufnahme', 'zettel', 'projektwurzel', 'renderWurzel', 'exportOrdner',
]);

function trockenlauf(angaben) {
  if (angaben === null || typeof angaben !== 'object' || Array.isArray(angaben)) {
    throw new TypeError('trockenlauf braucht ein Objekt mit ' +
      ERLAUBTE_ANGABEN.join(', ') + '.');
  }
  // Jede unbekannte Angabe wird abgewiesen, nicht verschluckt -- dieselbe
  // Sperre wie im Beipackzettel-Leser. Wer hier eine Ermaechtigung, ein
  // --execute oder einen Render-Zeitstempel mitgibt, bekommt einen Fehler und
  // kein stillschweigend ignoriertes Feld, das jemand fuer wirksam haelt.
  for (const schluessel of Object.keys(angaben)) {
    if (!ERLAUBTE_ANGABEN.includes(schluessel)) {
      throw new TypeError('trockenlauf kennt die Angabe ' + JSON.stringify(schluessel) +
        ' nicht. Erlaubt sind ' + ERLAUBTE_ANGABEN.join(', ') + '. Insbesondere gibt es ' +
        'hier KEINE Ermaechtigung und KEIN --execute: dieses Modul ist die lesende ' +
        'Haelfte, und es macht keinen schreibenden Aufruf, auch nicht auf Zuruf.');
    }
  }
  const { aufnahme, zettel = null, projektwurzel, renderWurzel, exportOrdner } = angaben;

  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new TypeError('aufnahme ist ' + JSON.stringify(aufnahme) +
      ' und nicht die Form JJJJ-MM-TT HH-MM-SS.');
  }
  for (const [name, wert] of [['projektwurzel', projektwurzel],
    ['renderWurzel', renderWurzel], ['exportOrdner', exportOrdner]]) {
    if (typeof wert !== 'string' || wert.trim() === '') {
      throw new TypeError(name + ' fehlt. main() loest die beiden Ordner aus ' +
        RENDER_WURZEL_SCHLUESSEL + ' und ' + EXPORT_ORDNER_SCHLUESSEL + ' auf; dieses ' +
        'Modul liest keine Einstellung.');
    }
  }
  if (zettel !== null && (typeof zettel !== 'string' || path.basename(zettel) !== zettel ||
      zettel.trim() === '')) {
    throw new TypeError('zettel ist ' + JSON.stringify(zettel) +
      ' und kein blosser Dateiname. Ein Pfad wird nicht genommen (Vertrag 3.1).');
  }

  const befund = {
    aufnahme,
    zettel_argument: zettel,
    render_wurzel: renderWurzel,
    export_ordner: exportOrdner,
    gesperrt: null,
    konfiguration: null,
    video: null,
    gedaechtnis: null,
    thumbnail: null,     // der Befund des Beipackzettel-Lesers, unveraendert
    metadaten: null,
    luecken: [],
    abbruch: null,
    saetze: [],
  };

  // ---- Schritt 2a: die Sperrliste ----------------------------------------
  // Vor jedem Zugriff auf die Platte, der ueber das Lesen der Argumente
  // hinausgeht (2.11). Sie ist der einzige Ausgang mit 3, und sie kehrt sofort
  // um: hinter einer Sperre wird nichts mehr gerechnet und nichts gezeigt.
  const selbstpruefung = pruefeSperrliste();
  if (selbstpruefung.length) {
    befund.abbruch = {
      code: 'sperrliste_unvollstaendig', nach: '2.11', wert: EXIT_GESPERRT,
      satz: selbstpruefung.join(' '),
    };
    befund.saetze = vorschau(befund);
    return befund;
  }
  const sperre = sperreFuer(aufnahme);
  if (sperre) {
    befund.gesperrt = sperre;
    befund.abbruch = {
      code: 'aufnahme_gesperrt', nach: '2.11', wert: EXIT_GESPERRT,
      satz: 'Die Aufnahme ' + aufnahme + ' ist gesperrt. ' + sperre.grund +
        ' Es gibt kein Argument, das die Sperre umgeht.',
    };
    befund.saetze = vorschau(befund);
    return befund;
  }

  // ---- Schritt 2b: die Konfiguration --------------------------------------
  // Dieselben drei Dateien wie beim Shorts-Uploader, mit denselben Regeln:
  // Vorlagen-Marker, unbekannte geschweifte Platzhalter, Kanalfelder. Die
  // eckigen Platzhalter werden erst an der FERTIGEN Beschreibung geprueft.
  const konfig = U.ladeKonfiguration(projektwurzel);
  if (konfig.fehler.length) {
    befund.konfiguration = { lesbar: false, fehler: konfig.fehler };
    setzeAbbruch(befund, 'konfiguration_fehlerhaft', '2.9', konfig.fehler.join(' '));
  } else {
    befund.konfiguration = {
      lesbar: true,
      vorlage_datei: U.BESCHREIBUNG_DATEI,
      hashtags_datei: U.HASHTAGS_DATEI,
      veroeffentlichung_datei: U.VEROEFFENTLICHUNG_DATEI,
      vorlage_bytes: Buffer.byteLength(konfig.beschreibung.vorlage, 'utf8'),
      platzhalter: konfig.beschreibung.platzhalter,
      veroeffentlichung: konfig.veroeffentlichung,
      nur_shorts: konfig.hashtags.nur_shorts,
    };
  }

  // ---- Schritt 3: die Videodatei ------------------------------------------
  befund.video = befundeVideodatei(renderWurzel, aufnahme);
  if (befund.video.stand !== 'da') {
    setzeAbbruch(befund, 'videodatei_' + befund.video.stand, '3.2', befund.video.satz);
  }

  // ---- Schritt 4: das Gedaechtnis -----------------------------------------
  // NICHT GEBAUT. Es steht als LUECKE in der Vorschau und nicht als leeres
  // Ergebnis: "kein Gedaechtnis gefunden" und "es wird keines gelesen" sind
  // zwei Zustaende, und sie duerfen nicht gleich aussehen. Solange die
  // schreibende Haelfte fehlt, kann es ohnehin keinen zweiten Lauf geben.
  befund.gedaechtnis = { gelesen: false, grund: 'nicht gebaut' };
  befund.luecken.push('Das Gedaechtnis (Vertrag 5) wird von diesem Lauf NICHT gelesen und ' +
    'nicht geschrieben. Es ist nicht gebaut. Ein zweiter Lauf wuerde darum nicht dort ' +
    'weitermachen, wo ein erster aufgehoert hat -- es gibt heute keinen ersten, weil ' +
    'nichts hochgeladen wird.');

  // ---- Schritt 5a: das Thumbnail (2.7), geliehen --------------------------
  // Der Beipackzettel-Leser macht das ganz. Er wird hier BENUTZT und nicht
  // nachgeprueft: eine zweite Stelle, die die Matrix auslegt, waere die zweite
  // Wahrheit, gegen die dieser Vertrag durchgehend gebaut ist.
  try {
    befund.thumbnail = Z.befundeKandidaten({ aufnahme, exportOrdner, zettel });
  } catch (e) {
    befund.thumbnail = null;
    setzeAbbruch(befund, 'export_ordner_unlesbar', '3.3',
      'Der Export-Ordner liess sich nicht lesen: ' + e.message + ' Er kommt aus ' +
      EXPORT_ORDNER_SCHLUESSEL + '.');
  }
  if (befund.thumbnail && befund.thumbnail.abbruch) {
    setzeAbbruch(befund, befund.thumbnail.abbruch.code, befund.thumbnail.abbruch.nach,
      befund.thumbnail.abbruch.satz);
  }

  // ---- Schritt 5b: das Bild unter 2 MiB (2.10) ----------------------------
  // Der Beipackzettel-Leser prueft Existenz, Groesse gegen den Zettel und
  // sha256. Die Grenze von 2 MiB prueft er NICHT -- sie ist eine Grenze des
  // schreibenden Aufrufs (2.10) und nicht der Zuordnung. Sie steht darum hier,
  // und sie steht VOR dem ersten schreibenden Aufruf: ein Video hochzuladen und
  // dann am Bild zu scheitern waere ein Upload, den niemand wollte.
  const gewaehlt = gewaehlterZettel(befund.thumbnail);
  if (gewaehlt && gewaehlt.bildbefund && typeof gewaehlt.bildbefund.gemessen_bytes === 'number' &&
      gewaehlt.bildbefund.gemessen_bytes > THUMBNAIL_MAX_BYTES) {
    setzeAbbruch(befund, 'bild_zu_gross', '2.10',
      'Das Bild ' + gewaehlt.bild.dateiname + ' hat ' + gewaehlt.bildbefund.gemessen_bytes +
      ' Bytes. Der zweite schreibende Aufruf nimmt hoechstens ' + THUMBNAIL_MAX_BYTES +
      ' Bytes (2 MiB); gemessen am 29.08. wurden 2.095.928 B angenommen und 2.121.384 B ' +
      'abgewiesen. Neu exportieren.');
  }

  // ---- Schritt 5c: Titel, Beschreibung, Hashtags, Tags (2.8, 2.9) ---------
  const titel = gewaehlt ? gewaehlt.videotitel : null;
  if (titel !== null && befund.konfiguration && befund.konfiguration.lesbar) {
    befund.metadaten = baueLongformMetadaten(titel, konfig);
    befund.metadaten.bildtyp = gewaehlt
      ? (BILDTYP_JE_ENDUNG[path.extname(gewaehlt.bild.dateiname).toLowerCase()] || null)
      : null;
    if (befund.metadaten.bildtyp === null && gewaehlt) {
      befund.luecken.push('Die Endung von ' + gewaehlt.bild.dateiname + ' gehoert zu keinem ' +
        'bekannten Bildtyp. Der Typ des zweiten schreibenden Aufrufs kommt aus der Endung ' +
        '(Vertrag 2.10) und laesst sich hier nicht bestimmen.');
    }
    if (befund.metadaten.verstoesse.length) {
      setzeAbbruch(befund, 'metadaten_verstoss', '2.9',
        befund.metadaten.verstoesse.join(' '));
    }
  } else if (titel === null && befund.thumbnail && !befund.thumbnail.abbruch) {
    // Kann heute nicht vorkommen -- der Beipackzettel-Leser bricht bei einem
    // Zettel ohne videotitel selbst ab. Die Sperre bleibt trotzdem stehen:
    // sie kostet nichts und faengt den Tag, an dem sich das aendert.
    setzeAbbruch(befund, 'kein_videotitel', '2.8',
      'Es gibt keinen Titel. Er kommt aus dem Beipackzettel und nur von dort; es gibt kein ' +
      'Ersatzfeld und kein Argument.');
  }

  befund.saetze = vorschau(befund);
  return befund;
}

// Der EINE Zettel, aus dem Titel und Bild kaemen: der genommene (Rang 1) oder
// der eine Vorschlag (Rang 2). Bei mehreren Kandidaten und bei Rang 3 gibt es
// ihn nicht -- dann hat der Beipackzettel-Leser schon abgebrochen.
function gewaehlterZettel(thumbnail) {
  if (!thumbnail) return null;
  return thumbnail.regel || thumbnail.vorschlag || null;
}

// Der ERSTE Abbruchgrund bestimmt Code und Vertragsstelle; die weiteren werden
// gesammelt und stehen in der Vorschau. Kein Grund geht verloren.
function setzeAbbruch(befund, code, nach, satz) {
  if (befund.abbruch === null) {
    befund.abbruch = { code, nach, wert: EXIT_BEFUND, satz, weitere: [] };
  } else {
    befund.abbruch.weitere = befund.abbruch.weitere || [];
    befund.abbruch.weitere.push({ code, nach, satz });
  }
}

// ---------------------------------------------------------------------------
// DIE VORSCHAU (Vertrag 4, Schritt 6)
// ---------------------------------------------------------------------------
//
// SIE SOLL URTEILSFAEHIG MACHEN, NICHT BERUHIGEN. Danach ist sie gebaut:
//
//   - Der erste Satz sagt IMMER, ob ein Video auf dem Kanal liegt (Vertrag 6:
//     der erste Satz hat genau drei Formen). Hier ist es immer dieselbe, und
//     sie steht trotzdem da -- eine Auskunft, die nur im Zweifelsfall kommt,
//     liest niemand im Zweifelsfall.
//   - Dann steht, WAS BEIM JA GESCHAEHE, in ganzen Saetzen und mit den Werten,
//     die hochgingen. Wer nicht weiterliest, hat trotzdem das Wichtigste.
//   - Danach jeder Teil einzeln, mit seiner Vertragsstelle, damit ein Zweifel
//     nachschlagbar ist.
//   - Am Schluss, in eigener Ueberschrift: WAS DIESER LAUF NICHT KANN. Die
//     Luecken und die offenen Punkte stehen dort ausdruecklich, weil eine
//     Vorschau, die nur zeigt, was sie kann, wie Vollstaendigkeit aussieht.
//
// Der Wortlaut ist nicht zugesagt; die Unterscheidungen sind es.
function vorschau(befund) {
  const z = [];
  const trenn = '='.repeat(78);

  z.push(trenn);
  z.push('LONGFORM-TROCKENLAUF -- Aufnahme ' + befund.aufnahme);
  z.push(trenn);
  // Vertrag 6: vor dem ersten schreibenden Aufruf sagt der erste Satz "kein
  // Video dieses Laufs auf dem Kanal". Dieser Lauf kommt nie darueber hinaus.
  z.push('Kein Video dieses Laufs auf dem Kanal.');
  z.push('Dieser Lauf hat gelesen und gerechnet. Er hat nichts geschrieben, nichts');
  z.push('hochgeladen und nichts veroeffentlicht.');
  z.push('');

  // ---- Was beim Ja geschaehe ----------------------------------------------
  z.push('WAS BEIM JA GESCHAEHE');
  z.push('');
  if (befund.abbruch) {
    z.push('  NICHTS. Dieser Lauf endet mit einem Befund; ein Knopf zum Ja gibt es nicht.');
    z.push('  Der Grund steht unten unter ABBRUCH.');
  } else if (befund.metadaten && befund.video) {
    const m = befund.metadaten;
    z.push('  Die Datei ' + befund.video.dateiname + ' (' + befund.video.bytes + ' Bytes)');
    z.push('  ginge privat auf den Kanal, mit diesem Titel:');
    z.push('');
    z.push('      ' + m.titel);
    z.push('');
    z.push('  Danach bekaeme sie das Bild ' + gewaehlterZettel(befund.thumbnail).bild.dateiname);
    z.push('  angeheftet. Oeffentlich wuerde sie erst durch ein ZWEITES Ja, nach der');
    z.push('  Verarbeitung (Vertrag 2.4, 2.5). Kein Termin, keine Vorausveroeffentlichung.');
  } else {
    z.push('  Es liess sich nicht bestimmen. Die Teile unten sagen, woran es liegt.');
  }
  z.push('');

  if (befund.gesperrt) {
    z.push(trenn);
    z.push('GESPERRT (Vertrag 2.11)');
    z.push('');
    umbrucheIn(z, '  ', befund.gesperrt.grund);
    z.push('');
  }

  // ---- 1. Die Videodatei ---------------------------------------------------
  z.push(trenn);
  z.push('1  DIE VIDEODATEI (Vertrag 3.2)');
  z.push('');
  if (befund.video) {
    const v = befund.video;
    z.push('  Pfad (zusammengebaut aus ' + RENDER_WURZEL_SCHLUESSEL + ' und dem Aufnahmenamen,');
    z.push('  darum hier woertlich und nicht nur angedeutet):');
    z.push('      ' + v.pfad);
    if (v.stand === 'da') {
      z.push('  Groesse:   ' + v.bytes + ' Bytes');
      z.push('  Geaendert: ' + v.mtime);
      z.push('  sha256:    ' + v.sha256);
      z.push('');
      umbrucheIn(z, '  ', v.vergleich.satz);
      z.push('');
      z.push('  Es wird genau diese eine Datei genommen. Kein .partial, kein .upload, keine');
      z.push('  Rohaufnahme, nie "die neueste MP4" (Vertrag 7).');
    } else {
      umbrucheIn(z, '  ', v.satz);
    }
  } else {
    z.push('  (nicht bestimmt)');
  }
  z.push('');

  // ---- 2. Das Thumbnail ----------------------------------------------------
  z.push(trenn);
  z.push('2  DAS THUMBNAIL (Vertrag 2.7) -- Befund des Beipackzettel-Lesers, woertlich');
  z.push('');
  if (befund.thumbnail) {
    for (const zeile of befund.thumbnail.saetze) z.push(zeile === '' ? '' : '  ' + zeile);
    const g = gewaehlterZettel(befund.thumbnail);
    if (g && g.bildbefund && typeof g.bildbefund.gemessen_bytes === 'number') {
      z.push('');
      z.push('  Groesse des Bildes: ' + g.bildbefund.gemessen_bytes + ' Bytes von hoechstens ' +
        THUMBNAIL_MAX_BYTES + ' (2 MiB, Vertrag 2.10).');
    }
    if (befund.thumbnail.rang === 2) {
      z.push('');
      z.push('  DAS IST EIN VORSCHLAG UND KEINE REGEL. Er wird nie ohne Rueckfrage genommen,');
      z.push('  auch nicht beim elften Mal. Das Ja traegt Dateiname und sha256 des Bildes,');
      z.push('  das hier steht -- ein Ja ohne den Namen darin waere ein Ja zu nichts.');
    }
  } else {
    z.push('  (nicht bestimmt)');
  }
  z.push('');

  // ---- 3. Der Titel --------------------------------------------------------
  z.push(trenn);
  z.push('3  DER TITEL (Vertrag 2.8)');
  z.push('');
  const gewaehlt = gewaehlterZettel(befund.thumbnail);
  if (befund.metadaten) {
    z.push('      ' + befund.metadaten.titel);
    z.push('');
    z.push('  ' + befund.metadaten.titelZeichen + ' Zeichen (Codepunkte) von hoechstens ' +
      U.TITEL_MAX_ZEICHEN + '; ohne < und >.');
    z.push('  Er kommt aus dem Feld videotitel des Zettels ' + gewaehlt.dateiname + ',');
    z.push('  unveraendert. Es gibt keine zweite Quelle: kein Feld auf der Seite, kein');
    z.push('  Argument. Wer ihn aendern will, aendert ihn im Compositor und exportiert neu.');
  } else if (gewaehlt) {
    z.push('  KEINER. Der Zettel ' + gewaehlt.dateiname + ' traegt kein Feld videotitel.');
    z.push('  Es gibt kein Ersatzfeld und kein Argument dafuer (Vertrag 2.8). Der Weg');
    z.push('  zurueck ist der Compositor: Titel eintragen, neu exportieren, neuer Zettel.');
  } else {
    z.push('  KEINER -- es gibt keinen Zettel, aus dem er kommen koennte.');
    z.push('  Ein Bild ohne Zettel reicht fuer das Thumbnail, aber nicht fuer den Upload.');
  }
  z.push('');

  // ---- 4. Beschreibung, Hashtags, Tags -------------------------------------
  z.push(trenn);
  z.push('4  BESCHREIBUNG, HASHTAGS UND TAGS (Vertrag 2.9)');
  z.push('');
  if (befund.metadaten) {
    const m = befund.metadaten;
    z.push('  Die Hashtag-Zeile (' + m.hashtags.length + '), jeder mit seiner Herkunft:');
    for (const h of m.herleitung) {
      z.push('      #' + h.hashtag.padEnd(16) + h.quelle);
    }
    z.push('      -- die Liste ' + JSON.stringify(U.HASHTAG_FELD_NUR_SHORTS) + ' aus ' +
      U.HASHTAGS_DATEI + ' ist hier NICHT dabei:');
    z.push('         #Shorts unter einem Langformvideo waere falsch (Vertrag 7).');
    z.push('');
    z.push('  Die Tags (' + m.tags.length + ', ' + m.tagsZeichen + ' von hoechstens ' +
      TAGS_MAX_ZEICHEN + ' Zeichen mit Kommas):');
    if (m.tags.length === 0) z.push('      (keine)');
    for (const h of m.tagHerleitung) {
      z.push('      ' + h.hashtag.padEnd(17) + h.quelle);
    }
    z.push('      -- ohne Raute, und ohne die sechs festen Hashtags der Kanalvorlage.');
    z.push('         Entfernt wurden: ' +
      (m.tagsEntfernt.length ? m.tagsEntfernt.join(', ') : '(keiner)') + '.');
    z.push('         Zuerst die Doppelten, DANN die sechs festen. Die Reihenfolge ist');
    z.push('         zugesagt, weil sie das Ergebnis aendert (Vertrag 2.9).');
    for (const hin of m.tagHinweise) { z.push(''); umbrucheIn(z, '      ', 'ACHTUNG: ' + hin); }
    z.push('');
    z.push('  Kanalfelder aus ' + U.VEROEFFENTLICHUNG_DATEI + ', unveraendert:');
    z.push('      ' + Object.entries(m.veroeffentlichung)
      .map(([k, v]) => k + '=' + v).join('  '));
    z.push('');
    z.push('  DIE ERSTE ZEILE DER BESCHREIBUNG IST DER TITEL -- UND DAS WEICHT VON DER');
    z.push('  KANALVORLAGE AB. Die Vorlage sieht dort ein bis zwei Saetze zum Video vor,');
    z.push('  weil die ersten rund 150 Zeichen in der Suche erscheinen. Der Longform-Weg');
    z.push('  hat fuer eine solche Hook-Zeile heute keine Quelle: der Zettel traegt keine,');
    z.push('  ein Ersatzfeld auf der Seite waere ein zweiter Ort fuer denselben Text, und');
    z.push('  eine Zeile, die niemand geschrieben hat, laesst sich nicht hochladen. Ob eine');
    z.push('  Hook-Zeile kommen soll und woher, ist OFFEN (Vertrag 11.2). Bis dahin steht');
    z.push('  dort der Titel, und dieser Absatz steht hier, damit es niemandem entgeht.');
    z.push('');
    z.push('  Die fertige Beschreibung (' + m.beschreibung.length + ' Zeichen, ' +
      Buffer.byteLength(m.beschreibung, 'utf8') + ' Bytes UTF-8), woertlich, aus ' +
      U.BESCHREIBUNG_DATEI + ':');
    z.push('  ' + '-'.repeat(74));
    for (const zeile of m.beschreibung.split('\n')) z.push('  | ' + zeile);
    z.push('  ' + '-'.repeat(74));
    if (m.verstoesse.length) {
      z.push('');
      z.push('  VERSTOESSE GEGEN DIE GRENZEN:');
      for (const v of m.verstoesse) umbrucheIn(z, '      ', v);
    }
  } else {
    z.push('  Nicht gerechnet: ohne Titel gibt es keine Beschreibung, keine Hashtags und');
    z.push('  keine Tags. Hier steht darum nichts und kein erfundener Wert.');
    if (befund.konfiguration && !befund.konfiguration.lesbar) {
      z.push('');
      z.push('  Und die Konfiguration traegt ausserdem nicht:');
      for (const f of befund.konfiguration.fehler) umbrucheIn(z, '      ', f);
    }
  }
  z.push('');

  // ---- 5. Was dieser Lauf nicht kann --------------------------------------
  z.push(trenn);
  z.push('5  WAS DIESER LAUF NICHT KANN');
  z.push('');
  z.push('  Dies ist die LESENDE Haelfte des Longform-Arbeiters. Was fehlt, steht hier,');
  z.push('  damit die Vorschau nicht wie Vollstaendigkeit aussieht:');
  z.push('');
  for (const l of befund.luecken) umbrucheIn(z, '   -  ', l, '      ');
  umbrucheIn(z, '   -  ', 'Es gibt keinen Knopf und keine Ermaechtigung. Der Upload, das ' +
    'Warten, das Bild am Video und das Oeffentlichstellen (Vertrag 4, Schritte 8 bis 17) ' +
    'sind nicht gebaut. Ohne sie kann dieser Lauf nichts anrichten -- und nichts leisten.',
  '      ');
  umbrucheIn(z, '   -  ', 'Die vier offenen Punkte aus Vertrag 11 sind offen und werden ' +
    'von diesem Lauf nicht gefuellt: die neue Fassung der Zusage zur Freigabe-Naht (11.1), ' +
    'die Hook-Zeile (11.2), ob die Uebersicht den Longform-Stand fuehrt (11.3), und ein ' +
    'Argument fuer die Bilddatei bei mehreren Bildern am Tag (11.4).', '      ');
  z.push('');

  // ---- Der Abbruch ---------------------------------------------------------
  if (befund.abbruch) {
    z.push(trenn);
    z.push('ABBRUCH nach Vertrag ' + befund.abbruch.nach + ' (' + befund.abbruch.code + ')');
    z.push('');
    umbrucheIn(z, '  ', befund.abbruch.satz);
    for (const w of (befund.abbruch.weitere || [])) {
      z.push('');
      z.push('  Und ausserdem (Vertrag ' + w.nach + ', ' + w.code + '):');
      umbrucheIn(z, '  ', w.satz);
    }
    z.push('');
    z.push('  Kein Video dieses Laufs auf dem Kanal.');
  } else {
    z.push(trenn);
    z.push('BEREIT. Alles, was vor dem ersten schreibenden Aufruf zu pruefen ist, ist');
    z.push('geprueft und steht oben. Ein Ja gibt es hier trotzdem nicht -- siehe 5.');
  }
  z.push(trenn);
  return z;
}

// Umbricht einen langen Satz auf 78 Spalten und schreibt ihn mit Einzug in die
// Zeilenliste. Geliehen waere schoener; der Umbruch des Uploaders (`umbrich`)
// arbeitet auf einer anderen Zeilenbreite und ohne Einzug, und ihn dafuer zu
// aendern hiesse, die Shorts-Ausgabe anzufassen. Das ist nicht additiv (7).
function umbrucheIn(zeilen, einzug, text, folgeEinzug) {
  // Der Aufzaehlungsstrich steht in der ERSTEN Zeile und nicht in jeder: eine
  // Liste, in der jede Fortsetzungszeile aussieht wie ein neuer Punkt, zaehlt
  // vier Punkte, wo einer steht.
  const zweiter = folgeEinzug === undefined ? einzug : folgeEinzug;
  const breite = 78 - Math.max(einzug.length, zweiter.length);
  let zeile = '';
  let erste = true;
  const raus = () => { zeilen.push((erste ? einzug : zweiter) + zeile); erste = false; };
  for (const wort of String(text).split(/\s+/).filter(Boolean)) {
    if (zeile === '') { zeile = wort; continue; }
    if ((zeile + ' ' + wort).length > breite) { raus(); zeile = wort; }
    else zeile += ' ' + wort;
  }
  if (zeile !== '') raus();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

// Die beiden Argumente der schreibenden Haelfte bekommen ihre eigene Meldung.
// "Unbekanntes Argument" waere die falsche Auskunft: sie sind bekannt, sie
// stehen im Vertrag, und sie sind nur nicht gebaut. Zwei Zustaende, zwei
// Meldungen -- der Umriss jedes Fehlers dieser Reihe ist der eine Satz fuer
// zwei Lagen.
function pruefeNochNichtGebauteArgumente(argv) {
  const gefunden = argv.slice(2).filter(
    (a) => NOCH_NICHT_GEBAUTE_ARGUMENTE.some((n) => a === n || a.startsWith(n)));
  if (!gefunden.length) return;
  console.error('');
  console.error('Abbruch: ' + gefunden.join(', ') + ' gibt es hier heute nicht.');
  console.error('');
  console.error('  Diese Argumente stehen im Vertrag (docs/VERTRAG-longform.md, 3.1), und sie');
  console.error('  gehoeren zur SCHREIBENDEN Haelfte des Arbeiters. Die ist nicht gebaut.');
  console.error('');
  console.error('  Sie werden nicht angenommen und ignoriert: wer sie mitgibt, soll nicht');
  console.error('  glauben, sie wirkten. Ein Argument, das nichts tut, aber angenommen wird,');
  console.error('  ist schlimmer als eines, das es nicht gibt.');
  console.error('');
  console.error('  Dieser Aufruf kennt heute: ' + ERLAUBTE_ARGUMENTE.join(' '));
  console.error('');
  console.error('Es wurde NICHTS gelesen, NICHTS geschrieben und kein Netzaufruf gemacht.');
  console.error('');
  // EXIT_ARGUMENTFEHLER aus cli-args und nicht das EXIT_AUFRUFFEHLER von weiter
  // unten: diese Pruefung laeuft als ERSTE Anweisung des Programms, und dort
  // ist die Konstante aus der Rueckgabewerttabelle noch nicht gebildet. Beide
  // sind 2, und tests/longform-arbeiter.test.cjs haelt sie gegeneinander --
  // zwei Namen fuer eine Zahl duerfen nicht auseinanderlaufen.
  process.exit(EXIT_ARGUMENTFEHLER);
}

function wertVon(argv, praefix) {
  const t = argv.slice(2).find((x) => x.startsWith(praefix));
  return t === undefined ? null : t.slice(praefix.length);
}

function main() {
  pruefeKeineFreienArgumente(process.argv, 'src/upload/longform-arbeiter.js', '--aufnahme=');

  const aufnahme = wertVon(process.argv, '--aufnahme=');
  if (aufnahme === null) {
    console.error('\nAbbruch: --aufnahme= fehlt. Beispiel: --aufnahme="2026-09-03 17-08-11"');
    console.error('Der Name traegt ein Leerzeichen und muss in Anfuehrungszeichen stehen.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  if (!AUFNAHME_FORM.test(aufnahme)) {
    console.error('\nAbbruch: --aufnahme= hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  const zettel = wertVon(process.argv, '--zettel=');
  if (zettel !== null && (zettel.trim() === '' || path.basename(zettel) !== zettel)) {
    console.error('\nAbbruch: --zettel= ist ' + JSON.stringify(zettel) + ' und kein blosser');
    console.error('Dateiname. Ein Pfad wird nicht genommen; die Datei muss im Export-Ordner');
    console.error('liegen und einer der Kandidaten sein (Vertrag 3.1).\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }

  // Die beiden Ordner sind EINSTELLUNGEN. Fehlt einer, endet der Aufruf mit 2
  // und nennt den Schluessel -- nichts gelesen, nichts geschrieben (Vertrag 6).
  const renderWurzel = process.env[RENDER_WURZEL_SCHLUESSEL] || null;
  const exportOrdner = process.env[EXPORT_ORDNER_SCHLUESSEL] || null;
  for (const [schluessel, wert, wofuer] of [
    [RENDER_WURZEL_SCHLUESSEL, renderWurzel, 'der Render-Ordner mit der Videodatei (3.2)'],
    [EXPORT_ORDNER_SCHLUESSEL, exportOrdner, 'der Export-Ordner des Compositors (3.3)'],
  ]) {
    if (!wert) {
      console.error('\nAbbruch: der Schluessel ' + schluessel + ' fehlt in der .env.');
      console.error('Dort steht ' + wofuer + ', und nur dort: es gibt dafuer kein Argument');
      console.error('und keinen eingebauten Wert im Quelltext.\n');
      process.exit(EXIT_AUFRUFFEHLER);
    }
  }

  const projektwurzel = path.join(__dirname, '..', '..');
  let befund;
  try {
    befund = trockenlauf({ aufnahme, zettel, projektwurzel, renderWurzel, exportOrdner });
  } catch (e) {
    console.error('\nAbbruch: ' + e.message + '\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }

  const text = befund.saetze.join('\n');
  if (befund.abbruch) {
    // Der Befund geht auf stderr, damit der Freigabedienst ihn durchreichen
    // kann, ohne ihn von der Vorschau trennen zu muessen (Vertrag 6).
    console.error(text);
    process.exit(befund.abbruch.wert);
  }
  console.log(text);
  process.exit(EXIT_OK);
}

if (require.main === module) main();

module.exports = {
  ERLAUBTE_ARGUMENTE, NOCH_NICHT_GEBAUTE_ARGUMENTE, ERLAUBTE_ANGABEN,
  EXIT_OK, EXIT_BEFUND, EXIT_AUFRUFFEHLER, EXIT_GESPERRT,
  RENDER_WURZEL_SCHLUESSEL, EXPORT_ORDNER_SCHLUESSEL,
  VIDEO_ENDUNG, RENDER_NAME_FORM, GROESSE_ABWEICHUNG_ANTEIL, GROESSE_MINDESTENS_ANDERE,
  THUMBNAIL_MAX_BYTES, TAGS_MAX_ZEICHEN, FESTE_KANAL_HASHTAGS, BILDTYP_JE_ENDUNG,
  GESPERRTE_AUFNAHMEN, pruefeSperrliste, sperreFuer,
  videoDateiname, befundeVideodatei, vergleicheGroesse,
  leiteTagsAb, leiteTagsAbVertauscht, hinweiseZuTags, baueLongformMetadaten,
  trockenlauf, gewaehlterZettel, vorschau, umbrucheIn,
};
