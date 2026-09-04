'use strict';

// DJ: Die Freigabeoberflaeche. Zweiter Bewohner von src/upload/.
//
// Ein lokaler Dienst und eine Seite. Der Mensch sieht jedes gepruefte Short,
// spielt es ab, uebernimmt oder ueberschreibt den Titel, gibt frei oder lehnt
// ab. Das Ergebnis geht in eine Freigabedatei. MEHR NICHT.
//
// Der Entwurf ist von der Urteilsseite des Cutters uebernommen
// (matrix_auto_cutter/shorts/judge_server.py -- gelesen, nicht kopiert): Bindung
// ausschliesslich an 127.0.0.1, feste Routenliste statt eines Dateiservers,
// Bereichsanfragen fuer <video>, Speichern nach jedem einzelnen Klick,
// geordnetes Beenden ueber die Seite UND ueber Strg+C. Drei Dinge kommen hier
// dazu, die das Vorbild nicht hat und nicht braucht: ein Sitzungstoken, eine
// Herkunftspruefung und ein Index statt eines fest verdrahteten Videos.
//
// ---------------------------------------------------------------------------
// DIE VIER HARTEN LINIEN
// ---------------------------------------------------------------------------
//
// 1. DIESER DIENST LIEST DIE uebergabe.json NIEMALS SELBST.
//    Seine einzige Eingabe ist die --json-Ausgabe von src/upload/uebergabe-
//    leser.js. Gaebe es hier einen zweiten Leser, gaebe es einen ohne die
//    Pfadsperre -- und der stuende direkt neben den Ordnern "(vor-auflage)" und
//    "(vor-pausenfix)", deren Inhalt von den guten Shorts nicht zu
//    unterscheiden ist. In dieser Datei kommt der Dateiname "uebergabe.json"
//    darum nur in Kommentaren vor.
//
//    DR: fs.readFileSync trifft jetzt vier Dinge -- die Freigabedatei, eine
//    Videodatei aus der Sperre, die Sperrdatei und data/inventory.json (fuer
//    den Kanalnamen auf dem Knopf). Keines davon ist die Lieferung: Pfade,
//    Pruefsummen und Titel kommen weiterhin ausschliesslich aus der Ausgabe
//    des Lesers, und was der Uploader ueber Plan und Lieferung weiss, sagt er
//    selbst -- dieser Dienst liest weder Plan noch Uebergabedatei.
//
// 2. KEIN KINDPROZESS ENTSTEHT ALS FOLGE EINES URTEILS.
//
//    DJb: Bis hierher hiess diese Zusage "es gibt genau zwei Kindprozesse".
//    Das war die falsche Zusage, weil sie an einer Zahl haengt, die sich
//    aendert -- in DJ waren es zwei, mit dem Browser aus DJb sind es drei, und
//    die Commit-Nachricht von 8061609 sagt sogar "der einzige". Alle drei
//    Fassungen meinten dasselbe und keine sagte es: es geht nicht darum, WIE
//    VIELE Prozesse starten, sondern WOFUER.
//
//    DR: Und genau deshalb steht die Zusage noch, obwohl es jetzt fuenf sind.
//    Bis DR hiess der Zusatz "alle beim Start, keinen danach". Das stimmt
//    nicht mehr -- die Kette startet Kindprozesse mitten im Betrieb. Der Kern
//    stimmt weiter: KEIN URTEIL LOEST EINEN AUS.
//
//    Drei gehoeren zum Start des SHORTS-Modus:
//      - der Leser (ruftLeser)          -- die EINGABE des Dienstes. Vor dem
//        Port, vor der ersten Karte, bei jedem Start.
//      - netstat (haelterDesPorts)      -- nur bei belegtem Port, und dann
//        startet der Dienst gar nicht erst. Liest eine Liste, sonst nichts.
//      - der Browser (oeffneImBrowser)  -- einmal, nach listen(), ausser bei
//        --no-browser. Scheitert er, laeuft der Dienst weiter.
//
//    Einer gehoert zum Start des LONGFORM-Modus, und er steht dort an
//    derselben Stelle wie der Leser hier:
//      - der Trockenlauf des Longform-Arbeiters (ruftLongformTrocken) -- die
//        EINGABE der Longform-Ansicht (EL, Vertrag 4, Schritt 2). Vor dem
//        Port, vor der Seite, bei jedem Start. Er macht keinen Netzaufruf und
//        laedt nichts hoch; sein Modul ist die lesende Haelfte (EK).
//        Der Leser laeuft in diesem Modus NICHT -- es gibt keine
//        Uebergabedatei, und es wird auch keine gesucht.
//
//    Zwei gehoeren zur Kette und haengen an je einem eigenen, benannten Knopf:
//      - der Planer und der Trockenlauf des Uploaders (ruftPlaner,
//        ruftUploaderTrocken) -- Schritt 1, "Einplanen und Vorschau".
//      - der scharfe Uploader (starteUploaderLauf) -- Schritt 3, "Hochladen",
//        und nur mit einer Einmal-Ermaechtigung, die dieser Dienst beim Klick
//        schreibt.
//
//    POST /urteil fuehrt weiterhin zu schreibeFreigaben() und zu keinem
//    spawn; POST /beenden schaltet ab und ruft nichts auf. Der Weg vom Urteil
//    zum Upload existiert nicht -- er geht ueber zwei weitere Klicks und eine
//    Vorschau, die ein Mensch gelesen haben muss.
//
//    Wer hier einen sechsten anfuegt, muss sagen, an welcher Handlung eines
//    Menschen er haengt. Haengt er an einem Urteil, faellt der Test
//    'kein Kindprozess entsteht als Folge eines Urteils'.
//
// 3. ES GIBT KEINEN WEG VON EINER ANFRAGE ZU EINEM DATEISYSTEMPFAD.
//    Die Dateiliste wird EINMAL beim Start aus der Lesereingabe gebaut. Eine
//    Anfrage traegt nur einen Index in diese Liste. Derselbe Bau wie
//    sperre.oeffnen() im Leser -- und zwar woertlich dieselbe Funktion, sie
//    wird von dort importiert, damit es nicht zwei Fassungen davon gibt.
//
// 4. DER DIENST SCHREIBT FUENF DATEIEN, JEDE DURCH GENAU EINE FUNKTION.
//
//    Bis DJ hiess diese Zeile "ausschliesslich die Freigabedatei". Mit der
//    Einzelinstanz-Sperre (DJa) wurden zwei daraus, mit der Kette (DR) vier,
//    mit dem zweiten Betriebsmodus (EI) fuenf. Die Zeile wird jedes Mal
//    BERICHTIGT statt weiter behauptet -- eine Zusage, die man nachtraeglich
//    zurechtbiegt, ist keine. Was sich NICHT aendert, ist ihre Form: eine
//    aufgezaehlte Liste von Zielen, je Ziel genau eine Funktion, und jede
//    andere Zeile faellt durch den Test.
//
//      data/freigaben/<aufnahme>.json          <- schreibeFreigaben()
//      data/freigaben/<aufnahme>.sperre.json   <- nimmSperre() /
//                                                 schreibeSperrinhalt() /
//                                                 gibSperreFrei()
//      data/freigaben/<aufnahme>.<modus>.sperre.json
//                                              <- dieselben drei (EI)
//      data/plaene/archiv/<aufnahme>.…json     <- archiviereAltenPlan()
//      data/ermaechtigungen/ermaechtigung-….json
//                                              <- schreibeErmaechtigung()
//
//    DIE DRITTE ZEILE IST KEINE FUENFTE FUNKTION. Der zweite Betriebsmodus
//    (EI, Vertrag 2.13) legt seine Sperre unter einem eigenen Dateinamen ab,
//    aber durch DIESELBEN drei Funktionen: ein sperrPfad, ein 'wx', eine
//    Verwaisten-Regel. Sie steht als eigene Zeile, weil ein zweiter DATEINAME
//    entstehen kann -- nicht, weil eine zweite Stelle schreibt. Der Name der
//    Shorts-Sperre bleibt woertlich <aufnahme>.sperre.json; die Zusage zur
//    Freigabe-Naht und die Uebersicht kennen ihn.
//
//    Alle liegen unter data/, und data/ steht in .gitignore. Ein sechster Ort
//    kommt nicht dazu. Das ist nachpruefbar, und tests/freigabe-server.test.cjs
//    rechnet es bei jedem Lauf nach: JEDER Schreibaufruf dieser Datei muss im
//    Rumpf einer dieser sechs Funktionen liegen, sonst faellt der Test -- und
//    die Zahl in der Ueberschrift wird gegen die Liste darunter geprueft, damit
//    ein Kommentar mit einer Zahl darin nicht unbemerkt falsch wird.
//
//    NICHT GEZAEHLT SIND DIE KINDPROZESSE. Der Planer schreibt
//    data/plaene/<aufnahme>.json, der Uploader data/uploads/<aufnahme>.json
//    und data/ermaechtigungen/verbraucht.json -- das sind Schreibzugriffe
//    IHRER Module, nach IHREN Regeln, mit IHREN Tests. Dieser Dienst ruft sie
//    auf; er schreibt diese Dateien nicht.

const { pruefeArgumenteStrikt } = require('../publish/cli-args');

// pruefeArgumenteStrikt als ALLERERSTE Anweisung -- vor jedem Lesen, vor jedem
// Kindprozess, vor dem Oeffnen eines Ports (CY Teil B).
const ERLAUBTE_ARGUMENTE = ['--aufnahme=', '--wurzel=', '--port=', '--no-browser', '--modus='];

// DJb: pruefeKeineFreienArgumente kommt aus dem Leser und ist nicht nachgebaut
// -- dieselbe Regel gehoert nicht zweimal ins Projekt, und die Abhaengigkeit in
// diese Richtung gibt es ohnehin schon (neueSperre weiter unten). Warum sie
// noetig ist, steht dort.
//
// Beide Pruefungen stehen VOR jedem anderen require: pruefeArgumenteStrikt fuer
// alles mit '-' davor, pruefeKeineFreienArgumente fuer alles ohne.
// DNa Punkt 1: der Flagname wird mitgegeben. Diese Funktion bedient drei
// Skripte, und zwei davon heissen --aufnahme=, eines --freigabe=.
const { pruefeKeineFreienArgumente } = require('./uebergabe-leser');
if (require.main === module) {
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/upload/freigabe-server.js');
  pruefeKeineFreienArgumente(process.argv, 'src/upload/freigabe-server.js', '--aufnahme=');
}

require('dotenv').config();
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

// EL: zwei Ansichten, zwei Funktionen. Welche gilt, entscheidet baueDienst
// anhand des Modus der Sitzung -- das Seitenmodul kennt diesen Dienst nicht.
const { baueSeite, baueLongformSeite } = require('./freigabe-seite');
// Die Pfadsperre kommt aus dem Leser. Eine eigene waere eine zweite Fassung
// derselben Regel, und zwei Fassungen einer Regel sind auf Dauer eineinhalb.
const { neueSperre } = require('./uebergabe-leser');
// EN: dieselbe Pruefung "liegt unterhalb", die der Arbeiter fuer die
// Videodatei und der Beipackzettel-Leser fuer das Bild verwendet. Eine eigene
// waere die zweite Fassung einer Regel, an der genau ein Zeichen falsch sein
// muesste, damit ein Pfad durchginge.
const { pfadLiegtUnter } = require('./uebergabe-leser');

// DNa Punkt 2c: die Zahlen stehen an EINER Stelle -- in der Tabelle EXIT_CODES
// in uebergabe-leser.js. Die drei Namen hier bleiben, weil sie die Faelle
// DIESES Dienstes benennen und weil sie so in der Zusage stehen
// (Bericht ZUSAGE-freigabedienst-aufruf.md, Abschnitt 5):
//   0 geordnetes Sitzungsende, 1 lief und lehnte den START ab, 2 lief nicht.
// Diese drei Werte sind Vertrag und werden nicht angetastet.
// EL: EXIT_CODES kommt dazu -- die Tabelle mit den BEDEUTUNGEN. Die
// Longform-Ansicht nennt den Rueckgabewert des Arbeiters und sagt, was er
// heisst; der Satz dazu wird von dort geholt und nicht hier ein zweites Mal
// formuliert.
const { EXIT, EXIT_CODES } = require('./uebergabe-leser');
const EXIT_OK = EXIT.OK;
const EXIT_ABBRUCH = EXIT.BEFUND;
const EXIT_AUFRUFFEHLER = EXIT.AUFRUF;

const HOST = '127.0.0.1';
// 8791 und nicht 8787: 8787 ist auf dem Rechner, auf dem dieser Dienst laufen
// soll, von einem fremden Prozess belegt (gemessen am 2026-09-01, netstat -ano:
// 127.0.0.1:8787, PID 36048). Ein Vorgabewert, der auf genau diesem Rechner nie
// funktioniert, ist kein Vorgabewert. Ist auch 8791 belegt, sagt der Dienst
// beim Start, wer ihn haelt -- siehe meldeBelegtenPort.
const STANDARD_PORT = 8791;

// Die Fassung DIESER Datei -- nicht die des Vertrags und nicht die der
// Uebergabedatei. Sie steigt, wenn sich die Form der Freigabedatei aendert.
const FREIGABE_SCHEMA_VERSION = '1.0';
const FREIGABE_ARTIFACT_TYPE = 'adw_shorts_freigaben';

const TITEL_MAX_ZEICHEN = 100;
const NOTIZ_MAX_ZEICHEN = 2000;
const MAX_ANFRAGE_BYTES = 16 * 1024;
const STROM_STUECK_BYTES = 1024 * 1024;

// Form JJJJ-MM-TT HH-MM-SS -- dieselbe wie im Leser. Sie steht hier ein zweites
// Mal, weil sie hier eine ANDERE Aufgabe hat: im Leser prueft sie ein Feld der
// Lieferung, hier haelt sie den einzigen Wert fest, aus dem dieser Dienst je
// einen Pfad baut (siehe freigabePfad).
const AUFNAHME_FORM = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// DIE ZWEI BETRIEBSMODI (EI, Vertrag 2.13)
// ---------------------------------------------------------------------------
//
// SHORTS IST DER STANDARD, UND ZWAR DURCH ABWESENHEIT. Der Knopf der
// Gegenseite ruft heute ohne Modusangabe -- die Zusage zur Freigabe-Naht
// (Abschnitt 1) zaehlt vier zulaessige Argumente auf, und keines davon ist ein
// Modus. Faellt das Argument weg, muss WOERTLICH das herauskommen, was vorher
// herauskam: derselbe Sperrdateiname, dieselbe Meldung, derselbe
// Rueckgabewert. Der Vorgabewert ist deshalb MODUS_SHORTS und nicht "kein
// Modus" -- ein dritter Zustand neben den zweien waere eine Stelle mehr, an
// der man sich irren kann.
//
// WARUM --modus=<wert> UND NICHT --longform ALS FLAG: ein Flag haette dem
// Shorts-Modus keinen Namen gegeben. Ein Modus ohne Namen laesst sich nicht
// ausdruecklich verlangen, nicht in einer Meldung nennen und nicht in eine
// Sperrdatei schreiben; man erkennt ihn nur an der Abwesenheit des anderen.
// Und der dritte Modus braeuchte ein zweites Flag samt der Frage, was zwei
// gesetzte Flags bedeuten sollen. Ein Wert stellt diese Frage nicht.
//
// Der Name des Modusarguments ist nicht zugesagt (Vertrag 9).
const MODUS_SHORTS = 'shorts';
const MODUS_LONGFORM = 'longform';
const MODI = [MODUS_SHORTS, MODUS_LONGFORM];

// Wie ein Modus in einem Satz heisst. Getrennt von den Werten oben, weil der
// Wert in einen Dateinamen geht und die Bezeichnung in eine Meldung.
//
// KEINE ZWEI EINTRAEGE DUERFEN GLEICH SEIN. Fielen "es laeuft bereits eine
// Shorts-Sitzung" und "es laeuft bereits eine Longform-Sitzung" zusammen,
// suchte der Mensch ein Fenster des falschen Modus -- genau der Schaden, den
// Vertrag 2.13 benennt. Der Test "die zwei Meldungen der Sperre sind
// verschieden" schnappt darauf zu.
const MODUS_BEZEICHNUNG = {
  [MODUS_SHORTS]: 'Shorts',
  [MODUS_LONGFORM]: 'Longform',
};

// Der Modus geht in einen DATEINAMEN (sperrPfad). Er wird deshalb genauso
// hart geprueft wie der Aufnahmename und nicht weicher: was nicht in MODI
// steht, wird kein Pfadbestandteil.
function pruefeModus(modus) {
  if (!MODI.includes(modus)) {
    throw new Error('Unbekannter Betriebsmodus: ' + JSON.stringify(modus) +
      '. Bekannt sind ' + MODI.join(', ') + '. Es wird kein Dateiname daraus gebaut.');
  }
  return modus;
}

// ---------------------------------------------------------------------------
// Die einzige Pfadkonstruktion des Dienstes
// ---------------------------------------------------------------------------

// Sie baut NICHT den Weg zu einem Video und nicht den Weg zur Uebergabedatei --
// beide kommen fertig aus der Lesereingabe. Sie baut allein den Weg zur
// Freigabedatei, also zu der einen Datei, die dieser Dienst selbst anlegt.
//
// <aufnahme> geht ungeprueft in einen Dateinamen -- deshalb steht die
// Formpruefung davor und nicht daneben. "..\\.." hat diese Form nicht, ein
// Laufwerksbuchstabe hat sie nicht, ein Schraegstrich hat sie nicht.
function freigabePfad(projektwurzel, aufnahme) {
  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new Error('Aufnahmename hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '. Es wird kein Dateiname daraus gebaut.');
  }
  return path.join(projektwurzel, 'data', 'freigaben', aufnahme + '.json');
}

// ---------------------------------------------------------------------------
// Die Eingabe: die --json-Ausgabe des Lesers, und sonst nichts
// ---------------------------------------------------------------------------

// WARUM --aufnahme= UND NICHT --eingabe=<datei> (die Begruendung im Auftrag):
//
// Beide Wege haetten dieselbe Zusage gehabt -- "die Oberflaeche liest die
// Uebergabedatei nicht selbst". Nur einer haelt sie mechanisch.
//
// Bei --eingabe=<datei> ist die Eingabe eine Datei, die BEHAUPTET, die Ausgabe
// des Lesers zu sein. Niemand pruefte, ob sie es ist. Sie koennte von Hand
// bearbeitet sein, sie koennte aus einem --ohne-platte-Lauf stammen (dann hat
// nie jemand nachgesehen, ob die Videos ueberhaupt existieren), sie koennte
// drei Tage alt sein und eine Lieferung beschreiben, die seither ersetzt wurde.
// Genau der Fehler, gegen den die harte Linie 1 gerichtet ist -- ein zweiter,
// schwaecherer Leser -- kaeme als zweite, schwaechere EINGABE zurueck, und
// diesmal ohne dass man ihn im Quelltext sehen koennte.
//
// Bei --aufnahme= ruft der Dienst den Leser selbst auf, mit --json und ohne
// --ohne-platte. Damit ist die Eingabe per Bauart frisch, vollstaendig geprueft
// und von genau einem Programm erzeugt. Der Leser wird AUFGERUFEN, nicht
// nachgebaut: hier steht ein spawnSync auf seine Datei und kein Nachbau seiner
// Regeln.
//
// Der Preis ist bekannt und wird nicht wegdefiniert: dieser Dienst startet
// einen Kindprozess, und ohne den Leser laeuft er nicht. Das ist der Punkt.
const LESER = path.join(__dirname, 'uebergabe-leser.js');

