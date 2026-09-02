'use strict';

// DQ: Tests fuer die vier Zusagen aus dem Auftrag DQ.
//
// WARUM ES DIESE DATEI GIBT: Alle vier Befunde von DQ sind Loecher, die man
// nicht sieht. Ein freies Argument, das durchfaellt; ein Flag, das "dry" heisst
// und schreibt; ein Skript, das bei einem Tippfehler live geht; eine Pruefung,
// die schweigend weniger prueft, als sie meldet. Keiner dieser Zustaende sieht
// im Betrieb falsch aus -- deshalb sind sie ueberhaupt so lange geblieben.
//
// Ein Test, der sie festhaelt, ist der einzige Grund, warum sie beim naechsten
// Umbau nicht zurueckkommen. Genau dieselbe Ueberlegung steht in
// planer.test.cjs und uploader.test.cjs.
//
// KEIN Test hier laedt googleapis, geht ins Netz oder schreibt in data/.
// Wo geschrieben werden koennte, zeigt der Test auf ein Ziel in os.tmpdir().

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const WURZEL = path.join(__dirname, '..');

// Der Quelltext ohne Kommentare -- ein require in einem Kommentar ist kein
// require, und ein Aufruf in einem Kommentar ist kein Aufruf.
function nurCode(rel) {
  return fs.readFileSync(path.join(WURZEL, rel), 'utf8')
    .split('\n')
    .filter((z) => !/^\s*\/\//.test(z))
    .join('\n');
}

function lauf(rel, argumente, env) {
  return spawnSync(process.execPath, [path.join(WURZEL, rel), ...argumente], {
    cwd: WURZEL, encoding: 'utf8', timeout: 60000,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

// JEDER Lauf hier ist so gebaut, dass auch der FEHLSCHLAG folgenlos bleibt.
//
// Der Grund steht im Bericht DQ: die erste Fassung dieser Datei rief decide.js
// und backup.js ohne --out auf. Gegen den korrigierten Stand ist das harmlos --
// die Argumentpruefung bricht vorher ab. Gegen den ALTEN Stand, bei der
// Gegenprobe, lief beides durch: decide.js schrieb data/proposals.json neu,
// und backup.js machte einen LIVE-Lauf mit echten Zugangsdaten und legte
// backups/manifest.json an. Beides wurde zurueckgenommen.
//
// Ein Test, der genau dann Schaden anrichtet, wenn er anschlaegt, taugt nichts:
// er ist am gefaehrlichsten in dem Moment, fuer den es ihn gibt. Deshalb
// zeigt jeder Lauf sein --out= auf os.tmpdir(), und die backup.js-Tests
// nehmen dem Kindprozess ueber YOUTUBE_TOKEN_PATH die Credentials weg --
// youtubeAvailable() ist dann false und der Live-Zweig unerreichbar.
const OHNE_CREDENTIALS = {
  YOUTUBE_TOKEN_PATH: path.join(os.tmpdir(), 'dq-token-gibt-es-nicht.json'),
  YOUTUBE_CLIENT_ID: '',
};

const EXIT_AUFRUF = 2;

// ---------------------------------------------------------------------------
// PUNKT 1 -- freie Argumente in den beiden Skripten, die auf YouTube schreiben
// ---------------------------------------------------------------------------
//
// unbekannteArgumente in cli-args.js filtert auf startsWith('-'). Ein freies
// Argument beginnt nicht mit '-' und war dieser Pruefung damit unsichtbar.
// Gemessen in DQ: `publish.js --nur-pruefen quatsch-frei` lief kommentarlos
// durch, ebenso bei restore.js.

for (const [rel, flag] of [
  ['src/publish/publish.js', '--in='],
  ['src/publish/restore.js', '--backups='],
]) {
  test(`DQ1: ${rel} lehnt ein freies Argument ab`, () => {
    const r = lauf(rel, ['--nur-pruefen', 'quatsch-frei']);
    assert.equal(r.status, EXIT_AUFRUF, 'Exit 2 erwartet, bekam ' + r.status);
    assert.match(r.stderr, /freie Argumente gibt es hier nicht/);
    assert.match(r.stderr, /"quatsch-frei"/);
    // Die Zusage, auf die es ankommt: es wurde nichts getan.
    assert.match(r.stderr, /NICHTS geschrieben und kein Netzaufruf/);
    // Und der Lauf ist wirklich nicht angelaufen -- keine Modusmeldung.
    assert.ok(!/TROCKENLAUF|Modus:/.test(r.stdout),
      'das Skript ist trotz Abbruch angelaufen:\n' + r.stdout);
  });

  test(`DQ1: ${rel} bindet pruefeKeineFreienArgumente ein, statt sie nachzubauen`, () => {
    const code = nurCode(rel);
    assert.match(code,
      /const \{ pruefeKeineFreienArgumente \} = require\('\.\.\/upload\/uebergabe-leser'\)/,
      'nicht importiert');
    assert.ok(!/function pruefeKeineFreienArgumente/.test(code),
      'nachgebaut statt importiert');
    // Sie steht NACH pruefeArgumenteStrikt -- erst das Bekannte pruefen, dann
    // das Freie; die Meldungen bleiben so in der Reihenfolge, in der jemand
    // seine Zeile liest.
    const wo = (s) => code.indexOf(s);
    assert.ok(wo('pruefeArgumenteStrikt(process.argv') > 0);
    assert.ok(wo('pruefeKeineFreienArgumente(process.argv') >
      wo('pruefeArgumenteStrikt(process.argv'));
    // Der Flagname geht mit und ist der, den dieses Skript wirklich kennt
    // (DNa Punkt 1: ein Vorschlag mit einem fremden Flag schickt in die Irre).
    assert.ok(code.includes("'" + flag + "'"), 'Flagname ' + flag + ' fehlt');
  });

  test(`DQ1: ${rel} laesst gueltige Aufrufe unveraendert durch`, () => {
    const r = lauf(rel, ['--nur-pruefen']);
    assert.notEqual(r.status, EXIT_AUFRUF,
      'ein gueltiger Aufruf wird als Argumentfehler abgewiesen');
    assert.match(r.stdout, /TROCKENLAUF/);
  });
}

test('DQ1: die drei scripts/shorts-thumbnail-*.cjs nehmen weiter freie Argumente', () => {
  // Sie tun das ABSICHTLICH -- "short"/"normal" und ein Bildpfad sind dort
  // Positionsargumente. Dieser Test haelt fest, dass DQ sie nicht mitgezogen
  // hat; wer die Regel spaeter verallgemeinert, faellt hier auf.
  for (const rel of [
    'scripts/shorts-thumbnail-matrix.cjs',
    'scripts/shorts-thumbnail-restore.cjs',
    'scripts/shorts-thumbnail-sizelimit.cjs',
  ]) {
    const code = nurCode(rel);
    assert.ok(!/pruefeKeineFreienArgumente/.test(code),
      rel + ' hat pruefeKeineFreienArgumente bekommen -- es nimmt freie Argumente absichtlich');
  }
});

// ---------------------------------------------------------------------------
// PUNKT 2 -- decide.js --dry-run schreibt nicht mehr
// ---------------------------------------------------------------------------
//
// Gemessen in DQ: `decide.js --dry-run` schrieb data/proposals.json neu
// (sha256 8ddec42f... -> e4557d77...). Das Flag hiess "dry" und war es nicht.

const INVENTAR = path.join(WURZEL, 'fixtures', 'inventory.sample.json');

function tmpZiel() {
  return path.join(os.tmpdir(), 'dq-decide-' + crypto.randomBytes(6).toString('hex') + '.json');
}

for (const flag of ['--dry-run', '--nur-pruefen']) {
  test(`DQ2: decide.js ${flag} schreibt die Ausgabedatei NICHT`, () => {
    const ziel = tmpZiel();
    assert.ok(!fs.existsSync(ziel), 'das Testziel existierte schon');
    const r = lauf('src/decision/decide.js', [flag, '--in=' + INVENTAR, '--out=' + ziel]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(ziel),
      flag + ' hat trotzdem geschrieben: ' + ziel);
    // Und er sagt es -- ein Lauf, der schweigend nichts tut, ist von einem,
    // der schweigend etwas tut, nicht zu unterscheiden.
    assert.match(r.stdout, /TROCKENLAUF/);
    assert.match(r.stdout, /NICHTS geschrieben/);
    assert.match(r.stdout, /Geschrieben worden waere/);
    assert.ok(r.stdout.includes(ziel), 'der Pfad, der verschont blieb, wird nicht genannt');
  });
}

test('DQ2: ohne Trockenlauf-Flag schreibt decide.js weiter', () => {
  // Die Gegenrichtung. Ein Trockenlauf, der immer trocken ist, waere kein
  // Trockenlauf mehr, sondern ein kaputtes Skript.
  const ziel = tmpZiel();
  try {
    const r = lauf('src/decision/decide.js', ['--in=' + INVENTAR, '--out=' + ziel]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(ziel), 'der normale Lauf hat nichts geschrieben');
    assert.match(r.stdout, /Geschrieben: /);
    const d = JSON.parse(fs.readFileSync(ziel, 'utf8'));
    assert.ok(Array.isArray(d.items) && d.items.length > 0);
  } finally {
    fs.rmSync(ziel, { force: true });
  }
});

test('DQ2: --dry-run bleibt der Mock-Modus', () => {
  // Die Bedeutung, die das Flag im ganzen Projekt hat (client.js, rank.js,
  // backup.js), ist NICHT verschoben worden -- nur das Schreiben ist weg.
  const ziel = tmpZiel();
  const r = lauf('src/decision/decide.js', ['--dry-run', '--in=' + INVENTAR, '--out=' + ziel]);
  assert.match(r.stdout, /Modus: {3}MOCK \(kein API-Call\)/);
  assert.ok(!fs.existsSync(ziel));
});

test('DQ2: decide.js weist Tippfehler und freie Argumente ab', () => {
  // Ohne diese Pruefung waere die Zusage oben loechrig: --dryrun faellt durch
  // die if/else-Kette hindurch und haette weiter geschrieben.
  const ziel = tmpZiel();
  try {
    for (const argumente of [['--dryrun'], ['--dry_run'], ['--dry-run', 'quatsch-frei']]) {
      // --in= und --out= gehen mit, damit ein Fehlschlag dieses Tests nicht
      // data/proposals.json trifft.
      const r = lauf('src/decision/decide.js',
        [...argumente, '--in=' + INVENTAR, '--out=' + ziel]);
      assert.equal(r.status, EXIT_AUFRUF,
        JSON.stringify(argumente) + ' ergab Exit ' + r.status + ' statt 2');
      assert.match(r.stderr, /NICHTS geschrieben und kein Netzaufruf/);
      assert.ok(!fs.existsSync(ziel), 'trotz Abbruch geschrieben: ' + JSON.stringify(argumente));
    }
  } finally {
    fs.rmSync(ziel, { force: true });
  }
});

// ---------------------------------------------------------------------------
// PUNKT 3 -- backup.js bindet cli-args ein
// ---------------------------------------------------------------------------
//
// Gemessen in DQ ueber parseArgs, ohne Lauf: --dryrun ergab dryRun=false und
// damit mock = false || !youtubeAvailable(). Bei vorhandenen Credentials war
// das ein LIVE-Lauf -- der Tippfehler kehrte die Bedeutung des Flags um.
//
// KEIN Test hier fuehrt backup.js bis zu einem Netzaufruf. Geprueft wird, dass
// die Argumentpruefung VOR allem anderen abbricht.

test('DQ3: backup.js weist --dryrun mit Exit 2 ab, bevor irgendetwas laeuft', () => {
  const r = lauf('src/publish/backup.js',
    ['--dryrun', '--out=' + path.join(os.tmpdir(), 'dq-backup-ziel')], OHNE_CREDENTIALS);
  assert.equal(r.status, EXIT_AUFRUF, 'Exit 2 erwartet, bekam ' + r.status);
  assert.match(r.stderr, /unbekannte\(s\) Argument\(e\): --dryrun/);
  assert.match(r.stderr, /NICHTS geschrieben und kein Netzaufruf/);
  // Der Lauf ist nicht angelaufen: keine Modusmeldung, kein Manifest-Satz.
  assert.equal(r.stdout.trim(), '', 'backup.js ist trotz Abbruch angelaufen:\n' + r.stdout);
});

test('DQ3: backup.js weist ein freies Argument ab', () => {
  const r = lauf('src/publish/backup.js',
    ['quatsch-frei', '--out=' + path.join(os.tmpdir(), 'dq-backup-ziel')], OHNE_CREDENTIALS);
  assert.equal(r.status, EXIT_AUFRUF);
  assert.match(r.stderr, /freie Argumente gibt es hier nicht/);
  assert.equal(r.stdout.trim(), '');
});

test('DQ3: die Pruefung steht vor dotenv, fs und https', () => {
  const code = nurCode('src/publish/backup.js');
  const wo = (s) => code.indexOf(s);
  assert.ok(wo('pruefeArgumenteStrikt(process.argv') > 0, 'gar nicht eingebunden');
  assert.ok(wo('pruefeKeineFreienArgumente(process.argv') >
    wo('pruefeArgumenteStrikt(process.argv'));
  for (const m of ["require('dotenv')", "require('fs')", "require('path')", "require('https')"]) {
    assert.ok(wo(m) > wo('pruefeKeineFreienArgumente(process.argv'),
      m + ' steht VOR der Argumentpruefung');
  }
  assert.ok(!/function pruefeKeineFreienArgumente/.test(code), 'nachgebaut statt importiert');
});

test('DQ3: --dry-run selbst ist unveraendert geblieben', () => {
  // Punkt 3 hat die Argumentpruefung nachgeruestet und die Bedeutung der Flags
  // NICHT angefasst. Anders als bei decide.js schreibt der Mock-Lauf hier
  // weiter -- das simulierte Manifest ist der Zweck des Mock-Modus.
  const B = require('../src/publish/backup.js');
  assert.deepEqual(B.parseArgs(['n', 's', '--dry-run']),
    { dryRun: true, in: null, out: 'backups' });
  assert.deepEqual(B.parseArgs(['n', 's']),
    { dryRun: false, in: null, out: 'backups' });
  assert.deepEqual(B.parseArgs(['n', 's', '--in=x.json', '--out=y']),
    { dryRun: false, in: 'x.json', out: 'y' });
});

// ---------------------------------------------------------------------------
// PUNKT 4 -- die stillen Kuerzungen im Freigabe-Check
// ---------------------------------------------------------------------------
//
// Dieselbe Regel wie DFa Punkt 2: was eine Pruefung nicht ansieht, muss sie
// beim Namen nennen. Heute faellt in beiden Funktionen nichts weg -- das ist
// kein Grund, es nicht zu melden, sondern der Grund, warum es so lange
// unbemerkt blieb.

test('DQ4: porcelainDateien zaehlt und nennt zu kurze Zeilen', () => {
  const code = nurCode('scripts/freigabe-check.cjs');
  assert.ok(!/\.filter\(\(z\) => z\.length > 3\)/.test(code),
    'die stille Laengen-Kuerzung steht noch da');
  assert.match(code, /zuKurz/, 'die verworfenen Zeilen werden nicht gesammelt');
  assert.match(code, /zu kurz fuer/, 'sie werden gesammelt, aber nicht gemeldet');
});

test('DQ4: vollbaumDateien nennt, was es nicht prueft', () => {
  const code = nurCode('scripts/freigabe-check.cjs');
  assert.ok(!/return roh\.split\('\\0'\)\.filter\(Boolean\)\.filter\(/.test(code),
    'die stille Kuerzung in vollbaumDateien steht noch da');
  assert.match(code, /git ls-files werden nicht geprueft/);
  assert.match(code, /von git gefuehrt, aber nicht auf der Platte/);
});

test('DQ4: beide Laeufe des Freigabe-Checks bleiben gruen', () => {
  for (const argumente of [[], ['--vollbaum']]) {
    const r = lauf('scripts/freigabe-check.cjs', argumente);
    assert.equal(r.status, 0,
      'freigabe-check ' + JSON.stringify(argumente) + ':\n' + r.stdout + r.stderr);
    assert.match(r.stdout, /FREIGABE: sauber/);
  }
});

// ---------------------------------------------------------------------------
// PUNKT 0 -- das Gedaechtnis ist UTF-8, ohne BOM
// ---------------------------------------------------------------------------
//
// Der Anlass war eine Anzeige, kein Inhalt: PowerShell liest UTF-8 ohne
// -Encoding als Windows-1252, und "laege" sieht dann aus wie "lAge" mit Muell.
// Der Inhalt war in Ordnung. Dieser Test haelt fest, dass er es bleibt --
// eine Datei, die als CP1252 oder mit BOM geschrieben wird, faellt hier auf,
// und nicht erst dort, wo ein Titel mit falschen Zeichen hochgeht.

for (const rel of [
  'data/uploads/2026-08-31 17-36-21.json',
  'data/freigaben/2026-08-31 17-36-21.json',
  'data/plaene/2026-08-31 17-36-21.json',
]) {
  test(`DQ0: ${rel} ist UTF-8 ohne BOM`, (t) => {
    const p = path.join(WURZEL, rel);
    if (!fs.existsSync(p)) {
      t.skip('gibt es auf dieser Platte nicht: ' + rel);
      return;
    }
    const buf = fs.readFileSync(p);
    assert.ok(!(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF), 'UTF-8-BOM davor');
    assert.ok(!(buf[0] === 0xFF && buf[1] === 0xFE), 'UTF-16-LE-BOM davor');
    assert.ok(!(buf[0] === 0xFE && buf[1] === 0xFF), 'UTF-16-BE-BOM davor');
    // Strikt: eine als CP1252 geschriebene Datei mit Umlauten faellt hier durch.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    // Und die Bytes ueberstehen den Weg zurueck unveraendert.
    assert.ok(Buffer.from(text, 'utf8').equals(buf), 'kein sauberer UTF-8-Roundtrip');
    JSON.parse(text);
    // Die Mojibake-Signatur selbst: "Ã" gefolgt von einem Steuerzeichenbereich
    // ist das, was entsteht, wenn UTF-8 einmal zu viel durch CP1252 lief.
    assert.ok(!/Ã[\u0080-\u009F\u00A0-\u00BF]/.test(text),
      'der Inhalt traegt Mojibake -- er wurde einmal falsch dekodiert geschrieben');
  });
}
