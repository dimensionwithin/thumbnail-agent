'use strict';

// ---------------------------------------------------------------------------
// EK: Tests fuer den Longform-Arbeiter (lesende Haelfte) und fuer Teil 1
// ---------------------------------------------------------------------------
//
// Was hier festgehalten wird, ist nicht "es laeuft", sondern "es wirkt":
//
//   1. TEIL 1 BLEIBT ZEICHENGLEICH. Die Hashtag-Zeile und die fertige
//      Beschreibung eines Shorts werden aus der ECHTEN Konfiguration erzeugt
//      und gegen den Stand VOR Teil 1 gehalten -- der im Test nachgebaut wird,
//      indem "Shorts" wieder ans Ende von `immer` wandert. Byte fuer Byte.
//      Dass der Vergleich zuschnappt, wird an zwei absichtlichen Verletzungen
//      vorgefuehrt.
//   2. KEIN SCHREIBENDER AUFRUF IST ERREICHBAR. Die verbotenen Woerter kommen
//      im Quelltext nicht vor, auch nicht ueber eine geliehene Kette; und die
//      schreibenden fs-Funktionen werden scharfgestellt, der volle Durchlauf
//      laeuft dagegen, und danach wird die Falle provoziert.
//   3. DIE TAG-SCHRITTFOLGE. Erst die Dubletten, dann die sechs festen. Die
//      umgekehrte Reihenfolge ergaebe "Krypto" als Tag; die gebaute tut es
//      nicht. Beide laufen hier, gegen dieselbe echte Konfiguration.
//   4. DER TITEL NACH 2.8, samt der Faelle, in denen es keinen gibt.
//
// Dazu die uebrigen Zusagen: die Videodatei (3.2), die Sperrliste (2.11), die
// Grenze von 2 MiB (2.10), die Argumente (3.1) und die Vorschau, die die
// offenen Punkte offen laesst (11).
//
// Alle Tests laufen gegen WEGWERFORDNER unter dem Temp-Verzeichnis. Keiner
// fasst den echten Export- oder Renderordner an; die eine Ausnahme sind die
// drei Konfigurationsdateien unter config/, und die werden nur GELESEN.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const L = require('../src/upload/longform-arbeiter.js');
const U = require('../src/upload/uploader.js');
const P = require('../src/upload/planer.js');

const WURZEL = path.join(__dirname, '..');
const QUELLE = fs.readFileSync(
  path.join(WURZEL, 'src', 'upload', 'longform-arbeiter.js'), 'utf8');

// Eine erfundene Aufnahme. Sie traegt keinen echten Datenbezug.
const AUFNAHME = '2026-08-31 17-36-21';
const TAG = '2026-08-31';
const ANDERE = '2026-08-30 09-12-00';

// ---------------------------------------------------------------------------
// Werkzeug
// ---------------------------------------------------------------------------

function wegwerfordner(marke) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ek-' + marke + '-'));
}

function sha256(puffer) {
  return crypto.createHash('sha256').update(puffer).digest('hex');
}

// Legt einen Render ab. `bytes` ist die Groesse, `name` der volle Dateiname.
function legeRender(ordner, name, bytes) {
  fs.writeFileSync(path.join(ordner, name), Buffer.alloc(bytes, 7));
  return path.join(ordner, name);
}

const WEG = Symbol('feld weglassen');

// Legt Bild + Zettel im Export-Ordner ab. Dieselbe Bauart wie in
// tests/zettel-leser.test.cjs -- absichtlich nachgebaut und nicht geliehen:
// die beiden Testdateien sollen sich nicht gegenseitig umwerfen koennen.
function legeZettel(ordner, basis, felder, bildBytes) {
  const inhalt = bildBytes === undefined
    ? Buffer.from('BILD:' + basis, 'utf8') : Buffer.alloc(bildBytes, 9);
  fs.writeFileSync(path.join(ordner, basis + '.jpg'), inhalt);
  const zettel = Object.assign({
    schema_version: 1,
    exportiert_am: TAG + 'T12:00:00+02:00',
    bild: { dateiname: basis + '.jpg', sha256: sha256(inhalt), bytes: inhalt.length },
    videotitel: 'Bitcoin und XRP im Wyckoff-Muster',
    episode: 'EP. 17',
    datum: TAG,
    format: 'standard',
    chart_quelle: null,
    aufnahme: AUFNAHME,
    aufnahme_herkunft: 'bestaetigt',
  }, felder || {});
  for (const k of Object.keys(zettel)) if (zettel[k] === WEG) delete zettel[k];
  fs.writeFileSync(path.join(ordner, basis + '.json'), JSON.stringify(zettel, null, 2));
  return { zettelname: basis + '.json', bildname: basis + '.jpg', bytes: inhalt.length };
}

// Eine vollstaendige Lage: Render-Ordner mit drei Renders, Export-Ordner mit
// einem Rang-1-Zettel. Das ist der Durchlauf, der WIRKLICH etwas rechnet --
// ein leerer Lauf beweist nichts.
function volleLage(marke, zettelFelder) {
  const render = wegwerfordner(marke + '-render');
  const exp = wegwerfordner(marke + '-export');
  legeRender(render, AUFNAHME + '.matrix-cut.mp4', 3000);
  legeRender(render, ANDERE + '.matrix-cut.mp4', 3200);
  legeRender(render, '2026-08-29 10-00-00.matrix-cut.mp4', 2800);
  // Die drei Muster, die NIE genommen werden (Vertrag 3.2):
  legeRender(render, AUFNAHME + '.upload.mp4', 900000);
  legeRender(render, AUFNAHME + '.upload2.mp4', 900000);
  legeRender(render, AUFNAHME + '.matrix-cut.render-attempt-ab12.libx264.partial.mp4', 900000);
  const zt = legeZettel(exp, 'adw-standard-ep-17', zettelFelder);
  return {
    render, exp, zt,
    weg() {
      fs.rmSync(render, { recursive: true, force: true });
      fs.rmSync(exp, { recursive: true, force: true });
    },
  };
}

function lauf(lage, extra) {
  return L.trockenlauf(Object.assign({
    aufnahme: AUFNAHME, projektwurzel: WURZEL,
    renderWurzel: lage.render, exportOrdner: lage.exp,
  }, extra || {}));
}

