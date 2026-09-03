'use strict';

// DN: Tests fuer den Planer.
//
// Der Planer hat zwei Aufgaben, und beide koennen still falsch sein:
// er rechnet Termine aus, und er weigert sich. Ein falsch gerechneter Plan
// sieht aus wie ein richtiger -- aufsteigende Uhrzeiten, plausible Abstaende.
// Eine Weigerung, die nicht kommt, sieht aus wie ein normaler Lauf. Diese
// Tests halten beide Richtungen fest, und die Zeitrechnung wird gegen die
// ECHTEN Umstellungstage 2026 geprueft, nicht gegen erfundene.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const P = require('../src/upload/planer.js');

const WURZEL = path.join(__dirname, '..');
const SKRIPT = path.join(WURZEL, 'src', 'upload', 'planer.js');
const AUFNAHME = '2026-08-31 17-36-21';
const GESPERRT = '2026-08-29 18-18-19';
const QUELLE = path.join(WURZEL, 'src', 'upload', 'planer.js');
const QUELLTEXT = fs.readFileSync(QUELLE, 'utf8');

// Der Quelltext ohne Kommentare. Die Bauart-Tests unten pruefen, was das
// Programm TUT -- ein require in einem Kommentar ist kein require.
const NURCODE = QUELLTEXT
  .split('\n')
  .filter((z) => !/^\s*\/\//.test(z))
  .join('\n');

function freigabeText(aufnahme = AUFNAHME) {
  return fs.readFileSync(path.join(WURZEL, 'data', 'freigaben', aufnahme + '.json'), 'utf8');
}

// Eine Freigabedatei mit n freigegebenen Eintraegen, aus der echten abgeleitet.
// DOa: mit alsAufnahme wird sie auf einen anderen Namen ausgestellt -- so
// bekommt jeder Test, der wirklich eine Datei auf die Platte legt, seine eigene
// Wegwerf-Aufnahme und faellt keinem anderen ins Handwerk.
function freigabeMit(n, aufnahme = AUFNAHME, alsAufnahme = null) {
  const name = alsAufnahme === null ? aufnahme : alsAufnahme;
  const d = JSON.parse(freigabeText(aufnahme));
  const vorlage = d.freigaben.find((e) => e.freigegeben === true);
  d.aufnahme = name;
  d.freigaben = [];
  for (let i = 0; i < n; i++) {
    d.freigaben.push(Object.assign({}, vorlage, {
      sha256: crypto.createHash('sha256').update('probe-' + i).digest('hex'),
      kennung: name + '/p' + (i + 1),
      titel: 'Probe ' + (i + 1),
    }));
  }
  return JSON.stringify(d, null, 2) + '\n';
}

// Ein Gedaechtnis, wie der Uploader es schreibt, mit den ersten n Shorts aus
// freigabeMit darin. Die videoIds sind erfunden und ohne Bezug zu irgendeinem
// Kanal -- der Planer sieht sie nur darauf an, OB sie da sind, und traegt sie
// nirgends ein.
function gedaechtnisMit(n, aufnahme) {
  const uploads = [];
  for (let i = 0; i < n; i++) {
    uploads.push({
      sha256: crypto.createHash('sha256').update('probe-' + i).digest('hex'),
      kennung: aufnahme + '/p' + (i + 1),
      videoId: 'PROBE-ohne-Bezug-' + i,
      hochgeladen_am: '2026-09-01T' + String(8 + i).padStart(2, '0') + ':00:00.000Z',
      publish_at: '2026-09-01T' + String(8 + i).padStart(2, '0') + ':30:00.000Z',
      titel: 'Probe ' + (i + 1),
    });
  }
  return JSON.stringify({
    artifact_type: 'adw_shorts_uploads',
    schema_version: '1.0',
    aufnahme,
    plan_datei: 'data/plaene/' + aufnahme + '.json',
    // ABSICHTLICH die Pruefsumme eines Plans, den es nicht mehr gibt: genau so
    // sieht die Lage aus, wenn neu geplant wird. Der Planer darf daran nicht
    // haengenbleiben (siehe leseGedaechtnis).
    plan_sha256: crypto.createHash('sha256').update('ein-frueherer-plan').digest('hex'),
    angelegt_am: '2026-09-01T10:00:00.000Z',
    zuletzt_geschrieben_am: '2026-09-01T12:00:00.000Z',
    uploads,
  }, null, 2) + '\n';
}

function plane(isoJetzt, text = freigabeText(), aufnahme = AUFNAHME) {
  const t0 = Date.parse(isoJetzt);
  return P.planeAufnahme({
    aufnahme, freigabeText: text, planungszeitpunkt: t0, vorgegeben: true, jetzt: t0,
  });
}

// ---------------------------------------------------------------------------
// BAUART
// ---------------------------------------------------------------------------

test('pruefeArgumenteStrikt und pruefeKeineFreienArgumente stehen vor allem anderen', () => {
  const wo = (s) => NURCODE.indexOf(s);
  assert.ok(wo('pruefeArgumenteStrikt(process.argv') > 0);
  assert.ok(wo('pruefeKeineFreienArgumente(process.argv') > wo('pruefeArgumenteStrikt(process.argv'));
  // Erst danach darf ueberhaupt etwas gelesen oder geschrieben werden koennen.
  assert.ok(wo("require('fs')") > wo('pruefeKeineFreienArgumente(process.argv'),
    'require(fs) steht vor der Argumentpruefung');
  assert.ok(wo("require('path')") > wo('pruefeKeineFreienArgumente(process.argv'));
  assert.ok(wo("require('crypto')") > wo('pruefeKeineFreienArgumente(process.argv'));
});

test('pruefeKeineFreienArgumente wird importiert, nicht nachgebaut', () => {
  // EH: Geprueft wird, WAS geholt wird, nicht wie die Zeile umbricht. Vorher
  // stand hier die Liste als ein Stueck im Muster; als SHA256_FORM dazukam und
  // die Zeile mehrzeilig wurde, fiel der Test, obwohl die Zusage genau
  // eingehalten war. Ein Test, der an der Zeilenlaenge haengt, misst die
  // Zeilenlaenge.
  const block = NURCODE.match(/const \{[^}]*\} = require\('\.\/uebergabe-leser'\);/);
  assert.ok(block, 'der Planer laedt nichts aus ./uebergabe-leser');
  for (const name of ['pruefeKeineFreienArgumente', 'AUFNAHME_FORM', 'SHA256_FORM', 'EXIT']) {
    assert.ok(new RegExp('\\b' + name + '\\b').test(block[0]),
      name + ' wird nicht aus ./uebergabe-leser geholt:\n' + block[0]);
  }
  assert.ok(!/function pruefeKeineFreienArgumente/.test(NURCODE),
    'der Planer baut pruefeKeineFreienArgumente nach, statt sie zu importieren');
  assert.ok(!/const AUFNAHME_FORM\s*=/.test(NURCODE),
    'der Planer baut AUFNAHME_FORM nach, statt sie zu importieren');
  assert.ok(!/const SHA256_FORM\s*=/.test(NURCODE),
    'der Planer baut SHA256_FORM nach, statt sie zu importieren');
});

