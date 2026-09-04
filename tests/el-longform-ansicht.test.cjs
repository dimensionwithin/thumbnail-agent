'use strict';

// EL: Die Longform-Ansicht der Freigabeseite.
//
// Der Dienst hat seit EI zwei Betriebsmodi. Bis EL endete der zweite nach der
// Sperre mit 1 und dem Satz, dass hier nichts gebaut sei; ab EL liefert er
// eine Seite aus, die zeigt, was der Trockenlauf des Longform-Arbeiters
// ergeben hat, und die dort aufhoert.
//
// WAS DIESE DATEI FESTHAELT, in der Reihenfolge des Auftrags:
//
//   1  Die Shorts-Ansicht ist unveraendert -- Byte fuer Byte gegen den Stand
//      vor diesem Bau. Ueber diesen Weg sind 21 Shorts hochgeladen worden.
//   2  Es gibt keinen zweiten Darstellungsweg. Die Seite uebernimmt die Saetze
//      des Arbeiters, statt sie nachzubauen.
//   3  Nichts an der Ansicht kann schreiben -- gemessen mit scharfen
//      Dateisystemfunktionen, nicht behauptet.
//   4  Die Absicherungen sind GEERBT, nicht nachgebaut: eine Bindung, ein
//      Token, eine Herkunftspruefung fuer beide Modi.
//
// WARUM DER TROCKENLAUF HIER ERFUNDEN IST: der Arbeiter hat eigene Tests
// (tests/longform-arbeiter.test.cjs), die ihn gegen den Vertrag halten. Ihn
// hier ein zweites Mal zu pruefen hiesse, dieselbe Zusage an zwei Orten zu
// fuehren. Was hier geprueft wird, ist der Umgang MIT seiner Ausgabe -- und
// dafuer ist ein erfundener Text sogar besser: er kann Zeichen tragen, die die
// echte Ausgabe heute nicht hat.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const S = require('../src/upload/freigabe-server.js');
const SEITE = require('../src/upload/freigabe-seite.js');

const WURZEL = path.join(__dirname, '..');
const SEITENDATEI = path.join(WURZEL, 'src', 'upload', 'freigabe-seite.js');
const SERVERDATEI = path.join(WURZEL, 'src', 'upload', 'freigabe-server.js');
const SEITENTEXT = fs.readFileSync(SEITENDATEI, 'utf8');
const SERVERTEXT = fs.readFileSync(SERVERDATEI, 'utf8');
const SERVER_NURCODE = SERVERTEXT.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');

// Der Teil dieser Datei, der die Longform-Ansicht ist. Alles davor ist die
// Shorts-Ansicht und wird von Nachweis 1 gedeckt.
const LONGFORM_TEIL = SEITENTEXT.slice(SEITENTEXT.indexOf('// EL: DIE LONGFORM-ANSICHT'));

const AUFNAHME = '2026-01-02 03-04-05';

// ---------------------------------------------------------------------------
// Werkzeug
// ---------------------------------------------------------------------------

function wegwerfordner() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'el-longform-'));
}

// Ein erfundener Trockenlauf. Der Text traegt ABSICHTLICH Zeichen, an denen
// sich ein Skriptblock sprengen liesse, und Zeilen, die aussehen wie
// Ueberschriften -- damit auffiele, wenn diese Seite anfinge, an ihnen
// entlangzuschneiden.
function erfundenerTrockenlauf(besonders) {
  const zeilen = [
    '='.repeat(78),
    'MARKE-KOPF -- Aufnahme ' + AUFNAHME,
    '='.repeat(78),
    'MARKE-ERSTER-SATZ.',
    '',
    'MARKE-ABSCHNITT-EINS',
    '  MARKE-WERT-A: 4711',
    '  MARKE-WERT-B: </script><script>MARKE-BOESE()</script>',
    '  MARKE-WERT-C: ein & zwei < drei > vier',
    '',
    '='.repeat(78),
    'MARKE-ABSCHNITT-ZWEI',
    '  MARKE-ACHTUNG: hier stimmt etwas nicht.',
  ];
  // LANG GENUG, UM EINE KUERZUNG AUFFALLEN ZU LASSEN. Beim Mutationslauf zu
  // EL war dieser Text vierzehn Zeilen lang, und eine eingebaute Kuerzung
  // "nach zwanzig Zeilen" ging deshalb durch den Test hindurch -- sie hatte
  // an vierzehn Zeilen nichts zu kuerzen. Der echte Trockenlauf hat rund
  // hundert; ein Pruefstueck, das kuerzer ist als der Ernstfall, prueft die
  // Faelle des Ernstfalls nicht. Die Zeilen unten sind numeriert, damit eine
  // Luecke in der Mitte genauso auffaellt wie eine am Ende.
  for (let i = 1; i <= 24; i++) {
    zeilen.push('  MARKE-ZEILE-' + String(i).padStart(3, '0') + ': Inhalt ' + (i * 7));
  }
  zeilen.push('='.repeat(78));
  zeilen.push('MARKE-LETZTE-ZEILE -- wer bis hier kuerzt, kuerzt den Befund weg.');
  zeilen.push('='.repeat(78));
  return Object.assign({
    befehl: 'node src/upload/longform-arbeiter.js --aufnahme="' + AUFNAHME + '"',
    code: 1,
    fehler: null,
    aus: '',
    err: zeilen.join('\n'),
  }, besonders || {});
}

function longformSitzung(besonders) {
  const ordner = wegwerfordner();
  const sitzung = S.baueLongformSitzung({
    aufnahme: AUFNAHME, projektwurzel: ordner, port: 0,
    trocken: erfundenerTrockenlauf(besonders),
  });
  sitzung.wegwerfordner = ordner;
  return sitzung;
}

// Holt den DATEN-Block aus der ausgelieferten Seite zurueck -- genau die eine
// Zeile, die auch der Browser liest, und mit derselben Entmaskierung, die sein
// HTML-Parser vornimmt.
function datenAusSeite(html) {
  const m = html.match(/\nconst DATEN = (\{.*\});\n/);
  assert.ok(m, 'die Seite traegt genau einen DATEN-Block');
  let roh = m[1];
  for (const [zeichen, maske] of Object.entries(SEITE.SKRIPTBLOCK_MASKEN)) {
    roh = roh.split(maske).join(zeichen);
  }
  return JSON.parse(roh);
}

