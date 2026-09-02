'use strict';

// DO: Der Uploader. Vierter Bewohner von src/upload/ -- und der erste, der den
// Kanal anfasst.
//
// Er liest die Planungsdatei EINER Aufnahme, prueft jeden Short noch einmal
// gegen die Platte, laedt ihn als PRIVATES Video mit dem publishAt aus dem Plan
// hoch und schreibt nach JEDEM Upload ein Gedaechtnis. Mehr nicht.
//
// WAS ER NICHT TUT -- und zwar so, dass man es im Quelltext sehen kann:
//   - kein videos.update, kein videos.delete, kein thumbnails.set, kein
//     playlistItems.*. Der einzige schreibende API-Aufruf dieses Moduls steht
//     in echterUpload() und heisst videos.insert. tests/uploader.test.cjs
//     zaehlt das nach.
//   - kein Einsammeln, kein Ordner absuchen. Er laedt genau die Shorts, die
//     im Plan stehen, in der Reihenfolge des Plans. Wer nichts benennt, laedt
//     nichts.
//   - der Plan wird nicht angefasst. Er ist der Beleg dessen, was hochgeladen
//     werden SOLLTE; das Gedaechtnis (data/uploads/<aufnahme>.json) ist der
//     Beleg dessen, was WURDE. Zwei Dateien, zwei Fragen.
//
// DIE HARTEN LINIEN:
//   - privacyStatus ist unten fest auf 'private' verdrahtet (PRIVACY_STATUS).
//     Kein Argument, keine Konfigurationsdatei und kein Feld des Plans kann
//     das aendern. Oeffentlich macht das Video allein YouTube zum publishAt --
//     nicht wir.
//   - Ein publishAt in der Vergangenheit wird NICHT hochgeladen. Der Lauf
//     bricht ab, bevor irgendein Video hochgeht. Ein abgelaufener Plan wird neu
//     geplant, nicht gebogen: YouTube veroeffentlicht ein Video mit
//     vergangenem publishAt sofort, und "sofort" ist genau die Uhrzeit, die
//     niemand geprueft hat.
//   - Vor jedem Upload wird die sha256 der Videodatei ERNEUT gegen die Platte
//     gerechnet. Weicht sie vom Plan ab, wird dieser Short uebersprungen und
//     der Lauf geht mit dem naechsten weiter. Zwischen Freigabe und Upload
//     koennen Stunden liegen, und am 30.08. wurden dieselben zehn Shorts
//     zweimal neu gebaut -- die Datei unter demselben Pfad ist dann eine
//     andere als die, die ein Mensch freigegeben hat.
//   - Die Aufnahme 2026-08-29 18-18-19 ist gesperrt, mit Begruendung, und
//     unabhaengig davon, dass der Planer sie schon sperrt. Die Sperre des
//     Planers schuetzt gegen einen Plan, den es nicht geben duerfte; diese
//     hier gegen einen, den jemand von Hand gelegt hat.
//
// VORGABE IST TROCKENLAUF. Ohne --execute passiert nichts, und der Trockenlauf
// macht keinen einzigen Netzaufruf -- er laedt nicht einmal googleapis. Das ist
// nachpruefbar: unter der Netzwache (data/backup-audit/netzwache.cjs) bleibt
// das Protokoll leer. Der Trockenlauf ist die Pruefung durch den Menschen: er
// zeigt je Short Titel, Hashtags einzeln mit Herleitung, publishAt in UTC und
// Ortszeit, Dateipfad und Pruefsummenstand. Die Hashtags sind das einzige
// Hergeleitete in der ganzen Kette; deshalb stehen sie dort vollstaendig und
// lesbar, bevor irgendetwas hochgeht.
//
// DT: VON DER BESCHREIBUNG STEHT JE SHORT NUR, WAS SICH UNTERSCHEIDET -- die
// erste Zeile (der Titel) und die Hashtag-Zeile am Schluss. Der Teil
// dazwischen ist bei allen derselbe und steht EINMAL, am Ende, vollstaendig
// und im Wortlaut. Er faellt nicht weg: er ist die einzige Stelle, an der ein
// Mensch sieht, was unter jedem Video steht. Dass er wirklich bei allen gleich
// ist, wird Zeichen fuer Zeichen geprueft und nicht angenommen -- weicht einer
// ab, faellt die Zusammenfassung aus und jede Beschreibung steht wieder
// einzeln da. Der Grund fuer die Kuerzung steht bei formatiereVorschau().

const { pruefeArgumenteStrikt, TROCKENLAUF_FLAG } = require('../publish/cli-args');

// pruefeArgumenteStrikt als ALLERERSTE Anweisung -- vor jedem Lesen, vor jedem
// Netzaufruf (CY Teil B). pruefeKeineFreienArgumente kommt aus dem Leser und
// ist NICHT nachgebaut; der Grund steht dort: --plan=2026-08-31 17-36-21 ohne
// Anfuehrungszeichen zerfaellt in zwei Argumente.
const ERLAUBTE_ARGUMENTE = [
  '--plan=', '--anzahl=', '--execute', '--bestaetigt-durch=', '--vorschau-json',
  TROCKENLAUF_FLAG,
];

const {
  pruefeKeineFreienArgumente, AUFNAHME_FORM, EXIT,
  uebergabedateiPfad, parseStreng, pruefeKopf, pfadLiegtUnter,
} = require('./uebergabe-leser');

if (require.main === module) {
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/upload/uploader.js');
  pruefeKeineFreienArgumente(process.argv, 'src/upload/uploader.js', '--plan=');
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

// Die Zeitdarstellung kommt aus dem Planer, damit ein Termin hier genauso
// aussieht wie dort. Die Konstanten des Plans ebenfalls: der Uploader liest,
// was der Planer schreibt, und zwar nach dessen Regeln.
const {
  ortszeitText, PLAN_ARTIFACT_TYPE, PLAN_SCHEMA_VERSION,
  GESPERRTE_AUFNAHMEN: SPERREN_DES_PLANERS,
} = require('./planer');

// Die Rueckgabewerte kommen aus der EINEN Tabelle in uebergabe-leser.js
// (DNa Punkt 2). KEINE_ANTWORT (4) war dort reserviert fuer genau diesen
// Fall: es konnte nicht gefragt werden. Hier kommt er zurueck.
const EXIT_OK = EXIT.OK;
const EXIT_BEFUND = EXIT.BEFUND;
const EXIT_AUFRUFFEHLER = EXIT.AUFRUF;
const EXIT_GESPERRT = EXIT.GESPERRT;
const EXIT_KEINE_ANTWORT = EXIT.KEINE_ANTWORT;

// ---------------------------------------------------------------------------
// DIE REGEL IN ZAHLEN UND ZEICHENKETTEN
// ---------------------------------------------------------------------------

// HART. Der einzige Wert, der hier je stehen darf. Er wird unten in
// echterUpload() woertlich eingesetzt und nirgends aus einer Variablen,
// einem Argument oder einer Datei bezogen.
const PRIVACY_STATUS = 'private';

// Die Grenzen der YouTube-API (videos-Ressource, snippet.title und
// snippet.description). Jede Verletzung bricht den Lauf ab, BEVOR irgendein
// Video hochgeht -- nicht mittendrin beim betroffenen.
//   Titel: hoechstens 100 Zeichen, ohne < und >.
//   Beschreibung: hoechstens 5000 -- die API-Dokumentation sagt "5000 bytes",
//     der Auftrag sagt 5000 Zeichen. Geprueft wird BEIDES, das strengere gilt.
//     Ebenfalls ohne < und >.
//   Hashtags: hoechstens 15. Ab dem sechzehnten ignoriert YouTube ALLE, und
//     zwar Titel und Beschreibung zusammengezaehlt.
const TITEL_MAX_ZEICHEN = 100;

// DR: WIE EIN TITEL GEZAEHLT WIRD -- UND WORAN DAS FESTGEMACHT IST.
//
// Bis DR zaehlte diese Datei mit `titel.length`, also UTF-16-Einheiten, und die
// Freigabeseite mit Array.from(), also Codepunkte. Bei einem Titel mit einem
// Emoji standen damit 57 gegen 102: die Seite haette ihn angenommen, der
// Uploader ihn abgewiesen -- und zwar erst nach der Freigabe, also an der
// spaetestmoeglichen Stelle. Heute traegt kein Titel ein Emoji; das ist ein
// Zufall und keine Zusage.
//
// GEMESSEN, NICHT ANGENOMMEN. Die Dokumentation der YouTube Data API sagt zu
// snippet.title nur "100 characters" und laesst offen, was ein character ist.
// Die Antwort steht in data/inventory.json -- 998 Titel, die YouTube fuer
// diesen Kanal tatsaechlich ANGENOMMEN hat:
//
//   groesster Titel in UTF-16-Einheiten:  148   (39 Titel liegen ueber 100)
//   groesster Titel in Codepunkten:       100   (kein einziger darueber)
//   groesster Titel in Graphemclustern:   100   (kein einziger darueber)
//
// Ein Titel mit 148 UTF-16-Einheiten steht auf dem Kanal. Waeren UTF-16-
// Einheiten die gezaehlte Einheit, gaebe es ihn nicht. Damit ist diese
// Moeglichkeit ausgeschlossen -- nicht fuer wahrscheinlich gehalten, sondern
// durch ein Gegenbeispiel erledigt.
//
// Codepunkte und Graphemcluster sind an diesen Daten NICHT zu unterscheiden:
// beide Zaehlweisen erreichen genau 100 und ueberschreiten es nie. Gezaehlt
// werden deshalb CODEPUNKTE, denn von den beiden verbliebenen ist das die
// strengere -- ein Text hat nie mehr Graphemcluster als Codepunkte. Ist in
// Wahrheit der Grapheme-Cluster gemeint, lehnt diese Zaehlung hoechstens einen
// Titel zu frueh ab; nie einen zu spaet.
//
// WOHIN DER IRRTUM FIELE, wenn die Messung doch trueg: ein zu langer Titel
// laesst videos.insert mit einem Fehler der API scheitern. Es geht dann nichts
// Falsches hoch -- es geht gar nichts hoch. Das ist der Ausgang, den man
// riskieren darf.
//
// DIESE FUNKTION IST DIE EINZIGE ZAEHLSTELLE. freigabe-server.js ruft sie
// hier ab, statt eine zweite zu haben; die Seite zaehlt mit demselben
// Array.from() im Browser, damit die Anzeige unter dem Feld dasselbe sagt.
function zaehleTitelZeichen(titel) {
  return Array.from(String(titel)).length;
}

const BESCHREIBUNG_MAX_ZEICHEN = 5000;
const BESCHREIBUNG_MAX_BYTES = 5000;
const HASHTAGS_MAX = 15;
const VERBOTENE_ZEICHEN = /[<>]/;
// Ein Hashtag, wie YouTube ihn zaehlt: # gefolgt von Buchstaben, Ziffern
// oder Unterstrich.
const HASHTAG_IM_TEXT = /#[\p{L}\p{N}_]+/gu;

// Mindestvorlauf: publishAt muss so weit in der Zukunft liegen, dass der
// Upload selbst noch davor fertig wird. Ein publishAt, das waehrend des
// Hochladens verstreicht, ist ein publishAt in der Vergangenheit -- nur
// spaeter bemerkt.
const MINDESTVORLAUF_MS = 5 * 60 * 1000;

// Pause zwischen zwei Uploads.
const PAUSE_MS = 5000;

// Die Bestaetigung.
const BESTAETIGUNGSWORT = 'HOCHLADEN';
const MAX_NACHFRAGEN = 2;

// Die Konfiguration, die ein Mensch bearbeitet (Teil 1).
const BESCHREIBUNG_DATEI = path.join('config', 'shorts-beschreibung.txt');
const HASHTAGS_DATEI = path.join('config', 'shorts-hashtags.json');
const VEROEFFENTLICHUNG_DATEI = path.join('config', 'shorts-veroeffentlichung.json');

// Solange dieser Marker in der Beschreibungsdatei steht, wird nichts
// hochgeladen. Er steht in der ersten Zeile der ausgelieferten Datei.
const VORLAGEN_MARKER = '>>> VORLAGE -- DIESEN TEXT ERSETZEN <<<';
// DP PUNKT 3: DER PLATZHALTER IN ECKIGEN KLAMMERN.
//
// Joshuas Vorlage trug [DISCORD-LINK] und [MEMBERSHIP-LINK] -- Stellen, an die
// ein Mensch etwas eintragen sollte. Wird eine davon vergessen, steht sie
// hinterher unter jedem Video. Das ist derselbe Fehler wie der Vorlagenmarker,
// nur kleiner und darum leichter zu uebersehen: der Marker steht in der ersten
// Zeile, [MEMBERSHIP-LINK] in der Mitte eines Linkblocks.
//
// GEPRUEFT WIRD DIE FERTIGE BESCHREIBUNG, nicht die Vorlage. Zwei Gruende: der
// Titel aus dem Plan koennte selbst so eine Zeichenfolge tragen, und die
// Vorlage koennte eine Stelle haben, die erst durch das Einsetzen entsteht.
//
// DIE FORM: eckige Klammer, darin nur GROSSBUCHSTABEN, Ziffern, Unterstrich und
// Bindestrich, mindestens ein Buchstabe, mindestens zwei Zeichen. Das trifft
// [PLATZHALTER], [DISCORD-LINK] und [MEMBERSHIP-LINK].
//
// WAS SIE ABSICHTLICH NICHT TRIFFT: Fliesstext in eckigen Klammern wie
// "[1-2 Saetze zum Video]" -- der enthaelt Kleinbuchstaben. Eine Regel, die
// jede eckige Klammer verbietet, waere eine Regel gegen normale Zeichensetzung;
// sie wuerde bei einer Quellenangabe "[2]" anschlagen und dann abgeschaltet.
// Eine Regel, die nur abgeschaltet wird, schuetzt nichts. Diese hier trifft die
// Form, in der Platzhalter tatsaechlich geschrieben werden.
//
// \p{Lu} statt A-Z, damit auch [GRUSS-ÜBERSCHRIFT] auffaellt.
const ECKIGER_PLATZHALTER = /\[(?=[^\]\n]*\p{Lu})[\p{Lu}\p{N}_-]{2,}\]/gu;

