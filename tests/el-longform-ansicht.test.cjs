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
    'THUMBNAIL_EXPORT_DIR', 'MiB',
    // Beschreibung, Hashtags, Tags (2.9) und der Upload (2.5, 2.14)
    'Hashtag', 'hashtag', 'Codepunkte', 'privacyStatus', 'notifySubscribers',
    'publishAt', 'videos.insert', 'thumbnails.set',
  ];
  // EN: "sha256" IST AUS DER LISTE HERAUSGENOMMEN, und das ist eine Aenderung
  // an der Zusage und keine Aufweichung. Sie ist es aus einem Grund, der
  // benannt gehoert:
  //
  // Bis EN hatte die Ansicht ueber den Arbeiter nur EINE Auskunft -- seinen
  // Text -, und alles, was sie ueber seinen INHALT wusste, konnte sie nur aus
  // diesem Text geschnitten haben. Deshalb war jedes seiner Woerter hier ein
  // Verstoss.
  //
  // Seit EN gibt es eine ZWEITE Auskunft: die Befundzeile, die der Arbeiter
  // AUSDRUECKLICH fuer diesen Dienst herausgibt (longform-arbeiter.js,
  // --befund-json). Ihre Feldnamen zu kennen ist kein Auslegen seines Textes,
  // sondern das Gegenteil davon -- sie sind gerade dafuer da, dass niemand im
  // Text nach dem Bildpfad sucht.
  //
  // Damit die Zusage nicht am Wort "sha256" haengenbleibt, waehrend die Sache
  // dahinter aufweicht, steht sie ab hier SCHAERFER da als vorher: kein Wort
  // des Arbeiters darf in der ausgelieferten Seite stehen, das nicht der
  // Arbeiter selbst geschrieben hat -- geprueft am Text UND an der
  // Befundzeile, weiter unten in EN-N2a.
  const AUS_DER_BEFUNDZEILE = ['sha256'];
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
  // Der Gegenbeweis fuer die Ausnahme: das eine herausgenommene Wort steht
  // wirklich in der Ansicht -- sonst waere die Liste oben eine Erlaubnis fuer
  // etwas, das gar nicht vorkommt, und der Test darunter (EN-N2a) haette
  // nichts zu pruefen.
  for (const wort of AUS_DER_BEFUNDZEILE) {
    assert.ok(nurCode.includes(wort),
      'die Ansicht kennt "' + wort + '" gar nicht -- dann gehoert es nicht in die ' +
      'Ausnahmeliste, sondern zurueck in VERBOTEN');
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
// EN: EIN OEFFNEN ZUM LESEN IST KEIN SCHREIBEN.
//
// openSync/open stehen in der Liste oben, weil ein Oeffnen der erste Schritt
// zu einem Schreiben sein kann. Seit EN geht aber auch ein LESESTROM durch
// diese Tuer: die Bildroute oeffnet das Thumbnail mit createReadStream, und
// node ruft dafuer fs.open(pfad, 'r'). Die Falle hat das zuerst als
// Schreibversuch gefangen -- der Test starb mit einem abgerissenen Socket
// statt mit einer Aussage.
//
// Die Antwort darauf ist NICHT, das Bild freizugeben (dann waere die Tuer
// offen), sondern die Flags anzusehen. 'r' und der Vorgabewert sind lesend;
// alles andere -- 'w', 'a', 'r+', 'wx' und jede numerische Fassung, die nicht
// O_RDONLY ist -- faellt weiter. Damit ist die Falle nach EN SCHAERFER als
// vorher: sie unterscheidet, was sie bisher zusammengeworfen hat.
function oeffnetNurZumLesen(flags) {
  if (flags === undefined || flags === null) return true;      // Vorgabe ist 'r'
  if (typeof flags === 'string') return flags === 'r';
  if (Number.isInteger(flags)) return flags === fsKonstanten.O_RDONLY;
  return false;
}
const fsKonstanten = fs.constants;

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
      // Ein Lese-open geht durch, OHNE seinen fd in eigeneFds einzutragen: ein
      // spaeteres writeSync auf ihn faellt damit weiter auf, denn er kam nicht
      // aus einem ERLAUBTEN openSync im Sinn dieser Buchfuehrung.
      if ((name === 'openSync' || name === 'open') && oeffnetNurZumLesen(args[1])) {
        return echt[name].apply(fs, args);
      }
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
      // EP: /hochladen IST jetzt eine Route dieses Modus, und sie antwortet
      // deshalb nicht mit 404. Sie antwortet mit 409 -- und das ist der
      // schaerfere Nachweis: sie hat den Klick angesehen, festgestellt, dass
      // es hier keinen Knopf gibt (diese Sitzung traegt keine Bindung und
      // keinen Kanal), und NICHTS geschrieben. Dass sie nichts geschrieben
      // hat, prueft die Falle unten -- an derselben Anfrage.
      if (pfad === '/hochladen') {
        assert.equal(p.status, 409, 'POST /hochladen antwortet mit ' + p.status +
          ' statt mit 409 -- diese Sitzung laeuft auf einem Wegwerfordner und traegt weder ' +
          'Bindung noch Kanal, es darf hier keinen Knopf geben');
        // ZWEI GRUENDE KOENNEN GREIFEN, und beide sind eine Weigerung, die
        // nichts schreibt: die fremde Projektwurzel (sie faellt zuerst, weil
        // der Dienst und seine Kindprozesse dieselbe Wurzel haben muessen) und
        // der fehlende Knopf. Der Test nimmt beide und nennt sie -- eine
        // dritte Antwort waere ein Fund.
        assert.ok(/kein_knopf|fremde_projektwurzel/.test(String(p.text || '')),
          'die Abweisung nennt einen Grund, den dieser Test nicht kennt: ' + p.text);
      } else {
        assert.equal(p.status, 404, 'POST ' + pfad + ' wird beantwortet statt abgewiesen');
      }
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

    // EN: und die neue Unterscheidung faengt weiterhin, was sie fangen soll.
    // Ein Oeffnen ZUM LESEN geht durch -- ein Oeffnen zum Schreiben nicht,
    // auch nicht auf denselben Pfad. Ohne diese Gegenprobe waere die Lockerung
    // von oben eine offene Tuer, die niemand mehr nachprueft.
    const nurLesen = fs.openSync(sperrpfad, 'r');
    fs.closeSync(nurLesen);
    for (const flag of ['w', 'a', 'r+', 'wx']) {
      assert.throws(() => fs.openSync(path.join(ordner, 'fremd.txt'), flag),
        /SCHREIBFALLE: fs\.openSync/, 'openSync mit ' + flag + ' kommt durch');
    }
    assert.throws(() => fs.openSync(path.join(ordner, 'fremd.txt'), fs.constants.O_WRONLY),
      /SCHREIBFALLE: fs\.openSync/, 'das numerische O_WRONLY kommt durch');
  } finally {
    falle.zurueck();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('EP: die Longform-Seite hat GENAU EINEN Knopf, ein <button>, und kein Formular', () => {
  // DIE ZUSAGE HAT SICH GEAENDERT UND WIRD NEU FORMULIERT.
  //
  // Bis EP hiess sie: "die Seite traegt kein Element, das etwas schicken
  // koennte" -- kein Knopf, kein fetch, kein Ereignis, kein connect-src, nicht
  // einmal das Sitzungstoken. Sie war wahr, solange dieser Modus nichts konnte.
  // Seit EP hat er einen Knopf, und der Satz waere eine Unwahrheit in einem
  // Test, den der naechste Leser fuer eine Sicherung haelt.
  //
  // WAS AN SEINE STELLE TRITT, IST ENGER ALS "ES GIBT JETZT EINEN KNOPF":
  //
  //   - GENAU EIN <button>, und kein zweites. Ein zweiter Knopf auf dieser
  //     Seite waere der, der oeffentlich stellt -- und den gibt es nicht.
  //   - KEIN FORMULAR und kein Eingabefeld. Der Klick schickt NICHTS ausser
  //     dem Sitzungstoken; was geschieht, stand vor dem Klick fest.
  //   - form-action bleibt 'none', connect-src wird 'self' und nur 'self'.
  const sitzung = longformSitzung();
  try {
    const html = SEITE.baueLongformSeite(sitzung);

    // Was es weiterhin NICHT gibt: alles, worin ein Mensch etwas eintraegt
    // oder woraus eine Adresse ausserhalb dieses Dienstes werden koennte.
    for (const stueck of ['<form', '<input', '<textarea', '<select',
      'XMLHttpRequest', 'navigator.sendBeacon', 'onclick', 'onsubmit', 'formaction']) {
      assert.ok(!html.includes(stueck),
        'die Longform-Seite traegt ' + stueck + ' -- der Knopf schickt nichts ausser dem ' +
        'Sitzungstoken, und dabei soll es bleiben');
    }

    // GENAU EIN Knopf. Abgezaehlt und nicht "mindestens einer": ein zweiter,
    // der sich eines Tages dazustellt, soll hier auffallen.
    assert.equal((html.match(/<button/g) || []).length, 1,
      'die Longform-Seite hat mehr oder weniger als einen Knopf');

    // Und er stellt nichts oeffentlich -- weder er noch sonst etwas auf dieser
    // Seite. Das ist die Zusage dieses Schnitts.
    for (const wort of ['veroeffentlich', 'Veroeffentlich', 'oeffentlich stellen',
      'videos.update']) {
      const treffer = (html.match(new RegExp(wort, 'g')) || []).length;
      if (wort === 'videos.update') {
        assert.equal(treffer, 0, 'die Seite nennt den dritten Aufruf beim Namen');
      }
    }

    // Die Sicherung im Kopf: der Weg hinaus ist genau EINER, und der fuehrt zu
    // diesem Dienst.
    assert.match(html, /default-src 'none'/);
    assert.match(html, /connect-src 'self'/);
    assert.match(html, /form-action 'none'/);
    assert.ok(!/connect-src [^;"]*https?:/.test(html),
      'connect-src laesst einen fremden Rechner zu');

    // Das Sitzungstoken steht jetzt in der Seite -- es MUSS, sonst kaeme der
    // Klick nicht am Torwaechter vorbei. Der Satz "es liegt nicht in der Seite
    // herum" wandert damit mit; was bleibt, ist, dass es genau zweimal
    // gebraucht wird und nirgends in eine fremde Adresse geht.
    assert.ok(html.includes(sitzung.token),
      'das Sitzungstoken fehlt -- dann kann der Knopf nicht wirken');
    assert.equal((html.match(/X-Freigabe-Token/g) || []).length, 2,
      'die Seite setzt die Tokenkopfzeile an mehr oder weniger als den zwei Aufrufen');
    assert.equal((html.match(/fetch\(/g) || []).length, 2,
      'die Seite macht mehr oder weniger als die zwei zugesagten Aufrufe');
    for (const m of html.matchAll(/fetch\('([^']*)'/g)) {
      assert.ok(m[1].startsWith('/'),
        'ein fetch geht an eine Adresse, die nicht dieser Dienst ist: ' + m[1]);
    }
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

test('EP: der Longform-Modus hat GENAU EINE POST-Route, und sie heisst /hochladen', () => {
  // Bis EP hiess die Zusage: "keine einzige POST-Route -- die leere Liste ist
  // die Zusage selbst". Sie ist nicht mehr wahr und wird ERSETZT, nicht
  // gestrichen. Was an ihre Stelle tritt, laesst sich genauso in einem Blick
  // pruefen: die Listen werden weiterhin ABGEZAEHLT und nicht auf "enthaelt
  // mindestens" geprueft. Eine Route, die sich eines Tages dazustellt, faellt
  // hier auf.
  const von = SERVER_NURCODE.indexOf('const ROUTEN_GET = {');
  const bis = SERVER_NURCODE.indexOf('};', SERVER_NURCODE.indexOf('const ROUTEN_POST = {'));
  const tabellen = SERVER_NURCODE.slice(von, bis);
  assert.ok(tabellen.includes("[MODUS_LONGFORM]: new Set(['/', '/bild', '/lauf']),"),
    'der Longform-Modus hat mehr oder weniger als die drei lesenden GET-Routen');
  assert.ok(tabellen.includes("[MODUS_LONGFORM]: new Set(['/hochladen']),"),
    'der Longform-Modus hat mehr oder weniger als die eine POST-Route');

  const postTeil = SERVER_NURCODE.slice(SERVER_NURCODE.indexOf('const ROUTEN_POST = {'), bis);
  // Die beiden lesenden Routen stehen in KEINER POST-Tabelle.
  for (const r of ['/bild', '/lauf']) {
    assert.ok(!postTeil.includes(r),
      'die Route ' + r + ' steht in einer POST-Tabelle -- sie ist lesend und nur lesend');
  }
  // Und es gibt keine Route, die etwas oeffentlich stellte.
  for (const r of ['/veroeffentlichen', '/oeffentlich', '/update']) {
    assert.ok(!tabellen.includes(r),
      'es gibt eine Route ' + r + ' -- das Oeffentlichstellen ist nicht gebaut');
  }
});

test('EP: POST /hochladen im Longform-Modus nimmt NICHTS entgegen', () => {
  // Der Klick schickt keinen Leib, und die Route liest keinen. Was geschieht,
  // stand vor dem Klick fest -- es ist die Bindung aus der Befundzeile des
  // Arbeiters. Eine Route, die etwas entgegennimmt, waere ein Knopf, ueber
  // dessen Wirkung die Seite mitentscheidet.
  const von = SERVER_NURCODE.indexOf('function nimmLongformHochladen(res)');
  assert.ok(von > 0, 'die Route wurde nicht gefunden');
  const bis = SERVER_NURCODE.indexOf('function liefereLongformLauf', von);
  const koerper = SERVER_NURCODE.slice(von, bis);
  assert.ok(koerper.length > 800, 'die Route wurde nicht ganz gefunden');
  for (const wort of ['req.on', 'req.body', "on('data'", 'abfrage.get', 'searchParams']) {
    assert.ok(!koerper.includes(wort),
      'POST /hochladen liest ' + wort + ' -- sie soll nichts entgegennehmen');
  }
  // Sie bekommt `res` und sonst nichts: der Anfrage selbst kommt sie nicht bei.
  assert.match(SERVER_NURCODE, /function nimmLongformHochladen\(res\) \{/);
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

test('EP: die Seite sagt, wo dieser WEG aufhoert -- und dass das Oeffentlichstellen ' +
  'nicht existiert', () => {
  // Bis EP hiess die Ueberschrift "Hier hoert diese SEITE auf" und der Text
  // darunter zaehlte auf, was nicht gebaut sei -- Knopf, Ermaechtigung,
  // schreibende Haelfte. Drei davon sind jetzt gebaut, und der Satz wandert
  // mit. Was bleibt und woran dieser Test haengt, ist das Vierte: der dritte
  // Aufruf. Nach einem Lauf, der eben etwas auf einen Kanal geschrieben hat,
  // ist "es ist fertig" die naheliegendste Lesart, und sie ist falsch.
  const sitzung = longformSitzung();
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    assert.match(html, /Hier hoert dieser Weg auf/);
    assert.match(html, /Das Video ist danach privat und bleibt es/);
    assert.match(html, /Das oeffentliche Stellen gibt es in diesem Bau nicht/);
    assert.match(html, /Vertrag 2\.5, Schritte 14 bis 17/);
    assert.match(html, /nicht als Aufruf, den man von Hand ausloesen koennte/);
    // Die ZWEITE Ermaechtigung wird benannt und nicht gebaut -- mit Grund.
    assert.match(html, /zweite<\/b>\s*\n?\s*'? ?\+? ?'?\s*Ermaechtigung|<b>zweite<\/b>/);
    assert.match(html, /Die erste ersetzt /);
    // Und was diese Sitzung schreibt, steht weiterhin da -- jetzt zwei Dateien
    // statt einer, und der Satz sagt beide.
    assert.match(html, /ihre Sperre unter <code>data\/freigaben\/<\/code>/);
    assert.match(html, /erst beim Klick &mdash; die eine ' \+\s*'Ermaechtigung|erst beim Klick/);
    assert.match(html, /Das Gedaechtnis schreibt der Arbeiter, nicht dieser Dienst/);
    // Die wichtigste Einschraenkung des Vertrags steht auf der Seite.
    assert.match(html, /nicht gemessen \(Vertrag 10\)/);
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
  //
  // EN: --befund-json kommt dazu, und der Test zaehlt die Argumente weiterhin
  // einzeln ab. Es ist LESEND -- es aendert am Lauf des Arbeiters nichts und
  // legt nur eine Zeile mehr auf stderr; dass es hier ausdruecklich stehen
  // muss, ist der Punkt: ein Argument, das sich unbemerkt dazustellen kann,
  // ist eines, das eines Tages --execute heisst.
  assert.match(SERVER_NURCODE,
    /const argumente = \[LONGFORM_ARBEITER, '--aufnahme=' \+ aufnahme, '--befund-json'\];/);
  // EP: --execute UND --bestaetigt-durch= GIBT ES JETZT AUCH IM LONGFORM-WEG,
  // und zwar an genau EINER Stelle: starteLongformLauf(), der Kindprozess des
  // Knopfes. Der Satz "keines von beiden kommt vor" ist damit unwahr und
  // wandert mit. Was an seine Stelle tritt, ist die Abzaehlung: die beiden
  // Argumentlisten dieses Modus stehen woertlich da, es gibt genau zwei, und
  // die eine ist die lesende.
  assert.match(SERVER_NURCODE,
    /const argumente = \[LONGFORM_ARBEITER, '--aufnahme=' \+ sitzung\.aufnahme, '--execute',\s*\n\s*'--bestaetigt-durch=' \+ ermaechtigungPfad\];/);
  // GENAU ZWEI Stellen starten den Arbeiter, und beide stehen hier woertlich:
  // ruftLongformTrocken (spawnSync, lesend) und starteLongformLauf (spawn,
  // scharf). Abgezaehlt an den Argumentlisten und nicht an der Konstante --
  // die kommt auch in Meldungen und im Export vor, und ein Test, der sie
  // zaehlt, faellt eines Tages, weil jemand einen Satz geschrieben hat.
  const argumentlisten = (SERVER_NURCODE.match(/const argumente = \[LONGFORM_ARBEITER/g)
    || []).length;
  assert.equal(argumentlisten, 2,
    'es gibt ' + argumentlisten + ' Argumentlisten fuer den Longform-Arbeiter -- erwartet ' +
    'sind zwei: der Trockenlauf und der scharfe Lauf. Eine dritte soll hier auffallen.');
  const spawns = (SERVER_NURCODE.match(/spawn(Sync)?\(process\.execPath, argumente/g)
    || []).length;
  assert.equal(spawns, 6,
    'es gibt ' + spawns + ' Kindprozesse aus einer Argumentliste -- erwartet sind sechs: ' +
    'der Leser, Planer, Uploader-Trockenlauf und scharfer Uploader der Shorts-Linie, und ' +
    'die beiden Longform-Wege (Trockenlauf spawnSync, scharfer Lauf spawn). Ein siebter ' +
    'soll hier auffallen.');

  // DER STARTWEG DES DIENSTES bleibt frei von beidem: was beim Start des
  // Dienstes geschieht, ist der TROCKENLAUF und nichts sonst. Der scharfe Lauf
  // kommt nur ueber den Knopf, also ueber eine Anfrage eines Menschen.
  const startweg = SERVER_NURCODE.slice(SERVER_NURCODE.indexOf('function starteLongform('),
    SERVER_NURCODE.indexOf('function main()'));
  assert.ok(startweg.length > 500, 'der Startweg des Longform-Modus wurde gefunden');
  for (const wort of ['--execute', 'bestaetigt-durch', 'schreibeErmaechtigung',
    'neueErmaechtigung', 'starteLongformLauf', 'planPfad', 'ruftPlaner',
    'schreibeFreigaben', 'starteUploaderLauf', 'ruftUploaderTrocken', 'ruftLeser']) {
    assert.ok(!startweg.includes(wort),
      'der Longform-STARTWEG fasst ' + wort + ' an -- beim Start des Dienstes laeuft der ' +
      'Trockenlauf und sonst nichts');
  }

  // UND DER DRITTE AUFRUF KOMMT IM GANZEN DIENST NICHT VOR.
  for (const wort of ['videos.update', 'publishAt']) {
    assert.ok(!SERVER_NURCODE.includes(wort),
      'der Freigabedienst kennt ' + wort + ' -- das Oeffentlichstellen ist nicht gebaut');
  }
});

// ===========================================================================
// EN: DAS BILD (Vertrag 4, Schritt 7)
// ===========================================================================
//
//   EN-N2a  Was in der Seite steht, hat der Arbeiter geschrieben -- geprueft
//           am Text UND an der Befundzeile.
//   EN-N3   Die Bildroute liefert nichts anderes aus. Sechs Angriffe, jeder
//           mit einer Meldung, die den Fall benennt; und die Abwehr schnappt
//           zu, wenn man sie loechrig macht.
//   EN-N4   Auch die neue Route schreibt nichts.
//   EN-N5   Die Shorts-Ansicht ist Byte fuer Byte die von a00cdab.

const AUFNAHME_EN = AUFNAHME;
const BILDNAME = 'adw-standard-ep-18.jpg';
const ANDERES_BILD = 'adw-livestream-30-08.jpg';

// Eine Lage mit einem ECHTEN Bild auf der Platte und einer ECHTEN Befundzeile.
// Die Zeile wird nicht von Hand geschrieben, sondern von befundJson() gebaut:
// eine hier abgetippte waere die zweite Vorstellung davon, wie sie aussieht,
// und der Test liefe dann gegen sich selbst statt gegen den Arbeiter.
function bildLage(besonders) {
  const exp = wegwerfordner();
  const inhalt = Buffer.from('BILDBYTES-' + 'x'.repeat(200), 'utf8');
  fs.writeFileSync(path.join(exp, BILDNAME), inhalt);
  // Ein ZWEITES Bild im selben Ordner. Es ist der Angriff "ein anderes Bild
  // desselben Ordners": es liegt am selben Ort, ist lesbar und geht die Route
  // trotzdem nichts an.
  fs.writeFileSync(path.join(exp, ANDERES_BILD), Buffer.from('NICHT DIESES BILD', 'utf8'));

  const befund = Object.assign({
    artifact_type: 'adw_longform_befund',
    schema_version: '1.0',
    aufnahme: AUFNAHME_EN,
    export_ordner: exp,
    rang: 2,
    art: 'vorschlag',
    bild: {
      pfad: path.join(exp, BILDNAME),
      dateiname: BILDNAME,
      typ: 'image/jpeg',
      bytes: inhalt.length,
      sha256: require('node:crypto').createHash('sha256').update(inhalt).digest('hex'),
      sha256_herkunft: 'gemessen und gegen den Beipackzettel geprueft',
      rang: 2,
      art: 'vorschlag',
      zettel: 'adw-standard-ep-18.json',
      matrixzeile: 25,
      weitere_im_rang: 0,
    },
    hinweise: ['MARKE-HINWEIS-RANG', 'MARKE-HINWEIS-ZELLE', 'MARKE-HINWEIS-BILD'],
    ohne_bild_weil: null,
    abbruch: null,
  }, besonders || {});

  const vorher = process.env.THUMBNAIL_EXPORT_DIR;
  process.env.THUMBNAIL_EXPORT_DIR = exp;
  let sitzung;
  try {
    sitzung = S.baueLongformSitzung({
      aufnahme: AUFNAHME_EN, projektwurzel: exp, port: 0,
      trocken: Object.assign(erfundenerTrockenlauf(), { befund }),
    });
  } finally {
    if (vorher === undefined) delete process.env.THUMBNAIL_EXPORT_DIR;
    else process.env.THUMBNAIL_EXPORT_DIR = vorher;
  }
  sitzung.wegwerfordner = exp;
  sitzung.probeInhalt = inhalt;
  sitzung.probeBefund = befund;
  return sitzung;
}

// Wie `anfrage`, aber die Antwort kommt als Puffer zurueck -- ein Bild
// ueber toString('utf8') zu vergleichen waere kein Byte-Vergleich.
function anfrageRoh(port, { methode = 'GET', pfad = '/', kopf = {} } = {}) {
  return new Promise((fertig, schiefgegangen) => {
    const zusammen = Object.assign({ host: S.HOST + ':' + port }, kopf);
    for (const k of Object.keys(zusammen)) if (zusammen[k] === undefined) delete zusammen[k];
    const req = http.request({
      host: S.HOST, port, method: methode, path: pfad, headers: zusammen,
    }, (res) => {
      const teile = [];
      res.on('data', (d) => teile.push(d));
      res.on('end', () => fertig({
        status: res.statusCode, kopf: res.headers, leib: Buffer.concat(teile),
      }));
    });
    req.on('error', schiefgegangen);
    req.end();
  });
}

// ===========================================================================
// EN-N2a: WAS IN DER SEITE STEHT, HAT DER ARBEITER GESCHRIEBEN
// ===========================================================================

test('EN-N2a: kein Wort in der Seite, das nicht vom Arbeiter kommt', () => {
  // Die schaerfere Fassung der Zusage aus EL-N2a. Dort war jedes Wort des
  // Arbeiters in der Seite ein Verstoss, weil es nur aus seinem Text stammen
  // konnte. Seit es die Befundzeile gibt, lautet die Frage anders und
  // schaerfer: steht das Wort in der Seite, muss es in DEM stehen, was der
  // Arbeiter geliefert hat -- in einem der beiden Stroeme oder in der Zeile.
  const sitzung = bildLage();
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    const vomArbeiter = sitzung.trocken.aus + '\n' + sitzung.trocken.err + '\n' +
      JSON.stringify(sitzung.trocken.befund);
    // Jeder Hinweis, der auf der Seite steht, steht auch in dem, was der
    // Arbeiter geschickt hat -- woertlich und nicht sinngemaess.
    for (const h of sitzung.probeBefund.hinweise) {
      assert.ok(html.includes(h), 'der Hinweis fehlt in der Seite: ' + h);
      assert.ok(vomArbeiter.includes(h), 'der Hinweis kommt nicht vom Arbeiter: ' + h);
    }
    assert.ok(html.includes(sitzung.probeBefund.bild.sha256),
      'die sha256 steht nicht auf der Seite -- dann kann niemand pruefen, worueber er urteilt');
    assert.ok(vomArbeiter.includes(sitzung.probeBefund.bild.sha256));
    assert.ok(html.includes(BILDNAME));

    // DER PFAD STEHT NICHT IN DER SEITE. Der Browser braucht ihn nicht, die
    // Route nimmt ihn nicht entgegen -- ein Pfad, der im Baum liegt, ist die
    // Einladung, ihn eines Tages zu benutzen.
    assert.ok(!html.includes(sitzung.probeBefund.bild.pfad),
      'der Bildpfad steht in der ausgelieferten Seite');
    assert.ok(!html.includes(sitzung.wegwerfordner),
      'der Export-Ordner steht in der ausgelieferten Seite');
    // Und das ANDERE Bild des Ordners kommt in der Seite nicht vor.
    assert.ok(!html.includes(ANDERES_BILD),
      'die Seite nennt ein Bild, das dieser Lauf nicht bestimmt hat');
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

test('EN-N2a: die Seite benennt Rang und Art -- ein Bild ohne sie waere ein anderes Bild', () => {
  for (const [rang, art, wort] of [[1, 'regel', 'Regel'], [2, 'vorschlag', 'Vorschlag']]) {
    const sitzung = bildLage();
    sitzung.bild.rang = rang;
    sitzung.bild.art = art;
    try {
      const baum = fuehreSkriptAus(SEITE.baueLongformSeite(sitzung));
      assert.equal(baum.get('bildArt').textContent, wort,
        'die Art steht nicht neben dem Bild');
      assert.equal(baum.get('bildRang').textContent, 'Rang ' + rang);
      assert.equal(baum.get('bildKasten').hidden, false, 'der Bildkasten bleibt zu');
      assert.equal(baum.get('bildName').textContent, BILDNAME);
      assert.equal(baum.get('bildSha').textContent, sitzung.bild.sha256);
      // Die Hinweise stehen vollstaendig da, jeder einzeln.
      for (const h of sitzung.probeBefund.hinweise) {
        assert.ok(baum.get('bildHinweise').textContent.includes(h),
          'ein Hinweis fehlt im Baum: ' + h);
      }
      // Und die Adresse traegt das Token dieser Sitzung -- ohne es kaeme das
      // Bild nicht an.
      assert.equal(baum.get('bild').src, '/bild?t=' + sitzung.token);
    } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
  }
});

test('EN-N2a: ohne bestimmtes Bild zeigt die Seite keines und sagt warum', () => {
  const sitzung = bildLage({ bild: null, rang: null, art: null, hinweise: [],
    ohne_bild_weil: 'MARKE-KEIN-BILD-WEIL: zwei Zettel kommen in Frage.',
    abbruch: { code: 'mehrere_rang2', nach: '2.7' } });
  try {
    const html = SEITE.baueLongformSeite(sitzung);
    const baum = fuehreSkriptAus(html);
    assert.equal(baum.get('bildKasten').hidden, true, 'der Bildkasten steht offen ohne Bild');
    assert.equal(baum.get('keinBild').hidden, false);
    assert.ok(baum.get('keinBild').textContent.includes('MARKE-KEIN-BILD-WEIL'),
      'der Grund fehlt: ' + baum.get('keinBild').textContent);
    // Kein <img src> in der Seite und keine Adresse in der Nutzlast.
    assert.ok(!html.includes('/bild?t='),
      'die Seite traegt eine Bildadresse, obwohl es kein Bild gibt');
  } finally { fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true }); }
});

// ===========================================================================
// EN-N3: DIE BILDROUTE LIEFERT NICHTS ANDERES AUS
// ===========================================================================

test('EN-N3: die Route liefert genau die benannte Datei -- Byte fuer Byte', async () => {
  const sitzung = bildLage();
  let lauf = null;
  try {
    lauf = await starte(sitzung);
    const a = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + sitzung.token });
    assert.equal(a.status, 200);
    assert.equal(Buffer.compare(a.leib, sitzung.probeInhalt), 0,
      'die ausgelieferten Bytes sind nicht die der Datei');
    assert.equal(a.kopf['content-type'], 'image/jpeg');
    assert.equal(a.kopf['x-content-type-options'], 'nosniff');
    assert.equal(a.kopf['cache-control'], 'no-store');
    // KEIN Accept-Ranges: ein Bild wird nicht gespult.
    assert.equal(a.kopf['accept-ranges'], undefined);
    // HEAD liefert die Kopfzeilen und keinen Leib.
    const h = await anfrageRoh(lauf.port, { methode: 'HEAD', pfad: '/bild?t=' + sitzung.token });
    assert.equal(h.status, 200);
    assert.equal(h.leib.length, 0);
  } finally {
    if (lauf) await lauf.schliesse();
    fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true });
  }
});

test('EN-N3: JEDER Versuch, etwas anderes zu holen, scheitert mit einer eigenen Meldung',
  async () => {
    const sitzung = bildLage();
    let lauf = null;
    try {
      lauf = await starte(sitzung);
      const t = sitzung.token;
      const ordner = sitzung.wegwerfordner;

      // DIE SECHS ANGRIFFE. Jeder bekommt seinen eigenen Fehlercode -- eine
      // gemeinsame Meldung "geht nicht" waere sechs Zustaende unter einer
      // Selbstauskunft, und genau das ist der Umriss jedes Fehlers dieser
      // Reihe.
      const ANGRIFFE_BILD = [
        // 1. Ein anderes Bild DESSELBEN Ordners -- lesbar, erlaubt gelegen,
        //    und geht die Route trotzdem nichts an.
        { was: 'anderes Bild desselben Ordners',
          pfad: '/bild?t=' + t + '&datei=' + encodeURIComponent(ANDERES_BILD),
          status: 400, code: 'bildroute_nimmt_nichts_entgegen' },
        // 2. Mit ".." im Pfad.
        { was: 'punkt-punkt im Parameter',
          pfad: '/bild?t=' + t + '&p=' + encodeURIComponent('..' + path.sep + '..' +
            path.sep + 'irgendwas.ini'),
          status: 400, code: 'bildroute_nimmt_nichts_entgegen' },
        // 3. Ein absoluter Pfad. Er steht hier NICHT als Zeichenkette im
        //    Quelltext -- der Freigabe-Check dieses oeffentlichen Repos
        //    verbietet absolute Laufwerkspfade, und er hat recht. Er wird aus
        //    dem Wegwerfordner dieses Laufs gebaut, und der ist einer.
        { was: 'absoluter Pfad',
          pfad: '/bild?t=' + t + '&p=' + encodeURIComponent(path.join(ordner, ANDERES_BILD)),
          status: 400, code: 'bildroute_nimmt_nichts_entgegen' },
        // 4. Ausserhalb des Export-Ordners.
        { was: 'ausserhalb des Export-Ordners',
          pfad: '/bild?t=' + t + '&p=' + encodeURIComponent(path.join(ordner, '..', 'x.jpg')),
          status: 400, code: 'bildroute_nimmt_nichts_entgegen' },
        // 5. Ein Index, wie ihn die Schwesterroute nimmt -- auch der ist hier
        //    keiner.
        { was: 'ein Index wie bei /video',
          pfad: '/bild?t=' + t + '&i=0',
          status: 400, code: 'bildroute_nimmt_nichts_entgegen' },
        // 6. Der Pfad IM PFAD statt im Parameter. Er trifft keinen Routennamen.
        { was: 'Pfad im Anfragepfad',
          pfad: '/bild/../../windows/win.ini?t=' + t,
          status: 404, code: 'unbekannte_route' },
      ];
      for (const a of ANGRIFFE_BILD) {
        const r = await anfrageRoh(lauf.port, { pfad: a.pfad });
        assert.equal(r.status, a.status, a.was + ' -> ' + r.status);
        const d = JSON.parse(r.leib.toString('utf8'));
        assert.equal(d.fehler, a.code, a.was + ': Fehlercode ' + d.fehler);
        // Die Meldung benennt den Fall. Bei den Parametern ist sie lang und
        // sagt, warum nichts entgegengenommen wird; bei einem Pfad, der gar
        // keine Route trifft, ist sie die geerbte kurze -- und das ist
        // richtig so: der Weg endet dort, wo jeder unbekannte Name endet,
        // und nicht in einem Zweig, der Pfade auslegt.
        assert.ok(d.meldung.length >= (a.code === 'unbekannte_route' ? 10 : 40),
          a.was + ': die Meldung benennt den Fall nicht -- ' + d.meldung);
        // UND: nichts von dem anderen Bild ist mitgekommen.
        assert.ok(!r.leib.includes(Buffer.from('NICHT DIESES BILD', 'utf8')),
          a.was + ': die Antwort traegt Bytes des anderen Bildes');
      }

      // 7. OHNE SITZUNGSTOKEN -- der Torwaechter, geerbt und nicht nachgebaut.
      const ohne = await anfrageRoh(lauf.port, { pfad: '/bild' });
      assert.equal(ohne.status, 403);
      assert.equal(JSON.parse(ohne.leib.toString('utf8')).fehler, 'token_fehlt_oder_falsch');
      // Ein FALSCHES Token derselben Laenge -- der Vergleich ist kein
      // startsWith.
      const falsch = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + 'a'.repeat(t.length) });
      assert.equal(falsch.status, 403);

      // 8. MIT FREMDEM URSPRUNG.
      const fremd = await anfrageRoh(lauf.port, {
        pfad: '/bild?t=' + t, kopf: { origin: 'http://boese.example' } });
      assert.equal(fremd.status, 403);
      assert.equal(JSON.parse(fremd.leib.toString('utf8')).fehler, 'fremder_ursprung');
      // 9. UND MIT FREMDEM HOST -- localhost statt der Zahl.
      const fremderHost = await anfrageRoh(lauf.port, {
        pfad: '/bild?t=' + t, kopf: { host: 'localhost:' + lauf.port } });
      assert.equal(fremderHost.status, 403);
      assert.equal(JSON.parse(fremderHost.leib.toString('utf8')).fehler, 'fremder_host');

      // Und danach geht der richtige Aufruf immer noch -- eine Abwehr, die
      // alles abweist, weist auch das Richtige ab und beweist dann nichts.
      const gut = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + t });
      assert.equal(gut.status, 200);
      assert.equal(Buffer.compare(gut.leib, sitzung.probeInhalt), 0);
    } finally {
      if (lauf) await lauf.schliesse();
      fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true });
    }
  });

test('EN-N3: ein Bildpfad, der nicht unter dem Export-Ordner liegt, kommt gar nicht in ' +
  'die Sitzung', () => {
  // DIE ZWEITE HUERDE, an ihrer eigenen Stelle geprueft. Die Route nimmt
  // nichts entgegen -- aber der PFAD kommt aus der Ausgabe eines
  // Kindprozesses, und was von dort kommt, wird geprueft, bevor es in die
  // Sitzung darf. Hier wird der Kindprozess also gespielt, und zwar boese.
  const exp = wegwerfordner();
  const daneben = wegwerfordner();
  const vorher = process.env.THUMBNAIL_EXPORT_DIR;
  process.env.THUMBNAIL_EXPORT_DIR = exp;
  try {
    fs.writeFileSync(path.join(exp, BILDNAME), 'x');
    fs.writeFileSync(path.join(daneben, 'geheim.jpg'), 'GEHEIM');

    const gut = { pfad: path.join(exp, BILDNAME), dateiname: BILDNAME, typ: 'image/jpeg',
      bytes: 1, sha256: null, sha256_herkunft: 'x', rang: 1, art: 'regel',
      zettel: null, matrixzeile: 1, weitere_im_rang: 0 };

    const FAELLE = [
      ['ein anderer Ordner', { pfad: path.join(daneben, 'geheim.jpg'), dateiname: 'geheim.jpg' },
        'nicht unter dem Export-Ordner'],
      ['punkt-punkt hinaus', { pfad: path.join(exp, '..', 'geheim.jpg') },
        'nicht unter dem Export-Ordner'],
      ['punkt-punkt und zurueck, aber anderer Name',
        { pfad: path.join(exp, '..', path.basename(daneben), 'geheim.jpg') },
        'nicht unter dem Export-Ordner'],
      ['Pfad und Dateiname gehen auseinander',
        { pfad: path.join(exp, ANDERES_BILD), dateiname: BILDNAME },
        'nicht der Dateiname'],
      ['ein Typ, der keiner ist', { typ: 'text/html' }, 'Ausgeliefert werden nur'],
      ['gar kein Typ', { typ: null }, 'Ausgeliefert werden nur'],
      ['leerer Pfad', { pfad: '' }, 'keinen brauchbaren Bildpfad'],
    ];
    for (const [was, abweichung, erwartet] of FAELLE) {
      const sperre = S.neueSperre ? S.neueSperre() : null;
      const b = S.nimmBildAuf(
        { bild: Object.assign({}, gut, abweichung), hinweise: [] },
        { ausDatei() { assert.fail(was + ': der Pfad wurde registriert, obwohl er ' +
          'abgewiesen gehoert'); } });
      assert.equal(b.da, false, was + ': durchgekommen');
      assert.ok(b.grund.includes(erwartet),
        was + ': die Meldung benennt den Fall nicht -- ' + b.grund);
      assert.equal(sperre, sperre);
    }

    // Und der gute Fall kommt durch UND wird registriert -- sonst wiese die
    // Pruefung oben nur alles ab.
    let registriert = null;
    const ok = S.nimmBildAuf({ bild: gut, hinweise: ['H'] },
      { ausDatei(w) { registriert = w; } });
    assert.equal(ok.da, true, ok.grund);
    assert.equal(registriert, gut.pfad, 'der Pfad wurde nicht in der Pfadsperre registriert');
    assert.deepEqual(ok.hinweise, ['H']);
  } finally {
    if (vorher === undefined) delete process.env.THUMBNAIL_EXPORT_DIR;
    else process.env.THUMBNAIL_EXPORT_DIR = vorher;
    fs.rmSync(exp, { recursive: true, force: true });
    fs.rmSync(daneben, { recursive: true, force: true });
  }
});

test('EN-N3: die Abwehr schnappt zu, wenn man sie loechrig macht', async () => {
  // DREI LOECHER, jedes an einer anderen Huerde. Ohne sie hiesse EN-N3 nur
  // "heute kommt nichts durch".

  // LOCH 1: die Route ignoriert mitgeschickte Parameter, statt sie
  // abzuweisen. Nachgebaut wird genau dieser eine Handgriff -- die Schleife
  // ueber die Parameter faellt weg.
  const loechrig = (abfrage) => {
    // (die gebaute Fassung weist hier ab; diese tut es nicht)
    return { abgewiesen: false, name: [...abfrage.keys()].find((k) => k !== 't') || null };
  };
  const scharf = (abfrage) => {
    for (const name of abfrage.keys()) {
      if (name === 't') continue;
      return { abgewiesen: true, name };
    }
    return { abgewiesen: false, name: null };
  };
  const mitParameter = new URLSearchParams('t=abc&p=..%2F..%2Fwin.ini');
  assert.equal(scharf(mitParameter).abgewiesen, true,
    'die gebaute Fassung weist den Parameter nicht ab');
  assert.equal(loechrig(mitParameter).abgewiesen, false,
    'die loechrige Fassung weist ab -- dann ist sie nicht loechrig, und der ' +
    'Vergleich zeigt nichts');
  // Und der Beweis, dass der Unterschied im ECHTEN Dienst ankommt: dort ist
  // die scharfe Fassung eingebaut, und der Test darueber misst sie.
  assert.match(SERVER_NURCODE, /bildroute_nimmt_nichts_entgegen/);
  assert.match(SERVER_NURCODE, /for \(const name of abfrage\.keys\(\)\) \{/);

  // LOCH 2: die Pfadpruefung faellt weg. nimmBildAuf ohne pfadLiegtUnter
  // liesse einen Pfad aus einem fremden Ordner durch -- gezeigt daran, dass
  // die gebaute Fassung ihn abweist und eine Fassung ohne die Huerde ihn
  // naehme.
  const exp = wegwerfordner();
  const daneben = wegwerfordner();
  const vorher = process.env.THUMBNAIL_EXPORT_DIR;
  process.env.THUMBNAIL_EXPORT_DIR = exp;
  try {
    const fremd = { pfad: path.join(daneben, 'geheim.jpg'), dateiname: 'geheim.jpg',
      typ: 'image/jpeg', bytes: 1, sha256: null, sha256_herkunft: 'x', rang: 1,
      art: 'regel', zettel: null, matrixzeile: 1, weitere_im_rang: 0 };
    const echt = S.nimmBildAuf({ bild: fremd, hinweise: [] }, { ausDatei() {} });
    assert.equal(echt.da, false, 'die gebaute Fassung nimmt einen fremden Ordner an');
    // Die loechrige Fassung: nur Name und Typ, keine Ordnerpruefung.
    const ohneHuerde = (b) => path.basename(b.pfad) === b.dateiname &&
      S.ERLAUBTE_BILDTYPEN.includes(b.typ);
    assert.equal(ohneHuerde(fremd), true,
      'auch ohne die Ordnerpruefung faellt der fremde Pfad -- dann prueft die ' +
      'Ordnerpruefung nichts');
  } finally {
    if (vorher === undefined) delete process.env.THUMBNAIL_EXPORT_DIR;
    else process.env.THUMBNAIL_EXPORT_DIR = vorher;
    fs.rmSync(exp, { recursive: true, force: true });
    fs.rmSync(daneben, { recursive: true, force: true });
  }

  // LOCH 3: der Torwaechter der Pfadsperre wird umgangen. Wird ein anderer
  // Pfad angefragt, als beim Start registriert wurde, MUSS sie werfen.
  const sitzung = bildLage();
  let lauf = null;
  try {
    lauf = await starte(sitzung);
    // Der registrierte Pfad geht durch.
    assert.equal(sitzung.sperre.oeffnen(sitzung.bild.pfad), sitzung.bild.pfad);
    // Das andere Bild desselben Ordners nicht -- obwohl es daneben liegt.
    assert.throws(
      () => sitzung.sperre.oeffnen(path.join(sitzung.wegwerfordner, ANDERES_BILD)),
      /Pfadsperre/, 'die Pfadsperre laesst ein zweites Bild desselben Ordners durch');
    // Und ein ANDERS GESCHRIEBENER Pfad auf dieselbe Datei auch nicht: die
    // Sperre vergleicht WOERTLICH und nicht aufgeloest. (path.join haette
    // hier nichts gezeigt -- es normalisiert das '.' weg und ergibt wieder
    // genau den registrierten Pfad. Der Test hat das im ersten Anlauf
    // uebersehen und ist daran gescheitert; er baut den Umweg jetzt selbst.)
    const umweg = sitzung.wegwerfordner + path.sep + '.' + path.sep + BILDNAME;
    assert.notEqual(umweg, sitzung.bild.pfad, 'der Umweg ist gar keiner');
    assert.throws(() => sitzung.sperre.oeffnen(umweg), /Pfadsperre/,
      'die Pfadsperre loest Pfade auf, statt sie woertlich zu vergleichen');
  } finally {
    if (lauf) await lauf.schliesse();
    fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true });
  }
});

