'use strict';

// ---------------------------------------------------------------------------
// EP/EU: DAS LONGFORM-GEDAECHTNIS (Vertrag 5) UND DIE BEIDEN ERMAECHTIGUNGEN
//        (2.12)
// ---------------------------------------------------------------------------
//
// WARUM DIESE BEIDEN IN EINER DATEI UND NICHT IM ARBEITER.
//
// Der Arbeiter ist bis EK die LESENDE Haelfte, und ueber ihm steht seit EK der
// Satz "Es SCHREIBT nichts". Ab EP schreibt dieser Weg -- aber nicht ueberall:
// die Vorschau, die Zettelwahl und die Metadaten bleiben, was sie waren. Laege
// alles in einer Datei, liesse sich ueber keinen Teil davon mehr ein Satz
// sagen, der fuer die ganze Datei gilt. Hier liegt, was auf die Platte
// schreibt, und hier steht auch, wogegen es prueft, bevor es schreibt.
//
// WAS HIER NICHT VORKOMMT, und der Test rechnet es nach: kein Netz, keine
// Bibliothek fuer den Kanal, kein Aufrufname der API, kein
// Vorausveroeffentlichungsfeld. Dieses Modul kennt die Kennung eines Videos
// nur als Zeichenkette, die ihm jemand gibt.
//
// GELIEHEN STATT NACHGEBAUT (Vertrag 2.1). Der Shorts-Uploader hat 21 Shorts
// ohne Doppel-Upload hochgeladen; seine Regeln sind gemessen, ein Nachbau
// waere es nicht:
//
//   uploader.js  schreibeGedaechtnisAtomar  tmp im selben Ordner, fsync,
//                                           umbenennen, tmp wegraeumen
//                schonHochgeladen           DIE Doppel-Upload-Abwehr: der
//                                           Schluessel ist die sha256, nicht
//                                           der Pfad und nicht ein Name
//                sha256Datei                die Pruefsumme einer Datei
//                sha256Text                 die Pruefsumme der Beschreibung
//                neuerZufall, ZUFALL_FORM   32 Bytes, 64 Hexziffern
//                ermaechtigungOrdner        EIN Ordner fuer beide Sorten
//                ermaechtigungPfad          der Dateiname kommt AUS dem
//                                           Zufallswert und aus nichts sonst
//                leseVerbrauchte            eine unlesbare Liste heisst NEIN
//                verbraucheErmaechtigung    erst merken, dann loeschen -- und
//                                           vorher nachsehen, wessen Datei da
//                                           jetzt liegt
//                pruefeKanal                der Vergleich nach channels.list
//                ERMAECHTIGUNG_GUELTIG_MS   zwei Minuten
//                ERMAECHTIGUNG_ZUKUNFT_MS   eine Sekunde Uhrenspielraum
//   planer.js    ISO_UTC                    die Form eines Zeitstempels
//   uebergabe-leser.js  AUFNAHME_FORM, SHA256_FORM, pfadLiegtUnter
//
// WAS NICHT GELIEHEN WURDE, samt Grund:
//
//   uploader.pruefeErmaechtigung  Sie prueft `plan_sha256` und `anzahl`. Beide
//     Felder gibt es hier nicht, und die drei, die es hier gibt (die sha256
//     der Videodatei, das Bild, der Zettel), gibt es dort nicht. Was
//     uebereinstimmt -- Pfadsperre, Verbrauchsliste, Zeitfenster, Reihenfolge
//     der Pruefungen -- steht unten sichtbar in derselben Reihenfolge; was
//     verschieden ist, ist der Vergleich selbst. Eine gemeinsame Funktion mit
//     einem Feldschema als Argument waere die Stelle, an der ein vergessenes
//     Feld stillschweigend nicht mehr geprueft wuerde.
//   uploader.neuesGedaechtnis     Der Kopf traegt hier `video` statt
//     `plan_datei`/`plan_sha256`; es gibt keinen Plan (Vertrag 2.12).
//
// DER PREIS, UND ER WIRD GESAGT: `verbraucht.json` wird mit dem Uploader
// GETEILT, und ihr artifact_type heisst `adw_shorts_ermaechtigungen_verbraucht`.
// Der Name ist historisch und ab hier zu eng. Ihn zu aendern hiesse,
// uploader.js anzufassen; das steht nicht in der Schreiberlaubnis dieses
// Auftrags. Zwei Listen waeren die Alternative gewesen, und die zweite waere
// die ungemessene -- die Liste ist genau die Stelle, an der ein
// Wiedereinspielen scheitert. Was der Longform-Eintrag dort NICHT traegt (die
// sha256 der Videodatei, das Bild), traegt das Gedaechtnis in
// `ermaechtigung_upload`, und dort verlangt Vertrag 5.2 es auch.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const {
  AUFNAHME_FORM, SHA256_FORM, pfadLiegtUnter,
} = require('./uebergabe-leser');
const U = require('./uploader');
const P = require('./planer');

// ---------------------------------------------------------------------------
// TEIL 1 -- DAS GEDAECHTNIS (Vertrag 5)
// ---------------------------------------------------------------------------

// Ein EIGENER Ordner neben data/uploads/ (5.1). Der Name ist nicht zugesagt
// (9); genommen ist der aus DX.
const GEDAECHTNIS_ORDNER = 'uploads-longform';

// Eine eigene Kennung, ausdruecklich NICHT adw_shorts_uploads (5.2). Ein
// Longform-Gedaechtnis, das sich als Shorts-Gedaechtnis ausgibt, waere die
// Unwahrheit in dem einen Feld, das ein Programm liest, bevor es den Rest
// glaubt.
const GEDAECHTNIS_ARTIFACT_TYPE = 'adw_longform_uploads';
const GEDAECHTNIS_SCHEMA_VERSION = '1.0';

// Die temporaere Datei des atomaren Schreibens, an ihrer FORM erkannt (5.1).
// WOERTLICH die Form aus planer.js (GEDAECHTNIS_TMP_FORM); sie ist dort nicht
// ausgefuehrt, und ein Import waere der ehrlichere Weg gewesen. Weil er nicht
// offensteht, haelt tests/ep-privat.test.cjs die beiden Quelltexte
// gegeneinander -- eine Kopie, die auseinanderlaeuft, faellt dort auf.
const GEDAECHTNIS_TMP_FORM = /^\..+\.json\.tmp\.\d+\.\d+$/;

// DIE STAENDE (5.2). Diese Liste ist vollstaendig; welche davon DIESER Bau
// setzen kann, ist die zweite Liste. Seit EU sind sie gleich: `oeffentlich`
// schreibt Aufruf 3, und den gibt es jetzt.
const STAENDE = Object.freeze([
  'hochgeladen', 'verarbeitet', 'verarbeitung_abgebrochen', 'abgelehnt',
  'thumbnail_gesetzt', 'oeffentlich',
]);
// EU: `oeffentlich` KOMMT DAZU. Bis EU war diese Liste um genau einen Wert
// kuerzer als STAENDE, und der fehlende war der, den dieser Bau nicht setzen
// konnte. Er kann es jetzt; die Liste wird darum BERICHTIGT und nicht
// stehengelassen. Die beiden Listen sind seit EU gleich lang -- sie bleiben
// trotzdem zwei, weil sie zwei Fragen beantworten ("welche Staende gibt es"
// und "welche schreibt dieser Bau"), und die naechste Fassung koennte sie
// wieder auseinandertreiben.
const STAENDE_DIESES_BAUS = Object.freeze([
  'hochgeladen', 'verarbeitet', 'verarbeitung_abgebrochen', 'abgelehnt',
  'thumbnail_gesetzt', 'oeffentlich',
]);

function gedaechtnisOrdner(projektwurzel) {
  return path.join(projektwurzel, 'data', GEDAECHTNIS_ORDNER);
}

// Der Dateiname kommt AUS dem Aufnahmenamen und aus nichts sonst, und der ist
// vorher auf seine Form geprueft. Dieselbe Bauart wie uploader.gedaechtnisPfad.
function gedaechtnisPfad(projektwurzel, aufnahme) {
  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new Error('Aufnahmename hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '. Es wird kein Dateiname daraus gebaut.');
  }
  return path.join(gedaechtnisOrdner(projektwurzel), aufnahme + '.json');
}