const BEKANNTE_PLATZHALTER = ['titel', 'hashtags'];
const PLATZHALTER_FORM = /\{([^{}\n]*)\}/g;

// Das Gedaechtnis (Teil 2).
const GEDAECHTNIS_ARTIFACT_TYPE = 'adw_shorts_uploads';
const GEDAECHTNIS_SCHEMA_VERSION = '1.0';
const BEKANNTE_PLAN_VERSIONEN = [PLAN_SCHEMA_VERSION];

const SHA256_FORM = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// ---------------------------------------------------------------------------
// DIE SPERRE
// ---------------------------------------------------------------------------
//
// Dieselbe Bauart wie im Planer, und ABSICHTLICH eine eigene Liste: zwei
// Sperren an zwei Stellen. Der Planer sperrt das Planen; wer die Sperre dort
// umgeht, indem er eine Planungsdatei von Hand nach data/plaene/ legt, laeuft
// hier in die zweite. Die Selbstpruefung unten verlangt ausserdem, dass jede
// Sperre des Planers auch hier steht -- eine Aufnahme, die der Planer nicht
// planen darf, darf der Uploader erst recht nicht hochladen, und wer im
// Planer eine Sperre eintraegt, ohne sie hier einzutragen, bekommt keinen
// stillen Durchlauf, sondern einen Abbruch mit Begruendung.
//
// WIE EINE AUFNAHME HINEINKOMMT, WER SIE HERAUSNIMMT: siehe den Kommentar an
// GESPERRTE_AUFNAHMEN in planer.js. Es gibt auch hier kein Flag, das die
// Sperre uebergeht.
const GESPERRTE_AUFNAHMEN = [
  {
    aufnahme: '2026-08-29 18-18-19',
    grund:
      'Diese Aufnahme stammt aus der Zeit VOR dem Korrekturlauf der Shorts-Linie. ' +
      'Ihre Shorts sind fehlerhaft geschnitten und duerfen nie veroeffentlicht ' +
      'werden. Der Planer sperrt sie bereits; diese zweite Sperre steht hier, ' +
      'weil eine Planungsdatei auch von Hand nach data/plaene/ gelegt werden ' +
      'kann -- und am Inhalt einer solchen Datei ist nicht zu sehen, dass sie ' +
      'nie haette entstehen duerfen.',
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
      fehler.push('Sperreintrag ' + JSON.stringify(s.aufnahme) + ' hat keine brauchbare Begruendung');
    }
    if (gesehen.has(s.aufnahme)) {
      fehler.push('Sperreintrag ' + JSON.stringify(s.aufnahme) + ' steht doppelt');
    }
    gesehen.add(s.aufnahme);
  }
  for (const p of SPERREN_DES_PLANERS) {
    if (!gesehen.has(p.aufnahme)) {
      fehler.push('Der Planer sperrt ' + JSON.stringify(p.aufnahme) +
        ', der Uploader nicht. Die Sperre gehoert an beide Stellen; bis sie hier ' +
        'steht, laedt der Uploader gar nichts hoch.');
    }
  }
  return fehler;
}

function sperreFuer(aufnahme) {
  return GESPERRTE_AUFNAHMEN.find((s) => s.aufnahme === aufnahme) || null;
}

// ---------------------------------------------------------------------------
// TEIL 1 -- DIE KONFIGURATION, DIE EIN MENSCH BEARBEITET
// ---------------------------------------------------------------------------

// Die Beschreibungsvorlage. Roher Text, UTF-8. Gibt { fehler } oder
// { fehler: [], vorlage, platzhalter }.
function leseBeschreibungsvorlage(roh) {
  const fehler = [];
  let text = String(roh);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  text = text.replace(/\r\n?/g, '\n');

  if (text.includes(VORLAGEN_MARKER)) {
    fehler.push('Die Beschreibungsdatei ' + BESCHREIBUNG_DATEI + ' ist noch die VORLAGE: ' +
      'sie enthaelt die Zeile ' + JSON.stringify(VORLAGEN_MARKER) + '. Solange die dort ' +
      'steht, wird nichts hochgeladen. Den Text durch die echte Beschreibung ersetzen -- ' +
      'einschliesslich dieser Zeile.');
    return { fehler };
  }
  if (!text.trim()) {
    fehler.push('Die Beschreibungsdatei ' + BESCHREIBUNG_DATEI + ' ist leer.');
    return { fehler };
  }
  const platzhalter = [];
  const unbekannt = [];
  for (const m of text.matchAll(PLATZHALTER_FORM)) {
    const name = m[1];
    if (BEKANNTE_PLATZHALTER.includes(name)) { if (!platzhalter.includes(name)) platzhalter.push(name); }
    else if (!unbekannt.includes(m[0])) unbekannt.push(m[0]);
  }
  if (unbekannt.length) {
    fehler.push('Die Beschreibungsdatei ' + BESCHREIBUNG_DATEI + ' enthaelt unbekannte ' +
      'Platzhalter: ' + unbekannt.join(', ') + '. Bekannt sind {' +
      BEKANNTE_PLATZHALTER.join('}, {') + '}. Ein unbekannter Platzhalter ist ein Fehler ' +
      'und kein Text, der stillschweigend stehenbleibt.');
    return { fehler };
  }
  return { fehler: [], vorlage: text, platzhalter };
}

// Baut aus Vorlage, Titel und Hashtags die FERTIGE Beschreibung -- genau den
// Text, der unter dem Video stuende.
function fuelleBeschreibung(vorlage, titel, hashtags) {
  const tags = hashtags.map((h) => '#' + h).join(' ');
  const hatTitel = vorlage.includes('{titel}');
  const hatHashtags = vorlage.includes('{hashtags}');
  let text = vorlage;
  if (hatTitel) text = text.split('{titel}').join(titel);
  if (hatHashtags) text = text.split('{hashtags}').join(tags);
  else if (tags) text = text.replace(/\s+$/, '') + '\n\n' + tags;
  return text.replace(/\s+$/, '');
}

// Die Hashtag-Zuordnung. Streng gelesen: was nicht der bekannten Form
// entspricht, wird abgelehnt, nicht zurechtgebogen. Gibt { fehler } oder
// { fehler: [], immer, gruppen }.
const HASHTAG_FORM = /^[\p{L}\p{N}_]+$/u;

function leseHashtagKonfiguration(text) {
  const fehler = [];
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return { fehler: [HASHTAGS_DATEI + ' ist kein JSON: ' + e.message] };
  }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return { fehler: [HASHTAGS_DATEI + ' enthaelt kein Objekt.'] };
  }
  for (const k of Object.keys(d)) {
    if (!['erklaerung', 'immer', 'gruppen'].includes(k)) {
      fehler.push(HASHTAGS_DATEI + ': unbekanntes Feld ' + JSON.stringify(k) +
        '. Erlaubt sind erklaerung, immer, gruppen.');
    }
  }
  const pruefeHashtags = (liste, wo) => {
    if (!Array.isArray(liste)) { fehler.push(HASHTAGS_DATEI + ': ' + wo + ' ist keine Liste.'); return []; }
    const raus = [];
    liste.forEach((h, i) => {
      if (typeof h !== 'string' || !h.trim()) {
        fehler.push(HASHTAGS_DATEI + ': ' + wo + '[' + i + '] ist kein Text.'); return;
      }
      if (h.startsWith('#')) {
        fehler.push(HASHTAGS_DATEI + ': ' + wo + '[' + i + '] = ' + JSON.stringify(h) +
          ' -- ohne #-Zeichen eintragen, das setzt der Uploader.'); return;
      }
      if (!HASHTAG_FORM.test(h)) {
        fehler.push(HASHTAGS_DATEI + ': ' + wo + '[' + i + '] = ' + JSON.stringify(h) +
          ' ist kein Hashtag (nur Buchstaben, Ziffern, Unterstrich; keine Leerzeichen).'); return;
      }
      raus.push(h);
    });
    return raus;
  };
  const pruefeStichwoerter = (liste, wo) => {
    if (!Array.isArray(liste)) { fehler.push(HASHTAGS_DATEI + ': ' + wo + ' ist keine Liste.'); return []; }
    const raus = [];
    liste.forEach((s, i) => {
      if (typeof s !== 'string' || !s.trim()) {
        fehler.push(HASHTAGS_DATEI + ': ' + wo + '[' + i + '] ist kein Text.'); return;
      }
      if (woerter(s).length === 0) {
        fehler.push(HASHTAGS_DATEI + ': ' + wo + '[' + i + '] = ' + JSON.stringify(s) +
          ' enthaelt kein Wort.'); return;
      }
      raus.push(s);
    });
    return raus;
  };

  const immer = pruefeHashtags(d.immer, 'immer');
  const gruppen = [];
  if (!Array.isArray(d.gruppen)) {
    fehler.push(HASHTAGS_DATEI + ': gruppen ist keine Liste.');
  } else {
    const namen = new Set();
    d.gruppen.forEach((g, i) => {
      const wo = 'gruppen[' + i + ']';
      if (g === null || typeof g !== 'object' || Array.isArray(g)) {
        fehler.push(HASHTAGS_DATEI + ': ' + wo + ' ist kein Objekt.'); return;
      }
      for (const k of Object.keys(g)) {
        if (!['name', 'stichwoerter', 'hashtags'].includes(k)) {
          fehler.push(HASHTAGS_DATEI + ': ' + wo + ' hat ein unbekanntes Feld ' + JSON.stringify(k) + '.');
        }
      }
      if (typeof g.name !== 'string' || !g.name.trim()) {
        fehler.push(HASHTAGS_DATEI + ': ' + wo + '.name fehlt.'); return;
      }
      if (namen.has(g.name)) fehler.push(HASHTAGS_DATEI + ': der Gruppenname ' + JSON.stringify(g.name) + ' steht doppelt.');
      namen.add(g.name);
      gruppen.push({
        name: g.name,
        stichwoerter: pruefeStichwoerter(g.stichwoerter, wo + '.stichwoerter'),
        hashtags: pruefeHashtags(g.hashtags, wo + '.hashtags'),
      });
    });
  }
  if (fehler.length) return { fehler };
  return { fehler: [], immer, gruppen };
}

// Woerter eines Textes: zusammenhaengende Buchstaben und Ziffern, klein
// geschrieben. "Hype:" wird zu "hype", "BTC/USD" zu "btc" und "usd",
// "BTCUSD" bleibt EIN Wort -- und trifft darum "btc" nicht.
function woerter(text) {
  return (String(text).match(/[\p{L}\p{N}]+/gu) || []).map((w) => w.toLocaleLowerCase('de'));
}

// Trifft das Stichwort den Titel? Nur als ganze Wortfolge. Kein Raten, keine
// Teiltreffer mitten im Wort.
function stichwortTrifft(titelWoerter, stichwort) {
  const s = woerter(stichwort);
  if (!s.length) return false;
  for (let i = 0; i + s.length <= titelWoerter.length; i++) {
    let alle = true;
    for (let j = 0; j < s.length; j++) {
      if (titelWoerter[i + j] !== s[j]) { alle = false; break; }
    }
    if (alle) return true;
  }
  return false;
}

// Ordnet einem Titel seine Hashtags zu. Gibt { hashtags, herleitung }; die
// Herleitung sagt zu jedem Hashtag, woher er kommt -- das ist der Teil, den
// der Trockenlauf einem Menschen zeigt.
function zuordneHashtags(titel, konfig) {
  const tw = woerter(titel);
  const hashtags = [];
  const herleitung = [];
  const gesehen = new Set();
  const nimm = (h, quelle) => {
    const k = h.toLocaleLowerCase('de');
    if (gesehen.has(k)) return;
    gesehen.add(k);
    hashtags.push(h);
    herleitung.push({ hashtag: h, quelle });
  };
  for (const g of konfig.gruppen) {
    const treffer = g.stichwoerter.find((s) => stichwortTrifft(tw, s));
    if (treffer === undefined) continue;
    for (const h of g.hashtags) nimm(h, 'Gruppe ' + JSON.stringify(g.name) + ', Stichwort ' + JSON.stringify(treffer) + ' im Titel');
  }
  for (const h of konfig.immer) nimm(h, 'immer');
  return { hashtags, herleitung };
}

// Die Felder, die fuer alle Shorts gleich sind.
const VEROEFFENTLICHUNG_FELDER = ['categoryId', 'defaultLanguage', 'defaultAudioLanguage', 'selfDeclaredMadeForKids'];

function leseVeroeffentlichung(text) {
  const fehler = [];
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return { fehler: [VEROEFFENTLICHUNG_DATEI + ' ist kein JSON: ' + e.message] };
  }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return { fehler: [VEROEFFENTLICHUNG_DATEI + ' enthaelt kein Objekt.'] };
  }
  for (const k of Object.keys(d)) {
    if (k !== 'erklaerung' && !VEROEFFENTLICHUNG_FELDER.includes(k)) {
      fehler.push(VEROEFFENTLICHUNG_DATEI + ': unbekanntes Feld ' + JSON.stringify(k) +
        (k === 'privacyStatus'
          ? '. privacyStatus steht in keiner Datei: er ist im Uploader fest auf "private" verdrahtet.'
          : '. Erlaubt sind ' + VEROEFFENTLICHUNG_FELDER.join(', ') + '.'));
    }
  }
  if (typeof d.categoryId !== 'string' || !/^\d+$/.test(d.categoryId)) {
    fehler.push(VEROEFFENTLICHUNG_DATEI + ': categoryId muss eine Zahl in Anfuehrungszeichen sein, z. B. "27".');
  }
  for (const f of ['defaultLanguage', 'defaultAudioLanguage']) {
    if (typeof d[f] !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(d[f])) {
      fehler.push(VEROEFFENTLICHUNG_DATEI + ': ' + f + ' muss ein Sprachkuerzel sein, z. B. "de" oder "de-DE".');
    }
  }
  if (typeof d.selfDeclaredMadeForKids !== 'boolean') {
    fehler.push(VEROEFFENTLICHUNG_DATEI + ': selfDeclaredMadeForKids muss true oder false sein.');
  }
  if (fehler.length) return { fehler };
  const felder = {};
  for (const f of VEROEFFENTLICHUNG_FELDER) felder[f] = d[f];
  return { fehler: [], felder };
}

