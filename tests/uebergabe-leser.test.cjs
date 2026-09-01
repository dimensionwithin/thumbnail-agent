'use strict';

// DH: Tests fuer den Uebergabe-Leser.
//
// Der Leser hat genau eine Aufgabe: annehmen, was dem Vertrag entspricht, und
// ablehnen, was ihm nicht entspricht. Diese Tests halten beide Richtungen fest.
//
// WARUM DIE FIXTURES OHNE PLATTENZUGRIFF GEPRUEFT WERDEN: Die Fixtures unter
// fixtures/uebergabe/ verweisen auf erfundene Pfade unterhalb einer erfundenen
// Wurzel. Dort liegt nichts, und es soll dort auch nichts liegen -- dieses Repo
// ist oeffentlich und traegt keine echten Pfade dieses Rechners. Wuerde die
// Plattenpruefung mitlaufen, meldete jede Fixture zusaetzlich "Datei nicht
// vorhanden", und der EINE Mangel, um den es der jeweiligen Fixture geht, waere
// nicht mehr allein zu sehen. Die Plattenpruefung steht deshalb in zwei eigenen
// Tests am Ende: einer an echten Daten (Annahmerichtung), einer an erzeugten
// Wegwerfvideos (Ablehnungsrichtung, DHa).

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const L = require('../src/upload/uebergabe-leser.js');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'uebergabe');
const AUFNAHME = '2026-01-02 03-04-05';
const WURZEL = '/erfunden/wurzel';

function fixtureText(fall) {
  return fs.readFileSync(path.join(FIXTURES, fall, AUFNAHME, 'uebergabe.json'), 'utf8');
}

function pruefeFixture(fall) {
  return L.pruefeUebergabe({
    text: fixtureText(fall), wurzel: WURZEL, aufnahme: AUFNAHME, platte: false,
  });
}

function alleMaengel(bericht) {
  return [...bericht.kopfMaengel, ...bericht.eintraege.flatMap((e) => e.maengel)];
}

// DHb: Hinweise werden GETRENNT gesammelt. Sie tauchen bewusst in keiner
// Mangelsumme auf -- sonst waeren sie in kurzer Zeit halbe Maengel.
function alleHinweise(bericht) {
  return bericht.eintraege.flatMap((e) => e.hinweise);
}

// ---------------------------------------------------------------------------
// Die harte Sperre gegen zusammengebaute Pfade
// ---------------------------------------------------------------------------

const QUELLTEXT = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'upload', 'uebergabe-leser.js'), 'utf8');

test('der Leser durchsucht kein Verzeichnis', () => {
  // Die eine Regel des Vertrags: kein Absuchen von Ordnern, kein Erraten von
  // Dateinamen. Neben den guten Shorts liegen Ordner mit fehlerhaften
  // Fassungen, die am Inhalt nicht zu unterscheiden sind. Ein Leser, der auch
  // nur einmal ein Verzeichnis auflistet, ist eine Zeile davon entfernt, sie
  // hochzuladen.
  for (const verboten of ['readdir', 'opendir', 'glob', 'readdirSync']) {
    assert.ok(!QUELLTEXT.includes(verboten),
      `Der Quelltext enthaelt "${verboten}" -- der Leser darf kein Verzeichnis ansehen.`);
  }
});

