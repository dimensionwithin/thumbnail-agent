'use strict';

// DW: Tests fuer die zwei Dinge, die am 02.09. gefehlt haben.
//
// 1. DAS GEDAECHTNIS DARF NICHT WEGGERAEUMT WERDEN. Der alte Rat lautete
//    "verschieben, nicht loeschen" -- und nach data/uploads/archiv/ verschoben
//    war das Gedaechtnis fuer den Planer unsichtbar. Er sah "nichts
//    ausstehend" und legte den naechsten Plan ueber vergebene Termine, ohne
//    ein Wort. Die Tests unten halten fest, dass genau das jetzt abbricht --
//    und dass eine ordentliche Gedaechtnisdatei weiterhin gelesen wird.
//
// 2. DIE VORSCHAU MUSS DEN ANSCHLUSS NENNEN. Wer sie liest, muss den letzten
//    vergebenen Termin mit seiner Aufnahme sehen und den ersten neuen
//    darunter. Ohne das erkennt niemand eine Ueberlappung -- am 02.09. hat sie
//    niemand erkannt, weil die Seite die alten Termine gar nicht nannte.
//
// Kein Test hier macht einen Netzaufruf, und keiner schreibt nach data/uploads
// oder data/plaene des Projekts: alles laeuft in Wegwerfverzeichnissen.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const P = require('../src/upload/planer.js');
const U = require('../src/upload/uploader.js');
const S = require('../src/upload/freigabe-server.js');
const L = require('../src/upload/uebergabe-leser.js');

const WURZEL = path.join(__dirname, '..');
const PLANER_QUELLE = fs.readFileSync(path.join(WURZEL, 'src', 'upload', 'planer.js'), 'utf8');
const UPLOADER_QUELLE = fs.readFileSync(path.join(WURZEL, 'src', 'upload', 'uploader.js'), 'utf8');
const SERVER_QUELLE = fs.readFileSync(path.join(WURZEL, 'src', 'upload', 'freigabe-server.js'), 'utf8');

const nurCode = (t) => t.split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n');

const ALT = '2026-01-05 09-00-00';
const NEU = '2026-01-06 09-00-00';
const JETZT = Date.parse('2026-01-06T09:00:00.000Z');
const MIN = 60 * 1000;

// Ein Gedaechtnis mit n Terminen ab versatzMs nach JETZT, je 72 Minuten.
function gedaechtnisText(aufnahme, n, versatzMs) {
  const uploads = [];
  for (let i = 0; i < n; i++) {
    uploads.push({
      sha256: crypto.createHash('sha256').update(aufnahme + '-' + i).digest('hex'),
      kennung: aufnahme + '/' + (i + 1),
      videoId: 'WEGWERF-' + i,
      hochgeladen_am: new Date(JETZT - 3600 * 1000).toISOString(),
      publish_at: new Date(JETZT + versatzMs + i * 72 * MIN).toISOString(),
      titel: 'Wegwerf ' + (i + 1),
    });
  }
  return JSON.stringify({
    artifact_type: 'adw_shorts_uploads', schema_version: '1.0', aufnahme,
    plan_datei: 'data/plaene/' + aufnahme + '.json',
    plan_sha256: crypto.createHash('sha256').update('plan-' + aufnahme).digest('hex'),
    angelegt_am: new Date(JETZT - 3600 * 1000).toISOString(),
    zuletzt_geschrieben_am: new Date(JETZT - 3600 * 1000).toISOString(),
    uploads,
  }, null, 2) + '\n';
}

// Ein Wegwerf-data/uploads. lege(verzeichnis) legt hinein, was der Fall braucht.
function mitUploads(lege) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  const u = path.join(tmp, 'data', 'uploads');
  fs.mkdirSync(u, { recursive: true });
  try { lege(u, tmp); return { tmp, u }; } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
}

// ---------------------------------------------------------------------------
// 1 -- DER DEFEKT: WEGGERAEUMT IST UNSICHTBAR
// ---------------------------------------------------------------------------