// DIE VERZEICHNISREGEL (5.1), dieselbe wie in data/uploads/ seit DW und aus
// demselben Grund: was dort liegt und keine Gedaechtnisdatei ist, bricht den
// Lauf ab und wird beim Namen genannt.
//
// WARUM SIE HIER UEBERHAUPT GREIFT, obwohl dieser Weg nur EINE Datei je
// Aufnahme liest: eine umbenannte Gedaechtnisdatei ("....json.alt") saehe
// sonst aus wie "noch nie hochgeladen" -- und das ist genau der Zustand, nach
// dem dieser Weg ein zweites Video anlegen wuerde.
function leseGedaechtnisverzeichnis(verzeichnis) {
  const fehler = [];
  const dateien = [];
  let eintraege;
  try {
    eintraege = fs.readdirSync(verzeichnis, { withFileTypes: true })
      .slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (e) {
    // Kein Verzeichnis heisst: dieses Werkzeug hat noch nie ein Langformvideo
    // hochgeladen. Das ist der Normalfall vor dem ersten Lauf und kein Mangel.
    if (e.code === 'ENOENT') return { fehler: [], dateien: [] };
    return { fehler: ['Der Gedaechtnisordner ist nicht lesbar (' + (e.code || e.message) +
      '): ' + verzeichnis + '. Solange nicht feststeht, was dieses Werkzeug schon ' +
      'hochgeladen hat, wird nichts hochgeladen.'] };
  }
  for (const eintrag of eintraege) {
    const name = eintrag.name;
    if (GEDAECHTNIS_TMP_FORM.test(name)) continue;
    if (!name.endsWith('.json')) {
      fehler.push('In data/' + GEDAECHTNIS_ORDNER + '/ liegt ' +
        (eintrag.isDirectory() ? 'das VERZEICHNIS ' : '') + JSON.stringify(name) +
        '. Dorthin gehoert je Aufnahme eine Gedaechtnisdatei ' +
        '<JJJJ-MM-TT HH-MM-SS>.json und sonst nichts. Uebergangen wird nichts: eine ' +
        'weggeraeumte oder umbenannte Gedaechtnisdatei saehe aus wie "noch nie ' +
        'hochgeladen", und dann entstuende ein ZWEITES Video.');
      continue;
    }
    const aufnahme = name.slice(0, name.length - 5);
    if (!AUFNAHME_FORM.test(aufnahme)) {
      fehler.push('In data/' + GEDAECHTNIS_ORDNER + '/ liegt die Datei ' +
        JSON.stringify(name) + '. Ihr Name hat nicht die Form ' +
        '<JJJJ-MM-TT HH-MM-SS>.json. Stuende darin ein Gedaechtnis, faende dieser Lauf ' +
        'es nicht -- und dann entstuende ein ZWEITES Video.');
      continue;
    }
    dateien.push({ name, aufnahme, pfad: path.join(verzeichnis, name) });
  }
  return { fehler, dateien };
}

// Der Kopf eines frischen Gedaechtnisses (5.2). `video` kommt WOERTLICH aus
// dem Befund des Arbeiters -- Pfad, sha256, Groesse, mtime und die
// Groessenwarnung -- und wird hier nicht nachgerechnet.
function neuesGedaechtnis({ aufnahme, video, jetzt }) {
  const wann = new Date(jetzt).toISOString();
  return {
    artifact_type: GEDAECHTNIS_ARTIFACT_TYPE,
    schema_version: GEDAECHTNIS_SCHEMA_VERSION,
    aufnahme,
    angelegt_am: wann,
    zuletzt_geschrieben_am: wann,
    video: {
      pfad: video.pfad,
      sha256: video.sha256,
      groesse_bytes: video.bytes,
      mtime: video.mtime,
      // Die Warnung mit BEIDEN Zahlen oder null (5.2). Ein "unauffaellig" ist
      // keine Warnung; null heisst hier "es gab nichts zu warnen".
      groessenwarnung: (video.vergleich && video.vergleich.auffaellig)
        ? {
          eigene_bytes: video.bytes,
          mittel_bytes: video.vergleich.mittel,
          andere: video.vergleich.andere,
          satz: video.vergleich.satz,
        }
        : null,
    },
    // Es gibt genau EINEN Eintrag. Die Form bleibt eine Liste, damit das Lesen
    // dieselbe Bauart hat wie bei den Shorts und ein zweiter Eintrag eines
    // Tages das Schema nicht bricht (5.2). Der Name `uploads` ist derselbe wie
    // drueben -- und zwar absichtlich: schonHochgeladen() aus uploader.js
    // liest ihn, und das ist die geliehene Doppel-Upload-Abwehr.
    uploads: [],
  };
}

// Liest das Gedaechtnis, wenn es eines gibt. { fehler: [...] } oder
// { fehler: [], gedaechtnis, pfad } -- gedaechtnis ist null, wenn dieses
// Werkzeug fuer diese Aufnahme noch nichts hochgeladen hat.
//
// EIN FEHLER IST EIN ABBRUCH UND KEINE LEERE ANTWORT. Ein unlesbares
// Gedaechtnis saehe sonst aus wie "noch nichts hochgeladen", und das ist der
// teuerste Irrtum, den dieser Weg machen kann.
function leseGedaechtnis(projektwurzel, aufnahme) {
  const p = gedaechtnisPfad(projektwurzel, aufnahme);

  // ZUERST DAS VERZEICHNIS, DANN DIE DATEI. Umgekehrt kaeme eine umbenannte
  // Gedaechtnisdatei nie zur Sprache: die eine gesuchte fehlte, und der Lauf
  // hielte das fuer den Normalfall.
  const verzeichnis = leseGedaechtnisverzeichnis(gedaechtnisOrdner(projektwurzel));
  if (verzeichnis.fehler.length) return { fehler: verzeichnis.fehler, pfad: p };

  if (!fs.existsSync(p)) return { fehler: [], gedaechtnis: null, pfad: p };
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) {
    return { fehler: ['Das Gedaechtnis ist nicht lesbar (' + (e.code || e.message) +
      '): ' + p + '. Solange nicht feststeht, ob schon ein Video oben ist, wird keines ' +
      'hochgeladen.'], pfad: p };
  }
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return { fehler: ['Das Gedaechtnis ' + p + ' ist kein JSON: ' + e.message +
      '. Es wird nicht repariert und nicht ueberschrieben.'], pfad: p };
  }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return { fehler: ['Das Gedaechtnis ' + p + ' enthaelt kein Objekt.'], pfad: p };
  }
  const fehler = [];
  if (d.artifact_type !== GEDAECHTNIS_ARTIFACT_TYPE) {
    fehler.push('Gedaechtnis: artifact_type ist ' + JSON.stringify(d.artifact_type) +
      ', erwartet ist ' + JSON.stringify(GEDAECHTNIS_ARTIFACT_TYPE) + '. Das ist kein ' +
      'Longform-Gedaechtnis -- ein Shorts-Gedaechtnis wird hier nicht nach den Regeln ' +
      'dieses Weges gelesen.');
  }
  if (d.schema_version !== GEDAECHTNIS_SCHEMA_VERSION) {
    fehler.push('Gedaechtnis: schema_version ' + JSON.stringify(d.schema_version) +
      ' ist unbekannt; dieser Bau kennt ' + JSON.stringify(GEDAECHTNIS_SCHEMA_VERSION) + '.');
  }
  if (d.aufnahme !== aufnahme) {
    fehler.push('Gedaechtnis: es nennt die Aufnahme ' + JSON.stringify(d.aufnahme) +
      ', der Dateiname nennt ' + JSON.stringify(aufnahme) + '.');
  }
  if (d.video === null || typeof d.video !== 'object' ||
      typeof d.video.sha256 !== 'string' || !SHA256_FORM.test(d.video.sha256)) {
    fehler.push('Gedaechtnis: der Kopf traegt keine sha256 der Videodatei. Sie ist der ' +
      'Schluessel dieses Gedaechtnisses (Vertrag 5.1); ohne sie ist nicht zu sagen, ' +
      'welches Video gemeint ist.');
  }
  if (!Array.isArray(d.uploads)) {
    fehler.push('Gedaechtnis: uploads ist keine Liste.');
  } else {
    d.uploads.forEach((u, i) => {
      if (u === null || typeof u !== 'object') {
        fehler.push('Gedaechtnis: uploads[' + i + '] ist kein Objekt.');
        return;
      }
      if (typeof u.sha256 !== 'string' || !SHA256_FORM.test(u.sha256)) {
        fehler.push('Gedaechtnis: uploads[' + i + '] traegt keine sha256.');
      }
      if (typeof u.videoId !== 'string' || !u.videoId) {
        fehler.push('Gedaechtnis: uploads[' + i + '] traegt keine Kennung des Videos. ' +
          'Ein Eintrag ohne sie waere ein Upload, den niemand mehr findet.');
      }
      if (!STAENDE.includes(u.stand)) {
        fehler.push('Gedaechtnis: uploads[' + i + '] hat den Stand ' +
          JSON.stringify(u.stand) + '. Bekannt sind: ' + STAENDE.join(', ') + '.');
      }
    });
  }
  if (fehler.length) return { fehler, pfad: p };
  return { fehler: [], gedaechtnis: d, pfad: p };
}