test('path.join steht genau einmal im Quelltext, naemlich im Weg zur Uebergabedatei', () => {
  const treffer = QUELLTEXT.match(/path\.join\(/g) || [];
  assert.equal(treffer.length, 1,
    'Jede weitere Pfadkonstruktion waere ein zusammengebauter Pfad.');
  assert.ok(/function uebergabedateiPfad\([^)]*\) \{\s*return path\.join\(/.test(QUELLTEXT));
});

test('die Pfadsperre laesst nur durch, was woertlich in der Datei stand', () => {
  const s = L.neueSperre();
  s.ausDatei('/erfunden/wurzel/a/short.mp4');
  assert.equal(s.oeffnen('/erfunden/wurzel/a/short.mp4'), '/erfunden/wurzel/a/short.mp4');
  // Derselbe Ort, andere Schreibweise -- und trotzdem gesperrt. Genau daran
  // haengt die Regel: was der Leser selbst geformt hat, ist nicht mehr das,
  // was uebergeben wurde.
  assert.throws(() => s.oeffnen('/erfunden/wurzel/a/../a/short.mp4'), /Pfadsperre/);
  assert.throws(() => s.oeffnen('/erfunden/wurzel/b/short.mp4'), /Pfadsperre/);
});

// ---------------------------------------------------------------------------
// Die Argumente
// ---------------------------------------------------------------------------

test('der Leser kennt genau vier Argumente und weder --execute noch --nur-pruefen', () => {
  assert.deepEqual(L.ERLAUBTE_ARGUMENTE,
    ['--aufnahme=', '--wurzel=', '--json', '--ohne-platte']);
  // Er schreibt nichts und ruft nichts auf; ein Trockenlauf waere von einem
  // scharfen Lauf nicht zu unterscheiden. Das Fehlen ist Absicht.
  assert.ok(!L.ERLAUBTE_ARGUMENTE.includes('--execute'));
  assert.ok(!L.ERLAUBTE_ARGUMENTE.includes('--nur-pruefen'));
  // DIb: --ohne-platte ist KEIN Trockenlauf und dieser Test soll das festhalten,
  // damit es nicht spaeter als Widerspruch zu den beiden Zeilen darueber gelesen
  // wird. Ein Trockenlauf taeuscht eine Wirkung vor, die er nicht hat;
  // --ohne-platte prueft WENIGER und schreibt in beide Ausgabeformen hinein,
  // dass es weniger war.
});

// ---------------------------------------------------------------------------
// Die Negativkontrolle: die unveraenderte Basis muss durchgehen
// ---------------------------------------------------------------------------

test('basis-gueltig wird ohne einen einzigen Mangel angenommen', () => {
  const b = pruefeFixture('basis-gueltig');
  assert.deepEqual(alleMaengel(b), [], 'Die Basis traegt keinen Mangel.');
  assert.equal(b.status, 'angenommen');
  assert.equal(b.angenommen, 2);
});

// ---------------------------------------------------------------------------
// Die sechzehn Fassungen mit je genau EINEM Mangel
// ---------------------------------------------------------------------------

// Jede Zeile: [Fixture, erwartete Ebene, erwartetes Feld, Wortlaut der Meldung].
// Der Wortlaut steht hier vollstaendig, nicht als Bruchstueck: eine Meldung,
// die sich unbemerkt aendert, ist eine Meldung, auf die sich niemand verlassen
// kann.
const EIN_MANGEL = [
  ['a-schema-version-unbekannt', 'Kopf', 'schema_version',
    'schema_version ist "2.0" und damit unbekannt. Bekannt ist zur Zeit nur: 1.0. ' +
    'Die Datei wird nicht weitergelesen: eine unbekannte Fassung nach den Regeln der ' +
    'bekannten zu pruefen wuerde eine Zusage vortaeuschen, die niemand gegeben hat.'],
  ['b-artifact-type-falsch', 'Kopf', 'artifact_type',
    'artifact_type ist "irgendein_anderes_artefakt", erwartet ist ' +
    '"matrix_auto_cutter_shorts_uebergabe". Die Datei wird nicht weitergelesen -- ' +
    'sie gehoert nicht zu diesem Vertrag.'],
  ['c-urteil-nein', 'Vertrag', 'urteil',
    'urteil ist "nein", erwartet ist exakt "ja". In der Uebergabedatei stehen ' +
    'ausschliesslich angenommene Shorts.'],
  ['d-urteil-fehlt', 'Vertrag', 'urteil',
    'urteil fehlt (Pflichtfeld).'],
  ['e-sha256-63-zeichen', 'Vertrag', 'sha256',
    'sha256 hat 63 Zeichen, erwartet sind genau 64 Hexzeichen in Kleinschreibung.'],
  ['f-sha256-grossbuchstaben', 'Vertrag', 'sha256',
    'sha256 enthaelt Grossbuchstaben, erwartet sind genau 64 Hexzeichen in Kleinschreibung.'],
  ['g-pfad-relativ', 'Vertrag', 'pfad',
    'pfad "kandidat-1/short.mp4" ist nicht absolut.'],
  ['h-pfad-ausserhalb-der-wurzel', 'Vertrag', 'pfad',
    'pfad "/woanders/kandidat-1/short.mp4" liegt nicht unterhalb der eingestellten ' +
    'Wurzel "/erfunden/wurzel".'],
  ['i-kennung-doppelt', 'Vertrag', 'kennung',
    'kennung "2026-01-02 03-04-05/1" kommt mehrfach vor (zuerst in Eintrag 0, ' +
    'jetzt in Eintrag 1).'],
  ['j-shorts-leer', 'Kopf', 'shorts',
    'shorts ist eine leere Liste. Der Vertrag verlangt eine nicht-leere Liste; ' +
    'eine Aufnahme ohne freigegebene Shorts wird gar nicht erst uebergeben.'],
  ['k-titel-leer', 'Vertrag', 'titel_vorschlag',
    'titel_vorschlag ist "" und damit leer.'],
  ['l-transkript-leer', 'Vertrag', 'transkript',
    'transkript ist "" und damit leer.'],
  ['m-quelle-bis-nicht-groesser', 'Vertrag', 'quelle_bis_ms',
    'quelle_bis_ms (100000) ist nicht groesser als quelle_von_ms (100000).'],
  ['n-dauer-weicht-500ms-ab', 'Vertrag', 'dauer_ms',
    'dauer_ms (10500) weicht um +500 ms von der Quellspanne 10000 ms ab; ' +
    'erlaubt sind hoechstens +-20 ms.'],
];

for (const [fall, ebene, feld, wortlaut] of EIN_MANGEL) {
  test(`${fall}: genau ein Mangel, im Wortlaut`, () => {
    const b = pruefeFixture(fall);
    const m = alleMaengel(b);
    assert.equal(m.length, 1, 'Erwartet ist genau EIN Mangel, gefunden: ' +
      JSON.stringify(m.map((x) => x.meldung), null, 2));
    assert.equal(m[0].ebene, ebene);
    assert.equal(m[0].feld, feld);
    assert.equal(m[0].meldung, wortlaut);
    assert.equal(b.status, 'abgelehnt');
  });
}

test('a und b lesen die Eintraege gar nicht erst weiter', () => {
  // Eine unbekannte Fassung nach den Regeln der bekannten zu pruefen waere
  // stillschweigendes Weiterlesen. Das ist ausdruecklich verboten.
  for (const fall of ['a-schema-version-unbekannt', 'b-artifact-type-falsch', 'j-shorts-leer']) {
    const b = pruefeFixture(fall);
    assert.equal(b.eintraegeGeprueft, false, fall);
    assert.equal(b.eintraege.length, 0, fall);
    assert.ok(b.verlauf.some((v) => v.includes('kein einziger Eintrag geprueft')), fall);
  }
});

test('o-unbekanntes-feld wird ANGENOMMEN und das Feld genannt', () => {
  // Die Gegenseite hat additive Erweiterung zugesagt: neue Felder kommen dazu,
  // vorhandene werden nie umbenannt, entfernt oder umgedeutet. Ein Leser, der
  // an einem neuen Feld abbricht, macht die Zusage wertlos.
  const b = pruefeFixture('o-unbekanntes-feld');
  assert.deepEqual(alleMaengel(b), []);
  assert.equal(b.status, 'angenommen');
  assert.deepEqual(b.eintraege[0].unbekannteFelder, ['lautheit_lufs']);
  assert.deepEqual(b.eintraege[1].unbekannteFelder, []);
});

test('p-json-abgeschnitten meldet "unvollstaendig geschrieben", nicht "keine Shorts"', () => {
  const b = pruefeFixture('p-json-abgeschnitten');
  const m = alleMaengel(b);
  assert.equal(m.length, 1);
  assert.equal(m[0].ebene, 'Kopf');
  assert.ok(m[0].meldung.startsWith(
    'Die Uebergabedatei ist unvollstaendig geschrieben (abgeschnittenes JSON: ' +
    'offene Klammer oder offene Zeichenkette am Dateiende). Das ist KEINE leere ' +
    'Aufnahme, sondern ein abgebrochener Schreibvorgang'), m[0].meldung);
  // Der entscheidende Punkt: Null Eintraege heisst hier NICHT "null Shorts".
  assert.equal(b.eintraegeGeprueft, false);
  assert.equal(b.status, 'abgelehnt');
});

test('N4: drei Maengel in drei Eintraegen werden alle gemeldet, nicht nur der erste', () => {
  const b = pruefeFixture('n4-drei-maengel');
  const m = alleMaengel(b);
  assert.equal(m.length, 3);
  assert.deepEqual(m.map((x) => x.feld), ['urteil', 'sha256', 'transkript']);
  assert.deepEqual(m.map((x) => x.eintrag), [
    '2026-01-02 03-04-05/1', '2026-01-02 03-04-05/2', '2026-01-02 03-04-05/3',
  ]);
  assert.equal(b.angenommen, 0);
  assert.equal(b.abgelehnt, 3);
});

// ---------------------------------------------------------------------------
// Grenzen, die nicht an einer Fixture haengen
// ---------------------------------------------------------------------------

function einEintrag(aenderung) {
  const d = JSON.parse(fixtureText('basis-gueltig'));
  d.shorts = [d.shorts[0]];
  aenderung(d.shorts[0]);
  return L.pruefeUebergabe({
    text: JSON.stringify(d), wurzel: WURZEL, aufnahme: AUFNAHME, platte: false,
  });
}

test('urteil wird auf Gleichheit geprueft, nicht ueber eine Ausschlussliste', () => {
  // Eine Ausschlussliste ("alles ausser nein") nimmt an, was sie nicht kennt.
  for (const wert of ['JA', 'Ja', ' ja', 'ja ', 'vielleicht', '', true, null, 1]) {
    const b = einEintrag((e) => { e.urteil = wert; });
    assert.equal(alleMaengel(b).length, 1, 'urteil=' + JSON.stringify(wert) +
      ' muesste abgelehnt werden');
    assert.equal(alleMaengel(b)[0].feld, 'urteil');
  }
  assert.deepEqual(alleMaengel(einEintrag((e) => { e.urteil = 'ja'; })), []);
});

test('die Zeittoleranz liegt bei +-20 ms und wird beidseitig eingehalten', () => {
  assert.equal(L.TOLERANZ_MS, 20);
  // Spanne ist 10000 ms.
  for (const dauer of [9980, 9987, 10000, 10013, 10020]) {
    assert.deepEqual(alleMaengel(einEintrag((e) => { e.dauer_ms = dauer; })), [],
      'dauer_ms=' + dauer + ' liegt innerhalb der Toleranz');
  }
  for (const dauer of [9979, 10021]) {
    const m = alleMaengel(einEintrag((e) => { e.dauer_ms = dauer; }));
    assert.equal(m.length, 1, 'dauer_ms=' + dauer + ' liegt ausserhalb der Toleranz');
    assert.equal(m[0].feld, 'dauer_ms');
  }
});

// ---------------------------------------------------------------------------
// DHb Teil 1: Die Dauerspanne ist keine Zusicherung.
//
// Abschnitt 6 des Vertrags ist ueberschrieben "Gemessen an 113 fertigen
// Shorts". Aufloesung, Bildrate, Codec und Tonformat sind Encoder-Einstellungen
// und damit Zusagen; die Spanne 6,9 bis 18,7 s ist eine BEOBACHTUNG. In DH
// stand sie faelschlich als Ablehnungsgrund im Leser.
//
// Die Laenge wird deshalb an zwei getrennten Grenzen gemessen: die
// Vernunftgrenze lehnt ab, die beobachtete Spanne meldet nur.
// ---------------------------------------------------------------------------

// Setzt die Dauer UND die Quellspanne, damit nicht die +-20-ms-Pruefung
// dazwischenfunkt und einen zweiten Mangel erzeugt.
function mitDauer(ms) {
  return einEintrag((e) => {
    e.dauer_ms = ms;
    e.quelle_bis_ms = e.quelle_von_ms + ms;
  });
}

test('ausserhalb der Vernunftgrenze ist ein Mangel', () => {
  assert.equal(L.VERNUNFT_MIN_MS, 1000);
  assert.equal(L.VERNUNFT_MAX_MS, 180000);
  for (const ms of [1, 500, 999, 180001, 181000, 3600000]) {
    const b = mitDauer(ms);
    const m = alleMaengel(b);
    assert.equal(m.length, 1, 'dauer_ms=' + ms + ': ' + JSON.stringify(m.map((x) => x.meldung)));
    assert.equal(m[0].feld, 'dauer_ms');
    assert.ok(m[0].meldung.includes('ausserhalb jeder Vernunftgrenze'), m[0].meldung);
    assert.equal(b.status, 'abgelehnt');
    // Ein Mangel, kein Hinweis -- die beiden Grenzen duerfen nicht doppelt melden.
    assert.deepEqual(alleHinweise(b), []);
  }
});

test('innerhalb der Vernunftgrenze, aber ausserhalb der Beobachtung: Hinweis, keine Ablehnung', () => {
  assert.equal(L.BEOBACHTET_MIN_MS, 6900);
  assert.equal(L.BEOBACHTET_MAX_MS, 18700);
  for (const ms of [1000, 6000, 6899, 18701, 25000, 180000]) {
    const b = mitDauer(ms);
    assert.deepEqual(alleMaengel(b), [], 'dauer_ms=' + ms + ' darf NICHT abgelehnt werden');
    const w = alleHinweise(b);
    assert.equal(w.length, 1, 'dauer_ms=' + ms);
    assert.equal(w[0].feld, 'dauer_ms');
    // Teil 1d: der Text muss sagen, dass es eine Beobachtung ist und keine Zusage.
    assert.ok(w[0].meldung.includes('BEOBACHTUNG aus 113 fertigen Shorts'), w[0].meldung);
    assert.ok(w[0].meldung.includes('KEINE Zusage'), w[0].meldung);
    assert.ok(w[0].meldung.includes('kein Defekt zu suchen'), w[0].meldung);
    // Teil 1c: Der Eintrag gilt als angenommen, der Rueckgabewert bleibt 0.
    assert.equal(b.status, 'angenommen');
    assert.equal(b.eintraege[0].angenommen, true);
    assert.equal(b.angenommen, 1);
    assert.equal(b.abgelehnt, 0);
    assert.equal(b.angenommenMitHinweis, 1);
  }
});

test('innerhalb der beobachteten Spanne gibt es weder Mangel noch Hinweis', () => {
  for (const ms of [6900, 8067, 12000, 15933, 18700]) {
    const b = mitDauer(ms);
    assert.deepEqual(alleMaengel(b), [], 'dauer_ms=' + ms);
    assert.deepEqual(alleHinweise(b), [], 'dauer_ms=' + ms);
    assert.equal(b.angenommenMitHinweis, 0);
    assert.equal(b.status, 'angenommen');
  }
});

test('die Abschlusszeile trennt Hinweis von Mangel', () => {
  // Teil 1e: Ein Hinweis darf nicht wie ein halber Mangel aussehen.
  const b = mitDauer(6000);
  const text = L.formatiere(b, '<Quelle>');
  assert.ok(text.includes('angenommen 1 (davon 1 mit Hinweis)'), text);
  assert.ok(text.includes('Hinweise gesamt: 1'), text);
  assert.ok(text.includes('Maengel gesamt: 0'), text);
  assert.ok(text.includes('ANGENOMMEN  [0]'), text);
  assert.ok(text.includes('1 Hinweis(e), kein Mangel'), text);
  // DIb: Dieser Bericht entstand mit platte:false, und seither sagt die
  // Schlusszeile in diesem Fall NICHT mehr "entspricht dem Vertrag" -- geprueft
  // wurde nur die eine Haelfte. Der Punkt dieses Tests bleibt derselbe: nichts
  // in der Ausgabe darf nach Ablehnung klingen.
  assert.ok(text.includes('ERGEBNIS: Die VERTRAGSPRUEFUNG ist bestanden.'), text);
  assert.ok(!text.includes('ERGEBNIS: Die Uebergabe entspricht dem Vertrag.'), text);
  // Und die Zeile darf NICHT so klingen, als waere etwas abgelehnt worden.
  assert.ok(!text.includes('ABGELEHNT'), text);
});

// ---------------------------------------------------------------------------
// DIb, Punkt 3: --ohne-platte
// ---------------------------------------------------------------------------

test('ohne Plattenpruefung sagt die Ausgabe das in beiden Formen', () => {
  const b = L.pruefeUebergabe({
    text: fixtureText('basis-gueltig'), wurzel: WURZEL, aufnahme: AUFNAHME, platte: false,
  });

  // Maschinenlesbar.
  assert.equal(b.plattenpruefung, false);
  assert.deepEqual(alleMaengel(b), []);
  assert.equal(b.status, 'angenommen');

  // Im JSON-Bericht: die Anmerkung nennt beim Namen, was NICHT nachgesehen
  // wurde, und benutzt den Wortlaut des uebersprungenen Lieferungstests.
  const anmerkung = b.verlauf.join('\n');
  assert.ok(anmerkung.includes('Die Plattenpruefung lief NICHT'), anmerkung);
  assert.ok(anmerkung.includes('Existenz, Pruefsumme, Groesse und Format'), anmerkung);
  assert.ok(anmerkung.includes('keine bestandene Pruefung, sondern eine ausgelassene'),
    anmerkung);

  // Im Klartext ebenso -- und die Schlusszeile behauptet NICHT mehr, die
  // Uebergabe entspreche dem Vertrag.
  const text = L.formatiere(b, '<Quelle>');
  assert.ok(text.includes('keine bestandene Pruefung, sondern eine ausgelassene'), text);
  assert.ok(text.includes('ERGEBNIS: Die VERTRAGSPRUEFUNG ist bestanden.'), text);
  assert.ok(text.includes('NICHT beantwortet'), text);
  assert.ok(!text.includes('ERGEBNIS: Die Uebergabe entspricht dem Vertrag.'), text);
});

test('mit Plattenpruefung bleibt die Schlusszeile unveraendert', () => {
  // Die Gegenprobe zum Test darueber: der gewohnte Wortlaut darf nur dann
  // verschwinden, wenn wirklich nicht nachgesehen wurde.
  const b = L.pruefeUebergabe({
    text: fixtureText('basis-gueltig'), wurzel: WURZEL, aufnahme: AUFNAHME, platte: false,
  });
  b.plattenpruefung = true;   // nur die Anzeige, ohne Plattenzugriff
  b.verlauf = [];
  const text = L.formatiere(b, '<Quelle>');
  assert.ok(text.includes('ERGEBNIS: Die Uebergabe entspricht dem Vertrag.'), text);
});

test('Hinweis und Mangel in derselben Datei werden beide gemeldet', () => {
  const d = JSON.parse(fixtureText('basis-gueltig'));
  // Eintrag 1 bekommt einen Hinweis (kurz, aber vernuenftig),
  d.shorts[0].dauer_ms = 6000;
  d.shorts[0].quelle_bis_ms = d.shorts[0].quelle_von_ms + 6000;
  // Eintrag 2 einen echten Mangel.
  d.shorts[1].urteil = 'nein';

  const b = L.pruefeUebergabe({
    text: JSON.stringify(d), wurzel: WURZEL, aufnahme: AUFNAHME, platte: false,
  });

  const m = alleMaengel(b);
  const w = alleHinweise(b);
  assert.equal(m.length, 1);
  assert.equal(m[0].feld, 'urteil');
  assert.equal(m[0].eintrag, AUFNAHME + '/2');
  assert.equal(w.length, 1);
  assert.equal(w[0].feld, 'dauer_ms');
  assert.equal(w[0].eintrag, AUFNAHME + '/1');

  assert.equal(b.angenommen, 1);
  assert.equal(b.abgelehnt, 1);
  assert.equal(b.angenommenMitHinweis, 1);
  assert.equal(b.maengelGesamt, 1);
  assert.equal(b.hinweiseGesamt, 1);
  assert.equal(b.status, 'abgelehnt');
});

test('die Dauer wird nicht mehr gegen die ffprobe-Dauer der Datei geprueft', () => {
  // DHb Teil 1a: Die Zusicherung 6,9-18,7 s ist aus ZUSICHERUNG entfernt. Wer
  // sie dort wieder eintraegt, laesst diesen Test fallen -- und faengt damit
  // wieder an, einwandfreie Shorts wegen einer Beobachtung abzulehnen.
  assert.ok(!('dauerMinSekunden' in L.ZUSICHERUNG));
  assert.ok(!('dauerMaxSekunden' in L.ZUSICHERUNG));
});

test('sha256 muss 64 kleine Hexzeichen sein', () => {
  const gut = 'aa11bb22cc33dd44ee55ff6600778899aa11bb22cc33dd44ee55ff6600778899';
  assert.deepEqual(alleMaengel(einEintrag((e) => { e.sha256 = gut; })), []);
  for (const schlecht of [gut + '0', gut.slice(0, 63), gut.toUpperCase(),
    gut.slice(0, 63) + 'g', 12345, null]) {
    const m = alleMaengel(einEintrag((e) => { e.sha256 = schlecht; }));
    assert.equal(m.length, 1, 'sha256=' + JSON.stringify(schlecht));
    assert.equal(m[0].feld, 'sha256');
  }
});

test('kennung muss die Form <aufnahme>/<index> haben', () => {
  assert.deepEqual(alleMaengel(einEintrag((e) => { e.kennung = AUFNAHME + '/7'; })), []);
  for (const schlecht of ['7', AUFNAHME, AUFNAHME + '/', AUFNAHME + '/a',
    '2026-01-02 03-04-06/1', '/1', '']) {
    const m = alleMaengel(einEintrag((e) => { e.kennung = schlecht; }));
    assert.ok(m.length >= 1, 'kennung=' + JSON.stringify(schlecht));
    assert.equal(m[0].feld, 'kennung');
  }
});

test('der Kopf prueft Ordnername, Form und Zonenversatz', () => {
  const basis = JSON.parse(fixtureText('basis-gueltig'));

  const anderer = L.pruefeKopf(basis, '2026-09-09 09-09-09');
  assert.equal(anderer.maengel.length, 1);
  assert.equal(anderer.maengel[0].feld, 'aufnahme');
  assert.ok(anderer.maengel[0].meldung.includes('der gelesene Ordner heisst aber'));

  for (const form of ['2026-01-02', '2026-01-02 03:04:05', 'irgendwas', 20260102]) {
    const d = { ...basis, aufnahme: form };
    const r = L.pruefeKopf(d, form);
    assert.ok(r.maengel.some((m) => m.feld === 'aufnahme'), 'aufnahme=' + form);
  }

  // ISO-8601 MIT Zonenversatz. Ohne Versatz ist der Zeitpunkt mehrdeutig, und
  // der Planer rechnet spaeter in Europe/Berlin -- da darf nichts raten.
  for (const zeit of ['2026-01-02T04:05:06', '2026-01-02 04:05:06+02:00',
    '02.01.2026 04:05', '2026-01-02T04:05:06+2:00', '']) {
    const d = { ...basis, erzeugt_am: zeit };
    const r = L.pruefeKopf(d, AUFNAHME);
    assert.ok(r.maengel.some((m) => m.feld === 'erzeugt_am'), 'erzeugt_am=' + zeit);
  }
  for (const zeit of ['2026-01-02T04:05:06+02:00', '2026-01-02T04:05:06Z',
    '2026-01-02T04:05:06.123+02:00', '2026-01-02T04:05:06-05:00']) {
    const d = { ...basis, erzeugt_am: zeit };
    const r = L.pruefeKopf(d, AUFNAHME);
    assert.ok(!r.maengel.some((m) => m.feld === 'erzeugt_am'), 'erzeugt_am=' + zeit);
  }
});

test('istAbgeschnitten trennt den halben Schreibvorgang vom kaputten JSON', () => {
  // Wahr: der Schreibvorgang brach ab.
  assert.equal(L.istAbgeschnitten(''), true);
  assert.equal(L.istAbgeschnitten('   \n'), true);
  assert.equal(L.istAbgeschnitten('{"shorts": ['), true);
  assert.equal(L.istAbgeschnitten('{"a": "halbe Zeichen'), true);
  assert.equal(L.istAbgeschnitten('{"a": 1'), true);
  // Falsch: vollstaendig geschrieben (ob gueltig oder nicht, ist eine andere
  // Frage -- der Leser meldet dann "kein gueltiges JSON").
  assert.equal(L.istAbgeschnitten('{"a": 1}'), false);
  assert.equal(L.istAbgeschnitten('{"a": 1,}'), false);
  assert.equal(L.istAbgeschnitten('{"a": "ein \\" maskiertes Zeichen"}'), false);
  assert.equal(L.istAbgeschnitten('nur text'), false);
});

test('pfadLiegtUnter haelt die Wurzel dicht', () => {
  assert.equal(L.pfadLiegtUnter(WURZEL, WURZEL + '/a/short.mp4'), true);
  assert.equal(L.pfadLiegtUnter(WURZEL, WURZEL), false);
  assert.equal(L.pfadLiegtUnter(WURZEL, '/woanders/a/short.mp4'), false);
  // Der Ausbruch ueber ".." darf nicht durchkommen.
  assert.equal(L.pfadLiegtUnter(WURZEL, WURZEL + '/../geheim/short.mp4'), false);
  // Ein Nachbarordner, dessen Name mit dem Wurzelnamen anfaengt, ist NICHT
  // unterhalb der Wurzel.
  assert.equal(L.pfadLiegtUnter(WURZEL, '/erfunden/wurzel-daneben/short.mp4'), false);
});

// ---------------------------------------------------------------------------
// DIb, Punkt 2: ein Code je Mangel.
//
// Der Fliesstext ist fuer Menschen und darf sich aendern; der Code ist fuer
// Programme und darf es nicht. Damit das traegt, muss dreierlei feststehen:
// kein Code doppelt, kein Code ohne Aufrufstelle, keine Aufrufstelle ohne Code.
// Die ersten beiden sind unten abgezaehlt, die dritte steht doppelt -- einmal
// als Quelltextzaehlung und einmal als Verhalten (mangel() wirft).
// ---------------------------------------------------------------------------

// Beide Aufrufformen: mangel('Ebene', <eintrag>, <feld>, <code>, ...) und der
// Helfer m(<feld>, <code>, ...). Feldnamen duerfen Ziffern und einen Schraegstrich
// tragen (sha256, breite/hoehe) -- ohne die beiden Zeichen zaehlt der Scanner
// sechs Stellen zu wenig und meldet trotzdem "alles in Ordnung".
const FELD_IM_AUFRUF = "(?:null|feld|'[a-z0-9_/]+')";
const AUFRUF_DIREKT = new RegExp(
  "mangel\\('(?:Kopf|Vertrag|Platte)',\\s*[^,]+?,\\s*" + FELD_IM_AUFRUF +
  ",\\s*(?:'([a-z0-9_]+)'|code)", 'g');
const AUFRUF_HELFER = new RegExp(
  "(?<![\\w.])m\\(\\s*" + FELD_IM_AUFRUF + "\\s*,\\s*(?:'([a-z0-9_]+)'|code)", 'g');

function codeAufrufstellen() {
  const treffer = [
    ...QUELLTEXT.matchAll(AUFRUF_DIREKT),
    ...QUELLTEXT.matchAll(AUFRUF_HELFER),
  ];
  // Zwei Treffer sind die Helferdefinitionen selbst -- dort steht `code` als
  // Variable, nicht als Zeichenkette. Sie sind keine Aufrufstellen.
  const definitionen = treffer.filter((t) => t[1] === undefined).length;
  return { codes: treffer.map((t) => t[1]).filter(Boolean), definitionen };
}

test('kein Mangelcode ist doppelt vergeben', () => {
  const codes = Object.keys(L.MANGEL_CODES);
  assert.equal(codes.length, new Set(codes).size);
  assert.equal(codes.length, 46);
  // Eingefroren: ein Code, der sich zur Laufzeit nachtragen laesst, ist keine
  // Zusage, sondern ein Vorschlag.
  assert.ok(Object.isFrozen(L.MANGEL_CODES));
  for (const [code, beschreibung] of Object.entries(L.MANGEL_CODES)) {
    assert.match(code, /^[a-z][a-z0-9_]*$/, code);
    assert.ok(beschreibung.length > 10, code + ' braucht eine lesbare Beschreibung');
  }
});

test('jede Mangelstelle im Quelltext traegt einen eingetragenen Code', () => {
  const { codes, definitionen } = codeAufrufstellen();
  assert.equal(definitionen, 2, 'erwartet sind genau die zwei Helferdefinitionen');
  assert.equal(codes.length, 47, 'Aufrufstellen im Quelltext');
  for (const code of codes) {
    assert.ok(code in L.MANGEL_CODES, 'unbekannter Code an einer Aufrufstelle: ' + code);
  }
});

test('kein eingetragener Code steht ohne Aufrufstelle herum', () => {
  // Die Gegenrichtung. Ein Code ohne Stelle ist eine Zusage auf einen Mangel,
  // den niemand mehr melden kann -- wer danach filtert, wartet fuer immer.
  const { codes } = codeAufrufstellen();
  const benutzt = new Set(codes);
  const verwaist = Object.keys(L.MANGEL_CODES).filter((c) => !benutzt.has(c));
  assert.deepEqual(verwaist, []);
  // Genau ein Code sitzt an zwei Stellen: dieselbe Ganzzahlpruefung laeuft
  // ueber zwei Feldgruppen. Welches Feld es war, sagt `feld`, nicht der Code.
  const zaehl = {};
  for (const c of codes) zaehl[c] = (zaehl[c] || 0) + 1;
  assert.deepEqual(Object.entries(zaehl).filter(([, n]) => n > 1),
    [['zahl_keine_ganzzahl', 2]]);
});

test('mangel() wirft, wenn der Code nicht eingetragen ist', () => {
  // Der Kern von "ein Mangel ohne Code soll auffallen, nicht durchgehen":
  // Er kann gar nicht erst entstehen.
  assert.throws(() => L.mangel('Vertrag', 'x', 'urteil', 'gibt_es_nicht', 'egal'),
    /Mangel ohne eingetragenen Code/);
  assert.throws(() => L.mangel('Vertrag', 'x', 'urteil', undefined, 'egal'),
    /Mangel ohne eingetragenen Code/);
  assert.throws(() => L.mangel('Vertrag', 'x', 'urteil', null, 'egal'),
    /Mangel ohne eingetragenen Code/);
  // Und ein geerbter Name ist kein eingetragener Code.
  assert.throws(() => L.mangel('Vertrag', 'x', 'urteil', 'toString', 'egal'),
    /Mangel ohne eingetragenen Code/);
  const gut = L.mangel('Vertrag', 'x', 'urteil', 'urteil_nicht_ja', 'egal');
  assert.equal(gut.code, 'urteil_nicht_ja');
  assert.equal(gut.meldung, 'egal');
});

test('jeder tatsaechlich erzeugte Mangel traegt einen eingetragenen Code', () => {
  // Nicht am Quelltext, sondern am Verhalten: alle Fixtures plus die Faelle,
  // die keine Fixture hat, einmal durchlaufen lassen und jeden erzeugten
  // Mangel ansehen.
  const berichte = fs.readdirSync(FIXTURES).map(pruefeFixture);
  for (const wert of ['JA', '', null, 1]) berichte.push(einEintrag((e) => { e.urteil = wert; }));
  for (const wert of [12345, null, 'zz']) berichte.push(einEintrag((e) => { e.sha256 = wert; }));
  for (const ms of [500, 200000]) berichte.push(mitDauer(ms));
  berichte.push(einEintrag((e) => { e.groesse_bytes = 0; }));
  berichte.push(einEintrag((e) => { e.breite = 'x'; }));
  berichte.push(einEintrag((e) => { delete e.titel_vorschlag; }));

  const maengel = berichte.flatMap(alleMaengel);
  assert.ok(maengel.length > 25, 'zu wenig Maengel erzeugt: ' + maengel.length);
  for (const m of maengel) {
    assert.ok(typeof m.code === 'string' && m.code in L.MANGEL_CODES,
      'Mangel ohne eingetragenen Code: ' + JSON.stringify(m));
  }
});

// ---------------------------------------------------------------------------
// DIb, Punkt 1: das Feld `daten`
// ---------------------------------------------------------------------------

test('nutzdaten reicht genau die zwoelf geprueften Felder woertlich durch', () => {
  assert.deepEqual(L.DURCHGEREICHTE_FELDER, L.PFLICHTFELDER);
  assert.equal(L.DURCHGEREICHTE_FELDER.length, 12);

  const eintrag = JSON.parse(fixtureText('o-unbekanntes-feld')).shorts[0];
  const daten = L.nutzdaten(eintrag);

  // Genau die zwoelf, in der Reihenfolge des Vertrags.
  assert.deepEqual(Object.keys(daten), L.PFLICHTFELDER);
  // Das unbekannte Feld geht NICHT mit -- es ist ungeprueft.
  assert.ok(!('lautheit_lufs' in daten));
  assert.ok('lautheit_lufs' in eintrag);
  // Woertlich: kein Wert neu berechnet, keiner normalisiert, keiner getrimmt.
  for (const feld of L.PFLICHTFELDER) assert.equal(daten[feld], eintrag[feld], feld);
  // Insbesondere der Pfad, Zeichen fuer Zeichen -- keine Schreibweise gedreht.
  assert.equal(daten.pfad, eintrag.pfad);
});

test('jedes durchgereichte Feld hat eine Pruefung hinter sich', () => {
  // DIE Absicherung gegen die stille Zusage. Jedes Feld, das der Leser
  // weiterreicht, wird hier einzeln kaputtgemacht; kommt dann KEIN Mangel mit
  // diesem Feldnamen, steht das Feld ohne Pruefung in `daten` -- und die
  // Oberflaeche zeigte einen Wert, fuer den niemand geradesteht.
  const KAPUTT = {
    kennung: 'ohne die vorgeschriebene Form',
    pfad: 'kandidat-1/short.mp4',
    sha256: 'zu kurz',
    groesse_bytes: 0,
    dauer_ms: 0,
    breite: 'keine Zahl',
    hoehe: 'keine Zahl',
    titel_vorschlag: '',
    transkript: '',
    quelle_von_ms: 'keine Zahl',
    quelle_bis_ms: 'keine Zahl',
    urteil: 'nein',
  };
  assert.deepEqual(Object.keys(KAPUTT).sort(), [...L.DURCHGEREICHTE_FELDER].sort(),
    'Kommt ein Feld nach DURCHGEREICHTE_FELDER, gehoert hier ein kaputter Wert dazu.');

  for (const feld of L.DURCHGEREICHTE_FELDER) {
    // a) falscher Wert
    const falsch = alleMaengel(einEintrag((e) => { e[feld] = KAPUTT[feld]; }));
    assert.ok(falsch.some((m) => m.feld === feld),
      feld + ': ein falscher Wert erzeugt keinen Mangel -- ungeprueft durchgereicht. ' +
      JSON.stringify(falsch.map((m) => m.meldung)));
    // b) Feld fehlt ganz
    const fehlt = alleMaengel(einEintrag((e) => { delete e[feld]; }));
    assert.ok(fehlt.some((m) => m.feld === feld && m.code === 'feld_fehlt'),
      feld + ': das Fehlen des Feldes erzeugt keinen Mangel.');
  }
});

test('daten bleibt leer, wenn der Eintrag abgelehnt ist', () => {
  const b = pruefeFixture('n4-drei-maengel');
  assert.equal(b.abgelehnt, 3);
  for (const e of b.eintraege) {
    assert.equal(e.angenommen, false);
    assert.equal(e.daten, null, 'Ein abgelehnter Eintrag darf keine Nutzdaten weiterreichen.');
  }
  // Das Feld ist ANWESEND und null, nicht abwesend: siehe der Test darunter.
  for (const e of b.eintraege) assert.ok('daten' in e);
});

test('daten ist immer da und im Ablehnungsfall null, nicht abwesend', () => {
  // Die Entscheidung, und der Grund steht hier, weil sie sonst niemand sieht:
  // ein abwesendes Feld ist mehrdeutig. "daten fehlt" heisst entweder
  // "abgelehnt" oder "der Leser ist aelter als dieses Feld" -- und JSON.stringify
  // laesst undefined spurlos verschwinden, so wie es das mit `kennung` schon
  // tut. `null` ist eine Aussage; Abwesenheit ist eine Frage.
  const b = pruefeFixture('c-urteil-nein');
  const roh = JSON.parse(JSON.stringify(b));
  for (const e of roh.eintraege) {
    assert.ok(Object.prototype.hasOwnProperty.call(e, 'daten'),
      'daten muss auch durch JSON.stringify hindurch sichtbar bleiben');
    assert.equal(e.daten, null);
  }
  // Alle acht Eintragsfelder sind immer da -- gleiche Form, egal wie das
  // Urteil ausfiel.
  assert.deepEqual(Object.keys(roh.eintraege[0]),
    ['index', 'kennung', 'bezeichner', 'unbekannteFelder', 'maengel', 'hinweise',
      'angenommen', 'daten']);
});

test('daten bleibt leer, wenn die Plattenpruefung nicht lief', () => {
  // Auch bei einem in JEDEM Feld einwandfreien Eintrag. Was der Leser nicht
  // gegen die Platte gehalten hat, reicht er nicht weiter -- sonst waere
  // --ohne-platte genau die stille Zusage, gegen die `daten` gebaut ist.
  const b = pruefeFixture('basis-gueltig');
  assert.equal(b.plattenpruefung, false);
  assert.equal(b.status, 'angenommen');
  assert.equal(b.angenommen, 2);
  for (const e of b.eintraege) {
    assert.equal(e.angenommen, true);
    assert.equal(e.daten, null, 'Ohne Plattenpruefung gibt es keine Nutzdaten.');
  }
});

test('ein Hinweis allein verhindert die Nutzdaten NICHT', () => {
  // Gegenprobe: `daten` haengt an den Maengeln und an der Plattenpruefung, nicht
  // an den Hinweisen. Sonst waere ein Hinweis doch wieder ein halber Mangel.
  const b = mitDauer(6000);
  assert.equal(b.hinweiseGesamt, 1);
  assert.equal(b.eintraege[0].angenommen, true);
  // Hier ist daten trotzdem null -- aber wegen platte:false, nicht wegen des
  // Hinweises. Der Beleg dafuer steht im Plattentest weiter unten, wo derselbe
  // Fall mit echtem Plattenzugriff laeuft.
  assert.equal(b.plattenpruefung, false);
  assert.equal(b.eintraege[0].daten, null);
});

// ---------------------------------------------------------------------------
// Die echte Lieferung -- nur, wenn das Renderlaufwerk erreichbar ist.
//
// Die Wurzel steht bewusst NICHT in dieser Datei: dieses Repo ist oeffentlich
// und traegt keine Pfade dieses Rechners. Sie kommt aus SHORTS_RENDER_WURZEL.
// Ist der Schluessel nicht gesetzt, sagt der Test das laut, statt still
// durchzugehen.
// ---------------------------------------------------------------------------

test('die echte Lieferung wird vollstaendig angenommen', (t) => {
  const wurzel = process.env.SHORTS_RENDER_WURZEL;
  if (!wurzel) {
    t.skip('SHORTS_RENDER_WURZEL ist nicht gesetzt -- die Pruefung gegen die Platte ' +
      'lief NICHT. Das ist keine bestandene Pruefung, sondern eine ausgelassene.');
    return;
  }
  // Der Ordnername einer Aufnahme ist ein Zeitstempel, kein Geheimnis; er darf
  // hier stehen. Ueberschreibbar, damit der Test auch auf eine spaetere
  // Lieferung gerichtet werden kann.
  const aufnahme = process.env.SHORTS_TEST_AUFNAHME || '2026-08-29 18-18-19';
  const quelle = L.uebergabedateiPfad(wurzel, aufnahme);
  if (!fs.existsSync(quelle)) {
    t.skip('Unter der eingestellten Wurzel liegt keine Uebergabedatei fuer diese Aufnahme.');
    return;
  }
  const text = fs.readFileSync(quelle, 'utf8');
  const b = L.pruefeUebergabe({ text, wurzel, aufnahme, platte: true });
  assert.deepEqual(alleMaengel(b).map((m) => m.meldung), []);
  assert.equal(b.status, 'angenommen');
  assert.equal(b.abgelehnt, 0);
  assert.ok(b.angenommen > 0);

  // DIb: Und die geprueften Nutzdaten stehen auch wirklich drin -- woertlich
  // dieselben Werte wie in der Uebergabedatei, Feld fuer Feld. Das ist die
  // Zusage, auf der die Freigabeoberflaeche steht: sie liest die Datei NICHT
  // selbst, sie bekommt sie von hier.
  assert.equal(b.plattenpruefung, true);
  const ausDerDatei = JSON.parse(text).shorts;
  assert.equal(b.eintraege.length, ausDerDatei.length);
  for (const e of b.eintraege) {
    assert.equal(e.angenommen, true);
    assert.notEqual(e.daten, null, 'Ein angenommener Eintrag muss Nutzdaten tragen.');
    assert.deepEqual(Object.keys(e.daten), L.PFLICHTFELDER);
    const quellEintrag = ausDerDatei[e.index];
    for (const feld of L.PFLICHTFELDER) {
      assert.equal(e.daten[feld], quellEintrag[feld],
        'Eintrag ' + e.index + ', Feld ' + feld + ' wurde nicht woertlich durchgereicht.');
    }
  }
});

test('dieselbe echte Lieferung reicht mit --ohne-platte NICHTS durch', (t) => {
  // Die Gegenprobe zum Test darueber, an denselben Daten: sobald nicht
  // nachgesehen wurde, bleiben die Nutzdaten weg -- auch wenn jedes Feld fuer
  // sich in Ordnung ist.
  const wurzel = process.env.SHORTS_RENDER_WURZEL;
  if (!wurzel) {
    t.skip('SHORTS_RENDER_WURZEL ist nicht gesetzt -- der Vergleich mit und ohne ' +
      'Plattenpruefung lief NICHT. Das ist keine bestandene Pruefung, sondern eine ' +
      'ausgelassene.');
    return;
  }
  const aufnahme = process.env.SHORTS_TEST_AUFNAHME || '2026-08-29 18-18-19';
  const quelle = L.uebergabedateiPfad(wurzel, aufnahme);
  if (!fs.existsSync(quelle)) {
    t.skip('Unter der eingestellten Wurzel liegt keine Uebergabedatei fuer diese Aufnahme.');
    return;
  }
  const b = L.pruefeUebergabe({
    text: fs.readFileSync(quelle, 'utf8'), wurzel, aufnahme, platte: false,
  });
  assert.deepEqual(alleMaengel(b), []);
  assert.equal(b.status, 'angenommen');
  assert.equal(b.plattenpruefung, false);
  for (const e of b.eintraege) {
    assert.equal(e.angenommen, true);
    assert.equal(e.daten, null);
  }
  assert.ok(b.verlauf.join('\n').includes('keine bestandene Pruefung, sondern eine ausgelassene'));
});

// ---------------------------------------------------------------------------
// DHa: Die Ablehnungsrichtung der Plattenpruefung.
//
// Bis DH war nur belegt, dass zehn konforme Dateien durchgehen. Dass eine
// NICHT-konforme abgelehnt wird, war ungeprueft -- eine Pruefung, von der nur
// die Ja-Antwort bekannt ist, ist keine Pruefung.
//
// WARUM DIE VIDEOS ZUR LAUFZEIT ENTSTEHEN UND NICHT ALS FIXTURE IM REPO LIEGEN:
// Eine Fixture muesste auf eine WIRKLICH vorhandene Datei zeigen, also einen
// echten Pfad dieses Rechners tragen. Gemessen in DHa an einer Wegwerfdatei im
// Arbeitsbaum: der Freigabe-Check meldet einen solchen Pfad in BEIDEN
// Schreibweisen -- mit Laufwerksbuchstaben als "absoluter Laufwerkspfad", ohne
// als "absoluter Unix-Heimpfad", weil der einzige beschreibbare Ablageort auf
// diesem Rechner unter /Users liegt. Der Weg aus DH -- eine erfundene Wurzel
// ohne Laufwerksbuchstaben -- traegt hier also nicht; er lebte davon, dass die
// Pfade dort erfunden sein DURFTEN. Die Videos entstehen deshalb unter
// os.tmpdir() und werden danach geloescht; kein Pfad landet in einer
// Repo-Datei.
//
// Was die erzeugte Datei beisteuert, sind sha256, Groesse und Dauer -- also
// genau die Felder, die in q/r/s nicht zur Debatte stehen. Die Werte, gegen die
// geprueft wird (1080x1920, 60 fps, 48000 Hz), stammen aus dem Vertrag und
// stehen im Leser.
// ---------------------------------------------------------------------------

function werkzeugVorhanden(name) {
  try {
    execFileSync(name, ['-version'], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

// Erzeugt ein Video mit genau den uebergebenen Eigenschaften. Alles uebrige ist
// fest auf die Zusicherung des Vertrags verdrahtet: h264 High Level 4.2
// yuv420p, AAC-LC stereo, 7 s (zugesichert sind 6,9 bis 18,7 s).
//
// -preset superfast, NICHT ultrafast: ultrafast schaltet CABAC und 8x8dct ab
// und faellt damit auf Constrained Baseline zurueck, obwohl -profile:v high
// dabeisteht. Das waere eine ZWEITE Abweichung und wuerde den Nachweis
// unbrauchbar machen. Nachgemessen in DHa, nicht vermutet.
function baueVideo(ziel, { groesse, bildrate, abtastrate }) {
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=blue:size=${groesse}:rate=${bildrate}:duration=7`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${abtastrate}:duration=7`,
    '-c:v', 'libx264', '-preset', 'superfast', '-profile:v', 'high', '-level:v', '4.2',
    '-pix_fmt', 'yuv420p', '-r', String(bildrate),
    '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', String(abtastrate), '-ac', '2',
    '-shortest', ziel,
  ], { stdio: 'ignore' });
}

function sondiere(datei) {
  const roh = execFileSync('ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', datei],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const j = JSON.parse(roh);
  const v = j.streams.find((s) => s.codec_type === 'video');
  return { breite: v.width, hoehe: v.height, dauerMs: Math.round(Number(j.format.duration) * 1000) };
}

// Ein Eintrag, der ausser dem Format in JEDEM Feld richtig ist: sha256,
// Groesse, Masse und Dauer werden aus der erzeugten Datei gelesen, die
// Quellspanne wird exakt auf die Dauer gelegt (Abweichung 0 ms).
function eintragFuer(aufnahme, datei) {
  const s = sondiere(datei);
  return {
    kennung: aufnahme + '/1',
    pfad: datei,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(datei)).digest('hex'),
    groesse_bytes: fs.statSync(datei).size,
    dauer_ms: s.dauerMs,
    breite: s.breite,
    hoehe: s.hoehe,
    titel_vorschlag: 'Erfundener Titelvorschlag fuer eine Wegwerfdatei',
    transkript: 'erfundenes transkript fuer eine wegwerfdatei',
    quelle_von_ms: 100000,
    quelle_bis_ms: 100000 + s.dauerMs,
    urteil: 'ja',
  };
}

function alsUebergabe(aufnahme, eintrag) {
  return JSON.stringify({
    artifact_type: 'matrix_auto_cutter_shorts_uebergabe',
    schema_version: '1.0',
    aufnahme,
    erzeugt_am: '2026-01-02T04:05:06+02:00',
    shorts: [eintrag],
  });
}

test('die Plattenpruefung lehnt ab, was der Zusicherung nicht entspricht', (t) => {
  if (!werkzeugVorhanden('ffmpeg') || !werkzeugVorhanden('ffprobe')) {
    t.skip('ffmpeg oder ffprobe fehlt -- die Ablehnungsrichtung der Plattenpruefung ' +
      'lief NICHT. Das ist keine bestandene Pruefung, sondern eine ausgelassene.');
    return;
  }

  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'dha-uebergabe-'));
  try {
    const V = (n) => path.join(wurzel, n);

    // Genau eine Abweichung je Datei, alles uebrige gleich.
    baueVideo(V('konform.mp4'), { groesse: '1080x1920', bildrate: 60, abtastrate: 48000 });
    baueVideo(V('q.mp4'), { groesse: '1280x720', bildrate: 60, abtastrate: 48000 });
    baueVideo(V('r.mp4'), { groesse: '1080x1920', bildrate: 30, abtastrate: 48000 });
    baueVideo(V('s.mp4'), { groesse: '1080x1920', bildrate: 60, abtastrate: 44100 });

    const bericht = (eintrag) => L.pruefeUebergabe({
      text: alsUebergabe(AUFNAHME, eintrag), wurzel, aufnahme: AUFNAHME, platte: true,
    });
    const pruefe = (eintrag) => alleMaengel(bericht(eintrag));
    const roh = (m) => JSON.stringify(m.map((x) => x.meldung), null, 2);

    // Negativkontrolle zuerst. Ohne sie belegt keiner der Faelle unten, dass
    // die Ablehnung von der EINEN Abweichung kommt und nicht davon, dass die
    // Datei erzeugt statt gerendert ist.
    const konformerEintrag = eintragFuer(AUFNAHME, V('konform.mp4'));
    assert.deepEqual(pruefe(konformerEintrag).map((m) => m.meldung), [],
      'Die vollstaendig konforme Wegwerfdatei muss angenommen werden.');

    // DIb: Der einzige Fall in dieser Datei, in dem `daten` wirklich GEFUELLT
    // ist -- ein angenommener Eintrag, gegen eine echte Datei geprueft. Alles
    // andere hier laeuft ohne Plattenzugriff und bekommt darum null.
    const konformerBericht = bericht(konformerEintrag);
    const durchgereicht = konformerBericht.eintraege[0].daten;
    assert.notEqual(durchgereicht, null);
    assert.deepEqual(Object.keys(durchgereicht), L.PFLICHTFELDER);
    for (const feld of L.PFLICHTFELDER) {
      assert.equal(durchgereicht[feld], konformerEintrag[feld], feld);
    }

    // Ein unbekanntes Feld geht auch hier nicht mit, obwohl der Eintrag
    // angenommen wird.
    const mitZusatz = { ...konformerEintrag, lautheit_lufs: -14.2 };
    const zusatzBericht = bericht(mitZusatz);
    assert.deepEqual(zusatzBericht.eintraege[0].unbekannteFelder, ['lautheit_lufs']);
    assert.equal(zusatzBericht.eintraege[0].angenommen, true);
    assert.ok(!('lautheit_lufs' in zusatzBericht.eintraege[0].daten));
    assert.deepEqual(Object.keys(zusatzBericht.eintraege[0].daten), L.PFLICHTFELDER);

    // Und dieselbe Datei mit --ohne-platte: angenommen, aber nichts durchgereicht.
    const ohnePlatte = L.pruefeUebergabe({
      text: alsUebergabe(AUFNAHME, konformerEintrag), wurzel, aufnahme: AUFNAHME, platte: false,
    });
    assert.equal(ohnePlatte.eintraege[0].angenommen, true);
    assert.equal(ohnePlatte.eintraege[0].daten, null);

    // q) Aufloesung.
    const q = pruefe(eintragFuer(AUFNAHME, V('q.mp4')));
    assert.equal(q.length, 1, roh(q));
    assert.equal(q[0].ebene, 'Platte');
    assert.equal(q[0].meldung, 'Aufloesung ist 1280x720, zugesichert ist 1080x1920.');

    // r) Bildrate.
    const r = pruefe(eintragFuer(AUFNAHME, V('r.mp4')));
    assert.equal(r.length, 1, roh(r));
    assert.equal(r[0].ebene, 'Platte');
    assert.equal(r[0].meldung,
      'Bildrate ist r_frame_rate=30/1 / avg_frame_rate=30/1, zugesichert sind ' +
      'konstant 60 fps (beide Werte muessen 60 ergeben).');

    // s) Abtastrate.
    const s = pruefe(eintragFuer(AUFNAHME, V('s.mp4')));
    assert.equal(s.length, 1, roh(s));
    assert.equal(s[0].ebene, 'Platte');
    assert.equal(s[0].meldung, 'Abtastrate ist 44100 Hz, zugesichert sind 48000 Hz.');

    // DHb (Teil 2): Bis DHa trugen genau diese drei Meldungen feld=null, und
    // ein Test hier hielt das als richtig fest -- ein Test, der einen Defekt
    // festnagelt, kaempft gegen seine eigene Behebung. Er ist umgestellt: jede
    // Formatpruefung nennt jetzt ihre Eigenschaft auch maschinenlesbar.
    assert.equal(q[0].feld, 'aufloesung');
    assert.equal(r[0].feld, 'bildrate');
    assert.equal(s[0].feld, 'abtastrate');
    for (const m of [q[0], r[0], s[0]]) assert.notEqual(m.feld, null);

    // t) Die Datei gibt es nicht. Alle Felder sind vertragskonform -- der Leser
    // darf erst auf der Platte scheitern und keinen Ersatzpfad suchen.
    const tEintrag = eintragFuer(AUFNAHME, V('konform.mp4'));
    tEintrag.pfad = V('gibt-es-nicht.mp4');
    const tM = pruefe(tEintrag);
    assert.equal(tM.length, 1, roh(tM));
    assert.equal(tM[0].ebene, 'Platte');
    assert.equal(tM[0].feld, 'pfad');
    assert.ok(tM[0].meldung.startsWith('Datei nicht vorhanden oder nicht lesbar (ENOENT)'),
      tM[0].meldung);

    // u) groesse_bytes um genau 1 daneben; Datei da, Pruefsumme stimmt.
    const uEintrag = eintragFuer(AUFNAHME, V('konform.mp4'));
    const echt = uEintrag.groesse_bytes;
    uEintrag.groesse_bytes = echt + 1;
    const uM = pruefe(uEintrag);
    assert.equal(uM.length, 1, roh(uM));
    assert.equal(uM[0].ebene, 'Platte');
    assert.equal(uM[0].feld, 'groesse_bytes');
    assert.equal(uM[0].meldung,
      `groesse_bytes ist mit ${echt + 1} angegeben, die Datei hat ${echt} Bytes.`);
  } finally {
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});

test('fehlendes ffprobe fuehrt zur Ablehnung, nicht zur stillen Annahme', (t) => {
  // DHb Teil 3, zweite Haelfte. Der DH-Bericht behauptete das aus dem
  // Quelltext heraus -- "der Zweig ist geschrieben, aber nicht ausgefuehrt".
  // Hier wird er ausgefuehrt: dieselbe, in jedem Feld richtige Uebergabe
  // einmal mit und einmal ohne erreichbares ffprobe.
  if (!werkzeugVorhanden('ffmpeg') || !werkzeugVorhanden('ffprobe')) {
    t.skip('ffmpeg oder ffprobe fehlt -- der Vergleich mit und ohne ffprobe lief NICHT. ' +
      'Das ist keine bestandene Pruefung, sondern eine ausgelassene.');
    return;
  }

  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'dhb-ffprobe-'));
  const altePfadliste = process.env.PATH;
  try {
    const datei = path.join(wurzel, 'konform.mp4');
    baueVideo(datei, { groesse: '1080x1920', bildrate: 60, abtastrate: 48000 });

    // Der Eintrag entsteht, SOLANGE ffprobe noch erreichbar ist.
    const eintrag = eintragFuer(AUFNAHME, datei);
    const lauf = () => L.pruefeUebergabe({
      text: alsUebergabe(AUFNAHME, eintrag), wurzel, aufnahme: AUFNAHME, platte: true,
    });

    const mit = lauf();
    assert.deepEqual(alleMaengel(mit), [], 'Mit ffprobe muss dieselbe Datei durchgehen.');
    assert.equal(mit.status, 'angenommen');

    // Jetzt ist ffprobe nicht mehr auffindbar. Der Ordner von node bleibt im
    // Suchpfad, damit nur ffprobe wegfaellt und nicht die halbe Umgebung.
    process.env.PATH = path.dirname(process.execPath);
    assert.equal(werkzeugVorhanden('ffprobe'), false, 'ffprobe muss jetzt unerreichbar sein');

    const ohne = lauf();
    const m = alleMaengel(ohne);
    assert.equal(m.length, 1, JSON.stringify(m.map((x) => x.meldung), null, 2));
    assert.equal(m[0].ebene, 'Platte');
    assert.equal(m[0].feld, 'format');
    assert.ok(m[0].meldung.includes('Format nicht pruefbar: ffprobe konnte nicht ausgefuehrt werden'),
      m[0].meldung);
    assert.ok(m[0].meldung.includes('NICHT angenommen'), m[0].meldung);
    // Der Kern: kein stilles Durchwinken.
    assert.equal(ohne.eintraege[0].angenommen, false);
    assert.equal(ohne.status, 'abgelehnt');
    assert.deepEqual(alleHinweise(ohne), []);
  } finally {
    process.env.PATH = altePfadliste;
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});
