'use strict';

// ---------------------------------------------------------------------------
// EG: Tests fuer den Beipackzettel-Leser
// ---------------------------------------------------------------------------
//
// Was hier festgehalten wird, ist nicht "es laeuft", sondern "es wirkt":
//
//   1. Alle 37 Zeilen der Zustandsmatrix, je ein Test, jeder auf den Ausgang
//      SEINER Zeile -- und ein Test, der die Matrix des Moduls gegen die
//      Tabelle im Vertrag haelt, damit eine fehlende Zeile laut auffaellt und
//      nicht als gruen durchgeht.
//   2. Kein Ausgang teilt sich eine Meldung. Die 37 Meldungen werden in den
//      37 Laeufen EINGESAMMELT und maschinell auf Verschiedenheit geprueft.
//      Dass diese Pruefung wirklich zuschnappt, wird an einer absichtlich
//      herbeigefuehrten Kollision vorgefuehrt.
//   3. Der Fall EP. 17, am kaputten Stand vorgefuehrt: die Regel der Fassung 2
//      ("nur Bilder nach dem Render-Zeitstempel") wird im Test nachgebaut und
//      verwirft das einzige Bild; die Regel der Fassung 3 findet es; und der
//      Weg zurueck zur alten Regel ist verriegelt.
//   4. Die Weitung des Fensters wird GESAGT, nicht nur getan -- nachgewiesen
//      an zwei Laeufen, die sich nur darin unterscheiden.
//   5. Das Modul schreibt nichts. Vorgefuehrt, nicht behauptet: die
//      schreibenden fs-Funktionen werden scharfgestellt, der volle Durchlauf
//      laeuft dagegen, und danach wird die Falle provoziert.
//
// Alle Tests laufen gegen Wegwerfordner unter dem Temp-Verzeichnis. Keiner
// fasst den echten Export- oder Renderordner an.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const Z = require('../src/upload/zettel-leser.js');

const VERTRAG = path.join(__dirname, '..', 'docs', 'VERTRAG-longform.md');

// Die Aufnahme dieses Laufs. Sie ist erfunden und traegt keinen echten
// Datenbezug; der Fall EP. 17 unten benutzt bewusst dieselbe.
const AUFNAHME = '2026-08-31 17-36-21';
const TAG = '2026-08-31';
const TAG_DAVOR = '2026-08-30';
const TAG_DANACH = '2026-09-01';
const ANDERE = '2026-08-30 09-12-00';

// ---------------------------------------------------------------------------
// Werkzeug
// ---------------------------------------------------------------------------

function wegwerfordner(marke) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eg-zettel-' + marke + '-'));
}

function sha256(puffer) {
  return crypto.createHash('sha256').update(puffer).digest('hex');
}

// Legt ein Bild ab. tag: 'JJJJ-MM-TT' setzt die mtime auf 12:00 Ortszeit
// dieses Tages; ein Date setzt sie woertlich.
function legeBild(ordner, name, marke, tag) {
  const inhalt = Buffer.from('BILD:' + marke, 'utf8');
  const voll = path.join(ordner, name);
  fs.writeFileSync(voll, inhalt);
  if (tag) {
    const d = tag instanceof Date
      ? tag
      : new Date(Number(tag.slice(0, 4)), Number(tag.slice(5, 7)) - 1,
        Number(tag.slice(8, 10)), 12, 0, 0);
    fs.utimesSync(voll, d, d);
  }
  return { name, inhalt, sha256: sha256(inhalt), bytes: inhalt.length };
}

const WEG = Symbol('feld weglassen');

// Legt Bild + Zettel ab. `felder` ueberschreibt die Vorgaben; der Wert WEG
// laesst das Feld ganz weg (das ist der Unterschied zwischen "null" und
// "fehlt", an dem die Zeilen F der Matrix haengen).
function legeZettel(ordner, basis, felder) {
  const bild = legeBild(ordner, basis + '.jpg', basis, null);
  const zettel = Object.assign({
    schema_version: 1,
    exportiert_am: TAG + 'T12:00:00+02:00',
    bild: { dateiname: bild.name, sha256: bild.sha256, bytes: bild.bytes },
    videotitel: 'Ein Titel fuer ' + basis,
    episode: 'EP. 18',
    datum: TAG,
    format: 'standard',
    chart_quelle: null,
    aufnahme: null,
    aufnahme_herkunft: 'leer',
  }, felder || {});
  for (const k of Object.keys(zettel)) if (zettel[k] === WEG) delete zettel[k];
  const name = basis + '.json';
  fs.writeFileSync(path.join(ordner, name), JSON.stringify(zettel, null, 2));
  return { zettelname: name, bild };
}

function befund(ordner, extra) {
  return Z.befundeKandidaten(Object.assign({ aufnahme: AUFNAHME, exportOrdner: ordner }, extra));
}

function zettelVon(b, name) {
  const zt = b.zettel.find((x) => x.dateiname === name);
  assert.ok(zt, 'Zettel ' + name + ' steht nicht im Befund.');
  return zt;
}

// ---------------------------------------------------------------------------
// Die Matrix des Moduls gegen die Tabelle im Vertrag
// ---------------------------------------------------------------------------

function matrixAusVertrag() {
  const zeilen = fs.readFileSync(VERTRAG, 'utf8').split(/\r?\n/);
  const kopf = zeilen.findIndex((l) => l.startsWith('| Nr. | H | N | F | Ausgang'));
  assert.ok(kopf >= 0, 'Im Vertrag steht keine Kopfzeile der Zustandsmatrix.');
  const gefunden = [];
  for (let i = kopf + 2; i < zeilen.length; i++) {
    const l = zeilen[i];
    if (!l.startsWith('|')) break;
    const teile = l.split('|').map((s) => s.trim());
    const nr = Number(teile[1]);
    if (!Number.isInteger(nr)) break;
    gefunden.push({
      nr,
      h: teile[2] === 'kein Zettel' ? null : (teile[2] || null),
      n: teile[3] === '' ? null : teile[3],
      f: teile[4],
      ausgangText: teile[5],
    });
  }
  return gefunden;
}

function ausgangSchluessel(text) {
  if (text.includes('Rang 1')) return 'rang1_regel';
  if (text.includes('Rang 2a')) return 'rang2a_vorschlag';
  if (text.includes('Rang 2b')) return 'rang2b_vorschlag';
  if (text.includes('Rang 3')) return 'rang3_vorschlag';
  if (text.includes('Abbruch')) return 'abbruch';
  if (text.includes('uebergangen')) return 'uebergangen';
  if (text.includes('kein Kandidat')) return 'kein_kandidat';
  throw new Error('Unbekannter Ausgang in der Vertragstabelle: ' + JSON.stringify(text));
}

test('Die Matrix des Moduls ist die Tabelle des Vertrags -- 37 Zeilen, Achsen und Ausgang', () => {
  const ausVertrag = matrixAusVertrag();
  assert.equal(ausVertrag.length, 37,
    'Der Vertrag traegt ' + ausVertrag.length + ' Matrixzeilen, nicht 37.');

  const fehlen = [];
  for (const v of ausVertrag) {
    const m = Z.MATRIX_NACH_NR.get(v.nr);
    if (!m) { fehlen.push(v.nr); continue; }
    assert.equal(m.h, v.h, 'Zeile ' + v.nr + ': Achse H');
    assert.equal(m.n, v.n, 'Zeile ' + v.nr + ': Achse N');
    assert.equal(m.f, v.f, 'Zeile ' + v.nr + ': Achse F');
    assert.equal(m.ausgang, ausgangSchluessel(v.ausgangText),
      'Zeile ' + v.nr + ': Ausgang (Vertrag: ' + v.ausgangText + ')');
  }
  assert.deepEqual(fehlen, [],
    'Im Modul FEHLEN Matrixzeilen: ' + fehlen.join(', ') + '. Das ist kein Gruen.');
  assert.equal(Z.MATRIX.length, 37, 'Das Modul traegt mehr oder weniger als 37 Zeilen.');
});