// ===========================================================================
// NACHWEIS 1 -- TEIL 1 BLEIBT ZEICHENGLEICH
// ===========================================================================
//
// Der Stand VOR Teil 1 wird hier nachgebaut statt eingefroren: "Shorts" stand
// als letztes Element in `immer`, und die Liste `nur_shorts` gab es nicht. Wer
// den Bau aendert, laeuft gegen diesen Nachbau -- eine eingefrorene Datei
// haette denselben Dienst nur einmal getan.

function konfigVorTeil1(hashtags) {
  return {
    immer: hashtags.immer.concat(hashtags.nur_shorts),
    gruppen: hashtags.gruppen,
    // nur_shorts gibt es im alten Stand nicht.
  };
}

const PROBETITEL = [
  'Bitcoin und XRP im Wyckoff-Muster',
  'Ein Titel ganz ohne Stichwort',
  'HYPE, Ripple und BTC am Alltime High',
  'Polymarket: was die Wetten sagen',
  'Wyckoff',
];

test('EK-N1: die Shorts-Hashtagzeile und die fertige Beschreibung bleiben zeichengleich', () => {
  const k = U.ladeKonfiguration(WURZEL);
  assert.deepEqual(k.fehler, [], 'die echte Konfiguration muss lesbar sein');
  const alt = konfigVorTeil1(k.hashtags);

  for (const titel of PROBETITEL) {
    const vorher = U.zuordneHashtags(titel, alt).hashtags;              // alter Weg
    const nachher = U.zuordneHashtagsFuerShorts(titel, k.hashtags);     // neuer Weg

    assert.deepEqual(nachher.hashtags, vorher,
      'die Hashtag-Zeile hat sich geaendert fuer ' + JSON.stringify(titel));

    const bVorher = U.fuelleBeschreibung(k.beschreibung.vorlage, titel, vorher);
    const bNachher = U.fuelleBeschreibung(k.beschreibung.vorlage, titel, nachher.hashtags);
    assert.equal(Buffer.compare(Buffer.from(bVorher, 'utf8'), Buffer.from(bNachher, 'utf8')), 0,
      'die fertige Beschreibung weicht ab fuer ' + JSON.stringify(titel));
    // Und der Short traegt seinen Hashtag weiter.
    assert.ok(bNachher.includes('#Shorts'), 'unter dem Short fehlt #Shorts');
  }
});

test('EK-N1b: der Vergleich schnappt zu, wenn man ihn verletzt', () => {
  const k = U.ladeKonfiguration(WURZEL);
  const alt = konfigVorTeil1(k.hashtags);
  const titel = PROBETITEL[0];
  const vorher = U.zuordneHashtags(titel, alt).hashtags;

  // A: die Liste haengt VOR `immer` statt dahinter.
  const kaputtA = { immer: k.hashtags.nur_shorts.concat(k.hashtags.immer),
    gruppen: k.hashtags.gruppen, nur_shorts: [] };
  assert.notDeepEqual(U.zuordneHashtagsFuerShorts(titel, kaputtA).hashtags, vorher,
    'A: die Reihenfolge ist verletzt, der Vergleich merkt es nicht');

  // B: niemand haengt die Liste an -- der Hashtag verschwindet.
  const kaputtB = { immer: k.hashtags.immer, gruppen: k.hashtags.gruppen, nur_shorts: [] };
  assert.notDeepEqual(U.zuordneHashtagsFuerShorts(titel, kaputtB).hashtags, vorher,
    'B: der Hashtag fehlt, der Vergleich merkt es nicht');
  const bKaputt = U.fuelleBeschreibung(k.beschreibung.vorlage, titel,
    U.zuordneHashtagsFuerShorts(titel, kaputtB).hashtags);
  const bEcht = U.fuelleBeschreibung(k.beschreibung.vorlage, titel, vorher);
  assert.notEqual(bKaputt, bEcht, 'B: die Beschreibungen sind gleich geblieben');
});

test('EK-N1c: die Vorlage heisst config/beschreibung.txt, und "Shorts" steht in genau ' +
  'einer Liste', () => {
  assert.equal(U.BESCHREIBUNG_DATEI, path.join('config', 'beschreibung.txt'));
  assert.ok(fs.existsSync(path.join(WURZEL, U.BESCHREIBUNG_DATEI)),
    'die Vorlage liegt nicht unter ihrem neuen Namen');
  assert.ok(!fs.existsSync(path.join(WURZEL, 'config', 'shorts-beschreibung.txt')),
    'die Vorlage liegt noch unter ihrem alten Namen -- dann gibt es sie zweimal');

  const roh = JSON.parse(fs.readFileSync(path.join(WURZEL, U.HASHTAGS_DATEI), 'utf8'));
  assert.deepEqual(roh[U.HASHTAG_FELD_NUR_SHORTS], ['Shorts'],
    'die Shorts-Liste der echten Datei');
  const klein = (a) => a.map((x) => x.toLocaleLowerCase('de'));
  assert.ok(!klein(roh.immer).includes('shorts'),
    '"Shorts" steht noch in immer -- dann kaeme es unter jedes Langformvideo');
  for (const g of roh.gruppen) {
    assert.ok(!klein(g.hashtags).includes('shorts'),
      'die Gruppe ' + JSON.stringify(g.name) + ' traegt "Shorts"');
  }
  // Und die Zuordnungsdatei laesst das neue Feld zu, ohne die alten zu verlieren.
  assert.deepEqual(U.ERLAUBTE_HASHTAG_FELDER,
    ['erklaerung', 'immer', 'gruppen', U.HASHTAG_FELD_NUR_SHORTS]);
});

test('EK-N1d: der Longform-Weg nimmt die Shorts-Liste NIE', () => {
  const k = U.ladeKonfiguration(WURZEL);
  for (const titel of PROBETITEL) {
    const lang = U.zuordneHashtags(titel, k.hashtags).hashtags;
    for (const s of k.hashtags.nur_shorts) {
      assert.ok(!lang.map((x) => x.toLocaleLowerCase('de'))
        .includes(s.toLocaleLowerCase('de')),
      'die Shorts-Liste steckt in der Longform-Zeile: ' + s);
    }
    // Und auch nicht als Tag.
    const tags = L.leiteTagsAb(titel, k.hashtags).tags;
    assert.ok(!tags.map((x) => x.toLocaleLowerCase('de')).includes('shorts'),
      'ein Tag "Shorts" unter einem Langformvideo (Vertrag 7)');
  }
});

// ===========================================================================
// NACHWEIS 2 -- KEIN SCHREIBENDER AUFRUF IST ERREICHBAR
// ===========================================================================

