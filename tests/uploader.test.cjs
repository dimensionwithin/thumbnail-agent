'use strict';

// DO: Tests fuer den Uploader.
//
// Der Uploader ist das erste Skript dieser Reihe, das den Kanal anfasst. Was
// hier geprueft wird, ist deshalb vor allem das, was er NICHT tut: nicht
// oeffentlich, nicht zweimal, nicht die falsche Datei, nicht ohne Frage,
// nicht mit einer Vorlage als Beschreibung. Kein Test hier macht einen
// Netzaufruf; der Upload ist ueberall eine Attrappe (fuehreUploadsAus nimmt
// ihn als Parameter), und die Bauart-Tests halten fest, dass der echte
// Aufruf genau einer ist und genau dort steht, wo er hingehoert.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');

const U = require('../src/upload/uploader.js');
const P = require('../src/upload/planer.js');
const L = require('../src/upload/uebergabe-leser.js');

const WURZEL = path.join(__dirname, '..');
const SKRIPT = path.join(WURZEL, 'src', 'upload', 'uploader.js');
const QUELLTEXT = fs.readFileSync(SKRIPT, 'utf8');
const NURCODE = QUELLTEXT.split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n');
const ECHTE_AUFNAHME = '2026-08-31 17-36-21';
const GESPERRT = '2026-08-29 18-18-19';
const PROBE = '2026-01-01 00-00-00';

// ---------------------------------------------------------------------------
// Hilfen: Wegwerf-Projektwurzel und Wegwerf-Lieferung im Temp-Ordner
// ---------------------------------------------------------------------------

const BESCHREIBUNG_PROBE = '{titel}\n\nProbetext fuer den Test.\n\n{hashtags}\n';

function wegwerfWurzel(beschreibung = BESCHREIBUNG_PROBE) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'do-uploader-'));
  fs.mkdirSync(path.join(w, 'config'));
  fs.mkdirSync(path.join(w, 'data', 'plaene'), { recursive: true });
  fs.copyFileSync(path.join(WURZEL, U.HASHTAGS_DATEI), path.join(w, U.HASHTAGS_DATEI));
  fs.copyFileSync(path.join(WURZEL, U.VEROEFFENTLICHUNG_DATEI), path.join(w, U.VEROEFFENTLICHUNG_DATEI));
  fs.writeFileSync(path.join(w, U.BESCHREIBUNG_DATEI), beschreibung);
  return w;
}

// n Wegwerf-"Videos" (Zufallsbytes -- der Uploader rechnet nur die sha256) und
// eine Uebergabedatei, die der Kopfpruefung des Lesers standhaelt.
function wegwerfLieferung(n, aufnahme = PROBE) {
  const l = fs.mkdtempSync(path.join(os.tmpdir(), 'do-lieferung-'));
  const ordner = path.join(l, aufnahme);
  fs.mkdirSync(ordner);
  const shorts = [];
  for (let i = 1; i <= n; i++) {
    const zo = path.join(ordner, 'kandidat-' + String(i).padStart(2, '0'));
    fs.mkdirSync(zo);
    const pfad = path.join(zo, 'short.mp4');
    const inhalt = crypto.randomBytes(4096 + i);
    fs.writeFileSync(pfad, inhalt);
    shorts.push({
      kennung: aufnahme + '/' + i,
      pfad,
      sha256: crypto.createHash('sha256').update(inhalt).digest('hex'),
      titel: 'Probe ' + i + (i === 2 ? ' mit Bitcoin' : ''),
    });
  }
  const u = {
    artifact_type: L.ARTIFACT_TYPE, schema_version: '1.0', aufnahme,
    erzeugt_am: '2026-01-01T00:00:00+01:00',
    shorts: shorts.map((s) => ({ kennung: s.kennung, pfad: s.pfad, sha256: s.sha256 })),
  };
  fs.writeFileSync(path.join(ordner, 'uebergabe.json'), JSON.stringify(u, null, 2) + '\n');
  return { wurzel: l, shorts };
}

const H = 60 * 60 * 1000;
const JETZT = Date.parse('2026-09-01T18:00:00Z');

function termineAus(shorts, jetzt = JETZT) {
  return shorts.map((s, i) => ({
    sha256: s.sha256, kennung: s.kennung, titel: s.titel,
    publish_at: new Date(jetzt + (i + 2) * H).toISOString(),
  }));
}

function schreibePlan(w, termine, aufnahme = PROBE, extra = {}) {
  const plan = Object.assign({
    artifact_type: P.PLAN_ARTIFACT_TYPE, schema_version: P.PLAN_SCHEMA_VERSION,
    aufnahme, verbindlich: 'publish_at', termine,
  }, extra);
  const text = JSON.stringify(plan, null, 2) + '\n';
  fs.writeFileSync(U.planPfad(w, aufnahme), text);
  return text;
}

function attrappe(protokoll, { scheiternBei = null } = {}) {
  return async (auftrag) => {
    protokoll.push(auftrag);
    if (scheiternBei !== null && protokoll.length === scheiternBei) {
      throw new Error('Attrappe: Abbruch beim ' + scheiternBei + '. Upload');
    }
    return { videoId: 'attrappe-' + protokoll.length, privacyStatus: 'private', publishAt: auftrag.publishAt };
  };
}

async function lauf(w, l, { anzahl = null, protokoll = [], scheiternBei = null, jetzt = JETZT } = {}) {
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, anzahl, jetzt });
  assert.deepEqual(v.fehler, []);
  const ergebnis = await U.fuehreUploadsAus({
    vorbereitung: v, projektwurzel: w,
    hochladen: attrappe(protokoll, { scheiternBei }),
    pause: async () => {}, jetzt: () => jetzt,
  });
  return { v, ergebnis, protokoll };
}

function gedaechtnis(w) {
  return JSON.parse(fs.readFileSync(U.gedaechtnisPfad(w, PROBE), 'utf8'));
}

// ---------------------------------------------------------------------------
// BAUART
// ---------------------------------------------------------------------------

test('pruefeArgumenteStrikt und pruefeKeineFreienArgumente stehen vor allem anderen', () => {
  const wo = (s) => NURCODE.indexOf(s);
  assert.ok(wo('pruefeArgumenteStrikt(process.argv') > 0);
  assert.ok(wo('pruefeKeineFreienArgumente(process.argv') > wo('pruefeArgumenteStrikt(process.argv'));
  for (const m of ["require('fs')", "require('path')", "require('crypto')", "require('readline')", "require('./planer')"]) {
    assert.ok(wo(m) > wo('pruefeKeineFreienArgumente(process.argv'), m + ' steht vor der Argumentpruefung');
  }
  assert.ok(!/function pruefeKeineFreienArgumente/.test(NURCODE), 'nachgebaut statt importiert');
  assert.ok(!/function pruefeArgumenteStrikt/.test(NURCODE), 'nachgebaut statt importiert');
  assert.ok(!/const AUFNAHME_FORM\s*=/.test(NURCODE), 'AUFNAHME_FORM nachgebaut statt importiert');
  assert.match(NURCODE, /pruefeKeineFreienArgumente\(process\.argv, 'src\/upload\/uploader\.js', '--plan='\)/);
  // DR: zwei neue Argumente. --bestaetigt-durch= nimmt die Einmal-Ermaechtigung
  // des Freigabedienstes entgegen, --vorschau-json legt neben die Vorschau eine
  // Zeile mit deren Zahlen (auf stderr, damit stdout woertlich die Ausgabe des
  // Terminalwegs bleibt). Die Liste steht hier vollstaendig: ein Argument, das
  // sich hineinschleicht, faellt auf.
  assert.deepEqual(U.ERLAUBTE_ARGUMENTE,
    ['--plan=', '--anzahl=', '--execute', '--bestaetigt-durch=', '--vorschau-json', '--nur-pruefen']);
});