test('EH: der Fenstervorbehalt des Vertrags und FENSTERABHAENGIG sind dieselbe Menge', () => {
  // Fassung 4 des Vertrags markiert die fensterabhaengigen Zeilen mit
  // "(im Fenster)". Bis dahin trugen die Zeilen fuer Zettel einer ANDEREN
  // Aufnahme (4-6, 13-15, 31-33) den Vorbehalt nicht, obwohl die Anmerkung
  // unter der Tabelle sie nie zu den immer genannten zaehlte -- Tabelle und
  // Anmerkung sagten Verschiedenes. Dieser Test haelt fest, dass sie es nicht
  // wieder tun.
  const ausVertrag = matrixAusVertrag();
  const mitVorbehalt = ausVertrag
    .filter((v) => v.ausgangText.includes('(im Fenster)'))
    .map((v) => v.nr).sort((a, b) => a - b);
  const imModul = [...Z.FENSTERABHAENGIG].sort((a, b) => a - b);
  assert.deepEqual(imModul, mitVorbehalt,
    'Der Vertrag markiert die Zeilen ' + mitVorbehalt.join(', ') +
    ' mit "(im Fenster)", das Modul fuehrt ' + imModul.join(', ') + '.');
  assert.ok(mitVorbehalt.length > 0, 'Im Vertrag traegt keine Zeile den Vorbehalt.');

  // Und die beiden Mengen zerlegen die 37 Zeilen vollstaendig und ohne
  // Ueberschneidung: jede Zeile wird entweder immer genannt oder nur im
  // Fenster. Eine Zeile, die in keiner der beiden steht, waere eine, ueber
  // deren Sichtbarkeit niemand entschieden hat.
  const beide = [...Z.IMMER_GENANNT].filter((n) => Z.FENSTERABHAENGIG.has(n));
  assert.deepEqual(beide, [], 'Zeilen in beiden Mengen: ' + beide.join(', '));
  const alle = [...Z.IMMER_GENANNT, ...Z.FENSTERABHAENGIG].sort((a, b) => a - b);
  assert.deepEqual(alle, Array.from({ length: 37 }, (_, i) => i + 1));
});

// ---------------------------------------------------------------------------
// NACHWEIS 1: alle 37 Zeilen, je ein Test
// ---------------------------------------------------------------------------

const HERKUNFT_FELD = { B: 'bestaetigt', U: 'unbestaetigt', L: 'leer', F: WEG };
const NAME_FELD = { G: AUFNAHME, A: ANDERE, K: null };
// '?' ist bewusst ein UNBEKANNTES Preset und nicht null: der Vertrag sagt, ein
// anderer Wert sei "kein lesbares Format" (Spalte ?), nicht "kein Zettel".
const FORMAT_FELD = { Z: 'standard', N: 'livestream', '?': 'holzweg' };

// Je Zeile: die Wortstuecke, die in der Meldung stehen MUESSEN. Der Wortlaut
// ist im Vertrag nicht zugesagt, die Unterscheidung schon -- geprueft wird
// darum, was die Zeile von ihren Nachbarn trennt.
const WORTSTUECKE = {
  1: ['nennt diese Aufnahme', 'bestaetigt', 'Format standard'],
  2: ['bestaetigt', 'Format livestream', 'keine Aufnahme hat', 'neu exportieren'],
  3: ['bestaetigt', 'kein lesbares Format'],
  4: ['gehoert bestaetigt zur Aufnahme ' + ANDERE],
  5: ['gehoert bestaetigt zur Aufnahme ' + ANDERE, 'Format livestream'],
  6: ['gehoert bestaetigt zur Aufnahme ' + ANDERE, 'ohne lesbares Format'],
  7: ['sagt bestaetigt', 'nennt keine Aufnahme', 'Format standard', 'Widerspruechlich'],
  8: ['sagt bestaetigt', 'nennt keine Aufnahme', 'Format livestream', 'Widerspruechlich'],
  9: ['sagt bestaetigt', 'nennt keine Aufnahme', 'ohne lesbares Format', 'Widerspruechlich'],
  10: ['nennt diese Aufnahme', 'unbestaetigt', 'Chart hat sich', 'Format standard'],
  11: ['nennt diese Aufnahme', 'unbestaetigt', 'Format livestream'],
  12: ['nennt diese Aufnahme', 'unbestaetigt', 'ohne lesbares Format'],
  13: ['gehoert unbestaetigt zur Aufnahme ' + ANDERE],
  14: ['gehoert unbestaetigt zur Aufnahme ' + ANDERE, 'Format livestream'],
  15: ['gehoert unbestaetigt zur Aufnahme ' + ANDERE, 'ohne lesbares Format'],
  16: ['sagt unbestaetigt', 'nennt keine Aufnahme', 'Format standard', 'Widerspruechlich'],
  17: ['sagt unbestaetigt', 'nennt keine Aufnahme', 'Format livestream', 'Widerspruechlich'],
  18: ['sagt unbestaetigt', 'nennt keine Aufnahme', 'ohne lesbares Format', 'Widerspruechlich'],
  19: ['sagt leer', 'nennt doch diese Aufnahme', 'Format standard', 'Widerspruechlich'],
  20: ['sagt leer', 'nennt doch diese Aufnahme', 'Format livestream', 'Widerspruechlich'],
  21: ['sagt leer', 'nennt doch diese Aufnahme', 'ohne lesbares Format', 'Widerspruechlich'],
  22: ['sagt leer', 'nennt doch die Aufnahme ' + ANDERE, 'Format standard', 'Widerspruechlich'],
  23: ['sagt leer', 'nennt doch die Aufnahme ' + ANDERE, 'Format livestream', 'Widerspruechlich'],
  24: ['sagt leer', 'nennt doch die Aufnahme ' + ANDERE, 'ohne lesbares Format', 'Widerspruechlich'],
  25: ['ohne Aufnahme (leer)', 'exportiert am', 'Format standard'],
  26: ['ohne Aufnahme (leer)', 'Format livestream', 'keine Aufnahme hat'],
  27: ['ohne Aufnahme (leer)', 'ohne lesbares Format'],
  28: ['nennt diese Aufnahme ohne Herkunftsangabe', 'wie unbestaetigt behandelt',
    'Format standard'],
  29: ['nennt diese Aufnahme ohne Herkunftsangabe', 'Format livestream'],
  30: ['nennt diese Aufnahme ohne Herkunftsangabe', 'ohne lesbares Format'],
  31: ['nennt die Aufnahme ' + ANDERE + ' ohne Herkunftsangabe'],
  32: ['nennt die Aufnahme ' + ANDERE + ' ohne Herkunftsangabe', 'Format livestream'],
  33: ['nennt die Aufnahme ' + ANDERE + ' ohne Herkunftsangabe', 'ohne lesbares Format'],
  34: ['von vor dem Nachtrag', 'exportiert am', 'Format standard'],
  35: ['von vor dem Nachtrag', 'Format livestream', 'keine Aufnahme hat'],
  36: ['von vor dem Nachtrag', 'ohne lesbares Format'],
  37: ['kein Zettel', 'entstanden', 'Bytes', 'Format unbekannt'],
};