const VERBOTENE_WOERTER = [
  'googleapis', 'videos.insert', 'thumbnails.set', 'videos.update',
  // Die beiden Protokolle stehen hier ohne die Doppelpunkt-Schraegstriche,
  // damit diese Zeile nicht selbst der Fund ist, den sie sucht.
  'http' + '://', 'https' + '://',
  'videoId', 'publishAt',
];

test('EK-N2: die verbotenen Woerter kommen im Quelltext nicht vor', () => {
  for (const wort of VERBOTENE_WOERTER) {
    assert.ok(!QUELLE.includes(wort),
      'Der Longform-Arbeiter darf ' + JSON.stringify(wort) + ' nicht enthalten.');
  }
});

test('EK-N2b: keine geliehene Kette zieht die Netzbibliothek herein', () => {
  // Dieser Test laeuft, NACHDEM das Modul oben geladen wurde -- samt allem,
  // was es leiht (uploader, planer, zettel-leser, uebergabe-leser, cli-args).
  const geladen = Object.keys(require.cache).filter((k) => k.includes('googleapis'));
  assert.deepEqual(geladen, [],
    'googleapis wurde ueber eine geliehene Kette geladen: ' + geladen.join(', '));
});

const SCHREIBENDE_FS = [
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'mkdirSync', 'mkdir', 'mkdtempSync', 'mkdtemp',
  'rmSync', 'rm', 'rmdirSync', 'rmdir', 'unlinkSync', 'unlink',
  'renameSync', 'rename', 'copyFileSync', 'copyFile',
  'truncateSync', 'truncate', 'ftruncateSync', 'ftruncate',
  'writeSync', 'write', 'writevSync', 'writev', 'createWriteStream',
  'utimesSync', 'utimes', 'futimesSync', 'chmodSync', 'chmod',
  'symlinkSync', 'symlink', 'linkSync', 'link', 'cpSync', 'cp',
];

// Stellt jede schreibende fs-Funktion scharf. openSync bleibt erlaubt, aber
// nur mit Lesekennzeichen -- genau die Unterscheidung, um die es geht: der
// Arbeiter rechnet sha256 ueber openSync(pfad, 'r').
function falleStellen() {
  const verletzungen = [];
  const echt = {};
  const schnapp = (was) => {
    verletzungen.push(was);
    throw new Error('Schreibfalle: das Modul hat ' + was + ' aufgerufen. ' +
      'Der Longform-Arbeiter schreibt nichts.');
  };
  for (const name of SCHREIBENDE_FS) {
    if (typeof fs[name] !== 'function') continue;
    echt[name] = fs[name];
    fs[name] = function (...args) {
      return schnapp('fs.' + name + '(' + JSON.stringify(String(args[0])) + ')');
    };
  }
  echt.openSync = fs.openSync;
  fs.openSync = function (pfad, kennzeichen, ...rest) {
    const k = kennzeichen === undefined ? 'r' : kennzeichen;
    if (k !== 'r' && k !== 0 && k !== 'rs') {
      return schnapp('fs.openSync(' + JSON.stringify(String(pfad)) +
        ', ' + JSON.stringify(k) + ')');
    }
    return echt.openSync.call(fs, pfad, k, ...rest);
  };
  return {
    verletzungen,
    loesen() { for (const name of Object.keys(echt)) fs[name] = echt[name]; },
  };
}

test('EK-N2c: der volle Durchlauf schreibt nichts', () => {
  const lage = volleLage('schreibfalle');
  // Ein Export-Ordner mit allem, was das Modul anfassen kann.
  legeZettel(lage.exp, 'wider', { aufnahme_herkunft: 'bestaetigt', aufnahme: null });
  legeZettel(lage.exp, 'fremd', { aufnahme_herkunft: 'unbestaetigt', aufnahme: ANDERE });
  fs.writeFileSync(path.join(lage.exp, 'kein-zettel.json'), '{"was":"anderes"}');

  const falle = falleStellen();
  let b;
  let waehrendDesLaufs = null;
  try {
    b = lauf(lage);
  } finally {
    // Erst zaehlen, dann loesen -- sonst schriebe schon die Fehlerausgabe.
    waehrendDesLaufs = falle.verletzungen.length;
    falle.loesen();
  }
  assert.equal(waehrendDesLaufs, 0,
    'Das Modul hat geschrieben: ' + falle.verletzungen.join(', '));

  // Und der Durchlauf war ein echter, kein leerer:
  assert.equal(b.abbruch, null, 'der Lauf haette durchgehen muessen');
  assert.equal(b.video.stand, 'da');
  assert.equal(typeof b.video.sha256, 'string');
  assert.equal(b.video.sha256.length, 64, 'die sha256 wurde wirklich gerechnet');
  assert.equal(b.thumbnail.rang, 1);
  assert.equal(b.thumbnail.regel.bildbefund.sha256_geprueft, true);
  assert.ok(b.metadaten.beschreibung.length > 1000, 'die echte Vorlage wurde gefuellt');
  assert.ok(b.metadaten.tags.length > 0);
  assert.ok(b.saetze.length > 40, 'die Vorschau ist gebaut worden');
  lage.weg();
});

test('EK-N2d: die Schreibfalle schnappt zu, wenn man sie provoziert', () => {
  const o = wegwerfordner('falle-probe');
  const lesbar = path.join(o, 'lesbar.txt');
  fs.writeFileSync(lesbar, 'inhalt');          // vor dem Scharfstellen
  const falle = falleStellen();
  let fehlerA = null;
  let fehlerB = null;
  let lesenGing = false;
  try {
    try { fs.writeFileSync(path.join(o, 'x.txt'), 'x'); } catch (e) { fehlerA = e; }
    try { fs.openSync(path.join(o, 'x.txt'), 'w'); } catch (e) { fehlerB = e; }
    // Lesen bleibt erlaubt -- eine Falle, die alles faengt, faengt nichts.
    const fd = fs.openSync(lesbar, 'r');
    fs.closeSync(fd);
    lesenGing = true;
  } finally {
    falle.loesen();
  }
  assert.ok(fehlerA && /Schreibfalle/.test(fehlerA.message),
    'fs.writeFileSync haette scheitern muessen.');
  assert.ok(fehlerB && /Schreibfalle/.test(fehlerB.message),
    'fs.openSync mit Schreibkennzeichen haette scheitern muessen.');
  assert.equal(lesenGing, true, 'Lesen muss weiter gehen, sonst prueft die Falle nichts.');
  assert.equal(falle.verletzungen.length, 2);
  assert.equal(fs.existsSync(path.join(o, 'x.txt')), false,
    'Die Falle hat das Schreiben nicht nur gemeldet, sondern verhindert.');
  fs.rmSync(o, { recursive: true, force: true });
});

