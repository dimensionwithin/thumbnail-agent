'use strict';

// DT: Tests fuer die LESBARE Vorschau.
//
// Der Trockenlauf ist die Pruefung durch den Menschen -- und bis DT druckte er
// je Short die vollstaendige Beschreibung, rund 2400 Zeichen. Bei neun Shorts
// war das eine Wand aus neunmal fast demselben Text; der Zweck der Vorschau
// ging an ihrer Laenge zugrunde.
//
// Was diese Tests festhalten, ist beides zugleich:
//   - dass gekuerzt wird -- je Short nur, was sich unterscheidet;
//   - dass dabei NICHTS verschwindet -- der gemeinsame Teil steht genau
//     einmal, vollstaendig und im Wortlaut, und jedes Feld, das vor DT je
//     Short dastand, steht weiter da;
//   - dass die Kuerzung AUSFAELLT, sobald zwei Shorts im gemeinsamen Teil
//     voneinander abweichen. Eine Kuerzung, die einen Unterschied verschluckt,
//     waere schlimmer als die Wand, gegen die sie gebaut ist;
//   - dass die Lesesperre der Freigabeseite dadurch nicht zur Formalitaet
//     wird. Das ist der einzige Test hier, der einen echten Browser braucht.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const U = require('../src/upload/uploader.js');
const SEITE = require('../src/upload/freigabe-seite.js');

const SEITENTEXT = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'upload', 'freigabe-seite.js'), 'utf8');

// ---------------------------------------------------------------------------
// Werkzeug: eine erfundene Vorbereitung, wie bereiteVor() sie liefert
// ---------------------------------------------------------------------------
//
// Erfunden, und zwar bewusst: geprueft wird hier die AUSGABE, nicht das Lesen
// des Plans -- das hat eigene Tests. Die Videodateien sind echt (kleine
// Wegwerfdateien mit richtiger sha256), damit der Pruefsummenstand derselbe
// Weg geht wie im scharfen Lauf und nicht abgeschaltet werden muss.

const MITTE = [
  '',
  'Zyklen statt News.',
  '--------------------',
  'Links: https://beispiel.invalid/links',
  '',
  'Kein Anlagerat.',
  '',
].join('\n');

function wegwerfordner() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dt-vorschau-'));
}

function baueVorbereitung(ordner, shorts) {
  const auswahl = shorts.map((s, i) => {
    const datei = path.join(ordner, 'short-' + i + '.mp4');
    fs.writeFileSync(datei, Buffer.from('VIDEO-' + i + '-' + 'x'.repeat(64), 'utf8'));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(datei)).digest('hex');
    return {
      kennung: '2026-01-02 03-04-05/' + (i + 1),
      sha256: sha,
      titel: s.titel,
      publish_at: '2026-01-0' + (3 + i) + 'T10:09:00.000Z',
      publish_at_ortszeit: '2026-01-0' + (3 + i) + ' 11:09 (UTC+01:00)',
      pfad: datei,
      beschreibung: s.beschreibung,
      hashtags: s.hashtags,
      herleitung: s.hashtags.map((h) => ({ hashtag: h, quelle: 'immer' })),
    };
  });
  return {
    fehler: [],
    aufnahme: '2026-01-02 03-04-05',
    planPfad: path.join(ordner, 'plan.json'),
    planSha256: 'a'.repeat(64),
    plan: { termine: auswahl.map(() => ({})) },
    konfig: {
      veroeffentlichung: {
        categoryId: '27', defaultLanguage: 'de',
        defaultAudioLanguage: 'de-DE', selfDeclaredMadeForKids: false,
      },
    },
    gedaechtnis: null,
    auswahl,
    schonDa: [],
    nichtGewaehlt: [],
    jetzt: Date.parse('2026-01-01T00:00:00.000Z'),
  };
}

// Drei Shorts aus derselben Vorlage: erste Zeile der Titel, letzte die
// Hashtags, dazwischen bei allen dasselbe.
function dreiGleiche(ordner) {
  return baueVorbereitung(ordner, [1, 2, 3].map((n) => ({
    titel: 'Titel Nummer ' + n,
    hashtags: ['krypto', 'Shorts'],
    beschreibung: 'Titel Nummer ' + n + '\n' + MITTE + '\n#krypto #Shorts',
  })));
}

// ---------------------------------------------------------------------------
// Die Zerlegung -- an Zeilenumbruechen, sonst nichts
// ---------------------------------------------------------------------------