// DIE DOPPEL-UPLOAD-ABWEHR, GELIEHEN UND NICHT NACHGEBAUT.
//
// uploader.schonHochgeladen sucht den Eintrag zur sha256. Es ist eine Zeile,
// und genau darum wird sie geliehen: eine zweite Zeile, die dasselbe tut, ist
// eine zweite Zeile, die es eines Tages anders tut -- und das eine Mal, an dem
// sie es anders tut, kostet ein zweites Video auf dem Kanal.
function schonHochgeladen(gedaechtnis, sha256) {
  return U.schonHochgeladen(gedaechtnis, sha256);
}

// Atomar, geliehen. Es gibt in diesem Modul KEINEN zweiten Schreibweg auf das
// Gedaechtnis; tests/ep-privat.test.cjs rechnet nach, dass jeder Schreibaufruf
// dieses Moduls durch diese eine Funktion geht.
function schreibeGedaechtnis(pfad, gedaechtnis, jetzt) {
  gedaechtnis.zuletzt_geschrieben_am = new Date(jetzt).toISOString();
  return U.schreibeGedaechtnisAtomar(pfad, gedaechtnis);
}

// ---------------------------------------------------------------------------
// TEIL 2 -- DIE ERSTE ERMAECHTIGUNG (Vertrag 2.12)
// ---------------------------------------------------------------------------
//
// WOFUER SIE STEHT. Bei den Shorts stand ein getipptes HOCHLADEN im Terminal;
// bei DR ist es an den Knopf der Freigabeseite gewandert. Hier gab es das
// getippte Wort nie -- der Weg hat keine Terminalfrage (2.12). Die
// Ermaechtigung ist damit der EINZIGE Beleg dafuer, dass ein Mensch gesehen
// hat, was gleich hochgeht.
//
// WORAN SIE HAENGT, UND WARUM AN GENAU DIESEN VIER DINGEN:
//
//   aufnahme         Eine Ermaechtigung fuer eine andere Aufnahme gilt hier
//                    nicht.
//   video_sha256     DER INHALT, NICHT DER PFAD. Neben <aufnahme>.matrix-cut.mp4
//                    liegen .partial- und .upload-Fassungen, und ein Render
//                    laesst sich wiederholen -- der Pfad bleibt derselbe, die
//                    Datei ist eine andere (5.1). Was der Mensch gesehen hat,
//                    ist die Datei, und die Datei ist ihr Inhalt.
//   bild             Dateiname UND sha256. Der Knopf trug den Dateinamen; die
//                    Pruefsumme sagt, dass es dieselben Bytes sind. Ein
//                    Compositor-Export unter demselben Namen ist ein anderes
//                    Bild, und ein anderes Bild als das beurteilte ist kein
//                    beurteiltes Bild.
//   zettel           Dateiname und Rang. Der Rang sagt, OB der Mensch einen
//                    Vorschlag oder eine Regel vor sich hatte (2.7); ein
//                    Vorschlag, der als Regel eingeloest wuerde, waere eine
//                    Zusage, die niemand gegeben hat.
//   kanal            Der Kanal, den der Knopf nannte, ist der Kanal, der es
//                    bekommt. Geprueft erst nach channels.list.
//
// UND AN EINEM ZWECK. Eine Ermaechtigung fuer den Upload gilt nie fuer das
// Oeffentlichstellen (2.12, 7). Der Zweck steht als eigenes Feld da und wird
// woertlich verglichen; alles ausser 'upload' wird abgelehnt.
//
// EU: DIE ZWEI ANDEREN ZWECKE STEHEN JETZT AUCH HIER. Bis EU stand an dieser
// Stelle der Satz, der Name des zweiten Zwecks stehe "ABSICHTLICH NICHT" da,
// weil er zu einem Aufruf gehoere, den es noch nicht gibt. Den Aufruf gibt es
// jetzt; der Satz wird darum BERICHTIGT statt weiter behauptet.

const ERMAECHTIGUNG_ARTIFACT_TYPE = 'adw_longform_ermaechtigung';
const ERMAECHTIGUNG_SCHEMA_VERSION = '1.0';

const ZWECK_UPLOAD = 'upload';

// ---------------------------------------------------------------------------
// EU: DIE ZWECKE DES DRITTEN AUFRUFS -- ZWEI, UND WARUM ZWEI
// ---------------------------------------------------------------------------
//
// `veroeffentlichen` loest Aufruf 3 aus. `veroeffentlichen_haltepunkt` loest
// ihn NICHT aus: derselbe Lauf, bis unmittelbar davor, und dort Schluss.
//
// WARUM DER HALTEPUNKT EIN ZWECK IST UND KEIN ARGUMENT. Der Auftrag verlangt
// einen Weg, den ersten echten Durchgang bis vor den letzten Aufruf zu fuehren
// und dort stehenzubleiben -- und er verlangt ausdruecklich, dass es "kein
// Argument sein darf, das angenommen wird und nichts bewirkt". Ein Schalter
// `--halt` waere genau das gewesen, und schlimmer: er waere ein Schalter, den
// man VERGESSEN kann. Wer ihn vergisst, veroeffentlicht.
//
// Als Zweck ist es umgekehrt. Eine Haltepunkt-Ermaechtigung kann auf KEINEM
// Weg zum dritten Aufruf fuehren -- nicht mit einem anderen Argument,
// nicht durch einen Aufruf von Hand, nicht durch einen Fehler im Arbeiter, der
// eine Verzweigung falsch nimmt: der Vergleich unten ist woertlich, und der
// Zweig, der den Aufruf macht, nimmt nur `veroeffentlichen` an. Was der Mensch
// geklickt hat, steht in der Datei und nicht in der Kommandozeile.
//
// UND ES IST DERSELBE MECHANISMUS, kein zweiter. Beide gehen durch dieselbe
// Pruefung, dieselbe Verbrauchsliste, denselben Ordner, dasselbe Zeitfenster.
// Der Haltepunkt VERBRAUCHT seine Ermaechtigung; er ist ein Lauf und keine
// Vorschau, und was er verbraucht hat, liegt danach nicht mehr herum.
const ZWECK_VEROEFFENTLICHEN = 'veroeffentlichen';
const ZWECK_HALTEPUNKT = 'veroeffentlichen_haltepunkt';
const ZWECKE_DRITTER_AUFRUF = Object.freeze([ZWECK_VEROEFFENTLICHEN, ZWECK_HALTEPUNKT]);

// Alle Zwecke, die dieses Projekt kennt. Die Liste steht da, damit "unbekannter
// Zweck" und "bekannter Zweck am falschen Ort" zwei Meldungen bekommen: das
// eine ist eine fremde Datei, das andere ein Griff daneben.
const ZWECKE = Object.freeze([ZWECK_UPLOAD].concat(ZWECKE_DRITTER_AUFRUF));

// DIE RAENGE, DIE EINE ERMAECHTIGUNG TRAGEN KANN (2.7, 2.12).
//
// Rang 3 STEHT HIER NICHT, und das ist kein Versehen. Vertrag 2.12 nennt als
// moegliche Bindung "Zettel-Dateiname und Rang, oder 'Rueckfall Rang 3'". Ein
// Rang-3-Lauf hat aber keinen Zettel, und ohne Zettel gibt es keinen Titel
// (2.8) -- Vertrag 4 Schritt 5 bricht dort ab, bevor irgendein Knopf
// erscheint. Die Form "Rueckfall Rang 3" laesst sich heute also nicht
// ausstellen und nicht einloesen. Sie trotzdem zu bauen hiesse, einen Zweig
// zu schreiben, der nie laeuft -- genau das, was EK an seinem eigenen
// Nachbau gefunden hat ("er stand da, sah nach Sorgfalt aus und ist nie
// gelaufen"). Statt des toten Zweigs steht hier eine SPERRE mit eigener
// Meldung: kommt eine Ermaechtigung mit Rang 3, wird sie abgelehnt und der
// Grund genannt. Wird Rang 3 eines Tages ein Weg, ist das die Stelle.
const ERLAUBTE_RAENGE = Object.freeze([1, '2a', '2b']);

// Die Form eines Zeitstempels, geliehen aus dem Planer -- es gibt sie im
// Projekt einmal.
const ISO_UTC = P.ISO_UTC;

// Zwei Minuten, eine Sekunde Uhrenspielraum, 64 Hexziffern: alle drei aus dem
// Uploader. Sie stehen hier als Namen und nicht als Zahlen, damit eine
// Aenderung dort auch hier gilt.
const ERMAECHTIGUNG_GUELTIG_MS = U.ERMAECHTIGUNG_GUELTIG_MS;
const ERMAECHTIGUNG_ZUKUNFT_MS = U.ERMAECHTIGUNG_ZUKUNFT_MS;
const ZUFALL_FORM = U.ZUFALL_FORM;

// Der Ordner und der Pfad kommen aus dem Uploader: EIN Ordner fuer beide
// Sorten Ermaechtigung, ein Dateiname, der aus dem Zufallswert und aus nichts
// sonst entsteht.
function ermaechtigungOrdner(projektwurzel) {
  return U.ermaechtigungOrdner(projektwurzel);
}
function ermaechtigungPfad(projektwurzel, zufall) {
  return U.ermaechtigungPfad(projektwurzel, zufall);
}
function neuerZufall() {
  return U.neuerZufall();
}