test('EK-N2e: es gibt keine Angabe, ueber die sich ein Schreiben anstossen liesse', () => {
  const lage = volleLage('angaben');
  assert.throws(() => lauf(lage, { execute: true }), /kennt die Angabe "execute" nicht/);
  assert.throws(() => lauf(lage, { bestaetigtDurch: 'x' }),
    /kennt die Angabe "bestaetigtDurch" nicht/);
  assert.throws(() => lauf(lage, { renderZeitstempel: 1 }),
    /kennt die Angabe "renderZeitstempel" nicht/);
  lage.weg();
});

// ===========================================================================
// NACHWEIS 3 -- DIE TAG-SCHRITTFOLGE
// ===========================================================================

test('EK-N3: erst die Dubletten, dann die sechs festen -- und die umgekehrte ' +
  'Reihenfolge ergaebe "Krypto"', () => {
  const k = U.ladeKonfiguration(WURZEL);

  // Die Voraussetzung, an der die ganze Zusage haengt: die echte Liste `immer`
  // traegt zwei Schreibweisen desselben Wortes, die kleine zuerst. Faellt das
  // weg, prueft dieser Test nichts mehr -- also faellt er dann auch.
  const kleinIndex = k.hashtags.immer.indexOf('krypto');
  const grossIndex = k.hashtags.immer.indexOf('Krypto');
  assert.ok(kleinIndex >= 0 && grossIndex >= 0,
    'die echte Liste immer traegt "krypto" und "Krypto" nicht mehr beide');
  assert.ok(kleinIndex < grossIndex, '"krypto" steht nicht mehr vor "Krypto" (DPa)');
  assert.ok(L.FESTE_KANAL_HASHTAGS.includes('krypto'));
  assert.ok(!L.FESTE_KANAL_HASHTAGS.includes('Krypto'),
    'die sechs festen der Kanalvorlage sind kleingeschrieben');

  for (const titel of PROBETITEL) {
    const gebaut = L.leiteTagsAb(titel, k.hashtags).tags;
    const vertauscht = L.leiteTagsAbVertauscht(titel, k.hashtags).tags;

    assert.ok(!gebaut.includes('Krypto'),
      'die gebaute Reihenfolge ergibt "Krypto" als Tag: ' + gebaut.join(', '));
    assert.ok(vertauscht.includes('Krypto'),
      'die vertauschte Reihenfolge ergibt "Krypto" NICHT -- dann macht die ' +
      'Reihenfolge keinen Unterschied und die Zusage haette keinen Gegenstand: ' +
      vertauscht.join(', '));

    // Der Unterschied ist genau dieser eine Tag und kein zweiter.
    assert.deepEqual(vertauscht.filter((t) => t !== 'Krypto'), gebaut,
      'die beiden Reihenfolgen unterscheiden sich in mehr als "Krypto"');
  }

  // Und die gemessene Folge aus dem Vertrag (2.9, ED F3): aus `immer` bleibt
  // ein einziger Eintrag uebrig, "Crypto".
  const ohneTreffer = L.leiteTagsAb('Ein Titel ganz ohne Stichwort', k.hashtags);
  assert.deepEqual(ohneTreffer.tags, ['Crypto']);
  assert.deepEqual(ohneTreffer.entfernt, L.FESTE_KANAL_HASHTAGS.slice(),
    'es wurden nicht genau die sechs festen entfernt');

  // Die Gruppentreffer kommen dazu, mit ihrer Schreibweise.
  assert.deepEqual(L.leiteTagsAb('Bitcoin und XRP', k.hashtags).tags,
    ['Bitcoin', 'BTC', 'XRP', 'Ripple', 'Crypto']);
});

test('EK-N3b: Schritt 3 laesst die Raute weg, und die Grenze von 500 Zeichen wird ' +
  'mit den Kommas gerechnet', () => {
  const k = U.ladeKonfiguration(WURZEL);
  const t = L.leiteTagsAb('Bitcoin und XRP im Wyckoff-Muster', k.hashtags);
  for (const tag of t.tags) assert.ok(!tag.startsWith('#'), 'ein Tag traegt eine Raute: ' + tag);
  assert.equal(t.zeichen, t.tags.join(',').length);
  assert.ok(t.zeichen < L.TAGS_MAX_ZEICHEN);

  // Ueber der Grenze wird es ein Verstoss -- an einer eigenen Konfiguration,
  // damit die echte dafuer nicht aufgeblaeht werden muss.
  const viele = [];
  for (let i = 0; i < 60; i++) viele.push('EinRechtLangerTagNummer' + i);
  const konfig = {
    beschreibung: k.beschreibung,
    hashtags: { immer: viele, gruppen: [], nur_shorts: [] },
    veroeffentlichung: k.veroeffentlichung,
  };
  const m = L.baueLongformMetadaten('Ein Titel', konfig);
  assert.ok(m.tagsZeichen > L.TAGS_MAX_ZEICHEN);
  assert.ok(m.verstoesse.some((v) => v.includes('die Tags sind zusammen')),
    'die Tag-Grenze wurde nicht gemeldet: ' + m.verstoesse.join(' | '));
});

test('EK-N3c: der DPa-Fall wird GESAGT, wenn jemand die Reihenfolge in immer dreht', () => {
  const k = U.ladeKonfiguration(WURZEL);
  // Gedreht: "Krypto" vor "krypto" -- der Zustand von vor DPa.
  const gedreht = {
    immer: ['Krypto'].concat(k.hashtags.immer.filter((h) => h !== 'Krypto')),
    gruppen: k.hashtags.gruppen, nur_shorts: [],
  };
  const t = L.leiteTagsAb('Ein Titel ganz ohne Stichwort', gedreht);
  assert.ok(t.tags.includes('Krypto'), 'gedreht muesste "Krypto" ergeben');
  const hinweise = L.hinweiseZuTags(t.tags, t.herleitung);
  assert.equal(hinweise.length, 1);
  assert.ok(hinweise[0].includes('"Krypto"') && hinweise[0].includes('"krypto"'), hinweise[0]);

  // Und er wird NICHT gesagt fuer die Gruppentreffer, die der Vertrag
  // ausdruecklich zu den erwarteten Tags zaehlt (2.9).
  const echt = L.leiteTagsAb('Bitcoin und XRP', k.hashtags);
  assert.deepEqual(L.hinweiseZuTags(echt.tags, echt.herleitung), [],
    'der Hinweis warnt vor "Bitcoin"/"XRP" -- also vor dem, was zugesagt ist');
});