test('DW1: ein Gedaechtnis in data/uploads/ wird gelesen -- kein Rueckschritt', () => {
  const { tmp, u } = mitUploads((u) => {
    fs.writeFileSync(path.join(u, ALT + '.json'), gedaechtnisText(ALT, 13, 24 * 3600 * 1000));
  });
  try {
    const v = P.leseGedaechtnisverzeichnis(u);
    assert.deepEqual(v.fehler, []);
    assert.deepEqual(v.dateien.map((d) => d.aufnahme), [ALT]);
    const g = P.sammleAusstehende(v.dateien, JETZT);
    assert.deepEqual(g.fehler, []);
    assert.equal(g.ausstehend.length, 13);
    assert.equal(P.bestimmeStartpunkt(JETZT, g.ausstehend).grund, 'ausstehender_termin');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('DW1: nach data/uploads/archiv/ verschoben BRICHT AB und nennt das Verzeichnis', () => {
  const { tmp, u } = mitUploads((u) => {
    const a = path.join(u, 'archiv');
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, ALT + '.json'), gedaechtnisText(ALT, 13, 24 * 3600 * 1000));
  });
  try {
    const v = P.leseGedaechtnisverzeichnis(u);
    assert.equal(v.fehler.length, 1, 'kein Abbruch: ' + JSON.stringify(v));
    assert.match(v.fehler[0], /VERZEICHNIS "archiv"/);
    // Die Meldung sagt, WARUM -- nicht nur, DASS.
    assert.match(v.fehler[0], /still ueber Termine, die schon vergeben sind/);
    assert.match(v.fehler[0], /NICHT weggeraeumt/);
    // Und es kommt keine Dateiliste zurueck, aus der ein Plan entstuende.
    assert.equal(v.dateien, undefined);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('DW1: eine umbenannte Gedaechtnisdatei (".json.alt") bricht ebenfalls ab', () => {
  // Der Auftrag nahm an, eine Umbenennung im selben Verzeichnis falle ohnehin
  // laut auf. Das galt nur, solange der Name auf .json endete. "....json.alt"
  // ging vorher genauso still durch wie das Unterverzeichnis -- gemessen.
  const { tmp, u } = mitUploads((u) => {
    fs.writeFileSync(path.join(u, ALT + '.json.alt'), gedaechtnisText(ALT, 13, 24 * 3600 * 1000));
  });
  try {
    const v = P.leseGedaechtnisverzeichnis(u);
    assert.equal(v.fehler.length, 1);
    assert.match(v.fehler[0], /json\.alt/);
    assert.match(v.fehler[0], /endet nicht auf \.json/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('DW1: ein fremder Name MIT .json bricht weiter ab -- die alte Regel bleibt', () => {
  const { tmp, u } = mitUploads((u) => {
    fs.writeFileSync(path.join(u, 'notizen.json'), '{}');
  });
  try {
    const v = P.leseGedaechtnisverzeichnis(u);
    assert.equal(v.fehler.length, 1);
    assert.match(v.fehler[0], /nicht die Form/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('DW1: die Temporaerdatei des atomaren Schreibens wird uebergangen', () => {
  // Sie entsteht in schreibeGedaechtnisAtomar und kann nach einem Absturz
  // liegenbleiben. Erkannt wird sie an ihrer FORM -- nicht daran, dass sie
  // nicht auf .json endet: sonst waere jeder beliebige Name wieder still.
  const { tmp, u } = mitUploads((u) => {
    fs.writeFileSync(path.join(u, ALT + '.json'), gedaechtnisText(ALT, 2, 24 * 3600 * 1000));
    fs.writeFileSync(path.join(u, '.' + ALT + '.json.tmp.12345.7'), 'halb geschrieben');
  });
  try {
    const v = P.leseGedaechtnisverzeichnis(u);
    assert.deepEqual(v.fehler, []);
    assert.deepEqual(v.dateien.map((d) => d.aufnahme), [ALT]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('DW1: der Schaden -- weggeraeumt entstand ein Plan UEBER vergebenen Terminen, jetzt entsteht keiner', () => {
  // Die Gegenprobe zum Bericht, an derselben Lage: 13 vergebene Termine, eine
  // Aufnahme mit 9 Freigaben, derselbe Planungszeitpunkt.
  const freigabeText = baueFreigabe(9);
  const letzterVergeben = JETZT + 24 * 3600 * 1000 + 12 * 72 * MIN;

  // (a) So wie es soll: der Plan schliesst an.
  const a = mitUploads((u) => {
    fs.writeFileSync(path.join(u, ALT + '.json'), gedaechtnisText(ALT, 13, 24 * 3600 * 1000));
  });
  try {
    const v = P.leseGedaechtnisverzeichnis(a.u);
    const g = P.sammleAusstehende(v.dateien, JETZT);
    const e = P.planeAufnahme({
      aufnahme: NEU, freigabeText, gedaechtnisText: null, planungszeitpunkt: JETZT,
      vorgegeben: true, jetzt: JETZT, ausstehende: g.ausstehend,
      gedaechtnisdateien: v.dateien.map((d) => d.datei),
    });
    assert.deepEqual(e.fehler, []);
    const ueber = e.plan.termine.filter((t) => Date.parse(t.publish_at) <= letzterVergeben);
    assert.equal(ueber.length, 0, 'ein Termin liegt ueber einem vergebenen');
    assert.equal(e.plan.anschluss.grund, 'ausstehender_termin');
  } finally { fs.rmSync(a.tmp, { recursive: true, force: true }); }

  // (b) Weggeraeumt: KEIN Plan mehr, sondern ein Abbruch mit Namen.
  const b = mitUploads((u) => {
    const arch = path.join(u, 'archiv');
    fs.mkdirSync(arch);
    fs.writeFileSync(path.join(arch, ALT + '.json'), gedaechtnisText(ALT, 13, 24 * 3600 * 1000));
  });
  try {
    const v = P.leseGedaechtnisverzeichnis(b.u);
    assert.equal(v.fehler.length, 1);
    assert.match(v.fehler[0], /archiv/);
  } finally { fs.rmSync(b.tmp, { recursive: true, force: true }); }
});

test('DW1: der Rat, das Gedaechtnis wegzuraeumen, steht in keinem der drei Programme mehr', () => {
  for (const [name, quelle] of [['planer.js', PLANER_QUELLE], ['uploader.js', UPLOADER_QUELLE],
    ['freigabe-server.js', SERVER_QUELLE]]) {
    const code = nurCode(quelle);
    assert.ok(!/raeumt das Gedaechtnis/.test(code), name + ' raet weiter zum Wegraeumen');
    assert.ok(!/Gedaechtnis selbst weg/.test(code), name + ' raet weiter zum Wegraeumen');
  }
  // Und die Weigerung des Uploaders sagt jetzt, was STATTDESSEN zu tun ist.
  assert.match(UPLOADER_QUELLE, /DAS GEDAECHTNIS BLEIBT ' \+\s*\n\s*'LIEGEN, WO ES LIEGT/);
});

// ---------------------------------------------------------------------------
// 2 -- DER ANSCHLUSS IN DER VORSCHAU
// ---------------------------------------------------------------------------

const BESCHREIBUNG_PROBE = '{titel}\n\nProbetext fuer den Test.\n\n{hashtags}\n';

// Eine vollstaendige Wegwerf-Lage: Projektwurzel mit config, Lieferung mit
// Videodateien, Plan, und ein FREMDES Gedaechtnis in data/uploads.
function wegwerfLage({ termineAbMs, fremdeTermine = 13, fremdeAbMs = 24 * 3600 * 1000, anzahl = 3 }) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-wurzel-'));
  fs.mkdirSync(path.join(w, 'config'));
  fs.mkdirSync(path.join(w, 'data', 'plaene'), { recursive: true });
  fs.mkdirSync(path.join(w, 'data', 'uploads'), { recursive: true });
  fs.copyFileSync(path.join(WURZEL, U.HASHTAGS_DATEI), path.join(w, U.HASHTAGS_DATEI));
  fs.copyFileSync(path.join(WURZEL, U.VEROEFFENTLICHUNG_DATEI), path.join(w, U.VEROEFFENTLICHUNG_DATEI));
  fs.writeFileSync(path.join(w, U.BESCHREIBUNG_DATEI), BESCHREIBUNG_PROBE);

  const l = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-lieferung-'));
  const ordner = path.join(l, NEU);
  fs.mkdirSync(ordner);
  const shorts = [];
  for (let i = 1; i <= anzahl; i++) {
    const zo = path.join(ordner, 'kandidat-' + String(i).padStart(2, '0'));
    fs.mkdirSync(zo);
    const pfad = path.join(zo, 'short.mp4');
    const inhalt = crypto.randomBytes(2048 + i);
    fs.writeFileSync(pfad, inhalt);
    shorts.push({ kennung: NEU + '/' + i, pfad,
      sha256: crypto.createHash('sha256').update(inhalt).digest('hex'), titel: 'Probe ' + i });
  }
  fs.writeFileSync(path.join(ordner, 'uebergabe.json'), JSON.stringify({
    artifact_type: L.ARTIFACT_TYPE, schema_version: '1.0', aufnahme: NEU,
    erzeugt_am: '2026-01-01T00:00:00+01:00',
    shorts: shorts.map((s) => ({ kennung: s.kennung, pfad: s.pfad, sha256: s.sha256 })),
  }, null, 2) + '\n');

  const termine = shorts.map((s, i) => ({
    sha256: s.sha256, kennung: s.kennung, titel: s.titel,
    publish_at: new Date(JETZT + termineAbMs + i * 72 * MIN).toISOString(),
  }));
  fs.writeFileSync(U.planPfad(w, NEU), JSON.stringify({
    artifact_type: P.PLAN_ARTIFACT_TYPE, schema_version: P.PLAN_SCHEMA_VERSION,
    aufnahme: NEU, verbindlich: 'publish_at',
    // ABSICHTLICH FALSCH: das Feld anschluss des Plans behauptet, es stehe
    // nichts aus. Wer die Vorschau daraus baut, faellt hier auf.
    anschluss: { grund: 'jetzt', ausstehende_termine_gesamt: 0, letzter_ausstehender: null },
    termine,
  }, null, 2) + '\n');

  if (fremdeTermine > 0) {
    fs.writeFileSync(path.join(w, 'data', 'uploads', ALT + '.json'),
      gedaechtnisText(ALT, fremdeTermine, fremdeAbMs));
  }
  return { w, lieferung: l, shorts, termine,
    aufraeumen: () => { fs.rmSync(w, { recursive: true, force: true });
      fs.rmSync(l, { recursive: true, force: true }); } };
}

function vorschauZu(lage) {
  const v = U.bereiteVor({ projektwurzel: lage.w, wurzel: lage.lieferung, aufnahme: NEU, jetzt: JETZT });
  assert.deepEqual(v.fehler, []);
  return { v, text: U.formatiereVorschau(v) };
}

test('DW2: die Vorschau nennt den letzten vergebenen Termin mit seiner Aufnahme und den ersten neuen darunter', () => {
  // 13 fremde Termine ab +24 h, der Plan setzt erst ab +72 h an.
  const lage = wegwerfLage({ termineAbMs: 72 * 3600 * 1000 });
  try {
    const { v, text } = vorschauZu(lage);
    const letzter = new Date(JETZT + 24 * 3600 * 1000 + 12 * 72 * MIN).toISOString();

    assert.equal(v.anschluss.lesbar, true);
    assert.equal(v.anschluss.ausstehende_gesamt, 13);
    assert.equal(v.anschluss.letzter_ausstehender.publish_at, letzter);
    assert.equal(v.anschluss.letzter_ausstehender.aufnahme, ALT);
    assert.equal(v.anschluss.erster_neuer.publish_at, lage.termine[0].publish_at);
    assert.deepEqual(v.anschluss.ueberlappend, []);

    assert.match(text, /ANSCHLUSS -- woran dieser Lauf anschliesst/);
    assert.match(text, /Ausstehende Termine:   13/);
    assert.ok(text.includes('Letzter vergebener:    ' + letzter), 'der letzte vergebene Termin fehlt');
    assert.ok(text.includes('Aufnahme ' + ALT + ', ' + ALT + '/13'), 'Aufnahme und Kennung fehlen');
    assert.ok(text.includes('Erster neuer Termin:   ' + lage.termine[0].publish_at));
    assert.match(text, /Der erste neue Termin liegt DAHINTER\. Keine Ueberlappung\./);

    // Und der Anschluss steht in der LAGE dieses Laufs, also VOR der ersten
    // Zeile aus 78 Gleichheitszeichen -- die Seite ueberschreibt diesen Block
    // mit "Lage dieses Laufs".
    const bis = text.indexOf('='.repeat(78));
    assert.ok(bis > 0, 'die Vorschau hat keine Trennzeile');
    assert.ok(text.indexOf('ANSCHLUSS --') < bis, 'der Anschluss steht hinter den Shorts');
  } finally { lage.aufraeumen(); }
});

test('DW2: die Lage, in der NICHTS aussteht -- die Vorschau sagt das und rechnet nicht 0 herbei', () => {
  const lage = wegwerfLage({ termineAbMs: 72 * 3600 * 1000, fremdeTermine: 0 });
  try {
    const { v, text } = vorschauZu(lage);
    assert.equal(v.anschluss.lesbar, true);
    assert.equal(v.anschluss.ausstehende_gesamt, 0);
    assert.equal(v.anschluss.letzter_ausstehender, null);
    assert.match(text, /Ausstehende Termine:   0  -- in keiner Gedaechtnisdatei steht ein Termin, der noch bevorsteht/);
    assert.match(text, /Es gibt keinen vergebenen Termin, ueber den sich dieser Lauf legen koennte\./);
    assert.ok(!/UEBERLAPPUNG/.test(text));
  } finally { lage.aufraeumen(); }
});

test('DW2: vergangene Termine stehen nicht aus -- ein Gedaechtnis von gestern macht keinen Anschluss', () => {
  const lage = wegwerfLage({ termineAbMs: 72 * 3600 * 1000, fremdeAbMs: -30 * 24 * 3600 * 1000 });
  try {
    const { v } = vorschauZu(lage);
    assert.equal(v.anschluss.ausstehende_gesamt, 0);
    assert.equal(v.anschluss.letzter_ausstehender, null);
  } finally { lage.aufraeumen(); }
});

test('DW2: liegt der Lauf ueber vergebenen Terminen, sagt die Vorschau es -- mit jedem einzelnen', () => {
  // Der Plan setzt schon nach 2 h an, die fremden Termine laufen bis +38 h.
  const lage = wegwerfLage({ termineAbMs: 2 * 3600 * 1000 });
  try {
    const { v, text } = vorschauZu(lage);
    assert.equal(v.anschluss.ueberlappend.length, 3, 'alle drei liegen darueber');
    assert.match(text, /UEBERLAPPUNG: 3 von 3 Terminen dieses Laufs liegen NICHT/);
    for (const t of lage.termine) assert.ok(text.includes(t.kennung + '   ' + t.publish_at),
      'der ueberlappende Termin ' + t.kennung + ' wird nicht einzeln genannt');
    assert.match(text, /Das ist die Lage vom 02\.09\./);
  } finally { lage.aufraeumen(); }
});

test('DW2: gerechnet wird aus data/uploads, NICHT aus dem Feld anschluss des Plans', () => {
  // Der Plan der Wegwerf-Lage behauptet ausdruecklich "ausstehende_termine_gesamt: 0"
  // und "letzter_ausstehender: null". Die Vorschau muss trotzdem 13 nennen.
  const lage = wegwerfLage({ termineAbMs: 72 * 3600 * 1000 });
  try {
    const plan = JSON.parse(fs.readFileSync(U.planPfad(lage.w, NEU), 'utf8'));
    assert.equal(plan.anschluss.ausstehende_termine_gesamt, 0, 'die Falle steht nicht');
    const { v } = vorschauZu(lage);
    assert.equal(v.anschluss.ausstehende_gesamt, 13);
    assert.notEqual(v.anschluss.letzter_ausstehender, null);
  } finally { lage.aufraeumen(); }
});

test('DW2: laesst data/uploads sich nicht lesen, sagt die Vorschau das -- statt "0 ausstehend"', () => {
  const lage = wegwerfLage({ termineAbMs: 72 * 3600 * 1000 });
  try {
    fs.mkdirSync(path.join(lage.w, 'data', 'uploads', 'archiv'));
    const { v, text } = vorschauZu(lage);
    assert.equal(v.anschluss.lesbar, false);
    assert.equal(v.anschluss.ausstehende_gesamt, 0);
    assert.match(text, /NICHT ZU BERECHNEN/);
    assert.match(text, /"0 ausstehend" waere an dieser Stelle eine Auskunft, die keine ist/);
    assert.match(text, /VERZEICHNIS "archiv"/);
    // Der Uploader bricht deswegen NICHT ab: die Weigerung gehoert in den
    // Planer, der Termine vergibt. Hier gehoert die Auskunft hin.
    assert.deepEqual(v.fehler, []);
    assert.equal(v.auswahl.length, 3);
  } finally { lage.aufraeumen(); }
});

test('DW2: die Vorschau nennt keine videoId -- auch nicht die aus dem fremden Gedaechtnis', () => {
  const lage = wegwerfLage({ termineAbMs: 72 * 3600 * 1000 });
  try {
    const { text } = vorschauZu(lage);
    assert.ok(!/WEGWERF-/.test(text), 'eine videoId steht in der Vorschau');
    assert.ok(!/videoId/.test(text));
  } finally { lage.aufraeumen(); }
});

test('DW2: anschlussZeilen ohne Anschluss behauptet nichts', () => {
  // Eine Vorschau, der kein Anschluss mitgegeben wurde (aeltere Aufrufer,
  // Testattrappen), darf nicht wie "0 ausstehend" aussehen.
  const z = U.anschlussZeilen(undefined).join('\n');
  assert.match(z, /NICHT BERECHNET/);
  assert.ok(!/Ausstehende Termine:/.test(z));
});

// ---------------------------------------------------------------------------
// 3 -- DER WEG AUF DIE SEITE
// ---------------------------------------------------------------------------

test('DW3: --vorschau-json traegt den Anschluss, und zwar den gerechneten', () => {
  const code = nurCode(UPLOADER_QUELLE);
  assert.match(code, /artifact_type: 'adw_shorts_vorschau'[\s\S]{0,900}anschluss: v\.anschluss,/);
  // Er kommt aus bereiteVor und nicht aus dem Plan.
  assert.match(code, /const anschluss = bestimmeAnschluss\(\{ projektwurzel, auswahl, jetzt \}\)/);
  assert.ok(!/anschluss: (v\.)?plan\.anschluss/.test(code), 'der Plan-Schnappschuss wird abgeschrieben');
});

test('DW3: der Freigabedienst reicht den Anschluss durch und bildet ihn nicht selbst', () => {
  const code = nurCode(SERVER_QUELLE);
  // Schritt 1 legt ihn in die Vorschau der Kette ...
  assert.match(code, /anschluss: zahlen\.anschluss \|\| null,/);
  // ... und kettenstand gibt ihn an den Browser weiter.
  assert.match(code, /anschluss: k\.vorschau\.anschluss \|\| null,/);
  // Der Dienst rechnet nichts: kein eigener Aufruf der Planerfunktionen.
  assert.ok(!/sammleAusstehende|leseGedaechtnisverzeichnis/.test(code),
    'der Dienst rechnet den Anschluss selbst aus');
});

test('DW3: kettenstand gibt den Anschluss heraus -- mit und ohne Vorschau', () => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-kette-'));
  fs.mkdirSync(path.join(w, 'data', 'plaene'), { recursive: true });
  try {
    const sitzung = { aufnahme: NEU, projektwurzel: w, kette: S.neueKette() };
    // Ohne Schritt 1 gibt es keine Vorschau -- und damit keinen Anschluss.
    assert.equal(S.kettenstand(sitzung).vorschau, null);

    const anschluss = {
      lesbar: true, fehler: [], gedaechtnisdateien: ['data/uploads/' + ALT + '.json'],
      ausstehende_gesamt: 13,
      letzter_ausstehender: { aufnahme: ALT, kennung: ALT + '/13',
        publish_at: '2026-01-07T23:24:00.000Z', publish_at_ortszeit: '2026-01-08 00:24 (UTC+01:00)' },
      erster_neuer: { kennung: NEU + '/1', publish_at: '2026-01-09T09:12:00.000Z',
        publish_at_ortszeit: '2026-01-09 10:12 (UTC+01:00)' },
      ueberlappend: [],
    };
    sitzung.kette.vorschau = {
      text: 'egal', befehl: 'egal', anzahl: 3, kennungen: [], termine_im_plan: 3,
      schon_hochgeladen: 0, plan_sha256: 'a'.repeat(64), erstellt_am: '2026-01-06T09:00:00.000Z',
      kanal_name: 'Probe', kanal_bekannt: true, kanal_grund: null, kanal_erzeugt_am: null,
      anschluss,
    };
    const stand = S.kettenstand(sitzung);
    assert.deepEqual(stand.vorschau.anschluss, anschluss);
    assert.equal(stand.vorschau.anschluss.letzter_ausstehender.aufnahme, ALT);

    // Eine Vorschau ohne Anschluss gibt null heraus und nicht undefined --
    // ein fehlendes Feld faellt im JSON sonst ganz weg.
    delete sitzung.kette.vorschau.anschluss;
    assert.equal(S.kettenstand(sitzung).vorschau.anschluss, null);
  } finally { fs.rmSync(w, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Hilfe: eine Freigabedatei mit n freigegebenen Eintraegen, aus der echten
// abgeleitet -- wie in planer.test.cjs, nur auf eine Wegwerf-Aufnahme
// ausgestellt. Sie wird nur GELESEN.
// ---------------------------------------------------------------------------

function baueFreigabe(n) {
  const d = JSON.parse(fs.readFileSync(
    path.join(WURZEL, 'data', 'freigaben', '2026-08-31 17-36-21.json'), 'utf8'));
  const vorlage = d.freigaben.find((e) => e.freigegeben === true);
  d.aufnahme = NEU;
  d.freigaben = [];
  for (let i = 0; i < n; i++) {
    d.freigaben.push(Object.assign({}, vorlage, {
      kennung: NEU + '/' + (i + 1),
      sha256: crypto.createHash('sha256').update('neu-' + i).digest('hex'),
      freigegeben: true,
    }));
  }
  return JSON.stringify(d, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// 4 -- DIE SEITE ZEIGT IHN WIRKLICH
// ---------------------------------------------------------------------------
//
// Die zwei Tests darunter starten einen Browser und lesen ab, was ein Mensch
// sieht. Sie belegen den Weg, um den es geht: der Anschluss steht im TEXT der
// Vorschau, der Dienst reicht diesen Text unveraendert durch, und die Seite
// setzt ihn in den Block, den sie "Lage dieses Laufs" ueberschreibt. Es gibt
// damit keine Stelle zwischen Uploader und Auge, die ihn formulieren oder
// weglassen koennte.
//
// Kein Byte geht ins Netz: jede Anfrage der Seite wird hier beantwortet (die
// Bauart ist aus tests/dt-vorschau.test.cjs uebernommen).

const SEITE = require('../src/upload/freigabe-seite.js');

let chromium = null;
let playwrightGrund = null;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  playwrightGrund = 'playwright ist nicht installiert (' + e.code + ')';
}
const BROWSERTEST = playwrightGrund ? { skip: playwrightGrund, timeout: 60000 } : { timeout: 60000 };

const HERKUNFT = 'http://freigabe.pruefung/';

function ketteMit(text) {
  return {
    aufnahme: NEU, plan_vorhanden: true, plan_pfad: 'data/plaene/' + NEU + '.json',
    eigene_projektwurzel: true, lauf: null, meldung: null,
    vorschau: {
      text, befehl: 'node src/upload/uploader.js --plan="' + NEU + '"',
      anzahl: 3, kennungen: [], termine_im_plan: 3, schon_hochgeladen: 0,
      plan_sha256: 'a'.repeat(64), erstellt_am: '2026-01-06T09:00:00.000Z',
      kanal_name: 'Pruefkanal', kanal_bekannt: true, kanal_grund: null,
      kanal_erzeugt_am: '2026-01-01T00:00:00.000Z',
      anschluss: null,
    },
    schritt3: { bereit: true, grund: null },
  };
}

async function mitSeite(text, arbeit) {
  const browser = await chromium.launch();
  try {
    const seite = await browser.newPage();
    const html = SEITE.baueSeite({
      aufnahme: NEU, freigabePfad: 'data/freigaben/' + NEU + '.json',
      token: 'x'.repeat(32), eingabeSha256: 'b'.repeat(64), karten: [], stand: {},
    });
    await seite.route('**/*', (route) => {
      if (route.request().url().indexOf('/kette') >= 0) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(ketteMit(text)) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    });
    await seite.goto(HERKUNFT, { waitUntil: 'load' });
    await seite.waitForSelector('#vorschauBloecke .block', { timeout: 20000 });
    await arbeit(seite);
  } finally { await browser.close(); }
}

// Der erste Block der Vorschau -- den ueberschreibt die Seite mit "Lage dieses
// Laufs". Zurueck kommt { ueberschrift, text }.
async function ersterBlock(seite) {
  return seite.evaluate(() => {
    const b = document.querySelector('#vorschauBloecke .block');
    return { ueberschrift: b.querySelector('h4').textContent,
      text: Array.from(b.querySelectorAll('pre')).map((p) => p.textContent).join('\n') };
  });
}

test('DW4: die Seite zeigt den Anschluss -- Lage: es steht etwas aus', BROWSERTEST, async () => {
  const lage = wegwerfLage({ termineAbMs: 72 * 3600 * 1000 });
  try {
    const { text } = vorschauZu(lage);
    const letzter = new Date(JETZT + 24 * 3600 * 1000 + 12 * 72 * MIN).toISOString();
    await mitSeite(text, async (seite) => {
      const b = await ersterBlock(seite);
      assert.equal(b.ueberschrift, 'Lage dieses Laufs');
      assert.match(b.text, /ANSCHLUSS -- woran dieser Lauf anschliesst/);
      assert.match(b.text, /Ausstehende Termine:   13/);
      assert.ok(b.text.includes('Letzter vergebener:    ' + letzter),
        'der letzte vergebene Termin steht nicht auf der Seite');
      assert.ok(b.text.includes('Aufnahme ' + ALT + ', ' + ALT + '/13'),
        'die Aufnahme des letzten vergebenen Termins steht nicht auf der Seite');
      assert.ok(b.text.includes('Erster neuer Termin:   ' + lage.termine[0].publish_at),
        'der erste neue Termin steht nicht auf der Seite');
      assert.match(b.text, /liegt DAHINTER\. Keine Ueberlappung\./);
      // Und keine videoId, nirgends auf der Seite.
      const alles = await seite.evaluate(() => document.body.textContent);
      assert.ok(!/WEGWERF-/.test(alles));
    });
  } finally { lage.aufraeumen(); }
});

test('DW4: die Seite zeigt den Anschluss -- Lage: es steht NICHTS aus', BROWSERTEST, async () => {
  const lage = wegwerfLage({ termineAbMs: 72 * 3600 * 1000, fremdeTermine: 0 });
  try {
    const { text } = vorschauZu(lage);
    await mitSeite(text, async (seite) => {
      const b = await ersterBlock(seite);
      assert.equal(b.ueberschrift, 'Lage dieses Laufs');
      assert.match(b.text, /ANSCHLUSS -- woran dieser Lauf anschliesst/);
      assert.match(b.text, /Ausstehende Termine:   0/);
      assert.match(b.text, /Es gibt keinen vergebenen Termin, ueber den sich dieser Lauf legen koennte\./);
      assert.ok(!/Letzter vergebener:/.test(b.text), 'es wird ein Termin genannt, den es nicht gibt');
    });
  } finally { lage.aufraeumen(); }
});

test('DW4: liegt eine Ueberlappung vor, steht sie auf der Seite -- mit jedem Termin',
  BROWSERTEST, async () => {
    const lage = wegwerfLage({ termineAbMs: 2 * 3600 * 1000 });
    try {
      const { text } = vorschauZu(lage);
      await mitSeite(text, async (seite) => {
        const b = await ersterBlock(seite);
        assert.match(b.text, /UEBERLAPPUNG: 3 von 3 Terminen dieses Laufs liegen NICHT/);
        for (const t of lage.termine) {
          assert.ok(b.text.includes(t.kennung + '   ' + t.publish_at),
            'der ueberlappende Termin ' + t.kennung + ' steht nicht auf der Seite');
        }
      });
    } finally { lage.aufraeumen(); }
  });
