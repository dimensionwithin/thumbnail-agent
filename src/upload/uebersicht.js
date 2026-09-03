'use strict';

// DV: Die Uebersicht. Fuenfter Bewohner von src/upload/.
//
// Sie liest ALLE Freigabedateien, ALLE Planungsdateien und ALLE
// Gedaechtnisdateien und beantwortet aufnahmenuebergreifend zwei Fragen:
// was steht noch aus, und wann steht aus data/uploads nichts mehr an. Dazu
// schreibt sie GENAU EINE Datei, die Linkdatei data/links.json. Sonst nichts:
// data/freigaben, data/plaene und data/uploads werden gelesen und nie
// geschrieben.
//
// WAS SIE NICHT TUT -- und zwar so, dass man es im Quelltext sehen kann:
// kein Netzaufruf, kein YouTube, kein Upload, kein Kindprozess. Unten steht
// kein require('https'), kein require('googleapis'), kein spawnSync.
//
// WARUM HIER WEDER --execute NOCH --nur-pruefen STEHT: Das Skript hat keinen
// Schreibpfad, der eine Entscheidung waere. Die Linkdatei ist eine Abschrift
// dessen, was in data/uploads steht, und wird bei jedem Lauf neu geschrieben;
// ein Trockenlauf waere von einem scharfen Lauf nicht zu unterscheiden. Es gilt
// dieselbe Begruendung wie im Leser (uebergabe-leser.js, Kopf).
//
// DIE DREI REGELN, DIE HIER NICHT VERHANDELBAR SIND (Bericht DU, Abschnitt C):
//
//   1. Ausstehende Termine kommen aus data/uploads und NIE aus dem Feld
//      `anschluss` eines Plans. Das Feld ist ein Schnappschuss vom
//      Planungszeitpunkt; gemessen am 02.09.2026: sechs Termine um 17:25,
//      fuenf um 19:08 (DU C2.3). Wer daraus liest, zeigt Vergangenes als
//      ausstehend.
//   2. Die gesperrten Aufnahmen kommen aus planer.js (GESPERRTE_AUFNAHMEN,
//      sperreFuer) und werden nicht nachgebaut. Eine Uebersicht, die die
//      Sperre nicht kennt, zeigt acht Shorts Vorrat, die keiner sind (DU C2.1).
//   3. Die Ausgabe sagt nicht "der Kanal ist ab X leer", sondern "aus
//      data/uploads steht nach X nichts mehr an". Was von Hand im Studio
//      eingeplant wurde, sieht dieses Werkzeug nicht; die Grenze steht in der
//      Ausgabe und nicht in einer Fussnote (DU C3, GRENZE_HANDPLANUNG).
//
// EINE ZAHL, DIE SICH NICHT BELEGEN LAESST, WIRD NICHT GENANNT. Aus der
// hoechsten Kennungsnummer einer Aufnahme (/57) folgt keine Stueckzahl: die
// fehlenden Nummern sind Kandidaten, die der Cutter oder die Shorts-Seite
// verworfen hat. "Geliefert" steht in keiner der drei Sorten und steht darum
// auch hier nirgends. Gezaehlt wird nur, was in den Dateien liegt.
//
// WENN ETWAS NICHT LESBAR IST: Abbruch, Datei nennen, keine Zahl ausgeben, die
// vollstaendig aussieht (DU D3). Eine Uebersicht, die still weniger zeigt, ist
// schlimmer als keine. Ein FEHLENDES Verzeichnis ist dagegen kein Fehler,
// sondern "nichts hochgeladen" (oder beurteilt, oder geplant) und wird genau so
// gesagt, mit dem Pfad.

const { pruefeArgumenteStrikt } = require('../publish/cli-args');

// pruefeArgumenteStrikt als ALLERERSTE Anweisung -- vor jedem Lesen, vor jedem
// Schreiben (CY Teil B).
const ERLAUBTE_ARGUMENTE = ['--json', '--jetzt='];

const { AUFNAHME_FORM, EXIT } = require('./uebergabe-leser');