// Die FORM der Ermaechtigung steht hier -- bei dem, der sie PRUEFT, und nicht
// bei dem, der sie schreibt. freigabe-server.js ruft diese Funktion auf, statt
// die Felder ein zweites Mal hinzuschreiben: zwei Fassungen einer Form sind
// auf Dauer eineinhalb, und die zweite waere ausgerechnet die, die den
// scharfen Lauf ausloest. Derselbe Grund wie bei uploader.neueErmaechtigung.
function neueErmaechtigung({
  aufnahme, videoSha256, bildDateiname, bildSha256, zettelDateiname, rang,
  kanalId, kanalName, zufall, jetzt,
}) {
  return {
    artifact_type: ERMAECHTIGUNG_ARTIFACT_TYPE,
    schema_version: ERMAECHTIGUNG_SCHEMA_VERSION,
    // Der Zweck steht VOR allem anderen im Objekt, weil er die Frage
    // beantwortet, die man zuerst stellt, wenn man diese Datei findet.
    zweck: ZWECK_UPLOAD,
    aufnahme,
    video_sha256: videoSha256,
    bild: { dateiname: bildDateiname, sha256: bildSha256 },
    zettel: { dateiname: zettelDateiname, rang },
    kanal_id: kanalId,
    kanal_name: kanalName,
    erstellt_am: new Date(jetzt).toISOString(),
    zufall,
    warum:
      'Diese Datei ermaechtigt zu GENAU EINEM Lauf: ein Video privat hochladen, auf die ' +
      'Verarbeitung warten, das Thumbnail setzen, zuruecklesen. Sie ermaechtigt NICHT ' +
      'zum Oeffentlichstellen -- dafuer gibt es eine zweite mit einem anderen Zweck ' +
      '(Vertrag 2.12). Geschrieben wurde sie beim Klick auf "Hochladen" in der ' +
      'Freigabeoberflaeche, nachdem ein Mensch die Vorschau, das Bild und den Ausgang ' +
      'des Trockenlaufs gesehen hat. Sie gilt zwei Minuten, nur fuer diese Aufnahme, nur ' +
      'fuer die Videodatei mit dieser sha256, nur fuer dieses Bild, nur fuer diesen ' +
      'Kanal und nur einmal. Der Arbeiter prueft jedes dieser Felder gegen das, was er ' +
      'selbst vorfindet, verbraucht die Datei und loescht sie.',
  };
}