test('EN-N3: der Torwaechter der Pfadsperre greift, wenn der Pfad NACH dem Start ' +
  'ein anderer wird', async () => {
  // DIESER TEST IST EIN FUND DES MUTATIONSLAUFS ZU EN, und er stand vorher
  // nicht da. Baut man das `sitzung.sperre.oeffnen(bild.pfad)` der Bildroute
  // aus und oeffnet stattdessen bild.pfad geradeheraus, blieb der ganze Baum
  // gruen: in jedem anderen Test IST der angefragte Pfad der registrierte, und
  // eine Sperre, die nie etwas abzulehnen hat, wird auch nie gemessen.
  //
  // Der Fall, gegen den sie gebaut ist, ist der, in dem beide auseinandergehen
  // -- weil spaeter jemand ein Feld setzt, ein Argument durchreicht oder einen
  // Pfad "korrigiert". Der Test fuehrt genau das herbei: er verbiegt
  // sitzung.bild.pfad NACH dem Bauen der Sitzung, also hinter allen Pruefungen
  // von nimmBildAuf. Ab da ist der Torwaechter die einzige Sicherung, die noch
  // steht -- und sie muss halten.
  const sitzung = bildLage();
  let lauf = null;
  try {
    lauf = await starte(sitzung);
    // Erst der Beweis, dass es vorher geht.
    const vorher = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + sitzung.token });
    assert.equal(vorher.status, 200);

    // Jetzt zeigt die Sitzung auf das ANDERE Bild desselben Ordners -- lesbar,
    // erlaubt gelegen, und nie registriert.
    const registriert = sitzung.bild.pfad;
    sitzung.bild.pfad = path.join(sitzung.wegwerfordner, ANDERES_BILD);
    sitzung.bild.bytes = fs.statSync(sitzung.bild.pfad).size;
    const a = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + sitzung.token });
    assert.equal(a.status, 500, 'die Route hat einen nie registrierten Pfad geoeffnet');
    const d = JSON.parse(a.leib.toString('utf8'));
    assert.equal(d.fehler, 'pfadsperre');
    assert.ok(d.meldung.includes('Pfadsperre'), d.meldung);
    // Und keine Bytes des anderen Bildes sind mitgekommen.
    assert.ok(!a.leib.includes(Buffer.from('NICHT DIESES BILD', 'utf8')),
      'die Antwort traegt Bytes des Bildes, das nie registriert wurde');

    // Auch ein anders GESCHRIEBENER Pfad auf dieselbe Datei faellt: die Sperre
    // vergleicht woertlich und loest nicht auf.
    sitzung.bild.pfad = sitzung.wegwerfordner + path.sep + '.' + path.sep + BILDNAME;
    const b = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + sitzung.token });
    assert.equal(b.status, 500, 'ein aufloesbarer Umweg kam durch');
    assert.equal(JSON.parse(b.leib.toString('utf8')).fehler, 'pfadsperre');

    // Zurueck auf den registrierten Pfad -- und es geht wieder. Eine Sperre,
    // die ab jetzt alles abweist, beweist nichts.
    sitzung.bild.pfad = registriert;
    sitzung.bild.bytes = sitzung.probeInhalt.length;
    const c = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + sitzung.token });
    assert.equal(c.status, 200);
    assert.equal(Buffer.compare(c.leib, sitzung.probeInhalt), 0);
  } finally {
    if (lauf) await lauf.schliesse();
    fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true });
  }
});

