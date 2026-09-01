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
function freigabeMit(n, aufnahme = AUFNAHME) {
  const d = JSON.parse(freigabeText(aufnahme));
  const vorlage = d.freigaben.find((e) => e.freigegeben === true);
  d.freigaben = [];
  for (let i = 0; i < n; i++) {
    d.freigaben.push(Object.assign({}, vorlage, {
      sha256: crypto.createHash('sha256').update('probe-' + i).digest('hex'),
      kennung: aufnahme + '/p' + (i + 1),
      titel: 'Probe ' + (i + 1),
    }));
  }
  return JSON.stringify(d, null, 2) + '\n';
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
  assert.match(NURCODE, /const \{ pruefeKeineFreienArgumente, AUFNAHME_FORM, EXIT \} = require\('\.\/uebergabe-leser'\)/);
  assert.ok(!/function pruefeKeineFreienArgumente/.test(NURCODE),
    'der Planer baut pruefeKeineFreienArgumente nach, statt sie zu importieren');
  assert.ok(!/const AUFNAHME_FORM\s*=/.test(NURCODE),
    'der Planer baut AUFNAHME_FORM nach, statt sie zu importieren');
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
    const jetzt = '--jetzt=2026-09-01T17:00:00+02:00';

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
  const r = spawnSync(process.execPath, [SKRIPT, '--freigabe=2026-08-31', '17-36-21'],
    { encoding: 'utf8' });
  assert.equal(r.status, P.EXIT_AUFRUFFEHLER);
  assert.ok(r.stderr.includes('node src/upload/planer.js --freigabe="2026-08-31 17-36-21"'),
    'der Vorschlag lautet anders als erwartet:\n' + r.stderr);
  assert.ok(!r.stderr.includes('--aufnahme='), 'die Meldung nennt ein fremdes Argument');
  // Und der vorgeschlagene Aufruf laeuft wirklich durch.
  const nach = spawnSync(process.execPath, [SKRIPT, '--freigabe=2026-08-31 17-36-21'],
    { encoding: 'utf8' });
  assert.equal(nach.status, P.EXIT_OK, nach.stderr);
  assert.match(nach.stdout, /TROCKENLAUF: es wurde NICHTS geschrieben/);
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