function ruftLeser(aufnahme, wurzel) {
  const argumente = [LESER, '--aufnahme=' + aufnahme, '--wurzel=' + wurzel, '--json'];
  const lauf = spawnSync(process.execPath, argumente, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (lauf.error) {
    return { fehler: 'Der Leser liess sich nicht starten: ' + lauf.error.message };
  }
  // Der Leser endet mit 0, wenn die Lieferung dem Vertrag entspricht, und mit
  // 1, wenn sie es nicht tut. BEIDE Faelle liefern einen vollstaendigen
  // Bericht -- eine Lieferung mit einem abgelehnten Eintrag ist genau der Fall
  // aus N9 und soll angezeigt werden. Mit 2 endet er bei einem Aufruffehler;
  // dann gibt es keinen Bericht, und hier wird nichts geraten.
  if (lauf.status !== 0 && lauf.status !== 1) {
    return {
      fehler: 'Der Leser endete mit Rueckgabewert ' + lauf.status + '. Ausgabe:\n' +
        (lauf.stderr || '') + (lauf.stdout || ''),
    };
  }
  const text = lauf.stdout;
  let bericht;
  try {
    bericht = JSON.parse(text);
  } catch (e) {
    return { fehler: 'Die Ausgabe des Lesers ist kein JSON (' + e.message + ').' };
  }
  return { text, bericht, ausgabe: lauf.stderr || '' };
}

// ---------------------------------------------------------------------------
// Aus dem Bericht des Lesers werden Karten
// ---------------------------------------------------------------------------

// Was auf den Schirm kommt, kommt AUSSCHLIESSLICH aus bericht.eintraege[].daten
// -- also aus dem Feld, das der Leser nur fuellt, wenn er den Eintrag
// angenommen UND die Platte geprueft hat. Ein Eintrag ohne `daten` bekommt eine
// Karte ohne Video, ohne Titelfeld und ohne Knopf.
//
// Beschreibung, Schlagworte, Sprache, Kategorie und Sichtbarkeit stehen
// bewusst NICHT auf der Karte. Sie sind fuer alle Shorts gleich und gehoeren in
// die Konfiguration des Uploaders, nicht zehnmal in ein Formular.
function baueKarten(bericht) {
  const karten = [];
  const sperre = neueSperre();
  const videoPfad = new Map();

  // Reihenfolge: die der Lesereingabe, und die ist die der Uebergabedatei.
  // NICHT sortiert -- eine andere Reihenfolge hat die Gegenseite nicht
  // zugesagt, und wer nach Titel sortiert, ordnet nach einem Feld, das der
  // Mensch auf dieser Seite gleich aendert.
  for (const e of bericht.eintraege) {
    const d = e.daten;
    if (!d) {
      karten.push({
        index: e.index,
        kennung: e.bezeichner || e.kennung || ('[' + e.index + ']'),
        freigebbar: false,
        ablehnungsgruende: (e.maengel || []).map(
          (m) => (m.feld ? m.feld + ': ' : '') + m.meldung),
      });
      continue;
    }
    // Ab hier ist d.pfad der einzige Wert, der jemals auf die Platte darf --
    // und nur genau so, wie er in der Lieferung stand.
    sperre.ausDatei(d.pfad);
    videoPfad.set(e.index, d.pfad);
    karten.push({
      index: e.index,
      kennung: d.kennung,
      freigebbar: true,
      ablehnungsgruende: [],
      sha256: d.sha256,
      groesse_bytes: d.groesse_bytes,
      dauer_ms: d.dauer_ms,
      breite: d.breite,
      hoehe: d.hoehe,
      titel_vorschlag: d.titel_vorschlag,
      transkript: d.transkript,
      quelle_von_ms: d.quelle_von_ms,
      quelle_bis_ms: d.quelle_bis_ms,
    });
  }
  return { karten, sperre, videoPfad };
}

// ---------------------------------------------------------------------------
// Die Titelpruefung -- serverseitig, und der Server ist der einzige Ort
// ---------------------------------------------------------------------------

// Jeder Fall bekommt einen eigenen Code und eine eigene Begruendung. Ein
// abgewiesener Titel wird BENANNT und nicht stillschweigend beschnitten:
// Beschneiden hiesse, dass jemand einen anderen Titel veroeffentlicht als den,
// den er gelesen hat.
//
// GEZAEHLT WIRD MIT DER ZAEHLFUNKTION DES UPLOADERS, nicht mit einer eigenen.
//
// Bis DR stand hier ein eigenes Array.from() und im Uploader ein .length --
// Codepunkte gegen UTF-16-Einheiten. Bei einem Titel mit einem Emoji hiess das
// 57 gegen 102: diese Seite haette ihn angenommen und der Uploader ihn
// abgewiesen, und zwar erst nach der Freigabe. Beide Seiten rufen jetzt
// dieselbe Funktion, und die Begruendung fuer ihre Zaehlweise steht dort --
// gemessen an 998 Titeln, die YouTube fuer diesen Kanal angenommen hat.
function pruefeTitel(roh) {
  if (typeof roh !== 'string') {
    return { ok: false, code: 'titel_kein_text',
      meldung: 'Der Titel ist kein Text (' + typeof roh + ').' };
  }
  if (roh.length === 0) {
    return { ok: false, code: 'titel_leer',
      meldung: 'Der Titel ist leer. Ein Short ohne Titel wird nicht freigegeben.' };
  }
  if (roh.trim().length === 0) {
    return { ok: false, code: 'titel_nur_leerzeichen',
      meldung: 'Der Titel besteht nur aus Leerzeichen (' + roh.length + ' Stueck). ' +
        'Das ist kein Titel, sieht aber im Feld wie einer aus.' };
  }
  const zeichen = UPLOADER_MODUL.zaehleTitelZeichen(roh);
  if (zeichen > TITEL_MAX_ZEICHEN) {
    return { ok: false, code: 'titel_zu_lang',
      meldung: 'Der Titel hat ' + zeichen + ' Zeichen, hoechstens ' + TITEL_MAX_ZEICHEN +
        ' sind zulaessig. Er wird NICHT beschnitten -- kuerze ihn selbst, sonst ' +
        'veroeffentlichst du einen anderen Titel als den, den du gelesen hast.' };
  }
  if (roh.includes('<') || roh.includes('>')) {
    return { ok: false, code: 'titel_spitze_klammer',
      meldung: 'Der Titel enthaelt < oder >. Beide Zeichen sind nicht zulaessig.' };
  }
  return { ok: true };
}

function pruefeNotiz(roh) {
  if (typeof roh !== 'string') {
    return { ok: false, code: 'notiz_kein_text',
      meldung: 'Die Notiz ist kein Text (' + typeof roh + ').' };
  }
  const zeichen = Array.from(roh).length;
  if (zeichen > NOTIZ_MAX_ZEICHEN) {
    return { ok: false, code: 'notiz_zu_lang',
      meldung: 'Die Notiz hat ' + zeichen + ' Zeichen, hoechstens ' + NOTIZ_MAX_ZEICHEN +
        ' sind zulaessig.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Die Freigabedatei
// ---------------------------------------------------------------------------

// SCHLUESSEL IST DIE sha256, NICHT DIE KENNUNG. So will es der Vertrag: die
// Kennung ist ein Name fuer Menschen, die Pruefsumme legt die Datei auf das Byte
// fest. Wird dieselbe Aufnahme neu gerendert, aendert sich die Pruefsumme und
// das alte Urteil trifft nicht mehr zu -- es steht dann auch nicht mehr auf der
// Karte, und das ist richtig so.
function leseFreigaben(pfad) {
  let text;
  try {
    text = fs.readFileSync(pfad, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { stand: {}, kopf: null, hinweis: null };
    return { stand: {}, kopf: null,
      hinweis: 'Die vorhandene Freigabedatei ist nicht lesbar (' + e.code + '). Es wird ' +
        'NICHT bei null angefangen und NICHTS ueberschrieben -- der Dienst bricht ab.',
      abbruch: true };
  }
  let daten;
  try {
    daten = JSON.parse(text);
  } catch (e) {
    return { stand: {}, kopf: null,
      hinweis: 'Die vorhandene Freigabedatei ist kein JSON (' + e.message + '). Der Dienst ' +
        'bricht ab, statt sie zu ueberschreiben: darin stehen Urteile eines Menschen, und ' +
        'die sind das einzige, was sich hier nicht neu erzeugen laesst.',
      abbruch: true };
  }
  if (daten === null || typeof daten !== 'object' || !Array.isArray(daten.freigaben)) {
    return { stand: {}, kopf: null,
      hinweis: 'Die vorhandene Freigabedatei hat eine unerwartete Form (freigaben ist keine ' +
        'Liste). Der Dienst bricht ab, statt sie zu ueberschreiben.',
      abbruch: true };
  }
  if (daten.schema_version !== FREIGABE_SCHEMA_VERSION) {
    return { stand: {}, kopf: null,
      hinweis: 'Die vorhandene Freigabedatei traegt schema_version ' +
        JSON.stringify(daten.schema_version) + ', dieser Dienst schreibt ' +
        FREIGABE_SCHEMA_VERSION + '. Der Dienst bricht ab: eine fremde Fassung nach den ' +
        'Regeln der eigenen zu lesen wuerde eine Zusage vortaeuschen, die niemand gegeben hat.',
      abbruch: true };
  }
  const stand = {};
  for (const e of daten.freigaben) {
    if (e && typeof e === 'object' && typeof e.sha256 === 'string') stand[e.sha256] = e;
  }
  return { stand, kopf: daten, hinweis: null };
}

// DER EINZIGE SCHREIBWEG DES DIENSTES.
//
// ATOMAR: temporaere Datei im SELBEN Verzeichnis, fsync, dann umbenennen. Ein
// Umbenennen innerhalb eines Verzeichnisses ist entweder geschehen oder nicht;
// eine halb geschriebene Freigabedatei kann es damit nicht geben. Der Leser
// bemerkt in der Uebergabedatei der Gegenseite ausdruecklich, dass DIE nicht
// atomar geschrieben wird -- dort gibt es dafuer einen Grund (die Datei
// entsteht am Ende eines langen Laufs und wird nur einmal geschrieben). Hier
// gibt es den Grund nicht: geschrieben wird nach JEDEM Klick, und ein Absturz
// beim vierzigsten darf die neununddreissig davor nicht kosten.
//
// Der Temporaername ist je Aufruf eindeutig (Zufall + Zaehler). Ein fester Name
// waere heute unschaedlich -- Node bedient alle Anfragen in einer Schleife --,
// aber genau darauf soll sich diese Funktion nicht verlassen muessen.
let tmpZaehler = 0;

function schreibeFreigaben(pfad, kopfDaten, eintraege) {
  const nutzlast = {
    artifact_type: FREIGABE_ARTIFACT_TYPE,
    schema_version: FREIGABE_SCHEMA_VERSION,
    aufnahme: kopfDaten.aufnahme,
    erzeugt_am: kopfDaten.erzeugt_am,
    geschrieben_am: kopfDaten.geschrieben_am,
    lesereingabe_sha256: kopfDaten.lesereingabe_sha256,
    freigaben: eintraege,
  };
  const inhalt = JSON.stringify(nutzlast, null, 2) + '\n';
  const verzeichnis = path.dirname(pfad);
  fs.mkdirSync(verzeichnis, { recursive: true });
  const tmp = path.join(verzeichnis,
    '.' + path.basename(pfad) + '.tmp.' + process.pid + '.' + (++tmpZaehler));
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, inhalt, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Ab hier ist die vollstaendige neue Fassung auf der Platte. Das Umbenennen
    // ersetzt die alte in einem Schritt.
    fs.renameSync(tmp, pfad);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (x) { /* egal */ } }
    try { fs.unlinkSync(tmp); } catch (x) { /* die Temporaerdatei war nie da */ }
    throw e;
  }
  return inhalt;
}

// ---------------------------------------------------------------------------
// DIE EINZELINSTANZ-SPERRE (DJa)
// ---------------------------------------------------------------------------
//
// DER SCHADEN, GEGEN DEN SIE GERICHTET IST -- gemessen, nicht vermutet:
// Jede Sitzung haelt den Stand der Freigaben im Speicher und schreibt bei jedem
// Klick die GANZE Datei neu. Laufen zwei Dienste auf dieselbe Aufnahme (auf
// verschiedenen Ports -- derselbe Port scheitert schon am Betriebssystem), dann
// hat jede Sitzung den Stand von IHREM Startzeitpunkt. Faellt in Sitzung A ein
// Urteil und danach in Sitzung B, schreibt B ihren alten Stand plus ihr eigenes
// Urteil -- und das von A ist weg. Kein Fehler, keine Meldung, kein Hinweis:
// der Mensch sieht seine Entscheidung auf dem Schirm der einen Seite stehen und
// nicht mehr in der Datei. Der Nachweis N2 des Berichts fuehrt genau das vor.
//
// EINE SPERRE JE AUFNAHME UND MODUS, NICHT JE RECHNER. Zwei Aufnahmen teilen
// sich keine Freigabedatei; sie gleichzeitig zu bearbeiten schadet niemandem
// und ist nuetzlich. Die Sperrdatei liegt darum NEBEN der Freigabedatei und
// traegt deren Namen: <aufnahme>.sperre.json neben <aufnahme>.json.
//
// EI (Vertrag 2.13): und je MODUS. Eine Shorts-Sitzung und eine
// Longform-Sitzung auf dieselbe Aufnahme schreiben keine gemeinsame Datei --
// die eine die Freigabedatei und den Plan, die andere das Longform-
// Gedaechtnis und ihre Ermaechtigungen. Eine Sperre, die beide gegeneinander
// haelt, schuetzt vor keinem Schaden und kostet ein Longform-Warten von bis
// zu 45 Minuten, in dem die Shorts derselben Aufnahme nicht beurteilt werden
// koennten. Zwei Sitzungen DESSELBEN Modus auf dieselbe Aufnahme bleiben
// ausgeschlossen -- dafuer ist die Sperre da.
//
// DER NAME DER SHORTS-SPERRE BLEIBT, WIE ER IST. Die Zusage zur Freigabe-Naht
// beschreibt ihr Verhalten, die Uebersicht kennt ihre Form, und beides soll
// fuer den Shorts-Knopf unveraendert wahr bleiben. Der zweite Modus bekommt
// einen Einschub vor der Endung: <aufnahme>.<modus>.sperre.json. Damit endet
// jede Sperrdatei auf .sperre.json -- wer in den Ordner sieht, erkennt beide
// am selben Suffix, und der Modus steht davor statt dahinter.
//
// WARUM data/freigaben/ UND NICHT irgendwo sonst: dieses Repo ist oeffentlich.
// /data/ steht in .gitignore (Zeile 10), die Sperrdatei taucht damit weder in
// `git status --porcelain --untracked-files=all` noch beim Freigabe-Check auf.
// Nachgeprueft, nicht angenommen -- siehe Bericht DJa, N9.
//
// WARUM 'wx' UND KEIN BLICK DAVOR: `existsSync` gefolgt von `openSync` hat ein
// Loch zwischen den beiden Zeilen, durch das ein zweiter Start passt. 'wx'
// legt an ODER scheitert mit EEXIST, in einem Schritt und im Betriebssystem.
// Das Anlegen IST die Pruefung.

const SPERRE_ARTIFACT_TYPE = 'adw_shorts_freigabe_sperre';

// EI: je Modus ein eigener Artefakttyp. Der Shorts-Wert steht UNVERAENDERT
// darueber und wird von hier aus verwiesen, damit man sieht, dass er derselbe
// geblieben ist. Eine Longform-Sperre mit "adw_shorts_..." im Kopf waere eine
// Luege in einem Feld, das heute niemand liest -- also genau die Sorte, die
// der naechste Leser fuer wahr nimmt.
const SPERRE_ARTIFACT_TYP_JE_MODUS = {
  [MODUS_SHORTS]: SPERRE_ARTIFACT_TYPE,
  [MODUS_LONGFORM]: 'adw_longform_freigabe_sperre',
};

// 1.1 und nicht mehr 1.0: der Inhalt traegt seit EI das Feld `modus`, und der
// Artefakttyp haengt daran. Die Fassung steigt, wenn sich die Form aendert.
const SPERRE_SCHEMA_VERSION = '1.1';

// Zweite Verwendung derselben Formpruefung: sperrPfad geht ueber freigabePfad,
// damit es nicht zwei Stellen gibt, an denen ein Aufnahmename zu einem
// Dateinamen wird. EI: auch der Modus geht hier durch und nirgends sonst --
// es gibt EINE Stelle, an der aus Aufnahme und Modus ein Sperrdateiname wird.
//
// OHNE MODUS IST SHORTS. Ein Aufruf, der den Modus weglaesst, bekommt Byte
// fuer Byte den Namen von DJa zurueck; das ist die Zusage an den Shorts-Knopf.
function sperrPfad(projektwurzel, aufnahme, modus = MODUS_SHORTS) {
  pruefeModus(modus);
  const frei = freigabePfad(projektwurzel, aufnahme);
  const einschub = modus === MODUS_SHORTS ? '' : '.' + modus;
  return path.join(path.dirname(frei), aufnahme + einschub + '.sperre.json');
}

// LEBT DER EINGETRAGENE PROZESS?
//
// Signal 0 stellt nichts zu, es fragt nur nach. Node bildet das unter Windows
// auf eine Existenzabfrage ab.
//
// IM ZWEIFEL GILT ER ALS LEBEND. Ein Irrtum in diese Richtung kostet einen
// Abbruch mit einer Meldung, die sagt, was zu tun ist. Ein Irrtum in die andere
// Richtung kostet die Urteile eines Menschen.
function prozessLebt(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { lebt: false, grund: 'in der Sperrdatei steht keine brauchbare Prozessnummer' };
  }
  try {
    process.kill(pid, 0);
    return { lebt: true, grund: 'der Prozess antwortet auf die Existenzabfrage (Signal 0)' };
  } catch (e) {
    if (e.code === 'ESRCH') {
      return { lebt: false, grund: 'es gibt keinen Prozess mit dieser Nummer mehr (ESRCH)' };
    }
    if (e.code === 'EPERM') {
      return { lebt: true,
        grund: 'der Prozess existiert, gehoert aber einem anderen Benutzer (EPERM)' };
    }
    return { lebt: true,
      grund: 'nicht entscheidbar (' + e.code + ') -- im Zweifel gilt er als lebend, weil ' +
        'ein Irrtum in diese Richtung nur einen Abbruch kostet und in die andere die ' +
        'Urteile eines Menschen' };
  }
}

// Lauscht dieser Prozess wirklich auf dem eingetragenen Port? Das ist KEIN
// Bestandteil der Entscheidung -- die faellt allein an prozessLebt --, sondern
// nur eine Ergaenzung der Meldung.
//
// GRUND FUER DIE TRENNUNG: Prozessnummern werden nach dem Ende eines Prozesses
// neu vergeben. Traefe die Entscheidung "lebt, lauscht aber nicht -> verwaist",
// dann fiele sie auch in dem Augenblick falsch, in dem der andere Dienst zwar
// schon die Sperre hat, aber seinen Port noch nicht offen -- und der zweite
// Start uebernaehme eine Sperre, die gerade genommen wurde. Also: die Antwort
// ist immer "belegt", und der Text sagt dem Menschen, wie sicher das ist.
function sperrePasstZumPort(pid, port) {
  if (!Number.isInteger(port) || port <= 0) return null;   // Port noch nicht eingetragen
  const halter = haelterDesPorts(port);
  if (halter === null) return null;                        // netstat lief nicht
  return halter.includes(String(pid));                     // [] -> false, und das stimmt
}

function leseSperre(pfad) {
  let text;
  try {
    text = fs.readFileSync(pfad, 'utf8');
  } catch (e) {
    return { gelesen: false, grund: 'nicht lesbar (' + (e.code || e.message) + ')' };
  }
  let daten;
  try {
    daten = JSON.parse(text);
  } catch (e) {
    // Eine halb geschriebene Sperrdatei heisst: der Schreiber ist beim
    // Schreiben gestorben. Die Datei wird in EINEM writeSync gefuellt, bevor
    // irgendetwas anderes passiert.
    return { gelesen: false, grund: 'kein JSON (' + e.message + ')' };
  }
  if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) {
    return { gelesen: false, grund: 'kein Objekt an oberster Stelle' };
  }
  return { gelesen: true, daten };
}

// EI: `modus` steht auch in der SHORTS-Sperre, nicht nur in der zweiten. Ein
// Feld, das nur die eine Sorte traegt, hiesse "fehlt = shorts" -- und diese
// Regel muesste dann jeder kennen, der die Datei aufmacht.
function sperrinhalt({ aufnahme, pid, port, gestartet_am, modus = MODUS_SHORTS }) {
  pruefeModus(modus);
  return {
    artifact_type: SPERRE_ARTIFACT_TYP_JE_MODUS[modus],
    schema_version: SPERRE_SCHEMA_VERSION,
    aufnahme,
    modus,
    pid,
    port,
    gestartet_am,
  };
}

// Schreibt IN DEN OFFENEN DESKRIPTOR, nicht ueber den Pfad. Der Deskriptor
// stammt aus dem 'wx'-Aufruf und gehoert damit sicher uns; ein Schreiben ueber
// den Pfad wuerde eine fremde Datei treffen, falls uns die Sperre inzwischen
// jemand weggenommen haette.
function schreibeSperrinhalt(fd, inhalt) {
  const text = JSON.stringify(inhalt, null, 2) + '\n';
  fs.ftruncateSync(fd, 0);
  fs.writeSync(fd, text, 0, 'utf8');
  fs.fsyncSync(fd);
  return text;
}

// Rueckgabe:
//   { ok: true,  pfad, modus, fd, inhalt, verwaist }   -- Sperre gehoert uns
//   { ok: false, pfad, modus, vorhanden, leben, port }  -- ein anderer haelt sie
//
// EI: `modus` steht in BEIDEN Rueckgaben, weil meldeFremdeSperre ihn braucht
// und ihn nicht aus dem Dateinamen zurueckrechnen soll. Er stammt aus dem
// Aufruf und nicht aus der gefundenen Datei: was dort steht, hat ein anderer
// Prozess geschrieben, und die Sperre gilt fuer den Modus, in dem WIR starten.
// Beide sind ohnehin gleich -- der Pfad trennt sie ja --, aber die Meldung
// soll von einer Angabe leben, die dieser Prozess selbst kennt.
//
// `verwaist` ist null oder beschreibt die uebernommene Leiche. Sie wird
// AUSDRUECKLICH benannt und nicht stillschweigend ueberschrieben: eine
// Sperrdatei, die einfach so verschwindet, ist eine Sperre, der niemand mehr
// glaubt.
function nimmSperre({ projektwurzel, aufnahme, modus = MODUS_SHORTS,
  pid = process.pid, jetzt = new Date() }) {
  const pfad = sperrPfad(projektwurzel, aufnahme, modus);
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  let verwaist = null;

  // Zwei Durchlaeufe, nicht mehr: einer fuer den Normalfall, einer nach dem
  // Aufraeumen genau einer verwaisten Sperre. Wer nach dem Aufraeumen wieder
  // EEXIST bekommt, ist einem echten zweiten Start begegnet, der schneller war
  // -- und dann ist "belegt" die richtige Antwort, nicht ein dritter Versuch.
  for (let versuch = 0; versuch < 2; versuch++) {
    let fd;
    try {
      fd = fs.openSync(pfad, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const gelesen = leseSperre(pfad);
      const vorhanden = gelesen.gelesen ? gelesen.daten : null;
      const leben = vorhanden
        ? prozessLebt(vorhanden.pid)
        : { lebt: false, grund: 'die Sperrdatei ist ' + gelesen.grund +
            ' -- wer sie geschrieben hat, ist dabei gestorben' };
      if (leben.lebt || versuch > 0) {
        return {
          ok: false, pfad, modus, vorhanden, leben,
          lauschtAufPort: vorhanden ? sperrePasstZumPort(vorhanden.pid, vorhanden.port) : null,
          wettlauf: versuch > 0,
        };
      }
      verwaist = { vorhanden, grund: leben.grund };
      // Nur jetzt, und nur nachdem feststeht, dass niemand mehr dahintersteht.
      fs.unlinkSync(pfad);
      continue;
    }
    const inhalt = sperrinhalt({
      aufnahme, pid, port: null, gestartet_am: jetzt.toISOString(), modus });
    try {
      schreibeSperrinhalt(fd, inhalt);
    } catch (e) {
      try { fs.closeSync(fd); } catch (x) { /* egal */ }
      try { fs.unlinkSync(pfad); } catch (x) { /* egal */ }
      throw e;
    }
    return { ok: true, pfad, modus, fd, inhalt, verwaist };
  }
  /* nicht erreichbar: beide Zweige der Schleife kehren zurueck */
  throw new Error('nimmSperre: unerreichbarer Zweig');
}

// Der Port steht erst fest, wenn der Dienst laeuft. Bis dahin steht `null` in
// der Sperrdatei -- und `null` heisst nicht "kein Port", sondern "faehrt gerade
// hoch". sperrePasstZumPort gibt darauf null zurueck und nicht false.
function traegeSperrePortNach(sperre, port) {
  sperre.inhalt = Object.assign({}, sperre.inhalt, { port });
  schreibeSperrinhalt(sperre.fd, sperre.inhalt);
  return sperre.inhalt;
}

// NUR DIE EIGENE. Vor dem Loeschen wird nachgelesen, wessen Nummer darinsteht.
//
// Ein Dienst, der beim Aufraeumen die Sperre eines anderen entfernt, ist
// schlimmer als gar keine Sperre: er macht den Weg frei fuer genau den
// Doppelbetrieb, gegen den die Sperre gebaut ist, und zwar in dem Augenblick,
// in dem alle Beteiligten glauben, sie sei in Ordnung.
function gibSperreFrei(sperre, pid = process.pid) {
  if (sperre === null || sperre === undefined) return { geloescht: false, grund: 'keine Sperre' };
  if (sperre.fd !== undefined) {
    try { fs.closeSync(sperre.fd); } catch (e) { /* schon zu */ }
    sperre.fd = undefined;
  }
  const gelesen = leseSperre(sperre.pfad);
  if (!gelesen.gelesen) {
    return { geloescht: false,
      grund: 'die Sperrdatei ist ' + gelesen.grund + ' -- sie wird NICHT geloescht, weil ' +
        'nicht mehr zu erkennen ist, wem sie gehoert' };
  }
  if (gelesen.daten.pid !== pid) {
    return { geloescht: false,
      grund: 'in der Sperrdatei steht Prozessnummer ' + JSON.stringify(gelesen.daten.pid) +
        ', wir sind ' + pid + '. Sie gehoert einem anderen und bleibt liegen.' };
  }
  try {
    fs.unlinkSync(sperre.pfad);
  } catch (e) {
    return { geloescht: false, grund: 'liess sich nicht loeschen (' + (e.code || e.message) + ')' };
  }
  return { geloescht: true, grund: 'die eigene Sperre wurde freigegeben' };
}

// "Damit der Mensch sie findet, statt zu raten."
//
// EI: der erste Satz bleibt WOERTLICH stehen. Die Zusage zur Freigabe-Naht
// (Abschnitt 8) laesst den Knopf der Gegenseite genau nach ihm suchen, um den
// Fall "Sitzung schon offen" von einem Fehlschlag zu unterscheiden. Der Modus
// kommt als eigene Zeile dazu, nicht in diesen Satz hinein.
function meldeFremdeSperre(ergebnis, aufnahme) {
  const v = ergebnis.vorhanden;
  const modus = pruefeModus(ergebnis.modus === undefined ? MODUS_SHORTS : ergebnis.modus);
  const z = [];
  z.push('');
  z.push('ABBRUCH: Fuer die Aufnahme ' + aufnahme + ' laeuft bereits eine Freigabesitzung.');
  z.push('');
  // Der Modus kommt aus dem PFAD dieses Starts, nicht aus der fremden Datei --
  // er steht auch dann da, wenn die Sperrdatei unlesbar ist.
  z.push('  Betriebsmodus:  ' + MODUS_BEZEICHNUNG[modus]);
  if (v) {
    z.push('  Prozessnummer:  ' + v.pid);
    z.push('  Port:           ' + (v.port === null || v.port === undefined
      ? '(noch keiner -- diese Sitzung faehrt gerade hoch)'
      : v.port + '   ->   http://' + HOST + ':' + v.port + '/'));
    z.push('  Gestartet am:   ' + v.gestartet_am);
    z.push('  Aufnahme:       ' + v.aufnahme);
  } else {
    z.push('  Die Sperrdatei war nicht zu lesen: ' + ergebnis.leben.grund);
  }
  z.push('  Sperrdatei:     ' + ergebnis.pfad);
  z.push('');
  z.push('Befund: ' + ergebnis.leben.grund + '.');
  if (ergebnis.lauschtAufPort === true) {
    z.push('Bestaetigt: diese Prozessnummer lauscht tatsaechlich auf Port ' + v.port +
      ' (aus netstat -ano). Es ist mit grosser Sicherheit die laufende Sitzung.');
  } else if (ergebnis.lauschtAufPort === false) {
    z.push('ACHTUNG: die Prozessnummer lebt, lauscht aber NICHT auf Port ' + v.port +
      ' (aus netstat -ano). Prozessnummern werden nach dem Ende eines Prozesses neu ' +
      'vergeben -- moeglicherweise gehoert sie inzwischen einem voellig anderen Programm. ' +
      'Sieh im Task-Manager nach, was Nummer ' + v.pid + ' heute ist. Ist es nicht diese ' +
      'Freigabesitzung, loesche die Sperrdatei oben von Hand.');
  } else if (ergebnis.wettlauf) {
    z.push('Die Sperre wurde zwischen zwei Versuchen genommen -- ein zweiter Start war ' +
      'um Sekundenbruchteile schneller.');
  }
  z.push('');
  if (modus === MODUS_SHORTS) {
    z.push('Es wurde NICHTS in die Freigabedatei geschrieben und keine Seite ausgeliefert.');
    z.push('Zwei Shorts-Sitzungen auf DIESELBE Aufnahme wuerden sich die Urteile gegenseitig ' +
      'ueberschreiben; zwei auf verschiedene Aufnahmen sind erlaubt und stoeren einander nicht.');
  } else {
    // Kein Wort ueber die Freigabedatei: in diesem Modus fasst der Dienst sie
    // nicht an, und eine Auskunft ueber etwas, das gar nicht geschieht, ist
    // keine Beruhigung, sondern eine Spur ins Falsche.
    z.push('Es wurde NICHTS geschrieben und keine Seite ausgeliefert.');
    z.push('Zwei ' + MODUS_BEZEICHNUNG[modus] + '-Sitzungen auf DIESELBE Aufnahme laesst ' +
      'dieser Dienst nicht zu (docs/VERTRAG-longform.md, 2.13); zwei auf verschiedene ' +
      'Aufnahmen sind erlaubt und stoeren einander nicht.');
  }
  // Der Satz, der die beiden Modi auseinanderhaelt: wer hier steht, soll nicht
  // ein Fenster des anderen Modus suchen.
  z.push('Die Sperre gilt je Aufnahme UND Modus. Was hier bereits laeuft, ist eine ' +
    MODUS_BEZEICHNUNG[modus] + '-Sitzung; eine Sitzung in einem anderen Modus auf ' +
    'dieselbe Aufnahme waere zulaessig -- sie braucht dann ihren eigenen --port=, ' +
    'wie jede zweite Sitzung auf diesem Rechner.');
  z.push('');
  return z.join('\n');
}

// ---------------------------------------------------------------------------
// DIE KETTE (DR) -- EINPLANEN, VORSCHAU, HOCHLADEN
// ---------------------------------------------------------------------------
//
// WAS SICH HIER AENDERT, UND WAS AUSDRUECKLICH NICHT.
//
// Bis DR endete dieser Dienst an der Freigabeseite. Danach tippte Joshua zwei
// Befehle ins Terminal: den Planer und den Uploader, den zweiten mit --execute
// und einem getippten HOCHLADEN. Das faellt hier weg -- drei Schritte auf der
// Seite treten an seine Stelle:
//
//   Schritt 1  "Einplanen und Vorschau"   -> ruftPlaner + ruftUploaderTrocken
//   Schritt 2  die Vorschau lesen          -> nichts; das tut ein Mensch
//   Schritt 3  "Hochladen"                 -> schreibeErmaechtigung +
//                                             starteUploaderLauf
//
// DER TERMINALWEG BLEIBT VOLLSTAENDIG BESTEHEN UND UNVERAENDERT. Er ist der
// Rueckfallweg, wenn dieser Dienst nicht laeuft, und er verlangt weiterhin das
// getippte Wort. Nichts an planer.js oder am Terminalzweig von uploader.js ist
// dafuer angefasst worden.
//
// DREI ZUSAGEN DIESES DIENSTES SIND DAMIT ANDERS GEWORDEN. Sie werden hier
// NEU FORMULIERT und nicht stillschweigend fallengelassen:
//
//   (a) "Der Dienst schreibt ZWEI Dateien" (harte Linie 4) heisst jetzt VIER,
//       jede weiterhin durch genau eine Funktion. Dazu unten.
//   (b) "Es gibt drei Kindprozesse, alle beim Start" (harte Linie 2) stimmt
//       nicht mehr. Was stimmt und was der Punkt daran war, steht dort.
//   (c) "Ein Urteil loest nichts aus -- kein Upload, kein Folgeschritt"
//       (Commit 8061609) gilt UNVERAENDERT: kein Urteil loest hier etwas aus.
//       Ausgeloest wird die Kette von drei eigenen, benannten Knoepfen, jeder
//       mit einer eigenen Route, und keiner davon haengt an POST /urteil.
//
// WARUM DER DIENST DEN PLANER UND DEN UPLOADER AUFRUFT UND NICHT NACHBAUT:
// derselbe Grund wie beim Leser (siehe oben bei LESER). Ein zweiter Planer
// waere ein zweiter, der die 08-20-Uhr-Regel kennt; ein zweiter Uploader waere
// einer ohne die Sperrliste, ohne die Pruefsummenpruefung und ohne das fest
// verdrahtete privacyStatus. Hier stehen spawn-Aufrufe auf ihre Dateien und
// kein Nachbau ihrer Regeln.

const PLANER = path.join(__dirname, 'planer.js');
const UPLOADER = path.join(__dirname, 'uploader.js');

// Die Form der Ermaechtigung kommt von dem, der sie PRUEFT -- aus uploader.js.
// Sie hier ein zweites Mal hinzuschreiben hiesse, die Felder des scharfen
// Laufs an zwei Stellen zu pflegen; die zweite waere ausgerechnet die, die ihn
// ausloest.
const UPLOADER_MODUL = require('./uploader');

// Die Projektwurzel DIESES Moduls. Sie ist zugleich die des Planers und die
// des Uploaders -- alle drei liegen in src/upload/ und rechnen sie gleich aus.
// Genau deshalb darf die Kette nur auf einer Sitzung laufen, die dieselbe
// Wurzel traegt: ein Kindprozess koennte gar nicht auf eine andere gelenkt
// werden, und ein Dienst, der auf Wurzel A zeigt, waehrend seine Kinder auf B
// schreiben, waere die gefaehrlichste Art von Missverstaendnis.
const PROJEKTWURZEL = path.join(__dirname, '..', '..');

const ARCHIV_ORDNER = 'archiv';

// Der Plan- und der Ermaechtigungspfad kommen aus uploader.js. Es gibt damit
// weiterhin genau eine Stelle je Zielordner im Projekt.
function planPfadDerKette(projektwurzel, aufnahme) {
  return UPLOADER_MODUL.planPfad(projektwurzel, aufnahme);
}

// Wie sperrPfad ueber freigabePfad geht, geht dieser hier ueber planPfad: der
// Ordner data/plaene steht nicht ein zweites Mal im Projekt.
function archivPfad(projektwurzel, aufnahme, jetzt) {
  const plan = planPfadDerKette(projektwurzel, aufnahme);
  const stempel = new Date(jetzt).toISOString().replace(/[:.]/g, '-');
  return path.join(path.dirname(plan), ARCHIV_ORDNER, aufnahme + '.archiviert-' + stempel + '.json');
}

// SCHREIBWEG 3: DAS ARCHIVIEREN.
//
// Der Planer weigert sich, einen bestehenden Plan zu ueberschreiben, und das
// bleibt so -- es ist die richtige Weigerung: ein Plan ist der Beleg dafuer,
// was hochgeladen werden sollte. Wer neu planen will, raeumt den alten weg,
// und das ist eine HANDLUNG EINES MENSCHEN. Auf der Seite steht dafuer ein
// eigener, benannter Knopf; es gibt keinen stillen Zwischenschritt, der das
// nebenbei erledigt.
//
// VERSCHOBEN, NICHT GELOESCHT. renameSync innerhalb desselben Ordnerbaums:
// entweder ist der Plan danach im Archiv oder er liegt noch da, wo er lag. Ein
// dritter Ausgang -- weg -- kann nicht entstehen.
function archiviereAltenPlan(projektwurzel, aufnahme, jetzt = Date.now()) {
  const quelle = planPfadDerKette(projektwurzel, aufnahme);
  const ziel = archivPfad(projektwurzel, aufnahme, jetzt);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.renameSync(quelle, ziel);
  return { quelle, ziel };
}

// SCHREIBWEG 4: DIE EINMAL-ERMAECHTIGUNG.
//
// Atomar wie die Freigabedatei: temporaere Datei im selben Verzeichnis, fsync,
// umbenennen. Eine halb geschriebene Ermaechtigung waere hier kein Datenverlust
// -- der Uploader wuerde sie ablehnen --, aber sie waere ein Fehlerbild, das
// wie ein Angriff aussieht und keiner ist.
//
// WARUM SIE UEBERHAUPT UEBER EINE DATEI GEHT und nicht ueber ein Argument:
// ein Argument stuende in der Prozessliste jedes Benutzers dieses Rechners,
// und der Uploader koennte nicht pruefen, WANN es entstanden ist. Die Datei
// traegt ihren Zeitpunkt in sich und wird beim Verbrauch geloescht.
function schreibeErmaechtigung(pfad, inhalt) {
  const text = JSON.stringify(inhalt, null, 2) + '\n';
  const verzeichnis = path.dirname(pfad);
  fs.mkdirSync(verzeichnis, { recursive: true });
  const tmp = path.join(verzeichnis,
    '.' + path.basename(pfad) + '.tmp.' + process.pid + '.' + (++tmpZaehler));
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, pfad);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (x) { /* egal */ } }
    try { fs.unlinkSync(tmp); } catch (x) { /* war nie da */ }
    throw e;
  }
  return text;
}