function ladeKonfiguration(projektwurzel) {
  const fehler = [];
  const lies = (rel) => {
    const p = path.join(projektwurzel, rel);
    try { return fs.readFileSync(p, 'utf8'); } catch (e) {
      fehler.push('Konfigurationsdatei nicht lesbar (' + (e.code || e.message) + '): ' + p);
      return null;
    }
  };
  const b = lies(BESCHREIBUNG_DATEI);
  const h = lies(HASHTAGS_DATEI);
  const v = lies(VEROEFFENTLICHUNG_DATEI);
  if (fehler.length) return { fehler };
  const vorlage = leseBeschreibungsvorlage(b);
  const hashtags = leseHashtagKonfiguration(h);
  const veroeffentlichung = leseVeroeffentlichung(v);
  fehler.push(...vorlage.fehler, ...hashtags.fehler, ...veroeffentlichung.fehler);
  if (fehler.length) return { fehler };
  return {
    fehler: [],
    beschreibung: vorlage,
    hashtags: { immer: hashtags.immer, gruppen: hashtags.gruppen },
    veroeffentlichung: veroeffentlichung.felder,
  };
}

// ---------------------------------------------------------------------------
// DIE GRENZEN DER API
// ---------------------------------------------------------------------------

function zaehleHashtags(text) {
  return (String(text).match(HASHTAG_IM_TEXT) || []).length;
}

// Prueft Titel und FERTIGE Beschreibung eines Shorts. Gibt eine Liste von
// Verstoessen, jeder mit eigener Meldung. Leer = in Ordnung.
function pruefeGrenzen({ kennung, titel, beschreibung }) {
  const fehler = [];
  const wo = kennung + ': ';
  // Codepunkte, nicht UTF-16-Einheiten -- die Begruendung steht an
  // zaehleTitelZeichen, und sie ist an 998 echten Kanaltiteln gemessen.
  const titelZeichen = zaehleTitelZeichen(titel);
  if (titelZeichen > TITEL_MAX_ZEICHEN) {
    fehler.push(wo + 'der Titel hat ' + titelZeichen + ' Zeichen, erlaubt sind hoechstens ' +
      TITEL_MAX_ZEICHEN + '.');
  }
  if (VERBOTENE_ZEICHEN.test(titel)) {
    fehler.push(wo + 'der Titel enthaelt < oder >. Beides laesst die YouTube-API nicht zu.');
  }
  const zeichen = beschreibung.length;
  const bytes = Buffer.byteLength(beschreibung, 'utf8');
  if (zeichen > BESCHREIBUNG_MAX_ZEICHEN || bytes > BESCHREIBUNG_MAX_BYTES) {
    fehler.push(wo + 'die fertige Beschreibung hat ' + zeichen + ' Zeichen (' + bytes +
      ' Bytes in UTF-8), erlaubt sind hoechstens ' + BESCHREIBUNG_MAX_ZEICHEN + ' Zeichen ' +
      'bzw. ' + BESCHREIBUNG_MAX_BYTES + ' Bytes.');
  }
  if (VERBOTENE_ZEICHEN.test(beschreibung)) {
    fehler.push(wo + 'die fertige Beschreibung enthaelt < oder >. Beides laesst die YouTube-API nicht zu.');
  }
  // DP PUNKT 3. Die Fundstelle wird im Klartext genannt: "es steht noch ein
  // Platzhalter drin" schickt einen Menschen in eine 2500 Zeichen lange Datei
  // auf die Suche. Der Name sagt ihm sofort, welche Zeile gemeint ist.
  const eckige = [];
  for (const m of beschreibung.matchAll(ECKIGER_PLATZHALTER)) {
    if (!eckige.includes(m[0])) eckige.push(m[0]);
  }
  if (eckige.length) {
    fehler.push(wo + 'in der fertigen Beschreibung steht noch ' +
      (eckige.length === 1 ? 'ein Platzhalter' : eckige.length + ' Platzhalter') +
      ' in eckigen Klammern: ' + eckige.join(', ') + '. Das ist eine Stelle, an die ein ' +
      'Mensch etwas eintragen sollte -- sie geht nicht hoch. Eine Vorlage zu ' +
      'veroeffentlichen ist ein Fehler, den man genau einmal macht. Zu aendern in ' +
      BESCHREIBUNG_DATEI + '. (Die geschweiften Platzhalter {titel} und {hashtags} sind ' +
      'davon nicht betroffen: sie sind zu diesem Zeitpunkt bereits ersetzt.)');
  }
  const tags = zaehleHashtags(titel) + zaehleHashtags(beschreibung);
  if (tags > HASHTAGS_MAX) {
    fehler.push(wo + 'Titel und Beschreibung tragen zusammen ' + tags + ' Hashtags, erlaubt sind ' +
      'hoechstens ' + HASHTAGS_MAX + '. Ab dem sechzehnten ignoriert YouTube ALLE Hashtags des Videos.');
  }
  return fehler;
}

// Alles, was fuer einen Termin an YouTube ginge -- aus Plan und Konfiguration.
function baueMetadaten(termin, konfig) {
  const z = zuordneHashtags(termin.titel, konfig.hashtags);
  const beschreibung = fuelleBeschreibung(konfig.beschreibung.vorlage, termin.titel, z.hashtags);
  return {
    titel: termin.titel,
    beschreibung,
    hashtags: z.hashtags,
    herleitung: z.herleitung,
    verstoesse: pruefeGrenzen({ kennung: termin.kennung, titel: termin.titel, beschreibung }),
  };
}

// ---------------------------------------------------------------------------
// DER PLAN LESEN
// ---------------------------------------------------------------------------

function planPfad(projektwurzel, aufnahme) {
  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new Error('Aufnahmename hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '. Es wird kein Dateiname daraus gebaut.');
  }
  return path.join(projektwurzel, 'data', 'plaene', aufnahme + '.json');
}

// Streng. Gibt { fehler } oder { fehler: [], plan, sha256 }.
function lesePlan(text, aufnahme) {
  const fehler = [];
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return { fehler: ['Die Planungsdatei ist kein JSON: ' + e.message] };
  }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return { fehler: ['Die Planungsdatei enthaelt kein Objekt.'] };
  }
  if (d.artifact_type !== PLAN_ARTIFACT_TYPE) {
    fehler.push('artifact_type ist ' + JSON.stringify(d.artifact_type) + ', erwartet ' +
      JSON.stringify(PLAN_ARTIFACT_TYPE) + '.');
  }
  if (!BEKANNTE_PLAN_VERSIONEN.includes(d.schema_version)) {
    fehler.push('schema_version ist ' + JSON.stringify(d.schema_version) + '; bekannt sind ' +
      BEKANNTE_PLAN_VERSIONEN.join(', ') + '. Eine fremde Fassung wird nicht nach den Regeln ' +
      'der bekannten gelesen.');
  }
  if (d.aufnahme !== aufnahme) {
    fehler.push('Die Planungsdatei nennt die Aufnahme ' + JSON.stringify(d.aufnahme) +
      ', angefragt war ' + JSON.stringify(aufnahme) + '.');
  }
  if (d.verbindlich !== 'publish_at') {
    fehler.push('Die Planungsdatei sagt nicht, dass publish_at verbindlich ist (verbindlich=' +
      JSON.stringify(d.verbindlich) + ').');
  }
  if (!Array.isArray(d.termine)) {
    fehler.push('termine ist keine Liste.');
    return { fehler };
  }
  if (d.termine.length === 0) {
    fehler.push('termine ist leer. Ein Plan ohne Termine wird nicht hochgeladen -- er sieht aus ' +
      'wie ein abgearbeiteter.');
  }
  const gesehen = new Set();
  d.termine.forEach((t, i) => {
    const wo = 'termine[' + i + ']';
    if (t === null || typeof t !== 'object') { fehler.push(wo + ' ist kein Objekt.'); return; }
    if (typeof t.sha256 !== 'string' || !SHA256_FORM.test(t.sha256)) {
      fehler.push(wo + '.sha256 ist keine sha256-Summe.'); return;
    }
    if (gesehen.has(t.sha256)) { fehler.push(wo + '.sha256 steht ein zweites Mal im Plan.'); return; }
    gesehen.add(t.sha256);
    if (typeof t.kennung !== 'string' || !t.kennung.trim()) fehler.push(wo + '.kennung fehlt.');
    if (typeof t.titel !== 'string' || !t.titel.trim()) fehler.push(wo + '.titel fehlt.');
    if (typeof t.publish_at !== 'string' || !ISO_UTC.test(t.publish_at) ||
        !Number.isFinite(Date.parse(t.publish_at))) {
      fehler.push(wo + '.publish_at ist kein Zeitstempel in UTC (RFC 3339 mit Z): ' +
        JSON.stringify(t.publish_at) + '.');
    }
  });
  if (fehler.length) return { fehler };
  return { fehler: [], plan: d, sha256: sha256Text(text) };
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// TEIL 2 -- DAS GEDAECHTNIS
// ---------------------------------------------------------------------------
//
// data/uploads/<aufnahme>.json. Schluessel je Eintrag ist die sha256 -- so
// will es der Vertrag, nicht die Kennung: die Kennung benennt einen Platz in
// der Lieferung, die sha256 benennt den Inhalt. Wird ein Short neu gebaut,
// behaelt er seine Kennung und verliert seine sha256; hochgeladen war der
// Inhalt, nicht der Platz.

function gedaechtnisPfad(projektwurzel, aufnahme) {
  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new Error('Aufnahmename hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '. Es wird kein Dateiname daraus gebaut.');
  }
  return path.join(projektwurzel, 'data', 'uploads', aufnahme + '.json');
}

function neuesGedaechtnis(aufnahme, planSha256, jetzt) {
  return {
    artifact_type: GEDAECHTNIS_ARTIFACT_TYPE,
    schema_version: GEDAECHTNIS_SCHEMA_VERSION,
    aufnahme,
    plan_datei: 'data/plaene/' + aufnahme + '.json',
    plan_sha256: planSha256,
    angelegt_am: new Date(jetzt).toISOString(),
    zuletzt_geschrieben_am: new Date(jetzt).toISOString(),
    uploads: [],
  };
}

// Liest das Gedaechtnis, wenn es eines gibt. Gibt { fehler } oder
// { fehler: [], gedaechtnis } -- gedaechtnis ist null, wenn noch nichts
// hochgeladen wurde.
//
// DAS GEDAECHTNIS MUSS ZUM PLAN PASSEN. Steht darin eine andere Plan-sha256,
// wurde der Plan nach dem ersten Upload veraendert oder ersetzt. Dann ist
// nicht mehr zu sagen, ob "schon hochgeladen" noch dasselbe meint -- Abbruch.
function leseGedaechtnis(projektwurzel, aufnahme, planSha256) {
  const p = gedaechtnisPfad(projektwurzel, aufnahme);
  if (!fs.existsSync(p)) return { fehler: [], gedaechtnis: null, pfad: p };
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) {
    return { fehler: ['Das Gedaechtnis ist nicht lesbar (' + (e.code || e.message) + '): ' + p] };
  }
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return { fehler: ['Das Gedaechtnis ' + p + ' ist kein JSON: ' + e.message +
      '. Es wird nicht repariert und nicht ueberschrieben.'] };
  }
  const fehler = [];
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return { fehler: ['Das Gedaechtnis enthaelt kein Objekt.'] };
  if (d.artifact_type !== GEDAECHTNIS_ARTIFACT_TYPE) fehler.push('Gedaechtnis: artifact_type ist ' + JSON.stringify(d.artifact_type) + '.');
  if (d.schema_version !== GEDAECHTNIS_SCHEMA_VERSION) fehler.push('Gedaechtnis: schema_version ' + JSON.stringify(d.schema_version) + ' ist unbekannt.');
  if (d.aufnahme !== aufnahme) fehler.push('Gedaechtnis: nennt die Aufnahme ' + JSON.stringify(d.aufnahme) + '.');
  if (d.plan_sha256 !== planSha256) {
    fehler.push('Das Gedaechtnis gehoert zu einem ANDEREN Plan (plan_sha256 ' +
      JSON.stringify(d.plan_sha256) + ', die Planungsdatei hat jetzt ' + planSha256 + '). ' +
      'Der Plan wurde nach dem ersten Upload veraendert oder ersetzt. Es ist nicht mehr zu ' +
      'sagen, ob "schon hochgeladen" noch dasselbe meint -- Abbruch. Wer neu anfaengt, raeumt ' +
      'das Gedaechtnis selbst weg (verschieben, nicht loeschen: es traegt videoIds).');
  }
  if (!Array.isArray(d.uploads)) fehler.push('Gedaechtnis: uploads ist keine Liste.');
  else {
    d.uploads.forEach((u, i) => {
      if (u === null || typeof u !== 'object' || typeof u.sha256 !== 'string' || !SHA256_FORM.test(u.sha256) ||
          typeof u.videoId !== 'string' || !u.videoId) {
        fehler.push('Gedaechtnis: uploads[' + i + '] ist unvollstaendig (sha256 oder videoId fehlt).');
      }
    });
  }
  if (fehler.length) return { fehler };
  return { fehler: [], gedaechtnis: d, pfad: p };
}

function schonHochgeladen(gedaechtnis, sha256) {
  if (!gedaechtnis) return null;
  return gedaechtnis.uploads.find((u) => u.sha256 === sha256) || null;
}

// ATOMAR: temporaere Datei im SELBEN Verzeichnis, fsync, dann umbenennen --
// dieselbe Bauart wie Planer und Freigabedienst. Ein halb geschriebenes
// Gedaechtnis waere eines, das einen Upload vergisst -- und den dann ein
// zweites Mal macht.
let tmpZaehler = 0;

