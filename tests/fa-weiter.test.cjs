'use strict';

// ---------------------------------------------------------------------------
// FA: WEITERSCHALTEN OHNE TERMINAL (Vertrag 11.7)
// ---------------------------------------------------------------------------
//
// Der erste echte Lauf am 05.09.2026 brauchte drei Terminalstarts. Den ersten
// nimmt der Knopf im Compositor ab (EZ). Diese Datei deckt die anderen beiden:
// nach dem Ende eines Laufs schaltet ein Knopf auf die naechste Seite weiter,
// ohne Strg+C und ohne Befehl.
//
// DER GEFAEHRLICHE TEIL IST DIE ABLOESUNG SELBST -- ein Prozess startet seinen
// Nachfolger und beendet sich dann. Zwei Prozesse wollen dieselbe Sperre und
// denselben Port, und zwei der drei moeglichen Fehlschlaege sehen auf dem
// Bildschirm gleich aus. Was auf keinen Fall herauskommen darf: ein Zustand,
// in dem beide weg sind.
//
// ACHT NACHWEISE, und jeder so, dass die Sicherung dabei ZUSCHNAPPT:
//
//   N1  DANACH LAEUFT GENAU EINER. Mit echten Prozessen, echten Sperrdateien
//       und echten Ports, vor und nach der Abloesung gezaehlt. Dazu die
//       Gegenprobe: dieselbe Pruefung an einer Lage, in der beide am Leben
//       geblieben waeren -- sie muss fallen.
//   N2  DIE SPERRE GEHT SAUBER UEBER. Erst der SCHADEN in den beiden falschen
//       Reihenfolgen, gemessen an echten Prozessen. Dann die richtige, mit
//       einer Abtastung der Sperrdatei waehrend der Uebergabe.
//   N3  SCHEITERT DER NACHFOLGER, BLEIBT DER ALTE AM LEBEN und sagt es mit
//       eigener Meldung. Vorgefuehrt, indem der Start des Nachfolgers
//       absichtlich scheitert.
//   N4  DER KNOPF ERSCHEINT ERST NACH DEM ENDE-KASTEN. Am ausgefuehrten
//       Skript der Seite und an der Antwort des Dienstes.
//   N5  ER SCHALTET WEITER, ER VEROEFFENTLICHT NICHT. Mit der Schreibfalle und
//       der Netzfalle belegt.
//   N6  DIE SHORTS-LINIE IST UNVERAENDERT. Byte fuer Byte gegen 0805769.
//   N7  WAS DER MUTATIONSLAUF GEFUNDEN HAT.
//   N8  DIE ZUSAGEN, DIE AN ZAHLEN HAENGEN -- und zwar an dieser Stelle
//       zusammengefasst, damit eine neue Route oder ein neuer Kindprozess
//       nicht nur in einer fremden Testdatei auffaellt.
//
// KEIN TEST HIER MACHT EINEN NETZAUFRUF. N5 rechnet das nach, statt es zu
// behaupten.
//
// DIE TESTS MIT ECHTEN PROZESSEN LAUFEN AUF DER ECHTEN PROJEKTWURZEL, und das
// geht nicht anders: der Nachfolger loest seine Wurzel selbst aus dem Ort
// SEINER Datei auf (das ist die Zusage -- ein Konfigurationswert koennte auf
// ein anderes Programm zeigen), und POST /weiter weist eine fremde Wurzel
// ohnehin ab. Sie benutzen darum einen Aufnahmenamen, den es nicht gibt, und
// raeumen ihre Sperrdatei hinterher weg. Geschrieben wird dabei nichts ausser
// dieser einen Datei; N5 zaehlt es nach.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const { spawn, spawnSync } = require('node:child_process');

const S = require('../src/upload/freigabe-server.js');
const SEITE = require('../src/upload/freigabe-seite.js');

const WURZEL = path.join(__dirname, '..');
const SERVER = path.join(WURZEL, 'src', 'upload', 'freigabe-server.js');

// Aufnahmenamen, die es nicht gibt, und je Nachweis ein eigener: zwei Tests,
// die sich einen teilen, teilen sich auch eine Sperrdatei.
const A_N1 = '2026-11-21 07-11-01';
const A_N2A = '2026-11-21 07-11-02';
const A_N2B = '2026-11-21 07-11-03';
const A_N2C = '2026-11-21 07-11-04';
const A_N3 = '2026-11-21 07-11-05';
const A_N5 = '2026-11-21 07-11-06';

// ---------------------------------------------------------------------------
// WERKZEUG
// ---------------------------------------------------------------------------

function freierPort() {
  return new Promise((fertig) => {
    const s = net.createServer();
    s.listen(0, S.HOST, () => {
      const p = s.address().port;
      s.close(() => fertig(p));
    });
  });
}

function schlaf(ms) { return new Promise((f) => setTimeout(f, ms)); }

function sperrpfad(aufnahme) {
  return S.sperrPfad(WURZEL, aufnahme, S.MODUS_LONGFORM);
}

function raeumeSperre(aufnahme) {
  try { fs.unlinkSync(sperrpfad(aufnahme)); } catch (e) { /* war nicht da */ }
}

// Wer haelt diesen Port? netstat, ueber DIE Funktion des Dienstes -- eine
// zweite Fassung waere eine zweite Vorstellung davon, was "belegt" heisst.
function haelter(port) {
  const p = S.haelterDesPorts(port);
  assert.ok(p !== null, 'netstat lief nicht -- dieser Nachweis kann so nicht laufen');
  return p.map(Number).sort((a, b) => a - b);
}

// DIE PRUEFUNG STEHT EINMAL. Der Nachweis und seine Gegenprobe rufen dieselbe
// Funktion; eine zweite, die ihr nur aehnlich saehe, sagte nichts ueber die
// erste. Genau so ist in EP-N4 eine Abwehr tot geworden.
function pruefeGenauEiner({ portHalter, sperrePid, erwartet, wobei }) {
  assert.deepEqual(portHalter, [erwartet],
    wobei + ': auf dem Port lauschen ' + JSON.stringify(portHalter) + ' statt allein ' +
    erwartet + '. Zwei heisst Doppelbetrieb, null heisst: es ist beides weg.');
  assert.equal(sperrePid, erwartet,
    wobei + ': die Sperrdatei nennt ' + JSON.stringify(sperrePid) + ' statt ' + erwartet);
}

function sperrePidVon(aufnahme) {
  const g = S.leseSperre(sperrpfad(aufnahme));
  return g.gelesen ? g.daten.pid : null;
}

// Ein Vorgaenger IM TESTPROZESS: echte Sperre, echter Port, echte Sitzung mit
// einem beendeten Lauf. Er dient den Nachweisen, die den Nachfolger
// beobachten; N1 braucht einen eigenen Prozess und bekommt ihn unten.
async function baueVorgaenger(aufnahme) {
  const port = await freierPort();
  const sperre = S.nimmSperre({ projektwurzel: WURZEL, aufnahme, modus: S.MODUS_LONGFORM });
  assert.ok(sperre.ok, 'die Sperre war schon belegt: ' + JSON.stringify(sperre.leben));
  const sitzung = S.baueLongformSitzung({
    aufnahme, projektwurzel: WURZEL, port,
    trocken: { befehl: 'node erfunden', code: 1, fehler: null, aus: 'VORSCHAU', err: '',
      befund: null },
  });
  // Ein Lauf, der zu Ende ist -- das ist die Lage, in der es den Knopf gibt.
  sitzung.lauf = { laeuft: false, gestartet_am: 'x', zeilen: [], befehl: null,
    ende: { code: 0, signal: null, beendet_am: 'y', ermaechtigung_noch_da: false } };
  const dienst = S.baueDienst(sitzung);
  const verbindungen = new Set();
  dienst.on('connection', (s) => {
    verbindungen.add(s);
    s.on('close', () => verbindungen.delete(s));
  });
  await new Promise((f) => dienst.listen(port, S.HOST, f));
  S.traegeSperrePortNach(sperre, port);
  return {
    port, sperre, sitzung, dienst, verbindungen,
    async weg() {
      await new Promise((f) => { dienst.close(() => f()); for (const s of verbindungen) s.destroy(); });
      S.gibSperreFrei(sperre);
      raeumeSperre(aufnahme);
    },
  };
}

// Der ECHTE Nachfolger als eigener Prozess -- dieselbe Argumentliste, die
// abloesungsArgumente() baut, und EIN Argument mehr: --no-browser.
//
// WARUM DAS EINE MEHR: der Nachfolger oeffnet in Wirklichkeit ein
// Browserfenster, und das ist der Sinn des Knopfes (der Mensch soll die
// naechste Seite sehen). Ein Testlauf, der bei jedem `npm test` Fenster
// aufreisst, ist keiner, den jemand laufen laesst. Dass die ECHTE Liste dieses
// Argument NICHT traegt, prueft N8 gegen den Quelltext -- die Abweichung steht
// also hier UND wird drueben festgenagelt.
function starteEchtenNachfolger({ aufnahme, port, vorgaengerPid, sammle, cwd = WURZEL,
  ohneSchluessel = [] }) {
  const argumente = S.abloesungsArgumente({ aufnahme, port, pid: vorgaengerPid })
    .concat(['--no-browser']);
  // `ohneSchluessel` nimmt Eintraege aus der Umgebung heraus. Sie muessen an
  // ZWEI Stellen weg: aus process.env (der Testprozess hat die .env beim
  // require geladen, und der Kindprozess erbt sie) UND aus der cwd (dotenv
  // holte sie sonst aus der .env dort zurueck). Wer nur eines von beiden tut,
  // baut einen Fehlschlag, der nicht eintritt.
  const umgebung = Object.assign({}, process.env);
  for (const k of ohneSchluessel) delete umgebung[k];
  const kind = spawn(process.execPath, argumente,
    { cwd, env: umgebung, stdio: ['ignore', 'pipe', 'pipe'] });
  const stand = { lebt: true, code: null, signal: null, fehler: null, text: '' };
  for (const strom of [kind.stdout, kind.stderr]) {
    strom.setEncoding('utf8');
    strom.on('data', (s) => { stand.text += s; if (sammle) sammle(s); });
  }
  kind.on('error', (e) => {
    stand.lebt = false; stand.fehler = e.code || e.message;
  });
  kind.on('exit', (code, signal) => { stand.lebt = false; stand.code = code; stand.signal = signal; });
  return { kind, stand, argumente };
}

async function warteBis(bedingung, grenzeMs, was) {
  const bis = Date.now() + grenzeMs;
  while (Date.now() < bis) {
    if (bedingung()) return true;
    await schlaf(50);
  }
  assert.fail('nicht eingetreten in ' + grenzeMs + ' ms: ' + was);
  return false;
}

// ===========================================================================
// NACHWEIS 1: DANACH LAEUFT GENAU EINER -- NICHT ZWEI, NICHT NULL
// ===========================================================================
//
// Der Vorgaenger ist hier ein EIGENER PROZESS und nicht der Testprozess: nur
// so laesst sich "und der Alte ist danach wirklich weg" ueberhaupt zaehlen.
// Er faehrt die PRODUKTIONSFOLGE -- baueAbloesungsLage() und
// fuehreAbloesung() --, dieselben zwei Funktionen, die starteLongform()
// aufruft, und beendet sich bei Erfolg wie dort mit 0.

// Die Startoptionen des Nachfolgers, WOERTLICH so, wie sie in der Produktion
// stehen. FA-N8 haelt beide gegeneinander.
const NACHFOLGER_OPTIONEN = "{ stdio: 'inherit', windowsHide: true, detached: true }";

const VORGAENGER_SKRIPT = `
'use strict';
const S = require(${JSON.stringify(SERVER.split('\\').join('/'))});
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [, , aufnahme, portRoh, losPfad] = process.argv;
const port = Number(portRoh);
const sage = (o) => console.log('##' + JSON.stringify(o));

(async () => {
  const sperre = S.nimmSperre({ projektwurzel: ${JSON.stringify(WURZEL.split('\\').join('/'))},
    aufnahme, modus: 'longform' });
  if (!sperre.ok) { sage({ was: 'sperre-belegt' }); process.exit(9); }
  const sitzung = S.baueLongformSitzung({ aufnahme,
    projektwurzel: ${JSON.stringify(WURZEL.split('\\').join('/'))}, port,
    trocken: { befehl: 'node erfunden', code: 1, fehler: null, aus: 'V', err: '', befund: null } });
  sitzung.lauf = { laeuft: false, gestartet_am: 'x', zeilen: [], befehl: null,
    ende: { code: 0, signal: null, beendet_am: 'y', ermaechtigung_noch_da: false } };
  const dienst = S.baueDienst(sitzung);
  const verbindungen = new Set();
  dienst.on('connection', (s) => { verbindungen.add(s); s.on('close', () => verbindungen.delete(s)); });
  await new Promise((f) => dienst.listen(port, S.HOST, f));
  S.traegeSperrePortNach(sperre, port);
  sage({ was: 'bereit', pid: process.pid, port });

  while (!fs.existsSync(losPfad)) await new Promise((f) => setTimeout(f, 50));

  const lage = S.baueAbloesungsLage({ dienst, verbindungen, sperre, aufnahme,
    projektwurzel: ${JSON.stringify(WURZEL.split('\\').join('/'))}, port,
    melde: (art, z) => sage({ was: 'melde', zeile: z }),
    beiPid: (p) => sage({ was: 'nachfolger', pid: p }) });
  // Das EINE Argument mehr, aus demselben Grund wie in starteEchtenNachfolger.
  let stand = { lebt: true, code: null, signal: null, fehler: null };
  lage.starteNachfolger = () => {
    const argumente = S.abloesungsArgumente({ aufnahme, port, pid: process.pid })
      .concat(['--no-browser']);
    const kind = spawn(process.execPath, argumente,
      { stdio: 'inherit', windowsHide: true, detached: true });
    kind.on('error', (e) => { stand = { lebt: false, code: null, signal: null, fehler: e.code }; });
    kind.on('exit', (c, sg) => { stand = { lebt: false, code: c, signal: sg, fehler: null }; });
    kind.unref();
    sage({ was: 'nachfolger', pid: kind.pid });
    return { pid: kind.pid, befehl: 'node …' };
  };
  lage.nachfolgerStand = () => stand;

  const ergebnis = await S.fuehreAbloesung(lage);
  sage({ was: 'ergebnis', ergebnis });
  if (ergebnis.gelungen) process.exit(0);
  process.exit(1);
})().catch((e) => { sage({ was: 'kaputt', text: String(e && e.stack) }); process.exit(8); });
`;