// Die Wirkung auf den Befund, je Zeile. Das ist der Teil, der einen Test von
// "kein Absturz" unterscheidet.
function pruefeWirkung(nr, b, name) {
  if (nr === 1) {
    assert.equal(b.rang, 1);
    assert.ok(b.regel && b.regel.dateiname === name, 'Zeile 1 wird als Regel genommen.');
    assert.equal(b.vorschlag, null, 'Rang 1 ist kein Vorschlag.');
    assert.equal(b.abbruch, null, 'Zeile 1 bricht nicht ab.');
    return;
  }
  if (nr === 2 || nr === 3) {
    assert.ok(b.abbruch, 'Zeile ' + nr + ' muss abbrechen.');
    assert.equal(b.abbruch.code, 'bestaetigter_zettel_mit_formatfehler');
    assert.equal(b.abbruch.nach, '2.7');
    assert.equal(b.regel, null);
    assert.equal(b.vorschlag, null);
    return;
  }
  if (nr === 10 || nr === 28 || nr === 25 || nr === 34) {
    assert.equal(b.rang, 2, 'Zeile ' + nr + ' ist ein Rang-2-Kandidat.');
    assert.ok(b.vorschlag && b.vorschlag.dateiname === name,
      'Zeile ' + nr + ' steht als Vorschlag, nicht als Regel.');
    assert.equal(b.regel, null, 'Rang 2 wird nie zur Regel.');
    assert.equal(b.abbruch, null);
    return;
  }
  if (nr === 37) {
    assert.equal(b.rang, 3);
    assert.equal(b.vorschlaege.length, 1);
    assert.equal(b.vorschlaege[0].dateiname, name);
    assert.ok(b.abbruch, 'Rang 3 reicht fuer das Bild, nicht fuer den Upload.');
    assert.equal(b.abbruch.code, 'rang3_kein_zettel_kein_titel');
    assert.equal(b.abbruch.nach, '2.8');
    return;
  }
  // Alle uebrigen: genannt, aber kein Kandidat -- der Lauf endet ohne Bild.
  assert.equal(b.rang, null, 'Zeile ' + nr + ' darf keinen Rang tragen.');
  assert.equal(b.regel, null);
  assert.equal(b.vorschlag, null);
  assert.ok(b.abbruch, 'Zeile ' + nr + ': ohne Kandidat bricht der Lauf ab.');
  assert.equal(b.abbruch.code, 'kein_kandidat');
}

// Hier sammeln die 37 Laeufe ihre Meldungen ein. Nachweis 2 liest sie.
//
// ALLE 37 Fixtures tragen bewusst DENSELBEN Dateinamen (jede in ihrem eigenen
// Wegwerfordner) und dieselben Werte fuer <andere>, <f> und <t>. Sonst waere
// Nachweis 2 wertlos: zwei Zeilen mit identischer Satzvorlage saehen allein
// wegen des unterschiedlichen Dateinamens verschieden aus, und genau die
// Verwechslung, gegen die die Matrix gebaut ist, ginge durch.
const EINGESAMMELT = new Map();
const EINHEITSNAME = 'adw-zettel';
const EINHEITSBILD = 'adw-bild-ohne-zettel.jpg';

for (const regel of Z.MATRIX) {
  const nr = regel.nr;
  test('Matrixzeile ' + nr + ' (' + (regel.h || 'kein Zettel') + '/' + (regel.n || '-') + '/' +
       regel.f + ') -> ' + regel.ausgang, () => {
    const ordner = wegwerfordner('zeile' + nr);
    let name;
    let b;
    if (nr === 37) {
      // Ein Bild ohne Zettel, am Kalendertag des Aufnahmebeginns.
      name = EINHEITSBILD;
      legeBild(ordner, name, 'ohne-zettel', TAG);
      b = befund(ordner);
      const bild = b.bilder_ohne_zettel.find((x) => x.dateiname === name);
      assert.ok(bild, 'Das Bild ohne Zettel steht nicht im Befund.');
      assert.equal(bild.zeile, 37);
      assert.equal(bild.ausgang, regel.ausgang);
      assert.equal(bild.im_fenster, true);
      assert.equal(bild.genannt, true);
      // Zuerst einsammeln, dann pruefen: Nachweis 2 darf nicht davon abhaengen,
      // dass die Wortstueck-Pruefung dieser Zeile durchgeht.
      EINGESAMMELT.set(37, bild.meldung);
      for (const stueck of WORTSTUECKE[37]) {
        assert.ok(bild.meldung.includes(stueck),
          'Zeile 37: die Meldung ' + JSON.stringify(bild.meldung) +
          ' enthaelt ' + JSON.stringify(stueck) + ' nicht.');
      }
      assert.ok(bild.meldung.includes(name));
      pruefeWirkung(37, b, name);
      return;
    }
    // Zeilen F/K sind "ein Zettel von vor dem Nachtrag": dort fehlen BEIDE
    // Felder, nicht nur die Herkunft.
    const vorDemNachtrag = regel.h === 'F' && regel.n === 'K';
    const gelegt = legeZettel(ordner, EINHEITSNAME, {
      aufnahme_herkunft: HERKUNFT_FELD[regel.h],
      aufnahme: vorDemNachtrag ? WEG : NAME_FELD[regel.n],
      format: FORMAT_FELD[regel.f],
    });
    name = gelegt.zettelname;
    b = befund(ordner);
    const zt = zettelVon(b, name);
    assert.equal(zt.lesbar, true, 'Zeile ' + nr + ': der Zettel muss lesbar sein.');
    assert.equal(zt.zeile, nr, 'Zeile ' + nr + ': falsche Zelle.');
    assert.deepEqual(zt.achsen, { h: regel.h, n: regel.n, f: regel.f });
    assert.equal(zt.ausgang, regel.ausgang, 'Zeile ' + nr + ': falscher Ausgang.');
    assert.equal(zt.genannt, true, 'Zeile ' + nr + ': der Zettel muss genannt werden.');
    EINGESAMMELT.set(nr, zt.meldung);
    assert.ok(zt.meldung.includes(name),
      'Zeile ' + nr + ': die Meldung nennt den Dateinamen nicht.');
    for (const stueck of WORTSTUECKE[nr]) {
      assert.ok(zt.meldung.includes(stueck),
        'Zeile ' + nr + ': die Meldung ' + JSON.stringify(zt.meldung) +
        ' enthaelt ' + JSON.stringify(stueck) + ' nicht.');
    }
    pruefeWirkung(nr, b, name);
  });
}

// ---------------------------------------------------------------------------
// NACHWEIS 2: kein Ausgang teilt sich eine Meldung
// ---------------------------------------------------------------------------

// Die Pruefung selbst, als Funktion -- damit sie auf die echten Meldungen UND
// auf eine absichtlich verdorbene Liste angewandt werden kann.
function kollisionen(meldungen) {
  const gesehen = new Map();
  const doppelt = [];
  for (const [nr, text] of meldungen) {
    if (gesehen.has(text)) doppelt.push({ erste: gesehen.get(text), zweite: nr, text });
    else gesehen.set(text, nr);
  }
  return doppelt;
}

