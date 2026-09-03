'use strict';

// DH: Der Uebergabe-Leser. Erster Bewohner von src/upload/.
//
// Er liest die Uebergabedatei EINER Aufnahme, prueft sie streng gegen den
// Vertrag ("Uebergabe: fertige Shorts an das Upload-Projekt", Abschnitt 3) und
// meldet. Er zeigt nichts an, entscheidet nichts, laedt nichts hoch und
// schreibt keine Zustandsdatei. Planer und Uploader kommen spaeter.
//
// WARUM HIER WEDER --execute NOCH --nur-pruefen STEHT: Dieses Skript schreibt
// nichts und ruft nichts auf -- ein Trockenlauf waere von einem scharfen Lauf
// nicht zu unterscheiden, also gibt es die Unterscheidung nicht. Das Fehlen der
// beiden projektueblichen Flags ist Absicht, kein Versehen.
//
// WARUM --ohne-platte TROTZDEM DAZUGEHOERT (DIb): Es ist kein Trockenlauf. Ein
// Trockenlauf tut so, als taete er etwas; --ohne-platte tut WENIGER und sagt
// das laut. Die beiden Laeufe sind an der Ausgabe zu unterscheiden --
// plattenpruefung:false, eine Anmerkung im Klartext, eine eigene
// Ergebniszeile, und `daten` bleibt bei jedem Eintrag leer. Genau daran
// haengt der Unterschied: was der Leser nicht nachgesehen hat, reicht er auch
// nicht weiter.

const { pruefeArgumenteStrikt } = require('../publish/cli-args');

// ---------------------------------------------------------------------------
// DIE RUECKGABEWERTE VON src/upload/ -- DIE EINE STELLE (DNa Punkt 2)
// ---------------------------------------------------------------------------
//
// WARUM SIE HIER STEHT UND NICHT DREIMAL: Vor DNa hatte jede der drei Dateien
// ihre eigenen Konstanten. Dieselbe Zahl stand dreimal da, unter drei Namen
// (EXIT_MANGEL im Leser, EXIT_ABBRUCH im Freigabedienst, EXIT_MANGEL im
// Planer), und niemand konnte sehen, ob sie noch dasselbe bedeuteten. Genau so
// ist die Doppelbelegung entstanden, die DNa aufraeumt: Der Planer vergab 3
// fuer "gesperrte Aufnahme", die inzwischen archivierte upload-probe vergab 3
// fuer "konnte nicht fragen" (Berichte DGa Abschnitt 7, DGb Abschnitt 2).
// Zwei Bedeutungen unter einer Zahl sind der Anfang einer Verwechslung.
//
// Diese Datei ist der Ort dafuer, weil die beiden anderen sie ohnehin schon
// laden (freigabe-server.js und planer.js holen hier pruefeKeineFreienArgumente
// und AUFNAHME_FORM). Es entsteht also keine neue Abhaengigkeit.
//
// 0, 1 UND 2 SIND VERTRAG UND WERDEN NICHT ANGETASTET. Sie sind im Bericht
// ZUSAGE-freigabedienst-aufruf.md, Abschnitt 5, gegenueber der
// aufrufenden Seite zugesagt. Die Beschreibungen hier verallgemeinern die
// Zusage auf alle drei Skripte, ohne die Bedeutung zu verschieben:
//
//   Zusage (Freigabedienst)        ->  hier (alle drei)
//   0 geordnetes Sitzungsende      ->  0 fertig, nichts zu beanstanden
//   1 lief und lehnte den START ab ->  1 lief, sah nach, lehnte ab
//   2 lief nicht (Aufruf falsch)   ->  2 der Aufruf war falsch
//
// WIE EIN CODE DAZUKOMMT: hier eintragen, mit Wert, Name und einem Satz, der
// sagt WANN er faellt -- nicht, was das Programm dabei tut. Ein Test in
// tests/uebergabe-leser.test.cjs haelt fest, dass kein Wert, kein Name und
// keine Bedeutung zweimal vorkommt.
const EXIT_CODES = [
  {
    wert: 0, name: 'OK',
    bedeutung: 'Fertig. Das Programm ist geordnet zu Ende gekommen und hat nichts zu beanstanden.',
  },
  {
    wert: 1, name: 'BEFUND',
    bedeutung: 'Das Programm lief, hat die Lage angesehen und lehnt ab. Der Grund liegt in den ' +
      'Daten oder im Zustand der Platte, nicht im Aufruf.',
  },
  {
    wert: 2, name: 'AUFRUF',
    bedeutung: 'Der Aufruf war falsch. Es wurde nichts gelesen, nichts geschrieben und kein ' +
      'Netzaufruf gemacht -- alle Pruefungen dieser Gruppe laufen vor dem ersten Zugriff.',
  },
  {
    wert: 3, name: 'GESPERRT',
    bedeutung: 'Eine benannte, begruendete Sperre im Quelltext greift. Das Programm weigert ' +
      'sich aus einer eingetragenen Regel heraus, nicht wegen der Daten.',
  },
  {
    // IN GEBRAUCH seit DO: der Uploader vergibt diesen Wert, wenn er vor dem
    // ersten Upload nicht fragen kann (src/upload/uploader.js,
    // EXIT_KEINE_ANTWORT). Bis dahin war er reserviert -- er stand hier, damit
    // die zweite Bedeutung von 3 einen eigenen Platz hat: die archivierte
    // upload-probe meldete mit 3, dass sie den Menschen nicht fragen konnte
    // (Eingabe weggefallen). Kommt so etwas zurueck, bekommt es 4 und nicht
    // wieder 3.
    wert: 4, name: 'KEINE_ANTWORT',
    bedeutung: 'Es konnte nicht gefragt werden -- die Eingabe ist weggefallen. Das Programm hat ' +
      'weder eine Zustimmung noch eine Ablehnung gehoert.',
  },
];

// Der Nachschlagewert: EXIT.OK, EXIT.BEFUND, ... Aus der Tabelle gebaut, damit
// die Zahl genau einmal im Projekt steht.
const EXIT = Object.freeze(Object.fromEntries(EXIT_CODES.map((c) => [c.name, c.wert])));

// pruefeArgumenteStrikt als ALLERERSTE Anweisung des Programms -- vor jedem
// Lesen, vor jedem Kindprozess. Nur so kann ein Tippfehler im Aufruf nicht
// mehr als "ist halt durchgelaufen" enden (CY Teil B).
const ERLAUBTE_ARGUMENTE = ['--aufnahme=', '--wurzel=', '--json', '--ohne-platte'];

// DJb: pruefeArgumenteStrikt sieht NUR Argumente, die mit '-' beginnen -- so
// steht es in src/publish/cli-args.js, und das ist dort auch richtig: Skripte
// mit Dateinamen oder Modusworten brauchen freie Argumente.
//
// DIESE BEIDEN SKRIPTE BRAUCHEN KEINE. Beide nehmen ausschliesslich benannte
// Argumente, und genau daran hing ein Fehlgriff, der lange harmlos aussah:
//
//     --aufnahme=2026-08-29 18-18-19        (ohne Anfuehrungszeichen)
//
// zerfaellt in --aufnahme=2026-08-29 und ein freies "18-18-19". Das freie
// Argument beginnt nicht mit '-', pruefeArgumenteStrikt sieht es nie, und das
// Programm lief mit einer abgeschnittenen Aufnahme weiter. Die Meldung, die
// dann kam, gehoerte nicht zu dem Fehler, den es gab.
//
// Die Aufzaehlung im Kopf von cli-args.js nennt fuer diesen Fall ein
// maxPositional -- das gibt es dort nicht, es steht nur im Kommentar
// (gemessen in DJb). Bis es das gibt, steht die Pruefung hier.
// DNa Punkt 1: DER FLAGNAME IST EIN PARAMETER, KEINE KONSTANTE.
//
// Bis DNa stand hier '--aufnahme=' fest verdrahtet. Das war fuer die beiden
// ersten Aufrufer richtig und fuer den dritten falsch: der Planer heisst
// --freigabe=. Wer den Aufnahmenamen ohne Anfuehrungszeichen tippte, bekam von
// ihm einen Vorschlag mit einem Argument, das er nicht kennt -- eine Meldung,
// die den Fehler benennt und dann in die Irre schickt. Gemessen in DN,
// Abschnitt 7.
//
// Der Beispielname kommt jetzt ausserdem aus dem, was der Mensch WIRKLICH
// getippt hat, und nicht aus einem festen Namen im Quelltext. Das feste
// Beispiel war '2026-08-29 18-18-19' -- ausgerechnet die Aufnahme, die der
// Planer seit DN sperrt. Ein Vorschlag, der auf eine gesperrte Aufnahme zeigt,
// ist schlechter als keiner.
function pruefeKeineFreienArgumente(argv, skriptname, flagname) {
  // Diese Pruefung laeuft bei JEDEM Aufruf, auch beim erfolgreichen: ein
  // Aufrufer, der den Flagnamen vergisst, soll sofort auffallen und nicht erst
  // an dem Tag, an dem jemand die Anfuehrungszeichen vergisst.
  if (typeof flagname !== 'string' || !flagname.endsWith('=')) {
    throw new Error('pruefeKeineFreienArgumente: flagname fehlt oder endet nicht auf "=" (' +
      JSON.stringify(flagname) + '). Der Aufrufer muss sein eigenes Argument benennen -- ' +
      'diese Funktion bedient drei Skripte mit drei verschiedenen Namen.');
  }
  const frei = argv.slice(2).filter((t) => !t.startsWith('-'));
  if (!frei.length) return;
  console.error('\nAbbruch: freie Argumente gibt es hier nicht: ' +
    frei.map((t) => JSON.stringify(t)).join(', '));
  // Der haeufigste Fall bekommt seinen eigenen Satz. Ein loses "18-18-19"
  // ratlos zu melden waere richtig und trotzdem nutzlos -- wer es sieht, sucht
  // dann im Skript statt in seiner eigenen Zeile.
  const rest = frei.find((t) => /^\d{2}-\d{2}-\d{2}$/.test(t));
  if (rest !== undefined) {
    console.error('');
    console.error('Das sieht aus wie der Rest eines Aufnahmenamens. Ein Aufnahmename');
    console.error('enthaelt ein Leerzeichen und muss darum in Anfuehrungszeichen stehen --');
    console.error('ohne sie zerfaellt er in zwei Argumente, und der zweite landet hier.');
    console.error('');
    console.error('So geht es, ohne npm dazwischen:');
    console.error('  node ' + skriptname + ' ' + flagname + '"' +
      beispielAufnahme(argv, flagname, rest) + '"');
  }
  console.error('');
  console.error('Es wurde NICHTS geschrieben und kein Netzaufruf gemacht.\n');
  process.exit(EXIT.AUFRUF);
}

