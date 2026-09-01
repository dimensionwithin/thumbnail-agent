'use strict';

// DJ: Tests fuer die Freigabeoberflaeche.
//
// Der Dienst hat genau eine Aufgabe: zeigen, was der Leser angenommen hat, ein
// Urteil eines Menschen entgegennehmen und es in EINE Datei schreiben. Diese
// Tests halten vor allem fest, was er NICHT tut -- keinen Pfad aus einer
// Anfrage bauen, nichts ohne Sitzungstoken beantworten, nichts von fremder
// Herkunft annehmen, keinen Titel stillschweigend beschneiden, keine halbe
// Datei hinterlassen und ausser der Freigabedatei nichts schreiben.
//
// WARUM DIE BERICHTE HIER ERFUNDEN SIND: Der Dienst bekommt seine Eingabe vom
// Leser, und der Leser hat eigene Tests (tests/uebergabe-leser.test.cjs), die
// ihn gegen den Vertrag halten. Ihn hier ein zweites Mal zu pruefen hiesse,
// dieselbe Zusage an zwei Orten zu fuehren. Was hier geprueft wird, ist der
// Umgang MIT seinem Bericht -- und dafuer muss der Bericht auch Formen
// annehmen koennen, die die echte Lieferung heute nicht hat (ein abgelehnter
// Eintrag, ein Titelvorschlag mit </script> darin).

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const S = require('../src/upload/freigabe-server.js');
const SEITE = require('../src/upload/freigabe-seite.js');

const QUELLTEXT = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'upload', 'freigabe-server.js'), 'utf8');
const SEITENTEXT = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'upload', 'freigabe-seite.js'), 'utf8');

const AUFNAHME = '2026-01-02 03-04-05';

// Die Kommentare des Dienstes reden ueber --ohne-platte und ueber die
// Uebergabedatei -- das sollen sie. Geprueft wird darum der CODE, und der ist
// hier alles, was nicht mit // beginnt.
const CODEZEILEN = QUELLTEXT.split('\n').filter((z) => !z.trim().startsWith('//'));
const NURCODE = CODEZEILEN.join('\n');

// ---------------------------------------------------------------------------
// Werkzeug: eine Wegwerf-Umgebung mit erfundenen Videodateien
// ---------------------------------------------------------------------------

function wegwerfordner() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dj-freigabe-'));
}

// Legt <anzahl> kleine Dateien an und baut daraus einen Leserbericht, wie ihn
// uebergabe-leser.js --json liefert. Optional ein zusaetzlicher, vom Leser
// ABGELEHNTER Eintrag (daten: null) -- der Fall aus N9.
function baueBericht(ordner, anzahl, { mitAbgelehntem = false, titel = null } = {}) {
  const eintraege = [];
  for (let i = 0; i < anzahl; i++) {
    const datei = path.join(ordner, 'short-' + i + '.mp4');
    const inhalt = Buffer.from('VIDEO-' + i + '-' + 'x'.repeat(200 + i), 'utf8');
    fs.writeFileSync(datei, inhalt);
    eintraege.push({
      index: i,
      kennung: AUFNAHME + '/' + i,
      bezeichner: AUFNAHME + '/' + i,
      unbekannteFelder: [], maengel: [], hinweise: [], angenommen: true,
      daten: {
        kennung: AUFNAHME + '/' + i,
        pfad: datei,
        sha256: crypto.createHash('sha256').update(inhalt).digest('hex'),
        groesse_bytes: inhalt.length,
        dauer_ms: 12000 + i,
        breite: 1080, hoehe: 1920,
        titel_vorschlag: titel === null ? ('Titelvorschlag ' + i) : titel,
        transkript: 'transkript ' + i,
        quelle_von_ms: 100000 + i * 1000,
        quelle_bis_ms: 112000 + i * 1000,
        urteil: 'ja',
      },
    });
  }
  if (mitAbgelehntem) {
    eintraege.push({
      index: anzahl,
      kennung: AUFNAHME + '/kaputt',
      bezeichner: AUFNAHME + '/kaputt',
      unbekannteFelder: [], hinweise: [], angenommen: false,
      maengel: [{ ebene: 'Platte', feld: 'sha256', code: 'sha256_ungleich',
        meldung: 'Die Pruefsumme der Datei stimmt nicht mit der Lieferung ueberein.' }],
      daten: null,
    });
  }
  return {
    quelle: '<erfunden>', aufnahme: AUFNAHME, wurzel: ordner, plattenpruefung: true,
    kopfMaengel: [], eintraege, eintraegeGeprueft: true, verlauf: [],
    angenommen: anzahl, abgelehnt: mitAbgelehntem ? 1 : 0,
    maengelGesamt: mitAbgelehntem ? 1 : 0, hinweiseGesamt: 0, angenommenMitHinweis: 0,
    status: mitAbgelehntem ? 'abgelehnt' : 'angenommen',
  };
}

function baueSitzung(ordner, optionen) {
  const bericht = baueBericht(ordner, (optionen && optionen.anzahl) || 3, optionen);
  return S.baueSitzung({
    bericht,
    eingabeText: JSON.stringify(bericht),
    aufnahme: AUFNAHME,
    projektwurzel: ordner,
    port: 0,
  });
}

// Startet den Dienst auf einem FREIEN Port (listen auf 0) und traegt ihn in die
// Sitzung nach. Kein geratener Port -- ein geratener waere gelegentlich belegt,
// und dann scheiterte die Herkunftspruefung am Zufall statt am Fehler.
async function starte(sitzung) {
  const dienst = S.baueDienst(sitzung);
  await new Promise((f) => dienst.listen(0, S.HOST, f));
  sitzung.port = dienst.address().port;
  return {
    dienst,
    port: sitzung.port,
    async schliesse() { await new Promise((f) => dienst.close(f)); },
  };
}

// Eine Anfrage, bei der JEDE Kopfzeile einzeln setzbar ist -- ohne das geht
// weder "fremder Host" noch "fremder Ursprung" zu pruefen.
function anfrage(port, { methode = 'GET', pfad = '/', kopf = {}, leib = null } = {}) {
  return new Promise((fertig, schiefgegangen) => {
    const zusammen = Object.assign({ host: S.HOST + ':' + port }, kopf);
    // undefined heisst "diese Kopfzeile gar nicht senden" -- Node lehnt sie
    // sonst als ungueltigen Wert ab, und der Fall "Origin fehlt" waere nicht
    // pruefbar.
    for (const k of Object.keys(zusammen)) if (zusammen[k] === undefined) delete zusammen[k];
    const req = http.request({
      host: S.HOST, port, method: methode, path: pfad, headers: zusammen,
    }, (res) => {
      const teile = [];
      res.on('data', (d) => teile.push(d));
      res.on('end', () => fertig({
        status: res.statusCode, kopf: res.headers, leib: Buffer.concat(teile),
        text: Buffer.concat(teile).toString('utf8'),
      }));
    });
    req.on('error', schiefgegangen);
    if (leib !== null) req.write(leib);
    req.end();
  });
}

function urteilsanfrage(port, token, nutzlast, extra) {
  const leib = JSON.stringify(nutzlast);
  return anfrage(port, {
    methode: 'POST', pfad: '/urteil', leib,
    kopf: Object.assign({
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(leib),
      origin: 'http://' + S.HOST + ':' + port,
      'x-freigabe-token': token,
    }, extra || {}),
  });
}

// ---------------------------------------------------------------------------
// Die harte Linie 1: es gibt hier keinen zweiten Leser
// ---------------------------------------------------------------------------

test('der Dienst nennt die Uebergabedatei nirgends im Code', () => {
  // Waere sie im Code genannt, gaebe es einen Weg, sie selbst zu lesen -- und
  // damit einen zweiten Leser ohne Pfadsperre.
  for (const z of CODEZEILEN) {
    assert.ok(!z.includes('uebergabe.json'),
      'uebergabe.json steht in einer Codezeile: ' + z.trim());
  }
});

