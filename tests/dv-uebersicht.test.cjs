'use strict';

// DV: Tests fuer die Uebersicht (src/upload/uebersicht.js).
//
// WARUM ES DIESE DATEI GIBT: Die drei Fehler, gegen die die Uebersicht gebaut
// ist, sieht man ihr nicht an. Ein Vorrat aus einer gesperrten Aufnahme sieht
// aus wie Vorrat; ein Anschluss-Schnappschuss von 17:25 sieht um 19:08 aus wie
// eine Terminliste; eine Uebersicht, die eine unlesbare Datei uebergeht, sieht
// aus wie eine vollstaendige. Jeder dieser Zustaende ist im Betrieb unauffaellig.
// Ein Test, der ihn festhaelt, ist der einzige Grund, warum er beim naechsten
// Umbau nicht zurueckkommt.
//
// KEIN Test hier liest oder schreibt data/ des Repos. Jede Lage wird in einer
// Wegwerf-Wurzel unter os.tmpdir() nachgebaut und fuehreAus() im Prozess
// aufgerufen. Die Kindprozess-Tests (Aufruf) brechen ab, bevor das Skript
// irgendetwas liest. Die Nachweise gegen die echte Datenlage stehen im Bericht
// DV, nicht hier -- data/ ist gitignored und in einem frischen Klon leer.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const U = require('../src/upload/uebersicht.js');
const P = require('../src/upload/planer.js');

const WURZEL = path.join(__dirname, '..');
const SKRIPT = path.join(WURZEL, 'src', 'upload', 'uebersicht.js');
const QUELLTEXT = fs.readFileSync(SKRIPT, 'utf8');
const PLANER_QUELLTEXT = fs.readFileSync(path.join(WURZEL, 'src', 'upload', 'planer.js'), 'utf8');

// Der Quelltext ohne Kommentare -- ein require in einem Kommentar ist kein
// require, und ein Aufruf in einem Kommentar ist kein Aufruf.
function nurCode(text) {
  return text.split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n');
}
const NURCODE = nurCode(QUELLTEXT);

// ---------------------------------------------------------------------------
// BAUSTEINE FUER EINE LAGE
// ---------------------------------------------------------------------------

const GESPERRT = P.GESPERRTE_AUFNAHMEN[0].aufnahme;
const A = '2026-08-31 17-36-21';
const B = '2026-09-02 12-10-37';
const C = '2026-09-05 10-00-00';
const JETZT = Date.parse('2026-09-02T19:00:00+02:00');

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function shortSha(aufnahme, n) {
  return sha('probe-' + aufnahme + '-' + n);
}

// Elf Zeichen aus [A-Za-z0-9_-], erfunden und ohne Bezug zu irgendeinem Kanal.
function vid(aufnahme, n) {
  return ('P_' + aufnahme.slice(8, 10) + aufnahme.slice(11, 13) + '_' + String(n).padStart(4, '0'))
    .slice(0, 11);
}

// eintraege: [{ n, frei, titel }]
function freigabeText(aufnahme, eintraege) {
  return JSON.stringify({
    artifact_type: 'adw_shorts_freigaben',
    schema_version: '1.0',
    aufnahme,
    erzeugt_am: '2026-09-01T14:00:00.000Z',
    geschrieben_am: '2026-09-01T14:30:00.000Z',
    lesereingabe_sha256: sha('leser-' + aufnahme),
    freigaben: eintraege.map((e) => ({
      sha256: shortSha(aufnahme, e.n),
      kennung: aufnahme + '/' + e.n,
      freigegeben: e.frei,
      titel: e.titel === undefined ? 'Probe ' + e.n : e.titel,
      notiz: '',
      entschieden_am: '2026-09-01T14:10:00.000Z',
      lesereingabe_sha256: sha('leser-' + aufnahme),
    })),
  }, null, 2) + '\n';
}

// termine: [{ n, titel, publish_at }]; anschluss: beliebiges Objekt oder null.
function planText(aufnahme, freigabe, termine, { anschluss = null } = {}) {
  const plan = {
    artifact_type: 'adw_shorts_plan',
    schema_version: '1.0',
    aufnahme,
    erzeugt_am: '2026-09-02T09:53:13.392Z',
    planungszeitpunkt: '2026-09-02T09:53:13.392Z',
    zeitzone: 'Europe/Berlin',
    verbindlich: 'publish_at',
    freigabedatei: 'data/freigaben/' + aufnahme + '.json',
    freigabe_sha256: sha(freigabe),
    gedaechtnis_datei: 'data/uploads/' + aufnahme + '.json',
    termine: termine.map((t) => ({
      sha256: shortSha(aufnahme, t.n),
      kennung: aufnahme + '/' + t.n,
      titel: t.titel === undefined ? 'Probe ' + t.n : t.titel,
      publish_at: t.publish_at,
      publish_at_ortszeit: P.ortszeitText(Date.parse(t.publish_at)),
    })),
  };
  if (anschluss) plan.anschluss = anschluss;
  return JSON.stringify(plan, null, 2) + '\n';
}

// uploads: [{ n, titel, publish_at, videoId }]
function gedaechtnisText(aufnahme, plan, uploads) {
  return JSON.stringify({
    artifact_type: 'adw_shorts_uploads',
    schema_version: '1.0',
    aufnahme,
    plan_datei: 'data/plaene/' + aufnahme + '.json',
    plan_sha256: sha(plan),
    angelegt_am: '2026-09-02T09:56:16.770Z',
    zuletzt_geschrieben_am: '2026-09-02T10:53:04.237Z',
    uploads: uploads.map((u) => ({
      sha256: shortSha(aufnahme, u.n),
      kennung: aufnahme + '/' + u.n,
      videoId: u.videoId === undefined ? vid(aufnahme, u.n) : u.videoId,
      hochgeladen_am: '2026-09-02T10:00:00.000Z',
      publish_at: u.publish_at,
      titel: u.titel === undefined ? 'Probe ' + u.n : u.titel,
    })),
  }, null, 2) + '\n';
}

function wegwerfWurzel() {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-uebersicht-'));
  for (const s of ['freigaben', 'plaene', 'uploads']) {
    fs.mkdirSync(path.join(w, 'data', s), { recursive: true });
  }
  return w;
}

function lege(w, sorte, name, text) {
  fs.writeFileSync(path.join(w, 'data', sorte, name), text, 'utf8');
}

function weg(w) {
  fs.rmSync(w, { recursive: true, force: true });
}

