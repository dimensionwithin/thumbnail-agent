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

const { pruefeArgumenteStrikt } = require('../publish/cli-args');

// pruefeArgumenteStrikt als ALLERERSTE Anweisung des Programms -- vor jedem
// Lesen, vor jedem Kindprozess. Nur so kann ein Tippfehler im Aufruf nicht
// mehr als "ist halt durchgelaufen" enden (CY Teil B).
const ERLAUBTE_ARGUMENTE = ['--aufnahme=', '--wurzel=', '--json'];
if (require.main === module) {
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/upload/uebergabe-leser.js');
}

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EXIT_OK = 0;
const EXIT_MANGEL = 1;
const EXIT_AUFRUFFEHLER = 2;

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
const SHA256_FORM = /^[0-9a-f]{64}$/;

const PFLICHTFELDER = [
  'kennung', 'pfad', 'sha256', 'groesse_bytes', 'dauer_ms', 'breite', 'hoehe',
  'titel_vorschlag', 'transkript', 'quelle_von_ms', 'quelle_bis_ms', 'urteil',
];

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

// ebene: 'Kopf' | 'Vertrag' | 'Platte'
// eintrag: Kennung oder "#<index>", wenn die Kennung selbst unbrauchbar ist
// feld: Feldname oder null
function mangel(ebene, eintrag, feld, meldung) {
  return { ebene, eintrag, feld, meldung };
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
        fehler: mangel('Kopf', null, null,
          'Die Uebergabedatei ist unvollstaendig geschrieben (abgeschnittenes JSON: ' +
          'offene Klammer oder offene Zeichenkette am Dateiende). Das ist KEINE leere ' +
          'Aufnahme, sondern ein abgebrochener Schreibvorgang -- die Datei wird bewusst ' +
          'nicht atomar geschrieben. Rohmeldung des Parsers: ' + e.message),
      };
    }
    return {
      fehler: mangel('Kopf', null, null,
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
    maengel.push(mangel('Kopf', null, null,
      'Die Uebergabedatei enthaelt kein JSON-Objekt an oberster Stelle.'));
    return { maengel, abbruch: true };
  }

  if (daten.artifact_type !== ARTIFACT_TYPE) {
    maengel.push(mangel('Kopf', null, 'artifact_type',
      'artifact_type ist ' + JSON.stringify(daten.artifact_type) + ', erwartet ist "' +
      ARTIFACT_TYPE + '". Die Datei wird nicht weitergelesen -- sie gehoert nicht zu ' +
      'diesem Vertrag.'));
    return { maengel, abbruch: true };
  }

  if (!BEKANNTE_SCHEMA_VERSIONEN.includes(daten.schema_version)) {
    maengel.push(mangel('Kopf', null, 'schema_version',
      'schema_version ist ' + JSON.stringify(daten.schema_version) + ' und damit unbekannt. ' +
      'Bekannt ist zur Zeit nur: ' + BEKANNTE_SCHEMA_VERSIONEN.join(', ') + '. ' +
      'Die Datei wird nicht weitergelesen: eine unbekannte Fassung nach den Regeln der ' +
      'bekannten zu pruefen wuerde eine Zusage vortaeuschen, die niemand gegeben hat.'));
    return { maengel, abbruch: true };
  }

  if (typeof daten.aufnahme !== 'string' || !AUFNAHME_FORM.test(daten.aufnahme)) {
    maengel.push(mangel('Kopf', null, 'aufnahme',
      'aufnahme ist ' + JSON.stringify(daten.aufnahme) +
      ' und hat nicht die Form JJJJ-MM-TT HH-MM-SS.'));
  } else if (daten.aufnahme !== aufnahmeOrdner) {
    maengel.push(mangel('Kopf', null, 'aufnahme',
      'aufnahme ist "' + daten.aufnahme + '", der gelesene Ordner heisst aber "' +
      aufnahmeOrdner + '".'));
  }

  if (typeof daten.erzeugt_am !== 'string' || !ISO_MIT_VERSATZ.test(daten.erzeugt_am) ||
      Number.isNaN(Date.parse(daten.erzeugt_am))) {
    maengel.push(mangel('Kopf', null, 'erzeugt_am',
      'erzeugt_am ist ' + JSON.stringify(daten.erzeugt_am) +
      ' und ist kein ISO-8601-Zeitpunkt mit Zonenversatz.'));
  }

  if (!Array.isArray(daten.shorts)) {
    maengel.push(mangel('Kopf', null, 'shorts',
      'shorts ist ' + JSON.stringify(daten.shorts) + ' und keine Liste.'));
    return { maengel, abbruch: true };
  }
  if (daten.shorts.length === 0) {
    maengel.push(mangel('Kopf', null, 'shorts',
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
  const m = (feld, text) => maengel.push(mangel('Vertrag', bezeichner, feld, text));
  const h = (feld, text) => hinweise.push(hinweis('Vertrag', bezeichner, feld, text));

  if (eintrag === null || typeof eintrag !== 'object' || Array.isArray(eintrag)) {
    m(null, 'Eintrag ' + index + ' ist kein Objekt.');
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
    if (!(feld in eintrag)) m(feld, feld + ' fehlt (Pflichtfeld).');
  }

  // kennung: Form <aufnahme>/<index>, innerhalb der Datei eindeutig.
  if ('kennung' in eintrag) {
    if (!istNichtLeererText(eintrag.kennung)) {
      m('kennung', 'kennung ist ' + JSON.stringify(eintrag.kennung) +
        ' und kein nicht-leerer Text.');
    } else {
      const roh = String(daten.aufnahme).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const erwartet = new RegExp('^' + roh + '\\/\\d+$');
      if (!erwartet.test(eintrag.kennung)) {
        m('kennung', 'kennung "' + eintrag.kennung + '" hat nicht die Form ' +
          '<aufnahme>/<index>, erwartet wird "' + daten.aufnahme + '/<Zahl>".');
      }
      if (gesehene.has(eintrag.kennung)) {
        m('kennung', 'kennung "' + eintrag.kennung + '" kommt mehrfach vor (zuerst in ' +
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
      m('pfad', 'pfad ist ' + JSON.stringify(eintrag.pfad) + ' und kein nicht-leerer Text.');
    } else if (!path.isAbsolute(eintrag.pfad)) {
      m('pfad', 'pfad "' + eintrag.pfad + '" ist nicht absolut.');
    } else if (!pfadLiegtUnter(wurzel, eintrag.pfad)) {
      m('pfad', 'pfad "' + eintrag.pfad + '" liegt nicht unterhalb der eingestellten ' +
        'Wurzel "' + wurzel + '".');
    } else {
      pfadBrauchbar = true;
    }
  }

  // sha256: 64 Hexzeichen, klein.
  if ('sha256' in eintrag) {
    const s = eintrag.sha256;
    if (typeof s !== 'string') {
      m('sha256', 'sha256 ist ' + JSON.stringify(s) + ' und kein Text.');
    } else if (s.length !== 64) {
      m('sha256', 'sha256 hat ' + s.length + ' Zeichen, erwartet sind genau 64 Hexzeichen ' +
        'in Kleinschreibung.');
    } else if (!SHA256_FORM.test(s)) {
      if (/^[0-9a-fA-F]{64}$/.test(s)) {
        m('sha256', 'sha256 enthaelt Grossbuchstaben, erwartet sind genau 64 Hexzeichen ' +
          'in Kleinschreibung.');
      } else {
        m('sha256', 'sha256 enthaelt Zeichen, die keine Hexziffern sind; erwartet sind ' +
          'genau 64 Hexzeichen in Kleinschreibung.');
      }
    }
  }

  for (const feld of ['groesse_bytes', 'dauer_ms']) {
    if (feld in eintrag) {
      if (!istGanzzahl(eintrag[feld])) {
        m(feld, feld + ' ist ' + JSON.stringify(eintrag[feld]) + ' und keine Ganzzahl.');
      } else if (eintrag[feld] <= 0) {
        m(feld, feld + ' ist ' + eintrag[feld] + ' und damit nicht groesser als 0.');
      }
    }
  }

  for (const feld of ['breite', 'hoehe', 'quelle_von_ms', 'quelle_bis_ms']) {
    if (feld in eintrag && !istGanzzahl(eintrag[feld])) {
      m(feld, feld + ' ist ' + JSON.stringify(eintrag[feld]) + ' und keine Ganzzahl.');
    }
  }

  for (const feld of ['titel_vorschlag', 'transkript']) {
    if (feld in eintrag && !istNichtLeererText(eintrag[feld])) {
      m(feld, feld + ' ist ' + JSON.stringify(eintrag[feld]) + ' und damit leer.');
    }
  }

  if (istGanzzahl(eintrag.quelle_von_ms) && istGanzzahl(eintrag.quelle_bis_ms) &&
      eintrag.quelle_bis_ms <= eintrag.quelle_von_ms) {
    m('quelle_bis_ms', 'quelle_bis_ms (' + eintrag.quelle_bis_ms + ') ist nicht groesser ' +
      'als quelle_von_ms (' + eintrag.quelle_von_ms + ').');
  }

  // urteil: EXAKTE Gleichheitspruefung auf "ja", keine Ausschlussliste. Eine
  // Ausschlussliste ("alles ausser nein") nimmt an, was sie nicht kennt.
  if ('urteil' in eintrag && eintrag.urteil !== 'ja') {
    m('urteil', 'urteil ist ' + JSON.stringify(eintrag.urteil) + ', erwartet ist exakt "ja". ' +
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
      m('dauer_ms', 'dauer_ms (' + eintrag.dauer_ms + ') weicht um ' +
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
      m('dauer_ms', 'dauer_ms ist ' + d + ' ms und liegt ausserhalb jeder Vernunftgrenze ' +
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
  const m = (feld, text) => maengel.push(mangel('Platte', bezeichner, feld, text));
  const pfad = eintrag.pfad;

  let stat;
  try {
    stat = fs.statSync(sperre.oeffnen(pfad));
  } catch (e) {
    m('pfad', 'Datei nicht vorhanden oder nicht lesbar (' + (e.code || e.message) + '): "' +
      pfad + '".');
    return maengel;
  }
  if (!stat.isFile()) {
    m('pfad', '"' + pfad + '" ist keine Datei.');
    return maengel;
  }

  if (istGanzzahl(eintrag.groesse_bytes) && stat.size !== eintrag.groesse_bytes) {
    m('groesse_bytes', 'groesse_bytes ist mit ' + eintrag.groesse_bytes +
      ' angegeben, die Datei hat ' + stat.size + ' Bytes.');
  }

  if (typeof eintrag.sha256 === 'string' && SHA256_FORM.test(eintrag.sha256)) {
    const gemessen = sha256VonDatei(sperre, pfad);
    if (gemessen !== eintrag.sha256) {
      m('sha256', 'sha256 stimmt nicht: angegeben ' + eintrag.sha256 + ', gemessen ' +
        gemessen + '.');
    }
  } else {
    m('sha256', 'sha256 konnte nicht verglichen werden, weil das Feld selbst ungueltig ist. ' +
      'Es wird nichts ergaenzt und nichts geraten.');
  }

  let sonde;
  try {
    sonde = ffprobe(sperre, pfad);
  } catch (e) {
    m('format', 'Format nicht pruefbar: ffprobe konnte nicht ausgefuehrt werden (' +
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
    m('videospuren', 'Die Datei hat ' + video.length + ' Videospuren, zugesichert ist genau eine.');
  } else {
    const v = video[0];
    if (v.width !== ZUSICHERUNG.breite || v.height !== ZUSICHERUNG.hoehe) {
      m('aufloesung', 'Aufloesung ist ' + v.width + 'x' + v.height + ', zugesichert ist ' +
        ZUSICHERUNG.breite + 'x' + ZUSICHERUNG.hoehe + '.');
    }
    if (istGanzzahl(eintrag.breite) && istGanzzahl(eintrag.hoehe) &&
        (v.width !== eintrag.breite || v.height !== eintrag.hoehe)) {
      m('breite/hoehe', 'breite/hoehe sind mit ' + eintrag.breite + 'x' + eintrag.hoehe +
        ' angegeben, die Datei ist ' + v.width + 'x' + v.height + '.');
    }
    const r = bruchZuZahl(v.r_frame_rate);
    const a = bruchZuZahl(v.avg_frame_rate);
    if (r !== ZUSICHERUNG.fps || a !== ZUSICHERUNG.fps) {
      m('bildrate', 'Bildrate ist r_frame_rate=' + v.r_frame_rate + ' / avg_frame_rate=' +
        v.avg_frame_rate + ', zugesichert sind konstant ' + ZUSICHERUNG.fps +
        ' fps (beide Werte muessen ' + ZUSICHERUNG.fps + ' ergeben).');
    }
    if (v.codec_name !== ZUSICHERUNG.videoCodec || v.profile !== ZUSICHERUNG.videoProfil ||
        v.level !== ZUSICHERUNG.videoLevel) {
      m('videocodec', 'Videocodec ist ' + v.codec_name + ' ' + v.profile + ' Level ' + v.level +
        ', zugesichert ist ' + ZUSICHERUNG.videoCodec + ' ' + ZUSICHERUNG.videoProfil +
        ' Level ' + ZUSICHERUNG.videoLevel + '.');
    }
    if (v.pix_fmt !== ZUSICHERUNG.pixelFormat) {
      m('pixelformat', 'Pixelformat ist ' + v.pix_fmt + ', zugesichert ist ' +
        ZUSICHERUNG.pixelFormat + '.');
    }
  }

  if (audio.length !== 1) {
    m('tonspuren', 'Die Datei hat ' + audio.length + ' Tonspuren, zugesichert ist genau eine.');
  } else {
    const t = audio[0];
    if (t.codec_name !== ZUSICHERUNG.audioCodec || t.profile !== ZUSICHERUNG.audioProfil) {
      m('toncodec', 'Toncodec ist ' + t.codec_name + ' ' + t.profile + ', zugesichert ist ' +
        ZUSICHERUNG.audioCodec + ' ' + ZUSICHERUNG.audioProfil + '.');
    }
    if (Number(t.sample_rate) !== ZUSICHERUNG.abtastrate) {
      m('abtastrate', 'Abtastrate ist ' + t.sample_rate + ' Hz, zugesichert sind ' +
        ZUSICHERUNG.abtastrate + ' Hz.');
    }
    if (t.channels !== ZUSICHERUNG.kanaele || t.channel_layout !== ZUSICHERUNG.kanalbild) {
      m('tonkanaele', 'Tonkanaele sind ' + t.channels + ' (' + t.channel_layout + '), zugesichert ' +
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
    bericht.verlauf.push('Nur die Vertragspruefung gelaufen: es wurde nichts auf der Platte nachgesehen.');
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
      maengel.push(mangel('Platte', e.bezeichner, 'pfad',
        'Die Pruefung gegen die Platte wurde NICHT ausgefuehrt, weil das Feld pfad ' +
        'schon den Vertrag verletzt. Es wird kein Ersatzpfad gesucht.'));
    } else {
      maengel.push(...pruefePlatte(roh, e.bezeichner, sperre));
    }

    bericht.eintraege.push({
      index: i,
      kennung: e.kennung,
      bezeichner: e.bezeichner,
      unbekannteFelder: e.unbekannteFelder,
      maengel,
      hinweise: e.hinweise,
      // DHb: Ein Hinweis macht einen Eintrag NICHT halb abgelehnt. Angenommen
      // wird allein an den Maengeln entschieden.
      angenommen: maengel.length === 0,
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
  z.push(bericht.status === 'angenommen'
    ? 'ERGEBNIS: Die Uebergabe entspricht dem Vertrag.'
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
  const aufnahme = wertVon(argv, '--aufnahme=');
  const wurzel = wertVon(argv, '--wurzel=') || process.env.SHORTS_RENDER_WURZEL || null;

  if (!aufnahme) {
    console.error('\nAbbruch: --aufnahme= fehlt. Beispiel: --aufnahme="2026-08-29 18-18-19"\n');
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

  const bericht = pruefeUebergabe({ text, wurzel, aufnahme, platte: true });
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
  DATEINAME, ERLAUBTE_ARGUMENTE, EXIT_OK, EXIT_MANGEL, EXIT_AUFRUFFEHLER,
  VERNUNFT_MIN_MS, VERNUNFT_MAX_MS, BEOBACHTET_MIN_MS, BEOBACHTET_MAX_MS,
  BEOBACHTET_STICHPROBEN,
  neueSperre, uebergabedateiPfad, istAbgeschnitten, parseStreng, pruefeKopf,
  pruefeEintrag, pruefePlatte, pruefeUebergabe, formatiere, pfadLiegtUnter,
};