// AUF WELCHEN KANAL? Die Frage stand bisher in der getippten Rueckfrage des
// Uploaders, und sie muss auf dem Knopf stehen -- ein Knopf, der nicht sagt,
// wohin er sendet, ist keine Bestaetigung.
//
// DIESER DIENST FRAGT DAFUER NICHT DAS NETZ. Er hat noch nie einen Netzaufruf
// gemacht, und das soll so bleiben; die Seite selbst darf nach ihrer eigenen
// Richtlinie ohnehin nur mit ihm sprechen. Genommen wird darum, was der letzte
// Lauf von `npm run inventory` auf die Platte geschrieben hat.
//
// DAS IST NUR DIE ANZEIGE. Verbindlich wird die Angabe erst dadurch, dass die
// Kanalkennung in die Ermaechtigung geht und der Uploader sie gegen
// channels.list haelt -- er ist der einzige hier, der den Kanal wirklich
// fragen kann. Stimmt sie nicht, laedt er nichts hoch. Fehlt inventory.json,
// wird Schritt 3 gar nicht erst angeboten: ein Knopf, der den Kanal nicht
// nennen kann, erfuellt seine Aufgabe nicht.
function leseKanal(projektwurzel) {
  const p = path.join(projektwurzel, 'data', 'inventory.json');
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) {
    return { ok: false, pfad: p,
      grund: 'data/inventory.json ist nicht lesbar (' + (e.code || e.message) + '). Ohne sie ' +
        'kann dieser Dienst den Kanal nicht benennen. Einmal `npm run inventory` laufen ' +
        'lassen -- oder den Terminalweg nehmen, dort nennt der Uploader den Kanal selbst.' };
  }
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return { ok: false, pfad: p, grund: 'data/inventory.json ist kein JSON (' + e.message + ').' };
  }
  if (!d || typeof d.channelId !== 'string' || !d.channelId.trim() ||
      typeof d.channelTitle !== 'string' || !d.channelTitle.trim()) {
    return { ok: false, pfad: p,
      grund: 'data/inventory.json nennt keinen Kanal (channelId/channelTitle fehlen).' };
  }
  return { ok: true, pfad: p, id: d.channelId, name: d.channelTitle,
    erzeugt_am: typeof d.generatedAt === 'string' ? d.generatedAt : null };
}

// ---------------------------------------------------------------------------
// Die beiden Kindprozesse der Kette
// ---------------------------------------------------------------------------

// Beide sind spawnSync und blockieren damit den Dienst, solange sie laufen.
// Das ist Absicht: waehrend Schritt 1 laeuft, soll auf dieser Seite nichts
// anderes gehen -- schon gar kein zweiter Schritt 1. Ein Mensch, der auf eine
// Vorschau wartet, spielt kein Video ab.

function ruftPlaner(aufnahme) {
  const argumente = [PLANER, '--freigabe=' + aufnahme, '--execute', '--json'];
  const lauf = spawnSync(process.execPath, argumente, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 170000,
  });
  return {
    befehl: 'node ' + path.relative(PROJEKTWURZEL, PLANER) + ' --freigabe="' + aufnahme +
      '" --execute --json',
    code: lauf.status, fehler: lauf.error ? lauf.error.message : null,
    aus: lauf.stdout || '', err: lauf.stderr || '',
  };
}

// Der Trockenlauf des Uploaders -- WOERTLICH derselbe, der im Terminal steht.
// Kein Netzaufruf, kein Upload; --vorschau-json legt auf stderr eine Zeile mit
// den Zahlen dazu, damit dieser Dienst die Vorschau nicht nach ihnen absuchen
// muss. stdout bleibt Byte fuer Byte die Ausgabe des Terminalwegs.
function ruftUploaderTrocken(aufnahme) {
  const argumente = [UPLOADER, '--plan=' + aufnahme, '--vorschau-json'];
  const lauf = spawnSync(process.execPath, argumente, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 170000,
  });
  return {
    befehl: 'node ' + path.relative(PROJEKTWURZEL, UPLOADER) + ' --plan="' + aufnahme + '"',
    code: lauf.status, fehler: lauf.error ? lauf.error.message : null,
    aus: lauf.stdout || '', err: lauf.stderr || '',
  };
}