test('Nachweis 2: die 37 eingesammelten Meldungen sind paarweise verschieden', () => {
  const fehlend = [];
  for (const regel of Z.MATRIX) if (!EINGESAMMELT.has(regel.nr)) fehlend.push(regel.nr);
  assert.deepEqual(fehlend, [],
    'Es fehlen Meldungen aus den Zeilen ' + fehlend.join(', ') +
    ' -- diese Zeilen sind NICHT gruen, sie sind ungelaufen.');
  assert.equal(EINGESAMMELT.size, 37);
  const doppelt = kollisionen(EINGESAMMELT);
  assert.deepEqual(doppelt, [],
    'Zwei Zustaende sehen gleich aus: ' + JSON.stringify(doppelt, null, 2));
});

test('Nachweis 2: die Kollisionspruefung schnappt zu, wenn zwei Meldungen zusammenfallen', () => {
  // Vorgefuehrt statt behauptet: Zeile 5 bekommt die Meldung der Zeile 4.
  const verdorben = new Map(EINGESAMMELT);
  verdorben.set(5, EINGESAMMELT.get(4));
  const doppelt = kollisionen(verdorben);
  assert.equal(doppelt.length, 1, 'Die Pruefung hat die Kollision nicht gesehen.');
  assert.equal(doppelt[0].erste, 4);
  assert.equal(doppelt[0].zweite, 5);
  // Und der Vollstaendigkeit halber: dieselbe Pruefung meldet auf der echten
  // Liste nichts. Eine Pruefung, die immer etwas meldet, ist auch keine.
  assert.equal(kollisionen(EINGESAMMELT).length, 0);
});

test('Nachweis 2: auch die Abbruchgruende teilen sich keinen Satz', () => {
  const saetze = new Map();
  // (a) Zeile 2/3
  {
    const o = wegwerfordner('ab-a');
    legeZettel(o, 'a', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME,
      format: 'livestream' });
    saetze.set('bestaetigter_zettel_mit_formatfehler', befund(o).abbruch.satz);
  }
  // (b) mehrere Rang 1
  {
    const o = wegwerfordner('ab-b');
    legeZettel(o, 'b1', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME });
    legeZettel(o, 'b2', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME });
    saetze.set('mehrere_rang1', befund(o).abbruch.satz);
  }
  // (c) mehrere Rang 2 (2a und 2b zusammen)
  {
    const o = wegwerfordner('ab-c');
    legeZettel(o, 'c1', { aufnahme_herkunft: 'unbestaetigt', aufnahme: AUFNAHME });
    legeZettel(o, 'c2', { aufnahme_herkunft: 'leer', aufnahme: null });
    saetze.set('mehrere_rang2', befund(o).abbruch.satz);
  }
  // (d) Kandidatenbild fehlt
  {
    const o = wegwerfordner('ab-d');
    const g = legeZettel(o, 'd', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME });
    fs.unlinkSync(path.join(o, g.bild.name));
    saetze.set('kandidatenbild_ungueltig', befund(o).abbruch.satz);
  }
  // (e) kein Videotitel
  {
    const o = wegwerfordner('ab-e');
    legeZettel(o, 'e', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME,
      videotitel: null });
    saetze.set('kein_videotitel', befund(o).abbruch.satz);
  }
  // (f) Rang 3 ohne Zettel
  {
    const o = wegwerfordner('ab-f');
    legeBild(o, 'f.jpg', 'f', TAG);
    saetze.set('rang3_kein_zettel_kein_titel', befund(o).abbruch.satz);
  }
  // (g) kein Kandidat
  {
    const o = wegwerfordner('ab-g');
    saetze.set('kein_kandidat', befund(o).abbruch.satz);
  }
  // (h) --zettel= auf einen Nicht-Kandidaten
  {
    const o = wegwerfordner('ab-h');
    legeZettel(o, 'h1', { aufnahme_herkunft: 'unbestaetigt', aufnahme: AUFNAHME });
    legeZettel(o, 'h2', { aufnahme_herkunft: 'bestaetigt', aufnahme: ANDERE });
    saetze.set('zettel_argument_kein_kandidat',
      befund(o, { zettel: 'h2.json' }).abbruch.satz);
  }
  assert.equal(saetze.size, 8);
  const doppelt = kollisionen(saetze);
  assert.deepEqual(doppelt, [],
    'Zwei Abbruchgruende sehen gleich aus: ' + JSON.stringify(doppelt, null, 2));
});

// ---------------------------------------------------------------------------
// NACHWEIS 3: der Fall EP. 17, am kaputten Stand vorgefuehrt
// ---------------------------------------------------------------------------
//
// Gemessen in EC (Befund 1) und ED (F5): das Bild zu EP. 17 entstand am
// 31.08. um 17:34, die Aufnahme begann um 17:36:21, der Render endete gegen
// 17:51. Zettel gibt es keinen.

const EP17_BILD_MTIME = new Date(2026, 7, 31, 17, 34, 0);
const EP17_RENDER_ENDE = new Date(2026, 7, 31, 17, 51, 0);

// Die Regel der Fassung 2, hier im TEST nachgebaut -- im Modul gibt es sie
// nicht, und das ist der Punkt. "Die juengste Bilddatei, die NACH dem
// Render-Zeitstempel entstanden ist."
function fassung2(ordner, renderZeitstempelMs) {
  return fs.readdirSync(ordner)
    .filter((n) => ['.jpg', '.jpeg', '.png'].includes(path.extname(n).toLowerCase()))
    .map((n) => ({ name: n, mtime: fs.statSync(path.join(ordner, n)).mtimeMs }))
    .filter((b) => b.mtime > renderZeitstempelMs)
    .sort((a, b) => b.mtime - a.mtime);
}

test('Nachweis 3a: die Regel der Fassung 2 verwirft das einzige Bild zu EP. 17', () => {
  const o = wegwerfordner('ep17-schaden');
  legeBild(o, 'adw-standard-ep17.jpg', 'ep17', EP17_BILD_MTIME);
  const kandidaten = fassung2(o, EP17_RENDER_ENDE.getTime());
  assert.equal(kandidaten.length, 0,
    'Der Render-Zeitfilter der Fassung 2 muesste hier auf 0 Kandidaten fallen.');
  // Und zur Sicherheit: es LIEGT ein Bild da. Der Filter wirft es weg, es
  // fehlt nicht.
  assert.equal(fs.readdirSync(o).filter((n) => n.endsWith('.jpg')).length, 1);
});

test('Nachweis 3b: die Regel der Fassung 3 findet es -- Kalendertag statt Render', () => {
  const o = wegwerfordner('ep17-reparatur');
  legeBild(o, 'adw-standard-ep17.jpg', 'ep17', EP17_BILD_MTIME);
  const b = befund(o);
  assert.equal(b.fenster.tag, TAG);
  assert.equal(b.fenster.geweitet, false, 'Der Tag traegt das Bild; nichts zu weiten.');
  assert.equal(b.rang, 3);
  assert.equal(b.vorschlaege.length, 1);
  assert.equal(b.vorschlaege[0].dateiname, 'adw-standard-ep17.jpg');
  assert.equal(b.vorschlaege[0].tag, TAG);
  // Das Bild ist bestimmt -- der Upload ist es nicht. Die beiden Zustaende
  // sehen ausdruecklich nicht gleich aus (Vertrag 2.8).
  assert.equal(b.abbruch.code, 'rang3_kein_zettel_kein_titel');
});

