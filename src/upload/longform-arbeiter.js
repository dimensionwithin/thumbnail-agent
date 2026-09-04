'use strict';

// ---------------------------------------------------------------------------
// DER LONGFORM-ARBEITER
//   EK: lesende Haelfte -- EP: bis zum privaten Video -- EU: bis zum
//   oeffentlichen
// ---------------------------------------------------------------------------
//
// Er bestimmt aus EINEM Aufnahmenamen alles, was ein Mensch sehen muss, bevor
// er ja sagt -- und zeigt es. Seit EP loest er das erste Ja ein: er laedt das
// Video PRIVAT hoch, wartet auf die Verarbeitung, heftet das Thumbnail an,
// liest zurueck. Seit EU loest er auch das ZWEITE ein: er haelt das Urteil
// gegen das Video, holt den Statusblock und stellt es OEFFENTLICH.
//
// DIE BEIDEN JA SIND NICHT DASSELBE, und dieses Modul behandelt sie nicht
// gleich. Das erste laesst sich zuruecknehmen -- ein privates Video loescht
// man im Studio, und niemand hat es gesehen. Das zweite nicht.
//
// Eingabe:  --aufnahme=<JJJJ-MM-TT HH-MM-SS>, dazu die Einstellungen
//           LONGFORM_RENDER_WURZEL (3.2) und THUMBNAIL_EXPORT_DIR (3.3).
//           Fuer den scharfen Lauf zusaetzlich --execute und
//           --bestaetigt-durch=<pfad zur Ermaechtigung>.
// Ausgabe:  EIN Befund und daraus eine Vorschau auf stdout, woertlich
//           (Vertrag 4, Schritt 6); im scharfen Lauf danach der Fortschritt
//           und der Abschluss.
//
// Vertragsstellen, die dieses Modul traegt: 2.3, 2.4, 2.5, 2.7 (ueber den
// Beipackzettel-Leser), 2.8, 2.9, 2.10, 2.11, 2.12, 2.14, 3.2, 3.3,
// 4 (Schritte 2 bis 6, 8 bis 13 und 16), 5, 6, 7.
//
// WO DIESER WEG AUFHOERT, UND WARUM DIE GRENZE JETZT DORT LIEGT:
//
//   Bis EU stand hier: "Aufruf 3 -- das Oeffentlichstellen (Vertrag 2.5) --
//   IST NICHT GEBAUT." Er ist es. Der Satz wird BERICHTIGT statt weiter
//   behauptet; was an seine Stelle tritt, ist die neue Grenze:
//
//   NACH DEM DRITTEN AUFRUF GESCHIEHT NICHTS MEHR. Es gibt kein
//   videos.delete, kein Zuruecksetzen auf privat, kein zweites videos.update
//   und kein Aufraeumen (Vertrag 7) -- weder als Argument noch als Aufruf, den
//   man von Hand ausloesen koennte. Geht etwas schief, wird es gemeldet und
//   nicht repariert. Ein Video, das der Mensch nicht freigibt, bleibt privat
//   liegen; dieser Weg raeumt nichts weg (2.4).
//
// WAS DIESES MODUL NICHT TUT, UND ZWAR MIT ABSICHT:
//
//   - Es schreibt NICHT in den Export-Ordner (Vertrag 7) und NICHT in den
//     Render-Ordner (7). Auf die Platte schreibt es genau zwei Dinge, und
//     beide ueber longform-gedaechtnis.js: das Gedaechtnis unter data/ und den
//     Vermerk der verbrauchten Ermaechtigung. Der Trockenlauf schreibt gar
//     nichts; tests/longform-arbeiter.test.cjs stellt die schreibenden
//     fs-Funktionen scharf und laesst ihn dagegen laufen.
//   - Es geht ohne --execute NICHT ins Netz. Keine Bibliothek fuer den Kanal
//     wird geladen (sie wird erst in longform-kanal.baueEchtenKanal() geholt),
//     kein Aufruf gemacht. Der Test zaehlt die verbotenen Woerter im Quelltext
//     nach und prueft, dass keine geliehene Kette die Netzbibliothek
//     hereinzieht, solange nur gelesen wird.
//   - KEIN AUFRUFNAME DER API STEHT IN DIESER DATEI. Sie stehen alle in
//     longform-kanal.js, und dieses Modul spricht ausschliesslich ueber die
//     sieben Methoden jenes Kanalobjekts. Der Grund ist nicht Ordnung: die
//     Frage "was kann dieses Programm auf dem Kanal tun" soll sich beantworten
//     lassen, indem man EINE Datei liest.
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
//   longform-gedaechtnis.js               das Gedaechtnis (5) und die erste
//                                         Ermaechtigung (2.12) -- samt allem,
//                                         was es sich seinerseits vom
//                                         Shorts-Uploader leiht
//   longform-kanal.js    baueEchtenKanal   die Aufrufe, die Zaehlung, das
//                                          Literal `private`
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

// Was dieser Aufruf kennt (Vertrag 3.1). --execute und --bestaetigt-durch=
// standen bis EK in einer eigenen Liste NOCH_NICHT_GEBAUTE_ARGUMENTE, mit einer
// eigenen Meldung ("erkannt, benannt, nicht gebaut"). Die Liste ist ERSATZLOS
// WEG und nicht danebengestellt worden: ihr Satz sagte, diese Haelfte sei nicht
// gebaut, und das ist ab EP unwahr. Eine Meldung, die stehen bleibt, nachdem
// ihr Satz nicht mehr stimmt, ist genau die Sorte, die der naechste Leser fuer
// wahr nimmt.
const ERLAUBTE_ARGUMENTE = [
  '--aufnahme=', '--zettel=', '--befund-json', '--execute', '--bestaetigt-durch=',
];