// Setzt den zerfallenen Aufnahmenamen wieder zusammen: aus dem Datumsteil, der
// noch am Flag haengt, und dem Uhrzeitteil, der als freies Argument uebrig
// blieb. Geht das nicht, bleibt es bei der Form -- ein erfundener Name waere
// hier schlechter als ein Platzhalter, den man als Platzhalter erkennt.
function beispielAufnahme(argv, flagname, rest) {
  const traeger = argv.slice(2).find((t) => t.startsWith(flagname));
  const datum = traeger === undefined ? null : traeger.slice(flagname.length);
  if (datum !== null && /^\d{4}-\d{2}-\d{2}$/.test(datum)) return datum + ' ' + rest;
  return 'JJJJ-MM-TT HH-MM-SS';
}

if (require.main === module) {
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/upload/uebergabe-leser.js');
  pruefeKeineFreienArgumente(process.argv, 'src/upload/uebergabe-leser.js', '--aufnahme=');
}

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Die gewohnten Namen dieses Skripts, aus der EINEN Tabelle oben bezogen. Der
// Name bleibt, weil er hier den Fall besser beschreibt als der allgemeine
// ("Mangel" ist im Leser genauer als "Befund"); die Zahl steht nur einmal.
const EXIT_OK = EXIT.OK;
const EXIT_MANGEL = EXIT.BEFUND;
const EXIT_AUFRUFFEHLER = EXIT.AUFRUF;

// ---------------------------------------------------------------------------
// Der Vertrag in Zahlen und Zeichenketten.
// ---------------------------------------------------------------------------

const ARTIFACT_TYPE = 'matrix_auto_cutter_shorts_uebergabe';

// Heute ist genau eine Fassung bekannt. Eine unbekannte Fassung wird ABGELEHNT
// und NICHT nach den Regeln der bekannten weitergelesen: die Gegenseite hat
// zugesagt, dass bei jeder Aenderung diese Nummer steigt -- eine hoehere Nummer
// heisst also, dass hier Regeln fehlen, nicht dass dort ein Feld fehlt.
const BEKANNTE_SCHEMA_VERSIONEN = ['1.0'];

const DATEINAME = 'uebergabe.json';

// Form JJJJ-MM-TT HH-MM-SS.
const AUFNAHME_FORM = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/;
// ISO-8601 mit Zonenversatz; "Z" ist der Versatz +00:00 und zaehlt mit.
const ISO_MIT_VERSATZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// EH: DIE Form einer sha256 -- genau 64 Hexziffern in Kleinschreibung.
//
// Sie stand bis hierher an drei Stellen im Repo (hier, planer.js, uploader.js)
// und war an keiner exportiert; der Beipackzettel-Leser haette sie zum vierten
// Mal hinschreiben muessen. Vier Fassungen einer Regel sind auf Dauer zwei:
// eine, die jemand korrigiert, und drei, die es nicht mitbekommen.
//
// Sie steht hier, weil dieses Modul die Wurzel der Kette ist -- planer.js,
// uploader.js, freigabe-server.js, uebersicht.js und zettel-leser.js laden es,
// es laedt keines von ihnen. Und sie steht neben AUFNAHME_FORM, wo die
// Schwesterregel schon steht.
//
// Nicht dasselbe, und darum ausdruecklich NICHT hierher zusammengefuehrt:
// uploader.js/ZUFALL_FORM (32 Zufallsbytes als Hex -- gleiche Gestalt, andere
// Frage; wird der Zufall eines Tages laenger, darf diese Regel sich nicht
// mitbewegen) und die weitere Form in pruefeEintrag unten, die
// Grossbuchstaben ZULAESST, um "falsch geschrieben" von "keine Hexziffern" zu
// unterscheiden. tests/uebergabe-leser.test.cjs haelt beides fest.
const SHA256_FORM = /^[0-9a-f]{64}$/;

const PFLICHTFELDER = [
  'kennung', 'pfad', 'sha256', 'groesse_bytes', 'dauer_ms', 'breite', 'hoehe',
  'titel_vorschlag', 'transkript', 'quelle_von_ms', 'quelle_bis_ms', 'urteil',
];

// ---------------------------------------------------------------------------
// DIb: WAS DURCHGEREICHT WIRD, IST GENAU DAS, WAS GEPRUEFT WURDE.
//
// Die Freigabeoberflaeche soll die Uebergabedatei NICHT selbst lesen. Taete sie
// es, gaebe es einen zweiten Leser ohne die Pfadsperre unten -- direkt neben
// den Ordnern mit den fehlerhaften Fassungen, die am Inhalt nicht von den guten
// zu unterscheiden sind. Der Leser bleibt der einzige, der die Datei anfasst,
// und reicht unter `daten` weiter, was er geprueft hat.
//
// DIE REGEL, UND SIE IST DER GANZE PUNKT DIESES FELDES:
// Ein Feld steht hier NUR, solange eine Pruefung dahintersteht. Faellt eine
// Pruefung weg, faellt das Feld aus dieser Liste -- oder die Pruefung kommt
// zurueck. Ein Feld in `daten` ohne Pruefung dahinter ist eine stille Zusage:
// die Oberflaeche zeigt einen Wert, fuer den niemand geradesteht, und niemand
// sieht, dass niemand geradesteht.
//
// Die Liste ist DESHALB dieselbe wie PFLICHTFELDER und nicht laenger: jedes
// dieser zwoelf Felder wird unten in pruefeEintrag gegen den Vertrag gehalten,
// und tests/uebergabe-leser.test.cjs bricht jedes einzelne davon absichtlich
// kaputt und verlangt einen Mangel dazu. Unbekannte Felder gehen NICHT mit --
// sie sind ungeprueft und stehen weiterhin allein unter `unbekannteFelder`.
const DURCHGEREICHTE_FELDER = PFLICHTFELDER;

// DJb: DIE FELDSCHLEIFEN, ALS DATEN.
//
// Vier Pruefungen laufen nicht ueber ein einzelnes Feld, sondern ueber eine
// LISTE von Feldern. An diesen Aufrufstellen steht darum eine Variable, wo
// sonst ein Feldname steht -- m(feld, 'zahl_keine_ganzzahl', ...) statt
// m('dauer_ms', ...). Kein Textsuchlauf ueber den Quelltext kann diese Maengel
// einem Feld zuordnen; er saehe nur die Variable.
//
// Genau daran ist die Zahl im Kommentar oben in DIb falsch geworden: gezaehlt
// wurden die Aufrufstellen mit sichtbarem Feldnamen, und feld_fehlt aus der
// PFLICHTFELDER-Schleife fiel hinten herunter.
//
// Deshalb stehen die vier Listen ab hier als benannte Daten und werden von den
// Schleifen unten benutzt statt dort ein zweites Mal hingeschrieben. Aus
// FELDSCHLEIFEN plus den Aufrufstellen mit sichtbarem Feldnamen laesst sich
// dann vollstaendig ableiten, welche Codes auf welches Feld fallen koennen --
// das tut der Test, und er prueft ausserdem, dass es KEINE fuenfte Schleife
// gibt, die er nicht kennt.
const GANZZAHL_POSITIV_FELDER = ['groesse_bytes', 'dauer_ms'];
const GANZZAHL_FELDER = ['breite', 'hoehe', 'quelle_von_ms', 'quelle_bis_ms'];
const TEXT_FELDER = ['titel_vorschlag', 'transkript'];

const FELDSCHLEIFEN = Object.freeze([
  Object.freeze({ liste: 'PFLICHTFELDER', felder: PFLICHTFELDER,
    codes: Object.freeze(['feld_fehlt']) }),
  Object.freeze({ liste: 'GANZZAHL_POSITIV_FELDER', felder: GANZZAHL_POSITIV_FELDER,
    codes: Object.freeze(['zahl_keine_ganzzahl', 'zahl_nicht_positiv']) }),
  Object.freeze({ liste: 'GANZZAHL_FELDER', felder: GANZZAHL_FELDER,
    codes: Object.freeze(['zahl_keine_ganzzahl']) }),
  Object.freeze({ liste: 'TEXT_FELDER', felder: TEXT_FELDER,
    codes: Object.freeze(['text_leer']) }),
]);