test('der Planer ruft nichts auf und geht nicht ins Netz', () => {
  for (const verboten of ['https', 'http', 'net', 'googleapis', 'child_process',
    'google-auth-library', 'dotenv']) {
    assert.ok(!new RegExp("require\\('" + verboten + "'\\)").test(NURCODE),
      'der Planer laedt ' + verboten);
  }
  assert.ok(!/spawnSync|execFileSync|execSync|spawn\(/.test(NURCODE),
    'der Planer startet einen Kindprozess');
  assert.ok(!/fetch\(/.test(NURCODE), 'der Planer macht einen Netzaufruf');
});

test('die Zeitzone ist fest verdrahtet und kommt nicht aus der Umgebung', () => {
  assert.equal(P.ZONE, 'Europe/Berlin');
  assert.ok(!/process\.env\.TZ/.test(NURCODE));
  assert.ok(!/process\.env/.test(NURCODE),
    'der Planer liest aus der Umgebung -- ein Plan darf davon nicht abhaengen');
});

test('npm-Skript shorts:planen zeigt auf den Planer', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(WURZEL, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['shorts:planen'], 'node src/upload/planer.js');
});

// ---------------------------------------------------------------------------
// DIE SPERRE
// ---------------------------------------------------------------------------

test('die Sperrliste prueft sich selbst und ist in Ordnung', () => {
  assert.deepEqual(P.pruefeSperrliste(), []);
  assert.ok(P.GESPERRTE_AUFNAHMEN.length >= 1);
});

test('die Sperrliste faellt auf, wenn ein Eintrag kaputt ist', () => {
  // Die Pruefung liest die echte Liste; hier wird sie kurz verbogen und
  // wiederhergestellt, damit der Test zeigt, dass die Pruefung wirklich sieht.
  const sicherung = P.GESPERRTE_AUFNAHMEN.slice();
  try {
    P.GESPERRTE_AUFNAHMEN.push({ aufnahme: 'kein Aufnahmename', grund: 'weil' });
    const f = P.pruefeSperrliste();
    assert.ok(f.some((x) => /Form JJJJ-MM-TT HH-MM-SS/.test(x)));
    assert.ok(f.some((x) => /keine brauchbare Begruendung/.test(x)));
  } finally {
    P.GESPERRTE_AUFNAHMEN.length = 0;
    for (const s of sicherung) P.GESPERRTE_AUFNAHMEN.push(s);
    assert.deepEqual(P.pruefeSperrliste(), []);
  }
});

test('die fehlerhafte Aufnahme 2026-08-29 18-18-19 ist gesperrt und wird nicht geplant', () => {
  const s = P.sperreFuer(GESPERRT);
  assert.ok(s, 'die Aufnahme steht nicht in der Sperrliste');
  assert.match(s.grund, /fehlerhaft geschnitten/);

  const e = P.planeAufnahme({
    aufnahme: GESPERRT, freigabeText: freigabeText(GESPERRT),
    planungszeitpunkt: Date.parse('2026-09-01T17:00:00+02:00'), jetzt: Date.now(),
  });
  assert.equal(e.plan, undefined, 'fuer eine gesperrte Aufnahme entsteht ein Plan');
  assert.equal(e.gesperrt.aufnahme, GESPERRT);
});

test('ihre Freigabedatei traegt acht freigegebene Eintraege und wird nicht geloescht', () => {
  const d = JSON.parse(freigabeText(GESPERRT));
  assert.equal(d.freigaben.filter((e) => e.freigegeben === true).length, 8,
    'die Testdatei der Sperre hat sich geaendert -- der Nachweis haengt daran');
});

test('die Sperre bricht den Aufruf ab, mit --execute genauso wie ohne', () => {
  for (const args of [[], ['--execute']]) {
    const r = spawnSync(process.execPath, [SKRIPT, '--freigabe=' + GESPERRT, ...args],
      { encoding: 'utf8' });
    assert.equal(r.status, P.EXIT_GESPERRT, 'Aufruf mit ' + JSON.stringify(args));
    assert.match(r.stderr, /GESPERRT/);
    assert.match(r.stderr, /fehlerhaft geschnitten/);
    assert.equal(r.stdout, '', 'die Sperre gibt trotzdem einen Plan aus');
  }
  assert.ok(!fs.existsSync(P.planPfad(WURZEL, GESPERRT)),
    'fuer die gesperrte Aufnahme liegt eine Planungsdatei');
});

// ---------------------------------------------------------------------------
// ZEITRECHNUNG GEGEN DIE ECHTEN UMSTELLUNGSTAGE
// ---------------------------------------------------------------------------

test('Sommerzeit: die Zone antwortet an den echten Umstellungstagen richtig', () => {
  // 29.03.2026: 02:00 wird zu 03:00. Die Stunde 02:00-02:59 gibt es nicht.
  assert.equal(P.versatzMinuten(Date.parse('2026-03-29T00:30:00Z')), 60);
  assert.equal(P.versatzMinuten(Date.parse('2026-03-29T01:30:00Z')), 120);
  assert.deepEqual(P.instantsFuerOrtszeit(2026, 3, 29, 2, 30), []);

  // 25.10.2026: 03:00 wird zu 02:00. Die Stunde 02:00-02:59 gibt es zweimal.
  assert.equal(P.versatzMinuten(Date.parse('2026-10-25T00:30:00Z')), 120);
  assert.equal(P.versatzMinuten(Date.parse('2026-10-25T01:30:00Z')), 60);
  assert.deepEqual(
    P.instantsFuerOrtszeit(2026, 10, 25, 2, 30).map((m) => new Date(m).toISOString()),
    ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
});

test('08:00 Ortszeit ist im Sommer 06:00 UTC und im Winter 07:00 UTC', () => {
  assert.equal(new Date(P.instantsFuerOrtszeit(2026, 3, 29, 8, 0)[0]).toISOString(),
    '2026-03-29T06:00:00.000Z');
  assert.equal(new Date(P.instantsFuerOrtszeit(2026, 3, 28, 8, 0)[0]).toISOString(),
    '2026-03-28T07:00:00.000Z');
  assert.equal(new Date(P.instantsFuerOrtszeit(2026, 10, 25, 8, 0)[0]).toISOString(),
    '2026-10-25T07:00:00.000Z');
  assert.equal(new Date(P.instantsFuerOrtszeit(2026, 10, 24, 8, 0)[0]).toISOString(),
    '2026-10-24T06:00:00.000Z');
});

test('an KEINEM Tag von 2026 fehlt 08:00 oder 20:00, und keiner hat sie doppelt', () => {
  // Das ist der Beleg dafuer, dass die beiden Sonderzweige in
  // nutzbareAbschnitte() in dieser Zone nie greifen -- geprueft, nicht behauptet.
  const fehlend = [];
  const doppelt = [];
  for (let monat = 1; monat <= 12; monat++) {
    for (let tag = 1; tag <= 31; tag++) {
      if (new Date(Date.UTC(2026, monat - 1, tag)).getUTCMonth() !== monat - 1) continue;
      for (const stunde of [8, 20]) {
        const l = P.instantsFuerOrtszeit(2026, monat, tag, stunde, 0);
        if (l.length === 0) fehlend.push(monat + '-' + tag + ' ' + stunde);
        if (l.length > 1) doppelt.push(monat + '-' + tag + ' ' + stunde);
      }
    }
  }
  assert.deepEqual(fehlend, []);
  assert.deepEqual(doppelt, []);
});

// ---------------------------------------------------------------------------
// DAS NUTZBARE FENSTER
// ---------------------------------------------------------------------------

function fenster(iso) {
  const r = P.nutzbareAbschnitte(Date.parse(iso));
  assert.deepEqual(r.probleme, []);
  return r.abschnitte.map((a) => a.datum + ' ' +
    P.ortszeitText(a.von).slice(11, 16) + '-' + P.ortszeitText(a.bis).slice(11, 16) +
    ' (' + Math.round((a.bis - a.von) / P.MINUTE_MS) + ')');
}

test('das Fenster bei den fuenf festen Planungszeitpunkten', () => {
  assert.deepEqual(fenster('2026-09-01T17:00:00+02:00'),
    ['2026-09-01 17:00-20:00 (180)', '2026-09-02 08:00-17:00 (540)']);
  assert.deepEqual(fenster('2026-09-01T09:00:00+02:00'),
    ['2026-09-01 09:00-20:00 (660)', '2026-09-02 08:00-09:00 (60)']);
  assert.deepEqual(fenster('2026-09-01T19:30:00+02:00'),
    ['2026-09-01 19:30-20:00 (30)', '2026-09-02 08:00-19:30 (690)']);
  // 23:00 liegt ausserhalb des Tagesfensters: die nutzbare Zeit beginnt am
  // naechsten Morgen um 08:00, das 24-Stunden-Fenster laeuft trotzdem ab 23:00.
  assert.deepEqual(fenster('2026-09-01T23:00:00+02:00'), ['2026-09-02 08:00-20:00 (720)']);
  // 07:00 liegt vor Fensterbeginn: heute 08:00-20:00, der Folgetag traegt nichts
  // bei (dort endet das 24-Stunden-Fenster schon um 07:00).
  assert.deepEqual(fenster('2026-09-01T07:00:00+02:00'), ['2026-09-01 08:00-20:00 (720)']);
});

test('ohne Zeitumstellung sind es immer genau 720 nutzbare Minuten', () => {
  for (let stunde = 0; stunde < 24; stunde++) {
    for (const minute of [0, 17, 43]) {
      const iso = '2026-09-01T' + String(stunde).padStart(2, '0') + ':' +
        String(minute).padStart(2, '0') + ':00+02:00';
      const r = P.nutzbareAbschnitte(Date.parse(iso));
      const summe = r.abschnitte.reduce((s, a) => s + (a.bis - a.von), 0) / P.MINUTE_MS;
      assert.equal(summe, 720, 'bei ' + iso + ' sind es ' + summe + ' Minuten');
    }
  }
});

test('Wochenenden zaehlen mit -- Samstag und Sonntag sind wie jeder Werktag', () => {
  // 2026-09-05 ist ein Samstag, 2026-09-06 ein Sonntag.
  assert.equal(new Date('2026-09-05T12:00:00Z').getUTCDay(), 6);
  assert.deepEqual(fenster('2026-09-05T17:00:00+02:00'),
    ['2026-09-05 17:00-20:00 (180)', '2026-09-06 08:00-17:00 (540)']);
  assert.ok(!/getDay|getUTCDay|Wochentag|Samstag|Sonntag|weekday/.test(NURCODE),
    'der Planer sieht auf den Wochentag -- er soll es nicht');
});

// ---------------------------------------------------------------------------
// DIE VERTEILUNG -- die Zusagen, jede einzeln geprueft
// ---------------------------------------------------------------------------

function pruefeZusagen(plan, isoJetzt) {
  const t0 = Date.parse(isoJetzt);
  const ende = t0 + P.VORLAUF_MS;
  let vorher = null;
  for (const t of plan.termine) {
    const ms = Date.parse(t.publish_at);
    assert.ok(ms > t0, t.publish_at + ' liegt nicht nach dem Planungszeitpunkt');
    assert.ok(ms - t0 >= P.MINUTE_MS, t.publish_at + ' liegt in derselben Minute wie die Planung');
    assert.ok(ms <= ende, t.publish_at + ' liegt spaeter als 24 Stunden nach der Planung');
    const min = P.ortsminuten(ms);
    assert.ok(min >= P.TAGESFENSTER_VON_MIN && min <= P.TAGESFENSTER_BIS_MIN,
      t.publish_at + ' = ' + t.publish_at_ortszeit + ' liegt ausserhalb 08:00-20:00');
    if (vorher !== null) assert.ok(ms > vorher, 'Termine nicht streng aufsteigend');
    vorher = ms;
    assert.equal(ms % P.MINUTE_MS, 0, 'Termin nicht auf die volle Minute gerundet');
    assert.equal(t.publish_at_ortszeit, P.ortszeitText(ms));
  }
}

test('die fuenf festen Planungszeitpunkte halten alle Zusagen', () => {
  for (const iso of ['2026-09-01T17:00:00+02:00', '2026-09-01T09:00:00+02:00',
    '2026-09-01T19:30:00+02:00', '2026-09-01T23:00:00+02:00', '2026-09-01T07:00:00+02:00']) {
    const e = plane(iso);
    assert.deepEqual(e.fehler, [], iso);
    assert.equal(e.plan.termine.length, 12);
    assert.equal(e.plan.freigaben_gesamt, 13);
    assert.equal(e.plan.freigaben_abgelehnt, 1, 'der abgelehnte Eintrag faellt nicht heraus');
    assert.equal(e.plan.fenster.nutzbare_minuten, 720);
    pruefeZusagen(e.plan, iso);
  }
});

test('zwoelf Shorts in zwoelf Stunden liegen rund eine Stunde auseinander', () => {
  const e = plane('2026-09-01T17:00:00+02:00');
  assert.equal(e.plan.fenster.abstand_minuten, 55.38); // 720 / 13
  const ms = e.plan.termine.map((t) => Date.parse(t.publish_at));
  // Die Nacht dazwischen ist keine Luecke der Verteilung -- der Abstand laeuft
  // ueber sie hinweg. Geprueft wird deshalb der Abstand IM Abschnitt.
  const innerhalb = [];
  for (let i = 1; i < ms.length; i++) {
    const d = (ms[i] - ms[i - 1]) / P.MINUTE_MS;
    if (d < 600) innerhalb.push(d);
  }
  for (const d of innerhalb) assert.ok(d >= 55 && d <= 56, 'Abstand ' + d + ' Minuten');
});

test('der erste Termin liegt einen vollen Abstand nach dem Planungszeitpunkt', () => {
  const iso = '2026-09-01T09:00:00+02:00';
  const e = plane(iso);
  const erster = Date.parse(e.plan.termine[0].publish_at);
  assert.equal((erster - Date.parse(iso)) / P.MINUTE_MS, 55);
});

test('eine Anzahl-Matrix haelt die Zusagen ueber viele Planungszeitpunkte', () => {
  for (const stunde of [0, 6, 7, 8, 12, 17, 19, 20, 23]) {
    for (const anzahl of [1, 2, 3, 12, 50, 200]) {
      const iso = '2026-09-01T' + String(stunde).padStart(2, '0') + ':30:00+02:00';
      const e = plane(iso, freigabeMit(anzahl));
      assert.deepEqual(e.fehler, [], iso + ' mit ' + anzahl);
      assert.equal(e.plan.termine.length, anzahl);
      pruefeZusagen(e.plan, iso);
    }
  }
});

test('Grenzfaelle bei der Anzahl: eins, zwei, fuenfzig', () => {
  const iso = '2026-09-01T17:00:00+02:00';
  const e1 = plane(iso, freigabeMit(1));
  assert.equal(e1.plan.termine.length, 1);
  assert.equal(e1.plan.fenster.abstand_minuten, 360); // 720/2 -- die Mitte
  const e2 = plane(iso, freigabeMit(2));
  assert.equal(e2.plan.fenster.abstand_minuten, 240); // 720/3
  const e50 = plane(iso, freigabeMit(50));
  assert.equal(e50.plan.fenster.abstand_minuten, 14.12); // 720/51
  for (const e of [e1, e2, e50]) pruefeZusagen(e.plan, iso);
});

test('es gibt keine erfundene Obergrenze -- die Grenze ist der Abstand von einer Minute', () => {
  const iso = '2026-09-01T17:00:00+02:00';
  // 719 passen: 720/720 = genau 1,000 Minuten Abstand.
  assert.deepEqual(plane(iso, freigabeMit(719)).fehler, []);
  // 720 passen nicht mehr: 720/721 = 0,999 Minuten -- zwei Termine faenden in
  // derselben Minute statt. Der Planer bricht ab, statt still zu runden.
  const zuviel = plane(iso, freigabeMit(720));
  assert.ok(zuviel.fehler.length > 0);
  assert.ok(zuviel.fehler.some((f) => /nicht in das nutzbare Fenster|weniger als eine Minute/.test(f)));
  assert.ok(!/MAX_SHORTS|OBERGRENZE|maxAnzahl/.test(NURCODE),
    'der Planer traegt eine erfundene Obergrenze');
});

// ---------------------------------------------------------------------------
// SOMMERZEIT IM PLAN
// ---------------------------------------------------------------------------

test('Vorstellung 28.03.2026: das 24-h-Fenster endet in Ortszeit eine Stunde spaeter', () => {
  const iso = '2026-03-28T18:00:00+01:00';
  const e = plane(iso);
  assert.deepEqual(e.fehler, []);
  assert.equal(e.plan.planungszeitpunkt, '2026-03-28T17:00:00.000Z');
  // 24 echte Stunden spaeter ist es in Deutschland 19:00, nicht 18:00 -- eine
  // Stunde ist an diesem Tag ausgefallen.
  assert.equal(e.plan.fenster.ende, '2026-03-29T17:00:00.000Z');
  assert.equal(e.plan.fenster.ende_ortszeit, '2026-03-29 19:00 (UTC+02:00)');
  assert.equal(e.plan.fenster.sommerzeitwechsel_im_fenster, true);
  // Und darum sind es 780 statt 720 nutzbare Minuten: 120 + 660.
  assert.deepEqual(e.plan.fenster.abschnitte.map((a) => a.minuten), [120, 660]);
  assert.equal(e.plan.fenster.nutzbare_minuten, 780);
  // 08:00 am 29.03. ist 06:00 UTC -- wer in UTC rechnete, laege eine Stunde daneben.
  assert.equal(e.plan.fenster.abschnitte[1].von, '2026-03-29T06:00:00.000Z');
  pruefeZusagen(e.plan, iso);
});

test('Rueckstellung 25.10.2026: das 24-h-Fenster endet in Ortszeit eine Stunde frueher', () => {
  const iso = '2026-10-24T18:00:00+02:00';
  const e = plane(iso);
  assert.deepEqual(e.fehler, []);
  assert.equal(e.plan.planungszeitpunkt, '2026-10-24T16:00:00.000Z');
  assert.equal(e.plan.fenster.ende, '2026-10-25T16:00:00.000Z');
  assert.equal(e.plan.fenster.ende_ortszeit, '2026-10-25 17:00 (UTC+01:00)');
  assert.equal(e.plan.fenster.sommerzeitwechsel_im_fenster, true);
  assert.deepEqual(e.plan.fenster.abschnitte.map((a) => a.minuten), [120, 540]);
  assert.equal(e.plan.fenster.nutzbare_minuten, 660);
  // 08:00 am 25.10. ist 07:00 UTC.
  assert.equal(e.plan.fenster.abschnitte[1].von, '2026-10-25T07:00:00.000Z');
  pruefeZusagen(e.plan, iso);
});

test('ueber beide Umstellungstage hinweg bleibt jeder Termin im Tagesfenster', () => {
  for (const tag of ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30',
    '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']) {
    for (let stunde = 0; stunde < 24; stunde++) {
      // Ortszeit ohne Versatz waere hier mehrdeutig; darum ueber UTC ansetzen.
      const t0 = Date.parse(tag + 'T' + String(stunde).padStart(2, '0') + ':07:00Z');
      const e = P.planeAufnahme({
        aufnahme: AUFNAHME, freigabeText: freigabeText(),
        planungszeitpunkt: t0, vorgegeben: true, jetzt: t0,
      });
      assert.deepEqual(e.fehler, [], tag + ' ' + stunde + ':07 UTC');
      pruefeZusagen(e.plan, new Date(t0).toISOString());
    }
  }
});

test('der 29.03.2026 wird nicht uebersprungen -- er ist in Ortszeit nur 23 Stunden lang', () => {
  // Der Fehler, den dieser Test festhaelt: die Tagesschleife lief einmal ueber
  // "Instant plus i mal 24 Stunden". Bei Planung am 28.03. um 23:07 Ortszeit
  // kamen dabei der 27., 28., 30. und 31. heraus -- der 29. fiel aus, und mit
  // ihm das einzige Tagesfenster im 24-Stunden-Fenster. Der Planer brach ab
  // ("keine nutzbare Zeit"), statt zu planen.
  const iso = '2026-03-28T23:07:00+01:00';
  assert.deepEqual(fenster(iso), ['2026-03-29 08:00-20:00 (720)']);
  const e = plane(iso);
  assert.deepEqual(e.fehler, []);
  assert.equal(e.plan.termine.length, 12);
  pruefeZusagen(e.plan, iso);
});

test('an JEDEM Tag von 2026 kommt zu jeder vollen Stunde ein Plan zustande', () => {
  // Der breite Beleg dafuer, dass die Tagesschleife nie einen Tag verliert und
  // die Nachpruefung nie anschlaegt -- 365 Tage mal drei Uhrzeiten.
  const text = freigabeText();
  let laeufe = 0;
  for (let tag = 0; tag < 365; tag++) {
    for (const stunde of [5, 12, 22]) {
      const t0 = Date.UTC(2026, 0, 1 + tag, stunde, 7, 0);
      const e = P.planeAufnahme({
        aufnahme: AUFNAHME, freigabeText: text, planungszeitpunkt: t0, vorgegeben: true, jetzt: t0,
      });
      assert.deepEqual(e.fehler, [], new Date(t0).toISOString());
      assert.equal(e.plan.termine.length, 12);
      laeufe++;
    }
  }
  assert.equal(laeufe, 1095);
});

// ---------------------------------------------------------------------------
// KEIN FREIGEGEBENER EINTRAG
// ---------------------------------------------------------------------------

test('ohne freigegebenen Eintrag entsteht kein Plan und keine leere Datei', () => {
  const d = JSON.parse(freigabeText());
  d.freigaben = d.freigaben.map((e) => Object.assign({}, e, { freigegeben: false }));
  const e = plane('2026-09-01T17:00:00+02:00', JSON.stringify(d, null, 2));
  assert.equal(e.plan, undefined);
  assert.equal(e.fehler.length, 1);
  assert.match(e.fehler[0], /kein Eintrag freigegeben/);
  assert.match(e.fehler[0], /nicht von einem abgearbeiteten Plan zu unterscheiden/);
});

test('auch eine leere Freigabeliste ergibt keinen Plan', () => {
  const d = JSON.parse(freigabeText());
  d.freigaben = [];
  const e = plane('2026-09-01T17:00:00+02:00', JSON.stringify(d, null, 2));
  assert.equal(e.plan, undefined);
  assert.equal(e.fehler.length, 1);
});

// ---------------------------------------------------------------------------
// DIE FREIGABEDATEI WIRD STRENG GELESEN
// ---------------------------------------------------------------------------

function mitAenderung(fn) {
  const d = JSON.parse(freigabeText());
  fn(d);
  return P.leseFreigabe(JSON.stringify(d, null, 2), AUFNAHME);
}

test('die echte Freigabedatei wird angenommen', () => {
  const r = P.leseFreigabe(freigabeText(), AUFNAHME);
  assert.deepEqual(r.fehler, []);
  assert.equal(r.eintraege.length, 13);
  assert.equal(r.eintraege.filter((e) => e.freigegeben === true).length, 12);
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
});

test('kein JSON, kein Objekt, falscher artifact_type', () => {
  assert.match(P.leseFreigabe('{kaputt', AUFNAHME).fehler[0], /kein JSON/);
  assert.match(P.leseFreigabe('[]', AUFNAHME).fehler[0], /kein Objekt/);
  assert.match(mitAenderung((d) => { d.artifact_type = 'etwas anderes'; }).fehler[0],
    /artifact_type/);
});

test('eine unbekannte schema_version wird abgelehnt, nicht mitgelesen', () => {
  const r = mitAenderung((d) => { d.schema_version = '2.0'; });
  assert.ok(r.fehler.some((f) => /schema_version/.test(f)));
  assert.equal(r.eintraege, undefined);
});

test('eine Datei fuer eine andere Aufnahme wird abgelehnt', () => {
  const r = mitAenderung((d) => { d.aufnahme = '2020-01-01 00-00-00'; });
  assert.ok(r.fehler.some((f) => /angefragt war/.test(f)));
});

test('doppelte sha256 werden abgelehnt -- sha256 ist der Schluessel des Plans', () => {
  const r = mitAenderung((d) => { d.freigaben[1].sha256 = d.freigaben[0].sha256; });
  assert.ok(r.fehler.some((f) => /ein zweites Mal/.test(f)));
});

test('freigegeben muss ein Wahrheitswert sein -- "true" als Text zaehlt nicht', () => {
  const r = mitAenderung((d) => { d.freigaben[0].freigegeben = 'true'; });
  assert.ok(r.fehler.some((f) => /kein Wahrheitswert/.test(f)));
});

test('ein freigegebener Eintrag ohne Titel wird abgelehnt', () => {
  const r = mitAenderung((d) => { d.freigaben[0].titel = '   '; });
  assert.ok(r.fehler.some((f) => /keinen Titel/.test(f)));
});

test('ein ABGELEHNTER Eintrag darf einen leeren Titel haben', () => {
  const r = mitAenderung((d) => {
    const abgelehnt = d.freigaben.find((e) => e.freigegeben === false);
    abgelehnt.titel = '';
  });
  assert.deepEqual(r.fehler, []);
});

// ---------------------------------------------------------------------------
// DIE PLANUNGSDATEI
// ---------------------------------------------------------------------------

test('der Kopf traegt alles, was ein Plan spaeter belegen muss', () => {
  const e = plane('2026-09-01T17:00:00+02:00');
  const p = e.plan;
  assert.equal(p.artifact_type, 'adw_shorts_plan');
  assert.equal(p.schema_version, '1.0');
  assert.equal(p.aufnahme, AUFNAHME);
  assert.match(p.erzeugt_am, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(p.planungszeitpunkt, '2026-09-01T15:00:00.000Z');
  assert.equal(p.zeitzone, 'Europe/Berlin');
  assert.equal(p.freigabe_sha256,
    crypto.createHash('sha256').update(freigabeText(), 'utf8').digest('hex'));
  assert.equal(p.fenster.vorlauf_stunden, 24);
  assert.equal(p.fenster.tagesfenster_von, '08:00');
  assert.equal(p.fenster.tagesfenster_bis, '20:00');
});

test('welches Zeitfeld verbindlich ist, steht in der Datei selbst', () => {
  const p = plane('2026-09-01T17:00:00+02:00').plan;
  assert.equal(p.verbindlich, 'publish_at');
  assert.match(p.hinweis_ortszeit, /publish_at ist der verbindliche Wert/);
  assert.match(p.hinweis_ortszeit, /von keinem Programm ausgewertet/);
});

test('publish_at ist RFC 3339 in UTC und geht so an die API', () => {
  const p = plane('2026-09-01T17:00:00+02:00').plan;
  for (const t of p.termine) {
    assert.match(t.publish_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    assert.equal(new Date(Date.parse(t.publish_at)).toISOString(), t.publish_at);
  }
});

test('je Eintrag stehen sha256, kennung, titel und beide Zeitfelder', () => {
  const p = plane('2026-09-01T17:00:00+02:00').plan;
  const quelle = JSON.parse(freigabeText()).freigaben.filter((e) => e.freigegeben === true);
  assert.equal(p.termine.length, quelle.length);
  p.termine.forEach((t, i) => {
    assert.deepEqual(Object.keys(t),
      ['sha256', 'kennung', 'titel', 'publish_at', 'publish_at_ortszeit']);
    // Die Reihenfolge der Freigabedatei bleibt erhalten -- der Planer sortiert nicht um.
    assert.equal(t.sha256, quelle[i].sha256);
    assert.equal(t.kennung, quelle[i].kennung);
    assert.equal(t.titel, quelle[i].titel);
  });
});

test('die Nachpruefung faellt an einem verbogenen Plan auf', () => {
  const t0 = Date.parse('2026-09-01T17:00:00+02:00');
  const p = plane('2026-09-01T17:00:00+02:00').plan;
  // Ein Termin um 06:00 Ortszeit -- genau der Fehler, den eine UTC-Rechnung macht.
  const kaputt = JSON.parse(JSON.stringify(p));
  kaputt.termine[3].publish_at = '2026-09-02T04:00:00.000Z';
  kaputt.termine[3].publish_at_ortszeit = P.ortszeitText(Date.parse('2026-09-02T04:00:00.000Z'));
  const f = P.pruefePlan(kaputt, t0);
  assert.ok(f.some((x) => /ausserhalb 08:00-20:00/.test(x)), f.join(' | '));

  // Ein Termin jenseits der 24 Stunden.
  const spaet = JSON.parse(JSON.stringify(p));
  spaet.termine[11].publish_at = '2026-09-02T17:00:00.000Z';
  spaet.termine[11].publish_at_ortszeit = P.ortszeitText(Date.parse('2026-09-02T17:00:00.000Z'));
  assert.ok(P.pruefePlan(spaet, t0).some((x) => /spaeter als 24 Stunden/.test(x)));

  // Eine Ortszeit, die nicht zum Zeitstempel passt.
  const luegt = JSON.parse(JSON.stringify(p));
  luegt.termine[0].publish_at_ortszeit = '2026-09-01 09:00 (UTC+02:00)';
  assert.ok(P.pruefePlan(luegt, t0).some((x) => /passt nicht zu publish_at/.test(x)));
});

test('geschrieben wird atomar und ohne Temporaerreste', () => {
  const verz = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dn-plan-'));
  try {
    const ziel = path.join(verz, 'unter', 'plan.json');
    const p = plane('2026-09-01T17:00:00+02:00').plan;
    const inhalt = P.schreibePlanAtomar(ziel, p);
    assert.equal(fs.readFileSync(ziel, 'utf8'), inhalt);
    assert.deepEqual(JSON.parse(inhalt), p);
    assert.deepEqual(fs.readdirSync(path.dirname(ziel)), ['plan.json'],
      'es liegt eine Temporaerdatei herum');
    assert.ok(inhalt.endsWith('\n'));
  } finally {
    fs.rmSync(verz, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// DER AUFRUF
// ---------------------------------------------------------------------------

test('unbekannte und freie Argumente brechen ab, bevor irgendetwas geschieht', () => {
  const faelle = [
    { args: ['--freigabe=' + AUFNAHME, '--nur-pruefen'], muster: /unbekannte\(s\) Argument/ },
    { args: ['--freigabe=2026-08-31', '17-36-21'], muster: /freie Argumente gibt es hier nicht/ },
    { args: [], muster: /--freigabe= fehlt/ },
    { args: ['--freigabe=../../etc/passwd'], muster: /nicht die Form/ },
    { args: ['--freigabe=' + AUFNAHME, '--jetzt=2026-09-01T17:00:00'], muster: /MIT Zonenversatz/ },
  ];
  for (const f of faelle) {
    const r = spawnSync(process.execPath, [SKRIPT, ...f.args], { encoding: 'utf8' });
    assert.equal(r.status, P.EXIT_AUFRUFFEHLER, JSON.stringify(f.args) + ': ' + r.stderr);
    assert.match(r.stderr, f.muster);
    assert.equal(r.stdout, '');
  }
});

test('Trockenlauf schreibt nichts, --execute schreibt, und ein Plan wird nie ersetzt', () => {
  // Eigene Wegwerf-Aufnahme, damit dieser Test keinen echten Plan anfasst.
  const probe = '2000-01-01 00-00-00';
  const freigabe = P.freigabePfad(WURZEL, probe);
  const ziel = P.planPfad(WURZEL, probe);
  assert.ok(!fs.existsSync(freigabe), 'die Wegwerf-Aufnahme gibt es schon');
  assert.ok(!fs.existsSync(ziel), 'fuer die Wegwerf-Aufnahme liegt schon ein Plan');
  const d = JSON.parse(freigabeMit(3));
  d.aufnahme = probe;
  d.freigaben.forEach((e, i) => { e.kennung = probe + '/p' + (i + 1); });
  fs.mkdirSync(path.dirname(freigabe), { recursive: true });
  fs.writeFileSync(freigabe, JSON.stringify(d, null, 2) + '\n', 'utf8');
  try {
    const jetzt = '--jetzt=2035-06-06T17:00:00+02:00';

    // 1. Trockenlauf: gibt aus, legt nichts an.
    const trocken = spawnSync(process.execPath, [SKRIPT, '--freigabe=' + probe, jetzt],
      { encoding: 'utf8' });
    assert.equal(trocken.status, P.EXIT_OK, trocken.stderr);
    assert.match(trocken.stdout, /TROCKENLAUF: es wurde NICHTS geschrieben/);
    assert.ok(!fs.existsSync(ziel), 'der Trockenlauf hat eine Datei angelegt');

    // 2. --execute: legt an.
    const scharf = spawnSync(process.execPath, [SKRIPT, '--freigabe=' + probe, jetzt, '--execute'],
      { encoding: 'utf8' });
    assert.equal(scharf.status, P.EXIT_OK, scharf.stderr);
    assert.match(scharf.stdout, /GESCHRIEBEN/);
    assert.ok(fs.existsSync(ziel));
    const vorher = fs.readFileSync(ziel, 'utf8');
    assert.equal(JSON.parse(vorher).termine.length, 3);

    // 3. Zweiter Lauf: bricht ab -- im Trockenlauf wie scharf -- und laesst
    //    die Datei Byte fuer Byte, wie sie war.
    for (const args of [[], ['--execute']]) {
      const zweiter = spawnSync(process.execPath,
        [SKRIPT, '--freigabe=' + probe, '--jetzt=2026-09-02T09:00:00+02:00', ...args],
        { encoding: 'utf8' });
      assert.equal(zweiter.status, P.EXIT_MANGEL, JSON.stringify(args));
      assert.match(zweiter.stderr, /gibt es schon einen Plan/);
      assert.match(zweiter.stderr, /wird nicht ueberschrieben/);
      assert.equal(fs.readFileSync(ziel, 'utf8'), vorher, 'der Plan wurde veraendert');
    }
    assert.deepEqual(fs.readdirSync(path.dirname(ziel)).filter((f) => f.startsWith('.')), [],
      'es liegt eine Temporaerdatei herum');
  } finally {
    fs.rmSync(freigabe, { force: true });
    fs.rmSync(ziel, { force: true });
  }
});

test('eine fehlende Freigabedatei bricht mit Code 1 ab', () => {
  const r = spawnSync(process.execPath, [SKRIPT, '--freigabe=2001-02-03 04-05-06'],
    { encoding: 'utf8' });
  assert.equal(r.status, P.EXIT_MANGEL);
  assert.match(r.stderr, /Freigabedatei nicht gefunden/);
});

test('die drei Abbruchgruende haben drei verschiedene Exit-Codes', () => {
  assert.equal(P.EXIT_OK, 0);
  assert.equal(P.EXIT_MANGEL, 1);
  assert.equal(P.EXIT_AUFRUFFEHLER, 2);
  assert.equal(P.EXIT_GESPERRT, 3);
});

test('die Ausgabe fuer Menschen zeigt zu jedem Termin die Ortszeit', () => {
  const p = plane('2026-09-01T17:00:00+02:00').plan;
  const text = P.formatiere(p);
  for (const t of p.termine) {
    assert.ok(text.includes(t.publish_at), t.publish_at + ' fehlt in der Ausgabe');
    assert.ok(text.includes(t.publish_at_ortszeit), t.publish_at_ortszeit + ' fehlt');
    assert.ok(text.includes(t.kennung));
  }
  assert.ok(text.includes('720 Minuten / (12 + 1) = 55.38 Minuten'),
    'die Summe steht nicht neben ihren Einzelposten');
});

// ---------------------------------------------------------------------------
// DOa: DER PLANER KENNT DAS GEDAECHTNIS
// ---------------------------------------------------------------------------
//
// Der gefaehrliche Fehler in diesem Abschnitt sieht harmlos aus: ein Plan mit
// zwoelf Terminen, obwohl drei der Shorts schon auf dem Kanal stehen. Er
// rechnet richtig, er liest sich richtig, und er laedt drei Videos ein zweites
// Mal hoch. Deshalb wird hier beides geprueft -- dass uebersprungen wird, UND
// dass die uebersprungenen einzeln benannt sind.

test('DOa: die Konstanten des Gedaechtnisses stimmen mit denen des Uploaders ueberein', () => {
  // Der Planer definiert sie ein zweites Mal, weil ein require zum Uploader
  // ein Ring waere (der Uploader laedt den Planer). Dieser Test ist der Ersatz
  // fuer das require: laufen die beiden Stellen auseinander, faellt es hier auf
  // und nicht daran, dass ein Gedaechtnis ploetzlich abgelehnt wird.
  const U = require('../src/upload/uploader.js');
  assert.equal(P.GEDAECHTNIS_ARTIFACT_TYPE, U.GEDAECHTNIS_ARTIFACT_TYPE);
  assert.ok(P.BEKANNTE_GEDAECHTNIS_VERSIONEN.includes(U.GEDAECHTNIS_SCHEMA_VERSION),
    'der Planer kennt die Fassung nicht, die der Uploader schreibt');
});

test('DOa: der Pfad des Gedaechtnisses wird aus der Form gebaut, nicht aus dem Text', () => {
  assert.equal(P.gedaechtnisPfad('/w', '2026-08-31 17-36-21'),
    path.join('/w', 'data', 'uploads', '2026-08-31 17-36-21.json'));
  for (const boese of ['../../etc/passwd', '2026-08-31/17-36-21', '2026-08-31',
    '2026-08-31 17-36-21.json', '2026-8-31 17-36-21', '']) {
    assert.throws(() => P.gedaechtnisPfad('/w', boese), /Form JJJJ-MM-TT HH-MM-SS/);
  }
});

test('DOa: drei im Gedaechtnis, zwoelf freigegeben -- neun Termine', () => {
  const e = P.planeAufnahme({
    aufnahme: AUFNAHME,
    freigabeText: freigabeMit(12),
    gedaechtnisText: gedaechtnisMit(3, AUFNAHME),
    planungszeitpunkt: Date.parse('2026-09-01T17:00:00+02:00'),
    vorgegeben: true, jetzt: Date.parse('2026-09-01T17:00:00+02:00'),
  });
  assert.deepEqual(e.fehler, []);
  assert.equal(e.plan.termine.length, 9);
  assert.equal(e.plan.freigaben_gesamt, 12);
  assert.equal(e.plan.freigaben_geplant, 9);
  assert.equal(e.plan.freigaben_uebersprungen, 3);
  assert.equal(e.plan.freigaben_abgelehnt, 0);

  // 1a: EINZELN genannt, mit Kennung und mit dem Hinweis, warum.
  assert.equal(e.plan.uebersprungen_hochgeladen.length, 3);
  e.plan.uebersprungen_hochgeladen.forEach((u, i) => {
    assert.equal(u.kennung, AUFNAHME + '/p' + (i + 1));
    assert.match(u.grund, /schon hochgeladen/);
    assert.match(u.sha256, /^[0-9a-f]{64}$/);
    assert.equal(u.titel, 'Probe ' + (i + 1));
  });

  // Und keiner von ihnen hat einen Termin bekommen.
  const uebersprungeneSummen = new Set(e.plan.uebersprungen_hochgeladen.map((u) => u.sha256));
  for (const t of e.plan.termine) {
    assert.ok(!uebersprungeneSummen.has(t.sha256),
      t.kennung + ' hat trotz Gedaechtnis einen Termin bekommen');
  }
  // Geplant sind die letzten neun -- p4 bis p12, in der Reihenfolge der Datei.
  assert.deepEqual(e.plan.termine.map((t) => t.kennung),
    Array.from({ length: 9 }, (_, i) => AUFNAHME + '/p' + (i + 4)));

  // Die neun verteilen sich ueber das GANZE Fenster, nicht ueber neun
  // Zwoelftel davon: der letzte Termin liegt nah am Fensterende.
  assert.equal(e.plan.fenster.nutzbare_minuten, 720);
  assert.equal(e.plan.fenster.abstand_minuten, 72);
});

test('DOa: die videoId aus dem Gedaechtnis kommt in keinen Plan', () => {
  const e = P.planeAufnahme({
    aufnahme: AUFNAHME,
    freigabeText: freigabeMit(12),
    gedaechtnisText: gedaechtnisMit(3, AUFNAHME),
    planungszeitpunkt: Date.parse('2026-09-01T17:00:00+02:00'),
    vorgegeben: true, jetzt: Date.parse('2026-09-01T17:00:00+02:00'),
  });
  const alsText = JSON.stringify(e.plan) + P.formatiere(e.plan);
  assert.ok(!/videoId|PROBE-ohne-Bezug/.test(alsText),
    'der Plan traegt eine videoId, die er nicht braucht');
  // Der Zeitpunkt darf mit -- er sagt einem Menschen, wann das passiert ist.
  assert.equal(e.plan.uebersprungen_hochgeladen[0].hochgeladen_am, '2026-09-01T08:00:00.000Z');
});

test('DOa: die Ausgabe fuer Menschen nennt die uebersprungenen einzeln', () => {
  const e = P.planeAufnahme({
    aufnahme: AUFNAHME,
    freigabeText: freigabeMit(12),
    gedaechtnisText: gedaechtnisMit(3, AUFNAHME),
    planungszeitpunkt: Date.parse('2026-09-01T17:00:00+02:00'),
    vorgegeben: true, jetzt: Date.parse('2026-09-01T17:00:00+02:00'),
  });
  const text = P.formatiere(e.plan);
  for (const u of e.plan.uebersprungen_hochgeladen) {
    assert.ok(text.includes(u.kennung), u.kennung + ' fehlt in der Ausgabe');
  }
  assert.match(text, /schon hochgeladen/);
  assert.match(text, /schon hochgeladen: 3/);
});

test('DOa: 1b -- der Kopf traegt die sha256 des Gedaechtnisses, das vorlag', () => {
  const g = gedaechtnisMit(3, AUFNAHME);
  const e = P.planeAufnahme({
    aufnahme: AUFNAHME, freigabeText: freigabeMit(12), gedaechtnisText: g,
    planungszeitpunkt: Date.parse('2026-09-01T17:00:00+02:00'),
    vorgegeben: true, jetzt: Date.parse('2026-09-01T17:00:00+02:00'),
  });
  assert.equal(e.plan.gedaechtnis_vorhanden, true);
  assert.equal(e.plan.gedaechtnis_sha256,
    crypto.createHash('sha256').update(g, 'utf8').digest('hex'));
  assert.equal(e.plan.gedaechtnis_datei, 'data/uploads/' + AUFNAHME + '.json');
  assert.match(e.plan.hinweis_gedaechtnis, /uebersprungen_hochgeladen/);
  assert.ok(P.formatiere(e.plan).includes(e.plan.gedaechtnis_sha256),
    'die sha256 des Gedaechtnisses steht nicht in der Ausgabe');
});

test('DOa: 1b -- ohne Gedaechtnis sagt der Kopf das ausdruecklich', () => {
  const e = P.planeAufnahme({
    aufnahme: AUFNAHME, freigabeText: freigabeMit(12),
    planungszeitpunkt: Date.parse('2026-09-01T17:00:00+02:00'),
    vorgegeben: true, jetzt: Date.parse('2026-09-01T17:00:00+02:00'),
  });
  assert.equal(e.plan.gedaechtnis_vorhanden, false);
  assert.equal(e.plan.gedaechtnis_sha256, null);
  assert.equal(e.plan.freigaben_uebersprungen, 0);
  assert.deepEqual(e.plan.uebersprungen_hochgeladen, []);
  assert.match(e.plan.hinweis_gedaechtnis, /KEIN Gedaechtnis/);
  assert.equal(e.plan.termine.length, 12);
  // Ein leeres Feld waere nicht dasselbe wie ein ausdruecklicher Satz: bei
  // einem fehlenden Feld weiss man nicht, ob nicht nachgesehen wurde.
  assert.ok(P.formatiere(e.plan).includes('gab es nicht'));
});

test('DOa: 1c -- steht alles im Gedaechtnis, entsteht KEIN Plan', () => {
  const e = P.planeAufnahme({
    aufnahme: AUFNAHME,
    freigabeText: freigabeMit(12),
    gedaechtnisText: gedaechtnisMit(12, AUFNAHME),
    planungszeitpunkt: Date.parse('2026-09-01T17:00:00+02:00'),
    vorgegeben: true, jetzt: Date.parse('2026-09-01T17:00:00+02:00'),
  });
  assert.deepEqual(e.fehler, []);
  assert.equal(e.plan, undefined, 'es ist doch ein Plan entstanden');
  assert.ok(e.alles_hochgeladen);
  assert.equal(e.alles_hochgeladen.freigegeben, 12);
  assert.equal(e.alles_hochgeladen.uebersprungen.length, 12);
  // Auch hier einzeln, nicht gezaehlt.
  e.alles_hochgeladen.uebersprungen.forEach((u, i) => {
    assert.equal(u.kennung, AUFNAHME + '/p' + (i + 1));
  });
});

test('DOa: der Planer bleibt an plan_sha256 nicht haengen', () => {
  // Der Uploader prueft plan_sha256 und muss das tun. Der Planer darf es NICHT:
  // beim Neuplanen gehoert das Gedaechtnis zwangslaeufig zu einem anderen Plan,
  // und mit dieser Pruefung koennte er nie etwas ueberspringen.
  const g = JSON.parse(gedaechtnisMit(3, AUFNAHME));
  g.plan_sha256 = crypto.createHash('sha256').update('ein voellig anderer plan').digest('hex');
  const e = P.planeAufnahme({
    aufnahme: AUFNAHME, freigabeText: freigabeMit(12),
    gedaechtnisText: JSON.stringify(g, null, 2),
    planungszeitpunkt: Date.parse('2026-09-01T17:00:00+02:00'),
    vorgegeben: true, jetzt: Date.parse('2026-09-01T17:00:00+02:00'),
  });
  assert.deepEqual(e.fehler, []);
  assert.equal(e.plan.termine.length, 9);
});

test('DOa: ein kaputtes Gedaechtnis wird abgelehnt, nicht uebergangen', () => {
  const t0 = Date.parse('2026-09-01T17:00:00+02:00');
  const mit = (text) => P.planeAufnahme({
    aufnahme: AUFNAHME, freigabeText: freigabeMit(12), gedaechtnisText: text,
    planungszeitpunkt: t0, vorgegeben: true, jetzt: t0,
  });
  const verbogen = (fn) => {
    const g = JSON.parse(gedaechtnisMit(3, AUFNAHME));
    fn(g);
    return mit(JSON.stringify(g, null, 2));
  };
  // Ein Gedaechtnis, das nicht gelesen werden kann, darf NICHT dazu fuehren,
  // dass einfach alles geplant wird. Das waere der stille Doppel-Upload.
  assert.match(mit('{kaputt').fehler[0], /kein JSON/);
  assert.match(mit('[]').fehler[0], /kein Objekt/);
  assert.match(mit('').fehler[0], /kein JSON/);
  assert.ok(verbogen((g) => { g.artifact_type = 'etwas anderes'; })
    .fehler.some((f) => /artifact_type/.test(f)));
  assert.ok(verbogen((g) => { g.schema_version = '2.0'; })
    .fehler.some((f) => /schema_version/.test(f)));
  assert.ok(verbogen((g) => { g.aufnahme = '2020-01-01 00-00-00'; })
    .fehler.some((f) => /geplant wird/.test(f)));
  assert.ok(verbogen((g) => { g.uploads = 'keine Liste'; })
    .fehler.some((f) => /uploads ist keine Liste/.test(f)));
  assert.ok(verbogen((g) => { delete g.uploads[1].videoId; })
    .fehler.some((f) => /keine videoId/.test(f)));
  assert.ok(verbogen((g) => { g.uploads[1].sha256 = 'zu kurz'; })
    .fehler.some((f) => /keine sha256-Summe/.test(f)));
  assert.ok(verbogen((g) => { g.uploads[1].sha256 = g.uploads[0].sha256; })
    .fehler.some((f) => /ein zweites Mal/.test(f)));
  // In keinem dieser Faelle entsteht ein Plan.
  assert.equal(mit('{kaputt').plan, undefined);
});

test('DOa: die Nachpruefung faellt auf, wenn ein uebersprungener doch einen Termin hat', () => {
  const t0 = Date.parse('2026-09-01T17:00:00+02:00');
  const e = P.planeAufnahme({
    aufnahme: AUFNAHME, freigabeText: freigabeMit(12),
    gedaechtnisText: gedaechtnisMit(3, AUFNAHME),
    planungszeitpunkt: t0, vorgegeben: true, jetzt: t0,
  });
  const hochgeladen = new Map();
  for (const u of e.plan.uebersprungen_hochgeladen) hochgeladen.set(u.sha256, u);
  // Sauber: die Nachpruefung schweigt.
  assert.deepEqual(P.pruefePlan(e.plan, t0, hochgeladen), []);
  // Verbogen: ein Termin traegt eine sha256 aus dem Gedaechtnis.
  const kaputt = JSON.parse(JSON.stringify(e.plan));
  kaputt.termine[0].sha256 = e.plan.uebersprungen_hochgeladen[0].sha256;
  assert.ok(P.pruefePlan(kaputt, t0, hochgeladen)
    .some((x) => /zweiter Upload/.test(x)));
  // Und die Rechnung muss aufgehen.
  const zaehlt = JSON.parse(JSON.stringify(e.plan));
  zaehlt.freigaben_uebersprungen = 1;
  assert.ok(P.pruefePlan(zaehlt, t0).some((x) => /Rechnung geht nicht auf/.test(x)));
});

test('DOa: der Planer schreibt nie in data/freigaben', () => {
  // 1d in Zahlen: es gibt in diesem Programm keinen Schreibzugriff, der auf die
  // Freigabedatei zeigen koennte. Der einzige Schreibweg ist schreibePlanAtomar,
  // und der bekommt seinen Pfad aus planPfad.
  const schreibend = /writeFileSync|appendFileSync|createWriteStream|unlinkSync|renameSync|rmSync/g;
  const zeilen = NURCODE.split('\n');
  for (const z of zeilen) {
    if (!schreibend.test(z)) { schreibend.lastIndex = 0; continue; }
    schreibend.lastIndex = 0;
    assert.ok(!/freigabe/i.test(z),
      'eine schreibende Zeile nennt die Freigabe: ' + z.trim());
  }
  // freigabePfad wird an genau EINER Stelle aufgerufen, und der Pfad, den es
  // liefert, geht von dort nach readFileSync. Ein zweiter Aufrufer waere die
  // Stelle, an der ein Vermerk in die Freigabedatei kaeme.
  const alle = NURCODE.split('freigabePfad(').length - 1;
  const definitionen = NURCODE.split('function freigabePfad(').length - 1;
  assert.equal(definitionen, 1);
  assert.equal(alle - definitionen, 1, 'freigabePfad wird an mehr als einer Stelle benutzt');
  assert.match(NURCODE, /const quelle = freigabePfad\(projektwurzel, aufnahme\);/);
  assert.match(NURCODE, /freigabeText = fs\.readFileSync\(quelle, 'utf8'\);/);
});

test('DOa: der Kommentar zu 1d steht im Quelltext, nicht nur im Bericht', () => {
  assert.match(QUELLTEXT, /Protokoll eines menschlichen Urteils/);
  assert.match(QUELLTEXT, /faelscht das Urteil/);
  assert.match(QUELLTEXT, /data\/uploads\/<aufnahme>\.json/);
});

// ---------------------------------------------------------------------------
// DOa: DIESELBE SACHE UEBER DIE BEFEHLSZEILE
// ---------------------------------------------------------------------------
//
// Die Tests oben gehen an planeAufnahme vorbei an der Platte vorbei. Hier
// laeuft das Programm wirklich, mit Dateien, die dieser Test selbst anlegt und
// wieder wegraeumt.

// DS: fremde ist eine Liste [{aufnahme, termine:[iso...]}]. Diese
// Gedaechtnisdateien gehoeren NICHT zur geplanten Aufnahme -- sie sind der
// Grund, warum es DS gibt: der Planer muss sie trotzdem sehen. Sie werden
// angelegt und im finally wieder weggeraeumt, wie alles andere hier auch.
function mitProbe(name, n, gedaechtnisEintraege, fn, fremde = []) {
  const freigabe = P.freigabePfad(WURZEL, name);
  const plan = P.planPfad(WURZEL, name);
  const ged = P.gedaechtnisPfad(WURZEL, name);
  assert.ok(!fs.existsSync(freigabe), 'die Wegwerf-Aufnahme gibt es schon: ' + freigabe);
  assert.ok(!fs.existsSync(plan), 'fuer die Wegwerf-Aufnahme liegt schon ein Plan');
  assert.ok(!fs.existsSync(ged), 'fuer die Wegwerf-Aufnahme liegt schon ein Gedaechtnis');
  fs.mkdirSync(path.dirname(freigabe), { recursive: true });
  fs.writeFileSync(freigabe, freigabeMit(n, AUFNAHME, name), 'utf8');
  if (gedaechtnisEintraege > 0) {
    fs.mkdirSync(path.dirname(ged), { recursive: true });
    fs.writeFileSync(ged, gedaechtnisMit(gedaechtnisEintraege, name), 'utf8');
  }
  const fremdePfade = [];
  for (const f of fremde) {
    const p = P.gedaechtnisPfad(WURZEL, f.aufnahme);
    assert.ok(!fs.existsSync(p), 'die fremde Wegwerf-Aufnahme gibt es schon: ' + p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.text !== undefined ? f.text : gedaechtnisDatei(f.aufnahme, f.termine).text,
      'utf8');
    fremdePfade.push(p);
  }
  const vorher = fs.readFileSync(freigabe, 'utf8');
  try {
    fn({ freigabe, plan, ged, fremdePfade });
    // 1d, gemessen: die Freigabedatei ist nach jedem Lauf Byte fuer Byte die
    // alte. Das ist die einzige Pruefung, die einen stillen Vermerk faende.
    assert.equal(fs.readFileSync(freigabe, 'utf8'), vorher,
      'die Freigabedatei wurde veraendert');
  } finally {
    fs.rmSync(freigabe, { force: true });
    fs.rmSync(plan, { force: true });
    fs.rmSync(ged, { force: true });
    for (const p of fremdePfade) fs.rmSync(p, { force: true });
  }
}

test('DOa (CLI): drei im Gedaechtnis -- neun Termine, drei einzeln genannt', () => {
  mitProbe('2000-04-04 04-04-04', 12, 3, ({ plan }) => {
    const r = spawnSync(process.execPath,
      [SKRIPT, '--freigabe=2000-04-04 04-04-04', '--jetzt=2035-06-06T17:00:00+02:00', '--execute'],
      { encoding: 'utf8' });
    assert.equal(r.status, P.EXIT_OK, r.stderr);
    const d = JSON.parse(fs.readFileSync(plan, 'utf8'));
    assert.equal(d.termine.length, 9);
    assert.equal(d.freigaben_uebersprungen, 3);
    assert.equal(d.gedaechtnis_vorhanden, true);
    assert.match(d.gedaechtnis_sha256, /^[0-9a-f]{64}$/);
    for (let i = 1; i <= 3; i++) {
      assert.ok(r.stdout.includes('2000-04-04 04-04-04/p' + i),
        'p' + i + ' wird nicht einzeln genannt');
    }
    assert.ok(!/videoId|PROBE-ohne-Bezug/.test(r.stdout + fs.readFileSync(plan, 'utf8')));
  });
});

test('DOa (CLI): alles im Gedaechtnis -- kein Plan, keine leere Datei, Klartext', () => {
  mitProbe('2000-05-05 05-05-05', 12, 12, ({ plan }) => {
    for (const args of [[], ['--execute']]) {
      const r = spawnSync(process.execPath,
        [SKRIPT, '--freigabe=2000-05-05 05-05-05', '--jetzt=2035-06-06T17:00:00+02:00', ...args],
        { encoding: 'utf8' });
      assert.equal(r.status, P.EXIT_MANGEL, JSON.stringify(args) + ': ' + r.stdout + r.stderr);
      assert.match(r.stdout, /KEIN PLAN: alle freigegebenen Shorts/);
      assert.ok(!fs.existsSync(plan), 'es ist doch eine Planungsdatei entstanden');
      // Auch keine leere, auch keine Temporaerdatei.
      assert.deepEqual(fs.readdirSync(path.dirname(plan))
        .filter((f) => f.startsWith('2000-05-05') || f.startsWith('.2000-05-05')), []);
      for (let i = 1; i <= 12; i++) {
        assert.ok(r.stdout.includes('2000-05-05 05-05-05/p' + i),
          'p' + i + ' wird nicht einzeln genannt');
      }
    }
  });
});

test('DOa (CLI): ohne Gedaechtnis bleibt alles, wie es war', () => {
  mitProbe('2000-06-06 06-06-06', 12, 0, ({ plan }) => {
    const r = spawnSync(process.execPath,
      [SKRIPT, '--freigabe=2000-06-06 06-06-06', '--jetzt=2035-06-06T17:00:00+02:00', '--execute'],
      { encoding: 'utf8' });
    assert.equal(r.status, P.EXIT_OK, r.stderr);
    const d = JSON.parse(fs.readFileSync(plan, 'utf8'));
    assert.equal(d.termine.length, 12);
    assert.equal(d.freigaben_uebersprungen, 0);
    assert.equal(d.gedaechtnis_vorhanden, false);
    assert.equal(d.gedaechtnis_sha256, null);
    assert.equal(d.fenster.abstand_minuten, 55.38);
  });
});


// ---------------------------------------------------------------------------
// DS: DER ANSCHLUSS -- DER PLANER KENNT ALLE AUSSTEHENDEN TERMINE
// ---------------------------------------------------------------------------
//
// Der Fehler, gegen den dieser Abschnitt steht, sieht aus wie ein richtiger
// Plan: zwoelf Zeilen, aufsteigende Uhrzeiten, plausible Abstaende -- und er
// legt sich ueber Termine, die auf dem Kanal schon vergeben sind. Geprueft wird
// deshalb beides: DASS angeschlossen wird, und dass ohne ausstehende Termine
// nichts anders ist als vorher.

// Eine Gedaechtnisdatei einer beliebigen Aufnahme, in der Form, die
// leseGedaechtnisverzeichnis liefert. Die videoIds sind erfunden und ohne
// Bezug zu irgendeinem Kanal.
function gedaechtnisDatei(aufnahme, termine) {
  const uploads = termine.map((iso, i) => ({
    sha256: crypto.createHash('sha256').update(aufnahme + '#' + i).digest('hex'),
    kennung: aufnahme + '/t' + (i + 1),
    videoId: 'PROBE-ohne-Bezug-' + i,
    hochgeladen_am: '2026-09-01T10:00:00.000Z',
    publish_at: iso,
    titel: 'Probe ' + (i + 1),
  }));
  const text = JSON.stringify({
    artifact_type: 'adw_shorts_uploads',
    schema_version: '1.0',
    aufnahme,
    plan_datei: 'data/plaene/' + aufnahme + '.json',
    plan_sha256: crypto.createHash('sha256').update('plan#' + aufnahme).digest('hex'),
    angelegt_am: '2026-09-01T10:00:00.000Z',
    zuletzt_geschrieben_am: '2026-09-01T12:00:00.000Z',
    uploads,
  }, null, 2) + '\n';
  return {
    aufnahme,
    datei: 'data/uploads/' + aufnahme + '.json',
    pfad: path.join(WURZEL, 'data', 'uploads', aufnahme + '.json'),
    text,
  };
}

// Die zwoelf Termine, die am 02.09.2026 wirklich auf dem Kanal standen -- die
// Lage, an der DS gemessen wurde. Sie stehen hier als Zahlen und nicht als
// Verweis auf data/uploads: dieser Test soll in einem Jahr noch dasselbe
// messen, auch wenn dort laengst etwas anderes liegt.
const ECHTE_LAGE = [
  '2026-09-02T10:48:00.000Z', '2026-09-02T11:43:00.000Z', '2026-09-02T12:39:00.000Z',
  '2026-09-02T13:34:00.000Z', '2026-09-02T14:30:00.000Z', '2026-09-02T15:25:00.000Z',
  '2026-09-02T16:20:00.000Z', '2026-09-02T17:16:00.000Z', '2026-09-03T06:11:00.000Z',
  '2026-09-03T07:07:00.000Z', '2026-09-03T08:02:00.000Z', '2026-09-03T08:57:00.000Z',
];

test('DS: der Startpunkt ist das spaetere von jetzt und dem letzten ausstehenden Termin', () => {
  const jetzt = Date.parse('2026-09-02T16:44:00+02:00');   // = 14:44 UTC
  const dateien = [gedaechtnisDatei('2026-08-31 17-36-21', ECHTE_LAGE)];
  const g = P.sammleAusstehende(dateien, jetzt);
  assert.deepEqual(g.fehler, []);
  assert.equal(g.termine_gesamt, 12, 'nicht alle Termine wurden angesehen');
  // Fuenf liegen vor 14:44 UTC -- die sind veroeffentlicht und zaehlen nicht.
  assert.equal(g.ausstehend.length, 7);
  assert.equal(g.ausstehend[0].publish_at, '2026-09-02T15:25:00.000Z');
  assert.equal(g.ausstehend[6].publish_at, '2026-09-03T08:57:00.000Z');
  // Und sie sind aufsteigend sortiert, egal wie sie in der Datei standen.
  for (let i = 1; i < g.ausstehend.length; i++) {
    assert.ok(g.ausstehend[i].ms > g.ausstehend[i - 1].ms);
  }

  const st = P.bestimmeStartpunkt(jetzt, g.ausstehend);
  assert.equal(st.grund, 'ausstehender_termin');
  assert.equal(new Date(st.startpunkt).toISOString(), '2026-09-03T08:57:00.000Z');
  assert.equal(st.anker.aufnahme, '2026-08-31 17-36-21');
  assert.equal(st.anker.kennung, '2026-08-31 17-36-21/t12');
});

test('DS: N1 -- kein neuer Termin liegt vor dem letzten alten, und der Abstand ist derselbe', () => {
  const jetzt = Date.parse('2026-09-02T16:44:00+02:00');
  const dateien = [gedaechtnisDatei('2026-08-31 17-36-21', ECHTE_LAGE)];
  const g = P.sammleAusstehende(dateien, jetzt);
  const e = P.planeAufnahme({
    aufnahme: '2026-09-02 12-10-37',
    freigabeText: freigabeText('2026-09-02 12-10-37'),
    planungszeitpunkt: jetzt, vorgegeben: true, jetzt,
    ausstehende: g.ausstehend,
    gedaechtnisdateien: dateien.map((d) => d.datei),
  });
  assert.deepEqual(e.fehler, [], 'der Plan kam nicht zustande');
  const p = e.plan;

  // Neun freigegebene Shorts -- nicht zehn. Steht die Zahl hier falsch, ist
  // jede Erwartung an Abstand und Uhrzeit unten ebenfalls falsch.
  assert.equal(p.freigaben_geplant, 9);

  const anker = Date.parse('2026-09-03T08:57:00.000Z');
  assert.equal(Date.parse(p.fenster.beginn), anker);
  assert.equal(Date.parse(p.fenster.ende), anker + P.VORLAUF_MS);
  assert.equal(p.fenster.nutzbare_minuten, 720);
  assert.equal(p.fenster.abstand_minuten, 72);          // 720 / (9 + 1)

  // KEIN Termin liegt vor dem letzten ausstehenden.
  for (const t of p.termine) {
    assert.ok(Date.parse(t.publish_at) > anker,
      t.kennung + ' liegt nicht nach dem letzten ausstehenden Termin');
  }
  // Und der Abstand ueber die Naht ist derselbe wie im Plan.
  const schritte = [Date.parse(p.termine[0].publish_at) - anker];
  for (let i = 1; i < p.termine.length; i++) {
    schritte.push(Date.parse(p.termine[i].publish_at) - Date.parse(p.termine[i - 1].publish_at));
  }
  // Innerhalb eines Abschnitts sind es 72 Minuten; ueber die Nacht hinweg ist
  // die Uhrzeit groesser, die NUTZBARE Zeit aber dieselbe. Geprueft wird
  // deshalb: jeder Schritt ist mindestens 72 Minuten, und der ueber die Naht
  // ist genau 72 -- der Anker liegt im Tagesfenster.
  assert.equal(schritte[0], 72 * P.MINUTE_MS);
  for (const sch of schritte) assert.ok(sch >= 72 * P.MINUTE_MS);

  // Der Kopf sagt, woran angeschlossen wurde -- ohne dass jemand nachrechnet.
  assert.equal(p.anschluss.grund, 'ausstehender_termin');
  assert.equal(p.anschluss.ausstehende_termine_gesamt, 7);
  assert.equal(p.anschluss.ausstehende_termine.length, 7);
  assert.equal(p.anschluss.letzter_ausstehender.aufnahme, '2026-08-31 17-36-21');
  assert.equal(p.anschluss.letzter_ausstehender.publish_at, '2026-09-03T08:57:00.000Z');
  assert.deepEqual(p.anschluss.gelesene_gedaechtnisdateien,
    ['data/uploads/2026-08-31 17-36-21.json']);
  // Und keine videoId, nirgends.
  assert.ok(!/videoId|PROBE-ohne-Bezug/.test(JSON.stringify(p) + P.formatiere(p)));
});

test('DS: N2 -- ohne ausstehende Termine bleibt der Plan der von DN', () => {
  const e = plane('2026-09-01T17:00:00+02:00');
  const p = e.plan;
  assert.equal(p.anschluss.grund, 'jetzt');
  assert.equal(p.anschluss.letzter_ausstehender, null);
  assert.equal(p.anschluss.ausstehende_termine_gesamt, 0);
  assert.deepEqual(p.anschluss.ausstehende_termine, []);
  assert.equal(p.fenster.beginn, p.planungszeitpunkt);
  assert.equal(p.fenster.nutzbare_minuten, 720);
  assert.equal(p.fenster.abstand_minuten, 55.38);
  // Die zwoelf Zeitstempel, die DN gerechnet hat -- ausgeschrieben, damit der
  // Vergleich nicht an derselben Rechnung haengt, die er pruefen soll.
  assert.deepEqual(p.termine.map((t) => t.publish_at), [
    '2026-09-01T15:55:00.000Z', '2026-09-01T16:50:00.000Z', '2026-09-01T17:46:00.000Z',
    '2026-09-02T06:41:00.000Z', '2026-09-02T07:36:00.000Z', '2026-09-02T08:32:00.000Z',
    '2026-09-02T09:27:00.000Z', '2026-09-02T10:23:00.000Z', '2026-09-02T11:18:00.000Z',
    '2026-09-02T12:13:00.000Z', '2026-09-02T13:09:00.000Z', '2026-09-02T14:04:00.000Z',
  ]);
});

test('DS: N3 -- liegen alle Termine in der Vergangenheit, ist der Startpunkt jetzt', () => {
  const jetzt = Date.parse('2026-09-10T17:00:00+02:00');
  const dateien = [gedaechtnisDatei('2026-08-31 17-36-21', ECHTE_LAGE)];
  const g = P.sammleAusstehende(dateien, jetzt);
  assert.deepEqual(g.fehler, []);
  assert.equal(g.termine_gesamt, 12);
  assert.deepEqual(g.ausstehend, [], 'ein vergangener Termin gilt als ausstehend');

  const st = P.bestimmeStartpunkt(jetzt, g.ausstehend);
  assert.equal(st.grund, 'jetzt');
  assert.equal(st.startpunkt, jetzt);
  assert.equal(st.anker, null);

  // Der Plan ist derselbe wie ohne jedes Gedaechtnis -- nicht der, der beim
  // letzten VERGANGENEN Termin ansetzt.
  const felder = { aufnahme: AUFNAHME, freigabeText: freigabeText(),
    planungszeitpunkt: jetzt, vorgegeben: true, jetzt };
  const mit = P.planeAufnahme(Object.assign({}, felder, {
    ausstehende: g.ausstehend, gedaechtnisdateien: dateien.map((d) => d.datei) }));
  const ohne = P.planeAufnahme(felder);
  assert.deepEqual(mit.plan.termine, ohne.plan.termine);
  assert.equal(mit.plan.fenster.beginn, new Date(jetzt).toISOString());
});

test('DS: N4 -- ein ausstehender Termin um 23:30 zieht das Fenster auf 23:30', () => {
  const jetzt = Date.parse('2026-09-02T16:00:00+02:00');
  // 23:30 Ortszeit im Sommer = 21:30 UTC.
  const dateien = [gedaechtnisDatei('2026-08-30 12-00-00', ['2026-09-02T21:30:00.000Z'])];
  const g = P.sammleAusstehende(dateien, jetzt);
  assert.equal(g.ausstehend.length, 1);
  assert.equal(g.ausstehend[0].publish_at_ortszeit, '2026-09-02 23:30 (UTC+02:00)');

  const e = P.planeAufnahme({
    aufnahme: AUFNAHME, freigabeText: freigabeMit(6),
    planungszeitpunkt: jetzt, vorgegeben: true, jetzt,
    ausstehende: g.ausstehend, gedaechtnisdateien: dateien.map((d) => d.datei),
  });
  assert.deepEqual(e.fehler, []);
  const p = e.plan;
  // Das 24-Stunden-Fenster laeuft ab 23:30 -- nicht ab dem naechsten Morgen.
  assert.equal(p.fenster.beginn, '2026-09-02T21:30:00.000Z');
  assert.equal(p.fenster.ende, '2026-09-03T21:30:00.000Z');
  // Nutzbar ist davon nur der 03.09., 08:00 bis 20:00.
  assert.deepEqual(p.fenster.abschnitte.map((a) => a.datum), ['2026-09-03']);
  assert.equal(p.fenster.abschnitte[0].von_ortszeit.slice(11, 16), '08:00');
  assert.equal(p.fenster.abschnitte[0].bis_ortszeit.slice(11, 16), '20:00');
  assert.equal(p.fenster.nutzbare_minuten, 720);
  // Und kein Termin faellt in die Nacht.
  for (const t of p.termine) {
    const min = P.ortsminuten(Date.parse(t.publish_at));
    assert.ok(min >= P.TAGESFENSTER_VON_MIN && min <= P.TAGESFENSTER_BIS_MIN,
      t.publish_at_ortszeit + ' liegt ausserhalb des Tagesfensters');
  }
});

test('DS: N5 -- eine unlesbare Gedaechtnisdatei bricht ab, mit Nennung der Datei', () => {
  const jetzt = Date.parse('2026-09-02T16:44:00+02:00');
  const gut = gedaechtnisDatei('2026-08-31 17-36-21', ECHTE_LAGE);
  const kaputt = { aufnahme: '2026-08-30 12-00-00',
    datei: 'data/uploads/2026-08-30 12-00-00.json',
    pfad: '/w/data/uploads/2026-08-30 12-00-00.json', text: '{kaputt' };
  const g = P.sammleAusstehende([gut, kaputt], jetzt);
  assert.ok(g.fehler.length >= 1, 'eine kaputte Datei wurde uebergangen');
  assert.ok(g.fehler[0].startsWith('data/uploads/2026-08-30 12-00-00.json -- '),
    'die Meldung nennt die Datei nicht: ' + g.fehler[0]);
  assert.match(g.fehler[0], /kein JSON/);
  // Und es kommt KEINE Liste ausstehender Termine heraus, die dann nach
  // "nichts ausstehend" aussaehe.
  assert.equal(g.ausstehend, undefined);

  // Ein Eintrag ohne publish_at ist genauso wenig lesbar: ohne ihn ist nicht zu
  // sagen, ob dieser Upload noch aussteht.
  const ohneZeit = JSON.parse(gut.text);
  delete ohneZeit.uploads[3].publish_at;
  const g2 = P.sammleAusstehende(
    [Object.assign({}, gut, { text: JSON.stringify(ohneZeit) })], jetzt);
  assert.ok(g2.fehler.some((f) => /publish_at ist kein Zeitstempel/.test(f)), g2.fehler.join(' | '));

  // Auf der Platte: eine Datei, die sich nicht lesen laesst (hier ein
  // Verzeichnis mit dem Namen einer Gedaechtnisdatei -- EISDIR).
  const verz = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ds-uploads-'));
  try {
    fs.mkdirSync(path.join(verz, '2026-01-01 00-00-00.json'));
    const v = P.leseGedaechtnisverzeichnis(verz);
    assert.equal(v.dateien, undefined);
    assert.equal(v.fehler.length, 1);
    assert.match(v.fehler[0], /2026-01-01 00-00-00\.json/);
    assert.match(v.fehler[0], /nicht lesbar \(EISDIR\)/);

    // Eine .json-Datei, deren Name keine Aufnahme ist, wird ebenfalls nicht
    // uebergangen -- es koennte ein Gedaechtnis darin stehen.
    fs.rmSync(path.join(verz, '2026-01-01 00-00-00.json'), { recursive: true });
    fs.writeFileSync(path.join(verz, 'notizen.json'), '{}', 'utf8');
    const v2 = P.leseGedaechtnisverzeichnis(verz);
    assert.equal(v2.dateien, undefined);
    assert.match(v2.fehler[0], /notizen\.json/);
    assert.match(v2.fehler[0], /nicht die Form/);

    // Was nicht auf .json endet, wird uebergangen: so heissen die
    // Temporaerdateien des atomaren Schreibens.
    fs.rmSync(path.join(verz, 'notizen.json'));
    fs.writeFileSync(path.join(verz, '.2026-01-01 00-00-00.json.tmp.4711.1'), 'halb', 'utf8');
    const v3 = P.leseGedaechtnisverzeichnis(verz);
    assert.deepEqual(v3.fehler, []);
    assert.deepEqual(v3.dateien, []);
  } finally {
    fs.rmSync(verz, { recursive: true, force: true });
  }

  // Kein Verzeichnis heisst: noch nie etwas hochgeladen. Kein Mangel.
  const nie = P.leseGedaechtnisverzeichnis(
    path.join(WURZEL, 'data', 'uploads-gibt-es-nicht'));
  assert.deepEqual(nie, { fehler: [], dateien: [] });
});

test('DS: N6 -- die eigene Aufnahme wird uebersprungen UND zaehlt als ausstehend', () => {
  const jetzt = Date.parse('2026-09-02T16:44:00+02:00');
  // Drei Shorts der EIGENEN Aufnahme sind hochgeladen; ihre Termine liegen in
  // der Zukunft. Beides muss gelten: sie bekommen keinen zweiten Termin, und
  // der Plan setzt hinter ihrem letzten an.
  const eigenes = gedaechtnisMit(3, AUFNAHME);
  const g = JSON.parse(eigenes);
  g.uploads[0].publish_at = '2026-09-02T15:00:00.000Z';
  g.uploads[1].publish_at = '2026-09-02T16:00:00.000Z';
  g.uploads[2].publish_at = '2026-09-02T17:00:00.000Z';
  const text = JSON.stringify(g, null, 2) + '\n';
  const dateien = [{ aufnahme: AUFNAHME, datei: 'data/uploads/' + AUFNAHME + '.json',
    pfad: path.join(WURZEL, 'data', 'uploads', AUFNAHME + '.json'), text }];
  const gesammelt = P.sammleAusstehende(dateien, jetzt);
  assert.equal(gesammelt.ausstehend.length, 3);

  const e = P.planeAufnahme({
    aufnahme: AUFNAHME, freigabeText: freigabeMit(12), gedaechtnisText: text,
    planungszeitpunkt: jetzt, vorgegeben: true, jetzt,
    ausstehende: gesammelt.ausstehend, gedaechtnisdateien: dateien.map((d) => d.datei),
  });
  assert.deepEqual(e.fehler, []);
  const p = e.plan;
  // uebersprungen: dieselben drei wie vor DS.
  assert.equal(p.freigaben_uebersprungen, 3);
  assert.equal(p.termine.length, 9);
  for (const u of p.uebersprungen_hochgeladen) {
    assert.ok(!p.termine.some((t) => t.sha256 === u.sha256),
      u.kennung + ' hat trotzdem einen Termin bekommen');
  }
  // ausstehend: ihr spaetester Termin ist der Anker.
  assert.equal(p.anschluss.grund, 'ausstehender_termin');
  assert.equal(p.anschluss.letzter_ausstehender.aufnahme, AUFNAHME);
  assert.equal(p.anschluss.letzter_ausstehender.publish_at, '2026-09-02T17:00:00.000Z');
  assert.equal(p.fenster.beginn, '2026-09-02T17:00:00.000Z');
  for (const t of p.termine) {
    assert.ok(Date.parse(t.publish_at) > Date.parse('2026-09-02T17:00:00.000Z'));
  }
});

test('DS: die Nachpruefung faellt auf, wenn ein Termin auf dem letzten alten liegt', () => {
  const jetzt = Date.parse('2026-09-02T16:44:00+02:00');
  const dateien = [gedaechtnisDatei('2026-08-31 17-36-21', ECHTE_LAGE)];
  const g = P.sammleAusstehende(dateien, jetzt);
  const e = P.planeAufnahme({
    aufnahme: '2026-09-02 12-10-37', freigabeText: freigabeText('2026-09-02 12-10-37'),
    planungszeitpunkt: jetzt, vorgegeben: true, jetzt,
    ausstehende: g.ausstehend, gedaechtnisdateien: dateien.map((d) => d.datei),
  });
  const anfang = Date.parse(e.plan.fenster.beginn);
  // Sauber: die Nachpruefung schweigt.
  assert.deepEqual(P.pruefePlan(e.plan, anfang), []);

  // Verbogen: ein Termin genau auf dem letzten ausstehenden.
  const kaputt = JSON.parse(JSON.stringify(e.plan));
  kaputt.termine[0].publish_at = '2026-09-03T08:57:00.000Z';
  kaputt.termine[0].publish_at_ortszeit = P.ortszeitText(Date.parse('2026-09-03T08:57:00.000Z'));
  assert.ok(P.pruefePlan(kaputt, anfang)
    .some((x) => /nicht nach dem letzten ausstehenden Termin/.test(x)),
    P.pruefePlan(kaputt, anfang).join(' | '));

  // Und ein Kopf, der einen anderen Startpunkt behauptet, als gerechnet wurde.
  const luegt = JSON.parse(JSON.stringify(e.plan));
  luegt.anschluss.startpunkt = '2026-09-02T14:44:00.000Z';
  assert.ok(P.pruefePlan(luegt, anfang).some((x) => /nicht der Anfang des Fensters/.test(x)));
});

test('DS: die Grenze der Regel steht im Quelltext, im Plan und in der Ausgabe', () => {
  // Sie gehoert dorthin, wo jemand den Plan ansieht -- nicht in eine Fussnote.
  assert.match(QUELLTEXT, /von Hand im YouTube-Studio/);
  assert.match(QUELLTEXT, /ABSICHTLICH keine Abfrage gegen YouTube/);
  const p = plane('2026-09-01T17:00:00+02:00').plan;
  assert.equal(p.anschluss.grenze, P.GRENZE_HANDPLANUNG);
  assert.match(p.anschluss.grenze, /von Hand im YouTube-Studio/);
  const text = P.formatiere(p);
  assert.ok(text.includes('GRENZE:'), 'die Ausgabe nennt die Grenze nicht');
  assert.ok(text.includes('YouTube-Studio'), 'die Ausgabe nennt die Handplanung nicht');
  // Und der Planer fragt weiterhin niemanden.
  assert.ok(!/fetch\(|require\('https'\)|googleapis/.test(NURCODE));
});

test('DS: die Ausgabe zeigt die Naht -- letzter alter Termin, dann der erste neue', () => {
  const jetzt = Date.parse('2026-09-02T16:44:00+02:00');
  const dateien = [gedaechtnisDatei('2026-08-31 17-36-21', ECHTE_LAGE)];
  const g = P.sammleAusstehende(dateien, jetzt);
  const p = P.planeAufnahme({
    aufnahme: '2026-09-02 12-10-37', freigabeText: freigabeText('2026-09-02 12-10-37'),
    planungszeitpunkt: jetzt, vorgegeben: true, jetzt,
    ausstehende: g.ausstehend, gedaechtnisdateien: dateien.map((d) => d.datei),
  }).plan;
  const text = P.formatiere(p);
  const zeilen = text.split('\n');
  // Der letzte ausstehende Termin steht in der Tabelle, mit "--" statt Nummer,
  // unmittelbar vor dem ersten neuen.
  const naht = zeilen.findIndex((z) => z.startsWith('  --  2026-09-03T08:57:00.000Z'));
  assert.ok(naht > 0, 'die Naht steht nicht in der Tabelle');
  assert.ok(zeilen[naht + 1].includes('2026-08-31 17-36-21/t12'));
  assert.ok(zeilen[naht + 1].includes('steht schon auf dem Kanal'));
  const ersteNeue = zeilen.findIndex((z) => z.startsWith('   1  ' + p.termine[0].publish_at));
  assert.ok(ersteNeue > naht, 'der erste neue Termin steht nicht unter der Naht');
  // Und der Abstand ueber die Naht steht daneben, nicht nur die Uhrzeiten.
  assert.ok(text.includes('Abstand bis zum ersten neuen Termin: 72 Minuten'));
  // Die ausstehenden Termine stehen einzeln, nicht nur als Zahl.
  assert.ok(text.includes('Ausstehende Termine aus frueheren Laeufen: 7'));
  for (const a of p.anschluss.ausstehende_termine) {
    assert.ok(text.includes(a.kennung), a.kennung + ' fehlt in der Ausgabe');
  }
});

test('DS (CLI): eine fremde Aufnahme mit offenen Terminen verschiebt das Fenster', () => {
  const fremd = '2000-07-07 07-07-07';
  mitProbe('2000-08-08 08-08-08', 4, 0, ({ plan }) => {
    const r = spawnSync(process.execPath,
      [SKRIPT, '--freigabe=2000-08-08 08-08-08', '--jetzt=2035-06-06T17:00:00+02:00', '--execute'],
      { encoding: 'utf8' });
    assert.equal(r.status, P.EXIT_OK, r.stderr);
    const d = JSON.parse(fs.readFileSync(plan, 'utf8'));
    assert.equal(d.anschluss.grund, 'ausstehender_termin');
    assert.equal(d.anschluss.letzter_ausstehender.aufnahme, fremd);
    assert.equal(d.anschluss.letzter_ausstehender.publish_at, '2035-06-07T09:00:00.000Z');
    assert.equal(d.fenster.beginn, '2035-06-07T09:00:00.000Z');
    for (const t of d.termine) {
      assert.ok(Date.parse(t.publish_at) > Date.parse('2035-06-07T09:00:00.000Z'),
        t.kennung + ' liegt vor dem letzten ausstehenden Termin');
    }
    // Die Ausgabe nennt die fremde Aufnahme -- wer sie liest, sieht die Naht.
    assert.ok(r.stdout.includes(fremd));
    assert.ok(r.stdout.includes('steht schon auf dem Kanal'));
    // Und keine videoId.
    assert.ok(!/PROBE-ohne-Bezug/.test(r.stdout + fs.readFileSync(plan, 'utf8')));
  }, [{ aufnahme: fremd, termine: ['2035-06-07T08:00:00.000Z', '2035-06-07T09:00:00.000Z'] }]);
});

test('DS (CLI): eine kaputte fremde Gedaechtnisdatei bricht ab und nennt sie', () => {
  const fremd = '2000-09-09 09-09-09';
  mitProbe('2000-10-10 10-10-10', 4, 0, ({ plan }) => {
    const r = spawnSync(process.execPath,
      [SKRIPT, '--freigabe=2000-10-10 10-10-10', '--jetzt=2035-06-06T17:00:00+02:00', '--execute'],
      { encoding: 'utf8' });
    assert.equal(r.status, P.EXIT_MANGEL, r.stdout + r.stderr);
    assert.match(r.stderr, /ABBRUCH/);
    assert.ok(r.stderr.includes('data/uploads/' + fremd + '.json'),
      'die Meldung nennt die kaputte Datei nicht:\n' + r.stderr);
    assert.ok(!fs.existsSync(plan), 'es ist trotzdem ein Plan entstanden');
  }, [{ aufnahme: fremd, text: '{ das ist kein JSON' }]);
});

// ---------------------------------------------------------------------------
// DNa: Flagname und Rueckgabewerte
// ---------------------------------------------------------------------------

test('DNa: der Planer gibt seinen eigenen Flagnamen mit -- --freigabe=, nicht --aufnahme=', () => {
  assert.match(NURCODE,
    /pruefeKeineFreienArgumente\(process\.argv, 'src\/upload\/planer\.js', '--freigabe='\)/);
  assert.ok(!/'--aufnahme='/.test(NURCODE), 'der Planer nennt ein Argument, das er nicht hat');
});

test('DNa: der Vorschlag bei verlorenen Anfuehrungszeichen ist ausfuehrbar', () => {
  // Der Fehler aus DN Abschnitt 7: die Meldung nannte --aufnahme=, das es hier
  // nicht gibt. Wer den Vorschlag abtippte, bekam den naechsten Abbruch.
  //
  // DOa PUNKT 2 -- WARUM DIESER TEST SEIT DO EINEN EIGENEN PROBENAMEN HAT:
  //
  // Bis DO stand hier die ECHTE Aufnahme 2026-08-31 17-36-21. Der Test tippte
  // ihren Namen ohne Anfuehrungszeichen, las den Vorschlag aus der Meldung und
  // fuehrte ihn aus -- und erwartete dabei einen Trockenlauf mit Code 0. Seit
  // in DO ein echter Plan in data/plaene liegt, bricht der Planer fuer diese
  // Aufnahme ab (Code 1), und der Test fiel.
  //
  // Beide Seiten hatten recht: der Planer SOLL bei vorhandenem Plan abbrechen,
  // auch im Trockenlauf, und der Test SOLL pruefen, dass der Vorschlag
  // durchlaeuft. Falsch war der Ort. Der Test hing an einer Aufnahme, deren
  // Zustand er nicht besitzt -- und wurde von echter Arbeit umgeworfen, ohne
  // dass an dem, was er prueft, irgendetwas kaputt war.
  //
  // Die bequeme Reparatur waere gewesen, den vorhandenen Plan zu ueberspringen
  // oder die Erwartung auf "0 oder 1" zu weiten. Das ist nicht gemacht worden:
  // ein Test, der bei echter Datenlage schweigt oder sich seine Erwartung nach
  // der Lage aussucht, ist keiner mehr. Stattdessen bekommt er eine eigene
  // Wegwerf-Aufnahme mit eigener Freigabedatei, deren Zustand er selbst
  // herstellt und selbst wieder aufraeumt.
  const probe = '2000-03-03 03-03-03';
  const freigabe = P.freigabePfad(WURZEL, probe);
  const ziel = P.planPfad(WURZEL, probe);
  assert.ok(!fs.existsSync(freigabe), 'die Wegwerf-Aufnahme gibt es schon');
  assert.ok(!fs.existsSync(ziel), 'fuer die Wegwerf-Aufnahme liegt schon ein Plan');
  fs.mkdirSync(path.dirname(freigabe), { recursive: true });
  fs.writeFileSync(freigabe, freigabeMit(3, AUFNAHME, probe), 'utf8');
  try {
    // "2000-03-03 03-03-03" ohne Anfuehrungszeichen zerfaellt genauso wie der
    // echte Name: --freigabe=2000-03-03 und ein freies "03-03-03".
    const r = spawnSync(process.execPath, [SKRIPT, '--freigabe=2000-03-03', '03-03-03'],
      { encoding: 'utf8' });
    assert.equal(r.status, P.EXIT_AUFRUFFEHLER);
    assert.ok(r.stderr.includes('node src/upload/planer.js --freigabe="2000-03-03 03-03-03"'),
      'der Vorschlag lautet anders als erwartet:\n' + r.stderr);
    assert.ok(!r.stderr.includes('--aufnahme='), 'die Meldung nennt ein fremdes Argument');
    // Und der vorgeschlagene Aufruf laeuft wirklich durch -- als Trockenlauf,
    // der nichts anlegt.
    const nach = spawnSync(process.execPath, [SKRIPT, '--freigabe=2000-03-03 03-03-03'],
      { encoding: 'utf8' });
    assert.equal(nach.status, P.EXIT_OK, nach.stderr);
    assert.match(nach.stdout, /TROCKENLAUF: es wurde NICHTS geschrieben/);
    assert.ok(!fs.existsSync(ziel), 'der Trockenlauf hat eine Datei angelegt');
  } finally {
    fs.rmSync(freigabe, { force: true });
    fs.rmSync(ziel, { force: true });
  }
});

test('DOa: der Vorschlag-Test haengt an keiner echten Aufnahme mehr', () => {
  // Der Beleg dafuer, dass die Reparatur oben eine ist und keine Vertagung:
  // sonst waere beim naechsten echten Plan derselbe Fehlschlag faellig.
  const quelltext = fs.readFileSync(__filename, 'utf8');
  const block = quelltext.slice(
    quelltext.indexOf("test('DNa: der Vorschlag bei verlorenen"),
    quelltext.indexOf("test('DOa: der Vorschlag-Test haengt"));
  assert.ok(block.length > 100, 'der Block wurde nicht gefunden');
  const wirkung = block.split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n');
  assert.ok(!wirkung.includes('2026-08-31'),
    'der Vorschlag-Test benutzt wieder eine echte Aufnahme');
  assert.ok(wirkung.includes("const probe = '2000-03-03 03-03-03'"));
});

test('DNa: die Rueckgabewerte kommen aus der Tabelle im Leser', () => {
  const L = require('../src/upload/uebergabe-leser.js');
  assert.equal(P.EXIT_OK, L.EXIT.OK);
  assert.equal(P.EXIT_MANGEL, L.EXIT.BEFUND);
  assert.equal(P.EXIT_AUFRUFFEHLER, L.EXIT.AUFRUF);
  assert.equal(P.EXIT_GESPERRT, L.EXIT.GESPERRT);
  assert.ok(!/const EXIT_[A-Z_]+\s*=\s*\d+\s*;/.test(NURCODE),
    'der Planer vergibt eine Exit-Zahl selbst');
});

test('DNa: 3 gehoert der Sperre -- die zweite Bedeutung hat einen eigenen Wert', () => {
  const L = require('../src/upload/uebergabe-leser.js');
  assert.equal(L.EXIT.GESPERRT, 3);
  assert.equal(L.EXIT.KEINE_ANTWORT, 4);
  assert.notEqual(L.EXIT.GESPERRT, L.EXIT.KEINE_ANTWORT);
  // Und der Planer vergibt 4 nicht: er fragt niemanden.
  assert.ok(!/EXIT\.KEINE_ANTWORT|EXIT_KEINE_ANTWORT/.test(NURCODE));
});