function schreibeGedaechtnisAtomar(pfad, gedaechtnis) {
  const inhalt = JSON.stringify(gedaechtnis, null, 2) + '\n';
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
    fs.renameSync(tmp, pfad);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (x) { /* egal */ } }
    try { fs.unlinkSync(tmp); } catch (x) { /* war nie da */ }
    throw e;
  }
  return inhalt;
}

// ---------------------------------------------------------------------------
// TEIL 2b -- DIE EINMAL-ERMAECHTIGUNG (DR)
// ---------------------------------------------------------------------------
//
// WARUM ES SIE GIBT, UND WAS SIE ERSETZT.
//
// Bis DR endete die Kette an der Freigabeseite, und danach tippte ein Mensch
// zwei Befehle ins Terminal -- den Planer und den Uploader --, den zweiten mit
// --execute und einem getippten HOCHLADEN. Dieses getippte Wort faellt auf dem
// neuen Weg weg. Es ist NICHT abgeschafft, es ist VERLEGT: an den Knopf
// "Hochladen" auf der Freigabeseite.
//
// WOFUER DAS GETIPPTE WORT DA WAR -- das ist der Massstab, an dem sich dieser
// Weg messen lassen muss, und es sind zwei Dinge:
//
//   (1) Ein MENSCH hat unmittelbar vorher gesehen, was gleich veroeffentlicht
//       wird. Beim Terminalweg ist das der Trockenlauf ueber der Frage. Beim
//       neuen Weg ist es die Vorschau auf der Seite -- dieselbe Ausgabe,
//       woertlich, erzeugt vom selben Trockenlauf.
//   (2) NIEMAND SONST kann diesen Weg ausloesen. Beim Terminalweg ist das die
//       Tastatur an einem Terminal. Beim neuen Weg ist es der Dienst, der nur
//       auf 127.0.0.1 lauscht, ein Sitzungstoken je Start verlangt und Host
//       und Origin prueft.
//
// DIE ERMAECHTIGUNG IST DIE BRUECKE ZWISCHEN BEIDEM. Der Dienst schreibt beim
// Klick eine Datei; der Uploader nimmt sie ueber --bestaetigt-durch=<pfad>
// entgegen und prueft JEDES ihrer Felder gegen das, was er selbst vorfindet:
//
//   aufnahme      gegen --plan=            -- eine Ermaechtigung fuer eine
//                                             andere Aufnahme gilt hier nicht.
//   plan_sha256   gegen die Planungsdatei  -- ist der Plan seit der Vorschau
//                                             ein anderer geworden, hat der
//                                             Mensch etwas anderes gesehen als
//                                             das, was hochginge.
//   anzahl        gegen die Auswahl        -- die Zahl stand auf dem Knopf.
//   erstellt_am   gegen die Uhr            -- hoechstens zwei Minuten alt.
//   zufall        gegen die Verbrauchsliste -- genau einmal.
//   kanal_id      gegen channels.list      -- der Kanal, den der Knopf nannte,
//                                             ist der Kanal, der es bekommt.
//
// Damit haengt die Ermaechtigung an einem MENSCHEN (nur der Dienst schreibt
// sie, und an den kommt nur ein Browser auf diesem Rechner mit dem Token
// dieses Starts), an einem AUGENBLICK (zwei Minuten) und an einem BESTIMMTEN
// PLAN (die Pruefsumme). Eine von Hand geschriebene Datei ist kein
// Schlupfloch: sie muesste die Pruefsumme des AKTUELLEN Plans treffen und
// frisch sein -- wer das hinbekommt, hat den Plan gelesen und weiss, was
// hochgeht. Genau das war der Zweck der getippten Bestaetigung.
//
// OHNE --bestaetigt-durch AENDERT SICH NICHTS. --execute verlangt weiterhin
// das getippte Wort, und nicht-interaktiv bleibt Rueckgabewert 4. Der
// Terminalweg ist der Rueckfallweg, wenn der Dienst nicht laeuft.

const ERMAECHTIGUNG_ARTIFACT_TYPE = 'adw_shorts_ermaechtigung';
const ERMAECHTIGUNG_SCHEMA_VERSION = '1.0';

// ZWEI MINUTEN. Nicht laenger: die Ermaechtigung soll den Augenblick des
// Klicks bezeugen und nicht den Nachmittag. Nicht kuerzer: zwischen Klick und
// dem Punkt, an dem der Uploader sie prueft, liegen die Anmeldung und ein
// channels.list, und ein langsames Netz darf den Menschen nicht zwingen,
// zweimal zu klicken.
const ERMAECHTIGUNG_GUELTIG_MS = 2 * 60 * 1000;

// Eine Ermaechtigung, die in der ZUKUNFT beginnt, ist keine. Dienst und
// Uploader laufen auf demselben Rechner an derselben Uhr; eine Sekunde
// Spielraum deckt die Ungenauigkeit ab, mehr nicht.
const ERMAECHTIGUNG_ZUKUNFT_MS = 1000;

const ERMAECHTIGUNG_ZUFALL_BYTES = 32;
const ZUFALL_FORM = /^[0-9a-f]{64}$/;

// Wie viele verbrauchte Zufallswerte aufgehoben werden. Die Liste dient
// ausschliesslich der Frage "war der schon einmal da"; eine Ermaechtigung ist
// nach zwei Minuten ohnehin abgelaufen, die Liste muss also nur weit genug
// zurueckreichen, um den Wiederverwendungsfall zu treffen, und nicht ewig.
const VERBRAUCHT_MAX = 500;

function ermaechtigungOrdner(projektwurzel) {
  return path.join(projektwurzel, 'data', 'ermaechtigungen');
}

// Der Dateiname kommt AUS dem Zufallswert und aus nichts sonst. Damit gibt es
// keinen Weg von einer Eingabe zu einem frei gewaehlten Dateinamen.
function ermaechtigungPfad(projektwurzel, zufall) {
  if (typeof zufall !== 'string' || !ZUFALL_FORM.test(zufall)) {
    throw new Error('Der Zufallswert hat nicht die Form von 64 Hexziffern. Es wird kein ' +
      'Dateiname daraus gebaut.');
  }
  return path.join(ermaechtigungOrdner(projektwurzel), 'ermaechtigung-' + zufall + '.json');
}

function verbrauchtPfad(projektwurzel) {
  return path.join(ermaechtigungOrdner(projektwurzel), 'verbraucht.json');
}

function neuerZufall() {
  return crypto.randomBytes(ERMAECHTIGUNG_ZUFALL_BYTES).toString('hex');
}

// Die FORM der Ermaechtigung steht hier -- bei dem, der sie prueft, und nicht
// bei dem, der sie schreibt. freigabe-server.js ruft diese Funktion auf,
// statt die Felder ein zweites Mal hinzuschreiben: zwei Fassungen einer Form
// sind auf Dauer eineinhalb, und die zweite waere ausgerechnet die, die den
// scharfen Lauf ausloest.
function neueErmaechtigung({ aufnahme, planSha256, anzahl, kanalId, kanalName, zufall, jetzt }) {
  return {
    artifact_type: ERMAECHTIGUNG_ARTIFACT_TYPE,
    schema_version: ERMAECHTIGUNG_SCHEMA_VERSION,
    aufnahme,
    plan_sha256: planSha256,
    anzahl,
    kanal_id: kanalId,
    kanal_name: kanalName,
    erstellt_am: new Date(jetzt).toISOString(),
    zufall,
    // Steht in der Datei, damit wer sie findet weiss, was er vor sich hat.
    warum:
      'Diese Datei ersetzt das getippte HOCHLADEN fuer GENAU EINEN Lauf. Sie wurde ' +
      'beim Klick auf "Hochladen" in der Freigabeoberflaeche geschrieben, nachdem ein ' +
      'Mensch die Vorschau gesehen hat. Sie gilt zwei Minuten, nur fuer diese Aufnahme, ' +
      'nur fuer den Plan mit dieser Pruefsumme, nur fuer diese Anzahl und nur einmal. ' +
      'Der Uploader prueft jedes dieser Felder, verbraucht die Datei und loescht sie.',
  };
}

// Die Liste der schon verbrauchten Zufallswerte. Fehlt sie, ist das kein
// Mangel -- dann wurde noch nie eine Ermaechtigung verbraucht.
//
// IST SIE DA UND UNLESBAR, WIRD ABGELEHNT. Eine kaputte Liste sieht sonst
// genauso aus wie "noch nie verbraucht", und dann waere die
// Wiederverwendungssperre genau in dem Augenblick weg, in dem etwas nicht
// stimmt.
function leseVerbrauchte(projektwurzel) {
  const p = verbrauchtPfad(projektwurzel);
  if (!fs.existsSync(p)) return { fehler: null, liste: [], pfad: p };
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) {
    return { fehler: 'Die Liste der verbrauchten Ermaechtigungen ist nicht lesbar (' +
      (e.code || e.message) + '): ' + p, liste: null, pfad: p };
  }
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return { fehler: 'Die Liste der verbrauchten Ermaechtigungen ist kein JSON (' + e.message +
      '): ' + p + '. Sie wird nicht repariert und nicht ueberschrieben.', liste: null, pfad: p };
  }
  if (d === null || typeof d !== 'object' || !Array.isArray(d.verbraucht)) {
    return { fehler: 'Die Liste der verbrauchten Ermaechtigungen hat eine unerwartete Form ' +
      '(verbraucht ist keine Liste): ' + p, liste: null, pfad: p };
  }
  return { fehler: null, liste: d.verbraucht, pfad: p };
}

// ALLE LOKALEN PRUEFUNGEN, JEDE MIT EIGENEM CODE UND EIGENER MELDUNG. Der
// Kanal fehlt hier absichtlich: den kennt erst channels.list, und der Rest
// soll ohne einen einzigen Netzaufruf entscheidbar sein.
//
// Gibt { ok: true, daten } oder { ok: false, code, meldung }.
function pruefeErmaechtigung({ projektwurzel, pfad, aufnahme, planSha256, anzahl, jetzt }) {
  const nein = (code, meldung) => ({ ok: false, code, meldung });

  // 0. WO SIE LIEGEN DARF. Diese Datei wird gleich GELOESCHT; ein Pfad, den
  //    jemand frei waehlen kann, waere damit ein Loeschbefehl mit
  //    Argumentangabe. Sie muss unterhalb von data/ermaechtigungen/ liegen.
  const ordner = ermaechtigungOrdner(projektwurzel);
  if (typeof pfad !== 'string' || !pfad.trim()) {
    return nein('ermaechtigung_pfad_leer',
      '--bestaetigt-durch= ist leer. Ohne Pfad gibt es keine Ermaechtigung.');
  }
  if (!pfadLiegtUnter(ordner, pfad)) {
    return nein('ermaechtigung_pfad_fremd',
      'Die Ermaechtigung liegt nicht unter ' + ordner + ', sondern bei ' + pfad + '. ' +
      'Der Uploader loescht diese Datei nach der Pruefung -- ein frei gewaehlter Pfad ' +
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
        'Wurde sie schon verbraucht, ist sie geloescht -- dann in der Oberflaeche erneut ' +
        'auf "Einplanen und Vorschau" und danach auf "Hochladen" klicken.');
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
      JSON.stringify(ERMAECHTIGUNG_ARTIFACT_TYPE) + '. Das ist keine Ermaechtigung.');
  }
  if (d.schema_version !== ERMAECHTIGUNG_SCHEMA_VERSION) {
    return nein('ermaechtigung_fremde_version',
      'schema_version ist ' + JSON.stringify(d.schema_version) + ', dieser Uploader kennt ' +
      JSON.stringify(ERMAECHTIGUNG_SCHEMA_VERSION) + '. Eine fremde Fassung wird nicht nach ' +
      'den Regeln der bekannten gelesen.');
  }

  // 2. DER ZUFALLSWERT -- erst die Form, dann die Verbrauchsliste.
  if (typeof d.zufall !== 'string' || !ZUFALL_FORM.test(d.zufall)) {
    return nein('ermaechtigung_zufall_form',
      'Der Zufallswert ist ' + JSON.stringify(d.zufall) + ' und keine 64 Hexziffern. ' +
      'Ohne ihn laesst sich nicht sagen, ob diese Ermaechtigung schon einmal verbraucht wurde.');
  }
  const verbraucht = leseVerbrauchte(projektwurzel);
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
      '. Sie gilt fuer GENAU EINEN Lauf. Wer noch einmal hochladen will, klickt in der ' +
      'Oberflaeche erneut auf "Einplanen und Vorschau" und danach auf "Hochladen" -- dann ' +
      'sieht auch wieder ein Mensch, was hochgeht.');
  }

  // 3. DER AUGENBLICK.
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
      new Date(jetzt).toISOString() + '). Dienst und Uploader laufen an derselben Uhr; ' +
      'eine Ermaechtigung, die noch nicht begonnen hat, bezeugt keinen Augenblick.');
  }
  if (alter > ERMAECHTIGUNG_GUELTIG_MS) {
    return nein('ermaechtigung_abgelaufen',
      'Die Ermaechtigung ist ' + Math.round(alter / 1000) + ' Sekunden alt, gueltig sind ' +
      (ERMAECHTIGUNG_GUELTIG_MS / 1000) + '. Erstellt am ' + d.erstellt_am + ', jetzt ist ' +
      new Date(jetzt).toISOString() + '. Sie soll den Augenblick des Klicks bezeugen und ' +
      'nicht den Nachmittag -- in der Oberflaeche neu klicken.');
  }

  // 4. DIE AUFNAHME.
  if (d.aufnahme !== aufnahme) {
    return nein('ermaechtigung_fremde_aufnahme',
      'Die Ermaechtigung gilt fuer die Aufnahme ' + JSON.stringify(d.aufnahme) +
      ', hochgeladen werden soll ' + JSON.stringify(aufnahme) + '. Eine Ermaechtigung fuer ' +
      'eine andere Aufnahme gilt hier nicht.');
  }

  // 5. DER PLAN. Das ist die Pruefung, die den Menschen an das bindet, was er
  //    gesehen hat: die Pruefsumme ist die des Planes, ueber dem die Vorschau
  //    stand.
  if (typeof d.plan_sha256 !== 'string' || !SHA256_FORM.test(d.plan_sha256)) {
    return nein('ermaechtigung_plan_sha_form',
      'plan_sha256 ist ' + JSON.stringify(d.plan_sha256) + ' und keine sha256-Summe.');
  }
  if (d.plan_sha256 !== planSha256) {
    return nein('ermaechtigung_plan_geaendert',
      'Die Ermaechtigung gehoert zu einem Plan mit der Pruefsumme ' + d.plan_sha256 +
      ', die Planungsdatei hat jetzt ' + planSha256 + '. Der Plan ist seit der Vorschau ein ' +
      'ANDERER geworden. Was ein Mensch gesehen hat, ist nicht das, was hochginge -- es ' +
      'wird nichts hochgeladen. In der Oberflaeche neu planen und die neue Vorschau lesen.');
  }

  // 6. DIE ANZAHL. Sie stand auf dem Knopf.
  if (!Number.isInteger(d.anzahl) || d.anzahl < 0) {
    return nein('ermaechtigung_anzahl_form',
      'anzahl ist ' + JSON.stringify(d.anzahl) + ' und keine Ganzzahl ab 0.');
  }
  if (d.anzahl !== anzahl) {
    return nein('ermaechtigung_anzahl',
      'Die Ermaechtigung nennt ' + d.anzahl + ' Short(s), dieser Lauf haette ' + anzahl +
      '. Auf dem Knopf stand eine andere Zahl als die, die jetzt hochginge -- es wird ' +
      'nichts hochgeladen.');
  }

  // 7. DER KANAL -- die FORM jetzt, der Vergleich spaeter (pruefeKanal).
  if (typeof d.kanal_id !== 'string' || !d.kanal_id.trim()) {
    return nein('ermaechtigung_kanal_form',
      'kanal_id fehlt in der Ermaechtigung. Der Knopf hat einen Kanal genannt; ohne diese ' +
      'Angabe laesst sich nicht pruefen, ob es derselbe ist, der das Video bekommt.');
  }

  return { ok: true, daten: d };
}

