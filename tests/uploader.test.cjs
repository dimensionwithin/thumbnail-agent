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
  assert.deepEqual(U.ERLAUBTE_ARGUMENTE, ['--plan=', '--anzahl=', '--execute', '--nur-pruefen']);
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

test('jeder Schreibaufruf auf die Platte steht in schreibeGedaechtnisAtomar', () => {
  const start = NURCODE.indexOf('function schreibeGedaechtnisAtomar');
  const ende = NURCODE.indexOf('\nfunction ', start + 1);
  assert.ok(start > 0 && ende > start);
  const drin = (i) => i > start && i < ende;
  for (const muster of [/fs\.writeFileSync\(/g, /fs\.openSync\([^)]*'wx'\)/g, /fs\.renameSync\(/g, /fs\.unlinkSync\(/g, /fs\.mkdirSync\(/g, /fs\.fsyncSync\(/g]) {
    const stellen = [...NURCODE.matchAll(muster)];
    assert.ok(stellen.length >= 1, muster + ' fehlt');
    for (const s of stellen) assert.ok(drin(s.index), muster + ' steht ausserhalb von schreibeGedaechtnisAtomar');
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

test('N2: die ausgelieferte Beschreibungsdatei ist die Vorlage, und die Vorlage wird verweigert', () => {
  const roh = fs.readFileSync(path.join(WURZEL, U.BESCHREIBUNG_DATEI), 'utf8');
  assert.ok(roh.includes(U.VORLAGEN_MARKER), 'die ausgelieferte Datei traegt den Marker nicht mehr');
  assert.ok(roh.replace(/\r\n/g, '\n').startsWith(U.VORLAGEN_MARKER + '\n'), 'der Marker steht nicht in der ersten Zeile');
  const g = U.leseBeschreibungsvorlage(roh);
  assert.equal(g.fehler.length, 1);
  assert.match(g.fehler[0], /noch die VORLAGE/);
  // Die ganze Konfiguration des Repos faellt damit durch -- und zwar nur daran.
  const k = U.ladeKonfiguration(WURZEL);
  assert.equal(k.fehler.length, 1);
  assert.match(k.fehler[0], /VORLAGE/);
  // Ohne den Marker laeuft sie.
  const ohne = roh.replace(U.VORLAGEN_MARKER, 'Eine echte Beschreibung.').replace(/[<>]/g, '');
  assert.deepEqual(U.leseBeschreibungsvorlage(ohne).fehler, []);
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
  assert.deepEqual(k.immer, ['Krypto', 'Crypto', 'Shorts']);
  const namen = k.gruppen.map((g) => g.name);
  for (const n of ['Bitcoin', 'XRP', 'Hyperliquid']) assert.ok(namen.includes(n), n + ' fehlt');
  const z = (titel) => U.zuordneHashtags(titel, k).hashtags;
  const freigabe = JSON.parse(fs.readFileSync(path.join(WURZEL, 'data', 'freigaben', ECHTE_AUFNAHME + '.json'), 'utf8'));
  const titelVon = (n) => freigabe.freigaben.find((e) => e.kennung.endsWith('/' + n)).titel;
  assert.deepEqual(z(titelVon(26)), ['Hyperliquid', 'HYPE', 'Krypto', 'Crypto', 'Shorts']);            // "Hype: Korrektur ..."
  assert.deepEqual(z(titelVon(28)), ['XRP', 'Ripple', 'Hyperliquid', 'HYPE', 'Krypto', 'Crypto', 'Shorts']); // "XRP ... bei Hype ..."
  assert.deepEqual(z(titelVon(9)), ['Wyckoff', 'Krypto', 'Crypto', 'Shorts']);
  for (const n of [4, 10, 14, 15, 19, 21, 25, 31, 33]) {
    assert.deepEqual(z(titelVon(n)), ['Krypto', 'Crypto', 'Shorts'], 'Kennung /' + n);
  }
  // Ohne Treffer bleiben nur die immer-dazu.
  assert.deepEqual(z('Ein Titel, in dem kein Stichwort vorkommt'), ['Krypto', 'Crypto', 'Shorts']);
  // Teiltreffer mitten im Wort zaehlen nicht.
  assert.deepEqual(z('BTCUSD Hypertrophie Ripples Bitcoins'), ['Krypto', 'Crypto', 'Shorts']);
  // Ganze Woerter schon, egal wie geschrieben und mit Satzzeichen daneben.
  assert.deepEqual(z('btc!'), ['Bitcoin', 'BTC', 'Krypto', 'Crypto', 'Shorts']);
  assert.deepEqual(z('Bitcoin und XRP'), ['Bitcoin', 'BTC', 'XRP', 'Ripple', 'Krypto', 'Crypto', 'Shorts']);
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
  assert.equal(a.beschreibung, 'Probe 2 mit Bitcoin\n\nProbetext fuer den Test.\n\n#Bitcoin #BTC #Krypto #Crypto #Shorts');
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
  assert.match(t, /\| #Bitcoin #BTC #Krypto #Crypto #Shorts/);
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

test('N1/N2: der Trockenlauf gegen den echten Plan verweigert die Vorlage -- Code 1, kein Upload', (t) => {
  if (!fs.existsSync(U.planPfad(WURZEL, ECHTE_AUFNAHME))) {
    t.skip('data/plaene/' + ECHTE_AUFNAHME + '.json liegt nicht vor (gitignored, wird vom Planer angelegt) -- ' +
      'der Lauf gegen den echten Plan lief NICHT.');
    return;
  }
  const r = spawnSync(process.execPath, [SKRIPT, '--plan=' + ECHTE_AUFNAHME], { encoding: 'utf8' });
  assert.equal(r.status, U.EXIT_BEFUND, r.stderr);
  assert.match(r.stderr, /noch die\s+VORLAGE/);
  assert.equal(r.stdout, '');
});