// Die echte Lage vom 02.09.2026 in klein: eine gesperrte Aufnahme mit acht
// Freigaben, zwei geplante und vollstaendig hochgeladene Aufnahmen, und im
// zweiten Plan ein Anschluss-Schnappschuss, der ABSICHTLICH veraltet ist.
function echteLageInKlein(w) {
  lege(w, 'freigaben', GESPERRT + '.json', freigabeText(GESPERRT, [
    { n: 10, frei: true }, { n: 12, frei: true }, { n: 29, frei: true }, { n: 30, frei: true },
    { n: 32, frei: false }, { n: 40, frei: true }, { n: 47, frei: true }, { n: 50, frei: false },
    { n: 56, frei: true }, { n: 57, frei: true },
  ]));

  const fA = freigabeText(A, [
    { n: 4, frei: true }, { n: 9, frei: true }, { n: 18, frei: false }, { n: 33, frei: true },
  ]);
  const tA = [
    { n: 4, publish_at: '2026-09-02T10:48:00.000Z' },
    { n: 9, publish_at: '2026-09-03T06:11:00.000Z' },
    { n: 33, publish_at: '2026-09-03T08:57:00.000Z' },
  ];
  const pA = planText(A, fA, tA);
  const gA = gedaechtnisText(A, pA, tA);

  const fB = freigabeText(B, [{ n: 4, frei: true }, { n: 26, frei: true }, { n: 28, frei: false }]);
  const tB = [
    { n: 4, publish_at: '2026-09-03T10:09:00.000Z' },
    { n: 26, publish_at: '2026-09-04T07:45:00.000Z' },
  ];
  const pB = planText(B, fB, tB, {
    anschluss: {
      startpunkt: '2026-09-03T08:57:00.000Z',
      grund: 'ausstehender_termin',
      // VERALTET: zum Planungszeitpunkt standen aus A noch drei Termine aus
      // (der Schnappschuss zaehlt sogar sechs); zur Bezugszeit sind es zwei.
      ausstehende_termine_gesamt: 6,
      ausstehende_termine: [
        { aufnahme: A, kennung: A + '/4', publish_at: '2026-09-02T10:48:00.000Z' },
        { aufnahme: A, kennung: A + '/9', publish_at: '2026-09-03T06:11:00.000Z' },
        { aufnahme: A, kennung: A + '/33', publish_at: '2026-09-03T08:57:00.000Z' },
        { aufnahme: A, kennung: A + '/99', publish_at: '2026-09-09T08:00:00.000Z' },
        { aufnahme: A, kennung: A + '/98', publish_at: '2026-09-09T09:00:00.000Z' },
        { aufnahme: A, kennung: A + '/97', publish_at: '2026-09-09T10:00:00.000Z' },
      ],
    },
  });
  const gB = gedaechtnisText(B, pB, tB);

  lege(w, 'freigaben', A + '.json', fA);
  lege(w, 'plaene', A + '.json', pA);
  lege(w, 'uploads', A + '.json', gA);
  lege(w, 'freigaben', B + '.json', fB);
  lege(w, 'plaene', B + '.json', pB);
  lege(w, 'uploads', B + '.json', gB);
  return { fA, pA, gA, fB, pB, gB, tA, tB };
}

function lauf(w, argumente = [], uhr = JETZT) {
  return U.fuehreAus({ argv: [process.execPath, SKRIPT, ...argumente], projektwurzel: w, uhr });
}

function baue(w, jetzt = JETZT) {
  return U.erstelleUebersicht({ projektwurzel: w, jetzt, vorgegeben: true, uhr: jetzt });
}

function pruefsummenDerDaten(w) {
  const aus = {};
  for (const s of ['freigaben', 'plaene', 'uploads']) {
    const v = path.join(w, 'data', s);
    if (!fs.existsSync(v)) continue;
    for (const n of fs.readdirSync(v).sort()) {
      aus[s + '/' + n] = crypto.createHash('sha256').update(fs.readFileSync(path.join(v, n))).digest('hex');
    }
  }
  return aus;
}