// Toleranz fuer dauer_ms gegen (quelle_bis_ms - quelle_von_ms), beidseitig.
// Gemessen in DD ueber zehn Dateien: groesste Abweichung 13 ms, Bereich -13 bis
// +10. Die Grenze liegt bewusst ueber diesem Maximum; die theoretische Schranke
// ist ein volles Bild bei 60 fps (16,67 ms) plus Rundung.
const TOLERANZ_MS = 20;

// Abschnitt 6 des Vertrags. Das sind Eigenschaften des Encoders: sie folgen aus
// der Einstellung, mit der gerendert wird, und sind deshalb echte Zusagen. Wer
// eine davon verletzt, hat anders gerendert als vereinbart.
const ZUSICHERUNG = {
  breite: 1080,
  hoehe: 1920,
  fps: 60,
  videoCodec: 'h264',
  videoProfil: 'High',
  videoLevel: 42,
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioProfil: 'LC',
  abtastrate: 48000,
  kanaele: 2,
  kanalbild: 'stereo',
};

// DHb (2026-08-31): DIE DAUERSPANNE IST KEINE ZUSICHERUNG.
//
// Abschnitt 6 des Vertrags ist ueberschrieben "Gemessen an 113 fertigen
// Shorts". Aufloesung, Bildrate, Codec und Tonformat stehen dort als
// Encoder-Einstellungen -- die sagt jemand zu. Die Spanne 6,9 bis 18,7 s ist
// etwas anderes: sie ist die Spanne, die in 113 Stichproben VORKAM. Niemand hat
// zugesagt, dass der naechste Short nicht 5 oder 25 Sekunden lang ist; die
// Laenge folgt aus dem Material, nicht aus einer Einstellung.
//
// In DH stand sie faelschlich als Ablehnungsgrund im Leser. Ein Leser, der
// einen einwandfreien Short wegen einer Beobachtung ablehnt, schickt einen
// Menschen auf die Suche nach einem Defekt, den es nicht gibt.
//
// Seither zwei getrennte Grenzen:
//   VERNUNFT   -- was ausserhalb liegt, ist kaputt oder kein Short. MANGEL.
//                 Unter 1 s kann kein Short sein, ueber 3 min ist keiner mehr.
//                 Bewusst so weit gesetzt, dass sie nie versehentlich greift.
//   BEOBACHTET -- die Spanne aus den 113 Dateien. Wer sie verlaesst, bekommt
//                 einen HINWEIS und wird trotzdem angenommen.
const VERNUNFT_MIN_MS = 1000;
const VERNUNFT_MAX_MS = 180000;
const BEOBACHTET_MIN_MS = 6900;
const BEOBACHTET_MAX_MS = 18700;
const BEOBACHTET_STICHPROBEN = 113;

// ---------------------------------------------------------------------------
// DIE HARTE SPERRE GEGEN ZUSAMMENGEBAUTE PFADE
//
// Die eine Regel des Vertrags (Abschnitt 2): Was nicht in der Uebergabedatei
// steht, wird nicht angefasst. Kein Absuchen von Ordnern, kein Erraten von
// Dateinamen, kein Ableiten aus der Ordnerstruktur.
//
// Der Grund ist handfest und keine Vorsichtsmassnahme: Neben den guten Shorts
// liegen Ordner mit fehlerhaften Fassungen (doppelter Avatar, falsche
// Kamerafuehrung). Sie sind am Inhalt NICHT von den guten zu unterscheiden --
// gleicher Name, gleiche Indizes, gleiche Titel, gleiche Zeiten -- und ihre
// internen Pfadangaben zeigen sogar auf den guten Ordner. Ein Programm, das
// Ordner absucht, laedt sie frueher oder spaeter hoch.
//
// Deshalb steht die Regel hier als Sperre und nicht als Kommentar: Jeder Pfad,
// der auf die Platte geht, muss vorher WOERTLICH aus der Uebergabedatei
// registriert worden sein. Ein zusammengebauter, ergaenzter oder normalisierter
// Pfad wird nicht geoeffnet, sondern wirft.
//
// Die EINZIGE Ausnahme ist der Weg zur Uebergabedatei selbst (Wurzel +
// Aufnahme + fester Dateiname) -- die muss irgendwo herkommen. Sie hat ihre
// eigene Funktion (uebergabedateiPfad) und ist die einzige Stelle im Modul,
// die path.join verwendet; tests/uebergabe-leser.test.cjs haelt das fest.
// ---------------------------------------------------------------------------

function neueSperre() {
  const woertlich = new Set();
  return {
    // Registriert einen Wert, so wie er in der Datei stand -- unveraendert.
    ausDatei(wert) {
      if (typeof wert === 'string') woertlich.add(wert);
      return wert;
    },
    // Torwaechter vor jedem Plattenzugriff.
    oeffnen(pfad) {
      if (!woertlich.has(pfad)) {
        throw new Error(
          'Pfadsperre: ' + JSON.stringify(pfad) + ' stand nicht woertlich in der ' +
          'Uebergabedatei. Es wird kein Pfad zusammengebaut, kein Ordner abgesucht ' +
          'und kein Dateiname erraten.'
        );
      }
      return pfad;
    },
  };
}

// Die einzige Pfadkonstruktion des Moduls.
function uebergabedateiPfad(wurzel, aufnahme) {
  return path.join(wurzel, aufnahme, DATEINAME);
}

// ---------------------------------------------------------------------------
// Maengel
// ---------------------------------------------------------------------------