test('FA-N1: nach der Abloesung laeuft GENAU EINER -- gezaehlt an Prozessen und am Port',
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-n1-'));
    const skript = path.join(tmp, 'vorgaenger.cjs');
    const los = path.join(tmp, 'los.txt');
    fs.writeFileSync(skript, VORGAENGER_SKRIPT);
    raeumeSperre(A_N1);
    const port = await freierPort();
    const zeilen = [];
    let rest = '';
    let ende = null;
    // cwd ist die Projektwurzel: der Nachfolger erbt sie, und dort liegt die
    // .env, aus der der Arbeiter seine Ordner holt. Genau so laeuft es in
    // Wirklichkeit -- der Compositor startet den Dienst mit derselben cwd.
    const vor = spawn(process.execPath, [skript, A_N1, String(port), los],
      { cwd: WURZEL, stdio: ['ignore', 'pipe', 'pipe'] });
    vor.stdout.setEncoding('utf8');
    vor.stderr.setEncoding('utf8');
    vor.stdout.on('data', (s) => {
      rest += s;
      const teile = rest.split('\n');
      rest = teile.pop();
      for (const z of teile) if (z.startsWith('##')) zeilen.push(JSON.parse(z.slice(2)));
    });
    vor.stderr.on('data', () => {});
    vor.on('exit', (code) => { ende = code; });

    let nachfolgerPid = null;
    try {
      await warteBis(() => zeilen.some((z) => z.was === 'bereit'), 20000,
        'der Vorgaenger meldet sich bereit');
      const bereit = zeilen.find((z) => z.was === 'bereit');

      // ---- VORHER ZAEHLEN ------------------------------------------------
      pruefeGenauEiner({
        portHalter: haelter(port), sperrePid: sperrePidVon(A_N1),
        erwartet: bereit.pid, wobei: 'vor der Abloesung',
      });

      // ---- ABLOESUNG ANSTOSSEN -------------------------------------------
      fs.writeFileSync(los, 'los');
      await warteBis(() => ende !== null, 90000, 'der Vorgaenger beendet sich');

      const ergebnis = zeilen.find((z) => z.was === 'ergebnis');
      assert.ok(ergebnis, 'der Vorgaenger hat kein Ergebnis gemeldet: ' +
        JSON.stringify(zeilen));
      assert.equal(ergebnis.ergebnis.gelungen, true,
        'die Abloesung ist gescheitert: ' + JSON.stringify(ergebnis.ergebnis, null, 2));
      assert.equal(ende, 0, 'der Vorgaenger endet mit ' + ende + ' statt mit 0');
      nachfolgerPid = ergebnis.ergebnis.nachfolger_pid;

      // ---- NACHHER ZAEHLEN -----------------------------------------------
      // Der Alte ist wirklich weg -- nicht "hat gesagt, er gehe".
      assert.equal(S.prozessLebt(bereit.pid).lebt, false,
        'der Vorgaenger (PID ' + bereit.pid + ') lebt noch, obwohl er sich beendet hat');
      assert.equal(S.prozessLebt(nachfolgerPid).lebt, true,
        'der Nachfolger (PID ' + nachfolgerPid + ') lebt nicht');
      pruefeGenauEiner({
        portHalter: haelter(port), sperrePid: sperrePidVon(A_N1),
        erwartet: nachfolgerPid, wobei: 'nach der Abloesung',
      });

      // ---- DIE GEGENPROBE: DIESELBE PRUEFUNG AN EINER LAGE, IN DER BEIDE --
      //      AM LEBEN GEBLIEBEN WAEREN. Ein Test, der nur zeigt, dass etwas
      //      geht, hat nichts gezeigt.
      const zweiAmLeben = () => pruefeGenauEiner({
        portHalter: [bereit.pid, nachfolgerPid].sort((a, b) => a - b),
        sperrePid: nachfolgerPid, erwartet: nachfolgerPid, wobei: 'Gegenprobe (zwei)',
      });
      assert.throws(zweiAmLeben, /Doppelbetrieb/,
        'die Pruefung laesst zwei Lauscher durch -- dann prueft sie nichts');
      const keinerAmLeben = () => pruefeGenauEiner({
        portHalter: [], sperrePid: null, erwartet: nachfolgerPid, wobei: 'Gegenprobe (null)',
      });
      assert.throws(keinerAmLeben, /es ist beides weg/,
        'die Pruefung laesst einen leeren Port durch -- dann prueft sie nichts');
    } finally {
      if (ende === null) { try { vor.kill(); } catch (e) { /* egal */ } }
      if (nachfolgerPid) { try { process.kill(nachfolgerPid); } catch (e) { /* egal */ } }
      await schlaf(400);
      raeumeSperre(A_N1);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

// ===========================================================================
// NACHWEIS 2: DIE SPERRE GEHT SAUBER UEBER
// ===========================================================================
//
// ERST DER SCHADEN. Die Abloesung wird zweimal in der falschen Reihenfolge
// gebaut, mit echten Prozessen, und es wird gemessen, was dabei herauskommt.

test('FA-N2 (Schaden A): haelt der Alte die Sperre noch, stirbt der Neue an ihr', async () => {
  // DIE FALSCHE REIHENFOLGE A: der Nachfolger wird OHNE --abloesung-von=
  // gestartet, also ohne das Warten. Er greift sofort nach der Sperre, die der
  // Alte noch haelt.
  //
  // WAS DABEI HERAUSKOMMT: er stirbt mit 1 und der Meldung ueber die laufende
  // Sitzung. Haette der Alte sich danach wie geplant beendet -- und das ist
  // genau der Ablauf, den man baut, wenn man nicht nachsieht --, liefe
  // anschliessend NICHTS mehr.
  const v = await baueVorgaenger(A_N2A);
  let kind = null;
  try {
    const argumente = [SERVER, '--modus=longform', '--aufnahme=' + A_N2A,
      '--port=' + v.port, '--no-browser'];
    const lauf = spawnSync(process.execPath, argumente,
      { cwd: WURZEL, encoding: 'utf8', timeout: 60000 });
    const text = (lauf.stdout || '') + (lauf.stderr || '');
    assert.equal(lauf.status, S.EXIT_ABBRUCH,
      'der Nachfolger endet mit ' + lauf.status + ' statt ' + S.EXIT_ABBRUCH + ':\n' + text);
    assert.ok(text.includes('laeuft bereits eine Freigabesitzung'),
      'er nennt nicht die laufende Sitzung:\n' + text);
    assert.ok(text.includes('PID ' + process.pid) || text.includes(String(process.pid)),
      'er nennt nicht, WER sie haelt:\n' + text);

    // UND DAS IST DER SCHADEN, ausgesprochen: nach diesem Fehlschlag haelt
    // weiterhin der Alte alles. Wer jetzt beendet, laesst nichts zurueck.
    assert.equal(sperrePidVon(A_N2A), process.pid);
    assert.deepEqual(haelter(v.port), [process.pid]);
  } finally {
    if (kind) { try { kind.kill(); } catch (e) { /* egal */ } }
    await v.weg();
  }
});

test('FA-N2 (Schaden B): erst die Sperre und dann der Port -- der Neue stirbt am Port',
  async () => {
    // DIE FALSCHE REIHENFOLGE B, und sie ist die heimtueckischere: der
    // Nachfolger WARTET brav, der Alte gibt die Sperre frei -- aber er haelt
    // den Port noch. Der Nachfolger nimmt die Sperre, rechnet seinen
    // Trockenlauf und stirbt erst DANACH an EADDRINUSE.
    //
    // WAS DABEI HERAUSKOMMT: der Nachfolger ist tot, und die Sperre hat in der
    // Zwischenzeit IHM gehoert. Der Alte muss sie sich zurueckholen; haette er
    // sich stattdessen beendet, liefe nichts mehr, und die Sperrdatei laege
    // verwaist herum.
    const v = await baueVorgaenger(A_N2B);
    let nach = null;
    try {
      nach = starteEchtenNachfolger({
        aufnahme: A_N2B, port: v.port, vorgaengerPid: process.pid });
      await warteBis(() => nach.stand.text.includes('warte darauf'), 20000,
        'der Nachfolger meldet, dass er wartet');
      // Der Alte gibt NUR die Sperre frei und behaelt den Port -- die falsche
      // Reihenfolge, von Hand gebaut.
      const frei = S.gibSperreFrei(v.sperre);
      assert.equal(frei.geloescht, true, frei.grund);

      await warteBis(() => !nach.stand.lebt, 90000, 'der Nachfolger beendet sich');
      assert.equal(nach.stand.code, S.EXIT_ABBRUCH,
        'er endet mit ' + nach.stand.code + ':\n' + nach.stand.text);
      assert.ok(nach.stand.text.includes('ist belegt'),
        'er nennt nicht den belegten Port:\n' + nach.stand.text);
      // Er HATTE die Sperre -- der Beleg steht in seiner eigenen Ausgabe.
      assert.ok(nach.stand.text.includes('Abloesung: die Sperre ist frei'),
        'er hat die Sperre gar nicht erst genommen:\n' + nach.stand.text);
      // Und danach ist sie weg, weil er sie beim Abbruch freigegeben hat: der
      // Alte lauscht auf einem Port, dessen Sperre NIEMAND haelt.
      assert.equal(sperrePidVon(A_N2B), null,
        'die Sperrdatei liegt noch da: ' + JSON.stringify(S.leseSperre(sperrpfad(A_N2B))));
      assert.deepEqual(haelter(v.port), [process.pid],
        'der Alte lauscht nicht mehr -- dann ist in dieser Lage gar nichts mehr da');
    } finally {
      if (nach && nach.stand.lebt) { try { nach.kind.kill(); } catch (e) { /* egal */ } }
      v.sperre.fd = undefined;
      await new Promise((f) => {
        v.dienst.close(() => f());
        for (const s of v.verbindungen) s.destroy();
      });
      raeumeSperre(A_N2B);
    }
  });

test('FA-N2 (richtig): erst der Port, dann die Sperre -- und sie wird nie doppelt gehalten',
  async () => {
    // DIE RICHTIGE REIHENFOLGE, und die Abtastung dazu: waehrend der ganzen
    // Uebergabe wird die Sperrdatei alle 20 ms gelesen und die Prozessnummer
    // darin aufgeschrieben. Was dabei herauskommen MUSS, ist genau eine Folge:
    //
    //   [Vorgaenger …]  ->  [niemand …]  ->  [Nachfolger …]
    //
    // Kein Zwischenschritt mit einer dritten Nummer, kein Rueckfall, und vor
    // allem: KEIN Abschnitt, in dem der Nachfolger an ihr scheitert -- er
    // wartet ja darauf.
    const v = await baueVorgaenger(A_N2C);
    const folge = [];
    const wechsel = [];
    const takt = setInterval(() => {
      const p = sperrePidVon(A_N2C);
      if (folge.length === 0 || folge[folge.length - 1] !== p) {
        folge.push(p);
        wechsel.push(Date.now());
      }
    }, 20);
    let nach = null;
    try {
      const lage = S.baueAbloesungsLage({
        dienst: v.dienst, verbindungen: v.verbindungen, sperre: v.sperre,
        aufnahme: A_N2C, projektwurzel: WURZEL, port: v.port,
        melde: () => {}, beiPid: () => {},
      });
      lage.starteNachfolger = () => {
        nach = starteEchtenNachfolger({
          aufnahme: A_N2C, port: v.port, vorgaengerPid: process.pid });
        return { pid: nach.kind.pid, befehl: 'node …' };
      };
      lage.nachfolgerStand = () => nach.stand;

      const ergebnis = await S.fuehreAbloesung(lage);
      clearInterval(takt);
      assert.equal(ergebnis.gelungen, true, JSON.stringify(ergebnis, null, 2));

      // DIE FOLGE. Sie steht hier als Ganzes und nicht als "enthaelt": ein
      // Zwischenzustand, der hier nicht steht, faellt auf.
      assert.deepEqual(folge, [process.pid, null, nach.kind.pid],
        'die Sperre ist nicht sauber uebergegangen. Beobachtet wurde: ' +
        JSON.stringify(folge) + ' -- erwartet: der Vorgaenger, dann niemand, dann der ' +
        'Nachfolger.');

      // KEIN FENSTER, IN DEM SIE DOPPELT GEHALTEN WIRD: die Datei kann nur
      // eine Nummer tragen, und der Weg dorthin ist 'wx'. Was hier zusaetzlich
      // gezeigt wird, ist der ANDERE Fall -- der Nachfolger ist an ihr NICHT
      // gescheitert, sondern hat gewartet.
      assert.ok(nach.stand.text.includes('warte darauf, dass PID ' + process.pid),
        'der Nachfolger hat nicht gewartet:\n' + nach.stand.text);
      assert.ok(!nach.stand.text.includes('laeuft bereits'),
        'der Nachfolger ist an der Sperre gescheitert:\n' + nach.stand.text);
      pruefeGenauEiner({
        portHalter: haelter(v.port), sperrePid: sperrePidVon(A_N2C),
        erwartet: nach.kind.pid, wobei: 'nach der richtigen Reihenfolge',
      });

      // DAS FENSTER, IN DEM SIE NIEMAND HAELT -- gemessen und nach oben
      // begrenzt. Es ist nicht wegzubauen (eine Sperre, die man weiterreicht,
      // ohne sie loszulassen, ist keine), aber es darf nicht wachsen: der
      // Nachfolger wartet im Takt von ABLOESUNG_TAKT_MS, also ist ein Takt
      // plus ein 'wx' die Obergrenze. Ein Fenster von Sekunden hiesse, dass er
      // gar nicht wartet, sondern etwas anderes tut.
      const luecke = wechsel[2] - wechsel[1];
      assert.ok(luecke >= 0 && luecke <= S.ABLOESUNG_TAKT_MS * 4,
        'das Fenster ohne Halter war ' + luecke + ' ms lang -- erwartet sind hoechstens ' +
        (S.ABLOESUNG_TAKT_MS * 4) + ' ms (ein Takt des Wartenden plus Zugriff). Beobachtet: ' +
        JSON.stringify(folge));
    } finally {
      clearInterval(takt);
      if (nach && nach.stand.lebt) { try { nach.kind.kill(); } catch (e) { /* egal */ } }
      await schlaf(400);
      try { v.dienst.close(); } catch (e) { /* schon zu */ }
      raeumeSperre(A_N2C);
    }
  });

test('FA-N2: die Frage "ist die Sperre des Vorgaengers frei" hat drei Antworten', () => {
  // Die Entscheidung des Wartenden, einzeln vorgefuehrt. Sie steht in EINER
  // Funktion, und jeder Zweig hat einen eigenen Satz -- zwei Lagen unter einem
  // Satz sind der Umriss jedes Fehlers dieser Reihe.
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-frei-'));
  try {
    const pfad = path.join(ordner, 'x.sperre.json');

    // 1. Weg -> frei.
    const weg = S.sperreFreiFuerNachfolger(pfad, 4242);
    assert.equal(weg.frei, true);
    assert.match(weg.grund, /ist weg/);

    // 2. Da, unser Vorgaenger, und er lebt -> NICHT frei.
    fs.writeFileSync(pfad, JSON.stringify({ pid: process.pid, port: 1 }));
    const lebt = S.sperreFreiFuerNachfolger(pfad, process.pid);
    assert.equal(lebt.frei, false);
    assert.match(lebt.grund, /haelt sie noch/);

    // 3. Da, unser Vorgaenger, aber tot -> frei (verwaist).
    let tot = 999999;
    while (tot > 900000 && S.prozessLebt(tot).lebt) tot -= 1;
    fs.writeFileSync(pfad, JSON.stringify({ pid: tot, port: 1 }));
    const verwaist = S.sperreFreiFuerNachfolger(pfad, tot);
    assert.equal(verwaist.frei, true);
    assert.match(verwaist.grund, /lebt nicht mehr/);

    // 4. Da, aber jemand DRITTES -> NICHT frei. Eine Sperre, die einem Dritten
    //    gehoert, wartet man nicht weg.
    fs.writeFileSync(pfad, JSON.stringify({ pid: process.pid, port: 1 }));
    const fremd = S.sperreFreiFuerNachfolger(pfad, tot);
    assert.equal(fremd.frei, false);
    assert.match(fremd.grund, /nicht unser Vorgaenger/);

    // 5. Unlesbar -> NICHT frei. Sie koennte halb geschrieben sein; im Zweifel
    //    wird gewartet. Das ist die Richtung, in der ein Irrtum eine Meldung
    //    kostet statt eines zweiten Dienstes.
    fs.writeFileSync(pfad, '{ das ist kein json');
    const kaputt = S.sperreFreiFuerNachfolger(pfad, process.pid);
    assert.equal(kaputt.frei, false);
    assert.match(kaputt.grund, /im Zweifel wird gewartet/);

    // Fuenf Lagen, fuenf verschiedene Saetze.
    const saetze = [weg.grund, lebt.grund, verwaist.grund, fremd.grund, kaputt.grund];
    assert.equal(new Set(saetze).size, 5);
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

test('FA-N2: laesst der Vorgaenger nicht los, geht der Nachfolger -- ohne etwas zu nehmen',
  () => {
    // Die Frist des Wartenden. Sie wird hier mit einer kurzen Grenze
    // vorgefuehrt, aber ueber DIESELBE Funktion, die der echte Start ruft.
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-frist-'));
    try {
      const wurzel = ordner;
      const aufnahme = A_N2C;
      const pfad = S.sperrPfad(wurzel, aufnahme, S.MODUS_LONGFORM);
      fs.mkdirSync(path.dirname(pfad), { recursive: true });
      fs.writeFileSync(pfad, JSON.stringify({ pid: process.pid, port: 1 }));
      let geschlafen = 0;
      const warten = S.warteAufVorgaengersSperre({
        projektwurzel: wurzel, aufnahme, modus: S.MODUS_LONGFORM, vorgaengerPid: process.pid,
        grenzeMs: 300, taktMs: 50, schlaf: () => { geschlafen += 1; },
      });
      assert.equal(warten.frei, false);
      assert.ok(geschlafen > 0, 'es wurde gar nicht gewartet');
      const meldung = S.meldeAbloesungWartenAbgelaufen(warten, aufnahme, process.pid);
      assert.match(meldung, /hat seine Sperre nicht losgelassen/);
      assert.match(meldung, /Dieser Start hat NICHTS genommen/);
      assert.match(meldung, /Der Vorgaenger laeuft mit grosser Wahrscheinlichkeit weiter/);
      // Und er wird NICHT als laufende Sitzung gedeutet -- sonst meldete der
      // Knopf der Gegenseite keinen Fehler (EK).
      assert.ok(!/laeuft bereits/.test(meldung), meldung);
    } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
  });

// ===========================================================================
// NACHWEIS 3: SCHEITERT DER NACHFOLGER, BLEIBT DER ALTE AM LEBEN
// ===========================================================================

test('FA-N3: scheitert der Start des Nachfolgers, wird NICHTS abgegeben', async () => {
  // Der billigste Fehlschlag, und der haeufigste: der Nachfolger laesst sich
  // gar nicht erst starten. Hier wird er absichtlich herbeigefuehrt.
  const v = await baueVorgaenger(A_N3);
  try {
    const lage = S.baueAbloesungsLage({
      dienst: v.dienst, verbindungen: v.verbindungen, sperre: v.sperre,
      aufnahme: A_N3, projektwurzel: WURZEL, port: v.port,
      melde: () => {}, beiPid: () => {},
    });
    lage.starteNachfolger = () => { const e = new Error('kein node'); e.code = 'ENOENT'; throw e; };
    const ergebnis = await S.fuehreAbloesung(lage);

    assert.equal(ergebnis.gelungen, false);
    assert.equal(ergebnis.phase, 'anlauf');
    assert.deepEqual(ergebnis.abgegeben, { port: false, sperre: false },
      'es wurde etwas abgegeben, obwohl der Nachfolger nie lief');
    assert.match(ergebnis.grund, /nichts abgegeben/);
    // UND DER ALTE HAELT WIRKLICH NOCH ALLES -- gemessen, nicht behauptet.
    pruefeGenauEiner({
      portHalter: haelter(v.port), sperrePid: sperrePidVon(A_N3),
      erwartet: process.pid, wobei: 'nach dem gescheiterten Anlauf',
    });
    const meldung = S.meldeAbloesungGescheitert(ergebnis, A_N3, v.port, v.sperre.pfad);
    assert.match(meldung, /DIE ABLOESUNG HAT NICHT GEKLAPPT/);
    assert.match(meldung, /DIESER DIENST LAEUFT WEITER/);
    assert.match(meldung, /Es ist NICHT beides weg/);
  } finally { await v.weg(); }
});

test('FA-N3: stirbt der Nachfolger nach der Uebergabe, holt der Alte Sperre und Port zurueck',
  async () => {
    // Der teurere Fehlschlag: der Nachfolger laeuft an, der Alte gibt Port und
    // Sperre ab -- und dann stirbt der Nachfolger. Hier gemessen an einem
    // ECHTEN Nachfolger, den ein zweiter Halter des Ports zu Fall bringt.
    //
    // WAS HERAUSKOMMEN MUSS: der Alte lebt, hat Sperre UND Port wieder, und
    // sagt es mit einer eigenen Meldung.
    const v = await baueVorgaenger(A_N3);
    let nach = null;
    const aufraeumen = [];
    try {
      const lage = S.baueAbloesungsLage({
        dienst: v.dienst, verbindungen: v.verbindungen, sperre: v.sperre,
        aufnahme: A_N3, projektwurzel: WURZEL, port: v.port,
        melde: () => {}, beiPid: () => {},
      });
      // DER FEHLSCHLAG IST ECHT UND NICHT NACHGESTELLT: der Nachfolger laeuft
      // in einem Ordner ohne .env. Sein Trockenlauf findet damit den
      // Render-Ordner nicht, endet mit 2, und ein 2er hat keine Seite
      // (LONGFORM_CODES_MIT_SEITE) -- der Nachfolger bricht mit
      // meldeLongformOhneVorschau ab und gibt die Sperre wieder her.
      //
      // Das ist der Fehlschlag, der in Wirklichkeit droht: der Trockenlauf des
      // Nachfolgers liest die Lage NACH dem Upload, und die kann anders sein
      // als die davor. Er faellt hinter der Uebergabe -- der Alte hat da schon
      // alles abgegeben.
      const ohneEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-ohne-env-'));
      lage.starteNachfolger = () => {
        nach = starteEchtenNachfolger({
          aufnahme: A_N3, port: v.port, vorgaengerPid: process.pid, cwd: ohneEnv,
          ohneSchluessel: ['LONGFORM_RENDER_WURZEL'] });
        return { pid: nach.kind.pid, befehl: 'node …' };
      };
      lage.nachfolgerStand = () => nach.stand;

      const ergebnis = await S.fuehreAbloesung(lage);
      // Der Ordner war die cwd eines Prozesses, den Windows gerade erst
      // aufgibt -- er wird im finally weggeraeumt, wenn er sich raeumen laesst.
      aufraeumen.push(ohneEnv);

      assert.equal(ergebnis.gelungen, false, JSON.stringify(ergebnis, null, 2));
      assert.equal(ergebnis.abgegeben.sperre, true, 'er hat die Sperre nie abgegeben');
      assert.equal(ergebnis.abgegeben.port, true, 'er hat den Port nie abgegeben');
      // Der Nachfolger HATTE die Sperre und hat sie beim Abbruch hergegeben --
      // das steht in seiner eigenen Ausgabe.
      assert.ok(nach.stand.text.includes('kam nicht bis zum Lesen'),
        'der Nachfolger ist an etwas anderem gescheitert:\n' + nach.stand.text);
      // UND DER ALTE HAT ALLES ZURUECK.
      assert.equal(ergebnis.rueckholung.sperre.ok, true,
        'die Sperre kam nicht zurueck: ' + ergebnis.rueckholung.sperre.grund);
      assert.equal(ergebnis.rueckholung.port.ok, true,
        'der Port kam nicht zurueck: ' + ergebnis.rueckholung.port.grund);
      pruefeGenauEiner({
        portHalter: haelter(v.port), sperrePid: sperrePidVon(A_N3),
        erwartet: process.pid, wobei: 'nach der gescheiterten Abloesung',
      });
      assert.match(ergebnis.grund, /Nachfolger ist beendet/);

      const meldung = S.meldeAbloesungGescheitert(ergebnis, A_N3, v.port, v.sperre.pfad);
      assert.match(meldung, /DIE ABLOESUNG HAT NICHT GEKLAPPT/);
      assert.match(meldung, /Hochgeladen oder oeffentlich gestellt wurde bei alledem NICHTS/);
    } finally {
      if (nach && nach.stand.lebt) { try { nach.kind.kill(); } catch (e) { /* egal */ } }
      await schlaf(400);
      try { v.dienst.close(); } catch (e) { /* schon zu */ }
      S.gibSperreFrei(v.sperre);
      raeumeSperre(A_N3);
      for (const o of aufraeumen) {
        try { fs.rmSync(o, { recursive: true, force: true }); } catch (e) { /* haelt ihn noch */ }
      }
    }
  });

test('FA-N3: ohne Sperre wird kein Port geoeffnet, und es wird gesagt', async () => {
  // Der Zweig, in dem die Rueckholung nur halb gelingt: die Sperre gehoert
  // inzwischen jemand anderem. Dann macht der Alte seinen Port NICHT wieder
  // auf -- ein Dienst, der lauscht, ohne die Sperre zu halten, ist genau der
  // Doppelbetrieb, gegen den sie gebaut ist.
  const geschehen = [];
  const lage = {
    erwarteterPort: 4711,
    grenzen: { anlaufMs: 10, uebernahmeMs: 30, taktMs: 5 },
    jetzt: Date.now,
    schlaf: (ms) => new Promise((f) => setTimeout(f, ms)),
    melde: (art, z) => geschehen.push(z),
    starteNachfolger: () => ({ pid: 4242, befehl: 'node …' }),
    nachfolgerStand: () => ({ lebt: true, code: null, signal: null, fehler: null }),
    portFreigeben: async () => { geschehen.push('PORT-FREI'); },
    portZurueckholen: async () => { geschehen.push('PORT-ZURUECK'); return { ok: true }; },
    sperreFreigeben: () => { geschehen.push('SPERRE-FREI'); return { geloescht: true, grund: 'ok' }; },
    sperreZurueckholen: () => { geschehen.push('SPERRE-ZURUECK'); return { ok: false, grund: 'sie gehoert jetzt PID 5 -- er lebt' }; },
    sperreLesen: () => ({ gelesen: false, grund: 'nicht da' }),
  };
  const ergebnis = await S.fuehreAbloesung(lage);
  assert.equal(ergebnis.gelungen, false);
  assert.equal(ergebnis.rueckholung.sperre.ok, false);
  assert.equal(ergebnis.rueckholung.port.ok, false);
  assert.match(ergebnis.rueckholung.port.grund, /ohne die Sperre wird kein Port geoeffnet/);
  assert.ok(!geschehen.includes('PORT-ZURUECK'),
    'der Port wurde wieder geoeffnet, obwohl die Sperre einem anderen gehoert');

  const meldung = S.meldeAbloesungGescheitert(ergebnis, A_N3, 4711, 'irgendwo.json');
  assert.match(meldung, /HAELT NICHT MEHR ALLES/);
  assert.match(meldung, /beendet sich darum geordnet/);
  // Und die beiden Meldungen sind VERSCHIEDEN -- "ich lebe und halte alles"
  // und "ich gehe" duerfen nicht denselben Text tragen.
  const alles = S.meldeAbloesungGescheitert(
    { phase: 'anlauf', grund: 'x', nachfolger_pid: null, abgegeben: { port: false, sperre: false } },
    A_N3, 4711, 'irgendwo.json');
  assert.match(alles, /DIESER DIENST LAEUFT WEITER/);
  assert.notEqual(alles, meldung);
});

test('FA-N3: stirbt der Nachfolger IM ANLAUF, wird nichts abgegeben -- und nichts angefasst',
  async () => {
    // Der Zweig zwischen den beiden oben: der Nachfolger LAEUFT AN (der Start
    // wirft nicht), stirbt aber innerhalb des Anlauffensters. Dann darf der
    // Alte weder Port noch Sperre angefasst haben.
    //
    // DER MUTATIONSLAUF HAT DIESE SICHERUNG ALS TOT GEFUNDEN (M7): der Test
    // darueber laesst starteNachfolger WERFEN und trifft damit den
    // try/catch -- die Wachschleife selbst lief in keinem Test.
    const geschehen = [];
    let lebt = true;
    const ergebnis = await S.fuehreAbloesung({
      erwarteterPort: 4711,
      grenzen: { anlaufMs: 300, uebernahmeMs: 300, taktMs: 20 },
      jetzt: Date.now,
      schlaf: (ms) => new Promise((f) => setTimeout(f, ms)),
      melde: () => {},
      starteNachfolger: () => { setTimeout(() => { lebt = false; }, 60); return { pid: 4242, befehl: 'x' }; },
      nachfolgerStand: () => ({ lebt, code: 3, signal: null, fehler: null }),
      portFreigeben: async () => { geschehen.push('port-frei'); },
      portZurueckholen: async () => { geschehen.push('port-zurueck'); return { ok: true }; },
      sperreFreigeben: () => { geschehen.push('sperre-frei'); return { geloescht: true, grund: 'ok' }; },
      sperreZurueckholen: () => { geschehen.push('sperre-zurueck'); return { ok: true, grund: 'ok' }; },
      sperreLesen: () => ({ gelesen: false, grund: 'nicht da' }),
    });
    assert.equal(ergebnis.gelungen, false);
    assert.equal(ergebnis.phase, 'anlauf');
    assert.equal(ergebnis.nachfolger_pid, 4242);
    assert.deepEqual(ergebnis.abgegeben, { port: false, sperre: false });
    assert.deepEqual(geschehen, [],
      'im Anlauf wurde etwas angefasst: ' + geschehen.join(' -> '));
    assert.match(ergebnis.grund, /im Anlauf gestorben \(Rueckgabewert 3\)/);
    assert.match(ergebnis.grund, /nichts abgegeben/);
    // Und es gibt keine Rueckholung -- es war nichts zurueckzuholen.
    assert.equal(ergebnis.rueckholung, undefined);
  });

test('FA-N3: die Sperre faellt erst, wenn der Port WIRKLICH zu ist', async () => {
  // DIE REIHENFOLGE ALLEIN GENUEGT NICHT. Der Mutationslauf hat gezeigt (M8),
  // dass ein weggelassenes `await` vor portFreigeben() die Aufrufreihenfolge
  // unveraendert laesst -- der Port waere dann noch am Schliessen, waehrend
  // die Sperre schon faellt, und der Nachfolger liefe in ein EADDRINUSE.
  // Geprueft wird darum nicht die Reihenfolge der AUFRUFE, sondern die der
  // ABSCHLUESSE.
  let portZu = null;
  let sperreWeg = null;
  const ergebnis = await S.fuehreAbloesung({
    erwarteterPort: 4711,
    grenzen: { anlaufMs: 20, uebernahmeMs: 60, taktMs: 10 },
    jetzt: Date.now,
    schlaf: (ms) => new Promise((f) => setTimeout(f, ms)),
    melde: () => {},
    starteNachfolger: () => ({ pid: 4242, befehl: 'x' }),
    nachfolgerStand: () => ({ lebt: true, code: null, signal: null, fehler: null }),
    // Ein Port, der sich Zeit laesst -- wie einer, an dem noch eine Verbindung
    // haengt.
    portFreigeben: () => new Promise((f) => setTimeout(() => { portZu = Date.now(); f(); }, 120)),
    portZurueckholen: async () => ({ ok: true }),
    sperreFreigeben: () => { sperreWeg = Date.now(); return { geloescht: true, grund: 'ok' }; },
    sperreZurueckholen: () => ({ ok: true, grund: 'ok' }),
    sperreLesen: () => ({ gelesen: false, grund: 'nicht da' }),
  });
  assert.equal(ergebnis.gelungen, false);   // der Nachfolger nimmt sie hier nie
  assert.ok(portZu !== null, 'der Port wurde gar nicht freigegeben');
  assert.ok(sperreWeg !== null, 'die Sperre wurde gar nicht freigegeben');
  assert.ok(sperreWeg >= portZu,
    'die Sperre fiel ' + (portZu - sperreWeg) + ' ms BEVOR der Port wirklich zu war. Der ' +
    'Nachfolger wartet auf die Sperre und greift danach nach dem Port -- er liefe in ein ' +
    'EADDRINUSE.');
});

test('FA-N3: die Reihenfolge der Handgriffe steht fest -- Port vor Sperre, Sperre vor Port',
  async () => {
    // DIE REIHENFOLGE IST DIE SICHERUNG, und sie wird hier abgezaehlt statt
    // erklaert. Beim Uebergeben: erst der Port, dann die Sperre. Beim
    // Zurueckholen: erst die Sperre, dann der Port. Wer die beiden vertauscht,
    // faellt hier.
    const geschehen = [];
    const bau = (nachfolgerLebt) => ({
      erwarteterPort: 4711,
      grenzen: { anlaufMs: 10, uebernahmeMs: 30, taktMs: 5 },
      jetzt: Date.now,
      schlaf: (ms) => new Promise((f) => setTimeout(f, ms)),
      melde: () => {},
      starteNachfolger: () => { geschehen.push('START'); return { pid: 4242, befehl: 'x' }; },
      nachfolgerStand: () => ({ lebt: nachfolgerLebt(), code: 7, signal: null, fehler: null }),
      portFreigeben: async () => { geschehen.push('port-frei'); },
      portZurueckholen: async () => { geschehen.push('port-zurueck'); return { ok: true }; },
      sperreFreigeben: () => { geschehen.push('sperre-frei'); return { geloescht: true, grund: 'ok' }; },
      sperreZurueckholen: () => { geschehen.push('sperre-zurueck'); return { ok: true, grund: 'ok' }; },
      sperreLesen: () => ({ gelesen: false, grund: 'nicht da' }),
    });
    await S.fuehreAbloesung(bau(() => true));
    assert.deepEqual(geschehen,
      ['START', 'port-frei', 'sperre-frei', 'sperre-zurueck', 'port-zurueck'],
      'die Handgriffe kommen in einer anderen Reihenfolge: ' + geschehen.join(' -> '));
  });

// ===========================================================================
// NACHWEIS 4: DER KNOPF ERSCHEINT ERST NACH DEM ENDE-KASTEN
// ===========================================================================

test('FA-N4: waehrend ein Arbeiter laeuft, gibt es den Knopf nicht -- und danach schon', () => {
  const grund = (sitzung) => S.weiterKnopfDa(sitzung).grund;
  const lf = (mehr) => Object.assign({ modus: S.MODUS_LONGFORM, lauf: null, abloesung: null }, mehr);

  const ohneLauf = S.weiterKnopfDa(lf({}));
  assert.equal(ohneLauf.da, false);
  assert.match(ohneLauf.grund, /noch kein Lauf gelaufen/);

  const laeuft = S.weiterKnopfDa(lf({ lauf: { laeuft: true, ende: null } }));
  assert.equal(laeuft.da, false);
  assert.match(laeuft.grund, /laeuft gerade ein Arbeiter/);

  // Der Zwischenzustand, der leicht durchrutscht: der Lauf ist nicht mehr
  // "laeuft", aber das Ende ist noch nicht eingetragen.
  const dazwischen = S.weiterKnopfDa(lf({ lauf: { laeuft: false, ende: null } }));
  assert.equal(dazwischen.da, false);

  const fertig = S.weiterKnopfDa(lf({ lauf: { laeuft: false, ende: { code: 0 } } }));
  assert.equal(fertig.da, true, fertig.grund);

  const schonMal = S.weiterKnopfDa(lf({
    lauf: { laeuft: false, ende: { code: 0 } }, abloesung: { phase: 'gescheitert' } }));
  assert.equal(schonMal.da, false);
  assert.match(schonMal.grund, /bereits weitergeschaltet/);

  // Und im Shorts-Modus gibt es ihn ueberhaupt nicht.
  const shorts = S.weiterKnopfDa({ modus: S.MODUS_SHORTS, lauf: { laeuft: false, ende: {} } });
  assert.equal(shorts.da, false);
  assert.match(shorts.grund, /nur im Longform-Modus/);

  // Fuenf Lagen, fuenf verschiedene Saetze.
  assert.equal(new Set([ohneLauf.grund, laeuft.grund, schonMal.grund, shorts.grund,
    grund(lf({ lauf: { laeuft: false, ende: null } }))]).size, 4);
});

test('FA-N4: GET /lauf sagt waehrend eines Laufs "kein Knopf" und danach "Knopf"', async () => {
  // Die Seite bildet die Bedingung NICHT selbst -- sie zeigt, was hier steht.
  // Geprueft wird darum die Antwort des Dienstes, in beiden Lagen.
  const port = await freierPort();
  const sitzung = S.baueLongformSitzung({
    aufnahme: A_N5, projektwurzel: WURZEL, port,
    trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
  });
  const dienst = S.baueDienst(sitzung);
  await new Promise((f) => dienst.listen(port, S.HOST, f));
  try {
    sitzung.port = dienst.address().port;
    const hole = async () => JSON.parse((await anfrage(sitzung.port, {
      pfad: '/lauf', kopf: { 'x-freigabe-token': sitzung.token } })).text);

    sitzung.lauf = { laeuft: true, gestartet_am: 'x', zeilen: [], ende: null, befehl: null };
    const waehrend = await hole();
    assert.equal(waehrend.laeuft, true);
    assert.equal(waehrend.ende, null);
    assert.equal(waehrend.weiter.da, false,
      'es gibt einen Knopf, waehrend ein Arbeiter laeuft');

    sitzung.lauf.laeuft = false;
    sitzung.lauf.ende = { code: 0, signal: null, beendet_am: 'y', ermaechtigung_noch_da: false };
    const danach = await hole();
    assert.equal(danach.weiter.da, true, danach.weiter.grund);

    // KEINE ANTWORT DIESER ROUTE TRAEGT BEIDES. Das ist die Zusage, an der die
    // Seite haengt: sie deckt den Kasten in dem Zweig auf, der auch das Ende
    // zeigt.
    for (const antwort of [waehrend, danach]) {
      assert.ok(!(antwort.laeuft && antwort.weiter.da),
        'eine Antwort traegt einen laufenden Arbeiter UND einen Knopf');
    }
  } finally {
    await new Promise((f) => dienst.close(() => f()));
  }
});

// FUEHRT DAS SKRIPT DER SEITE AUS und gibt seine eigenen Funktionen heraus.
//
// Derselbe Ersatz-Baum wie in tests/el-longform-ansicht.test.cjs, um zwei
// Faehigkeiten erweitert, die die Knoepfe brauchen: addEventListener und
// disabled. Der Grund ist derselbe wie dort: ein Test gegen die Nutzlast
// prueft, was ANKOMMT -- nicht, was ein Mensch SIEHT.
function fuehreLongformSkriptAus(html, { fetch }) {
  const m = html.match(/\nconst DATEN = (\{.*\});\n/);
  assert.ok(m, 'die Seite traegt genau einen DATEN-Block');
  let roh = m[1];
  for (const [zeichen, maske] of Object.entries(SEITE.SKRIPTBLOCK_MASKEN)) {
    roh = roh.split(maske).join(zeichen);
  }
  const daten = JSON.parse(roh);
  const auf = html.indexOf('<script>') + '<script>'.length;
  const zu = html.indexOf('<' + '/script>', auf);
  const skript = html.slice(auf, zu).replace(/^const DATEN = .*;$/m, '');
  const versteckt = new Set([...html.matchAll(/id="([a-zA-Z]+)"[^>]*hidden/g)].map((x) => x[1]));
  const baum = new Map();
  const nimm = (id) => {
    if (!baum.has(id)) {
      baum.set(id, {
        id, textContent: '', hidden: versteckt.has(id), disabled: false, className: '',
        zuhoerer: {},
        addEventListener(name, f) { this.zuhoerer[name] = f; },
      });
    }
    return baum.get(id);
  };
  for (const x of html.matchAll(/id="([a-zA-Z]+)"/g)) nimm(x[1]);
  const dokument = {
    getElementById: (id) => nimm(id),
    querySelector: (w) => nimm((/#([a-zA-Z]+)/.exec(w) || [])[1] || w),
  };
  // eslint-disable-next-line no-new-func
  const fabrik = new Function('DATEN', 'document', 'fetch', 'AbortSignal',
    skript + '\n;return { verfolgeLauf, zeigeWeiter, verfolgeAbloesung };');
  const teile = fabrik(daten, dokument, fetch, { timeout: () => undefined });
  return { baum, teile, daten };
}

test('FA-N4: das ausgefuehrte Skript deckt den Knopf ERST mit dem Ende-Kasten auf', async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-n4-'));
  try {
    const sitzung = S.baueLongformSitzung({
      aufnahme: A_N5, projektwurzel: ordner, port: 0,
      trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
    });
    const html = SEITE.baueLongformSeite(sitzung);

    // Zuerst: der Kasten ist im ausgelieferten HTML zu.
    assert.match(html, /id="weiterKasten" hidden/);

    const antworten = [
      // 1. Der Arbeiter laeuft -- kein Ende, kein Knopf.
      { lauf: { zweck: null }, ab: 0, gesamt: 1, zeilen: [{ art: 'aus', zeile: 'laeuft' }],
        laeuft: true, ende: null, weiter: { da: false, grund: 'Es laeuft gerade ein Arbeiter.' } },
      // 2. Er ist fertig -- Ende UND Knopf.
      { lauf: { zweck: null }, ab: 1, gesamt: 2, zeilen: [{ art: 'aus', zeile: 'fertig' }],
        laeuft: false, ende: { code: 0, ermaechtigung_noch_da: false },
        weiter: { da: true, grund: null } },
    ];
    let dran = 0;
    const { baum, teile } = fuehreLongformSkriptAus(html, {
      fetch: async () => ({ ok: true, json: async () => antworten[Math.min(dran++, 1)] }),
    });

    const lauf = teile.verfolgeLauf();
    // Nach der ERSTEN Antwort: der Lauf laeuft, der Ende-Kasten ist zu, und
    // der Weiter-Kasten ist es auch. Das ist die Zusage: waehrend eines
    // laufenden Arbeiters gibt es den Knopf nicht.
    await schlaf(150);
    assert.equal(baum.get('laufEnde').hidden, true, 'der Ende-Kasten steht schon offen');
    assert.equal(baum.get('weiterKasten').hidden, true,
      'DER KNOPF STEHT DA, WAEHREND EIN ARBEITER LAEUFT');
    assert.equal(baum.get('weiterGesperrt').hidden, true);

    // Nach der ZWEITEN: beide auf, und zwar der Ende-Kasten zuerst.
    await lauf;
    assert.equal(baum.get('laufEnde').hidden, false, 'der Ende-Kasten blieb zu');
    assert.equal(baum.get('weiterKasten').hidden, false, 'der Knopf kam nicht');
    assert.ok(baum.get('knopfWeiter').textContent.includes('Weiter'),
      'der Knopf traegt keine Beschriftung: ' + JSON.stringify(baum.get('knopfWeiter').textContent));
    assert.ok(typeof baum.get('knopfWeiter').zuhoerer.click === 'function',
      'am Knopf haengt kein Klick');

    // GEGENPROBE: sagt der Dienst "kein Knopf", bleibt der Kasten zu und der
    // GRUND steht da. Ein fehlender Knopf ohne Grund sieht aus wie ein
    // vergessener.
    const antworten2 = [{ lauf: { zweck: null }, ab: 0, gesamt: 1,
      zeilen: [{ art: 'aus', zeile: 'fertig' }], laeuft: false,
      ende: { code: 0, ermaechtigung_noch_da: false },
      weiter: { da: false, grund: 'Auf dieser Sitzung ist bereits weitergeschaltet worden.' } }];
    const zweiter = fuehreLongformSkriptAus(html, {
      fetch: async () => ({ ok: true, json: async () => antworten2[0] }),
    });
    await zweiter.teile.verfolgeLauf();
    assert.equal(zweiter.baum.get('laufEnde').hidden, false);
    assert.equal(zweiter.baum.get('weiterKasten').hidden, true,
      'der Knopf kam, obwohl der Dienst nein gesagt hat');
    assert.equal(zweiter.baum.get('weiterGesperrt').hidden, false);
    assert.match(zweiter.baum.get('weiterGrund').textContent, /bereits weitergeschaltet/);
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

test('FA-N4: es gibt im Skript GENAU EINE Stelle, die den Knopf aufdeckt', () => {
  // Die Zusage darueber ist am ausgefuehrten Skript geprueft; diese hier ist
  // die schaerfere: der Aufruf steht EINMAL, und zwar in dem Zweig, der auch
  // den Ende-Kasten fuellt. Eine zweite Stelle waere die, die eines Tages
  // frueher feuert.
  const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-seite.js'), 'utf8');
  const aufrufe = (quelle.match(/^\s*zeigeWeiter\(/gm) || []).length;
  assert.equal(aufrufe, 1, 'zeigeWeiter wird ' + aufrufe + '-mal gerufen -- erwartet ist ein ' +
    'einziger Aufruf, im Zweig des Ende-Kastens');
  const zweig = quelle.slice(quelle.indexOf("    if (daten.ende) {"),
    quelle.indexOf('    await schlaf(2000);'));
  assert.ok(zweig.includes('zeigeWeiter(daten.weiter);'),
    'der Aufruf steht nicht im Zweig des Ende-Kastens');
  assert.ok(zweig.indexOf("kel('laufEnde').hidden = false") < zweig.indexOf('zeigeWeiter('),
    'der Knopf wird aufgedeckt, bevor der Ende-Kasten steht');
  // Und nur zeigeWeiter deckt ihn auf -- kein zweiter Weg zum selben Kasten.
  const aufdecker = (quelle.match(/kel\('weiterKasten'\)\.hidden = false/g) || []).length;
  assert.equal(aufdecker, 1, 'der Weiter-Kasten wird an ' + aufdecker + ' Stellen aufgedeckt');
});

// ===========================================================================
// NACHWEIS 5: ER SCHALTET WEITER, ER VEROEFFENTLICHT NICHT
// ===========================================================================

// Dieselbe Schreibfalle wie in tests/ep-privat.test.cjs: JEDER schreibende Weg
// des Dateisystems wirft, statt zu schreiben.
function schreibfalleStellen() {
  const namen = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync',
    'rmSync', 'copyFileSync', 'createWriteStream', 'writeSync', 'ftruncateSync'];
  const echt = {};
  const beruehrt = [];
  for (const name of namen) {
    echt[name] = fs[name];
    fs[name] = function (...args) {
      beruehrt.push('fs.' + name + '(' + String(args[0]) + ')');
      throw new Error('SCHREIBFALLE: fs.' + name);
    };
  }
  echt.openSync = fs.openSync;
  fs.openSync = function (pfad, kennzeichen, ...rest) {
    const k = kennzeichen === undefined ? 'r' : kennzeichen;
    if (k !== 'r' && k !== 0 && k !== 'rs') {
      beruehrt.push('fs.openSync(' + String(pfad) + ', ' + String(k) + ')');
      throw new Error('SCHREIBFALLE: fs.openSync');
    }
    return echt.openSync.call(fs, pfad, k, ...rest);
  };
  return {
    beruehrt,
    loesen() { for (const name of Object.keys(echt)) fs[name] = echt[name]; },
  };
}

// Die Netzfalle aus tests/ep-privat.test.cjs, hier auf das gekuerzt, was
// dieser Weg beruehren koennte -- ausgehende Verbindungen und die Bibliothek.
// http.request bleibt STEHEN: dieser Test ruft damit selbst den Dienst an, und
// eine Falle, die den Test faengt, prueft den Test.
function netzfalleStellen() {
  const beruehrt = [];
  const echt = {};
  const schnapp = (was) => {
    beruehrt.push(was);
    throw new Error('NETZFALLE: ' + was);
  };
  const https = require('node:https');
  const dns = require('node:dns');
  const tls = require('node:tls');
  const stelle = (objekt, name, marke) => {
    if (typeof objekt[name] !== 'function') return;
    echt[marke] = { objekt, name, wert: objekt[name] };
    objekt[name] = function () { return schnapp(marke); };
  };
  stelle(https, 'request', 'https.request');
  stelle(https, 'get', 'https.get');
  stelle(tls, 'connect', 'tls.connect');
  stelle(dns, 'lookup', 'dns.lookup');
  stelle(globalThis, 'fetch', 'fetch');
  echt.load = Module._load;
  Module._load = function (anfrage, eltern, istHaupt) {
    if (/^googleapis/.test(anfrage) || /google-auth-library/.test(anfrage) ||
        /youtube\/auth/.test(anfrage)) {
      return schnapp('require(' + JSON.stringify(anfrage) + ')');
    }
    return echt.load.call(Module, anfrage, eltern, istHaupt);
  };
  return {
    beruehrt,
    loesen() {
      Module._load = echt.load;
      for (const marke of Object.keys(echt)) {
        if (marke === 'load') continue;
        echt[marke].objekt[echt[marke].name] = echt[marke].wert;
      }
    },
  };
}

function anfrage(port, { methode = 'GET', pfad = '/', kopf = {} } = {}) {
  return new Promise((fertig, schief) => {
    const zusammen = Object.assign({
      host: S.HOST + ':' + port, origin: 'http://' + S.HOST + ':' + port }, kopf);
    for (const k of Object.keys(zusammen)) if (zusammen[k] === undefined) delete zusammen[k];
    const req = http.request({ host: S.HOST, port, method: methode, path: pfad,
      headers: zusammen }, (res) => {
      const teile = [];
      res.on('data', (d) => teile.push(d));
      res.on('end', () => fertig({ status: res.statusCode,
        text: Buffer.concat(teile).toString('utf8') }));
    });
    req.on('error', schief);
    req.end();
  });
}

test('FA-N5: POST /weiter prueft SERVERSEITIG, ob es einen Knopf gibt -- und schreibt nichts',
  async () => {
    // Der Browser sperrt den Knopf zusaetzlich, aber das ist Bequemlichkeit.
    // Diese Zeile ist die Zusage: eine Anfrage, die den Browser umgeht, faellt
    // hier -- und nur hier.
    //
    // DIE SITZUNG LAEUFT AUF DER ECHTEN PROJEKTWURZEL. Anders ginge es nicht:
    // fremdeWurzel() faengt eine Wegwerfwurzel schon vorher ab, und dann
    // pruefte dieser Test nicht die Zusage, sondern die davor. Damit dabei
    // nichts entstehen kann, ist waehrend der Anfrage JEDER Schreibweg
    // scharfgestellt.
    const port = await freierPort();
    const sitzung = S.baueLongformSitzung({
      aufnahme: A_N5, projektwurzel: WURZEL, port,
      trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
    });
    assert.equal(S.weiterKnopfDa(sitzung).da, false, 'diese Sitzung hat schon einen Knopf');
    const dienst = S.baueDienst(sitzung);
    await new Promise((f) => dienst.listen(port, S.HOST, f));
    sitzung.port = dienst.address().port;

    const falle = schreibfalleStellen();
    const netz = netzfalleStellen();
    let antwort;
    try {
      antwort = await anfrage(sitzung.port, { methode: 'POST', pfad: '/weiter',
        kopf: { 'x-freigabe-token': sitzung.token } });
    } finally {
      falle.loesen();
      netz.loesen();
      await new Promise((f) => dienst.close(() => f()));
    }

    assert.equal(antwort.status, 409,
      'POST /weiter antwortet mit ' + antwort.status + ' statt 409. Leib: ' + antwort.text);
    assert.ok(antwort.text.includes('kein_knopf'), antwort.text);
    assert.ok(antwort.text.includes('nichts abgegeben'), antwort.text);
    assert.deepEqual(falle.beruehrt, [],
      'die Route hat geschrieben, obwohl es keinen Knopf gab: ' + falle.beruehrt.join(', '));
    assert.deepEqual(netz.beruehrt, [],
      'die Route hat einen Netzweg angefasst: ' + netz.beruehrt.join(', '));
    // Und es ist kein Prozess entstanden.
    assert.equal(sitzung.abloesung, null, 'die Sitzung traegt eine Abloesung');
  });

test('FA-N5: eine ANGENOMMENE Anfrage schreibt ebenfalls nichts und startet nichts -- ' +
  'sie meldet nur an', async () => {
  // Die andere Haelfte derselben Zusage, und die wichtigere: auch wenn es den
  // Knopf GIBT, entsteht bei der Anfrage selbst weder eine Datei noch ein
  // Prozess. Die Route meldet die Abloesung an; angefasst wird alles erst im
  // Zuhoerer, den starteLongform() haengt -- und den es hier nicht gibt.
  const port = await freierPort();
  const sitzung = S.baueLongformSitzung({
    aufnahme: A_N5, projektwurzel: WURZEL, port,
    trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
  });
  sitzung.lauf = { laeuft: false, gestartet_am: 'x', zeilen: [], befehl: null,
    ende: { code: 0, signal: null, beendet_am: 'y', ermaechtigung_noch_da: false } };
  assert.equal(S.weiterKnopfDa(sitzung).da, true);
  const dienst = S.baueDienst(sitzung);
  await new Promise((f) => dienst.listen(port, S.HOST, f));
  sitzung.port = dienst.address().port;

  const falle = schreibfalleStellen();
  const netz = netzfalleStellen();
  const echterSpawn = require('node:child_process').spawn;
  const gestartet = [];
  require('node:child_process').spawn = function (...args) {
    gestartet.push(args[0]);
    throw new Error('PROZESSFALLE: es wurde ein Prozess gestartet');
  };
  let antwort;
  try {
    antwort = await anfrage(sitzung.port, { methode: 'POST', pfad: '/weiter',
      kopf: { 'x-freigabe-token': sitzung.token } });
    await schlaf(200);   // der setImmediate der Route ist laengst durch
  } finally {
    require('node:child_process').spawn = echterSpawn;
    falle.loesen();
    netz.loesen();
    await new Promise((f) => dienst.close(() => f()));
  }

  assert.equal(antwort.status, 200, antwort.text);
  assert.deepEqual(falle.beruehrt, [], 'die Route hat geschrieben: ' + falle.beruehrt.join(', '));
  assert.deepEqual(netz.beruehrt, [], 'die Route hat einen Netzweg angefasst');
  assert.deepEqual(gestartet, [], 'die Route hat selbst einen Prozess gestartet');
  // Was sie tut, steht in der Sitzung -- und sonst nirgends.
  assert.ok(sitzung.abloesung, 'die Anmeldung ist nicht im Zustand angekommen');
  assert.equal(sitzung.abloesung.phase, 'anlauf');
  assert.equal(sitzung.abloesung.nachfolger_pid, null);
  const zeilen = sitzung.abloesung.zeilen.map((z) => z.zeile).join(' ');
  assert.match(zeilen, /Es wird nichts hochgeladen und nichts oeffentlich gestellt/);
  assert.match(zeilen, /Es entsteht keine Ermaechtigung/);
  // Und der Knopf ist danach zu.
  assert.equal(S.weiterKnopfDa(sitzung).da, false);
});

test('FA-N5: POST /weiter weist eine FREMDE Projektwurzel ab', async () => {
  // Der Nachfolger loest seine Projektwurzel aus dem Ort SEINER Datei auf --
  // das ist die Zusage, und ein Konfigurationswert koennte auf ein anderes
  // Programm zeigen. Eine Sitzung, die auf einem anderen Ordner laeuft,
  // bekommt darum keinen Nachfolger: er arbeitete auf einem anderen Ordner
  // als dem, den diese Seite zeigt.
  //
  // DER MUTATIONSLAUF HAT DIESE SICHERUNG ALS TOT GEFUNDEN (M14).
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-fremd-'));
  const port = await freierPort();
  const sitzung = S.baueLongformSitzung({
    aufnahme: A_N5, projektwurzel: ordner, port,
    trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
  });
  sitzung.lauf = { laeuft: false, gestartet_am: 'x', zeilen: [], befehl: null,
    ende: { code: 0, signal: null, beendet_am: 'y', ermaechtigung_noch_da: false } };
  // Der Knopf waere da -- es scheitert AN DER WURZEL und an nichts sonst.
  assert.equal(S.weiterKnopfDa(sitzung).da, true);
  const dienst = S.baueDienst(sitzung);
  await new Promise((f) => dienst.listen(port, S.HOST, f));
  sitzung.port = dienst.address().port;
  const echterSpawn = require('node:child_process').spawn;
  const gestartet = [];
  require('node:child_process').spawn = function (...args) {
    gestartet.push(args[0]);
    throw new Error('PROZESSFALLE');
  };
  let antwort;
  try {
    antwort = await anfrage(sitzung.port, { methode: 'POST', pfad: '/weiter',
      kopf: { 'x-freigabe-token': sitzung.token } });
    await schlaf(200);
  } finally {
    require('node:child_process').spawn = echterSpawn;
    await new Promise((f) => dienst.close(() => f()));
    fs.rmSync(ordner, { recursive: true, force: true });
  }
  assert.equal(antwort.status, 409, antwort.text);
  assert.ok(antwort.text.includes('fremde_projektwurzel'), antwort.text);
  assert.equal(sitzung.abloesung, null, 'die Abloesung wurde trotzdem angemeldet');
  assert.deepEqual(gestartet, [], 'es wurde ein Prozess gestartet');
});

test('FA-N5: --abloesung-von= wird geprueft, bevor irgendetwas geschieht', () => {
  // Beide Zweige. Der zweite -- die eigene Prozessnummer -- ist von aussen
  // nicht zu bauen: ein Aufruf muesste die Nummer tragen, die der gestartete
  // Prozess erst bekommt. Der Mutationslauf hat beide als TOTE SICHERUNGEN
  // gefunden (M20, M21), solange sie in main() standen; sie stehen jetzt in
  // einer eigenen Funktion, und die wird hier gefahren.
  assert.deepEqual(S.pruefeAbloesungVon(null, 111), { ok: true, pid: null });
  assert.deepEqual(S.pruefeAbloesungVon('222', 111), { ok: true, pid: 222 });

  const krumm = S.pruefeAbloesungVon('zwoelf', 111);
  assert.equal(krumm.ok, false);
  assert.match(krumm.meldung, /keine Prozessnummer/);
  assert.match(krumm.meldung, /von Hand tippt es niemand/);

  const selbst = S.pruefeAbloesungVon('111', 111);
  assert.equal(selbst.ok, false);
  assert.match(selbst.meldung, /nennt die eigene Prozessnummer \(111\)/);
  assert.match(selbst.meldung, /loest sich nicht selbst ab/);
  // Zwei Faelle, zwei Meldungen.
  assert.notEqual(krumm.meldung, selbst.meldung);
  // Und keine der beiden wird von der Gegenseite als laufende Sitzung
  // gedeutet (EK).
  for (const m of [krumm.meldung, selbst.meldung]) assert.ok(!/laeuft bereits/.test(m), m);

  // Die Randfaelle der Form: nichts Negatives, nichts mit Vorzeichen, nichts
  // Ueberlanges, nichts mit Leerraum.
  for (const roh of ['-1', '+1', '1 ', ' 1', '0x10', '1.0', '', '12345678901']) {
    assert.equal(S.pruefeAbloesungVon(roh, 111).ok, false, JSON.stringify(roh) + ' kam durch');
  }
  // '0' kommt durch die Form -- und genau das ist richtig: die Nummer wird
  // NICHT hier auf Sinn geprueft, sondern von prozessLebt(), das eine 0 als
  // "keine brauchbare Prozessnummer" fuehrt. Zwei Stellen, die dasselbe
  // pruefen, laufen auseinander.
  assert.equal(S.pruefeAbloesungVon('0', 111).ok, true);
  assert.equal(S.prozessLebt(0).lebt, false);
});

test('FA-N5: ein krummes --abloesung-von= beendet den Start, bevor irgendetwas geschieht',
  () => {
    // Die Pruefung oben ist eine Funktion; DASS SIE GERUFEN WIRD, steht hier.
    // Der Mutationslauf hat die Aufrufstelle als TOTE SICHERUNG gefunden
    // (M27): beide Zweige der Funktion waren gedeckt, ihr Aufruf nicht.
    //
    // Gefahren wird der ECHTE Dienst. Er endet mit 2 -- also VOR der Sperre,
    // vor dem Trockenlauf und vor dem Port; dieser Test fasst data/ nicht an.
    const lauf = spawnSync(process.execPath,
      [SERVER, '--modus=longform', '--aufnahme=' + A_N1, '--abloesung-von=zwoelf'],
      { cwd: WURZEL, encoding: 'utf8', timeout: 30000 });
    const text = (lauf.stdout || '') + (lauf.stderr || '');
    assert.equal(lauf.status, S.EXIT_AUFRUFFEHLER,
      'der Aufruf endet mit ' + lauf.status + ' statt ' + S.EXIT_AUFRUFFEHLER + ':\n' + text);
    assert.match(text, /keine Prozessnummer/);
    assert.match(text, /von Hand tippt es niemand/);
    // Er hat NICHT gewartet -- ein Start, der die Pruefung ueberspringt, liefe
    // in das Warten hinein und braeuchte eine Minute, statt sofort zu enden.
    assert.ok(!/warte darauf/.test(text), text);
    assert.ok(!/Rufe den Longform-Arbeiter/.test(text), text);
    // Und die Sperrdatei ist nicht entstanden.
    assert.equal(sperrePidVon(A_N1), null,
      'ein Start, der an der Argumentpruefung endet, hat eine Sperre angelegt');
  });

test('FA-N5: der ganze Weg der Abloesung kennt kein Veroeffentlichen', () => {
  const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
  const von = quelle.indexOf('// FA: DIE ABLOESUNG (Vertrag 11.7)');
  const bis = quelle.indexOf('// ---------------------------------------------------------------------------\n// CLI');
  assert.ok(von > 0 && bis > von, 'der Abschnitt der Abloesung wurde nicht gefunden');
  const block = quelle.slice(von, bis);
  // GEPRUEFT WIRD DER CODE, NICHT DIE PROSA. Die Meldungen dieses Weges REDEN
  // ueber die zwei Ermaechtigungen -- sie sagen ausdruecklich, dass sie
  // unveraendert bleiben --, und das sollen sie. Was hier nicht vorkommen
  // darf, sind die BEZEICHNER, ueber die eine entstuende oder ein Arbeiter
  // liefe.
  const nurCode = block.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  for (const wort of ['ZWECK_', 'videos.', 'GEDAECHTNIS_MODUL', 'schreibeErmaechtigung',
    'starteLongformLauf', 'LONGFORM_ARBEITER', 'neueErmaechtigung', 'ermaechtigungPfad',
    'leseKanal', 'require(']) {
    assert.ok(!nurCode.includes(wort),
      'der Weg der Abloesung nennt "' + wort + '" -- er schaltet weiter und sonst nichts');
  }
  // Und die Route selbst schreibt keine Datei.
  const route = quelle.slice(quelle.indexOf('function nimmWeiter(res) {'),
    quelle.indexOf('function liefereAbloesung(res, abfrage) {'));
  assert.ok(route.length > 400, 'die Route wurde nicht ganz gefunden');
  for (const wort of ['writeFileSync', 'openSync', 'spawn', 'schreibeErmaechtigung',
    'nimmSperre', 'gibSperreFrei']) {
    assert.ok(!route.includes(wort), 'POST /weiter fasst "' + wort + '" selbst an');
  }
});

// ===========================================================================
// DIE NAHT ZWISCHEN ROUTE UND ABLAUF
// ===========================================================================

test('FA-N5: GET /abloesung sagt vorher nichts und danach den Stand', async () => {
  const port = await freierPort();
  const sitzung = S.baueLongformSitzung({
    aufnahme: A_N5, projektwurzel: WURZEL, port,
    trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
  });
  sitzung.lauf = { laeuft: false, gestartet_am: 'x', zeilen: [], befehl: null,
    ende: { code: 0, signal: null, beendet_am: 'y', ermaechtigung_noch_da: false } };
  const dienst = S.baueDienst(sitzung);
  await new Promise((f) => dienst.listen(port, S.HOST, f));
  sitzung.port = dienst.address().port;
  const echterSpawn = require('node:child_process').spawn;
  require('node:child_process').spawn = function () {
    throw new Error('PROZESSFALLE');
  };
  try {
    const vorher = JSON.parse((await anfrage(sitzung.port, { pfad: '/abloesung',
      kopf: { 'x-freigabe-token': sitzung.token } })).text);
    assert.equal(vorher.abloesung, null,
      '"es wurde nie weitergeschaltet" und "es wurde und ist nichts dabei herausgekommen" ' +
      'sind zwei Zustaende');
    assert.deepEqual(vorher.zeilen, []);

    await anfrage(sitzung.port, { methode: 'POST', pfad: '/weiter',
      kopf: { 'x-freigabe-token': sitzung.token } });
    await schlaf(200);
    const nachher = JSON.parse((await anfrage(sitzung.port, { pfad: '/abloesung',
      kopf: { 'x-freigabe-token': sitzung.token } })).text);
    assert.equal(nachher.laeuft, true);
    assert.equal(nachher.abloesung.phase, 'anlauf');
    assert.equal(nachher.abloesung.port, port);
    assert.ok(nachher.zeilen.length >= 2, JSON.stringify(nachher));
    // Und ab-Zaehlung wie bei /lauf.
    const rest = JSON.parse((await anfrage(sitzung.port,
      { pfad: '/abloesung?ab=' + nachher.gesamt,
        kopf: { 'x-freigabe-token': sitzung.token } })).text);
    assert.deepEqual(rest.zeilen, []);
  } finally {
    require('node:child_process').spawn = echterSpawn;
    await new Promise((f) => dienst.close(() => f()));
  }
});

test('FA-N5: POST /weiter loest das Ereignis aus, an dem die Abloesung haengt', async () => {
  // DIE ROUTE MELDET AN -- und das Anmelden ist ein Ereignis am Dienst, nicht
  // ein Vermerk im Zustand. Ohne dieses Ereignis stuende in der Sitzung
  // "Abloesung angefordert", und es geschaehe nie etwas: der Knopf waere
  // danach zu, die Seite zeigte "laeuft", und der Mensch wartete auf einen
  // Nachfolger, den niemand startet.
  //
  // DER MUTATIONSLAUF HAT DIESE SICHERUNG ALS TOT GEFUNDEN (M26): der Zustand
  // wird VOR dem Ereignis gesetzt, also sagte kein Test etwas darueber, ob es
  // ueberhaupt kommt.
  const port = await freierPort();
  const sitzung = S.baueLongformSitzung({
    aufnahme: A_N5, projektwurzel: WURZEL, port,
    trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
  });
  sitzung.lauf = { laeuft: false, gestartet_am: 'x', zeilen: [], befehl: null,
    ende: { code: 0, signal: null, beendet_am: 'y', ermaechtigung_noch_da: false } };
  const dienst = S.baueDienst(sitzung);
  let ausgeloest = 0;
  dienst.on('abloesung-erwuenscht', () => { ausgeloest += 1; });
  await new Promise((f) => dienst.listen(port, S.HOST, f));
  sitzung.port = dienst.address().port;
  try {
    // Vorher: nichts.
    await anfrage(sitzung.port, { pfad: '/abloesung',
      kopf: { 'x-freigabe-token': sitzung.token } });
    assert.equal(ausgeloest, 0, 'das Ereignis kam ohne Klick');

    const antwort = await anfrage(sitzung.port, { methode: 'POST', pfad: '/weiter',
      kopf: { 'x-freigabe-token': sitzung.token } });
    assert.equal(antwort.status, 200, antwort.text);
    await schlaf(200);
    assert.equal(ausgeloest, 1, 'POST /weiter hat die Abloesung nicht ausgeloest');

    // Und ein ZWEITER Klick loest nichts mehr aus -- der Knopf ist verbraucht.
    const zweite = await anfrage(sitzung.port, { methode: 'POST', pfad: '/weiter',
      kopf: { 'x-freigabe-token': sitzung.token } });
    await schlaf(200);
    assert.equal(zweite.status, 409, zweite.text);
    assert.equal(ausgeloest, 1, 'ein zweiter Klick hat ein zweites Mal ausgeloest');
  } finally {
    await new Promise((f) => dienst.close(() => f()));
  }
});

test('FA-N5: ein NACHFOLGER sagt auf seiner Seite, dass Strg+C ihn nicht mehr erreicht', () => {
  // Ein Nachfolger entsteht abgeloest (detached) und haengt an keiner Konsole.
  // Der Satz des gewoehnlichen Starts waere fuer ihn unwahr -- und eine
  // Meldung, die stehen bleibt, nachdem ihr Satz nicht mehr stimmt, ist die
  // Sorte, die der naechste Leser fuer wahr nimmt.
  //
  // DER MUTATIONSLAUF HAT DIESE SICHERUNG ALS TOT GEFUNDEN (M25).
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-beenden-'));
  try {
    const bau = (abloesungVon) => S.baueLongformSitzung({
      aufnahme: A_N5, projektwurzel: ordner, port: 0, abloesungVon,
      trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
    });
    const gewoehnlich = fuehreLongformSkriptAus(SEITE.baueLongformSeite(bau(null)),
      { fetch: async () => { throw new Error('kein Aufruf erwartet'); } });
    assert.match(gewoehnlich.baum.get('beendenSatz').textContent,
      /^Beenden: Strg\+C in dem Terminal/);
    assert.ok(!/NACHFOLGER/.test(gewoehnlich.baum.get('beendenSatz').textContent));

    const nachfolger = fuehreLongformSkriptAus(SEITE.baueLongformSeite(bau(4242)),
      { fetch: async () => { throw new Error('kein Aufruf erwartet'); } });
    const satz = nachfolger.baum.get('beendenSatz').textContent;
    assert.match(satz, /NACHFOLGER/);
    assert.match(satz, /abgeloest von Prozess 4242/);
    assert.match(satz, /Strg\+C dort erreicht ihn nicht/);
    assert.match(satz, /Task-Manager/);
    // Zwei Startwege, zwei Saetze -- und keiner davon steht fest im HTML.
    assert.notEqual(satz, gewoehnlich.baum.get('beendenSatz').textContent);
    // UND ER STEHT NICHT FEST IM MARKUP. Im Skript steht er (dort wird er
    // gewaehlt); im ausgelieferten HTML davor darf er nicht stehen, sonst
    // gaelte er auch fuer einen Nachfolger.
    const html = SEITE.baueLongformSeite(bau(null));
    const markup = html.slice(0, html.indexOf('<script>'));
    assert.ok(!markup.includes('Strg'),
      'der Beenden-Satz steht fest im Markup -- dann gilt er auch fuer einen Nachfolger');
    assert.ok(markup.includes('<span class="kopfzeile" id="beendenSatz"></span>'),
      'der Platz fuer den Satz fehlt');

    // Und der Dienst sagt dasselbe im Terminal, nicht nur auf der Seite.
    const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
    const rumpf = quelle.slice(quelle.indexOf('function starteLongform('),
      quelle.indexOf('function main()'));
    assert.match(rumpf, /if \(abloesungVon !== null\) \{[\s\S]{0,600}?DIESER DIENST IST EIN NACHFOLGER/);
    assert.match(rumpf, /erreicht ihn NICHT/);
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

test('FA-N5: der Zuhoerer in starteLongform verdrahtet Route und Ablauf -- und sonst nichts',
  () => {
    // DIE EINE NAHT, DIE KEIN LAUFENDER TEST ERREICHT: zwischen der Route und
    // dem Ablauf steht ein Ereignis, und was daran haengt, braucht einen
    // vollstaendigen Longform-Start -- also einen Arbeiter, der ein Video auf
    // dem Kanal findet. Das ist im Test nicht herstellbar (kein Netz). Statt
    // die Naht ungeprueft zu lassen, wird sie hier ABGEZAEHLT.
    const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
    const von = quelle.indexOf('function starteLongform(');
    const bis = quelle.indexOf('function main()');
    // Gezaehlt wird im CODE, nicht in den Kommentaren -- die reden ueber
    // fuehreAbloesung(), und das sollen sie.
    const rumpf = quelle.slice(von, bis).split('\n')
      .filter((z) => !z.trim().startsWith('//')).join('\n');
    // Genau EIN Zuhoerer, und er ruft die beiden Funktionen, die oben geprueft
    // sind -- nicht eine dritte, die ihnen aehnlich saehe.
    assert.equal((rumpf.match(/dienst\.on\('abloesung-erwuenscht'/g) || []).length, 1);
    assert.match(rumpf, /fuehreAbloesung\(baueAbloesungsLage\(\{/);
    assert.equal((rumpf.match(/fuehreAbloesung\(/g) || []).length, 1);
    assert.equal((rumpf.match(/baueAbloesungsLage\(/g) || []).length, 1);
    // Bei Erfolg geht dieser Dienst -- und zwar mit 0.
    assert.match(rumpf, /if \(ergebnis\.gelungen\) \{[\s\S]{0,400}?process\.exit\(EXIT_OK\);/);
    // Und er fasst dabei die Sperre des Nachfolgers NICHT mehr an.
    assert.match(rumpf, /beendet = true;\s*\/\/ herunterfahren\(\) soll die fremde Sperre/);
    // Haelt er nach einem Fehlschlag alles, bleibt er am Leben; haelt er nicht
    // alles, geht er ueber abbruch().
    assert.match(rumpf, /if \(haeltAlles\) \{[\s\S]{0,400}?abloesungAktiv = false;/);
    assert.match(rumpf, /a\.ende\.meldung = text;\s*\n\s*abbruch\(text\);/);
    // 'beenden-erwuenscht' bleibt dem Longform-Modus fremd: es gibt weiterhin
    // keinen Knopf, der nur beendet.
    assert.ok(!rumpf.includes("'beenden-erwuenscht'"),
      'der Longform-Modus hat einen Zuhoerer auf beenden-erwuenscht bekommen');
  });

test('FA-N3: die Seite sagt "dunkel" statt "Fehler", solange niemand antwortet', async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-dunkel-'));
  try {
    const sitzung = S.baueLongformSitzung({
      aufnahme: A_N5, projektwurzel: ordner, port: 0,
      trocken: { befehl: 'x', code: 1, fehler: null, aus: 'V', err: '', befund: null },
    });
    const html = SEITE.baueLongformSeite(sitzung);
    let ruf = 0;
    const { baum, teile } = fuehreLongformSkriptAus(html, {
      fetch: async () => {
        ruf += 1;
        if (ruf === 1) throw new Error('ECONNREFUSED');
        return { ok: true, json: async () => ({
          abloesung: { phase: 'gescheitert', nachfolger_pid: 42, port: 1 },
          ab: 0, gesamt: 1, zeilen: [{ art: 'dienst', zeile: 'Nachfolger gestartet' }],
          laeuft: false,
          ende: { gelungen: false, phase: 'bestaetigung', nachfolger_pid: 42,
            grund: 'Der Nachfolger ist beendet.',
            meldung: 'DIE ABLOESUNG HAT NICHT GEKLAPPT. Dieser Dienst laeuft weiter.' },
        }) };
      },
    });
    const laufend = teile.verfolgeAbloesung();
    await schlaf(150);
    // DER ERSTE FEHLSCHLAG IST KEIN FEHLER, SONDERN DER WEG SELBST.
    assert.equal(baum.get('weiterEnde').hidden, false);
    assert.match(baum.get('weiterEnde').textContent, /DIESE SEITE IST DUNKEL/);
    assert.ok(!/Fehler/.test(baum.get('weiterEnde').textContent),
      'der Normalfall wird als Fehler angezeigt');
    await laufend;
    // UND WENN DER ALTE ZURUECKKOMMT, STEHT HIER, WAS WAR.
    assert.match(baum.get('weiterEnde').textContent, /HAT NICHT GEKLAPPT/);
    assert.match(baum.get('weiterEnde').textContent, /dieser Dienst lebt noch/);
    assert.match(baum.get('weiterEnde').textContent, /Strg\+C/);
    assert.equal(baum.get('weiterEnde').className, 'lf-ende-kasten weg');
    assert.equal(baum.get('knopfWeiter').textContent, 'nicht weitergeschaltet');
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

test('FA-N1: die Meldung des gelungenen Weiterschaltens sagt, wem jetzt was gehoert', () => {
  const text = S.meldeAbloesungGelungen(
    { gelungen: true, phase: 'bestaetigung', nachfolger_pid: 4242 },
    A_N1, 8791, 'data/freigaben/x.longform.sperre.json');
  assert.match(text, /WEITERGESCHALTET/);
  assert.match(text, /Nachfolger:     PID 4242/);
  assert.match(text, /jetzt seiner/);
  assert.match(text, /jetzt seine/);
  assert.match(text, /Es wurde nichts hochgeladen und nichts oeffentlich gestellt/);
  // Und sie wird von der Gegenseite NICHT als laufende Sitzung gedeutet (EK).
  assert.ok(!/laeuft bereits/.test(text), text);
});

// ===========================================================================
// NACHWEIS 6: DIE SHORTS-LINIE IST UNVERAENDERT
// ===========================================================================

const STAND_VOR_FA = '0805769';

function ausGit(datei) {
  const g = spawnSync('git', ['show', STAND_VOR_FA + ':' + datei],
    { cwd: WURZEL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (g.error || g.status !== 0) return null;
  return g.stdout;
}

function sha256(puffer) {
  return require('node:crypto').createHash('sha256').update(puffer).digest('hex');
}

function shortsSitzungFuerVergleich(ordner) {
  const eintraege = [];
  for (let i = 0; i < 3; i++) {
    const datei = path.join(ordner, 'short-' + i + '.mp4');
    const inhalt = Buffer.from('VIDEO-' + i + '-' + 'x'.repeat(200 + i), 'utf8');
    fs.writeFileSync(datei, inhalt);
    eintraege.push({
      index: i, kennung: A_N1 + '/' + i, bezeichner: A_N1 + '/' + i,
      unbekannteFelder: [], maengel: [], hinweise: [], angenommen: true,
      daten: {
        kennung: A_N1 + '/' + i, pfad: datei, sha256: sha256(inhalt),
        groesse_bytes: inhalt.length, dauer_ms: 12000 + i, breite: 1080, hoehe: 1920,
        titel_vorschlag: 'Titel </script> & <b>' + i, transkript: 'transkript ' + i,
        quelle_von_ms: 100000 + i * 1000, quelle_bis_ms: 112000 + i * 1000, urteil: 'ja',
      },
    });
  }
  const bericht = {
    quelle: '<erfunden>', aufnahme: A_N1, wurzel: ordner, plattenpruefung: true,
    kopfMaengel: [], eintraege, eintraegeGeprueft: true, verlauf: [],
    angenommen: 3, abgelehnt: 0, maengelGesamt: 0, hinweiseGesamt: 0,
    angenommenMitHinweis: 0, status: 'angenommen',
  };
  return S.baueSitzung({
    bericht, eingabeText: JSON.stringify(bericht), aufnahme: A_N1,
    projektwurzel: ordner, port: 8791,
  });
}

test('FA-N6: die ausgelieferte Shorts-Seite ist Byte fuer Byte die von ' + STAND_VOR_FA, () => {
  const alt = ausGit('src/upload/freigabe-seite.js');
  if (alt === null) {
    assert.fail('Der Stand ' + STAND_VOR_FA + ' ist aus git nicht zu holen. Dieser Test kann ' +
      'so nicht laufen, und er wird nicht als bestanden gezaehlt.');
  }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-n6-'));
  try {
    const altDatei = path.join(ordner, 'freigabe-seite-alt.cjs');
    fs.writeFileSync(altDatei, alt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const ALT = require(altDatei);

    const sitzung = shortsSitzungFuerVergleich(ordner);
    const vorher = Buffer.from(ALT.baueSeite(sitzung), 'utf8');
    const nachher = Buffer.from(SEITE.baueSeite(sitzung), 'utf8');

    assert.equal(nachher.length, vorher.length,
      'die Shorts-Seite ist ' + nachher.length + ' Bytes gross, vor FA waren es ' +
      vorher.length);
    if (!nachher.equals(vorher)) {
      let i = 0;
      while (i < vorher.length && vorher[i] === nachher[i]) i++;
      assert.fail('Die Shorts-Seite weicht ab Byte ' + i + ' ab.\n' +
        '  vorher:  ' + JSON.stringify(vorher.toString('utf8', Math.max(0, i - 60), i + 60)) +
        '\n  nachher: ' + JSON.stringify(nachher.toString('utf8', Math.max(0, i - 60), i + 60)));
    }

    // GEGENPROBE: der Vergleich muss zuschnappen.
    const verletzt = alt.replace('Shorts-Freigabe</title>', 'Shorts-Freigabe.</title>');
    assert.notEqual(verletzt, alt, 'die Gegenprobe hat wirklich etwas geaendert');
    const kaputtDatei = path.join(ordner, 'freigabe-seite-verletzt.cjs');
    fs.writeFileSync(kaputtDatei, verletzt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const KAPUTT = require(kaputtDatei);
    assert.ok(!Buffer.from(KAPUTT.baueSeite(sitzung), 'utf8').equals(nachher),
      'ein geaendertes Zeichen kam durch den Vergleich -- dann prueft er nichts');
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

test('FA-N6: der Shorts-Modus des Dienstes ist unveraendert, und seine Nachbarn sind es auch',
  () => {
    const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
    assert.ok(quelle.includes(
      "[MODUS_SHORTS]: new Set(['/', '/video', '/stand', '/kette', '/lauf']),"),
    'die GET-Routen des Shorts-Modus haben sich geaendert');
    assert.ok(quelle.includes(
      "[MODUS_SHORTS]: new Set(['/urteil', '/beenden', '/planen', '/archivieren', " +
      "'/hochladen']),"),
    'die POST-Routen des Shorts-Modus haben sich geaendert');

    const unberuehrt = [
      'src/upload/uploader.js', 'src/upload/planer.js', 'src/upload/uebergabe-leser.js',
      'src/upload/zettel-leser.js', 'src/upload/uebersicht.js', 'src/publish/cli-args.js',
      'src/youtube/auth.js', 'src/upload/longform-arbeiter.js',
      'src/upload/longform-gedaechtnis.js', 'src/upload/longform-kanal.js',
    ];
    const g = spawnSync('git', ['diff', '--name-only', STAND_VOR_FA, '--'].concat(unberuehrt),
      { cwd: WURZEL, encoding: 'utf8' });
    if (g.error || g.status !== 0) {
      assert.fail('git diff gegen ' + STAND_VOR_FA + ' ist nicht gelaufen. Dieser Test wird ' +
        'nicht als bestanden gezaehlt.');
    }
    assert.deepEqual(g.stdout.split('\n').map((z) => z.trim()).filter(Boolean), [],
      'eine Datei ausserhalb des Freigabedienstes ist angefasst worden');

    // GEGENPROBE: derselbe Aufruf auf die Datei, die dieser Auftrag umgebaut
    // hat. Zeigt er dort nichts, prueft er nichts.
    const g2 = spawnSync('git', ['diff', '--name-only', STAND_VOR_FA, '--',
      'src/upload/freigabe-server.js'], { cwd: WURZEL, encoding: 'utf8' });
    assert.equal(g2.status, 0);
    assert.equal(g2.stdout.trim(), 'src/upload/freigabe-server.js',
      'der Vergleich sieht nicht einmal die Datei, die dieser Auftrag umgebaut hat');
  });

test('FA-N6: --abloesung-von= wird im Shorts-Modus mit 2 abgewiesen, mit eigenem Satz', () => {
  const lauf = spawnSync(process.execPath,
    [SERVER, '--aufnahme=' + A_N1, '--wurzel=Q', '--abloesung-von=1'],
    { cwd: WURZEL, encoding: 'utf8', timeout: 30000 });
  const text = (lauf.stdout || '') + (lauf.stderr || '');
  assert.equal(lauf.status, S.EXIT_AUFRUFFEHLER,
    'der Aufruf endet mit ' + lauf.status + ':\n' + text);
  assert.match(text, /gibt es im Shorts-Modus nicht/);
  assert.match(text, /Es wurde nichts\ngelesen, nichts geschrieben und kein Port geoeffnet/);
  // Und er wird nicht als laufende Sitzung gedeutet (EK).
  assert.ok(!/laeuft bereits/.test(text), text);
});

// ===========================================================================
// NACHWEIS 7: WAS DER MUTATIONSLAUF GEFUNDEN HAT
// ===========================================================================
//
// Der Mutationslauf ueber die Sicherungen dieses Auftrags hat zwei gefunden,
// deren Ausbau nichts rot gemacht hat. Eine Sicherung, deren Ausbau nichts rot
// macht, ist keine.
//
//   M3   Die Bedingung "der Lauf ist zu Ende" im Weiter-Knopf. Ohne den Teil
//        `|| !l.ende` gaebe es den Knopf in dem Augenblick, in dem ein Lauf
//        aufgehoert hat zu laufen, das Ende aber noch nicht eingetragen ist --
//        ein Fenster von Millisekunden, in dem ein Klick den Dienst abloest,
//        waehrend der Rueckruf des Kindprozesses noch schreibt.
//
//   M7   Die Bedingung `daten.port === lage.erwarteterPort` in der
//        Bestaetigung. Ohne sie genuegte die Prozessnummer -- und die steht in
//        der Sperrdatei, BEVOR der Nachfolger seinen Trockenlauf gemacht hat.
//        Der Alte ginge dann, waehrend der Neue noch rechnen und scheitern
//        kann.

test('FA-N7 (M3): der Knopf gibt es nicht in der Luecke zwischen "laeuft nicht mehr" und ' +
  '"Ende eingetragen"', () => {
  // Der Zustand entsteht wirklich: beiEnde() setzt erst laeuft=false und dann
  // ende. Zwischen den beiden Zuweisungen liegt ein fs.existsSync.
  const zwischen = { modus: S.MODUS_LONGFORM, abloesung: null,
    lauf: { laeuft: false, ende: null } };
  const knopf = S.weiterKnopfDa(zwischen);
  assert.equal(knopf.da, false,
    'in der Luecke gibt es einen Knopf -- ein Klick dort loest den Dienst ab, waehrend der ' +
    'Rueckruf des Kindprozesses noch schreibt');
  assert.match(knopf.grund, /laeuft gerade ein Arbeiter/);
  // GEGENPROBE: mit eingetragenem Ende gibt es ihn.
  assert.equal(S.weiterKnopfDa({ modus: S.MODUS_LONGFORM, abloesung: null,
    lauf: { laeuft: false, ende: { code: 0 } } }).da, true);
});

test('FA-N7 (M7): die Bestaetigung verlangt den PORT und nicht nur die Prozessnummer',
  async () => {
    // DER SCHADEN: der Nachfolger hat die Sperre (seine Nummer steht drin),
    // aber noch keinen Port -- er ist mitten im Trockenlauf. Wer hier schon
    // bestaetigt, geht, waehrend der Neue noch scheitern kann.
    const zustand = { pid: 4242, port: null };
    let runden = 0;
    const lage = {
      erwarteterPort: 4711,
      grenzen: { anlaufMs: 10, uebernahmeMs: 400, taktMs: 10 },
      jetzt: Date.now,
      schlaf: (ms) => new Promise((f) => setTimeout(f, ms)),
      melde: () => {},
      starteNachfolger: () => ({ pid: 4242, befehl: 'x' }),
      nachfolgerStand: () => ({ lebt: true, code: null, signal: null, fehler: null }),
      portFreigeben: async () => {},
      portZurueckholen: async () => ({ ok: true }),
      sperreFreigeben: () => ({ geloescht: true, grund: 'ok' }),
      sperreZurueckholen: () => ({ ok: true, grund: 'ok' }),
      sperreLesen: () => { runden += 1; return { gelesen: true, daten: zustand }; },
    };
    // Nur die Nummer, nie ein Port -> die Abloesung wird NICHT bestaetigt.
    const ohnePort = await S.fuehreAbloesung(lage);
    assert.equal(ohnePort.gelungen, false,
      'die Abloesung gilt als gelungen, obwohl der Nachfolger nie einen Port geoeffnet hat');
    assert.ok(runden > 1, 'es wurde gar nicht nachgesehen');

    // GEGENPROBE: mit dem Port wird sie bestaetigt -- dieselbe Lage, ein Feld
    // mehr. Ein Test, der nur zeigt, dass etwas NICHT geht, hat nichts gezeigt.
    zustand.port = 4711;
    const mitPort = await S.fuehreAbloesung(lage);
    assert.equal(mitPort.gelungen, true, JSON.stringify(mitPort));

    // Und ein FREMDER Prozess auf dem richtigen Port genuegt ebenfalls nicht.
    zustand.pid = 9999;
    const fremd = await S.fuehreAbloesung(lage);
    assert.equal(fremd.gelungen, false,
      'ein fremder Halter der Sperre gilt als der eigene Nachfolger');
  });

// ===========================================================================
// NACHWEIS 8: DIE ZUSAGEN, DIE AN ZAHLEN HAENGEN
// ===========================================================================

test('FA-N8: die Argumentliste des Nachfolgers steht fest -- fuenf Stuecke, keine Shell', () => {
  const argumente = S.abloesungsArgumente({ aufnahme: A_N1, port: 8791, pid: 1234 });
  assert.deepEqual(argumente, [
    S.DIESES_SKRIPT,
    '--modus=longform',
    '--aufnahme=' + A_N1,
    '--port=8791',
    '--abloesung-von=1234',
  ]);
  // DER NACHFOLGER IST DIESE DATEI. Nicht ein Wert aus einer Einstellung.
  assert.equal(S.DIESES_SKRIPT, SERVER);
  // KEIN --no-browser: der Sinn dieses Knopfes ist, dass die naechste Seite
  // DASTEHT. Die Tests oben haengen es an, damit kein Fenster aufgeht -- dass
  // die echte Liste es NICHT traegt, steht hier.
  assert.ok(!argumente.includes('--no-browser'),
    'der Nachfolger oeffnet keine Seite -- dann schaltet der Knopf nicht weiter');
  // KEINE SHELL. Gestartet wird process.execPath -- die .exe des laufenden
  // node --, und nicht "node" aus dem PATH. Auf Windows genuegte shell:false
  // dafuer nicht: CreateProcess kann kein .cmd, Windows schiebt dafuer cmd.exe
  // dazwischen, und ein node.cmd aus einem npm-/nvm-/Volta-Schuh machte aus
  // dem sicheren Weg unbemerkt den unsicheren. Der Compositor loest denselben
  // Fall auf seiner Seite auf (EZ, finde_node_programm); hier ist er gar nicht
  // erst zu loesen.
  const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
  const rumpf = quelle.slice(quelle.indexOf('function starteNachfolgerProzess('),
    quelle.indexOf('function schlafeHart('));
  // DIE OPTIONEN STEHEN HIER ALS EINE ZEICHENKETTE, und der Hilfs-Vorgaenger in
  // FA-N1 benutzt WOERTLICH dieselbe. Aendert sich die Produktion, faellt
  // dieser Test -- und dann wird der Helfer im selben Zug mitgezogen, statt
  // still auseinanderzulaufen.
  assert.ok(rumpf.includes('spawn(process.execPath, argumente,\n    ' +
    NACHFOLGER_OPTIONEN + ')'),
  'die Startoptionen des Nachfolgers haben sich geaendert:\n' + rumpf.slice(0, 400));
  assert.ok(VORGAENGER_SKRIPT.includes(NACHFOLGER_OPTIONEN),
    'der Hilfs-Vorgaenger in FA-N1 startet mit anderen Optionen als die Produktion');
  // detached: true IST GEMESSEN. Ohne es haengt libuv das Kind in ein globales
  // Job-Objekt mit KILL_ON_JOB_CLOSE, und Windows bringt es um, sobald der
  // Vorgaenger endet -- also genau der Zustand, in dem beide weg sind. Der
  // erste Entwurf stand ohne; FA-N1 hat es gefangen.
  assert.match(rumpf, /detached: true/);
  assert.ok(!/shell/.test(rumpf), 'der Start des Nachfolgers nennt eine Shell');
  assert.ok(!/'node'|"node"/.test(rumpf), 'der Start des Nachfolgers sucht node im PATH');
  // Und in der ganzen Datei wird nie ueber eine Shell gestartet.
  const code = quelle.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.ok(!/shell:\s*true/.test(code), 'irgendwo steht shell: true');
});

test('FA-N8: der echte Start des Nachfolgers erzeugt einen echten Prozess -- ohne Shell',
  async () => {
    // starteNachfolgerProzess() selbst, ohne Umweg. Der Nachfolger laeuft in
    // sein Warten hinein und wird dort weggeraeumt -- er kommt gar nicht bis
    // zum Trockenlauf und damit auch nicht bis zu einem Browserfenster.
    const aufnahme = A_N2A;
    const pfad = sperrpfad(aufnahme);
    raeumeSperre(aufnahme);
    fs.mkdirSync(path.dirname(pfad), { recursive: true });
    // Eine Sperre, die der TESTPROZESS haelt: der Nachfolger wartet damit auf
    // uns und kommt nicht weiter.
    fs.writeFileSync(pfad, JSON.stringify({ artifact_type: 'adw_longform_freigabe_sperre',
      schema_version: '1.1', aufnahme, modus: 'longform', pid: process.pid, port: null,
      gestartet_am: new Date().toISOString() }, null, 2) + '\n');
    let stand = { lebt: true };
    let gestartet = null;
    try {
      gestartet = S.starteNachfolgerProzess({
        aufnahme, port: 8791, pid: process.pid, beiStand: (s) => { stand = s; } });
      assert.ok(Number.isInteger(gestartet.pid) && gestartet.pid > 0,
        'es ist kein Prozess entstanden');
      assert.match(gestartet.befehl, /freigabe-server\.js/);
      await schlaf(1200);
      assert.equal(stand.lebt, true,
        'der Nachfolger ist sofort gestorben (' + JSON.stringify(stand) + ')');
      assert.equal(S.prozessLebt(gestartet.pid).lebt, true);
      // Er hat NICHTS genommen: die Sperre gehoert weiterhin uns.
      assert.equal(sperrePidVon(aufnahme), process.pid);
    } finally {
      if (gestartet && gestartet.pid) { try { process.kill(gestartet.pid); } catch (e) { /* egal */ } }
      await schlaf(300);
      raeumeSperre(aufnahme);
    }
  });

test('FA-N8: die Grenzen stehen als Zahlen da, und sie passen zueinander', () => {
  // Die Bestaetigung muss laenger warten koennen als der Trockenlauf des
  // Nachfolgers dauern darf -- sonst gibt der Alte auf, waehrend der Neue noch
  // rechnet. Und der Nachfolger muss laenger warten als der Anlauf dauert.
  assert.ok(S.ABLOESUNG_UEBERNAHME_MS > 170000,
    'die Bestaetigung ist kuerzer als der Trockenlauf des Arbeiters dauern darf (170 s)');
  assert.ok(S.ABLOESUNG_WARTEN_MS > S.ABLOESUNG_ANLAUF_MS * 3,
    'der Nachfolger gibt auf, bevor der Anlauf des Vorgaengers durch ist');
  assert.ok(S.ABLOESUNG_TAKT_MS > 0 && S.ABLOESUNG_TAKT_MS < S.ABLOESUNG_ANLAUF_MS);
});