test('Nachweis 3c: der Weg zurueck zur Regel der Fassung 2 ist verriegelt', () => {
  const o = wegwerfordner('ep17-riegel');
  legeBild(o, 'adw-standard-ep17.jpg', 'ep17', EP17_BILD_MTIME);
  assert.throws(
    () => Z.befundeKandidaten({
      aufnahme: AUFNAHME, exportOrdner: o,
      renderZeitstempel: EP17_RENDER_ENDE.getTime(),
    }),
    (e) => e instanceof TypeError && /Render-Zeitstempel/.test(e.message),
    'Ein Render-Zeitstempel muss abgewiesen werden, nicht verschluckt.');
  // Ein verschlucktes Feld waere das Schlimmere: dann glaubte jemand, es wirke.
  assert.deepEqual(Z.ERLAUBTE_ANGABEN.slice().sort(),
    ['aufnahme', 'exportOrdner', 'zettel'].sort());
});

test('Nachweis 3d: das Modul liest nur im Export-Ordner -- ein Render kann es nicht sehen', () => {
  const o = wegwerfordner('ep17-lesespur');
  legeBild(o, 'adw-standard-ep17.jpg', 'ep17', EP17_BILD_MTIME);
  legeZettel(o, 'mit-zettel', { aufnahme_herkunft: 'leer', aufnahme: null });
  const gelesen = [];
  const echt = {};
  for (const name of ['readdirSync', 'readFileSync', 'statSync', 'openSync', 'lstatSync']) {
    echt[name] = fs[name];
    fs[name] = function (p, ...rest) {
      if (typeof p === 'string') gelesen.push(p);
      return echt[name].call(fs, p, ...rest);
    };
  }
  try {
    befund(o);
  } finally {
    for (const name of Object.keys(echt)) fs[name] = echt[name];
  }
  assert.ok(gelesen.length > 0, 'Es wurde ueberhaupt nichts gelesen.');
  const fremd = gelesen.filter((p) => path.resolve(p) !== path.resolve(o) &&
    !path.resolve(p).startsWith(path.resolve(o) + path.sep));
  assert.deepEqual(fremd, [],
    'Das Modul hat ausserhalb des Export-Ordners gelesen: ' + fremd.join(', '));
});

// ---------------------------------------------------------------------------
// NACHWEIS 4: die Weitung wird gesagt, nicht nur getan
// ---------------------------------------------------------------------------

test('Nachweis 4: leerer Kalendertag -- der Befund traegt die Weitung ausdruecklich', () => {
  // Ohne Weitung: der Zettel liegt am Tag der Aufnahme.
  const ohne = wegwerfordner('weitung-ohne');
  legeZettel(ohne, 'w', { aufnahme_herkunft: 'leer', aufnahme: null,
    exportiert_am: TAG + 'T09:00:00+02:00' });
  const a = befund(ohne);

  // Mit Weitung: derselbe Zettel, einen Tag frueher exportiert.
  const mit = wegwerfordner('weitung-mit');
  legeZettel(mit, 'w', { aufnahme_herkunft: 'leer', aufnahme: null,
    exportiert_am: TAG_DAVOR + 'T09:00:00+02:00' });
  const b = befund(mit);

  // Beide finden denselben Zettel als Rang-2b-Vorschlag ...
  assert.equal(a.rang, 2);
  assert.equal(b.rang, 2);
  assert.equal(a.vorschlag.dateiname, 'w.json');
  assert.equal(b.vorschlag.dateiname, 'w.json');

  // ... aber die Befunde sehen NICHT gleich aus.
  assert.equal(a.fenster.geweitet, false);
  assert.equal(b.fenster.geweitet, true);
  assert.deepEqual(a.fenster.tage, [TAG]);
  assert.deepEqual(b.fenster.tage, [TAG_DAVOR, TAG, TAG_DANACH]);
  assert.ok(!a.fenster.satz.includes('GEWEITET'));
  assert.ok(b.fenster.satz.includes('GEWEITET'));
  assert.ok(b.fenster.satz.includes(TAG_DAVOR) && b.fenster.satz.includes(TAG_DANACH));
  assert.equal(a.vorschlag.durch_weitung, false);
  assert.equal(b.vorschlag.durch_weitung, true);

  // Und die Vorschau sagt es, nicht nur das Feld.
  const textA = a.saetze.join('\n');
  const textB = b.saetze.join('\n');
  assert.ok(!textA.includes('GEWEITET'), 'Ohne Weitung darf das Wort nicht fallen.');
  assert.ok(textB.includes('GEWEITET'), 'Die Weitung muss in der Vorschau stehen.');
  assert.ok(textB.includes('gefunden erst durch die Weitung') ||
    textB.includes('Gefunden erst durch die Weitung'),
    'Der Vorschlag muss als durch die Weitung gefunden ausgewiesen sein.');
  assert.notEqual(textA, textB);
});

test('Nachweis 4b: auch eine Weitung, die nichts findet, steht im Abbruch', () => {
  const o = wegwerfordner('weitung-leer');
  const b = befund(o);
  assert.equal(b.fenster.geweitet, true);
  assert.deepEqual(b.fenster.tage, [TAG_DAVOR, TAG, TAG_DANACH]);
  assert.equal(b.abbruch.code, 'kein_kandidat');
  assert.ok(b.abbruch.satz.includes(TAG), 'Der Abbruch nennt den Tag.');
  assert.ok(b.abbruch.satz.includes(TAG_DAVOR) && b.abbruch.satz.includes(TAG_DANACH),
    'Der Abbruch nennt das geweitete Fenster.');
  assert.ok(b.abbruch.satz.includes('kein Bild'),
    'Der Abbruch sagt, dass kein Bild im Ordner liegt.');
});

test('Nachweis 4c: der Abbruch ohne Kandidat nennt das juengste Bild im Ordner', () => {
  const o = wegwerfordner('weitung-juengstes');
  // Ein Bild weit ausserhalb des Fensters -- kein Kandidat, aber der Abbruch
  // nennt sein Datum, damit ein Mensch sieht, was ueberhaupt da ist.
  legeBild(o, 'weit-weg.jpg', 'weit', '2026-07-04');
  const b = befund(o);
  assert.equal(b.rang, null);
  assert.equal(b.abbruch.code, 'kein_kandidat');
  assert.ok(b.abbruch.satz.includes('weit-weg.jpg'));
  assert.ok(b.abbruch.satz.includes('2026-07-04'));
  assert.equal(b.bilder_ausserhalb_des_fensters, 1);
  assert.ok(b.saetze.join('\n').includes('1 weitere Bilder ausserhalb des Fensters') ||
    b.saetze.join('\n').includes('ausserhalb des Fensters'));
});

// ---------------------------------------------------------------------------
// NACHWEIS 5: das Modul schreibt nichts
// ---------------------------------------------------------------------------