// ALLE LOKALEN PRUEFUNGEN, JEDE MIT EIGENEM CODE UND EIGENER MELDUNG.
//
// KEINE ZWEI TEILEN SICH EINE MELDUNG. Das ist keine Kosmetik: die Meldung ist
// das Einzige, woran ein Mensch erkennt, WELCHE der Bindungen nicht getragen
// hat -- ob die Videodatei eine andere ist oder das Bild, ob die Zeit abgelaufen
// ist oder die Ermaechtigung schon verbraucht. Zwei Lagen unter einem Satz sind
// der Umriss jedes Fehlers dieser Reihe. tests/ep-privat.test.cjs haelt alle
// Meldungen paarweise gegeneinander.
//
// Der Kanal fehlt hier absichtlich: den kennt erst channels.list, und alles
// andere soll ohne einen einzigen Netzaufruf entscheidbar sein.
//
// Gibt { ok: true, daten } oder { ok: false, code, meldung }.
function pruefeErmaechtigung({
  projektwurzel, pfad, aufnahme, videoSha256, bild, zettel, jetzt,
}) {
  const nein = (code, meldung) => ({ ok: false, code, meldung });

  // 0. WO SIE LIEGEN DARF. Diese Datei wird gleich GELOESCHT; ein Pfad, den
  //    jemand frei waehlen kann, waere damit ein Loeschbefehl mit
  //    Argumentangabe. Dieselbe Sperre wie im Uploader.
  const ordner = ermaechtigungOrdner(projektwurzel);
  if (typeof pfad !== 'string' || !pfad.trim()) {
    return nein('ermaechtigung_pfad_leer',
      '--bestaetigt-durch= ist leer. Ohne Pfad gibt es keine Ermaechtigung, und ohne ' +
      'Ermaechtigung laeuft dieser Arbeiter trocken.');
  }
  if (!pfadLiegtUnter(ordner, pfad)) {
    return nein('ermaechtigung_pfad_fremd',
      'Die Ermaechtigung liegt nicht unter ' + ordner + ', sondern bei ' + pfad + '. ' +
      'Der Arbeiter loescht diese Datei nach der Pruefung -- ein frei gewaehlter Pfad ' +
      'waere damit ein Loeschbefehl. Es wird nichts gelesen und nichts geloescht.');
  }

  // 1. DA?
  let text;
  try {
    text = fs.readFileSync(pfad, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return nein('ermaechtigung_fehlt',
        'Es gibt keine Ermaechtigung unter ' + pfad + '. Ohne sie wird nichts hochgeladen. ' +
        'Wurde sie schon verbraucht, ist sie geloescht -- dann in der Longform-Ansicht ' +
        'erneut auf "Hochladen" klicken, und ein Mensch sieht wieder, was hochginge.');
    }
    return nein('ermaechtigung_nicht_lesbar',
      'Die Ermaechtigung ist nicht lesbar (' + (e.code || e.message) + '): ' + pfad);
  }

  let d;
  try { d = JSON.parse(text); } catch (e) {
    return nein('ermaechtigung_kein_json',
      'Die Ermaechtigung ist kein JSON (' + e.message + '): ' + pfad);
  }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return nein('ermaechtigung_kein_objekt',
      'Die Ermaechtigung enthaelt kein Objekt: ' + pfad);
  }
  if (d.artifact_type !== ERMAECHTIGUNG_ARTIFACT_TYPE) {
    return nein('ermaechtigung_fremder_typ',
      'artifact_type ist ' + JSON.stringify(d.artifact_type) + ', erwartet ist ' +
      JSON.stringify(ERMAECHTIGUNG_ARTIFACT_TYPE) + '. Das ist keine Ermaechtigung ' +
      'dieses Weges -- eine Shorts-Ermaechtigung gilt hier nicht, und umgekehrt.');
  }
  if (d.schema_version !== ERMAECHTIGUNG_SCHEMA_VERSION) {
    return nein('ermaechtigung_fremde_version',
      'schema_version ist ' + JSON.stringify(d.schema_version) + ', dieser Arbeiter kennt ' +
      JSON.stringify(ERMAECHTIGUNG_SCHEMA_VERSION) + '. Eine fremde Fassung wird nicht ' +
      'nach den Regeln der bekannten gelesen.');
  }

  // 2. DER ZWECK. Vertrag 7: "Eine Ermaechtigung mit dem falschen Zweck wird
  //    abgelehnt." Sie steht VOR dem Zufallswert, damit eine Ermaechtigung
  //    fuer den falschen Zweck nicht nebenbei verbraucht wird: abgelehnt heisst
  //    hier auch, dass sie liegen bleibt und weiterhin fuer ihren eigenen
  //    Zweck taugt.
  if (d.zweck !== ZWECK_UPLOAD) {
    return nein('ermaechtigung_fremder_zweck',
      'Die Ermaechtigung nennt den Zweck ' + JSON.stringify(d.zweck) + '. Dieser Aufruf ' +
      'loest ausschliesslich den Zweck ' + JSON.stringify(ZWECK_UPLOAD) + ' ein -- ' +
      'privat hochladen, warten, Thumbnail setzen, zuruecklesen. Eine Ermaechtigung fuer ' +
      'das Oeffentlichstellen gilt hier nicht (Vertrag 2.12, 7); sie wird weder ' +
      'verbraucht noch geloescht.');
  }

  // 3. DER ZUFALLSWERT -- erst die Form, dann die Verbrauchsliste.
  if (typeof d.zufall !== 'string' || !ZUFALL_FORM.test(d.zufall)) {
    return nein('ermaechtigung_zufall_form',
      'Der Zufallswert ist ' + JSON.stringify(d.zufall) + ' und keine 64 Hexziffern. ' +
      'Ohne ihn laesst sich nicht sagen, ob diese Ermaechtigung schon einmal verbraucht ' +
      'wurde.');
  }
  const verbraucht = U.leseVerbrauchte(projektwurzel);
  if (verbraucht.fehler) {
    return nein('verbrauchsliste_unlesbar', verbraucht.fehler +
      ' Solange nicht feststeht, welche Ermaechtigungen schon verbraucht sind, wird keine ' +
      'angenommen.');
  }
  const schon = verbraucht.liste.find((v) => v && v.zufall === d.zufall);
  if (schon) {
    return nein('ermaechtigung_verbraucht',
      'Diese Ermaechtigung wurde schon verbraucht' +
      (schon.verbraucht_am ? ' (am ' + schon.verbraucht_am + ')' : '') +
      '. Sie gilt fuer GENAU EINEN Lauf. Wer denselben Schritt noch einmal gehen will, ' +
      'klickt in der Longform-Ansicht erneut -- dann sieht auch wieder ein Mensch, was ' +
      'geschieht.');
  }

  // 4. DER AUGENBLICK.
  if (typeof d.erstellt_am !== 'string' || !ISO_UTC.test(d.erstellt_am) ||
      !Number.isFinite(Date.parse(d.erstellt_am))) {
    return nein('ermaechtigung_zeit_form',
      'erstellt_am ist ' + JSON.stringify(d.erstellt_am) + ' und kein Zeitstempel in UTC ' +
      '(RFC 3339 mit Z).');
  }
  const alter = jetzt - Date.parse(d.erstellt_am);
  if (alter < -ERMAECHTIGUNG_ZUKUNFT_MS) {
    return nein('ermaechtigung_zukunft',
      'Die Ermaechtigung ist auf ' + d.erstellt_am + ' datiert und liegt damit ' +
      Math.round(-alter / 1000) + ' Sekunden in der ZUKUNFT (jetzt ist ' +
      new Date(jetzt).toISOString() + '). Dienst und Arbeiter laufen an derselben Uhr; ' +
      'eine Ermaechtigung, die noch nicht begonnen hat, bezeugt keinen Augenblick.');
  }
  if (alter > ERMAECHTIGUNG_GUELTIG_MS) {
    return nein('ermaechtigung_abgelaufen',
      'Die Ermaechtigung ist ' + Math.round(alter / 1000) + ' Sekunden alt, gueltig sind ' +
      (ERMAECHTIGUNG_GUELTIG_MS / 1000) + '. Erstellt am ' + d.erstellt_am + ', jetzt ist ' +
      new Date(jetzt).toISOString() + '. Sie soll den Augenblick des Klicks bezeugen und ' +
      'nicht den Nachmittag -- in der Longform-Ansicht neu klicken.');
  }

  // 5. DIE AUFNAHME.
  if (d.aufnahme !== aufnahme) {
    return nein('ermaechtigung_fremde_aufnahme',
      'Die Ermaechtigung gilt fuer die Aufnahme ' + JSON.stringify(d.aufnahme) +
      ', hochgeladen werden soll ' + JSON.stringify(aufnahme) + '. Eine Ermaechtigung ' +
      'fuer eine andere Aufnahme gilt hier nicht.');
  }

  // 6. DIE VIDEODATEI -- DIE BINDUNG, UM DIE ES GEHT.
  //
  // Vertrag 5.1: der Pfad bleibt derselbe, wenn ein Render wiederholt wird;
  // die Datei ist dann eine andere. Was ein Mensch beurteilt hat, ist der
  // Inhalt.
  if (typeof d.video_sha256 !== 'string' || !SHA256_FORM.test(d.video_sha256)) {
    return nein('ermaechtigung_video_sha_form',
      'video_sha256 ist ' + JSON.stringify(d.video_sha256) + ' und keine sha256-Summe. ' +
      'Ohne sie ist nicht zu sagen, welche Datei beurteilt wurde.');
  }
  if (d.video_sha256 !== videoSha256) {
    return nein('ermaechtigung_video_sha',
      'Die Ermaechtigung gehoert zu einer Videodatei mit der Pruefsumme ' + d.video_sha256 +
      ', auf der Platte liegt jetzt ' + videoSha256 + '. Die Datei unter demselben Namen ' +
      'ist eine ANDERE geworden -- ein wiederholter Render hat denselben Pfad und einen ' +
      'anderen Inhalt (Vertrag 5.1). Was ein Mensch gesehen hat, ist nicht das, was ' +
      'hochginge: es wird nichts hochgeladen. In der Longform-Ansicht neu ansehen.');
  }

  // 7. DAS BILD -- Dateiname UND Pruefsumme, und beide mit eigener Meldung.
  if (d.bild === null || typeof d.bild !== 'object' || Array.isArray(d.bild) ||
      typeof d.bild.dateiname !== 'string' || d.bild.dateiname === '' ||
      typeof d.bild.sha256 !== 'string' || !SHA256_FORM.test(d.bild.sha256)) {
    return nein('ermaechtigung_bild_form',
      'Das Feld bild ist ' + JSON.stringify(d.bild) + ' und traegt nicht Dateiname und ' +
      'sha256. Der Knopf trug den Dateinamen des Bildes; ohne beide Angaben ist nicht zu ' +
      'sagen, welches Bild beurteilt wurde.');
  }
  if (d.bild.dateiname !== bild.dateiname) {
    return nein('ermaechtigung_bild_name',
      'Die Ermaechtigung nennt das Bild ' + JSON.stringify(d.bild.dateiname) +
      ', dieser Lauf hat ' + JSON.stringify(bild.dateiname) + ' bestimmt. Auf dem Knopf ' +
      'stand ein anderer Dateiname als der, der jetzt ans Video ginge -- es wird nichts ' +
      'hochgeladen.');
  }
  if (d.bild.sha256 !== bild.sha256) {
    return nein('ermaechtigung_bild_sha',
      'Das Bild ' + bild.dateiname + ' traegt jetzt die Pruefsumme ' + bild.sha256 +
      ', die Ermaechtigung nennt ' + d.bild.sha256 + '. Der Dateiname stimmt, die Bytes ' +
      'nicht: der Compositor hat unter demselben Namen neu exportiert. Ein anderes Bild ' +
      'als das beurteilte ist kein beurteiltes Bild -- es wird nichts hochgeladen.');
  }

  // 8. DER ZETTEL UND SEIN RANG. Der Rang sagt, ob der Mensch eine Regel oder
  //    einen Vorschlag vor sich hatte (2.7).
  if (d.zettel === null || typeof d.zettel !== 'object' || Array.isArray(d.zettel)) {
    return nein('ermaechtigung_zettel_form',
      'Das Feld zettel ist ' + JSON.stringify(d.zettel) + ' und traegt nicht Dateiname ' +
      'und Rang. Ohne den Rang ist nicht zu sagen, ob das Bild eine Regel war oder ein ' +
      'Vorschlag.');
  }
  if (!ERLAUBTE_RAENGE.includes(d.zettel.rang)) {
    // Rang 3 bekommt seine EIGENE Meldung. "Unbekannter Rang" waere hier die
    // falsche Auskunft: 3 ist ein bekannter Rang des Vertrags, er ist nur
    // kein Weg, der bis zu einer Ermaechtigung fuehrt.
    if (d.zettel.rang === 3 || d.zettel.rang === '3') {
      return nein('ermaechtigung_rang3',
        'Die Ermaechtigung nennt Rang 3 -- ein Bild ohne Beipackzettel. Diesen Weg gibt ' +
        'es nicht: ohne Zettel gibt es keinen Titel (Vertrag 2.8), und der Lauf bricht ' +
        'schon vor jedem Knopf ab (4, Schritt 5). Es wird nichts hochgeladen. Der Weg zu ' +
        'einem Zettel fuehrt ueber den Compositor: neu exportieren, dann liegt einer ' +
        'daneben.');
    }
    return nein('ermaechtigung_zettel_rang_form',
      'Die Ermaechtigung nennt den Rang ' + JSON.stringify(d.zettel.rang) +
      '. Einloesbar sind ' + ERLAUBTE_RAENGE.map((r) => JSON.stringify(r)).join(', ') + '.');
  }
  if (d.zettel.dateiname !== zettel.dateiname) {
    return nein('ermaechtigung_zettel_name',
      'Die Ermaechtigung nennt den Beipackzettel ' + JSON.stringify(d.zettel.dateiname) +
      ', dieser Lauf hat ' + JSON.stringify(zettel.dateiname) + ' genommen. Aus dem ' +
      'Zettel kommt der Titel (Vertrag 2.8) -- ein anderer Zettel ist ein anderer Titel, ' +
      'und es wird nichts hochgeladen.');
  }
  if (d.zettel.rang !== zettel.rang) {
    return nein('ermaechtigung_zettel_rang',
      'Die Ermaechtigung nennt Rang ' + JSON.stringify(d.zettel.rang) + ', dieser Lauf ' +
      'steht bei Rang ' + JSON.stringify(zettel.rang) + '. Der Rang sagt, ob das Bild ' +
      'ohne Rueckfrage genommen wird (Rang 1) oder ein Vorschlag ist (Rang 2) -- die ' +
      'beiden sind nicht dasselbe Urteil. Es wird nichts hochgeladen.');
  }

  // 9. DER KANAL -- die FORM jetzt, der Vergleich spaeter (U.pruefeKanal).
  if (typeof d.kanal_id !== 'string' || !d.kanal_id.trim()) {
    return nein('ermaechtigung_kanal_form',
      'kanal_id fehlt in der Ermaechtigung. Der Knopf hat einen Kanal genannt; ohne diese ' +
      'Angabe laesst sich nicht pruefen, ob es derselbe ist, der das Video bekommt.');
  }

  return { ok: true, daten: d };
}