// ===========================================================================
// NACHWEIS 4 -- DER TITEL NACH 2.8
// ===========================================================================

test('EK-N4: der Titel kommt aus dem Zettel, unveraendert', () => {
  const lage = volleLage('titel', { videotitel: 'Ein ganz bestimmter Titel' });
  const b = lauf(lage);
  assert.equal(b.abbruch, null);
  assert.equal(b.metadaten.titel, 'Ein ganz bestimmter Titel');
  assert.equal(b.metadaten.titelZeichen, U.zaehleTitelZeichen('Ein ganz bestimmter Titel'));
  // Und er steht als erste Zeile in der Beschreibung.
  assert.equal(b.metadaten.beschreibung.split('\n')[0], 'Ein ganz bestimmter Titel');
  lage.weg();
});

test('EK-N4b: videotitel null -- Abbruch nach 2.8, kein Ersatzfeld', () => {
  const lage = volleLage('titel-null', { videotitel: null });
  const b = lauf(lage);
  assert.equal(b.abbruch.code, 'kein_videotitel');
  assert.equal(b.abbruch.nach, '2.8');
  assert.equal(b.abbruch.wert, L.EXIT_BEFUND);
  assert.equal(b.metadaten, null, 'ohne Titel wird nichts gerechnet');
  const text = b.saetze.join('\n');
  assert.ok(text.includes('traegt kein Feld videotitel'), text);
  assert.ok(text.includes('kein Ersatzfeld'), 'die Vorschau nennt den Weg zurueck nicht');
  assert.ok(text.includes('Compositor'));
  lage.weg();
});

test('EK-N4c: videotitel fehlt ganz -- derselbe Ausgang', () => {
  const lage = volleLage('titel-weg', { videotitel: WEG });
  const b = lauf(lage);
  assert.equal(b.abbruch.code, 'kein_videotitel');
  lage.weg();
});

test('EK-N4d: Rang 3 -- ein Bild ohne Zettel reicht fuer das Thumbnail, nicht fuer ' +
  'den Upload', () => {
  const render = wegwerfordner('rang3-render');
  const exp = wegwerfordner('rang3-export');
  legeRender(render, AUFNAHME + '.matrix-cut.mp4', 3000);
  legeRender(render, ANDERE + '.matrix-cut.mp4', 3200);
  legeRender(render, '2026-08-29 10-00-00.matrix-cut.mp4', 2800);
  const bild = path.join(exp, 'adw-standard-frei.jpg');
  fs.writeFileSync(bild, Buffer.from('FREI'));
  const d = new Date(2026, 7, 31, 12, 0, 0);
  fs.utimesSync(bild, d, d);

  const b = L.trockenlauf({ aufnahme: AUFNAHME, projektwurzel: WURZEL,
    renderWurzel: render, exportOrdner: exp });
  assert.equal(b.thumbnail.rang, 3, 'das Bild wurde nicht bestimmt');
  assert.equal(b.abbruch.code, 'rang3_kein_zettel_kein_titel');
  assert.equal(b.abbruch.nach, '2.8');
  assert.equal(b.metadaten, null);
  const text = b.saetze.join('\n');
  assert.ok(text.includes('adw-standard-frei.jpg'),
    'das gefundene Bild steht nicht in der Vorschau');
  assert.ok(text.includes('KEINER -- es gibt keinen Zettel'),
    'die Vorschau sagt nicht, warum es keinen Titel gibt');
  // "Bild gefunden" und "Upload moeglich" sind zwei Zustaende (2.7, Zeile 37).
  assert.notEqual(b.thumbnail.vorschlaege.length, 0);
  fs.rmSync(render, { recursive: true, force: true });
  fs.rmSync(exp, { recursive: true, force: true });
});

test('EK-N4e: ein zu langer Titel und ein Titel mit spitzen Klammern werden gemeldet', () => {
  const lang = 'x'.repeat(U.TITEL_MAX_ZEICHEN + 1);
  const a = volleLage('titel-lang', { videotitel: lang });
  const ba = lauf(a);
  assert.equal(ba.abbruch.code, 'metadaten_verstoss');
  assert.equal(ba.abbruch.nach, '2.9');
  assert.ok(ba.abbruch.satz.includes('der Titel hat ' + (U.TITEL_MAX_ZEICHEN + 1) + ' Zeichen'));
  a.weg();

  const c = volleLage('titel-klammer', { videotitel: 'Ein <b>Titel</b>' });
  const bc = lauf(c);
  assert.ok(bc.abbruch.satz.includes('< oder >'), bc.abbruch.satz);
  c.weg();
});

// ===========================================================================
// DIE VIDEODATEI (Vertrag 3.2)
// ===========================================================================

test('EK-V1: der Pfad wird zusammengebaut und WOERTLICH gezeigt, mit Groesse, ' +
  'mtime und sha256', () => {
  const lage = volleLage('video');
  const b = lauf(lage);
  assert.equal(b.video.dateiname, AUFNAHME + '.matrix-cut.mp4');
  assert.equal(b.video.pfad, path.join(lage.render, AUFNAHME + '.matrix-cut.mp4'));
  assert.equal(b.video.bytes, 3000);
  assert.equal(b.video.sha256, sha256(Buffer.alloc(3000, 7)));
  const text = b.saetze.join('\n');
  assert.ok(text.includes(b.video.pfad), 'der Pfad steht nicht woertlich in der Vorschau');
  assert.ok(text.includes(b.video.sha256));
  assert.ok(text.includes('zusammengebaut'),
    'die Vorschau sagt nicht, dass der Pfad zusammengebaut ist');
  lage.weg();
});

test('EK-V2: fehlt die Datei, bricht der Lauf ab (1) und nennt den zusammengebauten ' +
  'Pfad', () => {
  const lage = volleLage('video-fehlt');
  fs.unlinkSync(path.join(lage.render, AUFNAHME + '.matrix-cut.mp4'));
  const b = lauf(lage);
  assert.equal(b.abbruch.code, 'videodatei_fehlt');
  assert.equal(b.abbruch.nach, '3.2');
  assert.equal(b.abbruch.wert, L.EXIT_BEFUND);
  assert.ok(b.saetze.join('\n').includes(path.join(lage.render, AUFNAHME + '.matrix-cut.mp4')));
  lage.weg();
});