const SCHREIBENDE_FS = [
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'mkdirSync', 'mkdir', 'mkdtempSync', 'mkdtemp',
  'rmSync', 'rm', 'rmdirSync', 'rmdir', 'unlinkSync', 'unlink',
  'renameSync', 'rename', 'copyFileSync', 'copyFile',
  'truncateSync', 'truncate', 'ftruncateSync', 'ftruncate',
  'writeSync', 'write', 'writevSync', 'writev', 'createWriteStream',
  'utimesSync', 'utimes', 'futimesSync', 'chmodSync', 'chmod',
  'symlinkSync', 'symlink', 'linkSync', 'link', 'cpSync', 'cp',
];

// Stellt jede schreibende fs-Funktion scharf. openSync bleibt erlaubt, aber
// nur mit Lesekennzeichen -- genau die Unterscheidung, um die es geht.
function falleStellen() {
  const verletzungen = [];
  const echt = {};
  const schnapp = (was) => {
    verletzungen.push(was);
    throw new Error('Schreibfalle: das Modul hat ' + was + ' aufgerufen. ' +
      'Der Beipackzettel-Leser schreibt nichts.');
  };
  for (const name of SCHREIBENDE_FS) {
    if (typeof fs[name] !== 'function') continue;
    echt[name] = fs[name];
    fs[name] = function (...args) {
      return schnapp('fs.' + name + '(' + JSON.stringify(String(args[0])) + ')');
    };
  }
  echt.openSync = fs.openSync;
  fs.openSync = function (pfad, kennzeichen, ...rest) {
    const k = kennzeichen === undefined ? 'r' : kennzeichen;
    if (k !== 'r' && k !== 0 && k !== 'rs') {
      return schnapp('fs.openSync(' + JSON.stringify(String(pfad)) +
        ', ' + JSON.stringify(k) + ')');
    }
    return echt.openSync.call(fs, pfad, k, ...rest);
  };
  return {
    verletzungen,
    loesen() { for (const name of Object.keys(echt)) fs[name] = echt[name]; },
  };
}

test('Nachweis 5: der volle Durchlauf schreibt nichts', () => {
  const o = wegwerfordner('schreibfalle');
  // Ein Ordner mit allem, was das Modul anfassen kann: ein Rang-1-Zettel
  // (dessen sha256 wirklich gerechnet wird), ein widerspruechlicher, ein
  // Zettel einer anderen Aufnahme, eine .json, die kein Zettel ist, und zwei
  // Bilder ohne Zettel.
  legeZettel(o, 'regel', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME });
  legeZettel(o, 'wider', { aufnahme_herkunft: 'bestaetigt', aufnahme: null });
  legeZettel(o, 'fremd', { aufnahme_herkunft: 'unbestaetigt', aufnahme: ANDERE });
  fs.writeFileSync(path.join(o, 'kein-zettel.json'), '{"was":"anderes"}');
  legeBild(o, 'frei-1.jpg', 'f1', TAG);
  legeBild(o, 'frei-2.png', 'f2', TAG_DAVOR);

  const falle = falleStellen();
  let b;
  let waehrendDesLaufs = null;
  try {
    b = Z.befundeKandidaten({ aufnahme: AUFNAHME, exportOrdner: o });
  } finally {
    // Erst loesen, dann pruefen -- sonst schriebe schon die Fehlerausgabe.
    waehrendDesLaufs = falle.verletzungen.length;
    falle.loesen();
  }
  assert.equal(waehrendDesLaufs, 0,
    'Das Modul hat geschrieben: ' + falle.verletzungen.join(', '));
  // Und der Durchlauf war ein echter, kein leerer:
  assert.equal(b.rang, 1);
  assert.equal(b.regel.dateiname, 'regel.json');
  assert.equal(b.regel.bildbefund.stand, 'stimmt');
  assert.equal(b.regel.bildbefund.sha256_geprueft, true);
  assert.equal(b.zettel.length, 4);
  assert.equal(b.bilder_ohne_zettel.length, 2);
});

test('Nachweis 5b: die Schreibfalle schnappt zu, wenn man sie provoziert', () => {
  const o = wegwerfordner('schreibfalle-probe');
  const lesbar = path.join(o, 'lesbar.txt');
  fs.writeFileSync(lesbar, 'inhalt');          // vor dem Scharfstellen
  const falle = falleStellen();
  let fehlerA = null;
  let fehlerB = null;
  let lesenGing = false;
  try {
    try { fs.writeFileSync(path.join(o, 'x.txt'), 'x'); } catch (e) { fehlerA = e; }
    try { fs.openSync(path.join(o, 'x.txt'), 'w'); } catch (e) { fehlerB = e; }
    // Lesen bleibt erlaubt -- eine Falle, die alles faengt, faengt nichts.
    const fd = fs.openSync(lesbar, 'r');
    fs.closeSync(fd);
    lesenGing = true;
  } finally {
    falle.loesen();
  }
  assert.ok(fehlerA && /Schreibfalle/.test(fehlerA.message),
    'fs.writeFileSync haette scheitern muessen.');
  assert.ok(fehlerB && /Schreibfalle/.test(fehlerB.message),
    'fs.openSync mit Schreibkennzeichen haette scheitern muessen.');
  assert.equal(lesenGing, true, 'Lesen muss weiter gehen, sonst prueft die Falle nichts.');
  assert.equal(falle.verletzungen.length, 2);
  assert.equal(fs.existsSync(path.join(o, 'x.txt')), false,
    'Die Falle hat das Schreiben nicht nur gemeldet, sondern verhindert.');
});

// ---------------------------------------------------------------------------
// Die uebrigen Zusagen aus 2.7, 3.3 und 7
// ---------------------------------------------------------------------------

test('Eine .json, die kein Zettel ist, wird beim Namen genannt und uebergangen', () => {
  const o = wegwerfordner('unlesbar');
  fs.writeFileSync(path.join(o, 'kaputt.json'), '{"schema_version": 1, ');
  fs.writeFileSync(path.join(o, 'fremd.json'), '{"etwas":"anderes"}');
  fs.writeFileSync(path.join(o, 'alt.json'), JSON.stringify({ schema_version: 0 }));
  fs.writeFileSync(path.join(o, 'herkunft-null.json'), JSON.stringify({
    schema_version: 1, exportiert_am: TAG + 'T10:00:00+02:00',
    bild: { dateiname: 'x.jpg', sha256: 'a'.repeat(64), bytes: 3 },
    aufnahme: null, aufnahme_herkunft: null,
  }));
  fs.writeFileSync(path.join(o, 'name-schief.json'), JSON.stringify({
    schema_version: 1, exportiert_am: TAG + 'T10:00:00+02:00',
    bild: { dateiname: 'x.jpg', sha256: 'a'.repeat(64), bytes: 3 },
    aufnahme: '31.08.2026 17:36', aufnahme_herkunft: 'bestaetigt',
  }));
  fs.writeFileSync(path.join(o, 'pfad-im-bild.json'), JSON.stringify({
    schema_version: 1, exportiert_am: TAG + 'T10:00:00+02:00',
    bild: { dateiname: '../draussen.jpg', sha256: 'a'.repeat(64), bytes: 3 },
    aufnahme: null, aufnahme_herkunft: 'leer',
  }));
  const b = befund(o);
  assert.equal(b.zettel.length, 6);
  for (const zt of b.zettel) {
    assert.equal(zt.lesbar, false, zt.dateiname + ' haette unlesbar sein muessen.');
    assert.equal(zt.ausgang, 'unlesbar');
    assert.equal(zt.genannt, true, 'Ein stilles Uebergehen verbietet Vertrag 7.');
    assert.ok(zt.meldung.includes(zt.dateiname));
    assert.ok(zt.grund && zt.grund.length > 0, 'Der Grund fehlt.');
  }
  const grund = (n) => b.zettel.find((zt) => zt.dateiname === n).grund;
  assert.ok(/unvollstaendig/.test(grund('kaputt.json')));
  assert.ok(/schema_version/.test(grund('fremd.json')));
  assert.ok(/schema_version/.test(grund('alt.json')));
  assert.ok(/aufnahme_herkunft/.test(grund('herkunft-null.json')));
  assert.ok(/JJJJ-MM-TT/.test(grund('name-schief.json')));
  assert.ok(/Pfad/.test(grund('pfad-im-bild.json')));
  // Und: kein Abbruch daran. Der Export-Ordner ist kein Ordner dieses Werkzeugs.
  assert.equal(b.abbruch.code, 'kein_kandidat');
});

