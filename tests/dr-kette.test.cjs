'use strict';

// DR: Tests fuer die Kette -- Einplanen, Vorschau, Hochladen -- und fuer die
// Einmal-Ermaechtigung, die dabei an die Stelle des getippten HOCHLADEN tritt.
//
// WAS HIER GEPRUEFT WIRD, IST DIE ABLEHNUNG. Die Ermaechtigung hat sechs
// Pruefungen; jede einzelne bekommt hier einen eigenen Test, weil eine Kette
// von Pruefungen genau so stark ist wie die schwaechste, und weil eine
// Pruefung, die nie einzeln ausgeloest wurde, unbewiesen ist.
//
// WAS HIER NICHT STEHT: der scharfe Lauf. Er braucht die echte Projektwurzel,
// legt Dateien unter data/ an und startet den Uploader mit --execute. Das
// gehoert in einen Nachweislauf mit Aufraeumen (Bericht DR, N3/N5/N6) und
// nicht in npm test.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const U = require('../src/upload/uploader.js');
const S = require('../src/upload/freigabe-server.js');
const SEITE = require('../src/upload/freigabe-seite.js');

const UPLOADER_SKRIPT = path.join(__dirname, '..', 'src', 'upload', 'uploader.js');
const AUFNAHME = '2026-01-02 03-04-05';
const GESPERRTE_AUFNAHME = '2026-08-29 18-18-19';
const PLAN_SHA = 'a'.repeat(64);

function wegwerfordner() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dr-kette-'));
}

// Legt eine gueltige Ermaechtigung an -- genau so, wie der Dienst sie schreibt:
// ueber neueErmaechtigung() (die Form) und schreibeErmaechtigung() (den Weg).
// Nichts davon ist hier nachgebaut.
function legeErmaechtigung(wurzel, aenderungen = {}) {
  const zufall = aenderungen.zufall || U.neuerZufall();
  const inhalt = Object.assign(U.neueErmaechtigung({
    aufnahme: AUFNAHME, planSha256: PLAN_SHA, anzahl: 3,
    kanalId: 'KANAL-KENNUNG', kanalName: 'ein Kanal', zufall, jetzt: Date.now(),
  }), aenderungen);
  const pfad = U.ermaechtigungPfad(wurzel, zufall);
  S.schreibeErmaechtigung(pfad, inhalt);
  return { pfad, inhalt, zufall };
}

function pruefe(wurzel, pfad, aenderungen = {}) {
  return U.pruefeErmaechtigung(Object.assign({
    projektwurzel: wurzel, pfad, aufnahme: AUFNAHME,
    planSha256: PLAN_SHA, anzahl: 3, jetzt: Date.now(),
  }, aenderungen));
}

// ---------------------------------------------------------------------------
// N1 -- die Ermaechtigung, jede Pruefung einzeln
// ---------------------------------------------------------------------------