// DIb: JEDER MANGEL TRAEGT EINEN CODE.
//
// Bis DIa war ein Mangel nur durch `feld` plus Fliesstext bezeichnet. Das
// reicht nicht: auf ein einziges Feld fallen mehrere verschiedene Maengel.
//
// DJb: DIE ZAHLEN, UND WELCHE MENGE JEDE MEINT. In DIb standen hier "vier"
// und "fuenf"; beide waren zu klein, weil sie die Codes aus den
// Feldschleifen (feld_fehlt, zahl_*, text_leer) nicht mitgezaehlt haben.
//
//   feld="dauer_ms"   FUENF Codes, alle aus der Vertragspruefung:
//                     feld_fehlt, zahl_keine_ganzzahl, zahl_nicht_positiv,
//                     dauer_weicht_von_quellspanne, dauer_ausserhalb_vernunft
//
//   feld="sha256"     FUENF aus der Vertragspruefung:
//                     feld_fehlt, sha256_kein_text, sha256_laenge,
//                     sha256_grossbuchstaben, sha256_keine_hexziffern
//                     SIEBEN mit der Plattenpruefung, die zwei eigene hat:
//                     sha256_stimmt_nicht, sha256_nicht_vergleichbar
//
// Beide Zahlen sind gegen den Quelltext abgesichert und nicht abgeschrieben:
// tests/uebergabe-leser.test.cjs leitet sie aus den Aufrufstellen und aus
// FELDSCHLEIFEN unten her und vergleicht. Wer eine Pruefung hinzufuegt, ohne
// diesen Kommentar anzufassen, bekommt einen roten Test.
//
// Wer sie auseinanderhalten wollte, musste die Meldung
// lesen -- und die Meldung ist das Einzige an dieser Ausgabe, das sich
// jederzeit aendern darf. Der Fliesstext ist fuer Menschen, der Code ist fuer
// Programme; beide stehen nebeneinander, keiner ersetzt den anderen.
//
// Die Codes sind STABIL. Ein Code wird nicht umbenannt und nicht
// weiterverwendet; verschwindet eine Pruefung, verschwindet ihr Code mit ihr.
//
// Dieses Verzeichnis ist die einzige Quelle: mangel() unten WIRFT bei einem
// unbekannten Code. Ein Mangel ohne Code kann damit gar nicht erst entstehen --
// er faellt auf, statt durchzugehen.
const MANGEL_CODES = Object.freeze({
  // --- Kopf ---------------------------------------------------------------
  kopf_json_abgeschnitten: 'Die Datei ist mitten im Schreiben abgebrochen.',
  kopf_json_ungueltig: 'Die Datei ist vollstaendig, aber kein gueltiges JSON.',
  kopf_kein_objekt: 'An oberster Stelle steht kein JSON-Objekt.',
  kopf_artifact_type_falsch: 'artifact_type gehoert nicht zu diesem Vertrag.',
  kopf_schema_version_unbekannt: 'schema_version ist keine bekannte Fassung.',
  kopf_aufnahme_form: 'aufnahme hat nicht die Form JJJJ-MM-TT HH-MM-SS.',
  kopf_aufnahme_ungleich_ordner: 'aufnahme nennt einen anderen Ordner als den gelesenen.',
  kopf_erzeugt_am_ungueltig: 'erzeugt_am ist kein ISO-8601-Zeitpunkt mit Zonenversatz.',
  kopf_shorts_keine_liste: 'shorts ist keine Liste.',
  kopf_shorts_leer: 'shorts ist eine leere Liste.',

  // --- Vertrag, je Eintrag -------------------------------------------------
  eintrag_kein_objekt: 'Der Eintrag ist kein Objekt.',
  feld_fehlt: 'Ein Pflichtfeld fehlt ganz.',
  kennung_kein_text: 'kennung ist kein nicht-leerer Text.',
  kennung_form: 'kennung hat nicht die Form <aufnahme>/<index>.',
  kennung_doppelt: 'kennung kommt in derselben Datei mehrfach vor.',
  pfad_kein_text: 'pfad ist kein nicht-leerer Text.',
  pfad_nicht_absolut: 'pfad ist nicht absolut.',
  pfad_ausserhalb_wurzel: 'pfad liegt nicht unterhalb der eingestellten Wurzel.',
  sha256_kein_text: 'sha256 ist kein Text.',
  sha256_laenge: 'sha256 hat nicht genau 64 Zeichen.',
  sha256_grossbuchstaben: 'sha256 enthaelt Grossbuchstaben.',
  sha256_keine_hexziffern: 'sha256 enthaelt Zeichen, die keine Hexziffern sind.',
  zahl_keine_ganzzahl: 'Ein Zahlenfeld ist keine Ganzzahl.',
  zahl_nicht_positiv: 'Ein Zahlenfeld ist nicht groesser als 0.',
  text_leer: 'Ein Textfeld ist leer.',
  quelle_spanne_nicht_positiv: 'quelle_bis_ms ist nicht groesser als quelle_von_ms.',
  urteil_nicht_ja: 'urteil ist nicht exakt "ja".',
  dauer_weicht_von_quellspanne: 'dauer_ms weicht zu weit von der Quellspanne ab.',
  dauer_ausserhalb_vernunft: 'dauer_ms liegt ausserhalb jeder Vernunftgrenze.',

  // --- Platte --------------------------------------------------------------
  platte_uebersprungen_pfad_ungueltig:
    'Die Plattenpruefung entfiel, weil pfad schon den Vertrag verletzt.',
  datei_nicht_lesbar: 'Die Datei ist nicht vorhanden oder nicht lesbar.',
  pfad_keine_datei: 'Der Pfad zeigt auf etwas, das keine Datei ist.',
  groesse_stimmt_nicht: 'groesse_bytes stimmt nicht mit der Datei ueberein.',
  sha256_stimmt_nicht: 'sha256 stimmt nicht mit der gemessenen Pruefsumme ueberein.',
  sha256_nicht_vergleichbar: 'sha256 war schon als Feld ungueltig und blieb unverglichen.',
  format_nicht_pruefbar: 'ffprobe war nicht ausfuehrbar; das Format blieb ungeprueft.',
  videospuren_anzahl: 'Die Datei hat nicht genau eine Videospur.',
  aufloesung_abweichend: 'Die Aufloesung entspricht nicht der Zusicherung.',
  masse_stimmen_nicht: 'breite/hoehe stimmen nicht mit der Datei ueberein.',
  bildrate_abweichend: 'Die Bildrate entspricht nicht der Zusicherung.',
  videocodec_abweichend: 'Videocodec, Profil oder Level entsprechen nicht der Zusicherung.',
  pixelformat_abweichend: 'Das Pixelformat entspricht nicht der Zusicherung.',
  tonspuren_anzahl: 'Die Datei hat nicht genau eine Tonspur.',
  toncodec_abweichend: 'Toncodec oder Profil entsprechen nicht der Zusicherung.',
  abtastrate_abweichend: 'Die Abtastrate entspricht nicht der Zusicherung.',
  tonkanaele_abweichend: 'Kanalzahl oder Kanalbild entsprechen nicht der Zusicherung.',
});

// ebene: 'Kopf' | 'Vertrag' | 'Platte'
// eintrag: Kennung oder "#<index>", wenn die Kennung selbst unbrauchbar ist
// feld: Feldname oder null
// code: Schluessel aus MANGEL_CODES -- Pflicht, siehe dort
function mangel(ebene, eintrag, feld, code, meldung) {
  if (!Object.prototype.hasOwnProperty.call(MANGEL_CODES, code)) {
    // Kein stiller Ausweg auf null oder auf den Feldnamen: ein Mangel ohne
    // eingetragenen Code ist ein halb gebauter Mangel, und der faellt hier auf.
    throw new Error(
      'Mangel ohne eingetragenen Code: ' + JSON.stringify(code) + '. Jeder Mangel ' +
      'braucht einen Schluessel aus MANGEL_CODES -- erst eintragen, dann melden.'
    );
  }
  return { ebene, eintrag, feld, code, meldung };
}

// DHb: der dritte Zustand.
//
// Ein Hinweis ist etwas, das ein Mensch sehen soll, das aber KEIN Verstoss
// gegen den Vertrag ist. Er wird getrennt gefuehrt und getrennt gezaehlt:
//   - Ein Eintrag mit Hinweisen und ohne Maengel gilt als ANGENOMMEN.
//   - Hinweise aendern den Rueckgabewert des Programms nicht. Exit 1 kommt
//     ausschliesslich von Maengeln.
// Beides ausdruecklich, damit ein Hinweis nicht zum halben Mangel wird: wer
// Hinweise mitzaehlt, macht sie in kurzer Zeit unbrauchbar, weil dann jeder
// versucht, sie loszuwerden.
//
// DIb: Ein Hinweis traegt KEINEN Code. Es gibt heute genau eine Art Hinweis
// (dauer_ms ausserhalb der beobachteten Spanne), und feld="dauer_ms" bezeichnet
// sie eindeutig -- anders als bei den Maengeln, wo dasselbe Feld vier Faelle
// traegt. Kommt eine zweite Art dazu, ist dieselbe Not da wie bei den Maengeln,
// und dann gehoert hier ein HINWEIS_CODES-Verzeichnis daneben.
function hinweis(ebene, eintrag, feld, meldung) {
  return { ebene, eintrag, feld, meldung };
}

// ---------------------------------------------------------------------------
// Einlesen und Parsen
// ---------------------------------------------------------------------------

// EIN PARSERFEHLER IST KEINE LEERE AUFNAHME.
//
// Die Gegenseite schreibt die Datei bewusst NICHT atomar -- im Aufnahmeordner
// darf nichts ausser dieser Datei entstehen, auch nichts Voruebergehendes. Ein
// Absturz mitten im Schreiben hinterlaesst also eine halbe JSON-Datei. Wer die
// dann als "keine Shorts" auslegt, meldet Ruhe, wo ein Fehler ist.
//
// Erkannt wird das nicht am Wortlaut der V8-Fehlermeldung (der aendert sich mit
// der Node-Fassung), sondern an der Form: ein abgeschnittenes JSON-Dokument hat
// am Ende offene Klammern oder eine offene Zeichenkette. Beides ist deutlich
// und haengt an nichts Fremdem.
function istAbgeschnitten(text) {
  if (!text.trim()) return true; // 0 Bytes: Absturz gleich zu Beginn des Schreibens.
  let tiefe = 0;
  let inZeichenkette = false;
  let maskiert = false;
  for (const z of text) {
    if (inZeichenkette) {
      if (maskiert) { maskiert = false; continue; }
      if (z === '\\') { maskiert = true; continue; }
      if (z === '"') inZeichenkette = false;
      continue;
    }
    if (z === '"') { inZeichenkette = true; continue; }
    if (z === '{' || z === '[') tiefe++;
    else if (z === '}' || z === ']') tiefe--;
  }
  return inZeichenkette || maskiert || tiefe > 0;
}

function parseStreng(text) {
  try {
    return { daten: JSON.parse(text) };
  } catch (e) {
    if (istAbgeschnitten(text)) {
      return {
        fehler: mangel('Kopf', null, null, 'kopf_json_abgeschnitten',
          'Die Uebergabedatei ist unvollstaendig geschrieben (abgeschnittenes JSON: ' +
          'offene Klammer oder offene Zeichenkette am Dateiende). Das ist KEINE leere ' +
          'Aufnahme, sondern ein abgebrochener Schreibvorgang -- die Datei wird bewusst ' +
          'nicht atomar geschrieben. Rohmeldung des Parsers: ' + e.message),
      };
    }
    return {
      fehler: mangel('Kopf', null, null, 'kopf_json_ungueltig',
        'Die Uebergabedatei ist kein gueltiges JSON. Rohmeldung des Parsers: ' + e.message),
    };
  }
}

// ---------------------------------------------------------------------------
// Kopfpruefung
// ---------------------------------------------------------------------------