test('format null und ein fehlendes format sind beide Spalte ? -- kein "kein Zettel"', () => {
  for (const [marke, wert] of [['null', null], ['fehlt', WEG]]) {
    const o = wegwerfordner('format-' + marke);
    const g = legeZettel(o, 'f', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME,
      format: wert });
    const b = befund(o);
    const zt = zettelVon(b, g.zettelname);
    assert.equal(zt.lesbar, true, marke + ': muss ein Zettel bleiben.');
    assert.equal(zt.achsen.f, '?');
    assert.equal(zt.zeile, 3);
    assert.equal(b.abbruch.code, 'bestaetigter_zettel_mit_formatfehler');
  }
});

test('Zwei bestaetigte Zettel derselben Aufnahme: der Arbeiter waehlt nicht', () => {
  const o = wegwerfordner('zwei-rang1');
  legeZettel(o, 'eins', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME,
    exportiert_am: TAG + 'T10:00:00+02:00' });
  legeZettel(o, 'zwei', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME,
    exportiert_am: TAG + 'T11:00:00+02:00' });
  const b = befund(o);
  assert.equal(b.abbruch.code, 'mehrere_rang1');
  assert.equal(b.regel, null, 'Nichts wird genommen.');
  assert.equal(b.vorschlaege.length, 2);
  assert.equal(b.vorschlaege[0].dateiname, 'zwei.json', 'Juengstes zuerst.');
  assert.ok(b.abbruch.satz.includes('--zettel='), 'Der Weg zurueck steht in der Meldung.');
  assert.ok(b.abbruch.satz.includes('eins.json') && b.abbruch.satz.includes('zwei.json'));
});

test('Rang 2a und 2b bilden EINE Liste -- zwei darin sind zwei, nicht ein Vorrang', () => {
  const o = wegwerfordner('zwei-rang2');
  legeZettel(o, 'unbest', { aufnahme_herkunft: 'unbestaetigt', aufnahme: AUFNAHME,
    exportiert_am: TAG + 'T10:00:00+02:00' });
  legeZettel(o, 'leerer', { aufnahme_herkunft: 'leer', aufnahme: null,
    exportiert_am: TAG + 'T11:00:00+02:00' });
  const b = befund(o);
  assert.equal(b.abbruch.code, 'mehrere_rang2');
  assert.equal(b.vorschlag, null);
  assert.equal(b.vorschlaege.length, 2);
  assert.equal(b.vorschlaege[0].dateiname, 'leerer.json', 'Juengstes zuerst.');
});

test('Ein hoeherer Rang schliesst den niedrigeren aus', () => {
  const o = wegwerfordner('rangfolge');
  legeZettel(o, 'zweia', { aufnahme_herkunft: 'unbestaetigt', aufnahme: AUFNAHME });
  legeBild(o, 'frei.jpg', 'frei', TAG);
  const b = befund(o);
  assert.equal(b.rang, 2, 'Gibt es Rang-2-Kandidaten, werden Bilder ohne Zettel nicht ' +
    'vorgeschlagen.');
  assert.equal(b.vorschlag.dateiname, 'zweia.json');
  const bild = b.bilder_ohne_zettel.find((x) => x.dateiname === 'frei.jpg');
  assert.ok(bild, 'Das Bild steht weiter im Befund ...');
  assert.equal(b.vorschlaege.length, 1, '... aber nicht in der Vorschlagsliste.');
});

test('Ein Kandidatenzettel auf ein fehlendes Bild bricht ab, statt still zurueckzufallen', () => {
  const o = wegwerfordner('bild-fehlt');
  const g = legeZettel(o, 'kandidat', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME });
  fs.unlinkSync(path.join(o, g.bild.name));
  legeBild(o, 'rueckfall.jpg', 'rueckfall', TAG);   // laege als Rang 3 bereit
  const b = befund(o);
  assert.equal(b.rang, 1);
  assert.equal(b.regel, null);
  assert.equal(b.abbruch.code, 'kandidatenbild_ungueltig');
  assert.equal(b.abbruch.nach, '2.7');
  assert.ok(b.abbruch.satz.includes(g.bild.name));
  assert.ok(b.abbruch.satz.includes('nicht still auf einen niedrigeren Rang'));
});

test('Ein Kandidatenzettel auf ein veraendertes Bild bricht ab (sha256)', () => {
  const o = wegwerfordner('bild-anders');
  const g = legeZettel(o, 'kandidat', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME });
  // Gleiche Groesse, anderer Inhalt: nur die sha256 faengt das.
  const gleichLang = Buffer.alloc(g.bild.bytes, 0x41);
  fs.writeFileSync(path.join(o, g.bild.name), gleichLang);
  const b = befund(o);
  assert.equal(b.abbruch.code, 'kandidatenbild_ungueltig');
  assert.equal(b.regel, null);
  assert.equal(zettelVon(b, g.zettelname).bildbefund.stand, 'sha256_weicht_ab');
});

test('Ein Rang-1-Zettel ohne videotitel bricht ab -- nach 2.8, und er wird genannt', () => {
  const o = wegwerfordner('ohne-titel');
  legeZettel(o, 'kandidat', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME,
    videotitel: null });
  const b = befund(o);
  assert.equal(b.rang, 1);
  assert.ok(b.regel, 'Das Bild ist bestimmt ...');
  assert.equal(b.abbruch.code, 'kein_videotitel', '... der Upload ist es nicht.');
  assert.equal(b.abbruch.nach, '2.8');
  assert.ok(b.abbruch.satz.includes('kandidat.json'));
  assert.ok(b.abbruch.satz.includes('kein Ersatzfeld'));
});

test('Kein Bild eines Formats ohne Aufnahme wird Kandidat -- in keinem Rang', () => {
  const o = wegwerfordner('livestream');
  const g = legeZettel(o, 'stream', { aufnahme_herkunft: 'leer', aufnahme: null,
    format: 'livestream' });
  const b = befund(o);
  assert.equal(zettelVon(b, g.zettelname).zeile, 26);
  assert.equal(zettelVon(b, g.zettelname).ausgang, 'kein_kandidat');
  // Das Bild hat einen Zettel und faellt darum auch nicht in Rang 3 durch.
  assert.equal(b.bilder_ohne_zettel.length, 0);
  assert.equal(b.rang, null);
  assert.equal(b.abbruch.code, 'kein_kandidat');
  for (const f of Z.FORMATE_OHNE_AUFNAHME) assert.ok(!Z.ZUGELASSENE_FORMATE.includes(f));
});