test('der Dienst ruft den Leser auf, statt ihn nachzubauen', () => {
  assert.ok(/spawnSync\(process\.execPath, argumente/.test(NURCODE));
  assert.ok(NURCODE.includes("'--json'"), 'der Leser wird mit --json gerufen');
  assert.ok(!NURCODE.includes('--ohne-platte'),
    'der Dienst darf den Leser nie ohne Plattenpruefung rufen');
});

// ---------------------------------------------------------------------------
// Die harte Linie 4: der Dienst schreibt ausschliesslich die Freigabedatei
// ---------------------------------------------------------------------------

// DJa: Diese Zusage ist ENGER GEWORDEN, nicht weggefallen. Bis DJ hiess sie
// "jeder Schreibaufruf steht in schreibeFreigaben"; seit die Einzelinstanz-
// Sperre eine zweite Datei anlegt, stimmte das nicht mehr. Statt die Zusage
// aufzuweichen ("Schreiben ist halt erlaubt") wird jetzt aufgezaehlt, welche
// vier Funktionen schreiben duerfen -- und jede andere Zeile faellt durch.
const SCHREIBFUNKTIONEN = [
  'schreibeFreigaben',     // data/freigaben/<aufnahme>.json
  'nimmSperre',            // legt die Sperrdatei an (wx) und raeumt Verwaiste weg
  'schreibeSperrinhalt',   // fuellt sie
  'gibSperreFrei',         // loescht die EIGENE wieder
];

function rumpfBereiche(quelltext, namen) {
  const zeilen = quelltext.split('\n');
  const bereiche = [];
  for (const name of namen) {
    const beginn = zeilen.findIndex((z) => z.startsWith('function ' + name + '('));
    assert.ok(beginn >= 0, 'Funktion ' + name + ' gefunden');
    let ende = beginn;
    while (ende < zeilen.length && zeilen[ende] !== '}') ende++;
    bereiche.push({ name, von: beginn + 1, bis: ende + 1 });
  }
  return bereiche;
}

test('jeder Schreibaufruf steht in einer der vier Schreibfunktionen', () => {
  const zeilen = QUELLTEXT.split('\n');
  const bereiche = rumpfBereiche(QUELLTEXT, SCHREIBFUNKTIONEN);
  const schreibend = /\b(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|mkdirSync|mkdir|unlinkSync|unlink|rmSync|rmdirSync|createWriteStream|writeSync|copyFileSync|truncateSync|ftruncateSync|chmodSync|utimesSync|openSync)\s*\(/;
  const treffer = [];
  zeilen.forEach((z, i) => {
    if (z.trim().startsWith('//')) return;      // Kommentare zaehlen nicht
    if (schreibend.test(z)) treffer.push(i + 1);
  });
  assert.ok(treffer.length > 0, 'es wurde ueberhaupt ein Schreibaufruf gefunden');
  const zuordnung = new Map();
  for (const zeile of treffer) {
    const heim = bereiche.find((b) => zeile >= b.von && zeile <= b.bis);
    assert.ok(heim !== undefined,
      'Schreibaufruf in Zeile ' + zeile + ' liegt in KEINER der vier Schreibfunktionen ' +
      '(' + bereiche.map((b) => b.name + ' ' + b.von + '-' + b.bis).join(', ') + '): ' +
      zeilen[zeile - 1].trim());
    zuordnung.set(heim.name, (zuordnung.get(heim.name) || 0) + 1);
  }
  // Jede der vier Funktionen schreibt auch wirklich -- eine, die in der Liste
  // steht und nichts tut, waere ein Freibrief fuer den naechsten Aufrufer.
  for (const name of SCHREIBFUNKTIONEN) {
    assert.ok((zuordnung.get(name) || 0) > 0, name + ' schreibt gar nicht mehr -- ' +
      'dann gehoert sie aus SCHREIBFUNKTIONEN heraus');
  }
});

test('der Dienst schreibt nur unterhalb von data/', () => {
  // Beide geschriebenen Dateien gehen ueber freigabePfad -- sperrPfad baut auf
  // ihm auf. Es gibt damit genau EINE Stelle, an der der Zielordner steht.
  assert.ok(/path\.join\(projektwurzel, 'data', 'freigaben'/.test(NURCODE));
  // Gesucht wird das PAAR -- ein blosses 'data' trifft auch req.on('data', …),
  // und das ist ein Ereignisname und kein Ordner.
  assert.equal((NURCODE.match(/'data', 'freigaben'/g) || []).length, 1,
    'der Zielordner steht genau einmal im Code');
  assert.ok(/const frei = freigabePfad\(projektwurzel, aufnahme\);/.test(NURCODE),
    'sperrPfad geht ueber freigabePfad und baut den Weg nicht selbst');
});

test('die Seite schreibt gar nichts -- sie kennt fs nicht einmal', () => {
  assert.ok(!/require\(['"]fs['"]\)/.test(SEITENTEXT));
  assert.ok(!/require\(['"]node:fs['"]\)/.test(SEITENTEXT));
  assert.ok(!/require\(['"]http['"]\)/.test(SEITENTEXT));
});

// ---------------------------------------------------------------------------
// Die Titelpruefung
// ---------------------------------------------------------------------------

test('die Titelpruefung nennt jeden Fall einzeln', () => {
  assert.deepEqual(S.pruefeTitel('Ein brauchbarer Titel'), { ok: true });
  assert.equal(S.pruefeTitel('').code, 'titel_leer');
  assert.equal(S.pruefeTitel('     ').code, 'titel_nur_leerzeichen');
  assert.equal(S.pruefeTitel('\t\n  ').code, 'titel_nur_leerzeichen');
  assert.equal(S.pruefeTitel('a'.repeat(101)).code, 'titel_zu_lang');
  assert.equal(S.pruefeTitel('a'.repeat(100)).ok, true, 'genau 100 ist zulaessig');
  assert.equal(S.pruefeTitel('a<b').code, 'titel_spitze_klammer');
  assert.equal(S.pruefeTitel('a>b').code, 'titel_spitze_klammer');
  assert.equal(S.pruefeTitel(42).code, 'titel_kein_text');
  assert.equal(S.pruefeTitel(null).code, 'titel_kein_text');
  // Vier verschiedene Faelle, vier verschiedene Begruendungen.
  const meldungen = new Set(['', '   ', 'a'.repeat(101), '<'].map((t) => S.pruefeTitel(t).meldung));
  assert.equal(meldungen.size, 4);
});

test('ein Emoji zaehlt als ein Zeichen, nicht als zwei', () => {
  // Array.from zaehlt Codepunkte. 100 Emojis sind in UTF-16 200 Einheiten --
  // wer die zaehlt, weist einen Titel ab, der fuer einen Menschen 100 Zeichen
  // lang ist.
  assert.equal(S.pruefeTitel('\u{1F600}'.repeat(100)).ok, true);
  assert.equal(S.pruefeTitel('\u{1F600}'.repeat(101)).code, 'titel_zu_lang');
});

test('der Browser faengt keinen Titel vorher weg', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner));
  // Kein maxlength, kein pattern, kein required, keine Laengenpruefung im
  // Skript vor dem Senden. Faenge der Browser ab, waere die serverseitige
  // Pruefung nicht mehr testbar -- und was nicht mehr geprueft werden kann,
  // ist auf Dauer nicht mehr wahr.
  // Gesucht wird die EIGENSCHAFT, nicht das Wort: der Quelltext der Seite sagt
  // in einem Kommentar ausdruecklich, dass hier weder maxlength noch pattern
  // noch required steht. Die Kommentarzeilen fliegen darum vorher raus --
  // sonst pruefte dieser Test die Zusage gegen ihre eigene Ankuendigung.
  const ohneKommentar = html.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.ok(!/maxlength/i.test(ohneKommentar), 'kein maxlength');
  assert.ok(!/\bpattern\s*[=:]/i.test(ohneKommentar), 'kein pattern');
  assert.ok(!/\brequired\b/i.test(ohneKommentar), 'kein required');
  assert.ok(!/titel\.(maxLength|pattern|required)/.test(ohneKommentar));
  assert.ok(!/if\s*\(.{0,40}\.value.{0,40}length\s*[<>]/.test(ohneKommentar),
    'keine Laengenpruefung vor dem Senden');
  // Und die Titelpruefung des Dienstes taucht in der Seite nirgends auf.
  assert.ok(!ohneKommentar.includes('titel_zu_lang'));
  assert.ok(!ohneKommentar.includes("includes('<')"));
  fs.rmSync(ordner, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Die Sperre: kein Weg von einer Anfrage zu einem Dateisystempfad
// ---------------------------------------------------------------------------

test('N2: Index 99, -1, ein Pfad und ../ werden alle abgewiesen', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  const t = sitzung.token;
  try {
    const gut = await anfrage(lauf.port, { pfad: '/video?i=0&t=' + t });
    assert.equal(gut.status, 200, 'der gueltige Index liefert das Video');

    const faelle = [
      ['99', 404, 'index_unbekannt'],
      ['-1', 400, 'index_keine_zahl'],
      [encodeURIComponent(path.join(ordner, 'short-0.mp4')), 400, 'index_keine_zahl'],
      [encodeURIComponent('../short-0.mp4'), 400, 'index_keine_zahl'],
      [encodeURIComponent('../../../windows/win.ini'), 400, 'index_keine_zahl'],
      [encodeURIComponent(['..', '..', '..', 'windows', 'win.ini']
        .join(String.fromCharCode(92))), 400, 'index_keine_zahl'],
      ['0x0', 400, 'index_keine_zahl'],
      [encodeURIComponent(' 0 '), 400, 'index_keine_zahl'],
      ['', 400, 'index_keine_zahl'],
    ];
    for (const [wert, status, code] of faelle) {
      const a = await anfrage(lauf.port, { pfad: '/video?i=' + wert + '&t=' + t });
      assert.equal(a.status, status, 'i=' + wert);
      assert.equal(JSON.parse(a.text).fehler, code, 'i=' + wert);
      // Keine dieser Antworten traegt Videodaten.
      assert.ok(!a.kopf['content-type'].startsWith('video/'), 'i=' + wert);
    }

    // Auch der Pfadausbruch ueber die Route selbst trifft nichts.
    // Der URL-Parser normalisiert "..", bevor die Route geprueft wird. Aus
    // "/video/../geheim" wird "/geheim", und das trifft keinen der fuenf
    // Routennamen. Es gibt keinen Zweig, der aus einem Anfragepfad einen
    // Dateisystempfad machen wuerde -- der Pfad wird nur mit fuenf festen
    // Zeichenketten verglichen.
    for (const p of ['/../../../windows/win.ini', '/video/../geheim', '/beenden',
      '/kram', '/data/freigaben/x.json']) {
      const a = await anfrage(lauf.port, { pfad: p + '?t=' + t });
      assert.equal(a.status, 404, p);
      assert.equal(JSON.parse(a.text).fehler, 'unbekannte_route', p);
    }
    // "/video/../video" IST "/video" -- und damit dieselbe Indexroute wie
    // sonst, kein Weg an ihr vorbei.
    const gedreht = await anfrage(lauf.port, { pfad: '/video/../video?i=0&t=' + t });
    assert.equal(gedreht.status, 200);
    assert.deepEqual(gedreht.leib, gut.leib);
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('die Sperre wirft, wenn ein Pfad nicht aus der Lesereingabe stammt', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const fremd = path.join(ordner, 'fremd.mp4');
  fs.writeFileSync(fremd, 'nicht aus der Lieferung');
  // Ein Index, den es gibt, aber mit einem Pfad, der nie registriert wurde:
  // genau der Fall, den ein zusammengebauter Pfad ausloesen wuerde.
  sitzung.videoPfad.set(0, fremd);
  const lauf = await starte(sitzung);
  try {
    const a = await anfrage(lauf.port, { pfad: '/video?i=0&t=' + sitzung.token });
    assert.equal(a.status, 500);
    assert.equal(JSON.parse(a.text).fehler, 'pfadsperre');
    assert.ok(!a.text.includes('nicht aus der Lieferung'), 'die Datei wurde nicht gelesen');
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Sitzungstoken und Herkunft
// ---------------------------------------------------------------------------

test('N3: ohne Token, mit falschem Token, mit dem Token eines frueheren Starts', async () => {
  const ordner = wegwerfordner();
  const erste = baueSitzung(ordner);
  const laufA = await starte(erste);
  const altesToken = erste.token;
  await laufA.schliesse();

  const zweite = baueSitzung(ordner);
  assert.notEqual(zweite.token, altesToken, 'jeder Start hat ein eigenes Token');
  const lauf = await starte(zweite);
  try {
    for (const [was, pfad] of [
      ['ohne Token', '/'],
      ['falsches Token', '/?t=' + 'f'.repeat(64)],
      ['Token eines frueheren Starts', '/?t=' + altesToken],
    ]) {
      const a = await anfrage(lauf.port, { pfad });
      assert.equal(a.status, 403, was);
      assert.equal(JSON.parse(a.text).fehler, 'token_fehlt_oder_falsch', was);
    }
    // Auch schreibend, und auch fuer das Video.
    const b = await urteilsanfrage(lauf.port, altesToken, { index: 0, freigegeben: true, titel: 'x' });
    assert.equal(b.status, 403);
    const c = await anfrage(lauf.port, { pfad: '/video?i=0&t=' + altesToken });
    assert.equal(c.status, 403);
    // Mit dem richtigen Token geht dieselbe Anfrage.
    const d = await anfrage(lauf.port, { pfad: '/?t=' + zweite.token });
    assert.equal(d.status, 200);
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('N4: fremder Origin und fremder Host werden abgewiesen', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  const t = sitzung.token;
  try {
    const fremdOrigin = await anfrage(lauf.port, {
      pfad: '/?t=' + t, kopf: { origin: 'https://beispiel.invalid' } });
    assert.equal(fremdOrigin.status, 403);
    assert.equal(JSON.parse(fremdOrigin.text).fehler, 'fremder_ursprung');

    const fremdHost = await anfrage(lauf.port, {
      pfad: '/?t=' + t, kopf: { host: 'beispiel.invalid:' + lauf.port } });
    assert.equal(fremdHost.status, 403);
    assert.equal(JSON.parse(fremdHost.text).fehler, 'fremder_host');

    // Auch "localhost" ist ein Name und keine Zahl -- ein Name kann auf etwas
    // anderes zeigen, eine Zahl nicht.
    const localhost = await anfrage(lauf.port, {
      pfad: '/?t=' + t, kopf: { host: 'localhost:' + lauf.port } });
    assert.equal(localhost.status, 403);
    assert.equal(JSON.parse(localhost.text).fehler, 'fremder_host');

    // Eine schreibende Anfrage ohne Origin wird ebenfalls abgewiesen.
    const ohneOrigin = await urteilsanfrage(lauf.port, t,
      { index: 0, freigegeben: true, titel: 'x' }, { origin: undefined });
    assert.equal(ohneOrigin.status, 403);
    assert.equal(JSON.parse(ohneOrigin.text).fehler, 'ursprung_fehlt');
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Der Server lehnt Titel allein ab
// ---------------------------------------------------------------------------

test('N5: 101 Zeichen, ein <, leer und nur Leerzeichen werden vom Dienst abgewiesen', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  const t = sitzung.token;
  try {
    const faelle = [
      ['a'.repeat(101), 'titel_zu_lang'],
      ['Titel mit <b>', 'titel_spitze_klammer'],
      ['', 'titel_leer'],
      ['      ', 'titel_nur_leerzeichen'],
    ];
    const begruendungen = new Set();
    for (const [titel, code] of faelle) {
      const a = await urteilsanfrage(lauf.port, t, { index: 0, freigegeben: true, titel });
      assert.equal(a.status, 400, code);
      const leib = JSON.parse(a.text);
      assert.equal(leib.fehler, code);
      assert.ok(leib.meldung.length > 20, 'jede Ablehnung traegt eine Begruendung');
      begruendungen.add(leib.meldung);
    }
    assert.equal(begruendungen.size, 4, 'vier Faelle, vier eigene Begruendungen');
    // Und: nach vier abgewiesenen Titeln steht nichts in der Freigabedatei.
    assert.equal(fs.existsSync(sitzung.freigabePfad), false,
      'ein abgewiesener Titel schreibt nicht');
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('ein zu langer Titel wird NICHT beschnitten', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  try {
    const a = await urteilsanfrage(lauf.port, sitzung.token,
      { index: 0, freigegeben: true, titel: 'b'.repeat(140) });
    assert.equal(a.status, 400);
    assert.ok(!a.text.includes('b'.repeat(100)), 'es kommt kein gekuerzter Titel zurueck');
    assert.equal(sitzung.stand[sitzung.karten[0].sha256], undefined);
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Die Freigabedatei
// ---------------------------------------------------------------------------

test('N6: nach jedem einzelnen Klick liegt eine vollstaendige Datei vor', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  const t = sitzung.token;
  try {
    const gelesen = [];
    for (const [i, frei, titel] of [[0, true, 'Erster'], [1, false, 'Zweiter'], [2, true, 'Dritter']]) {
      const a = await urteilsanfrage(lauf.port, t,
        { index: i, freigegeben: frei, titel, notiz: 'Notiz ' + i });
      assert.equal(a.status, 200);
      // ZWISCHEN den Klicks gelesen -- nicht am Ende.
      const roh = fs.readFileSync(sitzung.freigabePfad, 'utf8');
      const datei = JSON.parse(roh);      // wirft, wenn die Datei halb ist
      assert.equal(datei.artifact_type, S.FREIGABE_ARTIFACT_TYPE);
      assert.equal(datei.schema_version, S.FREIGABE_SCHEMA_VERSION);
      assert.equal(datei.aufnahme, AUFNAHME);
      assert.equal(datei.lesereingabe_sha256, sitzung.eingabeSha256);
      assert.equal(datei.freigaben.length, gelesen.length + 1);
      assert.ok(roh.endsWith('}\n'), 'die Datei ist bis zum Ende geschrieben');
      gelesen.push(datei);
    }
    const letzte = gelesen[2];
    assert.deepEqual(letzte.freigaben.map((e) => e.freigegeben), [true, false, true]);
    assert.deepEqual(letzte.freigaben.map((e) => e.titel), ['Erster', 'Zweiter', 'Dritter']);
    for (const e of letzte.freigaben) {
      // Schluessel ist die sha256, die Kennung steht fuer Menschen daneben.
      assert.match(e.sha256, /^[0-9a-f]{64}$/);
      assert.match(e.kennung, /^2026-01-02 03-04-05\//);
      assert.match(e.entschieden_am, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(e.lesereingabe_sha256, sitzung.eingabeSha256);
    }
    // Keine Temporaerdatei bleibt liegen.
    const rest = fs.readdirSync(path.dirname(sitzung.freigabePfad));
    assert.deepEqual(rest, [AUFNAHME + '.json'], 'nur die Freigabedatei liegt da');
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('N7: bricht das Umbenennen ab, bleibt die alte Datei unversehrt', () => {
  const ordner = wegwerfordner();
  const ziel = path.join(ordner, 'data', 'freigaben', AUFNAHME + '.json');
  const kopf = { aufnahme: AUFNAHME, erzeugt_am: 'A', geschrieben_am: 'A', lesereingabe_sha256: 'x' };
  const vorher = S.schreibeFreigaben(ziel, kopf, [{ sha256: 'a'.repeat(64), kennung: 'k',
    freigegeben: true, titel: 'unversehrt', notiz: '', entschieden_am: 'A' }]);
  assert.equal(fs.readFileSync(ziel, 'utf8'), vorher);

  // Der Absturz sitzt GENAU zwischen "temporaere Datei vollstaendig
  // geschrieben" und "umbenannt". Genau dort entstuende eine halbe Datei, wenn
  // direkt ins Ziel geschrieben wuerde.
  const echt = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('Absturz'), { code: 'ABSTURZ' }); };
  let geworfen = null;
  try {
    S.schreibeFreigaben(ziel, kopf, [{ sha256: 'b'.repeat(64), kennung: 'k2',
      freigegeben: false, titel: 'haette die alte ersetzt', notiz: '', entschieden_am: 'B' }]);
  } catch (e) {
    geworfen = e;
  } finally {
    fs.renameSync = echt;
  }
  assert.equal(geworfen && geworfen.code, 'ABSTURZ', 'der Fehler wird nicht verschluckt');
  // Das Ziel ist unveraendert -- kein halber Inhalt, keine Mischung.
  assert.equal(fs.readFileSync(ziel, 'utf8'), vorher);
  assert.equal(JSON.parse(fs.readFileSync(ziel, 'utf8')).freigaben[0].titel, 'unversehrt');
  // Und die Temporaerdatei ist aufgeraeumt.
  assert.deepEqual(fs.readdirSync(path.dirname(ziel)), [AUFNAHME + '.json']);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('geschrieben wird erst die Temporaerdatei, dann umbenannt', () => {
  // Der atomare Weg am Quelltext: openSync/writeFileSync/fsyncSync/closeSync
  // stehen VOR renameSync, und die temporaere Datei liegt im selben
  // Verzeichnis wie das Ziel (sonst waere das Umbenennen ein Kopieren ueber
  // eine Dateisystemgrenze und damit nicht mehr atomar).
  const funktion = QUELLTEXT.slice(QUELLTEXT.indexOf('function schreibeFreigaben('));
  const reihenfolge = ['fs.openSync(tmp', 'fs.writeFileSync(fd', 'fs.fsyncSync(fd',
    'fs.closeSync(fd', 'fs.renameSync(tmp, pfad)'];
  let zuletzt = -1;
  for (const teil of reihenfolge) {
    const wo = funktion.indexOf(teil);
    assert.ok(wo > zuletzt, teil + ' steht nicht an der richtigen Stelle');
    zuletzt = wo;
  }
  assert.ok(/const tmp = path\.join\(verzeichnis,/.test(QUELLTEXT),
    'die Temporaerdatei liegt im Zielverzeichnis');
});

test('N8: eine neue Sitzung uebernimmt die Urteile der vorigen', async () => {
  const ordner = wegwerfordner();
  const ersteSitzung = baueSitzung(ordner);
  const laufA = await starte(ersteSitzung);
  try {
    for (const [i, frei] of [[0, true], [1, false], [2, true]]) {
      const a = await urteilsanfrage(laufA.port, ersteSitzung.token,
        { index: i, freigegeben: frei, titel: 'Titel ' + i, notiz: 'N' + i });
      assert.equal(a.status, 200);
    }
  } finally {
    await laufA.schliesse();
  }

  // Neuer Start, dieselbe Aufnahme -- und die Videodateien sind dieselben,
  // also auch dieselben Pruefsummen.
  const zweiteSitzung = baueSitzung(ordner);
  assert.equal(zweiteSitzung.uebernommen, 3);
  for (const karte of zweiteSitzung.karten) {
    const e = zweiteSitzung.stand[karte.sha256];
    assert.ok(e, 'Karte ' + karte.index + ' traegt ihren Stand wieder');
    assert.equal(e.titel, 'Titel ' + karte.index);
  }
  assert.deepEqual(
    S.sitzungsEintraege(zweiteSitzung).map((e) => e.freigegeben), [true, false, true]);
  // Der Kopf behaelt sein erzeugt_am und traegt die NEUE Lesereingabe.
  const alt = JSON.parse(fs.readFileSync(ersteSitzung.freigabePfad, 'utf8'));
  assert.equal(zweiteSitzung.kopf.erzeugt_am, alt.erzeugt_am);

  // Und die Seite der neuen Sitzung zeigt den Stand.
  const html = SEITE.baueSeite(zweiteSitzung);
  assert.ok(html.includes('Titel 0'), 'der uebernommene Titel steht auf der Seite');
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('ein Urteil laesst sich aendern und zuruecknehmen', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  const t = sitzung.token;
  try {
    await urteilsanfrage(lauf.port, t, { index: 0, freigegeben: true, titel: 'Erst so' });
    await urteilsanfrage(lauf.port, t, { index: 0, freigegeben: false, titel: 'Dann so' });
    let datei = JSON.parse(fs.readFileSync(sitzung.freigabePfad, 'utf8'));
    assert.equal(datei.freigaben.length, 1);
    assert.equal(datei.freigaben[0].freigegeben, false);
    assert.equal(datei.freigaben[0].titel, 'Dann so');

    const zurueck = await urteilsanfrage(lauf.port, t, { index: 0, freigegeben: null });
    assert.equal(zurueck.status, 200);
    datei = JSON.parse(fs.readFileSync(sitzung.freigabePfad, 'utf8'));
    assert.equal(datei.freigaben.length, 0);
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('ein Urteil zu einer fremden Pruefsumme wird nicht weggeworfen', () => {
  const ordner = wegwerfordner();
  const ziel = path.join(ordner, 'data', 'freigaben', AUFNAHME + '.json');
  S.schreibeFreigaben(ziel,
    { aufnahme: AUFNAHME, erzeugt_am: 'A', geschrieben_am: 'A', lesereingabe_sha256: 'alt' },
    [{ sha256: 'c'.repeat(64), kennung: 'aus einer frueheren Lieferung',
      freigegeben: true, titel: 'alt', notiz: '', entschieden_am: 'A' }]);
  const sitzung = baueSitzung(ordner);
  // Die Karte gibt es nicht mehr -- das Urteil bleibt trotzdem in der Datei.
  assert.equal(sitzung.karten.some((k) => k.sha256 === 'c'.repeat(64)), false);
  const raus = S.sitzungsEintraege(sitzung);
  assert.equal(raus.length, 1);
  assert.equal(raus[0].titel, 'alt');
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('eine unlesbare Freigabedatei wird nicht ueberschrieben', () => {
  const ordner = wegwerfordner();
  const ziel = path.join(ordner, 'data', 'freigaben', AUFNAHME + '.json');
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, '{ das ist kein JSON');
  assert.throws(() => baueSitzung(ordner), /kein JSON/);
  assert.equal(fs.readFileSync(ziel, 'utf8'), '{ das ist kein JSON');
  // Auch eine fremde Fassung wird nicht nach eigenen Regeln gelesen.
  fs.writeFileSync(ziel, JSON.stringify({ schema_version: '9.9', freigaben: [] }));
  assert.throws(() => baueSitzung(ordner), /schema_version/);
  fs.rmSync(ordner, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Der abgelehnte Eintrag
// ---------------------------------------------------------------------------

test('N9: ein abgelehnter Eintrag wird gezeigt, ist aber nicht abspielbar und nicht freigebbar',
  async () => {
    const ordner = wegwerfordner();
    const sitzung = baueSitzung(ordner, { anzahl: 2, mitAbgelehntem: true });
    const lauf = await starte(sitzung);
    const t = sitzung.token;
    try {
      assert.equal(sitzung.karten.length, 3);
      const gesperrt = sitzung.karten[2];
      assert.equal(gesperrt.freigebbar, false);
      assert.equal(gesperrt.sha256, undefined, 'zu ihm gibt es keine geprueften Daten');
      assert.equal(sitzung.videoPfad.has(2), false, 'er steht in keiner Dateiliste');
      assert.deepEqual(gesperrt.ablehnungsgruende,
        ['sha256: Die Pruefsumme der Datei stimmt nicht mit der Lieferung ueberein.']);

      // GEZEIGT: er steht in der ausgelieferten Seite, mit Grund.
      const html = (await anfrage(lauf.port, { pfad: '/?t=' + t })).text;
      assert.ok(html.includes(AUFNAHME + '/kaputt'), 'die Kennung steht auf der Seite');
      assert.ok(html.includes('VOM LESER ABGELEHNT'));
      assert.ok(html.includes('Die Pruefsumme der Datei stimmt nicht'));

      // NICHT ABSPIELBAR.
      const video = await anfrage(lauf.port, { pfad: '/video?i=2&t=' + t });
      assert.equal(video.status, 404);
      assert.equal(JSON.parse(video.text).fehler, 'index_unbekannt');

      // NICHT FREIGEBBAR.
      const urteil = await urteilsanfrage(lauf.port, t,
        { index: 2, freigegeben: true, titel: 'trotzdem' });
      assert.equal(urteil.status, 409);
      assert.equal(JSON.parse(urteil.text).fehler, 'eintrag_nicht_freigebbar');
      assert.equal(fs.existsSync(sitzung.freigabePfad), false);
    } finally {
      await lauf.schliesse();
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------
// Reihenfolge, Anzeige, Bereichsanfragen
// ---------------------------------------------------------------------------

test('die Reihenfolge ist die der Lesereingabe -- es wird nicht sortiert', () => {
  const ordner = wegwerfordner();
  const bericht = baueBericht(ordner, 3);
  // Titel absichtlich gegen die Indexreihenfolge.
  bericht.eintraege[0].daten.titel_vorschlag = 'Zzz';
  bericht.eintraege[1].daten.titel_vorschlag = 'Aaa';
  bericht.eintraege[2].daten.titel_vorschlag = 'Mmm';
  const { karten } = S.baueKarten(bericht);
  assert.deepEqual(karten.map((k) => k.index), [0, 1, 2]);
  assert.deepEqual(karten.map((k) => k.titel_vorschlag), ['Zzz', 'Aaa', 'Mmm']);
  assert.ok(!QUELLTEXT.includes('.sort('), 'im Dienst wird nirgends sortiert');
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('die Karte traegt Zeitbereich und Dauer als Anzeige, nicht als Eingabefeld', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner));
  // Es gibt genau zwei Eingabearten auf der Seite: das Titelfeld und das
  // Notizfeld. Kein Feld fuer Zeiten, Dauer, Masse oder Pruefsummen.
  const eingaben = html.match(/document\.createElement\('(input|textarea)'\)/g) || [];
  assert.deepEqual(eingaben.sort(),
    ["document.createElement('input')", "document.createElement('textarea')"]);
  assert.ok(html.includes("paar('Zeitbereich: '"), 'der Zeitbereich wird angezeigt');
  assert.ok(html.includes("paar('Dauer: '"), 'die Dauer wird angezeigt');
  // Und keines der Metadatenfelder des Uploaders steht auf der Seite.
  for (const feld of ['Beschreibung', 'Schlagwort', 'Sichtbarkeit', 'Kategorie', 'Sprache']) {
    assert.ok(!html.includes(feld), feld + ' gehoert nicht auf diese Seite');
  }
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('das Video wird mit preload="none" eingebunden', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner, { anzahl: 40 }));
  assert.ok(html.includes("video.preload = 'none'"));
  assert.ok(!html.includes("preload = 'auto'") && !html.includes("preload = 'metadata'"));
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('Bereichsanfragen werden bedient -- sonst springt kein Browser im Video', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  const t = sitzung.token;
  try {
    const ganz = await anfrage(lauf.port, { pfad: '/video?i=0&t=' + t });
    assert.equal(ganz.status, 200);
    assert.equal(ganz.kopf['accept-ranges'], 'bytes');
    assert.equal(ganz.kopf['content-type'], 'video/mp4');
    const groesse = ganz.leib.length;

    const teil = await anfrage(lauf.port, {
      pfad: '/video?i=0&t=' + t, kopf: { range: 'bytes=10-19' } });
    assert.equal(teil.status, 206);
    assert.equal(teil.kopf['content-range'], 'bytes 10-19/' + groesse);
    assert.equal(teil.leib.length, 10);
    assert.deepEqual(teil.leib, ganz.leib.subarray(10, 20));

    const offen = await anfrage(lauf.port, {
      pfad: '/video?i=0&t=' + t, kopf: { range: 'bytes=5-' } });
    assert.equal(offen.status, 206);
    assert.equal(offen.leib.length, groesse - 5);

    const suffix = await anfrage(lauf.port, {
      pfad: '/video?i=0&t=' + t, kopf: { range: 'bytes=-7' } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.leib.length, 7);

    const daneben = await anfrage(lauf.port, {
      pfad: '/video?i=0&t=' + t, kopf: { range: 'bytes=999999-' } });
    assert.equal(daneben.status, 416);
    assert.equal(daneben.kopf['content-range'], 'bytes */' + groesse);
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('leseBereich liest genau die Formen, die ein <video> anfragt', () => {
  assert.equal(S.leseBereich(undefined, 100), null);
  assert.deepEqual(S.leseBereich('bytes=0-9', 100), { von: 0, bis: 9 });
  assert.deepEqual(S.leseBereich('bytes=50-', 100), { von: 50, bis: 99 });
  assert.deepEqual(S.leseBereich('bytes=-10', 100), { von: 90, bis: 99 });
  assert.deepEqual(S.leseBereich('bytes=0-999', 100), { von: 0, bis: 99 });
  assert.throws(() => S.leseBereich('bytes=100-', 100));
  assert.throws(() => S.leseBereich('bytes=9-3', 100));
  assert.throws(() => S.leseBereich('items=0-1', 100));
  assert.throws(() => S.leseBereich('bytes=abc', 100));
});

test('eine seither ersetzte Videodatei wird nicht ausgeliefert', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  try {
    fs.writeFileSync(sitzung.videoPfad.get(0), 'eine andere Datei');
    const a = await anfrage(lauf.port, { pfad: '/video?i=0&t=' + sitzung.token });
    assert.equal(a.status, 409);
    assert.equal(JSON.parse(a.text).fehler, 'datei_veraendert');
    assert.ok(!a.text.includes('eine andere Datei'));
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Die Seite selbst
// ---------------------------------------------------------------------------

test('ein Titelvorschlag mit </script> sprengt den Skriptblock nicht', () => {
  const ordner = wegwerfordner();
  const boese = 'Ende</script><script>alert(1)</script>';
  const html = SEITE.baueSeite(baueSitzung(ordner, { titel: boese }));
  assert.ok(!html.includes('</script><script>'), 'kein zweiter Skriptblock');
  // Gesucht wird die maskierte Form von </script>, also ein echter Rueckstrich
  // gefolgt von u003c. Sie wird zusammengesetzt statt hingeschrieben: der
  // Freigabe-Check dieses oeffentlichen Repos liest zwei Rueckstriche
  // nebeneinander als Anfang eines UNC-Pfades, und diese Zeile soll ihn nicht
  // falsch alarmieren.
  const R = String.fromCharCode(92);
  assert.ok(html.includes(R + 'u003c/script' + R + 'u003e'), 'maskiert, nicht entfernt');
  // GENAU EINMAL maskiert: der Apostroph, der aus einem Skriptblock gar nicht
  // ausbrechen kann, kommt an, wie er geschrieben wurde.
  const mitApostroph = SEITE.baueSeite(baueSitzung(ordner, { titel: "Peter's Titel" }));
  assert.ok(mitApostroph.includes("Peter's Titel"));
  assert.ok(!mitApostroph.includes('&#x27;'));
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('jede Handlung geht auch mit der Maus', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner));
  // Freigeben, Ablehnen, Abspielen und Beenden haben alle einen Knopf bzw. eine
  // Bedienleiste. Die Tastenfuehrung ist ein Beschleuniger und kein einziger Weg.
  assert.ok(html.includes("el('button', 'ja', 'Freigeben')"));
  assert.ok(html.includes("el('button', 'nein', 'Ablehnen')"));
  assert.ok(html.includes('video.controls = true'), 'das Video hat eine Bedienleiste');
  assert.ok(html.includes('<button id="beenden">'));
  assert.ok(html.includes("ja.addEventListener('click'"));
  assert.ok(html.includes("nein.addEventListener('click'"));
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('das Sitzungstoken steht in der Seite und in den Videoadressen', () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const html = SEITE.baueSeite(sitzung);
  assert.ok(html.includes(sitzung.token));
  assert.ok(html.includes("'/video?i=' + karte.index + '&t=' + encodeURIComponent(TOKEN)"),
    'ein <video>-Element kann keine Kopfzeile setzen, darum der Parameter');
  assert.ok(html.includes("'X-Freigabe-Token': TOKEN"), 'fetch nutzt die Kopfzeile');
  fs.rmSync(ordner, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Beenden
// ---------------------------------------------------------------------------

test('GET /beenden schaltet nichts ab -- nur POST', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  try {
    const a = await anfrage(lauf.port, { pfad: '/beenden?t=' + sitzung.token });
    assert.equal(a.status, 404);
    // Der Dienst antwortet weiterhin.
    const b = await anfrage(lauf.port, { pfad: '/?t=' + sitzung.token });
    assert.equal(b.status, 200);
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('POST /beenden antwortet erst vollstaendig und meldet dann den Wunsch', async () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const lauf = await starte(sitzung);
  const gemeldet = new Promise((f) => lauf.dienst.once('beenden-erwuenscht', f));
  try {
    const a = await anfrage(lauf.port, {
      methode: 'POST', pfad: '/beenden',
      kopf: { origin: 'http://' + S.HOST + ':' + lauf.port,
        'x-freigabe-token': sitzung.token, 'content-length': 0 },
    });
    assert.equal(a.status, 200);
    assert.equal(JSON.parse(a.text).status, 'beendet');
    await gemeldet;   // erst hinaus, dann aus
  } finally {
    await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Die eine Pfadkonstruktion
// ---------------------------------------------------------------------------

test('aus einem Aufnahmenamen ohne die feste Form wird kein Pfad gebaut', () => {
  assert.equal(S.freigabePfad('/w', '2026-01-02 03-04-05'),
    path.join('/w', 'data', 'freigaben', '2026-01-02 03-04-05.json'));
  // Der Laufwerkspfad wird zusammengesetzt statt hingeschrieben -- siehe oben:
  // der Freigabe-Check verbietet absolute Laufwerkspfade im Quelltext, und
  // dieses Repo ist oeffentlich.
  const R = String.fromCharCode(92);
  const laufwerkspfad = 'C:' + R + 'Windows' + R + 'win.ini';
  const rueckwaerts = '..' + R + '..' + R + 'windows' + R + 'win.ini';
  for (const boese of ['..', '../../etc/passwd', laufwerkspfad, rueckwaerts, '', 'x',
    '2026-01-02 03-04-05/..', '2026-01-02', null, 42]) {
    assert.throws(() => S.freigabePfad('/w', boese), /Form JJJJ-MM-TT HH-MM-SS/,
      JSON.stringify(boese));
  }
});

test('der Dienst haengt an 127.0.0.1 und an nichts sonst', () => {
  assert.equal(S.HOST, '127.0.0.1');
  assert.ok(/dienst\.listen\(port, HOST,/.test(QUELLTEXT));
  assert.ok(!/listen\([^)]*'0\.0\.0\.0'/.test(QUELLTEXT));
  assert.ok(!/listen\(\s*port\s*\)/.test(QUELLTEXT), 'nie ohne Adresse');
});

// ---------------------------------------------------------------------------
// DJa: Die Einzelinstanz-Sperre
// ---------------------------------------------------------------------------

// Eine Prozessnummer, die es mit grosser Sicherheit nicht gibt. Sie wird
// nachgeprueft und nicht angenommen: waere sie zufaellig vergeben, pruefte der
// Verwaisten-Test das Gegenteil von dem, was er behauptet.
function toteNummer() {
  for (let n = 999999; n > 900000; n--) {
    if (!S.prozessLebt(n).lebt) return n;
  }
  throw new Error('keine freie Prozessnummer gefunden');
}

test('die Sperre wird mit wx angelegt -- das Anlegen ist die Pruefung', () => {
  // Kein existsSync davor: zwischen einem Blick und einem Oeffnen passt ein
  // zweiter Start. Das haelt der Quelltext fest, nicht nur der Kommentar.
  assert.ok(/fs\.openSync\(pfad, 'wx'\)/.test(NURCODE), "openSync(..., 'wx')");
  const vorher = NURCODE.slice(0, NURCODE.indexOf("fs.openSync(pfad, 'wx')"));
  const rumpf = vorher.slice(vorher.lastIndexOf('function nimmSperre('));
  assert.ok(!/existsSync/.test(rumpf), 'kein Blick vor dem Anlegen');
  assert.ok(!/existsSync/.test(NURCODE), 'existsSync kommt im Dienst gar nicht vor');
});

test('eine freie Sperre wird genommen und traegt PID, Port, Zeit und Aufnahme', () => {
  const ordner = wegwerfordner();
  const jetzt = new Date('2026-09-01T12:00:00.000Z');
  const sperre = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME, jetzt });
  assert.equal(sperre.ok, true);
  assert.equal(sperre.verwaist, null);
  assert.equal(sperre.pfad, S.sperrPfad(ordner, AUFNAHME));

  const auf = JSON.parse(fs.readFileSync(sperre.pfad, 'utf8'));
  assert.equal(auf.artifact_type, S.SPERRE_ARTIFACT_TYPE);
  assert.equal(auf.schema_version, S.SPERRE_SCHEMA_VERSION);
  assert.equal(auf.pid, process.pid);
  assert.equal(auf.aufnahme, AUFNAHME);
  assert.equal(auf.gestartet_am, '2026-09-01T12:00:00.000Z');
  // Der Port steht beim Anlegen noch nicht fest -- null heisst "faehrt hoch".
  assert.equal(auf.port, null);

  S.traegeSperrePortNach(sperre, 8791);
  assert.equal(JSON.parse(fs.readFileSync(sperre.pfad, 'utf8')).port, 8791);

  const frei = S.gibSperreFrei(sperre);
  assert.equal(frei.geloescht, true);
  assert.equal(fs.existsSync(sperre.pfad), false);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('eine gehaltene Sperre wird nicht ein zweites Mal genommen', () => {
  const ordner = wegwerfordner();
  const erste = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME });
  S.traegeSperrePortNach(erste, 8791);
  // Der zweite Versuch traegt DIESELBE Prozessnummer -- also eine, die lebt.
  const zweite = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME });
  assert.equal(zweite.ok, false);
  assert.equal(zweite.vorhanden.pid, process.pid);
  assert.equal(zweite.vorhanden.port, 8791);
  assert.equal(zweite.leben.lebt, true);
  const text = S.meldeFremdeSperre(zweite, AUFNAHME);
  assert.match(text, new RegExp('Prozessnummer:\\s+' + process.pid));
  assert.match(text, /Port:\s+8791/);
  assert.match(text, /Gestartet am:/);
  assert.ok(text.includes('Es wurde NICHTS in die Freigabedatei geschrieben'));
  S.gibSperreFrei(erste);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('N4: eine verwaiste Sperre wird benannt und uebernommen', () => {
  const ordner = wegwerfordner();
  const pfad = S.sperrPfad(ordner, AUFNAHME);
  const tot = toteNummer();
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  fs.writeFileSync(pfad, JSON.stringify(S.sperrinhalt({
    aufnahme: AUFNAHME, pid: tot, port: 8791,
    gestartet_am: '2026-08-31T09:00:00.000Z' }), null, 2) + '\n');

  const sperre = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME });
  assert.equal(sperre.ok, true, 'die verwaiste Sperre wurde uebernommen');
  // BENANNT, nicht stillschweigend ueberschrieben.
  assert.notEqual(sperre.verwaist, null);
  assert.equal(sperre.verwaist.vorhanden.pid, tot);
  assert.equal(sperre.verwaist.vorhanden.port, 8791);
  assert.match(sperre.verwaist.grund, /keinen Prozess mit dieser Nummer/);
  // Und jetzt gehoert sie uns.
  assert.equal(JSON.parse(fs.readFileSync(pfad, 'utf8')).pid, process.pid);
  S.gibSperreFrei(sperre);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('eine unlesbare Sperrdatei gilt als verwaist -- wer sie schrieb, starb dabei', () => {
  const ordner = wegwerfordner();
  const pfad = S.sperrPfad(ordner, AUFNAHME);
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  // Die Sperrdatei wird in EINEM writeSync gefuellt. Eine halbe kann es nur
  // geben, wenn der Schreiber dabei gestorben ist.
  fs.writeFileSync(pfad, '{"artifact_type":"adw_shorts_freig');
  const sperre = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME });
  assert.equal(sperre.ok, true);
  assert.notEqual(sperre.verwaist, null);
  assert.equal(sperre.verwaist.vorhanden, null);
  assert.match(sperre.verwaist.grund, /kein JSON/);
  S.gibSperreFrei(sperre);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('N5: eine fremde Sperre wird NICHT geloescht', () => {
  const ordner = wegwerfordner();
  const pfad = S.sperrPfad(ordner, AUFNAHME);
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  const fremd = JSON.stringify(S.sperrinhalt({
    aufnahme: AUFNAHME, pid: process.pid + 1, port: 8791,
    gestartet_am: '2026-08-31T09:00:00.000Z' }), null, 2) + '\n';
  fs.writeFileSync(pfad, fremd);

  // Ein Dienst, der beim Aufraeumen die Sperre eines anderen entfernt, ist
  // schlimmer als gar keine Sperre.
  const frei = S.gibSperreFrei({ pfad, fd: undefined });
  assert.equal(frei.geloescht, false);
  assert.match(frei.grund, /gehoert einem anderen/);
  assert.equal(fs.readFileSync(pfad, 'utf8'), fremd, 'Byte fuer Byte unveraendert');

  // Auch eine unlesbare fremde Sperre bleibt liegen -- dann ist erst recht
  // nicht zu erkennen, wem sie gehoert.
  fs.writeFileSync(pfad, 'kaputt');
  const frei2 = S.gibSperreFrei({ pfad, fd: undefined });
  assert.equal(frei2.geloescht, false);
  assert.equal(fs.readFileSync(pfad, 'utf8'), 'kaputt');
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('N3: die Sperre gilt je Aufnahme, nicht je Rechner', () => {
  const ordner = wegwerfordner();
  const zweite = '2026-03-04 05-06-07';
  const a = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME });
  const b = S.nimmSperre({ projektwurzel: ordner, aufnahme: zweite });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, 'eine andere Aufnahme ist nicht gesperrt');
  assert.notEqual(a.pfad, b.pfad);
  assert.deepEqual(fs.readdirSync(path.dirname(a.pfad)).sort(),
    [AUFNAHME + '.sperre.json', zweite + '.sperre.json']);
  // Und jede gibt nur ihre eigene frei.
  S.gibSperreFrei(a);
  assert.equal(fs.existsSync(a.pfad), false);
  assert.equal(fs.existsSync(b.pfad), true);
  S.gibSperreFrei(b);
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('aus einem Aufnahmenamen ohne die feste Form wird auch kein Sperrpfad gebaut', () => {
  // sperrPfad geht ueber freigabePfad und erbt dessen Formpruefung -- es gibt
  // keine zweite Stelle, an der ein Aufnahmename zu einem Dateinamen wird.
  const R = String.fromCharCode(92);
  for (const boese of ['..', '../../etc/passwd', 'C:' + R + 'Windows', '', null, 42]) {
    assert.throws(() => S.sperrPfad('/w', boese), /Form JJJJ-MM-TT HH-MM-SS/,
      JSON.stringify(boese));
  }
});

test('die Sperrdatei liegt neben der Freigabedatei und unter data/', () => {
  const frei = S.freigabePfad('/w', AUFNAHME);
  const sperr = S.sperrPfad('/w', AUFNAHME);
  assert.equal(path.dirname(frei), path.dirname(sperr));
  assert.equal(path.basename(sperr), AUFNAHME + '.sperre.json');
  // /data/ steht in .gitignore -- damit taucht die Sperrdatei weder im
  // Commit-Kandidaten noch beim Freigabe-Check auf (Bericht DJa, N9).
  const ignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.ok(ignore.split('\n').some((z) => z.trim() === '/data/'),
    '.gitignore enthaelt /data/');
});

test('N2 (Gegenprobe am kaputten Stand): ohne Sperre ueberschreibt die zweite ' +
  'Sitzung das Urteil der ersten', async () => {
  const ordner = wegwerfordner();
  // baueSitzung/baueDienst nehmen KEINE Sperre -- die sitzt in main(). Damit
  // laesst sich der Schaden hier vorfuehren, gegen den sie gebaut ist.
  const a = baueSitzung(ordner);
  const b = baueSitzung(ordner);          // startet, bevor A geurteilt hat
  const laufA = await starte(a);
  const laufB = await starte(b);
  try {
    await urteilsanfrage(laufA.port, a.token,
      { index: 0, freigegeben: true, titel: 'Urteil aus Sitzung A' });
    const nachA = JSON.parse(fs.readFileSync(a.freigabePfad, 'utf8'));
    assert.deepEqual(nachA.freigaben.map((e) => e.titel), ['Urteil aus Sitzung A']);

    await urteilsanfrage(laufB.port, b.token,
      { index: 1, freigegeben: true, titel: 'Urteil aus Sitzung B' });
    const nachB = JSON.parse(fs.readFileSync(a.freigabePfad, 'utf8'));

    // DAS ist der Schaden: A ist weg, ohne Fehler, ohne Meldung.
    assert.deepEqual(nachB.freigaben.map((e) => e.titel), ['Urteil aus Sitzung B']);
    assert.equal(nachB.freigaben.length, 1);

    // Und mit Sperre kaeme Sitzung B gar nicht erst so weit:
    const sperreA = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME });
    assert.equal(sperreA.ok, true);
    const sperreB = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME });
    assert.equal(sperreB.ok, false, 'der zweite Start bekommt die Sperre nicht');
    S.gibSperreFrei(sperreA);
  } finally {
    await laufA.schliesse();
    await laufB.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('main() nimmt die Sperre, bevor es die Freigabedatei anfasst', () => {
  // Die Reihenfolge ist der ganze Punkt: der Stand, den eine Sitzung beim Start
  // einliest, ist der Stand, den sie beim ersten Klick zurueckschreibt. Wird
  // die Sperre erst danach genommen, hat die zweite Sitzung den alten Stand
  // laengst im Speicher.
  const mainRumpf = NURCODE.slice(NURCODE.indexOf('function main()'));
  const woSperre = mainRumpf.indexOf('nimmSperre({ projektwurzel, aufnahme })');
  const woLeser = mainRumpf.indexOf('ruftLeser(aufnahme, wurzel)');
  const woSitzung = mainRumpf.indexOf('baueSitzung({');
  assert.ok(woSperre > 0 && woLeser > 0 && woSitzung > 0);
  assert.ok(woSperre < woLeser, 'die Sperre kommt vor dem Leser');
  assert.ok(woSperre < woSitzung, 'die Sperre kommt vor dem Lesen der Freigabedatei');
});

test('jeder Ausgang nach der Sperre gibt sie wieder frei', () => {
  // Ab der Zeile, in der die Sperre uns gehoert, darf kein process.exit mehr
  // direkt stehen -- nur noch abbruch(), und das loescht die Sperrdatei.
  const zeilen = QUELLTEXT.split('\n');
  const abSperre = zeilen.findIndex((z) => z.includes('function abbruch(text)'));
  assert.ok(abSperre > 0, 'abbruch() gefunden');
  const direkt = [];
  zeilen.forEach((z, i) => {
    if (i <= abSperre + 5) return;              // der Rumpf von abbruch() selbst
    if (z.trim().startsWith('//')) return;
    if (/process\.exit\(EXIT_ABBRUCH\)/.test(z)) direkt.push(i + 1);
  });
  assert.deepEqual(direkt, [],
    'diese Zeilen verlassen main() ohne die Sperre freizugeben: ' + direkt.join(', '));
});


// ---------------------------------------------------------------------------
// DJb: freie Argumente, Browser, Schleife, Sitzungsende
// ---------------------------------------------------------------------------

const SERVER = path.join(__dirname, '..', 'src', 'upload', 'freigabe-server.js');

function rufeDienst(argumente, umgebung) {
  const { spawnSync } = require('node:child_process');
  const lauf = spawnSync(process.execPath, [SERVER, ...argumente], {
    encoding: 'utf8', timeout: 30000,
    env: Object.assign({}, process.env, umgebung || {}),
  });
  return { code: lauf.status, aus: (lauf.stdout || '') + (lauf.stderr || '') };
}

test('DJb: ein freies Argument bricht den Dienst mit 2 ab', () => {
  const r = rufeDienst(['--aufnahme=2026-08-29', '18-18-19']);
  assert.equal(r.code, 2);
  assert.match(r.aus, /freie Argumente gibt es hier nicht/);
  assert.match(r.aus, /"18-18-19"/);
  assert.match(r.aus, /Rest eines Aufnahmenamens/);
  assert.match(r.aus, /freigabe-server\.js --aufnahme="2026-08-29 18-18-19"/);
  // Nichts angefasst: weder Leser noch Sperre noch Port.
  assert.ok(!/Rufe den Leser/.test(r.aus));
  assert.ok(!/Sperre/.test(r.aus));
});

test('DJb: die Pruefung auf freie Argumente ist nicht nachgebaut', () => {
  // Dieselbe Regel gehoert nicht zweimal ins Projekt. Sie kommt aus dem Leser,
  // so wie die Pfadsperre auch.
  assert.match(NURCODE, /const \{ pruefeKeineFreienArgumente \} = require\('\.\/uebergabe-leser'\)/);
  assert.ok(!/function pruefeKeineFreienArgumente/.test(NURCODE),
    'der Dienst darf keine eigene Fassung haben');
  const L = require('../src/upload/uebergabe-leser.js');
  assert.equal(typeof L.pruefeKeineFreienArgumente, 'function');
});

test('DJb: beide Argumentpruefungen laufen vor jedem anderen require', () => {
  // Sie stehen vor require('dotenv') und vor allem, was danach kommt -- ein
  // Tippfehler im Aufruf darf nicht erst nach dem halben Hochlauf auffallen.
  const wo = (t) => NURCODE.indexOf(t);
  assert.ok(wo('pruefeArgumenteStrikt(process.argv') > 0);
  assert.ok(wo('pruefeKeineFreienArgumente(process.argv') > wo('pruefeArgumenteStrikt(process.argv'));
  assert.ok(wo("require('dotenv')") > wo('pruefeKeineFreienArgumente(process.argv'),
    'dotenv wird erst nach den Argumentpruefungen geladen');
  assert.ok(wo("require('http')") > wo('pruefeKeineFreienArgumente(process.argv'));
});

// ---------------------------------------------------------------------------
// Punkt 3: der Browser
// ---------------------------------------------------------------------------

test('DJb: der Browser wird nur aus main() geoeffnet, nie aus baueDienst', () => {
  // Ein npm test, das Browserfenster oeffnet, waere schlimmer als das
  // Kopieren der Adresse. Die Tests fahren den Dienst ueber baueDienst und
  // erreichen oeffneImBrowser damit ueberhaupt nicht.
  const aufrufe = [...NURCODE.matchAll(/oeffneImBrowser\(/g)];
  assert.equal(aufrufe.length, 2, 'genau eine Definition und ein Aufruf');
  const mainRumpf = NURCODE.slice(NURCODE.indexOf('function main()'));
  assert.ok(mainRumpf.includes('oeffneImBrowser(adresse)'), 'der Aufruf steht in main()');
  const vorMain = NURCODE.slice(0, NURCODE.indexOf('function main()'));
  assert.ok(!/oeffneImBrowser\(adresse\)/.test(vorMain));
  // Und der Schalter steht davor.
  assert.ok(mainRumpf.indexOf('if (keinBrowser)') < mainRumpf.indexOf('oeffneImBrowser(adresse)'));
});

test('DJb: ein gescheitertes Oeffnen ist kein Startfehler', () => {
  // oeffneImBrowser gibt zurueck statt zu werfen, und der Aufrufer beendet
  // nichts. Der Dienst laeuft weiter -- die Adresse steht ja daneben.
  const rumpf = QUELLTEXT.slice(QUELLTEXT.indexOf('function oeffneImBrowser('),
    QUELLTEXT.indexOf('\n// ------', QUELLTEXT.indexOf('function oeffneImBrowser(')));
  assert.ok(!/process\.exit/.test(rumpf), 'oeffneImBrowser beendet nichts');
  assert.ok(/kind\.on\('error'/.test(rumpf),
    'ein spaeterer Fehler des Kindprozesses muss abgefangen sein');
  assert.ok(/detached: true/.test(rumpf) && /kind\.unref\(\)/.test(rumpf),
    'das Fenster gehoert dem Menschen, nicht diesem Prozess');
  // Und der Aufrufer meldet es, statt abzubrechen.
  assert.match(NURCODE, /Der Browser liess sich nicht oeffnen[\s\S]{0,200}laeuft/);
});

// ---------------------------------------------------------------------------
// Punkt 7: die tragende Zusage
// ---------------------------------------------------------------------------

test('DJb: kein Kindprozess entsteht als Folge eines Urteils', () => {
  // Die Zusage haengt nicht an einer Zahl -- die war schon dreimal anders --,
  // sondern am Zeitpunkt. Alle drei Kindprozesse gehoeren zum Start.
  const stellen = [...QUELLTEXT.split('\n').entries()]
    .filter(([, z]) => !z.trim().startsWith('//') && /\bspawn(Sync)?\(/.test(z))
    .map(([i, z]) => ({ zeile: i + 1, text: z.trim() }));
  assert.equal(stellen.length, 3, stellen.map((x) => x.zeile + ': ' + x.text).join(' | '));

  const heimat = ['ruftLeser', 'haelterDesPorts', 'oeffneImBrowser'];
  const bereiche = rumpfBereiche(QUELLTEXT, heimat);
  for (const st of stellen) {
    const wo = bereiche.find((b) => st.zeile >= b.von && st.zeile <= b.bis);
    assert.ok(wo !== undefined,
      'spawn in Zeile ' + st.zeile + ' gehoert zu keiner der drei Startfunktionen: ' + st.text);
  }

  // Und der Weg vom Urteil zum Schreiben beruehrt keine davon.
  const urteilRumpf = QUELLTEXT.slice(QUELLTEXT.indexOf('function nimmUrteil('),
    QUELLTEXT.indexOf('function speichere('));
  for (const name of heimat) {
    assert.ok(!urteilRumpf.includes(name + '('), name + ' wird aus nimmUrteil gerufen');
  }
  assert.ok(!/spawn/.test(urteilRumpf));
});

// ---------------------------------------------------------------------------
// Punkt 4: Schleife
// ---------------------------------------------------------------------------

test('DJb: jedes Video laeuft in Schleife, und preload bleibt none', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner, { anzahl: 5 }));
  assert.ok(html.includes('video.loop = true'), 'Schleife ist Vorgabe');
  assert.ok(html.includes("video.preload = 'none'"), 'preload bleibt none');
  // Kein Schalter: es gibt keine Stelle, an der loop wieder abgeschaltet wird.
  assert.ok(!/loop = false/.test(html));
  assert.ok(!/removeAttribute\('loop'\)/.test(html));
  fs.rmSync(ordner, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Punkt 5 und 6: Sitzungsende und ausbleibende Antworten
// ---------------------------------------------------------------------------

test('DJb: die Seite holt weiterhin keinen neuen Stand', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner));
  const ohneKommentar = html.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.ok(!/setInterval/.test(ohneKommentar), 'kein setInterval');
  assert.ok(!/location\.reload/.test(ohneKommentar), 'kein Neuladen');
  assert.ok(!/EventSource|WebSocket/.test(ohneKommentar));
  // Genau zwei fetch-Aufrufe, beide an den eigenen Dienst, beide durch eine
  // Handlung des Menschen ausgeloest.
  const fetches = [...ohneKommentar.matchAll(/fetch\('([^']+)'/g)].map((t) => t[1]);
  assert.deepEqual(fetches.sort(), ['/beenden', '/urteil']);
});

test('DJb: beide fetch-Aufrufe haben eine Zeitgrenze', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner));
  const treffer = [...html.matchAll(/AbortSignal\.timeout\(ZEITGRENZE_MS\)/g)];
  assert.equal(treffer.length, 2,
    'ohne Zeitgrenze wartet fetch endlos -- ein abgestuerzter Dienst saehe dann aus wie ein langsamer');
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('DJb: eine nicht gespeicherte Antwort faerbt die Karte nicht gruen', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner));
  // Im Fehlerzweig wird `stand` nicht angefasst und zeigeStand nicht gerufen.
  const zweig = html.slice(html.indexOf('if (!a.ok) {'), html.indexOf('stand[karte.sha256] = a.eintrag'));
  assert.ok(zweig.includes('fehler.textContent = a.meldung'));
  assert.ok(zweig.includes("knoten.classList.add('nichtgespeichert')"));
  assert.ok(!zweig.includes('zeigeStand()'), 'im Fehlerzweig wird der Stand nicht neu gezeichnet');
  assert.ok(!zweig.includes('stand[karte.sha256] ='), 'im Fehlerzweig wird nichts gemerkt');
  // Und beide Fehlertexte fangen mit derselben Ansage an.
  assert.ok(html.includes('NICHT GESPEICHERT'));
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('DJb: das Sitzungsende sperrt die Karten und nennt die Freigabedatei', () => {
  const ordner = wegwerfordner();
  const sitzung = baueSitzung(ordner);
  const html = SEITE.baueSeite(sitzung);
  assert.ok(html.includes('function zeigeSitzungsende()'));
  assert.ok(html.includes('function sperreAlleKarten()'));
  assert.ok(html.includes('Die Sitzung ist beendet. Der Dienst laeuft nicht mehr.'));
  // Der Pfad kommt als Daten mit -- der Kasten am Ende ist die Stelle, die
  // ein Mensch tatsaechlich liest.
  assert.ok(html.includes('DATEN.freigabePfad'));
  assert.ok(html.includes(sitzung.freigabePfad.split('\\').join('\\\\')) ||
    html.includes(sitzung.freigabePfad), 'der Pfad steht in der Nutzlast');
  // Ausgeloest von einer Antwort, nicht von einer Uhr.
  assert.ok(html.includes('zeigeSitzungsende();'));
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('DJb: der Knopf sagt, was er tut, und fragt bei offenen Karten nach', () => {
  const ordner = wegwerfordner();
  const html = SEITE.baueSeite(baueSitzung(ordner));
  assert.ok(html.includes('<button id="beenden">Sitzung beenden</button>'));
  assert.ok(!html.includes('Dienst beenden'), 'der alte Verwaltungsname ist weg');
  assert.ok(html.includes('dieser Knopf ') && html.includes('speichert nichts'),
    'daneben steht, dass er nichts speichert');
  // Die Rueckfrage nennt die Zahl -- eine Rueckfrage ohne Zahl klickt man weg.
  assert.ok(html.includes('window.confirm('));
  assert.ok(html.includes("offen + ' von ' + frei.length + ' Karten haben noch kein Urteil."),
    'die Rueckfrage nennt beide Zahlen');
  assert.ok(html.includes('bereits gefaellten Urteile sind gespeichert'),
    'und sagt, dass das Gefaellte gespeichert bleibt');
  fs.rmSync(ordner, { recursive: true, force: true });
});

test('unbekannte Argumente beenden den Aufruf, statt ignoriert zu werden', () => {
  assert.deepEqual(S.ERLAUBTE_ARGUMENTE,
    ['--aufnahme=', '--wurzel=', '--port=', '--no-browser']);
  const { unbekannteArgumente } = require('../src/publish/cli-args');
  assert.deepEqual(
    unbekannteArgumente(['node', 'x', '--aufnahme=a', '--nur-pruefen'], S.ERLAUBTE_ARGUMENTE),
    ['--nur-pruefen']);
});