function alleVideoIds(w) {
  const ids = [];
  const v = path.join(w, 'data', 'uploads');
  for (const n of fs.readdirSync(v)) {
    if (!n.endsWith('.json')) continue;
    for (const u of JSON.parse(fs.readFileSync(path.join(v, n), 'utf8')).uploads) ids.push(u.videoId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// BAUART
// ---------------------------------------------------------------------------

test('pruefeArgumenteStrikt und die Pruefung freier Argumente stehen vor allem anderen', () => {
  const wo = (s) => NURCODE.indexOf(s);
  assert.ok(wo('pruefeArgumenteStrikt(process.argv') > 0);
  assert.ok(wo('pruefeKeineFreienArgumenteOhneAufnahme(process.argv') > wo('pruefeArgumenteStrikt(process.argv'));
  assert.ok(wo("require('fs')") > wo('pruefeKeineFreienArgumenteOhneAufnahme(process.argv'),
    'require(fs) steht vor der Argumentpruefung');
  assert.ok(wo("require('./planer')") > wo('pruefeKeineFreienArgumenteOhneAufnahme(process.argv'));
  assert.ok(wo("require('./uploader')") > wo('pruefeKeineFreienArgumenteOhneAufnahme(process.argv'));
});

test('die Bausteine werden importiert und nicht nachgebaut', () => {
  assert.match(NURCODE, /const P = require\('\.\/planer'\)/);
  assert.match(NURCODE, /const \{ lesePlan \} = require\('\.\/uploader'\)/);
  assert.match(NURCODE, /const \{ AUFNAHME_FORM, EXIT \} = require\('\.\/uebergabe-leser'\)/);
  for (const verboten of [
    /GESPERRTE_AUFNAHMEN\s*=/, /function sperreFuer/, /function pruefeSperrliste/,
    /function sammleAusstehende/, /function leseGedaechtnisverzeichnis/,
    /function leseGedaechtnis\b/, /function leseFreigabe/, /function lesePlan/,
    /function ortszeitText/, /function zonenTeile/, /function versatzText/,
    /GRENZE_HANDPLANUNG\s*=/, /function umbrich/, /function schreibe\w*Atomar/,
    /const AUFNAHME_FORM\s*=/, /const ZONE\s*=/,
  ]) {
    assert.ok(!verboten.test(NURCODE), 'nachgebaut statt importiert: ' + verboten);
  }
  // Die Sperre und der Anschluss kommen ueber P.* -- und nur so.
  assert.match(NURCODE, /P\.sperreFuer\(/);
  assert.match(NURCODE, /P\.pruefeSperrliste\(/);
  assert.match(NURCODE, /P\.sammleAusstehende\(/);
  assert.match(NURCODE, /P\.leseGedaechtnisverzeichnis\(/);
  assert.match(NURCODE, /P\.GRENZE_HANDPLANUNG/);
});

test('die Uebersicht ruft nichts auf, geht nicht ins Netz und schreibt genau eine Datei', () => {
  for (const verboten of [
    /require\('https?'\)/, /googleapis/, /child_process/, /spawnSync|execSync|execFileSync/,
    /require\('net'\)/, /fetch\(/,
  ]) {
    assert.ok(!verboten.test(NURCODE), 'gefunden: ' + verboten);
  }
  // Der einzige Schreibzugriff: schreibePlanAtomar aus dem Planer, genau einmal,
  // auf den Pfad der Linkdatei.
  assert.equal((NURCODE.match(/schreibePlanAtomar\(/g) || []).length, 1);
  assert.match(NURCODE, /P\.schreibePlanAtomar\(ziel, links\)/);
  assert.match(NURCODE, /const ziel = linkdateiPfad\(projektwurzel\)/);
  assert.ok(!/fs\.(writeFileSync|writeSync|renameSync|unlinkSync|rmSync|rmdirSync|mkdirSync|appendFileSync|copyFileSync|openSync)/.test(NURCODE),
    'ein zweiter Schreibweg');
});

test('ausstehende Termine kommen nie aus dem Feld anschluss eines Plans', () => {
  // Das Feld wird im ganzen Quelltext nicht angefasst -- nicht gelesen, nicht
  // abgeschrieben. Die Wahrheit ueber "ausstehend" ist data/uploads.
  assert.ok(!/\.anschluss\b/.test(NURCODE), 'der Quelltext liest plan.anschluss');
  assert.ok(!/\banschluss\b\s*[:\]]/.test(NURCODE.replace(/'[^']*'/g, "''")),
    'der Quelltext greift auf anschluss zu');
});

test('ISO_MIT_VERSATZ ist wortgleich mit dem Planer', () => {
  const literal = (text) => {
    const m = text.match(/const ISO_MIT_VERSATZ = (\/.*\/);/);
    assert.ok(m, 'ISO_MIT_VERSATZ nicht gefunden');
    return m[1];
  };
  assert.equal(literal(QUELLTEXT), literal(PLANER_QUELLTEXT));
});

test('die Linkform ist festgelegt, nicht hergeleitet', () => {
  assert.equal(U.LINKFORM_SHORT, 'https://www.youtube.com/shorts/<videoId>');
  assert.equal(U.LINKFORM_ALLGEMEIN, 'https://youtu.be/<videoId>');
  assert.equal(U.shortsLink('abcDEF123_-'), 'https://www.youtube.com/shorts/abcDEF123_-');
  assert.equal(U.allgemeinerLink('abcDEF123_-'), 'https://youtu.be/abcDEF123_-');
  assert.equal(U.VIDEO_ART_SHORT, 'short');
});

// ---------------------------------------------------------------------------
// DER AUFRUF
// ---------------------------------------------------------------------------

test('unbekannte und freie Argumente brechen ab, bevor irgendetwas geschieht', () => {
  const faelle = [
    { args: ['--nur-pruefen'], muster: /unbekannte\(s\) Argument/ },
    { args: ['--execute'], muster: /unbekannte\(s\) Argument/ },
    { args: ['2026-08-31', '17-36-21'], muster: /freie Argumente gibt es hier nicht/ },
    { args: ['--json', 'irgendwas'], muster: /nimmt keine Aufnahme entgegen/ },
  ];
  for (const f of faelle) {
    const r = spawnSync(process.execPath, [SKRIPT, ...f.args], { encoding: 'utf8' });
    assert.equal(r.status, U.EXIT_AUFRUFFEHLER, JSON.stringify(f.args) + ': ' + r.stderr);
    assert.match(r.stderr, f.muster);
    assert.equal(r.stdout, '');
  }
});

test('--jetzt= verlangt einen Zonenversatz; mit ihm ist es die Bezugszeit', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const ohne = lauf(w, ['--jetzt=2026-09-02T19:00:00']);
    assert.equal(ohne.code, U.EXIT_AUFRUFFEHLER);
    assert.match(ohne.stderr, /MIT Zonenversatz/);
    assert.equal(ohne.stdout, '');
    assert.ok(!fs.existsSync(U.linkdateiPfad(w)), 'ein falscher Aufruf hat geschrieben');

    const mit = lauf(w, ['--jetzt=2026-09-02T19:00:00+02:00', '--json'], Date.parse('2030-01-01T00:00:00Z'));
    assert.equal(mit.code, U.EXIT_OK, mit.stderr);
    const u = JSON.parse(mit.stdout);
    assert.equal(u.bezugszeit, '2026-09-02T17:00:00.000Z');
    assert.equal(u.bezugszeit_ortszeit, '2026-09-02 19:00 (UTC+02:00)');
    assert.equal(u.bezugszeit_vorgegeben, true);
    assert.equal(u.erzeugt_am, '2030-01-01T00:00:00.000Z', 'erzeugt_am ist die Uhr, nicht die Bezugszeit');
  } finally { weg(w); }
});

// ---------------------------------------------------------------------------
// DIE ECHTE LAGE IN KLEIN
// ---------------------------------------------------------------------------

test('ausstehend kommt aus data/uploads: der veraltete Anschluss des Plans zaehlt nicht', () => {
  const w = wegwerfWurzel();
  try {
    const { pB } = echteLageInKlein(w);
    assert.equal(JSON.parse(pB).anschluss.ausstehende_termine_gesamt, 6, 'die Vorlage ist nicht veraltet');
    const r = baue(w);
    assert.deepEqual(r.fehler, []);
    const u = r.uebersicht;
    // Aus A stehen um 19:00 Ortszeit noch zwei aus (/9 und /33), nicht sechs.
    const ausA = u.ausstehend.termine.filter((t) => t.aufnahme === A);
    assert.deepEqual(ausA.map((t) => t.kennung), [A + '/9', A + '/33']);
    assert.equal(u.ausstehend.anzahl, 4);
    assert.deepEqual(u.ausstehend.termine.map((t) => t.kennung),
      [A + '/9', A + '/33', B + '/4', B + '/26']);
    assert.match(u.ausstehend.quelle, /NICHT das Feld anschluss/);
    // Und das ist genau, was sammleAusstehende dem naechsten Plan sagen wuerde.
    const roh = P.leseGedaechtnisverzeichnis(path.join(w, 'data', 'uploads'));
    const probe = P.sammleAusstehende(roh.dateien, JETZT);
    assert.deepEqual(probe.ausstehend.map((t) => t.kennung), u.ausstehend.termine.map((t) => t.kennung));
  } finally { weg(w); }
});

test('der letzte ausstehende Termin und die Aussage nennen die Quelle, nicht den Kanal', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const u = baue(w).uebersicht;
    const l = u.ausstehend.letzter;
    assert.equal(l.kennung, B + '/26');
    assert.equal(l.publish_at, '2026-09-04T07:45:00.000Z');
    assert.equal(l.publish_at_ortszeit, '2026-09-04 09:45 (UTC+02:00)');
    assert.equal(l.abstand_minuten, 38 * 60 + 45);
    assert.equal(l.abstand_text, '38 h 45 min');
    assert.equal(u.ausstehend.aussage,
      'Aus data/uploads steht nach 2026-09-04 09:45 (UTC+02:00) nichts mehr an.');
    assert.ok(!/Kanal ist/.test(u.ausstehend.aussage));
    assert.equal(u.grenze, P.GRENZE_HANDPLANUNG);
    const text = U.formatiere(Object.assign({}, u, { linkdatei: Object.assign({}, u.linkdatei, { geschrieben: true }) }));
    assert.match(text, /AUS DATA\/UPLOADS STEHT NACH 2026-09-04 09:45 \(UTC\+02:00\) NICHTS MEHR AN\./);
    assert.match(text, /Grenze dieses Werkzeugs, nicht die des Kanals/);
    assert.ok(text.includes(P.GRENZE_HANDPLANUNG.slice(0, 40)));
  } finally { weg(w); }
});

test('die gesperrte Aufnahme wird gelesen, gezeigt und zaehlt nicht als Vorrat', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const u = baue(w).uebersicht;
    const g = u.aufnahmen.find((a) => a.aufnahme === GESPERRT);
    assert.equal(g.zustand, 'gesperrt');
    assert.equal(g.beurteilt, 10);
    assert.equal(g.freigegeben, 8);
    assert.equal(g.abgelehnt, 2);
    assert.equal(g.geplant, null);
    assert.equal(g.hochgeladen, null);
    assert.equal(g.sperre.grund, P.sperreFuer(GESPERRT).grund);
    assert.equal(u.vorrat.planbar.shorts_gesamt, 0);
    assert.deepEqual(u.vorrat.planbar.aufnahmen, []);
    assert.equal(u.vorrat.gesperrt.shorts_gesamt, 8);
    assert.equal(u.vorrat.gesperrt.aufnahmen[0].aufnahme, GESPERRT);
    assert.equal(u.vorrat.gesperrt.aufnahmen[0].shorts.length, 8);
    assert.deepEqual(u.widersprueche, []);
    const text = U.formatiere(u);
    assert.match(text, /VORRAT \(freigegeben, planbar, ohne Plan\): 0 Shorts in 0 Aufnahme\(n\)/);
    assert.match(text, /Nicht als Vorrat gezaehlt: 8 freigegebene Shorts in 1 GESPERRTEN Aufnahme/);
    assert.match(text, /GESPERRT 2026-08-29 18-18-19 \(GESPERRTE_AUFNAHMEN, src\/upload\/planer\.js\)/);
  } finally { weg(w); }
});

test('eine freigegebene, planbare Aufnahme ohne Plan ist Vorrat', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    lege(w, 'freigaben', C + '.json', freigabeText(C, [
      { n: 1, frei: true, titel: 'Eins' }, { n: 2, frei: false }, { n: 3, frei: true, titel: 'Drei' },
    ]));
    const u = baue(w).uebersicht;
    const c = u.aufnahmen.find((a) => a.aufnahme === C);
    assert.equal(c.zustand, 'freigegeben_ohne_plan');
    assert.equal(u.vorrat.planbar.shorts_gesamt, 2);
    assert.deepEqual(u.vorrat.planbar.aufnahmen[0].shorts.map((s) => s.titel), ['Eins', 'Drei']);
    assert.equal(u.vorrat.gesperrt.shorts_gesamt, 8);
    assert.deepEqual(u.widersprueche, []);
    // Und der letzte ausstehende Termin bleibt derselbe: Vorrat ist kein Termin.
    assert.equal(u.ausstehend.letzter.kennung, B + '/26');
  } finally { weg(w); }
});

test('Zaehlung je Aufnahme und Summen stammen aus den Dateien, nichts wird geschaetzt', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const u = baue(w).uebersicht;
    const a = u.aufnahmen.find((x) => x.aufnahme === A);
    assert.deepEqual(
      [a.beurteilt, a.freigegeben, a.abgelehnt, a.geplant, a.hochgeladen, a.termin_vorbei, a.ausstehend, a.zustand],
      [4, 3, 1, 3, 3, 1, 2, 'hochgeladen_wartet']);
    const b = u.aufnahmen.find((x) => x.aufnahme === B);
    assert.deepEqual(
      [b.beurteilt, b.freigegeben, b.abgelehnt, b.geplant, b.hochgeladen, b.termin_vorbei, b.ausstehend, b.zustand],
      [3, 2, 1, 2, 2, 0, 2, 'hochgeladen_wartet']);
    assert.deepEqual(u.summen, {
      aufnahmen: 3, beurteilt: 17, freigegeben: 13, abgelehnt: 4, geplant: 5, hochgeladen: 5,
      termin_vorbei: 1, ausstehend: 4,
    });
    assert.equal(u.termin_vorbei.anzahl, 1);
    assert.equal(u.termin_vorbei.termine[0].kennung, A + '/4');
    // Keine Stueckzahl aus der hoechsten Kennung, kein Schnitt, keine Quote:
    // es gibt kein Feld, das so etwas traegt. Jede Zahl oben ist die Laenge
    // einer Liste aus einer Datei.
    const felder = new Set();
    JSON.stringify(u, (k, v) => { felder.add(k); return v; });
    for (const f of felder) {
      assert.ok(!/geliefert|hoechst|schnitt|quote|durchschnitt|schaetz|reichweite/i.test(f),
        'ein Feld, das schaetzt: ' + f);
    }
    assert.match(u.vorrat.erklaerung, /steht in keiner Datei und wird nicht geschaetzt/);
  } finally { weg(w); }
});

