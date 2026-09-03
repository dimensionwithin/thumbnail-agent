'use strict';

// ---------------------------------------------------------------------------
// DER BEIPACKZETTEL-LESER (EG)
// ---------------------------------------------------------------------------
//
// Er befundet, er entscheidet nicht.
//
// Eingabe: ein Aufnahmename und der Export-Ordner des Thumbnail-Compositors.
// Ausgabe: EIN Befund -- welcher Rang greift, welcher Zettel oder welches Bild
// genommen oder vorgeschlagen wird, welche Zettel mit welchem Satz genannt
// werden, ob abgebrochen werden muss und nach welcher Vertragsstelle.
//
// Was dieses Modul NICHT tut, und zwar mit Absicht:
//
//   - Es SCHREIBT nichts. Nicht in den Export-Ordner (Vertrag 7: "Kein
//     Schreiben in den Export-Ordner des Compositors"), nicht nach data/,
//     nirgends. tests/zettel-leser.test.cjs stellt die schreibenden
//     fs-Funktionen scharf und laesst den vollen Durchlauf dagegen laufen.
//   - Es geht NICHT ins Netz, laedt nichts hoch und kennt keine Video-Kennung.
//   - Es kennt kein Gedaechtnis und keine Freigabeseite.
//   - Es setzt keinen Rueckgabewert. Wo der Vertrag "Abbruch (1)" sagt, traegt
//     der Befund ein Feld `abbruch`; die Zahl setzt der Arbeiter.
//   - Es liest die Videodatei nicht und kennt keinen Render-Zeitstempel. Das
//     ist die Reparatur aus Fassung 3 (2.7): Fassung 2 verlangte "die juengste
//     Bilddatei, die NACH dem Render-Zeitstempel entstanden ist", und dieser
//     Filter warf beim Render vom 31.08. das einzige Bild weg, das es gab --
//     es entstand 17 Minuten vor Renderende. Das Fenster ist seither der
//     KALENDERTAG des Aufnahmebeginns. Damit die alte Regel hier nicht wieder
//     einsickern kann, weist `befundeKandidaten` jede unbekannte Angabe ab:
//     wer ihr einen Render-Zeitstempel mitgibt, bekommt einen Fehler und kein
//     stillschweigend ignoriertes Feld.
//
// Geliehen statt nachgebaut (Vertrag 2.1: "Leihen heisst importieren, nicht
// kopieren"):
//
//   uebergabe-leser.js   AUFNAHME_FORM     die Form des Aufnahmenamens
//                        SHA256_FORM       die Form einer sha256
//                        istAbgeschnitten  abgebrochenes JSON von kaputtem
//                                          unterscheiden
//                        pfadLiegtUnter    ein Dateiname darf nicht aus dem
//                                          Export-Ordner hinauszeigen
//   uploader.js          sha256Datei       die sha256 einer Datei auf der Platte
//
// Was NICHT geliehen werden konnte, samt Grund, steht im Bericht EG. Die eine
// Ausnahme, SHA256_FORM, ist seit EH keine mehr: sie stand an drei Stellen und
// war an keiner exportiert; sie steht jetzt einmal und kommt von dort.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const {
  AUFNAHME_FORM, SHA256_FORM, istAbgeschnitten, pfadLiegtUnter,
} = require('./uebergabe-leser');
const { sha256Datei } = require('./uploader');

// ---------------------------------------------------------------------------
// Die Formen, die ein Zettel haben muss (Vertrag 3.3)
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

// SHA256_FORM steht nicht hier, sondern in uebergabe-leser.js, und wird oben
// geholt (EH).

// Der Tagesteil eines ISO-Zeitpunkts mit Ortszeitversatz. Gelesen wird
// AUSSCHLIESSLICH dieser Teil -- nicht umgerechnet. `exportiert_am` traegt den
// Versatz des Rechners, der exportiert hat; sein Kalendertag steht woertlich
// darin. Eine Umrechnung in die Zone des Lesers koennte den Tag verschieben.
const ISO_TAG = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}/;

const BILD_ENDUNGEN = ['.jpg', '.jpeg', '.png'];

// Die sechs Presets des Compositors (thumbnail_service.py, SERIES_FOR_PRESET).
const ZUGELASSENE_FORMATE = Object.freeze(['standard', 'aiv', 'nonchart']);
const FORMATE_OHNE_AUFNAHME = Object.freeze(['livestream', 'innercircle', 'memberlive']);

const HERKUNFT_WERTE = Object.freeze(['bestaetigt', 'unbestaetigt', 'leer']);

// ---------------------------------------------------------------------------
// DIE ZUSTANDSMATRIX (Vertrag 2.7)
// ---------------------------------------------------------------------------
//
// 37 Zeilen, drei Achsen:
//   h  aufnahme_herkunft:  B bestaetigt | U unbestaetigt | L leer | F fehlt
//   n  Name:               G diese Aufnahme | A andere | K kein Name
//   f  Format:             Z zugelassen | N ohne Aufnahme | ? nicht lesbar
// Zeile 37 ist die Zeile ohne Zettel: ein Bild, zu dem kein Zettel gehoert.
//
// Jede Zeile hat GENAU EINEN Ausgang und GENAU EINE Meldung. Das ist keine
// Bequemlichkeit, sondern die Zusage selbst: zwei Zustaende, die gleich
// aussehen, sind der Fehler, gegen den diese Matrix gebaut ist.
// tests/zettel-leser.test.cjs prueft die Verschiedenheit aller 37 Meldungen
// maschinell und vergleicht Achsen und Ausgang gegen die Tabelle im Vertrag.
//
// Die Ausgaenge:
//   rang1_regel        genommen, ohne Rueckfrage
//   rang2a_vorschlag   Vorschlag; das Fenster gilt fuer ihn nicht
//   rang2b_vorschlag   Vorschlag; nur im Fenster
//   rang3_vorschlag    Vorschlag; Bild ohne Zettel, nur im Fenster
//   kein_kandidat      genannt, kommt nicht in Frage; der Lauf geht weiter
//   uebergangen        genannt, widerspruechlich; der Lauf geht weiter
//   abbruch            genannt, der Lauf bricht ab (Zeilen 2 und 3)