// Der Vergleich, der erst nach channels.list moeglich ist. Getrennt, damit
// jeder lokale Fehler ohne einen einzigen Netzaufruf auffaellt.
function pruefeKanal(daten, kanalId, kanalName) {
  if (daten.kanal_id === kanalId) return { ok: true };
  return {
    ok: false,
    code: 'ermaechtigung_kanal',
    meldung:
      'Der Knopf nannte den Kanal ' + JSON.stringify(daten.kanal_name) + ', angemeldet ist ' +
      'aber ' + JSON.stringify(kanalName) + '. Die Kanalkennungen stimmen nicht ueberein. ' +
      'Es wird nichts hochgeladen: die Zusage des Knopfes war, auf WELCHEN Kanal das geht.',
  };
}

// VERBRAUCHEN HEISST: erst merken, dann loeschen -- in dieser Reihenfolge.
//
// Umgekehrt waere ein Absturz zwischen den beiden Schritten ein Freibrief: die
// Datei waere weg, der Zufallswert nicht vermerkt, und eine Kopie der Datei
// (die jemand vor dem Loeschen gezogen hat) taugte noch einmal. So herum
// kostet ein Absturz zwischen den Schritten hoechstens eine liegengebliebene
// Datei, die niemand mehr einloesen kann.
//
// GEPRUEFT WIRD NOCH EINMAL, WESSEN DATEI DA LIEGT: zwischen pruefeErmaechtigung
// und hier liegen die Anmeldung und ein channels.list. Traegt die Datei jetzt
// einen anderen Zufallswert, ist sie in der Zwischenzeit ersetzt worden -- dann
// wird sie nicht verbraucht und nicht geloescht.
//
// DIES IST DER ZWEITE UND LETZTE SCHREIBWEG DIESES MODULS. Der erste ist
// schreibeGedaechtnisAtomar; tests/uploader.test.cjs rechnet nach, dass jeder
// Schreibaufruf in genau einer dieser beiden Funktionen liegt.
let tmpZaehlerErmaechtigung = 0;

function verbraucheErmaechtigung({ projektwurzel, pfad, daten, jetzt }) {
  let jetztText;
  try { jetztText = fs.readFileSync(pfad, 'utf8'); } catch (e) {
    return { ok: false, code: 'ermaechtigung_weg',
      meldung: 'Die Ermaechtigung ist zwischen Pruefung und Verbrauch verschwunden (' +
        (e.code || e.message) + '): ' + pfad + '. Es wird nichts hochgeladen.' };
  }
  let jetztDaten;
  try { jetztDaten = JSON.parse(jetztText); } catch (e) {
    return { ok: false, code: 'ermaechtigung_ersetzt',
      meldung: 'Die Ermaechtigung ist seit der Pruefung kein JSON mehr: ' + pfad };
  }
  if (!jetztDaten || jetztDaten.zufall !== daten.zufall) {
    return { ok: false, code: 'ermaechtigung_ersetzt',
      meldung: 'Die Ermaechtigung traegt jetzt einen anderen Zufallswert als bei der ' +
        'Pruefung. Sie wurde in der Zwischenzeit ersetzt -- sie wird weder verbraucht ' +
        'noch geloescht, und es wird nichts hochgeladen.' };
  }

  const vp = verbrauchtPfad(projektwurzel);
  const gelesen = leseVerbrauchte(projektwurzel);
  if (gelesen.fehler) {
    return { ok: false, code: 'verbrauchsliste_unlesbar', meldung: gelesen.fehler };
  }
  const eintrag = {
    zufall: daten.zufall,
    aufnahme: daten.aufnahme,
    plan_sha256: daten.plan_sha256,
    anzahl: daten.anzahl,
    erstellt_am: daten.erstellt_am,
    verbraucht_am: new Date(jetzt).toISOString(),
    verbraucht_von_pid: process.pid,
  };
  const liste = gelesen.liste.concat([eintrag]).slice(-VERBRAUCHT_MAX);
  const inhalt = JSON.stringify({
    artifact_type: 'adw_shorts_ermaechtigungen_verbraucht',
    schema_version: '1.0',
    erklaerung:
      'Zufallswerte bereits verbrauchter Einmal-Ermaechtigungen. Der Uploader lehnt eine ' +
      'Ermaechtigung ab, deren Zufallswert hier steht -- auch dann, wenn ihre Datei wieder ' +
      'auftaucht. Es werden hoechstens ' + VERBRAUCHT_MAX + ' Eintraege aufgehoben; eine ' +
      'Ermaechtigung ist nach zwei Minuten ohnehin abgelaufen.',
    zuletzt_geschrieben_am: eintrag.verbraucht_am,
    verbraucht: liste,
  }, null, 2) + '\n';

  const verzeichnis = path.dirname(vp);
  fs.mkdirSync(verzeichnis, { recursive: true });
  const tmp = path.join(verzeichnis,
    '.' + path.basename(vp) + '.tmp.' + process.pid + '.' + (++tmpZaehlerErmaechtigung));
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, inhalt, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, vp);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (x) { /* egal */ } }
    try { fs.unlinkSync(tmp); } catch (x) { /* war nie da */ }
    return { ok: false, code: 'verbrauchsliste_nicht_schreibbar',
      meldung: 'Die Verbrauchsliste liess sich nicht schreiben (' + (e.code || e.message) +
        '): ' + vp + '. Ohne sie kann eine Ermaechtigung ein zweites Mal gelten -- es wird ' +
        'nichts hochgeladen.' };
  }

  // Erst jetzt. Ist der Vermerk drin, darf die Datei weg.
  let geloescht = true;
  let loeschgrund = null;
  try {
    fs.unlinkSync(pfad);
  } catch (e) {
    geloescht = false;
    loeschgrund = e.code || e.message;
  }
  return { ok: true, verbrauchtPfad: vp, geloescht, loeschgrund, eintrag };
}

// ---------------------------------------------------------------------------
// DIE DATEIEN AUF DER PLATTE
// ---------------------------------------------------------------------------
//
// Der Plan traegt keine Pfade -- absichtlich, er ist ein Beleg ueber Inhalte
// (sha256) und Termine. Den Pfad zu einer Kennung kennt die Uebergabedatei der
// Lieferung. Sie wird hier streng gelesen (Kopfpruefung des Lesers), und der
// Pfad wird WOERTLICH genommen: kein path.join, kein Erraten, kein Absuchen.
// Ob die Datei dahinter noch die freigegebene ist, entscheidet allein die
// sha256 -- gerechnet gegen die Platte, jedes Mal.

function leseUebergabePfade(text, aufnahme, wurzel) {
  const geparst = parseStreng(text);
  if (geparst.fehler) return { fehler: ['Uebergabedatei: ' + geparst.fehler.meldung] };
  const kopf = pruefeKopf(geparst.daten, aufnahme);
  if (kopf.maengel.length) return { fehler: kopf.maengel.map((m) => 'Uebergabedatei: ' + m.meldung) };
  const pfade = new Map();
  const shorts = Array.isArray(geparst.daten.shorts) ? geparst.daten.shorts : [];
  for (const s of shorts) {
    if (s === null || typeof s !== 'object') continue;
    if (typeof s.kennung !== 'string' || typeof s.pfad !== 'string') continue;
    if (!path.isAbsolute(s.pfad) || !pfadLiegtUnter(wurzel, s.pfad)) continue;
    if (pfade.has(s.kennung)) continue;
    pfade.set(s.kennung, { pfad: s.pfad, sha256: typeof s.sha256 === 'string' ? s.sha256 : null });
  }
  return { fehler: [], pfade };
}

function sha256Datei(pfad) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(pfad, 'r');
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

// Der Pruefsummenstand eines Shorts, JETZT gegen die Platte gerechnet.
// Gibt { status, text, gemessen }. status 'ok' heisst: die Datei ist die
// freigegebene. Alles andere heisst: nicht hochladen.
function pruefsummenstand(short) {
  if (!short.pfad) {
    return { status: 'kennung_fehlt', gemessen: null,
      text: 'KEIN PFAD: die Kennung steht nicht (mehr) in der Uebergabedatei der Lieferung. ' +
        'Die Lieferung wurde seit der Freigabe veraendert.' };
  }
  let gemessen;
  try { gemessen = sha256Datei(short.pfad); } catch (e) {
    return { status: 'datei_fehlt', gemessen: null,
      text: 'DATEI NICHT LESBAR (' + (e.code || e.message) + ').' };
  }
  if (gemessen !== short.sha256) {
    return { status: 'weicht_ab', gemessen,
      text: 'WEICHT AB: die Datei auf der Platte ist eine ANDERE als die freigegebene. ' +
        'freigegeben ' + short.sha256 + ', gemessen ' + gemessen + '.' };
  }
  return { status: 'ok', gemessen, text: 'stimmt (sha256 der Datei = sha256 des Plans)' };
}

// ---------------------------------------------------------------------------
// DIE VORBEREITUNG -- ALLES, WAS VOR DEM ERSTEN UPLOAD GEPRUEFT WIRD
// ---------------------------------------------------------------------------
//
// Gibt { fehler: [...] } oder { gesperrt } oder
// { fehler: [], aufnahme, plan, planSha256, konfig, gedaechtnis, auswahl,
//   schonDa, nichtGewaehlt }.
//
// auswahl: die Shorts dieses Laufs, in der Reihenfolge des Plans -- die
// ersten n, die noch nicht im Gedaechtnis stehen. Ein Short, dessen Datei
// nicht mehr stimmt, bleibt in der Auswahl (und wird beim Lauf uebersprungen,
// mit Meldung); er wird NICHT durch den naechsten ersetzt. Wer --anzahl=1
// sagt, will genau einen sehen, nicht "irgendeinen, der geht".
function bereiteVor({ projektwurzel, wurzel, aufnahme, anzahl = null, jetzt }) {
  const sperrfehler = pruefeSperrliste();
  if (sperrfehler.length) return { fehler: sperrfehler.map((f) => 'Sperrliste: ' + f) };
  const sperre = sperreFuer(aufnahme);
  if (sperre) return { gesperrt: sperre, fehler: [] };

  const pp = planPfad(projektwurzel, aufnahme);
  if (!fs.existsSync(pp)) return { fehler: ['Planungsdatei nicht gefunden: ' + pp] };
  let planText;
  try { planText = fs.readFileSync(pp, 'utf8'); } catch (e) {
    return { fehler: ['Planungsdatei nicht lesbar (' + (e.code || e.message) + '): ' + pp] };
  }
  const gelesen = lesePlan(planText, aufnahme);
  if (gelesen.fehler.length) return { fehler: gelesen.fehler.map((f) => 'Planungsdatei: ' + f) };
  const plan = gelesen.plan;
  const planSha256 = gelesen.sha256;

  const konfig = ladeKonfiguration(projektwurzel);
  if (konfig.fehler.length) return { fehler: konfig.fehler };

  const g = leseGedaechtnis(projektwurzel, aufnahme, planSha256);
  if (g.fehler.length) return { fehler: g.fehler };
  const gedaechtnis = g.gedaechtnis;

  const schonDa = [];
  const offen = [];
  for (const t of plan.termine) {
    const u = schonHochgeladen(gedaechtnis, t.sha256);
    if (u) schonDa.push({ termin: t, upload: u });
    else offen.push(t);
  }
  const auswahlTermine = anzahl === null ? offen : offen.slice(0, anzahl);
  const nichtGewaehlt = offen.slice(auswahlTermine.length);

  // Pfade aus der Uebergabedatei -- nur gebraucht, wenn es etwas zu tun gibt.
  let pfade = new Map();
  if (auswahlTermine.length) {
    const up = uebergabedateiPfad(wurzel, aufnahme);
    let ut;
    try { ut = fs.readFileSync(up, 'utf8'); } catch (e) {
      return { fehler: ['Die Uebergabedatei der Lieferung ist nicht lesbar (' + (e.code || e.message) +
        '): ' + up + '. Ohne sie gibt es keinen Pfad zu keinem Short -- es wird kein Pfad erraten.'] };
    }
    const gelesenU = leseUebergabePfade(ut, aufnahme, wurzel);
    if (gelesenU.fehler.length) return { fehler: gelesenU.fehler };
    pfade = gelesenU.pfade;
  }

  const fehler = [];
  const auswahl = auswahlTermine.map((t) => {
    const ms = Date.parse(t.publish_at);
    if (ms <= jetzt + MINDESTVORLAUF_MS) {
      const vergangen = ms <= jetzt;
      fehler.push(t.kennung + ': publish_at ' + t.publish_at + ' (' + ortszeitText(ms) + ') liegt ' +
        (vergangen ? 'in der VERGANGENHEIT' : 'weniger als ' + (MINDESTVORLAUF_MS / 60000) +
          ' Minuten voraus') + ' -- jetzt ist ' + new Date(jetzt).toISOString() + ' (' +
        ortszeitText(jetzt) + '). Ein abgelaufener Plan wird neu geplant, nicht gebogen: YouTube ' +
        'veroeffentlicht ein Video mit vergangenem publishAt SOFORT.');
    }
    const meta = baueMetadaten(t, konfig);
    fehler.push(...meta.verstoesse);
    const p = pfade.get(t.kennung) || null;
    return {
      kennung: t.kennung,
      sha256: t.sha256,
      titel: t.titel,
      publish_at: t.publish_at,
      publish_at_ortszeit: ortszeitText(ms),
      pfad: p ? p.pfad : null,
      beschreibung: meta.beschreibung,
      hashtags: meta.hashtags,
      herleitung: meta.herleitung,
    };
  });
  if (fehler.length) return { fehler };

  return {
    fehler: [], aufnahme, plan, planSha256, planPfad: pp, konfig, gedaechtnis,
    auswahl, schonDa, nichtGewaehlt, jetzt,
  };
}