test('die Bezugszeit entscheidet, was vorbei ist -- vor allen Terminen und nach allen', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const frueh = baue(w, Date.parse('2026-09-02T08:00:00+02:00')).uebersicht;
    assert.equal(frueh.ausstehend.anzahl, 5);
    assert.equal(frueh.termin_vorbei.anzahl, 0);
    // Genau auf dem Termin: nicht mehr ausstehend (dieselbe Regel wie sammleAusstehende).
    const genau = baue(w, Date.parse('2026-09-02T10:48:00.000Z')).uebersicht;
    assert.equal(genau.ausstehend.anzahl, 4);
    const spaet = baue(w, Date.parse('2026-09-05T08:00:00+02:00')).uebersicht;
    assert.equal(spaet.ausstehend.anzahl, 0);
    assert.equal(spaet.ausstehend.letzter, null);
    assert.equal(spaet.ausstehend.aussage,
      'Aus data/uploads steht nichts mehr an: kein Termin liegt nach 2026-09-05 08:00 (UTC+02:00).');
    assert.equal(spaet.aufnahmen.find((a) => a.aufnahme === A).zustand, 'hochgeladen_abgelaufen');
  } finally { weg(w); }
});

// ---------------------------------------------------------------------------
// DIE LINKDATEI
// ---------------------------------------------------------------------------