test('privacyStatus ist fest auf private verdrahtet und kommt aus keiner Variablen', () => {
  assert.equal(U.PRIVACY_STATUS, 'private');
  // Genau eine Stelle setzt privacyStatus in einem Request, und die setzt das
  // Literal -- nicht die Konstante, nicht ein Argument, nicht ein Feld.
  const anfrage = NURCODE.slice(NURCODE.indexOf('requestBody: {'), NURCODE.indexOf('media: {'));
  assert.ok(anfrage.length > 0);
  assert.deepEqual(anfrage.match(/privacyStatus:\s*[^,\n]+/g), ["privacyStatus: 'private'"]);
  assert.equal((NURCODE.match(/privacyStatus: '/g) || []).length, 1);
  assert.ok(!/privacyStatus:\s*(PRIVACY_STATUS|process|argv|konfig|auftrag|v\.)/.test(NURCODE));
  // Kein Argument und keine Konfigurationsdatei kennt den Wert.
  assert.ok(!U.ERLAUBTE_ARGUMENTE.some((a) => /privacy|public|oeffentlich/i.test(a)));
  const ver = U.leseVeroeffentlichung(JSON.stringify({ categoryId: '27', defaultLanguage: 'de', defaultAudioLanguage: 'de-DE', selfDeclaredMadeForKids: false, privacyStatus: 'public' }));
  assert.equal(ver.fehler.length, 1);
  assert.match(ver.fehler[0], /privacyStatus steht in keiner Datei/);
});

test('genau ein schreibender API-Aufruf: videos.insert -- und sonst keiner', () => {
  const insert = NURCODE.match(/videos\.insert\(/g) || [];
  assert.equal(insert.length, 1);
  for (const verboten of ['videos.update', 'videos.delete', 'thumbnails.set', 'playlistItems', 'playlists.', 'videos.rate', 'commentThreads', 'captions.']) {
    assert.ok(!NURCODE.includes(verboten), verboten + ' kommt im Uploader vor');
  }
  // Alle Aufrufe am YouTube-Client: einer lesend (Kanalname), einer schreibend.
  const ytAufrufe = [...NURCODE.matchAll(/\byt\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)].map((m) => m[1] + '.' + m[2]).sort();
  assert.deepEqual(ytAufrufe, ['channels.list', 'videos.insert']);
  // googleapis wird erst im scharfen Zweig geladen, nicht am Dateianfang.
  const req = [...NURCODE.matchAll(/require\('googleapis'\)/g)];
  assert.equal(req.length, 1);
  assert.ok(req[0].index > NURCODE.indexOf('async function main()'), 'googleapis wird schon beim Laden gezogen');
  assert.ok(NURCODE.indexOf("require('../youtube/auth')") > NURCODE.indexOf('async function main()'));
});

test('jeder Schreibaufruf auf die Platte steht in einer der beiden Schreibfunktionen', () => {
  // DR: Bis hierher hiess diese Zusage "steht in schreibeGedaechtnisAtomar".
  // Mit der Einmal-Ermaechtigung schreibt der Uploader eine zweite Datei --
  // die Liste der verbrauchten Zufallswerte -- und loescht die Ermaechtigung.
  // Statt die Zusage aufzuweichen, wird sie wie im Freigabedienst als
  // AUFZAEHLUNG gefuehrt: zwei Funktionen duerfen schreiben, jede andere
  // Zeile faellt durch.
  const bereich = (name) => {
    const start = NURCODE.indexOf('function ' + name);
    assert.ok(start > 0, name + ' gefunden');
    const ende = NURCODE.indexOf('\nfunction ', start + 1);
    assert.ok(ende > start, name + ' hat ein Ende');
    return { start, ende };
  };
  const bereiche = [
    bereich('schreibeGedaechtnisAtomar'),  // data/uploads/<aufnahme>.json
    bereich('verbraucheErmaechtigung'),    // verbraucht.json + Loeschen der Ermaechtigung
  ];
  const drin = (i) => bereiche.some((b) => i > b.start && i < b.ende);
  for (const muster of [/fs\.writeFileSync\(/g, /fs\.openSync\([^)]*'wx'\)/g, /fs\.renameSync\(/g, /fs\.unlinkSync\(/g, /fs\.mkdirSync\(/g, /fs\.fsyncSync\(/g]) {
    const stellen = [...NURCODE.matchAll(muster)];
    assert.ok(stellen.length >= 1, muster + ' fehlt');
    for (const s of stellen) {
      assert.ok(drin(s.index), muster + ' steht ausserhalb der beiden Schreibfunktionen: ' +
        NURCODE.slice(s.index - 60, s.index + 60));
    }
  }
  // Und jede der beiden schreibt auch wirklich.
  for (const b of bereiche) {
    const rumpf = NURCODE.slice(b.start, b.ende);
    assert.ok(/fs\.(writeFileSync|renameSync|unlinkSync)\(/.test(rumpf),
      'eine Schreibfunktion, die nicht schreibt, ist ein Freibrief');
  }
  for (const nie of ['fs.writeFile(', 'fs.appendFileSync', 'fs.rmSync', 'fs.rmdirSync', 'fs.copyFileSync', 'fs.createWriteStream']) {
    assert.ok(!NURCODE.includes(nie), nie + ' kommt vor');
  }
  // Und das Gedaechtnis liegt nur unter data/uploads.
  assert.match(U.gedaechtnisPfad('W', PROBE), /^W[\\/]data[\\/]uploads[\\/]2026-01-01 00-00-00\.json$/);
  assert.throws(() => U.gedaechtnisPfad('W', 'x/y'), /nicht die Form/);
  assert.throws(() => U.gedaechtnisPfad('W', '2026-01-01'), /nicht die Form/);
});

test('der Planer wird nicht angefasst: kein Schreibzugriff auf data/plaene', () => {
  assert.ok(!/plaene[^\n]*(write|rename|unlink)/.test(NURCODE));
  assert.match(U.planPfad('W', PROBE), /data[\\/]plaene[\\/]2026-01-01 00-00-00\.json$/);
});

// ---------------------------------------------------------------------------
// DIE SPERRE
// ---------------------------------------------------------------------------

test('die Sperrliste prueft sich selbst und deckt jede Sperre des Planers', () => {
  assert.deepEqual(U.pruefeSperrliste(), []);
  assert.ok(U.sperreFuer(GESPERRT));
  assert.ok(U.sperreFuer(GESPERRT).grund.length > 100);
  for (const s of P.GESPERRTE_AUFNAHMEN) assert.ok(U.sperreFuer(s.aufnahme), s.aufnahme + ' fehlt im Uploader');
  assert.equal(U.sperreFuer(ECHTE_AUFNAHME), null);
  // Die Sperre greift in der Vorbereitung, bevor eine Datei gelesen wird.
  const v = U.bereiteVor({ projektwurzel: 'gibt-es-nicht', wurzel: 'gibt-es-nicht', aufnahme: GESPERRT, jetzt: JETZT });
  assert.ok(v.gesperrt);
  assert.deepEqual(v.fehler, []);
});

test('N7: die Sperre bricht den Aufruf ab, mit --execute genauso wie ohne', () => {
  for (const args of [[], ['--execute'], ['--anzahl=1', '--execute'], ['--nur-pruefen']]) {
    const r = spawnSync(process.execPath, [SKRIPT, '--plan=' + GESPERRT, ...args], { encoding: 'utf8' });
    assert.equal(r.status, U.EXIT_GESPERRT, JSON.stringify(args) + ': ' + r.stderr);
    assert.match(r.stderr, /GESPERRT/);
    assert.match(r.stderr, /fehlerhaft geschnitten/);
    assert.match(r.stderr, /von Hand/);
    assert.equal(r.stdout, '');
  }
});

test('N7: die Sperre greift auch, wenn ein Plan fuer die Aufnahme von Hand gelegt wurde', () => {
  // In einer Wegwerf-Wurzel, nicht in data/plaene des Repos: dort darf fuer
  // die gesperrte Aufnahme nie eine Planungsdatei liegen -- der Planer-Test
  // haelt genau das fest, und ein Test, der sie kurz anlegt, laeuft ihm in
  // die Quere (die Testdateien laufen nebeneinander).
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(2, GESPERRT);
  schreibePlan(w, termineAus(l.shorts), GESPERRT);
  assert.ok(fs.existsSync(U.planPfad(w, GESPERRT)));
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: GESPERRT, jetzt: JETZT });
  assert.ok(v.gesperrt, 'der Handplan wurde gelesen');
  assert.equal(v.gesperrt.aufnahme, GESPERRT);
  assert.ok(!('auswahl' in v));
  assert.ok(!fs.existsSync(U.gedaechtnisPfad(w, GESPERRT)));
});

// ---------------------------------------------------------------------------
// TEIL 1 -- DIE KONFIGURATION
// ---------------------------------------------------------------------------

test('DP1/DP2a: die ausgelieferte Beschreibungsdatei traegt {titel} oben und die Hashtags an EINER Stelle', () => {
  const datei = fs.readFileSync(path.join(WURZEL, U.BESCHREIBUNG_DATEI), 'utf8').replace(/\r\n?/g, '\n');

  // DP PUNKT 1. Die ersten rund 150 Zeichen der Beschreibung erscheinen in der
  // Suche. Stuende dort bei allen zwoelf Shorts derselbe Satz, saehen alle
  // zwoelf in der Suche gleich aus. Oben steht deshalb der Titel -- der
  // einzige Text dieser Kette, den ein Mensch angesehen und freigegeben hat.
  assert.ok(datei.startsWith('{titel}\n'),
    'die erste Zeile ist nicht {titel}, sondern: ' + JSON.stringify(datei.split('\n')[0]));

  // DP PUNKT 2a. In der Beschreibung steht nur der Platzhalter. Eine feste
  // Hashtag-Zeile hier UND abgeleitete Hashtags dazu hiessen: #krypto steht
  // doppelt unter dem Video, und gepflegt wird spaeter an der falschen Stelle.
  assert.ok(datei.includes('{hashtags}'), '{hashtags} fehlt');
  const istHashtagZeile = (z) => z.trim().length > 0 &&
    z.trim().split(/\s+/).every((w) => /^#[\p{L}\p{N}_]+$/u.test(w));
  const feste = datei.split('\n').filter(istHashtagZeile);
  assert.deepEqual(feste, [],
    'in der Beschreibung steht wieder eine feste Hashtag-Zeile: ' + JSON.stringify(feste));

  // Und der Marker ist weg -- sonst laedt der Uploader ueberhaupt nichts hoch.
  assert.ok(!datei.includes(U.VORLAGEN_MARKER), 'der Vorlagenmarker steht wieder drin');
  assert.deepEqual(U.ladeKonfiguration(WURZEL).fehler, [],
    'die ausgelieferte Konfiguration des Repos ist nicht lauffaehig');
});

test('N2: der Vorlagenmarker wird weiterhin verweigert -- an einer eigenen Datei geprueft', () => {
  // DP: bis hierher hing dieser Test daran, dass die AUSGELIEFERTE Datei die
  // Vorlage IST. Das war richtig, solange sie niemand gefuellt hatte, und fiel
  // in dem Augenblick um, in dem Joshuas Text eintraf -- ohne dass an der
  // Verweigerung selbst irgendetwas kaputt gewesen waere. Derselbe Fehler wie
  // beim Planer-Test in DOa: der Test haengte an einem Zustand, den er nicht
  // besitzt. Die Verweigerung wird deshalb an einer Datei geprueft, die dieser
  // Test selbst schreibt.
  const mitMarker = U.VORLAGEN_MARKER + '\nirgendein Text darunter.\n';
  const g = U.leseBeschreibungsvorlage(mitMarker);
  assert.equal(g.fehler.length, 1);
  assert.match(g.fehler[0], /noch die VORLAGE/);

  const w = wegwerfWurzel(mitMarker);
  try {
    const k = U.ladeKonfiguration(w);
    assert.equal(k.fehler.length, 1);
    assert.match(k.fehler[0], /VORLAGE/);
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }

  // Dieselbe Datei ohne den Marker laeuft durch.
  assert.deepEqual(U.leseBeschreibungsvorlage('Eine echte Beschreibung.\n').fehler, []);
});

test('Platzhalter: {titel} und {hashtags} werden ersetzt, unbekannte sind ein Fehler, ohne beide kommen die Hashtags ans Ende', () => {
  const t = 'Ein Titel';
  const h = ['Krypto', 'Shorts'];
  const a = U.leseBeschreibungsvorlage('{titel}\r\n\r\nText.\r\n\r\n{hashtags}\r\n');
  assert.deepEqual(a.fehler, []);
  assert.deepEqual(a.platzhalter, ['titel', 'hashtags']);
  assert.equal(U.fuelleBeschreibung(a.vorlage, t, h), 'Ein Titel\n\nText.\n\n#Krypto #Shorts');

  const b = U.leseBeschreibungsvorlage('Nur Text ohne Platzhalter.\n');
  assert.deepEqual(b.fehler, []);
  assert.equal(U.fuelleBeschreibung(b.vorlage, t, h), 'Nur Text ohne Platzhalter.\n\n#Krypto #Shorts');

  const c = U.leseBeschreibungsvorlage('Text {titel} {datum} {kanal}\n');
  assert.equal(c.fehler.length, 1);
  assert.match(c.fehler[0], /unbekannte Platzhalter: \{datum\}, \{kanal\}/);

  assert.match(U.leseBeschreibungsvorlage('   \n').fehler[0], /leer/);
  // BOM wird entfernt.
  assert.equal(U.leseBeschreibungsvorlage('﻿Text').vorlage, 'Text');
});

test('N4: die Hashtag-Zuordnung an den echten Titeln -- ganze Woerter, keine Teiltreffer, kein Raten', () => {
  const k = U.leseHashtagKonfiguration(fs.readFileSync(path.join(WURZEL, U.HASHTAGS_DATEI), 'utf8'));
  assert.deepEqual(k.fehler, []);
  // DP: die immer-Liste wird hier NICHT mehr Eintrag fuer Eintrag
  // festgeschrieben. Sie waechst, sobald Joshua eine feste Hashtag-Zeile
  // dazugibt (DP Punkt 2a) -- und dieser Test handelt vom Treffen ganzer
  // Woerter, nicht vom Inhalt der Liste. Wer sie hier festschreibt, laesst
  // diesen Test bei jeder Pflege der Konfiguration umfallen, ohne dass am
  // Treffen etwas kaputt waere. Der Inhalt der Liste steht in DP2a, die
  // Schreibweise in DPa.
  //
  // DPa: auch der WERT der ersten Schreibweise stand hier noch fest ('Krypto')
  // und fiel um, als in DPa die Reihenfolge gedreht wurde. Eine Tatsache
  // gehoert an EINE Stelle. Geprueft wird deshalb nur noch die Eigenschaft,
  // von der dieser Test lebt: dass jede Schreibweise in der immer-Liste beim
  // ERSTEN Vorkommen entschieden wird -- welche das ist, sagt DPa.
  assert.ok(k.immer.length >= 3, 'die immer-Liste ist geschrumpft');
  const ersteVorkommen = k.immer.filter((h, i) =>
    k.immer.findIndex((x) => x.toLocaleLowerCase('de') === h.toLocaleLowerCase('de')) === i);
  assert.deepEqual(U.zuordneHashtags('Ein Titel ohne jedes Stichwort', k).hashtags, ersteVorkommen,
    'nicht jede Schreibweise wird beim ersten Vorkommen entschieden');
  const namen = k.gruppen.map((g) => g.name);
  for (const n of ['Bitcoin', 'XRP', 'Hyperliquid']) assert.ok(namen.includes(n), n + ' fehlt');
  // DP: geprueft wird der ABGELEITETE Teil -- das ist das Thema dieses Tests.
  // Vorher stand hier jedes Mal die volle Liste einschliesslich der
  // immer-dazu; damit fiel der Test um, sobald Joshuas feste Hashtag-Zeile in
  // die immer-Liste einzog (DP Punkt 2a), obwohl am Treffen ganzer Woerter
  // nichts kaputt war. Dass die immer-dazu HINTEN stehen, haelt DP2c fest,
  // und die volle Liste steht unten am Beispiel einer eigenen Konfiguration.
  const abgeleitet = (titel) => U.zuordneHashtags(titel, k).herleitung
    .filter((h) => h.quelle !== 'immer').map((h) => h.hashtag);
  const freigabe = JSON.parse(fs.readFileSync(path.join(WURZEL, 'data', 'freigaben', ECHTE_AUFNAHME + '.json'), 'utf8'));
  const titelVon = (n) => freigabe.freigaben.find((e) => e.kennung.endsWith('/' + n)).titel;
  assert.deepEqual(abgeleitet(titelVon(26)), ['Hyperliquid', 'HYPE']);            // "Hype: Korrektur ..."
  assert.deepEqual(abgeleitet(titelVon(28)), ['XRP', 'Ripple', 'Hyperliquid', 'HYPE']); // "XRP ... bei Hype ..."
  assert.deepEqual(abgeleitet(titelVon(9)), ['Wyckoff']);
  for (const n of [4, 10, 14, 15, 19, 21, 25, 31, 33]) {
    assert.deepEqual(abgeleitet(titelVon(n)), [], 'Kennung /' + n);
  }
  // Ohne Treffer wird nichts abgeleitet -- es bleiben nur die immer-dazu.
  assert.deepEqual(abgeleitet('Ein Titel, in dem kein Stichwort vorkommt'), []);
  assert.deepEqual(U.zuordneHashtags('Ein Titel, in dem kein Stichwort vorkommt', k).hashtags,
    k.immer.filter((h, i) => k.immer.findIndex((x) => x.toLocaleLowerCase('de') === h.toLocaleLowerCase('de')) === i));
  // Teiltreffer mitten im Wort zaehlen nicht.
  assert.deepEqual(abgeleitet('BTCUSD Hypertrophie Ripples Bitcoins'), []);
  // Ganze Woerter schon, egal wie geschrieben und mit Satzzeichen daneben.
  assert.deepEqual(abgeleitet('btc!'), ['Bitcoin', 'BTC']);
  assert.deepEqual(abgeleitet('Bitcoin und XRP'), ['Bitcoin', 'BTC', 'XRP', 'Ripple']);
  // Die volle Liste, an einer eigenen Konfiguration: abgeleitet zuerst, immer danach.
  const eigene = { immer: ['Krypto', 'Shorts'], gruppen: k.gruppen };
  assert.deepEqual(U.zuordneHashtags('Bitcoin und XRP', eigene).hashtags,
    ['Bitcoin', 'BTC', 'XRP', 'Ripple', 'Krypto', 'Shorts']);
  // Die Herleitung nennt Gruppe und Stichwort.
  const her = U.zuordneHashtags('Was macht BTC?', k).herleitung;
  assert.equal(her[0].quelle, 'Gruppe "Bitcoin", Stichwort "BTC" im Titel');
  assert.equal(her[her.length - 1].quelle, 'immer');
  // Doppelte werden nicht doppelt.
  const kk = { immer: ['Shorts', 'shorts'], gruppen: [{ name: 'S', stichwoerter: ['x'], hashtags: ['SHORTS'] }] };
  assert.deepEqual(U.zuordneHashtags('x', kk).hashtags, ['SHORTS']);
  // Mehrwort-Stichwort trifft nur als Folge.
  const km = { immer: [], gruppen: [{ name: 'A', stichwoerter: ['Alltime High'], hashtags: ['ATH'] }] };
  assert.deepEqual(U.zuordneHashtags('durchs Alltime High?', km).hashtags, ['ATH']);
  assert.deepEqual(U.zuordneHashtags('Alltime ist High', km).hashtags, []);
});

test('die Hashtag-Konfiguration wird streng gelesen', () => {
  const f = (o) => U.leseHashtagKonfiguration(JSON.stringify(o)).fehler;
  assert.match(f({ immer: ['#Krypto'], gruppen: [] })[0], /ohne #-Zeichen/);
  assert.match(f({ immer: ['Kry pto'], gruppen: [] })[0], /kein Hashtag/);
  assert.match(f({ immer: [], gruppen: [], extra: 1 })[0], /unbekanntes Feld "extra"/);
  assert.match(f({ immer: [], gruppen: [{ name: 'A', stichwoerter: [''], hashtags: [] }] })[0], /kein Text/);
  assert.match(f({ immer: [], gruppen: [{ name: 'A', stichwoerter: ['x'], hashtags: ['a'] }, { name: 'A', stichwoerter: ['y'], hashtags: ['b'] }] })[0], /doppelt/);
  assert.match(f({ immer: 'Krypto', gruppen: [] })[0], /keine Liste/);
  assert.match(U.leseHashtagKonfiguration('{').fehler[0], /kein JSON/);
});

test('die Veroeffentlichungsfelder werden streng gelesen und stimmen mit dem Kanal ueberein', () => {
  const v = U.leseVeroeffentlichung(fs.readFileSync(path.join(WURZEL, U.VEROEFFENTLICHUNG_DATEI), 'utf8'));
  assert.deepEqual(v.fehler, []);
  assert.deepEqual(v.felder, { categoryId: '27', defaultLanguage: 'de', defaultAudioLanguage: 'de-DE', selfDeclaredMadeForKids: false });
  const f = (o) => U.leseVeroeffentlichung(JSON.stringify(o)).fehler;
  assert.match(f({ categoryId: 27, defaultLanguage: 'de', defaultAudioLanguage: 'de', selfDeclaredMadeForKids: false })[0], /categoryId/);
  assert.match(f({ categoryId: '27', defaultLanguage: 'de', defaultAudioLanguage: 'de' })[0], /selfDeclaredMadeForKids/);
  assert.match(f({ categoryId: '27', defaultLanguage: 'de', defaultAudioLanguage: 'de', selfDeclaredMadeForKids: false, tags: [] })[0], /unbekanntes Feld "tags"/);
});

// ---------------------------------------------------------------------------
// DIE GRENZEN DER API (N3)
// ---------------------------------------------------------------------------

test('N3: 5001 Zeichen, 16 Hashtags, 101 Zeichen Titel, < und > -- jede Grenze bricht mit eigener Meldung', () => {
  const ok = (o) => U.pruefeGrenzen(Object.assign({ kennung: 'k', titel: 'T', beschreibung: 'B' }, o));
  assert.deepEqual(ok({}), []);
  assert.deepEqual(ok({ beschreibung: 'x'.repeat(5000) }), []);
  const b = ok({ beschreibung: 'x'.repeat(5001) });
  assert.equal(b.length, 1);
  assert.match(b[0], /5001 Zeichen .*hoechstens 5000/);
  // 5000 Zeichen, aber mehr als 5000 Bytes: die API zaehlt Bytes.
  const by = ok({ beschreibung: 'ä'.repeat(4000) });
  assert.equal(by.length, 1);
  assert.match(by[0], /4000 Zeichen \(8000 Bytes/);

  assert.deepEqual(ok({ beschreibung: Array.from({ length: 15 }, (_, i) => '#t' + i).join(' ') }), []);
  const h = ok({ beschreibung: Array.from({ length: 16 }, (_, i) => '#t' + i).join(' ') });
  assert.equal(h.length, 1);
  assert.match(h[0], /16 Hashtags, erlaubt sind hoechstens 15/);
  // Titel und Beschreibung werden zusammengezaehlt.
  const hz = ok({ titel: '#a #b', beschreibung: Array.from({ length: 14 }, (_, i) => '#t' + i).join(' ') });
  assert.match(hz[0], /16 Hashtags/);

  assert.deepEqual(ok({ titel: 't'.repeat(100) }), []);
  const t = ok({ titel: 't'.repeat(101) });
  assert.equal(t.length, 1);
  assert.match(t[0], /101 Zeichen, erlaubt sind hoechstens 100/);

  assert.match(ok({ titel: 'a < b' })[0], /Titel enthaelt < oder >/);
  assert.match(ok({ beschreibung: 'a > b' })[0], /Beschreibung enthaelt < oder >/);

  // Alles auf einmal: jede Verletzung ihre eigene Meldung.
  const alle = ok({ titel: 't'.repeat(101) + '<', beschreibung: 'x'.repeat(5001) + '>' + Array.from({ length: 16 }, (_, i) => ' #t' + i).join('') });
  assert.equal(alle.length, 5, alle.join('\n'));
});

test('N3: die Grenzen brechen den Lauf ab, bevor irgendein Video hochgeht -- nicht mittendrin', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(3);
  const termine = termineAus(l.shorts);
  termine[2].titel = 't'.repeat(101); // der DRITTE verletzt die Grenze
  schreibePlan(w, termine);
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  assert.equal(v.fehler.length, 1);
  assert.match(v.fehler[0], /2026-01-01 00-00-00\/3: der Titel hat 101 Zeichen/);
  assert.ok(!('auswahl' in v), 'trotz Verstoss wurde eine Auswahl gebaut');
  assert.ok(!fs.existsSync(U.gedaechtnisPfad(w, PROBE)));

  // Dasselbe mit der Beschreibung: die Vorlage macht sie zu lang.
  const w2 = wegwerfWurzel('{titel}\n' + 'x'.repeat(4990) + '\n{hashtags}');
  schreibePlan(w2, termineAus(l.shorts));
  const v2 = U.bereiteVor({ projektwurzel: w2, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  assert.equal(v2.fehler.length, 3, v2.fehler.join('\n'));
  for (const f of v2.fehler) assert.match(f, /Beschreibung hat \d+ Zeichen/);
});

// ---------------------------------------------------------------------------
// DER PLAN
// ---------------------------------------------------------------------------

test('der Plan wird streng gelesen', () => {
  const basis = () => ({ artifact_type: P.PLAN_ARTIFACT_TYPE, schema_version: '1.0', aufnahme: PROBE, verbindlich: 'publish_at',
    termine: [{ sha256: 'a'.repeat(64), kennung: PROBE + '/1', titel: 'T', publish_at: '2026-09-02T06:55:00.000Z' }] });
  const f = (aendern) => { const d = basis(); aendern(d); return U.lesePlan(JSON.stringify(d), PROBE).fehler; };
  assert.deepEqual(f(() => {}), []);
  assert.match(f((d) => { d.artifact_type = 'x'; })[0], /artifact_type/);
  assert.match(f((d) => { d.schema_version = '2.0'; })[0], /schema_version/);
  assert.match(f((d) => { d.aufnahme = GESPERRT; })[0], /nennt die Aufnahme/);
  assert.match(f((d) => { d.verbindlich = 'publish_at_ortszeit'; })[0], /verbindlich/);
  assert.match(f((d) => { d.termine = []; })[0], /termine ist leer/);
  assert.match(f((d) => { d.termine.push(Object.assign({}, d.termine[0])); })[0], /zweites Mal/);
  assert.match(f((d) => { d.termine[0].publish_at = '2026-09-02T08:55:00+02:00'; })[0], /kein Zeitstempel in UTC/);
  assert.match(f((d) => { d.termine[0].publish_at = '2026-09-02 08:55'; })[0], /kein Zeitstempel in UTC/);
  assert.match(U.lesePlan('{', PROBE).fehler[0], /kein JSON/);
  // Die sha256 des Plans ist die des Textes, wie er auf der Platte liegt.
  const text = JSON.stringify(basis());
  assert.equal(U.lesePlan(text, PROBE).sha256, crypto.createHash('sha256').update(text, 'utf8').digest('hex'));
});

// EH: Die Gegenrichtung zur sha256-Form.
//
// Die Form steht seit EH einmal im Repo (uebergabe-leser.js) und wird von hier
// geholt. Die Gegenprobe dazu -- die eine Fassung absichtlich falsch machen --
// hat gezeigt, dass der Uploader sie nur in EINE Richtung festhielt: wird die
// Form zu STRENG, fallen hier sechzehn Tests, denn dann geht keine echte
// Pruefsumme mehr durch. Wird sie zu FREIZUEGIG (/^[0-9a-f]+$/), fiel hier
// nichts -- der Uploader hatte an keiner seiner drei Stellen einen Fall, in
// dem etwas, das keine sha256 ist, auch abgelehnt werden muss.
//
// Eine Regel, die nur in einer Richtung geprueft ist, ist eine halbe. Dieser
// Test schliesst die andere Richtung an den beiden Stellen, die von hier aus
// erreichbar sind: lesePlan und leseGedaechtnis.

const KEINE_SHA256 = [
  ['zu kurz', 'a'.repeat(63)],
  ['zu lang', 'a'.repeat(65)],
  ['Grossbuchstaben', 'A'.repeat(64)],
  ['keine Hexziffern', 'g'.repeat(64)],
  ['leer', ''],
  ['mit Leerraum', ' ' + 'a'.repeat(63)],
  ['mit Zeilenumbruch', 'a'.repeat(63) + String.fromCharCode(10)],
];

test('EH: was keine sha256 ist, wird abgelehnt -- im Plan und im Gedaechtnis', () => {
  const planBasis = () => ({
    artifact_type: P.PLAN_ARTIFACT_TYPE, schema_version: P.PLAN_SCHEMA_VERSION,
    aufnahme: PROBE, verbindlich: 'publish_at',
    termine: [{ sha256: 'a'.repeat(64), kennung: PROBE + '/1', titel: 'T',
      publish_at: '2026-09-02T06:55:00.000Z' }],
  });
  // Erst die Annahmerichtung -- sonst prueft die Ablehnung nichts.
  assert.deepEqual(U.lesePlan(JSON.stringify(planBasis()), PROBE).fehler, []);

  for (const [was, wert] of KEINE_SHA256) {
    const d = planBasis();
    d.termine[0].sha256 = wert;
    const fehler = U.lesePlan(JSON.stringify(d), PROBE).fehler;
    assert.ok(fehler.length > 0, 'Plan: ' + was + ' ging als sha256 durch.');
    assert.match(fehler[0], /sha256 ist keine sha256-Summe/,
      'Plan: ' + was + ' -- falsche Meldung: ' + fehler[0]);
  }

  // Und dasselbe im Gedaechtnis, an einer Wegwerf-Wurzel.
  const w = wegwerfWurzel();
  fs.mkdirSync(path.join(w, 'data', 'uploads'), { recursive: true });
  const planSha = 'b'.repeat(64);
  const schreibe = (sha) => {
    const g = U.neuesGedaechtnis(PROBE, planSha, JETZT);
    g.uploads.push({ sha256: sha, videoId: 'attrappe-1' });
    fs.writeFileSync(U.gedaechtnisPfad(w, PROBE), JSON.stringify(g, null, 2));
  };
  schreibe('c'.repeat(64));
  assert.deepEqual(U.leseGedaechtnis(w, PROBE, planSha).fehler, [],
    'Ein gueltiges Gedaechtnis muss angenommen werden, sonst prueft die Ablehnung nichts.');
  for (const [was, wert] of KEINE_SHA256) {
    schreibe(wert);
    const fehler = U.leseGedaechtnis(w, PROBE, planSha).fehler;
    assert.ok(fehler.length > 0, 'Gedaechtnis: ' + was + ' ging als sha256 durch.');
    assert.match(fehler[0], /uploads\[0\] ist unvollstaendig/,
      'Gedaechtnis: ' + was + ' -- falsche Meldung: ' + fehler[0]);
  }
});

// ---------------------------------------------------------------------------
// TEIL 2 -- DAS GEDAECHTNIS (N6), DIE PRUEFSUMME (N5), DIE ZEIT (N8), --anzahl (N9)
// ---------------------------------------------------------------------------

test('N6: nach jedem Short wird geschrieben -- sichtbar aus der Attrappe heraus', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(4);
  const planText = schreibePlan(w, termineAus(l.shorts));
  const gPfad = U.gedaechtnisPfad(w, PROBE);
  const gesehen = [];
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  assert.deepEqual(v.fehler, []);
  assert.equal(v.gedaechtnis, null);
  const ergebnis = await U.fuehreUploadsAus({
    vorbereitung: v, projektwurzel: w, pause: async () => {}, jetzt: () => JETZT,
    hochladen: async (a) => {
      // Beim k-ten Aufruf stehen k-1 Eintraege auf der Platte: der vorige
      // wurde geschrieben, BEVOR dieser begann.
      gesehen.push(fs.existsSync(gPfad) ? JSON.parse(fs.readFileSync(gPfad, 'utf8')).uploads.length : 0);
      return { videoId: 'attrappe-' + gesehen.length };
    },
  });
  assert.deepEqual(gesehen, [0, 1, 2, 3]);
  assert.equal(ergebnis.hochgeladen.length, 4);
  const g = gedaechtnis(w);
  assert.equal(g.artifact_type, U.GEDAECHTNIS_ARTIFACT_TYPE);
  assert.equal(g.schema_version, U.GEDAECHTNIS_SCHEMA_VERSION);
  assert.equal(g.aufnahme, PROBE);
  assert.equal(g.plan_sha256, crypto.createHash('sha256').update(planText, 'utf8').digest('hex'));
  assert.equal(g.uploads.length, 4);
  for (const [i, u] of g.uploads.entries()) {
    assert.deepEqual(Object.keys(u), ['sha256', 'kennung', 'videoId', 'hochgeladen_am', 'publish_at', 'titel']);
    assert.equal(u.sha256, l.shorts[i].sha256);
    assert.equal(u.kennung, l.shorts[i].kennung);
    assert.equal(u.videoId, 'attrappe-' + (i + 1));
    assert.equal(u.publish_at, v.auswahl[i].publish_at);
    assert.equal(u.titel, l.shorts[i].titel);
    assert.equal(u.hochgeladen_am, new Date(JETZT).toISOString());
  }
  // Atomar: keine temporaere Datei bleibt liegen.
  assert.deepEqual(fs.readdirSync(path.dirname(gPfad)), [PROBE + '.json']);
  // Der Plan ist unangetastet.
  assert.equal(fs.readFileSync(U.planPfad(w, PROBE), 'utf8'), planText);
  // Der Auftrag an den Upload traegt, was hochgehen soll -- und keinen privacyStatus-Schalter.
  const v2 = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  assert.equal(v2.auswahl.length, 0);
  assert.equal(v2.schonDa.length, 4);
});

test('N6: ein zweiter Lauf ueberspringt alles -- kein zweiter Upload', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(3);
  schreibePlan(w, termineAus(l.shorts));
  const erster = await lauf(w, l);
  assert.equal(erster.protokoll.length, 3);
  const zweiter = await lauf(w, l);
  assert.equal(zweiter.protokoll.length, 0, 'der zweite Lauf hat hochgeladen');
  assert.equal(zweiter.v.auswahl.length, 0);
  assert.deepEqual(zweiter.v.schonDa.map((s) => s.termin.kennung), l.shorts.map((s) => s.kennung));
  assert.equal(gedaechtnis(w).uploads.length, 3);
  // Auch wenn jemand die Auswahl von Hand fuellt: fuehreUploadsAus liest das
  // Gedaechtnis vor jedem Upload erneut von der Platte.
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  v.auswahl = erster.v.auswahl;
  const protokoll = [];
  const e = await U.fuehreUploadsAus({ vorbereitung: v, projektwurzel: w, hochladen: attrappe(protokoll), pause: async () => {}, jetzt: () => JETZT });
  assert.equal(protokoll.length, 0);
  assert.equal(e.uebersprungen.length, 3);
  assert.ok(e.uebersprungen.every((u) => u.grund === 'schon_hochgeladen'));
});

test('N6: Abbruch nach dem dritten Short -- der naechste Lauf macht mit dem vierten weiter', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(5);
  schreibePlan(w, termineAus(l.shorts));
  const protokoll = [];
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  await assert.rejects(
    U.fuehreUploadsAus({ vorbereitung: v, projektwurzel: w, hochladen: attrappe(protokoll, { scheiternBei: 4 }), pause: async () => {}, jetzt: () => JETZT }),
    /Abbruch beim 4\. Upload/
  );
  assert.equal(protokoll.length, 4, 'der vierte Aufruf ist der, der scheitert');
  assert.deepEqual(gedaechtnis(w).uploads.map((u) => u.kennung), l.shorts.slice(0, 3).map((s) => s.kennung));

  const zweiter = await lauf(w, l);
  assert.deepEqual(zweiter.protokoll.map((a) => a.kennung), [l.shorts[3].kennung, l.shorts[4].kennung]);
  assert.deepEqual(zweiter.v.schonDa.map((s) => s.termin.kennung), l.shorts.slice(0, 3).map((s) => s.kennung));
  assert.deepEqual(gedaechtnis(w).uploads.map((u) => u.kennung), l.shorts.map((s) => s.kennung));
});

test('das Gedaechtnis muss zum Plan passen', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(2);
  schreibePlan(w, termineAus(l.shorts));
  await lauf(w, l, { anzahl: 1 });
  // Plan danach veraendert (ein Byte mehr) -> anderes sha256 -> Abbruch.
  fs.appendFileSync(U.planPfad(w, PROBE), '\n');
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  assert.equal(v.fehler.length, 1);
  assert.match(v.fehler[0], /ANDEREN Plan/);
  // Ein kaputtes Gedaechtnis wird nicht repariert.
  fs.writeFileSync(U.gedaechtnisPfad(w, PROBE), '{ kaputt');
  assert.match(U.leseGedaechtnis(w, PROBE, 'x').fehler[0], /kein JSON/);
});

test('N5: eine veraenderte Datei wird uebersprungen, der Lauf geht weiter, das Gedaechtnis bleibt ohne sie', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(4);
  schreibePlan(w, termineAus(l.shorts));
  // Kontrolllauf: alles stimmt.
  const v0 = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  assert.ok(v0.auswahl.every((s) => U.pruefsummenstand(s).status === 'ok'));
  assert.ok(v0.auswahl.every((s) => s.pfad === l.shorts.find((x) => x.kennung === s.kennung).pfad));

  // EIN Byte im zweiten Video.
  const buf = fs.readFileSync(l.shorts[1].pfad);
  buf[100] ^= 0x01;
  fs.writeFileSync(l.shorts[1].pfad, buf);
  // Das dritte verschwindet ganz.
  fs.unlinkSync(l.shorts[2].pfad);

  const { ergebnis, protokoll } = await lauf(w, l);
  assert.deepEqual(protokoll.map((a) => a.kennung), [l.shorts[0].kennung, l.shorts[3].kennung]);
  assert.equal(ergebnis.hochgeladen.length, 2);
  assert.deepEqual(ergebnis.uebersprungen.map((u) => [u.kennung, u.grund]),
    [[l.shorts[1].kennung, 'weicht_ab'], [l.shorts[2].kennung, 'datei_fehlt']]);
  assert.match(ergebnis.uebersprungen[0].text, /eine ANDERE als die freigegebene/);
  const g = gedaechtnis(w);
  assert.deepEqual(g.uploads.map((u) => u.kennung), [l.shorts[0].kennung, l.shorts[3].kennung]);
  assert.ok(!g.uploads.some((u) => u.sha256 === l.shorts[1].sha256));

  // Der uebersprungene bleibt offen: der naechste Lauf nimmt ihn wieder vor
  // -- und ueberspringt ihn wieder, solange die Datei nicht stimmt.
  const noch = await lauf(w, l);
  assert.equal(noch.protokoll.length, 0);
  assert.deepEqual(noch.ergebnis.uebersprungen.map((u) => u.grund), ['weicht_ab', 'datei_fehlt']);
});

test('N5: eine Kennung, die nicht mehr in der Uebergabedatei steht, hat keinen Pfad und wird uebersprungen', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(2);
  const termine = termineAus(l.shorts);
  termine[1].kennung = PROBE + '/99';
  schreibePlan(w, termine);
  const { ergebnis, protokoll, v } = await lauf(w, l);
  assert.equal(v.auswahl[1].pfad, null);
  assert.deepEqual(protokoll.map((a) => a.kennung), [l.shorts[0].kennung]);
  assert.deepEqual(ergebnis.uebersprungen.map((u) => u.grund), ['kennung_fehlt']);
  // Ohne Uebergabedatei gibt es gar keinen Lauf -- es wird kein Pfad erraten.
  fs.unlinkSync(path.join(l.wurzel, PROBE, 'uebergabe.json'));
  const v2 = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  assert.match(v2.fehler[0], /kein Pfad erraten/);
  // Ein Pfad ausserhalb der Wurzel wird nicht genommen.
  const fremd = U.leseUebergabePfade(JSON.stringify({
    artifact_type: L.ARTIFACT_TYPE, schema_version: '1.0', aufnahme: PROBE, erzeugt_am: '2026-01-01T00:00:00+01:00',
    shorts: [{ kennung: PROBE + '/1', pfad: path.join(os.tmpdir(), 'woanders.mp4'), sha256: 'a'.repeat(64) }],
  }), PROBE, l.wurzel);
  assert.deepEqual(fremd.fehler, []);
  assert.equal(fremd.pfade.size, 0);
});

test('N8: ein publishAt in der Vergangenheit bricht ab, bevor irgendetwas geschieht', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(3);
  const termine = termineAus(l.shorts);
  termine[1].publish_at = new Date(JETZT - H).toISOString();
  termine[2].publish_at = new Date(JETZT + 3 * 60 * 1000).toISOString();
  schreibePlan(w, termine);
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  assert.equal(v.fehler.length, 2, v.fehler.join('\n'));
  assert.match(v.fehler[0], /\/2: publish_at .* in der VERGANGENHEIT/);
  assert.match(v.fehler[0], /neu geplant, nicht gebogen/);
  assert.match(v.fehler[1], /\/3: publish_at .* weniger als 5 Minuten voraus/);
  assert.ok(!('auswahl' in v));
  assert.ok(!fs.existsSync(U.gedaechtnisPfad(w, PROBE)));
  // Ein schon hochgeladener Termin in der Vergangenheit stoert nicht: er ist
  // erledigt und wird nicht mehr geprueft.
  const w2 = wegwerfWurzel();
  const t2 = termineAus(l.shorts.slice(0, 2));
  schreibePlan(w2, t2);
  await lauf(w2, l, { anzahl: 1 });
  // Zehn Minuten nach dem ersten Termin: der ist vorbei (und erledigt), der
  // zweite liegt noch 50 Minuten voraus.
  const v2 = U.bereiteVor({ projektwurzel: w2, wurzel: l.wurzel, aufnahme: PROBE, jetzt: Date.parse(t2[0].publish_at) + 10 * 60 * 1000 });
  assert.deepEqual(v2.fehler, []);
  assert.equal(v2.auswahl.length, 1);
  assert.equal(v2.auswahl[0].kennung, l.shorts[1].kennung);
});

test('N9: --anzahl=1 nimmt genau den ersten offenen Short des Plans', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(3);
  schreibePlan(w, termineAus(l.shorts));
  const eins = await lauf(w, l, { anzahl: 1 });
  assert.deepEqual(eins.v.auswahl.map((s) => s.kennung), [l.shorts[0].kennung]);
  assert.deepEqual(eins.v.nichtGewaehlt.map((t) => t.kennung), [l.shorts[1].kennung, l.shorts[2].kennung]);
  assert.deepEqual(eins.protokoll.map((a) => a.kennung), [l.shorts[0].kennung]);
  // Beim naechsten Mal ist der erste erledigt: --anzahl=1 nimmt den zweiten.
  const zwei = await lauf(w, l, { anzahl: 1 });
  assert.deepEqual(zwei.protokoll.map((a) => a.kennung), [l.shorts[1].kennung]);
  // Mehr als offen: alle offenen.
  const rest = await lauf(w, l, { anzahl: 50 });
  assert.deepEqual(rest.protokoll.map((a) => a.kennung), [l.shorts[2].kennung]);
});

test('der Auftrag an den Upload traegt Titel, fertige Beschreibung, publishAt und die Felder fuer alle', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(2);
  schreibePlan(w, termineAus(l.shorts));
  const { protokoll } = await lauf(w, l);
  const a = protokoll[1];
  assert.deepEqual(Object.keys(a), ['kennung', 'pfad', 'titel', 'beschreibung', 'publishAt', 'veroeffentlichung']);
  assert.equal(a.titel, 'Probe 2 mit Bitcoin');
  // DP: nicht mehr die GANZE Hashtag-Zeile, sondern ihr Anfang. Dieser Test
  // handelt vom Auftrag an den Upload -- Titel oben, fertiger Text, Hashtags
  // unten --, nicht vom Inhalt der immer-Liste. Der Anfang haelt trotzdem das
  // fest, worauf es hier ankommt: der Titel steht als erste Zeile, und die
  // abgeleiteten Hashtags stehen VOR den immer-dazu (DP Punkt 2c).
  // DPa: der erste immer-Hashtag ist hier nicht mehr dabei. Er stand hier nur
  // als Anker fuer "abgeleitete zuerst" -- und dafuer genuegen die beiden
  // abgeleiteten. Seine Schreibweise gehoert nach DPa, nicht hierher.
  assert.ok(a.beschreibung.startsWith('Probe 2 mit Bitcoin\n\nProbetext fuer den Test.\n\n#Bitcoin #BTC #'),
    'die fertige Beschreibung faengt anders an:\n' + a.beschreibung);
  assert.match(a.publishAt, /Z$/);
  assert.deepEqual(a.veroeffentlichung, { categoryId: '27', defaultLanguage: 'de', defaultAudioLanguage: 'de-DE', selfDeclaredMadeForKids: false });
  assert.ok(!('privacyStatus' in a));
});

test('meldet YouTube etwas anderes als privat, geht kein weiterer Short hoch', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(3);
  schreibePlan(w, termineAus(l.shorts));
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  let n = 0;
  await assert.rejects(U.fuehreUploadsAus({
    vorbereitung: v, projektwurzel: w, pause: async () => {}, jetzt: () => JETZT,
    hochladen: async () => ({ videoId: 'attrappe-' + (++n), privacyStatus: n === 2 ? 'public' : 'private' }),
  }), /privacyStatus "public" statt "private"/);
  assert.equal(n, 2);
  // Der zweite steht trotzdem im Gedaechtnis: hochgeladen ist hochgeladen.
  assert.equal(gedaechtnis(w).uploads.length, 2);
  // Und ohne videoId bricht der Lauf ebenfalls ab, ohne Gedaechtniseintrag.
  const w2 = wegwerfWurzel();
  schreibePlan(w2, termineAus(l.shorts));
  const v2 = U.bereiteVor({ projektwurzel: w2, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  await assert.rejects(U.fuehreUploadsAus({ vorbereitung: v2, projektwurzel: w2, pause: async () => {}, hochladen: async () => ({}) }), /keine videoId/);
  assert.ok(!fs.existsSync(U.gedaechtnisPfad(w2, PROBE)));
});

test('die Pause liegt zwischen zwei Uploads, nicht nach dem letzten und nicht nach einem uebersprungenen', async () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(3);
  schreibePlan(w, termineAus(l.shorts));
  fs.unlinkSync(l.shorts[1].pfad);
  const pausen = [];
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  await U.fuehreUploadsAus({ vorbereitung: v, projektwurzel: w, hochladen: attrappe([]), pause: async (ms) => { pausen.push(ms); }, jetzt: () => JETZT });
  assert.deepEqual(pausen, [U.PAUSE_MS]);
  assert.equal(U.PAUSE_MS, 5000);
});

// ---------------------------------------------------------------------------
// DIE VORSCHAU (Trockenlauf)
// ---------------------------------------------------------------------------

test('die Vorschau zeigt je Short Titel mit Zeichenzahl, fertige Beschreibung, Hashtags einzeln, publishAt in UTC und Ortszeit, Pfad, Pruefsumme', () => {
  const w = wegwerfWurzel();
  const l = wegwerfLieferung(2);
  schreibePlan(w, termineAus(l.shorts));
  const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
  const t = U.formatiereVorschau(v);
  assert.match(t, /\[2\/2\]  2026-01-01 00-00-00\/2/);
  assert.match(t, /Titel \(19 Zeichen\):   Probe 2 mit Bitcoin/);
  assert.match(t, /publishAt UTC:         2026-09-01T21:00:00\.000Z/);
  assert.match(t, /publishAt Ortszeit:    2026-09-01 23:00 \(UTC\+02:00\)/);
  assert.ok(t.includes('Datei:                 ' + l.shorts[1].pfad));
  assert.match(t, /Pruefsumme:            stimmt/);
  assert.match(t, /#Bitcoin\s+Gruppe "Bitcoin", Stichwort "Bitcoin" im Titel/);
  assert.match(t, /#Shorts\s+immer/);
  assert.match(t, /Beschreibung \(\d+ Zeichen, \d+ Bytes UTF-8\)/);
  // DPa: aus demselben Grund wie oben nur noch die abgeleiteten. Dass die
  // immer-dazu dahinter kommen, haelt DP2c fest; wie sie geschrieben werden,
  // haelt DPa fest.
  assert.match(t, /\| #Bitcoin #BTC #/);
  assert.match(t, /privacyStatus:         private \(fest verdrahtet/);
});

// ---------------------------------------------------------------------------
// DIE BESTAETIGUNG (N10)
// ---------------------------------------------------------------------------

function konsole(eingabe) {
  const input = new PassThrough();
  const output = new PassThrough();
  let gedruckt = '';
  output.on('data', (d) => { gedruckt += d.toString(); });
  if (eingabe !== null) { input.end(eingabe); }
  return { input, output, text: () => gedruckt };
}

test('N10: nicht-interaktiv ist ein eigenes Nein mit eigenem Code, ohne zu lesen', async () => {
  const k = konsole('HOCHLADEN\n');
  const r = await U.bestaetigungEinholen('Frage: ', 'HOCHLADEN', { input: k.input, output: k.output, istTerminal: false });
  assert.equal(r.code, U.EXIT_KEINE_ANTWORT);
  assert.equal(U.EXIT_KEINE_ANTWORT, 4);
  assert.match(r.text, /kein Terminal/);
  assert.equal(k.text(), '', 'die Frage wurde trotzdem gedruckt');
});

test('N10: eine leere Zeile im Eingabepuffer fuehrt zur Nachfrage, nicht zum Abbruch', async () => {
  const k = konsole('\n\nHOCHLADEN\n');
  const r = await U.bestaetigungEinholen('Frage: ', 'HOCHLADEN', { input: k.input, output: k.output, istTerminal: true });
  assert.equal(r, null, 'freigegeben');
  assert.equal((k.text().match(/Keine Eingabe\. Bitte tippe "HOCHLADEN"/g) || []).length, 2);
});

test('N10: drei leere Zeilen, ein falsches Wort, eine geschlossene Eingabe -- drei verschiedene Nein', async () => {
  const leer = konsole('\n\n\n\n');
  const a = await U.bestaetigungEinholen('Frage: ', 'HOCHLADEN', { input: leer.input, output: leer.output, istTerminal: true });
  assert.equal(a.code, U.EXIT_OK);
  assert.match(a.text, /3 mal nur eine leere Zeile/);
  assert.equal(U.MAX_NACHFRAGEN, 2);

  const falsch = konsole('hochladen\n');
  const b = await U.bestaetigungEinholen('Frage: ', 'HOCHLADEN', { input: falsch.input, output: falsch.output, istTerminal: true });
  assert.equal(b.code, U.EXIT_OK);
  assert.match(b.text, /keine Bestaetigung/);

  const zu = konsole('');
  const c = await U.bestaetigungEinholen('Frage: ', 'HOCHLADEN', { input: zu.input, output: zu.output, istTerminal: true });
  assert.equal(c.code, U.EXIT_KEINE_ANTWORT);
  assert.match(c.text, /geschlossen, bevor eine Antwort kam/);
});

test('N10: --execute ohne Terminal bricht mit Code 4 ab, bevor irgendetwas gelesen wird', () => {
  // Eine Aufnahme, fuer die es keinen Plan gibt: kaeme der Lauf bis zum
  // Lesen, hiesse der Fehler "Planungsdatei nicht gefunden" mit Code 1.
  const r = spawnSync(process.execPath, [SKRIPT, '--plan=' + PROBE, '--execute'], { encoding: 'utf8', input: 'HOCHLADEN\n' });
  assert.equal(r.status, U.EXIT_KEINE_ANTWORT, r.stderr);
  assert.match(r.stderr, /stdin ist kein Terminal/);
  assert.match(r.stderr, /NICHTS hochgeladen/);
  assert.equal(r.stdout, '');
  assert.ok(!fs.existsSync(U.gedaechtnisPfad(WURZEL, PROBE)));
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('falsche Aufrufe enden mit Code 2, ohne zu lesen', () => {
  const faelle = [
    { args: ['--plan=' + PROBE, '--erfunden'], muster: /unbekannte\(s\) Argument/ },
    { args: ['--plan=' + PROBE, '--yes'], muster: /unbekannte\(s\) Argument/ },
    { args: ['--plan=2026-01-01', '00-00-00'], muster: /freie Argumente/ },
    { args: [], muster: /--plan= fehlt/ },
    { args: ['--plan=heute'], muster: /nicht die Form/ },
    { args: ['--plan=' + PROBE, '--anzahl=0'], muster: /keine Zahl ab 1/ },
    { args: ['--plan=' + PROBE, '--anzahl=eins'], muster: /keine Zahl ab 1/ },
    { args: ['--plan=' + PROBE, '--execute', '--nur-pruefen'], muster: /schliessen einander aus/ },
  ];
  for (const f of faelle) {
    const r = spawnSync(process.execPath, [SKRIPT, ...f.args], { encoding: 'utf8' });
    assert.equal(r.status, U.EXIT_AUFRUFFEHLER, JSON.stringify(f.args) + ': ' + r.stderr);
    assert.match(r.stderr, f.muster);
    assert.equal(r.stdout, '');
  }
});

test('ein fehlender Plan ist ein Befund (Code 1), kein Aufruffehler', () => {
  const r = spawnSync(process.execPath, [SKRIPT, '--plan=2001-02-03 04-05-06'], { encoding: 'utf8' });
  assert.equal(r.status, U.EXIT_BEFUND);
  assert.match(r.stderr, /Planungsdatei nicht gefunden/);
  assert.match(r.stderr, /NICHTS hochgeladen und kein Netzaufruf/);
});

test('DP N1: die AUSGELIEFERTE Beschreibung ergibt vollstaendige Vorschauen -- an eigener Datenlage', () => {
  // DPb: DIESER TEST HAT KEINE UHR MEHR DARIN.
  //
  // Bis hierher lief er gegen den echten Plan in data/plaene und erwartete
  // Code 0. Das war wahr, als er geschrieben wurde, und wurde am naechsten
  // Vormittag falsch -- nicht weil etwas kaputtging, sondern weil die Termine
  // des Plans verstrichen. Der Uploader lehnte einen abgelaufenen Plan ab, ganz
  // richtig, und der Test meldete das als Fehlschlag.
  //
  // Es ist dasselbe Muster wie beim Planer-Test in DOa und beim
  // Vorlagen-Test in DP: ein Test haengt an einem Zustand, den er nicht
  // besitzt. Neu ist nur, dass der Zustand hier eine UHR enthaelt -- er
  // veraltet von allein, ohne dass jemand etwas anfasst.
  //
  // Geprueft wird deshalb hier die MECHANIK an eigener Datenlage: die echte
  // Beschreibungsdatei und die echte Hashtag-Zuordnung des Repos, aber ein
  // Plan, den dieser Test selbst schreibt, mit festem Zeitpunkt. Der Lauf
  // gegen den echten Plan steht im Test darunter.
  const echteBeschreibung = fs.readFileSync(path.join(WURZEL, U.BESCHREIBUNG_DATEI), 'utf8');
  const w = wegwerfWurzel(echteBeschreibung);
  const l = wegwerfLieferung(3);
  try {
    schreibePlan(w, termineAus(l.shorts));
    const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
    assert.deepEqual(v.fehler, [], 'die ausgelieferte Beschreibung kommt nicht durch die Grenzen');
    assert.equal(v.auswahl.length, 3);

    const text = U.formatiereVorschau(v);
    for (const s of v.auswahl) {
      // Der Titel steht als Hook-Zeile oben ...
      assert.ok(s.beschreibung.startsWith(s.titel + '\n'),
        s.kennung + ': die Beschreibung faengt nicht mit dem Titel an');
      // ... und jede Zeile der fertigen Beschreibung steht in der Vorschau.
      for (const zeile of s.beschreibung.split('\n')) {
        if (!zeile.trim()) continue;
        assert.ok(text.includes(zeile), s.kennung + ': diese Zeile fehlt in der Vorschau: ' + zeile);
      }
    }
    // Drei verschiedene Titel, drei verschiedene erste Zeilen -- der Punkt der
    // Hook-Zeile: in der Suche sehen die Shorts nicht gleich aus.
    const ersteZeilen = new Set(v.auswahl.map((s) => s.beschreibung.split('\n')[0]));
    assert.equal(ersteZeilen.size, 3);
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
    fs.rmSync(l.wurzel, { recursive: true, force: true });
  }
});

test('DP N1: der Trockenlauf gegen den ECHTEN Plan -- oder ein lautes Ueberspringen', (t) => {
  // DPb: Der Lauf gegen die echte Datenlage bleibt erhalten, aber er darf nicht
  // mehr rot werden, nur weil die Uhr weitergegangen ist. Ist der Plan
  // abgelaufen, wird laut uebersprungen und gesagt, was zu tun ist -- ein
  // stilles Ueberspringen waere hier das Schlimmste: es saehe aus wie ein
  // Lauf, der geglueckt ist.
  const pfad = U.planPfad(WURZEL, ECHTE_AUFNAHME);
  if (!fs.existsSync(pfad)) {
    t.skip('data/plaene/' + ECHTE_AUFNAHME + '.json liegt nicht vor (gitignored, wird vom Planer ' +
      'angelegt) -- der Lauf gegen den echten Plan lief NICHT.');
    return;
  }
  const plan = JSON.parse(fs.readFileSync(pfad, 'utf8'));
  const frueheste = Math.min(...plan.termine.map((x) => Date.parse(x.publish_at)));
  if (frueheste <= Date.now() + U.MINDESTVORLAUF_MS) {
    t.skip('Der Plan ist ABGELAUFEN: der fruehste Termin ist ' + new Date(frueheste).toISOString() +
      ', jetzt ist ' + new Date().toISOString() + '. Der Uploader lehnt ihn zu Recht ab -- ' +
      'ein abgelaufener Plan wird neu geplant, nicht gebogen. Der Lauf gegen den echten Plan ' +
      'lief NICHT; die Mechanik prueft der Test darueber an eigener Datenlage.');
    return;
  }
  const r = spawnSync(process.execPath, [SKRIPT, '--plan=' + ECHTE_AUFNAHME], { encoding: 'utf8' });
  assert.equal(r.status, U.EXIT_OK, r.stderr);
  assert.match(r.stdout, /TROCKENLAUF/);

  const konfig = U.ladeKonfiguration(WURZEL);
  assert.deepEqual(konfig.fehler, []);
  for (const termin of plan.termine) {
    assert.ok(r.stdout.includes(termin.titel), termin.kennung + ': der Titel fehlt in der Ausgabe');
    const m = U.baueMetadaten(termin, konfig);
    assert.deepEqual(m.verstoesse, [], termin.kennung);
    for (const zeile of m.beschreibung.split('\n')) {
      if (!zeile.trim()) continue;
      assert.ok(r.stdout.includes(zeile), termin.kennung + ': diese Zeile fehlt in der Ausgabe: ' + zeile);
    }
  }
  assert.ok(!fs.existsSync(U.gedaechtnisPfad(WURZEL, ECHTE_AUFNAHME)),
    'der Trockenlauf hat ein Gedaechtnis angelegt');
});

// ---------------------------------------------------------------------------
// DP -- DIE HOOK-ZEILE UND DIE HASHTAGS
// ---------------------------------------------------------------------------

test('DP2a: die sechs festen Hashtags aus Joshuas Zeile stehen jetzt in der immer-Liste', () => {
  const k = U.ladeKonfiguration(WURZEL);
  assert.deepEqual(k.fehler, []);
  const immerKlein = k.hashtags.immer.map((h) => h.toLocaleLowerCase('de'));
  for (const h of ['krypto', 'bitcoin', 'xrp', 'polymarket', 'okkulteskrypto', 'finanzen']) {
    assert.ok(immerKlein.includes(h), h + ' fehlt in der immer-Liste');
  }
});

test('DP2b: doppelte Hashtags fallen heraus, Gross- und Kleinschreibung egal, die erste Schreibweise gewinnt', () => {
  const konfig = {
    immer: ['krypto', 'KRYPTO', 'Shorts'],
    gruppen: [{ name: 'G', stichwoerter: ['Wyckoff'], hashtags: ['Krypto', 'Wyckoff', 'wyckoff'] }],
  };
  const z = U.zuordneHashtags('Eine Wyckoff Analyse', konfig);
  // 'Krypto' kommt aus der Gruppe ZUERST und gewinnt; 'krypto' und 'KRYPTO'
  // aus immer fallen weg. 'wyckoff' faellt gegen 'Wyckoff' weg.
  assert.deepEqual(z.hashtags, ['Krypto', 'Wyckoff', 'Shorts']);
  assert.deepEqual(z.herleitung.map((h) => h.hashtag), ['Krypto', 'Wyckoff', 'Shorts']);
});

test('DP2c: die Reihenfolge ist fest -- erst die abgeleiteten, dann die immer-dazu', () => {
  const k = U.ladeKonfiguration(WURZEL);
  const titel = 'XRP ausgesteuert, bei Hype weiss ich es nicht';
  const z = U.zuordneHashtags(titel, k.hashtags);
  const quellen = z.herleitung.map((h) => h.quelle === 'immer');
  assert.ok(quellen.includes(false), 'dieser Titel sollte Gruppen treffen');
  assert.ok(quellen.includes(true), 'die immer-Liste sollte etwas beitragen');
  // Kein abgeleiteter steht hinter einem immer: die Folge ist erst false, dann true.
  assert.equal(quellen.lastIndexOf(false) < quellen.indexOf(true), true,
    'ein immer-Hashtag steht vor einem abgeleiteten: ' + JSON.stringify(z.herleitung));
  // Zweimal derselbe Aufruf, zweimal dieselbe Zeile.
  assert.deepEqual(U.zuordneHashtags(titel, k.hashtags).hashtags, z.hashtags);
});

test('DP2d: bei den zwoelf echten Titeln bleibt es unter fuenfzehn Hashtags -- je Titel gezaehlt', (t) => {
  if (!fs.existsSync(U.planPfad(WURZEL, ECHTE_AUFNAHME))) {
    t.skip('data/plaene/' + ECHTE_AUFNAHME + '.json liegt nicht vor -- es wurde nicht gezaehlt.');
    return;
  }
  const plan = JSON.parse(fs.readFileSync(U.planPfad(WURZEL, ECHTE_AUFNAHME), 'utf8'));
  const k = U.ladeKonfiguration(WURZEL);
  assert.deepEqual(k.fehler, []);
  for (const termin of plan.termine) {
    const m = U.baueMetadaten(termin, k);
    const gezaehlt = U.zaehleHashtags(termin.titel) + U.zaehleHashtags(m.beschreibung);
    assert.ok(gezaehlt <= U.HASHTAGS_MAX,
      termin.kennung + ': ' + gezaehlt + ' Hashtags, erlaubt ' + U.HASHTAGS_MAX);
    assert.deepEqual(m.verstoesse, [], termin.kennung);
  }
});

test('DP3: die Form trifft Platzhalter und laesst Fliesstext und geschweifte Klammern in Ruhe', () => {
  const trifft = (t) => { U.ECKIGER_PLATZHALTER.lastIndex = 0; return U.ECKIGER_PLATZHALTER.test(t); };
  for (const p of ['[DISCORD-LINK]', '[MEMBERSHIP-LINK]', '[PLATZHALTER]', '[BTC_2]', '[GRUSS-UEBERSCHRIFT]']) {
    assert.ok(trifft(p), p + ' wird nicht getroffen');
  }
  // GESCHWEIFTE Klammern sind etwas anderes als eckige: {titel} und {hashtags}
  // kollidieren mit dieser Regel nicht. Sie koennten es auch gar nicht -- zum
  // Zeitpunkt der Pruefung sind sie laengst ersetzt.
  for (const p of ['{titel}', '{hashtags}', '[2]', '[a]', 'ganz normaler Text',
    '[1-2 Saetze zum Video: Thema, Kernaussage oder Frage]']) {
    assert.ok(!trifft(p), p + ' wird faelschlich getroffen');
  }
});

test('DP3/N4: eine Beschreibung mit [PLATZHALTER] bricht ab, eine mit {titel} nicht', () => {
  const hashtags = ['Krypto'];

  // Mit {titel}: der Platzhalter wird ersetzt, kein Verstoss.
  const gut = U.fuelleBeschreibung('{titel}\n\nEin Text.\n\n{hashtags}', 'Ein Titel', hashtags);
  assert.ok(gut.startsWith('Ein Titel'));
  assert.deepEqual(U.pruefeGrenzen({ kennung: 'k', titel: 'Ein Titel', beschreibung: gut }), []);

  // Mit [PLATZHALTER]: ein Verstoss, und die Fundstelle steht im Klartext drin.
  const boese = U.fuelleBeschreibung(
    '{titel}\n\nDiscord: [DISCORD-LINK]\nMitglied: [MEMBERSHIP-LINK]\n\n{hashtags}', 'Ein Titel', hashtags);
  const f = U.pruefeGrenzen({ kennung: 'k', titel: 'Ein Titel', beschreibung: boese });
  assert.equal(f.length, 1, f.join(' | '));
  assert.ok(f[0].includes('[DISCORD-LINK]'), f[0]);
  assert.ok(f[0].includes('[MEMBERSHIP-LINK]'), f[0]);
  assert.match(f[0], /eckigen Klammern/);
  assert.ok(f[0].includes(U.BESCHREIBUNG_DATEI), f[0]);

  // Auch ein Platzhalter, der erst ueber den TITEL hereinkommt, faellt auf.
  const ausTitel = U.fuelleBeschreibung('{titel}\n\nText', '[UNBEKANNT-XY]', hashtags);
  assert.equal(U.pruefeGrenzen({ kennung: 'k', titel: '[UNBEKANNT-XY]', beschreibung: ausTitel }).length, 1);
});

test('DP3: ein Platzhalter in eckigen Klammern bricht den Lauf ab, bevor irgendein Video hochgeht', () => {
  const w = wegwerfWurzel('{titel}\n\nKostenloser Discord: [DISCORD-LINK]\n\n{hashtags}\n');
  const l = wegwerfLieferung(3);
  try {
    schreibePlan(w, termineAus(l.shorts));
    const v = U.bereiteVor({ projektwurzel: w, wurzel: l.wurzel, aufnahme: PROBE, jetzt: JETZT });
    // ALLE DREI fallen auf, nicht nur der erste: geprueft wird der ganze Plan,
    // bevor irgendetwas hochgeht.
    assert.equal(v.fehler.length, 3, v.fehler.join(' | '));
    for (const f of v.fehler) assert.ok(f.includes('[DISCORD-LINK]'), f);
    assert.ok(!('auswahl' in v), 'trotz Verstoss wurde eine Auswahl gebaut');
    assert.ok(!fs.existsSync(U.gedaechtnisPfad(w, PROBE)), 'es wurde ein Gedaechtnis angelegt');
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
    fs.rmSync(l.wurzel, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// DPa -- SCHREIBWEISE
// ---------------------------------------------------------------------------

test('DPa: Joshuas Schreibweise gewinnt -- seine sechs stehen vorn in der immer-Liste', () => {
  const k = U.ladeKonfiguration(WURZEL);
  assert.deepEqual(k.fehler, []);
  // Die Regel ist unveraendert (die erste Schreibweise gewinnt, DP Punkt 2b);
  // geaendert hat sich nur die Reihenfolge. Deshalb steht hier die Reihenfolge
  // und nicht die Regel: sie ist das, was in DPa entschieden wurde.
  assert.deepEqual(k.hashtags.immer.slice(0, 6),
    ['krypto', 'bitcoin', 'xrp', 'polymarket', 'okkulteskrypto', 'finanzen'],
    'Joshuas sechs stehen nicht mehr vorn oder nicht mehr in seiner Schreibweise');
});

test('DPa: an den zwoelf echten Titeln erscheint #krypto klein und #Krypto nirgends', (t) => {
  if (!fs.existsSync(U.planPfad(WURZEL, ECHTE_AUFNAHME))) {
    t.skip('data/plaene/' + ECHTE_AUFNAHME + '.json liegt nicht vor -- nicht gemessen.');
    return;
  }
  const plan = JSON.parse(fs.readFileSync(U.planPfad(WURZEL, ECHTE_AUFNAHME), 'utf8'));
  const k = U.ladeKonfiguration(WURZEL);
  assert.deepEqual(k.fehler, []);
  let mitKlein = 0;
  for (const termin of plan.termine) {
    const m = U.baueMetadaten(termin, k);
    assert.ok(m.hashtags.includes('krypto'), termin.kennung + ': #krypto fehlt');
    assert.ok(!m.hashtags.includes('Krypto'),
      termin.kennung + ': #Krypto steht wieder gross da');
    // Und zwar auch im fertigen Text, nicht nur in der Liste.
    assert.ok(m.beschreibung.includes('#krypto'), termin.kennung);
    assert.ok(!/#Krypto\b/.test(m.beschreibung), termin.kennung + ': #Krypto im Text');
    mitKlein++;
  }
  assert.equal(mitKlein, 12);
});

test('DPa: das wirkungslose "Krypto" aendert nichts -- die Ausgabe haengt an der ersten Schreibweise', () => {
  // In der immer-Liste steht hinter Joshuas sechs noch das alte "Krypto". Es
  // ist seit DPa wirkungslos, und dieser Test haelt fest, dass es das ist:
  // nimmt man es heraus, kommt genau dieselbe Zeile heraus. Wer es eines Tages
  // entfernt, soll nicht raten muessen, ob sich dadurch etwas aendert.
  const k = U.ladeKonfiguration(WURZEL);
  const ohne = { immer: k.hashtags.immer.filter((h) => h !== 'Krypto'), gruppen: k.hashtags.gruppen };
  const titel = 'Ein Titel ganz ohne Stichwort';
  assert.deepEqual(U.zuordneHashtags(titel, ohne).hashtags,
    U.zuordneHashtags(titel, k.hashtags).hashtags);
});