test('N1: eine gueltige Ermaechtigung wird angenommen -- sonst prueft der Rest nichts', () => {
  const w = wegwerfordner();
  const e = legeErmaechtigung(w);
  const r = pruefe(w, e.pfad);
  assert.equal(r.ok, true, r.meldung);
  assert.equal(r.daten.zufall, e.zufall);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: fehlende Datei', () => {
  const w = wegwerfordner();
  const pfad = U.ermaechtigungPfad(w, U.neuerZufall());
  const r = pruefe(w, pfad);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ermaechtigung_fehlt');
  assert.match(r.meldung, /keine Ermaechtigung unter/);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: abgelaufen -- aelter als zwei Minuten', () => {
  const w = wegwerfordner();
  const jetzt = Date.now();
  // Genau an der Grenze gilt sie noch, eine Sekunde darueber nicht mehr. Beide
  // Faelle werden geprueft: eine Grenze, die nur von einer Seite geprueft ist,
  // ist eine halbe Grenze.
  const knapp = legeErmaechtigung(w, {
    erstellt_am: new Date(jetzt - U.ERMAECHTIGUNG_GUELTIG_MS).toISOString() });
  assert.equal(pruefe(w, knapp.pfad, { jetzt }).ok, true);

  const alt = legeErmaechtigung(w, {
    erstellt_am: new Date(jetzt - U.ERMAECHTIGUNG_GUELTIG_MS - 1000).toISOString() });
  const r = pruefe(w, alt.pfad, { jetzt });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ermaechtigung_abgelaufen');
  assert.match(r.meldung, /121 Sekunden alt, gueltig sind 120/);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: datiert in der Zukunft', () => {
  const w = wegwerfordner();
  const jetzt = Date.now();
  const e = legeErmaechtigung(w, { erstellt_am: new Date(jetzt + 30000).toISOString() });
  const r = pruefe(w, e.pfad, { jetzt });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ermaechtigung_zukunft');
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: falsche Aufnahme', () => {
  const w = wegwerfordner();
  const e = legeErmaechtigung(w, { aufnahme: '2020-01-01 00-00-00' });
  const r = pruefe(w, e.pfad);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ermaechtigung_fremde_aufnahme');
  assert.match(r.meldung, /2020-01-01 00-00-00/);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: falsche Plan-sha256 -- der Plan ist seit der Vorschau ein anderer', () => {
  const w = wegwerfordner();
  const e = legeErmaechtigung(w, { plan_sha256: 'b'.repeat(64) });
  const r = pruefe(w, e.pfad);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ermaechtigung_plan_geaendert');
  assert.match(r.meldung, /seit der Vorschau ein ANDERER/);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: falsche Anzahl -- auf dem Knopf stand eine andere Zahl', () => {
  const w = wegwerfordner();
  const e = legeErmaechtigung(w, { anzahl: 12 });
  const r = pruefe(w, e.pfad);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ermaechtigung_anzahl');
  assert.match(r.meldung, /nennt 12 Short\(s\), dieser Lauf haette 3/);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: zweimal verwendet -- und das ist etwas anderes als eine fehlende Datei', () => {
  const w = wegwerfordner();
  const e = legeErmaechtigung(w);
  assert.equal(pruefe(w, e.pfad).ok, true);

  const v = U.verbraucheErmaechtigung({
    projektwurzel: w, pfad: e.pfad, daten: e.inhalt, jetzt: Date.now() });
  assert.equal(v.ok, true);
  assert.equal(v.geloescht, true);
  assert.equal(fs.existsSync(e.pfad), false, 'verbraucht heisst geloescht');

  // (a) Ohne die Datei: sie fehlt.
  const a = pruefe(w, e.pfad);
  assert.equal(a.code, 'ermaechtigung_fehlt');

  // (b) MIT der Datei -- jemand hatte eine Kopie: sie ist verbraucht. Das ist
  //     der Fall, gegen den die Verbrauchsliste gebaut ist, und er bekommt
  //     eine eigene Meldung.
  S.schreibeErmaechtigung(e.pfad, e.inhalt);
  const b = pruefe(w, e.pfad);
  assert.equal(b.ok, false);
  assert.equal(b.code, 'ermaechtigung_verbraucht');
  assert.match(b.meldung, /schon verbraucht/);
  assert.notEqual(a.meldung, b.meldung, 'zwei Faelle, zwei Meldungen');

  const liste = U.leseVerbrauchte(w);
  assert.equal(liste.fehler, null);
  assert.equal(liste.liste.length, 1);
  assert.equal(liste.liste[0].zufall, e.zufall);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: ein Pfad ausserhalb von data/ermaechtigungen wird nicht einmal gelesen', () => {
  const w = wegwerfordner();
  const fremd = path.join(w, 'nicht-hier.json');
  fs.writeFileSync(fremd, JSON.stringify(U.neueErmaechtigung({
    aufnahme: AUFNAHME, planSha256: PLAN_SHA, anzahl: 3, kanalId: 'K', kanalName: 'N',
    zufall: U.neuerZufall(), jetzt: Date.now() })));
  const r = pruefe(w, fremd);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ermaechtigung_pfad_fremd');
  // Der Uploader LOESCHT diese Datei sonst -- ein frei gewaehlter Pfad waere
  // ein Loeschbefehl. Sie liegt danach unveraendert da.
  assert.equal(fs.existsSync(fremd), true);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: fremder Typ, fremde Fassung, kaputter Zufallswert, kein JSON', () => {
  const w = wegwerfordner();
  const faelle = [
    [{ artifact_type: 'etwas anderes' }, 'ermaechtigung_fremder_typ'],
    [{ schema_version: '9.9' }, 'ermaechtigung_fremde_version'],
    [{ zufall: 'kurz' }, 'ermaechtigung_zufall_form'],
    [{ erstellt_am: 'gestern' }, 'ermaechtigung_zeit_form'],
    [{ plan_sha256: 'keine summe' }, 'ermaechtigung_plan_sha_form'],
    [{ anzahl: '3' }, 'ermaechtigung_anzahl_form'],
    [{ kanal_id: '' }, 'ermaechtigung_kanal_form'],
  ];
  const gesehen = new Set();
  for (const [aenderung, code] of faelle) {
    // Der Dateiname haengt am Zufallswert, der Inhalt darf abweichen.
    const zufall = U.neuerZufall();
    const pfad = U.ermaechtigungPfad(w, zufall);
    S.schreibeErmaechtigung(pfad, Object.assign(U.neueErmaechtigung({
      aufnahme: AUFNAHME, planSha256: PLAN_SHA, anzahl: 3, kanalId: 'K', kanalName: 'N',
      zufall, jetzt: Date.now() }), aenderung));
    const r = pruefe(w, pfad);
    assert.equal(r.ok, false, JSON.stringify(aenderung));
    assert.equal(r.code, code, JSON.stringify(aenderung) + ' -> ' + r.code);
    assert.ok(!gesehen.has(r.meldung), 'jede Ablehnung hat ihre eigene Meldung');
    gesehen.add(r.meldung);
  }

  const kaputt = U.ermaechtigungPfad(w, U.neuerZufall());
  fs.writeFileSync(kaputt, '{ das ist kein JSON');
  assert.equal(pruefe(w, kaputt).code, 'ermaechtigung_kein_json');
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: eine unlesbare Verbrauchsliste laesst gar nichts mehr durch', () => {
  // Eine kaputte Liste saehe sonst aus wie "noch nie verbraucht" -- und dann
  // waere die Wiederverwendungssperre genau dann weg, wenn etwas nicht stimmt.
  const w = wegwerfordner();
  const e = legeErmaechtigung(w);
  fs.mkdirSync(path.dirname(U.verbrauchtPfad(w)), { recursive: true });
  fs.writeFileSync(U.verbrauchtPfad(w), '{ kaputt');
  const r = pruefe(w, e.pfad);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'verbrauchsliste_unlesbar');
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: der Kanal wird getrennt geprueft -- er ist erst nach channels.list bekannt', () => {
  const daten = U.neueErmaechtigung({
    aufnahme: AUFNAHME, planSha256: PLAN_SHA, anzahl: 3,
    kanalId: 'RICHTIG', kanalName: 'der richtige', zufall: U.neuerZufall(), jetzt: Date.now() });
  assert.equal(U.pruefeKanal(daten, 'RICHTIG', 'der richtige').ok, true);
  const r = U.pruefeKanal(daten, 'FALSCH', 'ein anderer');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ermaechtigung_kanal');
  assert.match(r.meldung, /Der Knopf nannte den Kanal/);
});