test('die Linkdatei wird atomar geschrieben, bei jedem Lauf neu, und traegt jedes Video', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const r1 = lauf(w, [], JETZT);
    assert.equal(r1.code, U.EXIT_OK, r1.stderr);
    const pfad = U.linkdateiPfad(w);
    assert.ok(fs.existsSync(pfad));
    assert.deepEqual(fs.readdirSync(path.join(w, 'data')).sort(), ['freigaben', 'links.json', 'plaene', 'uploads'],
      'es liegt eine Temporaerdatei herum');
    const l = JSON.parse(fs.readFileSync(pfad, 'utf8'));
    assert.equal(l.artifact_type, U.LINKS_ARTIFACT_TYPE);
    assert.equal(l.schema_version, '1.0');
    assert.equal(l.erzeugt_am, new Date(JETZT).toISOString());
    assert.equal(l.anzahl, 5);
    assert.equal(l.anzahl_termin_vorbei, 1);
    assert.equal(l.anzahl_ausstehend, 4);
    assert.equal(l.videos.length, 5);
    assert.deepEqual(l.linkform, { short: U.LINKFORM_SHORT, allgemein: U.LINKFORM_ALLGEMEIN });
    assert.match(l.hinweis, /beweist nicht, dass das Video oeffentlich ist/);
    assert.deepEqual(l.gelesene_gedaechtnisdateien, ['data/uploads/' + A + '.json', 'data/uploads/' + B + '.json']);
    // Sortiert nach Termin.
    assert.deepEqual(l.videos.map((v) => v.kennung), [A + '/4', A + '/9', A + '/33', B + '/4', B + '/26']);
    for (const v of l.videos) {
      assert.equal(v.art, 'short');
      assert.match(v.videoId, U.VIDEOID_FORM);
      assert.equal(v.link, 'https://www.youtube.com/shorts/' + v.videoId);
      assert.equal(v.link_allgemein, 'https://youtu.be/' + v.videoId);
      assert.equal(v.publish_at_ortszeit, P.ortszeitText(Date.parse(v.publish_at)));
      assert.equal(typeof v.termin_vorbei, 'boolean');
      assert.match(v.sha256, /^[0-9a-f]{64}$/);
      assert.equal(typeof v.titel, 'string');
      assert.equal(v.aufnahme, v.kennung.split('/')[0]);
    }
    assert.deepEqual(l.videos.map((v) => v.termin_vorbei), [true, false, false, false, false]);
    assert.equal(l.videos[0].videoId, vid(A, 4));

    // Zweiter Lauf mit anderer Uhr: die Datei wird ersetzt, nichts bleibt liegen.
    const r2 = lauf(w, [], JETZT + 60 * 60 * 1000);
    assert.equal(r2.code, U.EXIT_OK);
    const l2 = JSON.parse(fs.readFileSync(pfad, 'utf8'));
    assert.equal(l2.erzeugt_am, new Date(JETZT + 60 * 60 * 1000).toISOString());
    assert.deepEqual(fs.readdirSync(path.join(w, 'data')).sort(), ['freigaben', 'links.json', 'plaene', 'uploads']);
  } finally { weg(w); }
});

test('videoIds stehen in der Linkdatei und in keiner Ausgabe', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const ids = alleVideoIds(w);
    assert.equal(ids.length, 5);
    const text = lauf(w, []);
    const json = lauf(w, ['--json']);
    assert.equal(text.code, U.EXIT_OK);
    assert.equal(json.code, U.EXIT_OK);
    for (const id of ids) {
      assert.ok(!text.stdout.includes(id), 'videoId in der Textausgabe');
      assert.ok(!json.stdout.includes(id), 'videoId in der JSON-Ausgabe');
    }
    assert.ok(!/videoId/.test(json.stdout), 'ein Feld videoId in der JSON-Ausgabe');
    const l = fs.readFileSync(U.linkdateiPfad(w), 'utf8');
    for (const id of ids) assert.ok(l.includes(id), 'videoId fehlt in der Linkdatei');
    // Die Ausgabe sagt, dass die Datei geschrieben wurde und was ein Link beweist.
    assert.match(text.stdout, /LINKDATEI: data\/links\.json geschrieben, 5 Video\(s\) -- 4 ausstehend, 1 Termin vorbei\./);
    assert.match(text.stdout, /Ein Link beweist nicht, dass das Video oeffentlich ist/);
    const u = JSON.parse(json.stdout);
    assert.equal(u.linkdatei.geschrieben, true);
    assert.equal(u.linkdatei.anzahl, 5);
    assert.equal(u.artifact_type, U.UEBERSICHT_ARTIFACT_TYPE);
  } finally { weg(w); }
});

test('data/freigaben, data/plaene und data/uploads sind nach allen Laeufen byte-gleich', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    lege(w, 'freigaben', C + '.json', freigabeText(C, [{ n: 1, frei: true }]));
    const vorher = pruefsummenDerDaten(w);
    lauf(w, []);
    lauf(w, ['--json']);
    lauf(w, ['--jetzt=2026-09-05T08:00:00+02:00']);
    lauf(w, ['--jetzt=2026-09-05T08:00:00']);
    lege(w, 'uploads', 'kaputt.json', '{');
    lauf(w, []);
    fs.unlinkSync(path.join(w, 'data', 'uploads', 'kaputt.json'));
    const nachher = pruefsummenDerDaten(w);
    assert.deepEqual(nachher, vorher);
    assert.equal(Object.keys(vorher).length, 8);
  } finally { weg(w); }
});