test('EK-V3: .partial, .upload und die Rohaufnahme werden nie genommen und zaehlen ' +
  'nicht ins Mittel', () => {
  const lage = volleLage('video-nachbarn');
  // Die Rohaufnahme eine Ebene hoeher gibt es hier gar nicht -- der Arbeiter
  // liest AUFNAHME_WURZEL nicht (Vertrag 7). Die drei Muster im selben Ordner
  // sind je 900000 Bytes gross; kaemen sie ins Mittel, waere es sechsstellig.
  const b = lauf(lage);
  assert.equal(b.video.bytes, 3000);
  assert.equal(b.video.vergleich.andere, 2, 'es zaehlen genau die zwei echten Renders');
  assert.equal(b.video.vergleich.mittel, 3000);
  assert.equal(b.video.vergleich.auffaellig, false);
  lage.weg();
});

test('EK-V4: die Groessenwarnung sagt beide Zahlen und bricht nichts ab', () => {
  const render = wegwerfordner('groesse-render');
  const exp = wegwerfordner('groesse-export');
  legeRender(render, AUFNAHME + '.matrix-cut.mp4', 100);        // winzig
  legeRender(render, ANDERE + '.matrix-cut.mp4', 10000);
  legeRender(render, '2026-08-29 10-00-00.matrix-cut.mp4', 10000);
  legeZettel(exp, 'adw-standard-ep-17', null);
  const b = L.trockenlauf({ aufnahme: AUFNAHME, projektwurzel: WURZEL,
    renderWurzel: render, exportOrdner: exp });
  assert.equal(b.video.vergleich.auffaellig, true);
  assert.ok(b.video.vergleich.satz.includes('100'), 'die eigene Zahl fehlt');
  assert.ok(b.video.vergleich.satz.includes('10000'), 'das Mittel fehlt');
  assert.equal(b.abbruch, null, 'die Warnung hat abgebrochen -- sie soll es nicht');
  assert.ok(b.saetze.join('\n').includes('ACHTUNG, Groessenvergleich'));
  fs.rmSync(render, { recursive: true, force: true });
  fs.rmSync(exp, { recursive: true, force: true });
});

test('EK-V5: unter zwei anderen Dateien gibt es kein Mittel -- und die Vorschau ' +
  'SAGT es, statt zu schweigen', () => {
  const render = wegwerfordner('kein-mittel-render');
  const exp = wegwerfordner('kein-mittel-export');
  legeRender(render, AUFNAHME + '.matrix-cut.mp4', 3000);
  legeRender(render, ANDERE + '.matrix-cut.mp4', 3200);   // nur EINE andere
  legeZettel(exp, 'adw-standard-ep-17', null);
  const b = L.trockenlauf({ aufnahme: AUFNAHME, projektwurzel: WURZEL,
    renderWurzel: render, exportOrdner: exp });
  assert.equal(b.video.vergleich.mittel, null);
  assert.equal(b.video.vergleich.andere, 1);
  assert.ok(b.saetze.join('\n').includes('gibt es kein Mittel'));
  assert.equal(b.abbruch, null);
  fs.rmSync(render, { recursive: true, force: true });
  fs.rmSync(exp, { recursive: true, force: true });
});

// ===========================================================================
// DIE GRENZE VON 2 MiB (Vertrag 2.10)
// ===========================================================================

test('EK-B1: ein Bild ueber 2 MiB bricht ab -- VOR dem ersten schreibenden Aufruf', () => {
  const lage = volleLage('bild-gross', undefined);
  // Der Zettel aus volleLage traegt ein winziges Bild; hier ein eigenes.
  const lage2 = { render: lage.render, exp: wegwerfordner('bild-gross-export'), weg: lage.weg };
  legeZettel(lage2.exp, 'adw-standard-gross', null, L.THUMBNAIL_MAX_BYTES + 1);
  const b = L.trockenlauf({ aufnahme: AUFNAHME, projektwurzel: WURZEL,
    renderWurzel: lage2.render, exportOrdner: lage2.exp });
  assert.equal(b.abbruch.code, 'bild_zu_gross');
  assert.equal(b.abbruch.nach, '2.10');
  assert.ok(b.abbruch.satz.includes(String(L.THUMBNAIL_MAX_BYTES)));
  lage.weg();
  fs.rmSync(lage2.exp, { recursive: true, force: true });
});

test('EK-B2: genau 2 MiB gehen durch -- die Grenze ist "hoechstens", nicht "unter"', () => {
  const render = wegwerfordner('bild-genau-render');
  const exp = wegwerfordner('bild-genau-export');
  legeRender(render, AUFNAHME + '.matrix-cut.mp4', 3000);
  legeRender(render, ANDERE + '.matrix-cut.mp4', 3200);
  legeRender(render, '2026-08-29 10-00-00.matrix-cut.mp4', 2800);
  legeZettel(exp, 'adw-standard-genau', null, L.THUMBNAIL_MAX_BYTES);
  const b = L.trockenlauf({ aufnahme: AUFNAHME, projektwurzel: WURZEL,
    renderWurzel: render, exportOrdner: exp });
  assert.equal(b.abbruch, null, b.abbruch && b.abbruch.satz);
  fs.rmSync(render, { recursive: true, force: true });
  fs.rmSync(exp, { recursive: true, force: true });
});

// ===========================================================================
// DIE SPERRLISTE (Vertrag 2.11)
// ===========================================================================

test('EK-S1: jede Sperre des Planers und des Uploaders steht auch hier', () => {
  assert.deepEqual(L.pruefeSperrliste(), []);
  const meine = new Set(L.GESPERRTE_AUFNAHMEN.map((s) => s.aufnahme));
  for (const s of P.GESPERRTE_AUFNAHMEN) assert.ok(meine.has(s.aufnahme), 'Planer: ' + s.aufnahme);
  for (const s of U.GESPERRTE_AUFNAHMEN) assert.ok(meine.has(s.aufnahme), 'Uploader: ' + s.aufnahme);
});