// Rueckgabe: { maengel, abbruch }. abbruch=true heisst: Die Eintraege werden
// GAR NICHT geprueft, und der Bericht sagt das ausdruecklich.
function pruefeKopf(daten, aufnahmeOrdner) {
  const maengel = [];

  if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) {
    maengel.push(mangel('Kopf', null, null, 'kopf_kein_objekt',
      'Die Uebergabedatei enthaelt kein JSON-Objekt an oberster Stelle.'));
    return { maengel, abbruch: true };
  }

  if (daten.artifact_type !== ARTIFACT_TYPE) {
    maengel.push(mangel('Kopf', null, 'artifact_type', 'kopf_artifact_type_falsch',
      'artifact_type ist ' + JSON.stringify(daten.artifact_type) + ', erwartet ist "' +
      ARTIFACT_TYPE + '". Die Datei wird nicht weitergelesen -- sie gehoert nicht zu ' +
      'diesem Vertrag.'));
    return { maengel, abbruch: true };
  }

  if (!BEKANNTE_SCHEMA_VERSIONEN.includes(daten.schema_version)) {
    maengel.push(mangel('Kopf', null, 'schema_version', 'kopf_schema_version_unbekannt',
      'schema_version ist ' + JSON.stringify(daten.schema_version) + ' und damit unbekannt. ' +
      'Bekannt ist zur Zeit nur: ' + BEKANNTE_SCHEMA_VERSIONEN.join(', ') + '. ' +
      'Die Datei wird nicht weitergelesen: eine unbekannte Fassung nach den Regeln der ' +
      'bekannten zu pruefen wuerde eine Zusage vortaeuschen, die niemand gegeben hat.'));
    return { maengel, abbruch: true };
  }

  if (typeof daten.aufnahme !== 'string' || !AUFNAHME_FORM.test(daten.aufnahme)) {
    maengel.push(mangel('Kopf', null, 'aufnahme', 'kopf_aufnahme_form',
      'aufnahme ist ' + JSON.stringify(daten.aufnahme) +
      ' und hat nicht die Form JJJJ-MM-TT HH-MM-SS.'));
  } else if (daten.aufnahme !== aufnahmeOrdner) {
    maengel.push(mangel('Kopf', null, 'aufnahme', 'kopf_aufnahme_ungleich_ordner',
      'aufnahme ist "' + daten.aufnahme + '", der gelesene Ordner heisst aber "' +
      aufnahmeOrdner + '".'));
  }

  if (typeof daten.erzeugt_am !== 'string' || !ISO_MIT_VERSATZ.test(daten.erzeugt_am) ||
      Number.isNaN(Date.parse(daten.erzeugt_am))) {
    maengel.push(mangel('Kopf', null, 'erzeugt_am', 'kopf_erzeugt_am_ungueltig',
      'erzeugt_am ist ' + JSON.stringify(daten.erzeugt_am) +
      ' und ist kein ISO-8601-Zeitpunkt mit Zonenversatz.'));
  }

  if (!Array.isArray(daten.shorts)) {
    maengel.push(mangel('Kopf', null, 'shorts', 'kopf_shorts_keine_liste',
      'shorts ist ' + JSON.stringify(daten.shorts) + ' und keine Liste.'));
    return { maengel, abbruch: true };
  }
  if (daten.shorts.length === 0) {
    maengel.push(mangel('Kopf', null, 'shorts', 'kopf_shorts_leer',
      'shorts ist eine leere Liste. Der Vertrag verlangt eine nicht-leere Liste; ' +
      'eine Aufnahme ohne freigegebene Shorts wird gar nicht erst uebergeben.'));
    return { maengel, abbruch: true };
  }

  return { maengel, abbruch: false };
}

// ---------------------------------------------------------------------------
// Vertragspruefung je Eintrag (ohne Plattenzugriff)
// ---------------------------------------------------------------------------

function istGanzzahl(w) { return Number.isInteger(w); }
function istNichtLeererText(w) { return typeof w === 'string' && w.trim() !== ''; }