// ---------------------------------------------------------------------------
// WENN ETWAS NICHT LESBAR IST
// ---------------------------------------------------------------------------

test('eine unlesbare Datei bricht ab, wird genannt, und die Linkdatei bleibt unangetastet', () => {
  const faelle = [
    { sorte: 'uploads', name: 'kaputt.json', text: '{}', muster: /In data\/uploads\/ liegt die Datei "kaputt\.json"\. Ihr Name hat nicht die Form/ },
    { sorte: 'uploads', name: A + '.json', text: '{ kein json', muster: /data\/uploads\/2026-08-31 17-36-21\.json.*kein JSON/s },
    { sorte: 'freigaben', name: A + '.json', text: '{ kein json', muster: /data\/freigaben\/2026-08-31 17-36-21\.json -- Die Freigabedatei ist kein JSON/ },
    { sorte: 'plaene', name: B + '.json', text: '[]', muster: /data\/plaene\/2026-09-02 12-10-37\.json -- Die Planungsdatei enthaelt kein Objekt/ },
    { sorte: 'plaene', name: 'notiz.json', text: '{}', muster: /data\/plaene\/ liegt die Datei "notiz\.json"/ },
    { sorte: 'freigaben', name: A + '.json', text: freigabeText(B, [{ n: 1, frei: true }]), muster: /nennt die Aufnahme "2026-09-02 12-10-37", angefragt war "2026-08-31 17-36-21"/ },
  ];
  for (const f of faelle) {
    const w = wegwerfWurzel();
    try {
      echteLageInKlein(w);
      // Ein Marker von einem "frueheren Lauf": er muss danach unveraendert sein.
      const marker = '{"vom":"frueheren Lauf"}\n';
      fs.writeFileSync(U.linkdateiPfad(w), marker, 'utf8');
      lege(w, f.sorte, f.name, f.text);
      const r = lauf(w, []);
      assert.equal(r.code, U.EXIT_BEFUND, f.name + ': ' + r.stderr);
      assert.equal(r.stdout, '', f.name + ': es wurde eine Uebersicht ausgegeben');
      assert.match(r.stderr, /ABBRUCH: es entsteht keine Uebersicht/);
      // Die Meldungen sind umgebrochen (umbrich); gematcht wird die eine Zeile.
      assert.match(r.stderr.replace(/\s+/g, ' '), f.muster);
      assert.match(r.stderr, /keine Zahl ausgegeben, die vollstaendig aussieht/);
      assert.match(r.stderr, /links\.json wurde NICHT neu/);
      assert.equal(fs.readFileSync(U.linkdateiPfad(w), 'utf8'), marker, f.name + ': die Linkdatei wurde angefasst');
      // Auch --json liefert dann kein JSON, das vollstaendig aussieht.
      const j = lauf(w, ['--json']);
      assert.equal(j.code, U.EXIT_BEFUND);
      assert.equal(j.stdout, '');
    } finally { weg(w); }
  }
});

test('ein Verzeichnis mit dem Namen einer Datei bricht ab und wird genannt', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    fs.mkdirSync(path.join(w, 'data', 'plaene', C + '.json'));
    const r = lauf(w, []);
    assert.equal(r.code, U.EXIT_BEFUND);
    assert.match(r.stderr.replace(/\s+/g, ' '),
      /data\/plaene\/2026-09-05 10-00-00\.json liegt da, ist aber nicht lesbar \(EISDIR\)/);
  } finally { weg(w); }
});

test('ein fehlendes Verzeichnis ist kein Fehler, sondern "nichts" -- mit dem Pfad', () => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-leer-'));
  try {
    const r = lauf(w, []);
    assert.equal(r.code, U.EXIT_OK, r.stderr);
    assert.match(r.stdout, /data\/freigaben\/ {3}gibt es nicht -- nichts beurteilt/);
    assert.match(r.stdout, /data\/plaene\/ {3}gibt es nicht -- nichts geplant/);
    assert.match(r.stdout, /data\/uploads\/ {3}gibt es nicht -- nichts hochgeladen/);
    assert.match(r.stdout, /AUSSTEHENDE TERMINE: 0/);
    assert.match(r.stdout, /AUS DATA\/UPLOADS STEHT NICHTS MEHR AN: KEIN TERMIN LIEGT NACH/);
    const j = JSON.parse(lauf(w, ['--json']).stdout);
    assert.equal(j.gelesen.uploads.vorhanden, false);
    assert.equal(j.ausstehend.anzahl, 0);
    assert.deepEqual(j.aufnahmen, []);
    assert.equal(j.summen.aufnahmen, 0);
    // Die Linkdatei entsteht trotzdem -- leer, aber mit Kopf. data/ wird dafuer angelegt.
    const l = JSON.parse(fs.readFileSync(U.linkdateiPfad(w), 'utf8'));
    assert.equal(l.anzahl, 0);
    assert.deepEqual(l.videos, []);
  } finally { weg(w); }
});

test('eine laufende Freigabe-Sitzung und uebergangene Namen werden genannt, nicht verschwiegen', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    lege(w, 'freigaben', C + '.sperre.json', '{"pid":1}\n');
    lege(w, 'uploads', '.' + A + '.json.tmp.1234.1', '{');
    fs.mkdirSync(path.join(w, 'data', 'plaene', 'archiv'));
    const r = lauf(w, []);
    assert.equal(r.code, U.EXIT_OK, r.stderr);
    assert.match(r.stdout, /data\/freigaben\/2026-09-05 10-00-00\.sperre\.json {3}FREIGABE-SITZUNG laeuft/);
    assert.match(r.stdout, /data\/uploads\/\.2026-08-31 17-36-21\.json\.tmp\.1234\.1 {3}uebergangen \(kein \.json\)/);
    assert.match(r.stdout, /data\/plaene\/archiv {3}uebergangen \(kein \.json\)/);
    const j = JSON.parse(lauf(w, ['--json']).stdout);
    assert.deepEqual(j.gelesen.freigaben.sitzungen, [C]);
    assert.deepEqual(j.gelesen.uploads.uebergangen, ['.' + A + '.json.tmp.1234.1']);
    assert.deepEqual(j.gelesen.plaene.uebergangen, ['archiv']);
    assert.equal(j.ausstehend.anzahl, 4, 'die Sitzung hat die Zaehlung veraendert');
  } finally { weg(w); }
});