test('zerlegeBeschreibung schneidet an Zeilenumbruechen und deutet nichts', () => {
  const z = U.zerlegeBeschreibung('erste\nmitte a\nmitte b\nletzte');
  assert.equal(z.erste, 'erste');
  assert.equal(z.mitte, 'mitte a\nmitte b');
  assert.equal(z.letzte, 'letzte');
});

test('zerlegeBeschreibung: unter drei Zeilen gibt es keinen Mittelteil', () => {
  assert.equal(U.zerlegeBeschreibung('nur eine Zeile').mitte, '');
  assert.equal(U.zerlegeBeschreibung('nur eine Zeile').letzte, null);
  assert.equal(U.zerlegeBeschreibung('erste\nletzte').mitte, '');
  assert.equal(U.zerlegeBeschreibung('erste\nletzte').letzte, 'letzte');
});

test('gemeinsamerTeil vergleicht Zeichen fuer Zeichen und nimmt nichts an', () => {
  const gleich = U.gemeinsamerTeil([
    { kennung: 'a', beschreibung: 'A\nx\ny\n#1' },
    { kennung: 'b', beschreibung: 'B\nx\ny\n#2' },
  ]);
  assert.equal(gleich.gekuerzt, true);
  assert.equal(gleich.text, 'x\ny');
  assert.equal(gleich.zeilen, 2);

  // Ein einziges Zeichen Unterschied reicht.
  const anders = U.gemeinsamerTeil([
    { kennung: 'a', beschreibung: 'A\nx\ny\n#1' },
    { kennung: 'b', beschreibung: 'B\nx\ny \n#2' },
  ]);
  assert.equal(anders.gekuerzt, false);
  assert.equal(anders.grund, 'abweichung');
  assert.deepEqual(anders.abweichungen.map((x) => x.kennung), ['b']);
});

test('gemeinsamerTeil kuerzt nicht, wenn es nichts zu kuerzen gibt', () => {
  const leer = U.gemeinsamerTeil([{ kennung: 'a', beschreibung: 'erste\nletzte' }]);
  assert.equal(leer.gekuerzt, false);
  const keiner = U.gemeinsamerTeil([]);
  assert.equal(keiner.gekuerzt, false);
});

// ---------------------------------------------------------------------------
// DT-N2: der gemeinsame Teil steht GENAU EINMAL und VOLLSTAENDIG
// ---------------------------------------------------------------------------

test('DT-N2: der gemeinsame Teil steht genau einmal in der Vorschau', () => {
  const ordner = wegwerfordner();
  const text = U.formatiereVorschau(dreiGleiche(ordner));

  // Eine Zeile, die nur im gemeinsamen Teil vorkommt -- eingerueckt mit "| ",
  // wie der Trockenlauf jede Beschreibungszeile einrueckt.
  const probe = '    | Zyklen statt News.';
  const treffer = text.split('\n').filter((z) => z === probe);
  assert.equal(treffer.length, 1, 'die Zeile steht ' + treffer.length + ' mal statt einmal');

  // Und die Ueberschrift des Blocks ebenfalls genau einmal.
  const koepfe = text.split('\n').filter((z) => z.indexOf(U.GEMEINSAM_UEBERSCHRIFT) === 0);
  assert.equal(koepfe.length, 1);
});

test('DT-N2: der gemeinsame Teil steht vollstaendig -- Zeile fuer Zeile', () => {
  const ordner = wegwerfordner();
  const text = U.formatiereVorschau(dreiGleiche(ordner));
  const zeilen = text.split('\n');

  const kopf = zeilen.findIndex((z) => z.indexOf(U.GEMEINSAM_UEBERSCHRIFT) === 0);
  assert.ok(kopf >= 0, 'der Block fehlt');
  const ab = zeilen.findIndex((z, i) => i > kopf && z.indexOf('    | ') === 0);
  assert.ok(ab > kopf, 'der Wortlaut fehlt');
  let bis = ab;
  while (bis < zeilen.length && zeilen[bis].indexOf('    | ') === 0) bis += 1;

  // Aus dem Block zurueckgerechnet muss WOERTLICH der gemeinsame Teil
  // herauskommen -- kein Zeichen weniger, keins mehr.
  const zurueck = zeilen.slice(ab, bis).map((z) => z.slice('    | '.length)).join('\n');
  assert.equal(zurueck, MITTE);
});