// ---------------------------------------------------------------------------
// TEIL 3 -- DER LAUF
// ---------------------------------------------------------------------------
//
// hochladen(auftrag) ist injiziert: im scharfen Lauf echterUpload, im Test
// eine Attrappe. Der Ablauf drumherum -- Pruefsumme, Gedaechtnis, Schreiben
// nach JEDEM Short, Pause -- ist derselbe, und genau der wird getestet.
async function fuehreUploadsAus({ vorbereitung, projektwurzel, hochladen, pause, jetzt = () => Date.now(), melde = () => {} }) {
  const { aufnahme, planSha256, auswahl } = vorbereitung;
  const gPfad = gedaechtnisPfad(projektwurzel, aufnahme);
  const ergebnis = { hochgeladen: [], uebersprungen: [] };
  let gedaechtnis = vorbereitung.gedaechtnis || neuesGedaechtnis(aufnahme, planSha256, jetzt());

  for (let i = 0; i < auswahl.length; i++) {
    const s = auswahl[i];
    const nr = '[' + (i + 1) + '/' + auswahl.length + '] ' + s.kennung;

    // 1. Pruefsumme ERNEUT gegen die Platte. Jetzt, nicht vorhin.
    const stand = pruefsummenstand(s);
    if (stand.status !== 'ok') {
      melde(nr + '  UEBERSPRUNGEN -- ' + stand.text);
      melde('    Dieser Short wird NICHT hochgeladen. Der Lauf geht mit dem naechsten weiter.');
      ergebnis.uebersprungen.push({ kennung: s.kennung, sha256: s.sha256, grund: stand.status, text: stand.text });
      continue;
    }

    // 2. Gedaechtnis ERNEUT von der Platte lesen. Was ein anderer Lauf
    //    inzwischen geschrieben hat, zaehlt.
    const frisch = leseGedaechtnis(projektwurzel, aufnahme, planSha256);
    if (frisch.fehler.length) throw new Error(frisch.fehler.join('\n'));
    if (frisch.gedaechtnis) gedaechtnis = frisch.gedaechtnis;
    const schon = schonHochgeladen(gedaechtnis, s.sha256);
    if (schon) {
      melde(nr + '  UEBERSPRUNGEN -- steht schon im Gedaechtnis (hochgeladen am ' +
        schon.hochgeladen_am + '). Kein zweiter Upload.');
      ergebnis.uebersprungen.push({ kennung: s.kennung, sha256: s.sha256, grund: 'schon_hochgeladen', text: 'steht schon im Gedaechtnis' });
      continue;
    }

    // 3. Der eine schreibende Aufruf.
    melde(nr + '  Upload laeuft ...');
    const antwort = await hochladen({
      kennung: s.kennung,
      pfad: s.pfad,
      titel: s.titel,
      beschreibung: s.beschreibung,
      publishAt: s.publish_at,
      veroeffentlichung: vorbereitung.konfig.veroeffentlichung,
    });
    if (!antwort || typeof antwort.videoId !== 'string' || !antwort.videoId) {
      throw new Error(s.kennung + ': der Upload hat keine videoId zurueckgegeben. Der Lauf bricht ab; ' +
        'ob das Video angekommen ist, muss im Studio nachgesehen werden, BEVOR neu gestartet wird.');
    }

    // 4. Gedaechtnis schreiben, BEVOR der naechste Short beginnt.
    const wann = new Date(jetzt()).toISOString();
    gedaechtnis.uploads.push({
      sha256: s.sha256,
      kennung: s.kennung,
      videoId: antwort.videoId,
      hochgeladen_am: wann,
      publish_at: s.publish_at,
      titel: s.titel,
    });
    gedaechtnis.zuletzt_geschrieben_am = wann;
    schreibeGedaechtnisAtomar(gPfad, gedaechtnis);
    melde(nr + '  HOCHGELADEN -- Gedaechtnis geschrieben: ' + gPfad);
    if (antwort.privacyStatus !== undefined) {
      melde('    privacyStatus laut Antwort: ' + antwort.privacyStatus +
        (antwort.publishAt !== undefined ? '   publishAt laut Antwort: ' + antwort.publishAt : ''));
    }
    ergebnis.hochgeladen.push({ kennung: s.kennung, sha256: s.sha256, videoId: antwort.videoId, hochgeladen_am: wann });

    // Sagt YouTube etwas anderes als privat, geht KEIN weiterer Short hoch.
    // Korrigieren kann dieses Modul nicht (kein videos.update) -- es kann nur
    // aufhoeren und laut sein.
    if (antwort.privacyStatus !== undefined && antwort.privacyStatus !== PRIVACY_STATUS) {
      throw new Error(s.kennung + ': YouTube meldet privacyStatus ' + JSON.stringify(antwort.privacyStatus) +
        ' statt ' + JSON.stringify(PRIVACY_STATUS) + '. Der Lauf bricht ab. Bitte SOFORT im Studio nachsehen.');
    }

    // 5. Pause -- nur, wenn noch einer kommt.
    if (i < auswahl.length - 1) await pause(PAUSE_MS);
  }
  return ergebnis;
}

// DER EINE SCHREIBENDE API-AUFRUF DIESES MODULS. videos.insert, sonst nichts.
// googleapis wird erst hier geladen: der Trockenlauf kommt nie hierher und
// laedt darum nicht einmal die Bibliothek.
async function echterUpload(auftrag, yt) {
  const v = auftrag.veroeffentlichung;
  const antwort = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: auftrag.titel,
        description: auftrag.beschreibung,
        categoryId: v.categoryId,
        defaultLanguage: v.defaultLanguage,
        defaultAudioLanguage: v.defaultAudioLanguage,
      },
      status: {
        // HART: 'private' ist der einzige Wert, der hier je stehen darf.
        privacyStatus: 'private',
        publishAt: auftrag.publishAt,
        selfDeclaredMadeForKids: v.selfDeclaredMadeForKids,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(auftrag.pfad),
    },
  });
  const d = antwort.data || {};
  return {
    videoId: d.id,
    privacyStatus: d.status ? d.status.privacyStatus : undefined,
    publishAt: d.status ? d.status.publishAt : undefined,
    uploadStatus: d.status ? d.status.uploadStatus : undefined,
  };
}