if (require.main === module) {
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/upload/uebersicht.js');
  pruefeKeineFreienArgumenteOhneAufnahme(process.argv);
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Die Bausteine kommen aus dem Planer und werden NICHT nachgebaut. Zwei
// Fassungen einer Regel sind in diesem Projekt ein Fehler (freigabe-server.js,
// harte Linie 4). Insbesondere:
//   - leseGedaechtnisverzeichnis und sammleAusstehende: die Regel "was steht
//     aus" ist die des Planers, mit denselben Abbruechen bei unlesbaren Dateien.
//   - GESPERRTE_AUFNAHMEN, sperreFuer, pruefeSperrliste: die Sperre.
//   - leseFreigabe, leseGedaechtnis: die strengen Leser der beiden Sorten.
//   - ortszeitText, versatzText, ZONE: die Zeitrechnung ueber Intl.
//   - GRENZE_HANDPLANUNG: der Grenzsatz, wortgleich.
//   - schreibePlanAtomar: das atomare Schreiben (Temporaerdatei im selben
//     Verzeichnis, fsync, umbenennen). Es heisst "Plan", schreibt aber jedes
//     JSON-Objekt; eine vierte Abschrift dieser zwanzig Zeilen waere die vierte
//     Stelle, an der ein Fehler darin zu beheben waere.
//   - umbrich, druckeFehlerliste: die Ausgabehelfer.
const P = require('./planer');
// lesePlan wohnt im Uploader (er ist der, der Plaene liest). Der Uploader laedt
// googleapis erst im Upload selbst und nicht beim require; das Laden hier ist
// kein Netzaufruf, und ein Test haelt das fest.
const { lesePlan } = require('./uploader');

const EXIT_OK = EXIT.OK;
const EXIT_BEFUND = EXIT.BEFUND;
const EXIT_AUFRUFFEHLER = EXIT.AUFRUF;

// ---------------------------------------------------------------------------
// FREIE ARGUMENTE
// ---------------------------------------------------------------------------
//
// WARUM pruefeKeineFreienArgumente aus dem Leser hier NICHT benutzt wird,
// obwohl sie die Regel schon enthaelt: sie verlangt den Namen des
// Aufnahme-Flags des aufrufenden Skripts und baut daraus den Hinweis "so geht
// es: node <skript> --<flag>="JJJJ-MM-TT HH-MM-SS"". Diese Uebersicht HAT kein
// Aufnahme-Flag -- sie liest immer alle Aufnahmen. Der Hinweis waere eine
// Anleitung zu einem Aufruf, den es nicht gibt; ein falscher Hinweis ist
// schlechter als keiner. Die Regel selbst (kein freies Argument, Exit 2, vor
// jedem Zugriff) ist dieselbe, und der erste Satz ist wortgleich.
function pruefeKeineFreienArgumenteOhneAufnahme(argv) {
  const frei = argv.slice(2).filter((t) => !t.startsWith('-'));
  if (!frei.length) return;
  console.error('\nAbbruch: freie Argumente gibt es hier nicht: ' +
    frei.map((t) => JSON.stringify(t)).join(', '));
  console.error('');
  console.error('Diese Uebersicht nimmt keine Aufnahme entgegen: sie liest immer alle drei');
  console.error('Verzeichnisse (data/freigaben, data/plaene, data/uploads). Zulaessig sind');
  console.error('nur ' + ERLAUBTE_ARGUMENTE.join(' und ') + '.');
  console.error('');
  console.error('Es wurde NICHTS geschrieben und kein Netzaufruf gemacht.\n');
  process.exit(EXIT.AUFRUF);
}

// ---------------------------------------------------------------------------
// DIE FORM
// ---------------------------------------------------------------------------

const UEBERSICHT_ARTIFACT_TYPE = 'adw_shorts_uebersicht';
// 1.1 und nicht mehr 1.0: `gelesen.<sorte>.sitzungen` traegt seit EI Objekte
// { aufnahme, modus, name } statt blosser Aufnahmenamen. Wer die --json-Ausgabe
// liest, merkt das an der Fassung und nicht erst an einem Feldzugriff.
const UEBERSICHT_SCHEMA_VERSION = '1.1';

const LINKS_ARTIFACT_TYPE = 'adw_shorts_links';
const LINKS_SCHEMA_VERSION = '1.0';
const LINKDATEI = 'data/links.json';

// Die Art des Videos. Heute gibt es nur Shorts; das Feld steht trotzdem in
// jedem Eintrag, weil spaeter Longform dazukommt und ein nachgeruestetes Feld
// in alten Dateien fehlen wuerde.
const VIDEO_ART_SHORT = 'short';

// Die Linkform ist festgelegt und keine Herleitung.
const LINKFORM_SHORT = 'https://www.youtube.com/shorts/<videoId>';
const LINKFORM_ALLGEMEIN = 'https://youtu.be/<videoId>';

// Eine YouTube-videoId hat elf Zeichen aus [A-Za-z0-9_-]. Ein anderer Wert ist
// kein Abbruchgrund (die Datei ist lesbar), aber ein Widerspruch: der Link
// daraus fuehrt nirgendwohin.
const VIDEOID_FORM = /^[A-Za-z0-9_-]{11}$/;

const LINK_HINWEIS =
  'Ein Link beweist nicht, dass das Video oeffentlich ist. Bei einem noch nicht ' +
  'erreichten Termin fuehrt er auf eine Fehlerseite. Diese Datei haelt fest, was ' +
  'DIESES Werkzeug hochgeladen hat (data/uploads), nicht was auf dem Kanal zu sehen ' +
  'ist -- ob YouTube das Video angenommen, verarbeitet oder inzwischen verschoben ' +
  'hat, steht in keiner Datei dieses Projekts.';

// Spiegel von ISO_MIT_VERSATZ in planer.js (dort nicht exportiert). Ein Test in
// tests/dv-uebersicht.test.cjs haelt die beiden Literale gegeneinander.
const ISO_MIT_VERSATZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const MINUTE_MS = P.MINUTE_MS;

function linkdateiPfad(projektwurzel) {
  return path.join(projektwurzel, 'data', 'links.json');
}

function shortsLink(videoId) {
  return 'https://www.youtube.com/shorts/' + encodeURIComponent(videoId);
}

function allgemeinerLink(videoId) {
  return 'https://youtu.be/' + encodeURIComponent(videoId);
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// LESEN -- DREI VERZEICHNISSE
// ---------------------------------------------------------------------------
//
// DIE SPERRFORM -- GELESEN, NICHT NACHGEBAUT (EI)
//
// Der Freigabedienst legt seine Sperre unter <aufnahme>.sperre.json ab und im
// zweiten Betriebsmodus unter <aufnahme>.<modus>.sperre.json (Vertrag 2.13).
// Diese Funktion erkennt BEIDE -- und jede weitere, die derselben Form folgt.
//
// WARUM KEINE LISTE DER MODI: eine Liste muesste hier bei jedem neuen Modus
// nachgezogen werden, und wer sie vergisst, legt genau das lahm, was diese
// Datei beantworten soll. Vorgefuehrt am Stand vor diesem Bau: eine Sperrdatei
// unter einem Namen, den diese Funktion nicht kennt, faellt in die Formpruefung
// darunter, leseVerzeichnis gibt { fehler } zurueck, und die Uebersicht
// entsteht fuer die ganze Dauer der Sitzung NICHT -- kein "was steht aus", kein
// Vorrat, keine Zahl. Ein Werkzeug, das eine fremde Datei nur DEUTEN will, darf
// dabei nicht davon abhaengen, alle ihre Sorten zu kennen.
//
// WAS TROTZDEM SCHARF BLEIBT: die Form. Der Kern muss <aufnahme> oder
// <aufnahme>.<wort> sein, <aufnahme> in der festen Zeitform und <wort> ohne
// weiteren Punkt. Alles andere faellt weiterhin durch und bricht ab. Diese
// Uebersicht baut keinen Sperrnamen -- das tut sperrPfad im Dienst, an genau
// einer Stelle -- sie liest einen.
//
// Gibt { aufnahme, modus } oder null. modus ist null fuer die Form ohne
// Einschub; sie ist die des Shorts-Modus, aber diese Datei nennt keinen
// Modusnamen, den sie nicht aus dem Dateinamen gelesen hat.
function sperrform(kernOhneSperre) {
  if (AUFNAHME_FORM.test(kernOhneSperre)) return { aufnahme: kernOhneSperre, modus: null };
  // Ein Aufnahmename traegt keinen Punkt; der erste trennt ihn also vom Modus.
  const punkt = kernOhneSperre.indexOf('.');
  if (punkt <= 0) return null;
  const aufnahme = kernOhneSperre.slice(0, punkt);
  const modus = kernOhneSperre.slice(punkt + 1);
  if (!AUFNAHME_FORM.test(aufnahme)) return null;
  if (!modus.length || modus.includes('.')) return null;
  return { aufnahme, modus };
}

// Was in der Ausgabe neben einer Sperrdatei steht.
//
// Die Zeile fuer die Form ohne Einschub ist WOERTLICH die von DV geblieben.
// Fuer einen Modus mit Einschub steht dort NICHT derselbe Satz: eine
// Longform-Sitzung schreibt die Freigabedatei nicht (Vertrag 2.13), und "die
// Freigabedatei kann sich gerade aendern" waere dort schlicht falsch.
//
// Und sie sagt, was diese Uebersicht ueber den fremden Modus NICHT weiss. Ob
// sie den Longform-Stand fuehrt, ist offener Punkt 11.3 des Vertrags; er wird
// hier nicht gefuellt, sondern benannt.
function sitzungssatz(sitzung) {
  if (sitzung.modus === null) {
    return 'FREIGABE-SITZUNG laeuft oder Sperrdatei liegengeblieben -- die Freigabedatei ' +
      'kann sich gerade aendern';
  }
  return sitzung.modus.toUpperCase() + '-SITZUNG laeuft oder Sperrdatei liegengeblieben -- ' +
    'diese Uebersicht zeigt von diesem Modus nichts als dass er laeuft';
}

// Dieselbe Regel wie leseGedaechtnisverzeichnis im Planer, fuer data/freigaben
// und data/plaene: <aufnahme>.json wird gelesen; eine ANDERE Datei, die auf
// .json endet, bricht ab und wird nicht uebergangen; was nicht auf .json endet
// (Temporaerdateien, Unterordner wie plaene/archiv) wird uebergangen -- und
// hier zusaetzlich GENANNT, damit "uebergangen" nicht "unsichtbar" heisst.
//
// Fuer data/uploads wird NICHT diese Funktion benutzt, sondern die des Planers:
// die Antwort "was steht aus" soll auf genau demselben Lesen beruhen wie der
// naechste Plan.
//
// Eine Ausnahme kennt nur data/freigaben: eine Sperrdatei einer laufenden
// Freigabe-Sitzung (freigabe-server.js, nimmSperre). Sie ist kein Fremdkoerper
// und wird als Sitzung gemeldet, nicht als Fehler.
//
// Gibt { fehler } oder { fehler: [], vorhanden, dateien, sitzungen, uebergangen }.
// dateien: [{ aufnahme, name, datei, pfad, text, geaendert_ms, sha256 }].
// sitzungen: [{ aufnahme, modus, name }], modus null fuer die Form ohne Einschub.
function leseVerzeichnis(verzeichnis, anzeige, { sperrdateien = false } = {}) {
  const fehler = [];
  const dateien = [];
  const sitzungen = [];
  const uebergangen = [];
  let namen;
  try {
    namen = fs.readdirSync(verzeichnis).slice().sort();
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { fehler: [], vorhanden: false, dateien, sitzungen, uebergangen };
    }
    return { fehler: ['Das Verzeichnis ' + anzeige + ' ist nicht lesbar (' + e.code + '): ' +
      verzeichnis + '. Solange nicht feststeht, was darin liegt, entsteht keine Uebersicht.'] };
  }
  for (const name of namen) {
    if (!name.endsWith('.json')) { uebergangen.push(name); continue; }
    const kern = name.slice(0, name.length - 5);
    if (sperrdateien && kern.endsWith('.sperre')) {
      const s = sperrform(kern.slice(0, kern.length - '.sperre'.length));
      if (s) { sitzungen.push({ aufnahme: s.aufnahme, modus: s.modus, name }); continue; }
    }
    if (!AUFNAHME_FORM.test(kern)) {
      fehler.push('In ' + anzeige + '/ liegt die Datei ' + JSON.stringify(name) + '. Ihr Name ' +
        'hat nicht die Form <JJJJ-MM-TT HH-MM-SS>.json. Sie wird nicht uebergangen: eine ' +
        'Uebersicht, die still weniger zeigt, ist schlimmer als keine.');
      continue;
    }
    const pfad = path.join(verzeichnis, name);
    let text;
    let stat;
    try {
      text = fs.readFileSync(pfad, 'utf8');
      stat = fs.statSync(pfad);
    } catch (x) {
      fehler.push('Die Datei ' + anzeige + '/' + name + ' liegt da, ist aber nicht lesbar (' +
        x.code + '). Sie wird nicht uebergangen.');
      continue;
    }
    dateien.push({
      aufnahme: kern, name, datei: anzeige + '/' + name, pfad, text,
      geaendert_ms: stat.mtimeMs, sha256: sha256Text(text),
    });
  }
  if (fehler.length) return { fehler };
  return { fehler: [], vorhanden: true, dateien, sitzungen, uebergangen };
}

// Fuer data/uploads: Vorhandensein und uebergangene Namen, damit der Stand
// dieselben Angaben traegt wie bei den beiden anderen Verzeichnissen. Das Lesen
// selbst macht leseGedaechtnisverzeichnis aus dem Planer.
function verzeichnisStand(verzeichnis) {
  try {
    const namen = fs.readdirSync(verzeichnis).slice().sort();
    return { vorhanden: true, uebergangen: namen.filter((n) => !n.endsWith('.json')) };
  } catch (e) {
    if (e.code === 'ENOENT') return { vorhanden: false, uebergangen: [] };
    throw e;
  }
}

function standEintrag(d) {
  return {
    datei: d.datei,
    geaendert_am: new Date(d.geaendert_ms).toISOString(),
    geaendert_am_ortszeit: P.ortszeitText(d.geaendert_ms),
    sha256: d.sha256,
  };
}

// Liest alles von der Platte und prueft jede Datei streng. Gibt { fehler } oder
// { fehler: [], gelesen }. gelesen traegt drei Maps (aufnahme -> Datei) und den
// Stand der Verzeichnisse. Kein Urteil, keine Zaehlung -- das faellt in
// baueUebersicht, das ohne Platte pruefbar bleibt.
function leseAlles(projektwurzel) {
  const fehler = [];

  const fVerz = path.join(projektwurzel, 'data', 'freigaben');
  const pVerz = path.join(projektwurzel, 'data', 'plaene');
  const gVerz = P.gedaechtnisVerzeichnis(projektwurzel);

  const f = leseVerzeichnis(fVerz, 'data/freigaben', { sperrdateien: true });
  const p = leseVerzeichnis(pVerz, 'data/plaene');
  const g = P.leseGedaechtnisverzeichnis(gVerz);
  fehler.push(...f.fehler, ...p.fehler, ...g.fehler);
  if (fehler.length) return { fehler };

  let gStand;
  try {
    gStand = verzeichnisStand(gVerz);
  } catch (e) {
    return { fehler: ['Das Verzeichnis data/uploads ist nicht lesbar (' + e.code + '): ' + gVerz] };
  }
  // Aenderungszeit und Pruefsumme der Gedaechtnisdateien nachtragen -- der
  // Planer braucht beides nicht und liefert es darum nicht.
  const gDateien = [];
  for (const d of g.dateien) {
    let stat;
    try {
      stat = fs.statSync(d.pfad);
    } catch (e) {
      fehler.push('Die Gedaechtnisdatei ' + d.datei + ' war eben lesbar und ist jetzt nicht mehr ' +
        'da (' + e.code + '). Es wird gerade geschrieben; die Uebersicht entsteht nicht.');
      continue;
    }
    gDateien.push(Object.assign({}, d, {
      name: path.basename(d.pfad), geaendert_ms: stat.mtimeMs, sha256: sha256Text(d.text),
    }));
  }
  if (fehler.length) return { fehler };

  const freigaben = new Map();
  for (const d of f.dateien) {
    const r = P.leseFreigabe(d.text, d.aufnahme);
    if (r.fehler.length) { for (const x of r.fehler) fehler.push(d.datei + ' -- ' + x); continue; }
    const jeSha = new Map();
    for (const e of r.eintraege) jeSha.set(e.sha256, e);
    freigaben.set(d.aufnahme, Object.assign({}, d, { kopf: r.kopf, eintraege: r.eintraege, jeSha }));
  }
  const plaene = new Map();
  for (const d of p.dateien) {
    const r = lesePlan(d.text, d.aufnahme);
    if (r.fehler.length) { for (const x of r.fehler) fehler.push(d.datei + ' -- ' + x); continue; }
    const jeSha = new Map();
    for (const t of r.plan.termine) jeSha.set(t.sha256, t);
    plaene.set(d.aufnahme, Object.assign({}, d, { plan: r.plan, jeSha }));
  }
  const gedaechtnisse = new Map();
  for (const d of gDateien) {
    const r = P.leseGedaechtnis(d.text, d.aufnahme);
    if (r.fehler.length) { for (const x of r.fehler) fehler.push(d.datei + ' -- ' + x); continue; }
    gedaechtnisse.set(d.aufnahme, Object.assign({}, d, {
      gedaechtnis: r.gedaechtnis, hochgeladen: r.hochgeladen,
    }));
  }
  if (fehler.length) return { fehler };

  return {
    fehler: [],
    gelesen: {
      freigaben, plaene, gedaechtnisse,
      // Die rohen Gedaechtnisdateien, so wie der Planer sie sammleAusstehende
      // gibt -- fuer die Gegenprobe in baueUebersicht.
      gedaechtnisdateienRoh: g.dateien,
      stand: {
        freigaben: {
          verzeichnis: 'data/freigaben', vorhanden: f.vorhanden,
          dateien: f.dateien.map(standEintrag), sitzungen: f.sitzungen, uebergangen: f.uebergangen,
        },
        plaene: {
          verzeichnis: 'data/plaene', vorhanden: p.vorhanden,
          dateien: p.dateien.map(standEintrag), sitzungen: [], uebergangen: p.uebergangen,
        },
        uploads: {
          verzeichnis: 'data/uploads', vorhanden: gStand.vorhanden,
          dateien: gDateien.map(standEintrag), sitzungen: [], uebergangen: gStand.uebergangen,
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// DIE UEBERSICHT BAUEN -- OHNE PLATTE
// ---------------------------------------------------------------------------

function abstandText(minuten) {
  const vorzeichen = minuten < 0 ? '-' : '';
  const a = Math.abs(minuten);
  return vorzeichen + Math.floor(a / 60) + ' h ' + String(a % 60).padStart(2, '0') + ' min';
}

function terminEintrag(aufnahme, datei, u, jetzt) {
  const ms = Date.parse(u.publish_at);
  return {
    aufnahme,
    kennung: u.kennung,
    titel: typeof u.titel === 'string' ? u.titel : null,
    publish_at: new Date(ms).toISOString(),
    publish_at_ortszeit: P.ortszeitText(ms),
    termin_vorbei: ms <= jetzt,
    gedaechtnis_datei: datei,
    ms,
  };
}

function ohneMs(e) {
  const k = Object.assign({}, e);
  delete k.ms;
  return k;
}

function sortiereTermine(a, b) {
  if (a.ms !== b.ms) return a.ms - b.ms;
  if (a.aufnahme !== b.aufnahme) return a.aufnahme < b.aufnahme ? -1 : 1;
  return a.kennung < b.kennung ? -1 : a.kennung > b.kennung ? 1 : 0;
}

// gelesen: aus leseAlles. jetzt: die Bezugszeit (Instant). vorgegeben: ob sie
// aus --jetzt= kam. uhr: die echte Uhr dieses Rechners (fuer erzeugt_am).
// Gibt { fehler } oder { fehler: [], uebersicht, links }.
function baueUebersicht({ gelesen, jetzt, vorgegeben = false, uhr = jetzt }) {
  const sperrfehler = P.pruefeSperrliste();
  if (sperrfehler.length) return { fehler: sperrfehler.map((f) => 'Sperrliste: ' + f) };

  const { freigaben, plaene, gedaechtnisse } = gelesen;
  const widersprueche = [];
  const W = (art, aufnahme, text) => widersprueche.push({ art, aufnahme, text });

  const namen = new Set([...freigaben.keys(), ...plaene.keys(), ...gedaechtnisse.keys()]);
  const aufnahmen = [];
  const vorratPlanbar = [];
  const vorratGesperrt = [];
  const alleUploads = [];

  for (const aufnahme of [...namen].sort()) {
    const f = freigaben.get(aufnahme) || null;
    const p = plaene.get(aufnahme) || null;
    const g = gedaechtnisse.get(aufnahme) || null;
    const sperre = P.sperreFuer(aufnahme);

    const frei = f ? f.eintraege.filter((e) => e.freigegeben === true) : [];
    const uploads = g ? g.gedaechtnis.uploads : [];
    const termine = uploads.map((u) => terminEintrag(aufnahme, g.datei, u, jetzt));
    for (const t of termine) alleUploads.push(t);
    const vorbei = termine.filter((t) => t.termin_vorbei).length;
    const ausstehend = termine.length - vorbei;

    // --- Widersprueche je Aufnahme -------------------------------------
    if (sperre && (p || g)) {
      W('sperre_umgangen', aufnahme, 'Die Aufnahme ist in GESPERRTE_AUFNAHMEN eingetragen, ' +
        'trotzdem liegt ' + (p ? 'ein Plan' : '') + (p && g ? ' und ' : '') +
        (g ? 'ein Gedaechtnis' : '') + ' fuer sie vor. Die Sperre wurde umgangen oder ' +
        'nachtraeglich eingetragen.');
    }
    if (p && !f) {
      W('plan_ohne_freigabe', aufnahme, 'Es gibt einen Plan (' + p.datei + '), aber keine ' +
        'Freigabedatei. Der Plan nennt ' + JSON.stringify(p.plan.freigabedatei) + '.');
    }
    if (g && !p) {
      W('gedaechtnis_ohne_plan', aufnahme, 'Es gibt ein Gedaechtnis (' + g.datei + ') mit ' +
        uploads.length + ' Upload(s), aber keinen Plan. Das Gedaechtnis nennt ' +
        JSON.stringify(g.gedaechtnis.plan_datei) + '. Wurde der Plan weggeraeumt, sieht ' +
        'der naechste Planer diese Termine trotzdem -- er liest data/uploads.');
    }
    if (p && f && p.plan.freigabe_sha256 !== f.sha256) {
      W('freigabe_nach_plan_geaendert', aufnahme, 'Der Plan nennt die Freigabedatei mit ' +
        'sha256 ' + String(p.plan.freigabe_sha256).slice(0, 12) + '..., die Datei hat heute ' +
        f.sha256.slice(0, 12) + '.... Die Freigabe wurde nach dem Planen geaendert; der ' +
        'Plan spiegelt sie nicht mehr.');
    }
    if (g && p && g.gedaechtnis.plan_sha256 !== p.sha256) {
      W('plan_nach_upload_geaendert', aufnahme, 'Das Gedaechtnis nennt den Plan mit sha256 ' +
        String(g.gedaechtnis.plan_sha256).slice(0, 12) + '..., die Planungsdatei hat heute ' +
        p.sha256.slice(0, 12) + '.... Der Plan wurde nach dem Upload ersetzt oder geaendert.');
    }

    const fehlend = [];
    if (p) {
      for (const t of p.plan.termine) {
        if (f) {
          const fe = f.jeSha.get(t.sha256);
          if (!fe) {
            W('termin_ohne_freigabe', aufnahme, 'Termin ' + t.kennung + ' steht im Plan, sein ' +
              'sha256 aber in keiner Freigabe.');
          } else if (fe.freigegeben !== true) {
            W('termin_nicht_freigegeben', aufnahme, 'Termin ' + t.kennung + ' steht im Plan, ' +
              'die Freigabe sagt aber "abgelehnt".');
          } else if (fe.titel !== t.titel) {
            W('titel_weicht_ab', aufnahme, 'Titel von ' + t.kennung + ' in der Freigabe: ' +
              JSON.stringify(fe.titel) + '; im Plan: ' + JSON.stringify(t.titel) + '.');
          }
        }
        if (g) {
          const u = g.hochgeladen.get(t.sha256);
          if (!u) {
            fehlend.push(t);
          } else {
            if (u.publish_at !== t.publish_at) {
              W('termin_verschoben', aufnahme, 'Termin ' + t.kennung + ' im Plan: ' +
                t.publish_at + '; im Gedaechtnis: ' + u.publish_at + '. Massgeblich ist das ' +
                'Gedaechtnis -- das ist, was an die API ging.');
            }
            if (typeof u.titel === 'string' && u.titel !== t.titel) {
              W('titel_weicht_ab', aufnahme, 'Titel von ' + t.kennung + ' im Plan: ' +
                JSON.stringify(t.titel) + '; im Gedaechtnis: ' + JSON.stringify(u.titel) + '.');
            }
          }
        }
      }
      const vergangen = (ts) => ts.filter((t) => Date.parse(t.publish_at) <= jetzt).length;
      if (g && fehlend.length) {
        W('plan_unvollstaendig_hochgeladen', aufnahme, fehlend.length + ' von ' +
          p.plan.termine.length + ' Terminen des Plans stehen nicht im Gedaechtnis' +
          (vergangen(fehlend) ? ', davon ' + vergangen(fehlend) + ' mit bereits verstrichenem ' +
            'Termin -- der Uploader lehnt sie ab (Mindestvorlauf)' : '') + '. Kennungen: ' +
          fehlend.map((t) => t.kennung).join(', ') + '.');
      }
      if (!g && vergangen(p.plan.termine)) {
        W('plan_nicht_hochgeladen_termine_vergangen', aufnahme, 'Der Plan wurde nie ' +
          'hochgeladen, und ' + vergangen(p.plan.termine) + ' von ' + p.plan.termine.length +
          ' Terminen sind bereits verstrichen. So wird er nicht mehr hochgeladen.');
      }
    }
    if (f && p && !sperre) {
      const ohneTermin = frei.filter((e) => !p.jeSha.has(e.sha256) &&
        !(g && g.hochgeladen.has(e.sha256)));
      if (ohneTermin.length) {
        W('freigabe_ohne_termin', aufnahme, ohneTermin.length + ' freigegebene(r) Short(s) ' +
          'stehen weder im Plan noch im Gedaechtnis: ' +
          ohneTermin.map((e) => e.kennung).join(', ') + '. Ein zweiter Plan fuer dieselbe ' +
          'Aufnahme entsteht nicht von selbst (der Planer ersetzt keinen Plan).');
      }
    }
    if (g) {
      for (const u of uploads) {
        if (p && !p.jeSha.has(u.sha256)) {
          W('upload_ohne_termin', aufnahme, 'Upload ' + u.kennung + ' steht im Gedaechtnis, ' +
            'sein sha256 aber in keinem Termin des Plans.');
        }
        if (!VIDEOID_FORM.test(u.videoId)) {
          W('videoid_form', aufnahme, 'Upload ' + u.kennung + ' traegt eine videoId, die nicht ' +
            'die Form einer YouTube-Kennung hat (11 Zeichen). Der Link in ' + LINKDATEI +
            ' fuehrt nirgendwohin.');
        }
      }
    }

    // --- Zustand ----------------------------------------------------------
    let zustand;
    if (sperre) zustand = 'gesperrt';
    else if (f && !p && !g) zustand = frei.length ? 'freigegeben_ohne_plan' : 'beurteilt_nichts_freigegeben';
    else if (p && !g) zustand = 'geplant_nichts_hochgeladen';
    else if (p && g && fehlend.length) zustand = 'teilweise_hochgeladen';
    else if (g && ausstehend > 0) zustand = 'hochgeladen_wartet';
    else if (g) zustand = 'hochgeladen_abgelaufen';
    else zustand = 'unklar';

    // --- Vorrat -------------------------------------------------------------
    // Vorrat ist, was freigegeben und planbar ist und noch keinen Plan hat.
    // Die gesperrte Aufnahme wird gelesen und gezeigt -- mit Sperrvermerk --
    // und zaehlt NICHT. Sie nicht zu lesen hiesse, die Sperre zum stillen
    // Filter zu machen (planer.js, ueber GESPERRTE_AUFNAHMEN).
    const shorts = frei.map((e) => ({ kennung: e.kennung, titel: e.titel }));
    if (sperre && frei.length) {
      vorratGesperrt.push({ aufnahme, freigegeben: frei.length, grund: sperre.grund, shorts });
    } else if (!sperre && f && !p && !g && frei.length) {
      vorratPlanbar.push({ aufnahme, freigegeben: frei.length, shorts });
    }

    aufnahmen.push({
      aufnahme,
      zustand,
      sperre: sperre ? { grund: sperre.grund } : null,
      freigabedatei: f ? f.datei : null,
      plandatei: p ? p.datei : null,
      gedaechtnisdatei: g ? g.datei : null,
      beurteilt: f ? f.eintraege.length : null,
      freigegeben: f ? frei.length : null,
      abgelehnt: f ? f.eintraege.length - frei.length : null,
      geplant: p ? p.plan.termine.length : null,
      hochgeladen: g ? uploads.length : null,
      termin_vorbei: g ? vorbei : null,
      ausstehend: g ? ausstehend : null,
    });
  }

  // --- Ausstehend, aufnahmenuebergreifend --------------------------------
  alleUploads.sort(sortiereTermine);
  const ausstehend = alleUploads.filter((t) => !t.termin_vorbei);
  const vorbei = alleUploads.filter((t) => t.termin_vorbei);

  // GEGENPROBE gegen die Regel des Planers: sammleAusstehende ist das, woran
  // der naechste Plan anschliesst. Weicht die eigene Zaehlung davon ab, ist
  // eine der beiden falsch -- und dann entsteht keine Uebersicht, statt einer,
  // die dem Planer widerspricht, ohne dass es jemand merkt.
  const probe = P.sammleAusstehende(gelesen.gedaechtnisdateienRoh, jetzt);
  if (probe.fehler.length) return { fehler: probe.fehler };
  const eigene = ausstehend.map((t) => t.aufnahme + '|' + t.kennung + '|' + t.publish_at);
  const fremde = probe.ausstehend.map((t) => t.aufnahme + '|' + t.kennung + '|' + t.publish_at);
  if (eigene.length !== fremde.length || eigene.some((e, i) => e !== fremde[i])) {
    return { fehler: ['Interner Widerspruch: die Uebersicht zaehlt ' + eigene.length +
      ' ausstehende Termine, sammleAusstehende aus planer.js zaehlt ' + fremde.length +
      ' (oder in anderer Reihenfolge). Es entsteht keine Uebersicht, die dem Planer ' +
      'widerspricht.'] };
  }

  const letzter = ausstehend.length ? ausstehend[ausstehend.length - 1] : null;
  const jetztOrtszeit = P.ortszeitText(jetzt);
  const aussage = letzter
    ? 'Aus data/uploads steht nach ' + letzter.publish_at_ortszeit + ' nichts mehr an.'
    : 'Aus data/uploads steht nichts mehr an: kein Termin liegt nach ' + jetztOrtszeit + '.';

  const summe = (feld) => aufnahmen.reduce((s, a) => s + (a[feld] === null ? 0 : a[feld]), 0);

  const gelesenDateien = gelesen.stand.uploads.dateien.map((d) => d.datei);

  const uebersicht = {
    artifact_type: UEBERSICHT_ARTIFACT_TYPE,
    schema_version: UEBERSICHT_SCHEMA_VERSION,
    erzeugt_am: new Date(uhr).toISOString(),
    bezugszeit: new Date(jetzt).toISOString(),
    bezugszeit_ortszeit: jetztOrtszeit,
    bezugszeit_vorgegeben: vorgegeben,
    zeitzone: P.ZONE,
    hinweis_bezugszeit: '"Termin vorbei" und "ausstehend" sind gegen die Bezugszeit gerechnet. ' +
      'Ein Termin, der vorbei ist, gilt als veroeffentlicht -- ob er es wirklich wurde, ' +
      'sagen die Dateien nicht.',
    gelesen: gelesen.stand,
    ausstehend: {
      quelle: 'data/uploads (publish_at je Upload), NICHT das Feld anschluss eines Plans',
      anzahl: ausstehend.length,
      termine: ausstehend.map(ohneMs),
      letzter: letzter ? Object.assign(ohneMs(letzter), {
        abstand_minuten: Math.floor((letzter.ms - jetzt) / MINUTE_MS),
        abstand_text: abstandText(Math.floor((letzter.ms - jetzt) / MINUTE_MS)),
      }) : null,
      aussage,
    },
    termin_vorbei: {
      anzahl: vorbei.length,
      termine: vorbei.map(ohneMs),
    },
    aufnahmen,
    summen: {
      aufnahmen: aufnahmen.length,
      beurteilt: summe('beurteilt'),
      freigegeben: summe('freigegeben'),
      abgelehnt: summe('abgelehnt'),
      geplant: summe('geplant'),
      hochgeladen: summe('hochgeladen'),
      termin_vorbei: vorbei.length,
      ausstehend: ausstehend.length,
    },
    vorrat: {
      erklaerung: 'Vorrat ist, was freigegeben und planbar ist und noch keinen Plan hat. ' +
        'Freigaben gesperrter Aufnahmen zaehlen nicht. Wie viele Shorts eine Lieferung ' +
        'enthielt, steht in keiner Datei und wird nicht geschaetzt.',
      planbar: {
        aufnahmen: vorratPlanbar,
        shorts_gesamt: vorratPlanbar.reduce((s, a) => s + a.freigegeben, 0),
      },
      gesperrt: {
        aufnahmen: vorratGesperrt,
        shorts_gesamt: vorratGesperrt.reduce((s, a) => s + a.freigegeben, 0),
      },
      regel: 'Jede weitere geplante Aufnahme belegt nach der Regel des Planers ein Fenster von ' +
        (P.VORLAUF_MS / 3600000) + ' Stunden, angehaengt an den letzten ausstehenden Termin -- ' +
        'unabhaengig davon, wie viele Shorts sie enthaelt.',
    },
    widersprueche,
    linkdatei: {
      datei: LINKDATEI,
      geschrieben: null,
      anzahl: alleUploads.length,
      hinweis: LINK_HINWEIS,
    },
    grenze: P.GRENZE_HANDPLANUNG,
  };

  const links = {
    artifact_type: LINKS_ARTIFACT_TYPE,
    schema_version: LINKS_SCHEMA_VERSION,
    erzeugt_am: new Date(uhr).toISOString(),
    erzeugt_am_ortszeit: P.ortszeitText(uhr),
    bezugszeit: new Date(jetzt).toISOString(),
    bezugszeit_ortszeit: jetztOrtszeit,
    bezugszeit_vorgegeben: vorgegeben,
    zeitzone: P.ZONE,
    quelle: 'data/uploads',
    gelesene_gedaechtnisdateien: gelesenDateien,
    linkform: { short: LINKFORM_SHORT, allgemein: LINKFORM_ALLGEMEIN },
    hinweis: LINK_HINWEIS,
    anzahl: alleUploads.length,
    anzahl_termin_vorbei: vorbei.length,
    anzahl_ausstehend: ausstehend.length,
    videos: alleUploads.map((t) => {
      const u = gedaechtnisse.get(t.aufnahme).gedaechtnis.uploads
        .find((x) => x.kennung === t.kennung && x.publish_at === t.publish_at);
      return {
        art: VIDEO_ART_SHORT,
        aufnahme: t.aufnahme,
        kennung: t.kennung,
        titel: t.titel,
        sha256: u.sha256,
        videoId: u.videoId,
        link: shortsLink(u.videoId),
        link_allgemein: allgemeinerLink(u.videoId),
        publish_at: t.publish_at,
        publish_at_ortszeit: t.publish_at_ortszeit,
        termin_vorbei: t.termin_vorbei,
        hochgeladen_am: typeof u.hochgeladen_am === 'string' ? u.hochgeladen_am : null,
        gedaechtnis_datei: t.gedaechtnis_datei,
      };
    }),
  };

  return { fehler: [], uebersicht, links };
}

function erstelleUebersicht({ projektwurzel, jetzt, vorgegeben = false, uhr = jetzt }) {
  const gelesen = leseAlles(projektwurzel);
  if (gelesen.fehler.length) return { fehler: gelesen.fehler };
  return baueUebersicht({ gelesen: gelesen.gelesen, jetzt, vorgegeben, uhr });
}

// ---------------------------------------------------------------------------
// AUSGABE FUER MENSCHEN
// ---------------------------------------------------------------------------

function formatiere(u) {
  const z = [];
  const zz = (n) => (n === null || n === undefined ? '-' : String(n));
  z.push('');
  z.push('UEBERSICHT -- Shorts aus data/freigaben, data/plaene, data/uploads');
  z.push('');
  z.push('Bezugszeit:          ' + u.bezugszeit + '   = ' + u.bezugszeit_ortszeit +
    (u.bezugszeit_vorgegeben ? '   (vorgegeben mit --jetzt=)' : ''));
  z.push('');
  z.push('Gelesen:');
  for (const sorte of ['freigaben', 'plaene', 'uploads']) {
    const s = u.gelesen[sorte];
    if (!s.vorhanden) {
      z.push('  ' + s.verzeichnis + '/   gibt es nicht -- ' + ({
        freigaben: 'nichts beurteilt', plaene: 'nichts geplant', uploads: 'nichts hochgeladen',
      })[sorte]);
      continue;
    }
    if (!s.dateien.length) z.push('  ' + s.verzeichnis + '/   leer');
    for (const d of s.dateien) {
      z.push('  ' + d.datei.padEnd(42) + ' geaendert ' + d.geaendert_am_ortszeit);
    }
    for (const si of s.sitzungen) {
      z.push('  ' + s.verzeichnis + '/' + si.name + '   ' + sitzungssatz(si));
    }
    for (const n of s.uebergangen) {
      z.push('  ' + s.verzeichnis + '/' + n + '   uebergangen (kein .json)');
    }
  }
  z.push('');
  z.push('AUSSTEHENDE TERMINE: ' + u.ausstehend.anzahl);
  z.push('  Quelle: ' + u.ausstehend.quelle);
  for (const t of u.ausstehend.termine) {
    z.push('  ' + t.publish_at_ortszeit + '  ' + t.kennung.padEnd(24) + '  ' + zz(t.titel));
  }
  z.push('');
  if (u.ausstehend.letzter) {
    const l = u.ausstehend.letzter;
    z.push('Letzter ausstehender Termin: ' + l.publish_at + '   = ' + l.publish_at_ortszeit);
    z.push('                             ' + l.kennung + '   (in ' + l.abstand_text + ')');
  }
  z.push('');
  z.push(u.ausstehend.aussage.toUpperCase());
  z.push('  Das ist die Grenze dieses Werkzeugs, nicht die des Kanals -- siehe GRENZE unten.');
  z.push('');
  z.push('Termin vorbei (laut Bezugszeit veroeffentlicht, nicht nachgeprueft): ' + u.termin_vorbei.anzahl);
  z.push('');
  z.push('JE AUFNAHME:');
  const kopf = '  ' + 'Aufnahme'.padEnd(20) + ' beurt. frei  abgel. gepl.  hochg. vorbei ausst.  Zustand';
  z.push(kopf);
  z.push('  ' + '-'.repeat(kopf.length - 2));
  for (const a of u.aufnahmen) {
    z.push('  ' + a.aufnahme.padEnd(20) +
      zz(a.beurteilt).padStart(6) + zz(a.freigegeben).padStart(6) + zz(a.abgelehnt).padStart(7) +
      zz(a.geplant).padStart(6) + zz(a.hochgeladen).padStart(8) + zz(a.termin_vorbei).padStart(7) +
      zz(a.ausstehend).padStart(7) + '  ' + a.zustand.toUpperCase());
  }
  for (const a of u.aufnahmen) {
    if (!a.sperre) continue;
    z.push('');
    z.push('  GESPERRT ' + a.aufnahme + ' (GESPERRTE_AUFNAHMEN, src/upload/planer.js):');
    for (const zeile of P.umbrich(a.sperre.grund, 68)) z.push('    ' + zeile);
  }
  z.push('');
  z.push('  Summe: ' + u.summen.aufnahmen + ' Aufnahmen, ' + u.summen.beurteilt + ' beurteilt, ' +
    u.summen.freigegeben + ' freigegeben, ' + u.summen.abgelehnt + ' abgelehnt, ' +
    u.summen.geplant + ' geplant, ' + u.summen.hochgeladen + ' hochgeladen.');
  z.push('  "-" heisst: fuer diese Sorte gibt es keine Datei. Wie viele Shorts geliefert');
  z.push('  wurden, steht in keiner Datei und wird nicht geschaetzt.');
  z.push('');
  z.push('VORRAT (freigegeben, planbar, ohne Plan): ' + u.vorrat.planbar.shorts_gesamt +
    ' Shorts in ' + u.vorrat.planbar.aufnahmen.length + ' Aufnahme(n)');
  for (const a of u.vorrat.planbar.aufnahmen) {
    z.push('  ' + a.aufnahme + ': ' + a.freigegeben + ' freigegeben');
    for (const s of a.shorts) z.push('    ' + s.kennung.padEnd(24) + '  ' + s.titel);
  }
  if (u.vorrat.gesperrt.shorts_gesamt) {
    z.push('  Nicht als Vorrat gezaehlt: ' + u.vorrat.gesperrt.shorts_gesamt + ' freigegebene ' +
      'Shorts in ' + u.vorrat.gesperrt.aufnahmen.length + ' GESPERRTEN Aufnahme(n): ' +
      u.vorrat.gesperrt.aufnahmen.map((a) => a.aufnahme).join(', '));
  }
  z.push('  ' + u.vorrat.regel);
  z.push('');
  if (u.widersprueche.length) {
    z.push('WIDERSPRUECHE: ' + u.widersprueche.length);
    for (const w of u.widersprueche) {
      const zeilen = P.umbrich(w.text, 66);
      z.push('  - [' + w.art + '] ' + w.aufnahme + ': ' + zeilen[0]);
      for (const zeile of zeilen.slice(1)) z.push('    ' + zeile);
    }
  } else {
    z.push('WIDERSPRUECHE: keine. Freigabe, Plan und Gedaechtnis passen bei jeder Aufnahme');
    z.push('  zusammen (Pruefsummen, Termine, Titel).');
  }
  z.push('');
  const l = u.linkdatei;
  if (l.geschrieben === true) {
    z.push('LINKDATEI: ' + l.datei + ' geschrieben, ' + l.anzahl + ' Video(s) -- ' +
      u.ausstehend.anzahl + ' ausstehend, ' + u.termin_vorbei.anzahl + ' Termin vorbei.');
  } else if (l.geschrieben === false) {
    z.push('LINKDATEI: ' + l.datei + ' NICHT geschrieben: ' + l.fehler);
    z.push('  Was dort liegt, stammt von einem frueheren Lauf.');
  } else {
    z.push('LINKDATEI: ' + l.datei + ' -- nicht geschrieben (nur gebaut).');
  }
  for (const zeile of P.umbrich(l.hinweis, 70)) z.push('  ' + zeile);
  z.push('');
  z.push('GRENZE (wortgleich mit dem Planer; sie gilt fuer diese Uebersicht genauso):');
  for (const zeile of P.umbrich(u.grenze, 70)) z.push('  ' + zeile);
  z.push('');
  return z.join('\n');
}

// ---------------------------------------------------------------------------
// DER LAUF
// ---------------------------------------------------------------------------

function wertVon(argv, praefix) {
  const t = argv.slice(2).find((a) => a.startsWith(praefix));
  return t === undefined ? null : t.slice(praefix.length);
}

// Der ganze Lauf ohne process.exit und ohne console: gibt { code, stdout,
// stderr }. main() druckt und beendet. So laesst sich der Lauf gegen ein
// Wegwerf-Verzeichnis pruefen, ohne einen Kindprozess und ohne data/.
function fuehreAus({ argv, projektwurzel, uhr = Date.now() }) {
  const aus = [];
  const err = [];
  const alsJson = argv.includes('--json');

  let jetzt = uhr;
  let vorgegeben = false;
  const jetztArg = wertVon(argv, '--jetzt=');
  if (jetztArg !== null) {
    if (!ISO_MIT_VERSATZ.test(jetztArg)) {
      err.push('');
      err.push('Abbruch: --jetzt=' + JSON.stringify(jetztArg) +
        ' ist keine ISO-8601-Zeit MIT Zonenversatz.');
      err.push('Ohne Versatz waere die Angabe eine Ortszeit ohne Zone. Beispiel:');
      err.push('  --jetzt=2026-09-02T19:00:00+02:00');
      err.push('');
      return { code: EXIT_AUFRUFFEHLER, stdout: '', stderr: err.join('\n') };
    }
    jetzt = Date.parse(jetztArg);
    if (!Number.isFinite(jetzt)) {
      err.push('\nAbbruch: --jetzt=' + JSON.stringify(jetztArg) + ' ist kein Zeitpunkt.\n');
      return { code: EXIT_AUFRUFFEHLER, stdout: '', stderr: err.join('\n') };
    }
    vorgegeben = true;
  }

  const ergebnis = erstelleUebersicht({ projektwurzel, jetzt, vorgegeben, uhr });
  if (ergebnis.fehler.length) {
    err.push('');
    err.push('ABBRUCH: es entsteht keine Uebersicht.');
    err.push('');
    for (const f of ergebnis.fehler) {
      const zeilen = P.umbrich(f, 72);
      err.push('  - ' + zeilen[0]);
      for (const zeile of zeilen.slice(1)) err.push('    ' + zeile);
    }
    err.push('');
    err.push('Es wird keine Zahl ausgegeben, die vollstaendig aussieht. ' + LINKDATEI +
      ' wurde NICHT neu');
    err.push('geschrieben; was dort liegt, stammt von einem frueheren Lauf.');
    err.push('');
    return { code: EXIT_BEFUND, stdout: '', stderr: err.join('\n') };
  }

  const { uebersicht, links } = ergebnis;
  // DIE EINE DATEI. Der einzige Schreibzugriff dieses Programms.
  const ziel = linkdateiPfad(projektwurzel);
  let code = EXIT_OK;
  try {
    P.schreibePlanAtomar(ziel, links);
    uebersicht.linkdatei.geschrieben = true;
  } catch (e) {
    uebersicht.linkdatei.geschrieben = false;
    uebersicht.linkdatei.fehler = (e.code ? e.code + ': ' : '') + e.message;
    code = EXIT_BEFUND;
  }

  if (alsJson) aus.push(JSON.stringify(uebersicht, null, 2));
  else aus.push(formatiere(uebersicht));
  if (code !== EXIT_OK) {
    err.push('\nBEFUND: ' + LINKDATEI + ' konnte nicht geschrieben werden: ' +
      uebersicht.linkdatei.fehler + '\n');
  }
  return { code, stdout: aus.join('\n'), stderr: err.join('\n') };
}

function main() {
  const r = fuehreAus({ argv: process.argv, projektwurzel: path.join(__dirname, '..', '..') });
  if (r.stdout) process.stdout.write(r.stdout + '\n');
  if (r.stderr) process.stderr.write(r.stderr + '\n');
  process.exit(r.code);
}

if (require.main === module) main();

module.exports = {
  ERLAUBTE_ARGUMENTE, EXIT_OK, EXIT_BEFUND, EXIT_AUFRUFFEHLER,
  UEBERSICHT_ARTIFACT_TYPE, UEBERSICHT_SCHEMA_VERSION,
  LINKS_ARTIFACT_TYPE, LINKS_SCHEMA_VERSION, LINKDATEI, VIDEO_ART_SHORT,
  LINKFORM_SHORT, LINKFORM_ALLGEMEIN, LINK_HINWEIS, VIDEOID_FORM, ISO_MIT_VERSATZ,
  linkdateiPfad, shortsLink, allgemeinerLink,
  sperrform, sitzungssatz,
  leseVerzeichnis, leseAlles, baueUebersicht, erstelleUebersicht,
  formatiere, fuehreAus,
};