test('DT-N2: die vollstaendige Beschreibung steht NICHT mehr je Short', () => {
  const ordner = wegwerfordner();
  const text = U.formatiereVorschau(dreiGleiche(ordner));
  // Die Zeile "Kein Anlagerat." kommt in jeder der drei Beschreibungen vor.
  // Stuenden die noch einzeln da, faende sie sich dreimal.
  const treffer = text.split('\n').filter((z) => z === '    | Kein Anlagerat.');
  assert.equal(treffer.length, 1);
  // Statt dessen je Short die Zeile, die sagt, was dazwischen steht.
  const hinweise = text.split('\n').filter((z) => z.indexOf('    [ dazwischen der gemeinsame Teil:') === 0);
  assert.equal(hinweise.length, 3);
});

// ---------------------------------------------------------------------------
// DT-N5: keine Angabe ist beim Kuerzen verlorengegangen
// ---------------------------------------------------------------------------

test('DT-N5: je Short stehen alle Angaben wie vor der Kuerzung', () => {
  const ordner = wegwerfordner();
  const v = dreiGleiche(ordner);
  const text = U.formatiereVorschau(v);
  const s = v.auswahl[0];

  // Kennung mit Zaehler
  assert.ok(text.includes('[1/3]  ' + s.kennung));
  // Titel MIT Zeichenzahl
  assert.ok(text.includes('  Titel (' + U.zaehleTitelZeichen(s.titel) + ' Zeichen):   ' + s.titel));
  // Termin, beide Angaben
  assert.ok(text.includes('  publishAt UTC:         ' + s.publish_at));
  assert.ok(text.includes('  publishAt Ortszeit:    ' + s.publish_at_ortszeit));
  // Datei
  assert.ok(text.includes('  Datei:                 ' + s.pfad));
  // Pruefsummenstand
  assert.ok(text.includes('  Pruefsumme:            stimmt (sha256 der Datei = sha256 des Plans)'));
  // Hashtags mit Anzahl UND Herleitung je Hashtag
  assert.ok(text.includes('  Hashtags (2):'));
  assert.ok(text.includes('    #krypto           immer'));
  assert.ok(text.includes('    #Shorts           immer'));
  // Zeichen- und Bytezahl der VOLLSTAENDIGEN Beschreibung -- nicht der gekuerzten
  assert.ok(text.includes('  Beschreibung (' + s.beschreibung.length + ' Zeichen, ' +
    Buffer.byteLength(s.beschreibung, 'utf8') + ' Bytes UTF-8)'));
  // Erste und letzte Zeile der Beschreibung
  assert.ok(text.includes('    | Titel Nummer 1'));
  assert.ok(text.includes('    | #krypto #Shorts'));
});

test('DT: die Kuerzung greift auch bei der Lage des Laufs nicht', () => {
  const ordner = wegwerfordner();
  const v = dreiGleiche(ordner);
  const text = U.formatiereVorschau(v);
  for (const zeile of ['Aufnahme:', 'Planungsdatei:', '  sha256:', '  Termine im Plan:',
    'Gedaechtnis:', 'Jetzt:', 'privacyStatus:', 'Fuer alle gleich:', 'Dieser Lauf:']) {
    assert.ok(text.includes(zeile), zeile + ' fehlt');
  }
});

// ---------------------------------------------------------------------------
// DT-N3: weichen zwei Shorts ab, faellt die Zusammenfassung aus
// ---------------------------------------------------------------------------