test('der Stand nennt jede gelesene Datei mit Aenderungszeit und Pruefsumme', () => {
  const w = wegwerfWurzel();
  try {
    const { gA } = echteLageInKlein(w);
    const u = baue(w).uebersicht;
    assert.deepEqual(u.gelesen.freigaben.dateien.map((d) => d.datei),
      ['data/freigaben/' + GESPERRT + '.json', 'data/freigaben/' + A + '.json', 'data/freigaben/' + B + '.json']);
    const g = u.gelesen.uploads.dateien.find((d) => d.datei === 'data/uploads/' + A + '.json');
    assert.equal(g.sha256, sha(gA));
    assert.match(g.geaendert_am_ortszeit, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    assert.equal(g.geaendert_am, new Date(fs.statSync(path.join(w, 'data', 'uploads', A + '.json')).mtimeMs).toISOString());
  } finally { weg(w); }
});

// ---------------------------------------------------------------------------
// WIDERSPRUECHE -- jeder einzeln benannt, keiner bricht ab
// ---------------------------------------------------------------------------

function arten(u) {
  return u.widersprueche.map((x) => x.art).sort();
}

test('Freigabe nach dem Planen geaendert: freigabe_sha256 passt nicht mehr', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const f = JSON.parse(fs.readFileSync(path.join(w, 'data', 'freigaben', A + '.json'), 'utf8'));
    f.freigaben[0].notiz = 'nachtraeglich';
    lege(w, 'freigaben', A + '.json', JSON.stringify(f, null, 2) + '\n');
    const u = baue(w).uebersicht;
    assert.deepEqual(arten(u), ['freigabe_nach_plan_geaendert']);
    assert.equal(u.widersprueche[0].aufnahme, A);
    assert.match(u.widersprueche[0].text, /nach dem Planen geaendert/);
    const r = lauf(w, []);
    assert.equal(r.code, U.EXIT_OK, 'ein Widerspruch ist ein Befund in der Ausgabe, kein Abbruch');
    assert.match(r.stdout, /WIDERSPRUECHE: 1/);
    assert.match(r.stdout, /\[freigabe_nach_plan_geaendert\] 2026-08-31 17-36-21:/);
  } finally { weg(w); }
});

test('Plan nach dem Upload ersetzt: plan_sha256 im Gedaechtnis passt nicht mehr', () => {
  const w = wegwerfWurzel();
  try {
    const { fA, tA } = echteLageInKlein(w);
    lege(w, 'plaene', A + '.json', planText(A, fA, tA, { anschluss: { grund: 'jetzt' } }));
    const u = baue(w).uebersicht;
    assert.deepEqual(arten(u), ['plan_nach_upload_geaendert']);
  } finally { weg(w); }
});

test('Plan nur teilweise hochgeladen, mit verstrichenen Terminen', () => {
  const w = wegwerfWurzel();
  try {
    const { pA, tA } = echteLageInKlein(w);
    // Nur der zweite Termin ist hochgeladen; der erste (vergangen) und der
    // dritte fehlen im Gedaechtnis.
    lege(w, 'uploads', A + '.json', gedaechtnisText(A, pA, [tA[1]]));
    const u = baue(w).uebersicht;
    assert.deepEqual(arten(u), ['plan_unvollstaendig_hochgeladen']);
    assert.match(u.widersprueche[0].text, /2 von 3 Terminen des Plans stehen nicht im Gedaechtnis, davon 1 mit bereits verstrichenem Termin/);
    assert.match(u.widersprueche[0].text, /2026-08-31 17-36-21\/4, 2026-08-31 17-36-21\/33/);
    const a = u.aufnahmen.find((x) => x.aufnahme === A);
    assert.equal(a.zustand, 'teilweise_hochgeladen');
    assert.equal(a.hochgeladen, 1);
    assert.equal(a.geplant, 3);
    // Ausstehend ist nur, was hochgeladen ist -- nicht, was der Plan wollte.
    assert.deepEqual(u.ausstehend.termine.filter((t) => t.aufnahme === A).map((t) => t.kennung), [A + '/9']);
  } finally { weg(w); }
});

test('Plan nie hochgeladen und Termine verstrichen', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    fs.unlinkSync(path.join(w, 'data', 'uploads', A + '.json'));
    const u = baue(w).uebersicht;
    assert.deepEqual(arten(u), ['plan_nicht_hochgeladen_termine_vergangen']);
    assert.match(u.widersprueche[0].text, /1 von 3 Terminen sind bereits verstrichen/);
    const a = u.aufnahmen.find((x) => x.aufnahme === A);
    assert.equal(a.zustand, 'geplant_nichts_hochgeladen');
    assert.equal(a.hochgeladen, null);
    assert.equal(a.ausstehend, null);
    assert.equal(u.ausstehend.anzahl, 2);
    // Ein Plan ohne verstrichene Termine ist kein Widerspruch, nur ein Zustand.
    const frueh = baue(w, Date.parse('2026-09-02T08:00:00+02:00')).uebersicht;
    assert.deepEqual(arten(frueh), []);
    assert.equal(frueh.aufnahmen.find((x) => x.aufnahme === A).zustand, 'geplant_nichts_hochgeladen');
  } finally { weg(w); }
});

test('Gedaechtnis ohne Plan: die Termine zaehlen trotzdem als ausstehend', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    fs.unlinkSync(path.join(w, 'data', 'plaene', A + '.json'));
    const u = baue(w).uebersicht;
    assert.deepEqual(arten(u), ['gedaechtnis_ohne_plan']);
    assert.equal(u.ausstehend.anzahl, 4);
    assert.equal(u.aufnahmen.find((x) => x.aufnahme === A).geplant, null);
  } finally { weg(w); }
});

test('die Sperre wurde umgangen: Plan oder Gedaechtnis fuer eine gesperrte Aufnahme', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    const f = fs.readFileSync(path.join(w, 'data', 'freigaben', GESPERRT + '.json'), 'utf8');
    const t = [{ n: 10, publish_at: '2026-09-06T08:00:00.000Z' }];
    const p = planText(GESPERRT, f, t);
    lege(w, 'plaene', GESPERRT + '.json', p);
    lege(w, 'uploads', GESPERRT + '.json', gedaechtnisText(GESPERRT, p, t));
    const u = baue(w).uebersicht;
    assert.ok(arten(u).includes('sperre_umgangen'), arten(u).join(','));
    assert.match(u.widersprueche.find((x) => x.art === 'sperre_umgangen').text, /ein Plan und ein Gedaechtnis/);
    // Der Upload steht trotzdem als ausstehend da -- er IST hochgeladen.
    assert.equal(u.ausstehend.letzter.kennung, GESPERRT + '/10');
    assert.equal(u.aufnahmen.find((x) => x.aufnahme === GESPERRT).zustand, 'gesperrt');
    // Und die Freigaben zaehlen weiterhin nicht als Vorrat.
    assert.equal(u.vorrat.planbar.shorts_gesamt, 0);
  } finally { weg(w); }
});