const MATRIX = Object.freeze([
  z(1, 'B', 'G', 'Z', 'rang1_regel',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme, bestaetigt; Format ' + c.f + '.'),
  z(2, 'B', 'G', 'N', 'abbruch',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme, bestaetigt, traegt aber das Format ' +
      c.f + ', das keine Aufnahme hat. Zettel neu exportieren oder wegnehmen.'),
  z(3, 'B', 'G', '?', 'abbruch',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme, bestaetigt, hat aber kein lesbares Format.'),
  z(4, 'B', 'A', 'Z', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' gehoert bestaetigt zur Aufnahme ' + c.andere + '.'),
  z(5, 'B', 'A', 'N', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' gehoert bestaetigt zur Aufnahme ' + c.andere +
      ' und traegt das Format ' + c.f + ', das keine Aufnahme hat.'),
  z(6, 'B', 'A', '?', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' gehoert bestaetigt zur Aufnahme ' + c.andere +
      ', ohne lesbares Format.'),
  z(7, 'B', 'K', 'Z', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt bestaetigt und nennt keine Aufnahme; Format ' + c.f +
      '. Widerspruechlich, nicht vom Dienst geschrieben.'),
  z(8, 'B', 'K', 'N', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt bestaetigt, nennt keine Aufnahme und traegt das Format ' +
      c.f + ', das keine Aufnahme hat. Widerspruechlich.'),
  z(9, 'B', 'K', '?', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt bestaetigt, nennt keine Aufnahme, ohne lesbares Format. ' +
      'Widerspruechlich.'),
  z(10, 'U', 'G', 'Z', 'rang2a_vorschlag',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme, unbestaetigt (das Chart hat sich seit ' +
      'dem Setzen geaendert); Format ' + c.f + '.'),
  z(11, 'U', 'G', 'N', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme, unbestaetigt, traegt aber das Format ' +
      c.f + ', das keine Aufnahme hat.'),
  z(12, 'U', 'G', '?', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme, unbestaetigt, ohne lesbares Format.'),
  z(13, 'U', 'A', 'Z', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' gehoert unbestaetigt zur Aufnahme ' + c.andere + '.'),
  z(14, 'U', 'A', 'N', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' gehoert unbestaetigt zur Aufnahme ' + c.andere +
      ' und traegt das Format ' + c.f + ', das keine Aufnahme hat.'),
  z(15, 'U', 'A', '?', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' gehoert unbestaetigt zur Aufnahme ' + c.andere +
      ', ohne lesbares Format.'),
  z(16, 'U', 'K', 'Z', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt unbestaetigt und nennt keine Aufnahme; Format ' + c.f +
      '. Widerspruechlich.'),
  z(17, 'U', 'K', 'N', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt unbestaetigt, nennt keine Aufnahme, Format ' + c.f +
      ' ohne Aufnahme. Widerspruechlich.'),
  z(18, 'U', 'K', '?', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt unbestaetigt, nennt keine Aufnahme, ohne lesbares ' +
      'Format. Widerspruechlich.'),
  z(19, 'L', 'G', 'Z', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt leer und nennt doch diese Aufnahme; Format ' + c.f +
      '. Widerspruechlich, wird nicht genommen.'),
  z(20, 'L', 'G', 'N', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt leer, nennt doch diese Aufnahme, Format ' + c.f +
      ' ohne Aufnahme. Widerspruechlich.'),
  z(21, 'L', 'G', '?', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt leer, nennt doch diese Aufnahme, ohne lesbares Format. ' +
      'Widerspruechlich.'),
  z(22, 'L', 'A', 'Z', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt leer und nennt doch die Aufnahme ' + c.andere +
      '; Format ' + c.f + '. Widerspruechlich.'),
  z(23, 'L', 'A', 'N', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt leer, nennt doch die Aufnahme ' + c.andere + ', Format ' +
      c.f + ' ohne Aufnahme. Widerspruechlich.'),
  z(24, 'L', 'A', '?', 'uebergangen',
    (c) => 'Zettel ' + c.name + ' sagt leer, nennt doch die Aufnahme ' + c.andere +
      ', ohne lesbares Format. Widerspruechlich.'),
  z(25, 'L', 'K', 'Z', 'rang2b_vorschlag',
    (c) => 'Zettel ' + c.name + ', ohne Aufnahme (leer), exportiert am ' + c.t + '; Format ' +
      c.f + '.'),
  z(26, 'L', 'K', 'N', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ', ohne Aufnahme (leer), traegt das Format ' + c.f +
      ', das keine Aufnahme hat.'),
  z(27, 'L', 'K', '?', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ', ohne Aufnahme (leer), ohne lesbares Format.'),
  z(28, 'F', 'G', 'Z', 'rang2a_vorschlag',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme ohne Herkunftsangabe (nicht vom Dienst ' +
      'geschrieben); wie unbestaetigt behandelt. Format ' + c.f + '.'),
  z(29, 'F', 'G', 'N', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme ohne Herkunftsangabe und traegt das ' +
      'Format ' + c.f + ', das keine Aufnahme hat.'),
  z(30, 'F', 'G', '?', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' nennt diese Aufnahme ohne Herkunftsangabe, ohne lesbares Format.'),
  z(31, 'F', 'A', 'Z', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' nennt die Aufnahme ' + c.andere + ' ohne Herkunftsangabe.'),
  z(32, 'F', 'A', 'N', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' nennt die Aufnahme ' + c.andere + ' ohne Herkunftsangabe, ' +
      'Format ' + c.f + ' ohne Aufnahme.'),
  z(33, 'F', 'A', '?', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' nennt die Aufnahme ' + c.andere + ' ohne Herkunftsangabe, ' +
      'ohne lesbares Format.'),
  z(34, 'F', 'K', 'Z', 'rang2b_vorschlag',
    (c) => 'Zettel ' + c.name + ' von vor dem Nachtrag (kein Aufnahmefeld), exportiert am ' +
      c.t + '; Format ' + c.f + '.'),
  z(35, 'F', 'K', 'N', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' von vor dem Nachtrag traegt das Format ' + c.f +
      ', das keine Aufnahme hat.'),
  z(36, 'F', 'K', '?', 'kein_kandidat',
    (c) => 'Zettel ' + c.name + ' von vor dem Nachtrag, ohne lesbares Format.'),
  z(37, null, null, '?', 'rang3_vorschlag',
    (c) => 'Bild ' + c.name + ', kein Zettel, entstanden ' + c.t + ', ' + c.bytes +
      ' Bytes; Format unbekannt.'),
]);

function z(nr, h, n, f, ausgang, meldung) {
  return Object.freeze({ nr, h, n, f, ausgang, meldung });
}

// Zeilen, die IMMER genannt werden, an jedem Tag, auch ausserhalb des
// Fensters (Vertrag 2.7, Anmerkung unter der Matrix): die Zettel, die diese
// Aufnahme nennen, und die widerspruechlichen.
const IMMER_GENANNT = Object.freeze(new Set([
  1, 2, 3, 10, 11, 12, 28, 29, 30,          // nennen diese Aufnahme
  7, 8, 9, 16, 17, 18, 19, 20, 21, 22, 23, 24, // widerspruechlich
]));

// Zeilen, die vom Fenster abhaengen: sie werden genannt, wenn ihr Tag im
// Fenster liegt, und sonst nur gezaehlt. Der Vertrag markiert sie mit
// "(im Fenster)".
//
// Seit Fassung 4 gehoeren auch die Zeilen fuer Zettel einer ANDEREN Aufnahme
// dazu (4 bis 6, 13 bis 15, 31 bis 33). Bis dahin sagten Tabelle und Anmerkung
// darunter Verschiedenes: die Anmerkung zaehlte sie nie zu den immer
// genannten, die Tabelle trug keinen Vorbehalt. EG hat nach der Anmerkung
// gebaut, EH hat die Tabelle nachgezogen.
//
// IMMER_GENANNT und FENSTERABHAENGIG zerlegen die 37 Zeilen vollstaendig und
// ohne Ueberschneidung; tests/zettel-leser.test.cjs prueft beides gegen die
// Tabelle im Vertrag.
const FENSTERABHAENGIG = Object.freeze(new Set([
  4, 5, 6, 13, 14, 15, 25, 26, 27, 31, 32, 33, 34, 35, 36, 37,
]));

const MATRIX_NACH_NR = Object.freeze(new Map(MATRIX.map((r) => [r.nr, r])));

function zeileFuer(h, n, f) {
  const r = MATRIX.find((x) => x.h === h && x.n === n && x.f === f);
  if (!r) throw new Error('Zustandsmatrix: keine Zeile fuer ' + h + '/' + n + '/' + f);
  return r;
}

// ---------------------------------------------------------------------------
// Kalendertage
// ---------------------------------------------------------------------------
//
// "gerechnet in der Ortszeit des Rechners" (Vertrag 2.7). Bewusst NICHT ueber
// planer.js/zonenTeile: das ist auf Europe/Berlin festgenagelt, und das ist
// eine andere Regel als "der Rechner". Siehe Bericht EG.

function zweistellig(n) { return String(n).padStart(2, '0'); }

function tagVonInstant(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + zweistellig(d.getMonth() + 1) + '-' + zweistellig(d.getDate());
}

// Fuer die Anzeige: derselbe Kalender wie das Fenster. Eine mtime in UTC neben
// einem Fenster in Ortszeit waeren zwei Uhren in einer Vorschau, und ein
// Mensch, der 15:34 liest und 17:34 meint, prueft nichts.
function zeitVonInstant(ms) {
  const d = new Date(ms);
  return tagVonInstant(ms) + ' ' + zweistellig(d.getHours()) + ':' +
    zweistellig(d.getMinutes()) + ':' + zweistellig(d.getSeconds());
}

// Der Tag im Aufnahmenamen. Der Name traegt ihn woertlich; AUFNAHME_WURZEL
// wird dafuer nicht gelesen (Vertrag 7).
function tagVonAufnahme(aufnahme) {
  return aufnahme.slice(0, 10);
}

function tagVerschoben(tag, tage) {
  const [j, m, t] = tag.split('-').map(Number);
  const d = new Date(j, m - 1, t + tage);
  return d.getFullYear() + '-' + zweistellig(d.getMonth() + 1) + '-' + zweistellig(d.getDate());
}

// ---------------------------------------------------------------------------
// Einen Zettel lesen (Vertrag 3.3)
// ---------------------------------------------------------------------------
//
// Rueckgabe:
//   { lesbar: true,  daten }          ein Zettel im Sinn von 3.3
//   { lesbar: false, grund }          eine .json, die kein Zettel ist
//
// Eine .json, die kein Zettel ist, ist KEIN Abbruch: der Export-Ordner ist,
// anders als data/uploads/, kein Ordner dieses Werkzeugs, und dort darf
// anderes liegen. Sie wird beim Namen genannt und uebergangen.

function leseZettelText(text) {
  let daten;
  try {
    daten = JSON.parse(text);
  } catch (e) {
    return {
      lesbar: false,
      grund: istAbgeschnitten(text)
        ? 'die Datei ist unvollstaendig geschrieben (abgeschnittenes JSON). Rohmeldung: ' +
          e.message
        : 'kein gueltiges JSON. Rohmeldung: ' + e.message,
    };
  }
  if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) {
    return { lesbar: false, grund: 'der Inhalt ist kein JSON-Objekt' };
  }
  if (daten.schema_version !== SCHEMA_VERSION) {
    return {
      lesbar: false,
      grund: Object.prototype.hasOwnProperty.call(daten, 'schema_version')
        ? 'schema_version ist ' + JSON.stringify(daten.schema_version) + ', erwartet ist ' +
          SCHEMA_VERSION
        : 'schema_version fehlt (erwartet ist ' + SCHEMA_VERSION + ')',
    };
  }
  const b = daten.bild;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    return { lesbar: false, grund: 'das Feld bild fehlt oder ist kein Objekt' };
  }
  if (typeof b.dateiname !== 'string' || b.dateiname.trim() === '') {
    return { lesbar: false, grund: 'bild.dateiname fehlt oder ist leer' };
  }
  if (path.basename(b.dateiname) !== b.dateiname) {
    return {
      lesbar: false,
      grund: 'bild.dateiname ist ' + JSON.stringify(b.dateiname) + ' und damit ein Pfad, ' +
        'kein Dateiname',
    };
  }
  if (typeof b.sha256 !== 'string' || !SHA256_FORM.test(b.sha256)) {
    return { lesbar: false, grund: 'bild.sha256 ist keine sha256-Summe' };
  }
  if (!Number.isInteger(b.bytes) || b.bytes < 0) {
    return { lesbar: false, grund: 'bild.bytes ist keine Groesse in ganzen Bytes' };
  }
  // aufnahme: der Name, null oder fehlend. Alles andere ist kein Zettel.
  const hatAufnahme = Object.prototype.hasOwnProperty.call(daten, 'aufnahme');
  const a = hatAufnahme ? daten.aufnahme : null;
  if (a !== null && (typeof a !== 'string' || !AUFNAHME_FORM.test(a))) {
    return {
      lesbar: false,
      grund: 'aufnahme ist ' + JSON.stringify(a) + ' und nicht die Form JJJJ-MM-TT HH-MM-SS',
    };
  }
  // aufnahme_herkunft: einer der drei Werte ODER das Feld fehlt ganz. Ein
  // ausgeschriebenes null ist beides nicht -- der Vertrag laesst fuer dieses
  // Feld nur "einer der drei Werte oder fehlend" zu, anders als bei aufnahme.
  const hatHerkunft = Object.prototype.hasOwnProperty.call(daten, 'aufnahme_herkunft');
  if (hatHerkunft && !HERKUNFT_WERTE.includes(daten.aufnahme_herkunft)) {
    return {
      lesbar: false,
      grund: 'aufnahme_herkunft ist ' + JSON.stringify(daten.aufnahme_herkunft) +
        ' und keiner der drei Werte ' + HERKUNFT_WERTE.join(', '),
    };
  }
  return { lesbar: true, daten, hatAufnahme, hatHerkunft };
}

// ---------------------------------------------------------------------------
// Die Achsen eines gelesenen Zettels
// ---------------------------------------------------------------------------

function achseHerkunft(gelesen) {
  if (!gelesen.hatHerkunft) return 'F';
  return { bestaetigt: 'B', unbestaetigt: 'U', leer: 'L' }[gelesen.daten.aufnahme_herkunft];
}

function achseName(gelesen, aufnahme) {
  const a = gelesen.hatAufnahme ? gelesen.daten.aufnahme : null;
  if (a === null) return 'K';
  return a === aufnahme ? 'G' : 'A';
}

function achseFormat(daten) {
  const f = daten.format;
  if (typeof f !== 'string') return '?';
  if (ZUGELASSENE_FORMATE.includes(f)) return 'Z';
  if (FORMATE_OHNE_AUFNAHME.includes(f)) return 'N';
  return '?';
}

// ---------------------------------------------------------------------------
// Der Befund
// ---------------------------------------------------------------------------

const ERLAUBTE_ANGABEN = Object.freeze(['aufnahme', 'exportOrdner', 'zettel']);

function befundeKandidaten(angaben) {
  if (angaben === null || typeof angaben !== 'object' || Array.isArray(angaben)) {
    throw new TypeError('befundeKandidaten braucht ein Objekt mit ' +
      ERLAUBTE_ANGABEN.join(', ') + '.');
  }
  // Jede unbekannte Angabe wird abgewiesen, nicht verschluckt. Das ist die
  // Sperre gegen die Regel der Fassung 2: wer hier einen Render-Zeitstempel
  // mitgibt, bekommt einen Fehler und nicht ein stillschweigend ignoriertes
  // Feld, das jemand fuer wirksam haelt.
  for (const schluessel of Object.keys(angaben)) {
    if (!ERLAUBTE_ANGABEN.includes(schluessel)) {
      throw new TypeError(
        'befundeKandidaten kennt die Angabe ' + JSON.stringify(schluessel) + ' nicht. ' +
        'Erlaubt sind ' + ERLAUBTE_ANGABEN.join(', ') + '. Insbesondere gibt es KEINEN ' +
        'Render-Zeitstempel: das Fenster ist der Kalendertag des Aufnahmebeginns ' +
        '(Vertrag 2.7, Fassung 3), nicht der Zeitpunkt des Renders.');
    }
  }
  const { aufnahme, exportOrdner, zettel = null } = angaben;

  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new TypeError('aufnahme ist ' + JSON.stringify(aufnahme) +
      ' und nicht die Form JJJJ-MM-TT HH-MM-SS.');
  }
  if (typeof exportOrdner !== 'string' || exportOrdner.trim() === '') {
    throw new TypeError('exportOrdner fehlt. Der Arbeiter loest ihn aus ' +
      'THUMBNAIL_EXPORT_DIR auf; dieses Modul liest keine Einstellung.');
  }
  if (zettel !== null && (typeof zettel !== 'string' || path.basename(zettel) !== zettel ||
      zettel.trim() === '')) {
    throw new TypeError('zettel ist ' + JSON.stringify(zettel) +
      ' und kein blosser Dateiname. Ein Pfad wird nicht genommen (Vertrag 3.1).');
  }

  const tag = tagVonAufnahme(aufnahme);

  // ---- Ordner lesen -------------------------------------------------------
  const eintraege = fs.readdirSync(exportOrdner, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();

  const jsonNamen = eintraege.filter((n) => n.toLowerCase().endsWith('.json'));
  const bildNamen = eintraege.filter((n) =>
    BILD_ENDUNGEN.includes(path.extname(n).toLowerCase()));

  // ---- Zettel lesen und einordnen -----------------------------------------
  const zettelListe = [];
  for (const name of jsonNamen) {
    const voll = path.join(exportOrdner, name);
    if (!pfadLiegtUnter(exportOrdner, voll)) continue; // kann nicht vorkommen; die Sperre bleibt
    let text;
    try {
      text = fs.readFileSync(voll, 'utf8');
    } catch (e) {
      zettelListe.push({
        dateiname: name, lesbar: false, zeile: null, ausgang: 'unlesbar',
        grund: 'nicht lesbar: ' + e.message, genannt: true, im_fenster: null,
        meldung: 'Datei ' + name + ' ist kein Beipackzettel: nicht lesbar: ' + e.message +
          '. Beim Namen genannt und uebergangen.',
      });
      continue;
    }
    const gelesen = leseZettelText(text);
    if (!gelesen.lesbar) {
      zettelListe.push({
        dateiname: name, lesbar: false, zeile: null, ausgang: 'unlesbar',
        grund: gelesen.grund, genannt: true, im_fenster: null,
        meldung: 'Datei ' + name + ' ist kein Beipackzettel: ' + gelesen.grund +
          '. Beim Namen genannt und uebergangen.',
      });
      continue;
    }
    const h = achseHerkunft(gelesen);
    const n = achseName(gelesen, aufnahme);
    const f = achseFormat(gelesen.daten);
    const regel = zeileFuer(h, n, f);
    const treffer = ISO_TAG.exec(String(gelesen.daten.exportiert_am));
    zettelListe.push({
      dateiname: name,
      lesbar: true,
      zeile: regel.nr,
      achsen: { h, n, f },
      ausgang: regel.ausgang,
      exportiert_am: typeof gelesen.daten.exportiert_am === 'string'
        ? gelesen.daten.exportiert_am : null,
      exporttag: treffer ? treffer[1] : null,
      videotitel: gelesen.daten.videotitel === undefined ? null : gelesen.daten.videotitel,
      episode: gelesen.daten.episode === undefined ? null : gelesen.daten.episode,
      datum: gelesen.daten.datum === undefined ? null : gelesen.daten.datum,
      format: typeof gelesen.daten.format === 'string' ? gelesen.daten.format : null,
      aufnahme: gelesen.hatAufnahme ? gelesen.daten.aufnahme : null,
      aufnahme_herkunft: gelesen.hatHerkunft ? gelesen.daten.aufnahme_herkunft : null,
      bild: {
        dateiname: gelesen.daten.bild.dateiname,
        sha256: gelesen.daten.bild.sha256,
        bytes: gelesen.daten.bild.bytes,
      },
      meldung: regel.meldung({
        name, f: gelesen.daten.format, andere: gelesen.daten.aufnahme,
        t: gelesen.daten.exportiert_am,
      }),
      im_fenster: null,   // wird unten gesetzt, sobald das Fenster steht
      genannt: null,
      bildbefund: null,
    });
  }

  // ---- Bilder ohne Zettel --------------------------------------------------
  //
  // "Ohne Zettel" heisst: kein LESBARER Zettel dieses Ordners nennt diese
  // Bilddatei in bild.dateiname. Damit faellt ein Livestream-Bild nie in
  // Rang 3 -- es hat einen Zettel, und der traegt sein Format (Vertrag 7:
  // kein Bild eines Formats ohne Aufnahme als Kandidat, in keinem Rang).
  const bebildert = new Set(
    zettelListe.filter((zt) => zt.lesbar).map((zt) => zt.bild.dateiname));

  const bilderListe = [];
  const alleBilder = [];   // auch die mit Zettel -- fuer "das juengste Bild im Ordner"
  for (const name of bildNamen) {
    const voll = path.join(exportOrdner, name);
    let st;
    try {
      st = fs.statSync(voll);
    } catch (e) {
      continue; // zwischen readdir und stat verschwunden; kein Kandidat, kein Befund
    }
    alleBilder.push({ dateiname: name, mtime_ms: st.mtimeMs, tag: tagVonInstant(st.mtimeMs) });
    if (bebildert.has(name)) continue;
    const zeile37 = MATRIX_NACH_NR.get(37);
    bilderListe.push({
      dateiname: name,
      zeile: 37,
      achsen: { h: null, n: null, f: '?' },
      ausgang: zeile37.ausgang,
      mtime_ms: st.mtimeMs,
      mtime: zeitVonInstant(st.mtimeMs),
      tag: tagVonInstant(st.mtimeMs),
      bytes: st.size,
      meldung: zeile37.meldung({
        name, t: zeitVonInstant(st.mtimeMs), bytes: st.size,
      }),
      im_fenster: null,
      genannt: null,
    });
  }

  // ---- Das Fenster ---------------------------------------------------------
  //
  // Der Kalendertag des Aufnahmebeginns. Es ORDNET die Vorschlagsliste, es
  // WAEHLT nie. Geweitet wird auf den Tag davor und danach -- aber nur, wenn
  // es sonst gar keinen Kandidaten gaebe, und dann WIRD ES GESAGT.
  //
  // Warum nur dann: die Weitung ist dazu da, einen Kandidaten zu finden. Wo
  // Rang 1 oder ein Rang-2-Kandidat schon steht, brauchte sie keiner, und sie
  // koennte aus einem eindeutigen Rang-2-Vorschlag ein "zwei Zettel kommen in
  // Frage" machen -- ein Abbruch, den erst die Weitung erzeugt haette.

  const rang1Alle = zettelListe.filter((zt) => zt.zeile === 1);
  const rang2aAlle = zettelListe.filter((zt) => zt.ausgang === 'rang2a_vorschlag');

  let fensterTage = [tag];
  let geweitet = false;

  const rang2bIn = (tage) => zettelListe.filter(
    (zt) => zt.ausgang === 'rang2b_vorschlag' && zt.exporttag !== null &&
      tage.includes(zt.exporttag));
  const rang3In = (tage) => bilderListe.filter((b) => tage.includes(b.tag));

  // Geweitet wird, sobald der Tag leer ist -- und gesagt wird es dann auch,
  // gleich ob die Weitung etwas findet. Der Vertrag verlangt fuer den Abbruch
  // "kein Kandidat" ausdruecklich den Tag UND das geweitete Fenster; ein
  // Befund, der die Weitung nur im Erfolgsfall nennt, verschwiege genau die
  // Suche, die ins Leere lief.
  if (rang1Alle.length === 0 && rang2aAlle.length === 0 &&
      rang2bIn(fensterTage).length === 0 && rang3In(fensterTage).length === 0) {
    fensterTage = [tagVerschoben(tag, -1), tag, tagVerschoben(tag, 1)];
    geweitet = true;
  }

  const fenster = {
    tag,
    tage: fensterTage,
    geweitet,
    satz: geweitet
      ? 'Fenster: der Kalendertag ' + tag + ' trug keinen Kandidaten. GEWEITET auf ' +
        fensterTage[0] + ' bis ' + fensterTage[2] + ' (Tag davor und Tag danach).'
      : 'Fenster: der Kalendertag ' + tag + '. Nicht geweitet.',
  };

  // ---- Im Fenster? Genannt? ------------------------------------------------
  for (const zt of zettelListe) {
    if (!zt.lesbar) { zt.im_fenster = null; zt.genannt = true; continue; }
    zt.im_fenster = zt.exporttag !== null && fensterTage.includes(zt.exporttag);
    // Ein Zettel ohne lesbares exportiert_am laesst sich nicht ins Fenster
    // legen. Er wird darum immer GENANNT statt gezaehlt -- ein stilles
    // Uebergehen verbietet Vertrag 7.
    if (zt.exporttag === null) { zt.genannt = true; continue; }
    zt.genannt = IMMER_GENANNT.has(zt.zeile) || zt.im_fenster;
  }
  for (const b of bilderListe) {
    b.im_fenster = fensterTage.includes(b.tag);
    b.genannt = b.im_fenster;
  }

  const zettelAusserhalb = zettelListe.filter((zt) => zt.lesbar && !zt.genannt).length;
  const bilderAusserhalb = bilderListe.filter((b) => !b.genannt).length;

  // ---- Die Kandidatenlisten ------------------------------------------------
  const juengstesZuerst = (a, b) =>
    String(b.exportiert_am || '').localeCompare(String(a.exportiert_am || '')) ||
    a.dateiname.localeCompare(b.dateiname);

  const rang1 = rang1Alle.slice().sort(juengstesZuerst);
  // 2a und 2b bilden EINE Liste; keiner der beiden hat Vorrang (Vertrag 2.7).
  const rang2 = rang2aAlle.concat(rang2bIn(fensterTage)).sort(juengstesZuerst);
  const rang3 = rang3In(fensterTage).slice()
    .sort((a, b) => b.mtime_ms - a.mtime_ms || a.dateiname.localeCompare(b.dateiname));

  for (const zt of rang2) zt.durch_weitung = geweitet && zt.ausgang === 'rang2b_vorschlag';
  for (const b of rang3) b.durch_weitung = geweitet;

  const befund = {
    aufnahme,
    export_ordner: exportOrdner,
    zettel_argument: zettel,
    fenster,
    zettel: zettelListe,
    bilder_ohne_zettel: bilderListe,
    zettel_ausserhalb_des_fensters: zettelAusserhalb,
    bilder_ausserhalb_des_fensters: bilderAusserhalb,
    rang: null,
    regel: null,
    vorschlag: null,
    vorschlaege: [],
    abbruch: null,
    saetze: [],
  };

  // ---- Die Bildpruefung der Kandidaten -------------------------------------
  //
  // Existenz und Groesse fuer jeden GENANNTEN Zettel -- das ist billig und
  // faengt das meiste. Die sha256 nur fuer Kandidaten: sie liest die Datei,
  // und Vertrag 3.3 sagt, es werde keine geoeffnet, ausser zum Rechnen der
  // sha256 fuer die Vorschau.
  const kandidaten = rang1.concat(rang2);
  for (const zt of zettelListe) {
    if (!zt.lesbar) continue;
    if (!zt.genannt && !kandidaten.includes(zt)) continue;
    zt.bildbefund = pruefeBild(exportOrdner, zt, kandidaten.includes(zt));
  }

  // ---- Rangfolge und Abbruch ----------------------------------------------
  entscheide(befund, { rang1, rang2, rang3, zettelListe, alleBilder, zettel });
  befund.saetze = vorschau(befund);
  return befund;
}

// Existenz, Groesse und (nur fuer Kandidaten) sha256 des Bildes, auf das ein
// Zettel zeigt.
function pruefeBild(exportOrdner, zt, istKandidat) {
  const voll = path.join(exportOrdner, zt.bild.dateiname);
  if (!pfadLiegtUnter(exportOrdner, voll)) {
    return { stand: 'ausserhalb', satz: 'Das Bild ' + zt.bild.dateiname +
      ' liegt nicht unter dem Export-Ordner.' };
  }
  let st;
  try {
    st = fs.statSync(voll);
  } catch (e) {
    return { stand: 'fehlt', satz: 'Das Bild ' + zt.bild.dateiname + ', auf das Zettel ' +
      zt.dateiname + ' zeigt, liegt nicht im Export-Ordner.' };
  }
  if (!st.isFile()) {
    return { stand: 'fehlt', satz: 'Das Bild ' + zt.bild.dateiname + ', auf das Zettel ' +
      zt.dateiname + ' zeigt, ist keine regulaere Datei.' };
  }
  if (st.size !== zt.bild.bytes) {
    return { stand: 'bytes_weichen_ab', gemessen_bytes: st.size,
      satz: 'Das Bild ' + zt.bild.dateiname + ' hat ' + st.size + ' Bytes, der Zettel ' +
        zt.dateiname + ' nennt ' + zt.bild.bytes + '.' };
  }
  if (!istKandidat) {
    return { stand: 'da', gemessen_bytes: st.size, sha256_geprueft: false,
      satz: 'Das Bild ' + zt.bild.dateiname + ' liegt da, mit der Groesse aus dem Zettel ' +
        '(sha256 nicht gerechnet: kein Kandidat).' };
  }
  const gemessen = sha256Datei(voll);
  if (gemessen !== zt.bild.sha256) {
    return { stand: 'sha256_weicht_ab', gemessen_bytes: st.size, gemessen_sha256: gemessen,
      sha256_geprueft: true,
      satz: 'Das Bild ' + zt.bild.dateiname + ' ist nicht mehr das, auf das Zettel ' +
        zt.dateiname + ' zeigt: der Zettel nennt eine andere sha256 als die Datei jetzt hat.' };
  }
  return { stand: 'stimmt', gemessen_bytes: st.size, gemessen_sha256: gemessen,
    sha256_geprueft: true,
    satz: 'Das Bild ' + zt.bild.dateiname + ' liegt da und stimmt mit dem Zettel ueberein ' +
      '(Groesse und sha256).' };
}

const BILD_UNGUELTIG = Object.freeze(['fehlt', 'ausserhalb', 'bytes_weichen_ab',
  'sha256_weicht_ab']);

function abbruch(befund, code, nach, satz) {
  befund.abbruch = { code, nach, satz };
}

function entscheide(befund, lage) {
  const { rang1, rang2, rang3, zettelListe, alleBilder, zettel } = lage;

  // (a) Zeilen 2 und 3: ein BESTAETIGTER Zettel dieser Aufnahme mit einem
  //     Format ohne Aufnahme oder ohne lesbares Format. Dahinter steht die
  //     Bestaetigung eines Menschen, die der Formatregel widerspricht, und das
  //     entscheidet keine Maschine.
  const bestaetigtMitFormatfehler = zettelListe.filter(
    (zt) => zt.lesbar && (zt.zeile === 2 || zt.zeile === 3));
  if (bestaetigtMitFormatfehler.length > 0) {
    abbruch(befund, 'bestaetigter_zettel_mit_formatfehler', '2.7',
      bestaetigtMitFormatfehler.map((zt) => zt.meldung).join(' '));
    return;
  }

  // (b) Ein Argument --zettel= waehlt unter den Kandidaten; ein Nicht-Kandidat
  //     wird auch per Argument nicht genommen (Vertrag 2.7, 7).
  let gewaehlteRang1 = rang1;
  let gewaehlteRang2 = rang2;
  if (zettel !== null) {
    const alle = rang1.concat(rang2);
    const treffer = alle.filter((zt) => zt.dateiname === zettel);
    if (treffer.length === 0) {
      const bekannt = zettelListe.find((zt) => zt.dateiname === zettel);
      abbruch(befund, 'zettel_argument_kein_kandidat', '2.7',
        'Der genannte Zettel ' + zettel + ' ist kein Kandidat dieses Laufs. ' +
        (bekannt
          ? (bekannt.lesbar ? bekannt.meldung : bekannt.meldung)
          : 'Eine Datei dieses Namens liegt nicht im Export-Ordner.') +
        ' Ein Zettel einer anderen Aufnahme, eines Formats ohne Aufnahme oder ein ' +
        'widerspruechlicher wird auch per Argument nicht genommen.');
      return;
    }
    gewaehlteRang1 = rang1.filter((zt) => zt.dateiname === zettel);
    gewaehlteRang2 = gewaehlteRang1.length > 0
      ? [] : rang2.filter((zt) => zt.dateiname === zettel);
  }

  // (c) Rang 1 -- die Regel.
  if (gewaehlteRang1.length > 1) {
    abbruch(befund, 'mehrere_rang1', '2.7',
      'Zwei oder mehr bestaetigte Zettel nennen diese Aufnahme; der Arbeiter waehlt nicht. ' +
      kandidatenzeilen(gewaehlteRang1) +
      ' Der Weg zurueck ist ein Neuaufruf mit --zettel=<dateiname>.');
    befund.rang = 1;
    befund.vorschlaege = gewaehlteRang1;
    return;
  }
  if (gewaehlteRang1.length === 1) {
    const zt = gewaehlteRang1[0];
    befund.rang = 1;
    if (BILD_UNGUELTIG.includes(zt.bildbefund.stand)) {
      abbruch(befund, 'kandidatenbild_ungueltig', '2.7',
        zt.bildbefund.satz + ' Der Zettel ist damit fuer diesen Lauf ungueltig; der Lauf ' +
        'faellt nicht still auf einen niedrigeren Rang zurueck. Ein Mensch entscheidet, ob ' +
        'er das Bild neu exportiert oder den Zettel wegnimmt.');
      return;
    }
    befund.regel = zt;
    if (zt.videotitel === null) {
      abbruch(befund, 'kein_videotitel', '2.8',
        'Zettel ' + zt.dateiname + ' traegt keinen videotitel. Es gibt kein Ersatzfeld und ' +
        'kein Argument fuer den Titel; der Weg zurueck ist der Compositor.');
    }
    return;
  }

  // (d) Rang 2 -- 2a und 2b als EINE Liste.
  if (gewaehlteRang2.length > 1) {
    abbruch(befund, 'mehrere_rang2', '2.7',
      'Zwei oder mehr Zettel kommen als Vorschlag in Frage; der Arbeiter waehlt nicht. ' +
      kandidatenzeilen(gewaehlteRang2) +
      ' Der Weg zurueck ist ein Neuaufruf mit --zettel=<dateiname>.');
    befund.rang = 2;
    befund.vorschlaege = gewaehlteRang2;
    return;
  }
  if (gewaehlteRang2.length === 1) {
    const zt = gewaehlteRang2[0];
    befund.rang = 2;
    befund.vorschlaege = gewaehlteRang2;
    if (BILD_UNGUELTIG.includes(zt.bildbefund.stand)) {
      abbruch(befund, 'kandidatenbild_ungueltig', '2.7',
        zt.bildbefund.satz + ' Der Zettel ist damit fuer diesen Lauf ungueltig; der Lauf ' +
        'faellt nicht still auf einen niedrigeren Rang zurueck. Ein Mensch entscheidet, ob ' +
        'er das Bild neu exportiert oder den Zettel wegnimmt.');
      return;
    }
    befund.vorschlag = zt;
    if (zt.videotitel === null) {
      abbruch(befund, 'kein_videotitel', '2.8',
        'Zettel ' + zt.dateiname + ' traegt keinen videotitel. Es gibt kein Ersatzfeld und ' +
        'kein Argument fuer den Titel; der Weg zurueck ist der Compositor.');
    }
    return;
  }

  // (e) Rang 3 -- Bilder ohne Zettel. Ein Argument fuer eine Bilddatei gibt es
  //     nicht; wurde --zettel= mitgegeben, ist der Lauf schon bei (b) zu Ende.
  if (rang3.length > 0) {
    befund.rang = 3;
    befund.vorschlaege = rang3;
    // Ein Bild ohne Zettel reicht fuer das Thumbnail, aber nicht fuer den
    // Upload: der Titel kommt aus einem Zettel, und keiner ist da (2.8).
    // "Bild gefunden" und "Upload moeglich" sind hier ausdruecklich zwei
    // Zustaende und sehen darum nicht gleich aus.
    abbruch(befund, 'rang3_kein_zettel_kein_titel', '2.8',
      'Das Bild ist bestimmt, aber der Titel muss aus einem Zettel kommen, und keiner ist ' +
      'da. ' + rang3.length + (rang3.length === 1 ? ' Bild ohne Zettel' : ' Bilder ohne Zettel') +
      ' im Fenster, juengstes zuerst: ' + rang3.map((b) => b.meldung).join(' '));
    return;
  }

  // (f) Kein Kandidat.
  befund.rang = null;
  const juengstesBild = alleBilder.slice()
    .sort((a, b) => b.mtime_ms - a.mtime_ms)[0] || null;
  abbruch(befund, 'kein_kandidat', '2.7',
    'Kein Kandidat fuer das Thumbnail. ' + befund.fenster.satz + ' ' +
    (juengstesBild
      ? 'Das juengste Bild im Export-Ordner ist ' + juengstesBild.dateiname + ' vom ' +
        juengstesBild.tag + '.'
      : 'Im Export-Ordner liegt kein Bild.'));
}

function kandidatenzeilen(liste) {
  return liste.map((zt) =>
    zt.dateiname + ' (exportiert ' + (zt.exportiert_am || 'ohne lesbaren Zeitpunkt') +
    ', Titel ' + JSON.stringify(zt.videotitel) +
    ', Datum ' + JSON.stringify(zt.datum) +
    ', Format ' + JSON.stringify(zt.format) +
    ', Herkunft ' + JSON.stringify(zt.aufnahme_herkunft) + ')').join('; ') + '.';
}

// ---------------------------------------------------------------------------
// Die Vorschau: woertlich, jeder Zettel mit seinem Ausgang, das Fenster und
// ob es geweitet wurde, die Kandidatenliste (Vertrag 4, Schritt 6).
// ---------------------------------------------------------------------------

function vorschau(befund) {
  const zeilen = [];
  zeilen.push('Aufnahme: ' + befund.aufnahme);
  zeilen.push(befund.fenster.satz);
  if (befund.fenster.geweitet) {
    zeilen.push('Die Weitung steht hier, weil sie stattgefunden hat, nicht als Formel: ' +
      'ohne sie gaebe es fuer diese Aufnahme keinen Kandidaten.');
  }
  zeilen.push('');
  zeilen.push('Zettel:');
  const genannte = befund.zettel.filter((zt) => zt.genannt);
  if (genannte.length === 0) zeilen.push('  (keiner zu nennen)');
  for (const zt of genannte) {
    zeilen.push('  [' + (zt.zeile === null ? '--' : String(zt.zeile).padStart(2)) + '] ' +
      zt.ausgang + ': ' + zt.meldung);
    if (zt.bildbefund) zeilen.push('       ' + zt.bildbefund.satz);
  }
  if (befund.zettel_ausserhalb_des_fensters > 0) {
    zeilen.push('  ' + befund.zettel_ausserhalb_des_fensters +
      ' weitere Zettel ausserhalb des Fensters (gezaehlt, nicht genannt).');
  }
  zeilen.push('');
  zeilen.push('Bilder ohne Zettel:');
  const genannteBilder = befund.bilder_ohne_zettel.filter((b) => b.genannt);
  if (genannteBilder.length === 0) zeilen.push('  (keines im Fenster)');
  for (const b of genannteBilder) zeilen.push('  [37] ' + b.ausgang + ': ' + b.meldung);
  if (befund.bilder_ausserhalb_des_fensters > 0) {
    zeilen.push('  ' + befund.bilder_ausserhalb_des_fensters +
      ' weitere Bilder ausserhalb des Fensters (gezaehlt, nicht genannt).');
  }
  zeilen.push('');
  if (befund.rang === null) {
    zeilen.push('Rang: keiner.');
  } else {
    zeilen.push('Rang: ' + befund.rang + '.');
  }
  if (befund.regel) {
    zeilen.push('Genommen (Regel, ohne Rueckfrage): ' + befund.regel.dateiname +
      ', Bild ' + befund.regel.bild.dateiname + ', sha256 ' + befund.regel.bild.sha256 + '.');
  }
  if (befund.vorschlag) {
    zeilen.push('Vorschlag (nie ohne Rueckfrage): ' + befund.vorschlag.dateiname +
      ', Bild ' + befund.vorschlag.bild.dateiname +
      ', sha256 ' + befund.vorschlag.bild.sha256 + '.' +
      (befund.vorschlag.durch_weitung ? ' Gefunden erst durch die Weitung des Fensters.' : ''));
  }
  if (!befund.vorschlag && befund.vorschlaege.length > 0) {
    zeilen.push('Vorschlagsliste, juengstes zuerst:');
    for (const k of befund.vorschlaege) {
      zeilen.push('  - ' + k.dateiname +
        (k.durch_weitung ? ' (gefunden erst durch die Weitung des Fensters)' : ''));
    }
  }
  if (befund.abbruch) {
    zeilen.push('');
    zeilen.push('ABBRUCH nach Vertrag ' + befund.abbruch.nach + ' (' + befund.abbruch.code +
      '): ' + befund.abbruch.satz);
  }
  return zeilen;
}

module.exports = {
  befundeKandidaten, vorschau,
  MATRIX, MATRIX_NACH_NR, IMMER_GENANNT, FENSTERABHAENGIG, zeileFuer,
  ZUGELASSENE_FORMATE, FORMATE_OHNE_AUFNAHME, HERKUNFT_WERTE,
  SCHEMA_VERSION, BILD_ENDUNGEN, ERLAUBTE_ANGABEN, BILD_UNGUELTIG,
  leseZettelText, achseHerkunft, achseName, achseFormat,
  tagVonAufnahme, tagVonInstant, zeitVonInstant, tagVerschoben,
};