// ---------------------------------------------------------------------------
// TEIL 3 -- DIE ZWEITE ERMAECHTIGUNG (Vertrag 2.12, EU)
// ---------------------------------------------------------------------------
//
// WOFUER SIE STEHT, UND WARUM SIE NICHT DIE ERSTE IST.
//
// Die erste bezeugt: ein Mensch hat gesehen, WAS hochginge. Sie ist
// zuruecknehmbar in dem einen Sinn, der zaehlt -- ein privates Video laesst
// sich im Studio loeschen, und niemand hat es gesehen.
//
// Die zweite bezeugt: ein Mensch hat gesehen, was auf dem Kanal LIEGT -- den
// Titel, wie YouTube ihn fuehrt, das Bild, das wirklich daran haengt, und
// jeden Befund, den YouTube dazu gemeldet hat -- und will, dass es oeffentlich
// wird. Was danach oeffentlich war, hat jemand gesehen; das nimmt niemand
// zurueck. Die beiden liegen bis zu 45 Minuten auseinander, und zwischen ihnen
// liegt das, was die zweite ueberhaupt erst moeglich macht (2.12).
//
// WORAN SIE HAENGT. Vertrag 2.12 nennt vier Bindungen: Aufnahme, sha256 der
// Videodatei, videoId aus dem Gedaechtnis, Kanal. Dieser Bau traegt eine
// FUENFTE, und das ist eine Abweichung vom Wortlaut der Tabelle, die im
// Bericht steht: das URTEIL. Es ist die Antwort auf den Satz des Auftrags,
// die Ermaechtigung sei "an genau das gebunden, was der Mensch gesehen hat".
//
//   urteil.titel                 der Titel, WIE YOUTUBE IHN BEIM ZURUECKLESEN
//                                GENANNT HAT -- nicht der gesendete. Der
//                                Vergleich laeuft spaeter gegen dieselbe
//                                Quelle: YouTube damals gegen YouTube jetzt.
//                                Gegen den gesendeten zu vergleichen hiesse,
//                                jede Normalisierung der API als Aenderung zu
//                                lesen, und der Weg liefe nie.
//   urteil.beschreibung_sha256   die Pruefsumme der Beschreibung, ebenfalls
//                                wie zurueckgelesen. Der TEXT steht weder hier
//                                noch im Gedaechtnis (5.2 verbietet ihn dort
//                                ausdruecklich); eine Pruefsumme ist kein
//                                Wortlaut.
//   urteil.thumbnail             Dateiname und sha256 der Bilddatei von der
//                                Platte, die geheftet wurde. Sie wird
//                                unmittelbar vor dem dritten Aufruf noch
//                                einmal gegen die Platte gehalten: der
//                                Compositor kann in der Zwischenzeit unter
//                                demselben Namen neu exportiert haben, und
//                                dann ist der Beleg dafuer, WAS am Video
//                                haengt, weg.
//
// DIE ABWEICHUNG IST IN DIE ENGE RICHTUNG. Sie erlaubt nichts, was 2.12
// verbietet; sie verweigert zusaetzlich. Eine Ermaechtigung, die eine dieser
// Bindungen nicht traegt, wird abgelehnt -- der Weg wird dadurch nur
// schwerer, nie leichter.
//
// WAS SIE NICHT TRAEGT: das Bild als Bytes, den Statusblock, die
// Thumbnail-URLs von YouTube. Die URLs nicht, weil sie sich aendern koennen,
// ohne dass sich das Bild aendert (DX hat 25 Minuten Nachhinken gemessen) --
// eine Bindung, die von selbst bricht, ist keine Bindung, sondern ein Alarm,
// den man abstellt.

function neueZweiteErmaechtigung({
  aufnahme, videoSha256, videoId, urteil, kanalId, kanalName, zweck, zufall, jetzt,
}) {
  if (!ZWECKE_DRITTER_AUFRUF.includes(zweck)) {
    throw new Error('neueZweiteErmaechtigung: der Zweck ist ' + JSON.stringify(zweck) +
      '. Zulaessig sind ' + ZWECKE_DRITTER_AUFRUF.map((z) => JSON.stringify(z)).join(' und ') +
      '. Es wird keine Ermaechtigung mit einem Zweck geschrieben, den niemand einloest.');
  }
  const haltepunkt = zweck === ZWECK_HALTEPUNKT;
  return {
    artifact_type: ERMAECHTIGUNG_ARTIFACT_TYPE,
    schema_version: ERMAECHTIGUNG_SCHEMA_VERSION,
    zweck,
    aufnahme,
    video_sha256: videoSha256,
    videoId,
    urteil: {
      titel: urteil.titel,
      beschreibung_sha256: urteil.beschreibung_sha256 === undefined
        ? null : urteil.beschreibung_sha256,
      thumbnail: { dateiname: urteil.thumbnail.dateiname, sha256: urteil.thumbnail.sha256 },
    },
    kanal_id: kanalId,
    kanal_name: kanalName,
    erstellt_am: new Date(jetzt).toISOString(),
    zufall,
    warum: haltepunkt
      ? 'Diese Datei ermaechtigt zu GENAU EINEM Lauf, und der stellt NICHTS oeffentlich. Er ' +
        'geht den ganzen Weg des dritten Aufrufs -- anmelden, Kanal pruefen, das Video ' +
        'zuruecklesen, den Statusblock holen, den Anfragekoerper bauen -- und haelt ' +
        'unmittelbar VOR dem Absenden an. Was gesendet WUERDE, steht danach Feld fuer Feld ' +
        'auf dem Schirm und im Gedaechtnis. Den dritten Aufruf macht dieser Lauf nicht, auf ' +
        'keinem Weg und mit keinem Argument: der Zweig, der ihn macht, nimmt diesen Zweck ' +
        'nicht an. Zum wirklichen Oeffentlichstellen braucht es einen zweiten Klick und ' +
        'eine Ermaechtigung mit dem Zweck "' + ZWECK_VEROEFFENTLICHEN + '".'
      : 'Diese Datei ermaechtigt zu GENAU EINEM Lauf: ein Video, das privat auf dem Kanal ' +
        'liegt, OEFFENTLICH stellen. Das laesst sich nicht zuruecknehmen -- was oeffentlich ' +
        'war, hat jemand gesehen, und die Abonnenten sind beim Upload benachrichtigt worden ' +
        '(Vertrag 2.14). Geschrieben wurde sie beim Klick auf "Veroeffentlichen" in der ' +
        'Freigabeoberflaeche, nachdem ein Mensch den Titel, die Beschreibung, das Bild am ' +
        'Video und jeden Befund von YouTube gesehen hat. Sie gilt zwei Minuten, nur fuer ' +
        'diese Aufnahme, nur fuer die Videodatei mit dieser sha256, nur fuer dieses eine ' +
        'Video auf dem Kanal, nur fuer diesen Kanal und nur einmal. Sie ermaechtigt NICHT ' +
        'zu einem Upload; dafuer gibt es eine erste mit dem Zweck "' + ZWECK_UPLOAD + '". ' +
        'Der Arbeiter prueft jedes Feld gegen das, was er selbst vorfindet, verbraucht die ' +
        'Datei und loescht sie. Er aendert am Video NUR die Sichtbarkeit: kein Titel, keine ' +
        'Beschreibung, keine Tags, kein Termin (Vertrag 2.5, 7).',
  };
}

// DER ZWECK, NACHGESEHEN -- UND SONST NICHTS.
//
// WOFUER SIE DA IST: der Arbeiter bekommt EINEN Pfad und muss wissen, welchen
// der beiden Wege er geht. Er kann das nicht raten, und er darf es nicht aus
// einem Argument nehmen (dann waere der Zweck ein Argument). Also sieht er in
// der Datei nach.
//
// SIE PRUEFT NICHTS UND VERBRAUCHT NICHTS. Jede Pruefung -- Typ, Fassung,
// Zeit, Verbrauch, Bindung -- macht danach die Funktion des gewaehlten Weges,
// vollstaendig und in ihrer eigenen Reihenfolge. Diese hier entscheidet nur,
// WELCHE das ist. Findet sie nichts Brauchbares, gibt sie null zurueck; der
// Arbeiter geht dann den Upload-Weg, und dessen Pruefung sagt mit ihrer
// eigenen Meldung, was mit der Datei nicht stimmt. So entsteht keine zweite
// Fehlermeldung fuer denselben Mangel.
//
// DIE PFADSPERRE GILT AUCH HIER. Sie liest eine Datei; ein frei gewaehlter
// Pfad waere ein Leseweg mit Argumentangabe.
function liesZweck(projektwurzel, pfad) {
  if (typeof pfad !== 'string' || !pfad.trim()) return null;
  if (!pfadLiegtUnter(ermaechtigungOrdner(projektwurzel), pfad)) return null;
  let text;
  try { text = fs.readFileSync(pfad, 'utf8'); } catch (e) { return null; }
  let d;
  try { d = JSON.parse(text); } catch (e) { return null; }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return null;
  return typeof d.zweck === 'string' ? d.zweck : null;
}