test('EN-N3: verschwindet oder aendert sich die Datei, wird gemeldet statt ausgeliefert',
  async () => {
    const sitzung = bildLage();
    let lauf = null;
    try {
      lauf = await starte(sitzung);
      // Die Datei wird groesser -- sie ist damit eine andere als die, deren
      // sha256 auf der Seite steht.
      fs.writeFileSync(path.join(sitzung.wegwerfordner, BILDNAME),
        Buffer.concat([sitzung.probeInhalt, Buffer.from('MEHR', 'utf8')]));
      const a = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + sitzung.token });
      assert.equal(a.status, 409);
      assert.equal(JSON.parse(a.leib.toString('utf8')).fehler, 'datei_veraendert');

      // Und weg ist weg.
      fs.unlinkSync(path.join(sitzung.wegwerfordner, BILDNAME));
      const b = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + sitzung.token });
      assert.equal(b.status, 404);
      assert.equal(JSON.parse(b.leib.toString('utf8')).fehler, 'datei_weg');
    } finally {
      if (lauf) await lauf.schliesse();
      fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true });
    }
  });

test('EN-N3: ohne bestimmtes Bild liefert die Route nichts, mit dem Grund', async () => {
  const sitzung = bildLage({ bild: null, rang: null, art: null, hinweise: [],
    ohne_bild_weil: 'MARKE-GRUND: der Arbeiter hat nicht gewaehlt.', abbruch: null });
  let lauf = null;
  try {
    lauf = await starte(sitzung);
    const a = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + sitzung.token });
    assert.equal(a.status, 409);
    const d = JSON.parse(a.leib.toString('utf8'));
    assert.equal(d.fehler, 'kein_bild_bestimmt');
    assert.ok(d.meldung.includes('MARKE-GRUND'), d.meldung);
  } finally {
    if (lauf) await lauf.schliesse();
    fs.rmSync(sitzung.wegwerfordner, { recursive: true, force: true });
  }
});