// Absolut UND unterhalb der Wurzel. Der aufgeloeste Pfad dient AUSSCHLIESSLICH
// dem Vergleich -- geoeffnet wird immer der woertliche Wert aus der Datei
// (siehe Pfadsperre).
function pfadLiegtUnter(wurzel, pfad) {
  const w = path.resolve(wurzel);
  const p = path.resolve(pfad);
  const rel = path.relative(w, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Rueckgabe je Eintrag:
//   { kennung, bezeichner, maengel, unbekannteFelder, pfadBrauchbar }
function pruefeEintrag(eintrag, index, daten, wurzel, gesehene) {
  const bezeichner = (eintrag && istNichtLeererText(eintrag.kennung))
    ? eintrag.kennung
    : '#' + index;
  const maengel = [];
  const hinweise = [];
  const m = (feld, code, text) => maengel.push(mangel('Vertrag', bezeichner, feld, code, text));
  const h = (feld, text) => hinweise.push(hinweis('Vertrag', bezeichner, feld, text));

  if (eintrag === null || typeof eintrag !== 'object' || Array.isArray(eintrag)) {
    m(null, 'eintrag_kein_objekt', 'Eintrag ' + index + ' ist kein Objekt.');
    return {
      kennung: null, bezeichner, maengel, hinweise, unbekannteFelder: [], pfadBrauchbar: false,
    };
  }

  // Unbekannte Felder werden UEBERSPRUNGEN, nicht abgelehnt. Die Gegenseite hat
  // additive Erweiterung zugesagt: neue Felder kommen dazu, vorhandene werden
  // nie umbenannt, entfernt oder umgedeutet, und bei jeder Aenderung steigt
  // schema_version. Gezaehlt und genannt werden sie trotzdem -- ein stiller
  // Filter waere wieder eine Blindheit, die sich als Ergebnis tarnt.
  const unbekannteFelder = Object.keys(eintrag).filter((k) => !PFLICHTFELDER.includes(k));

  for (const feld of PFLICHTFELDER) {
    if (!(feld in eintrag)) m(feld, 'feld_fehlt', feld + ' fehlt (Pflichtfeld).');
  }

  // kennung: Form <aufnahme>/<index>, innerhalb der Datei eindeutig.
  if ('kennung' in eintrag) {
    if (!istNichtLeererText(eintrag.kennung)) {
      m('kennung', 'kennung_kein_text', 'kennung ist ' + JSON.stringify(eintrag.kennung) +
        ' und kein nicht-leerer Text.');
    } else {
      const roh = String(daten.aufnahme).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const erwartet = new RegExp('^' + roh + '\\/\\d+$');
      if (!erwartet.test(eintrag.kennung)) {
        m('kennung', 'kennung_form', 'kennung "' + eintrag.kennung + '" hat nicht die Form ' +
          '<aufnahme>/<index>, erwartet wird "' + daten.aufnahme + '/<Zahl>".');
      }
      if (gesehene.has(eintrag.kennung)) {
        m('kennung', 'kennung_doppelt', 'kennung "' + eintrag.kennung + '" kommt mehrfach vor (zuerst in ' +
          'Eintrag ' + gesehene.get(eintrag.kennung) + ', jetzt in Eintrag ' + index + ').');
      } else {
        gesehene.set(eintrag.kennung, index);
      }
    }
  }

  // pfad: absolut UND unterhalb der eingestellten Wurzel.
  let pfadBrauchbar = false;
  if ('pfad' in eintrag) {
    if (!istNichtLeererText(eintrag.pfad)) {
      m('pfad', 'pfad_kein_text', 'pfad ist ' + JSON.stringify(eintrag.pfad) + ' und kein nicht-leerer Text.');
    } else if (!path.isAbsolute(eintrag.pfad)) {
      m('pfad', 'pfad_nicht_absolut', 'pfad "' + eintrag.pfad + '" ist nicht absolut.');
    } else if (!pfadLiegtUnter(wurzel, eintrag.pfad)) {
      m('pfad', 'pfad_ausserhalb_wurzel', 'pfad "' + eintrag.pfad + '" liegt nicht unterhalb der eingestellten ' +
        'Wurzel "' + wurzel + '".');
    } else {
      pfadBrauchbar = true;
    }
  }

  // sha256: 64 Hexzeichen, klein.
  if ('sha256' in eintrag) {
    const s = eintrag.sha256;
    if (typeof s !== 'string') {
      m('sha256', 'sha256_kein_text', 'sha256 ist ' + JSON.stringify(s) + ' und kein Text.');
    } else if (s.length !== 64) {
      m('sha256', 'sha256_laenge', 'sha256 hat ' + s.length + ' Zeichen, erwartet sind genau 64 Hexzeichen ' +
        'in Kleinschreibung.');
    } else if (!SHA256_FORM.test(s)) {
      if (/^[0-9a-fA-F]{64}$/.test(s)) {
        m('sha256', 'sha256_grossbuchstaben', 'sha256 enthaelt Grossbuchstaben, erwartet sind genau 64 Hexzeichen ' +
          'in Kleinschreibung.');
      } else {
        m('sha256', 'sha256_keine_hexziffern', 'sha256 enthaelt Zeichen, die keine Hexziffern sind; erwartet sind ' +
          'genau 64 Hexzeichen in Kleinschreibung.');
      }
    }
  }

  for (const feld of GANZZAHL_POSITIV_FELDER) {
    if (feld in eintrag) {
      if (!istGanzzahl(eintrag[feld])) {
        m(feld, 'zahl_keine_ganzzahl',
          feld + ' ist ' + JSON.stringify(eintrag[feld]) + ' und keine Ganzzahl.');
      } else if (eintrag[feld] <= 0) {
        m(feld, 'zahl_nicht_positiv',
          feld + ' ist ' + eintrag[feld] + ' und damit nicht groesser als 0.');
      }
    }
  }

  for (const feld of GANZZAHL_FELDER) {
    if (feld in eintrag && !istGanzzahl(eintrag[feld])) {
      m(feld, 'zahl_keine_ganzzahl',
        feld + ' ist ' + JSON.stringify(eintrag[feld]) + ' und keine Ganzzahl.');
    }
  }

  for (const feld of TEXT_FELDER) {
    if (feld in eintrag && !istNichtLeererText(eintrag[feld])) {
      m(feld, 'text_leer', feld + ' ist ' + JSON.stringify(eintrag[feld]) + ' und damit leer.');
    }
  }

  if (istGanzzahl(eintrag.quelle_von_ms) && istGanzzahl(eintrag.quelle_bis_ms) &&
      eintrag.quelle_bis_ms <= eintrag.quelle_von_ms) {
    m('quelle_bis_ms', 'quelle_spanne_nicht_positiv',
      'quelle_bis_ms (' + eintrag.quelle_bis_ms + ') ist nicht groesser ' +
      'als quelle_von_ms (' + eintrag.quelle_von_ms + ').');
  }

  // urteil: EXAKTE Gleichheitspruefung auf "ja", keine Ausschlussliste. Eine
  // Ausschlussliste ("alles ausser nein") nimmt an, was sie nicht kennt.
  if ('urteil' in eintrag && eintrag.urteil !== 'ja') {
    m('urteil', 'urteil_nicht_ja',
      'urteil ist ' + JSON.stringify(eintrag.urteil) + ', erwartet ist exakt "ja". ' +
      'In der Uebergabedatei stehen ausschliesslich angenommene Shorts.');
  }

  // dauer_ms gegen die Quellspanne. Diese Pruefung steht im Auftrag unter
  // "gegen die Platte", braucht aber keinen Plattenzugriff -- sie rechnet nur
  // mit Feldern der Datei. Sie liegt deshalb hier und laeuft auch dann, wenn
  // die Datei auf der Platte fehlt.
  if (istGanzzahl(eintrag.dauer_ms) && istGanzzahl(eintrag.quelle_von_ms) &&
      istGanzzahl(eintrag.quelle_bis_ms) && eintrag.quelle_bis_ms > eintrag.quelle_von_ms) {
    const spanne = eintrag.quelle_bis_ms - eintrag.quelle_von_ms;
    const abweichung = eintrag.dauer_ms - spanne;
    if (Math.abs(abweichung) > TOLERANZ_MS) {
      m('dauer_ms', 'dauer_weicht_von_quellspanne',
        'dauer_ms (' + eintrag.dauer_ms + ') weicht um ' +
        (abweichung > 0 ? '+' : '') + abweichung + ' ms von der Quellspanne ' + spanne +
        ' ms ab; erlaubt sind hoechstens +-' + TOLERANZ_MS + ' ms.');
    }
  }

  // DHb: Vernunftgrenze (Mangel) und beobachtete Spanne (Hinweis).
  //
  // Die Pruefung sitzt hier auf dem FELD dauer_ms und nicht bei ffprobe: sie
  // braucht keine Platte, und sie soll auch dann greifen, wenn die Videodatei
  // gar nicht erreichbar ist. Was auf der Platte liegt, ist ueber sha256 und
  // groesse_bytes ohnehin auf das Byte festgenagelt.
  if (istGanzzahl(eintrag.dauer_ms) && eintrag.dauer_ms > 0) {
    const d = eintrag.dauer_ms;
    if (d < VERNUNFT_MIN_MS || d > VERNUNFT_MAX_MS) {
      m('dauer_ms', 'dauer_ausserhalb_vernunft',
        'dauer_ms ist ' + d + ' ms und liegt ausserhalb jeder Vernunftgrenze ' +
        '(' + VERNUNFT_MIN_MS + ' bis ' + VERNUNFT_MAX_MS + ' ms). Unter einer Sekunde ' +
        'kann kein Short sein, ueber drei Minuten ist keiner mehr.');
    } else if (d < BEOBACHTET_MIN_MS || d > BEOBACHTET_MAX_MS) {
      h('dauer_ms', 'dauer_ms ist ' + d + ' ms und liegt ausserhalb der bisher ' +
        'beobachteten Spanne ' + BEOBACHTET_MIN_MS + ' bis ' + BEOBACHTET_MAX_MS + ' ms. ' +
        'Das ist eine BEOBACHTUNG aus ' + BEOBACHTET_STICHPROBEN + ' fertigen Shorts und ' +
        'KEINE Zusage der Gegenseite -- der Eintrag ist angenommen. Es ist kein Defekt zu ' +
        'suchen; die Laenge folgt aus dem Material, nicht aus einer Encoder-Einstellung.');
    }
  }

  return {
    kennung: eintrag.kennung, bezeichner, maengel, hinweise, unbekannteFelder, pfadBrauchbar,
  };
}

// ---------------------------------------------------------------------------
// Plattenpruefung je Eintrag
// ---------------------------------------------------------------------------

function bruchZuZahl(s) {
  if (typeof s !== 'string' || !s.includes('/')) return NaN;
  const teile = s.split('/');
  const a = Number(teile[0]);
  const b = Number(teile[1]);
  if (!b) return NaN;
  return a / b;
}

function ffprobe(sperre, pfad) {
  const roh = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', sperre.oeffnen(pfad)],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  return JSON.parse(roh);
}

function sha256VonDatei(sperre, pfad) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(sperre.oeffnen(pfad), 'r');
  try {
    const puffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, puffer, 0, puffer.length, null);
      if (n === 0) break;
      h.update(puffer.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function pruefePlatte(eintrag, bezeichner, sperre) {
  const maengel = [];
  const m = (feld, code, text) => maengel.push(mangel('Platte', bezeichner, feld, code, text));
  const pfad = eintrag.pfad;

  let stat;
  try {
    stat = fs.statSync(sperre.oeffnen(pfad));
  } catch (e) {
    m('pfad', 'datei_nicht_lesbar',
      'Datei nicht vorhanden oder nicht lesbar (' + (e.code || e.message) + '): "' +
      pfad + '".');
    return maengel;
  }
  if (!stat.isFile()) {
    m('pfad', 'pfad_keine_datei', '"' + pfad + '" ist keine Datei.');
    return maengel;
  }

  if (istGanzzahl(eintrag.groesse_bytes) && stat.size !== eintrag.groesse_bytes) {
    m('groesse_bytes', 'groesse_stimmt_nicht',
      'groesse_bytes ist mit ' + eintrag.groesse_bytes +
      ' angegeben, die Datei hat ' + stat.size + ' Bytes.');
  }

  if (typeof eintrag.sha256 === 'string' && SHA256_FORM.test(eintrag.sha256)) {
    const gemessen = sha256VonDatei(sperre, pfad);
    if (gemessen !== eintrag.sha256) {
      m('sha256', 'sha256_stimmt_nicht',
        'sha256 stimmt nicht: angegeben ' + eintrag.sha256 + ', gemessen ' +
        gemessen + '.');
    }
  } else {
    m('sha256', 'sha256_nicht_vergleichbar',
      'sha256 konnte nicht verglichen werden, weil das Feld selbst ungueltig ist. ' +
      'Es wird nichts ergaenzt und nichts geraten.');
  }

  let sonde;
  try {
    sonde = ffprobe(sperre, pfad);
  } catch (e) {
    m('format', 'format_nicht_pruefbar',
      'Format nicht pruefbar: ffprobe konnte nicht ausgefuehrt werden (' +
      (e.code || e.message) + '). Der Eintrag wird deshalb NICHT angenommen -- ' +
      'eine ungepruefte Zusicherung ist keine erfuellte Zusicherung.');
    return maengel;
  }

  const streams = Array.isArray(sonde.streams) ? sonde.streams : [];
  const video = streams.filter((s) => s.codec_type === 'video');
  const audio = streams.filter((s) => s.codec_type === 'audio');

  // DHb (Teil 2): Jede Formatpruefung traegt ihren eigenen Feldnamen. Bis DHa
  // stand hier ueberall null -- der Meldungstext nannte die Eigenschaft, die
  // maschinenlesbare Angabe fehlte. Wer die --json-Ausgabe auswertete, musste
  // im Fliesstext suchen. Die Namen bezeichnen die geprueften EIGENSCHAFTEN
  // der Datei, nicht Felder der Uebergabedatei; einzige Ausnahme ist
  // "breite/hoehe", wo Feld und Datei gegeneinander stehen.
  if (video.length !== 1) {
    m('videospuren', 'videospuren_anzahl',
      'Die Datei hat ' + video.length + ' Videospuren, zugesichert ist genau eine.');
  } else {
    const v = video[0];
    if (v.width !== ZUSICHERUNG.breite || v.height !== ZUSICHERUNG.hoehe) {
      m('aufloesung', 'aufloesung_abweichend',
        'Aufloesung ist ' + v.width + 'x' + v.height + ', zugesichert ist ' +
        ZUSICHERUNG.breite + 'x' + ZUSICHERUNG.hoehe + '.');
    }
    if (istGanzzahl(eintrag.breite) && istGanzzahl(eintrag.hoehe) &&
        (v.width !== eintrag.breite || v.height !== eintrag.hoehe)) {
      m('breite/hoehe', 'masse_stimmen_nicht',
        'breite/hoehe sind mit ' + eintrag.breite + 'x' + eintrag.hoehe +
        ' angegeben, die Datei ist ' + v.width + 'x' + v.height + '.');
    }
    const r = bruchZuZahl(v.r_frame_rate);
    const a = bruchZuZahl(v.avg_frame_rate);
    if (r !== ZUSICHERUNG.fps || a !== ZUSICHERUNG.fps) {
      m('bildrate', 'bildrate_abweichend',
        'Bildrate ist r_frame_rate=' + v.r_frame_rate + ' / avg_frame_rate=' +
        v.avg_frame_rate + ', zugesichert sind konstant ' + ZUSICHERUNG.fps +
        ' fps (beide Werte muessen ' + ZUSICHERUNG.fps + ' ergeben).');
    }
    if (v.codec_name !== ZUSICHERUNG.videoCodec || v.profile !== ZUSICHERUNG.videoProfil ||
        v.level !== ZUSICHERUNG.videoLevel) {
      m('videocodec', 'videocodec_abweichend',
        'Videocodec ist ' + v.codec_name + ' ' + v.profile + ' Level ' + v.level +
        ', zugesichert ist ' + ZUSICHERUNG.videoCodec + ' ' + ZUSICHERUNG.videoProfil +
        ' Level ' + ZUSICHERUNG.videoLevel + '.');
    }
    if (v.pix_fmt !== ZUSICHERUNG.pixelFormat) {
      m('pixelformat', 'pixelformat_abweichend',
        'Pixelformat ist ' + v.pix_fmt + ', zugesichert ist ' +
        ZUSICHERUNG.pixelFormat + '.');
    }
  }

  if (audio.length !== 1) {
    m('tonspuren', 'tonspuren_anzahl',
      'Die Datei hat ' + audio.length + ' Tonspuren, zugesichert ist genau eine.');
  } else {
    const t = audio[0];
    if (t.codec_name !== ZUSICHERUNG.audioCodec || t.profile !== ZUSICHERUNG.audioProfil) {
      m('toncodec', 'toncodec_abweichend',
        'Toncodec ist ' + t.codec_name + ' ' + t.profile + ', zugesichert ist ' +
        ZUSICHERUNG.audioCodec + ' ' + ZUSICHERUNG.audioProfil + '.');
    }
    if (Number(t.sample_rate) !== ZUSICHERUNG.abtastrate) {
      m('abtastrate', 'abtastrate_abweichend',
        'Abtastrate ist ' + t.sample_rate + ' Hz, zugesichert sind ' +
        ZUSICHERUNG.abtastrate + ' Hz.');
    }
    if (t.channels !== ZUSICHERUNG.kanaele || t.channel_layout !== ZUSICHERUNG.kanalbild) {
      m('tonkanaele', 'tonkanaele_abweichend',
        'Tonkanaele sind ' + t.channels + ' (' + t.channel_layout + '), zugesichert ' +
        'sind ' + ZUSICHERUNG.kanaele + ' (' + ZUSICHERUNG.kanalbild + ').');
    }
  }

  // DHb (Teil 1a): Hier stand bis DHa eine Ablehnung, wenn die Dauer der Datei
  // ausserhalb von 6,9 bis 18,7 s lag. Sie ist ERSATZLOS entfallen: das war
  // keine Zusicherung, sondern die Spanne aus 113 Stichproben. Beurteilt wird
  // die Laenge jetzt am Feld dauer_ms (Vernunftgrenze als Mangel, beobachtete
  // Spanne als Hinweis, siehe pruefeEintrag).
  //
  // BEKANNTE FOLGE, ausdruecklich nicht wegdefiniert: die von ffprobe GEMESSENE
  // Dauer wird damit gegen nichts mehr geprueft. Sie ist nicht ungedeckt --
  // sha256 legt den Inhalt der Datei auf das Byte fest, und damit auch ihre
  // Dauer --, aber es gibt keine Meldung mehr, wenn dauer_ms und Datei
  // auseinanderlaufen, solange die Pruefsumme stimmt.

  return maengel;
}

// ---------------------------------------------------------------------------
// Die Nutzdaten eines angenommenen Eintrags (DIb)
// ---------------------------------------------------------------------------

// WOERTLICH. Nicht neu berechnet, nicht normalisiert, nicht umbenannt, nicht
// getrimmt -- was hier herauskommt, ist Zeichen fuer Zeichen das, was in der
// Uebergabedatei stand und was oben gegen den Vertrag gehalten wurde.
//
// Insbesondere wird der PFAD nicht angefasst: keine Schreibweise gedreht, kein
// Trennzeichen vereinheitlicht, kein path.resolve. Ein Pfad, den der Leser
// selbst geformt haette, ist nicht mehr der Pfad, der uebergeben wurde -- genau
// das ist die Regel der Pfadsperre oben, und sie gilt auf dem Rueckweg
// genauso wie auf dem Hinweg.
//
// Gelesen wird ueber DURCHGEREICHTE_FELDER und nicht ueber Object.keys: was
// nicht in der Liste steht, hat keine Pruefung hinter sich und geht darum auch
// nicht mit. Unbekannte Felder bleiben allein unter `unbekannteFelder` stehen.
function nutzdaten(eintrag) {
  const daten = {};
  for (const feld of DURCHGEREICHTE_FELDER) daten[feld] = eintrag[feld];
  return daten;
}

// ---------------------------------------------------------------------------
// Die Gesamtpruefung
// ---------------------------------------------------------------------------

// text:     Inhalt der Uebergabedatei
// wurzel:   eingestellte Render-Wurzel (fuer die Pfadpruefung)
// aufnahme: Ordnername der Aufnahme
// platte:   false = nur die Vertragspruefung, ohne jeden Plattenzugriff
function pruefeUebergabe({ text, wurzel, aufnahme, platte = true }) {
  const bericht = {
    aufnahme,
    wurzel,
    plattenpruefung: platte,
    kopfMaengel: [],
    eintraege: [],
    eintraegeGeprueft: false,
    // Verlaufsbemerkungen ueber den Lauf selbst -- NICHT die Hinweise zu
    // einzelnen Eintraegen. Die stehen bei den Eintraegen (DHb).
    verlauf: [],
  };

  const geparst = parseStreng(text);
  if (geparst.fehler) {
    bericht.kopfMaengel.push(geparst.fehler);
    bericht.verlauf.push('Es wurde kein einziger Eintrag geprueft: die Datei liess sich nicht lesen.');
    return abschliessen(bericht);
  }

  const daten = geparst.daten;
  const kopf = pruefeKopf(daten, aufnahme);
  bericht.kopfMaengel = kopf.maengel;
  if (kopf.abbruch) {
    bericht.verlauf.push('Es wurde kein einziger Eintrag geprueft: der Kopf der Datei traegt nicht.');
    return abschliessen(bericht);
  }

  const sperre = neueSperre();
  const gesehene = new Map();
  bericht.eintraegeGeprueft = true;
  if (!platte) {
    // DIb: Der Wortlaut ist derselbe, mit dem der uebersprungene Lieferungstest
    // sich selbst meldet. Eine ausgelassene Pruefung darf nirgends wie eine
    // bestandene aussehen -- auch dann nicht, wenn sie absichtlich ausgelassen
    // wurde.
    bericht.verlauf.push(
      'Die Plattenpruefung lief NICHT (--ohne-platte): Existenz, Pruefsumme, Groesse und ' +
      'Format wurden nicht nachgesehen. Das ist keine bestandene Pruefung, sondern eine ' +
      'ausgelassene. `daten` bleibt darum bei jedem Eintrag leer.');
  }

  for (let i = 0; i < daten.shorts.length; i++) {
    const roh = daten.shorts[i];
    // Ab hier ist "pfad" der einzige Wert, der jemals auf die Platte darf --
    // und nur genau so, wie er in der Datei stand.
    if (roh && typeof roh === 'object') sperre.ausDatei(roh.pfad);

    const e = pruefeEintrag(roh, i, daten, wurzel, gesehene);
    const maengel = e.maengel.slice();

    if (!platte) {
      // Kein Plattenzugriff gewuenscht -- steht als Bemerkung oben im Bericht.
    } else if (!e.pfadBrauchbar) {
      maengel.push(mangel('Platte', e.bezeichner, 'pfad', 'platte_uebersprungen_pfad_ungueltig',
        'Die Pruefung gegen die Platte wurde NICHT ausgefuehrt, weil das Feld pfad ' +
        'schon den Vertrag verletzt. Es wird kein Ersatzpfad gesucht.'));
    } else {
      maengel.push(...pruefePlatte(roh, e.bezeichner, sperre));
    }

    // DHb: Ein Hinweis macht einen Eintrag NICHT halb abgelehnt. Angenommen
    // wird allein an den Maengeln entschieden.
    const angenommen = maengel.length === 0;

    bericht.eintraege.push({
      index: i,
      kennung: e.kennung,
      bezeichner: e.bezeichner,
      unbekannteFelder: e.unbekannteFelder,
      maengel,
      hinweise: e.hinweise,
      angenommen,
      // DIb: die geprueften Nutzdaten, woertlich. Siehe DURCHGEREICHTE_FELDER.
      daten: (platte && angenommen) ? nutzdaten(roh) : null,
    });
  }

  return abschliessen(bericht);
}

function abschliessen(bericht) {
  bericht.angenommen = bericht.eintraege.filter((e) => e.angenommen).length;
  bericht.abgelehnt = bericht.eintraege.length - bericht.angenommen;
  bericht.maengelGesamt =
    bericht.kopfMaengel.length +
    bericht.eintraege.reduce((s, e) => s + e.maengel.length, 0);
  // DHb: Hinweise werden GETRENNT gezaehlt und gehen in keine Mangelsumme ein.
  bericht.hinweiseGesamt = bericht.eintraege.reduce((s, e) => s + e.hinweise.length, 0);
  bericht.angenommenMitHinweis =
    bericht.eintraege.filter((e) => e.angenommen && e.hinweise.length > 0).length;
  // Der Status haengt ausschliesslich an den Maengeln -- und damit auch der
  // Rueckgabewert des Programms. Ein Hinweis fuehrt nie zu Exit 1.
  bericht.status = (bericht.maengelGesamt === 0 && bericht.eintraege.length > 0)
    ? 'angenommen' : 'abgelehnt';
  return bericht;
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

function formatiere(bericht, quelle) {
  const z = [];
  z.push('Uebergabedatei: ' + quelle);
  z.push('Aufnahme:       ' + bericht.aufnahme);
  z.push('Wurzel:         ' + bericht.wurzel);
  z.push('');

  if (bericht.kopfMaengel.length) {
    z.push('KOPF -- abgelehnt:');
    for (const m of bericht.kopfMaengel) {
      z.push('  ' + (m.feld || '-').padEnd(16) + ' ' + m.meldung);
    }
    z.push('');
  } else {
    z.push('Kopf: in Ordnung.');
    z.push('');
  }

  for (const e of bericht.eintraege) {
    // DHb: Ein Eintrag mit Hinweisen und ohne Maengel ist ANGENOMMEN. Damit das
    // beim Ueberfliegen nicht wie ein halber Mangel aussieht, steht es in der
    // Kopfzeile des Eintrags dabei.
    const marke = e.angenommen ? 'ANGENOMMEN' : 'ABGELEHNT ';
    const teile = [];
    if (e.hinweise.length) teile.push(e.hinweise.length + ' Hinweis(e), kein Mangel');
    if (e.unbekannteFelder.length) {
      teile.push(e.unbekannteFelder.length + ' unbekannte(s) Feld(er) uebersprungen: ' +
        e.unbekannteFelder.join(', '));
    }
    const zusatz = teile.length ? '   (' + teile.join('; ') + ')' : '';
    z.push(marke + '  [' + e.index + '] ' + e.bezeichner + zusatz);
    for (const m of e.maengel) {
      z.push('    MANGEL   ' + m.ebene.padEnd(8) + ' ' + (m.feld || '-').padEnd(16) + ' ' + m.meldung);
    }
    for (const w of e.hinweise) {
      z.push('    HINWEIS  ' + w.ebene.padEnd(8) + ' ' + (w.feld || '-').padEnd(16) + ' ' + w.meldung);
    }
  }
  if (bericht.eintraege.length) z.push('');

  for (const b of bericht.verlauf) z.push('Anmerkung: ' + b);
  if (bericht.verlauf.length) z.push('');

  z.push('Eintraege: ' + bericht.eintraege.length + ' -- angenommen ' + bericht.angenommen +
    (bericht.angenommenMitHinweis
      ? ' (davon ' + bericht.angenommenMitHinweis + ' mit Hinweis)' : '') +
    ', abgelehnt ' + bericht.abgelehnt + '.');
  z.push('Maengel gesamt: ' + bericht.maengelGesamt +
    ' (Kopf ' + bericht.kopfMaengel.length + ', Eintraege ' +
    (bericht.maengelGesamt - bericht.kopfMaengel.length) + ').' +
    '   Hinweise gesamt: ' + bericht.hinweiseGesamt +
    ' -- Hinweise sind keine Maengel und aendern den Rueckgabewert nicht.');
  // DIb: Ohne Plattenpruefung darf die Schlusszeile NICHT sagen, die Uebergabe
  // entspreche dem Vertrag. Geprueft wurde dann nur die eine Haelfte -- die
  // Felder gegeneinander -, waehrend die andere (Existenz, Pruefsumme, Groesse,
  // Format aus Abschnitt 6) gar nicht angesehen wurde. Die Schlusszeile ist die
  // eine Zeile, die ein Mensch mit Sicherheit liest; sie ist der letzte Ort, an
  // dem eine ausgelassene Pruefung noch wie eine bestandene aussehen darf.
  z.push(bericht.status === 'angenommen'
    ? (bericht.plattenpruefung === false
      ? 'ERGEBNIS: Die VERTRAGSPRUEFUNG ist bestanden. Die Plattenpruefung lief NICHT -- ' +
        'das ist keine bestandene Pruefung, sondern eine ausgelassene. Ob die Uebergabe ' +
        'dem Vertrag entspricht, ist damit NICHT beantwortet.'
      : 'ERGEBNIS: Die Uebergabe entspricht dem Vertrag.')
    : 'ERGEBNIS: Die Uebergabe entspricht dem Vertrag NICHT. Es wurde nichts repariert ' +
      'und nichts ergaenzt.');
  return z.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function wertVon(argv, praefix) {
  const t = argv.slice(2).find((x) => x.startsWith(praefix));
  return t === undefined ? null : t.slice(praefix.length);
}

function main() {
  const argv = process.argv;
  const alsJson = argv.includes('--json');
  // DIb: schaltet AUSSCHLIESSLICH die Plattenpruefung ab (Existenz, Pruefsumme,
  // Groesse, Format). Die Vertragspruefung laeuft unveraendert weiter, und die
  // Ausgabe sagt in beiden Formen, dass nicht nachgesehen wurde.
  const ohnePlatte = argv.includes('--ohne-platte');
  const aufnahme = wertVon(argv, '--aufnahme=');
  const wurzel = wertVon(argv, '--wurzel=') || process.env.SHORTS_RENDER_WURZEL || null;

  if (!aufnahme) {
    console.error('\nAbbruch: --aufnahme= fehlt. Beispiel: --aufnahme="2026-08-29 18-18-19"\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  // DJb: Die Form wird geprueft, BEVOR daraus ein Pfad wird.
  //
  // Vorher lief ein abgeschnittener Name "2026-08-29" bis zum Oeffnen durch und
  // endete als "Die Uebergabedatei ist nicht lesbar (ENOENT): ...\2026-08-29\
  // uebergabe.json". Das ist wahr und trotzdem irrefuehrend: es sieht aus wie
  // eine fehlende Lieferung und ist ein Tippfehler im Aufruf. Wer das liest,
  // sucht auf dem Renderlaufwerk statt in seiner eigenen Kommandozeile.
  //
  // Ein Ordnername ohne diese Form kann ohnehin nie angenommen werden -- das
  // Feld `aufnahme` in der Datei muesste ihm gleichen (kopf_aufnahme_ungleich_
  // ordner) und scheiterte dann selbst an der Form (kopf_aufnahme_form). Die
  // Pruefung nimmt also nichts weg; sie sagt es nur frueher und richtig.
  if (!AUFNAHME_FORM.test(aufnahme)) {
    console.error('\nAbbruch: --aufnahme= hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme));
    console.error('Es wurde kein Pfad daraus gebaut und keine Datei geoeffnet.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  if (!wurzel) {
    console.error('\nAbbruch: keine Wurzel. Setze SHORTS_RENDER_WURZEL in der .env ' +
      'oder gib --wurzel= an.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }

  const quelle = uebergabedateiPfad(wurzel, aufnahme);
  let text;
  try {
    text = fs.readFileSync(quelle, 'utf8');
  } catch (e) {
    const meldung = 'Die Uebergabedatei ist nicht lesbar (' + (e.code || e.message) + '): ' + quelle;
    if (alsJson) {
      console.log(JSON.stringify({ quelle, aufnahme, wurzel, status: 'abgelehnt', fehler: meldung }, null, 2));
    } else {
      console.error('\nAbbruch: ' + meldung + '\n');
    }
    process.exit(EXIT_MANGEL);
  }

  const bericht = pruefeUebergabe({ text, wurzel, aufnahme, platte: !ohnePlatte });
  if (alsJson) {
    console.log(JSON.stringify(Object.assign({ quelle }, bericht), null, 2));
  } else {
    console.log(formatiere(bericht, quelle));
  }
  process.exit(bericht.status === 'angenommen' ? EXIT_OK : EXIT_MANGEL);
}

if (require.main === module) main();

module.exports = {
  ARTIFACT_TYPE, BEKANNTE_SCHEMA_VERSIONEN, PFLICHTFELDER, TOLERANZ_MS, ZUSICHERUNG,
  MANGEL_CODES, DURCHGEREICHTE_FELDER, nutzdaten, mangel,
  DATEINAME, ERLAUBTE_ARGUMENTE, EXIT_OK, EXIT_MANGEL, EXIT_AUFRUFFEHLER,
  EXIT_CODES, EXIT, beispielAufnahme,
  VERNUNFT_MIN_MS, VERNUNFT_MAX_MS, BEOBACHTET_MIN_MS, BEOBACHTET_MAX_MS,
  BEOBACHTET_STICHPROBEN,
  GANZZAHL_POSITIV_FELDER, GANZZAHL_FELDER, TEXT_FELDER, FELDSCHLEIFEN,
  AUFNAHME_FORM, SHA256_FORM, pruefeKeineFreienArgumente,
  neueSperre, uebergabedateiPfad, istAbgeschnitten, parseStreng, pruefeKopf,
  pruefeEintrag, pruefePlatte, pruefeUebergabe, formatiere, pfadLiegtUnter,
};