// FUEHRT DAS SKRIPT DER SEITE AUS -- ohne Browser, aber wirklich.
//
// WARUM DAS NOETIG IST, und es ist beim Mutationslauf zu EL aufgefallen: ein
// Test, der nur die Nutzlast im Skriptblock prueft, prueft, was ANKOMMT --
// nicht, was ein Mensch SIEHT. Eine Ansicht, die den Text vollstaendig
// mitliefert und ihn dann im Browser nach zwanzig Zeilen abschneidet, kaeme
// durch so einen Test hindurch. Genau das ist die Fehlerform, gegen die
// dieser Auftrag gebaut ist: ein Zustand, der gut aussieht, obwohl er es
// nicht ist.
//
// Der Ersatz kann genau so viel, wie das Skript dieser Seite braucht:
// getElementById, querySelector, textContent, hidden. Mehr waere ein
// Browser-Nachbau; weniger liefe nicht.
function fuehreSkriptAus(html) {
  const daten = datenAusSeite(html);
  const auf = html.indexOf('<script>') + '<script>'.length;
  const zu = html.indexOf('<' + '/script>', auf);
  assert.ok(zu > auf, 'der Skriptblock der Seite wurde gefunden');
  // Die DATEN-Zeile wird herausgenommen und der Wert stattdessen als
  // Argument hineingegeben -- entmaskiert, so wie ihn der Browser nach dem
  // Auspacken saehe.
  const skript = html.slice(auf, zu).replace(/^const DATEN = .*;$/m, '');
  const baum = new Map();
  // hidden faengt bei true an, wo es im HTML steht -- sonst waere "das Skript
  // deckt den Kasten auf" nicht von "er war nie zu" zu unterscheiden.
  const zuAnfangVersteckt = new Set(
    [...html.matchAll(/id="([a-zA-Z]+)"[^>]*hidden/g)].map((m) => m[1]));
  const nimm = (schluessel, id) => {
    if (!baum.has(schluessel)) {
      baum.set(schluessel, { id, textContent: '', hidden: zuAnfangVersteckt.has(id) });
    }
    return baum.get(schluessel);
  };
  // JEDE id der Seite wird vorab angelegt, auch die, die das Skript nie
  // anfasst. Sonst waere "das Skript hat den Kasten nicht aufgedeckt" von
  // "den Kasten gibt es gar nicht" nicht zu unterscheiden -- und der Test
  // fuer den leeren Strom liefe ins Leere statt zu pruefen.
  for (const m of html.matchAll(/id="([a-zA-Z]+)"/g)) nimm(m[1], m[1]);
  const dokument = {
    getElementById: (id) => nimm(id, id),
    querySelector: (w) => nimm(w, (/#([a-zA-Z]+)/.exec(w) || [])[1] || w),
  };
  // eslint-disable-next-line no-new-func
  new Function('DATEN', 'document', skript)(daten, dokument);
  return baum;
}

// Dieselbe Anfragefunktion wie in tests/freigabe-server.test.cjs -- jede
// Kopfzeile einzeln setzbar, sonst liesse sich "fremder Host" nicht pruefen.
function anfrage(port, { methode = 'GET', pfad = '/', kopf = {}, leib = null } = {}) {
  return new Promise((fertig, schiefgegangen) => {
    const zusammen = Object.assign({ host: S.HOST + ':' + port }, kopf);
    for (const k of Object.keys(zusammen)) if (zusammen[k] === undefined) delete zusammen[k];
    const req = http.request({
      host: S.HOST, port, method: methode, path: pfad, headers: zusammen,
    }, (res) => {
      const teile = [];
      res.on('data', (d) => teile.push(d));
      res.on('end', () => fertig({
        status: res.statusCode, kopf: res.headers,
        text: Buffer.concat(teile).toString('utf8'),
      }));
    });
    req.on('error', schiefgegangen);
    if (leib !== null) req.write(leib);
    req.end();
  });
}

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

// ===========================================================================
// NACHWEIS 1: DIE SHORTS-ANSICHT IST UNVERAENDERT
// ===========================================================================
//
// Nicht "sieht gleich aus", sondern Byte fuer Byte dieselbe. Ueber diesen Weg
// sind 21 Shorts hochgeladen worden; ein einziges abweichendes Zeichen ist ein
// Fund und keine Nebensache.
//
// Der Vergleich holt die alte Fassung aus git. Ist git nicht da oder der
// Commit nicht im Klon (ein flacher Klon etwa), wird der Test LAUT
// uebersprungen und nicht still bestanden.

const STAND_VOR_EL = 'd09095f';

function alteFassungAusGit(datei) {
  const g = spawnSync('git', ['show', STAND_VOR_EL + ':' + datei],
    { cwd: WURZEL, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (g.error || g.status !== 0) return null;
  return g.stdout;
}

// Eine Shorts-Sitzung mit FESTEN Werten. Sie geht beiden Fassungen als
// dasselbe Objekt hinein -- Token und Zeitstempel sind damit nicht zufaellig
// verschieden, sondern gar nicht erst zweimal gebildet.
function shortsSitzungFuerVergleich(ordner) {
  const eintraege = [];
  for (let i = 0; i < 3; i++) {
    const datei = path.join(ordner, 'short-' + i + '.mp4');
    const inhalt = Buffer.from('VIDEO-' + i + '-' + 'x'.repeat(200 + i), 'utf8');
    fs.writeFileSync(datei, inhalt);
    eintraege.push({
      index: i, kennung: AUFNAHME + '/' + i, bezeichner: AUFNAHME + '/' + i,
      unbekannteFelder: [], maengel: [], hinweise: [], angenommen: true,
      daten: {
        kennung: AUFNAHME + '/' + i, pfad: datei,
        sha256: require('node:crypto').createHash('sha256').update(inhalt).digest('hex'),
        groesse_bytes: inhalt.length, dauer_ms: 12000 + i, breite: 1080, hoehe: 1920,
        titel_vorschlag: 'Titel </script> & <b>' + i, transkript: 'transkript ' + i,
        quelle_von_ms: 100000 + i * 1000, quelle_bis_ms: 112000 + i * 1000, urteil: 'ja',
      },
    });
  }
  const bericht = {
    quelle: '<erfunden>', aufnahme: AUFNAHME, wurzel: ordner, plattenpruefung: true,
    kopfMaengel: [], eintraege, eintraegeGeprueft: true, verlauf: [],
    angenommen: 3, abgelehnt: 0, maengelGesamt: 0, hinweiseGesamt: 0,
    angenommenMitHinweis: 0, status: 'angenommen',
  };
  return S.baueSitzung({
    bericht, eingabeText: JSON.stringify(bericht), aufnahme: AUFNAHME,
    projektwurzel: ordner, port: 8791,
  });
}

test('EL-N1: die Shorts-Seite ist Byte fuer Byte die von ' + STAND_VOR_EL, () => {
  const alt = alteFassungAusGit('src/upload/freigabe-seite.js');
  if (alt === null) {
    // LAUT uebersprungen. Ein stiller Uebersprung waere hier das Schlimmste:
    // der Test, der die 21 Uploads deckt, saehe gruen aus und haette nichts
    // geprueft.
    assert.fail('Der Stand ' + STAND_VOR_EL + ' ist aus git nicht zu holen. Dieser Test ' +
      'kann so nicht laufen, und er wird nicht als bestanden gezaehlt.');
  }
  const ordner = wegwerfordner();
  try {
    const altDatei = path.join(ordner, 'freigabe-seite-alt.cjs');
    fs.writeFileSync(altDatei, alt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const ALT = require(altDatei);

    const sitzung = shortsSitzungFuerVergleich(ordner);
    const vorher = Buffer.from(ALT.baueSeite(sitzung), 'utf8');
    const nachher = Buffer.from(SEITE.baueSeite(sitzung), 'utf8');

    assert.equal(nachher.length, vorher.length,
      'die Seite ist ' + nachher.length + ' Bytes gross, vor EL waren es ' + vorher.length);
    if (!nachher.equals(vorher)) {
      let i = 0;
      while (i < vorher.length && vorher[i] === nachher[i]) i++;
      assert.fail('Die Shorts-Seite weicht ab Byte ' + i + ' ab.\n' +
        '  vorher:  ' + JSON.stringify(vorher.toString('utf8', Math.max(0, i - 60), i + 60)) + '\n' +
        '  nachher: ' + JSON.stringify(nachher.toString('utf8', Math.max(0, i - 60), i + 60)));
    }

    // GEGENPROBE: der Vergleich muss zuschnappen. Ein Test, der nur gleiche
    // Dinge gleich nennt, hat nichts gezeigt.
    const verletzt = alt.replace('Shorts-Freigabe</title>', 'Shorts-Freigabe.</title>');
    assert.notEqual(verletzt, alt, 'die Gegenprobe hat wirklich etwas geaendert');
    const verletztDatei = path.join(ordner, 'freigabe-seite-verletzt.cjs');
    fs.writeFileSync(verletztDatei, verletzt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const KAPUTT = require(verletztDatei);
    const anders = Buffer.from(KAPUTT.baueSeite(sitzung), 'utf8');
    assert.ok(!anders.equals(nachher),
      'ein geaendertes Zeichen kam durch den Vergleich -- dann prueft er nichts');
    assert.equal(anders.length, nachher.length + 1);
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('EL-N1: auch der Weg zur Shorts-Seite ist derselbe -- Routen und Antworten', async () => {
  // Die Seite allein genuegt nicht: sie koennte gleich sein und der Dienst
  // sie anders ausliefern. Geprueft wird darum, was ueber die Leitung kommt.
  const ordner = wegwerfordner();
  try {
    const sitzung = shortsSitzungFuerVergleich(ordner);
    const lauf = await starte(sitzung);
    try {
      const t = { 'x-freigabe-token': sitzung.token };
      const seite = await anfrage(lauf.port, { pfad: '/', kopf: t });
      assert.equal(seite.status, 200);
      assert.equal(seite.kopf['content-type'], 'text/html; charset=utf-8');
      assert.equal(seite.text, SEITE.baueSeite(sitzung));
      // Jede Route, die der Shorts-Modus vor EL hatte, hat er noch.
      for (const pfad of ['/stand', '/kette', '/lauf']) {
        const a = await anfrage(lauf.port, { pfad, kopf: t });
        assert.equal(a.status, 200, pfad + ' antwortet nicht mehr mit 200');
      }
      const video = await anfrage(lauf.port, { pfad: '/video?i=0', kopf: t });
      assert.equal(video.status, 200, '/video liefert nicht mehr aus');
      // Und der Fallback, der frueher jede unbekannte GET-Route an /video
      // weitergab, faengt weiterhin nichts Fremdes: unbekannt bleibt 404.
      const fremd = await anfrage(lauf.port, { pfad: '/gibtsnicht', kopf: t });
      assert.equal(fremd.status, 404);
    } finally { await lauf.schliesse(); }
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

// ===========================================================================
// NACHWEIS 2: KEIN ZWEITER DARSTELLUNGSWEG
// ===========================================================================

test('EL-N2a: die Ansicht kennt keinen Feldnamen und kein Befundwort des Arbeiters', () => {
  // Nach dem Muster von EK-T2 ("der Arbeiter baut die Zustandsmatrix nicht
  // nach"): was der Arbeiter benennt, wird hier nicht ein zweites Mal benannt.
  // Kaeme eines dieser Woerter hier vor, gaebe es eine Stelle, an der diese
  // Seite ueber den Inhalt des Trockenlaufs etwas WEISS -- und ab da koennte
  // sie ihn auslegen.
  const VERBOTEN = [
    // die Felder des Beipackzettels und der Matrix (Vertrag 2.7, 3.3)
    'videotitel', 'aufnahme_herkunft', 'unbestaetigt', 'Beipackzettel',
    'rang1', 'rang2', 'kein_kandidat', 'Kalendertag', 'geweitet',
    // die Videodatei (3.2)
    'matrix-cut', 'Groessenvergleich', 'LONGFORM_RENDER_WURZEL', '.partial',
    // das Bild und seine Grenze (2.10)
    'THUMBNAIL_EXPORT_DIR', 'sha256', 'MiB',
    // Beschreibung, Hashtags, Tags (2.9) und der Upload (2.5, 2.14)
    'Hashtag', 'hashtag', 'Codepunkte', 'privacyStatus', 'notifySubscribers',
    'publishAt', 'videos.insert', 'thumbnails.set',
  ];
  // Geprueft wird zweierlei, und die Trennung ist beim Bau von EL noetig
  // geworden: der CODE dieser Ansicht -- was sie TUT --, und die
  // AUSGELIEFERTE Seite -- was ueber die Leitung geht. Die Begruendungen in
  // den // -Kommentaren gehoeren zu keinem von beiden: dort steht, WARUM ein
  // Wort hier nicht vorkommt, und ein Test, der seine eigene Begruendung als
  // Verstoss zaehlt, zwingt dazu, die Begruendung wegzulassen. Ein Kommentar
  // INNERHALB der Stil- oder Skriptvorlage zaehlt dagegen mit -- der geht
  // bei jedem Aufruf mit hinaus und steht im Browser eines Menschen.
  const nurCode = LONGFORM_TEIL.split(String.fromCharCode(10))
    .filter((z) => !z.trim().startsWith('//')).join(String.fromCharCode(10));
  const sitzung = longformSitzung();
  let ausgeliefert;
  try { ausgeliefert = SEITE.baueLongformSeite(sitzung); }
  finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
  for (const wort of VERBOTEN) {
    assert.ok(!nurCode.includes(wort),
      'Die Longform-Ansicht kennt "' + wort + '" -- ein Wort, das dem Arbeiter gehoert. ' +
      'Damit hat sie eine Meinung ueber seinen Inhalt, und die naechste Aenderung an ' +
      'seiner Ausgabe macht sie unwahr.');
    assert.ok(!ausgeliefert.includes(wort),
      'Das Wort "' + wort + '" steht in der ausgelieferten Seite, obwohl der Arbeiter ' +
      'es nicht geschrieben hat.');
  }
  // Und der Gegenbeweis, dass hier ueberhaupt etwas steht.
  assert.ok(LONGFORM_TEIL.length > 5000, 'der Longform-Teil wurde gefunden');
  assert.ok(LONGFORM_TEIL.includes('function baueLongformSeite(sitzung)'));
});

test('EL-N2b: das Skript der Ansicht zerlegt den Text des Arbeiters nicht', () => {
  // Der eigentliche Riegel. Woerter kann man vermeiden und trotzdem
  // nachbauen; was man NICHT kann, ist einen Text auslegen, ohne ihn
  // anzufassen. Im Skript dieser Ansicht gibt es keine einzige
  // Zeichenkettenoperation -- der Text geht als EIN Stueck an textContent und
  // wird nie geteilt, gesucht, ersetzt oder beschnitten.
  const von = LONGFORM_TEIL.indexOf('const LONGFORM_SKRIPT = String.raw`');
  assert.ok(von >= 0, 'das Skript der Ansicht wurde gefunden');
  const bis = LONGFORM_TEIL.indexOf('`;', von);
  // Nur der CODE. Die Kommentare des Skripts reden ueber innerHTML und ueber
  // das Zerlegen -- das sollen sie, denn dort steht, warum beides hier nicht
  // vorkommt. Ein Test, der seine eigene Begruendung als Verstoss zaehlt,
  // zwingt dazu, die Begruendung wegzulassen.
  const skript = LONGFORM_TEIL.slice(von, bis).split('\n')
    .filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.ok(skript.length > 400, 'das Skript hat einen Rumpf');

  for (const werkzeug of ['.split(', '.match(', '.replace(', '.indexOf(', '.slice(',
    '.substring(', '.trim(', '.startsWith(', '.endsWith(', '.includes(', '.exec(',
    'RegExp', 'innerHTML', 'insertAdjacentHTML', 'document.write']) {
    assert.ok(!skript.includes(werkzeug),
      'Das Skript der Longform-Ansicht benutzt ' + werkzeug + '. Damit legt es den Text ' +
      'des Arbeiters aus -- und das ist die zweite Fassung einer Regel, die 37 Zustaende ' +
      'hat (Vertrag 2.7).');
  }
  // Positiv: der Text geht ueber textContent in den Baum, und zwar er selbst.
  // GENAU EINE Stelle, an der Text in den Baum geht. Zwei waeren zwei
  // Gelegenheiten, an einer davon zu kuerzen -- und der Mutationslauf zu EL
  // hat vorgefuehrt, dass eine Kuerzung an der einen die andere unberuehrt
  // laesst und der Test dann gruen bleibt.
  assert.equal((skript.match(/\.textContent = /g) || []).length, 1,
    'Text geht an mehr als einer Stelle in den Baum');
  assert.ok(skript.includes('element.textContent = text;'),
    'der Wert wird nicht unveraendert gesetzt');

  // Und die Gegenprobe: eine Fassung MIT einem Schnitt faellt durch.
  const verletzt = skript.replace('element.textContent = text;',
    "element.textContent = text.split(String.fromCharCode(10))[0];");
  assert.notEqual(verletzt, skript, 'die Gegenprobe hat wirklich etwas geaendert');
  assert.ok(verletzt.includes('.split('),
    'die Gegenprobe traegt jetzt einen Schnitt -- und genau den findet die Schleife oben');
});

test('EL-N2c: jede Zeile des Arbeiters steht unveraendert in der ausgelieferten Seite', () => {
  // Der Positivnachweis zu den beiden davor: dass nichts nachgebaut wird,
  // nuetzt nichts, wenn dafuer etwas fehlt. Verglichen wird der ganze Strom,
  // Zeichen fuer Zeichen, und zusaetzlich jede einzelne Zeile.
  const sitzung = longformSitzung();
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    const daten = datenAusSeite(html);
    assert.equal(daten.err, sitzung.trocken.err,
      'der Strom in der Seite ist nicht mehr der des Arbeiters');
    assert.equal(daten.aus, sitzung.trocken.aus);
    for (const zeile of sitzung.trocken.err.split('\n')) {
      if (zeile === '') continue;
      assert.ok(daten.err.includes(zeile), 'diese Zeile fehlt in der Seite: ' + zeile);
    }
    // Der Text steht GENAU EINMAL in der Seite und nicht noch einmal als
    // Markup daneben: zweimal derselbe Text waere zwei Stellen, die
    // auseinanderlaufen koennen.
    const ohneDaten = html.replace(/\nconst DATEN = \{.*\};\n/, '\n');
    assert.ok(!ohneDaten.includes('MARKE-KOPF'),
      'der Text des Arbeiters steht ein zweites Mal in der Seite -- ausserhalb des ' +
      'einen JSON-Blocks');
    assert.ok(!ohneDaten.includes('MARKE-WERT-A'));

    // Und der Befehl, aus dem er stammt, steht dabei -- sonst weiss niemand,
    // welcher Lauf das war.
    assert.equal(daten.befehl, sitzung.trocken.befehl);
    assert.equal(daten.aufnahme, AUFNAHME);

    // UND JETZT DAS, WAS EIN MENSCH SIEHT. Das Skript der Seite laeuft
    // wirklich, und danach wird nachgesehen, was im Kasten steht. Ohne diesen
    // Schritt hiesse "jede Zeile ist da" nur "jede Zeile ist mitgeschickt".
    const baum = fuehreSkriptAus(html);
    const kasten = baum.get('#stromErr pre');
    assert.ok(kasten, 'der Kasten fuer stderr wurde nie beschrieben');
    assert.equal(kasten.textContent, sitzung.trocken.err,
      'was im Kasten steht, ist nicht Zeichen fuer Zeichen der Text des Arbeiters');
    assert.ok(kasten.textContent.includes('MARKE-LETZTE-ZEILE'),
      'die letzte Zeile fehlt im Kasten -- irgendwo wird gekuerzt');
    assert.ok(kasten.textContent.includes('MARKE-ZEILE-024'),
      'eine Zeile aus der Mitte fehlt im Kasten');
    assert.equal(baum.get('stromErr').hidden, false, 'der Kasten bleibt zugedeckt');
    assert.equal(baum.get('stromAus').hidden, true,
      'der leere Kasten fuer stdout wird aufgedeckt -- ein Rahmen ohne Inhalt');
    // Und der Kopf sagt, welcher Lauf das war.
    assert.ok(baum.get('kopf2').textContent.includes(sitzung.trocken.befehl));
    assert.ok(baum.get('kopf1').textContent.includes(AUFNAHME));
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

test('EL-N2c: ein Trockenlauf mit </script> darin sprengt den Skriptblock nicht', () => {
  const sitzung = longformSitzung();
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    // Im Skriptblock steht kein rohes </script> -- sonst endete er dort.
    const von = html.indexOf('<script>');
    const bis = html.indexOf('<\/script>', von);
    const block = html.slice(von, bis);
    assert.ok(!block.includes('</script>'),
      'der Skriptblock traegt ein rohes </script> und endet damit an der falschen Stelle');
    // Und trotzdem kommt der Text vollstaendig wieder heraus.
    const daten = datenAusSeite(html);
    assert.ok(daten.err.includes('</script><script>MARKE-BOESE()</script>'),
      'der maskierte Text kommt nicht unversehrt zurueck');
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

test('EL-N2: der Ausgang wird benannt, nicht gedeutet -- die Bedeutung kommt aus der Tabelle',
  () => {
    const L = require('../src/upload/uebergabe-leser.js');
    for (const wert of S.LONGFORM_CODES_MIT_SEITE) {
      const a = S.longformAusgang({ code: wert, fehler: null, aus: '', err: '', befehl: 'x' });
      const zeile = L.EXIT_CODES.find((c) => c.wert === wert);
      assert.equal(a.bedeutung, zeile.bedeutung,
        'die Bedeutung von ' + wert + ' ist hier anders formuliert als in der Tabelle');
      assert.equal(a.name, zeile.name);
      assert.ok(a.zusatz && a.zusatz.length > 40, 'zu ' + wert + ' fehlt der Zusatz');
    }
    // KEIN GRUEN, KEIN "BEREIT". Auch der 0er ist hier kein gutes Zeichen.
    const null_ = S.longformAusgang({ code: 0, fehler: null, aus: '', err: '', befehl: 'x' });
    assert.match(null_.zusatz, /heisst NICHT/);
    // Das WORT, nicht seine Bestandteile: "vorbereiten" und "bereits" sind
    // etwas anderes und duerfen vorkommen. Ohne die Wortgrenzen faellt dieser
    // Test eines Tages aus einem Grund, mit dem er nichts zu tun hat -- beim
    // Mutationslauf zu EL ist genau das passiert.
    assert.ok(!/\bbereit\b/i.test(null_.zusatz + LONGFORM_TEIL),
      'irgendwo steht "bereit" -- ein Wort, das diese Seite nicht sagen darf');
    assert.ok(!/gruen|#3fa45b|#7bd79a|#235c37/.test(
      LONGFORM_TEIL.slice(LONGFORM_TEIL.indexOf('const LONGFORM_STIL'),
        LONGFORM_TEIL.indexOf('const LONGFORM_SKRIPT'))),
    'die Longform-Ansicht traegt eine Zustimmungsfarbe');
  });

// ===========================================================================
// NACHWEIS 3: NICHTS AN DER ANSICHT KANN SCHREIBEN
// ===========================================================================

// Die schreibenden Funktionen des Dateisystems. Dieselbe Liste wie in
// tests/freigabe-server.test.cjs, dazu die Promise-Fassungen -- ein Weg, der
// ueber fs.promises ginge, faende dort sonst eine offene Tuer.
const SCHREIBENDE_FS = [
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'renameSync', 'rename',
  'mkdirSync', 'mkdir', 'unlinkSync', 'unlink', 'rmSync', 'rm', 'rmdirSync', 'rmdir',
  'createWriteStream', 'writeSync', 'write', 'copyFileSync', 'copyFile',
  'truncateSync', 'truncate', 'ftruncateSync', 'chmodSync', 'chmod', 'utimesSync',
  'openSync', 'open', 'mkdtempSync', 'symlinkSync', 'linkSync',
];

// Stellt jede davon scharf: sie wirft, ausser der Pfad gehoert zur Sperre
// dieser Sitzung. Gibt eine Liste der ERLAUBTEN Aufrufe zurueck -- die wird
// hinterher angesehen, damit "nichts geschrieben" nicht heisst "gar nichts
// getan".
// EIN DATEIDESKRIPTOR IST KEIN FREIBRIEF. schreibeSperrinhalt arbeitet auf
// dem fd, den nimmSperre geoeffnet hat -- ftruncateSync(fd), writeSync(fd).
// Die Falle laesst das durch, aber nur fuer die fds, die sie SELBST aus
// einem erlaubten openSync hat herausgehen sehen. Ein writeSync auf einen
// fremden fd faellt damit genauso auf wie ein writeFileSync auf einen
// fremden Pfad; ohne diese Buchfuehrung waere jede fd-Fassung ein Loch.
function stelleScharf(erlaubtePfade) {
  const echt = {};
  const gesehen = [];
  const eigeneFds = new Set();
  const pfadErlaubt = (p) => erlaubtePfade.some((e) => p === e || p.startsWith(e));
  for (const name of SCHREIBENDE_FS) {
    if (typeof fs[name] !== 'function') continue;
    echt[name] = fs[name];
    fs[name] = function scharf(...args) {
      const a = args[0];
      const alsPfad = typeof a === 'string' ? a : (Buffer.isBuffer(a) ? a.toString() : null);
      if (alsPfad !== null) {
        if (!pfadErlaubt(alsPfad)) {
          throw new Error('SCHREIBFALLE: fs.' + name + '(' + JSON.stringify(alsPfad) +
            ') -- dieser Durchlauf darf ausser der Sperre nichts schreiben.');
        }
      } else if (Number.isInteger(a)) {
        if (!eigeneFds.has(a)) {
          throw new Error('SCHREIBFALLE: fs.' + name + ' auf den fremden Deskriptor ' + a +
            ' -- er kam nicht aus einem erlaubten openSync dieses Durchlaufs.');
        }
      } else {
        throw new Error('SCHREIBFALLE: fs.' + name + ' mit einem Ziel, das weder Pfad ' +
          'noch Deskriptor ist: ' + String(a));
      }
      const ergebnis = echt[name].apply(fs, args);
      if (name === 'openSync' && Number.isInteger(ergebnis)) eigeneFds.add(ergebnis);
      gesehen.push(name + ' ' + (alsPfad === null ? 'fd ' + a : alsPfad));
      return ergebnis;
    };
  }
  return {
    gesehen,
    eigeneFds,
    zurueck() { for (const name of Object.keys(echt)) fs[name] = echt[name]; },
  };
}

test('EL-N3: der volle Longform-Durchlauf schreibt nichts ausser der Sperre', async () => {
  const ordner = wegwerfordner();
  const sperrpfad = S.sperrPfad(ordner, AUFNAHME, S.MODUS_LONGFORM);
  // Erlaubt sind: die Sperrdatei selbst und der Ordner, in dem sie liegt
  // (nimmSperre legt ihn mit mkdirSync an). Beides ausdruecklich aufgezaehlt
  // und nicht ueber eine weiche Regel abgedeckt.
  const falle = stelleScharf([sperrpfad, path.dirname(sperrpfad)]);
  let lauf = null;
  let sperre = null;
  try {
    sperre = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME, modus: S.MODUS_LONGFORM });
    assert.equal(sperre.ok, true);

    const sitzung = S.baueLongformSitzung({
      aufnahme: AUFNAHME, projektwurzel: ordner, port: 0,
      trocken: erfundenerTrockenlauf(),
    });
    lauf = await starte(sitzung);
    S.traegeSperrePortNach(sperre, lauf.port);

    const t = { 'x-freigabe-token': sitzung.token };
    const u = { origin: 'http://' + S.HOST + ':' + lauf.port };

    // Die Seite selbst, mehrfach.
    for (let i = 0; i < 3; i++) {
      const a = await anfrage(lauf.port, { pfad: '/', kopf: t });
      assert.equal(a.status, 200);
    }
    // JEDE Route des Shorts-Modus, mit GET und mit POST, mit und ohne Leib.
    const leib = JSON.stringify({ sha256: 'a'.repeat(64), freigegeben: true, titel: 'x' });
    for (const pfad of ['/', '/video?i=0', '/stand', '/kette', '/lauf', '/urteil',
      '/beenden', '/planen', '/archivieren', '/hochladen', '/gibtsnicht',
      '/../../windows/win.ini']) {
      const g = await anfrage(lauf.port, { pfad, kopf: t });
      assert.ok(g.status === 200 || g.status === 404 || g.status === 400,
        'GET ' + pfad + ' -> ' + g.status);
      const p = await anfrage(lauf.port, {
        methode: 'POST', pfad, leib,
        kopf: Object.assign({ 'content-type': 'application/json',
          'content-length': Buffer.byteLength(leib) }, t, u),
      });
      assert.equal(p.status, 404, 'POST ' + pfad + ' wird beantwortet statt abgewiesen');
      const d = await anfrage(lauf.port, { methode: 'DELETE', pfad, kopf: t });
      assert.ok(d.status === 404 || d.status === 405, 'DELETE ' + pfad + ' -> ' + d.status);
    }
    await lauf.schliesse();
    lauf = null;

    const frei = S.gibSperreFrei(sperre);
    assert.equal(frei.geloescht, true, frei.grund);
    sperre = null;

    // Es wurde ueberhaupt geschrieben -- naemlich die Sperre, und nur sie.
    assert.ok(falle.gesehen.length > 0, 'die Falle hat gar keinen Schreibaufruf gesehen');
    for (const eintrag of falle.gesehen) {
      const aufDenEigenenFd = /^\w+ fd (\d+)$/.exec(eintrag);
      assert.ok(eintrag.includes(path.dirname(sperrpfad)) ||
        (aufDenEigenenFd && falle.eigeneFds.has(Number(aufDenEigenenFd[1]))),
      'ein erlaubter Aufruf ging woanders hin: ' + eintrag);
    }
    // Und die Sperrdatei war wirklich dabei -- sonst hiesse "nur die Sperre"
    // hier bloss "gar nichts", und der Durchlauf haette nicht stattgefunden.
    assert.ok(falle.gesehen.some((e) => e.includes(sperrpfad)),
      'die Sperrdatei wurde gar nicht angefasst: ' + falle.gesehen.join(' | '));
  } finally {
    falle.zurueck();
    if (lauf) await lauf.schliesse();
    if (sperre) S.gibSperreFrei(sperre);
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('EL-N3: die Schreibfalle schnappt zu, wenn man sie verletzt', () => {
  const ordner = wegwerfordner();
  const sperrpfad = S.sperrPfad(ordner, AUFNAHME, S.MODUS_LONGFORM);
  const falle = stelleScharf([sperrpfad, path.dirname(sperrpfad)]);
  try {
    // Ein Schreibaufruf woanders hin -- genau der, den der Durchlauf oben nicht
    // machen darf. Er MUSS werfen, sonst hat der Test darueber nichts gezeigt.
    assert.throws(
      () => fs.writeFileSync(path.join(ordner, 'ermaechtigung-4711.json'), '{}'),
      /SCHREIBFALLE: fs\.writeFileSync/);
    assert.throws(() => fs.mkdirSync(path.join(ordner, 'ermaechtigungen')),
      /SCHREIBFALLE: fs\.mkdirSync/);
    assert.throws(() => fs.createWriteStream(path.join(ordner, 'x')),
      /SCHREIBFALLE: fs\.createWriteStream/);
    // Und die Sperre bleibt erlaubt -- eine Falle, die alles faengt, faengt
    // auch das, was erlaubt ist, und beweist dann nichts.
    fs.mkdirSync(path.dirname(sperrpfad), { recursive: true });
    fs.writeFileSync(sperrpfad, '{}');
    assert.ok(fs.existsSync(sperrpfad));
  } finally {
    falle.zurueck();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('EL-N3: die ausgelieferte Seite traegt kein Element, das etwas schicken koennte', () => {
  const sitzung = longformSitzung();
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    for (const stueck of ['<form', '<input', '<button', '<textarea', '<select',
      'fetch(', 'XMLHttpRequest', 'navigator.sendBeacon', 'addEventListener',
      'onclick', 'onsubmit', 'formaction']) {
      assert.ok(!html.includes(stueck),
        'die Longform-Seite traegt ' + stueck + ' -- damit gibt es einen Weg zurueck zum ' +
        'Dienst, und den soll es in diesem Modus nicht geben');
    }
    // Auch die Sicherung im Kopf sagt es: nichts darf hinaus.
    assert.match(html, /default-src 'none'/);
    assert.ok(!/connect-src/.test(html),
      "connect-src steht in der Sicherung -- diese Seite ruft nichts auf, also faellt " +
      "sie auf default-src 'none'");
    assert.match(html, /form-action 'none'/);
    // Und das Sitzungstoken liegt nicht in der Seite herum: sie braucht es
    // nicht, weil sie keinen Aufruf macht.
    assert.ok(!html.includes(sitzung.token),
      'das Sitzungstoken steht in der Seite, obwohl sie keinen Aufruf macht');
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

test('EL-N3: der Longform-Modus hat keine einzige POST-Route', () => {
  // Nicht "die POST-Routen schreiben nichts", sondern: es gibt keine. Das
  // laesst sich in einem Blick pruefen, das andere muesste man glauben.
  assert.match(SERVER_NURCODE, /\[MODUS_LONGFORM\]: new Set\(\[\]\),/);
  const von = SERVER_NURCODE.indexOf('const ROUTEN_GET = {');
  const bis = SERVER_NURCODE.indexOf('};', SERVER_NURCODE.indexOf('const ROUTEN_POST = {'));
  const tabellen = SERVER_NURCODE.slice(von, bis);
  assert.ok(tabellen.includes("[MODUS_LONGFORM]: new Set(['/']),"),
    'der Longform-Modus hat mehr oder weniger als die eine GET-Route');
});

// ===========================================================================
// NACHWEIS 4: DIE ABSICHERUNGEN SIND GEERBT, NICHT NACHGEBAUT
// ===========================================================================
//
// Der Punkt ist nicht, dass beide Modi gesichert sind -- es ist, dass es
// DIESELBE Sicherung ist. Zwei Fassungen einer Regel sind auf Dauer
// eineinhalb.

test('EL-N4: es gibt EINE Bindung, EIN Token und EINE Herkunftspruefung, nicht je Modus eine',
  () => {
    // 1. Die Bindung steht als eine Konstante da und wird nirgends umgangen.
    assert.equal((SERVER_NURCODE.match(/const HOST = '127\.0\.0\.1';/g) || []).length, 1);
    assert.equal((SERVER_NURCODE.match(/\.listen\(/g) || []).length, 2,
      'listen steht zweimal -- einmal je Startweg');
    for (const m of SERVER_NURCODE.matchAll(/\.listen\(([^)]*)\)/g)) {
      assert.ok(/HOST/.test(m[1]),
        'ein listen ohne HOST: ' + m[0] + ' -- der Dienst haenge dann an allem');
    }
    // 2. Die drei Pruefungen stehen je genau EINMAL, und zwar im Handler.
    for (const [was, muster] of [
      ['Host-Pruefung', /if \(wirklicherHost !== erwarteterHost\(\)\) \{/g],
      ['Origin-Pruefung', /if \(ursprung !== undefined && ursprung !== erwarteterUrsprung\(\)\) \{/g],
      ['Origin-Pflicht bei POST', /if \(req\.method === 'POST' && ursprung === undefined\) \{/g],
      ['Tokenpruefung', /if \(!gleichSicher\(token, sitzung\.token\)\) \{/g],
    ]) {
      assert.equal((SERVER_NURCODE.match(muster) || []).length, 1,
        was + ' steht nicht genau einmal im Code');
    }
    // 3. Sie stehen VOR der Routenwahl -- und die Routenwahl ist die einzige
    //    Stelle, an der der Modus ueberhaupt vorkommt.
    const handler = SERVER_NURCODE.slice(SERVER_NURCODE.indexOf('const dienst = http.createServer'),
      SERVER_NURCODE.indexOf('function liefereVideo('));
    const wo = (x) => handler.indexOf(x);
    assert.ok(wo('wirklicherHost !== erwarteterHost()') > 0);
    assert.ok(wo('gleichSicher(token, sitzung.token)') > wo('wirklicherHost !== erwarteterHost()'),
      'das Token wird vor der Herkunft geprueft');
    assert.ok(wo('routenGet.has(pfad)') > wo('gleichSicher(token, sitzung.token)'),
      'die Route wird gewaehlt, bevor Herkunft und Token geprueft sind');
    assert.ok(!/MODUS_LONGFORM|MODUS_SHORTS/.test(
      handler.slice(0, wo('gleichSicher(token, sitzung.token)'))),
    'vor der Tokenpruefung steht ein Modusvergleich -- dann gibt es dort zwei Wege');
  });

// Dieselben Angriffe, beide Modi, dieselben Antworten. Faellt die eine Stelle,
// faellt dieser Test fuer BEIDE -- und genau das ist die Zusage.
// undefined heisst "diese Kopfzeile gar nicht senden" -- dieselbe Regel wie in
// tests/freigabe-server.test.cjs. Ohne sie waere "ohne Token" nicht pruefbar,
// weil das Token unten sonst immer mitgeht.
const ANGRIFFE = [
  ['ohne Token', { kopf: { 'x-freigabe-token': undefined } }, 403, 'token_fehlt_oder_falsch'],
  ['falsches Token', { kopf: { 'x-freigabe-token': 'a'.repeat(64) } }, 403,
    'token_fehlt_oder_falsch'],
  ['leeres Token', { kopf: { 'x-freigabe-token': '' } }, 403, 'token_fehlt_oder_falsch'],
  ['fremder Host', { host: 'example.invalid:1' }, 403, 'fremder_host'],
  ['Host als Name statt Zahl', { host: 'localhost' }, 403, 'fremder_host'],
  ['fremder Ursprung', { kopf: { origin: 'http://example.invalid' } }, 403, 'fremder_ursprung'],
];

for (const modus of ['shorts', 'longform']) {
  test('EL-N4: dieselbe Sicherung im Modus ' + modus, async () => {
    const ordner = wegwerfordner();
    let sitzung;
    if (modus === 'shorts') sitzung = shortsSitzungFuerVergleich(ordner);
    else {
      sitzung = S.baueLongformSitzung({
        aufnahme: AUFNAHME, projektwurzel: ordner, port: 0, trocken: erfundenerTrockenlauf(),
      });
    }
    const lauf = await starte(sitzung);
    try {
      // Erst der Beweis, dass es MIT Token geht -- sonst zeigten die
      // Abweisungen unten nur, dass der Dienst gar nichts beantwortet.
      const gut = await anfrage(lauf.port, {
        pfad: '/', kopf: { 'x-freigabe-token': sitzung.token } });
      assert.equal(gut.status, 200, modus + ': die Seite kommt nicht einmal mit Token');

      for (const [name, wie, status, code] of ANGRIFFE) {
        const kopf = Object.assign({ 'x-freigabe-token': sitzung.token }, wie.kopf || {});
        if (wie.host !== undefined) kopf.host = wie.host;
        const a = await anfrage(lauf.port, { pfad: '/', kopf });
        assert.equal(a.status, status, modus + ' / ' + name + ': Status ' + a.status);
        assert.match(a.text, new RegExp(code), modus + ' / ' + name);
      }
      // Das Token in der Adresse wirkt wie das im Kopf -- in beiden Modi.
      const ueberAdresse = await anfrage(lauf.port, { pfad: '/?t=' + sitzung.token });
      assert.equal(ueberAdresse.status, 200, modus + ': das Token in der Adresse wirkt nicht');
      // Und ein Token, das nur fast stimmt, wird zeichenweise sicher verglichen.
      const fast = sitzung.token.slice(0, -1) + (sitzung.token.endsWith('a') ? 'b' : 'a');
      const knapp = await anfrage(lauf.port, { pfad: '/?t=' + fast });
      assert.equal(knapp.status, 403, modus + ': ein fast richtiges Token kam durch');
    } finally {
      await lauf.schliesse();
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });
}

// ===========================================================================
// WAS DIE ANSICHT ZEIGT UND WO SIE AUFHOERT
// ===========================================================================

test('EL: die Seite sagt, wo sie aufhoert, und dass es das Naechste nicht gibt', () => {
  const sitzung = longformSitzung();
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    assert.match(html, /Hier hoert diese Seite auf/);
    assert.match(html, /Was als Naechstes kaeme/);
    assert.match(html, /Vertrag 4, Schritte 8 bis 17/);
    assert.match(html, /Nichts davon ist gebaut/);
    // Die Ermaechtigung wird BENANNT und nicht gebaut -- und der Grund steht
    // dabei, weil eine Auskunft ohne Grund beim naechsten Bau umgestossen wird.
    assert.match(html, /Einmal-Ermaechtigung/);
    assert.match(html, /liegt herum, bis jemand sie einloest/);
    // Und die eine Datei, die dieser Dienst schreibt, steht da.
    assert.match(html, /seine\s+eigene Sperre/);
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

test('EL: ein leerer Strom bekommt keinen leeren Kasten', () => {
  const sitzung = longformSitzung({ aus: '', err: '' });
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    // Beide Kaesten stehen versteckt in der Seite; das Skript deckt nur den
    // auf, der Inhalt hat. Bei zwei leeren Stroemen sagt die Seite das --
    // statt zwei leere Rahmen zu zeigen, die aussehen wie Inhalt.
    assert.match(html, /id="keinStrom"/);
    assert.match(html, /auf beiden Kanaelen nichts geschrieben/);
    assert.match(html, /kein guter Zustand, sondern ein unerklaerter/);
    const daten = datenAusSeite(html);
    assert.equal(daten.aus, '');
    assert.equal(daten.err, '');
    const baum = fuehreSkriptAus(html);
    assert.equal(baum.get('stromAus').hidden, true);
    assert.equal(baum.get('stromErr').hidden, true);
    assert.equal(baum.get('keinStrom').hidden, false,
      'bei zwei leeren Stroemen sagt die Seite nichts dazu');
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

test('EL: beide Stroeme stehen getrennt, wenn beide etwas tragen', () => {
  const sitzung = longformSitzung({ aus: 'MARKE-STDOUT-EINS\nMARKE-STDOUT-ZWEI', code: 0 });
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    const daten = datenAusSeite(html);
    assert.equal(daten.aus, 'MARKE-STDOUT-EINS\nMARKE-STDOUT-ZWEI');
    assert.ok(daten.err.includes('MARKE-KOPF'));
    // Nicht zusammengefuegt: der eine steht nicht im anderen.
    assert.ok(!daten.aus.includes('MARKE-KOPF'));
    assert.ok(!daten.err.includes('MARKE-STDOUT-EINS'));
    assert.match(html, /Zusammengefuegt werden sie nicht/);
    // Und beide Kaesten stehen wirklich offen, jeder mit seinem eigenen Text.
    const baum = fuehreSkriptAus(html);
    assert.equal(baum.get('stromAus').hidden, false);
    assert.equal(baum.get('stromErr').hidden, false);
    assert.equal(baum.get('#stromAus pre').textContent, daten.aus);
    assert.equal(baum.get('#stromErr pre').textContent, daten.err);
    assert.equal(baum.get('keinStrom').hidden, true);
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

test('EL: eine Aufnahme ohne die feste Form kommt gar nicht erst in eine Sitzung', () => {
  for (const boese of ['..', '2026-9-3 17-08-11', '', 'x/../y', null]) {
    assert.throws(() => S.baueLongformSitzung({
      aufnahme: boese, projektwurzel: 'Q', port: 0, trocken: erfundenerTrockenlauf(),
    }), /nicht die feste Form/, JSON.stringify(boese) + ' kam durch');
  }
});

test('EL: der Ausgang mit 2 bekommt keine Seite, sondern eine Meldung', () => {
  // Die Regel: hat der Arbeiter gelesen, zeigt die Seite es; hat er nichts
  // gelesen, gibt es nichts zu zeigen. Der 2er ist aus seiner eigenen
  // Definition heraus der Fall "es wurde nichts gelesen".
  assert.ok(!S.LONGFORM_CODES_MIT_SEITE.includes(S.EXIT_AUFRUFFEHLER));
  assert.ok(S.LONGFORM_CODES_MIT_SEITE.includes(S.EXIT_OK));
  assert.ok(S.LONGFORM_CODES_MIT_SEITE.includes(S.EXIT_ABBRUCH));
  assert.ok(S.LONGFORM_CODES_MIT_SEITE.includes(3), 'die Sperrliste (3) bekommt eine Seite');

  const text = S.meldeLongformOhneVorschau(AUFNAHME, 'Q/x.longform.sperre.json', {
    befehl: 'node arbeiter --aufnahme="x"', code: 2, fehler: null,
    aus: '', err: 'MARKE-DER-ARBEITER-SAGT-DAS-HIER',
  });
  assert.match(text, /kam nicht bis zum Lesen/);
  assert.ok(text.includes(AUFNAHME));
  assert.ok(text.includes('MARKE-DER-ARBEITER-SAGT-DAS-HIER'),
    'sein Text wird nicht durchgereicht');
  assert.match(text, /Es wurde nichts hochgeladen/);
  assert.match(text, /nichts ausser seiner Sperre/);

  // Und der Fall, in dem er sich gar nicht starten liess.
  const weg = S.meldeLongformOhneVorschau(AUFNAHME, 'Q/x.longform.sperre.json', {
    befehl: 'node arbeiter --aufnahme="x"', code: null, fehler: 'spawn ENOENT',
    aus: '', err: '',
  });
  assert.match(weg, /liess sich nicht starten: spawn ENOENT/);
  assert.match(weg, /\(kein Ende\)/);
});

test('EL: der Dienst ruft den Arbeiter auf, statt ihn nachzubauen', () => {
  // Derselbe Riegel wie beim Leser: hier steht ein spawnSync auf seine Datei
  // und kein Nachbau seiner Regeln. Kein --execute, kein --bestaetigt-durch=.
  assert.match(SERVER_NURCODE,
    /const argumente = \[LONGFORM_ARBEITER, '--aufnahme=' \+ aufnahme\];/);
  // --execute und --bestaetigt-durch= gibt es im Dienst -- fuer den SHORTS-
  // Uploader, seit DR, mit Knopf und Ermaechtigung. Geprueft wird darum der
  // Longform-Weg: von ruftLongformTrocken bis zum Ende von starteLongform
  // kommt keines von beiden vor.
  const longformWeg = SERVER_NURCODE.slice(
    SERVER_NURCODE.indexOf('function ruftLongformTrocken'),
    SERVER_NURCODE.indexOf('function main()'));
  assert.ok(longformWeg.length > 1500, 'der Longform-Weg wurde gefunden');
  for (const wort of ['--execute', 'bestaetigt-durch']) {
    assert.ok(!longformWeg.includes(wort),
      'der Longform-Weg kennt ' + wort + ' -- dann kann er den schreibenden Arbeiter ' +
      'starten oder eine Ermaechtigung vorbereiten');
  }
  // Und keine Ermaechtigung fuer Longform: der Ordner kommt in diesem Modus
  // nicht vor.
  const longformTeil = SERVER_NURCODE.slice(SERVER_NURCODE.indexOf('function starteLongform('),
    SERVER_NURCODE.indexOf('function main()'));
  assert.ok(longformTeil.length > 500, 'der Startweg des Longform-Modus wurde gefunden');
  for (const wort of ['schreibeErmaechtigung', 'ermaechtigung', 'planPfad', 'ruftPlaner',
    'schreibeFreigaben', 'starteUploaderLauf', 'ruftUploaderTrocken', 'ruftLeser']) {
    assert.ok(!longformTeil.includes(wort),
      'der Longform-Startweg fasst ' + wort + ' an');
  }
});