test('DT-N3: abweichender gemeinsamer Teil -- Befund da, Zusammenfassung weg', () => {
  const ordner = wegwerfordner();
  const v = baueVorbereitung(ordner, [
    { titel: 'Titel A', hashtags: ['krypto'], beschreibung: 'Titel A\n' + MITTE + '\n#krypto' },
    { titel: 'Titel B', hashtags: ['krypto'],
      beschreibung: 'Titel B\n' + MITTE.replace('Kein Anlagerat.', 'Doch ein Anlagerat.') + '\n#krypto' },
  ]);
  const text = U.formatiereVorschau(v);

  // Der Befund steht da -- und zwar VOR dem ersten Short, wo man ihn sieht.
  assert.ok(text.includes(U.GEMEINSAM_BEFUND), 'der Befund fehlt');
  assert.ok(text.indexOf(U.GEMEINSAM_BEFUND) < text.indexOf('[1/2]'),
    'der Befund steht hinter den Shorts -- dort wird er ueberlesen');
  // Er benennt beide Seiten.
  assert.ok(text.includes(v.auswahl[0].kennung));
  assert.ok(text.includes('WEICHT AB:                     ' + v.auswahl[1].kennung));

  // Die Zusammenfassung faellt aus.
  assert.ok(!text.includes(U.GEMEINSAM_UEBERSCHRIFT), 'die Zusammenfassung steht trotzdem da');
  assert.ok(!text.includes('    [ dazwischen der gemeinsame Teil:'));

  // Und jede Beschreibung steht wieder einzeln und vollstaendig da.
  assert.equal(text.split('\n').filter((z) => z === '    | Zyklen statt News.').length, 2);
  assert.ok(text.includes('    | Kein Anlagerat.'));
  assert.ok(text.includes('    | Doch ein Anlagerat.'));
  for (const s of v.auswahl) {
    for (const zeile of s.beschreibung.split('\n')) {
      assert.ok(text.includes('    | ' + zeile), 'fehlende Zeile: ' + JSON.stringify(zeile));
    }
  }
});

// ---------------------------------------------------------------------------
// Punkt 3: im Terminal aendert sich am Termin NICHTS
// ---------------------------------------------------------------------------

test('DT: die Vorschau enthaelt keine Farbcodes -- im Terminal gibt es keine', () => {
  const ordner = wegwerfordner();
  const text = U.formatiereVorschau(dreiGleiche(ordner));
  assert.ok(!/\[/.test(text), 'in der Ausgabe stehen ANSI-Folgen');
});

// ---------------------------------------------------------------------------
// Die beiden Marken -- an zwei Stellen, und sie muessen dasselbe sagen
// ---------------------------------------------------------------------------

test('DT: Uploader und Seite kennen dieselben Marken', () => {
  assert.ok(SEITENTEXT.includes("const GEMEINSAM_MARKE = '" + U.GEMEINSAM_UEBERSCHRIFT + "';"),
    'die Seite sucht eine andere Ueberschrift, als der Uploader schreibt');
  assert.ok(SEITENTEXT.includes("const BEFUND_MARKE = '" + U.GEMEINSAM_BEFUND + "';"),
    'die Seite sucht einen anderen Befund, als der Uploader schreibt');
});

test('DT: die Seite faerbt genau die Terminzeilen, die der Uploader schreibt', () => {
  const ordner = wegwerfordner();
  const text = U.formatiereVorschau(dreiGleiche(ordner));
  const muster = /^\s*publishAt (UTC|Ortszeit):/;
  assert.ok(SEITENTEXT.includes('const TERMINZEILE = ' + muster.toString() + ';'),
    'das Muster der Seite ist ein anderes als das hier gepruefte');
  const treffer = text.split('\n').filter((z) => muster.test(z));
  assert.equal(treffer.length, 6, 'drei Shorts, zwei Terminzeilen je Short');
});

// ---------------------------------------------------------------------------
// DT-N4: DIE LESESPERRE -- im echten Browser, gegen die echte Seite
// ---------------------------------------------------------------------------
//
// Dieser Test baut die Seite mit baueSeite(), gibt ihr ueber eine abgefangene
// /kette-Antwort die ECHTE Ausgabe eines Trockenlaufs und klickt dann so, wie
// ein Mensch klickt. Geprueft wird der Zustand des scharfen Knopfes -- und
// zwar der, den der Browser wirklich hat, nicht der, den der Quelltext
// verspricht.
//
// Warum ueberhaupt ein Browser: die Sperre IST eine Sache des Browsers. Der
// Dienst kann nicht wissen, ob ein Mensch gelesen hat; er kann nur wissen, ob
// eine Vorschau ueberhaupt gerechnet wurde, ob sie zu diesem Plan gehoert und
// ob dieselbe Pruefsumme noch gilt -- und genau das prueft er weiter
// (schritt3Bereit, pruefeErmaechtigung). Ein Feld "gelesen", das der Browser
// mitschickt, waere kein Beleg dafuer, dass jemand gelesen hat, sondern nur
// eine Behauptung mehr. Darum bleibt die Sperre hier, und darum wird sie hier
// geprueft.

let chromium = null;
let playwrightGrund = null;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  playwrightGrund = 'playwright ist nicht installiert (' + e.code + ')';
}

// Eine Vorschau, die sicher laenger ist als das Feld (max-height 460px).
function langeVorschau() {
  const ordner = wegwerfordner();
  return U.formatiereVorschau(dreiGleiche(ordner));
}