test('Ausserhalb des Fensters wird gezaehlt; widerspruechliche und Namensnenner immer genannt', () => {
  const o = wegwerfordner('fenster-zaehlen');
  // Im Fenster: ein leerer Zettel, damit nicht geweitet wird.
  legeZettel(o, 'im-fenster', { aufnahme_herkunft: 'leer', aufnahme: null });
  // Ausserhalb, harmlos (Zeile 26): nur gezaehlt.
  legeZettel(o, 'weit-weg', { aufnahme_herkunft: 'leer', aufnahme: null,
    format: 'livestream', exportiert_am: '2026-07-04T10:00:00+02:00' });
  // Ausserhalb, widerspruechlich (Zeile 19): trotzdem genannt.
  legeZettel(o, 'wider-weg', { aufnahme_herkunft: 'leer', aufnahme: AUFNAHME,
    exportiert_am: '2026-07-04T10:00:00+02:00' });
  // Ausserhalb, nennt diese Aufnahme (Zeile 11): trotzdem genannt.
  legeZettel(o, 'nennt-weg', { aufnahme_herkunft: 'unbestaetigt', aufnahme: AUFNAHME,
    format: 'livestream', exportiert_am: '2026-07-04T10:00:00+02:00' });
  const b = befund(o);
  assert.equal(b.fenster.geweitet, false);
  assert.equal(zettelVon(b, 'weit-weg.json').genannt, false);
  assert.equal(zettelVon(b, 'wider-weg.json').genannt, true);
  assert.equal(zettelVon(b, 'nennt-weg.json').genannt, true);
  assert.equal(b.zettel_ausserhalb_des_fensters, 1);
  const text = b.saetze.join('\n');
  assert.ok(text.includes('1 weitere Zettel ausserhalb des Fensters'));
  assert.ok(!text.includes('weit-weg.json'), 'Der gezaehlte wird nicht genannt.');
  assert.ok(text.includes('wider-weg.json') && text.includes('nennt-weg.json'));
});

test('Ein Zettel ohne lesbares exportiert_am wird genannt statt gezaehlt', () => {
  const o = wegwerfordner('ohne-exportzeit');
  legeZettel(o, 'im-fenster', { aufnahme_herkunft: 'leer', aufnahme: null });
  legeZettel(o, 'zeitlos', { aufnahme_herkunft: 'leer', aufnahme: null,
    exportiert_am: 'irgendwann' });
  const b = befund(o);
  const zt = zettelVon(b, 'zeitlos.json');
  assert.equal(zt.lesbar, true);
  assert.equal(zt.exporttag, null);
  assert.equal(zt.im_fenster, false, 'Ohne Tag laesst er sich nicht ins Fenster legen ...');
  assert.equal(zt.genannt, true, '... darum wird er genannt und nicht gezaehlt.');
  assert.equal(zt.ausgang, 'rang2b_vorschlag');
  // Er ist kein Kandidat, weil er nicht im Fenster liegt -- der eine im
  // Fenster bleibt der einzige Vorschlag.
  assert.equal(b.rang, 2);
  assert.equal(b.vorschlag.dateiname, 'im-fenster.json');
});

test('--zettel= waehlt unter den Kandidaten, und nur unter ihnen', () => {
  const o = wegwerfordner('zettel-argument');
  legeZettel(o, 'eins', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME,
    exportiert_am: TAG + 'T10:00:00+02:00' });
  legeZettel(o, 'zwei', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME,
    exportiert_am: TAG + 'T11:00:00+02:00' });
  legeZettel(o, 'fremd', { aufnahme_herkunft: 'bestaetigt', aufnahme: ANDERE });
  // Ohne Argument: Abbruch.
  assert.equal(befund(o).abbruch.code, 'mehrere_rang1');
  // Mit Argument: genau der genannte.
  const b = befund(o, { zettel: 'eins.json' });
  assert.equal(b.abbruch, null);
  assert.equal(b.rang, 1);
  assert.equal(b.regel.dateiname, 'eins.json');
  // Auf einen Nicht-Kandidaten: abgewiesen, mit dem Grund aus der Matrix.
  const c = befund(o, { zettel: 'fremd.json' });
  assert.equal(c.abbruch.code, 'zettel_argument_kein_kandidat');
  assert.ok(c.abbruch.satz.includes('gehoert bestaetigt zur Aufnahme ' + ANDERE));
  // Auf etwas, das gar nicht da ist:
  const d = befund(o, { zettel: 'gibtsnicht.json' });
  assert.equal(d.abbruch.code, 'zettel_argument_kein_kandidat');
  assert.ok(d.abbruch.satz.includes('liegt nicht im Export-Ordner'));
});

test('Ein Pfad statt eines Dateinamens und eine schiefe Aufnahme werden abgewiesen', () => {
  const o = wegwerfordner('argumente');
  assert.throws(() => befund(o, { zettel: path.join('unter', 'x.json') }), /kein blosser Dateiname/);
  assert.throws(() => Z.befundeKandidaten({ aufnahme: '31.08.2026', exportOrdner: o }),
    /JJJJ-MM-TT HH-MM-SS/);
  assert.throws(() => Z.befundeKandidaten({ aufnahme: AUFNAHME }), /exportOrdner/);
  assert.throws(() => Z.befundeKandidaten({ aufnahme: AUFNAHME, exportOrdner: o, wurzel: o }),
    /kennt die Angabe "wurzel" nicht/);
});

test('Die Vorschau nennt jeden genannten Zettel mit seinem Ausgang und das Fenster', () => {
  const o = wegwerfordner('vorschau');
  legeZettel(o, 'regel', { aufnahme_herkunft: 'bestaetigt', aufnahme: AUFNAHME });
  legeZettel(o, 'wider', { aufnahme_herkunft: 'leer', aufnahme: AUFNAHME });
  legeBild(o, 'frei.jpg', 'frei', TAG);
  const b = befund(o);
  const text = Z.vorschau(b).join('\n');
  assert.equal(text, b.saetze.join('\n'), 'saetze ist die Vorschau.');
  assert.ok(text.includes('Aufnahme: ' + AUFNAHME));
  assert.ok(text.includes('Fenster: der Kalendertag ' + TAG));
  assert.ok(text.includes('regel.json') && text.includes('rang1_regel'));
  assert.ok(text.includes('wider.json') && text.includes('uebergangen'));
  assert.ok(text.includes('Genommen (Regel, ohne Rueckfrage)'));
  assert.ok(text.includes('frei.jpg'), 'Auch das Bild ohne Zettel steht in der Vorschau.');
  assert.ok(text.includes('sha256'), 'Der Knopf braucht Dateiname und sha256.');
});

test('Das Modul kennt keine videoId, keinen Kanal und kein Netz', () => {
  const quelle = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'upload', 'zettel-leser.js'), 'utf8');
  for (const wort of ['googleapis', 'videos.insert', 'thumbnails.set', 'videos.update',
    'https://', 'http://', 'videoId', 'publishAt']) {
    assert.ok(!quelle.includes(wort),
      'Der Beipackzettel-Leser darf ' + JSON.stringify(wort) + ' nicht enthalten.');
  }
  // Und keine geliehene Kette zieht googleapis herein.
  assert.ok(!Object.keys(require.cache).some((k) => k.includes('googleapis')),
    'googleapis wurde geladen.');
});