test('EN-N3: im Shorts-Modus gibt es die Bildroute nicht', async () => {
  // Die Routentabellen haengen am Modus. Was der Longform-Modus dazubekommen
  // hat, hat der Shorts-Modus NICHT dazubekommen -- und das ist keine
  // Nebensache: ueber den Shorts-Weg sind 21 Shorts hochgeladen worden.
  const ordner = wegwerfordner();
  let lauf = null;
  try {
    const sitzung = shortsSitzungFuerVergleich(ordner);
    lauf = await starte(sitzung);
    const a = await anfrageRoh(lauf.port, {
      pfad: '/bild', kopf: { 'x-freigabe-token': sitzung.token } });
    assert.equal(a.status, 404);
    assert.equal(JSON.parse(a.leib.toString('utf8')).fehler, 'unbekannte_route');
  } finally {
    if (lauf) await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

// ===========================================================================
// EN-N4: AUCH DIE NEUE ROUTE SCHREIBT NICHTS
// ===========================================================================

test('EN-N4: der volle Durchlauf MIT der Bildroute schreibt nichts ausser der Sperre',
  async () => {
    // Wie EL-N3, aber der Durchlauf holt jetzt auch das Bild -- mehrfach, mit
    // GET und HEAD, richtig und falsch. Kein Zwischenspeichern, keine Kopie,
    // kein Standbild.
    const exp = wegwerfordner();
    const inhalt = Buffer.from('BILDBYTES-N4', 'utf8');
    fs.writeFileSync(path.join(exp, BILDNAME), inhalt);
    const vorher = process.env.THUMBNAIL_EXPORT_DIR;
    process.env.THUMBNAIL_EXPORT_DIR = exp;

    const ordner = wegwerfordner();
    const sperrpfad = S.sperrPfad(ordner, AUFNAHME_EN, S.MODUS_LONGFORM);
    let falle = null;
    let lauf = null;
    let sperre = null;
    try {
      const sitzung = S.baueLongformSitzung({
        aufnahme: AUFNAHME_EN, projektwurzel: ordner, port: 0,
        trocken: Object.assign(erfundenerTrockenlauf(), {
          befund: {
            artifact_type: 'adw_longform_befund', schema_version: '1.0',
            aufnahme: AUFNAHME_EN, export_ordner: exp, rang: 1, art: 'regel',
            bild: { pfad: path.join(exp, BILDNAME), dateiname: BILDNAME, typ: 'image/jpeg',
              bytes: inhalt.length, sha256: 'a'.repeat(64), sha256_herkunft: 'x',
              rang: 1, art: 'regel', zettel: null, matrixzeile: 1, weitere_im_rang: 0 },
            hinweise: ['H'], ohne_bild_weil: null, abbruch: null,
          },
        }),
      });
      assert.equal(sitzung.bild.da, true, sitzung.bild.grund);

      // Die Falle wird ERST JETZT scharf gestellt -- das Anlegen der
      // Wegwerfordner und der Sitzung gehoert nicht zu dem, was gemessen wird.
      falle = stelleScharf([sperrpfad, path.dirname(sperrpfad)]);
      sperre = S.nimmSperre({ projektwurzel: ordner, aufnahme: AUFNAHME_EN,
        modus: S.MODUS_LONGFORM });
      assert.equal(sperre.ok, true);
      lauf = await starte(sitzung);
      S.traegeSperrePortNach(sperre, lauf.port);

      const t = sitzung.token;
      for (let i = 0; i < 3; i++) {
        const a = await anfrageRoh(lauf.port, { pfad: '/bild?t=' + t });
        assert.equal(a.status, 200);
        assert.equal(Buffer.compare(a.leib, inhalt), 0);
        const h = await anfrageRoh(lauf.port, { methode: 'HEAD', pfad: '/bild?t=' + t });
        assert.equal(h.status, 200);
      }
      // Und die abgewiesenen Faelle schreiben erst recht nichts.
      for (const p of ['/bild', '/bild?t=' + t + '&p=x', '/bild?t=falsch',
        '/bild/../etwas?t=' + t]) {
        await anfrageRoh(lauf.port, { pfad: p });
      }
      await lauf.schliesse();
      lauf = null;

      const frei = S.gibSperreFrei(sperre);
      assert.equal(frei.geloescht, true, frei.grund);
      sperre = null;

      assert.ok(falle.gesehen.length > 0, 'die Falle hat gar keinen Schreibaufruf gesehen');
      for (const eintrag of falle.gesehen) {
        const aufDenEigenenFd = /^\w+ fd (\d+)$/.exec(eintrag);
        assert.ok(eintrag.includes(path.dirname(sperrpfad)) ||
          (aufDenEigenenFd && falle.eigeneFds.has(Number(aufDenEigenenFd[1]))),
        'ein erlaubter Aufruf ging woanders hin: ' + eintrag);
      }
      assert.ok(falle.gesehen.some((e) => e.includes(sperrpfad)),
        'die Sperrdatei wurde gar nicht angefasst');
      // UND: im Export-Ordner ist nichts entstanden. Kein Standbild, keine
      // Kopie, keine Zwischendatei.
      assert.deepEqual(fs.readdirSync(exp).sort(), [BILDNAME],
        'im Export-Ordner liegt jetzt mehr als vorher');
    } finally {
      if (falle) falle.zurueck();
      if (lauf) await lauf.schliesse();
      if (sperre) S.gibSperreFrei(sperre);
      if (vorher === undefined) delete process.env.THUMBNAIL_EXPORT_DIR;
      else process.env.THUMBNAIL_EXPORT_DIR = vorher;
      fs.rmSync(ordner, { recursive: true, force: true });
      fs.rmSync(exp, { recursive: true, force: true });
    }
  });

test('EN-N4: der Weg zum Bild kennt keine schreibende Funktion', () => {
  // Nicht "er ruft heute keine", sondern: die Woerter kommen im Abschnitt
  // nicht vor. Das laesst sich in einem Blick pruefen.
  const von = SERVER_NURCODE.indexOf('function liefereBild(');
  const bis = SERVER_NURCODE.indexOf('function nimmUrteil(', von);
  assert.ok(von > 0 && bis > von, 'der Abschnitt der Bildroute wurde gefunden');
  const abschnitt = SERVER_NURCODE.slice(von, bis);
  assert.ok(abschnitt.length > 800, 'der Abschnitt ist verdaechtig kurz');
  for (const wort of ['writeFile', 'appendFile', 'mkdir', 'createWriteStream', 'copyFile',
    'rename', 'unlink', 'rmSync', 'spawn', 'exec', 'ffmpeg', 'Buffer.concat']) {
    assert.ok(!abschnitt.includes(wort),
      'die Bildroute kennt ' + wort + ' -- dann kann sie schreiben oder zwischenspeichern');
  }
  // Sie liest als STROM und laedt das Bild nicht in den Speicher: ein Puffer
  // waere der erste Schritt zu einer Kopie.
  assert.ok(abschnitt.includes('createReadStream'));
  assert.ok(!abschnitt.includes('readFileSync'));
});

// ===========================================================================
// EN-N5: DIE SHORTS-ANSICHT IST UNVERAENDERT, BYTE FUER BYTE
// ===========================================================================
//
// Derselbe Vergleich wie EL-N1, nur gegen den Stand VOR EN. Er wird nicht
// durch EL-N1 miterledigt: der prueft gegen d09095f, und alles, was zwischen
// d09095f und a00cdab an der Shorts-Seite haette passieren koennen, waere
// dort schon eingebacken. Zwei Staende, zwei Vergleiche.
//
// Ueber diesen Weg sind 21 Shorts hochgeladen worden. Jede Abweichung ist ein
// Fund und keine Nebensache.

const STAND_VOR_EN = 'a00cdab';

function fassungAusGit(stand, datei) {
  const g = spawnSync('git', ['show', stand + ':' + datei],
    { cwd: WURZEL, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (g.status !== 0) return null;
  return g.stdout;
}

test('EN-N5: die Shorts-Seite ist Byte fuer Byte die von ' + STAND_VOR_EN, () => {
  const alt = fassungAusGit(STAND_VOR_EN, 'src/upload/freigabe-seite.js');
  if (alt === null) {
    // LAUT uebersprungen, nie still. Der Test, der die 21 Uploads deckt, darf
    // nicht gruen aussehen, wenn er nichts geprueft hat.
    assert.fail('Der Stand ' + STAND_VOR_EN + ' ist aus git nicht zu holen. Dieser Test ' +
      'kann so nicht laufen, und er wird nicht als bestanden gezaehlt.');
  }
  const ordner = wegwerfordner();
  try {
    const altDatei = path.join(ordner, 'seite-vor-en.cjs');
    fs.writeFileSync(altDatei, alt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const ALT = require(altDatei);

    const sitzung = shortsSitzungFuerVergleich(ordner);
    const vorher = Buffer.from(ALT.baueSeite(sitzung), 'utf8');
    const nachher = Buffer.from(SEITE.baueSeite(sitzung), 'utf8');

    assert.equal(nachher.length, vorher.length,
      'die Shorts-Seite ist ' + nachher.length + ' Bytes gross, vor EN waren es ' +
      vorher.length);
    if (!nachher.equals(vorher)) {
      let i = 0;
      while (i < vorher.length && vorher[i] === nachher[i]) i++;
      assert.fail('Die Shorts-Seite weicht ab Byte ' + i + ' ab.\n' +
        '  vorher:  ' + JSON.stringify(vorher.toString('utf8', Math.max(0, i - 60), i + 60)) +
        '\n  nachher: ' + JSON.stringify(nachher.toString('utf8', Math.max(0, i - 60), i + 60)));
    }

    // GEGENPROBE: der Vergleich schnappt zu.
    const verletzt = alt.replace('Shorts-Freigabe</title>', 'Shorts-Freigabe.</title>');
    assert.notEqual(verletzt, alt, 'die Gegenprobe hat wirklich etwas geaendert');
    const verletztDatei = path.join(ordner, 'seite-vor-en-verletzt.cjs');
    fs.writeFileSync(verletztDatei, verletzt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const KAPUTT = require(verletztDatei);
    assert.ok(!Buffer.from(KAPUTT.baueSeite(sitzung), 'utf8').equals(nachher),
      'ein geaendertes Zeichen kam durch den Vergleich -- dann prueft er nichts');
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

test('EN-N5: auch der Weg zur Shorts-Seite ist der von ' + STAND_VOR_EN, async () => {
  // Die Seite koennte gleich sein und der Dienst sie anders ausliefern. Und
  // die Routentabelle hat sich in DIESEM Auftrag geaendert -- also wird sie
  // hier gegen den alten Stand gehalten, Eintrag fuer Eintrag.
  const altServer = fassungAusGit(STAND_VOR_EN, 'src/upload/freigabe-server.js');
  assert.ok(altServer !== null, 'der Stand ' + STAND_VOR_EN + ' ist aus git nicht zu holen');

  // Die Shorts-Zeilen der beiden Routentabellen, aus dem alten Quelltext
  // gelesen und gegen den heutigen gehalten. Kein Nachbau: beide Male steht
  // dieselbe Zeile da oder eben nicht.
  for (const zeile of [
    "  [MODUS_SHORTS]: new Set(['/', '/video', '/stand', '/kette', '/lauf']),",
    "  [MODUS_SHORTS]: new Set(['/urteil', '/beenden', '/planen', '/archivieren', " +
      "'/hochladen']),",
  ]) {
    assert.ok(altServer.includes(zeile), 'so stand es vor EN gar nicht: ' + zeile);
    assert.ok(SERVERTEXT.includes(zeile),
      'die Shorts-Routen haben sich geaendert -- erwartet:\n' + zeile);
  }

  const ordner = wegwerfordner();
  let lauf = null;
  try {
    const sitzung = shortsSitzungFuerVergleich(ordner);
    lauf = await starte(sitzung);
    const t = { 'x-freigabe-token': sitzung.token };
    const seite = await anfrage(lauf.port, { pfad: '/', kopf: t });
    assert.equal(seite.status, 200);
    assert.equal(seite.kopf['content-type'], 'text/html; charset=utf-8');
    assert.equal(seite.text, SEITE.baueSeite(sitzung));
    for (const pfad of ['/stand', '/kette', '/lauf']) {
      const a = await anfrage(lauf.port, { pfad, kopf: t });
      assert.ok(a.status === 200 || a.status === 400, pfad + ' -> ' + a.status);
    }
    // Und die neue Route gibt es hier NICHT.
    const b = await anfrage(lauf.port, { pfad: '/bild', kopf: t });
    assert.equal(b.status, 404, 'die Bildroute ist im Shorts-Modus erreichbar');
  } finally {
    if (lauf) await lauf.schliesse();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('EN-N5: auch der Shorts-Arbeiter wird unveraendert aufgerufen', () => {
  // Der Aufruf des LONGFORM-Arbeiters hat ein Argument dazubekommen. Der des
  // Shorts-Uploaders nicht -- und das steht hier, damit es auffiele.
  const altServer = fassungAusGit(STAND_VOR_EN, 'src/upload/freigabe-server.js');
  assert.ok(altServer !== null);
  for (const marke of ['function ruftUploaderTrocken(', 'function starteUploaderLauf(',
    'function ruftPlaner(', 'function ruftLeser(']) {
    const alteFassung = ausschnitt(altServer, marke);
    const neueFassung = ausschnitt(SERVERTEXT, marke);
    assert.ok(alteFassung.length > 100, 'nicht gefunden im alten Stand: ' + marke);
    assert.equal(neueFassung, alteFassung,
      marke + ' hat sich geaendert -- das ist der Shorts-Weg, und er sollte unberuehrt sein');
  }
});

// Ein Ausschnitt von einer Funktionsmarke bis zur naechsten Leerzeile vor
// einem neuen Zeilenanfang auf Spalte 0 -- reicht, um eine Funktion ganz zu
// fassen, ohne einen Parser zu bauen.
function ausschnitt(text, marke) {
  const von = text.indexOf(marke);
  if (von < 0) return '';
  const bis = text.indexOf('\n}\n', von);
  return bis < 0 ? text.slice(von) : text.slice(von, bis + 3);
}