test('Titel, der zwischen den Sorten abweicht, und eine videoId ohne Form', () => {
  const w = wegwerfWurzel();
  try {
    const { pA, tA } = echteLageInKlein(w);
    const uploads = tA.map((t) => Object.assign({}, t));
    uploads[1].titel = 'In Studio umbenannt';
    uploads[2].videoId = 'keine-echte-kennung';
    lege(w, 'uploads', A + '.json', gedaechtnisText(A, pA, uploads));
    const u = baue(w).uebersicht;
    assert.deepEqual(arten(u), ['titel_weicht_ab', 'videoid_form']);
    assert.match(u.widersprueche.find((x) => x.art === 'titel_weicht_ab').text, /im Plan: "Probe 9"; im Gedaechtnis: "In Studio umbenannt"/);
    assert.match(u.widersprueche.find((x) => x.art === 'videoid_form').text, /fuehrt nirgendwohin/);
    // Die Linkdatei traegt, was im Gedaechtnis steht -- auch die kaputte Kennung.
    const r = lauf(w, []);
    assert.equal(r.code, U.EXIT_OK);
    const l = JSON.parse(fs.readFileSync(U.linkdateiPfad(w), 'utf8'));
    assert.equal(l.videos.find((v) => v.kennung === A + '/33').videoId, 'keine-echte-kennung');
    assert.equal(l.videos.find((v) => v.kennung === A + '/9').titel, 'In Studio umbenannt');
  } finally { weg(w); }
});

test('Termin im Plan ohne Freigabe, abgelehnt, freigegeben ohne Termin, Upload ohne Termin', () => {
  const w = wegwerfWurzel();
  try {
    const { fA, tA, pA } = echteLageInKlein(w);
    // Plan mit einem Termin, dessen sha256 in der Freigabe abgelehnt ist (/18),
    // und einem, den es in der Freigabe nicht gibt (/77).
    const t = tA.concat([
      { n: 18, publish_at: '2026-09-03T09:30:00.000Z' },
      { n: 77, publish_at: '2026-09-03T09:50:00.000Z' },
    ]);
    const p = planText(A, fA, t);
    lege(w, 'plaene', A + '.json', p);
    // Gedaechtnis mit einem Upload, der in keinem Termin steht (/55), und ohne /33.
    lege(w, 'uploads', A + '.json', gedaechtnisText(A, p, [tA[0], tA[1],
      { n: 55, publish_at: '2026-09-03T11:00:00.000Z' }]));
    const u = baue(w).uebersicht;
    assert.deepEqual(arten(u), [
      'plan_unvollstaendig_hochgeladen', 'termin_nicht_freigegeben', 'termin_ohne_freigabe',
      'upload_ohne_termin',
    ]);
    // Und ein freigegebener Short, den weder Plan noch Gedaechtnis kennen:
    lege(w, 'freigaben', A + '.json', freigabeText(A, [
      { n: 4, frei: true }, { n: 9, frei: true }, { n: 18, frei: false }, { n: 33, frei: true },
      { n: 88, frei: true },
    ]));
    lege(w, 'plaene', A + '.json', pA);
    lege(w, 'uploads', A + '.json', gedaechtnisText(A, pA, tA));
    const u2 = baue(w).uebersicht;
    assert.deepEqual(arten(u2), ['freigabe_nach_plan_geaendert', 'freigabe_ohne_termin']);
    assert.match(u2.widersprueche.find((x) => x.art === 'freigabe_ohne_termin').text, /2026-08-31 17-36-21\/88/);
    // Das ist KEIN Vorrat: die Aufnahme hat einen Plan.
    assert.equal(u2.vorrat.planbar.shorts_gesamt, 0);
  } finally { weg(w); }
});

test('Widersprueche aendern weder Exit-Code noch Linkdatei', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    fs.unlinkSync(path.join(w, 'data', 'plaene', A + '.json'));
    const r = lauf(w, ['--json']);
    assert.equal(r.code, U.EXIT_OK);
    const u = JSON.parse(r.stdout);
    assert.equal(u.widersprueche.length, 1);
    assert.equal(u.linkdatei.geschrieben, true);
    assert.equal(JSON.parse(fs.readFileSync(U.linkdateiPfad(w), 'utf8')).anzahl, 5);
  } finally { weg(w); }
});

test('kann die Linkdatei nicht geschrieben werden, sagt es die Ausgabe und der Exit-Code', () => {
  const w = wegwerfWurzel();
  try {
    echteLageInKlein(w);
    // Ein Verzeichnis, wo die Datei hin soll: rename schlaegt fehl.
    fs.mkdirSync(U.linkdateiPfad(w));
    const r = lauf(w, []);
    assert.equal(r.code, U.EXIT_BEFUND);
    assert.match(r.stdout, /LINKDATEI: data\/links\.json NICHT geschrieben:/);
    assert.match(r.stderr, /BEFUND: data\/links\.json konnte nicht geschrieben werden/);
    assert.deepEqual(fs.readdirSync(path.join(w, 'data')).sort(), ['freigaben', 'links.json', 'plaene', 'uploads'],
      'es liegt eine Temporaerdatei herum');
    const j = lauf(w, ['--json']);
    assert.equal(j.code, U.EXIT_BEFUND);
    assert.equal(JSON.parse(j.stdout).linkdatei.geschrieben, false);
  } finally { weg(w); }
});

test('die Exit-Codes sind die der Tabelle in uebergabe-leser.js', () => {
  const { EXIT } = require('../src/upload/uebergabe-leser.js');
  assert.equal(U.EXIT_OK, EXIT.OK);
  assert.equal(U.EXIT_BEFUND, EXIT.BEFUND);
  assert.equal(U.EXIT_AUFRUFFEHLER, EXIT.AUFRUF);
  assert.deepEqual(U.ERLAUBTE_ARGUMENTE, ['--json', '--jetzt=']);
});

test('package.json kennt shorts:uebersicht', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(WURZEL, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['shorts:uebersicht'], 'node src/upload/uebersicht.js');
});