if (require.main === module) {
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/upload/longform-arbeiter.js');
  // Die Verbindungspruefung liegt NACH der Listenpruefung und VOR jedem Lesen
  // -- dieselbe Reihenfolge wie im Freigabedienst (Vertrag 3.1).
  pruefeSchreibendeArgumente(process.argv);
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
const G = require('./longform-gedaechtnis');
// NUR die Namen und die Zaehlung werden hier gebraucht; `googleapis` laedt
// dieses require NICHT -- die Bibliothek wird erst in baueEchtenKanal() geholt,
// und dorthin kommt kein Trockenlauf.
const K = require('./longform-kanal');

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
    // EU: DIE FRAGE (2.4). Sie ist null, solange der Lauf nicht so weit
    // gekommen ist, dass es eine gibt -- und `moeglich: false` mit Grund,
    // wenn sie auf dieser Lage nicht ansteht. Die beiden sind nicht dasselbe:
    // das eine heisst "nicht gerechnet", das andere "gerechnet, steht nicht an".
    frage: null,
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

  // ---- Schritt 4: das Gedaechtnis (Vertrag 5) -----------------------------
  //
  // ES WIRD IMMER GELESEN, auch im Trockenlauf und auch dann, wenn oben schon
  // etwas abgebrochen ist. Der Grund ist die Frage, die es beantwortet: liegt
  // von dieser Aufnahme schon ein Video auf dem Kanal? Sie muss in der
  // Vorschau stehen, BEVOR jemand klickt -- eine Auskunft, die nur im
  // scharfen Lauf kaeme, kaeme zu spaet.
  //
  // EIN FEHLER BEIM LESEN IST EIN ABBRUCH. Ein unlesbares Gedaechtnis sieht
  // sonst aus wie "noch nichts hochgeladen", und das ist der Zustand, nach dem
  // dieser Weg ein zweites Video anlegte.
  befund.gedaechtnis = leseGedaechtnisFuerBefund(projektwurzel, aufnahme, befund.video);
  if (befund.gedaechtnis.fehler.length) {
    setzeAbbruch(befund, 'gedaechtnis_unlesbar', '5.1',
      befund.gedaechtnis.fehler.join(' '));
  } else if (befund.gedaechtnis.abbruch) {
    setzeAbbruch(befund, befund.gedaechtnis.abbruch.code, befund.gedaechtnis.abbruch.nach,
      befund.gedaechtnis.satz);
  }

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

  // ---- Schritt 14 (EU): die Frage, falls sie ansteht (2.4) ----------------
  //
  // SIE WIRD IMMER GERECHNET, auch wenn oben schon etwas abgebrochen ist -- aus
  // demselben Grund, aus dem das Gedaechtnis immer gelesen wird: die Auskunft
  // "an diesem Video haengt etwas nicht" muss VOR dem Klick stehen. Ob es
  // einen Knopf gibt, entscheidet sie nicht; das tut zweiteBindung() daraus.
  befund.frage = frageBlock(befund);

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

// ---------------------------------------------------------------------------
// DAS GEDAECHTNIS IM BEFUND (Vertrag 5, Schritt 4) UND DER WIEDEREINSTIEG (5.3)
// ---------------------------------------------------------------------------
//
// DIE TABELLE IST DIE AUS 5.3, ZEILE FUER ZEILE. Sie steht als Tabelle und
// nicht als Kette von if: was ein zweiter Lauf tut, soll sich lesen lassen,
// ohne den Code auszufuehren, und ein Stand, der hier fehlt, faellt sofort auf
// (er landet im Zweig "unbekannt" und bricht ab, statt still weiterzulaufen).
//
// `ab` sagt, wo der Lauf ansetzt: 'upload' (Schritt 10), 'warten' (11),
// 'thumbnail' (12) oder null -- dann gibt es fuer diesen Bau nichts mehr zu
// tun, und der Grund steht daneben.
const WIEDEREINSTIEG = Object.freeze({
  hochgeladen: {
    ab: 'warten',
    satz: 'Das Video ist hochgeladen; die Verarbeitung war beim letzten Lauf noch nicht zu ' +
      'Ende. Dieser Lauf macht bei Schritt 11 weiter, mit einer NEUEN 45-Minuten-Frist ab ' +
      'jetzt. Es entsteht KEIN zweites Video.',
  },
  verarbeitung_abgebrochen: {
    ab: 'warten',
    satz: 'Beim letzten Lauf waren die 45 Minuten um, ohne dass YouTube die Verarbeitung ' +
      'abgeschlossen gemeldet hat. Dieser Lauf wartet noch einmal, mit einer NEUEN Frist. ' +
      'Es entsteht KEIN zweites Video; das Gedaechtnis vermerkt, dass es der zweite Anlauf ' +
      'ist.',
  },
  verarbeitet: {
    ab: 'thumbnail',
    satz: 'Das Video ist hochgeladen und verarbeitet; das Thumbnail fehlt noch. Dieser Lauf ' +
      'macht bei Schritt 12 weiter. Es entsteht KEIN zweites Video.',
  },
  abgelehnt: {
    ab: null,
    satz: 'YouTube hat dieses Video ABGELEHNT. Dieser Weg macht mit einem abgelehnten Video ' +
      'nichts -- kein Thumbnail, kein zweiter Upload, keine Veroeffentlichung. Der ' +
      'gespeicherte Grund steht unten; alles Weitere ist Sache eines Menschen im Studio.',
  },
  // EU: DIESE ZEILE HAT SICH GEAENDERT, UND ZWAR AN DER GEFAEHRLICHSTEN
  // STELLE. Bis EU stand hier `ab: null` und der Satz, das Oeffentlichstellen
  // sei "nicht gebaut". Beides ist nicht mehr wahr. Der Stand ist ab hier
  // KEIN Endzustand mehr, sondern der, an dem die Frage aus 2.4 gestellt wird
  // -- und aus dem ein zweiter Klick einen unwiderruflichen Aufruf macht.
  thumbnail_gesetzt: {
    ab: 'oeffentlich',
    satz: 'Das Video liegt PRIVAT auf dem Kanal, das Thumbnail haengt daran, und es ist ' +
      'zurueckgelesen. Damit steht die FRAGE an (Vertrag 2.4, 4 Schritt 14): ein Mensch ' +
      'sieht Titel, Beschreibung, Bild und jeden Befund von YouTube und entscheidet. Dieser ' +
      'Lauf macht KEINEN Upload mehr; was er mit einer zweiten Ermaechtigung taete, ist ' +
      'Aufruf 3 -- das Oeffentlichstellen, und das nimmt niemand zurueck. Die erste ' +
      'Ermaechtigung ersetzt die zweite nicht und ist ohnehin verbraucht (2.12, 7).',
  },
  oeffentlich: {
    ab: null,
    satz: 'Dieses Video ist bereits OEFFENTLICH. Es wird nichts angefasst -- kein zweiter ' +
      'Upload, kein zweites Thumbnail, keine Aenderung (Vertrag 5.3, 7).',
  },
});

// Liest das Gedaechtnis und sagt, was dieser Lauf damit anfangen kann.
//
// `video` ist der Befund der Videodatei. Ist sie nicht da, hat sie keine
// sha256 -- dann wird das Gedaechtnis trotzdem GELESEN (seine Fehler zaehlen)
// und nur nicht zugeordnet: ohne Pruefsumme gibt es keinen Schluessel.
function leseGedaechtnisFuerBefund(projektwurzel, aufnahme, video) {
  const g = G.leseGedaechtnis(projektwurzel, aufnahme);
  const stand = {
    pfad: g.pfad,
    fehler: g.fehler,
    gelesen: true,
    vorhanden: false,
    eintrag: null,
    stand: null,
    weiter: null,
    andere_datei: null,
    satz: null,
  };
  if (g.fehler.length) {
    stand.satz = 'Das Gedaechtnis liess sich nicht lesen. Solange nicht feststeht, ob schon ' +
      'ein Video oben ist, wird keines hochgeladen.';
    return stand;
  }
  if (!g.gedaechtnis) {
    stand.satz = 'Es gibt kein Gedaechtnis fuer diese Aufnahme: ' + g.pfad + '. Dieses ' +
      'Werkzeug hat aus ihr noch kein Langformvideo hochgeladen. (Die Renders vom 29.08., ' +
      '31.08., 02.09. und 03.09. sind mutmasslich VON HAND auf dem Kanal und werden nicht ' +
      'nachgetragen -- Vertrag 5.1. Ob DIESES Video schon oben ist, sieht dieser Lauf am ' +
      'Gedaechtnis und nicht am Kanal.)';
    return stand;
  }
  stand.vorhanden = true;
  // Das gelesene Objekt geht MIT. Der scharfe Lauf schreibt darauf weiter; es
  // ein zweites Mal von der Platte zu holen hiesse, zwischen Vorschau und
  // Upload eine zweite Fassung zu bekommen -- und ein Mensch haette dann ueber
  // die erste geurteilt.
  stand.gedaechtnisObjekt = g.gedaechtnis;

  const platte = video && typeof video.sha256 === 'string' ? video.sha256 : null;
  if (platte === null) {
    stand.satz = 'Es gibt ein Gedaechtnis (' + g.pfad + '), aber keine Pruefsumme der ' +
      'Videodatei auf der Platte -- die Datei fehlt oder ist nicht lesbar. Ohne sie laesst ' +
      'sich der Eintrag nicht zuordnen.';
    return stand;
  }

  // DIE GELIEHENE DOPPEL-UPLOAD-ABWEHR. Der Schluessel ist die sha256 und
  // nicht der Pfad: ein wiederholter Render liegt unter demselben Namen und
  // ist eine andere Datei (5.1).
  const eintrag = G.schonHochgeladen(g.gedaechtnis, platte);
  if (!eintrag) {
    // Das Gedaechtnis kennt diese Aufnahme, aber nicht diese Datei. Vertrag
    // 5.1: das ist KEIN zweiter Lauf desselben Videos, sondern ein anderes
    // Video unter demselben Namen -- Abbruch, beide Pruefsummen, die videoId
    // des ersten, und es wird NICHT ein zweites hochgeladen.
    const erster = g.gedaechtnis.uploads[0] || null;
    stand.andere_datei = {
      im_gedaechtnis: g.gedaechtnis.video ? g.gedaechtnis.video.sha256 : null,
      auf_der_platte: platte,
      videoId: erster ? erster.videoId : null,
      stand: erster ? erster.stand : null,
    };
    stand.satz = 'Die Videodatei auf der Platte ist eine ANDERE als die, die dieses Werkzeug ' +
      'fuer diese Aufnahme hochgeladen hat. Im Gedaechtnis steht die Pruefsumme ' +
      String(stand.andere_datei.im_gedaechtnis) + ', auf der Platte liegt jetzt ' + platte +
      '. Das ist kein zweiter Lauf desselben Videos, sondern ein anderes Video unter ' +
      'demselben Namen (Vertrag 5.1). Das erste liegt als ' +
      String(stand.andere_datei.videoId) + ' auf dem Kanal, Stand ' +
      String(stand.andere_datei.stand) + '. Es wird KEIN zweites hochgeladen; ob und wie ' +
      'eine Aufnahme ein zweites Mal hochgeladen werden kann, sieht der Vertrag nicht vor.';
    stand.abbruch = { code: 'andere_videodatei', nach: '5.1' };
    return stand;
  }

  stand.eintrag = eintrag;
  stand.stand = eintrag.stand;
  const zeile = WIEDEREINSTIEG[eintrag.stand];
  if (!zeile) {
    stand.satz = 'Das Gedaechtnis nennt den Stand ' + JSON.stringify(eintrag.stand) +
      '. Dieser Bau kennt ihn nicht und macht darum nichts -- ein unbekannter Stand wird ' +
      'nicht wie der naechstbeste behandelt.';
    stand.abbruch = { code: 'gedaechtnis_unbekannter_stand', nach: '5.2' };
    return stand;
  }

  // DER EINE SONDERFALL AUS 5.3: `terminated` ist ein ENDZUSTAND und kein
  // Zwischenstand. "Processing information is no longer available" -- ein
  // Weiterwarten wartete auf nichts (2.3).
  const v = eintrag.verarbeitung || null;
  const terminiert = v && v.processingStatus && v.processingStatus.wert === 'terminated';
  if (eintrag.stand === 'verarbeitung_abgebrochen' && terminiert) {
    stand.weiter = { ab: null, zweiter_anlauf: false };
    stand.satz = 'YouTube hat fuer dieses Video processingStatus "terminated" gemeldet: die ' +
      'Verarbeitungsinformation ist nicht mehr verfuegbar. Das ist ein Endzustand und kein ' +
      'Zwischenstand (Vertrag 2.3) -- der Stand bleibt stehen, und dieser Lauf wartet nicht ' +
      'noch einmal auf etwas, das nicht mehr kommt. Das Video liegt privat auf dem Kanal, ' +
      'Kennung ' + eintrag.videoId + '.';
    stand.abbruch = { code: 'verarbeitung_terminated', nach: '2.3' };
    return stand;
  }

  // EU: DER ANGEFANGENE DRITTE AUFRUF -- der zweite Sonderfall, und der
  // teuerste.
  //
  // Das Gedaechtnis wird VOR dem videos.update geschrieben (fuehreOeffentlichLauf),
  // mit dem Statusblock und dem Koerper, der gleich hinausgeht. Steht dieser
  // Vermerk da und der Stand ist noch `thumbnail_gesetzt`, dann ist der Aufruf
  // begonnen und nicht als beendet vermerkt worden: der Prozess ist dazwischen
  // gestorben, oder die Antwort ging verloren.
  //
  // OB ER DURCHKAM, WEISS DIESES GEDAECHTNIS NICHT -- und niemand hier kann es
  // wissen. Ein zweiter Lauf, der einfach weitermachte, machte im schlechten
  // Fall ein ZWEITES videos.update auf ein Video, das schon oeffentlich ist
  // (Vertrag 7 verbietet das ausdruecklich); im anderen Fall stellte er ein
  // Video oeffentlich, dessen Statusblock inzwischen ein anderer sein kann.
  // Beides entscheidet ein Mensch im Studio, nicht dieser Bau.
  //
  // WARUM KEIN EIGENER STAND: Vertrag 5.2 zaehlt die Staende auf, und die
  // Liste ist zugesagt. Ein siebter waere eine Abweichung; ein zusaetzliches
  // FELD ist ausdruecklich erlaubt ("additiv erweiterbar").
  if (eintrag.stand === 'thumbnail_gesetzt' && eintrag.oeffentlich_versuch) {
    const v = eintrag.oeffentlich_versuch;
    stand.weiter = { ab: null, zweiter_anlauf: false };
    stand.satz = 'Fuer dieses Video ist der dritte Aufruf BEGONNEN worden (am ' +
      String(v.begonnen_am) + ') und nicht als beendet vermerkt. Ob YouTube ihn ausgefuehrt ' +
      'hat, weiss dieses Gedaechtnis NICHT -- der Vermerk wird vor dem Aufruf geschrieben, ' +
      'damit genau diese Lage auffaellt. Das Video ist jetzt entweder noch privat oder ' +
      'schon oeffentlich; nachzusehen ist es im Studio, unter der Kennung ' +
      eintrag.videoId + '. Dieser Bau fasst es NICHT an: kein zweiter dritter Aufruf, kein ' +
      'Loeschen, kein Zuruecksetzen auf privat, kein Aufraeumen. Was danach zu tun ist, ' +
      'entscheidet ein ' +
      'Mensch -- und wenn das Video oeffentlich ist, traegt er den Stand von Hand ins ' +
      'Gedaechtnis nach oder loescht es dort und im Studio.';
    stand.abbruch = { code: 'oeffentlich_versuch_offen', nach: '2.5' };
    return stand;
  }

  stand.weiter = {
    ab: zeile.ab,
    zweiter_anlauf: eintrag.stand === 'verarbeitung_abgebrochen',
  };
  stand.satz = 'Dieses Video ist schon hochgeladen: Kennung ' + eintrag.videoId + ', am ' +
    eintrag.hochgeladen_am + ', Stand ' + eintrag.stand + '. ' + zeile.satz;
  // ZWEI DER STAENDE OHNE FORTSETZUNG SIND EIN ABBRUCH (5.3), EINER NICHT.
  // `abgelehnt` und `oeffentlich` sind Lagen, in denen dieser Weg sich
  // WEIGERT; `thumbnail_gesetzt` ist der fertige Schritt, und ein fertiger
  // Schritt ist kein Befund. Die drei unter einem Rueckgabewert zu fuehren
  // hiesse, "fertig" und "ich fasse das nicht an" gleich aussehen zu lassen.
  if (eintrag.stand === 'abgelehnt') {
    stand.abbruch = { code: 'video_abgelehnt', nach: '5.3' };
  } else if (eintrag.stand === 'oeffentlich') {
    stand.abbruch = { code: 'video_schon_oeffentlich', nach: '5.3' };
  }
  return stand;
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

  const eintrag = befund.gedaechtnis ? befund.gedaechtnis.eintrag : null;

  z.push(trenn);
  z.push('LONGFORM-TROCKENLAUF -- Aufnahme ' + befund.aufnahme);
  z.push(trenn);
  // Vertrag 6: der erste Satz sagt IMMER, ob ein Video auf dem Kanal liegt,
  // und er hat genau drei Formen. Bis EK war es immer dieselbe -- der Lauf kam
  // nie ueber das Lesen hinaus. Seit EP kann er es, und darum kommt der Satz
  // jetzt aus ersterSatz() und nicht mehr als Literal: eine Zeile, die "kein
  // Video" behauptet, waehrend eines oben liegt, waere die schlimmste Auskunft
  // dieser ganzen Ausgabe.
  z.push(ersterSatz(eintrag));
  z.push('Dieser Lauf hat gelesen und gerechnet. Er hat nichts hochgeladen und nichts');
  z.push('veroeffentlicht.');
  z.push('');

  // ---- Was beim Ja geschaehe ----------------------------------------------
  z.push('WAS BEIM JA GESCHAEHE');
  z.push('');
  if (befund.abbruch) {
    z.push('  NICHTS. Dieser Lauf endet mit einem Befund; ein Knopf zum Ja gibt es nicht.');
    z.push('  Der Grund steht unten unter ABBRUCH.');
  } else if (eintrag && befund.gedaechtnis.weiter && befund.gedaechtnis.weiter.ab) {
    // DER WIEDEREINSTIEG (Vertrag 5.3). Er steht HIER und nicht weiter unten:
    // "es wird hochgeladen" und "es wird dort weitergemacht, wo ein Lauf
    // stehengeblieben ist" sind zwei verschiedene Zusagen, und wer nur den
    // Anfang liest, muss die richtige lesen.
    z.push('  KEIN ZWEITER UPLOAD. Dieses Video ist schon oben; ein Ja setzt den');
    z.push('  angefangenen Lauf fort und legt kein zweites an.');
    z.push('');
    umbrucheIn(z, '  ', befund.gedaechtnis.satz);
    z.push('');
    z.push('  Weiter ab: ' + befund.gedaechtnis.weiter.ab +
      '   (Bild ' + eintrag.thumbnail.dateiname + ', aus dem Gedaechtnis)');
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

  // ---- 5. Das Gedaechtnis (Vertrag 5) -------------------------------------
  //
  // ES STEHT VOR "WAS DIESER LAUF NICHT KANN" und nicht darin: die Frage, ob
  // von dieser Aufnahme schon ein Video auf dem Kanal liegt, ist eine Auskunft
  // ueber die LAGE und keine ueber die Grenzen dieses Werkzeugs.
  z.push(trenn);
  z.push('5  DAS GEDAECHTNIS (Vertrag 5)');
  z.push('');
  z.push('  Datei:  ' + (befund.gedaechtnis ? befund.gedaechtnis.pfad : '(nicht gelesen)'));
  z.push('');
  if (befund.gedaechtnis) {
    umbrucheIn(z, '  ', befund.gedaechtnis.satz);
    if (eintrag) {
      z.push('');
      z.push('  Kennung:        ' + eintrag.videoId);
      z.push('  Hochgeladen am: ' + eintrag.hochgeladen_am);
      z.push('  Stand:          ' + eintrag.stand);
      z.push('  Titel damals:   ' + eintrag.titel);
      z.push('  Bild damals:    ' + eintrag.thumbnail.dateiname + '   (Rang ' +
        JSON.stringify(eintrag.thumbnail.rang) + ', sha256 ' +
        String(eintrag.thumbnail.sha256) + ')');
      if (eintrag.thumbnail_gesetzt_am) {
        z.push('  Thumbnail gesetzt: ' + eintrag.thumbnail_gesetzt_am);
      }
      if (eintrag.verarbeitung) {
        z.push('  Zuletzt gemeldet: ' + kurzfassung(eintrag.verarbeitung));
      }
    }
  }
  z.push('');
  z.push('  DIESES GEDAECHTNIS IST DIE DOPPEL-UPLOAD-ABWEHR. Sein Schluessel ist die');
  z.push('  sha256 der Videodatei und nicht ihr Pfad: ein wiederholter Render liegt unter');
  z.push('  demselben Namen und ist eine andere Datei (Vertrag 5.1). Steht die Pruefsumme');
  z.push('  dort, wird nicht noch einmal hochgeladen -- auch dann nicht, wenn der letzte');
  z.push('  Lauf mitten drin abgebrochen ist.');
  z.push('');
  z.push('  Nicht darin stehen die Renders vom 29.08., 31.08., 02.09. und 03.09.: sie sind');
  z.push('  mutmasslich VON HAND auf dem Kanal, ohne Lauf dieses Werkzeugs, und sie werden');
  z.push('  nicht nachgetragen (5.1). Fuer sie sieht dieser Lauf ein Video als neu an, bis');
  z.push('  ein Mensch das hier erkennt und nicht klickt.');
  z.push('');

  // ---- 5b. EU: DIE FRAGE (Vertrag 2.4, 4 Schritt 14) ----------------------
  //
  // Sie steht NUR da, wenn sie ansteht. Ein leerer Kasten "die Frage steht
  // nicht an" waere die haeufigste Ueberschrift dieser Vorschau und damit die,
  // die niemand mehr liest.
  //
  // WARUM SIE AUCH IM TERMINAL STEHT, obwohl der zweite Klick nur auf der
  // Seite geschieht: die Seite zeigt diesen Text woertlich, und wer den
  // Arbeiter von Hand ruft, soll dieselbe Lage sehen wie sie. Zwei Fassungen
  // dessen, was an einem Video haengt, waeren zwei Vorstellungen davon.
  const f = befund.frage;
  if (f && f.moeglich) {
    z.push(trenn);
    z.push('5b DIE FRAGE -- WAS AM VIDEO HAENGT (Vertrag 2.4)');
    z.push('');
    umbrucheIn(z, '  ', 'Das Video liegt PRIVAT auf dem Kanal, Kennung ' + f.videoId +
      '. Was hier steht, ist das, worueber ein Mensch entscheidet, bevor es OEFFENTLICH ' +
      'wird. Das laesst sich nicht zuruecknehmen.');
    z.push('');
    z.push('  Hochgeladen am:     ' + f.hochgeladen_am);
    z.push('  Thumbnail gesetzt:  ' + (f.thumbnail_gesetzt_am || '(nicht gesetzt)'));
    z.push('  Zurueckgelesen am:  ' + (f.rueckgelesen_am || '(nicht gelesen)'));
    z.push('');

    z.push('  DER TITEL');
    z.push('    wie gesendet:     ' + String(f.titel.gesendet));
    z.push('    wie YouTube ihn nennt: ' + String(f.titel.laut_youtube));
    z.push('    ' + (f.titel.gleich === true ? 'Beide sind gleich.'
      : f.titel.gleich === false ? 'SIE SIND VERSCHIEDEN.'
        : 'Nicht vergleichbar -- eine der beiden Angaben fehlt.'));
    z.push('');

    z.push('  DIE BESCHREIBUNG, IM WORTLAUT UND VOLLSTAENDIG');
    z.push('');
    if (f.beschreibung.heute_gebaut === null) {
      z.push('    (nicht vorhanden)');
    } else {
      for (const zeile of f.beschreibung.heute_gebaut.split('\n')) z.push('    ' + zeile);
    }
    z.push('');
    umbrucheIn(z, '    ', f.beschreibung.satz, '    ');
    z.push('');
    z.push('  Hashtagzeile: ' + (Array.isArray(f.hashtags) ? f.hashtags.join(' ') : '(keine)'));
    z.push('  Tags (' + f.tags.length + '): ' + (f.tags.join(', ') || '(keine)'));
    z.push('');

    z.push('  DAS BILD');
    if (f.thumbnail === null) {
      z.push('    (das Gedaechtnis nennt keines)');
    } else {
      z.push('    Datei von der Platte: ' + f.thumbnail.dateiname);
      z.push('      sha256:  ' + String(f.thumbnail.sha256));
      z.push('      Groesse: ' + String(f.thumbnail.bytes) + ' Bytes');
      z.push('      Rang ' + JSON.stringify(f.thumbnail.rang) + ', Zettel ' +
        (f.thumbnail.zettel === null ? '(keiner)' : f.thumbnail.zettel));
      z.push('      Jetzt noch einmal gemessen: ' + (f.thumbnail.auf_der_platte.ok
        ? 'unveraendert.' : 'ABWEICHUNG.'));
      if (!f.thumbnail.auf_der_platte.ok) {
        umbrucheIn(z, '      ', String(f.thumbnail.auf_der_platte.satz), '      ');
      }
    }
    z.push('');
    z.push('    WAS YOUTUBE AUSLIEFERT (snippet.thumbnails):');
    if (f.youtube_thumbnails && Object.keys(f.youtube_thumbnails).length) {
      for (const name of Object.keys(f.youtube_thumbnails)) {
        const b = f.youtube_thumbnails[name] || {};
        z.push('      ' + name + ': ' + String(b.url) +
          (b.width && b.height ? '   (' + b.width + 'x' + b.height + ')' : ''));
      }
    } else {
      z.push('      NICHT VORHANDEN. Das ist keine Bestaetigung und keine Ablehnung,');
      z.push('      sondern eine fehlende Auskunft -- im Studio nachsehen.');
    }
    z.push('');

    z.push('  WAS YOUTUBE GEMELDET HAT');
    z.push('');
    for (const a of f.auskuenfte) {
      z.push('    ' + a.name.padEnd(26, ' ') + ': ' +
        (a.da ? JSON.stringify(a.wert) + '   (' + a.quelle + ')' : 'nicht vorhanden'));
    }
    z.push('');
    z.push('    Der vollstaendige status-Block der Rueckleseantwort, unveraendert:');
    if (f.status_roh) {
      for (const name of Object.keys(f.status_roh)) {
        z.push('      ' + name + ': ' + JSON.stringify(f.status_roh[name]));
      }
    } else {
      z.push('      NICHT VORHANDEN.');
    }
    z.push('');
    z.push('    Der vollstaendige processingDetails-Block, unveraendert:');
    if (f.processing_roh) {
      for (const name of Object.keys(f.processing_roh)) {
        z.push('      ' + name + ': ' + JSON.stringify(f.processing_roh[name]));
      }
    } else {
      z.push('      NICHT VORHANDEN.');
    }
    z.push('');

    // ---- Die Auffaelligkeiten, ganz unten und mit eigener Ueberschrift ----
    //
    // "Ein Video, an dem etwas nicht stimmt, darf nicht so aussehen wie eines,
    // an dem alles stimmt." Darum steht hier IMMER etwas -- auch der Satz,
    // dass nichts aufgefallen ist. Eine leere Liste, die man uebersieht,
    // sieht aus wie eine, die es nicht gibt.
    z.push('  WAS AUFGEFALLEN IST');
    z.push('');
    if (!f.auffaelligkeiten.length) {
      umbrucheIn(z, '    ', 'Nichts. Das heisst: keiner der Vergleiche dieses Baus hat ' +
        'angeschlagen -- nicht, dass mit dem Video alles in Ordnung ist. Was YouTube ueber ' +
        'ein Langformvideo meldet, ist NICHT GEMESSEN (Vertrag 10, erster Punkt).', '    ');
    } else {
      for (const a of f.auffaelligkeiten) {
        umbrucheIn(z, '    ' + (a.schwere === 'sperrend' ? '[SPERREND] ' : '[LAUT] '),
          a.satz, '      ');
      }
      z.push('');
      if (f.sperrend > 0) {
        umbrucheIn(z, '    ', 'SPERREND heisst: auf dieser Lage gibt es keinen Knopf. ' +
          'Nicht, weil diese Anzeige es fuer unklug haelt, sondern weil eine Zusage des ' +
          'Vertrags dagegen steht.', '    ');
      } else {
        umbrucheIn(z, '    ', 'LAUT heisst: es gibt einen Knopf, und daneben steht, was ' +
          'nicht stimmt. Ob das reicht, entscheidet ein Mensch -- das ist der Sinn des ' +
          'zweiten Ja.', '    ');
      }
    }
    z.push('');
  }

  // ---- 6. Was dieser Lauf nicht kann --------------------------------------
  z.push(trenn);
  z.push('6  WAS DIESER LAUF NICHT KANN');
  z.push('');
  z.push('  Was fehlt, steht hier, damit die Vorschau nicht wie Vollstaendigkeit');
  z.push('  aussieht:');
  z.push('');
  for (const l of befund.luecken) umbrucheIn(z, '   -  ', l, '      ');
  // EU: DIESER SATZ HAT SICH GEAENDERT. Bis EU stand hier "DAS OEFFENTLICHE
  // STELLEN GIBT ES NICHT ... der Name der Methode kommt in diesem Projekt
  // nirgends vor". Beides ist nicht mehr wahr; der Satz wird BERICHTIGT und
  // nicht stehengelassen. Was bleibt, ist die Grenze dieses EINEN Klicks: er
  // laedt privat hoch und hoert auf.
  umbrucheIn(z, '   -  ', 'DIESER KLICK STELLT NICHTS OEFFENTLICH. Er laedt das Video ' +
    'PRIVAT hoch, wartet auf die Verarbeitung, heftet das Bild an, liest zurueck -- und ' +
    'hoert auf. Was danach auf dem Kanal liegt, ist privat und bleibt es, bis ein Mensch ' +
    'ein ZWEITES Mal klickt: der dritte Aufruf (Vertrag 2.5, 4 Schritte 14 bis 17) braucht ' +
    'eine eigene Ermaechtigung mit einem anderen Zweck, und die erste ersetzt sie nicht ' +
    '(2.12, 7). Um diesen zweiten Klick zu sehen, wird der Dienst nach dem Upload NEU ' +
    'GESTARTET -- dann liest der Trockenlauf das Gedaechtnis von jetzt, und die Frage steht ' +
    'auf der Lage von jetzt statt auf der von vor dem Upload.', '      ');
  umbrucheIn(z, '   -  ', 'Was YouTube nach der Verarbeitung ueber ein Langformvideo ' +
    'meldet -- einen Urheberrechtstreffer etwa -- ist NICHT GEMESSEN (Vertrag 10, erster ' +
    'Punkt). Die Anzeige nach dem Upload zeigt, was die API zurueckgibt; ob das alles ist, ' +
    'weiss dieses Projekt nicht. Das ist die wichtigste Einschraenkung dieses Weges.',
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
    z.push('  ' + ersterSatz(eintrag));
  } else {
    z.push(trenn);
    z.push('BEREIT. Alles, was vor dem ersten schreibenden Aufruf zu pruefen ist, ist');
    z.push('geprueft und steht oben.');
    z.push('');
    z.push('DAS HEISST NICHT, DASS ES GUT IST. Es heisst, dass dieser Lauf keinen Grund');
    z.push('gefunden hat, vorher abzubrechen. Ob das richtige Video, der richtige Titel und');
    z.push('das richtige Bild dastehen, steht oben -- und entscheidet ein Mensch.');
    z.push('');
    z.push('Ein Ja laedt PRIVAT hoch und hoert dort auf; siehe 6.');
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
// DIE BEFUNDZEILE (EN, Vertrag 4 Schritt 7)
// ---------------------------------------------------------------------------
//
// EINE Zeile JSON auf stderr, nach dem Muster von --vorschau-json beim
// Shorts-Uploader. Sie sagt AUSDRUECKLICH, welches Bild dieser Lauf bestimmt
// hat -- damit der Freigabedienst es zeigen kann, ohne es aus der Vorschau
// herauszulesen.
//
// WARUM SIE UEBERHAUPT DA IST, und das ist der ganze Grund: die Ansicht zeigt
// den Text des Arbeiters woertlich und zerlegt ihn nicht (EL). Ein Dienst, der
// den Bildpfad aus diesem Text herausschnitte, waere der zweite
// Darstellungsweg, den die Ansicht gerade vermeidet -- und er stuende beim
// naechsten Satzumbau still auf dem falschen Wort. Also gibt der Arbeiter den
// Pfad heraus, statt dass ihn jemand errechnet.
//
// SIE IST NICHT DIE ZWEITE WAHRHEIT, und daran haengt alles. Jedes Feld unten
// kommt aus DEMSELBEN `befund`, aus dem auch vorschau() ihre Saetze bildet.
// Diese Funktion liest den Befund und rechnet nicht nach: sie oeffnet keine
// Datei, sie liest kein Verzeichnis, sie prueft keine Pruefsumme und sie legt
// die Matrix nicht ein zweites Mal aus. tests/longform-arbeiter.test.cjs haelt
// das mit scharfgestellten LESENDEN fs-Funktionen fest -- ein Griff auf die
// Platte an dieser Stelle waere genau die zweite Auslegung, die dieser Vertrag
// durchgehend verbietet. Der einzige Weg, an dem sie etwas ZUSAMMENSETZT, ist
// der Bildpfad aus Export-Ordner und Dateiname, und beide stehen im Befund.
//
// SIE GEHT AUF stderr, wie beim Shorts-Uploader und aus demselben Grund: der
// Trockenlauf hat GENAU EINE Ausgabe fuer Menschen, und die soll ohne dieses
// Argument Byte fuer Byte bleiben, was sie ist. Anders als drueben zeigt die
// Longform-Ansicht aber BEIDE Stroeme -- also nimmt der Dienst die Zeile
// wieder heraus, bevor er den Strom anzeigt (freigabe-server.js,
// trenneBefundzeile). Ohne dieses Herausnehmen laese ein Mensch JSON.
const BEFUND_ARTIFACT_TYPE = 'adw_longform_befund';
const BEFUND_SCHEMA_VERSION = '1.0';

// WAS RANG UND ART FUER DEN MENSCHEN BEDEUTEN, der das Bild gleich ansieht.
// Ein Bild aus Rang 2 sieht auf dem Schirm genauso aus wie eines aus Rang 1;
// der Unterschied ist, ob es ohne Rueckfrage genommen wird oder nie. Das ist
// die eine Auskunft, die neben dem Bild stehen muss, und Vertrag 2.7 sagt sie
// in einem Satz: "Rang 2 und 3 werden nie zur Regel."
//
// WAS HIER AUSDRUECKLICH NICHT STEHT: warum der Leser diesen Rang vergeben
// hat. Das ist die Zustandsmatrix, sie steht in genau einem Modul, und ihre
// Meldung zu dieser Zelle steht als naechster Hinweis direkt darunter -- in
// den Worten des Lesers. Der erste Anlauf dieser Tabelle hat den Grund
// nacherzaehlt; tests/longform-arbeiter.test.cjs (EK-T2) hat das gefangen, und
// zwar zu Recht: eine Nacherzaehlung ist eine zweite Auslegung, sobald sich
// die erste aendert.
const RANG_ART = Object.freeze({
  1: {
    art: 'regel',
    satz: 'Rang 1 -- REGEL: dieses Bild wird ohne Rueckfrage genommen. Der Grund steht im ' +
      'naechsten Hinweis, in den Worten des Beipackzettel-Lesers.',
  },
  2: {
    art: 'vorschlag',
    satz: 'Rang 2 -- VORSCHLAG und keine Regel: dieses Bild wird nie ohne Rueckfrage ' +
      'genommen, auch dann nicht, wenn der Vorschlag zehnmal hintereinander richtig lag. ' +
      'Der Grund steht im naechsten Hinweis.',
  },
  3: {
    art: 'vorschlag',
    satz: 'Rang 3 -- VORSCHLAG aus einer Bilddatei OHNE Beipackzettel: ueber dieses Bild ist ' +
      'nichts aufgeschrieben, kein Titel, kein Datum, kein Format. Sein Dateiname sieht ' +
      'vielleicht aus, als truege er eines; er wird gezeigt und nicht gedeutet.',
  },
});

// Der Inhaltstyp aus der ENDUNG, aus DERSELBEN Tabelle, aus der ihn der
// zweite schreibende Aufruf nimmt (Vertrag 2.10). Der Freigabedienst setzt ihn
// in die Kopfzeile der Bildantwort; haette er dafuer eine eigene Tabelle,
// gaebe es zwei Wege von einer Endung zu einem Typ, und einer davon waere
// eines Tages der falsche. Eine unbekannte Endung ergibt null -- und ein Bild
// ohne bekannten Typ wird nicht ausgeliefert, statt einen geratenen zu
// bekommen.
function bildtypVon(dateiname) {
  return BILDTYP_JE_ENDUNG[path.extname(String(dateiname)).toLowerCase()] || null;
}

// Das EINE Bild, das dieser Lauf bestimmt hat -- oder keines.
//
// Die drei Faelle sind die drei Raenge, und sie stehen hier in derselben
// Reihenfolge wie in der Rangfolge des Vertrags. Wo der Beipackzettel-Leser
// NICHT gewaehlt hat -- zwei Kandidaten, ein ungueltiges Kandidatenbild, gar
// kein Kandidat -- gibt es kein Bild, und dann steht hier null und nicht das
// erstbeste. Ein Bild, das der Arbeiter nicht bestimmt hat, darf die Seite
// nicht zeigen: sie zeigte sonst eine Wahl, die niemand getroffen hat.
function bestimmtesBild(thumbnail) {
  if (!thumbnail) return null;
  const zt = gewaehlterZettel(thumbnail);
  if (zt) {
    const bb = zt.bildbefund || {};
    return {
      rang: thumbnail.rang,
      dateiname: zt.bild.dateiname,
      typ: bildtypVon(zt.bild.dateiname),
      // Die GEMESSENE Groesse und die GEMESSENE Pruefsumme, nicht die Angaben
      // des Zettels: was ausgeliefert wird, sind die Bytes auf der Platte.
      // Dass beide uebereinstimmen, hat der Leser vorher geprueft -- taeten
      // sie es nicht, gaebe es hier keinen Kandidaten mehr (BILD_UNGUELTIG).
      bytes: typeof bb.gemessen_bytes === 'number' ? bb.gemessen_bytes : null,
      sha256: typeof bb.gemessen_sha256 === 'string' ? bb.gemessen_sha256 : null,
      sha256_herkunft: typeof bb.gemessen_sha256 === 'string'
        ? 'gemessen und gegen den Beipackzettel geprueft'
        : 'nicht gerechnet',
      zettel: zt.dateiname,
      matrixzeile: zt.zeile,
      weitere_im_rang: 0,
    };
  }
  // Rang 3: eine Bilddatei ohne Zettel. Der Lauf bricht trotzdem ab (kein
  // Zettel, kein Titel, 2.8) -- das Bild ist davon unberuehrt und steht in der
  // Liste. Vertrag 2.7 nennt das ausdruecklich zwei Ebenen und keinen
  // Widerspruch: "Bild gefunden" und "Upload moeglich" duerfen nicht gleich
  // aussehen.
  if (thumbnail.rang === 3 && Array.isArray(thumbnail.vorschlaege) &&
      thumbnail.vorschlaege.length > 0) {
    // Das ERSTE der Liste, juengstes zuerst -- dasselbe, dessen Dateinamen der
    // Knopf spaeter traegt (Vertrag 2.7, "Mehrere Bilder ohne Zettel").
    const b = thumbnail.vorschlaege[0];
    return {
      rang: 3,
      dateiname: b.dateiname,
      typ: bildtypVon(b.dateiname),
      bytes: typeof b.bytes === 'number' ? b.bytes : null,
      // KEINE PRUEFSUMME, UND DAS WIRD GESAGT. Der Beipackzettel-Leser rechnet
      // sie nur fuer Kandidaten MIT Zettel (Vertrag 3.3: es wird keine Datei
      // geoeffnet ausser zum Rechnen der sha256 fuer die Vorschau). Sie hier
      // nachzurechnen waere eine Messung, die in der Vorschau daneben nicht
      // steht -- also die zweite Quelle. Ein null mit Grund ist ehrlicher als
      // eine Zahl, die nur diese Zeile kennt.
      sha256: null,
      sha256_herkunft: 'nicht gerechnet: Bild ohne Beipackzettel (Rang 3). Der ' +
        'Beipackzettel-Leser rechnet die Pruefsumme nur fuer Kandidaten mit Zettel; es ' +
        'gibt hier nichts, wogegen sie zu pruefen waere.',
      zettel: null,
      matrixzeile: b.zeile,
      weitere_im_rang: thumbnail.vorschlaege.length - 1,
    };
  }
  return null;
}

// Die Hinweise, die zu DIESEM Bild gehoeren. Jeder einzelne ist ein Satz aus
// dem Befund -- die Meldung seiner Matrixzelle, der Befund seiner Bilddatei,
// der Satz des Fensters, der Grund des Abbruchs. Diese Funktion formuliert
// keinen davon um und erfindet keinen dazu; der einzige Satz, der von hier
// stammt, ist der des Rangs (RANG_ART oben), und der benennt eine Zahl, die
// der Leser gesetzt hat.
function bildhinweise(thumbnail, bild, abbruch) {
  const h = [];
  if (!thumbnail || !bild) return h;
  const art = RANG_ART[bild.rang];
  if (art) h.push(art.satz);
  const zt = gewaehlterZettel(thumbnail);
  if (zt) {
    h.push(zt.meldung);
    if (zt.bildbefund && zt.bildbefund.satz) h.push(zt.bildbefund.satz);
    if (zt.durch_weitung) h.push(thumbnail.fenster.satz);
  } else if (bild.rang === 3) {
    const b = thumbnail.vorschlaege[0];
    h.push(b.meldung);
    if (b.durch_weitung) h.push(thumbnail.fenster.satz);
    if (bild.weitere_im_rang > 0) {
      h.push('Es liegen ' + (bild.weitere_im_rang + 1) + ' Bilder ohne Zettel im Fenster, ' +
        'juengstes zuerst; dieses ist das juengste. Der Weg zu einem anderen ist der ' +
        'Compositor: neu exportieren, dann liegt ein Zettel daneben. Ein Argument fuer eine ' +
        'Bilddatei gibt es nicht.');
    }
  }
  // Der Abbruch gehoert zum Bild, wenn es trotz Abbruch eines gibt -- genau
  // der Rang-3-Fall. Ohne ihn saehe das Bild aus, als koennte man es nehmen.
  if (abbruch) {
    h.push('Dieser Lauf endet trotzdem mit einem Befund (' + abbruch.code + ', Vertrag ' +
      abbruch.nach + '): ' + abbruch.satz);
  }
  return h;
}

function befundJson(befund) {
  const bild = bestimmtesBild(befund.thumbnail);
  const art = bild ? RANG_ART[bild.rang] : null;
  return {
    artifact_type: BEFUND_ARTIFACT_TYPE,
    schema_version: BEFUND_SCHEMA_VERSION,
    aufnahme: befund.aufnahme,
    export_ordner: befund.export_ordner,
    // Der Rang steht AUCH ausserhalb von `bild`, und zwar mit dem Wert des
    // Leser-Befunds: es gibt Laeufe mit einem Rang und ohne Bild (zwei
    // Kandidaten, ungueltiges Kandidatenbild). "Kein Bild" und "kein Rang"
    // sind zwei Zustaende.
    rang: befund.thumbnail ? befund.thumbnail.rang : null,
    art: art ? art.art : null,
    bild: bild === null ? null : {
      // Der Pfad wird aus zwei Werten des Befunds zusammengesetzt und aus
      // keiner dritten Stelle geholt. Er ist der einzige Grund, aus dem diese
      // Zeile ueberhaupt existiert.
      pfad: path.join(befund.export_ordner, bild.dateiname),
      dateiname: bild.dateiname,
      typ: bild.typ,
      bytes: bild.bytes,
      sha256: bild.sha256,
      sha256_herkunft: bild.sha256_herkunft,
      rang: bild.rang,
      art: art ? art.art : null,
      zettel: bild.zettel,
      matrixzeile: bild.matrixzeile,
      weitere_im_rang: bild.weitere_im_rang,
    },
    hinweise: bildhinweise(befund.thumbnail, bild, befund.abbruch),
    // WARUM ES KEIN BILD GIBT, wenn es keines gibt. Ohne diesen Satz saehe
    // "der Lauf hat keines bestimmt" aus wie "die Zeile hat es vergessen".
    ohne_bild_weil: bild !== null ? null
      : (befund.abbruch
        ? 'Der Lauf endet mit ' + befund.abbruch.code + ' (Vertrag ' + befund.abbruch.nach +
          '), und dabei hat der Beipackzettel-Leser kein einzelnes Bild bestimmt. ' +
          befund.abbruch.satz
        : 'Der Beipackzettel-Leser hat kein Bild bestimmt.'),
    abbruch: befund.abbruch === null ? null
      : { code: befund.abbruch.code, nach: befund.abbruch.nach },

    // EP: DER STAND DES GEDAECHTNISSES UND DIE BINDUNG.
    //
    // Beides gehoert in DIESE Zeile und nicht in eine zweite Rechnung des
    // Dienstes. Der Dienst schreibt die Ermaechtigung aus der Bindung, und der
    // Arbeiter prueft sie dagegen -- kaemen die Werte aus zwei Rechnungen,
    // waere die eine, die abweicht, ausgerechnet die, die den Upload ausloest.
    //
    // `bindung` ist null, wenn es keinen Knopf geben darf. Dann steht der
    // GRUND daneben: ein fehlender Knopf ohne Grund sieht aus wie ein
    // vergessener.
    gedaechtnis: befund.gedaechtnis === null ? null : {
      pfad: befund.gedaechtnis.pfad,
      vorhanden: befund.gedaechtnis.vorhanden === true,
      stand: befund.gedaechtnis.stand === undefined ? null : befund.gedaechtnis.stand,
      videoId: befund.gedaechtnis.eintrag ? befund.gedaechtnis.eintrag.videoId : null,
      hochgeladen_am: befund.gedaechtnis.eintrag
        ? befund.gedaechtnis.eintrag.hochgeladen_am : null,
      weiter_ab: befund.gedaechtnis.weiter ? befund.gedaechtnis.weiter.ab : null,
      satz: befund.gedaechtnis.satz,
    },
    bindung: bindungsZeile(befund),

    // EU: DIE FRAGE UND DIE ZWEITE BINDUNG.
    //
    // Dieselbe Bauart und derselbe Grund wie bei `bindung`: der Dienst
    // schreibt die zweite Ermaechtigung aus dieser Zeile, und der Arbeiter
    // prueft sie dagegen. `frage` ist das, was die Seite ZEIGT;
    // `zweite_bindung` ist das, woran die Ermaechtigung HAENGT. Die beiden
    // sind getrennt, weil sie zwei Fragen beantworten -- und weil in `frage`
    // Dinge stehen, die nichts binden (die Auskuenfte von YouTube etwa), und
    // in der Bindung nichts stehen darf, das nicht binden soll.
    frage: befund.frage === null ? null : befund.frage,
    zweite_bindung: zweiteBindungsZeile(befund),
  };
}

// Die Bindung als Zeile -- oder null mit Grund. Getrennt von befundJson(),
// weil bindung() mehr weiss, als in die Zeile gehoert: der Bildtyp und der
// Pfad bleiben hier, der Dienst braucht sie nicht und soll sie nicht bekommen.
function bindungsZeile(befund) {
  const b = bindung(befund);
  if (!b.ok) return { moeglich: false, grund: b.grund };
  return {
    moeglich: true,
    quelle: b.quelle,
    weiter_ab: b.weiter_ab,
    aufnahme: b.aufnahme,
    video_sha256: b.video_sha256,
    bild: { dateiname: b.bild.dateiname, sha256: b.bild.sha256 },
    zettel: { dateiname: b.zettel.dateiname, rang: b.zettel.rang },
  };
}

// ---------------------------------------------------------------------------
// DIE SCHREIBENDE HAELFTE (EP) -- Vertrag 4, Schritte 8 bis 13
// ---------------------------------------------------------------------------
//
// AB HIER GESCHIEHT ETWAS AUF EINEM ECHTEN KANAL. Was diese Haelfte tut, ist
// vollstaendig:
//
//   Aufruf 1  das Video PRIVAT hochladen, ohne Termin, mit Benachrichtigung
//   Warten    bis YouTube die Verarbeitung abgeschlossen meldet, hoechstens
//             45 Minuten
//   Aufruf 2  das Thumbnail an GENAU DIESES Video heften
//   Schritt 13 zuruecklesen, was wirklich dranhaengt
//
// UND DANN HOERT SIE AUF. Aufruf 3 -- das Oeffentlichstellen -- gehoert NICHT
// zu dieser Haelfte. Er steht weiter unten, in fuehreOeffentlichLauf(), und er
// braucht eine eigene Ermaechtigung mit einem eigenen Zweck. Was nach DIESEM
// Lauf auf dem Kanal liegt, ist ein privates Video mit Bild, und es bleibt
// privat, bis ein Mensch ein zweites Mal klickt.
//
// EU: DIE TRENNUNG IST GEBLIEBEN, obwohl beide Wege jetzt in einer Datei
// stehen. Sie sind zwei Funktionen, zwei Ermaechtigungen, zwei Bindungen und
// zwei Anzeigen; es gibt keinen Ablauf, in dem der eine in den anderen
// uebergeht. Ein Lauf laedt hoch ODER stellt oeffentlich, nie beides -- und
// welches von beiden, steht in der Datei, die ein Klick geschrieben hat.
//
// DREI SICHERUNGEN TRAGEN DIESEN TEIL, und jede einzelne faengt einen anderen
// Schaden:
//
//   (1) DIE ERMAECHTIGUNG (2.12). Sie ist der Beleg, dass ein Mensch gesehen
//       hat, was hochgeht -- gebunden an die sha256 der Videodatei und an
//       Namen und sha256 des Bildes. Sie gilt einmal.
//   (2) DAS GEDAECHTNIS (5). Es ist die Doppel-Upload-Abwehr. Steht die sha256
//       der Datei darin, wird NICHT noch einmal hochgeladen -- und zwar auch
//       dann nicht, wenn der letzte Lauf mitten drin abgestuerzt ist. Das ist
//       der teuerste Fehler, den dieser Weg machen kann, und das Gedaechtnis
//       ist das Einzige, was ihn verhindert.
//   (3) DIE ZAEHLUNG IM KANALOBJEKT (longform-kanal.js). Sie laesst je Lauf
//       hoechstens einen schreibenden Aufruf jeder Sorte durch, und zwar VOR
//       dem Aufruf. Sie ist die letzte Linie: sie greift auch dann, wenn (1)
//       und (2) durch einen Fehler in diesem Modul umgangen wuerden.
//
// Alle drei lassen sich einzeln ausbauen, und tests/ep-privat.test.cjs tut das
// -- jede fuer sich, mit dem Nachweis, dass Tests dabei rot werden.

// ZUGESAGT (Vertrag 2.3). Gemessen an sieben Renders: 294 bis 928 MB, 10
// Minuten bei 2560x1440 und 60 fps. Laenger als das ist kein Warten mehr,
// sondern ein Zustand, den ein Mensch ansehen soll.
const WARTEGRENZE_MS = 45 * 60 * 1000;

// NICHT ZUGESAGT (Vertrag 2.3, letzter Satz, und 9). Fuenfzehn Sekunden sind
// gewaehlt und nicht gemessen: bei einer Verarbeitung von Minuten kostet ein
// engerer Abstand Kontingent ohne Gewinn, ein weiterer laesst den Menschen vor
// einer Seite sitzen, auf der sich nichts ruehrt.
const ABFRAGEABSTAND_MS = 15 * 1000;

// Die vier Werte aus der Dokumentation, woertlich (Vertrag 2.3). Sie stehen
// als Konstanten da, damit ein Tippfehler nicht als "unbekannter Wert" endet
// und dann bis zur Frist weitergewartet wird.
const PROCESSING_FERTIG = 'succeeded';
const PROCESSING_LAEUFT = 'processing';
const PROCESSING_FEHLGESCHLAGEN = 'failed';
const PROCESSING_TERMINIERT = 'terminated';

// uploadStatus: bei diesen beiden wird nicht weiter gewartet (2.3).
const UPLOAD_ENDE_SCHLECHT = Object.freeze(['rejected', 'failed']);

// Die fuenf Auskuenfte, die die Anzeige nennen muss (2.4) -- jede mit dem Satz
// "nicht vorhanden", wenn sie fehlt. Die Liste steht einmal, damit keine davon
// beim naechsten Bau verlorengeht.
const YOUTUBE_AUSKUENFTE = Object.freeze([
  'processingStatus', 'uploadStatus', 'rejectionReason', 'failureReason',
  'processingFailureReason',
]);

// ---------------------------------------------------------------------------
// DER ERSTE SATZ (Vertrag 6)
// ---------------------------------------------------------------------------
//
// "Jede Meldung mit 1 sagt deshalb als ersten Satz, ob ein Video auf dem Kanal
// liegt, mit videoId und Zustand, und vor Aufruf 1 sagt sie 'kein Video dieses
// Laufs auf dem Kanal'. Der erste Satz hat damit genau drei Formen, und die
// drei sind nicht verwechselbar."
//
// Er steht hier als EINE Funktion, weil er an vier Stellen gebraucht wird: in
// der Vorschau, im Abschluss, in jeder Abbruchmeldung des scharfen Laufs und
// in der Ausgabe von main(). Vier Fassungen waeren vier Gelegenheiten, an
// einer davon "kein Video" zu sagen, waehrend eines oben liegt.
function ersterSatz(eintrag) {
  if (!eintrag || typeof eintrag.videoId !== 'string' || !eintrag.videoId) {
    return 'Kein Video dieses Laufs auf dem Kanal.';
  }
  if (eintrag.stand === 'oeffentlich') {
    return 'Ein Video dieses Laufs ist OEFFENTLICH auf dem Kanal: Kennung ' +
      eintrag.videoId + '.';
  }
  return 'Ein Video dieses Laufs liegt PRIVAT auf dem Kanal: Kennung ' + eintrag.videoId +
    ', Stand ' + String(eintrag.stand) + '.';
}

// ---------------------------------------------------------------------------
// DER FEINE RANG (Vertrag 5.2, 2.12)
// ---------------------------------------------------------------------------
//
// Der Beipackzettel-Leser fuehrt drei Raenge; der Vertrag will im Gedaechtnis
// und in der Ermaechtigung vier Werte: 1, '2a', '2b', 3. Der Unterschied
// zwischen 2a und 2b ist nicht kosmetisch -- 2a ist ein Zettel mit
// nicht bestaetigtem Namen, 2b ein leerer Zettel im Fenster, und ein Gedaechtnis,
// das nur "Rang 2" sagt, traegt zwei Zustaende unter einem Wort (5.2).
//
// DIE UNTERSCHEIDUNG WIRD NICHT HIER GERECHNET, UND SIE WIRD AUCH NICHT AN
// IHREM NAMEN ERKANNT. Der Unterschied zwischen 2a und 2b ist genau EINER: ob
// das Fenster fuer den Zettel gilt (2a nicht, 2b nur im Fenster). Diese
// Einteilung fuehrt der Beipackzettel-Leser selbst -- in zwei Mengen ueber die
// Zeilennummern seiner Matrix, die zusammen alle 37 Zeilen abdecken und sich
// nicht ueberschneiden. Sie werden hier BENUTZT.
//
// Der Weg ueber den `ausgang` waere kuerzer gewesen und ist absichtlich nicht
// genommen: dann stuenden die Namen der Matrixausgaenge in dieser Datei, und
// eine zweite Stelle, die die Vokabeln der Matrix kennt, ist der Anfang einer
// zweiten Stelle, die sie auslegt. tests/longform-arbeiter.test.cjs (EK-T2)
// haelt diese Datei frei davon; tests/ep-privat.test.cjs prueft dafuer, dass
// die Einteilung hier dasselbe ergibt wie der `ausgang` des Lesers.
function feinerRang(thumbnail) {
  if (!thumbnail || thumbnail.rang === null) return null;
  if (thumbnail.rang !== 2) return thumbnail.rang;
  const zt = gewaehlterZettel(thumbnail);
  // Mehrere Kandidaten: der Leser hat nicht gewaehlt, und dann gibt es keinen
  // feinen Rang. Der grobe bleibt stehen -- er ist wahr.
  if (!zt || zt.zeile === null || zt.zeile === undefined) return 2;
  if (Z.IMMER_GENANNT.has(zt.zeile)) return '2a';
  if (Z.FENSTERABHAENGIG.has(zt.zeile)) return '2b';
  return 2;
}

// Der Thumbnail-Block des Gedaechtniseintrags (Vertrag 5.2). Die vier Felder
// hinter Dateiname und Pruefsumme sind da, damit spaeter nachlesbar ist, WIE
// das Bild bestimmt wurde und nicht nur welches.
function thumbnailEintrag(befund) {
  const bild = bestimmtesBild(befund.thumbnail);
  const zt = gewaehlterZettel(befund.thumbnail);
  if (!bild) return null;
  return {
    dateiname: bild.dateiname,
    sha256: bild.sha256,
    bytes: bild.bytes,
    zettel: zt ? zt.dateiname : null,
    rang: feinerRang(befund.thumbnail),
    // "fehlt" und null sind zwei Zustaende: das eine heisst "der Zettel traegt
    // das Feld nicht", das andere "es gibt keinen Zettel" (Rang 3).
    zettel_herkunft: zt ? (zt.aufnahme_herkunft === null ? 'fehlt' : zt.aufnahme_herkunft) : null,
    format: zt ? zt.format : null,
    fenster_geweitet: zt ? zt.durch_weitung === true : false,
    per_argument: befund.zettel_argument !== null,
  };
}

// ---------------------------------------------------------------------------
// DIE BINDUNG (Vertrag 2.12)
// ---------------------------------------------------------------------------
//
// WORAN DIE ERMAECHTIGUNG HAENGT -- an EINER Stelle gerechnet, von zwei Seiten
// gebraucht: der Freigabedienst schreibt die Ermaechtigung daraus (ueber die
// Befundzeile), und dieser Arbeiter prueft sie dagegen. Zwei Rechnungen waeren
// zwei Vorstellungen davon, was der Mensch beurteilt hat, und die eine, die
// abweicht, waere die, die den Upload ausloest.
//
// SIE HAT ZWEI QUELLEN, UND WELCHE GILT, ENTSCHEIDET DAS GEDAECHTNIS:
//
//   'lauf'         erster Lauf: was dieser Lauf eben bestimmt hat.
//   'gedaechtnis'  Wiedereinstieg (5.3): "Die Zettelwahl selbst wird beim
//                  Wiedereinstieg NICHT wiederholt: das Gedaechtnis nennt den
//                  Zettel, und ein anderer Zettel, der inzwischen im Ordner
//                  liegt, aendert daran nichts. Sonst koennte ein Bild, das
//                  der Mensch beim ersten Lauf gesehen hat, beim zweiten ein
//                  anderes sein."
//
// Gibt { ok: true, ... } oder { ok: false, grund }. Ein `ok: false` heisst:
// auf dieser Lage gibt es keinen Knopf. Der Dienst bietet dann keinen an, und
// eine trotzdem geschriebene Ermaechtigung findet nichts, wogegen sie gilt.
function bindung(befund) {
  const g = befund.gedaechtnis;

  // Der Wiedereinstieg zuerst: liegt schon ein Video oben, gilt, was damals
  // beurteilt wurde, und nicht, was der Ordner heute hergibt.
  if (g && g.eintrag && g.eintrag.thumbnail) {
    const w = g.weiter;
    if (!w || w.ab === null) {
      return { ok: false, grund: 'Fuer dieses Video gibt es in diesem Bau nichts mehr zu ' +
        'tun. ' + g.satz };
    }
    // EU: DER STAND `thumbnail_gesetzt` FUEHRT NICHT MEHR ZU EINEM
    // UPLOAD-KNOPF, aber auch nicht mehr zu "nichts zu tun". Er fuehrt zur
    // FRAGE, und die haengt an der ZWEITEN Ermaechtigung (zweiteBindung()).
    // Die beiden Bindungen sind darum an dieser Stelle getrennt: eine
    // Ermaechtigung fuer den Upload, die hier eingeloest wuerde, ermaechtigte
    // zu einem zweiten Video und nicht zu dem, was ansteht.
    if (w.ab === 'oeffentlich') {
      return { ok: false, grund: 'Der Upload-Schritt ist fuer dieses Video FERTIG: es liegt ' +
        'privat auf dem Kanal, das Bild haengt daran, es ist zurueckgelesen. Eine ' +
        'Ermaechtigung zum Hochladen hat hier nichts einzuloesen. Was ansteht, ist die ' +
        'Frage aus Vertrag 2.4 und danach der dritte Aufruf -- dafuer braucht es eine ' +
        'ZWEITE Ermaechtigung mit einem anderen Zweck (2.12).' };
    }
    const t = g.eintrag.thumbnail;
    return {
      ok: true,
      quelle: 'gedaechtnis',
      aufnahme: befund.aufnahme,
      video_sha256: g.eintrag.sha256,
      bild: {
        dateiname: t.dateiname, sha256: t.sha256, bytes: t.bytes,
        typ: bildtypVon(t.dateiname),
      },
      zettel: { dateiname: t.zettel, rang: t.rang },
      weiter_ab: w.ab,
    };
  }

  if (befund.abbruch) {
    return { ok: false, grund: 'Dieser Lauf endet mit einem Befund (' + befund.abbruch.code +
      ', Vertrag ' + befund.abbruch.nach + '). Auf einen Befund folgt kein Knopf: ' +
      befund.abbruch.satz };
  }
  if (!befund.video || befund.video.stand !== 'da' || typeof befund.video.sha256 !== 'string') {
    return { ok: false, grund: 'Es gibt keine Videodatei mit einer Pruefsumme. Ohne sie ' +
      'haengt eine Ermaechtigung an nichts (Vertrag 2.12).' };
  }
  const bild = bestimmtesBild(befund.thumbnail);
  const zt = gewaehlterZettel(befund.thumbnail);
  if (!bild || !zt) {
    return { ok: false, grund: 'Dieser Lauf hat kein einzelnes Bild mit Beipackzettel ' +
      'bestimmt. Ohne Bild und Zettel gibt es nichts, woran eine Ermaechtigung haengen ' +
      'koennte.' };
  }
  if (typeof bild.sha256 !== 'string') {
    return { ok: false, grund: 'Fuer das Bild ' + bild.dateiname + ' gibt es keine ' +
      'gerechnete Pruefsumme. Eine Ermaechtigung ohne sie bezeugte den Dateinamen und ' +
      'nicht die Bytes.' };
  }
  const rang = feinerRang(befund.thumbnail);
  if (!G.ERLAUBTE_RAENGE.includes(rang)) {
    return { ok: false, grund: 'Rang ' + JSON.stringify(rang) + ' fuehrt zu keinem Knopf. ' +
      'Einloesbar sind ' + G.ERLAUBTE_RAENGE.map((r) => JSON.stringify(r)).join(', ') +
      ' (Vertrag 2.7, 2.12).' };
  }
  if (bild.typ === null) {
    return { ok: false, grund: 'Die Endung von ' + bild.dateiname + ' gehoert zu keinem ' +
      'bekannten Bildtyp. Der Typ des zweiten schreibenden Aufrufs kommt aus der Endung ' +
      '(Vertrag 2.10); ohne ihn wird nichts angeheftet.' };
  }
  return {
    ok: true,
    quelle: 'lauf',
    aufnahme: befund.aufnahme,
    video_sha256: befund.video.sha256,
    bild: {
      dateiname: bild.dateiname, sha256: bild.sha256, bytes: bild.bytes, typ: bild.typ,
    },
    zettel: { dateiname: zt.dateiname, rang },
    weiter_ab: 'upload',
  };
}

// ---------------------------------------------------------------------------
// EU: DIE FRAGE (Vertrag 2.4, 4 Schritt 14)
// ---------------------------------------------------------------------------
//
// WAS EIN MENSCH VOR SEINEM ZWEITEN JA SIEHT -- an einer Stelle
// zusammengestellt, aus dem Gedaechtnis und aus dem, was dieser Lauf auf der
// Platte vorfindet. Kein Netzaufruf: der Dienst startet diesen Trockenlauf,
// und der macht keinen (Vertrag 3.1).
//
// DER LEITSATZ DIESES BLOCKS: ein Video, an dem etwas nicht stimmt, darf nicht
// so aussehen wie eines, an dem alles stimmt. Darum steht neben jeder Auskunft
// auch, ob sie FEHLT, und darum gibt es die Liste `auffaelligkeiten`. Sie hat
// zwei Schweregrade, und der Unterschied ist nicht Geschmack:
//
//   sperrend   Auf dieser Lage gibt es KEINEN Knopf. Nicht, weil die Anzeige
//              es fuer unklug haelt, sondern weil eine Zusage des Vertrags
//              dagegen steht oder weil eine Angabe fehlt, ohne die die
//              Ermaechtigung an nichts haengt.
//   laut       Es gibt einen Knopf, und daneben steht, was nicht stimmt. Ob
//              das reicht, entscheidet der Mensch -- das ist der Sinn des
//              zweiten Ja. Ein Bau, der hier selbst entscheidet, nimmt ihm die
//              Entscheidung ab, die er treffen soll.
//
// WORAUS DIE ANGABEN KOMMEN, und warum jede aus dieser Quelle:
//
//   Titel         ZWEIMAL: wie gesendet (Gedaechtnis) und wie YouTube ihn
//                 nennt (Rueckleseantwort). Gehen sie auseinander, hat jemand
//                 im Studio umbenannt -- oder die API normalisiert. Beides
//                 muss ein Mensch sehen; welches von beidem es ist, kann
//                 dieser Bau nicht wissen.
//   Beschreibung  Der Wortlaut steht NICHT im Gedaechtnis (5.2). Gezeigt wird
//                 darum, was HEUTE aus Zettel und Vorlage entstuende, und
//                 daneben der Beleg, ob das Zeichen fuer Zeichen die gesendete
//                 ist: die Pruefsumme des gesendeten Textes steht im
//                 Gedaechtnis, die des heutigen wird hier gerechnet. Stimmen
//                 sie ueberein, ist der Text oben der gesendete -- nicht
//                 "vermutlich", sondern belegt.
//   Bild          Die Datei von der Platte (Name, sha256, Bytes) UND was
//                 YouTube in snippet.thumbnails zurueckgegeben hat. Die Datei
//                 wird JETZT noch einmal gemessen: zwischen dem Anheften und
//                 diesem Blick koennen Stunden liegen.
//   YouTube       Die fuenf Auskuenfte, jede mit "nicht vorhanden", wenn sie
//                 fehlt, und dazu die beiden ROHEN Bloecke (status,
//                 processingDetails) unveraendert. Was dieser Bau nicht kennt,
//                 verschwindet damit nicht.
function frageBlock(befund) {
  const g = befund.gedaechtnis;
  const auff = [];
  const merke = (schwere, satz) => auff.push({ schwere, satz });
  const nichts = (grund) => ({
    moeglich: false, grund, auffaelligkeiten: auff,
  });

  if (!g || !g.vorhanden || !g.eintrag) {
    return nichts('Es gibt fuer diese Aufnahme keinen Gedaechtniseintrag. Die Frage aus ' +
      'Vertrag 2.4 setzt ein Video voraus, das auf dem Kanal liegt.');
  }
  const e = g.eintrag;
  if (e.stand !== 'thumbnail_gesetzt') {
    return nichts('Der Stand ist ' + JSON.stringify(e.stand) + ' und nicht ' +
      '"thumbnail_gesetzt". Gefragt wird erst NACH der Verarbeitung und NACH dem Thumbnail ' +
      '(Vertrag 2.4): vorher zeigte die Frage ein Bild, von dem niemand weiss, ob es am ' +
      'Video haengt.');
  }
  if (e.oeffentlich_versuch) {
    return nichts('Fuer dieses Video ist der dritte Aufruf schon einmal begonnen worden. ' +
      String(g.satz));
  }

  const r = e.rueckgelesen || null;
  if (!r) {
    merke('sperrend', 'Das Gedaechtnis traegt keine Rueckleseantwort. Ohne sie steht nicht ' +
      'fest, WAS am Video haengt und was YouTube dazu meldet -- und genau dafuer ist dieser ' +
      'Schritt da (Vertrag 2.4).');
  }

  // ---- Der Titel, zweimal ------------------------------------------------
  const titelGesendet = typeof e.titel === 'string' ? e.titel : null;
  const titelYoutube = (r && typeof r.titel === 'string') ? r.titel : null;
  if (titelYoutube === null) {
    merke('sperrend', 'YouTube hat beim Zuruecklesen keinen Titel genannt. Der Titel ist ' +
      'das, was unter dem Video steht, sobald es oeffentlich ist; ohne ihn haengt die ' +
      'zweite Ermaechtigung an nichts (Vertrag 2.12).');
  } else if (titelGesendet !== null && titelYoutube !== titelGesendet) {
    merke('laut', 'DER TITEL AUF DEM KANAL IST NICHT DER GESENDETE. Gesendet wurde ' +
      JSON.stringify(titelGesendet) + ', YouTube nennt ' + JSON.stringify(titelYoutube) +
      '. Entweder hat jemand ihn im Studio geaendert, oder die API hat ihn veraendert ' +
      'zurueckgegeben. Was oeffentlich wuerde, ist der von YouTube.');
  }

  // ---- Die Beschreibung: heute gebaut, gegen die gesendete Pruefsumme -----
  const heute = (befund.metadaten && typeof befund.metadaten.beschreibung === 'string')
    ? befund.metadaten.beschreibung : null;
  const heuteSha = heute === null ? null : U.sha256Text(heute);
  const gesendetSha = typeof e.beschreibung_sha256 === 'string' ? e.beschreibung_sha256 : null;
  let beschreibungSatz;
  if (heute === null) {
    beschreibungSatz = 'DIESER LAUF KONNTE DIE BESCHREIBUNG NICHT BILDEN, und das Gedaechtnis ' +
      'fuehrt ihren Wortlaut absichtlich nicht (Vertrag 5.2). Sie steht auf dieser Seite ' +
      'darum NICHT. Nachzulesen ist sie im Studio, unter der Kennung des Videos.';
    merke('laut', beschreibungSatz);
  } else if (gesendetSha === null) {
    beschreibungSatz = 'Das Gedaechtnis traegt keine Pruefsumme der gesendeten Beschreibung. ' +
      'Der Text oben ist der, der HEUTE aus Zettel und Vorlage entstuende; ob er der ' +
      'gesendete ist, laesst sich nicht belegen.';
    merke('laut', beschreibungSatz);
  } else if (heuteSha === gesendetSha) {
    beschreibungSatz = 'Der Text oben ist ZEICHEN FUER ZEICHEN der gesendete: die Pruefsumme ' +
      'des heute gebauten Textes ist dieselbe, die beim Upload ins Gedaechtnis ging (' +
      gesendetSha + ').';
  } else {
    beschreibungSatz = 'ACHTUNG: der Text oben ist NICHT der gesendete. Er ist der, der ' +
      'heute aus Zettel und Vorlage entstuende (Pruefsumme ' + heuteSha + '); gesendet ' +
      'wurde einer mit der Pruefsumme ' + gesendetSha + '. Die Vorlage oder der Zettel hat ' +
      'sich seit dem Upload geaendert. Was am Video steht, ist der gesendete -- nachzulesen ' +
      'im Studio.';
    merke('laut', beschreibungSatz);
  }

  // ---- Das Bild: die Datei von jetzt, und was YouTube ausliefert ----------
  const t = e.thumbnail || null;
  let platte = { ok: false, satz: 'Das Gedaechtnis nennt kein Bild.' };
  if (t && typeof t.dateiname === 'string' && typeof t.sha256 === 'string') {
    platte = pruefeBildAufDerPlatte(befund.export_ordner, t,
      'Das Bild haengt bereits am Video; was hier fehlt, ist der BELEG dafuer, WELCHES es ' +
      'war. Es wird nichts oeffentlich gestellt, bis ein Mensch das benannt hat.');
  }
  if (!platte.ok) {
    merke('sperrend', 'DIE BILDDATEI VON DER PLATTE: ' + platte.satz);
  }
  const yt = (r && r.thumbnails && typeof r.thumbnails === 'object') ? r.thumbnails : null;
  if (r && !yt) {
    merke('laut', 'YouTube hat beim Zuruecklesen KEIN snippet.thumbnails zurueckgegeben. Das ' +
      'ist keine Bestaetigung und keine Ablehnung, sondern eine fehlende Auskunft -- im ' +
      'Studio nachsehen, ob das Bild wirklich am Video haengt.');
  } else if (yt && Object.keys(yt).length === 0) {
    merke('laut', 'YouTube hat snippet.thumbnails zurueckgegeben, aber ohne Eintraege. Es ist ' +
      'damit nicht zu sehen, ob das Bild angekommen ist.');
  }

  // ---- Was YouTube gemeldet hat ------------------------------------------
  //
  // Aus BEIDEN Quellen: die Rueckleseantwort ist die juengere, der
  // Verarbeitungsstand die vollstaendigere. Wo die juengere ein Feld nicht
  // traegt, steht die aeltere -- und WOHER die Angabe kommt, steht daneben.
  const v = e.verarbeitung || {};
  const rStatus = (r && r.status && typeof r.status === 'object') ? r.status : null;
  const rPd = (r && r.processingDetails && typeof r.processingDetails === 'object')
    ? r.processingDetails : null;
  const ausRoh = (name) => {
    if (name === 'processingStatus' || name === 'processingFailureReason') {
      return K.feld(rPd, name);
    }
    return K.feld(rStatus, name);
  };
  const auskuenfte = YOUTUBE_AUSKUENFTE.map((name) => {
    const neu = ausRoh(name);
    if (neu.da) return { name, da: true, wert: neu.wert, quelle: 'rueckleseantwort' };
    const alt = v[name];
    if (alt && alt.da) return { name, da: true, wert: alt.wert, quelle: 'verarbeitungsstand' };
    return { name, da: false, wert: null, quelle: null };
  });
  const nenne = (name) => auskuenfte.find((a) => a.name === name) || { da: false, wert: null };

  const us = nenne('uploadStatus');
  if (us.da && UPLOAD_ENDE_SCHLECHT.includes(us.wert)) {
    merke('sperrend', 'YOUTUBE MELDET uploadStatus ' + JSON.stringify(us.wert) + '. Ein ' +
      'abgelehntes oder fehlgeschlagenes Video wird nicht oeffentlich gestellt (Vertrag ' +
      '2.3, 5.3).');
  }
  const ps = nenne('processingStatus');
  if (ps.da && (ps.wert === PROCESSING_FEHLGESCHLAGEN || ps.wert === PROCESSING_TERMINIERT)) {
    merke('sperrend', 'YOUTUBE MELDET processingStatus ' + JSON.stringify(ps.wert) + '. Es ' +
      'wird nichts oeffentlich gestellt.');
  }
  for (const name of ['rejectionReason', 'failureReason', 'processingFailureReason']) {
    const f = nenne(name);
    if (f.da) {
      merke('laut', 'YOUTUBE NENNT ' + name + ': ' + JSON.stringify(f.wert) + '. Das steht ' +
        'hier, weil es da steht -- was es bedeutet, ist im Studio nachzusehen.');
    }
  }

  // ---- Die Sichtbarkeit jetzt --------------------------------------------
  const privacy = K.feld(rStatus, K.STATUS_FELD_PRIVACY);
  if (!privacy.da) {
    merke('laut', 'Die Rueckleseantwort nennt keinen privacyStatus. Dass das Video privat ' +
      'ist, steht damit nicht in dieser Antwort -- es ist nur nicht widerlegt.');
  } else if (privacy.wert !== K.PRIVACY_STATUS) {
    merke('sperrend', 'DIE SICHTBARKEIT IST SCHON ' + JSON.stringify(privacy.wert) +
      ' UND NICHT ' + JSON.stringify(K.PRIVACY_STATUS) + '. Dieser Weg stellt nur ein ' +
      'privates Video oeffentlich; was hier steht, hat jemand anders geaendert. Im Studio ' +
      'nachsehen -- es wird nichts angefasst.');
  }
  const termin = K.feld(rStatus, K.STATUS_FELDER_NIE[0]);
  if (termin.da) {
    merke('sperrend', 'DER STATUSBLOCK TRAEGT EINEN VEROEFFENTLICHUNGSTERMIN (' +
      K.STATUS_FELDER_NIE[0] + ': ' + JSON.stringify(termin.wert) + '). Dieser Weg setzt ' +
      'nie einen (Vertrag 7); er stammt also nicht von hier. Ein Video mit Termin ist ein ' +
      'terminiertes Video, und es jetzt von Hand oeffentlich zu stellen waere eine andere ' +
      'Handlung als die, ueber die geurteilt wird. Es wird nichts angefasst.');
  }

  // ---- Der Zettel: der von damals, der von heute --------------------------
  const zt = gewaehlterZettel(befund.thumbnail);
  if (t && typeof t.zettel === 'string' && zt && zt.dateiname !== t.zettel) {
    merke('laut', 'Der Beipackzettel im Export-Ordner ist heute ein anderer als der, aus dem ' +
      'Titel und Bild dieses Videos kamen: damals ' + JSON.stringify(t.zettel) + ', heute ' +
      'waehlte der Leser ' + JSON.stringify(zt.dateiname) + '. Am Video aendert das nichts ' +
      '-- die Zettelwahl wird beim Wiedereinstieg nicht wiederholt (Vertrag 5.3). Es heisst ' +
      'nur, dass der Text oben aus einem anderen Zettel stammt.');
  }

  if (befund.video && befund.video.vergleich && befund.video.vergleich.auffaellig) {
    merke('laut', befund.video.vergleich.satz);
  }

  return {
    moeglich: true,
    grund: null,
    videoId: e.videoId,
    stand: e.stand,
    hochgeladen_am: e.hochgeladen_am,
    thumbnail_gesetzt_am: e.thumbnail_gesetzt_am || null,
    rueckgelesen_am: r ? r.gelesen_am : null,
    anlaeufe: typeof e.anlaeufe === 'number' ? e.anlaeufe : 1,
    titel: {
      gesendet: titelGesendet,
      laut_youtube: titelYoutube,
      gleich: (titelGesendet !== null && titelYoutube !== null)
        ? titelGesendet === titelYoutube : null,
    },
    beschreibung: {
      heute_gebaut: heute,
      heute_sha256: heuteSha,
      gesendet_sha256: gesendetSha,
      gleich: (heuteSha !== null && gesendetSha !== null) ? heuteSha === gesendetSha : null,
      satz: beschreibungSatz,
    },
    hashtags: (befund.metadaten && befund.metadaten.hashtags) || null,
    hashtag_herleitung: (befund.metadaten && befund.metadaten.herleitung) || null,
    tags: Array.isArray(e.tags) ? e.tags : [],
    thumbnail: t === null ? null : {
      dateiname: t.dateiname,
      sha256: t.sha256,
      bytes: t.bytes,
      rang: t.rang,
      zettel: t.zettel,
      zettel_herkunft: t.zettel_herkunft,
      format: t.format,
      fenster_geweitet: t.fenster_geweitet === true,
      per_argument: t.per_argument === true,
      auf_der_platte: { ok: platte.ok === true, satz: platte.satz },
    },
    youtube_thumbnails: yt,
    auskuenfte,
    status_roh: rStatus,
    processing_roh: rPd,
    verarbeitung_abfragen: typeof v.abfragen === 'number' ? v.abfragen : null,
    video: befund.video === null ? null : {
      dateiname: befund.video.dateiname,
      pfad: befund.video.pfad,
      sha256: befund.video.sha256,
      bytes: befund.video.bytes,
    },
    auffaelligkeiten: auff,
    sperrend: auff.filter((a) => a.schwere === 'sperrend').length,
  };
}

// ---------------------------------------------------------------------------
// EU: DIE ZWEITE BINDUNG (Vertrag 2.12)
// ---------------------------------------------------------------------------
//
// DIESELBE BAUART WIE bindung() UND AUS DEMSELBEN GRUND: der Dienst schreibt
// die zweite Ermaechtigung daraus (ueber die Befundzeile), und dieser Arbeiter
// prueft sie dagegen. Zwei Rechnungen waeren zwei Vorstellungen davon, was der
// Mensch beurteilt hat -- und die eine, die abweicht, waere die, die ein Video
// oeffentlich stellt.
//
// SIE HAT NUR EINE QUELLE, anders als die erste: das GEDAECHTNIS. Es gibt hier
// keinen "ersten Lauf" -- was oeffentlich gestellt wird, ist immer etwas, das
// ein frueherer Lauf hochgeladen hat, und woran es haengt, hat derselbe Lauf
// aufgeschrieben. Der Export-Ordner steuert genau eine Angabe bei, und die
// wird nicht uebernommen, sondern GEPRUEFT: liegt die Bilddatei noch so da,
// wie sie geheftet wurde.
//
// EINE SPERRENDE AUFFAELLIGKEIT SCHLIESST DEN KNOPF. Das ist der Unterschied
// zur ersten Bindung: dort gibt es keine Lage, in der ein Mensch sinnvoll
// "trotzdem" sagen koennte, hier schon -- und darum muss ausdruecklich stehen,
// welche Lagen das NICHT sind.
function zweiteBindung(befund) {
  const f = befund.frage;
  if (!f || !f.moeglich) {
    return { ok: false, grund: (f && f.grund) || 'Auf dieser Lage steht die Frage aus ' +
      'Vertrag 2.4 nicht an.' };
  }
  if (f.sperrend > 0) {
    const gruende = f.auffaelligkeiten.filter((a) => a.schwere === 'sperrend')
      .map((a) => a.satz);
    return { ok: false, grund: 'Es gibt ' + gruende.length + ' Befund(e), die einen Knopf ' +
      'ausschliessen: ' + gruende.join(' -- ') };
  }
  const e = befund.gedaechtnis.eintrag;
  if (!befund.video || befund.video.stand !== 'da' ||
      typeof befund.video.sha256 !== 'string') {
    return { ok: false, grund: 'Es gibt keine Videodatei mit einer Pruefsumme auf der ' +
      'Platte. Die zweite Ermaechtigung haengt an ihr (Vertrag 2.12), auch wenn das Video ' +
      'laengst oben liegt: sie sagt, ueber WELCHE Datei geurteilt wurde.' };
  }
  if (befund.video.sha256 !== e.sha256) {
    return { ok: false, grund: 'Die Videodatei auf der Platte traegt die Pruefsumme ' +
      befund.video.sha256 + ', der Gedaechtniseintrag ' + String(e.sha256) + '.' };
  }
  return {
    ok: true,
    aufnahme: befund.aufnahme,
    video_sha256: befund.video.sha256,
    videoId: e.videoId,
    urteil: {
      titel: f.titel.laut_youtube,
      beschreibung_sha256: (e.rueckgelesen && typeof e.rueckgelesen.beschreibung_sha256 === 'string')
        ? e.rueckgelesen.beschreibung_sha256 : null,
      thumbnail: { dateiname: e.thumbnail.dateiname, sha256: e.thumbnail.sha256 },
    },
  };
}

// Die zweite Bindung als Zeile fuer den Dienst -- dieselbe Trennung wie bei
// bindungsZeile(): was der Dienst nicht braucht, bekommt er nicht.
function zweiteBindungsZeile(befund) {
  const b = zweiteBindung(befund);
  if (!b.ok) return { moeglich: false, grund: b.grund };
  return {
    moeglich: true,
    aufnahme: b.aufnahme,
    video_sha256: b.video_sha256,
    videoId: b.videoId,
    urteil: b.urteil,
  };
}

// ---------------------------------------------------------------------------
// DIE ZIELSPERRE (Vertrag 7)
// ---------------------------------------------------------------------------
//
// "Kein thumbnails.set auf eine videoId, die nicht Aufruf 1 dieses
// Gedaechtnisses zurueckgegeben hat. Damit nie auf ein Short, nie auf ein
// Back-Catalog-Video, nie auf eine von Hand eingetragene Id."
//
// WARUM DAS EINE EIGENE PRUEFUNG IST UND NICHT "kann nicht vorkommen": CV und
// CX haben gemessen, dass thumbnails.set auf ein Short mit 200 antwortet, nur
// die 16:9-Ableitungen ersetzt und die 9:16-Fassung stehen laesst -- und das
// laesst sich nicht zurueckdrehen. Ein Fehlgriff hier ist stumm und
// unumkehrbar. Eine Erwartung ist dagegen keine Sicherung.
function pruefeThumbnailZiel(eintrag, videoId) {
  if (!eintrag || typeof eintrag.videoId !== 'string' || !eintrag.videoId) {
    return { ok: false, satz: 'ZIELSPERRE: es gibt keinen Gedaechtniseintrag mit einer ' +
      'Kennung. Das Bild wird an nichts geheftet.' };
  }
  if (videoId !== eintrag.videoId) {
    return { ok: false, satz: 'ZIELSPERRE: das Bild sollte an ' + String(videoId) +
      ' geheftet werden, das Gedaechtnis dieses Laufs nennt aber ' + eintrag.videoId +
      '. Es wird nichts geheftet. Ein Thumbnail auf ein fremdes Video ersetzt dort die ' +
      '16:9-Ableitungen und laesst sich nicht zurueckdrehen (Vertrag 2.10, gemessen in ' +
      'CV und CX).' };
  }
  return { ok: true, satz: null };
}

// Das Bild noch einmal gegen die Platte (Vertrag 5.3): "Der Beipackzettel und
// die Bilddatei werden beim Wiedereinstieg ERNEUT gegen die Platte geprueft;
// weicht die sha256 des Bildes vom Eintrag ab, wird kein Thumbnail gesetzt,
// bis ein Mensch das benannt hat."
//
// SIE LAEUFT AUCH IM ERSTEN LAUF, unmittelbar vor Aufruf 2. Zwischen der
// Vorschau und diesem Punkt liegen bis zu 45 Minuten Warten; der Compositor
// kann in dieser Zeit neu exportiert haben.
//
// EU: `folge` KOMMT DAZU, UND ZWAR ALS ARGUMENT UND NICHT ALS ZWEITE FUNKTION.
//
// Diese Pruefung wird ab EU an DREI Stellen gebraucht: vor dem Anheften
// (Aufruf 2), in der Frage (Schritt 14) und unmittelbar vor dem
// Oeffentlichstellen (Aufruf 3). Die MECHANIK ist ueberall dieselbe -- Pfad
// unter dem Ordner, Datei da, unter 2 MiB, sha256 gleich, Endung bekannt.
// Verschieden ist nur die FOLGE: vor Aufruf 2 heisst ein Mangel "das Video
// bleibt privat, ohne Bild", danach heisst er "das Bild haengt schon dran, nur
// der Beleg fehlt". Eine zweite Funktion mit denselben fuenf Pruefungen waere
// die, die eines Tages vier hat. Ein falscher Folgesatz waere aber schlimmer
// als eine doppelte statSync -- darum wandert der Satz herein, statt dass die
// Pruefung sich verdoppelt. Ohne Angabe gilt der von EP, woertlich.
const BILD_FOLGE_VOR_AUFRUF_2 = 'Das Video bleibt privat auf dem Kanal, ohne Bild.';

function pruefeBildAufDerPlatte(exportOrdner, thumbnail, folge = BILD_FOLGE_VOR_AUFRUF_2) {
  const voll = path.join(exportOrdner, String(thumbnail.dateiname));
  if (!pfadLiegtUnter(exportOrdner, voll)) {
    return { ok: false, satz: 'Das Bild ' + thumbnail.dateiname + ' laege nicht unter dem ' +
      'Export-Ordner. Es wird nichts geoeffnet und nichts geheftet.' };
  }
  let st;
  try { st = fs.statSync(voll); } catch (e) {
    return { ok: false, satz: 'Das Bild ' + thumbnail.dateiname + ' liegt nicht mehr im ' +
      'Export-Ordner (' + (e.code || e.message) + '). Es wird kein Thumbnail gesetzt.' };
  }
  if (!st.isFile()) {
    return { ok: false, satz: 'Das Bild ' + thumbnail.dateiname + ' ist keine regulaere ' +
      'Datei mehr.' };
  }
  if (st.size > THUMBNAIL_MAX_BYTES) {
    return { ok: false, satz: 'Das Bild ' + thumbnail.dateiname + ' hat jetzt ' + st.size +
      ' Bytes; der Aufruf nimmt hoechstens ' + THUMBNAIL_MAX_BYTES + ' (2 MiB, Vertrag ' +
      '2.10).' };
  }
  const gemessen = U.sha256Datei(voll);
  if (gemessen !== thumbnail.sha256) {
    return { ok: false, satz: 'Das Bild ' + thumbnail.dateiname + ' ist nicht mehr das, ' +
      'das beurteilt wurde: damals ' + String(thumbnail.sha256) + ', jetzt ' + gemessen +
      '. Der Compositor hat unter demselben Namen neu exportiert. Es geht so nicht weiter, ' +
      'bis ein Mensch das benannt hat (Vertrag 5.3). ' + folge };
  }
  const typ = bildtypVon(thumbnail.dateiname);
  if (typ === null) {
    return { ok: false, satz: 'Die Endung von ' + thumbnail.dateiname + ' gehoert zu keinem ' +
      'bekannten Bildtyp (Vertrag 2.10).' };
  }
  return { ok: true, satz: null, pfad: voll, bytes: st.size, sha256: gemessen, typ };
}

// ---------------------------------------------------------------------------
// DER LAUF (Vertrag 4, Schritte 10 bis 13)
// ---------------------------------------------------------------------------
//
// `kanal` ist INJIZIERT: im scharfen Lauf das gezaehlte Objekt aus
// longform-kanal.baueEchtenKanal(), im Test der Doppelgaenger -- durch
// dasselbe zaehlenderKanal() hindurch. Der Ablauf drumherum ist derselbe, und
// genau der wird geprueft. Dieselbe Bauart wie fuehreUploadsAus() im
// Shorts-Uploader, und aus demselben Grund.
//
// `schlafe` ist ebenfalls injiziert: das Warten dauert im Ernstfall bis zu 45
// Minuten, und ein Test, der das aussitzt, ist kein Test.
//
// GESCHRIEBEN WIRD NACH JEDEM SCHREIBENDEN AUFRUF UND NACH JEDER AENDERUNG DES
// VERARBEITUNGSSTANDS (5.2), und zwar BEVOR der naechste Schritt beginnt. Ein
// Gedaechtnis, das einen Upload vergisst, waere der Fehler, den es verhindern
// soll -- darum steht das Schreiben nach Aufruf 1 sogar VOR der Pruefung der
// Antwort: eine Antwort, die nicht gefaellt, aendert nichts daran, dass ein
// Video oben liegt.
async function fuehreLongformLauf({
  befund, kanal, projektwurzel, ermaechtigung, exportOrdner,
  jetzt = () => Date.now(), schlafe, melde = () => {},
  wartegrenzeMs = WARTEGRENZE_MS, abfrageabstandMs = ABFRAGEABSTAND_MS,
}) {
  if (typeof schlafe !== 'function') {
    throw new TypeError('fuehreLongformLauf braucht eine schlafe()-Funktion. Das Warten ' +
      'dauert bis zu 45 Minuten; ein eingebautes setTimeout waere im Test nicht zu ' +
      'umgehen und der Test damit keiner.');
  }
  const gPfad = G.gedaechtnisPfad(projektwurzel, befund.aufnahme);
  const vorhandenes = befund.gedaechtnis && befund.gedaechtnis.vorhanden
    ? befund.gedaechtnis.gedaechtnisObjekt : null;
  let g = vorhandenes || G.neuesGedaechtnis({
    aufnahme: befund.aufnahme, video: befund.video, jetzt: jetzt(),
  });
  let eintrag = G.schonHochgeladen(g, befund.video.sha256);

  const nein = (code, satz) => ({
    ok: false, abbruch: { code, satz }, eintrag, gedaechtnis: g, pfad: gPfad,
  });

  // -------------------------------------------------------------------------
  // AUFRUF 1 -- videos.insert (Vertrag 4, Schritt 10)
  // -------------------------------------------------------------------------
  if (!eintrag) {
    if (!befund.metadaten) {
      return nein('keine_metadaten', 'Es gibt keinen Titel und keine Beschreibung. Ohne sie ' +
        'wird nichts hochgeladen.');
    }
    const t = thumbnailEintrag(befund);
    if (!t) {
      return nein('kein_thumbnail_eintrag', 'Dieser Lauf hat kein Bild bestimmt.');
    }
    melde('Aufruf 1 von 2 (' + K.SCHREIBENDE_AUFRUFE[0] + '): ' + befund.video.dateiname +
      ' (' + befund.video.bytes + ' Bytes) geht PRIVAT auf den Kanal.');
    melde('  Titel: ' + befund.metadaten.titel);
    melde('  Ohne Termin, ohne Vorausveroeffentlichung, mit Benachrichtigung der ' +
      'Abonnenten (Vertrag 2.14).');

    let antwort;
    try {
      antwort = await kanal.ladeVideoHoch({
        pfad: befund.video.pfad,
        titel: befund.metadaten.titel,
        beschreibung: befund.metadaten.beschreibung,
        tags: befund.metadaten.tags,
        veroeffentlichung: befund.metadaten.veroeffentlichung,
      });
    } catch (e) {
      // DER GEFAEHRLICHSTE AUSGANG DIESES WEGES, UND ER WIRD ALS SOLCHER
      // GEMELDET. Ein Fehler beim Upload kann heissen, dass nichts angekommen
      // ist -- oder dass etwas angekommen ist und die Antwort verlorenging.
      // Das Gedaechtnis kann das nicht wissen; ein Mensch schon.
      return nein('upload_fehlgeschlagen',
        'Der Upload ist mit einem Fehler abgebrochen: ' + (e && e.message ? e.message : e) +
        ' ES IST NICHT SICHER, OB DAS VIDEO ANGEKOMMEN IST. Im Studio nachsehen, BEVOR ' +
        'dieser Lauf neu gestartet wird -- das Gedaechtnis traegt keine Kennung, und ein ' +
        'neuer Lauf wuerde darum von vorn anfangen.');
    }

    if (!antwort || typeof antwort.videoId !== 'string' || !antwort.videoId) {
      return nein('upload_ohne_kennung',
        'Der Upload hat keine Kennung zurueckgegeben. Der Lauf bricht ab. Ob das Video ' +
        'angekommen ist, muss im Studio nachgesehen werden, BEVOR neu gestartet wird ' +
        '(Vertrag 4, Schritt 10).');
    }

    const wann = new Date(jetzt()).toISOString();
    eintrag = {
      sha256: befund.video.sha256,
      videoId: antwort.videoId,
      hochgeladen_am: wann,
      titel: befund.metadaten.titel,
      tags: befund.metadaten.tags,
      // Der Text selbst steht NICHT im Gedaechtnis (5.2): die Vorlage kann
      // sich aendern, und DY hat gezeigt, dass die Antwort der API der Beleg
      // ist. Die Pruefsumme sagt trotzdem, ob zwei Laeufe dasselbe geschickt
      // haben.
      beschreibung_sha256: U.sha256Text(befund.metadaten.beschreibung),
      ermaechtigung_upload: ermaechtigung
        ? { zufall: ermaechtigung.zufall, erstellt_am: ermaechtigung.erstellt_am }
        : null,
      thumbnail: t,
      verarbeitung: null,
      thumbnail_gesetzt_am: null,
      rueckgelesen: null,
      stand: 'hochgeladen',
    };
    g.uploads.push(eintrag);
    G.schreibeGedaechtnis(gPfad, g, jetzt());
    melde('HOCHGELADEN: Kennung ' + eintrag.videoId + '. Gedaechtnis geschrieben: ' + gPfad);

    // ERST JETZT die Antwort pruefen -- das Gedaechtnis steht schon.
    const p = antwort.privacyStatus || { da: false, wert: null };
    if (!p.da) {
      melde('  ACHTUNG: die Antwort nennt keinen privacyStatus. Das ist kein "privat", ' +
        'sondern eine fehlende Auskunft.');
    } else {
      melde('  privacyStatus laut Antwort: ' + String(p.wert));
    }
    if (p.da && p.wert !== K.PRIVACY_STATUS) {
      return nein('privacy_nicht_privat',
        'YouTube meldet privacyStatus ' + JSON.stringify(p.wert) + ' statt ' +
        JSON.stringify(K.PRIVACY_STATUS) + '. SOFORT IM STUDIO NACHSEHEN. Der Lauf bricht ' +
        'hier ab und macht nichts weiter -- korrigieren kann dieser Bau es nicht: der ' +
        'Aufruf, der einen Zustand aendert, gehoert zum Oeffentlichstellen und ist nicht ' +
        'gebaut (Vertrag 2.5, 7).');
    }
  } else {
    melde('Kein Upload: dieses Video steht schon im Gedaechtnis (Kennung ' + eintrag.videoId +
      ', hochgeladen am ' + eintrag.hochgeladen_am + ', Stand ' + eintrag.stand + '). ' +
      'Es entsteht KEIN zweites.');
  }

  // -------------------------------------------------------------------------
  // DAS WARTEN (Vertrag 4, Schritt 11; 2.3)
  // -------------------------------------------------------------------------
  if (eintrag.stand === 'hochgeladen' || eintrag.stand === 'verarbeitung_abgebrochen') {
    const zweiterAnlauf = eintrag.stand === 'verarbeitung_abgebrochen';
    if (zweiterAnlauf) {
      // Der Vermerk, dass es der zweite Anlauf ist (5.3). Er zaehlt hoch statt
      // ein Ja zu setzen: beim dritten steht dann eine 3 und nicht wieder ein
      // Ja, das nichts mehr unterscheidet.
      eintrag.anlaeufe = (typeof eintrag.anlaeufe === 'number' ? eintrag.anlaeufe : 1) + 1;
      eintrag.stand = 'hochgeladen';
    }
    const frist = jetzt() + wartegrenzeMs;
    melde('Warten auf die Verarbeitung, hoechstens ' + (wartegrenzeMs / 60000) + ' Minuten ' +
      '(Vertrag 2.3)' + (zweiterAnlauf ? ' -- Anlauf ' + eintrag.anlaeufe + ', mit einer ' +
      'NEUEN Frist ab jetzt' : '') + '.');

    let vorher = eintrag.verarbeitung ? kurzfassung(eintrag.verarbeitung) : null;
    let abfragen = (eintrag.verarbeitung && typeof eintrag.verarbeitung.abfragen === 'number')
      ? eintrag.verarbeitung.abfragen : 0;
    let nieGemeldet = true;

    for (;;) {
      let a;
      try {
        a = await kanal.liesVerarbeitung({ videoId: eintrag.videoId });
      } catch (e) {
        return nein('verarbeitung_nicht_lesbar',
          ersterSatz(eintrag) + ' Der Verarbeitungsstand liess sich nicht lesen: ' +
          (e && e.message ? e.message : e) + ' Der Lauf bricht ab; das Video bleibt privat ' +
          'auf dem Kanal. Ein neuer Lauf setzt hier wieder an (Vertrag 5.3).');
      }
      abfragen++;
      eintrag.verarbeitung = verarbeitungsstand(a, abfragen, jetzt());
      const jetztKurz = kurzfassung(eintrag.verarbeitung);
      if (jetztKurz !== vorher) {
        vorher = jetztKurz;
        G.schreibeGedaechtnis(gPfad, g, jetzt());
        melde('  ' + jetztKurz);
      }

      // uploadStatus ZUERST (2.3): ist er rejected oder failed, wird nicht
      // weiter gewartet.
      const us = a.uploadStatus;
      if (us.da && UPLOAD_ENDE_SCHLECHT.includes(us.wert)) {
        eintrag.stand = 'abgelehnt';
        G.schreibeGedaechtnis(gPfad, g, jetzt());
        return nein('upload_abgelehnt',
          ersterSatz(eintrag) + ' YouTube meldet uploadStatus ' + JSON.stringify(us.wert) +
          '. ' + gruendeSatz(a) + ' Es wird nicht weiter gewartet und kein Thumbnail ' +
          'gesetzt. Das Video bleibt privat auf dem Kanal.');
      }

      const ps = a.processingStatus;
      if (ps.da) {
        nieGemeldet = false;
        if (ps.wert === PROCESSING_FERTIG) {
          eintrag.stand = 'verarbeitet';
          G.schreibeGedaechtnis(gPfad, g, jetzt());
          melde('  Verarbeitung abgeschlossen (' + PROCESSING_FERTIG + ') nach ' + abfragen +
            ' Abfrage(n).');
          break;
        }
        if (ps.wert === PROCESSING_FEHLGESCHLAGEN) {
          eintrag.stand = 'abgelehnt';
          G.schreibeGedaechtnis(gPfad, g, jetzt());
          return nein('verarbeitung_fehlgeschlagen',
            ersterSatz(eintrag) + ' YouTube meldet processingStatus ' +
            JSON.stringify(PROCESSING_FEHLGESCHLAGEN) + '. ' + gruendeSatz(a) +
            ' Es wird kein Thumbnail gesetzt. Das Video bleibt privat auf dem Kanal.');
        }
        if (ps.wert === PROCESSING_TERMINIERT) {
          eintrag.stand = 'verarbeitung_abgebrochen';
          eintrag.verarbeitung.abgebrochen_am = new Date(jetzt()).toISOString();
          G.schreibeGedaechtnis(gPfad, g, jetzt());
          return nein('verarbeitung_terminated',
            ersterSatz(eintrag) + ' YouTube meldet processingStatus ' +
            JSON.stringify(PROCESSING_TERMINIERT) + ': die Verarbeitungsinformation ist ' +
            'nicht mehr verfuegbar. Das ist ein Endzustand und kein Zwischenstand (Vertrag ' +
            '2.3) -- ein Weiterwarten wartete auf nichts. Das Video bleibt privat auf dem ' +
            'Kanal. Auch ein neuer Lauf wartet darauf nicht noch einmal.');
        }
        // 'processing' und jeder unbekannte Wert: weiter warten. Ein
        // unbekannter Wert wird MITGEZAEHLT und steht in der Meldung -- er
        // wird nicht wie 'processing' behandelt, ohne dass es jemand sieht.
        if (ps.wert !== PROCESSING_LAEUFT) {
          melde('  YouTube meldet einen processingStatus, den dieser Bau nicht kennt: ' +
            JSON.stringify(ps.wert) + '. Es wird weiter gewartet, bis die Frist um ist -- ' +
            'ein unbekannter Wert wird nicht fuer "fertig" genommen.');
        }
      }

      if (jetzt() >= frist) {
        eintrag.stand = 'verarbeitung_abgebrochen';
        eintrag.verarbeitung.abgebrochen_am = new Date(jetzt()).toISOString();
        G.schreibeGedaechtnis(gPfad, g, jetzt());
        return nein('verarbeitung_zu_lang',
          ersterSatz(eintrag) + ' Die ' + (wartegrenzeMs / 60000) + ' Minuten sind um, ohne ' +
          'dass YouTube die Verarbeitung abgeschlossen gemeldet hat (' + abfragen +
          ' Abfragen). ' + (nieGemeldet
            ? 'YOUTUBE HAT NIE EINEN VERARBEITUNGSSTAND GEMELDET -- das Feld fehlte in jeder ' +
              'Antwort. '
            : 'Zuletzt: ' + kurzfassung(eintrag.verarbeitung) + '. ') +
          'Das Video bleibt privat auf dem Kanal, kein Thumbnail ist gesetzt. Ein neuer ' +
          'Lauf wartet noch einmal, mit einer neuen Frist (Vertrag 5.3).');
      }
      await schlafe(abfrageabstandMs);
    }
  }

  // -------------------------------------------------------------------------
  // AUFRUF 2 -- thumbnails.set (Vertrag 4, Schritt 12; 2.10)
  // -------------------------------------------------------------------------
  if (eintrag.stand !== 'verarbeitet' && eintrag.stand !== 'thumbnail_gesetzt') {
    return nein('stand_ohne_fortsetzung',
      ersterSatz(eintrag) + ' Der Stand ist ' + JSON.stringify(eintrag.stand) + '; dieser ' +
      'Bau macht damit nichts.');
  }

  if (eintrag.stand === 'verarbeitet') {
    const ziel = pruefeThumbnailZiel(eintrag, eintrag.videoId);
    if (!ziel.ok) return nein('thumbnail_ziel', ersterSatz(eintrag) + ' ' + ziel.satz);

    const bp = pruefeBildAufDerPlatte(exportOrdner, eintrag.thumbnail);
    if (!bp.ok) {
      return nein('thumbnail_bild', ersterSatz(eintrag) + ' ' + bp.satz);
    }

    melde('Aufruf 2 von 2 (' + K.SCHREIBENDE_AUFRUFE[1] + '): ' + eintrag.thumbnail.dateiname +
      ' (' + bp.bytes + ' Bytes, ' + bp.typ + ') an ' + eintrag.videoId + '.');
    try {
      await kanal.setzeThumbnail({
        videoId: eintrag.videoId, pfad: bp.pfad, mimeType: bp.typ,
      });
    } catch (e) {
      return nein('thumbnail_fehlgeschlagen',
        ersterSatz(eintrag) + ' Das Thumbnail liess sich nicht setzen: ' +
        (e && e.message ? e.message : e) + ' Das Video liegt PRIVAT auf dem Kanal, und das ' +
        'BILD FEHLT. Es wird nicht oeffentlich gestellt. Ein neuer Lauf wiederholt diesen ' +
        'Aufruf (Vertrag 2.10, 5.3).');
    }
    eintrag.thumbnail_gesetzt_am = new Date(jetzt()).toISOString();
    G.schreibeGedaechtnis(gPfad, g, jetzt());
    melde('  Gesetzt. Gedaechtnis geschrieben.');
  }

  // -------------------------------------------------------------------------
  // SCHRITT 13 -- zuruecklesen, was wirklich dranhaengt (2.4, 2.10)
  // -------------------------------------------------------------------------
  let zurueck;
  try {
    zurueck = await kanal.liesVideoVoll({ videoId: eintrag.videoId });
  } catch (e) {
    return nein('rueckleseantwort_fehlt',
      ersterSatz(eintrag) + ' Das Zuruecklesen ist fehlgeschlagen: ' +
      (e && e.message ? e.message : e) + ' Das Bild ist gesetzt, aber es steht nicht fest, ' +
      'WAS am Video haengt -- und genau dafuer ist dieser Schritt da (Vertrag 2.4). Das ' +
      'Video bleibt privat.');
  }
  eintrag.rueckgelesen = {
    gefunden: zurueck.gefunden,
    thumbnails: (zurueck.snippet && zurueck.snippet.thumbnails) || null,
    titel: (zurueck.snippet && zurueck.snippet.title) || null,
    // EU: DIE PRUEFSUMME DER BESCHREIBUNG, WIE YOUTUBE SIE ZURUECKGIBT.
    //
    // Der TEXT steht hier nicht -- Vertrag 5.2 verbietet ihn im Gedaechtnis
    // ausdruecklich, und eine Pruefsumme ist kein Wortlaut. Sie ist trotzdem
    // da, und zwar fuer genau eine Frage: hat jemand die Beschreibung im
    // Studio geaendert, seit ein Mensch sie beurteilt hat? Der Vergleich
    // laeuft dann YouTube-damals gegen YouTube-jetzt und nicht gegen den
    // gesendeten Text -- eine Normalisierung der API faellt damit nicht als
    // Aenderung auf, eine Aenderung schon.
    beschreibung_sha256: (zurueck.snippet && typeof zurueck.snippet.description === 'string')
      ? U.sha256Text(zurueck.snippet.description) : null,
    // Die Rohobjekte gehen MIT (5.2, "die Thumbnail-URLs und der Status").
    // Was YouTube sonst noch meldet, landet damit im Gedaechtnis, statt hier
    // lautlos zu verschwinden.
    status: zurueck.status,
    processingDetails: zurueck.processingDetails,
    gelesen_am: new Date(jetzt()).toISOString(),
  };
  eintrag.stand = 'thumbnail_gesetzt';
  G.schreibeGedaechtnis(gPfad, g, jetzt());

  return { ok: true, abbruch: null, eintrag, gedaechtnis: g, pfad: gPfad, zurueck };
}

// ---------------------------------------------------------------------------
// EU: DER DRITTE AUFRUF (Vertrag 4, Schritt 16; 2.5)
// ---------------------------------------------------------------------------
//
// HIER GESCHIEHT DAS, WAS SICH NICHT ZURUECKNEHMEN LAESST. EP hat den Schritt
// gebaut, den man zurueckziehen kann -- ein privates Video laesst sich im
// Studio loeschen, und niemand hat es gesehen. Dieser hier ist der andere.
//
// DIE REIHENFOLGE IST DIE GANZE SACHE, und sie steht darum hier oben:
//
//   1. KONTROLLBLICK    videos.list mit part=snippet,status,processingDetails
//                       -- derselbe Aufruf, den Schritt 13 macht (geliehen,
//                       nicht nachgebaut). Er beantwortet die Frage, die die
//                       Ermaechtigung nicht beantworten kann: hat sich das
//                       Video seit dem Urteil geaendert? Titel und
//                       Beschreibung stehen dort, und nur dort.
//   2. DAS URTEIL       Titel gegen Titel, Pruefsumme gegen Pruefsumme, Bild
//                       gegen die Platte. Jeder Fall mit eigener Meldung.
//   3. DER STATUSBLOCK  videos.list mit part=status, WOERTLICH und
//                       unmittelbar vor dem Update (2.5 Punkt 1). Zwischen ihm
//                       und dem Aufruf liegt nur noch das Bauen des Koerpers.
//   4. DER KOERPER      aus baueStatusKoerper(), der einen Stelle. Was dabei
//                       fehlt, wird BENANNT und nicht erraten.
//   5. DER VERMERK      ins Gedaechtnis, VOR dem Aufruf. Siehe unten.
//   6. DER AUFRUF       videos.update, part=status. Einmal, nie zweimal.
//   7. DIE ANTWORT      geschrieben, dann geprueft -- in dieser Reihenfolge.
//
// WARUM ZWEI LESENDE AUFRUFE UND NICHT EINER. Vertrag 2.5 verlangt
// `part=status` unmittelbar vor dem Update, woertlich. Der Kontrollblick
// braucht `snippet`. Beides in einen Aufruf zu legen hiesse, von 2.5
// abzuweichen; den Statusblock aus dem Kontrollblick zu nehmen hiesse, einen
// aelteren Stand zu senden als den, den der Vertrag verlangt. Der Preis sind
// zwei Kontingenteinheiten statt einer, und er wird gesagt.
//
// WARUM DER VERMERK VOR DEM AUFRUF STEHT. Das ist die Antwort auf den Abbruch
// in der Mitte, und sie ist die einzige, die traegt. Stirbt der Prozess
// zwischen dem Aufruf und dem Schreiben der Antwort, weiss hinterher niemand,
// ob YouTube das Video oeffentlich gestellt hat. Ein Gedaechtnis, das dann
// aussieht wie "noch nicht angefangen", fuehrt beim naechsten Lauf zu einem
// ZWEITEN videos.update -- und Vertrag 7 verbietet das ausdruecklich, aus
// gutem Grund: der zweite schickt einen Statusblock, der inzwischen ein
// anderer sein kann, an ein Video, das schon oeffentlich ist. Der Vermerk
// macht aus dieser Lage einen sichtbaren Befund: der naechste Lauf bricht ab
// und sagt einem Menschen, dass er im Studio nachsehen muss.
//
// WAS DIESER LAUF NICHT TUT, in keinem Ausgang: kein videos.delete, kein
// Zuruecksetzen auf privat, kein zweites Update, kein Aufraeumen. Geht etwas
// schief, wird es gemeldet, nicht repariert (Vertrag 7).
async function fuehreOeffentlichLauf({
  befund, kanal, projektwurzel, exportOrdner, ermaechtigung,
  jetzt = () => Date.now(), melde = () => {},
}) {
  const gPfad = G.gedaechtnisPfad(projektwurzel, befund.aufnahme);
  const g = befund.gedaechtnis && befund.gedaechtnis.vorhanden
    ? befund.gedaechtnis.gedaechtnisObjekt : null;
  const eintrag = g ? G.schonHochgeladen(g, befund.video.sha256) : null;

  const nein = (code, satz) => ({
    ok: false, abbruch: { code, satz }, eintrag, gedaechtnis: g, pfad: gPfad,
  });

  // DIE DREI VORAUSSETZUNGEN, noch einmal und hier. Sie stehen schon in
  // zweiteBindung(), und sie stehen trotzdem hier: diese Funktion macht den
  // Aufruf, und was der Aufruf voraussetzt, prueft der, der ihn macht. Eine
  // Voraussetzung, die nur der Aufrufer prueft, ist eine Erwartung.
  if (!eintrag) {
    return nein('kein_eintrag', 'Es gibt fuer diese Videodatei keinen Gedaechtniseintrag. Es ' +
      'wird nichts oeffentlich gestellt -- die Kennung des Videos kommt ausschliesslich aus ' +
      'dem Gedaechtnis dieses Laufs (Vertrag 2.5 Punkt 2).');
  }
  if (eintrag.oeffentlich_versuch) {
    return nein('oeffentlich_versuch_offen', ersterSatz(eintrag) + ' Fuer dieses Video ist ' +
      'der dritte Aufruf schon einmal BEGONNEN worden (am ' +
      String(eintrag.oeffentlich_versuch.begonnen_am) + '). Ob er durchkam, weiss dieses ' +
      'Gedaechtnis nicht. Es wird KEIN zweiter ' + K.SCHREIBENDE_AUFRUFE[2] + ' gemacht ' +
      '(Vertrag 7). Im Studio ' +
      'nachsehen.');
  }
  if (eintrag.stand !== 'thumbnail_gesetzt') {
    return nein('stand_nicht_bereit', ersterSatz(eintrag) + ' Der Stand ist ' +
      JSON.stringify(eintrag.stand) + '. Oeffentlich gestellt wird nur ein Video, an dem ' +
      'das Thumbnail haengt und das zurueckgelesen ist (Vertrag 2.4, 5.3).');
  }

  const haltepunkt = ermaechtigung.zweck === G.ZWECK_HALTEPUNKT;
  const urteil = ermaechtigung.urteil;

  // -------------------------------------------------------------------------
  // 1. DER KONTROLLBLICK
  // -------------------------------------------------------------------------
  melde('');
  melde('KONTROLLBLICK (' + K.LESENDE_AUFRUFE[1] + ', part=snippet,status,processingDetails): ' +
    'hat sich das Video seit dem Urteil geaendert?');
  let jetztAmVideo;
  try {
    jetztAmVideo = await kanal.liesVideoVoll({ videoId: eintrag.videoId });
  } catch (e) {
    return nein('kontrollblick_fehlgeschlagen', ersterSatz(eintrag) + ' Das Video liess sich ' +
      'nicht lesen: ' + (e && e.message ? e.message : e) + ' Solange nicht feststeht, was ' +
      'gerade an ihm haengt, wird es nicht oeffentlich gestellt. Es wurde NICHTS geaendert.');
  }
  if (!jetztAmVideo.gefunden) {
    return nein('video_nicht_gefunden', ersterSatz(eintrag) + ' YouTube liefert zu dieser ' +
      'Kennung KEIN Video zurueck. Entweder ist es geloescht worden, oder der angemeldete ' +
      'Zugang sieht es nicht. Es wird nichts oeffentlich gestellt.');
  }

  // -------------------------------------------------------------------------
  // 2. DAS URTEIL -- jeder Fall mit eigener Meldung
  // -------------------------------------------------------------------------
  const titelJetzt = (jetztAmVideo.snippet && typeof jetztAmVideo.snippet.title === 'string')
    ? jetztAmVideo.snippet.title : null;
  if (titelJetzt === null) {
    return nein('urteil_titel_fehlt', ersterSatz(eintrag) + ' YouTube nennt jetzt KEINEN ' +
      'Titel fuer dieses Video. Beurteilt wurde eines mit dem Titel ' +
      JSON.stringify(urteil.titel) + '. Eine fehlende Auskunft ist keine Bestaetigung -- es ' +
      'wird nichts oeffentlich gestellt.');
  }
  if (titelJetzt !== urteil.titel) {
    return nein('urteil_titel', ersterSatz(eintrag) + ' DER TITEL HAT SICH SEIT DEM URTEIL ' +
      'GEAENDERT. Beurteilt wurde ' + JSON.stringify(urteil.titel) + ', YouTube nennt jetzt ' +
      JSON.stringify(titelJetzt) + '. Der Titel ist das, was unter einem oeffentlichen Video ' +
      'steht; ein anderer Titel ist ein anderes Video, als der Mensch freigegeben hat. Es ' +
      'wird nichts oeffentlich gestellt. Wer den neuen Titel will, startet den Dienst neu ' +
      'und urteilt ueber ihn.');
  }
  melde('  Titel: unveraendert seit dem Urteil.');

  const beschreibungJetzt = (jetztAmVideo.snippet &&
    typeof jetztAmVideo.snippet.description === 'string')
    ? U.sha256Text(jetztAmVideo.snippet.description) : null;
  if (urteil.beschreibung_sha256 === null) {
    melde('  Beschreibung: NICHT VERGLEICHBAR -- beim Zuruecklesen ist keine Pruefsumme ' +
      'entstanden. Ob sie sich seit dem Urteil geaendert hat, sagt dieser Lauf nicht.');
  } else if (beschreibungJetzt === null) {
    melde('  Beschreibung: YouTube gibt jetzt KEINE zurueck. Das ist eine fehlende Auskunft ' +
      'und kein Beleg dafuer, dass sie unveraendert ist.');
  } else if (beschreibungJetzt !== urteil.beschreibung_sha256) {
    // LAUT, ABER KEIN ABBRUCH -- und der Grund steht dabei. Anders als beim
    // Titel ist hier nicht gemessen, ob die API den Text unveraendert
    // zurueckgibt (Vertrag 10). Ein Abbruch auf einer ungemessenen
    // Gleichheitsannahme machte den Weg unbenutzbar; ein stiller Durchgang
    // machte die Aenderung unsichtbar. Also: laut.
    melde('  ACHTUNG -- DIE BESCHREIBUNG HAT SICH SEIT DEM URTEIL GEAENDERT. Beim Urteil ' +
      'hatte sie die Pruefsumme ' + urteil.beschreibung_sha256 + ', jetzt hat sie ' +
      beschreibungJetzt + '. Dieser Lauf bricht deswegen NICHT ab: ob die API den Text ' +
      'immer unveraendert zurueckgibt, ist nicht gemessen (Vertrag 10). Was unter dem Video ' +
      'steht, ist im Studio nachzusehen.');
  } else {
    melde('  Beschreibung: unveraendert seit dem Urteil (Pruefsumme gleich).');
  }

  // Die Befunde von YouTube, jetzt. Sie sind die letzte Gelegenheit, ein Video
  // stehenzulassen, an dem etwas nicht stimmt.
  const usJetzt = jetztAmVideo.uploadStatus;
  if (usJetzt.da && UPLOAD_ENDE_SCHLECHT.includes(usJetzt.wert)) {
    return nein('jetzt_abgelehnt', ersterSatz(eintrag) + ' YouTube meldet JETZT uploadStatus ' +
      JSON.stringify(usJetzt.wert) + '. ' + gruendeSatz(jetztAmVideo) + ' Ein abgelehntes ' +
      'oder fehlgeschlagenes Video wird nicht oeffentlich gestellt.');
  }
  const psJetzt = jetztAmVideo.processingStatus;
  if (psJetzt.da && (psJetzt.wert === PROCESSING_FEHLGESCHLAGEN ||
      psJetzt.wert === PROCESSING_TERMINIERT)) {
    return nein('jetzt_verarbeitung_schlecht', ersterSatz(eintrag) + ' YouTube meldet JETZT ' +
      'processingStatus ' + JSON.stringify(psJetzt.wert) + '. ' + gruendeSatz(jetztAmVideo) +
      ' Es wird nichts oeffentlich gestellt.');
  }
  melde('  YouTube meldet: ' + gruendeSatz(jetztAmVideo));

  // -------------------------------------------------------------------------
  // 3. DAS BILD, NOCH EINMAL GEGEN DIE PLATTE
  // -------------------------------------------------------------------------
  //
  // Dieselbe Funktion wie vor Aufruf 2, mit einem anderen Folgesatz: das Bild
  // haengt bereits am Video, weg ist hier nur der BELEG dafuer, welches es
  // war. Ein Compositor-Export unter demselben Namen in den Minuten zwischen
  // Urteil und Klick ist der Fall, den das faengt.
  const bp = pruefeBildAufDerPlatte(exportOrdner, urteil.thumbnail,
    'Das Bild haengt bereits am Video; verloren ist der Beleg, WELCHES es war. Es wird ' +
    'nichts oeffentlich gestellt, bis ein Mensch das benannt hat.');
  if (!bp.ok) {
    return nein('urteil_bild', ersterSatz(eintrag) + ' DAS THUMBNAIL AUF DER PLATTE HAT SICH ' +
      'SEIT DEM URTEIL GEAENDERT. ' + bp.satz);
  }
  melde('  Thumbnail auf der Platte: unveraendert seit dem Urteil (' +
    urteil.thumbnail.dateiname + ', sha256 ' + urteil.thumbnail.sha256 + ').');

  // -------------------------------------------------------------------------
  // 4. DER STATUSBLOCK -- unmittelbar vor dem Aufruf (2.5 Punkt 1)
  // -------------------------------------------------------------------------
  melde('');
  melde('DER STATUSBLOCK (' + K.LESENDE_AUFRUFE[1] + ', part=status), unmittelbar vor dem ' +
    'Aufruf. Er geht VOLLSTAENDIG zurueck -- was im Koerper fehlt, wird geloescht ' +
    '(Vertrag 2.5).');
  let gelesen;
  try {
    gelesen = await kanal.liesStatus({ videoId: eintrag.videoId });
  } catch (e) {
    return nein('statusblock_nicht_lesbar', ersterSatz(eintrag) + ' Der Statusblock liess ' +
      'sich nicht lesen: ' + (e && e.message ? e.message : e) + ' Ohne ihn gibt es keinen ' +
      'vollstaendigen Anfragekoerper, und ein unvollstaendiger loescht Felder. Es wurde ' +
      'NICHTS geaendert.');
  }
  if (!gelesen.gefunden || !gelesen.status) {
    return nein('statusblock_fehlt', ersterSatz(eintrag) + ' Die Abfrage mit part=status ' +
      'liefert keinen Statusblock zurueck (gefunden: ' + String(gelesen.gefunden) + '). Ohne ' +
      'ihn wird nichts gesendet: ein Koerper aus dem Nichts loescht jedes veraenderbare ' +
      'Feld des Teils status.');
  }
  for (const name of Object.keys(gelesen.status)) {
    melde('    gelesen: ' + name + ' = ' + JSON.stringify(gelesen.status[name]));
  }

  // -------------------------------------------------------------------------
  // 5. DER KOERPER
  // -------------------------------------------------------------------------
  const gebaut = K.baueStatusKoerper({ videoId: eintrag.videoId, status: gelesen.status });
  if (!gebaut.ok) {
    return nein('koerper_nicht_baubar', ersterSatz(eintrag) + ' Der Anfragekoerper liess sich ' +
      'nicht bauen: ' + gebaut.grund + ' Es wurde NICHTS gesendet.');
  }

  // DER TERMIN. Er wird nie gesendet (Vertrag 7) -- steht er im gelesenen
  // Block, hat ihn jemand anders gesetzt, und dann ist dieses Video ein
  // terminiertes. Es jetzt von Hand oeffentlich zu stellen waere eine andere
  // Handlung als die, ueber die geurteilt wurde.
  if (gebaut.termin.da) {
    return nein('termin_im_statusblock', ersterSatz(eintrag) + ' DER STATUSBLOCK TRAEGT ' +
      'EINEN VEROEFFENTLICHUNGSTERMIN (' + K.STATUS_FELDER_NIE[0] + ': ' +
      JSON.stringify(gebaut.termin.wert) + '). Dieser Weg setzt nie einen; er stammt also ' +
      'nicht von hier. Ein terminiertes Video wird nicht von Hand oeffentlich gestellt -- ' +
      'das waere eine andere Handlung als die, ueber die geurteilt wurde, und die ' +
      'Dokumentation nennt einen Termin neben "public" ausserdem einen Fehler ' +
      '(invalidPublishAt, 400). Es wurde NICHTS gesendet.');
  }
  // Die Sichtbarkeit, aus dem FRISCHEN Block. Der Kontrollblick hat sie auch
  // gesehen; hier zaehlt der Stand von jetzt.
  if (!gebaut.gelesen_privacy.da) {
    return nein('privacy_fehlt_im_statusblock', ersterSatz(eintrag) + ' Der gelesene ' +
      'Statusblock nennt keinen ' + K.STATUS_FELD_PRIVACY + '. Dass das Video privat ist, ' +
      'steht damit nicht fest -- und dieser Weg stellt nur ein privates oeffentlich. Es ' +
      'wurde NICHTS gesendet.');
  }
  if (gebaut.gelesen_privacy.wert !== K.PRIVACY_STATUS) {
    return nein('nicht_mehr_privat', ersterSatz(eintrag) + ' Das Video ist laut Statusblock ' +
      'schon ' + JSON.stringify(gebaut.gelesen_privacy.wert) + ' und nicht ' +
      JSON.stringify(K.PRIVACY_STATUS) + '. Jemand anders hat die Sichtbarkeit geaendert. Es ' +
      'wird NICHTS gesendet und nichts zurueckgesetzt -- was mit diesem Video geschehen ' +
      'soll, entscheidet ein Mensch im Studio.');
  }

  melde('');
  melde('DER KOERPER, DER GESENDET WUERDE (part=status, ' + K.SCHREIBENDE_AUFRUFE[2] + '):');
  melde('    id: ' + JSON.stringify(gebaut.koerper.id));
  for (const name of Object.keys(gebaut.koerper.status)) {
    melde('    status.' + name + ' = ' + JSON.stringify(gebaut.koerper.status[name]) +
      (name === K.STATUS_FELD_PRIVACY ? '   <- das EINZIGE geaenderte Feld'
        : '   (unveraendert uebernommen)'));
  }
  melde('    ' + K.STATUS_FELDER_NIE[0] + ': NICHT im Koerper -- nie, in keinem Aufruf ' +
    '(Vertrag 7).');
  melde('    snippet: NICHT im Koerper und nicht im part. Titel, Beschreibung, Tags und ' +
    'Kategorie werden nicht angefasst (Vertrag 2.5, 7).');
  if (gebaut.verworfen.length) {
    melde('    Nur lesbare Felder des Blocks, die NICHT mitgehen (sie duerfen nicht): ' +
      gebaut.verworfen.join(', ') + '.');
  }
  if (gebaut.fehlend.length) {
    // DIE GEFAEHRLICHE LISTE, und sie wird als solche gesagt. Was YouTube
    // nicht gemeldet hat, kann dieser Bau nicht erhalten -- und laut
    // Dokumentation faellt es damit auf seine Vorgabe zurueck.
    melde('');
    melde('    ACHTUNG -- DIESE UEBERTRAGBAREN FELDER STANDEN NICHT IM GELESENEN BLOCK:');
    for (const name of gebaut.fehlend) melde('      ' + name);
    melde('    Was nicht gelesen wurde, kann nicht zurueckgeschickt werden. Laut ' +
      'Dokumentation faellt ein veraenderbares Feld des Teils status, das im Koerper fehlt, ' +
      'auf seine VORGABE zurueck (Vertrag 2.5). Dieser Bau erfindet dafuer keinen Wert -- ' +
      'ein erfundener waere derselbe Schaden mit besserem Gewissen. Nach dem Aufruf im ' +
      'Studio nachsehen, ob eine dieser Einstellungen anders steht als vorher.');
  } else {
    melde('    Alle uebertragbaren Felder standen im gelesenen Block und gehen unveraendert ' +
      'zurueck.');
  }

  // -------------------------------------------------------------------------
  // 6. DER HALTEPUNKT -- hier und nicht einen Schritt spaeter
  // -------------------------------------------------------------------------
  if (haltepunkt) {
    eintrag.haltepunkt = {
      angehalten_am: new Date(jetzt()).toISOString(),
      ermaechtigung: { zufall: ermaechtigung.zufall, erstellt_am: ermaechtigung.erstellt_am },
      status_gelesen: gelesen.status,
      koerper: gebaut.koerper,
      fehlend: gebaut.fehlend,
      verworfen: gebaut.verworfen,
    };
    G.schreibeGedaechtnis(gPfad, g, jetzt());
    return {
      ok: true, angehalten: true, abbruch: null,
      eintrag, gedaechtnis: g, pfad: gPfad, gebaut, gelesen: gelesen.status, antwort: null,
      abweichungen: [],
    };
  }

  // -------------------------------------------------------------------------
  // 7. DER VERMERK -- VOR dem Aufruf
  // -------------------------------------------------------------------------
  const begonnen = new Date(jetzt()).toISOString();
  eintrag.oeffentlich_versuch = {
    begonnen_am: begonnen,
    ermaechtigung: { zufall: ermaechtigung.zufall, erstellt_am: ermaechtigung.erstellt_am },
    status_gelesen: gelesen.status,
    koerper: gebaut.koerper,
    fehlend: gebaut.fehlend,
    verworfen: gebaut.verworfen,
    beendet: false,
  };
  G.schreibeGedaechtnis(gPfad, g, jetzt());
  melde('');
  melde('VERMERKT: der dritte Aufruf beginnt um ' + begonnen + '. Das Gedaechtnis traegt es ' +
    'JETZT, bevor der Aufruf hinausgeht -- stirbt dieser Prozess dazwischen, weiss der ' +
    'naechste Lauf, dass er nichts wiederholen darf.');
  melde('');
  melde('AUFRUF 3 (' + K.SCHREIBENDE_AUFRUFE[2] + '): ' + eintrag.videoId + ' wird ' +
    'OEFFENTLICH. Das laesst sich nicht zuruecknehmen.');

  // -------------------------------------------------------------------------
  // 8. DER AUFRUF
  // -------------------------------------------------------------------------
  let antwort;
  try {
    antwort = await kanal.stelleOeffentlich({
      videoId: eintrag.videoId, status: gelesen.status,
    });
  } catch (e) {
    // DER GEFAEHRLICHSTE AUSGANG, und er wird als solcher gemeldet. Der
    // Vermerk steht schon; das Gedaechtnis sagt danach "begonnen, nicht
    // beendet", und genau das ist die Wahrheit.
    eintrag.oeffentlich_versuch.fehler = String(e && e.message ? e.message : e);
    eintrag.oeffentlich_versuch.fehler_am = new Date(jetzt()).toISOString();
    G.schreibeGedaechtnis(gPfad, g, jetzt());
    return nein('update_fehlgeschlagen', ersterSatz(eintrag) + ' Der dritte Aufruf ist mit ' +
      'einem Fehler abgebrochen: ' + (e && e.message ? e.message : e) +
      ' ES IST NICHT SICHER, OB DAS VIDEO JETZT OEFFENTLICH IST. Der Aufruf ist hinausgegangen; ' +
      'was zurueckkam, war ein Fehler -- das kann heissen, dass nichts geschehen ist, oder ' +
      'dass die Antwort verlorenging. IM STUDIO NACHSEHEN, bevor irgendetwas weiter ' +
      'geschieht. Dieser Bau wiederholt den Aufruf NICHT und setzt nichts zurueck (Vertrag ' +
      '7); der Vermerk im Gedaechtnis laesst auch keinen zweiten Lauf weitermachen.');
  }

  // -------------------------------------------------------------------------
  // 9. GESCHRIEBEN, DANN GEPRUEFT
  // -------------------------------------------------------------------------
  const fertig = new Date(jetzt()).toISOString();
  eintrag.oeffentlich_versuch.beendet = true;
  eintrag.oeffentlich_versuch.beendet_am = fertig;
  eintrag.oeffentlich_am = fertig;
  eintrag.oeffentlich_privacystatus = antwort.privacyStatus && antwort.privacyStatus.da
    ? antwort.privacyStatus.wert : null;
  eintrag.oeffentlich_antwort_status = antwort.status || null;
  // DER STAND WECHSELT, SOBALD DER AUFRUF ZURUECKGEKOMMEN IST -- gleich was er
  // sagt. `oeffentlich` heisst in diesem Gedaechtnis "Aufruf 3 ist gemacht,
  // Finger weg" (Vertrag 5.3), und das gilt auch dann, wenn die Antwort nicht
  // gefaellt. Ein Stand, der bei einer unerwarteten Antwort auf
  // `thumbnail_gesetzt` stehenbliebe, liesse einen zweiten Lauf das Update
  // wiederholen -- genau das, was Vertrag 7 verbietet.
  eintrag.stand = 'oeffentlich';
  G.schreibeGedaechtnis(gPfad, g, jetzt());
  melde('');
  melde('DER AUFRUF IST ZURUECK. Gesendet um ' + begonnen + ', Antwort um ' + fertig +
    ' (' + (Date.parse(fertig) - Date.parse(begonnen)) + ' ms dazwischen). Gedaechtnis ' +
    'geschrieben: ' + gPfad);

  // DIE FALLE, IM SCHARFEN LAUF NACHGERECHNET -- UND ZWAR GEGEN DEN GELESENEN
  // BLOCK, NICHT GEGEN DEN GESENDETEN KOERPER.
  //
  // Der Unterschied ist die Luecke, die dieser Bau sonst haette. Der Koerper
  // traegt die Felder, die dieser Bau KENNT; der gelesene Block traegt, was
  // YouTube wirklich fuehrt. Meldet YouTube eines Tages ein setzbares Feld,
  // das STATUS_FELDER_UEBERTRAGEN nicht kennt, dann wird es hier als "nur
  // lesbar" verworfen -- und laut Dokumentation geloescht. Ein Vergleich, der
  // nur den Koerper kennt, saehe davon nichts: das Feld ging ja nie hinaus.
  //
  // Darum: JEDES Feld des gelesenen Blocks muss in der Antwort wieder da sein.
  // Fehlt eines, ist es die Falle, und der Lauf endet laut.
  //
  // DREI SORTEN, DREI FOLGEN:
  //   fehlt              -> Abbruch. Das ist der Schaden aus 2.5.
  //   uebertragen und
  //     anders           -> Abbruch. Wir haben genau diesen Wert geschickt.
  //   sonst anders       -> HINWEIS, kein Abbruch. Ein nur lesbares Feld
  //                        (uploadStatus etwa) darf sich zwischen zwei
  //                        Aufrufen aendern; das ist YouTubes Sache und kein
  //                        Verlust.
  const abweichungen = [];
  const hinweise = [];
  const zurueckStatus = (antwort.status && typeof antwort.status === 'object')
    ? antwort.status : null;
  if (!zurueckStatus) {
    abweichungen.push({ feld: null, satz: 'Die Antwort traegt keinen status-Block. Ob die ' +
      'Felder erhalten geblieben sind, laesst sich daran nicht ablesen.' });
  } else {
    for (const name of Object.keys(gelesen.status)) {
      const vorher = gelesen.status[name];
      const her = K.feld(zurueckStatus, name);
      if (!her.da) {
        abweichungen.push({ feld: name, satz: 'Das Feld ' + name + ' stand mit dem Wert ' +
          JSON.stringify(vorher) + ' im gelesenen Block und steht in der Antwort NICHT MEHR. ' +
          'Genau das ist die Falle aus Vertrag 2.5' +
          (gebaut.verworfen.includes(name)
            ? ' -- und dieses Feld ist von diesem Bau als "nur lesbar" verworfen worden. Ist ' +
              'es in Wahrheit setzbar, gehoert es in die Liste der uebertragbaren Felder ' +
              '(STATUS_FELDER_UEBERTRAGEN in src/upload/longform-kanal.js).'
            : '.') + ' Im Studio nachsehen.' });
        continue;
      }
      if (name === K.STATUS_FELD_PRIVACY) continue;   // der eine geaenderte Wert
      if (JSON.stringify(her.wert) === JSON.stringify(vorher)) continue;
      if (K.STATUS_FELDER_UEBERTRAGEN.includes(name)) {
        abweichungen.push({ feld: name, satz: 'Das Feld ' + name + ' ging mit ' +
          JSON.stringify(vorher) + ' hinaus und kam mit ' + JSON.stringify(her.wert) +
          ' zurueck.' });
      } else {
        hinweise.push('Das nur lesbare Feld ' + name + ' stand beim Lesen auf ' +
          JSON.stringify(vorher) + ' und in der Antwort auf ' + JSON.stringify(her.wert) +
          '. Das aendert YouTube selbst; dieser Aufruf hat es nicht geschickt.');
      }
    }
    for (const name of Object.keys(zurueckStatus)) {
      if (Object.prototype.hasOwnProperty.call(gelesen.status, name)) continue;
      hinweise.push('Das Feld ' + name + ' steht in der Antwort und stand nicht im gelesenen ' +
        'Block: ' + JSON.stringify(zurueckStatus[name]) + '.');
    }
  }
  eintrag.oeffentlich_abweichungen = abweichungen.map((a) => a.satz);
  eintrag.oeffentlich_hinweise = hinweise;
  G.schreibeGedaechtnis(gPfad, g, jetzt());
  for (const h of hinweise) melde('  Hinweis: ' + h);

  const p = antwort.privacyStatus || { da: false, wert: null };
  if (!p.da) {
    return nein('antwort_ohne_privacy', ersterSatz(eintrag) + ' Die Antwort auf den dritten ' +
      'Aufruf nennt KEINEN ' + K.STATUS_FELD_PRIVACY + '. Der Aufruf ist gemacht; ob das ' +
      'Video jetzt oeffentlich ist, sagt diese Antwort nicht. Das ist kein "nein", sondern ' +
      'eine fehlende Auskunft -- im Studio nachsehen. Es wird NICHTS korrigiert und kein ' +
      'zweites Update gemacht (Vertrag 7).');
  }
  if (p.wert !== K.PRIVACY_OEFFENTLICH) {
    return nein('antwort_nicht_oeffentlich', ersterSatz(eintrag) + ' YouTube meldet nach dem ' +
      'dritten Aufruf ' + K.STATUS_FELD_PRIVACY + ' ' + JSON.stringify(p.wert) + ' statt ' +
      JSON.stringify(K.PRIVACY_OEFFENTLICH) + '. SOFORT IM STUDIO NACHSEHEN. Der Lauf ist ' +
      'hier zu Ende und korrigiert nichts: ein zweiter ' + K.SCHREIBENDE_AUFRUFE[2] +
      ' ist kein Teil dieses ' +
      'Vertrags (2.5, 7).');
  }
  if (abweichungen.length) {
    return nein('felder_verloren', ersterSatz(eintrag) + ' Das Video ist OEFFENTLICH, aber ' +
      'die Antwort weicht vom gesendeten Koerper ab: ' +
      abweichungen.map((a) => a.satz).join(' ') + ' Der Lauf ist laut zu Ende. Er ' +
      'korrigiert nichts (Vertrag 7); was im Studio nachzustellen ist, stellt ein Mensch ' +
      'nach.');
  }

  return {
    ok: true, angehalten: false, abbruch: null,
    eintrag, gedaechtnis: g, pfad: gPfad, gebaut, gelesen: gelesen.status,
    antwort, abweichungen, jetztAmVideo,
  };
}

// Der Verarbeitungsstand, wie er ins Gedaechtnis geht (5.2). Jede der drei
// Gruende traegt "da" mit: abwesend und leer sind zwei Zustaende (2.3).
function verarbeitungsstand(a, abfragen, jetzt) {
  const s = {
    gefunden: a.gefunden,
    zuletzt_gelesen_am: new Date(jetzt).toISOString(),
    abfragen,
    abgebrochen_am: null,
  };
  for (const name of YOUTUBE_AUSKUENFTE) s[name] = a[name];
  return s;
}

// Eine Zeile, die den Stand zusammenfasst -- der Vergleich, an dem "hat sich
// etwas geaendert" haengt (Vertrag 4, Schritt 11). Sie steht als EINE Funktion
// da, damit die Frage "ist das eine Aenderung" und die Anzeige derselben
// Aenderung nicht auseinanderlaufen koennen.
function kurzfassung(v) {
  const teile = [];
  for (const name of YOUTUBE_AUSKUENFTE) {
    const f = v[name];
    teile.push(name + '=' + (f && f.da ? JSON.stringify(f.wert) : 'nicht vorhanden'));
  }
  return (v.gefunden ? '' : 'video nicht in der Antwort; ') + teile.join('  ');
}

// Die drei Gruende im Klartext, jeder mit "nicht vorhanden", wenn er fehlt
// (2.3, 2.4). DY hat gemessen, dass sie abwesend sind und nicht leer.
function gruendeSatz(a) {
  const teile = [];
  for (const name of ['rejectionReason', 'failureReason', 'processingFailureReason']) {
    const f = a[name];
    teile.push(name + ': ' + (f && f.da ? JSON.stringify(f.wert) : 'nicht vorhanden'));
  }
  return 'Gruende -- ' + teile.join('; ') + '.';
}

// ---------------------------------------------------------------------------
// DIE ANZEIGE DANACH (Vertrag 4, Schritt 13; 2.4)
// ---------------------------------------------------------------------------
//
// SIE IST KEIN ERFOLGSBERICHT. Sie zeigt, WAS auf dem Kanal liegt und was
// YouTube dazu sagt -- vollstaendig, auch dort, wo YouTube nichts sagt. Und
// sie sagt, wo dieser Weg aufhoert.
//
// WARUM DER SCHLUSSSATZ EINEN EIGENEN BLOCK BEKOMMT UND KEINE FUSSNOTE IST:
// nach einem Lauf, der eben etwas auf einen Kanal geschrieben hat, ist "es ist
// fertig" die naheliegendste Lesart. Sie ist falsch. Ein Video, das hier
// liegen bleibt, ist privat und bleibt es -- und wer das ueberliest, wartet
// auf eine Veroeffentlichung, die niemand ausgeloest hat.
//
// WAS SIE NICHT ZEIGT: das Bild, das YouTube ausliefert. Die URLs stehen da,
// die Bytes nicht -- sie zu holen waere ein Netzaufruf dieses Programms an
// einen fremden Rechner, und den macht es nicht. Die Freigabeseite zeigt
// daneben die Datei von der Platte; was YouTube daraus gemacht hat, ist an
// den URLs nachzusehen.
function abschlussSaetze({ befund, eintrag, zurueck, gedaechtnisPfad, aufrufe }) {
  const z = [];
  const trenn = '='.repeat(78);
  const strich = '-'.repeat(78);

  z.push('');
  z.push(trenn);
  z.push('LONGFORM -- DAS VIDEO LIEGT PRIVAT AUF DEM KANAL');
  z.push(trenn);
  // Vertrag 6: der erste Satz, in einer seiner drei Formen.
  z.push(ersterSatz(eintrag));
  z.push('Aufnahme ' + befund.aufnahme + '   Kennung ' + eintrag.videoId);
  z.push('');

  // ---- Was geschehen ist, in der Reihenfolge ------------------------------
  z.push('WAS DIESER LAUF GETAN HAT');
  z.push('');
  if (Array.isArray(aufrufe) && aufrufe.length) {
    for (const a of aufrufe) {
      z.push('  ' + String(a.nr).padStart(2, ' ') + '. ' + a.aufruf +
        (a.videoId ? '   (' + a.videoId + ')' : ''));
    }
  } else {
    z.push('  (keine Aufrufe verzeichnet)');
  }
  z.push('');
  z.push('  Hochgeladen am:      ' + eintrag.hochgeladen_am);
  z.push('  Thumbnail gesetzt:   ' + (eintrag.thumbnail_gesetzt_am || '(nicht gesetzt)'));
  z.push('  Zurueckgelesen am:   ' +
    ((eintrag.rueckgelesen && eintrag.rueckgelesen.gelesen_am) || '(nicht gelesen)'));
  z.push('  Stand im Gedaechtnis: ' + eintrag.stand);
  z.push('  Gedaechtnis:         ' + gedaechtnisPfad);
  z.push('');

  // ---- Die Videodatei ------------------------------------------------------
  z.push(strich);
  z.push('DIE DATEI, DIE HOCHGEGANGEN IST');
  z.push('');
  z.push('  ' + befund.video.dateiname + '   ' + befund.video.bytes + ' Bytes');
  z.push('  Pfad:    ' + befund.video.pfad);
  z.push('  sha256:  ' + eintrag.sha256);
  if (befund.video.vergleich && befund.video.vergleich.satz) {
    umbrucheIn(z, '  ', befund.video.vergleich.satz, '  ');
  }
  z.push('');

  // ---- Titel und Beschreibung, im Wortlaut --------------------------------
  z.push(strich);
  z.push('DER TITEL, IM WORTLAUT');
  z.push('');
  z.push('    ' + eintrag.titel);
  z.push('');
  z.push('DIE BESCHREIBUNG, IM WORTLAUT UND VOLLSTAENDIG');
  z.push('');
  if (befund.metadaten && typeof befund.metadaten.beschreibung === 'string') {
    for (const zeile of befund.metadaten.beschreibung.split('\n')) z.push('    ' + zeile);
    z.push('');
    z.push('  sha256 der gesendeten Beschreibung: ' + eintrag.beschreibung_sha256);
  } else {
    // Der Wiedereinstieg. Das Gedaechtnis fuehrt den Text NICHT (5.2) -- die
    // Vorlage kann sich geaendert haben, und ein Text von heute waere nicht
    // der gesendete. Die Pruefsumme ist der Beleg, den es gibt.
    z.push('    (dieser Lauf hat sie nicht gebildet -- er ist der Wiedereinstieg in einen');
    z.push('     Upload, der schon geschehen ist. Das Gedaechtnis fuehrt den Wortlaut');
    z.push('     absichtlich nicht: die Vorlage kann sich seither geaendert haben, und ein');
    z.push('     Text von heute waere nicht der gesendete. Was bleibt, ist die Pruefsumme.)');
    z.push('');
    z.push('  sha256 der gesendeten Beschreibung: ' + eintrag.beschreibung_sha256);
  }
  z.push('');
  z.push('  Tags (' + (eintrag.tags || []).length + '): ' +
    ((eintrag.tags || []).join(', ') || '(keine)'));
  z.push('');

  // ---- Das Thumbnail -------------------------------------------------------
  z.push(strich);
  z.push('DAS THUMBNAIL');
  z.push('');
  const t = eintrag.thumbnail;
  z.push('  Datei von der Platte: ' + t.dateiname);
  z.push('    sha256:  ' + t.sha256);
  z.push('    Groesse: ' + t.bytes + ' Bytes');
  z.push('    Rang:    ' + JSON.stringify(t.rang) + '   Zettel: ' +
    (t.zettel === null ? '(keiner)' : t.zettel));
  z.push('    Herkunft im Zettel: ' + JSON.stringify(t.zettel_herkunft) +
    '   Format: ' + JSON.stringify(t.format));
  z.push('    Fenster geweitet: ' + (t.fenster_geweitet ? 'ja' : 'nein') +
    '   per --zettel= gewaehlt: ' + (t.per_argument ? 'ja' : 'nein'));
  z.push('');
  z.push('  WAS YOUTUBE ZURUECKGIBT (snippet.thumbnails):');
  const tn = eintrag.rueckgelesen ? eintrag.rueckgelesen.thumbnails : null;
  if (tn && typeof tn === 'object') {
    for (const name of Object.keys(tn)) {
      const b = tn[name] || {};
      z.push('    ' + name + ': ' + String(b.url) +
        (b.width && b.height ? '   (' + b.width + 'x' + b.height + ')' : ''));
    }
    if (!Object.keys(tn).length) z.push('    (leer -- das Feld war da, aber ohne Eintraege)');
  } else {
    z.push('    NICHT VORHANDEN. YouTube hat kein snippet.thumbnails zurueckgegeben.');
    z.push('    Das ist keine Bestaetigung und keine Ablehnung, sondern eine fehlende');
    z.push('    Auskunft -- im Studio nachsehen.');
  }
  z.push('');
  z.push('  Die Vorschaubilder im CDN hinken nach (DX hat 25 Minuten gemessen). Eine URL,');
  z.push('  die noch das alte Bild zeigt, heisst darum nicht, dass das neue nicht');
  z.push('  angekommen ist. Was hier steht, ist die ANTWORT der API, nicht ein Abruf des');
  z.push('  Bildes -- dieses Programm holt von einem fremden Rechner nichts.');
  z.push('');

  // ---- Was YouTube gemeldet hat -------------------------------------------
  z.push(strich);
  z.push('WAS YOUTUBE GEMELDET HAT');
  z.push('');
  z.push('  Jede der fuenf Auskuenfte steht hier, auch die, die fehlen. "nicht vorhanden"');
  z.push('  heisst: das Feld stand nicht in der Antwort -- gemessen an 21 Shorts (DY) ist');
  z.push('  das der Normalfall, wenn nichts vorliegt. Es ist nicht dasselbe wie "leer".');
  z.push('');
  const q = eintrag.verarbeitung || {};
  for (const name of YOUTUBE_AUSKUENFTE) {
    const ausRueck = zurueck ? zurueck[name] : null;
    const ausWarten = q[name];
    const f = (ausRueck && ausRueck.da) ? ausRueck : ausWarten;
    z.push('    ' + name.padEnd(26, ' ') + ': ' +
      (f && f.da ? JSON.stringify(f.wert) : 'nicht vorhanden'));
  }
  z.push('');
  z.push('    Abfragen bis zur Verarbeitung: ' + (q.abfragen === undefined ? '(keine)' : q.abfragen));
  z.push('');
  z.push('  Der vollstaendige status-Block aus der Rueckleseantwort, unveraendert:');
  const rohStatus = eintrag.rueckgelesen ? eintrag.rueckgelesen.status : null;
  if (rohStatus && typeof rohStatus === 'object') {
    for (const name of Object.keys(rohStatus)) {
      z.push('    ' + name + ': ' + JSON.stringify(rohStatus[name]));
    }
  } else {
    z.push('    NICHT VORHANDEN.');
  }
  z.push('');

  // ---- Wo dieser Weg aufhoert ---------------------------------------------
  z.push(trenn);
  z.push('HIER IST SCHLUSS');
  z.push(trenn);
  z.push('');
  z.push('DAS VIDEO IST PRIVAT UND BLEIBT ES. Niemand ausser dem Kanalinhaber sieht es.');
  z.push('Es steht in keinem Feed, in keiner Benachrichtigung und auf keiner Kanalseite.');
  z.push('');
  z.push('DIESER LAUF HAT NICHTS OEFFENTLICH GESTELLT, und er kann es auch nicht: die');
  z.push('Ermaechtigung, die ihn ausgeloest hat, traegt den Zweck "Upload", und der Zweig,');
  z.push('der den dritten Aufruf macht, nimmt diesen Zweck nicht an. Es gibt hier also');
  z.push('nichts, was "noch schnell" geschehen koennte.');
  z.push('');
  z.push('WAS DAZU GEHOERT (Vertrag 4, Schritte 14 bis 17): eine ZWEITE Ermaechtigung mit');
  z.push('einem anderen Zweck, geschrieben von einem zweiten Klick, nachdem ein Mensch');
  z.push('gesehen hat, was oben steht. Die erste -- die, die diesen Lauf ausgeloest hat --');
  z.push('ersetzt sie nicht und ist ohnehin verbraucht (2.12, 7).');
  z.push('');
  z.push('UM DIESEN ZWEITEN KLICK ZU SEHEN, WIRD DER DIENST NEU GESTARTET. Die Seite, auf');
  z.push('der eben "Hochladen" stand, ist auf der Lage von VOR diesem Lauf gebaut; die');
  z.push('Frage aus 2.4 gehoert auf die Lage von jetzt. Ein neuer Start liest das');
  z.push('Gedaechtnis, das dieser Lauf eben geschrieben hat, und stellt sie darauf.');
  z.push('');
  z.push('WENN DIESES VIDEO NICHT OEFFENTLICH WERDEN SOLL, ist nichts weiter zu tun. Es');
  z.push('bleibt privat liegen; dieser Weg raeumt nichts weg, und das Wegraeumen eines');
  z.push('privaten Videos ist Sache eines Menschen im Studio (Vertrag 2.4, 7).');
  z.push('');
  z.push('NACHZUSEHEN IST TROTZDEM: ob YouTube oben etwas gemeldet hat, das hier nicht');
  z.push('erwartet wurde -- ein Urheberrechtstreffer etwa taucht in dieser Antwort nicht');
  z.push('unbedingt auf. Was die API von so einer Meldung wirklich zeigt, ist NICHT');
  z.push('gemessen (Vertrag 10, erster Punkt); das ist die wichtigste Einschraenkung');
  z.push('dieses Weges. Der Blick ins Studio ersetzt sie nicht, aber er ist der einzige,');
  z.push('den es gibt.');
  z.push('');
  return z;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

// DIE VERBINDUNGSPRUEFUNG DER BEIDEN SCHREIBENDEN ARGUMENTE (Vertrag 3.1)
//
// Sie steht hier und nicht in pruefeArgumenteStrikt: der prueft ZUGEHOERIGKEIT
// zu einer flachen Liste, keine Verbindung -- das ist der Befund ED F2, und er
// gilt weiter. Die beiden Faelle:
//
//   --bestaetigt-durch= OHNE --execute   Ein Missverstaendnis, kein
//     Trockenlauf mit Zusatz: die Ermaechtigung wuerde geprueft und
//     verbraucht, und dann geschaehe nichts damit. Dieselbe Weigerung wie im
//     Shorts-Uploader.
//
//   --execute OHNE --bestaetigt-durch=   Hier weicht dieser Bau vom
//     WORTLAUT des Vertrags ab, und das steht so im Bericht EP. 2.12 sagt:
//     "Ohne --bestaetigt-durch= laeuft nur der Trockenlauf." Ein --execute,
//     das stillschweigend zum Trockenlauf wird, ist aber genau die Form, gegen
//     die dieses Projekt seit ED F2 baut: ein Argument, das angenommen wird
//     und nichts tut. Wer --execute tippt, meint es. Er bekommt darum eine
//     Meldung und keinen Lauf, der aussieht, als haette er beinahe
//     hochgeladen. Die ZUSAGE ist damit nicht verletzt, sondern verschaerft:
//     ohne Ermaechtigung wird auf keinem Weg irgendetwas hochgeladen. Der
//     Trockenlauf bleibt, was er ist -- er laeuft, wenn man KEINES der beiden
//     Argumente mitgibt.
function pruefeSchreibendeArgumente(argv) {
  const rest = argv.slice(2);
  const execute = rest.includes('--execute');
  const ermaechtigt = rest.some((a) => a.startsWith('--bestaetigt-durch='));
  if (ermaechtigt && !execute) {
    console.error('');
    console.error('Abbruch: --bestaetigt-durch= ohne --execute.');
    console.error('');
    console.error('  Die Ermaechtigung loest einen SCHARFEN Lauf aus. Ohne --execute gaebe es');
    console.error('  nichts einzuloesen, und sie wuerde verbraucht, ohne dass etwas geschieht --');
    console.error('  eine Einmal-Ermaechtigung ist danach weg und gilt nicht mehr.');
    console.error('');
    console.error('  Trockenlauf:  --aufnahme="..."');
    console.error('  Scharf:       --aufnahme="..." --execute --bestaetigt-durch=<pfad>');
    console.error('');
    console.error('Es wurde NICHTS gelesen, NICHTS geschrieben und kein Netzaufruf gemacht.');
    console.error('');
    process.exit(EXIT_ARGUMENTFEHLER);
  }
  if (execute && !ermaechtigt) {
    console.error('');
    console.error('Abbruch: --execute ohne --bestaetigt-durch=.');
    console.error('');
    console.error('  Dieser Weg hat KEIN getipptes Bestaetigungswort und keine Terminalfrage');
    console.error('  (Vertrag 2.12). Die Freigabeseite ist der einzige Ort, an dem eine');
    console.error('  Ermaechtigung entsteht -- dort stehen Vorschau, Bild und Ausgang');
    console.error('  nebeneinander, und dort wird geklickt.');
    console.error('');
    console.error('  --execute wird hier NICHT stillschweigend zum Trockenlauf. Ein Argument,');
    console.error('  das angenommen wird und nichts tut, ist schlimmer als eines, das es nicht');
    console.error('  gibt: wer es tippt, glaubt sonst, es habe gewirkt.');
    console.error('');
    console.error('  Der Trockenlauf laeuft OHNE beide Argumente:  --aufnahme="..."');
    console.error('');
    console.error('Es wurde NICHTS gelesen, NICHTS geschrieben und kein Netzaufruf gemacht.');
    console.error('');
    process.exit(EXIT_ARGUMENTFEHLER);
  }
}

function wertVon(argv, praefix) {
  const t = argv.slice(2).find((x) => x.startsWith(praefix));
  return t === undefined ? null : t.slice(praefix.length);
}

async function main() {
  pruefeKeineFreienArgumente(process.argv, 'src/upload/longform-arbeiter.js', '--aufnahme=');

  // Beide sind hier schon auf ihre Verbindung geprueft (pruefeSchreibendeArgumente,
  // als zweite Anweisung des Programms): entweder stehen beide da oder keines.
  const execute = process.argv.slice(2).includes('--execute');
  const bestaetigtDurch = wertVon(process.argv, '--bestaetigt-durch=');

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
  // Ein Schalter ohne Wert, WOERTLICH verglichen und nicht mit startsWith.
  //
  // Eine eigene Meldung fuer "--befund-json=irgendwas" braucht es hier NICHT,
  // und der erste Entwurf hatte trotzdem eine: pruefeArgumenteStrikt vergleicht
  // Eintraege ohne "=" woertlich und weist die Fassung mit Wert schon vor
  // dieser Zeile ab, mit der Liste der zulaessigen Argumente darunter. Der
  // Nachbau war toter Code -- er stand da, sah nach Sorgfalt aus und ist nie
  // gelaufen. Gefunden hat ihn der Test, der ihn ausloesen wollte.
  const befundZeileGewuenscht = process.argv.slice(2).includes('--befund-json');

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

  // BEIDE AUSGABEN AUS EINEM BEFUND, und zwar sichtbar aus einem: die Vorschau
  // steht schon in befund.saetze, die Zeile wird hier daneben gebildet -- aus
  // derselben Veraenderlichen, in derselben Zeile Code. Zwei Aufrufe an zwei
  // Stellen weiter unten waeren zwei Gelegenheiten, an einer davon einen
  // anderen Befund zu erwischen.
  //
  // Sie wird IMMER gebildet, auch ohne das Argument. Eine Zeile, die nur
  // gebaut wird, wenn jemand sie sehen will, ist eine Zeile, die im Test
  // gruen ist und im Ernstfall zum ersten Mal laeuft.
  const text = befund.saetze.join('\n');
  const zeile = befundJson(befund);
  if (befund.abbruch) {
    // Der Befund geht auf stderr, damit der Freigabedienst ihn durchreichen
    // kann, ohne ihn von der Vorschau trennen zu muessen (Vertrag 6).
    console.error(text);
    schreibeBefundzeile(befundZeileGewuenscht, zeile);
    process.exit(befund.abbruch.wert);
  }
  console.log(text);
  schreibeBefundzeile(befundZeileGewuenscht, zeile);

  // ---- DER TROCKENLAUF ENDET HIER -----------------------------------------
  if (!execute) process.exit(EXIT_OK);

  // ---- DER SCHARFE LAUF (Vertrag 4, Schritte 9 bis 13) --------------------
  //
  // OHNE weitere Angaben: die Vorgaben von scharferLauf() sind der ECHTE
  // Kanal, die echte Uhr und ein echtes Warten. main() reicht nichts hinein,
  // was das aendern koennte.
  const ergebnis = await scharferLauf({
    befund, projektwurzel, exportOrdner, bestaetigtDurch,
  });
  process.exit(ergebnis.code);
}

// Der scharfe Lauf, getrennt von main(): main() ist die Argumentpruefung und
// der Trockenlauf, und der ist seit EK unveraendert. Ein Zweig, der sich durch
// ihn hindurchschlaengelt, liesse sich nicht mehr lesen, ohne beide zu lesen --
// derselbe Grund, aus dem starteLongform() im Freigabedienst eine eigene
// Funktion ist.
//
// DIE REIHENFOLGE IST DIE AUS VERTRAG 4, UND SIE IST KEINE GESCHMACKSFRAGE:
// alles, was ohne Netz entscheidbar ist, faellt VOR dem ersten Netzaufruf. Wer
// eine abgelaufene, fremde oder schon verbrauchte Ermaechtigung mitgibt, hat
// dann nicht einmal die Netzbibliothek geladen.
//
// WARUM `baueKanal`, `schlafe`, `jetzt` UND DIE BEIDEN MELDER INJIZIERT SIND.
//
// Dieselbe Bauart wie fuehreUploadsAus() im Shorts-Uploader, und aus demselben
// Grund -- nur ist er hier zwingender: dieser Weg darf im Test KEINEN echten
// Aufruf machen, und ein Bau, der die Bibliothek selbst holt, laesst sich nicht
// gegen einen Doppelgaenger pruefen. Die Vorgabe ist in jedem Fall der scharfe
// Weg; wer etwas anderes will, muss es hinschreiben, und main() tut das nicht.
//
// DAS IST KEINE ZUSAETZLICHE TUER. Wer dieses Modul laden kann, kann auch
// longform-kanal.js laden und die Aufrufe direkt machen. Was die Injektion
// bringt, ist der Nachweis: tests/ep-privat.test.cjs faehrt die GANZE Kette --
// Ermaechtigung, Kanal, Gedaechtnis, Aufrufe -- gegen einen Doppelgaenger, der
// jeden Aufruf mit Namen und Reihenfolge zaehlt.
async function scharferLauf({
  befund, projektwurzel, exportOrdner, bestaetigtDurch,
  baueKanal = K.baueEchtenKanal,
  schlafe = (ms) => new Promise((f) => setTimeout(f, ms)),
  jetzt = () => Date.now(),
  melde = (t) => console.log(t),
  meldeFehler = (t) => console.error(t),
  wartegrenzeMs = WARTEGRENZE_MS,
  abfrageabstandMs = ABFRAGEABSTAND_MS,
} = {}) {
  // -------------------------------------------------------------------------
  // EU: DIE WEICHE -- UND SIE STEHT IN DER DATEI, NICHT IN DER KOMMANDOZEILE
  // -------------------------------------------------------------------------
  //
  // Welchen der beiden Wege dieser Lauf geht, entscheidet der ZWECK, der in
  // der Ermaechtigung steht. Es gibt dafuer KEIN Argument -- weder eines, das
  // veroeffentlicht, noch eines, das anhaelt. Der Grund ist der Fehler, den
  // dieses Projekt am meisten kennt: ein Argument, das angenommen wird und
  // nicht wirkt, und eines, das man vergisst. Wer den Haltepunkt als Schalter
  // baute, baute einen Schalter, dessen Vergessen veroeffentlicht.
  //
  // liesZweck() PRUEFT NICHTS. Sie sieht nach, welchen Zweck die Datei nennt,
  // und sonst gar nichts; jede Pruefung macht danach der gewaehlte Weg,
  // vollstaendig. Findet sie nichts Brauchbares -- Datei fehlt, kein JSON,
  // fremder Pfad, kein Zweck --, faellt der Lauf auf den Upload-Weg, und
  // dessen pruefeErmaechtigung() sagt mit ihrer eigenen Meldung, was mit der
  // Datei nicht stimmt. So gibt es fuer denselben Mangel nicht zwei Meldungen.
  const zweck = G.liesZweck(projektwurzel, bestaetigtDurch);

  // DIE ZWEITE FRAGE: WAS STEHT UEBERHAUPT AN? Sie entscheidet den Fall, in
  // dem die Datei keinen Zweck hergibt -- sie fehlt, sie ist kein JSON, sie
  // liegt am falschen Ort. Dann waere der Upload-Weg die falsche Wahl: seine
  // Meldung spraeche vom Hochladen, waehrend ein Mensch auf ein
  // Oeffentlichstellen gewartet hat. Steht laut Gedaechtnis der dritte Aufruf
  // an, geht dieser Lauf dorthin und sagt mit DESSEN Meldungen, was mit der
  // Datei nicht stimmt.
  //
  // Ein LESBARER Zweck schlaegt das immer: eine Upload-Ermaechtigung auf einem
  // fertigen Upload bekommt die Auskunft des Upload-Wegs, und das ist die
  // richtige -- sie hat dort nichts einzuloesen.
  const stehtAn = (befund.gedaechtnis && befund.gedaechtnis.weiter)
    ? befund.gedaechtnis.weiter.ab : null;
  const unbekannterZweck = zweck === null || !G.ZWECKE.includes(zweck);
  if (G.ZWECKE_DRITTER_AUFRUF.includes(zweck) ||
      (unbekannterZweck && stehtAn === 'oeffentlich')) {
    return oeffentlicherLauf({
      befund, projektwurzel, exportOrdner, bestaetigtDurch,
      baueKanal, jetzt, melde, meldeFehler,
    });
  }

  const imGedaechtnis = () => (befund.gedaechtnis ? befund.gedaechtnis.eintrag : null);
  let kanal = null;

  // Jede Weigerung geht durch DIESE Funktion, und sie beginnt mit dem ersten
  // Satz aus Vertrag 6 -- "ob ein Video auf dem Kanal liegt, mit videoId und
  // Zustand". Das ist der Unterschied zum Shorts-Uploader: ein 1 kann auf
  // diesem Weg NACH Aufruf 1 fallen, und dann ist die wichtigste Auskunft
  // nicht der Grund, sondern der Zustand des Kanals.
  const nein = (code, ueberschrift, gruende) => {
    meldeFehler('');
    meldeFehler(ersterSatz(imGedaechtnis()));
    meldeFehler('');
    meldeFehler('ABBRUCH: ' + ueberschrift);
    meldeFehler('');
    for (const g of gruende) {
      for (const zeile of U.umbrich(String(g), 74)) meldeFehler('  ' + zeile);
      meldeFehler('');
    }
    if (kanal) {
      meldeFehler('Aufrufe in diesem Lauf: ' + (kanal.aufrufnamen().join(', ') || '(keine)'));
      meldeFehler('');
    }
    return { code: EXIT_BEFUND, kanal, abbruch: { code, ueberschrift, gruende } };
  };

  // 1. GIBT ES UEBERHAUPT ETWAS EINZULOESEN? Das entscheidet das Gedaechtnis,
  //    und es entscheidet es VOR der Ermaechtigung: eine Ermaechtigung, fuer
  //    die es nichts zu tun gibt, wird nicht verbraucht, sondern bleibt liegen
  //    und laeuft von selbst ab.
  const b = bindung(befund);
  if (!b.ok) {
    const e = imGedaechtnis();
    // Ein FERTIGER Schritt ist kein Befund. Nur die Lagen, in denen dieser Weg
    // sich weigert, enden mit 1 -- "fertig" und "ich fasse das nicht an"
    // duerfen nicht denselben Rueckgabewert tragen (Vertrag 6).
    if (e && e.stand === 'thumbnail_gesetzt') {
      melde('');
      melde(ersterSatz(e));
      melde('');
      melde('NICHTS HOCHZULADEN: der Upload-Schritt ist fertig. ' + b.grund);
      melde('');
      // EU: DIE ERMAECHTIGUNG BLEIBT LIEGEN. Sie wurde nicht geprueft und
      // nicht verbraucht -- eine Upload-Ermaechtigung, die hier eingeloest
      // wuerde, ermaechtigte zu einem zweiten Video. Sie laeuft in hoechstens
      // zwei Minuten von selbst ab.
      melde('Die mitgegebene Ermaechtigung wurde NICHT verbraucht: es gab nichts einzuloesen.');
      melde('Was ansteht, ist die Frage aus Vertrag 2.4 und danach der dritte Aufruf. Der');
      melde('braucht eine ZWEITE Ermaechtigung mit einem anderen Zweck, geschrieben von');
      melde('einem zweiten Klick in der Longform-Ansicht.');
      melde('');
      return { code: EXIT_OK, kanal: null, abbruch: null };
    }
    return nein('nichts_einzuloesen', 'es gibt hier nichts einzuloesen.', [b.grund]);
  }

  // 2. DIE ERMAECHTIGUNG -- alles ausser dem Kanalvergleich ohne Netz (2.12).
  const geprueft = G.pruefeErmaechtigung({
    projektwurzel,
    pfad: bestaetigtDurch,
    aufnahme: befund.aufnahme,
    videoSha256: b.video_sha256,
    bild: b.bild,
    zettel: b.zettel,
    jetzt: jetzt(),
  });
  if (!geprueft.ok) {
    return nein(geprueft.code, 'die Ermaechtigung traegt nicht (' + geprueft.code + ').',
      [geprueft.meldung]);
  }
  const ermaechtigung = geprueft.daten;
  melde('');
  melde('ERMAECHTIGT DURCH:      ' + bestaetigtDurch);
  melde('  Zweck:                ' + ermaechtigung.zweck +
    '   (NICHT das Oeffentlichstellen -- dafuer braeuchte es eine zweite, 2.12)');
  melde('  ausgestellt am:       ' + ermaechtigung.erstellt_am + '   (' +
    Math.round((jetzt() - Date.parse(ermaechtigung.erstellt_am)) / 1000) +
    ' Sekunden alt, hoechstens ' + (G.ERMAECHTIGUNG_GUELTIG_MS / 1000) + ')');
  melde('  fuer Aufnahme:        ' + ermaechtigung.aufnahme);
  melde('  fuer Videodatei:      sha256 ' + ermaechtigung.video_sha256);
  melde('  fuer Bild:            ' + ermaechtigung.bild.dateiname +
    '   sha256 ' + ermaechtigung.bild.sha256);
  melde('  fuer Zettel:          ' + String(ermaechtigung.zettel.dateiname) +
    '   Rang ' + JSON.stringify(ermaechtigung.zettel.rang));
  melde('  fuer Kanal:           ' + ermaechtigung.kanal_name);
  melde('  Geprueft gegen:       ' + (b.quelle === 'gedaechtnis'
    ? 'das GEDAECHTNIS. Dies ist die FORTSETZUNG eines Uploads und kein neuer; die ' +
      'Zettelwahl wird dabei nicht wiederholt (Vertrag 5.3).'
    : 'DIESEN Lauf. Videodatei und Bild sind die, die eben in der Vorschau standen.'));

  // 3. ANMELDEN UND DER KANAL (Vertrag 4, Schritt 9). Erst hier wird die
  //    Netzbibliothek geladen.
  try {
    kanal = await baueKanal();
  } catch (e) {
    return nein('anmeldung_fehlgeschlagen', 'die Anmeldung ist fehlgeschlagen.',
      [String(e && e.message ? e.message : e) + ' Es wurde nichts hochgeladen und die ' +
        'Ermaechtigung nicht verbraucht -- sie laeuft in hoechstens zwei Minuten ab.']);
  }
  let wer;
  try {
    wer = await kanal.nenneKanal();
  } catch (e) {
    return nein('kanal_nicht_lesbar', 'der Kanal liess sich nicht lesen.',
      [String(e && e.message ? e.message : e) + ' Es wurde nichts hochgeladen.']);
  }
  if (!wer.gefunden) {
    return nein('kein_kanal', 'es ist kein Kanal angemeldet.',
      ['Die Abfrage auf den eigenen Kanal liefert keinen. Es wurde nichts hochgeladen.']);
  }
  const k = G.pruefeKanal(ermaechtigung, wer.id, wer.name);
  if (!k.ok) {
    return nein(k.code, 'die Ermaechtigung traegt nicht (' + k.code + ').', [k.meldung]);
  }

  // 4. VERBRAUCHEN, BEVOR DER ERSTE SCHREIBENDE AUFRUF BEGINNT. Bricht der
  //    Lauf danach ab, ist die Ermaechtigung trotzdem weg -- ein zweiter Lauf
  //    braucht einen zweiten Klick, und dann sieht wieder ein Mensch hin.
  const verbraucht = G.verbraucheErmaechtigung({
    projektwurzel, pfad: bestaetigtDurch, daten: ermaechtigung, jetzt: jetzt(),
  });
  if (!verbraucht.ok) {
    return nein(verbraucht.code,
      'die Ermaechtigung liess sich nicht verbrauchen (' + verbraucht.code + ').',
      [verbraucht.meldung]);
  }
  melde('');
  melde('ERMAECHTIGUNG VERBRAUCHT: vermerkt in ' + verbraucht.verbrauchtPfad);
  melde('  Datei ' + (verbraucht.geloescht
    ? 'geloescht: ' + bestaetigtDurch
    : 'NICHT geloescht (' + verbraucht.loeschgrund + ') -- sie ist aber vermerkt und gilt ' +
      'nicht mehr: ' + bestaetigtDurch));
  melde('  Kanal geprueft: die Kennung aus der Ermaechtigung ist die des angemeldeten ' +
    'Kanals "' + wer.name + '".');
  melde('');

  // 5. DER LAUF.
  let ergebnis;
  try {
    ergebnis = await fuehreLongformLauf({
      befund, kanal, projektwurzel, ermaechtigung, exportOrdner,
      jetzt, schlafe, melde, wartegrenzeMs, abfrageabstandMs,
    });
  } catch (e) {
    return nein('unerwarteter_fehler',
      'der Lauf ist mit einem unerwarteten Fehler abgebrochen.',
      [String(e && e.stack ? e.stack : e)]);
  }
  if (!ergebnis.ok) {
    // Der Gedaechtniseintrag DIESES Laufs tritt hier an die Stelle des alten:
    // nach Aufruf 1 gibt es einen, den der Trockenlauf noch nicht kannte, und
    // der erste Satz muss ihn nennen.
    const stand = ergebnis.eintrag;
    meldeFehler('');
    meldeFehler(ersterSatz(stand));
    meldeFehler('');
    meldeFehler('ABBRUCH: der Lauf ist stehengeblieben (' + ergebnis.abbruch.code + ').');
    meldeFehler('');
    for (const zeile of U.umbrich(String(ergebnis.abbruch.satz), 74)) {
      meldeFehler('  ' + zeile);
    }
    meldeFehler('');
    meldeFehler('Gedaechtnis: ' + ergebnis.pfad);
    meldeFehler('Aufrufe in diesem Lauf: ' + (kanal.aufrufnamen().join(', ') || '(keine)'));
    meldeFehler('');
    return { code: EXIT_BEFUND, kanal,
      abbruch: { code: ergebnis.abbruch.code, ueberschrift: 'der Lauf ist stehengeblieben.',
        gruende: [ergebnis.abbruch.satz] } };
  }

  melde(abschlussSaetze({
    befund, eintrag: ergebnis.eintrag, zurueck: ergebnis.zurueck,
    gedaechtnisPfad: ergebnis.pfad, aufrufe: kanal.aufrufe(),
  }).join('\n'));
  return { code: EXIT_OK, kanal, abbruch: null, eintrag: ergebnis.eintrag };
}

// ---------------------------------------------------------------------------
// EU: DIE ANZEIGE NACH DEM DRITTEN AUFRUF (und nach dem Haltepunkt)
// ---------------------------------------------------------------------------
//
// ZWEI AUSGAENGE, EINE FUNKTION. Der Haltepunkt und das wirkliche
// Oeffentlichstellen zeigen dasselbe -- den Koerper, den Statusblock, die
// Zeitpunkte -- und unterscheiden sich in genau einem Satz: ob er gesendet
// wurde. Zwei Funktionen waeren zwei Gelegenheiten, in einer davon einen
// Koerper zu zeigen, der so nie hinausging.
//
// WARUM DER ZEITPUNKT SO PROMINENT STEHT. Beim Upload ist
// `notifySubscribers: true` mitgegangen (Vertrag 2.14). Wann genau die
// Benachrichtigung an die Abonnenten hinausgeht, weiss dieses Projekt nicht --
// beim Upload, beim Oeffentlichstellen, gar nicht. Der erste echte Lauf soll
// das messen koennen, und dafuer braucht er zwei Zeitpunkte auf die Sekunde:
// wann der Aufruf hinausging und wann die Antwort kam. Alles, was in diesem
// Fenster passiert, gehoert zu diesem Aufruf; alles davor oder danach nicht.
function abschlussOeffentlich({ befund, ergebnis, gedaechtnisPfad, aufrufe }) {
  const e = ergebnis.eintrag;
  const angehalten = ergebnis.angehalten === true;
  const z = [];
  const trenn = '='.repeat(78);
  const strich = '-'.repeat(78);

  z.push('');
  z.push(trenn);
  z.push(angehalten
    ? 'LONGFORM -- ANGEHALTEN, UNMITTELBAR VOR DEM DRITTEN AUFRUF'
    : 'LONGFORM -- DAS VIDEO IST OEFFENTLICH');
  z.push(trenn);
  z.push(ersterSatz(e));
  z.push('Aufnahme ' + befund.aufnahme + '   Kennung ' + e.videoId);
  z.push('');

  z.push('WAS DIESER LAUF GETAN HAT');
  z.push('');
  if (Array.isArray(aufrufe) && aufrufe.length) {
    for (const a of aufrufe) {
      z.push('  ' + String(a.nr).padStart(2, ' ') + '. ' + a.aufruf +
        (a.videoId ? '   (' + a.videoId + ')' : ''));
    }
  } else {
    z.push('  (keine Aufrufe verzeichnet)');
  }
  z.push('');
  if (angehalten) {
    z.push('  ES IST KEIN SCHREIBENDER AUFRUF DARUNTER, und das ist der ganze Zweck dieses');
    z.push('  Laufs: er geht den Weg bis zum letzten Schritt und macht ihn nicht.');
  } else {
    z.push('  Der dritte ist der schreibende. Es gibt je Lauf hoechstens einen von jeder');
    z.push('  schreibenden Sorte; die Zaehlung sitzt im Kanalobjekt und wirft vor dem Aufruf,');
    z.push('  nicht danach (src/upload/longform-kanal.js).');
  }
  z.push('');

  // ---- Die Zeitpunkte -----------------------------------------------------
  z.push(strich);
  z.push(angehalten ? 'DER ZEITPUNKT DES ANHALTENS' : 'DER ZEITPUNKT DES OEFFENTLICHSTELLENS');
  z.push('');
  if (angehalten) {
    z.push('  Angehalten am:  ' + String(e.haltepunkt && e.haltepunkt.angehalten_am));
    z.push('');
    z.push('  Es ist nichts oeffentlich geworden, und darum gibt es hier keinen Zeitpunkt,');
    z.push('  gegen den sich eine Benachrichtigung halten liesse.');
  } else {
    const v = e.oeffentlich_versuch || {};
    z.push('  Aufruf hinausgegangen:  ' + String(v.begonnen_am));
    z.push('  Antwort zurueck:        ' + String(e.oeffentlich_am));
    if (v.begonnen_am && e.oeffentlich_am) {
      z.push('  Dazwischen:             ' +
        (Date.parse(e.oeffentlich_am) - Date.parse(v.begonnen_am)) + ' ms');
    }
    z.push('  privacyStatus laut Antwort: ' + JSON.stringify(e.oeffentlich_privacystatus));
    z.push('');
    z.push('  BEIDE ZEITPUNKTE STEHEN IM GEDAECHTNIS, auf die Sekunde genau. Wann YouTube');
    z.push('  die Abonnenten benachrichtigt -- beim Upload, beim Oeffentlichstellen, gar');
    z.push('  nicht -- ist NICHT GEMESSEN. Der Upload hat notifySubscribers: true');
    z.push('  mitgeschickt (Vertrag 2.14); was daraus folgt, laesst sich nur an einer');
    z.push('  Benachrichtigung ablesen, die jemand wirklich bekommen hat. Ohne diese beiden');
    z.push('  Zeitpunkte waere hinterher nicht zu sagen, ob eine dazugehoerte.');
  }
  z.push('');

  // ---- Der Statusblock, hin und zurueck -----------------------------------
  z.push(strich);
  z.push('DER STATUSBLOCK: GELESEN, GESENDET, ZURUECKGEKOMMEN');
  z.push('');
  z.push('  Die Regel dahinter steht in Vertrag 2.5, aus der Dokumentation: JEDES');
  z.push('  veraenderbare Feld des Teils "status", das im Anfragekoerper FEHLT, wird');
  z.push('  geloescht und faellt auf seine Vorgabe zurueck. "Nur privacyStatus schicken"');
  z.push('  waere also genau falsch gewesen.');
  z.push('');
  z.push('  GELESEN (videos.list, part=status, unmittelbar vorher):');
  const gel = ergebnis.gelesen;
  if (gel && typeof gel === 'object') {
    for (const name of Object.keys(gel)) {
      z.push('    ' + name.padEnd(26, ' ') + ': ' + JSON.stringify(gel[name]));
    }
  } else {
    z.push('    (keiner)');
  }
  z.push('');
  z.push('  ' + (angehalten ? 'WAS GESENDET WUERDE' : 'GESENDET') + ' (' +
    K.SCHREIBENDE_AUFRUFE[2] + ', part=status):');
  const geb = ergebnis.gebaut;
  z.push('    id' + ' '.repeat(24) + ': ' + JSON.stringify(geb.koerper.id));
  for (const name of Object.keys(geb.koerper.status)) {
    z.push('    status.' + name.padEnd(19, ' ') + ': ' +
      JSON.stringify(geb.koerper.status[name]) +
      (name === K.STATUS_FELD_PRIVACY ? '   <- das einzige geaenderte Feld' : ''));
  }
  z.push('');
  z.push('    NICHT im Koerper, und keines davon aus Versehen:');
  z.push('      ' + K.STATUS_FELDER_NIE[0] + ' -- nie, in keinem Aufruf (Vertrag 7). Es ist');
  z.push('      ein SETZBARES Feld; es fehlt hier also mit Absicht und nicht aus');
  z.push('      Nachlaessigkeit. Ein Termin neben "public" ist ausserdem ein Fehler.');
  z.push('      snippet -- nicht im part und nicht im Koerper. Titel, Beschreibung, Tags,');
  z.push('      Kategorie und Sprache bleiben unangetastet (Vertrag 2.5, 7).');
  if (geb.verworfen.length) {
    z.push('      ' + geb.verworfen.join(', ') + ' -- nur lesbare Felder des Blocks. Sie');
    z.push('      gehoeren nicht in den Koerper (Vertrag 2.5 Punkt 4).');
  }
  z.push('');
  if (geb.fehlend.length) {
    z.push('    ACHTUNG -- DIESE UEBERTRAGBAREN FELDER STANDEN NICHT IM GELESENEN BLOCK:');
    for (const name of geb.fehlend) z.push('      ' + name);
    z.push('    Was nicht gelesen wurde, konnte nicht zurueckgeschickt werden. Laut');
    z.push('    Dokumentation faellt es damit auf seine Vorgabe. Im Studio nachsehen.');
  } else {
    z.push('    Alle uebertragbaren Felder standen im gelesenen Block und gingen');
    z.push('    unveraendert zurueck. Es kann keines geloescht worden sein.');
  }
  z.push('');
  if (!angehalten) {
    z.push('  ZURUECKGEKOMMEN (die Antwort auf ' + K.SCHREIBENDE_AUFRUFE[2] + '):');
    const zur = e.oeffentlich_antwort_status;
    if (zur && typeof zur === 'object') {
      for (const name of Object.keys(zur)) {
        z.push('    ' + name.padEnd(26, ' ') + ': ' + JSON.stringify(zur[name]));
      }
    } else {
      z.push('    NICHT VORHANDEN. Die Antwort trug keinen status-Block.');
    }
    z.push('');
    if (ergebnis.abweichungen && ergebnis.abweichungen.length) {
      z.push('    ABWEICHUNGEN ZWISCHEN GESENDET UND ZURUECKGEKOMMEN:');
      for (const a of ergebnis.abweichungen) umbrucheIn(z, '      - ', a.satz, '        ');
    } else {
      z.push('    Feld fuer Feld verglichen: kein Unterschied zwischen dem, was hinausging,');
      z.push('    und dem, was zurueckkam. Die Falle aus 2.5 hat nicht zugeschlagen.');
    }
    z.push('');
  }

  // ---- Was am Video haengt -------------------------------------------------
  z.push(strich);
  z.push('WORUEBER GEURTEILT WURDE');
  z.push('');
  z.push('  Titel:      ' + String(e.titel));
  z.push('  Bild:       ' + String(e.thumbnail && e.thumbnail.dateiname));
  z.push('    sha256:   ' + String(e.thumbnail && e.thumbnail.sha256));
  z.push('  Videodatei: ' + String(befund.video && befund.video.dateiname));
  z.push('    sha256:   ' + String(e.sha256));
  z.push('  Gedaechtnis: ' + gedaechtnisPfad);
  z.push('');

  // ---- Der Schluss ---------------------------------------------------------
  z.push(trenn);
  if (angehalten) {
    z.push('ANGEHALTEN -- ES IST NICHTS OEFFENTLICH');
    z.push(trenn);
    z.push('');
    z.push('DAS VIDEO IST PRIVAT UND BLEIBT ES. Dieser Lauf hat KEINEN schreibenden Aufruf');
    z.push('gemacht; die Liste oben zeigt es. Er hat den ganzen Weg dorthin abgelaufen --');
    z.push('anmelden, Kanal pruefen, das Urteil gegen das Video halten, den Statusblock');
    z.push('holen, den Koerper bauen -- und am letzten Schritt angehalten.');
    z.push('');
    z.push('DIE ERMAECHTIGUNG IST TROTZDEM VERBRAUCHT. Sie galt fuer diesen einen Lauf, und');
    z.push('den hat sie ausgeloest. Sie liegt nicht herum und laesst sich nicht nachtraeglich');
    z.push('zum Veroeffentlichen umdeuten -- ihr Zweck stand in der Datei.');
    z.push('');
    z.push('WER JETZT WIRKLICH VEROEFFENTLICHEN WILL, klickt in der Longform-Ansicht auf');
    z.push('"Veroeffentlichen". Das schreibt eine neue Ermaechtigung mit dem anderen Zweck,');
    z.push('und der Lauf liest den Statusblock NOCH EINMAL -- der von eben ist dann alt.');
  } else {
    z.push('HIER IST SCHLUSS -- UND DIESER SCHRITT LAESST SICH NICHT ZURUECKNEHMEN');
    z.push(trenn);
    z.push('');
    z.push('DAS VIDEO IST OEFFENTLICH. Es steht auf der Kanalseite, in der Suche und');
    z.push('moeglicherweise in den Feeds der Abonnenten. Wer es gesehen hat, hat es gesehen;');
    z.push('ein spaeteres Zuruecksetzen auf privat macht das nicht rueckgaengig.');
    z.push('');
    z.push('DIESER BAU SETZT NICHTS ZURUECK. Es gibt hier kein Loeschen des Videos, keinen');
    z.push('zweiten dritten Aufruf und keinen Weg zurueck auf "privat" -- weder als Argument');
    z.push('noch als Aufruf, den man von Hand ausloesen koennte (Vertrag 7). Wer die');
    z.push('Sichtbarkeit aendern will, tut es im Studio.');
    z.push('');
    z.push('WAS NICHT GEAENDERT WURDE: Titel, Beschreibung, Tags, Kategorie, Sprache,');
    z.push('Thumbnail, Termin. Der Aufruf nannte im part nur "status", und im Koerper stand');
    z.push('genau der gelesene Statusblock mit einem geaenderten Feld.');
    z.push('');
    z.push('NACHZUSEHEN IST TROTZDEM, und zwar jetzt: ob im Studio unter diesem Video etwas');
    z.push('steht, das hier nicht steht. Was die API ueber einen Urheberrechtstreffer oder');
    z.push('eine Altersbeschraenkung meldet, ist NICHT GEMESSEN (Vertrag 10, erster Punkt);');
    z.push('dieser Lauf hat gezeigt, was sie zurueckgab, und nicht, was es alles gibt.');
  }
  z.push('');
  return z;
}

// ---------------------------------------------------------------------------
// EU: DER SCHARFE LAUF DES DRITTEN AUFRUFS
// ---------------------------------------------------------------------------
//
// EINE EIGENE FUNKTION UND KEIN ZWEIG IN scharferLauf(), aus demselben Grund,
// aus dem scharferLauf() selbst keiner in main() ist: die beiden Wege pruefen
// verschiedene Ermaechtigungen gegen verschiedene Bindungen und enden in
// verschiedenen Anzeigen. Ein Zweig, der sich durch beide schlaengelt, liesse
// sich nicht mehr lesen, ohne beide zu lesen -- und dies hier ist der Weg, bei
// dem das Lesen zaehlt.
//
// DIE REIHENFOLGE IST DIESELBE WIE OBEN, und das ist kein Zufall: alles, was
// ohne Netz entscheidbar ist, faellt VOR dem ersten Netzaufruf. Wer eine
// abgelaufene, fremde oder schon verbrauchte Ermaechtigung mitgibt, hat dann
// nicht einmal die Netzbibliothek geladen.
async function oeffentlicherLauf({
  befund, projektwurzel, exportOrdner, bestaetigtDurch, baueKanal, jetzt, melde, meldeFehler,
}) {
  const imGedaechtnis = () => (befund.gedaechtnis ? befund.gedaechtnis.eintrag : null);
  let kanal = null;

  const nein = (code, ueberschrift, gruende) => {
    meldeFehler('');
    meldeFehler(ersterSatz(imGedaechtnis()));
    meldeFehler('');
    meldeFehler('ABBRUCH: ' + ueberschrift);
    meldeFehler('');
    for (const gr of gruende) {
      for (const zeile of U.umbrich(String(gr), 74)) meldeFehler('  ' + zeile);
      meldeFehler('');
    }
    if (kanal) {
      meldeFehler('Aufrufe in diesem Lauf: ' + (kanal.aufrufnamen().join(', ') || '(keine)'));
      meldeFehler('');
    }
    return { code: EXIT_BEFUND, kanal, abbruch: { code, ueberschrift, gruende } };
  };

  // 1. GIBT ES ETWAS EINZULOESEN? Das entscheidet das Gedaechtnis, vor der
  //    Ermaechtigung: eine, fuer die es nichts zu tun gibt, wird nicht
  //    verbraucht, sondern laeuft von selbst ab.
  const b = zweiteBindung(befund);
  if (!b.ok) {
    return nein('nichts_zu_veroeffentlichen', 'es gibt hier nichts oeffentlich zu stellen.',
      [b.grund]);
  }

  // 2. DIE ERMAECHTIGUNG -- alles ausser dem Kanalvergleich ohne Netz (2.12).
  const geprueft = G.pruefeZweiteErmaechtigung({
    projektwurzel,
    pfad: bestaetigtDurch,
    aufnahme: b.aufnahme,
    videoSha256: b.video_sha256,
    videoId: b.videoId,
    urteil: b.urteil,
    jetzt: jetzt(),
  });
  if (!geprueft.ok) {
    return nein(geprueft.code, 'die zweite Ermaechtigung traegt nicht (' + geprueft.code + ').',
      [geprueft.meldung]);
  }
  const ermaechtigung = geprueft.daten;
  const haltepunkt = ermaechtigung.zweck === G.ZWECK_HALTEPUNKT;
  melde('');
  melde('ERMAECHTIGT DURCH:      ' + bestaetigtDurch);
  melde('  Zweck:                ' + ermaechtigung.zweck + (haltepunkt
    ? '   (ANHALTEN vor dem dritten Aufruf -- dieser Lauf stellt NICHTS oeffentlich)'
    : '   (OEFFENTLICH STELLEN -- das laesst sich nicht zuruecknehmen)'));
  melde('  ausgestellt am:       ' + ermaechtigung.erstellt_am + '   (' +
    Math.round((jetzt() - Date.parse(ermaechtigung.erstellt_am)) / 1000) +
    ' Sekunden alt, hoechstens ' + (G.ERMAECHTIGUNG_GUELTIG_MS / 1000) + ')');
  melde('  fuer Aufnahme:        ' + ermaechtigung.aufnahme);
  melde('  fuer Videodatei:      sha256 ' + ermaechtigung.video_sha256);
  melde('  fuer das Video:       ' + ermaechtigung.videoId);
  melde('  beurteilter Titel:    ' + JSON.stringify(ermaechtigung.urteil.titel));
  melde('  beurteiltes Bild:     ' + ermaechtigung.urteil.thumbnail.dateiname +
    '   sha256 ' + ermaechtigung.urteil.thumbnail.sha256);
  melde('  Beschreibung (Pruefsumme beim Urteil): ' +
    String(ermaechtigung.urteil.beschreibung_sha256));
  melde('  fuer Kanal:           ' + ermaechtigung.kanal_name);

  // 3. ANMELDEN UND DER KANAL. Erst hier wird die Netzbibliothek geladen.
  try {
    kanal = await baueKanal();
  } catch (e) {
    return nein('anmeldung_fehlgeschlagen', 'die Anmeldung ist fehlgeschlagen.',
      [String(e && e.message ? e.message : e) + ' Es wurde nichts geaendert und die ' +
        'Ermaechtigung nicht verbraucht -- sie laeuft in hoechstens zwei Minuten ab.']);
  }
  let wer;
  try {
    wer = await kanal.nenneKanal();
  } catch (e) {
    return nein('kanal_nicht_lesbar', 'der Kanal liess sich nicht lesen.',
      [String(e && e.message ? e.message : e) + ' Es wurde nichts geaendert.']);
  }
  if (!wer.gefunden) {
    return nein('kein_kanal', 'es ist kein Kanal angemeldet.',
      ['Die Abfrage auf den eigenen Kanal liefert keinen. Es wurde nichts geaendert.']);
  }
  const k = G.pruefeKanal(ermaechtigung, wer.id, wer.name);
  if (!k.ok) {
    return nein(k.code, 'die zweite Ermaechtigung traegt nicht (' + k.code + ').', [k.meldung]);
  }

  // 4. VERBRAUCHEN, BEVOR IRGENDETWAS GESCHIEHT -- auch beim Haltepunkt.
  //    Bricht der Lauf danach ab, ist die Ermaechtigung trotzdem weg: ein
  //    zweiter Lauf braucht einen zweiten Klick, und dann sieht wieder ein
  //    Mensch hin.
  const verbraucht = G.verbraucheErmaechtigung({
    projektwurzel, pfad: bestaetigtDurch, daten: ermaechtigung, jetzt: jetzt(),
  });
  if (!verbraucht.ok) {
    return nein(verbraucht.code,
      'die zweite Ermaechtigung liess sich nicht verbrauchen (' + verbraucht.code + ').',
      [verbraucht.meldung]);
  }
  melde('');
  melde('ERMAECHTIGUNG VERBRAUCHT: vermerkt in ' + verbraucht.verbrauchtPfad);
  melde('  Datei ' + (verbraucht.geloescht
    ? 'geloescht: ' + bestaetigtDurch
    : 'NICHT geloescht (' + verbraucht.loeschgrund + ') -- sie ist aber vermerkt und gilt ' +
      'nicht mehr: ' + bestaetigtDurch));
  melde('  Kanal geprueft: die Kennung aus der Ermaechtigung ist die des angemeldeten ' +
    'Kanals "' + wer.name + '".');

  // 5. DER LAUF.
  let ergebnis;
  try {
    ergebnis = await fuehreOeffentlichLauf({
      befund, kanal, projektwurzel, exportOrdner, ermaechtigung, jetzt, melde,
    });
  } catch (e) {
    return nein('unerwarteter_fehler',
      'der Lauf ist mit einem unerwarteten Fehler abgebrochen.',
      [String(e && e.stack ? e.stack : e) + ' Ob der dritte Aufruf gemacht wurde, steht im ' +
        'Gedaechtnis: traegt der Eintrag einen oeffentlich_versuch ohne beendet_am, ist er ' +
        'hinausgegangen und die Antwort fehlt. Dann im Studio nachsehen.']);
  }
  if (!ergebnis.ok) {
    const stand = ergebnis.eintrag;
    meldeFehler('');
    meldeFehler(ersterSatz(stand));
    meldeFehler('');
    meldeFehler('ABBRUCH: der Lauf ist stehengeblieben (' + ergebnis.abbruch.code + ').');
    meldeFehler('');
    for (const zeile of U.umbrich(String(ergebnis.abbruch.satz), 74)) {
      meldeFehler('  ' + zeile);
    }
    meldeFehler('');
    meldeFehler('Gedaechtnis: ' + ergebnis.pfad);
    meldeFehler('Aufrufe in diesem Lauf: ' + (kanal.aufrufnamen().join(', ') || '(keine)'));
    meldeFehler('');
    return { code: EXIT_BEFUND, kanal,
      abbruch: { code: ergebnis.abbruch.code, ueberschrift: 'der Lauf ist stehengeblieben.',
        gruende: [ergebnis.abbruch.satz] } };
  }

  const text = abschlussOeffentlich({
    befund, ergebnis, gedaechtnisPfad: ergebnis.pfad, aufrufe: kanal.aufrufe(),
  }).join('\n');

  // DER HALTEPUNKT ENDET MIT 1, NICHT MIT 0 -- und das ist eine Entscheidung
  // dieses Baus, die im Bericht steht.
  //
  // Vertrag 6 sagt zu 0: "Der Schritt ist fertig." Der Haltepunkt ist nicht
  // fertig; das Video ist privat, und jemand wartet vielleicht darauf, dass es
  // das nicht mehr ist. Zu 1 sagt derselbe Vertrag: "oder er ist unterwegs
  // stehengeblieben", und genau das ist er -- absichtlich. Ein 0 hier hiesse,
  // dass ein abgebrochener Ablauf und ein vollendeter denselben Wert tragen,
  // und das ist der Umriss jedes Fehlers dieser Reihe. Der Text sagt in seinem
  // ersten Satz, was Sache ist; der Rueckgabewert widerspricht ihm nicht.
  if (ergebnis.angehalten) {
    meldeFehler(text);
    return { code: EXIT_BEFUND, kanal, abbruch: null, angehalten: true,
      eintrag: ergebnis.eintrag };
  }
  melde(text);
  return { code: EXIT_OK, kanal, abbruch: null, angehalten: false, eintrag: ergebnis.eintrag };
}

// NACH der Vorschau und auf stderr -- beides absichtlich.
//
// Auf stderr, weil stdout die Vorschau fuer Menschen ist und ohne dieses
// Argument Byte fuer Byte bleiben soll, was sie ist (dasselbe Argument wie
// beim Shorts-Uploader, DR).
//
// NACH der Vorschau, weil im Abbruchfall beide in DENSELBEN Strom gehen: die
// Vorschau steht dann zuerst und vollstaendig da, und die eine Zeile haengt
// hinten dran. Ein Mensch im Terminal, der das Argument selbst gar nicht
// tippt, sieht sie nie; der Dienst, der es tippt, nimmt sie wieder heraus.
function schreibeBefundzeile(gewuenscht, zeile) {
  if (!gewuenscht) return;
  console.error(JSON.stringify(zeile));
}

if (require.main === module) {
  main().catch((e) => {
    console.error('');
    console.error('FEHLER: ' + (e && e.message ? e.message : e));
    console.error('Der Lauf ist abgebrochen. Ob ein Video auf dem Kanal liegt, steht im');
    console.error('Gedaechtnis unter data/' + G.GEDAECHTNIS_ORDNER + '/; ein neuer Lauf setzt');
    console.error('dort an, wo dieser stehengeblieben ist, und laedt kein zweites hoch.');
    console.error('');
    process.exit(EXIT_BEFUND);
  });
}

module.exports = {
  ERLAUBTE_ARGUMENTE, ERLAUBTE_ANGABEN,
  EXIT_OK, EXIT_BEFUND, EXIT_AUFRUFFEHLER, EXIT_GESPERRT,
  RENDER_WURZEL_SCHLUESSEL, EXPORT_ORDNER_SCHLUESSEL,
  VIDEO_ENDUNG, RENDER_NAME_FORM, GROESSE_ABWEICHUNG_ANTEIL, GROESSE_MINDESTENS_ANDERE,
  THUMBNAIL_MAX_BYTES, TAGS_MAX_ZEICHEN, FESTE_KANAL_HASHTAGS, BILDTYP_JE_ENDUNG,
  GESPERRTE_AUFNAHMEN, pruefeSperrliste, sperreFuer,
  videoDateiname, befundeVideodatei, vergleicheGroesse,
  leiteTagsAb, leiteTagsAbVertauscht, hinweiseZuTags, baueLongformMetadaten,
  trockenlauf, gewaehlterZettel, vorschau, umbrucheIn,
  BEFUND_ARTIFACT_TYPE, BEFUND_SCHEMA_VERSION, RANG_ART,
  bestimmtesBild, bildhinweise, befundJson, bindungsZeile,

  // Die schreibende Haelfte (EP).
  WARTEGRENZE_MS, ABFRAGEABSTAND_MS, YOUTUBE_AUSKUENFTE, WIEDEREINSTIEG,
  PROCESSING_FERTIG, PROCESSING_LAEUFT, PROCESSING_FEHLGESCHLAGEN, PROCESSING_TERMINIERT,
  UPLOAD_ENDE_SCHLECHT,
  ersterSatz, feinerRang, thumbnailEintrag, bindung,
  pruefeThumbnailZiel, pruefeBildAufDerPlatte, BILD_FOLGE_VOR_AUFRUF_2,
  leseGedaechtnisFuerBefund,
  verarbeitungsstand, kurzfassung, gruendeSatz,
  fuehreLongformLauf, abschlussSaetze, scharferLauf,

  // EU: der dritte Aufruf.
  frageBlock, zweiteBindung, zweiteBindungsZeile,
  fuehreOeffentlichLauf, abschlussOeffentlich, oeffentlicherLauf,
};