test('EK-S2: eine gesperrte Aufnahme endet mit 3, vor jedem Zugriff auf die Platte', () => {
  const gesperrt = L.GESPERRTE_AUFNAHMEN[0].aufnahme;
  // Wegwerfordner, die es GAR NICHT gibt: greift die Sperre wirklich vor dem
  // Lesen, stoert das nicht. Liest der Lauf vorher, faellt er darueber.
  const b = L.trockenlauf({
    aufnahme: gesperrt, projektwurzel: WURZEL,
    renderWurzel: path.join(os.tmpdir(), 'ek-gibt-es-nicht-render'),
    exportOrdner: path.join(os.tmpdir(), 'ek-gibt-es-nicht-export'),
  });
  assert.equal(b.abbruch.code, 'aufnahme_gesperrt');
  assert.equal(b.abbruch.wert, L.EXIT_GESPERRT);
  assert.equal(b.video, null, 'die Videodatei wurde trotz Sperre angefasst');
  assert.equal(b.thumbnail, null, 'der Export-Ordner wurde trotz Sperre gelesen');
  assert.ok(b.saetze.join('\n').includes('kein Argument, das die Sperre umgeht'));
});

// ===========================================================================
// DIE ARGUMENTE (Vertrag 3.1)
// ===========================================================================

const ARBEITER = path.join(WURZEL, 'src', 'upload', 'longform-arbeiter.js');

function rufeArbeiter(argumente, umgebung) {
  const { spawnSync } = require('node:child_process');
  const lauf2 = spawnSync(process.execPath, [ARBEITER, ...argumente], {
    encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, process.env, umgebung || {}),
  });
  return { code: lauf2.status, aus: (lauf2.stdout || '') + (lauf2.stderr || '') };
}

test('EK-A1: --execute und --bestaetigt-durch= bekommen ihre EIGENE Meldung, nicht ' +
  'die fuer unbekannte Argumente', () => {
  // Die Pruefung laeuft als erste Anweisung und nimmt darum die Zahl aus
  // cli-args. Beide Namen muessen dieselbe Zahl tragen.
  assert.equal(require('../src/publish/cli-args.js').EXIT_ARGUMENTFEHLER,
    L.EXIT_AUFRUFFEHLER, 'zwei Namen fuer eine Zahl sind auseinandergelaufen');
  for (const arg of ['--execute', '--bestaetigt-durch=irgendwas']) {
    const r = rufeArbeiter(['--aufnahme=' + AUFNAHME, arg]);
    assert.equal(r.code, L.EXIT_AUFRUFFEHLER, arg + ': ' + r.aus);
    assert.ok(r.aus.includes('gibt es hier heute nicht'), arg + ': ' + r.aus);
    assert.ok(r.aus.includes('SCHREIBENDE'), arg + ': die Meldung sagt nicht, was fehlt');
    assert.ok(!r.aus.includes('unbekannte(s) Argument'),
      arg + ': das ist die Meldung fuer ein UNBEKANNTES Argument -- diese hier sind bekannt');
    assert.ok(r.aus.includes('NICHTS gelesen'), arg);
  }
});

test('EK-A2: ein wirklich unbekanntes Argument, ein freies Argument und eine schiefe ' +
  'Aufnahme enden mit 2', () => {
  const a = rufeArbeiter(['--aufnahme=' + AUFNAHME, '--wurzel=x']);
  assert.equal(a.code, L.EXIT_AUFRUFFEHLER);
  assert.ok(a.aus.includes('unbekannte(s) Argument'), a.aus);

  // Der zerfallene Aufnahmename -- der Fall, den die geliehene Pruefung faengt.
  const b = rufeArbeiter(['--aufnahme=2026-08-31', '17-36-21']);
  assert.equal(b.code, L.EXIT_AUFRUFFEHLER);
  assert.ok(b.aus.includes('Anfuehrungszeichen'), b.aus);

  const c = rufeArbeiter(['--aufnahme=31.08.2026']);
  assert.equal(c.code, L.EXIT_AUFRUFFEHLER);
  assert.ok(c.aus.includes('JJJJ-MM-TT HH-MM-SS'), c.aus);
});

test('EK-A3: ein fehlender Einstellungsschluessel endet mit 2 und nennt ihn', () => {
  const ohne = { [L.RENDER_WURZEL_SCHLUESSEL]: '', [L.EXPORT_ORDNER_SCHLUESSEL]: '' };
  const r = rufeArbeiter(['--aufnahme=' + AUFNAHME], ohne);
  assert.equal(r.code, L.EXIT_AUFRUFFEHLER, r.aus);
  assert.ok(r.aus.includes(L.RENDER_WURZEL_SCHLUESSEL), r.aus);
  assert.ok(r.aus.includes('kein Argument'), 'die Meldung sagt nicht, dass es dafuer keines gibt');
});

test('EK-A4: --zettel= nimmt nur einen Dateinamen, keinen Pfad', () => {
  const r = rufeArbeiter(['--aufnahme=' + AUFNAHME, '--zettel=' + path.join('unter', 'x.json')]);
  assert.equal(r.code, L.EXIT_AUFRUFFEHLER);
  assert.ok(r.aus.includes('kein blosser'), r.aus);
  // Und im Modul ebenso.
  const lage = volleLage('zettel-pfad');
  assert.throws(() => lauf(lage, { zettel: path.join('unter', 'x.json') }),
    /kein blosser Dateiname/);
  lage.weg();
});

// ===========================================================================
// DIE VORSCHAU
// ===========================================================================

test('EK-P1: die Vorschau sagt, dass die erste Zeile von der Kanalvorlage abweicht, ' +
  'und laesst 11.2 offen', () => {
  const lage = volleLage('vorschau-hook');
  const text = lauf(lage).saetze.join('\n');
  assert.ok(text.includes('WEICHT VON DER'), 'die Abweichung wird nicht genannt');
  assert.ok(text.includes('KANALVORLAGE AB'));
  assert.ok(text.includes('OFFEN (Vertrag 11.2)'), 'der offene Punkt wird nicht als offen benannt');
  // Und sie erfindet keine Hook-Zeile: die erste Zeile IST der Titel.
  const b = lauf(lage);
  assert.equal(b.metadaten.beschreibung.split('\n')[0], b.metadaten.titel);
  lage.weg();
});