function schlafe(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// DIE BESTAETIGUNG -- die Fassung aus der archivierten upload-probe (DGb)
// ---------------------------------------------------------------------------
//
// Es gibt DREI verschiedene Nein, und sie sehen hier verschieden aus:
//   (1) Ein Mensch wurde gefragt und hat etwas Falsches getippt -> Exit 0.
//   (2) Es konnte gar nicht gefragt werden (stdin kein Terminal, oder die
//       Eingabe faellt waehrend der Frage weg) -> Exit KEINE_ANTWORT (4).
//   (3) Es kam eine LEERE Zeile -- das ist keine Ablehnung, das ist gar keine
//       Antwort. Hoechstens MAX_NACHFRAGEN Nachfragen, danach Abbruch, Exit 0.
//
// Fall (3) ist der aus DGb: liegt beim Start schon ein Zeilenumbruch im
// Eingabepuffer der Konsole -- wie ihn ein in PowerShell eingefuegter
// mehrzeiliger Block hinterlaesst --, druckt readline die Frage, verschluckt
// sofort die leere Zeile und braeche ohne Nachfrage ab.
//
// EIN readline-Interface fuer alle Durchlaeufe, nicht eines pro Frage: pro
// Frage ein neues Interface verliert Eingaben (gemessen in DGb). Und close
// wird ausdruecklich als Abbruch behandelt: endet stdin waehrend einer Frage,
// kaeme der question-Rueckruf sonst NIE, das Promise loeste nie auf, und node
// beendete sich still mit 0.
//
// input/output/istTerminal sind Parameter, damit der Test die Faelle ohne
// Konsole nachstellen kann. Die Vorgabe ist die echte Konsole.
function textNichtInteraktiv() {
  return 'Abgebrochen -- es konnte nicht gefragt werden: stdin ist kein Terminal.\n' +
    '  gemessen: stdin.isTTY=' + process.stdin.isTTY + ' stdout.isTTY=' + process.stdout.isTTY + '\n' +
    '  Nicht-interaktiv gilt als Nein -- das bleibt so. Es wurde NICHTS hochgeladen.\n' +
    '  Starte den Befehl direkt in einem PowerShell-Fenster. Es darf nichts\n' +
    '  in das Skript hineinpipen und stdin darf nicht umgeleitet sein: kein\n' +
    '  "< NUL", kein vorgeschaltetes "... | node ...", keine PowerShell ISE,\n' +
    '  kein Aufruf aus einem Agenten, Task-Runner oder Dienst heraus.';
}

function bestaetigungEinholen(frage, wort, { input = process.stdin, output = process.stdout, istTerminal = !!process.stdin.isTTY } = {}) {
  return new Promise((resolve) => {
    if (!istTerminal) {
      return resolve({ text: textNichtInteraktiv(), code: EXIT_KEINE_ANTWORT });
    }

    const nachfrage = '\nKeine Eingabe. Bitte tippe "' + wort + '" und Enter, oder Strg+C zum Abbrechen: ';
    const rl = readline.createInterface({ input, output });

    let fertig = false;
    let leere = 0;
    const beenden = (ergebnis) => {
      if (fertig) return;
      fertig = true;
      rl.close();
      resolve(ergebnis);
    };

    rl.on('close', () => beenden({
      text: 'Abgebrochen -- die Eingabe wurde geschlossen, bevor eine Antwort kam. Es wurde NICHTS hochgeladen.',
      code: EXIT_KEINE_ANTWORT,
    }));

    const fragen = (text) => rl.question(text, (antwort) => {
      const wert = String(antwort).trim();
      if (wert === wort) return beenden(null);                                   // freigegeben
      if (wert !== '') return beenden({ text: 'Abgebrochen -- keine Bestaetigung. Es wurde NICHTS hochgeladen.', code: EXIT_OK });

      leere += 1;
      if (leere > MAX_NACHFRAGEN) {
        return beenden({
          text:
            'Abgebrochen -- ' + leere + ' mal nur eine leere Zeile, keine Bestaetigung. Es wurde NICHTS hochgeladen.\n' +
            '  Das passiert, wenn beim Start schon Zeilenumbrueche im Eingabepuffer der\n' +
            '  Konsole lagen -- typisch, wenn ein mehrzeiliger Block eingefuegt wurde.\n' +
            '  Tippe den Befehl in eine frische Zeile statt ihn als Block einzufuegen.',
          code: EXIT_OK,
        });
      }
      fragen(nachfrage);
    });

    fragen(frage);
  });
}

function meldeInteraktivitaet() {
  console.log('  interaktiv: stdin.isTTY=' + !!process.stdin.isTTY + ' stdout.isTTY=' + !!process.stdout.isTTY);
}

// ---------------------------------------------------------------------------
// AUSGABE FUER MENSCHEN -- der Trockenlauf ist die Pruefung durch den Menschen
// ---------------------------------------------------------------------------

// DT: DIE MARKEN, AN DENEN DIE SEITE DIE BEIDEN SONDERBLOECKE ERKENNT.
//
// Die Freigabeseite zeigt woertlich diese Ausgabe und schneidet sie an den
// Trennzeilen aus Gleichheitszeichen in Bloecke. Damit sie den gemeinsamen
// Teil zusammenklappen und den Befund hervorheben kann, muss sie beide Bloecke
// erkennen -- und zwar an ihrer ERSTEN Zeile, denn mehr sieht der Schnitt
// nicht. Die beiden Zeichenketten stehen darum hier, wo sie erzeugt werden,
// und in src/upload/freigabe-seite.js noch einmal, wo sie gesucht werden. Wer
// eine aendert, aendert beide; tests/dt-vorschau.test.cjs haelt sie
// gegeneinander und schlaegt an, sobald sie auseinanderlaufen.
const GEMEINSAM_UEBERSCHRIFT = 'DER GEMEINSAME TEIL DER BESCHREIBUNG';
const GEMEINSAM_BEFUND = 'BEFUND: DER GEMEINSAME TEIL IST NICHT BEI ALLEN SHORTS GLEICH';

// DT: Zerlegt eine fertige Beschreibung in die drei Teile, aus denen sie
// besteht -- erste Zeile, Mittelteil, letzte Zeile. Es wird nichts gedeutet
// und nichts gesucht: geschnitten wird an Zeilenumbruechen, sonst nichts.
// Bei weniger als drei Zeilen gibt es keinen Mittelteil; dann ist er leer,
// und die Kuerzung unten greift nicht.
function zerlegeBeschreibung(text) {
  const zeilen = String(text).split('\n');
  if (zeilen.length < 3) {
    return {
      erste: zeilen[0] === undefined ? '' : zeilen[0],
      mitte: '',
      letzte: zeilen.length > 1 ? zeilen[zeilen.length - 1] : null,
    };
  }
  return { erste: zeilen[0], mitte: zeilen.slice(1, -1).join('\n'), letzte: zeilen[zeilen.length - 1] };
}

// DT: IST DER MITTELTEIL BEI ALLEN DERSELBE? GEPRUEFT, NICHT ANGENOMMEN.
//
// Dass alle Beschreibungen aus derselben Vorlage kommen, ist eine Annahme --
// sie stimmt, solange die Vorlage genau zwei Platzhalter hat und die in der
// ersten bzw. letzten Zeile stehen. Steht {titel} eines Tages mitten im Text,
// oder kommt ein dritter Platzhalter dazu, stimmt sie nicht mehr. Dann darf
// nicht gekuerzt werden: eine Kuerzung, die einen Unterschied verschluckt, ist
// schlimmer als die Wand aus Text, gegen die sie gebaut ist.
//
// Verglichen wird Zeichen fuer Zeichen. Gibt:
//   { gekuerzt: true,  text, zeichen, zeilen }                       -- alle gleich
//   { gekuerzt: false, grund: 'abweichung', massgeblich, abweichungen }
//   { gekuerzt: false, grund: <Text> }                               -- nichts zu kuerzen
function gemeinsamerTeil(auswahl) {
  const teile = auswahl.map((s) => Object.assign({ kennung: s.kennung }, zerlegeBeschreibung(s.beschreibung)));
  if (!teile.length) {
    return { gekuerzt: false, grund: 'kein Short in diesem Lauf', abweichungen: [] };
  }
  const massgeblich = teile[0];
  const abweichungen = teile.slice(1).filter((x) => x.mitte !== massgeblich.mitte);
  if (abweichungen.length) {
    return { gekuerzt: false, grund: 'abweichung', massgeblich, abweichungen };
  }
  if (!massgeblich.mitte.length) {
    return {
      gekuerzt: false, abweichungen: [],
      grund: 'zwischen erster und letzter Zeile steht nichts -- es gibt nichts zusammenzufassen',
    };
  }
  return {
    gekuerzt: true, grund: null, abweichungen: [],
    text: massgeblich.mitte,
    zeichen: massgeblich.mitte.length,
    zeilen: massgeblich.mitte.split('\n').length,
  };
}

function formatiereVorschau(v, { mitPruefsumme = true } = {}) {
  const z = [];
  const k = v.konfig.veroeffentlichung;
  z.push('');
  z.push('Aufnahme:              ' + v.aufnahme);
  z.push('Planungsdatei:         ' + v.planPfad);
  z.push('  sha256:              ' + v.planSha256);
  z.push('  Termine im Plan:     ' + v.plan.termine.length);
  z.push('Gedaechtnis:           ' + (v.gedaechtnis
    ? gedaechtnisPfad('', v.aufnahme).replace(/^[\\/]/, '') + ' -- ' + v.gedaechtnis.uploads.length + ' schon hochgeladen'
    : 'keines -- noch nichts hochgeladen'));
  z.push('Jetzt:                 ' + new Date(v.jetzt).toISOString() + '   = ' + ortszeitText(v.jetzt));
  z.push('privacyStatus:         ' + PRIVACY_STATUS + ' (fest verdrahtet; oeffentlich wird das Video zum publishAt)');
  z.push('Fuer alle gleich:      categoryId=' + k.categoryId + '  defaultLanguage=' + k.defaultLanguage +
    '  defaultAudioLanguage=' + k.defaultAudioLanguage + '  selfDeclaredMadeForKids=' + k.selfDeclaredMadeForKids);
  z.push('');
  z.push('Dieser Lauf:           ' + v.auswahl.length + ' Short(s)' +
    (v.schonDa.length ? ', ' + v.schonDa.length + ' schon hochgeladen (uebersprungen)' : '') +
    (v.nichtGewaehlt.length ? ', ' + v.nichtGewaehlt.length + ' offen, aber nicht in diesem Lauf (--anzahl)' : ''));
  for (const s of v.schonDa) {
    z.push('  schon da:  ' + s.termin.kennung + '  (hochgeladen am ' + s.upload.hochgeladen_am + ')');
  }
  z.push('');

  // DT: JE SHORT NUR DAS UNTERSCHIEDLICHE -- DER GEMEINSAME TEIL EINMAL.
  //
  // Bis DT stand unter jedem Short die vollstaendige Beschreibung, rund 2400
  // Zeichen. Bei neun Shorts war das eine Wand aus neunmal fast demselben
  // Text, und der Zweck der Vorschau -- dass ein Mensch hinsieht -- ging genau
  // an dieser Laenge zugrunde. Verschieden sind nur die erste Zeile (der
  // Titel) und die Hashtag-Zeile am Schluss; alles dazwischen kommt aus
  // derselben Vorlage.
  //
  // Der gemeinsame Teil FAELLT NICHT WEG. Er ist die einzige Stelle, an der
  // ein Mensch sieht, was unter jedem Video steht, und er aendert sich, sobald
  // jemand config/shorts-beschreibung.txt anfasst. Er steht darum weiter
  // unten -- einmal, am Stueck, vollstaendig und im Wortlaut.
  const g = gemeinsamerTeil(v.auswahl);

  // Der Befund steht VOR den Shorts. Am Ende, hinter neun vollstaendigen
  // Beschreibungen, waere er genau das, was er nicht sein darf: eine Zeile,
  // die man ueberliest.
  if (g.grund === 'abweichung') {
    z.push('=' .repeat(78));
    z.push(GEMEINSAM_BEFUND);
    z.push('');
    z.push('Der Teil zwischen erster und letzter Zeile sollte bei allen Shorts derselbe sein --');
    z.push('er kommt aus ' + BESCHREIBUNG_DATEI + '. Er ist es nicht. Die Zusammenfassung faellt');
    z.push('fuer diesen Lauf aus: jede Beschreibung steht unten wieder einzeln und vollstaendig');
    z.push('da, damit der Unterschied zu sehen ist und nicht in einer Kuerzung verschwindet.');
    z.push('');
    z.push('  Massgeblich (der erste Short):  ' + g.massgeblich.kennung +
      '  -- ' + g.massgeblich.mitte.length + ' Zeichen dazwischen');
    for (const a of g.abweichungen) {
      z.push('  WEICHT AB:                     ' + a.kennung +
        '  -- ' + a.mitte.length + ' Zeichen dazwischen');
    }
    z.push('');
    z.push('Es wurde nichts hochgeladen -- der Trockenlauf laedt ohnehin nichts hoch. Zu pruefen');
    z.push('ist ' + BESCHREIBUNG_DATEI + ' und ob dort ein Platzhalter mitten im Text steht.');
  }

  v.auswahl.forEach((s, i) => {
    z.push('=' .repeat(78));
    z.push('[' + (i + 1) + '/' + v.auswahl.length + ']  ' + s.kennung);
    z.push('  Titel (' + zaehleTitelZeichen(s.titel) + ' Zeichen):   ' + s.titel);
    z.push('  publishAt UTC:         ' + s.publish_at);
    z.push('  publishAt Ortszeit:    ' + s.publish_at_ortszeit);
    z.push('  Datei:                 ' + (s.pfad || '(kein Pfad -- Kennung nicht in der Uebergabedatei)'));
    if (mitPruefsumme) {
      z.push('  Pruefsumme:            ' + pruefsummenstand(s).text);
    }
    z.push('  Hashtags (' + s.hashtags.length + '):');
    for (const h of s.herleitung) {
      z.push('    ' + ('#' + h.hashtag).padEnd(18) + h.quelle);
    }
    // Zeichen- und Bytezahl sind die der VOLLSTAENDIGEN Beschreibung, auch
    // wenn darunter nur zwei Zeilen stehen. Sie sind die Zahlen, die gegen die
    // Grenzen der API gehalten werden; eine gekuerzte Zahl waere hier eine
    // Luege ueber das, was hochgeht.
    z.push('  Beschreibung (' + s.beschreibung.length + ' Zeichen, ' + Buffer.byteLength(s.beschreibung, 'utf8') +
      ' Bytes UTF-8)' + (g.gekuerzt
        ? ' -- erste und letzte Zeile; dazwischen der gemeinsame Teil:'
        : ' -- Wortlaut, wie er auf YouTube stuende:'));
    if (g.gekuerzt) {
      const teile = zerlegeBeschreibung(s.beschreibung);
      z.push('    | ' + teile.erste);
      z.push('    [ dazwischen der gemeinsame Teil: ' + g.zeichen + ' Zeichen, ' + g.zeilen +
        ' Zeilen -- er steht unten einmal vollstaendig ]');
      z.push('    | ' + teile.letzte);
    } else {
      for (const zeile of s.beschreibung.split('\n')) z.push('    | ' + zeile);
    }
  });
  z.push('=' .repeat(78));

  // DT: DER GEMEINSAME TEIL -- EINMAL, VOLLSTAENDIG, IM WORTLAUT.
  //
  // Im Terminal steht er hier, am Ende des Trockenlaufs. Auf der Freigabeseite
  // steht derselbe Block zugeklappt hinter einem Knopf -- dieselbe Ausgabe,
  // woertlich; die Seite schneidet sie nur an den Trennzeilen. Erkannt wird er
  // dort an seiner ersten Zeile, GEMEINSAM_UEBERSCHRIFT.
  if (g.gekuerzt) {
    z.push(GEMEINSAM_UEBERSCHRIFT + ' -- bei allen ' + v.auswahl.length +
      ' Shorts dieses Laufs Zeichen fuer Zeichen derselbe.');
    z.push(g.zeichen + ' Zeichen, ' + g.zeilen + ' Zeilen. Er steht unter jedem dieser Videos,');
    z.push('zwischen der ersten Zeile (dem Titel) und der Hashtag-Zeile am Schluss.');
    z.push('Geaendert wird er in ' + BESCHREIBUNG_DATEI + ' -- was dort steht, steht hier.');
    for (const zeile of g.text.split('\n')) z.push('    | ' + zeile);
    z.push('=' .repeat(78));
  }
  z.push('');
  return z.join('\n');
}

function umbrich(text, breite) {
  const zeilen = [];
  let aktuell = '';
  for (const wort of String(text).split(/\s+/)) {
    if (!aktuell.length) { aktuell = wort; continue; }
    if ((aktuell + ' ' + wort).length > breite) { zeilen.push(aktuell); aktuell = wort; }
    else aktuell += ' ' + wort;
  }
  if (aktuell.length) zeilen.push(aktuell);
  return zeilen;
}

function druckeFehler(ueberschrift, fehler) {
  console.error('');
  console.error('ABBRUCH: ' + ueberschrift);
  console.error('');
  for (const f of fehler) {
    const zeilen = umbrich(f, 74);
    console.error('  - ' + zeilen[0]);
    for (const zz of zeilen.slice(1)) console.error('    ' + zz);
  }
  console.error('');
  console.error('Es wurde NICHTS hochgeladen und kein Netzaufruf gemacht.');
  console.error('');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function wertVon(argv, praefix) {
  const t = argv.slice(2).find((a) => a.startsWith(praefix));
  return t === undefined ? null : t.slice(praefix.length);
}

async function main() {
  const argv = process.argv;
  const projektwurzel = path.join(__dirname, '..', '..');
  const execute = argv.includes('--execute');
  const nurPruefen = argv.includes(TROCKENLAUF_FLAG);
  const vorschauJson = argv.includes('--vorschau-json');
  const bestaetigtDurch = wertVon(argv, '--bestaetigt-durch=');

  if (execute && nurPruefen) {
    console.error('\nAbbruch: ' + TROCKENLAUF_FLAG + ' und --execute schliessen einander aus.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  // Eine Ermaechtigung ohne --execute ist ein Missverstaendnis und kein
  // Trockenlauf mit Zusatz: sie wuerde verbraucht und nichts damit getan.
  if (bestaetigtDurch !== null && !execute) {
    console.error('\nAbbruch: --bestaetigt-durch= ohne --execute. Die Ermaechtigung ersetzt die');
    console.error('getippte Bestaetigung eines SCHARFEN Laufs; ohne --execute gibt es nichts zu');
    console.error('bestaetigen, und sie wuerde verbraucht, ohne dass etwas geschieht.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  if (bestaetigtDurch !== null && nurPruefen) {
    console.error('\nAbbruch: --bestaetigt-durch= und ' + TROCKENLAUF_FLAG + ' schliessen einander aus.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }

  const aufnahme = wertVon(argv, '--plan=');
  if (!aufnahme) {
    console.error('\nAbbruch: --plan= fehlt.');
    console.error('Der Uploader sucht sich keinen Plan. Er laedt genau den einen hoch, der im');
    console.error('Aufruf steht -- und ohne --execute laedt er gar nichts.\n');
    console.error('  node src/upload/uploader.js --plan="2026-08-31 17-36-21"              (Trockenlauf)');
    console.error('  node src/upload/uploader.js --plan="2026-08-31 17-36-21" --anzahl=1 --execute\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  if (!AUFNAHME_FORM.test(aufnahme)) {
    console.error('\nAbbruch: --plan=' + JSON.stringify(aufnahme) + ' hat nicht die Form JJJJ-MM-TT HH-MM-SS.');
    console.error('Es wird kein Dateiname daraus gebaut und nichts gelesen.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }

  let anzahl = null;
  const anzahlArg = wertVon(argv, '--anzahl=');
  if (anzahlArg !== null) {
    if (!/^[1-9]\d*$/.test(anzahlArg)) {
      console.error('\nAbbruch: --anzahl=' + JSON.stringify(anzahlArg) + ' ist keine Zahl ab 1.\n');
      process.exit(EXIT_AUFRUFFEHLER);
    }
    anzahl = Number(anzahlArg);
  }

  // DIE SPERRE -- vor dem Lesen, vor der Frage nach dem Terminal. Eine
  // gesperrte Aufnahme wird nicht angefasst, egal wie sie aufgerufen wird.
  const sperre = sperreFuer(aufnahme);
  if (sperre) {
    console.error('');
    console.error('ABBRUCH: Diese Aufnahme ist zum Hochladen GESPERRT.');
    console.error('');
    console.error('  Aufnahme: ' + sperre.aufnahme);
    console.error('  Grund:');
    for (const zeile of umbrich(sperre.grund, 68)) console.error('    ' + zeile);
    console.error('');
    console.error('Es wurde nichts gelesen, nichts hochgeladen und kein Netzaufruf gemacht.');
    console.error('Die Sperre steht in GESPERRTE_AUFNAHMEN in src/upload/uploader.js -- zusaetzlich');
    console.error('zu der im Planer. Es gibt kein Flag, das sie uebergeht.');
    console.error('');
    process.exit(EXIT_GESPERRT);
  }

  // NICHT-INTERAKTIV HEISST NEIN -- und zwar BEVOR irgendetwas gelesen oder
  // geladen wird. Wer --execute sagt und nicht gefragt werden kann, bekommt
  // einen eigenen Rueckgabewert und keinen Trockenlauf, der so aussieht, als
  // haette er beinahe hochgeladen.
  //
  // DR: Diese Pruefung gilt weiterhin fuer JEDEN Aufruf OHNE Ermaechtigung --
  // sie ist der Terminalweg und der bleibt unveraendert. Mit
  // --bestaetigt-durch= wird sie uebersprungen, und zwar genau deshalb, weil
  // dort ein anderer Beleg an ihre Stelle tritt: die Ermaechtigungsdatei, die
  // nur der Freigabedienst schreibt, nachdem ein Mensch die Vorschau gesehen
  // und geklickt hat. Es faellt hier also nicht die Bestaetigung weg, sondern
  // nur die Frage, ob ein Terminal daran haengt -- und der Uploader eines
  // Klicks hat keines.
  if (execute && bestaetigtDurch === null && !process.stdin.isTTY) {
    console.error('');
    console.error(textNichtInteraktiv());
    console.error('');
    process.exit(EXIT_KEINE_ANTWORT);
  }

  const wurzel = process.env.SHORTS_RENDER_WURZEL || null;
  if (!wurzel) {
    console.error('\nAbbruch: keine Wurzel. Setze SHORTS_RENDER_WURZEL in der .env -- der Uploader');
    console.error('nimmt die Pfade zu den Videodateien aus der Uebergabedatei der Lieferung, und');
    console.error('die liegt unter <SHORTS_RENDER_WURZEL>/<aufnahme>/uebergabe.json.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }

  const jetzt = Date.now();
  const v = bereiteVor({ projektwurzel, wurzel, aufnahme, anzahl, jetzt });
  if (v.fehler.length) {
    druckeFehler('es wird nichts hochgeladen.', v.fehler);
    process.exit(EXIT_BEFUND);
  }

  console.log(formatiereVorschau(v));

  // DR: --vorschau-json. Eine Zeile JSON ueber die LAGE dieses Laufs, damit
  // der Freigabedienst nicht die Vorschau nach Zahlen absuchen muss.
  //
  // SIE GEHT AUF stderr, UND ZWAR ABSICHTLICH. stdout ist die Vorschau fuer
  // Menschen -- woertlich dieselbe, die im Terminal steht, und der Nachweis
  // dafuer ist ein Byte-Vergleich (DQ-N4, DR-N8). Eine Zeile mehr auf stdout
  // haette diesen Vergleich zerstoert. Der Dienst zeigt die Vorschau aus
  // stdout und nimmt die Zahlen aus stderr; damit gibt es keine zweite Stelle,
  // die Plan-Pruefsumme oder Anzahl selbst ausrechnet.
  if (vorschauJson) {
    console.error(JSON.stringify({
      artifact_type: 'adw_shorts_vorschau',
      schema_version: '1.0',
      aufnahme: v.aufnahme,
      plan_pfad: v.planPfad,
      plan_sha256: v.planSha256,
      termine_im_plan: v.plan.termine.length,
      anzahl: v.auswahl.length,
      schon_hochgeladen: v.schonDa.length,
      nicht_in_diesem_lauf: v.nichtGewaehlt.length,
      kennungen: v.auswahl.map((s) => s.kennung),
      jetzt: new Date(v.jetzt).toISOString(),
    }));
  }

  if (v.auswahl.length === 0) {
    console.log('NICHTS ZU TUN: alle ' + v.plan.termine.length + ' Termine des Plans stehen schon im Gedaechtnis.');
    console.log('');
    process.exit(EXIT_OK);
  }

  if (!execute) {
    console.log('TROCKENLAUF: kein Netzaufruf, kein Upload. Es wurde NICHTS hochgeladen.');
    console.log('Hochgeladen wird erst mit --execute und der getippten Bestaetigung:');
    console.log('  node src/upload/uploader.js --plan="' + aufnahme + '"' +
      (anzahl !== null ? ' --anzahl=' + anzahl : '') + ' --execute');
    console.log('');
    process.exit(EXIT_OK);
  }

  // DR: DIE ERMAECHTIGUNG WIRD GEPRUEFT, BEVOR IRGENDEIN NETZAUFRUF GESCHIEHT.
  //
  // Alles ausser dem Kanalvergleich ist ohne Netz entscheidbar -- fehlende,
  // abgelaufene, fremde, schon verbrauchte oder auf einen anderen Plan
  // ausgestellte Ermaechtigungen fallen hier, und dann wurde nicht einmal
  // googleapis geladen.
  let ermaechtigung = null;
  if (bestaetigtDurch !== null) {
    const geprueft = pruefeErmaechtigung({
      projektwurzel, pfad: bestaetigtDurch, aufnahme,
      planSha256: v.planSha256, anzahl: v.auswahl.length, jetzt: Date.now(),
    });
    if (!geprueft.ok) {
      druckeFehler('die Ermaechtigung traegt nicht (' + geprueft.code + ').', [geprueft.meldung]);
      process.exit(EXIT_BEFUND);
    }
    ermaechtigung = geprueft.daten;
    console.log('');
    console.log('ERMAECHTIGT DURCH:      ' + bestaetigtDurch);
    console.log('  ausgestellt am:       ' + ermaechtigung.erstellt_am +
      '   (' + Math.round((Date.now() - Date.parse(ermaechtigung.erstellt_am)) / 1000) +
      ' Sekunden alt, hoechstens ' + (ERMAECHTIGUNG_GUELTIG_MS / 1000) + ')');
    console.log('  fuer Aufnahme:        ' + ermaechtigung.aufnahme);
    console.log('  fuer Plan sha256:     ' + ermaechtigung.plan_sha256);
    console.log('  fuer Anzahl:          ' + ermaechtigung.anzahl);
    console.log('  fuer Kanal:           ' + ermaechtigung.kanal_name);
    console.log('Sie ersetzt das getippte "' + BESTAETIGUNGSWORT + '" fuer GENAU DIESEN Lauf ' +
      'und wird gleich verbraucht.');
  } else {
    // Ab hier: Netz. Erst der Nachweis, dass gefragt werden kann.
    meldeInteraktivitaet();
  }

  // googleapis und die Anmeldung werden erst jetzt geladen -- kein Trockenlauf
  // kommt bis hierher.
  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('../youtube/auth');
  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });

  // Lesend: auf welchen Kanal? Der Name gehoert in die Frage.
  const me = await yt.channels.list({ part: ['snippet'], mine: true });
  const kanal = me.data.items && me.data.items[0];
  if (!kanal) throw new Error('channels.list(mine=true) liefert keinen Kanal. Es wurde nichts hochgeladen.');
  const kanalName = kanal.snippet.title;

  if (ermaechtigung === null) {
    const frage = '\nWirklich ' + v.auswahl.length + ' Short(s) als PRIVAT mit publishAt aus dem Plan auf den Kanal "' +
      kanalName + '" hochladen? Tippe "' + BESTAETIGUNGSWORT + '" zum Bestaetigen: ';
    const abgelehnt = await bestaetigungEinholen(frage, BESTAETIGUNGSWORT);
    if (abgelehnt) {
      console.log(abgelehnt.text);
      process.exit(abgelehnt.code);
    }
  } else {
    // Der Kanal, den der Knopf genannt hat, muss der Kanal sein, der es
    // bekommt. Das ist die einzige Pruefung, die vorher nicht moeglich war.
    const k = pruefeKanal(ermaechtigung, kanal.id, kanalName);
    if (!k.ok) {
      druckeFehler('die Ermaechtigung traegt nicht (' + k.code + ').', [k.meldung]);
      process.exit(EXIT_BEFUND);
    }
    // VERBRAUCHT, BEVOR DER ERSTE UPLOAD BEGINNT. Bricht der Lauf danach ab,
    // ist die Ermaechtigung trotzdem weg -- ein zweiter Lauf braucht einen
    // zweiten Klick, und dann sieht wieder ein Mensch die Vorschau.
    const verbraucht = verbraucheErmaechtigung({
      projektwurzel, pfad: bestaetigtDurch, daten: ermaechtigung, jetzt: Date.now(),
    });
    if (!verbraucht.ok) {
      druckeFehler('die Ermaechtigung liess sich nicht verbrauchen (' + verbraucht.code + ').',
        [verbraucht.meldung]);
      process.exit(EXIT_BEFUND);
    }
    console.log('');
    console.log('ERMAECHTIGUNG VERBRAUCHT: vermerkt in ' + verbraucht.verbrauchtPfad);
    console.log('  Datei ' + (verbraucht.geloescht
      ? 'geloescht: ' + bestaetigtDurch
      : 'NICHT geloescht (' + verbraucht.loeschgrund + ') -- sie ist aber vermerkt und ' +
        'gilt nicht mehr: ' + bestaetigtDurch));
    console.log('  Kanal geprueft: die Kennung aus der Ermaechtigung ist die des ' +
      'angemeldeten Kanals "' + kanalName + '".');
  }

  console.log('');
  const ergebnis = await fuehreUploadsAus({
    vorbereitung: v,
    projektwurzel,
    hochladen: (auftrag) => echterUpload(auftrag, yt),
    pause: schlafe,
    melde: (t) => console.log(t),
  });

  console.log('');
  console.log('FERTIG: ' + ergebnis.hochgeladen.length + ' hochgeladen, ' + ergebnis.uebersprungen.length +
    ' uebersprungen, von ' + v.auswahl.length + ' in diesem Lauf.');
  for (const u of ergebnis.uebersprungen) console.log('  uebersprungen: ' + u.kennung + ' -- ' + u.grund);
  console.log('Gedaechtnis: ' + gedaechtnisPfad(projektwurzel, aufnahme));
  console.log('');
  process.exit(ergebnis.uebersprungen.length ? EXIT_BEFUND : EXIT_OK);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('');
    console.error('FEHLER: ' + e.message);
    console.error('Der Lauf ist abgebrochen. Was bis dahin hochgeladen wurde, steht im Gedaechtnis');
    console.error('(data/uploads/<aufnahme>.json); ein neuer Lauf ueberspringt es.');
    console.error('');
    process.exit(EXIT_BEFUND);
  });
}

module.exports = {
  ERLAUBTE_ARGUMENTE, EXIT_OK, EXIT_BEFUND, EXIT_AUFRUFFEHLER, EXIT_GESPERRT, EXIT_KEINE_ANTWORT,
  PRIVACY_STATUS, TITEL_MAX_ZEICHEN, BESCHREIBUNG_MAX_ZEICHEN, BESCHREIBUNG_MAX_BYTES, HASHTAGS_MAX,
  MINDESTVORLAUF_MS, PAUSE_MS, BESTAETIGUNGSWORT, MAX_NACHFRAGEN,
  BESCHREIBUNG_DATEI, HASHTAGS_DATEI, VEROEFFENTLICHUNG_DATEI, VORLAGEN_MARKER, BEKANNTE_PLATZHALTER,
  ECKIGER_PLATZHALTER,
  GEDAECHTNIS_ARTIFACT_TYPE, GEDAECHTNIS_SCHEMA_VERSION,
  GESPERRTE_AUFNAHMEN, pruefeSperrliste, sperreFuer,
  leseBeschreibungsvorlage, fuelleBeschreibung, leseHashtagKonfiguration, woerter, stichwortTrifft,
  zuordneHashtags, leseVeroeffentlichung, ladeKonfiguration,
  zaehleHashtags, pruefeGrenzen, baueMetadaten, zaehleTitelZeichen,
  ERMAECHTIGUNG_ARTIFACT_TYPE, ERMAECHTIGUNG_SCHEMA_VERSION, ERMAECHTIGUNG_GUELTIG_MS,
  ERMAECHTIGUNG_ZUKUNFT_MS, ZUFALL_FORM, VERBRAUCHT_MAX,
  ermaechtigungOrdner, ermaechtigungPfad, verbrauchtPfad, neuerZufall, neueErmaechtigung,
  leseVerbrauchte, pruefeErmaechtigung, pruefeKanal, verbraucheErmaechtigung,
  planPfad, lesePlan, sha256Text,
  gedaechtnisPfad, neuesGedaechtnis, leseGedaechtnis, schonHochgeladen, schreibeGedaechtnisAtomar,
  leseUebergabePfade, sha256Datei, pruefsummenstand,
  bereiteVor, fuehreUploadsAus, echterUpload,
  textNichtInteraktiv, bestaetigungEinholen, formatiereVorschau, umbrich,
  GEMEINSAM_UEBERSCHRIFT, GEMEINSAM_BEFUND, zerlegeBeschreibung, gemeinsamerTeil,
};