test('N1: zwischen Pruefung und Verbrauch ausgetauscht -- dann wird nichts verbraucht', () => {
  const w = wegwerfordner();
  const e = legeErmaechtigung(w);
  // Dieselbe Datei, anderer Zufallswert: jemand hat sie in der Zwischenzeit
  // ersetzt. Die Datei bleibt liegen und die Liste bleibt leer.
  S.schreibeErmaechtigung(e.pfad, Object.assign({}, e.inhalt, { zufall: U.neuerZufall() }));
  const v = U.verbraucheErmaechtigung({
    projektwurzel: w, pfad: e.pfad, daten: e.inhalt, jetzt: Date.now() });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'ermaechtigung_ersetzt');
  assert.equal(fs.existsSync(e.pfad), true);
  assert.equal(U.leseVerbrauchte(w).liste.length, 0);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N1: die Verbrauchsliste waechst nicht unbegrenzt', () => {
  const w = wegwerfordner();
  const vp = U.verbrauchtPfad(w);
  fs.mkdirSync(path.dirname(vp), { recursive: true });
  const alt = [];
  for (let i = 0; i < U.VERBRAUCHT_MAX + 5; i++) alt.push({ zufall: String(i).padStart(64, '0') });
  fs.writeFileSync(vp, JSON.stringify({ verbraucht: alt }));
  const e = legeErmaechtigung(w);
  const v = U.verbraucheErmaechtigung({
    projektwurzel: w, pfad: e.pfad, daten: e.inhalt, jetzt: Date.now() });
  assert.equal(v.ok, true);
  const liste = U.leseVerbrauchte(w).liste;
  assert.equal(liste.length, U.VERBRAUCHT_MAX);
  assert.equal(liste[liste.length - 1].zufall, e.zufall, 'der neueste steht hinten');
  fs.rmSync(w, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// N2 -- ohne Ermaechtigung bleibt alles, wie es war
// ---------------------------------------------------------------------------

function rufeUploader(argumente) {
  const lauf = spawnSync(process.execPath, [UPLOADER_SKRIPT, ...argumente], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: lauf.status, aus: (lauf.stdout || '') + (lauf.stderr || '') };
}

test('N2: --execute ohne --bestaetigt-durch bleibt bei Exit 4, wenn nicht gefragt werden kann', () => {
  const r = rufeUploader(['--plan=' + AUFNAHME, '--execute']);
  assert.equal(r.code, U.EXIT_KEINE_ANTWORT);
  assert.equal(U.EXIT_KEINE_ANTWORT, 4);
  assert.match(r.aus, /stdin ist kein Terminal/);
  assert.match(r.aus, /Es wurde NICHTS hochgeladen/);
});

test('N2: der Quelltext verlangt das getippte Wort weiterhin -- nur nicht mit Ermaechtigung', () => {
  const quelltext = fs.readFileSync(UPLOADER_SKRIPT, 'utf8');
  const code = quelltext.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.equal(U.BESTAETIGUNGSWORT, 'HOCHLADEN');
  // Die Frage haengt daran, dass KEINE Ermaechtigung da ist.
  assert.match(code, /if \(ermaechtigung === null\) \{[\s\S]{0,400}bestaetigungEinholen\(frage, BESTAETIGUNGSWORT\)/);
  // Und die Terminal-Pruefung greift ebenfalls nur ohne Ermaechtigung.
  assert.match(code, /if \(execute && bestaetigtDurch === null && !process\.stdin\.isTTY\)/);
});

test('N2: mit --bestaetigt-durch faellt die Terminalpruefung, nicht die Bestaetigung', () => {
  // Nicht-interaktiv, aber MIT Ermaechtigung: der Lauf kommt an der
  // Terminalpruefung vorbei und scheitert am naechsten echten Befund (hier:
  // es gibt keinen Plan). Exit 1 und nicht Exit 4 ist der ganze Nachweis.
  const w = wegwerfordner();
  const e = legeErmaechtigung(w);
  const r = rufeUploader(['--plan=' + AUFNAHME, '--execute', '--bestaetigt-durch=' + e.pfad]);
  assert.equal(r.code, U.EXIT_BEFUND);
  assert.doesNotMatch(r.aus, /stdin ist kein Terminal/);
  assert.match(r.aus, /Planungsdatei nicht gefunden/);
  fs.rmSync(w, { recursive: true, force: true });
});

test('N2: --bestaetigt-durch ohne --execute ist ein Aufruffehler', () => {
  const r = rufeUploader(['--plan=' + AUFNAHME, '--bestaetigt-durch=x']);
  assert.equal(r.code, U.EXIT_AUFRUFFEHLER);
  assert.match(r.aus, /ohne --execute/);
  const r2 = rufeUploader(['--plan=' + AUFNAHME, '--execute', '--nur-pruefen', '--bestaetigt-durch=x']);
  assert.equal(r2.code, U.EXIT_AUFRUFFEHLER);
});

// ---------------------------------------------------------------------------
// N4 -- Schritt 3 ist serverseitig gesperrt, bevor Schritt 1 lief
// ---------------------------------------------------------------------------

// Eine Sitzung auf der ECHTEN Projektwurzel, aber mit einem erfundenen
// Aufnahmenamen: die Kette laeuft nur dort, und ohne Plan und ohne Freigabe
// wird dabei nichts geschrieben.
function sitzungAufEchterWurzel(aufnahme) {
  const bericht = {
    quelle: '<erfunden>', aufnahme, wurzel: '<erfunden>', plattenpruefung: true,
    kopfMaengel: [], eintraege: [], eintraegeGeprueft: true, verlauf: [],
    angenommen: 0, abgelehnt: 0, maengelGesamt: 0, hinweiseGesamt: 0,
    angenommenMitHinweis: 0, status: 'angenommen',
  };
  return S.baueSitzung({
    bericht, eingabeText: JSON.stringify(bericht), aufnahme,
    projektwurzel: S.PROJEKTWURZEL, port: 0,
  });
}

async function starte(sitzung) {
  const dienst = S.baueDienst(sitzung);
  await new Promise((f) => dienst.listen(0, S.HOST, f));
  sitzung.port = dienst.address().port;
  return { dienst, port: sitzung.port, token: sitzung.token,
    schliesse: () => new Promise((f) => dienst.close(f)) };
}

// Roh ueber http.request -- kein Browser, kein fetch, keine Seite. Genau so
// wuerde eine Anfrage aussehen, die den Browser umgeht.
function anfrage(port, { methode = 'GET', pfad = '/', kopf = {} } = {}) {
  return new Promise((f, x) => {
    const req = http.request({ host: S.HOST, port, method: methode, path: pfad, headers: kopf },
      (res) => {
        const s = [];
        res.on('data', (t) => s.push(t));
        res.on('end', () => f({ status: res.statusCode, leib: Buffer.concat(s).toString('utf8') }));
      });
    req.on('error', x);
    req.end();
  });
}

test('N4: POST /hochladen ohne Schritt 1 wird abgewiesen -- am Dienst, nicht im Browser', async () => {
  const sitzung = sitzungAufEchterWurzel(AUFNAHME);
  const d = await starte(sitzung);
  try {
    const r = await anfrage(d.port, { methode: 'POST', pfad: '/hochladen', kopf: {
      host: S.HOST + ':' + d.port, origin: 'http://' + S.HOST + ':' + d.port,
      'x-freigabe-token': d.token } });
    assert.equal(r.status, 409);
    const leib = JSON.parse(r.leib);
    assert.equal(leib.fehler, 'schritt1_fehlt');
    assert.match(leib.meldung, /Schritt 1 ist noch nicht gelaufen/);
    assert.match(leib.meldung, /keine Ermaechtigung ausgestellt/);
    // Es ist auch wirklich keine entstanden.
    assert.equal(sitzung.kette.lauf, null);
    assert.equal(sitzung.kette.vorschau, null);
  } finally { await d.schliesse(); }
});

test('N4: der Dienst sagt selbst, warum Schritt 3 gesperrt ist', async () => {
  const sitzung = sitzungAufEchterWurzel(AUFNAHME);
  const d = await starte(sitzung);
  try {
    const r = await anfrage(d.port, { pfad: '/kette', kopf: {
      host: S.HOST + ':' + d.port, 'x-freigabe-token': d.token } });
    assert.equal(r.status, 200);
    const k = JSON.parse(r.leib);
    assert.equal(k.schritt3.bereit, false);
    assert.match(k.schritt3.grund, /Schritt 1 ist noch nicht gelaufen/);
    assert.equal(k.eigene_projektwurzel, true);
  } finally { await d.schliesse(); }
});

test('N4: ohne Sitzungstoken geht auch die Kette nicht', async () => {
  const sitzung = sitzungAufEchterWurzel(AUFNAHME);
  const d = await starte(sitzung);
  try {
    for (const pfad of ['/kette', '/lauf']) {
      const r = await anfrage(d.port, { pfad, kopf: { host: S.HOST + ':' + d.port } });
      assert.equal(r.status, 403, pfad);
    }
    for (const pfad of ['/planen', '/archivieren', '/hochladen']) {
      const r = await anfrage(d.port, { methode: 'POST', pfad, kopf: {
        host: S.HOST + ':' + d.port, origin: 'http://' + S.HOST + ':' + d.port } });
      assert.equal(r.status, 403, pfad);
    }
    // Und ohne Origin nimmt der Dienst keine schreibende Anfrage an.
    const ohneUrsprung = await anfrage(d.port, { methode: 'POST', pfad: '/hochladen', kopf: {
      host: S.HOST + ':' + d.port, 'x-freigabe-token': d.token } });
    assert.equal(ohneUrsprung.status, 403);
    assert.equal(JSON.parse(ohneUrsprung.leib).fehler, 'ursprung_fehlt');
  } finally { await d.schliesse(); }
});

test('die Kette laeuft nicht auf einer fremden Projektwurzel', async () => {
  // Planer und Uploader rechnen sich ihre Wurzel selbst aus. Eine Sitzung auf
  // einem Wegwerfordner wuerde eine Seite zeigen, die etwas anderes beschreibt
  // als das, was geschieht.
  const ordner = wegwerfordner();
  const bericht = {
    quelle: '<erfunden>', aufnahme: AUFNAHME, wurzel: ordner, plattenpruefung: true,
    kopfMaengel: [], eintraege: [], eintraegeGeprueft: true, verlauf: [],
    angenommen: 0, abgelehnt: 0, maengelGesamt: 0, hinweiseGesamt: 0,
    angenommenMitHinweis: 0, status: 'angenommen',
  };
  const sitzung = S.baueSitzung({ bericht, eingabeText: '{}', aufnahme: AUFNAHME,
    projektwurzel: ordner, port: 0 });
  const d = await starte(sitzung);
  try {
    for (const pfad of ['/planen', '/archivieren', '/hochladen']) {
      const r = await anfrage(d.port, { methode: 'POST', pfad, kopf: {
        host: S.HOST + ':' + d.port, origin: 'http://' + S.HOST + ':' + d.port,
        'x-freigabe-token': d.token } });
      assert.equal(r.status, 409, pfad);
      assert.equal(JSON.parse(r.leib).fehler, 'fremde_projektwurzel', pfad);
    }
  } finally { await d.schliesse(); fs.rmSync(ordner, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// N5 -- Archivieren verschiebt, es loescht nicht
// ---------------------------------------------------------------------------

test('N5: archiviereAltenPlan verschiebt nach data/plaene/archiv/', () => {
  const w = wegwerfordner();
  const plan = U.planPfad(w, AUFNAHME);
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  const inhalt = '{"artifact_type":"adw_shorts_plan","termine":[]}\n';
  fs.writeFileSync(plan, inhalt);

  const bewegt = S.archiviereAltenPlan(w, AUFNAHME, Date.parse('2026-09-02T12:00:00Z'));
  assert.equal(fs.existsSync(plan), false, 'an der alten Stelle liegt nichts mehr');
  assert.equal(fs.existsSync(bewegt.ziel), true, 'an der neuen liegt er');
  assert.equal(fs.readFileSync(bewegt.ziel, 'utf8'), inhalt, 'Byte fuer Byte derselbe');
  assert.match(bewegt.ziel.replace(/\\/g, '/'), /\/data\/plaene\/archiv\//);
  assert.match(path.basename(bewegt.ziel), /^2026-01-02 03-04-05\.archiviert-/);

  // Ein zweites Archivieren am selben Zeitpunkt trifft denselben Namen -- der
  // Plan ist aber schon weg, also gibt es nichts zu ueberschreiben.
  assert.throws(() => S.archiviereAltenPlan(w, AUFNAHME, Date.parse('2026-09-02T12:00:00Z')));
  fs.rmSync(w, { recursive: true, force: true });
});

test('N5: ohne Plan gibt es nichts zu archivieren', async () => {
  const sitzung = sitzungAufEchterWurzel(AUFNAHME);
  const d = await starte(sitzung);
  try {
    const r = await anfrage(d.port, { methode: 'POST', pfad: '/archivieren', kopf: {
      host: S.HOST + ':' + d.port, origin: 'http://' + S.HOST + ':' + d.port,
      'x-freigabe-token': d.token } });
    assert.equal(r.status, 409);
    assert.equal(JSON.parse(r.leib).fehler, 'kein_plan');
  } finally { await d.schliesse(); }
});

// ---------------------------------------------------------------------------
// N7 -- die gesperrte Aufnahme bricht auch ueber den neuen Weg ab
// ---------------------------------------------------------------------------

test('N7: die gesperrte Aufnahme bricht in Schritt 1 ab -- ueber den Planer, der sie sperrt',
  async () => {
    // Der Dienst ruft den echten Planer. Der bricht mit Rueckgabewert 3 ab,
    // bevor er irgendetwas liest. Es entsteht kein Plan und keine Vorschau.
    assert.ok(U.sperreFuer(GESPERRTE_AUFNAHME), 'die Aufnahme ist im Uploader gesperrt');
    const planVorher = fs.existsSync(U.planPfad(S.PROJEKTWURZEL, GESPERRTE_AUFNAHME));
    assert.equal(planVorher, false, 'zu dieser Aufnahme gibt es keinen Plan -- sonst misst der Test etwas anderes');

    const sitzung = sitzungAufEchterWurzel(GESPERRTE_AUFNAHME);
    const d = await starte(sitzung);
    try {
      const r = await anfrage(d.port, { methode: 'POST', pfad: '/planen', kopf: {
        host: S.HOST + ':' + d.port, origin: 'http://' + S.HOST + ':' + d.port,
        'x-freigabe-token': d.token } });
      assert.equal(r.status, 200);
      const k = JSON.parse(r.leib);
      assert.equal(k.meldung.art, 'gesperrt');
      assert.match(k.meldung.text, /GESPERRT/);
      assert.equal(k.vorschau, null);
      assert.equal(k.schritt3.bereit, false);
      assert.equal(fs.existsSync(U.planPfad(S.PROJEKTWURZEL, GESPERRTE_AUFNAHME)), false,
        'es ist kein Plan entstanden');
    } finally { await d.schliesse(); }
  });

test('N7: der Uploader sperrt sie unabhaengig davon ein zweites Mal', () => {
  const r = rufeUploader(['--plan=' + GESPERRTE_AUFNAHME, '--execute', '--bestaetigt-durch=x']);
  assert.equal(r.code, U.EXIT_GESPERRT);
  assert.match(r.aus, /GESPERRT/);
  assert.match(r.aus, /kein Flag, das sie uebergeht/);
});

// ---------------------------------------------------------------------------
// N9 -- die Zaehlweise, an beiden Seiten dieselbe
// ---------------------------------------------------------------------------

test('N9: Seite, Dienst und Uploader zaehlen einen Titel gleich', () => {
  const emoji = '\u{1F600}';
  // Ein Emoji: ein Codepunkt, zwei UTF-16-Einheiten.
  assert.equal(emoji.length, 2);
  assert.equal(U.zaehleTitelZeichen(emoji), 1);

  // Der Uploader zaehlt jetzt genauso wie die Freigabeseite. Der Fall, an dem
  // sich beide frueher widersprachen: 51 Emojis = 51 Zeichen, aber 102
  // UTF-16-Einheiten.
  const titel = emoji.repeat(51);
  assert.equal(titel.length, 102);
  assert.equal(U.zaehleTitelZeichen(titel), 51);
  assert.equal(S.pruefeTitel(titel).ok, true, 'der Dienst nimmt ihn an');
  assert.deepEqual(U.pruefeGrenzen({ kennung: 'k', titel, beschreibung: 'x' }), [],
    'und der Uploader auch');

  // Die Grenze liegt bei beiden bei 100 Codepunkten.
  assert.equal(S.pruefeTitel(emoji.repeat(100)).ok, true);
  assert.equal(S.pruefeTitel(emoji.repeat(101)).code, 'titel_zu_lang');
  assert.deepEqual(U.pruefeGrenzen({ kennung: 'k', titel: emoji.repeat(100), beschreibung: 'x' }), []);
  assert.equal(U.pruefeGrenzen(
    { kennung: 'k', titel: emoji.repeat(101), beschreibung: 'x' }).length, 1);

  // Und der Uploader hat keine zweite Zaehlstelle mehr.
  const quelltext = fs.readFileSync(UPLOADER_SKRIPT, 'utf8');
  const code = quelltext.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.ok(!/titel\.length/.test(code), 'titel.length zaehlt UTF-16-Einheiten');
  assert.ok(!/s\.titel\.length/.test(code));
});

test('N9: die Seite zaehlt im Browser mit Array.from -- also auch Codepunkte', () => {
  const ordner = wegwerfordner();
  const bericht = {
    quelle: '<erfunden>', aufnahme: AUFNAHME, wurzel: ordner, plattenpruefung: true,
    kopfMaengel: [], eintraege: [], eintraegeGeprueft: true, verlauf: [],
    angenommen: 0, abgelehnt: 0, maengelGesamt: 0, hinweiseGesamt: 0,
    angenommenMitHinweis: 0, status: 'angenommen',
  };
  const sitzung = S.baueSitzung({ bericht, eingabeText: '{}', aufnahme: AUFNAHME,
    projektwurzel: ordner, port: 0 });
  const html = SEITE.baueSeite(sitzung);
  assert.match(html, /const n = Array\.from\(titel\.value\)\.length;/);
  assert.match(html, /von hoechstens 100 Zeichen/);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('N9: die Messung, an der die Zaehlweise haengt', (t) => {
  // Die Behauptung: YouTube zaehlt keine UTF-16-Einheiten. Der Beleg sind die
  // Titel, die es fuer diesen Kanal ANGENOMMEN hat. data/inventory.json steht
  // in .gitignore -- fehlt sie, wird der Test laut uebersprungen statt still
  // etwas anderes zu pruefen.
  const p = path.join(S.PROJEKTWURZEL, 'data', 'inventory.json');
  if (!fs.existsSync(p)) {
    t.skip('data/inventory.json fehlt (steht in .gitignore). Die Messung aus Bericht DR, ' +
      'N9 laesst sich hier nicht wiederholen: einmal `npm run inventory` laufen lassen.');
    return;
  }
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const titel = (d.items || []).map((v) => v.title).filter((x) => typeof x === 'string' && x);
  assert.ok(titel.length > 100, 'genug Titel fuer eine Aussage: ' + titel.length);

  let maxU16 = 0; let maxCp = 0; let ueber100u16 = 0;
  for (const x of titel) {
    if (x.length > maxU16) maxU16 = x.length;
    const cp = U.zaehleTitelZeichen(x);
    if (cp > maxCp) maxCp = cp;
    if (x.length > 100) ueber100u16 += 1;
  }
  // Es gibt Titel mit mehr als 100 UTF-16-Einheiten. Waeren die gezaehlt,
  // gaebe es sie nicht. Damit ist die Frage entschieden.
  assert.ok(ueber100u16 > 0,
    'kein Titel ueber 100 UTF-16-Einheiten -- dann traegt die Messung nicht mehr');
  assert.ok(maxU16 > 100);
  // In Codepunkten wird die 100 nie ueberschritten.
  assert.equal(maxCp <= U.TITEL_MAX_ZEICHEN, true,
    'ein Titel mit mehr als 100 Codepunkten wuerde die Zaehlweise widerlegen: ' + maxCp);
});

// ---------------------------------------------------------------------------
// Die Seite: was sie tut und was sie nicht entscheidet
// ---------------------------------------------------------------------------

test('die Seite entscheidet nicht selbst, ob Schritt 3 gehen darf', () => {
  const ordner = wegwerfordner();
  const bericht = {
    quelle: '<erfunden>', aufnahme: AUFNAHME, wurzel: ordner, plattenpruefung: true,
    kopfMaengel: [], eintraege: [], eintraegeGeprueft: true, verlauf: [],
    angenommen: 0, abgelehnt: 0, maengelGesamt: 0, hinweiseGesamt: 0,
    angenommenMitHinweis: 0, status: 'angenommen',
  };
  const sitzung = S.baueSitzung({ bericht, eingabeText: '{}', aufnahme: AUFNAHME,
    projektwurzel: ordner, port: 0 });
  const html = SEITE.baueSeite(sitzung);

  // Der Knopf ist gesperrt, WEIL der Dienst das sagt (k.schritt3.bereit) --
  // und zusaetzlich, solange die Vorschau nicht gelesen wurde.
  assert.match(html, /const serverBereit = k\.schritt3 && k\.schritt3\.bereit;/);
  assert.match(html, /s3\.disabled = !serverBereit \|\| !vorschauGelesen;/);
  assert.match(html, /<button id="schritt3" class="gross scharf" disabled>/,
    'gesperrt schon im ausgelieferten Markup');
  // Die Seite rechnet keine Pruefsumme und kein Ergebnis nach.
  assert.ok(!/createHash|sha256\(/.test(html));
  // Und sie liefert kein zweites Bestaetigungswort mit.
  assert.ok(!html.includes(U.BESTAETIGUNGSWORT),
    'das getippte Wort gehoert in den Terminalweg und nicht auf die Seite');
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('die Vorschau wird in Bloecke geschnitten, nicht als Klumpen gezeigt', () => {
  const ordner = wegwerfordner();
  const bericht = {
    quelle: '<erfunden>', aufnahme: AUFNAHME, wurzel: ordner, plattenpruefung: true,
    kopfMaengel: [], eintraege: [], eintraegeGeprueft: true, verlauf: [],
    angenommen: 0, abgelehnt: 0, maengelGesamt: 0, hinweiseGesamt: 0,
    angenommenMitHinweis: 0, status: 'angenommen',
  };
  const sitzung = S.baueSitzung({ bericht, eingabeText: '{}', aufnahme: AUFNAHME,
    projektwurzel: ordner, port: 0 });
  const html = SEITE.baueSeite(sitzung);
  assert.match(html, /v\.text\.split\(\/\\n=\+\\n\/\)/, 'geschnitten an den Trennzeilen');
  // Jeder Block geht ueber textContent in den Baum -- el() setzt textContent.
  assert.match(html, /block\.append\(el\('pre', null, teil/);
  // Und der scharfe Knopf bleibt gesperrt, bis die Vorschau durchgelaufen ist.
  assert.match(html, /if \(!vorschauGelesen\) \{ vorschauGelesen = true; pruefeGelesen\(\); \}/);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('der Dienst schreibt die Ermaechtigung atomar und nur unter data/ermaechtigungen', () => {
  const w = wegwerfordner();
  const zufall = U.neuerZufall();
  const pfad = U.ermaechtigungPfad(w, zufall);
  assert.match(pfad.replace(/\\/g, '/'), /\/data\/ermaechtigungen\/ermaechtigung-[0-9a-f]{64}\.json$/);
  S.schreibeErmaechtigung(pfad, { a: 1 });
  assert.equal(fs.readFileSync(pfad, 'utf8'), JSON.stringify({ a: 1 }, null, 2) + '\n');
  // Keine Temporaerdatei bleibt liegen.
  const drin = fs.readdirSync(path.dirname(pfad));
  assert.deepEqual(drin, [path.basename(pfad)]);
  // Aus etwas, das kein Zufallswert ist, wird kein Dateiname gebaut.
  for (const boese of ['..', '', 'x', crypto.randomBytes(31).toString('hex'), null]) {
    assert.throws(() => U.ermaechtigungPfad(w, boese), /64 Hexziffern/, JSON.stringify(boese));
  }
  fs.rmSync(w, { recursive: true, force: true });
});