test('EK-P2: die Vorschau nennt alle vier offenen Punkte und die fehlende Haelfte', () => {
  const lage = volleLage('vorschau-luecken');
  const text = lauf(lage).saetze.join('\n');
  for (const stelle of ['11.1', '11.2', '11.3', '11.4']) {
    assert.ok(text.includes(stelle), 'der offene Punkt ' + stelle + ' fehlt in der Vorschau');
  }
  assert.ok(text.includes('WAS DIESER LAUF NICHT KANN'));
  assert.ok(text.includes('Gedaechtnis'), 'das nicht gebaute Gedaechtnis wird verschwiegen');
  assert.ok(text.includes('keine Ermaechtigung'));
  lage.weg();
});

test('EK-P3: der erste Satz sagt immer, dass kein Video auf dem Kanal liegt', () => {
  const gut = volleLage('erster-satz-gut');
  const schlecht = volleLage('erster-satz-schlecht', { videotitel: null });
  for (const lage of [gut, schlecht]) {
    const zeilen = lauf(lage).saetze;
    const wo = zeilen.findIndex((z) => z.includes('Kein Video dieses Laufs auf dem Kanal'));
    assert.ok(wo >= 0 && wo < 6, 'der Satz steht nicht am Anfang: ' + zeilen.slice(0, 6).join(' / '));
    lage.weg();
  }
  // Und beim Abbruch steht er noch einmal am Schluss.
  const s = volleLage('erster-satz-schluss', { videotitel: null });
  const t = lauf(s).saetze.join('\n');
  assert.equal((t.match(/Kein Video dieses Laufs auf dem Kanal/g) || []).length, 2);
  s.weg();
});

test('EK-P4: die Vorschau traegt nie beide Wortteile, an denen der Knopf der ' +
  'Gegenseite die Sperrmeldung erkennt', () => {
  // Der Freigabedienst reicht das stderr des Arbeiters unveraendert durch
  // (Vertrag 6). Traegt eine Vorschau beide Wortteile, deutete der Knopf der
  // Gegenseite einen Longform-Befund als "Sitzung laeuft schon". Zwei
  // Zustaende, eine Deutung -- der Umriss jedes Fehlers dieser Reihe.
  const lagen = [
    volleLage('wortteile-1'),
    volleLage('wortteile-2', { videotitel: null }),
    volleLage('wortteile-3', { aufnahme: ANDERE }),
  ];
  const texte = lagen.map((lage) => lauf(lage).saetze.join('\n'));
  texte.push(L.trockenlauf({
    aufnahme: L.GESPERRTE_AUFNAHMEN[0].aufnahme, projektwurzel: WURZEL,
    renderWurzel: lagen[0].render, exportOrdner: lagen[0].exp,
  }).saetze.join('\n'));
  for (const t of texte) {
    const flach = t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    assert.ok(!(flach.includes('laeuft bereits') && flach.includes('freigabesitzung')),
      'diese Vorschau traegt beide Wortteile: ' + t.slice(0, 200));
  }
  for (const lage of lagen) lage.weg();
});

test('EK-P5: die Vorschau des Trockenlaufs geht auf stdout und endet mit 0; ein ' +
  'Befund geht auf stderr und endet mit 1', () => {
  const gut = volleLage('cli-gut');
  const r = rufeArbeiter(['--aufnahme=' + AUFNAHME], {
    [L.RENDER_WURZEL_SCHLUESSEL]: gut.render, [L.EXPORT_ORDNER_SCHLUESSEL]: gut.exp });
  assert.equal(r.code, L.EXIT_OK, r.aus);
  assert.ok(r.aus.includes('LONGFORM-TROCKENLAUF'), r.aus);
  assert.ok(r.aus.includes('BEREIT.'));
  gut.weg();

  const schlecht = volleLage('cli-schlecht', { videotitel: null });
  const r2 = rufeArbeiter(['--aufnahme=' + AUFNAHME], {
    [L.RENDER_WURZEL_SCHLUESSEL]: schlecht.render,
    [L.EXPORT_ORDNER_SCHLUESSEL]: schlecht.exp });
  assert.equal(r2.code, L.EXIT_BEFUND, r2.aus);
  assert.ok(r2.aus.includes('ABBRUCH nach Vertrag 2.8'), r2.aus);
  schlecht.weg();
});

// ===========================================================================
// DAS THUMBNAIL WIRD GELIEHEN, NICHT NACHGEBAUT
// ===========================================================================

test('EK-T1: der Befund des Beipackzettel-Lesers steht unveraendert in der Vorschau', () => {
  const Z = require('../src/upload/zettel-leser.js');
  const lage = volleLage('geliehen');
  const b = lauf(lage);
  // Derselbe Aufruf, denselben Befund: das Modul legt nichts dazu und nichts weg.
  const eigen = Z.befundeKandidaten({ aufnahme: AUFNAHME, exportOrdner: lage.exp });
  assert.deepEqual(b.thumbnail.saetze, eigen.saetze);
  assert.equal(b.thumbnail.rang, eigen.rang);
  const text = b.saetze.join('\n');
  for (const zeile of eigen.saetze) {
    if (zeile === '') continue;
    assert.ok(text.includes(zeile), 'diese Zeile des Lesers fehlt in der Vorschau: ' + zeile);
  }
  lage.weg();
});

test('EK-T2: der Arbeiter baut die Zustandsmatrix nicht nach', () => {
  // Sie steht in genau einem Modul. Eine zweite Stelle, die sie auslegt, waere
  // die zweite Wahrheit, gegen die dieser Vertrag durchgehend gebaut ist.
  for (const wort of ['rang1_regel', 'rang2a_vorschlag', 'rang2b_vorschlag', 'aufnahme_herkunft',
    'unbestaetigt', 'MATRIX']) {
    assert.ok(!QUELLE.includes(wort),
      'Der Arbeiter legt die Matrix selbst aus (' + wort + ') -- statt sie zu leihen.');
  }
  assert.ok(QUELLE.includes("require('./zettel-leser')"),
    'Der Beipackzettel-Leser wird nicht importiert.');
});

test('EK-T3: ein Vorschlag wird als Vorschlag gezeigt und nie als Regel', () => {
  const lage = volleLage('vorschlag', { aufnahme_herkunft: 'unbestaetigt' });
  const b = lauf(lage);
  assert.equal(b.thumbnail.rang, 2);
  const text = b.saetze.join('\n');
  assert.ok(text.includes('DAS IST EIN VORSCHLAG UND KEINE REGEL'), text.slice(0, 400));
  assert.ok(text.includes('nie ohne Rueckfrage'));
  assert.ok(text.includes('sha256'), 'das Ja traegt sha256 -- die Vorschau muss sie zeigen');
  lage.weg();
});