function ketteMit(text) {
  return {
    aufnahme: '2026-01-02 03-04-05',
    plan_vorhanden: true,
    plan_pfad: 'data/plaene/2026-01-02 03-04-05.json',
    eigene_projektwurzel: true,
    lauf: null,
    meldung: null,
    vorschau: {
      text,
      befehl: 'node src/upload/uploader.js --plan="2026-01-02 03-04-05"',
      anzahl: 3,
      kennungen: [],
      termine_im_plan: 3,
      schon_hochgeladen: 0,
      plan_sha256: 'a'.repeat(64),
      erstellt_am: '2026-01-02T03:04:05.000Z',
      kanal_name: 'Prüfkanal',
      kanal_bekannt: true,
      kanal_grund: null,
      kanal_erzeugt_am: '2026-01-01T00:00:00.000Z',
    },
    schritt3: { bereit: true, grund: null },
  };
}

function seiteMit(text) {
  return SEITE.baueSeite({
    aufnahme: '2026-01-02 03-04-05',
    freigabePfad: 'data/freigaben/2026-01-02 03-04-05.json',
    token: 'x'.repeat(32),
    eingabeSha256: 'b'.repeat(64),
    karten: [],
    stand: {},
  });
}

// Die Seite braucht eine Herkunft: sie holt /kette relativ, und ihre CSP sagt
// connect-src 'self'. Ein about:blank haette beides nicht. Es geht dabei kein
// Byte ins Netz -- jede Anfrage dieser Herkunft wird hier beantwortet.
const HERKUNFT = 'http://freigabe.pruefung/';

async function mitSeite(text, arbeit) {
  const browser = await chromium.launch();
  try {
    const seite = await browser.newPage();
    const html = seiteMit(text);
    await seite.route('**/*', (route) => {
      if (route.request().url().indexOf('/kette') >= 0) {
        return route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify(ketteMit(text)),
        });
      }
      return route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8', body: html,
      });
    });
    await seite.goto(HERKUNFT, { waitUntil: 'load' });
    await seite.waitForSelector('#vorschauBloecke .block', { timeout: 20000 });
    await arbeit(seite);
  } finally {
    await browser.close();
  }
}

// Eine Zeitgrenze je Browsertest: ein haengender Browser soll FEHLSCHLAGEN und
// nicht die ganze Testreihe stehenlassen.
//
// Das Feld skip wird nur gesetzt, wenn es einen Grund GIBT: node:test
// ueberspringt bereits, wenn der Schluessel vorhanden ist -- auch mit dem Wert
// null. Ein Test, der sich stillschweigend selbst abschaltet, ist schlimmer
// als keiner.
const BROWSERTEST = playwrightGrund
  ? { skip: playwrightGrund, timeout: 60000 }
  : { timeout: 60000 };

test('DT-N4: der scharfe Knopf bleibt gesperrt, solange der gemeinsame Teil zu ist',
  BROWSERTEST, async () => {
    await mitSeite(langeVorschau(), async (seite) => {
      // Der Dienst sagt "bereit" -- gesperrt ist der Knopf allein wegen der Sperre.
      assert.equal(await seite.isDisabled('#schritt3'), true);

      // Bis ganz nach unten scrollen reicht NICHT, solange zugeklappt ist.
      await seite.evaluate(() => {
        const b = document.getElementById('vorschauBloecke');
        b.scrollTop = b.scrollHeight;
        b.dispatchEvent(new Event('scroll'));
      });
      assert.equal(await seite.isDisabled('#schritt3'), true,
        'zugeklappt bis unten gescrollt hat die Sperre geoeffnet');
      assert.match(await seite.textContent('#gelesen'), /noch zugeklappt/);
    });
  });

test('DT-N4: aufklappen allein reicht auch nicht -- danach gilt die alte Regel',
  BROWSERTEST, async () => {
    await mitSeite(langeVorschau(), async (seite) => {
      await seite.evaluate(() => {
        const b = document.getElementById('vorschauBloecke');
        b.scrollTop = 0;
      });
      await seite.click('#vorschauBloecke .aufklapp button');
      assert.equal(await seite.isDisabled('#schritt3'), true,
        'aufklappen allein hat die Sperre geoeffnet');

      // Jetzt bis unten -- und erst jetzt geht der Knopf auf.
      await seite.evaluate(() => {
        const b = document.getElementById('vorschauBloecke');
        b.scrollTop = b.scrollHeight;
        b.dispatchEvent(new Event('scroll'));
      });
      assert.equal(await seite.isDisabled('#schritt3'), false, 'die Sperre laesst sich nicht oeffnen');
      assert.match(await seite.textContent('#gelesen'), /bis zum Ende gesehen/);
    });
  });