// ALLE LOKALEN PRUEFUNGEN DER ZWEITEN ERMAECHTIGUNG.
//
// DIESELBE REIHENFOLGE WIE OBEN, und das ist keine Kosmetik: wer die beiden
// nebeneinanderlegt, soll sehen, wo sie gleich sind und wo nicht. Gleich sind
// Pfadsperre, Typ, Fassung, Zweck, Zufallswert, Verbrauchsliste, Zeitfenster,
// Aufnahme, Videodatei, Kanalform. Verschieden ist, was danach kommt: dort
// stehen videoId und Urteil statt Bild und Zettel.
//
// KEINE ZWEI TEILEN SICH EINE MELDUNG, und keine teilt sich eine mit denen der
// ersten Ermaechtigung. Jede sagt AUCH, welche Bindung nicht getragen hat und
// was das heisst -- ein "die Ermaechtigung passt nicht" laesst einen Menschen
// vor einem oeffentlichen oder eben nicht oeffentlichen Video stehen, ohne zu
// wissen, warum.
//
// `videoId` und `urteil` kommen aus dem GEDAECHTNIS dieses Laufs und nicht aus
// einem Argument (2.5 Punkt 2). Der Titelvergleich gegen YOUTUBE steht nicht
// hier, sondern beim Arbeiter: er braucht einen Netzaufruf, und alles hier
// soll ohne einen einzigen entscheidbar sein.
//
// Gibt { ok: true, daten } oder { ok: false, code, meldung }.
function pruefeZweiteErmaechtigung({
  projektwurzel, pfad, aufnahme, videoSha256, videoId, urteil, jetzt,
}) {
  const nein = (code, meldung) => ({ ok: false, code, meldung });

  // 0. WO SIE LIEGEN DARF.
  const ordner = ermaechtigungOrdner(projektwurzel);
  if (typeof pfad !== 'string' || !pfad.trim()) {
    return nein('zweite_pfad_leer',
      '--bestaetigt-durch= ist leer. Ohne Pfad gibt es keine zweite Ermaechtigung, und ohne ' +
      'sie wird nichts oeffentlich gestellt.');
  }
  if (!pfadLiegtUnter(ordner, pfad)) {
    return nein('zweite_pfad_fremd',
      'Die zweite Ermaechtigung liegt nicht unter ' + ordner + ', sondern bei ' + pfad +
      '. Der Arbeiter loescht diese Datei nach der Pruefung -- ein frei gewaehlter Pfad ' +
      'waere damit ein Loeschbefehl. Es wird nichts gelesen, nichts geloescht und nichts ' +
      'oeffentlich gestellt.');
  }

  // 1. DA?
  let text;
  try {
    text = fs.readFileSync(pfad, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return nein('zweite_fehlt',
        'Es gibt keine zweite Ermaechtigung unter ' + pfad + '. Ohne sie wird nichts ' +
        'oeffentlich gestellt. Wurde sie schon verbraucht, ist sie geloescht -- dann in der ' +
        'Longform-Ansicht erneut klicken, und ein Mensch sieht wieder, was am Video haengt.');
    }
    return nein('zweite_nicht_lesbar',
      'Die zweite Ermaechtigung ist nicht lesbar (' + (e.code || e.message) + '): ' + pfad +
      '. Solange nicht feststeht, wozu sie ermaechtigt, wird nichts oeffentlich gestellt.');
  }
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return nein('zweite_kein_json',
      'Die zweite Ermaechtigung ist kein JSON (' + e.message + '): ' + pfad);
  }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return nein('zweite_kein_objekt',
      'Die zweite Ermaechtigung enthaelt kein Objekt: ' + pfad);
  }
  if (d.artifact_type !== ERMAECHTIGUNG_ARTIFACT_TYPE) {
    return nein('zweite_fremder_typ',
      'artifact_type ist ' + JSON.stringify(d.artifact_type) + ', erwartet ist ' +
      JSON.stringify(ERMAECHTIGUNG_ARTIFACT_TYPE) + '. Das ist keine Ermaechtigung dieses ' +
      'Weges; sie wird nicht eingeloest und nicht verbraucht.');
  }
  if (d.schema_version !== ERMAECHTIGUNG_SCHEMA_VERSION) {
    return nein('zweite_fremde_version',
      'schema_version ist ' + JSON.stringify(d.schema_version) + ', dieser Arbeiter kennt ' +
      JSON.stringify(ERMAECHTIGUNG_SCHEMA_VERSION) + '. Eine fremde Fassung wird nicht nach ' +
      'den Regeln der bekannten gelesen -- schon gar nicht vor einem Aufruf, den niemand ' +
      'zurueckdreht.');
  }

  // 2. DER ZWECK. VOR dem Zufallswert, damit eine Ermaechtigung fuer den
  //    falschen Zweck nicht nebenbei verbraucht wird und fuer ihren eigenen
  //    Zweck weiter taugt.
  if (!ZWECKE_DRITTER_AUFRUF.includes(d.zweck)) {
    return nein('zweite_fremder_zweck',
      'Die Ermaechtigung nennt den Zweck ' + JSON.stringify(d.zweck) + '. Dieser Weg loest ' +
      'ausschliesslich ' + ZWECKE_DRITTER_AUFRUF.map((z) => JSON.stringify(z)).join(' und ') +
      ' ein. Eine Ermaechtigung fuer den Upload gilt hier NICHT (Vertrag 2.12, 7) -- die ' +
      'erste ersetzt die zweite nicht, und sie wird weder verbraucht noch geloescht.');
  }

  // 3. DER ZUFALLSWERT -- erst die Form, dann die Verbrauchsliste.
  if (typeof d.zufall !== 'string' || !ZUFALL_FORM.test(d.zufall)) {
    return nein('zweite_zufall_form',
      'Der Zufallswert der zweiten Ermaechtigung ist ' + JSON.stringify(d.zufall) +
      ' und keine 64 Hexziffern. Ohne ihn laesst sich nicht sagen, ob sie schon einmal ' +
      'eingeloest wurde -- und ein zweites Oeffentlichstellen desselben Videos waere ein ' +
      'zweiter dritter Aufruf (Vertrag 7).');
  }
  const verbraucht = U.leseVerbrauchte(projektwurzel);
  if (verbraucht.fehler) {
    return nein('zweite_verbrauchsliste_unlesbar', verbraucht.fehler +
      ' Solange nicht feststeht, welche Ermaechtigungen schon verbraucht sind, wird keine ' +
      'angenommen und nichts oeffentlich gestellt.');
  }
  const schon = verbraucht.liste.find((v) => v && v.zufall === d.zufall);
  if (schon) {
    return nein('zweite_verbraucht',
      'Diese zweite Ermaechtigung wurde schon verbraucht' +
      (schon.verbraucht_am ? ' (am ' + schon.verbraucht_am + ')' : '') +
      '. Sie gilt fuer GENAU EINEN Lauf. Ob dieser Lauf das Video oeffentlich gestellt hat, ' +
      'steht im Gedaechtnis und nicht hier; der dritte Aufruf wird jedenfalls KEIN zweites ' +
      'Mal gemacht (Vertrag 7). Wer den Schritt noch einmal ansehen will, startet den Dienst ' +
      'neu -- dann liest der Trockenlauf die Lage von jetzt.');
  }

  // 4. DER AUGENBLICK.
  if (typeof d.erstellt_am !== 'string' || !ISO_UTC.test(d.erstellt_am) ||
      !Number.isFinite(Date.parse(d.erstellt_am))) {
    return nein('zweite_zeit_form',
      'erstellt_am der zweiten Ermaechtigung ist ' + JSON.stringify(d.erstellt_am) +
      ' und kein Zeitstempel in UTC (RFC 3339 mit Z).');
  }
  const alter = jetzt - Date.parse(d.erstellt_am);
  if (alter < -ERMAECHTIGUNG_ZUKUNFT_MS) {
    return nein('zweite_zukunft',
      'Die zweite Ermaechtigung ist auf ' + d.erstellt_am + ' datiert und liegt damit ' +
      Math.round(-alter / 1000) + ' Sekunden in der ZUKUNFT (jetzt ist ' +
      new Date(jetzt).toISOString() + '). Dienst und Arbeiter laufen an derselben Uhr; eine ' +
      'Ermaechtigung, die noch nicht begonnen hat, bezeugt keinen Augenblick.');
  }
  if (alter > ERMAECHTIGUNG_GUELTIG_MS) {
    return nein('zweite_abgelaufen',
      'Die zweite Ermaechtigung ist ' + Math.round(alter / 1000) + ' Sekunden alt, gueltig ' +
      'sind ' + (ERMAECHTIGUNG_GUELTIG_MS / 1000) + '. Erstellt am ' + d.erstellt_am +
      ', jetzt ist ' + new Date(jetzt).toISOString() + '. Sie soll den Augenblick des Klicks ' +
      'bezeugen und nicht den Nachmittag -- in der Longform-Ansicht neu klicken.');
  }

  // 5. DIE AUFNAHME.
  if (d.aufnahme !== aufnahme) {
    return nein('zweite_fremde_aufnahme',
      'Die zweite Ermaechtigung gilt fuer die Aufnahme ' + JSON.stringify(d.aufnahme) +
      ', oeffentlich gestellt werden soll ' + JSON.stringify(aufnahme) + '. Eine ' +
      'Ermaechtigung fuer eine andere Aufnahme gilt hier nicht.');
  }

  // 6. DIE VIDEODATEI.
  if (typeof d.video_sha256 !== 'string' || !SHA256_FORM.test(d.video_sha256)) {
    return nein('zweite_video_sha_form',
      'video_sha256 der zweiten Ermaechtigung ist ' + JSON.stringify(d.video_sha256) +
      ' und keine sha256-Summe. Ohne sie ist nicht zu sagen, welches Video gemeint ist.');
  }
  if (d.video_sha256 !== videoSha256) {
    return nein('zweite_video_sha',
      'Die zweite Ermaechtigung gehoert zu einer Videodatei mit der Pruefsumme ' +
      d.video_sha256 + ', der Eintrag dieses Laufs traegt ' + videoSha256 + '. Das ist nicht ' +
      'dasselbe Video. Es wird nichts oeffentlich gestellt.');
  }

  // 7. DIE KENNUNG -- die Bindung, die es bei der ersten nicht gab.
  //
  //    Sie kommt aus dem Gedaechtnis dieses Laufs (Vertrag 2.5 Punkt 2), und
  //    hier wird sie gegen die aus der Ermaechtigung gehalten. Ein Video
  //    oeffentlich zu stellen, ueber das niemand geurteilt hat, ist der eine
  //    Fehler dieses Weges, den niemand mehr zurueckdreht.
  if (typeof d.videoId !== 'string' || !d.videoId) {
    return nein('zweite_video_id_form',
      'Die zweite Ermaechtigung traegt keine Kennung des Videos. Ohne sie ist nicht zu ' +
      'sagen, WELCHES Video oeffentlich werden soll -- es wird keines.');
  }
  if (d.videoId !== videoId) {
    return nein('zweite_video_id',
      'Die zweite Ermaechtigung gilt fuer ein ANDERES Video: sie nennt die Kennung ' +
      d.videoId + ', das Gedaechtnis dieses Laufs nennt ' + String(videoId) + '. Es wird ' +
      'nichts oeffentlich gestellt. Ein Video oeffentlich zu stellen, ueber das dieser ' +
      'Mensch nicht geurteilt hat, laesst sich nicht zuruecknehmen (Vertrag 2.5, 2.12).');
  }

  // 8. DAS URTEIL -- Titel, Beschreibung, Bild. Die Form jetzt; die Werte
  //    unmittelbar vor dem Aufruf, teils gegen die Platte, teils gegen
  //    YouTube (dort, wo es einen Netzaufruf braucht).
  if (d.urteil === null || typeof d.urteil !== 'object' || Array.isArray(d.urteil)) {
    return nein('zweite_urteil_form',
      'Das Feld urteil ist ' + JSON.stringify(d.urteil) + '. Ohne es haengt die ' +
      'Ermaechtigung nicht an dem, WAS der Mensch gesehen hat, sondern nur daran, DASS er ' +
      'geklickt hat. Es wird nichts oeffentlich gestellt.');
  }
  if (d.urteil.thumbnail === null || typeof d.urteil.thumbnail !== 'object' ||
      typeof d.urteil.thumbnail.dateiname !== 'string' || d.urteil.thumbnail.dateiname === '' ||
      typeof d.urteil.thumbnail.sha256 !== 'string' ||
      !SHA256_FORM.test(d.urteil.thumbnail.sha256)) {
    return nein('zweite_urteil_bild_form',
      'urteil.thumbnail ist ' + JSON.stringify(d.urteil.thumbnail) + ' und traegt nicht ' +
      'Dateiname und sha256. Ohne beide ist nicht zu sagen, welches Bild an dem Video hing, ' +
      'ueber das geurteilt wurde.');
  }
  if (typeof d.urteil.titel !== 'string') {
    return nein('zweite_urteil_titel_form',
      'urteil.titel ist ' + JSON.stringify(d.urteil.titel) + ' und keine Zeichenkette. Der ' +
      'Titel ist das, was unter dem Video steht, sobald es oeffentlich ist; eine ' +
      'Ermaechtigung ohne ihn bezeugt ihn nicht.');
  }
  if (d.urteil.thumbnail.dateiname !== urteil.thumbnail.dateiname) {
    return nein('zweite_urteil_bild_name',
      'Die zweite Ermaechtigung nennt als Bild am Video ' +
      JSON.stringify(d.urteil.thumbnail.dateiname) + ', das Gedaechtnis dieses Laufs nennt ' +
      JSON.stringify(urteil.thumbnail.dateiname) + '. Zwei Angaben ueber dasselbe Bild, die ' +
      'auseinandergehen, werden nicht aufgeloest, sondern abgewiesen. Es wird nichts ' +
      'oeffentlich gestellt.');
  }
  if (d.urteil.thumbnail.sha256 !== urteil.thumbnail.sha256) {
    return nein('zweite_urteil_bild_sha_gedaechtnis',
      'Die zweite Ermaechtigung nennt fuer das Bild ' + d.urteil.thumbnail.dateiname +
      ' die Pruefsumme ' + d.urteil.thumbnail.sha256 + ', das Gedaechtnis dieses Laufs ' +
      'nennt ' + String(urteil.thumbnail.sha256) + '. Das Gedaechtnis hat sich zwischen dem ' +
      'Urteil und diesem Lauf geaendert. Es wird nichts oeffentlich gestellt.');
  }

  // 9. DER KANAL -- die FORM jetzt, der Vergleich spaeter (U.pruefeKanal).
  if (typeof d.kanal_id !== 'string' || !d.kanal_id.trim()) {
    return nein('zweite_kanal_form',
      'kanal_id fehlt in der zweiten Ermaechtigung. Der Knopf hat einen Kanal genannt; ohne ' +
      'diese Angabe laesst sich nicht pruefen, ob es derselbe ist, auf dem das Video ' +
      'oeffentlich wuerde.');
  }

  return { ok: true, daten: d };
}