// Der scharfe Lauf. spawn (nicht spawnSync): er dauert Minuten, und die Seite
// soll waehrenddessen den Fortschritt je Short sehen koennen.
//
// stdin ist 'ignore'. Der Uploader hat damit kein Terminal -- und genau das
// ist der Fall, in dem er OHNE Ermaechtigung mit Rueckgabewert 4 abbricht.
// Dass er hier laeuft, liegt allein an --bestaetigt-durch=.
function starteUploaderLauf(sitzung, ermaechtigungPfad, beiZeile, beiEnde) {
  const argumente = [UPLOADER, '--plan=' + sitzung.aufnahme, '--execute',
    '--bestaetigt-durch=' + ermaechtigungPfad];
  const kind = spawn(process.execPath, argumente, {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const rest = { aus: '', err: '' };
  const strom = (name, kanal) => {
    kanal.setEncoding('utf8');
    kanal.on('data', (s) => {
      rest[name] += s;
      const teile = rest[name].split('\n');
      rest[name] = teile.pop();
      for (const z of teile) beiZeile(name, z);
    });
  };
  strom('aus', kind.stdout);
  strom('err', kind.stderr);
  kind.on('error', (e) => {
    beiZeile('err', 'Der Uploader liess sich nicht starten: ' + (e.code || e.message));
    beiEnde(null, null);
  });
  kind.on('close', (code, signal) => {
    if (rest.aus) beiZeile('aus', rest.aus);
    if (rest.err) beiZeile('err', rest.err);
    beiEnde(code, signal);
  });
  return {
    kind,
    befehl: 'node ' + path.relative(PROJEKTWURZEL, UPLOADER) + ' --plan="' + sitzung.aufnahme +
      '" --execute --bestaetigt-durch=<ermaechtigung>',
  };
}

// ---------------------------------------------------------------------------
// Der Zustand der Kette -- serverseitig, und der Server ist der einzige Ort
// ---------------------------------------------------------------------------
//
// N4 haengt an dieser Stelle: Schritt 3 ist nicht anklickbar, bevor Schritt 1
// gelaufen ist -- und zwar HIER geprueft, nicht im Browser. Der Browser sperrt
// den Knopf zusaetzlich, aber das ist Bequemlichkeit; eine Anfrage, die den
// Browser umgeht, faellt an schritt3Bereit().
function neueKette() {
  return {
    vorschau: null,       // { text, plan_sha256, anzahl, ... } -- Schritt 1 gelaufen
    meldung: null,        // was Schritt 1 zu sagen hatte
    planWarSchonDa: false,
    archiviert: [],
    lauf: null,
  };
}

function schritt3Bereit(sitzung) {
  const k = sitzung.kette;
  if (k.lauf && k.lauf.laeuft) {
    return { bereit: false, grund: 'Es laeuft gerade ein Upload. Zwei gleichzeitig gibt es nicht.' };
  }
  if (k.lauf && k.lauf.ende) {
    return { bereit: false, grund: 'Dieser Lauf ist abgeschlossen. Fuer einen weiteren zuerst ' +
      'wieder Schritt 1 -- dann sieht auch wieder ein Mensch, was hochginge.' };
  }
  if (!k.vorschau) {
    return { bereit: false, grund: 'Schritt 1 ist noch nicht gelaufen. Es gibt keine Vorschau, ' +
      'also hat niemand gesehen, was hochgehen wuerde.' };
  }
  if (k.vorschau.anzahl === 0) {
    return { bereit: false, grund: 'Die Vorschau nennt 0 Shorts. Es gibt nichts hochzuladen.' };
  }
  if (!k.vorschau.kanal_bekannt) {
    return { bereit: false, grund: 'Der Kanal ist nicht zu benennen: ' + k.vorschau.kanal_grund };
  }
  return { bereit: true, grund: null };
}

function kettenstand(sitzung) {
  const k = sitzung.kette;
  const b = schritt3Bereit(sitzung);
  const planVorhanden = fs.existsSync(planPfadDerKette(sitzung.projektwurzel, sitzung.aufnahme));
  return {
    aufnahme: sitzung.aufnahme,
    eigene_projektwurzel: sitzung.projektwurzel === PROJEKTWURZEL,
    plan_vorhanden: planVorhanden,
    plan_pfad: planPfadDerKette(sitzung.projektwurzel, sitzung.aufnahme),
    plan_war_schon_da: k.planWarSchonDa,
    archiviert: k.archiviert,
    meldung: k.meldung,
    // Der Kanal geht als NAME auf die Seite, nicht als Kennung. Die Kennung
    // steht in der Ermaechtigung, wo sie hingehoert -- gebraucht wird sie vom
    // Uploader und nicht vom Browser.
    vorschau: k.vorschau === null ? null : {
      text: k.vorschau.text,
      befehl: k.vorschau.befehl,
      anzahl: k.vorschau.anzahl,
      kennungen: k.vorschau.kennungen,
      termine_im_plan: k.vorschau.termine_im_plan,
      schon_hochgeladen: k.vorschau.schon_hochgeladen,
      plan_sha256: k.vorschau.plan_sha256,
      erstellt_am: k.vorschau.erstellt_am,
      kanal_name: k.vorschau.kanal_name,
      kanal_bekannt: k.vorschau.kanal_bekannt,
      kanal_grund: k.vorschau.kanal_grund,
      kanal_erzeugt_am: k.vorschau.kanal_erzeugt_am,
      // DW: durchgereicht, nicht neu gebildet. Der Dienst rechnet hier nichts
      // aus -- er gibt weiter, was der Uploader gerechnet hat.
      anschluss: k.vorschau.anschluss || null,
    },
    lauf: k.lauf === null ? null : {
      laeuft: k.lauf.laeuft,
      gestartet_am: k.lauf.gestartet_am,
      anzahl: k.lauf.anzahl,
      befehl: k.lauf.befehl,
      zeilen_gesamt: k.lauf.zeilen.length,
      ende: k.lauf.ende,
    },
    schritt3: b,
  };
}

// ---------------------------------------------------------------------------
// Bereichsanfragen (RFC 7233) -- Pflicht fuer <video>
// ---------------------------------------------------------------------------

// Ohne sie springt kein Browser im Video: er laedt die Datei von vorn und
// verweigert jedes Suchen. Unterstuetzt wird genau der Ein-Bereich-Fall, mehr
// fragt ein <video> nicht an.
function leseBereich(kopf, dateiGroesse) {
  if (kopf === undefined || kopf === null || kopf === '') return null;
  if (!kopf.startsWith('bytes=')) throw new Error('nicht unterstuetzte Einheit: ' + kopf);
  const teil = kopf.slice('bytes='.length).split(',')[0].trim();
  if (!teil.includes('-')) throw new Error('unlesbare Bereichsangabe: ' + teil);
  const trenn = teil.indexOf('-');
  const vonText = teil.slice(0, trenn);
  const bisText = teil.slice(trenn + 1);
  let von;
  let bis;
  if (vonText === '') {
    if (bisText === '') throw new Error('leere Bereichsangabe');
    const laenge = Number(bisText);
    if (!Number.isInteger(laenge) || laenge <= 0) throw new Error('unlesbare Suffixlaenge');
    von = Math.max(0, dateiGroesse - laenge);
    bis = dateiGroesse - 1;
  } else {
    von = Number(vonText);
    bis = bisText === '' ? dateiGroesse - 1 : Number(bisText);
    if (!Number.isInteger(von) || !Number.isInteger(bis)) throw new Error('unlesbare Zahl');
  }
  if (von < 0 || bis < von || von >= dateiGroesse) throw new Error('Bereich ausserhalb der Datei');
  return { von, bis: Math.min(bis, dateiGroesse - 1) };
}

// ---------------------------------------------------------------------------
// Der Dienst
// ---------------------------------------------------------------------------

// DIE ROUTEN HAENGEN AM MODUS, DER TORWAECHTER NICHT (EL).
//
// Was JE MODUS verschieden ist, steht in genau diesen beiden Tabellen: welche
// Namen es ueberhaupt gibt. Alles davor -- die Bindung an 127.0.0.1, die
// Host-Pruefung, die Origin-Pruefung, das Sitzungstoken -- steht EINMAL im
// Handler unten und kennt den Modus nicht. Ein Modus, der sich seine eigenen
// Sicherungen baut, hat sie beim naechsten Mal anders gebaut.
//
// DER LONGFORM-MODUS HAT ZWEI LESENDE ROUTEN UND KEINE EINZIGE MIT POST.
//
// Die leere POST-Liste ist die Zusage selbst: die Ansicht zeigt den
// Trockenlauf und hoert dort auf. Sie holt keinen Stand nach, spielt kein
// Video ab, startet nichts und schickt nichts zurueck -- ihre Seite traegt
// darum auch kein fetch, kein Formular und keinen Knopf (EL). Eine leere
// POST-Liste laesst sich in einem Blick pruefen; "der eine Knopf schreibt ja
// nichts" muss man glauben.
//
// EN: '/bild' KOMMT DAZU, UND SIE IST LESEND. Vertrag 4, Schritt 7 verlangt,
// dass der Mensch das Thumbnail sieht, bevor er urteilt; ein Bild, das er
// nicht sieht, kann er nicht beurteilen. Die Route liefert GENAU die eine
// Datei aus, die der Arbeiter in seiner Befundzeile benannt hat, und sie
// NIMMT DAZU NICHTS ENTGEGEN -- kein i, kein p, keinen Namen, keinen Pfad.
// Was sie ausliefert, stand fest, bevor die erste Anfrage kam.
//
// Die Zusage "kein Weg zurueck zum Dienst" bleibt damit wahr: ein <img src>
// ist eine Anzeige und kein Aufruf. Die Seite traegt weiterhin kein fetch,
// kein Formular, keinen Knopf und kein Ereignis.
//
// WAS DAS KOSTET, und es wird nicht wegdefiniert: der Longform-Modus hat
// keinen Knopf "Sitzung beenden". Er wird mit Strg+C in dem Terminal
// beendet, in dem er gestartet wurde -- und dort steht ohnehin der Mensch,
// der ihn gestartet hat. Kommt spaeter der Knopf, der hochlaedt (Vertrag 4,
// Schritte 8 bis 17), kommt die POST-Route mit ihm und nicht vorher.
const ROUTEN_GET = {
  [MODUS_SHORTS]: new Set(['/', '/video', '/stand', '/kette', '/lauf']),
  [MODUS_LONGFORM]: new Set(['/', '/bild']),
};
const ROUTEN_POST = {
  [MODUS_SHORTS]: new Set(['/urteil', '/beenden', '/planen', '/archivieren', '/hochladen']),
  [MODUS_LONGFORM]: new Set([]),
};

function gleichSicher(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// sitzung wird von baueSitzung() geliefert und ist die EINZIGE Quelle von
// Pfaden, Karten und Zustand. Der Handler unten baut nichts davon nach.
function baueDienst(sitzung) {
  // Erwarteter Host und Ursprung werden bei JEDER Anfrage aus sitzung.port
  // gebildet und nicht hier einmal eingefroren. Grund: der Port steht erst
  // fest, wenn der Dienst laeuft -- ein Test, der sich einen freien Port geben
  // laesst (listen auf 0), traegt ihn danach nach. Ein eingefrorener Wert
  // zwaenge dazu, den Port vorher zu erraten, und ein erratener Port ist
  // gelegentlich belegt: die Herkunftspruefung wuerde dann nicht am Fehler
  // scheitern, sondern am Zufall.
  const erwarteterHost = () => HOST + ':' + sitzung.port;
  const erwarteterUrsprung = () => 'http://' + erwarteterHost();
  // EL: ZWEI ANSICHTEN, ZWEI FUNKTIONEN, EINE ENTSCHEIDUNG. Der Modusvergleich
  // steht HIER und nicht in der Seite: das Seitenmodul kennt weder fs noch
  // http noch diesen Dienst, und es soll auch seine Konstanten nicht kennen.
  // baueSeite() ist damit woertlich die Funktion geblieben, die vor EL die
  // Shorts-Seite gebaut hat -- sie hat von der zweiten Ansicht nicht einmal
  // gehoert.
  const modus = pruefeModus(sitzung.modus === undefined ? MODUS_SHORTS : sitzung.modus);
  const seite = Buffer.from(
    modus === MODUS_LONGFORM ? baueLongformSeite(sitzung) : baueSeite(sitzung), 'utf8');
  const routenGet = ROUTEN_GET[modus];
  const routenPost = ROUTEN_POST[modus];

  function antwort(res, status, typ, leib, kopfzeilen) {
    const daten = Buffer.isBuffer(leib) ? leib : Buffer.from(leib, 'utf8');
    res.writeHead(status, Object.assign({
      'Content-Type': typ,
      'Content-Length': daten.length,
      // Der Browser soll bei jedem Neustart die frische Seite bekommen, nicht
      // die des vorigen Starts -- mit dem Token des vorigen Starts.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }, kopfzeilen || {}));
    if (res.req.method === 'HEAD') res.end(); else res.end(daten);
  }

  function fehler(res, status, code, meldung) {
    antwort(res, status, 'application/json; charset=utf-8',
      JSON.stringify({ fehler: code, meldung }, null, 2) + '\n');
  }

  const dienst = http.createServer((req, res) => {
    let pfad;
    let abfrage;
    try {
      const u = new URL(req.url, erwarteterUrsprung());
      pfad = u.pathname;
      abfrage = u.searchParams;
    } catch (e) {
      fehler(res, 400, 'anfrage_unlesbar', 'Die Anfragezeile ist nicht lesbar.');
      return;
    }

    // 1. HERKUNFT. Der Host-Kopf muss woertlich 127.0.0.1:<port> sein -- auch
    //    "localhost:<port>" wird abgewiesen: ein Name kann auf etwas anderes
    //    zeigen als eine Zahl, eine Zahl nicht. Ein Origin, wenn er da ist,
    //    muss derselbe sein; bei POST muss er da sein.
    const wirklicherHost = req.headers.host;
    if (wirklicherHost !== erwarteterHost()) {
      fehler(res, 403, 'fremder_host',
        'Der Host-Kopf ist ' + JSON.stringify(wirklicherHost || null) + ', erwartet ist ' +
        JSON.stringify(erwarteterHost()) + '. Dieser Dienst ist ausschliesslich unter dieser ' +
        'Adresse erreichbar.');
      return;
    }
    const ursprung = req.headers.origin;
    if (ursprung !== undefined && ursprung !== erwarteterUrsprung()) {
      fehler(res, 403, 'fremder_ursprung',
        'Der Origin-Kopf ist ' + JSON.stringify(ursprung) + ', erwartet ist ' +
        JSON.stringify(erwarteterUrsprung()) + '.');
      return;
    }
    if (req.method === 'POST' && ursprung === undefined) {
      fehler(res, 403, 'ursprung_fehlt',
        'Eine schreibende Anfrage ohne Origin-Kopf wird abgewiesen.');
      return;
    }

    // 2. SITZUNGSTOKEN. Bei jedem Start neu. Kopfzeile fuer die fetch-Aufrufe,
    //    Abfrageparameter fuer <video src> und fuer die Seite selbst -- ein
    //    <video>-Element kann keine Kopfzeile setzen.
    const token = req.headers['x-freigabe-token'] || abfrage.get('t') || '';
    if (!gleichSicher(token, sitzung.token)) {
      fehler(res, 403, 'token_fehlt_oder_falsch',
        'Ohne das Sitzungstoken dieses Starts geht hier nichts. Es steht in der Adresse, ' +
        'die der Dienst beim Start auf der Konsole ausgegeben hat, und gilt nur fuer diesen ' +
        'einen Start.');
      return;
    }

    // 3. ROUTE. Feste Liste. Es gibt keinen Zweig, der einen Anfragepfad in
    //    einen Dateisystempfad uebersetzt -- "/../../windows/win.ini" trifft
    //    keinen dieser Namen und bekommt 404.
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!routenGet.has(pfad)) { fehler(res, 404, 'unbekannte_route', 'Unbekannte Route.'); return; }
      if (pfad === '/') { antwort(res, 200, 'text/html; charset=utf-8', seite); return; }
      if (pfad === '/stand') {
        antwort(res, 200, 'application/json; charset=utf-8',
          JSON.stringify(sitzungsstand(sitzung), null, 2) + '\n');
        return;
      }
      if (pfad === '/kette') {
        antwort(res, 200, 'application/json; charset=utf-8',
          JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
        return;
      }
      if (pfad === '/lauf') { liefereLauf(res, abfrage); return; }
      // EL: /video steht jetzt AUSDRUECKLICH da und faengt nicht mehr alles auf,
      // was uebrig bleibt. Ein Auffangbecken am Ende einer Kette von Namen tut
      // still das Falsche, sobald die Namensliste wachsen kann -- und seit EL
      // haengt sie am Modus. Im Longform-Modus koennte hier ohnehin nichts
      // ankommen (routenGet kennt dort nur '/'), aber "kann nicht vorkommen" ist
      // keine Sicherung, sondern eine Erwartung.
      if (pfad === '/video') { liefereVideo(req, res, abfrage); return; }
      if (pfad === '/bild') { liefereBild(req, res, abfrage); return; }
      fehler(res, 404, 'unbekannte_route', 'Unbekannte Route.');
      return;
    }
    if (req.method === 'POST') {
      if (!routenPost.has(pfad)) { fehler(res, 404, 'unbekannte_route', 'Unbekannte Route.'); return; }
      if (pfad === '/beenden') { beende(res); return; }
      if (pfad === '/planen') { nimmPlanen(res); return; }
      if (pfad === '/archivieren') { nimmArchivieren(res); return; }
      if (pfad === '/hochladen') { nimmHochladen(res); return; }
      nimmUrteil(req, res);
      return;
    }
    fehler(res, 405, 'methode_nicht_erlaubt', 'Diese Methode gibt es hier nicht.');
  });

  // -------------------------------------------------------------------------
  // GET /video?i=<index>
  // -------------------------------------------------------------------------
  function liefereVideo(req, res, abfrage) {
    const roh = abfrage.get('i');
    // Der Index ist eine Zahl und nichts anderes. Geprueft wird die
    // ZEICHENKETTE, bevor sie zur Zahl wird: Number("0x2") ist 2 und
    // Number(" 3 ") ist 3 -- beides sind keine Indizes, die jemand geschrieben
    // hat. Ein Punkt-Punkt-Schraegstrich und ein absoluter Laufwerkspfad
    // bestehen diese Pruefung nicht einmal ansatzweise. Beides steht hier
    // absichtlich als Beschreibung und nicht als Beispiel: der Freigabe-Check
    // dieses oeffentlichen Repos verbietet absolute Laufwerkspfade im
    // Quelltext, auch in Kommentaren, und er hat damit recht.
    if (typeof roh !== 'string' || !/^[0-9]{1,6}$/.test(roh)) {
      fehler(res, 400, 'index_keine_zahl',
        'Der Parameter i ist ' + JSON.stringify(roh) + ' und keine Ziffernfolge. Eine ' +
        'Anfrage traegt einen Index in die beim Start gebaute Liste -- niemals einen Pfad.');
      return;
    }
    const index = Number(roh);
    const pfad = sitzung.videoPfad.get(index);
    if (pfad === undefined) {
      fehler(res, 404, 'index_unbekannt',
        'Zu Index ' + index + ' gibt es kein abspielbares Video. Abspielbar sind allein die ' +
        'vom Leser angenommenen Eintraege dieser Lieferung.');
      return;
    }
    // Torwaechter. Der Wert kam gerade aus der beim Start gebauten Liste und
    // muss dort registriert worden sein; ist er es nicht, wirft die Sperre,
    // und es wird nichts geoeffnet.
    let woertlich;
    try {
      woertlich = sitzung.sperre.oeffnen(pfad);
    } catch (e) {
      fehler(res, 500, 'pfadsperre', e.message);
      return;
    }

    let stat;
    try {
      stat = fs.statSync(woertlich);
    } catch (e) {
      fehler(res, 404, 'datei_weg',
        'Die Datei ist seit dem Start des Dienstes nicht mehr lesbar (' + e.code + ').');
      return;
    }
    // Der Leser hat die Groesse gegen die Lieferung geprueft. Weicht sie jetzt
    // ab, ist die Datei seither ersetzt worden -- dann wird nicht ausgeliefert,
    // sondern gemeldet. Die Pruefsumme wird hier NICHT neu gebildet: das waere
    // je Bereichsanfrage ein voller Durchlauf ueber die Datei.
    const karte = sitzung.karten.find((k) => k.index === index);
    if (karte && stat.size !== karte.groesse_bytes) {
      fehler(res, 409, 'datei_veraendert',
        'Die Datei ist jetzt ' + stat.size + ' Bytes gross, beim Pruefen waren es ' +
        karte.groesse_bytes + '. Sie wurde seither ersetzt. Lass den Leser neu laufen.');
      return;
    }

    let bereich;
    try {
      bereich = leseBereich(req.headers.range, stat.size);
    } catch (e) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size, 'Content-Length': 0 });
      res.end();
      return;
    }
    const von = bereich ? bereich.von : 0;
    const bis = bereich ? bereich.bis : stat.size - 1;
    const kopfzeilen = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': bis - von + 1,
      'Cache-Control': 'no-store',
    };
    if (bereich) kopfzeilen['Content-Range'] = 'bytes ' + von + '-' + bis + '/' + stat.size;
    res.writeHead(bereich ? 206 : 200, kopfzeilen);
    if (req.method === 'HEAD') { res.end(); return; }
    const strom = fs.createReadStream(woertlich,
      { start: von, end: bis, highWaterMark: STROM_STUECK_BYTES });
    strom.on('error', () => res.destroy());
    res.on('close', () => strom.destroy());
    strom.pipe(res);
  }

  // -------------------------------------------------------------------------
  // GET /bild   (EN, Vertrag 4 Schritt 7)
  // -------------------------------------------------------------------------
  //
  // SIE NIMMT NICHTS ENTGEGEN. Das ist die ganze Bauart, und sie ist der Grund,
  // warum diese Route nicht die Stelle ist, ueber die jemand die Platte
  // ausliest: es gibt keinen Wert, den ein Browser hierher schicken koennte und
  // der irgendetwas an der Auslieferung aendern wuerde.
  //
  // Die Schwesterroute /video nimmt einen INDEX in eine beim Start gebaute
  // Liste -- sie muss, denn drueben liegen viele Videos. Hier liegt genau ein
  // Bild; der naechstschwaechere Entwurf waere ein Index in eine Liste der
  // Laenge eins gewesen, und der haette einen Parameter eingefuehrt, den
  // niemand braucht. Ein Parameter, den niemand braucht, ist ein Parameter,
  // den eines Tages jemand benutzt.
  //
  // EIN MITGESCHICKTER PARAMETER IST EIN FEHLER UND WIRD ALS SOLCHER GEMELDET,
  // statt still uebergangen zu werden. Ein "?p=..\..\irgendwas", das eine 200
  // mit dem richtigen Bild bekommt, sieht fuer den, der es probiert, aus wie
  // ein Treffer -- und fuer den, der die Antwort spaeter liest, wie ein Weg,
  // den es gibt. "Wirkungslos" und "abgewiesen" sind zwei Zustaende, und die
  // duerfen hier so wenig gleich aussehen wie sonst irgendwo in diesem Weg.
  const NUR_TOKEN = 't';

  function liefereBild(req, res, abfrage) {
    for (const name of abfrage.keys()) {
      if (name === NUR_TOKEN) continue;
      fehler(res, 400, 'bildroute_nimmt_nichts_entgegen',
        'Diese Route hat den Parameter ' + JSON.stringify(name) + ' bekommen. Sie nimmt ' +
        'keinen entgegen -- weder einen Pfad noch einen Dateinamen noch einen Index. Sie ' +
        'liefert genau die eine Datei aus, die der Arbeiter beim Start dieser Sitzung ' +
        'benannt hat; ein mitgeschickter Wert kann daran nichts aendern und wird darum ' +
        'nicht angenommen, sondern gemeldet.');
      return;
    }

    const bild = sitzung.bild;
    if (!bild || !bild.da) {
      fehler(res, 409, 'kein_bild_bestimmt',
        'Diese Sitzung hat kein Bild zu zeigen. ' + ((bild && bild.grund) || '') +
        ' Es wird kein anderes gesucht und keines geraten.');
      return;
    }

    // DER TORWAECHTER. Der Wert kam gerade aus der Sitzung und muss beim
    // Bauen registriert worden sein; ist er es nicht, wirft die Sperre, und es
    // wird nichts geoeffnet. Wortgleich der Weg, den /video geht.
    let woertlich;
    try {
      woertlich = sitzung.sperre.oeffnen(bild.pfad);
    } catch (e) {
      fehler(res, 500, 'pfadsperre', e.message);
      return;
    }

    let stat;
    try {
      stat = fs.statSync(woertlich);
    } catch (e) {
      fehler(res, 404, 'datei_weg',
        'Das Bild ist seit dem Start des Dienstes nicht mehr lesbar (' + e.code + '). Der ' +
        'Weg zurueck ist ein neuer Start: der Arbeiter bestimmt das Bild dabei neu.');
      return;
    }
    if (!stat.isFile()) {
      fehler(res, 409, 'keine_datei',
        'Der benannte Pfad ist keine regulaere Datei mehr.');
      return;
    }
    // Der Arbeiter hat die Groesse gemessen und gegen den Beipackzettel
    // gehalten. Weicht sie jetzt ab, ist die Datei seither ersetzt worden --
    // dann wird nicht ausgeliefert, sondern gemeldet. Genau derselbe Handgriff
    // wie bei /video, aus genau demselben Grund: ein Mensch, der ein Bild
    // beurteilt, soll nicht ueber ein anderes urteilen als das, dessen sha256
    // ihm daneben angezeigt wird.
    if (bild.bytes !== null && stat.size !== bild.bytes) {
      fehler(res, 409, 'datei_veraendert',
        'Das Bild ist jetzt ' + stat.size + ' Bytes gross, beim Trockenlauf waren es ' +
        bild.bytes + '. Es wurde seither ersetzt; die sha256 auf der Seite gehoert dann ' +
        'nicht mehr zu diesen Bytes. Starte den Dienst neu.');
      return;
    }

    // KEIN ZWISCHENSPEICHERN, KEINE KOPIE, KEIN STANDBILD. Was hier passiert,
    // ist ein Lesestrom von der Platte in die Antwort und sonst nichts; diese
    // Sitzung schreibt weiterhin genau eine Datei, ihre Sperre.
    //
    // Kein Accept-Ranges und keine Bereichsanfrage: ein Bild wird nicht
    // gespult. /video braucht beides, ein <img> braucht keines, und was
    // niemand braucht, wird nicht "zur Sicherheit" mitgebaut.
    res.writeHead(200, {
      'Content-Type': bild.typ,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Ein Bild, das dieser Dienst ausliefert, wird angezeigt und nicht in
      // eine fremde Seite eingebettet. Beides kostet nichts und schliesst je
      // einen Weg, auf dem diese Antwort woanders landen koennte.
      'Content-Disposition': 'inline',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const strom = fs.createReadStream(woertlich, { highWaterMark: STROM_STUECK_BYTES });
    strom.on('error', () => res.destroy());
    res.on('close', () => strom.destroy());
    strom.pipe(res);
  }

  // -------------------------------------------------------------------------
  // POST /urteil
  // -------------------------------------------------------------------------
  function nimmUrteil(req, res) {
    const typ = String(req.headers['content-type'] || '');
    if (!typ.startsWith('application/json')) {
      fehler(res, 415, 'inhaltstyp',
        'Erwartet wird application/json, gemeldet wurde ' + JSON.stringify(typ) + '.');
      return;
    }
    const stuecke = [];
    let umfang = 0;
    let abgebrochen = false;
    req.on('data', (s) => {
      if (abgebrochen) return;
      umfang += s.length;
      if (umfang > MAX_ANFRAGE_BYTES) {
        abgebrochen = true;
        fehler(res, 413, 'anfrage_zu_gross',
          'Die Anfrage ist groesser als ' + MAX_ANFRAGE_BYTES + ' Bytes.');
        req.destroy();
        return;
      }
      stuecke.push(s);
    });
    req.on('end', () => {
      if (abgebrochen) return;
      let leib;
      try {
        leib = JSON.parse(Buffer.concat(stuecke).toString('utf8'));
      } catch (e) {
        fehler(res, 400, 'leib_kein_json', 'Der Anfrageleib ist kein JSON.');
        return;
      }
      if (leib === null || typeof leib !== 'object' || Array.isArray(leib)) {
        fehler(res, 400, 'leib_kein_objekt', 'Der Anfrageleib ist kein Objekt.');
        return;
      }
      if (!Number.isInteger(leib.index)) {
        fehler(res, 400, 'index_keine_ganzzahl',
          'index ist ' + JSON.stringify(leib.index) + ' und keine Ganzzahl.');
        return;
      }
      const karte = sitzung.karten.find((k) => k.index === leib.index);
      if (karte === undefined) {
        fehler(res, 404, 'index_unbekannt',
          'Zu Index ' + leib.index + ' gibt es in dieser Lieferung keinen Eintrag.');
        return;
      }
      if (!karte.freigebbar) {
        fehler(res, 409, 'eintrag_nicht_freigebbar',
          'Eintrag ' + leib.index + ' wurde vom Leser abgelehnt. Er wird angezeigt, damit ' +
          'niemand ihn uebersieht, aber er ist nicht freigebbar: es gibt keine geprueften ' +
          'Daten zu ihm, also auch nichts, wofuer eine Freigabe geradestehen koennte.');
        return;
      }
      if (leib.freigegeben !== true && leib.freigegeben !== false && leib.freigegeben !== null) {
        fehler(res, 400, 'urteil_ungueltig',
          'freigegeben ist ' + JSON.stringify(leib.freigegeben) +
          '; zulaessig sind true, false und null (Urteil zuruecknehmen).');
        return;
      }

      if (leib.freigegeben === null) {
        delete sitzung.stand[karte.sha256];
        speichere(res, null);
        return;
      }

      const t = pruefeTitel(leib.titel);
      if (!t.ok) { fehler(res, 400, t.code, t.meldung); return; }
      const n = pruefeNotiz(leib.notiz === undefined ? '' : leib.notiz);
      if (!n.ok) { fehler(res, 400, n.code, n.meldung); return; }

      const eintrag = {
        sha256: karte.sha256,
        kennung: karte.kennung,
        freigegeben: leib.freigegeben,
        titel: leib.titel,
        notiz: leib.notiz === undefined ? '' : leib.notiz,
        entschieden_am: new Date().toISOString(),
        // Woran hing dieses Urteil? Der Kopf nennt die Lesereingabe DIESER
        // Sitzung; ein Eintrag kann aber aus einer frueheren stammen. Damit
        // spaeter niemand raten muss, traegt jeder Eintrag seine eigene.
        lesereingabe_sha256: sitzung.eingabeSha256,
      };
      sitzung.stand[karte.sha256] = eintrag;
      speichere(res, eintrag);
    });
  }

  // Nach JEDEM Klick, nicht am Ende.
  function speichere(res, eintrag) {
    try {
      sitzung.kopf.geschrieben_am = new Date().toISOString();
      schreibeFreigaben(sitzung.freigabePfad, sitzung.kopf, sitzungsEintraege(sitzung));
    } catch (e) {
      fehler(res, 500, 'nicht_geschrieben',
        'Die Freigabedatei liess sich nicht schreiben (' + (e.code || e.message) + '). Das ' +
        'Urteil gilt als NICHT gespeichert.');
      return;
    }
    antwort(res, 200, 'application/json; charset=utf-8',
      JSON.stringify({ gespeichert: true, eintrag }, null, 2) + '\n');
  }

  // -------------------------------------------------------------------------
  // DIE KETTE (DR): POST /planen, POST /archivieren, POST /hochladen, GET /lauf
  // -------------------------------------------------------------------------

  // Die Kette laeuft NUR auf einer Sitzung, deren Projektwurzel die dieses
  // Moduls ist. Planer und Uploader rechnen sich ihre Wurzel selbst aus und
  // liessen sich gar nicht auf eine andere lenken; ein Dienst, der auf Wurzel A
  // zeigt, waehrend seine Kinder auf B schreiben, waere die gefaehrlichste Art
  // von Missverstaendnis -- die Seite zeigte dann etwas anderes an, als
  // geschieht. Die Tests bauen Sitzungen auf Wegwerfordner; die duerfen die
  // Kette nicht anfassen, und das sagt ihnen diese Zeile.
  function fremdeWurzel(res) {
    if (sitzung.projektwurzel === PROJEKTWURZEL) return false;
    fehler(res, 409, 'fremde_projektwurzel',
      'Diese Sitzung laeuft auf der Projektwurzel ' + JSON.stringify(sitzung.projektwurzel) +
      ', Planer und Uploader arbeiten aber immer auf ' + JSON.stringify(PROJEKTWURZEL) +
      '. Die Kette wird nicht angeboten: sie wuerde auf einem anderen Ordner arbeiten als ' +
      'dem, den diese Seite anzeigt.');
    return true;
  }

  // Sucht in der stderr-Ausgabe des Trockenlaufs die eine Zeile, die
  // --vorschau-json dort hinterlassen hat. Gesucht wird nach dem
  // artifact_type und nicht nach der Position: stderr kann auch Warnungen von
  // node tragen, und die stehen mal davor und mal dahinter.
  function findeVorschauJson(text) {
    for (const zeile of String(text).split(/\r?\n/)) {
      const t = zeile.trim();
      if (!t.startsWith('{')) continue;
      let d;
      try { d = JSON.parse(t); } catch (e) { continue; }
      if (d && d.artifact_type === 'adw_shorts_vorschau') return d;
    }
    return null;
  }

  // SCHRITT 1. Der Dienst plant ein und laesst danach den Trockenlauf laufen.
  //
  // DER PLANER WIRD UEBERSPRUNGEN, WENN ES SCHON EINEN PLAN GIBT -- und zwar
  // hier, an einem existsSync, und nicht dadurch, dass man seine Absage
  // hinterher am Text erkennt. Seine Weigerung bleibt unangetastet: es gibt
  // weiterhin kein --ersetzen, und ueberschrieben wird nichts. Die Seite sagt
  // stattdessen, dass ein Plan da ist, und bietet den benannten Knopf zum
  // Archivieren an. Der Trockenlauf laeuft trotzdem: eine Vorschau auf den
  // BESTEHENDEN Plan ist genau das, was ein Mensch jetzt sehen will.
  function nimmPlanen(res) {
    if (fremdeWurzel(res)) return;
    const k = sitzung.kette;
    if (k.lauf && k.lauf.laeuft) {
      fehler(res, 409, 'lauf_laeuft',
        'Es laeuft gerade ein Upload. Solange er laeuft, wird nicht neu geplant.');
      return;
    }
    // Ein neuer Schritt 1 setzt einen abgeschlossenen Lauf und die alte
    // Vorschau zurueck. Eine Vorschau, die neben einem fertigen Lauf steht,
    // beschreibt eine Lage, die es nicht mehr gibt.
    k.vorschau = null;
    k.meldung = null;
    k.lauf = null;

    const pp = planPfadDerKette(sitzung.projektwurzel, sitzung.aufnahme);
    k.planWarSchonDa = fs.existsSync(pp);

    let planer = null;
    if (!k.planWarSchonDa) {
      planer = ruftPlaner(sitzung.aufnahme);
      if (planer.fehler) {
        k.meldung = { art: 'fehler', ueberschrift: 'Der Planer liess sich nicht starten.',
          text: planer.fehler, befehl: planer.befehl };
        antwort(res, 200, 'application/json; charset=utf-8',
          JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
        return;
      }
      if (planer.code === EXIT.GESPERRT) {
        k.meldung = { art: 'gesperrt',
          ueberschrift: 'Diese Aufnahme ist zum Planen GESPERRT.',
          text: planer.err || planer.aus, befehl: planer.befehl };
        antwort(res, 200, 'application/json; charset=utf-8',
          JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
        return;
      }
      if (planer.code !== EXIT.OK) {
        // Der Planer sagt "alles schon hochgeladen" mit Rueckgabewert 1 und
        // einem JSON auf stdout. Das ist kein Fehler, sondern eine Lage.
        let d = null;
        try { d = JSON.parse(planer.aus); } catch (e) { d = null; }
        if (d && d.ergebnis === 'alles_hochgeladen') {
          k.meldung = { art: 'alles_hochgeladen',
            ueberschrift: 'Alle freigegebenen Shorts dieser Aufnahme sind schon hochgeladen.',
            text: 'Freigegeben: ' + d.freigegeben + ', davon schon hochgeladen: ' +
              (d.uebersprungen_hochgeladen || []).length + '. Es wurde KEINE Planungsdatei ' +
              'angelegt -- auch keine leere. Es gibt hier nichts zu tun.',
            befehl: planer.befehl };
        } else {
          k.meldung = { art: 'fehler', ueberschrift: 'Der Planer hat keinen Plan erstellt.',
            text: (planer.err || planer.aus || '').trim(), befehl: planer.befehl };
        }
        antwort(res, 200, 'application/json; charset=utf-8',
          JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
        return;
      }
    }

    // Der Trockenlauf. Er laeuft in beiden Faellen -- frisch geplant oder
    // Plan war schon da.
    const trocken = ruftUploaderTrocken(sitzung.aufnahme);
    if (trocken.fehler) {
      k.meldung = { art: 'fehler', ueberschrift: 'Der Trockenlauf liess sich nicht starten.',
        text: trocken.fehler, befehl: trocken.befehl };
      antwort(res, 200, 'application/json; charset=utf-8',
        JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
      return;
    }
    if (trocken.code === EXIT.GESPERRT) {
      k.meldung = { art: 'gesperrt',
        ueberschrift: 'Diese Aufnahme ist zum Hochladen GESPERRT.',
        text: trocken.err || trocken.aus, befehl: trocken.befehl };
      antwort(res, 200, 'application/json; charset=utf-8',
        JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
      return;
    }
    const zahlen = findeVorschauJson(trocken.err);
    if (trocken.code !== EXIT.OK || zahlen === null) {
      k.meldung = { art: 'fehler',
        ueberschrift: 'Der Trockenlauf hat keine Vorschau ergeben (Rueckgabewert ' +
          trocken.code + ').',
        text: ((trocken.aus || '') + '\n' + (trocken.err || '')).trim(), befehl: trocken.befehl };
      antwort(res, 200, 'application/json; charset=utf-8',
        JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
      return;
    }
    if (zahlen.anzahl === 0) {
      k.meldung = { art: 'alles_hochgeladen',
        ueberschrift: 'Es gibt nichts hochzuladen.',
        text: 'Der Plan hat ' + zahlen.termine_im_plan + ' Termine, davon stehen ' +
          zahlen.schon_hochgeladen + ' schon im Gedaechtnis. Fuer diesen Lauf bleiben 0 ' +
          'Shorts. Es wird nichts angeboten.',
        befehl: trocken.befehl };
      // Die Vorschau wird trotzdem aufgehoben und gezeigt -- sie sagt, WAS
      // schon hochgeladen ist. Schritt 3 bleibt gesperrt (anzahl === 0).
    }

    const kanal = leseKanal(sitzung.projektwurzel);
    k.vorschau = {
      text: trocken.aus,
      plan_sha256: zahlen.plan_sha256,
      plan_pfad: zahlen.plan_pfad,
      anzahl: zahlen.anzahl,
      kennungen: zahlen.kennungen || [],
      termine_im_plan: zahlen.termine_im_plan,
      schon_hochgeladen: zahlen.schon_hochgeladen,
      erstellt_am: new Date().toISOString(),
      befehl: trocken.befehl,
      kanal_bekannt: kanal.ok,
      kanal_id: kanal.ok ? kanal.id : null,
      kanal_name: kanal.ok ? kanal.name : null,
      kanal_erzeugt_am: kanal.ok ? kanal.erzeugt_am : null,
      kanal_grund: kanal.ok ? null : kanal.grund,
      // DW: DER ANSCHLUSS -- WORAN DIESER LAUF ANSCHLIESST.
      //
      // Er kommt aus derselben stderr-Zeile wie alle anderen Zahlen und damit
      // aus dem Uploader, der ihn beim Trockenlauf frisch aus data/uploads
      // rechnet. NICHT aus der stdout des Planers, wie der DS-Bericht es
      // vorschlug, und aus zwei Gruenden: erstens ist das Feld anschluss des
      // Plans der Stand vom Augenblick des Planens und altert (DV, gemessen);
      // zweitens laeuft der Planer hier gar nicht, wenn schon ein Plan dalag --
      // dann gaebe es keine Planerausgabe, und die Seite bliebe in genau der
      // Lage stumm, in der ein Mensch die Ueberlappung sehen muesste.
      //
      // Im TEXT der Vorschau steht dasselbe schon; dieses Feld ist fuer alles,
      // was den Text nicht liest.
      anschluss: zahlen.anschluss || null,
    };
    if (k.meldung === null) {
      k.meldung = { art: 'bereit',
        ueberschrift: k.planWarSchonDa
          ? 'Es gibt schon einen Plan fuer diese Aufnahme -- er wurde NICHT ueberschrieben.'
          : 'Plan geschrieben.',
        text: k.planWarSchonDa
          ? 'Die Vorschau unten steht ueber dem BESTEHENDEN Plan (' + pp + '). Wer neu planen ' +
            'will, archiviert ihn zuerst -- der Knopf dafuer sagt, was er tut.'
          : 'Der Planer hat ' + zahlen.termine_im_plan + ' Termine nach ' + pp + ' geschrieben.',
        befehl: planer ? planer.befehl : null };
    }
    antwort(res, 200, 'application/json; charset=utf-8',
      JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
  }

  // "Alten Plan archivieren und neu planen" -- die Handlung eines Menschen,
  // kein stiller Zwischenschritt. Sie verschiebt und loescht nicht.
  function nimmArchivieren(res) {
    if (fremdeWurzel(res)) return;
    const k = sitzung.kette;
    if (k.lauf && k.lauf.laeuft) {
      fehler(res, 409, 'lauf_laeuft',
        'Es laeuft gerade ein Upload. Der Plan, den er abarbeitet, wird nicht weggeraeumt.');
      return;
    }
    const pp = planPfadDerKette(sitzung.projektwurzel, sitzung.aufnahme);
    if (!fs.existsSync(pp)) {
      fehler(res, 409, 'kein_plan',
        'Es gibt keinen Plan zu archivieren: ' + pp);
      return;
    }
    let bewegt;
    try {
      bewegt = archiviereAltenPlan(sitzung.projektwurzel, sitzung.aufnahme, Date.now());
    } catch (e) {
      fehler(res, 500, 'nicht_archiviert',
        'Der Plan liess sich nicht archivieren (' + (e.code || e.message) + '). Er liegt ' +
        'unveraendert an seiner Stelle: ' + pp);
      return;
    }
    k.archiviert.push({ von: bewegt.quelle, nach: bewegt.ziel, am: new Date().toISOString() });
    // Die Vorschau gehoerte zum alten Plan und gilt jetzt nicht mehr.
    k.vorschau = null;
    k.planWarSchonDa = false;
    k.meldung = { art: 'archiviert',
      ueberschrift: 'Der alte Plan ist archiviert -- verschoben, nicht geloescht.',
      text: 'Von:  ' + bewegt.quelle + '\nNach: ' + bewegt.ziel +
        '\n\nDie Vorschau von eben gehoerte zu diesem Plan und ist damit hinfaellig. ' +
        'Jetzt noch einmal auf "Einplanen und Vorschau".',
      befehl: null };
    antwort(res, 200, 'application/json; charset=utf-8',
      JSON.stringify(kettenstand(sitzung), null, 2) + '\n');
  }

  // SCHRITT 3. Hier faellt die getippte Bestaetigung weg -- und hier wird
  // ersetzt, wofuer sie da war.
  function nimmHochladen(res) {
    if (fremdeWurzel(res)) return;
    const k = sitzung.kette;

    // N4: SERVERSEITIG. Der Browser sperrt den Knopf zusaetzlich, aber das ist
    // Bequemlichkeit. Diese Zeile ist die Zusage.
    const bereit = schritt3Bereit(sitzung);
    if (!bereit.bereit) {
      fehler(res, 409, 'schritt1_fehlt', bereit.grund +
        ' Es wurde nichts geschrieben, nichts gestartet und keine Ermaechtigung ausgestellt.');
      return;
    }

    const v = k.vorschau;
    const zufall = UPLOADER_MODUL.neuerZufall();
    const pfad = UPLOADER_MODUL.ermaechtigungPfad(sitzung.projektwurzel, zufall);
    const inhalt = UPLOADER_MODUL.neueErmaechtigung({
      aufnahme: sitzung.aufnahme,
      planSha256: v.plan_sha256,
      anzahl: v.anzahl,
      kanalId: v.kanal_id,
      kanalName: v.kanal_name,
      zufall,
      jetzt: Date.now(),
    });
    try {
      schreibeErmaechtigung(pfad, inhalt);
    } catch (e) {
      fehler(res, 500, 'ermaechtigung_nicht_geschrieben',
        'Die Ermaechtigung liess sich nicht schreiben (' + (e.code || e.message) + '): ' + pfad +
        '. Es wurde nichts gestartet.');
      return;
    }

    k.lauf = {
      laeuft: true,
      gestartet_am: new Date().toISOString(),
      anzahl: v.anzahl,
      kanal_name: v.kanal_name,
      ermaechtigung: pfad,
      zeilen: [],
      ende: null,
      befehl: null,
    };
    const merke = (art, zeile) => {
      k.lauf.zeilen.push({ art, zeile });
    };
    merke('dienst', 'Ermaechtigung geschrieben: ' + pfad);
    merke('dienst', 'Sie gilt ' + (UPLOADER_MODUL.ERMAECHTIGUNG_GUELTIG_MS / 1000) +
      ' Sekunden, fuer ' + v.anzahl + ' Short(s), fuer den Plan mit sha256 ' + v.plan_sha256 +
      ' und fuer den Kanal "' + v.kanal_name + '" -- und genau einmal.');

    const gestartet = starteUploaderLauf(sitzung, pfad,
      (art, zeile) => merke(art, zeile),
      (code, signal) => {
        k.lauf.laeuft = false;
        k.lauf.ende = {
          code, signal,
          beendet_am: new Date().toISOString(),
          // Ob die Ermaechtigung wirklich weg ist, wird NACHGESEHEN und nicht
          // angenommen. Steht sie noch da, hat der Uploader sie nicht
          // verbraucht -- dann ist er gar nicht bis dahin gekommen, und das
          // gehoert auf die Seite.
          ermaechtigung_noch_da: fs.existsSync(pfad),
        };
        merke('dienst', 'Der Uploader ist beendet (Rueckgabewert ' + code +
          (signal ? ', Signal ' + signal : '') + ').');
        merke('dienst', k.lauf.ende.ermaechtigung_noch_da
          ? 'ACHTUNG: die Ermaechtigungsdatei liegt noch da: ' + pfad + '. Der Uploader hat ' +
            'sie nicht verbraucht. Sie laeuft in hoechstens zwei Minuten ab; wer sicher ' +
            'gehen will, loescht sie von Hand.'
          : 'Die Ermaechtigung ist verbraucht und geloescht. Ein zweiter Lauf braucht einen ' +
            'zweiten Klick -- und damit wieder eine Vorschau, die ein Mensch gesehen hat.');
      });
    k.lauf.befehl = gestartet.befehl;

    antwort(res, 200, 'application/json; charset=utf-8',
      JSON.stringify({ gestartet: true, anzahl: v.anzahl, kanal: v.kanal_name,
        befehl: gestartet.befehl }, null, 2) + '\n');
  }

  // Der Fortschritt. Die Seite fragt ab Zeile <ab> nach und bekommt, was seit
  // dem letzten Mal dazugekommen ist.
  function liefereLauf(res, abfrage) {
    const k = sitzung.kette;
    const roh = abfrage.get('ab');
    const ab = (typeof roh === 'string' && /^[0-9]{1,7}$/.test(roh)) ? Number(roh) : 0;
    if (k.lauf === null) {
      antwort(res, 200, 'application/json; charset=utf-8',
        JSON.stringify({ lauf: null, ab, zeilen: [], laeuft: false, ende: null }, null, 2) + '\n');
      return;
    }
    antwort(res, 200, 'application/json; charset=utf-8',
      JSON.stringify({
        lauf: { gestartet_am: k.lauf.gestartet_am, anzahl: k.lauf.anzahl,
          kanal: k.lauf.kanal_name, befehl: k.lauf.befehl },
        ab, gesamt: k.lauf.zeilen.length,
        zeilen: k.lauf.zeilen.slice(ab),
        laeuft: k.lauf.laeuft, ende: k.lauf.ende,
      }, null, 2) + '\n');
  }

  // -------------------------------------------------------------------------
  // POST /beenden -- erst hinaus, dann aus
  // -------------------------------------------------------------------------
  //
  // Nur POST. Ein Vorauslesen der Verknuepfung, ein Lesezeichen oder ein
  // neugieriger Browser duerfen den Dienst nicht abschalten; GET /beenden
  // trifft keine GET-Route und bekommt 404.
  //
  // Am Schreibweg aendert das nichts: die Urteile stehen bereits auf der
  // Platte, geschrieben nach jedem einzelnen Klick. Ein Abschalten danach kann
  // nichts verlieren.
  function beende(res) {
    antwort(res, 200, 'application/json; charset=utf-8',
      JSON.stringify({ status: 'beendet' }, null, 2) + '\n', { Connection: 'close' });
    res.on('finish', () => {
      setImmediate(() => dienst.emit('beenden-erwuenscht'));
    });
  }

  return dienst;
}

// ---------------------------------------------------------------------------
// Zustand einer Sitzung
// ---------------------------------------------------------------------------

// Die Eintraege der Freigabedatei: erst die dieser Lieferung in ihrer
// Reihenfolge, dann die uebernommenen, die zu keiner Karte gehoeren.
//
// UEBERNOMMENE EINTRAEGE WERDEN NICHT WEGGEWORFEN. Ein Urteil ist das einzige
// in dieser Kette, das sich nicht neu erzeugen laesst. Gehoert eines zu einer
// Pruefsumme, die in der jetzigen Lieferung nicht mehr vorkommt, bleibt es
// unveraendert in der Datei stehen -- es wird nur nicht angezeigt, weil es
// nichts zu zeigen gibt.
function sitzungsEintraege(sitzung) {
  const raus = [];
  const genommen = new Set();
  for (const k of sitzung.karten) {
    if (!k.freigebbar) continue;
    const e = sitzung.stand[k.sha256];
    if (e) { raus.push(e); genommen.add(k.sha256); }
  }
  for (const [sha, e] of Object.entries(sitzung.stand)) {
    if (!genommen.has(sha)) raus.push(e);
  }
  return raus;
}

function sitzungsstand(sitzung) {
  return {
    aufnahme: sitzung.aufnahme,
    freigabedatei: sitzung.freigabePfad,
    lesereingabe_sha256: sitzung.eingabeSha256,
    karten: sitzung.karten.length,
    freigebbar: sitzung.karten.filter((k) => k.freigebbar).length,
    freigaben: sitzungsEintraege(sitzung),
  };
}

// Baut die Sitzung aus einem FERTIGEN Leserbericht. Diese Funktion liest keine
// Uebergabedatei und ruft den Leser nicht auf -- das tut ruftLeser(), und main()
// setzt beides zusammen. Getrennt, damit die Tests den Dienst gegen einen
// beliebigen Bericht fahren koennen, ohne dafuer einen zweiten Leser zu haben.
function baueSitzung({ bericht, eingabeText, aufnahme, projektwurzel, port }) {
  const { karten, sperre, videoPfad } = baueKarten(bericht);
  const pfad = freigabePfad(projektwurzel, aufnahme);
  const vorhanden = leseFreigaben(pfad);
  if (vorhanden.abbruch) {
    const e = new Error(vorhanden.hinweis);
    e.freigabePfad = pfad;
    throw e;
  }
  const jetzt = new Date().toISOString();
  const eingabeSha256 = crypto.createHash('sha256').update(eingabeText, 'utf8').digest('hex');
  return {
    // EL: DER MODUS STEHT IN BEIDEN SITZUNGEN, auch in dieser, die es vor EL
    // schon gab. Derselbe Grund wie beim Feld `modus` der Sperrdatei
    // (Vertrag 2.13): traegt ihn nur die zweite Sorte, dann bedeutet "Feld
    // fehlt" heimlich "shorts", und diese Regel steht dann in keiner Datei,
    // sondern nur im Kopf dessen, der sie geschrieben hat.
    modus: MODUS_SHORTS,
    aufnahme,
    port,
    token: crypto.randomBytes(32).toString('hex'),
    eingabeSha256,
    // DR: Die Kette braucht sie -- fuer den Plan, das Archiv und die
    // Ermaechtigung. Sie steht hier und wird nicht in jedem Handler neu
    // ausgerechnet; und die Kette prueft sie gegen PROJEKTWURZEL, bevor sie
    // einen Kindprozess startet.
    projektwurzel,
    freigabePfad: pfad,
    karten,
    sperre,
    videoPfad,
    kette: neueKette(),
    stand: vorhanden.stand,
    uebernommen: Object.keys(vorhanden.stand).length,
    kopf: {
      aufnahme,
      // Angelegt wurde die Datei einmal; das bleibt stehen, auch wenn eine
      // spaetere Sitzung sie neu schreibt.
      erzeugt_am: (vorhanden.kopf && vorhanden.kopf.erzeugt_am) || jetzt,
      geschrieben_am: jetzt,
      lesereingabe_sha256: eingabeSha256,
    },
  };
}

// ---------------------------------------------------------------------------
// Belegter Port
// ---------------------------------------------------------------------------

// "Benannt, nicht nur gemeldet": Adresse, Port, und wer ihn haelt, soweit
// dieser Rechner das hergibt.
//
// BEKANNTE GRENZE, ausdruecklich nicht wegdefiniert: der NAME des Prozesses ist
// hier nicht zu bekommen. tasklist geht ueber WMI, und WMI antwortet auf diesem
// Rechner mit "Ungueltige Klasse". Was bleibt, ist die PID aus netstat -- damit
// laesst sich der Prozess im Task-Manager finden.
function haelterDesPorts(port) {
  let roh;
  try {
    const lauf = spawnSync('netstat', ['-ano', '-p', 'TCP'],
      { encoding: 'utf8', timeout: 8000 });
    if (lauf.error || lauf.status !== 0) return null;
    roh = lauf.stdout;
  } catch (e) {
    return null;
  }
  const pids = new Set();
  for (const zeile of roh.split(/\r?\n/)) {
    const felder = zeile.trim().split(/\s+/);
    if (felder.length < 4) continue;
    const lokal = felder[1] || '';
    if (!lokal.endsWith(':' + port)) continue;
    const pid = felder[felder.length - 1];
    if (/^\d+$/.test(pid)) pids.add(pid);
  }
  // DJa: Eine LEERE Liste und `null` sind zwei verschiedene Antworten.
  //   []   -- netstat lief und hat auf diesem Port niemanden gefunden.
  //   null -- netstat lief nicht; ueber den Port ist nichts bekannt.
  // Bis DJa gab diese Funktion in beiden Faellen `null` zurueck. Das fiel bei
  // N5 auf: eine Sperrdatei mit lebender Prozessnummer und einem Port, auf dem
  // gar niemand lauscht, ist der deutlichste Hinweis auf eine neu vergebene
  // Nummer -- und genau diesen Hinweis verschluckte die Zusammenfassung.
  return [...pids];
}

function meldeBelegtenPort(port) {
  const z = [];
  z.push('');
  z.push('ABBRUCH: Der Port ' + port + ' auf ' + HOST + ' ist belegt.');
  const pids = haelterDesPorts(port);
  if (pids && pids.length) {
    z.push('Gehalten wird er von Prozess-Nummer ' + pids.join(', ') +
      ' (aus netstat -ano). Den Namen dazu kann dieser Rechner nicht liefern: ' +
      'tasklist geht ueber WMI, und WMI antwortet hier mit "Ungueltige Klasse". ' +
      'Im Task-Manager, Reiter Details, laesst sich die Nummer nachschlagen.');
  } else if (pids) {
    z.push('netstat lief, hat auf diesem Port aber keinen lauschenden Prozess gefunden. ' +
      'Moeglich ist ein Dienst, der den Port gerade erst freigibt (Zustand WARTEND).');
  } else {
    z.push('Wer ihn haelt, war nicht zu ermitteln -- netstat liess sich nicht ausfuehren.');
  }
  z.push('Es wurde NICHTS geschrieben und keine Seite ausgeliefert.');
  z.push('Anderer Port: --port=' + (port + 1) + '   oder   SHORTS_FREIGABE_PORT in der .env.');
  z.push('');
  return z.join('\n');
}

// ---------------------------------------------------------------------------
// Die Seite oeffnet sich von selbst (DJb, Punkt 3)
// ---------------------------------------------------------------------------

// Vorher musste der Mensch die Adresse aus der Konsole kopieren -- mitsamt dem
// 64 Zeichen langen Sitzungstoken. Der Thumbnail-Compositor im selben Repo
// macht es andersherum, und richtig herum: er oeffnet von selbst, und der
// Schalter ist der Ausnahmefall.
//
// DAS OEFFNEN IST KEIN STARTSCHRITT. Es steht hinter listen(), es wird nicht
// abgewartet, und wenn es scheitert, laeuft der Dienst weiter. Ein Dienst, der
// wegen eines nicht auffindbaren Browsers nicht startet, waere schlechter als
// einer, der gar keinen oeffnet: die Adresse steht ja daneben.
//
// spawn statt spawnSync, detached und unref: das Fenster gehoert dem Menschen,
// nicht diesem Prozess. Der Dienst soll weder darauf warten noch es beim
// Beenden mitreissen.
function oeffneImBrowser(url) {
  // Windows: cmd /c start. Der erste, LEERE Anfuehrungsstrich ist der
  // Fenstertitel -- ohne ihn nimmt start die URL als Titel und oeffnet nichts.
  const befehl = process.platform === 'win32'
    ? { datei: 'cmd', argumente: ['/c', 'start', '', url] }
    : (process.platform === 'darwin'
      ? { datei: 'open', argumente: [url] }
      : { datei: 'xdg-open', argumente: [url] });
  try {
    const kind = spawn(befehl.datei, befehl.argumente, {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    // Ein Fehler kommt bei spawn erst spaeter als Ereignis. Er darf den Dienst
    // nicht mitnehmen -- ohne diesen Zuhoerer waere ein fehlendes cmd ein
    // unbehandeltes Ereignis und damit das Ende des Prozesses.
    kind.on('error', (e) => {
      console.error('Der Browser liess sich nicht oeffnen (' + (e.code || e.message) + '). ' +
        'Der Dienst laeuft weiter -- nimm die Adresse oben von Hand.');
    });
    kind.unref();
    return { gestartet: true, befehl: befehl.datei + ' ' + befehl.argumente.join(' ') };
  } catch (e) {
    return { gestartet: false, grund: e.code || e.message };
  }
}

// ---------------------------------------------------------------------------
// DIE VERBINDUNGSPRUEFUNG (EI, Vertrag 3.1)
// ---------------------------------------------------------------------------
//
// pruefeArgumenteStrikt prueft ZUGEHOERIGKEIT zu einer flachen Liste und sonst
// nichts (ED F2): sie weiss, dass --wurzel= erlaubt ist, aber nicht, in welchem
// Modus. Diese Pruefung hier ist die Verbindung zwischen Modus und Argument.
// Sie liegt NACH der Listenpruefung und VOR der Sperre, und sie endet mit
// demselben Wert wie die Listenpruefung (2), weil bis dorthin nichts angefasst
// wurde: kein Leser, keine Sperre, kein Port.
//
// WARUM --wurzel= IM LONGFORM-MODUS ABGEWIESEN WIRD und nicht umgedeutet oder
// verschluckt: --wurzel= bedeutet heute "die Wurzel, unter der die
// Aufnahmeordner mit der Uebergabedatei liegen"; der Dienst reicht es
// unveraendert an den Leser durch, und nur der Leser macht einen Pfad daraus.
// Im Longform-Modus laeuft der Leser nicht, es gibt keine Uebergabedatei, und
// die Videodatei kommt aus einer anderen Einstellung. Das Argument haette dort
// also entweder keine Bedeutung -- dann wird es stillschweigend verschluckt,
// und wer es mitgibt, glaubt, es wirke -- oder eine zweite, und dann bedeutet
// ein Argument je Modus etwas anderes. Das ist die Form, die dieses Projekt
// schon mehrfach gebissen hat. Abweisen ist das einzige, was beides vermeidet.
//
// Rueckgabe: null, wenn nichts dagegen spricht, sonst der fertige Meldungstext.
function pruefeModusVerbindung(modus, argv) {
  pruefeModus(modus);
  const gegeben = (praefix) => argv.slice(2).some((a) => a.startsWith(praefix));
  if (modus === MODUS_LONGFORM && gegeben('--wurzel=')) {
    return [
      '',
      'Abbruch: --wurzel= gibt es im Longform-Modus nicht.',
      '',
      '  --wurzel= benennt die Wurzel, unter der die Aufnahmeordner mit der',
      '  Uebergabedatei der Shorts-Linie liegen. Im Longform-Modus laeuft der Leser',
      '  nicht, es gibt keine Uebergabedatei, und die Videodatei kommt aus einer',
      '  anderen Einstellung.',
      '',
      '  Die Longform-Wurzel steht in der .env unter LONGFORM_RENDER_WURZEL, und',
      '  nur dort. Ein Argument dafuer gibt es nicht und soll es nicht geben.',
      '',
      'Angenommen und ignoriert wird es nicht: wer es mitgibt, soll nicht glauben,',
      'es wirke. Es wurde nichts gelesen, nichts geschrieben und kein Port geoeffnet.',
      '',
    ].join(String.fromCharCode(10));
  }
  return null;
}

// ---------------------------------------------------------------------------
// DER LONGFORM-MODUS (EL, Vertrag 2.13 und 4)
// ---------------------------------------------------------------------------
//
// WAS AN DIE STELLE VON meldeLongformOhneSeite() GETRETEN IST. Bis EL endete
// dieser Modus nach der Sperre mit 1 und dem Satz, dass hier nichts gebaut
// ist. Diese Meldung ist ERSATZLOS WEG und nicht danebengestellt worden: sie
// sagte "der Longform-Modus hat noch keine Seite", und das ist ab hier
// unwahr. Eine Meldung, die stehen bleibt, nachdem ihr Satz nicht mehr
// stimmt, ist genau die Sorte, die der naechste Leser fuer wahr nimmt.
//
// WAS DIESER MODUS TUT, VOLLSTAENDIG: Sperre nehmen (2.13), den Trockenlauf
// des Arbeiters als Kindprozess starten (4, Schritt 2 bis 6), seine Ausgabe
// woertlich ausliefern (4, Schritt 7, soweit gebaut), und dort aufhoeren.
//
// WAS ER NICHT TUT, UND ZWAR MIT ABSICHT:
//
//   - Keine Ermaechtigung. Weder schreiben noch entgegennehmen, kein Knopf,
//     der eine ausloest, kein Feld, das eine vorbereitet. Grund: eine
//     Einmal-Ermaechtigung ohne Empfaenger liegt herum, bis jemand sie
//     einloest. Sie kommt mit dem Arbeiter, der sie einloest (Vertrag 4,
//     Schritte 8 bis 17), und keinen Schritt frueher.
//   - Kein Netzaufruf, kein Upload, kein Start des schreibenden Arbeiters.
//     Der Trockenlauf laeuft OHNE --execute und OHNE --bestaetigt-durch=; der
//     Arbeiter selbst weist beide Argumente heute mit einer eigenen Meldung
//     ab (EK), und dieser Dienst gibt sie ihm gar nicht erst.
//   - Keine zweite Darstellung dessen, was der Arbeiter sagt. Was er ueber
//     Videodatei, Titel, Beschreibung, Hashtags, Tags und Thumbnail schreibt,
//     geht Zeichen fuer Zeichen durch diesen Dienst hindurch auf die Seite.
//     Ein zweiter Formatierungsweg waere eine zweite Fassung derselben Regel,
//     und die Regel hinter dem Thumbnail allein hat 37 Zustaende (2.7).
//
// WARUM KINDPROZESS UND NICHT require(): der Arbeiter loest seine beiden
// Ordner selbst aus der .env auf (LONGFORM_RENDER_WURZEL, THUMBNAIL_EXPORT_DIR),
// prueft seine Argumente selbst und setzt seinen Rueckgabewert selbst. Ihn
// hier im selben Prozess aufzurufen hiesse, all das ein zweites Mal zu bauen
// -- und die zweite Fassung waere die, die der Mensch vor Augen hat. Es ist
// dieselbe Bauart wie beim Leser und beim Trockenlauf des Uploaders: hier
// steht ein spawnSync auf seine Datei und kein Nachbau seiner Regeln.
const LONGFORM_ARBEITER = path.join(__dirname, 'longform-arbeiter.js');

// Der Trockenlauf -- WOERTLICH derselbe, der im Terminal steht. Kein
// --execute, kein --bestaetigt-durch=, kein --json und keine zweite
// Ausgabeart: der Arbeiter hat nur eine, und das ist die, die ein Mensch
// liest.
//
// BEIDE STROEME WERDEN GETRENNT AUFGEHOBEN. Vertrag 6: die Vorschau geht auf
// stdout, wenn der Lauf durchkommt, und auf stderr, wenn er mit einem Befund
// endet. Sie hier zusammenzuruehren hiesse, eine Reihenfolge zu erfinden, die
// es zwischen zwei Stroemen nicht gibt.
//
// EN: --befund-json KOMMT DAZU, UND ZWAR NUR HIER. Ein Mensch, der den
// Arbeiter im Terminal aufruft, tippt es nicht und sieht die Zeile nie; dieser
// Dienst tippt es, weil er den Bildpfad braucht. Ohne das Argument ist die
// Ausgabe des Arbeiters woertlich, was sie vorher war -- auf beiden Stroemen.
function ruftLongformTrocken(aufnahme) {
  const argumente = [LONGFORM_ARBEITER, '--aufnahme=' + aufnahme, '--befund-json'];
  const lauf = spawnSync(process.execPath, argumente, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 170000,
  });
  // Die eine Zeile wird HIER aus dem Strom genommen, sofort beim Einsammeln,
  // und nicht erst irgendwo weiter unten. Was ab hier `err` heisst, ist das,
  // was ein Mensch zu sehen bekommt -- es gibt keine Stelle dazwischen, an der
  // jemand versehentlich den ungetrennten Strom weiterreicht.
  const getrennt = trenneBefundzeile(lauf.stderr || '');
  return {
    befehl: 'node ' + path.relative(PROJEKTWURZEL, LONGFORM_ARBEITER) +
      ' --aufnahme="' + aufnahme + '"',
    code: lauf.status, fehler: lauf.error ? lauf.error.message : null,
    aus: lauf.stdout || '', err: getrennt.text,
    befund: getrennt.daten,
  };
}

// DIE BEFUNDZEILE AUS DEM STROM NEHMEN -- Finden und Herausnehmen in EINER
// Funktion.
//
// Der Shorts-Dienst SUCHT die Zeile nur (findeVorschauJson); er zeigt stderr
// gar nicht an, also stoert sie dort niemanden. Die Longform-Ansicht zeigt
// BEIDE Stroeme in voller Laenge (EL) -- eine Zeile JSON mittendrin waere
// genau das, was diese Ansicht nicht sein soll: etwas, das ein Mensch liest
// und nicht versteht.
//
// Zwei getrennte Funktionen -- eine, die sucht, und eine, die kuerzt -- waeren
// zwei Vorstellungen davon, welche Zeile gemeint ist. Eines Tages faende die
// eine sie und die andere nicht, und dann stuende sie auf dem Schirm.
//
// GESUCHT WIRD NACH DEM artifact_type UND NICHT NACH DER POSITION: stderr
// kann auch Warnungen von node tragen, und die stehen mal davor und mal
// dahinter. Genau derselbe Grund wie beim Shorts-Dienst.
const LONGFORM_BEFUND_TYPE = 'adw_longform_befund';

function trenneBefundzeile(roh) {
  const zeilen = String(roh).split(/\r?\n/);
  let daten = null;
  const bleiben = [];
  for (const zeile of zeilen) {
    const t = zeile.trim();
    if (daten === null && t.startsWith('{')) {
      let d = null;
      try { d = JSON.parse(t); } catch (e) { d = null; }
      if (d && d.artifact_type === LONGFORM_BEFUND_TYPE) { daten = d; continue; }
    }
    bleiben.push(zeile);
  }
  // KEIN ZWEITES KUERZEN. Die Zeile aus der Liste zu nehmen entfernt genau
  // einen Zeilenumbruch -- denselben, den console.error hinter sie gesetzt
  // hat. Der erste Entwurf hat danach noch ein '\n' abgeschnitten "damit es
  // aufgeht"; EN-N1 hat das gefangen, weil stderr danach um ein Byte kuerzer
  // war als ohne das Argument. Ein Vergleich, der Byte fuer Byte prueft,
  // verzeiht auch das eine Byte nicht, und genau dafuer ist er da.
  return { daten, text: bleiben.join('\n') };
}

// BEI WELCHEM RUECKGABEWERT ES ETWAS ZU ZEIGEN GIBT.
//
// Die Regel dahinter ist ein Satz: hat der Arbeiter gelesen, zeigt die Seite,
// was er gelesen hat; hat er nichts gelesen, gibt es nichts zu zeigen.
//
//   0 (OK)        er ist durchgelaufen                   -> Seite
//   1 (BEFUND)    er hat gelesen und lehnt ab            -> Seite, mit seinem Grund
//   3 (GESPERRT)  eine Sperre im Quelltext greift        -> Seite, mit dem Grund
//   2 (AUFRUF)    "es wurde nichts gelesen" (EXIT_CODES) -> KEINE Seite
//
// Der 2er ist der einzige, der hier ausgeschlossen ist, und er ist es aus
// seiner eigenen Definition heraus: ein Aufruffehler faellt vor dem ersten
// Zugriff. Eine Seite darueber haette keinen Inhalt ausser der Meldung selbst
// -- und die gehoert dorthin, wo der Mensch gerade steht, wenn er den Dienst
// startet: ins Terminal. Ihr haeufigster Fall auf einem frischen Rechner ist
// ein fehlender Schluessel in der .env, und der wird dort behoben, nicht hier.
const LONGFORM_CODES_MIT_SEITE = [EXIT.OK, EXIT.BEFUND, EXIT.GESPERRT];

// Was der Rueckgabewert BEDEUTET -- geliehen aus der einen Tabelle im Leser
// (EXIT_CODES), nicht hier ein zweites Mal aufgeschrieben. Der Zusatz je Fall
// sagt, was das FUER DIESE SEITE heisst, und er sagt nichts ueber den Inhalt
// des Trockenlaufs: der steht darunter, in den Worten des Arbeiters.
//
// KEIN "BEREIT", KEIN "IN ORDNUNG", KEIN GRUEN. Auch der 0er ist hier kein
// gutes Zeichen, sondern eine Auskunft ueber einen Prozess, der zu Ende
// gelaufen ist. Ein Zustand, der gut aussieht, obwohl er es nicht ist, ist der
// Fehler, gegen den dieses ganze Projekt gebaut ist.
const LONGFORM_ZUSATZ = {
  [EXIT.OK]: 'Er hat keinen Grund gefunden, vorher abzubrechen. Das heisst NICHT, dass ' +
    'hochgeladen werden koennte: den Weg dorthin gibt es in diesem Dienst nicht, und was ' +
    'der Trockenlauf selbst nicht kann, sagt er unten unter seiner eigenen Ueberschrift.',
  [EXIT.BEFUND]: 'Er hat gelesen, gerechnet und lehnt ab. Der Grund steht unten in seinen ' +
    'Worten -- diese Seite gibt ihn nicht mit eigenen wieder.',
  [EXIT.GESPERRT]: 'Eine benannte Sperre im Quelltext greift (Vertrag 2.11). Es gibt kein ' +
    'Argument, das sie umgeht, und dieser Dienst hat keines.',
};

function longformAusgang(trocken) {
  const bekannt = EXIT_CODES.find((c) => c.wert === trocken.code);
  return {
    code: trocken.code,
    name: bekannt ? bekannt.name : null,
    bedeutung: bekannt ? bekannt.bedeutung : null,
    zusatz: LONGFORM_ZUSATZ[trocken.code] || null,
    fehler: trocken.fehler,
  };
}

// Die Sitzung des Longform-Modus. Sie traegt ABSICHTLICH weniger als die des
// Shorts-Modus: keine Karten, keine Freigabedatei, keinen Stand und keine
// Kette. Was sie nicht hat, kann keine Route anfassen -- und es gibt in diesem
// Modus auch keine, die es versuchte.
//
// EN: SIE TRAEGT JETZT EINE PFADSPERRE, mit GENAU EINEM Eintrag. Der Satz
// darueber hiess bis EN "keine Videoliste und keine Pfadsperre", und er wandert
// hier mit, statt weiter behauptet zu werden: seit die Ansicht das Thumbnail
// zeigt, geht ein Weg von einer Anfrage auf die Platte, und der bekommt
// denselben Torwaechter wie der Weg zum Video im Shorts-Modus -- nicht einen
// zweiten, der spaeter anders gebaut ist.
//
// `trocken` ist das Ergebnis von ruftLongformTrocken(). Seine beiden Stroeme
// werden hier NICHT ausgewertet, nicht zerlegt und nicht umsortiert; die Seite
// setzt sie ueber textContent in den Baum, und das ist der ganze Weg von der
// Ausgabe des Arbeiters bis vor die Augen eines Menschen. Ausgewertet wird
// allein `trocken.befund` -- die Zeile, die der Arbeiter AUSDRUECKLICH fuer
// diesen Dienst herausgibt, damit niemand den Bildpfad aus dem Text schneidet.
function baueLongformSitzung({ aufnahme, projektwurzel, port, trocken }) {
  if (!AUFNAHME_FORM.test(String(aufnahme))) {
    throw new Error('baueLongformSitzung: die Aufnahme hat nicht die feste Form.');
  }
  const sperre = neueSperre();
  return {
    modus: MODUS_LONGFORM,
    aufnahme,
    port,
    projektwurzel,
    token: crypto.randomBytes(32).toString('hex'),
    trocken,
    ausgang: longformAusgang(trocken),
    sperre,
    bild: nimmBildAuf(trocken.befund, sperre),
  };
}

// DAS EINE BILD DIESER SITZUNG -- oder keines, mit dem Grund.
//
// HIER STEHT DIE GANZE SICHERUNG DER BILDROUTE, und sie steht hier und nicht
// dort, weil sie EINMAL beim Start greift und nicht bei jeder Anfrage. Eine
// Pruefung, die je Anfrage laeuft, ist eine Pruefung, die je Anfrage umgangen
// werden kann; eine, die den Pfad ueberhaupt nur einmal in die Sitzung laesst,
// hat danach nichts mehr zu tun.
//
// DREI HUERDEN, und jede faengt etwas anderes:
//
//   1. Der Pfad muss unter dem Export-Ordner liegen, den DIESER Dienst in
//      seiner eigenen Umgebung stehen hat -- nicht unter dem, den der Befund
//      selbst nennt. Sonst prueft der Fuchs den Fuchs.
//   2. Sein letzter Teil muss woertlich der Dateiname aus dem Befund sein.
//      Damit ist ein "..", ein zweiter Ordner oder ein angehaengtes Stueck im
//      Pfad kein Pfad mehr, der hier durchkommt.
//   3. Er wird in der Pfadsperre registriert. Ab da ist ER es, der geoeffnet
//      wird -- woertlich, unveraendert -, und alles andere wirft.
//
// WAS DIESE FUNKTION NICHT TUT: die Datei anfassen. Kein stat, kein open, kein
// Hash. Ob sie noch daliegt, prueft die Route beim Ausliefern; hier geht es
// allein darum, ob dieser Pfad ueberhaupt in die Sitzung darf.
function nimmBildAuf(befund, sperre) {
  const ohne = (grund) => ({ da: false, grund });
  if (!befund) {
    return ohne('Der Arbeiter hat keine Befundzeile ausgegeben. Ohne sie gibt es keinen ' +
      'Bildpfad -- und aus seiner Vorschau wird keiner herausgeschnitten.');
  }
  if (!befund.bild) {
    return ohne(befund.ohne_bild_weil ||
      'Der Arbeiter hat kein einzelnes Bild bestimmt.');
  }
  const b = befund.bild;
  const exportOrdner = process.env.THUMBNAIL_EXPORT_DIR || null;
  if (!exportOrdner) {
    return ohne('THUMBNAIL_EXPORT_DIR steht nicht in der Umgebung dieses Dienstes. Ohne den ' +
      'Ordner gibt es nichts, wogegen der Bildpfad zu pruefen waere, und ein ungepruefter ' +
      'Pfad wird nicht ausgeliefert.');
  }
  if (typeof b.pfad !== 'string' || typeof b.dateiname !== 'string' ||
      b.pfad === '' || b.dateiname === '') {
    return ohne('Die Befundzeile traegt keinen brauchbaren Bildpfad.');
  }
  if (!pfadLiegtUnter(exportOrdner, b.pfad)) {
    return ohne('Der Bildpfad aus der Befundzeile liegt nicht unter dem Export-Ordner ' +
      'dieses Dienstes. Es wird nichts ausgeliefert, was ausserhalb liegt.');
  }
  if (path.basename(b.pfad) !== b.dateiname) {
    return ohne('Der letzte Teil des Bildpfads ist nicht der Dateiname, den die Befundzeile ' +
      'nennt. Zwei Angaben ueber dieselbe Datei, die auseinandergehen, werden nicht ' +
      'aufgeloest, sondern abgewiesen.');
  }
  if (!ERLAUBTE_BILDTYPEN.includes(b.typ)) {
    return ohne('Die Befundzeile nennt als Inhaltstyp ' + JSON.stringify(b.typ || null) +
      '. Ausgeliefert werden nur ' + ERLAUBTE_BILDTYPEN.join(' und ') + '.');
  }
  sperre.ausDatei(b.pfad);
  return {
    da: true,
    grund: null,
    pfad: b.pfad,
    dateiname: b.dateiname,
    bytes: typeof b.bytes === 'number' ? b.bytes : null,
    sha256: typeof b.sha256 === 'string' ? b.sha256 : null,
    sha256_herkunft: b.sha256_herkunft || null,
    typ: b.typ,
    rang: b.rang === undefined ? null : b.rang,
    art: b.art || null,
    zettel: b.zettel || null,
    weitere_im_rang: typeof b.weitere_im_rang === 'number' ? b.weitere_im_rang : 0,
    hinweise: Array.isArray(befund.hinweise) ? befund.hinweise : [],
  };
}

// EINE FREIGABELISTE, KEINE ZWEITE ZUORDNUNG.
//
// Welche Endung welchen Inhaltstyp ergibt, steht im Arbeiter (BILDTYP_JE_ENDUNG)
// und geht von dort in die Befundzeile -- dieselbe Tabelle, die auch den Typ
// des zweiten schreibenden Aufrufs bestimmt (Vertrag 2.10). Sie hier ein
// zweites Mal hinzuschreiben hiesse, sie eines Tages anders zu haben.
//
// GEPRUEFT WIRD SIE TROTZDEM, und das ist kein Widerspruch: der Wert kommt aus
// der Ausgabe eines Kindprozesses und geht in eine Kopfzeile der Antwort. Was
// in eine Kopfzeile geht, wird gegen eine feste Liste gehalten und nicht
// durchgereicht, gleich wie vertrauenswuerdig die Quelle heute ist.
const ERLAUBTE_BILDTYPEN = Object.freeze(['image/jpeg', 'image/png']);

// Der eine Ausgang des Longform-Modus, der KEINE Seite hat: der Arbeiter kam
// nicht bis zum Lesen. Sein Text wird unveraendert durchgereicht -- er hat
// eigene Meldungen fuer den fehlenden Schluessel und fuer die beiden noch
// nicht gebauten Argumente, und die sind besser als jede, die dieser Dienst
// darueber schreiben koennte.
//
// KEINE ZWEITE DEUTUNG. Was hier von diesem Dienst stammt, sind der Rahmen und
// die Angabe, wo die Sperre lag; alles andere ist der Arbeiter, mit "| "
// eingerueckt, damit zu sehen bleibt, wo sein Text anfaengt und aufhoert.
function meldeLongformOhneVorschau(aufnahme, sperrpfad, trocken) {
  const z = [];
  z.push('');
  z.push('ABBRUCH: der Longform-Arbeiter kam nicht bis zum Lesen.');
  z.push('');
  z.push('  Aufnahme:       ' + aufnahme);
  z.push('  Sperrdatei:     ' + sperrpfad + '   (wird jetzt freigegeben)');
  z.push('  Aufruf:         ' + trocken.befehl);
  z.push('  Rueckgabewert:  ' + (trocken.code === null ? '(kein Ende)' : trocken.code));
  z.push('');
  if (trocken.fehler) {
    z.push('  Er liess sich nicht starten: ' + trocken.fehler);
    z.push('');
  }
  const durchgereicht = (trocken.err || '') + (trocken.aus || '');
  if (durchgereicht.trim() !== '') {
    z.push('  Was er selbst dazu sagt, woertlich:');
    z.push('');
    for (const zeile of durchgereicht.split(String.fromCharCode(10))) {
      z.push(zeile === '' ? '' : '  | ' + zeile);
    }
    z.push('');
  }
  z.push('Es wurde nichts hochgeladen, nichts veroeffentlicht und keine Seite ausgeliefert.');
  z.push('Geschrieben hat dieser Dienst nichts ausser seiner Sperre, und die ist wieder weg.');
  z.push('');
  return z.join(String.fromCharCode(10));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function wertVon(argv, praefix) {
  const t = argv.slice(2).find((x) => x.startsWith(praefix));
  return t === undefined ? null : t.slice(praefix.length);
}

// DER START DES LONGFORM-MODUS (EL, Vertrag 4, Schritte 1 bis 7)
//
// Er steht als eigene Funktion und nicht als Zweig mitten in main(): die
// Shorts-Linie darunter ist lang, und ein Modus, der sich durch sie
// hindurchschlaengelt, laesst sich nicht mehr lesen, ohne beide zu lesen.
//
// DIE SPERRE IST SCHON GENOMMEN, wenn diese Funktion anfaengt, und `abbruch`
// ist die EINE Tuer nach draussen -- dieselbe, die die Shorts-Linie benutzt,
// und die einzige, die die Sperre wieder freigibt. Es gibt hier kein
// process.exit, das an ihr vorbeigeht.
//
// DIE REIHENFOLGE IST DIE AUS VERTRAG 4, und sie ist keine Geschmacksfrage:
// der Trockenlauf laeuft VOR dem Port. Ein Dienst, der erst einen Port
// aufmacht und dann eine halbe Minute rechnet, zeigt in dieser halben Minute
// eine leere Seite -- und eine leere Seite ist der Zustand, den ein Mensch am
// leichtesten fuer "nichts gefunden" haelt.
function starteLongform({ aufnahme, projektwurzel, port, sperre, keinBrowser, abbruch }) {
  console.log('Rufe den Longform-Arbeiter im Trockenlauf: ' +
    path.relative(projektwurzel, LONGFORM_ARBEITER) +
    ' --aufnahme=' + JSON.stringify(aufnahme));
  console.log('Er liest und rechnet. Er macht keinen Netzaufruf und laedt nichts hoch.');
  const trocken = ruftLongformTrocken(aufnahme);

  // Der 2er und der nicht gestartete Prozess sind die beiden Faelle, in denen
  // es nichts zu zeigen gibt. Beide gehen ueber abbruch() -- die Sperre wird
  // frei, und der Text des Arbeiters geht unveraendert mit.
  if (!LONGFORM_CODES_MIT_SEITE.includes(trocken.code)) {
    abbruch(meldeLongformOhneVorschau(aufnahme, sperre.pfad, trocken));
    return;
  }

  const sitzung = baueLongformSitzung({ aufnahme, projektwurzel, port, trocken });
  const dienst = baueDienst(sitzung);
  const verbindungen = new Set();
  dienst.on('connection', (s) => {
    verbindungen.add(s);
    s.on('close', () => verbindungen.delete(s));
  });

  dienst.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      abbruch(meldeBelegtenPort(port));
      return;
    }
    abbruch(String.fromCharCode(10) + 'Abbruch: ' + e.message + String.fromCharCode(10));
  });

  let beendet = false;
  function herunterfahren(grund) {
    if (beendet) return;
    beendet = true;
    console.log(String.fromCharCode(10) + grund);
    // Anders als im Shorts-Modus steht hier NICHT "alle Urteile stehen auf der
    // Platte": es gibt in diesem Modus kein Urteil und keine Datei, in der
    // eines stuende. Der Satz waere eine Beruhigung ueber etwas, das gar nicht
    // vorkommt.
    console.log('Diese Sitzung hat gelesen und gezeigt. Geschrieben hat sie nichts ausser ' +
      'ihrer Sperre, und die geht jetzt weg.');
    const frei = gibSperreFrei(sperre);
    console.log(frei.geloescht
      ? 'Sperre freigegeben: ' + sperre.pfad
      : 'Sperrdatei blieb liegen: ' + frei.grund);
    dienst.close(() => process.exit(EXIT_OK));
    for (const s of verbindungen) s.destroy();
    setTimeout(() => process.exit(EXIT_OK), 2000).unref();
  }

  // NUR SIGINT. Es gibt in diesem Modus keine POST-Route und keinen Knopf, der
  // 'beenden-erwuenscht' ausloesen koennte; ein Zuhoerer darauf waere ein
  // Anschluss ins Leere und saehe aus wie ein Weg, den es gibt.
  process.on('SIGINT', () => herunterfahren('Strg+C -- beende den Dienst.'));

  dienst.listen(port, HOST, () => {
    const adresse = 'http://' + HOST + ':' + port + '/?t=' + sitzung.token;
    traegeSperrePortNach(sperre, port);
    console.log('');
    console.log('Betriebsmodus:  ' + MODUS_BEZEICHNUNG[MODUS_LONGFORM]);
    console.log('Aufnahme:       ' + sitzung.aufnahme);
    console.log('Trockenlauf:    ' + trocken.befehl);
    console.log('Rueckgabewert:  ' + sitzung.ausgang.code +
      (sitzung.ausgang.name ? ' (' + sitzung.ausgang.name + ')' : ''));
    console.log('Sperre:         ' + sperre.pfad + '   (PID ' + process.pid +
      ', Port ' + port + ')');
    if (sperre.verwaist) {
      const v = sperre.verwaist.vorhanden;
      console.log('                VERWAISTE SPERRE UEBERNOMMEN -- ' + sperre.verwaist.grund + '.');
      console.log('                Sie stammte von PID ' + (v ? v.pid : '(unlesbar)') +
        (v && v.port ? ', Port ' + v.port : '') +
        (v && v.gestartet_am ? ', gestartet am ' + v.gestartet_am : '') +
        '. Diese Sitzung wurde nicht geordnet beendet.');
    }
    console.log('');
    console.log('Die Seite zeigt die Ausgabe des Trockenlaufs, woertlich, und hoert dort ' +
      'auf. Es gibt auf ihr keinen Knopf, der etwas hochlaedt, und keine Ermaechtigung.');
    console.log('');
    console.log('Die Adresse traegt das Sitzungstoken dieses Starts. Ohne das Token ' +
      'antwortet der Dienst auf nichts:');
    console.log('  ' + adresse);
    console.log('');
    console.log('Beenden: Strg+C hier im Terminal. Die Seite hat dafuer keinen Knopf ' +
      '-- sie schickt ueberhaupt nichts an diesen Dienst zurueck.');

    if (keinBrowser) {
      console.log('');
      console.log('--no-browser: es wird nichts geoeffnet. Nimm die Adresse oben.');
      return;
    }
    const auf = oeffneImBrowser(adresse);
    console.log('');
    console.log(auf.gestartet
      ? 'Die Seite wird im Standardbrowser geoeffnet (--no-browser schaltet das ab).'
      : 'Der Browser liess sich nicht oeffnen (' + auf.grund + '). Der Dienst laeuft ' +
        'weiter -- nimm die Adresse oben von Hand.');
  });
}

function main() {
  const argv = process.argv;
  const aufnahme = wertVon(argv, '--aufnahme=');
  const wurzel = wertVon(argv, '--wurzel=') || process.env.SHORTS_RENDER_WURZEL || null;
  const portRoh = wertVon(argv, '--port=') || process.env.SHORTS_FREIGABE_PORT || String(STANDARD_PORT);
  const keinBrowser = argv.includes('--no-browser');
  const projektwurzel = path.join(__dirname, '..', '..');

  // DER MODUS ZUERST, weil von ihm abhaengt, welche der folgenden Pruefungen
  // ueberhaupt gelten. Ohne Angabe: Shorts -- das ist der Aufruf des Knopfes
  // der Gegenseite, und fuer ihn aendert sich hier nichts.
  const modusRoh = wertVon(argv, '--modus=');
  const modus = modusRoh === null ? MODUS_SHORTS : modusRoh;
  if (!MODI.includes(modus)) {
    console.error('\nAbbruch: --modus= ist ' + JSON.stringify(modus) + ' und keiner der ' +
      'Betriebsmodi. Bekannt sind: ' + MODI.join(', ') + '.\nOhne --modus= laeuft der ' +
      'Dienst im Modus ' + MODUS_SHORTS + '.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  const verbindungsfehler = pruefeModusVerbindung(modus, argv);
  if (verbindungsfehler) {
    console.error(verbindungsfehler);
    process.exit(EXIT_AUFRUFFEHLER);
  }

  if (!aufnahme) {
    console.error('\nAbbruch: --aufnahme= fehlt. Beispiel: --aufnahme="2026-08-29 18-18-19"\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  if (!AUFNAHME_FORM.test(aufnahme)) {
    console.error('\nAbbruch: --aufnahme= hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  // Nur im Shorts-Modus: die Wurzel geht an den LESER, und der laeuft im
  // Longform-Modus nicht. Eine Shorts-Renderwurzel dort zu verlangen hiesse,
  // einen Longform-Start an einer Einstellung scheitern zu lassen, die er nie
  // anfasst.
  if (modus === MODUS_SHORTS && !wurzel) {
    console.error('\nAbbruch: keine Wurzel. Setze SHORTS_RENDER_WURZEL in der .env ' +
      'oder gib --wurzel= an.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  if (!/^[0-9]{1,5}$/.test(portRoh) || Number(portRoh) < 1 || Number(portRoh) > 65535) {
    console.error('\nAbbruch: --port= ist ' + JSON.stringify(portRoh) + ' und keine ' +
      'Portnummer zwischen 1 und 65535.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  const port = Number(portRoh);

  // DIE SPERRE WIRD ALS ERSTES GENOMMEN -- vor dem Leser, vor dem Lesen der
  // Freigabedatei, vor dem Port.
  //
  // Vor dem Leser, weil der eine halbe Minute ffprobe und sha256 laeuft: ein
  // zweiter Start soll das nicht erst tun und dann abbrechen.
  // Vor dem Lesen der Freigabedatei, weil GENAU DA der Schaden entsteht -- der
  // Stand, den eine Sitzung beim Start einliest, ist der Stand, den sie beim
  // ersten Klick zurueckschreibt.
  let sperre;
  try {
    sperre = nimmSperre({ projektwurzel, aufnahme, modus });
  } catch (e) {
    console.error('\nAbbruch: die Sperrdatei liess sich nicht anlegen (' +
      (e.code || e.message) + '): ' + sperrPfad(projektwurzel, aufnahme, modus) + '\n');
    process.exit(EXIT_ABBRUCH);
  }
  if (!sperre.ok) {
    console.error(meldeFremdeSperre(sperre, aufnahme));
    process.exit(EXIT_ABBRUCH);
  }

  // Ab hier gehoert uns eine Datei auf der Platte. JEDER Ausgang unterhalb
  // dieser Zeile muss sie wieder freigeben -- deshalb geht ab hier kein
  // process.exit mehr direkt, sondern nur ueber abbruch().
  function abbruch(text) {
    if (text) console.error(text);
    const frei = gibSperreFrei(sperre);
    if (!frei.geloescht) console.error('Sperrdatei blieb liegen: ' + frei.grund);
    process.exit(EXIT_ABBRUCH);
  }

  // DER LONGFORM-MODUS (EL). Er zweigt HIER ab, an derselben Stelle, an der er
  // bis EI endete: hinter der Sperre und vor dem Leser. Was danach kommt, ist
  // die SHORTS-Linie -- der Leser, die Karten, die Seite --, und nichts davon
  // gilt fuer Longform oder wird ihm untergeschoben. Der Longform-Zweig
  // kehrt nie in die Shorts-Linie zurueck; er hat seinen eigenen Ausgang.
  if (modus === MODUS_LONGFORM) {
    starteLongform({ aufnahme, projektwurzel, port, sperre, keinBrowser, abbruch });
    return;
  }

  console.log('Rufe den Leser: ' + path.relative(projektwurzel, LESER) +
    ' --aufnahme=' + JSON.stringify(aufnahme) + ' --json');
  const gelesen = ruftLeser(aufnahme, wurzel);
  if (gelesen.fehler) {
    abbruch('\nAbbruch: ' + gelesen.fehler + '\n');
    return;
  }
  const bericht = gelesen.bericht;

  // Der Leser meldet einen Kopffehler mit einem Bericht ohne Eintraege. Karten
  // gibt es dann keine, und es wird auch keine erfunden.
  if (bericht.fehler) {
    abbruch('\nAbbruch: ' + bericht.fehler + '\n');
    return;
  }
  if ((bericht.kopfMaengel || []).length > 0) {
    console.error('\nAbbruch: Der Kopf der Lieferung traegt nicht. Der Leser meldet:');
    for (const m of bericht.kopfMaengel) {
      console.error('  ' + (m.feld || '-') + ': ' + m.meldung);
    }
    console.error('\nEs wird nichts angezeigt und nichts freigegeben.\n');
    abbruch(null);
    return;
  }
  // Absicherung gegen einen Aufruf, der die Plattenpruefung verloren hat: ohne
  // sie ist `daten` bei jedem Eintrag leer, und die Seite waere leer statt
  // falsch -- gesagt wird es trotzdem.
  if (bericht.plattenpruefung !== true) {
    console.error('\nAbbruch: Der Leser lief ohne Plattenpruefung. Dann ist nicht ' +
      'nachgesehen worden, ob die Videos ueberhaupt existieren -- freigeben laesst sich ' +
      'so nichts.\n');
    abbruch(null);
    return;
  }

  let sitzung;
  try {
    sitzung = baueSitzung({
      bericht, eingabeText: gelesen.text, aufnahme, projektwurzel, port,
    });
  } catch (e) {
    console.error('\nAbbruch: ' + e.message);
    if (e.freigabePfad) console.error('Betroffene Datei: ' + e.freigabePfad);
    console.error('');
    abbruch(null);
    return;
  }

  const dienst = baueDienst(sitzung);
  const verbindungen = new Set();
  dienst.on('connection', (s) => {
    verbindungen.add(s);
    s.on('close', () => verbindungen.delete(s));
  });

  dienst.on('error', (e) => {
    // Auch diese beiden Ausgaenge gehen ueber abbruch(): der belegte Port ist
    // der haeufigste Grund, aus dem ein Start scheitert, NACHDEM die Sperre
    // schon genommen war. Eine Sperrdatei, die nach so einem Abbruch liegen
    // bleibt, blockiert den naechsten Start ohne Not.
    if (e.code === 'EADDRINUSE') {
      abbruch(meldeBelegtenPort(port));
      return;
    }
    abbruch('\nAbbruch: ' + e.message + '\n');
  });

  let beendet = false;
  function herunterfahren(grund) {
    if (beendet) return;
    beendet = true;
    console.log('\n' + grund);
    console.log('Alle Urteile stehen auf der Platte -- geschrieben wurde nach jedem ' +
      'einzelnen Klick, nicht jetzt.');
    // Die Sperre wird VOR dem Schliessen des Dienstes freigegeben und nicht im
    // close-Rueckruf: der laeuft erst, wenn die letzte Verbindung weg ist, und
    // der Notausgang unten (zwei Sekunden) wuerde ihn dann ueberholen. Hier
    // steht nichts mehr aus, was ein offener Port noch retten koennte -- die
    // Urteile sind laengst geschrieben, nach jedem einzelnen Klick.
    const frei = gibSperreFrei(sperre);
    console.log(frei.geloescht
      ? 'Sperre freigegeben: ' + sperre.pfad
      : 'Sperrdatei blieb liegen: ' + frei.grund);
    dienst.close(() => process.exit(EXIT_OK));
    for (const s of verbindungen) s.destroy();
    // Falls eine Verbindung haengt: nach zwei Sekunden trotzdem raus. Es steht
    // nichts mehr aus, was verloren gehen koennte.
    setTimeout(() => process.exit(EXIT_OK), 2000).unref();
  }

  dienst.on('beenden-erwuenscht', () => herunterfahren('Von der Seite aus beendet.'));
  process.on('SIGINT', () => herunterfahren('Strg+C -- beende den Dienst.'));

  dienst.listen(port, HOST, () => {
    const adresse = 'http://' + HOST + ':' + port + '/?t=' + sitzung.token;
    // Jetzt erst steht der Port fest. Bis hierher stand `null` in der
    // Sperrdatei, und `null` heisst dort "faehrt gerade hoch".
    traegeSperrePortNach(sperre, port);
    const freigebbar = sitzung.karten.filter((k) => k.freigebbar).length;
    const gesperrt = sitzung.karten.length - freigebbar;
    console.log('');
    console.log('Betriebsmodus:  ' + MODUS_BEZEICHNUNG[modus]);
    console.log('Aufnahme:       ' + sitzung.aufnahme);
    console.log('Eintraege:      ' + sitzung.karten.length + ' -- ' + freigebbar +
      ' freigebbar, ' + gesperrt + ' vom Leser abgelehnt (angezeigt, nicht abspielbar)');
    console.log('Freigabedatei:  ' + sitzung.freigabePfad);
    console.log('Sperre:         ' + sperre.pfad + '   (PID ' + process.pid +
      ', Port ' + port + ')');
    if (sperre.verwaist) {
      // AUSDRUECKLICH benannt, nicht stillschweigend uebernommen. Wer das hier
      // liest, weiss, dass beim letzten Mal etwas hart abgebrochen ist.
      const v = sperre.verwaist.vorhanden;
      console.log('                VERWAISTE SPERRE UEBERNOMMEN -- ' + sperre.verwaist.grund + '.');
      console.log('                Sie stammte von PID ' + (v ? v.pid : '(unlesbar)') +
        (v && v.port ? ', Port ' + v.port : '') +
        (v && v.gestartet_am ? ', gestartet am ' + v.gestartet_am : '') +
        '. Diese Sitzung wurde nicht geordnet beendet.');
    }
    console.log('Lesereingabe:   sha256 ' + sitzung.eingabeSha256);
    if (sitzung.uebernommen) {
      const bekannt = new Set(sitzung.karten.filter((k) => k.freigebbar).map((k) => k.sha256));
      const fremd = Object.keys(sitzung.stand).filter((s) => !bekannt.has(s)).length;
      console.log('Uebernommen:    ' + sitzung.uebernommen + ' Urteil(e) aus der vorhandenen ' +
        'Freigabedatei' + (fremd
          ? ' -- davon ' + fremd + ' zu Pruefsummen, die in dieser Lieferung nicht ' +
            'vorkommen. Die bleiben unveraendert in der Datei stehen und werden NICHT ' +
            'angezeigt; weggeworfen wird kein Urteil.'
          : '.'));
    }
    console.log('');
    console.log('Die Adresse traegt das Sitzungstoken dieses Starts. Ohne das Token ' +
      'antwortet der Dienst auf nichts:');
    console.log('  ' + adresse);
    console.log('');
    console.log('Beenden: der Knopf auf der Seite oder Strg+C. Dieser Dienst laedt nichts ' +
      'hoch und schreibt nur die Freigabedatei und seine Sperre.');

    // Zuletzt, und ausdruecklich NACH der Adresse: sie bleibt in der Konsole
    // stehen, auch wenn das Oeffnen klappt. Wer den falschen Browser bekommt
    // oder das Fenster schliesst, braucht sie noch.
    if (keinBrowser) {
      console.log('');
      console.log('--no-browser: es wird nichts geoeffnet. Nimm die Adresse oben.');
      return;
    }
    const auf = oeffneImBrowser(adresse);
    console.log('');
    console.log(auf.gestartet
      ? 'Die Seite wird im Standardbrowser geoeffnet (--no-browser schaltet das ab).'
      : 'Der Browser liess sich nicht oeffnen (' + auf.grund + '). Der Dienst laeuft ' +
        'weiter -- nimm die Adresse oben von Hand.');
  });
}

if (require.main === module) main();

module.exports = {
  ERLAUBTE_ARGUMENTE, EXIT_OK, EXIT_ABBRUCH, EXIT_AUFRUFFEHLER,
  HOST, STANDARD_PORT, AUFNAHME_FORM,
  MODUS_SHORTS, MODUS_LONGFORM, MODI, MODUS_BEZEICHNUNG, pruefeModus,
  pruefeModusVerbindung, meldeLongformOhneVorschau,
  LONGFORM_ARBEITER, LONGFORM_CODES_MIT_SEITE, LONGFORM_ZUSATZ,
  ruftLongformTrocken, longformAusgang, baueLongformSitzung,
  LONGFORM_BEFUND_TYPE, ERLAUBTE_BILDTYPEN, trenneBefundzeile, nimmBildAuf,
  ROUTEN_GET, ROUTEN_POST,
  FREIGABE_SCHEMA_VERSION, FREIGABE_ARTIFACT_TYPE,
  TITEL_MAX_ZEICHEN, NOTIZ_MAX_ZEICHEN, MAX_ANFRAGE_BYTES,
  freigabePfad, ruftLeser, baueKarten, pruefeTitel, pruefeNotiz,
  leseFreigaben, schreibeFreigaben, leseBereich,
  baueDienst, baueSitzung, sitzungsEintraege, sitzungsstand,
  haelterDesPorts, meldeBelegtenPort,
  SPERRE_ARTIFACT_TYPE, SPERRE_ARTIFACT_TYP_JE_MODUS, SPERRE_SCHEMA_VERSION,
  sperrPfad, prozessLebt, sperrePasstZumPort, leseSperre, sperrinhalt,
  schreibeSperrinhalt, nimmSperre, traegeSperrePortNach, gibSperreFrei,
  meldeFremdeSperre, oeffneImBrowser,
  PROJEKTWURZEL, PLANER, UPLOADER, ARCHIV_ORDNER,
  planPfadDerKette, archivPfad, archiviereAltenPlan, schreibeErmaechtigung, leseKanal,
  ruftPlaner, ruftUploaderTrocken, starteUploaderLauf,
  neueKette, schritt3Bereit, kettenstand,
};