test('DT-N4: der zugeklappte Teil steht vollstaendig im Baum -- nur unsichtbar',
  BROWSERTEST, async () => {
    const text = langeVorschau();
    await mitSeite(text, async (seite) => {
      const gefunden = await seite.evaluate(() => {
        const b = document.getElementById('vorschauBloecke');
        return b.textContent.split('\n').filter((z) => z === '    | Zyklen statt News.').length;
      });
      assert.equal(gefunden, 1, 'der gemeinsame Teil steht ' + gefunden + ' mal im Baum');
      // und er ist zugeklappt.
      assert.equal(await seite.isVisible('#vorschauBloecke .aufklapp + pre'), false);
    });
  });

test('DT-N4: die Terminzeilen sind gefaerbt, beide, und im Wortlaut unveraendert',
  BROWSERTEST, async () => {
    await mitSeite(langeVorschau(), async (seite) => {
      const termine = await seite.evaluate(() =>
        Array.from(document.querySelectorAll('#vorschauBloecke .termin')).map((n) => n.textContent.replace(/\n$/, '')));
      assert.equal(termine.length, 6, 'drei Shorts, zwei Terminzeilen je Short');
      assert.ok(termine.some((z) => /^\s*publishAt UTC:/.test(z)));
      assert.ok(termine.some((z) => /^\s*publishAt Ortszeit:/.test(z)));
      const farbe = await seite.evaluate(() =>
        getComputedStyle(document.querySelector('#vorschauBloecke .termin')).color);
      const rundum = await seite.evaluate(() =>
        getComputedStyle(document.querySelector('#vorschauBloecke pre')).color);
      assert.notEqual(farbe, rundum, 'der Termin hat dieselbe Farbe wie der uebrige Text');
    });
  });

// DT-N4, die serverseitige Haelfte: die Sperre des Browsers ist die zweite
// Huerde, nicht die einzige. Der Dienst laesst Schritt 3 unabhaengig davon
// nicht durch, solange keine Vorschau gerechnet wurde -- eine Anfrage, die
// diesen Browser umgeht, faellt dort. Dass DT daran nichts geaendert hat,
// steht hier und nicht nur in einem Kommentar.
test('DT-N4: der Dienst laesst Schritt 3 ohne gerechnete Vorschau weiter nicht durch', () => {
  const S = require('../src/upload/freigabe-server.js');
  const ohne = S.schritt3Bereit({ kette: S.neueKette() });
  assert.equal(ohne.bereit, false);
  assert.match(ohne.grund, /Schritt 1 ist noch nicht gelaufen/);

  const leer = S.neueKette();
  leer.vorschau = { anzahl: 0, kanal_bekannt: true, kanal_name: 'x' };
  assert.equal(S.schritt3Bereit({ kette: leer }).bereit, false);
});

test('DT-N4: ohne gemeinsamen Teil bleibt es bei der alten Regel',
  BROWSERTEST, async () => {
    // Ein Lauf mit abweichendem gemeinsamem Teil: kein Knopf, keine zusaetzliche
    // Huerde -- eine Huerde, die sich nicht nehmen LAESST, waere ein Fehler.
    const ordner = wegwerfordner();
    const v = baueVorbereitung(ordner, [
      { titel: 'Titel A', hashtags: ['krypto'], beschreibung: 'Titel A\n' + MITTE + '\n#krypto' },
      { titel: 'Titel B', hashtags: ['krypto'],
        beschreibung: 'Titel B\n' + MITTE.replace('Kein Anlagerat.', 'Doch nicht.') + '\n#krypto' },
    ]);
    await mitSeite(U.formatiereVorschau(v), async (seite) => {
      assert.equal(await seite.locator('#vorschauBloecke .aufklapp button').count(), 0);
      assert.equal(await seite.isDisabled('#schritt3'), true);
      await seite.evaluate(() => {
        const b = document.getElementById('vorschauBloecke');
        b.scrollTop = b.scrollHeight;
        b.dispatchEvent(new Event('scroll'));
      });
      assert.equal(await seite.isDisabled('#schritt3'), false);
    });
  });