// Der Vergleich nach channels.list und das Verbrauchen -- beide WOERTLICH die
// des Uploaders. Sie stehen hier als Weiterreichung und nicht als Nachbau:
// `pruefeKanal` liest `kanal_id`/`kanal_name`, und diese Ermaechtigung traegt
// dieselben beiden Felder unter denselben Namen. Das ist kein Zufall, sondern
// der Grund, warum sie so heissen.
function pruefeKanal(daten, kanalId, kanalName) {
  return U.pruefeKanal(daten, kanalId, kanalName);
}
function verbraucheErmaechtigung({ projektwurzel, pfad, daten, jetzt }) {
  return U.verbraucheErmaechtigung({ projektwurzel, pfad, daten, jetzt });
}

module.exports = {
  GEDAECHTNIS_ORDNER, GEDAECHTNIS_ARTIFACT_TYPE, GEDAECHTNIS_SCHEMA_VERSION,
  GEDAECHTNIS_TMP_FORM, STAENDE, STAENDE_DIESES_BAUS,
  gedaechtnisOrdner, gedaechtnisPfad, leseGedaechtnisverzeichnis,
  neuesGedaechtnis, leseGedaechtnis, schonHochgeladen, schreibeGedaechtnis,

  ERMAECHTIGUNG_ARTIFACT_TYPE, ERMAECHTIGUNG_SCHEMA_VERSION, ZWECK_UPLOAD,
  ZWECK_VEROEFFENTLICHEN, ZWECK_HALTEPUNKT, ZWECKE_DRITTER_AUFRUF, ZWECKE,
  ERLAUBTE_RAENGE, ERMAECHTIGUNG_GUELTIG_MS, ERMAECHTIGUNG_ZUKUNFT_MS, ZUFALL_FORM,
  ISO_UTC,
  ermaechtigungOrdner, ermaechtigungPfad, neuerZufall, neueErmaechtigung,
  pruefeErmaechtigung, pruefeKanal, verbraucheErmaechtigung,
  neueZweiteErmaechtigung, pruefeZweiteErmaechtigung, liesZweck,
};
