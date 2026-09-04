'use strict';

// ---------------------------------------------------------------------------
// EP: DIE ERSTE ERMAECHTIGUNG UND DAS PRIVATE VIDEO
// ---------------------------------------------------------------------------
//
// AB HIER GIBT ES CODE, DER AUF EINEN ECHTEN KANAL SCHREIBT. Diese Datei ist
// der Grund, warum man ihn laufen lassen darf. Sie fuehrt sechs Dinge vor, und
// jedes davon so, dass die Sicherung dabei ZUSCHNAPPT -- ein Test, der nur
// zeigt, dass etwas geht, hat nichts gezeigt.
//
//   N1  Genau EIN videos.insert je Lauf. Der Doppelgaenger zaehlt jeden Aufruf
//       mit Namen und Reihenfolge; ein zweiter Upload wirft, bevor er
//       geschieht. Vorgefuehrt.
//   N2  videos.update ist nicht erreichbar -- nicht im Code, nicht ueber eine
//       geliehene Kette, nicht ueber das Kanalobjekt.
//   N3  Die Ermaechtigung gilt EINMAL und haengt an dem, worueber ein Mensch
//       geurteilt hat. Sechzehn Faelle, jeder mit eigener Meldung, keine zwei
//       teilen sich eine, keiner laedt hoch.
//   N4  Der Abbruch in der Mitte. Erst der SCHADEN -- was ohne die Abwehr
//       geschaehe --, dann dass es nicht mehr geht.
//   N5  Kein echter Aufruf ist moeglich. Jeder Netzweg scharf, voller
//       Durchlauf dagegen, und die Falle wird provoziert.
//   N6  Die Shorts-Linie ist unveraendert. Byte fuer Byte gegen bd886d7.
//
// KEIN TEST HIER MACHT EINEN NETZAUFRUF, und N5 rechnet das nach, statt es zu
// behaupten. Alle Tests laufen gegen WEGWERFORDNER unter dem Temp-Verzeichnis;
// keiner fasst den echten Export-, Render- oder data-Ordner an. Die drei
// Konfigurationsdateien unter config/ werden GELESEN und in den Wegwerfordner
// KOPIERT -- geschrieben wird nur in der Kopie.
//
// KEINE ECHTE KENNUNG. Die Kennungen des Doppelgaengers sehen absichtlich
// nicht aus wie die von YouTube; ein Testdatum, das echt aussieht, ist das
// erste, das jemand fuer echt haelt (Vertrag 7, docs/warum-keine-video-ids-im-repo.md).

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const L = require('../src/upload/longform-arbeiter.js');
const G = require('../src/upload/longform-gedaechtnis.js');
const K = require('../src/upload/longform-kanal.js');
const U = require('../src/upload/uploader.js');
const Z = require('../src/upload/zettel-leser.js');
const S = require('../src/upload/freigabe-server.js');
const SEITE = require('../src/upload/freigabe-seite.js');

const WURZEL = path.join(__dirname, '..');
const AUFNAHME = '2026-08-31 17-36-21';
const TAG = '2026-08-31';
const ANDERE_AUFNAHME = '2026-08-30 09-12-00';

// Kennungen des Doppelgaengers. Sie tragen ihren Charakter im Namen.
const DOPPEL_VIDEO = 'DOPPELGAENGER-VIDEO-OHNE-ECHTE-KENNUNG';
const DOPPEL_KANAL_ID = 'DOPPELGAENGER-KANAL-OHNE-ECHTE-KENNUNG';
const DOPPEL_KANAL_NAME = 'Doppelgaengerkanal';

// ---------------------------------------------------------------------------
// WERKZEUG: DIE LAGE
// ---------------------------------------------------------------------------

function wegwerfordner(marke) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ep-' + marke + '-'));
}

function sha256(puffer) {
  return crypto.createHash('sha256').update(puffer).digest('hex');
}

// Eine vollstaendige Lage: eine Projektwurzel mit kopierter Konfiguration, ein
// Render-Ordner mit der einen Videodatei, ein Export-Ordner mit Bild und
// Beipackzettel. Alles im Temp-Verzeichnis.
function lage(marke, { zettelfelder = {}, bildbytes = 4096 } = {}) {
  const wurzel = wegwerfordner(marke + '-wurzel');
  const render = wegwerfordner(marke + '-render');
  const exp = wegwerfordner(marke + '-export');

  // Die Konfiguration wird KOPIERT und nicht gelesen-wo-sie-liegt: der
  // Arbeiter loest sie aus der Projektwurzel auf, und die ist hier eine
  // andere. Die echten Dateien werden dabei nur gelesen.
  fs.mkdirSync(path.join(wurzel, 'config'), { recursive: true });
  for (const datei of [U.BESCHREIBUNG_DATEI, U.HASHTAGS_DATEI, U.VEROEFFENTLICHUNG_DATEI]) {
    fs.copyFileSync(path.join(WURZEL, datei), path.join(wurzel, datei));
  }

  // Die eine Videodatei, dazu zwei weitere derselben Form fuer den
  // Groessenvergleich (Vertrag 3.2).
  const videoInhalt = Buffer.alloc(300000, 3);
  const videoPfad = path.join(render, AUFNAHME + '.matrix-cut.mp4');
  fs.writeFileSync(videoPfad, videoInhalt);
  for (const n of ['2026-08-28 10-00-00', '2026-08-27 10-00-00']) {
    fs.writeFileSync(path.join(render, n + '.matrix-cut.mp4'), Buffer.alloc(310000, 4));
  }

  // Bild und Beipackzettel.
  const bildname = 'adw-' + marke + '.jpg';
  const bildInhalt = Buffer.alloc(bildbytes, 9);
  fs.writeFileSync(path.join(exp, bildname), bildInhalt);
  const zettelname = 'adw-' + marke + '.json';
  const zettel = Object.assign({
    schema_version: Z.SCHEMA_VERSION,
    videotitel: 'Ein Titel fuer den Doppelgaengerlauf',
    episode: 'EP. 17',
    datum: TAG,
    format: 'standard',
    chart_quelle: null,
    aufnahme: AUFNAHME,
    aufnahme_herkunft: 'bestaetigt',
    exportiert_am: TAG + 'T14:00:00+02:00',
    bild: { dateiname: bildname, bytes: bildInhalt.length, sha256: sha256(bildInhalt) },
  }, zettelfelder);
  fs.writeFileSync(path.join(exp, zettelname), JSON.stringify(zettel, null, 2));
  const t = new Date(TAG + 'T14:00:00');
  fs.utimesSync(path.join(exp, bildname), t, t);
  fs.utimesSync(path.join(exp, zettelname), t, t);

  return {
    wurzel, render, exp,
    bildname, zettelname,
    bildSha: sha256(bildInhalt),
    videoSha: sha256(videoInhalt),
    videoPfad,
    weg() {
      for (const o of [wurzel, render, exp]) fs.rmSync(o, { recursive: true, force: true });
    },
  };
}

function trocken(l, { zettel = null } = {}) {
  return L.trockenlauf({
    aufnahme: AUFNAHME, zettel, projektwurzel: l.wurzel,
    renderWurzel: l.render, exportOrdner: l.exp,
  });
}

// ---------------------------------------------------------------------------
// WERKZEUG: DIE ERMAECHTIGUNG
// ---------------------------------------------------------------------------
//
// Sie wird ueber DIESELBEN Funktionen gebaut, die der Freigabedienst benutzt
// (G.neueErmaechtigung, G.ermaechtigungPfad) und ueber dieselbe, die er zum
// Schreiben benutzt (S.schreibeErmaechtigung). Ein hier nachgebauter Schreiber
// pruefte eine Form, die im Ernstfall niemand schreibt.
function schreibeErmaechtigung(l, befund, aenderungen = {}) {
  const b = L.bindungsZeile(befund);
  assert.equal(b.moeglich, true, 'diese Lage gibt keine Bindung her: ' + b.grund);
  const zufall = aenderungen.zufall || G.neuerZufall();
  const inhalt = G.neueErmaechtigung({
    aufnahme: b.aufnahme,
    videoSha256: b.video_sha256,
    bildDateiname: b.bild.dateiname,
    bildSha256: b.bild.sha256,
    zettelDateiname: b.zettel.dateiname,
    rang: b.zettel.rang,
    kanalId: DOPPEL_KANAL_ID,
    kanalName: DOPPEL_KANAL_NAME,
    zufall,
    jetzt: aenderungen.jetzt === undefined ? Date.now() : aenderungen.jetzt,
  });
  // Die Verfaelschungen werden NACH dem Bauen eingesetzt, damit die Form die
  // echte bleibt und nur das eine Feld abweicht, um das es geht.
  for (const [pfad, wert] of Object.entries(aenderungen.felder || {})) {
    const teile = pfad.split('.');
    let ziel = inhalt;
    for (const t of teile.slice(0, -1)) ziel = ziel[t];
    ziel[teile[teile.length - 1]] = wert;
  }
  const pfad = aenderungen.pfad || G.ermaechtigungPfad(l.wurzel, zufall);
  S.schreibeErmaechtigung(pfad, inhalt);
  return { pfad, inhalt, zufall };
}

// ---------------------------------------------------------------------------
// WERKZEUG: DER DOPPELGAENGER
// ---------------------------------------------------------------------------
//
// Er antwortet, wie die API antwortet -- mit { da, wert } je Auskunft, weil
// ABWESEND nicht LEER ist (Vertrag 2.3, gemessen von DY an 21 Shorts). Und er
// geht durch K.zaehlenderKanal(): das ist DIESELBE Zaehlung, die im scharfen
// Lauf greift, und nicht eine zweite, die ihr aehnlich sieht.
const da = (w) => ({ da: true, wert: w });
const weg = () => ({ da: false, wert: null });

function antwortMit({ processingStatus, uploadStatus, gruende = {} }) {
  return {
    gefunden: true,
    status: { uploadStatus: uploadStatus === undefined ? 'uploaded' : uploadStatus },
    processingDetails: { processingStatus },
    snippet: null,
    processingStatus: processingStatus === undefined ? weg() : da(processingStatus),
    uploadStatus: uploadStatus === undefined ? da('uploaded') : da(uploadStatus),
    rejectionReason: gruende.rejectionReason === undefined ? weg() : da(gruende.rejectionReason),
    failureReason: gruende.failureReason === undefined ? weg() : da(gruende.failureReason),
    processingFailureReason: gruende.processingFailureReason === undefined
      ? weg() : da(gruende.processingFailureReason),
  };
}

// `wirf` benennt die Methode, an der der Doppelgaenger abbricht -- so wird ein
// Absturz mitten im Lauf nachgestellt, ohne dass der Test etwas anderes tut
// als der Ernstfall.
function doppelgaenger({
  videoId = DOPPEL_VIDEO,
  privacyStatus = 'private',
  verarbeitung = [antwortMit({ processingStatus: 'succeeded' })],
  wirf = null,
  kanalId = DOPPEL_KANAL_ID,
  kanalName = DOPPEL_KANAL_NAME,
  kanalGefunden = true,
} = {}) {
  let abfrage = 0;
  const pruefe = (name) => {
    if (wirf === name) throw new Error('DOPPELGAENGER: ' + name + ' bricht ab (nachgestellt)');
  };
  return K.zaehlenderKanal({
    async nenneKanal() {
      pruefe('nenneKanal');
      return { gefunden: kanalGefunden, id: kanalId, name: kanalName };
    },
    async ladeVideoHoch() {
      pruefe('ladeVideoHoch');
      return {
        videoId,
        status: { privacyStatus, uploadStatus: 'uploaded' },
        privacyStatus: privacyStatus === null ? weg() : da(privacyStatus),
        uploadStatus: da('uploaded'),
      };
    },
    async liesVerarbeitung() {
      pruefe('liesVerarbeitung');
      const i = Math.min(abfrage, verarbeitung.length - 1);
      abfrage++;
      return verarbeitung[i];
    },
    async setzeThumbnail() {
      pruefe('setzeThumbnail');
      return { items: [] };
    },
    async liesVideoVoll() {
      pruefe('liesVideoVoll');
      return {
        gefunden: true,
        status: { privacyStatus, uploadStatus: 'processed' },
        processingDetails: { processingStatus: 'succeeded' },
        snippet: {
          title: 'Ein Titel fuer den Doppelgaengerlauf',
          thumbnails: { high: { url: 'about:blank#doppelgaenger', width: 480, height: 360 } },
        },
        processingStatus: da('succeeded'),
        uploadStatus: da('processed'),
        rejectionReason: weg(),
        failureReason: weg(),
        processingFailureReason: weg(),
      };
    },
  });
}

// Ein ganzer scharfer Lauf gegen den Doppelgaenger -- durch DIESELBE Funktion,
// die main() ruft. Nichts wird hier umgangen: Bindung, Ermaechtigung,
// Kanalvergleich, Verbrauch, Gedaechtnis und die Aufrufe liegen alle darin.
async function scharf(l, befund, ermPfad, { kanal, wirf, verarbeitung, videoId,
  privacyStatus, kanalId, kanalGefunden, wartegrenzeMs, jetzt } = {}) {
  const k = kanal || doppelgaenger({ wirf, verarbeitung, videoId, privacyStatus,
    kanalId, kanalGefunden });
  const aus = [];
  const fehler = [];
  const ergebnis = await L.scharferLauf({
    befund, projektwurzel: l.wurzel, exportOrdner: l.exp, bestaetigtDurch: ermPfad,
    baueKanal: async () => k,
    // KEIN ECHTES WARTEN. Die Frist wird ueber `jetzt` gestellt, nicht
    // ausgesessen.
    schlafe: async () => {},
    jetzt: jetzt || (() => Date.now()),
    melde: (t) => aus.push(t),
    meldeFehler: (t) => fehler.push(t),
    wartegrenzeMs,
    abfrageabstandMs: 0,
  });
  return Object.assign({}, ergebnis, {
    kanal: k,
    aufrufe: k.aufrufnamen(),
    aus: aus.join('\n'),
    fehler: fehler.join('\n'),
  });
}

function gedaechtnisVon(l) {
  const p = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ===========================================================================
// NACHWEIS 1: GENAU EIN SCHREIBENDER AUFRUF JE LAUF
// ===========================================================================

test('EP-N1: ein voller Lauf macht GENAU die fuenf Aufrufe, in dieser Reihenfolge', async () => {
  const l = lage('n1');
  try {
    const befund = trocken(l);
    assert.equal(befund.abbruch, null, JSON.stringify(befund.abbruch));
    const e = schreibeErmaechtigung(l, befund);
    const r = await scharf(l, befund, e.pfad);

    assert.equal(r.code, L.EXIT_OK, r.fehler);
    // DIE REIHENFOLGE IST DIE AUS VERTRAG 4 -- abgezaehlt und nicht "enthaelt".
    assert.deepEqual(r.aufrufe, [
      'channels.list',    // Schritt 9: auf welchen Kanal?
      'videos.insert',    // Aufruf 1  (Schritt 10)
      'videos.list',      // Schritt 11: das Warten
      'thumbnails.set',   // Aufruf 2  (Schritt 12)
      'videos.list',      // Schritt 13: zuruecklesen
    ]);
    // Und von jeder SCHREIBENDEN Sorte genau einer.
    for (const name of K.SCHREIBENDE_AUFRUFE) {
      assert.equal(r.aufrufe.filter((a) => a === name).length, 1,
        name + ' ist nicht genau einmal gemacht worden: ' + r.aufrufe.join(', '));
    }
    // Der Doppelgaenger fuehrt Namen UND Reihenfolge.
    const voll = r.kanal.aufrufe();
    assert.deepEqual(voll.map((a) => a.nr), [1, 2, 3, 4, 5]);
    assert.equal(voll[3].aufruf, 'thumbnails.set');
    assert.equal(voll[3].videoId, DOPPEL_VIDEO,
      'das Bild ging an eine andere Kennung als die des Uploads');
  } finally { l.weg(); }
});

test('EP-N1: die Zaehlung schnappt zu -- ein zweites videos.insert wird NICHT gemacht',
  async () => {
    // DIE GEGENPROBE. Ein Test, der nur zeigt, dass ein Lauf einen Upload
    // macht, hat nichts gezeigt. Hier wird der zweite provoziert.
    const k = doppelgaenger();
    await k.ladeVideoHoch({});
    let gefangen = null;
    try {
      await k.ladeVideoHoch({});
    } catch (e) { gefangen = e; }
    assert.ok(gefangen, 'ein zweites videos.insert kam durch -- das waere ein zweites Video');
    assert.match(gefangen.message, /SCHREIBSPERRE: videos\.insert/);
    // Die Meldung nennt den ERSTEN Aufruf mit. Ein Abbruch, der nur "schon
    // einmal" sagt, laesst offen, ob das erste Video existiert.
    assert.match(gefangen.message, /Aufruf Nr\. 1/);
    assert.match(gefangen.message, /ladeVideoHoch/);
    assert.match(gefangen.message, /ein zweites Video auf dem Kanal/);
    // Und der zweite ist NICHT in der Zaehlung gelandet: er ist nicht
    // geschehen, nicht nur gescheitert.
    assert.deepEqual(k.aufrufnamen(), ['videos.insert']);

    // Dasselbe gilt fuer den zweiten schreibenden Aufruf.
    const k2 = doppelgaenger();
    await k2.setzeThumbnail({ videoId: DOPPEL_VIDEO });
    await assert.rejects(() => k2.setzeThumbnail({ videoId: DOPPEL_VIDEO }),
      /SCHREIBSPERRE: thumbnails\.set/);
    assert.deepEqual(k2.aufrufnamen(), ['thumbnails.set']);

    // Ein LESENDER Aufruf darf beliebig oft: das Warten fragt bis zu 45
    // Minuten lang nach.
    const k3 = doppelgaenger();
    for (let i = 0; i < 5; i++) await k3.liesVerarbeitung({ videoId: DOPPEL_VIDEO });
    assert.equal(k3.aufrufnamen().length, 5);
  });

test('EP-N1: die Zaehlung steht im PROGRAMM und nicht nur im Test', () => {
  // Der Doppelgaenger geht durch K.zaehlenderKanal, und dieselbe Funktion legt
  // sich im scharfen Lauf um das echte Kanalobjekt. Ein Zaehler, den nur der
  // Test sieht, zaehlt genau dort, wo nichts passieren kann.
  const quelle = fs.readFileSync(path.join(WURZEL, 'src', 'upload', 'longform-kanal.js'),
    'utf8');
  assert.match(quelle, /return zaehlenderKanal\(rohKanal\(yt\)\);/);
  // Und es gibt keinen zweiten Weg zu einem Kanalobjekt: rohKanal wird genau
  // einmal aufgerufen, und zwar dort.
  const nurCode = quelle.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.equal((nurCode.match(/rohKanal\(/g) || []).length, 2,
    'rohKanal kommt anders als zweimal vor (Erklaerung und der eine Aufruf)');
  assert.equal((nurCode.match(/zaehlenderKanal\(/g) || []).length, 2);
});

// ===========================================================================
// NACHWEIS 2: videos.update IST NICHT ERREICHBAR
// ===========================================================================
//
// Wie in EG und EK: als Test, nicht als Zusicherung. Der dritte Aufruf ist der
// naechste Auftrag, und die Grenze zwischen den beiden ist der Sinn dieses
// Schnitts.

// Die Methoden, die dieser Weg NIE macht (Vertrag 7). `videos.update` steht
// vorn, weil es die eine ist, die nahe liegt.
const NIE = Object.freeze([
  'videos.update', 'videos.delete', 'videos.rate', 'videos.reportAbuse',
  'playlistItems.', 'playlists.', 'captions.', 'commentThreads', 'comments.',
  'liveBroadcasts', 'membershipsLevels', 'watermarks.',
]);

// DER VEROEFFENTLICHUNGSTERMIN STEHT NICHT IN `NIE`, UND DAS IST KEIN
// VERSEHEN. Die SHORTS-Linie benutzt ihn -- sie plant Termine, das ist ihr
// ganzer Zweck --, und uploader.js gehoert zur geliehenen Kette. Ein Test, der
// ihn dort verboete, verboete den Shorts-Weg. Er ist darum eine Zusage der
// LONGFORM-Module und wird unten an ihnen geprueft, dort aber schaerfer: sie
// duerfen ihn nicht einmal im Kommentar tragen.
const NIE_IM_LONGFORM = Object.freeze(['videos.update', 'publishAt']);

const LONGFORM_MODULE = Object.freeze([
  'src/upload/longform-arbeiter.js',
  'src/upload/longform-kanal.js',
  'src/upload/longform-gedaechtnis.js',
]);

// Jede Datei unter src/, die vom Arbeiter aus erreichbar ist. Nicht eine
// Liste, die jemand pflegt -- die geliehene Kette selbst, aus require.cache.
function geliehenKette() {
  const src = path.join(WURZEL, 'src') + path.sep;
  return Object.keys(require.cache)
    .filter((d) => d.startsWith(src))
    .sort();
}

test('EP-N2: keine Datei der geliehenen Kette kennt videos.update', () => {
  const dateien = geliehenKette();
  // Der Test prueft ins Leere, wenn die Kette leer ist.
  assert.ok(dateien.length >= 8,
    'die geliehene Kette hat nur ' + dateien.length + ' Dateien -- das kann nicht stimmen');
  assert.ok(dateien.some((d) => d.endsWith('longform-arbeiter.js')));
  assert.ok(dateien.some((d) => d.endsWith('longform-kanal.js')));
  assert.ok(dateien.some((d) => d.endsWith('uploader.js')));

  // GEPRUEFT WIRD DER CODE, NICHT DER KOMMENTAR. Der Shorts-Uploader erklaert
  // in seinem Kopf, dass er kein videos.update macht -- ein Satz, der die
  // Zusage NENNT, ist nicht ihre Verletzung. Was zaehlt, ist, ob eine Zeile
  // den Aufruf machen koennte.
  const funde = [];
  for (const datei of dateien) {
    const nurCode = fs.readFileSync(datei, 'utf8').split('\n')
      .filter((z) => !z.trim().startsWith('//') && !z.trim().startsWith('*'))
      .join('\n');
    for (const wort of NIE) {
      if (nurCode.includes(wort)) funde.push(path.relative(WURZEL, datei) + ': ' + wort);
    }
  }
  assert.deepEqual(funde, [],
    'eine erreichbare Datei kennt einen Aufruf, den dieser Weg nie macht:\n  ' +
    funde.join('\n  '));

  // GEGENPROBE: der Kommentarfilter darf nicht alles wegnehmen. Waere er zu
  // grosszuegig, saehe dieser Test gruen aus und haette nichts angesehen.
  const kanalCode = fs.readFileSync(path.join(WURZEL, 'src/upload/longform-kanal.js'), 'utf8')
    .split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.ok(kanalCode.includes('videos.insert'),
    'der Kommentarfilter hat den Code mit weggenommen -- dann prueft dieser Test nichts');
  assert.ok(kanalCode.includes('thumbnails.set'));
});

test('EP-N2: die Longform-Module tragen videos.update nicht einmal im Kommentar', () => {
  // SCHAERFER ALS OBEN, und nur fuer die drei Module dieses Weges. Ein
  // Kommentar, der den Namen traegt, ist die erste Zeile, die ihn enthaelt --
  // und die zweite ist die, die ihn benutzt.
  for (const datei of LONGFORM_MODULE) {
    const text = fs.readFileSync(path.join(WURZEL, datei), 'utf8');
    for (const wort of NIE_IM_LONGFORM) {
      assert.ok(!text.includes(wort), datei + ' nennt ' + wort);
    }
  }
  // Der Freigabedienst ebenso -- ganz, denn sein Shorts-Teil braucht keinen
  // von beiden.
  const dienst = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
  for (const wort of NIE_IM_LONGFORM) {
    assert.ok(!dienst.includes(wort), 'freigabe-server.js nennt ' + wort);
  }
  // Die Seite nur in ihrem LONGFORM-Teil: ihre Shorts-Haelfte faerbt die
  // Terminzeilen des Uploaders ein und muss den Feldnamen dafuer kennen.
  const seite = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-seite.js'), 'utf8');
  const longformTeil = seite.slice(seite.indexOf('// EL: DIE LONGFORM-ANSICHT'));
  assert.ok(longformTeil.length > 3000, 'der Longform-Teil der Seite wurde nicht gefunden');
  for (const wort of NIE_IM_LONGFORM) {
    assert.ok(!longformTeil.includes(wort),
      'die Longform-Ansicht nennt ' + wort);
  }
  // Und die Gegenprobe: der Shorts-Teil nennt den Termin sehr wohl -- sonst
  // haette der Schnitt oben nichts geschnitten.
  assert.ok(seite.slice(0, seite.indexOf('// EL: DIE LONGFORM-ANSICHT')).includes('publishAt'),
    'der Schnitt zwischen den beiden Haelften trifft nicht');
});

test('EP-N2: der Kanal hat GENAU die fuenf Methoden, und keine fuehrt weiter', () => {
  const k = doppelgaenger();
  // Abgezaehlt, nicht "enthaelt": eine sechste, die sich dazustellt, faellt
  // hier auf.
  assert.deepEqual(Object.keys(k).sort(),
    K.METHODENNAMEN.concat(['aufrufe', 'aufrufnamen']).sort());
  // Und die fuenf machen genau die vier Aufrufe (videos.list zweimal).
  assert.deepEqual(K.METHODENNAMEN.map((m) => K.METHODEN[m]).sort(),
    ['channels.list', 'thumbnails.set', 'videos.insert', 'videos.list', 'videos.list'].sort());
  for (const name of K.METHODENNAMEN) {
    assert.ok(K.ALLE_AUFRUFE.includes(K.METHODEN[name]),
      'die Methode ' + name + ' macht einen Aufruf, der in keiner Liste steht');
  }
  // Keine der beiden Listen kennt einen verbotenen Aufruf.
  for (const a of K.ALLE_AUFRUFE) {
    assert.ok(!NIE.includes(a), 'ein verbotener Aufruf steht in der Liste: ' + a);
  }
});

test('EP-N2: der Zaehler reicht NICHT durch -- was er nicht kennt, kommt nicht heraus', () => {
  // DIE GEGENPROBE, und sie ist der eigentliche Nachweis: ein inneres Objekt,
  // das eine Methode `stelleOeffentlich` traegt, kommt damit nicht nach
  // draussen. zaehlenderKanal baut sein Ergebnis AUS der Methodenliste und
  // nicht aus dem, was das innere Objekt mitbringt.
  const heimlich = {
    nenneKanal: async () => ({ gefunden: true, id: 'x', name: 'y' }),
    ladeVideoHoch: async () => ({ videoId: 'x' }),
    liesVerarbeitung: async () => ({}),
    setzeThumbnail: async () => ({}),
    liesVideoVoll: async () => ({}),
    stelleOeffentlich: async () => { throw new Error('das darf nicht erreichbar sein'); },
  };
  const k = K.zaehlenderKanal(heimlich);
  assert.equal(k.stelleOeffentlich, undefined,
    'eine Methode, die nicht in METHODEN steht, ist von aussen erreichbar');
  assert.ok(!Object.keys(k).includes('stelleOeffentlich'));
  // Und das innere Objekt selbst liegt nirgends offen: kein Feld des
  // Ergebnisses zeigt darauf.
  for (const [name, wert] of Object.entries(k)) {
    assert.notEqual(wert, heimlich, 'das innere Objekt haengt unter ' + name);
  }

  // Ein halbes Kanalobjekt wird gar nicht erst angenommen -- "kann nicht
  // vorkommen" ist keine Sicherung.
  assert.throws(() => K.zaehlenderKanal({ nenneKanal: async () => {} }),
    /fehlt die Methode/);
});

test('EP-N2: der echte Kanal haelt seinen Klienten in der Schliessung', () => {
  // rohKanal(yt) gibt fuenf Funktionen zurueck und KEIN Feld, das auf `yt`
  // zeigt. Wer das Objekt in der Hand hat, kommt von ihm aus an nichts, was
  // hier nicht steht.
  const yt = {
    videos: { insert: async () => ({}), list: async () => ({}), update: async () => {
      throw new Error('videos.update darf von hier aus nicht erreichbar sein');
    } },
    channels: { list: async () => ({ data: { items: [] } }) },
    thumbnails: { set: async () => ({}) },
  };
  const roh = K.rohKanal(yt);
  assert.deepEqual(Object.keys(roh).sort(), K.METHODENNAMEN.slice().sort());
  for (const [name, wert] of Object.entries(roh)) {
    assert.equal(typeof wert, 'function', name + ' ist keine Funktion');
    assert.notEqual(wert, yt);
  }
  // Auch nicht ueber den Zaehler.
  const k = K.zaehlenderKanal(roh);
  for (const wert of Object.values(k)) assert.notEqual(wert, yt);
});

test('EP-N2: die Anzeige sagt trotzdem, dass es den Schritt gibt und dass er fehlt', () => {
  // Ein Weg, der den Namen nicht nennt und den Schritt verschweigt, waere
  // keine Sicherung, sondern eine Luecke. Wo die Anzeige vom
  // Oeffentlichstellen spricht, tut sie es ueber die Vertragsstelle.
  const l = lage('n2-anzeige');
  try {
    const befund = trocken(l);
    const text = befund.saetze.join('\n');
    assert.ok(text.includes('Vertrag 2.5'), 'die Vorschau nennt die Vertragsstelle nicht');
    assert.ok(text.includes('DAS OEFFENTLICHE STELLEN GIBT ES NICHT'));

    // Und der Abschluss nach einem Lauf sagt es noch einmal, an der Stelle, an
    // der ein Mensch "es ist fertig" lesen wuerde.
    const eintrag = {
      sha256: l.videoSha, videoId: DOPPEL_VIDEO, hochgeladen_am: '2026-09-04T00:00:00Z',
      titel: 'x', tags: [], beschreibung_sha256: 'a'.repeat(64),
      ermaechtigung_upload: null, thumbnail: L.thumbnailEintrag(befund),
      verarbeitung: null, thumbnail_gesetzt_am: '2026-09-04T00:01:00Z',
      rueckgelesen: { thumbnails: null, status: null, gelesen_am: 'x' },
      stand: 'thumbnail_gesetzt',
    };
    const schluss = L.abschlussSaetze({
      befund, eintrag, zurueck: null, gedaechtnisPfad: 'x', aufrufe: [],
    }).join('\n');
    assert.ok(schluss.includes('HIER IST SCHLUSS'));
    assert.ok(schluss.includes('DAS VIDEO IST PRIVAT UND BLEIBT ES'));
    assert.ok(schluss.includes('DAS OEFFENTLICHE STELLEN GIBT ES IN DIESEM BAU NICHT'));
    assert.ok(schluss.includes('Vertrag 2.5'));
    assert.ok(!schluss.includes('videos.update'), 'der Abschluss nennt die Methode');
  } finally { l.weg(); }
});

// ===========================================================================
// NACHWEIS 3: DIE ERMAECHTIGUNG GILT EINMAL UND HAENGT AN DEM BEURTEILTEN
// ===========================================================================
//
// Sechzehn Faelle. Jeder laeuft durch DIESELBE Funktion, die main() ruft --
// Bindung, Ermaechtigung, Kanal, Verbrauch, Aufrufe. Und jeder muss dreierlei
// leisten:
//
//   1. Es wird NICHTS hochgeladen -- die Liste der Aufrufe traegt kein
//      videos.insert.
//   2. Der Code benennt den Fall, und keine zwei Faelle teilen sich einen.
//   3. Die MELDUNG benennt ihn auch. Zwei Lagen unter einem Satz sind der
//      Umriss jedes Fehlers dieser Reihe; darum werden alle sechzehn
//      Meldungen paarweise gegeneinander gehalten.

// Jeder Fall: ein Name, eine Aenderung an der Ermaechtigung (oder am Umfeld),
// der erwartete Code. `vorher` darf die Lage veraendern, bevor der Lauf
// beginnt.
function ermaechtigungsfaelle(l) {
  const andereSha = sha256(Buffer.from('eine andere Datei', 'utf8'));
  const anderesBild = sha256(Buffer.from('ein anderes Bild', 'utf8'));
  return [
    {
      name: 'andere Videodatei (sha256)',
      code: 'ermaechtigung_video_sha',
      aenderungen: { felder: { video_sha256: andereSha } },
    },
    {
      name: 'anderes Bild (Dateiname)',
      code: 'ermaechtigung_bild_name',
      aenderungen: { felder: { 'bild.dateiname': 'adw-ein-anderes.jpg' } },
    },
    {
      name: 'anderes Bild (sha256)',
      code: 'ermaechtigung_bild_sha',
      aenderungen: { felder: { 'bild.sha256': anderesBild } },
    },
    {
      name: 'anderer Beipackzettel',
      code: 'ermaechtigung_zettel_name',
      aenderungen: { felder: { 'zettel.dateiname': 'adw-ein-anderer.json' } },
    },
    {
      name: 'anderer Rang',
      code: 'ermaechtigung_zettel_rang',
      aenderungen: { felder: { 'zettel.rang': '2a' } },
    },
    {
      name: 'Rang 3 -- ein Weg, den es nicht gibt',
      code: 'ermaechtigung_rang3',
      aenderungen: { felder: { 'zettel.rang': 3 } },
    },
    {
      name: 'unbekannter Rang',
      code: 'ermaechtigung_zettel_rang_form',
      aenderungen: { felder: { 'zettel.rang': 'sieben' } },
    },
    {
      name: 'fremder Zweck -- die zweite Ermaechtigung gilt hier nicht',
      code: 'ermaechtigung_fremder_zweck',
      aenderungen: { felder: { zweck: 'ein anderer Zweck' } },
    },
    {
      name: 'andere Aufnahme',
      code: 'ermaechtigung_fremde_aufnahme',
      aenderungen: { felder: { aufnahme: ANDERE_AUFNAHME } },
    },
    {
      name: 'abgelaufen',
      code: 'ermaechtigung_abgelaufen',
      aenderungen: { jetzt: Date.now() - (G.ERMAECHTIGUNG_GUELTIG_MS + 5000) },
    },
    {
      name: 'aus der Zukunft',
      code: 'ermaechtigung_zukunft',
      aenderungen: { jetzt: Date.now() + 60000 },
    },
    {
      name: 'fremder Typ -- eine Shorts-Ermaechtigung',
      code: 'ermaechtigung_fremder_typ',
      aenderungen: { felder: { artifact_type: U.ERMAECHTIGUNG_ARTIFACT_TYPE } },
    },
    {
      name: 'fremde Fassung',
      code: 'ermaechtigung_fremde_version',
      aenderungen: { felder: { schema_version: '99.0' } },
    },
    {
      name: 'anderer Kanal',
      code: 'ermaechtigung_kanal',
      aenderungen: { felder: { kanal_id: 'EIN-ANDERER-DOPPELGAENGERKANAL' } },
    },
    {
      name: 'Pfad ausserhalb des Ermaechtigungsordners',
      code: 'ermaechtigung_pfad_fremd',
      aenderungen: { pfad: path.join(l.wurzel, 'anderswo.json') },
    },
    {
      name: 'gar keine Ermaechtigung',
      code: 'ermaechtigung_fehlt',
      // Sie wird geschrieben und vor dem Lauf wieder weggenommen -- so wie es
      // aussaehe, wenn sie schon verbraucht und geloescht waere.
      aenderungen: {},
      vorher: (pfad) => fs.unlinkSync(pfad),
    },
  ];
}

test('EP-N3: sechzehn Faelle, sechzehn Meldungen, kein einziger Upload', async () => {
  const l = lage('n3');
  try {
    const befund = trocken(l);
    assert.equal(befund.abbruch, null);

    const gesehen = [];
    for (const fall of ermaechtigungsfaelle(l)) {
      const e = schreibeErmaechtigung(l, befund, fall.aenderungen);
      if (fall.vorher) fall.vorher(e.pfad);
      const r = await scharf(l, befund, e.pfad);

      assert.equal(r.code, L.EXIT_BEFUND, fall.name + ': der Lauf endete mit ' + r.code);
      assert.equal(r.abbruch.code, fall.code,
        fall.name + ': erwartet ' + fall.code + ', bekommen ' + r.abbruch.code);
      // 1. NICHTS HOCHGELADEN.
      assert.ok(!r.aufrufe.includes('videos.insert'),
        fall.name + ': es wurde hochgeladen! Aufrufe: ' + r.aufrufe.join(', '));
      assert.ok(!r.aufrufe.includes('thumbnails.set'), fall.name + ': ein Bild wurde gesetzt');
      // Und kein Gedaechtnis entstanden.
      assert.equal(gedaechtnisVon(l), null,
        fall.name + ': es ist ein Gedaechtnis entstanden, obwohl nichts hochging');
      // 3. Die Meldung nennt den Fall.
      const meldung = r.abbruch.gruende.join(' ');
      assert.ok(meldung.length > 60, fall.name + ': die Meldung ist zu duenn: ' + meldung);
      gesehen.push({ name: fall.name, code: fall.code, meldung });
    }

    assert.equal(gesehen.length, 16, 'es sind nicht sechzehn Faelle');

    // 2. KEINE ZWEI TEILEN SICH EINEN CODE.
    const codes = gesehen.map((g) => g.code);
    assert.equal(new Set(codes).size, codes.length,
      'zwei Faelle tragen denselben Code: ' + codes.join(', '));

    // 3. KEINE ZWEI TEILEN SICH EINE MELDUNG -- paarweise und nicht ueber ein
    //    Set: die Fehlermeldung soll sagen, WELCHE beiden es sind.
    for (let i = 0; i < gesehen.length; i++) {
      for (let j = i + 1; j < gesehen.length; j++) {
        assert.notEqual(gesehen[i].meldung, gesehen[j].meldung,
          'die Faelle "' + gesehen[i].name + '" und "' + gesehen[j].name +
          '" teilen sich eine Meldung');
      }
    }
  } finally { l.weg(); }
});

test('EP-N3: die Ermaechtigung gilt EINMAL -- der zweite Lauf mit derselben laedt nicht hoch',
  async () => {
    const l = lage('n3-einmal');
    try {
      const befund = trocken(l);
      const e = schreibeErmaechtigung(l, befund);
      // Eine Kopie, Byte fuer Byte -- so, wie sie jemand vor dem Verbrauch
      // gezogen haette.
      const kopie = fs.readFileSync(e.pfad);

      // LAUF 1: er kommt bis zum Upload und bricht DORT ab. Damit ist die
      // Ermaechtigung verbraucht (sie wird VOR dem ersten schreibenden Aufruf
      // verbraucht) und das Gedaechtnis leer -- die Lage, in der ein zweiter
      // Lauf wirklich hochladen wuerde.
      const r1 = await scharf(l, befund, e.pfad, { wirf: 'ladeVideoHoch' });
      assert.equal(r1.code, L.EXIT_BEFUND);
      assert.equal(r1.abbruch.code, 'upload_fehlgeschlagen');
      assert.ok(r1.abbruch.gruende.join(' ').includes('NICHT SICHER, OB DAS VIDEO ANGEKOMMEN'),
        'die gefaehrlichste Lage wird nicht als solche benannt');
      assert.equal(fs.existsSync(e.pfad), false, 'die Ermaechtigung liegt noch da');
      assert.equal(gedaechtnisVon(l), null, 'ohne Kennung entsteht kein Eintrag');

      // Die Kopie zurueck an ihren Platz -- der Wiedereinspielversuch.
      fs.writeFileSync(e.pfad, kopie);
      assert.deepEqual(fs.readFileSync(e.pfad), kopie, 'die Kopie ist nicht dieselbe Datei');

      // LAUF 2: er faellt an der Verbrauchsliste, und zwar OHNE Netz -- die
      // Aufrufliste ist leer, es wurde nicht einmal ein Kanal gefragt.
      const r2 = await scharf(l, befund, e.pfad);
      assert.equal(r2.code, L.EXIT_BEFUND);
      assert.equal(r2.abbruch.code, 'ermaechtigung_verbraucht');
      assert.deepEqual(r2.aufrufe, [],
        'der zweite Lauf hat den Kanal gefragt, obwohl die Ermaechtigung verbraucht war');
      assert.ok(r2.abbruch.gruende.join(' ').includes('GENAU EINEN Lauf'));
      assert.equal(gedaechtnisVon(l), null);

      // Die Datei liegt noch da -- eine verbrauchte wird nicht noch einmal
      // geloescht, und sie gilt trotzdem nicht.
      assert.equal(fs.existsSync(e.pfad), true);
    } finally { l.weg(); }
  });

test('EP-N3: die Bindung kommt aus EINER Rechnung -- Dienst und Arbeiter teilen sie', () => {
  // Der Dienst schreibt die Ermaechtigung aus der Befundzeile, der Arbeiter
  // prueft sie gegen die Bindung. Kaemen die Werte aus zwei Rechnungen, waere
  // die abweichende ausgerechnet die, die den Upload ausloest.
  const l = lage('n3-bindung');
  try {
    const befund = trocken(l);
    const zeile = L.befundJson(befund);
    const direkt = L.bindung(befund);
    assert.equal(zeile.bindung.moeglich, true);
    assert.equal(zeile.bindung.video_sha256, direkt.video_sha256);
    assert.equal(zeile.bindung.video_sha256, l.videoSha);
    assert.equal(zeile.bindung.bild.dateiname, l.bildname);
    assert.equal(zeile.bindung.bild.sha256, l.bildSha);
    assert.equal(zeile.bindung.zettel.dateiname, l.zettelname);
    assert.equal(zeile.bindung.zettel.rang, 1);
    assert.equal(zeile.bindung.quelle, 'lauf');
    // Der PFAD des Bildes und sein Typ stehen NICHT in der Zeile: der Dienst
    // braucht sie fuer die Ermaechtigung nicht, und was im Baum liegt, ohne
    // dass es jemand benutzt, ist die Einladung, es eines Tages zu benutzen.
    assert.equal(zeile.bindung.bild.pfad, undefined);
    assert.equal(zeile.bindung.bild.typ, undefined);
  } finally { l.weg(); }
});

test('EP-N3: ohne Bindung gibt es keinen Knopf, und der Grund steht dabei', () => {
  // Ein fehlender Knopf ohne Grund sieht aus wie ein vergessener.
  const l = lage('n3-ohne', { zettelfelder: { videotitel: null } });
  try {
    const befund = trocken(l);
    assert.ok(befund.abbruch, 'diese Lage haette abbrechen muessen');
    const b = L.bindungsZeile(befund);
    assert.equal(b.moeglich, false);
    assert.ok(b.grund.length > 60, 'der Grund ist zu duenn: ' + b.grund);
    assert.ok(b.grund.includes(befund.abbruch.code), 'der Grund nennt den Befund nicht');
  } finally { l.weg(); }
});

test('EP-N3: der Rang 3 hat eine EIGENE Meldung, nicht die fuer einen unbekannten Rang',
  async () => {
  // 3 ist ein bekannter Rang des Vertrags -- er ist nur kein Weg, der bis zu
  // einer Ermaechtigung fuehrt. "Unbekannter Rang" waere hier die falsche
  // Auskunft, und ein Mensch suchte den Fehler an der falschen Stelle.
  const l = lage('n3-rang3');
  try {
    const befund = trocken(l);
    const drei = schreibeErmaechtigung(l, befund, { felder: { 'zettel.rang': 3 } });
    const sieben = schreibeErmaechtigung(l, befund, { felder: { 'zettel.rang': 'sieben' } });
    const a = await scharf(l, befund, drei.pfad);
    const b = await scharf(l, befund, sieben.pfad);
    assert.equal(a.abbruch.code, 'ermaechtigung_rang3');
    assert.equal(b.abbruch.code, 'ermaechtigung_zettel_rang_form');
    assert.notEqual(a.abbruch.gruende[0], b.abbruch.gruende[0]);
    assert.ok(a.abbruch.gruende[0].includes('ohne Zettel gibt es keinen Titel'),
      'die Rang-3-Meldung sagt nicht, warum es diesen Weg nicht gibt');
    assert.ok(a.abbruch.gruende[0].includes('Compositor'),
      'sie sagt nicht, wo der Weg zurueck ist');
    // Und Rang 3 steht nicht in der Liste der einloesbaren Raenge -- der
    // Zweig ist eine SPERRE und kein toter Weg.
    assert.deepEqual(G.ERLAUBTE_RAENGE.slice(), [1, '2a', '2b']);
  } finally { l.weg(); }
});

// ===========================================================================
// NACHWEIS 4: DER ABBRUCH IN DER MITTE
// ===========================================================================
//
// DAS IST DER TEUERSTE FEHLER, DEN DIESER WEG MACHEN KANN: ein Lauf bricht
// nach dem Upload und vor dem Thumbnail ab, jemand startet neu, und es
// entsteht ein ZWEITES Video auf dem Kanal. Kein Test dieser Datei ist
// wichtiger.
//
// Der Nachweis beginnt darum mit dem SCHADEN: erst wird gezeigt, was ohne die
// Abwehr geschaehe, dann dass es nicht mehr geht. Ein Test, der nur die heile
// Lage prueft, sagt nicht, ob die Abwehr etwas tut oder ob der Fall gar nicht
// eintreten kann.
//
// DIE ABWEHR IST DAS GEDAECHTNIS, und sie ist geliehen: der Schluessel ist die
// sha256 der Videodatei (uploader.schonHochgeladen), nicht der Pfad und nicht
// ein Name. Der Shorts-Uploader hat mit dieser einen Zeile 21 Shorts ohne
// Doppel-Upload hochgeladen.

// Ein Lauf, der nach videos.insert und VOR thumbnails.set abbricht -- der
// Absturz wird nachgestellt, indem der Doppelgaenger beim Warten wirft.
async function laufBrichtNachUploadAb(l, befund) {
  const e = schreibeErmaechtigung(l, befund);
  const r = await scharf(l, befund, e.pfad, { wirf: 'liesVerarbeitung' });
  assert.equal(r.code, L.EXIT_BEFUND, 'der Lauf haette abbrechen muessen');
  assert.equal(r.abbruch.code, 'verarbeitung_nicht_lesbar');
  // Die Zaehlung fuehrt AUCH den Aufruf, der geworfen hat: er ist gemacht
  // worden und gescheitert, nicht unterblieben. Ein Zaehler, der nur die
  // gelungenen fuehrte, saehe einen halb ausgefuehrten Aufruf als
  // ungeschehen an -- und genau die Lage ist die gefaehrliche.
  assert.deepEqual(r.aufrufe, ['channels.list', 'videos.insert', 'videos.list'],
    'der Lauf ist nicht dort abgebrochen, wo er sollte: ' + r.aufrufe.join(', '));
  assert.ok(!r.aufrufe.includes('thumbnails.set'),
    'der Lauf ist ueber thumbnails.set hinausgekommen');
  return r;
}

test('EP-N4: bricht der Lauf nach dem Upload ab, steht die Kennung trotzdem im Gedaechtnis',
  async () => {
    // OHNE DIESEN SCHRITT GIBT ES KEINE ABWEHR. Ein Gedaechtnis, das einen
    // Upload vergisst, waere der Fehler, den es verhindern soll (Vertrag 5.2)
    // -- darum wird es geschrieben, BEVOR die Antwort geprueft wird.
    const l = lage('n4-vermerk');
    try {
      const befund = trocken(l);
      const r = await laufBrichtNachUploadAb(l, befund);

      const g = gedaechtnisVon(l);
      assert.ok(g, 'es ist kein Gedaechtnis entstanden -- der Upload ist vergessen');
      assert.equal(g.artifact_type, G.GEDAECHTNIS_ARTIFACT_TYPE);
      assert.equal(g.aufnahme, AUFNAHME);
      assert.equal(g.video.sha256, l.videoSha);
      assert.equal(g.uploads.length, 1);
      const eintrag = g.uploads[0];
      assert.equal(eintrag.sha256, l.videoSha, 'der Schluessel ist nicht die sha256');
      assert.equal(eintrag.videoId, DOPPEL_VIDEO);
      assert.equal(eintrag.stand, 'hochgeladen');
      assert.equal(eintrag.thumbnail_gesetzt_am, null);
      assert.equal(eintrag.thumbnail.dateiname, l.bildname);
      assert.equal(eintrag.thumbnail.sha256, l.bildSha);
      assert.equal(eintrag.thumbnail.rang, 1);
      assert.equal(eintrag.ermaechtigung_upload.zufall.length, 64);

      // Und die Abbruchmeldung sagt als ERSTEN Satz, dass ein Video oben liegt
      // (Vertrag 6). Das ist der Unterschied zum Shorts-Uploader: ein 1 kann
      // hier NACH Aufruf 1 fallen.
      const ersteZeile = r.fehler.split('\n').find((z) => z.trim() !== '');
      assert.ok(ersteZeile.includes('liegt PRIVAT auf dem Kanal'),
        'der erste Satz sagt nicht, dass ein Video oben liegt: ' + ersteZeile);
      assert.ok(ersteZeile.includes(DOPPEL_VIDEO), 'er nennt die Kennung nicht');
      assert.ok(ersteZeile.includes('hochgeladen'), 'er nennt den Stand nicht');
    } finally { l.weg(); }
  });

test('EP-N4: DER SCHADEN -- ohne das Gedaechtnis entsteht ein ZWEITES Video', async () => {
  // ERST DER SCHADEN. Hier wird das Gedaechtnis weggenommen -- genau das, was
  // ein Mensch taete, der "neu anfangen" will -- und der zweite Lauf laedt
  // WIRKLICH ein zweites Mal hoch. Das ist keine Simulation: es ist derselbe
  // Code, dieselbe Ermaechtigung, derselbe Weg. Nur die eine Datei fehlt.
  const l = lage('n4-schaden');
  try {
    const befund1 = trocken(l);
    await laufBrichtNachUploadAb(l, befund1);
    const gPfad = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
    assert.equal(fs.existsSync(gPfad), true);

    // DIE ABWEHR WEGNEHMEN.
    fs.unlinkSync(gPfad);

    const befund2 = trocken(l);
    assert.equal(befund2.gedaechtnis.vorhanden, false,
      'der Lauf sieht das Gedaechtnis noch -- dann zeigt dieser Test nichts');
    const e2 = schreibeErmaechtigung(l, befund2);
    const r2 = await scharf(l, befund2, e2.pfad, { videoId: DOPPEL_VIDEO + '-ZWEI' });

    // DER SCHADEN, AUSGESPROCHEN: ein zweiter Upload, ein zweites Video.
    assert.equal(r2.code, L.EXIT_OK, r2.fehler);
    assert.ok(r2.aufrufe.includes('videos.insert'),
      'der zweite Lauf hat NICHT hochgeladen -- dann zeigt dieser Test den Schaden nicht');
    assert.equal(r2.aufrufe.filter((a) => a === 'videos.insert').length, 1);
    const g2 = gedaechtnisVon(l);
    assert.equal(g2.uploads[0].videoId, DOPPEL_VIDEO + '-ZWEI',
      'es ist ein ZWEITES Video entstanden -- genau das ist der Schaden, den die naechste ' +
      'Haelfte dieses Nachweises verhindert');
  } finally { l.weg(); }
});

test('EP-N4: DIE ABWEHR -- mit dem Gedaechtnis entsteht KEIN zweites Video', async () => {
  // DIESELBE LAGE, DERSELBE ZWEITE LAUF -- nur bleibt das Gedaechtnis liegen.
  const l = lage('n4-abwehr');
  try {
    const befund1 = trocken(l);
    await laufBrichtNachUploadAb(l, befund1);
    const gPfad = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
    const vorher = fs.readFileSync(gPfad, 'utf8');

    // DER ZWEITE LAUF. Er sieht das Gedaechtnis und setzt bei Schritt 11 an.
    const befund2 = trocken(l);
    assert.equal(befund2.gedaechtnis.vorhanden, true);
    assert.equal(befund2.gedaechtnis.stand, 'hochgeladen');
    assert.equal(befund2.gedaechtnis.weiter.ab, 'warten');
    assert.ok(befund2.gedaechtnis.satz.includes('KEIN zweites Video'),
      'die Vorschau sagt nicht, dass kein zweites entsteht');

    // Die Bindung kommt jetzt aus dem GEDAECHTNIS und nicht aus dem Lauf
    // (Vertrag 5.3): die Zettelwahl wird nicht wiederholt.
    const b = L.bindungsZeile(befund2);
    assert.equal(b.moeglich, true);
    assert.equal(b.quelle, 'gedaechtnis');
    assert.equal(b.weiter_ab, 'warten');

    const e2 = schreibeErmaechtigung(l, befund2);
    const r2 = await scharf(l, befund2, e2.pfad, { videoId: DOPPEL_VIDEO + '-ZWEI' });

    assert.equal(r2.code, L.EXIT_OK, r2.fehler);
    // DER NACHWEIS: KEIN ZWEITER UPLOAD.
    assert.ok(!r2.aufrufe.includes('videos.insert'),
      'es wurde ein zweites Mal hochgeladen: ' + r2.aufrufe.join(', '));
    assert.deepEqual(r2.aufrufe, ['channels.list', 'videos.list', 'thumbnails.set',
      'videos.list'], 'der zweite Lauf ist nicht bei Schritt 11 eingestiegen');
    assert.ok(r2.aus.includes('Kein Upload: dieses Video steht schon im Gedaechtnis'),
      'der Lauf sagt nicht, warum er nicht hochlaedt');

    // Es ist bei EINEM Video geblieben -- derselbe Eintrag, dieselbe Kennung.
    const g2 = gedaechtnisVon(l);
    assert.equal(g2.uploads.length, 1);
    assert.equal(g2.uploads[0].videoId, DOPPEL_VIDEO,
      'die Kennung hat gewechselt -- dann ist ein zweites Video entstanden');
    assert.equal(g2.uploads[0].stand, 'thumbnail_gesetzt');
    assert.notEqual(fs.readFileSync(gPfad, 'utf8'), vorher,
      'das Gedaechtnis wurde nicht fortgeschrieben');

    // Und das Bild ging an DIE Kennung aus dem Gedaechtnis (Zielsperre,
    // Vertrag 7) -- nicht an die, die der Doppelgaenger diesmal anbot.
    const gesetzt = r2.kanal.aufrufe().find((a) => a.aufruf === 'thumbnails.set');
    assert.equal(gesetzt.videoId, DOPPEL_VIDEO);
  } finally { l.weg(); }
});

test('EP-N4: die Zielsperre haelt -- kein Thumbnail auf eine fremde Kennung', () => {
  // Vertrag 7: "Kein thumbnails.set auf eine videoId, die nicht Aufruf 1
  // dieses Gedaechtnisses zurueckgegeben hat." Gemessen in CV und CX: ein
  // Thumbnail auf ein Short ersetzt dort die 16:9-Ableitungen, antwortet mit
  // 200 und laesst sich nicht zurueckdrehen. Ein Fehlgriff hier ist stumm und
  // unumkehrbar -- eine Erwartung waere keine Sicherung.
  const eintrag = { videoId: DOPPEL_VIDEO };
  assert.deepEqual(L.pruefeThumbnailZiel(eintrag, DOPPEL_VIDEO), { ok: true, satz: null });
  const fremd = L.pruefeThumbnailZiel(eintrag, 'EINE-FREMDE-KENNUNG');
  assert.equal(fremd.ok, false);
  assert.ok(fremd.satz.includes('ZIELSPERRE'));
  assert.ok(fremd.satz.includes('nicht zurueckdrehen'));
  assert.equal(L.pruefeThumbnailZiel({ videoId: null }, DOPPEL_VIDEO).ok, false);
  assert.equal(L.pruefeThumbnailZiel(null, DOPPEL_VIDEO).ok, false);
});

test('EP-N4: eine ANDERE Videodatei unter demselben Namen laedt nicht ein zweites Mal hoch',
  async () => {
    // Vertrag 5.1: "Weicht die sha256 der Datei auf der Platte von der im
    // Gedaechtnis ab, ist das kein zweiter Lauf desselben Videos, sondern ein
    // anderes Video unter demselben Namen." Ein Render laesst sich wiederholen,
    // und der Pfad bleibt derselbe.
    const l = lage('n4-neuer-render');
    try {
      const befund1 = trocken(l);
      await laufBrichtNachUploadAb(l, befund1);

      // NEU GERENDERT: derselbe Pfad, ein anderer Inhalt.
      fs.writeFileSync(l.videoPfad, Buffer.alloc(300000, 5));

      const befund2 = trocken(l);
      assert.ok(befund2.abbruch, 'der Lauf haette abbrechen muessen');
      assert.equal(befund2.abbruch.code, 'andere_videodatei');
      assert.equal(befund2.abbruch.nach, '5.1');
      const satz = befund2.gedaechtnis.satz;
      // Die Meldung nennt BEIDE Pruefsummen und die Kennung des ersten.
      assert.ok(satz.includes(l.videoSha), 'die alte Pruefsumme fehlt');
      assert.ok(satz.includes(sha256(Buffer.alloc(300000, 5))), 'die neue Pruefsumme fehlt');
      assert.ok(satz.includes(DOPPEL_VIDEO), 'die Kennung des ersten Videos fehlt');
      assert.ok(satz.includes('KEIN zweites'), 'sie sagt nicht, dass nichts hochgeht');

      // Und es gibt keinen Knopf: auf einen Befund folgt keiner.
      assert.equal(L.bindungsZeile(befund2).moeglich, false);
    } finally { l.weg(); }
  });

test('EP-N4: ein Video, das schon oeffentlich ist, wird nicht angefasst', async () => {
  // 5.3, letzte Zeile. Dieser Bau kann den Stand `oeffentlich` nicht selbst
  // schreiben -- er kommt aus einem Lauf, den es noch nicht gibt. Der Zweig
  // ist trotzdem gebaut: er ist die Sperre, die ein SPAETERER Lauf braucht,
  // und er faengt heute schon ein von Hand gesetztes Feld.
  const l = lage('n4-oeffentlich');
  try {
    const befund1 = trocken(l);
    await laufBrichtNachUploadAb(l, befund1);
    const gPfad = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
    const g = JSON.parse(fs.readFileSync(gPfad, 'utf8'));
    g.uploads[0].stand = 'oeffentlich';
    g.uploads[0].oeffentlich_am = '2026-09-04T12:00:00Z';
    fs.writeFileSync(gPfad, JSON.stringify(g, null, 2));

    const befund2 = trocken(l);
    assert.ok(befund2.abbruch);
    assert.equal(befund2.abbruch.code, 'video_schon_oeffentlich');
    assert.ok(befund2.gedaechtnis.satz.includes('bereits OEFFENTLICH'));
    // Der erste Satz der Vorschau hat jetzt die DRITTE Form.
    const zeilen = befund2.saetze;
    assert.ok(zeilen.some((z) => z.includes('ist OEFFENTLICH auf dem Kanal')),
      'der erste Satz nennt den oeffentlichen Zustand nicht');
    assert.equal(L.bindungsZeile(befund2).moeglich, false);

    // Und ein scharfer Lauf faellt, ohne den Kanal auch nur zu fragen.
    const e = G.neueErmaechtigung({
      aufnahme: AUFNAHME, videoSha256: l.videoSha,
      bildDateiname: l.bildname, bildSha256: l.bildSha,
      zettelDateiname: l.zettelname, rang: 1,
      kanalId: DOPPEL_KANAL_ID, kanalName: DOPPEL_KANAL_NAME,
      zufall: G.neuerZufall(), jetzt: Date.now(),
    });
    const pfad = G.ermaechtigungPfad(l.wurzel, e.zufall);
    S.schreibeErmaechtigung(pfad, e);
    const r = await scharf(l, befund2, pfad);
    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.abbruch.code, 'nichts_einzuloesen');
    assert.deepEqual(r.aufrufe, []);
    // Die Ermaechtigung wurde NICHT verbraucht: es gab nichts einzuloesen.
    assert.equal(fs.existsSync(pfad), true,
      'die Ermaechtigung wurde verbraucht, obwohl es nichts zu tun gab');
  } finally { l.weg(); }
});

test('EP-N4: ein FERTIGER Schritt ist kein Befund -- er endet mit 0 und tut nichts',
  async () => {
    // "fertig" und "ich fasse das nicht an" duerfen nicht denselben
    // Rueckgabewert tragen (Vertrag 6).
    const l = lage('n4-fertig');
    try {
      const befund1 = trocken(l);
      const e1 = schreibeErmaechtigung(l, befund1);
      const r1 = await scharf(l, befund1, e1.pfad);
      assert.equal(r1.code, L.EXIT_OK);
      assert.equal(gedaechtnisVon(l).uploads[0].stand, 'thumbnail_gesetzt');

      const befund2 = trocken(l);
      assert.equal(befund2.abbruch, null, 'ein fertiger Schritt ist kein Abbruch');
      assert.equal(befund2.gedaechtnis.weiter.ab, null);
      assert.equal(L.bindungsZeile(befund2).moeglich, false);

      const e2 = schreibeErmaechtigung(l, befund1);   // Bindung aus Lauf 1
      const r2 = await scharf(l, befund2, e2.pfad);
      assert.equal(r2.code, L.EXIT_OK, 'ein fertiger Schritt endet nicht mit 0');
      assert.deepEqual(r2.aufrufe, []);
      assert.ok(r2.aus.includes('NICHTS ZU TUN'));
      assert.ok(r2.aus.includes('zweite Ermaechtigung') || r2.aus.includes('ZWEITE'),
        'es wird nicht gesagt, was fehlte: ' + r2.aus);
      // Es ist bei einem Video geblieben.
      assert.equal(gedaechtnisVon(l).uploads.length, 1);
    } finally { l.weg(); }
  });

// ===========================================================================
// NACHWEIS 5: KEIN ECHTER AUFRUF IST MOEGLICH
// ===========================================================================
//
// Die anderen Nachweise laufen gegen einen Doppelgaenger. Dieser hier prueft,
// dass es KEINEN Weg an ihm vorbei gibt: jeder Netzweg wird scharfgestellt --
// die Bibliothek, die vier Wege, auf denen eine Verbindung entstuende, die
// Namensaufloesung und fetch --, und der volle Durchlauf laeuft dagegen. Wuerde
// irgendetwas davon angefasst, faellt der Test.
//
// UND DIE FALLE WIRD PROVOZIERT. Eine Falle, von der man nur weiss, dass sie
// nicht zugeschnappt ist, kann auch kaputt sein.

const Module = require('node:module');

// Jeder Weg, auf dem aus diesem Prozess eine Verbindung nach draussen wuerde.
// Die Liste ist absichtlich laenger als noetig: was hier fehlt, ist der Weg,
// den niemand geprueft hat.
function netzfalleStellen() {
  const beruehrt = [];
  const echt = {};
  const schnapp = (was) => {
    beruehrt.push(was);
    throw new Error('NETZFALLE: ' + was + ' -- dieser Lauf hat einen echten Aufruf versucht.');
  };

  const netz = require('node:net');
  const tls = require('node:tls');
  const http = require('node:http');
  const https = require('node:https');
  const dns = require('node:dns');

  const stelle = (objekt, name, marke) => {
    if (typeof objekt[name] !== 'function') return;
    echt[marke] = { objekt, name, wert: objekt[name] };
    objekt[name] = function () { return schnapp(marke); };
  };
  stelle(http, 'request', 'http.request');
  stelle(http, 'get', 'http.get');
  stelle(https, 'request', 'https.request');
  stelle(https, 'get', 'https.get');
  stelle(netz, 'connect', 'net.connect');
  stelle(netz, 'createConnection', 'net.createConnection');
  stelle(netz.Socket.prototype, 'connect', 'net.Socket.connect');
  stelle(tls, 'connect', 'tls.connect');
  stelle(dns, 'lookup', 'dns.lookup');
  stelle(dns, 'resolve', 'dns.resolve');
  stelle(dns.promises, 'lookup', 'dns.promises.lookup');
  stelle(globalThis, 'fetch', 'fetch');

  // Und die Bibliothek selbst: sie darf nicht einmal GELADEN werden.
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
        const e = echt[marke];
        e.objekt[e.name] = e.wert;
      }
    },
  };
}

test('EP-N5: der volle Durchlauf fasst keinen Netzweg an', async () => {
  const l = lage('n5');
  let waehrendDesLaufs = null;
  let r = null;
  try {
    const befund = trocken(l);
    const e = schreibeErmaechtigung(l, befund);
    const falle = netzfalleStellen();
    try {
      r = await scharf(l, befund, e.pfad);
    } finally {
      // Erst zaehlen, dann loesen -- sonst faende schon die Fehlerausgabe
      // einen Weg hinaus.
      waehrendDesLaufs = falle.beruehrt.slice();
      falle.loesen();
    }
    assert.deepEqual(waehrendDesLaufs, [],
      'der Lauf hat einen Netzweg angefasst: ' + waehrendDesLaufs.join(', '));

    // UND DER DURCHLAUF WAR EIN ECHTER, KEIN LEERER: er hat hochgeladen, das
    // Bild gesetzt und zurueckgelesen -- gegen den Doppelgaenger.
    assert.equal(r.code, L.EXIT_OK, r.fehler);
    assert.deepEqual(r.aufrufe, ['channels.list', 'videos.insert', 'videos.list',
      'thumbnails.set', 'videos.list']);
    assert.equal(gedaechtnisVon(l).uploads[0].stand, 'thumbnail_gesetzt');
  } finally { l.weg(); }
});

test('EP-N5: die Falle schnappt zu -- vorgefuehrt an jedem einzelnen Weg', async () => {
  // DIE GEGENPROBE. Eine Falle, von der man nur weiss, dass sie nicht
  // zugeschnappt ist, kann auch kaputt sein.
  const falle = netzfalleStellen();
  const gefangen = [];
  try {
    const http = require('node:http');
    const https = require('node:https');
    const netz = require('node:net');
    const tls = require('node:tls');
    const dns = require('node:dns');
    const versuche = [
      ['http.request', () => http.request('http://127.0.0.1:1/')],
      ['https.request', () => https.request('https://127.0.0.1:1/')],
      ['net.connect', () => netz.connect(1, '127.0.0.1')],
      ['tls.connect', () => tls.connect(1, '127.0.0.1')],
      ['dns.lookup', () => dns.lookup('127.0.0.1', () => {})],
      ['fetch', () => globalThis.fetch('https://127.0.0.1:1/')],
      // UND DIE BIBLIOTHEK: sie laesst sich nicht einmal laden.
      ['require(googleapis)', () => require('googleapis')],
    ];
    for (const [name, tun] of versuche) {
      let fehler = null;
      try { tun(); } catch (e) { fehler = e; }
      if (fehler && /NETZFALLE/.test(fehler.message)) gefangen.push(name);
    }
  } finally {
    falle.loesen();
  }
  assert.equal(gefangen.length, 7,
    'nicht jeder Weg ist scharf: gefangen wurden ' + gefangen.join(', '));

  // UND DER WEG, DEN DIESES PROJEKT WIRKLICH GEHT: baueEchtenKanal() holt die
  // Bibliothek. Mit gestellter Falle kommt es nicht durch -- also kann kein
  // Test dieser Datei versehentlich einen echten Kanal bekommen.
  const falle2 = netzfalleStellen();
  let gefangen2 = null;
  try {
    await K.baueEchtenKanal();
  } catch (e) {
    gefangen2 = e;
  } finally {
    falle2.loesen();
  }
  assert.ok(gefangen2, 'baueEchtenKanal ist durchgekommen');
  assert.match(gefangen2.message, /NETZFALLE/);
});

test('EP-N5: ohne --execute wird die Netzbibliothek nicht einmal geladen', () => {
  // Vertrag 3.1: "ohne --execute kein Netz, nicht einmal googleapis geladen."
  // Der Trockenlauf ist oben in dieser Datei hundertfach gelaufen; wenn er die
  // Bibliothek zoege, stuende sie jetzt in require.cache.
  const geladen = Object.keys(require.cache).filter((k) => /googleapis|google-auth/.test(k));
  assert.deepEqual(geladen, [],
    'die Netzbibliothek ist geladen worden: ' + geladen.join(', '));

  // Und sie wird an GENAU EINER Stelle geholt.
  const kanal = fs.readFileSync(path.join(WURZEL, 'src/upload/longform-kanal.js'), 'utf8');
  const nurCode = kanal.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.equal((nurCode.match(/require\('googleapis'\)/g) || []).length, 1);
  // Sie steht INNERHALB einer Funktion und nicht im Kopf der Datei.
  const vorDerFunktion = nurCode.slice(0, nurCode.indexOf("require('googleapis')"));
  assert.ok(vorDerFunktion.includes('async function baueEchtenKanal()'),
    'die Bibliothek wird ausserhalb von baueEchtenKanal geholt -- dann laedt sie jeder ' +
    'Trockenlauf mit');
});

test('EP-N5: der Trockenlauf schreibt nichts -- auch nicht ins Gedaechtnis', () => {
  // EK hat das fuer die lesende Haelfte gezeigt. Seit EP liest der Trockenlauf
  // zusaetzlich das Gedaechtnis, und LESEN ist nicht SCHREIBEN -- das ist die
  // Zusage, die hier nachgerechnet wird.
  const l = lage('n5-trocken');
  const schreibend = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
    'mkdirSync', 'mkdir', 'rmSync', 'rm', 'unlinkSync', 'unlink', 'renameSync', 'rename',
    'copyFileSync', 'copyFile', 'createWriteStream', 'writeSync', 'write', 'truncateSync',
    'utimesSync', 'symlinkSync', 'linkSync', 'cpSync'];
  const verletzungen = [];
  const echt = {};
  try {
    for (const name of schreibend) {
      if (typeof fs[name] !== 'function') continue;
      echt[name] = fs[name];
      fs[name] = function (...args) {
        verletzungen.push('fs.' + name + '(' + JSON.stringify(String(args[0])) + ')');
        throw new Error('SCHREIBFALLE: fs.' + name);
      };
    }
    echt.openSync = fs.openSync;
    fs.openSync = function (pfad, kennzeichen, ...rest) {
      const k = kennzeichen === undefined ? 'r' : kennzeichen;
      if (k !== 'r' && k !== 0 && k !== 'rs') {
        verletzungen.push('fs.openSync(' + JSON.stringify(String(pfad)) + ', ' +
          JSON.stringify(k) + ')');
        throw new Error('SCHREIBFALLE: fs.openSync');
      }
      return echt.openSync.call(fs, pfad, k, ...rest);
    };
    const befund = trocken(l);
    assert.equal(verletzungen.length, 0, 'der Trockenlauf hat geschrieben: ' +
      verletzungen.join(', '));
    assert.equal(befund.abbruch, null, 'der Durchlauf war kein echter');
    // Und er hat das Gedaechtnis wirklich ANGESEHEN.
    assert.ok(befund.gedaechtnis.gelesen);
    assert.equal(befund.gedaechtnis.vorhanden, false);
    assert.ok(befund.gedaechtnis.satz.includes('noch kein Langformvideo'));
  } finally {
    for (const name of Object.keys(echt)) fs[name] = echt[name];
    l.weg();
  }
});

// ===========================================================================
// NACHWEIS 6: DIE SHORTS-LINIE IST UNVERAENDERT
// ===========================================================================
//
// Ueber diesen Weg sind 21 Shorts hochgeladen worden. Ein einziges
// abweichendes Zeichen ist ein Fund und keine Nebensache.
//
// Der Vergleich holt die alte Fassung aus git. Ist git nicht da oder der
// Commit nicht im Klon (ein flacher Klon etwa), wird der Test LAUT
// uebersprungen und nicht still bestanden -- ein stiller Uebersprung waere
// hier das Schlimmste: der Test, der die 21 Uploads deckt, saehe gruen aus und
// haette nichts geprueft.

const STAND_VOR_EP = 'bd886d7';

function ausGit(datei) {
  const g = spawnSync('git', ['show', STAND_VOR_EP + ':' + datei],
    { cwd: WURZEL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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
        kennung: AUFNAHME + '/' + i, pfad: datei, sha256: sha256(inhalt),
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

test('EP-N6: die ausgelieferte Shorts-Seite ist Byte fuer Byte die von ' + STAND_VOR_EP, () => {
  const alt = ausGit('src/upload/freigabe-seite.js');
  if (alt === null) {
    assert.fail('Der Stand ' + STAND_VOR_EP + ' ist aus git nicht zu holen. Dieser Test ' +
      'kann so nicht laufen, und er wird nicht als bestanden gezaehlt.');
  }
  const ordner = wegwerfordner('n6');
  try {
    const altDatei = path.join(ordner, 'freigabe-seite-alt.cjs');
    fs.writeFileSync(altDatei, alt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const ALT = require(altDatei);

    const sitzung = shortsSitzungFuerVergleich(ordner);
    const vorher = Buffer.from(ALT.baueSeite(sitzung), 'utf8');
    const nachher = Buffer.from(SEITE.baueSeite(sitzung), 'utf8');

    assert.equal(nachher.length, vorher.length,
      'die Shorts-Seite ist ' + nachher.length + ' Bytes gross, vor EP waren es ' +
      vorher.length);
    if (!nachher.equals(vorher)) {
      let i = 0;
      while (i < vorher.length && vorher[i] === nachher[i]) i++;
      assert.fail('Die Shorts-Seite weicht ab Byte ' + i + ' ab.\n' +
        '  vorher:  ' + JSON.stringify(vorher.toString('utf8', Math.max(0, i - 60), i + 60)) +
        '\n  nachher: ' + JSON.stringify(nachher.toString('utf8', Math.max(0, i - 60),
          i + 60)));
    }

    // GEGENPROBE: der Vergleich muss zuschnappen. Ein Test, der nur gleiche
    // Dinge gleich nennt, hat nichts gezeigt.
    const verletzt = alt.replace('Shorts-Freigabe</title>', 'Shorts-Freigabe.</title>');
    assert.notEqual(verletzt, alt, 'die Gegenprobe hat wirklich etwas geaendert');
    const kaputtDatei = path.join(ordner, 'freigabe-seite-verletzt.cjs');
    fs.writeFileSync(kaputtDatei, verletzt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const KAPUTT = require(kaputtDatei);
    const anders = Buffer.from(KAPUTT.baueSeite(sitzung), 'utf8');
    assert.ok(!anders.equals(nachher),
      'ein geaendertes Zeichen kam durch den Vergleich -- dann prueft er nichts');
    assert.equal(anders.length, nachher.length + 1);
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

test('EP-N6: der Shorts-Uploader und seine Nachbarn sind unberuehrt', () => {
  // Nicht "sieht gleich aus", sondern: git kennt keinen Unterschied. Die fuenf
  // Dateien tragen zusammen den Weg, ueber den 21 Shorts hochgegangen sind.
  const unberuehrt = [
    'src/upload/uploader.js',
    'src/upload/planer.js',
    'src/upload/uebergabe-leser.js',
    'src/upload/zettel-leser.js',
    'src/upload/uebersicht.js',
    'src/publish/cli-args.js',
    'src/youtube/auth.js',
  ];
  const g = spawnSync('git', ['diff', '--name-only', STAND_VOR_EP, '--'].concat(unberuehrt),
    { cwd: WURZEL, encoding: 'utf8' });
  if (g.error || g.status !== 0) {
    assert.fail('git diff gegen ' + STAND_VOR_EP + ' ist nicht gelaufen. Dieser Test wird ' +
      'nicht als bestanden gezaehlt.');
  }
  const geaendert = g.stdout.split('\n').map((z) => z.trim()).filter(Boolean);
  assert.deepEqual(geaendert, [],
    'die Shorts-Linie ist angefasst worden: ' + geaendert.join(', '));

  // GEGENPROBE: derselbe Aufruf auf eine Datei, die sich SEHR WOHL geaendert
  // hat. Zeigt er dort auch nichts, prueft er nichts.
  const g2 = spawnSync('git', ['diff', '--name-only', STAND_VOR_EP, '--',
    'src/upload/longform-arbeiter.js'], { cwd: WURZEL, encoding: 'utf8' });
  assert.equal(g2.status, 0);
  assert.equal(g2.stdout.trim(), 'src/upload/longform-arbeiter.js',
    'der Vergleich sieht nicht einmal die Datei, die dieser Auftrag umgebaut hat');
});

test('EP-N6: der Shorts-Modus des Dienstes hat dieselben Routen wie vor EP', () => {
  // Die Longform-Listen sind gewachsen; die Shorts-Listen stehen woertlich da,
  // wo sie standen. Abgezaehlt und nicht "enthaelt".
  const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
  assert.ok(quelle.includes(
    "[MODUS_SHORTS]: new Set(['/', '/video', '/stand', '/kette', '/lauf']),"),
  'die GET-Routen des Shorts-Modus haben sich geaendert');
  assert.ok(quelle.includes(
    "[MODUS_SHORTS]: new Set(['/urteil', '/beenden', '/planen', '/archivieren', " +
    "'/hochladen']),"),
  'die POST-Routen des Shorts-Modus haben sich geaendert');

  // Und der Shorts-Zweig der beiden geteilten Routen ruft weiterhin seine
  // eigene Funktion: der Modusvergleich steht VOR dem Aufruf und nicht darin.
  assert.match(quelle, /if \(modus === MODUS_LONGFORM\) liefereLongformLauf\(res, abfrage\);\s*\n\s*else liefereLauf\(res, abfrage\);/);
  assert.match(quelle, /if \(modus === MODUS_LONGFORM\) nimmLongformHochladen\(res\);\s*\n\s*else nimmHochladen\(res\);/);
});

// ===========================================================================
// NACHWEIS 7: WAS DER MUTATIONSLAUF GEFUNDEN HAT
// ===========================================================================
//
// Der erste Mutationslauf ueber die achtzehn Sicherungen dieses Auftrags hat
// VIER gefunden, deren Ausbau nichts rot gemacht hat. Eine Sicherung, deren
// Ausbau nichts rot macht, ist keine -- sie steht da, sieht nach Sorgfalt aus
// und haelt nichts.
//
// Die vier stehen hier, jede mit dem Schaden, den sie abwendet:
//
//   M9   Die Verzeichnisregel des Gedaechtnisses. Eine umbenannte
//        Gedaechtnisdatei saehe aus wie "noch nie hochgeladen" -- und dann
//        entstuende ein zweites Video.
//   M14  Die Bildpruefung unmittelbar vor dem Anheften. Zwischen der Vorschau
//        und diesem Punkt liegen bis zu 45 Minuten; der Compositor kann in der
//        Zeit neu exportiert haben.
//   M16  Die Pruefung der Antwort auf den Upload. Ein privacyStatus ungleich
//        "private" ist der eine Fall, in dem sofort ein Mensch hinsehen muss.
//   M18  Die serverseitige Pruefung des Knopfes. Der Browser sperrt ihn
//        zusaetzlich, aber das ist Bequemlichkeit -- eine Anfrage, die ihn
//        umgeht, faellt allein hier.

test('EP-N7 (M9): eine umbenannte Gedaechtnisdatei bricht den Lauf ab und wird genannt',
  () => {
    // Vertrag 5.1: "Was dort liegt und keine Gedaechtnisdatei ist, bricht den
    // Lauf ab und wird beim Namen genannt." Ohne diese Regel saehe eine
    // weggeraeumte Datei aus wie "noch nie hochgeladen".
    const faelle = [
      ['2026-08-31 17-36-21.json.alt', 'eine umbenannte Gedaechtnisdatei'],
      ['notiz.txt', 'eine Datei, die nicht auf .json endet'],
      ['irgendwas.json', 'eine .json ohne die Form des Aufnahmenamens'],
    ];
    for (const [name, was] of faelle) {
      const l = lage('n7-m9');
      try {
        const ordner = G.gedaechtnisOrdner(l.wurzel);
        fs.mkdirSync(ordner, { recursive: true });
        fs.writeFileSync(path.join(ordner, name), '{}');

        const befund = trocken(l);
        assert.ok(befund.abbruch, was + ' (' + name + ') kam durch');
        assert.equal(befund.abbruch.code, 'gedaechtnis_unlesbar', was);
        assert.ok(befund.abbruch.satz.includes(JSON.stringify(name)),
          was + ': die Datei wird nicht beim Namen genannt: ' + befund.abbruch.satz);
        assert.ok(befund.abbruch.satz.includes('ZWEITES Video'),
          was + ': der Grund fehlt -- warum das schlimm ist, steht nicht dabei');
        // Und es gibt keinen Knopf.
        assert.equal(L.bindungsZeile(befund).moeglich, false, was);
      } finally { l.weg(); }
    }
  });

test('EP-N7 (M9): die temporaere Datei des atomaren Schreibens wird uebergangen', () => {
  // Sie wird an ihrer FORM erkannt und nicht daran, dass sie nicht auf .json
  // endet -- sonst waere jeder beliebige Name wieder still. Die Form ist
  // woertlich die aus planer.js.
  const l = lage('n7-m9-tmp');
  try {
    const ordner = G.gedaechtnisOrdner(l.wurzel);
    fs.mkdirSync(ordner, { recursive: true });
    fs.writeFileSync(path.join(ordner, '.' + AUFNAHME + '.json.tmp.1234.1'), '{}');
    const befund = trocken(l);
    assert.equal(befund.abbruch, null, 'die temporaere Datei hat den Lauf abgebrochen');
  } finally { l.weg(); }

  // UND DIE FORM IST DIESELBE WIE IM PLANER. Sie steht hier ein zweites Mal,
  // weil planer.js sie nicht ausfuehrt; laufen die beiden auseinander, faellt
  // es hier auf und nicht erst an einer liegengebliebenen Datei.
  const planer = fs.readFileSync(path.join(WURZEL, 'src/upload/planer.js'), 'utf8');
  const treffer = /const GEDAECHTNIS_TMP_FORM = (\/.*\/);/.exec(planer);
  assert.ok(treffer, 'die Form steht im Planer nicht mehr da, wo dieser Test sie sucht');
  assert.equal(String(G.GEDAECHTNIS_TMP_FORM), treffer[1],
    'die Form der temporaeren Datei ist im Longform-Gedaechtnis eine andere als im Planer');
});

test('EP-N7 (M14): ein Bild, das sich waehrend des Wartens geaendert hat, wird nicht angeheftet',
  async () => {
    // Vertrag 5.3: "weicht die sha256 des Bildes vom Eintrag ab, wird kein
    // Thumbnail gesetzt, bis ein Mensch das benannt hat."
    const l = lage('n7-m14');
    try {
      // LAUF 1 kommt bis zum Thumbnail und bricht DORT ab. Das Gedaechtnis
      // steht dann auf `verarbeitet` und traegt die sha256 des Bildes von
      // damals.
      const befund1 = trocken(l);
      const e1 = schreibeErmaechtigung(l, befund1);
      const r1 = await scharf(l, befund1, e1.pfad, { wirf: 'setzeThumbnail' });
      assert.equal(r1.abbruch.code, 'thumbnail_fehlgeschlagen');
      assert.ok(r1.abbruch.gruende.join(' ').includes('BILD FEHLT'),
        'die Meldung sagt nicht, dass das Video ohne Bild dasteht');
      assert.equal(gedaechtnisVon(l).uploads[0].stand, 'verarbeitet');
      const bildDamals = gedaechtnisVon(l).uploads[0].thumbnail.sha256;
      assert.equal(bildDamals, l.bildSha);

      // DER COMPOSITOR HAT NEU EXPORTIERT: dasselbe Bild, andere Bytes -- und
      // der Zettel wandert mit, sonst faenge ihn schon der Trockenlauf ab.
      const neu = Buffer.alloc(4096, 7);
      fs.writeFileSync(path.join(l.exp, l.bildname), neu);
      const zettel = JSON.parse(fs.readFileSync(path.join(l.exp, l.zettelname), 'utf8'));
      zettel.bild.sha256 = sha256(neu);
      zettel.bild.bytes = neu.length;
      fs.writeFileSync(path.join(l.exp, l.zettelname), JSON.stringify(zettel, null, 2));

      // LAUF 2. Die Bindung kommt aus dem GEDAECHTNIS (5.3) und nennt darum
      // das alte Bild -- die Ermaechtigung traegt also die alte Pruefsumme,
      // und die passt nicht zu dem, was jetzt auf der Platte liegt.
      const befund2 = trocken(l);
      assert.equal(befund2.abbruch, null, 'der Trockenlauf haette durchgehen muessen');
      const b = L.bindungsZeile(befund2);
      assert.equal(b.quelle, 'gedaechtnis');
      assert.equal(b.bild.sha256, bildDamals);
      const e2 = schreibeErmaechtigung(l, befund2);
      const r2 = await scharf(l, befund2, e2.pfad);

      assert.equal(r2.code, L.EXIT_BEFUND);
      assert.equal(r2.abbruch.code, 'thumbnail_bild');
      assert.ok(!r2.aufrufe.includes('thumbnails.set'),
        'das geaenderte Bild wurde angeheftet: ' + r2.aufrufe.join(', '));
      assert.ok(!r2.aufrufe.includes('videos.insert'));
      const satz = r2.abbruch.gruende.join(' ');
      assert.ok(satz.includes('nicht mehr das, das beurteilt wurde'), satz);
      assert.ok(satz.includes(bildDamals) && satz.includes(sha256(neu)),
        'die Meldung nennt nicht beide Pruefsummen');
      assert.ok(satz.includes('bis ein Mensch das benannt hat'), satz);
      // Und der erste Satz sagt, dass das Video oben liegt.
      assert.ok(satz.startsWith('Ein Video dieses Laufs liegt PRIVAT') ||
        r2.fehler.includes('liegt PRIVAT auf dem Kanal'),
      'der erste Satz nennt den Zustand des Kanals nicht');
    } finally { l.weg(); }
  });

test('EP-N7 (M14): ein Bild, das waehrend des Wartens verschwindet, ebenso', async () => {
  const l = lage('n7-m14-weg');
  try {
    const befund1 = trocken(l);
    const e1 = schreibeErmaechtigung(l, befund1);
    await scharf(l, befund1, e1.pfad, { wirf: 'setzeThumbnail' });
    assert.equal(gedaechtnisVon(l).uploads[0].stand, 'verarbeitet');

    // pruefeBildAufDerPlatte wird DIREKT gerufen: der Trockenlauf faende ein
    // fehlendes Bild schon vorher, und geprueft werden soll die Sicherung
    // unmittelbar vor dem Anheften.
    fs.unlinkSync(path.join(l.exp, l.bildname));
    const p = L.pruefeBildAufDerPlatte(l.exp, gedaechtnisVon(l).uploads[0].thumbnail);
    assert.equal(p.ok, false);
    assert.ok(p.satz.includes('liegt nicht mehr im Export-Ordner'), p.satz);

    // Und ein Bild ueber 2 MiB wird ebenfalls abgewiesen (Vertrag 2.10).
    const zuGross = Buffer.alloc(L.THUMBNAIL_MAX_BYTES + 1, 8);
    fs.writeFileSync(path.join(l.exp, l.bildname), zuGross);
    const p2 = L.pruefeBildAufDerPlatte(l.exp, gedaechtnisVon(l).uploads[0].thumbnail);
    assert.equal(p2.ok, false);
    assert.ok(p2.satz.includes(String(L.THUMBNAIL_MAX_BYTES)), p2.satz);

    // Der heile Fall, damit dieser Test nicht nur Neins prueft.
    fs.writeFileSync(path.join(l.exp, l.bildname), Buffer.alloc(4096, 9));
    const p3 = L.pruefeBildAufDerPlatte(l.exp, gedaechtnisVon(l).uploads[0].thumbnail);
    assert.equal(p3.ok, true, p3.satz);
    assert.equal(p3.typ, 'image/jpeg');
    assert.equal(p3.sha256, l.bildSha);
  } finally { l.weg(); }
});

test('EP-N7 (M16): ein privacyStatus ungleich "private" bricht den Lauf LAUT ab', async () => {
  // Der eine Fall, in dem sofort ein Mensch hinsehen muss. Korrigieren kann
  // dieser Bau es nicht -- der Aufruf, der einen Zustand aendert, gehoert zum
  // Oeffentlichstellen und ist nicht gebaut.
  const l = lage('n7-m16');
  try {
    const befund = trocken(l);
    const e = schreibeErmaechtigung(l, befund);
    const r = await scharf(l, befund, e.pfad, { privacyStatus: 'public' });

    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.abbruch.code, 'privacy_nicht_privat');
    // Der Lauf hoert SOFORT auf: kein Warten, kein Thumbnail.
    assert.deepEqual(r.aufrufe, ['channels.list', 'videos.insert'],
      'der Lauf ist weitergelaufen: ' + r.aufrufe.join(', '));
    const satz = r.abbruch.gruende.join(' ');
    assert.ok(satz.includes('SOFORT IM STUDIO NACHSEHEN'), satz);
    assert.ok(satz.includes('"public"'), 'der gemeldete Wert steht nicht in der Meldung');
    assert.ok(satz.includes('nicht gebaut'), 'es wird nicht gesagt, dass niemand das ' +
      'korrigieren kann');

    // UND DAS GEDAECHTNIS STEHT TROTZDEM. Es wird VOR der Pruefung
    // geschrieben: eine Antwort, die nicht gefaellt, aendert nichts daran,
    // dass ein Video oben liegt.
    const g = gedaechtnisVon(l);
    assert.ok(g, 'der Upload ist vergessen worden');
    assert.equal(g.uploads[0].videoId, DOPPEL_VIDEO);
    assert.equal(g.uploads[0].stand, 'hochgeladen');

    // Und der erste Satz der Meldung sagt, dass ein Video auf dem Kanal liegt.
    const ersteZeile = r.fehler.split('\n').find((z) => z.trim() !== '');
    assert.ok(ersteZeile.includes('liegt PRIVAT auf dem Kanal'), ersteZeile);
  } finally { l.weg(); }
});

test('EP-N7 (M16): fehlt der privacyStatus in der Antwort ganz, wird das GESAGT', async () => {
  // Abwesend ist nicht leer und nicht "private". Eine fehlende Auskunft ist
  // keine Bestaetigung -- der Lauf geht weiter, sagt es aber.
  const l = lage('n7-m16-fehlt');
  try {
    const befund = trocken(l);
    const e = schreibeErmaechtigung(l, befund);
    const r = await scharf(l, befund, e.pfad, { privacyStatus: null });
    assert.equal(r.code, L.EXIT_OK, r.fehler);
    assert.ok(r.aus.includes('die Antwort nennt keinen privacyStatus'),
      'die fehlende Auskunft wird verschwiegen');
    assert.ok(r.aus.includes('Das ist kein "privat", sondern eine fehlende Auskunft'),
      'sie wird nicht als das benannt, was sie ist');
  } finally { l.weg(); }
});

test('EP-N7 (M18): POST /hochladen prueft SERVERSEITIG, ob es einen Knopf gibt', async () => {
  // Der Browser sperrt den Knopf zusaetzlich, aber das ist Bequemlichkeit.
  // Diese Zeile ist die Zusage: eine Anfrage, die den Browser umgeht, faellt
  // hier -- und nur hier.
  //
  // DIE SITZUNG LAEUFT AUF DER ECHTEN PROJEKTWURZEL. Anders ginge es nicht:
  // fremdeWurzel() faengt eine Wegwerfwurzel schon vorher ab, und dann pruefte
  // dieser Test nicht die Zusage, sondern die davor. Damit dabei nichts
  // Echtes entstehen kann, ist waehrend der Anfrage JEDER Schreibweg des
  // Dateisystems scharfgestellt: kaeme die Anfrage durch, schriebe sie nicht,
  // sondern faellt in die Falle -- und der Test sieht einen anderen
  // Rueckgabewert.
  const trockenErfunden = {
    befehl: 'node src/upload/longform-arbeiter.js --aufnahme="' + AUFNAHME + '"',
    code: 0, fehler: null, aus: 'VORSCHAU', err: '',
    befund: null,          // KEINE Befundzeile -> keine Bindung -> kein Knopf
  };
  const sitzung = S.baueLongformSitzung({
    aufnahme: AUFNAHME, projektwurzel: WURZEL, port: 0, trocken: trockenErfunden,
  });
  assert.equal(sitzung.bindung.moeglich, false, 'diese Sitzung traegt eine Bindung');
  assert.equal(S.longformKnopfDa(sitzung).da, false);

  const dienst = S.baueDienst(sitzung);
  await new Promise((f) => dienst.listen(0, S.HOST, f));
  sitzung.port = dienst.address().port;

  const schreibend = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync',
    'unlinkSync', 'rmSync', 'copyFileSync', 'createWriteStream', 'writeSync'];
  const echt = {};
  const beruehrt = [];
  let antwort = null;
  try {
    for (const name of schreibend) {
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
    echt.spawn = require('node:child_process').spawn;

    antwort = await new Promise((fertig, schief) => {
      const req = require('node:http').request({
        host: S.HOST, port: sitzung.port, method: 'POST', path: '/hochladen',
        headers: {
          host: S.HOST + ':' + sitzung.port,
          origin: 'http://' + S.HOST + ':' + sitzung.port,
          'x-freigabe-token': sitzung.token,
        },
      }, (res) => {
        const teile = [];
        res.on('data', (d) => teile.push(d));
        res.on('end', () => fertig({ status: res.statusCode,
          text: Buffer.concat(teile).toString('utf8') }));
      });
      req.on('error', schief);
      req.end();
    });
  } finally {
    for (const name of Object.keys(echt)) {
      if (name !== 'spawn') fs[name] = echt[name];
    }
    await new Promise((f) => dienst.close(f));
  }

  assert.equal(antwort.status, 409,
    'POST /hochladen antwortet mit ' + antwort.status + ' statt 409 -- ohne Bindung darf ' +
    'es keinen Knopf geben. Leib: ' + antwort.text);
  assert.ok(antwort.text.includes('kein_knopf'), antwort.text);
  assert.ok(antwort.text.includes('keine Ermaechtigung ausgestellt'), antwort.text);
  assert.deepEqual(beruehrt, [],
    'die Route hat geschrieben, obwohl es keinen Knopf gab: ' + beruehrt.join(', '));
});

test('EP-N7 (M18): und der Knopf ist auch zu, solange ein Lauf laeuft oder gelaufen ist', () => {
  // Die drei uebrigen Zweige derselben Zusage. Sie stehen hier als Einheit --
  // die Route oben faehrt nur einen davon.
  const grund = { moeglich: true, quelle: 'lauf', weiter_ab: 'upload', aufnahme: AUFNAHME,
    video_sha256: 'a'.repeat(64), bild: { dateiname: 'x.jpg', sha256: 'b'.repeat(64) },
    zettel: { dateiname: 'x.json', rang: 1 } };
  const kanal = { ok: true, id: DOPPEL_KANAL_ID, name: DOPPEL_KANAL_NAME };

  const laeuft = S.longformKnopfDa({ lauf: { laeuft: true }, bindung: grund, kanal });
  assert.equal(laeuft.da, false);
  assert.ok(laeuft.grund.includes('Zwei gleichzeitig gibt es nicht'));

  const fertig = S.longformKnopfDa({ lauf: { laeuft: false, ende: { code: 0 } },
    bindung: grund, kanal });
  assert.equal(fertig.da, false);
  assert.ok(fertig.grund.includes('neuen Start des Dienstes'),
    'es wird nicht gesagt, wie ein zweiter Lauf zustande kaeme');
  assert.ok(fertig.grund.includes('veralteten Vorschau'),
    'der Grund fehlt: eine Ermaechtigung auf einer alten Vorschau bezeugte nichts');

  const ohneKanal = S.longformKnopfDa({ lauf: null, bindung: grund,
    kanal: { ok: false, grund: 'data/inventory.json fehlt.' } });
  assert.equal(ohneKanal.da, false);
  assert.ok(ohneKanal.grund.includes('nicht sagt, WOHIN'),
    'ein Knopf ohne Kanalnamen wird nicht als das benannt, was er ist');

  const offen = S.longformKnopfDa({ lauf: null, bindung: grund, kanal });
  assert.equal(offen.da, true, offen.grund);

  // Und die drei Gruende sind verschieden -- zwei Lagen unter einem Satz sind
  // der Umriss jedes Fehlers dieser Reihe.
  const saetze = [laeuft.grund, fertig.grund, ohneKanal.grund];
  assert.equal(new Set(saetze).size, 3);
});

// ===========================================================================
// NACHWEIS 8 (ER): notifySubscribers IST GEWAEHLT UND NICHT GEERBT
// ===========================================================================
//
// Vertrag 2.14 sagt, `videos.insert` schicke `notifySubscribers` AUSDRUECKLICH
// mit -- nicht als Vorgabe der Bibliothek, sondern als Wert im Aufruf. Der
// Wert ist derselbe, den die API ohnehin annaehme; genau darum ist er ohne
// diesen Nachweis nicht zu belegen. Faellt die Zeile eines Tages weg, laeuft
// alles weiter, jeder andere Test bleibt gruen, und die Sache verhaelt sich
// bis zur naechsten Bibliotheksversion unveraendert. Ein ausdruecklich
// gesetzter Wert und ein geerbter sind ohne diese Pruefung dasselbe --
// dieselbe Ununterscheidbarkeit, gegen die dieses Projekt seit dem
// Bestiarium baut.
//
// GEPRUEFT WIRD DER AUFRUF, NICHT DIE KONSTANTE. Ein Test gegen
// `K.NOTIFY_SUBSCRIBERS` bewiese, dass irgendwo `true` steht, und nicht, dass
// es in den Aufruf gelangt. Darum laeuft hier das ECHTE `rohKanal()` gegen
// eine Attrappe, die das Argumentobjekt festhaelt, mit dem `videos.insert`
// gerufen wuerde. Ein Netzaufruf entsteht dabei nicht: die Attrappe IST die
// Bibliothek, und `googleapis` wird nicht geladen (N5 rechnet das nach).

// Die Pruefung steht EINMAL. Der Nachweis und sein Gegenstueck rufen dieselbe
// Funktion -- eine zweite, die ihr nur aehnlich saehe, sagte nichts ueber die
// erste. Genau so ist in N4 eine Abwehr tot geworden.
function pruefeNotifySubscribers(argumente) {
  assert.ok(argumente !== null && typeof argumente === 'object',
    'videos.insert wurde ohne Argumentobjekt gerufen.');
  assert.ok(Object.prototype.hasOwnProperty.call(argumente, 'notifySubscribers'),
    'notifySubscribers steht NICHT im Aufruf. Dann gilt die Vorgabe der ' +
    'Bibliothek, und ein geerbter Wert ist von einem gewaehlten nicht zu ' +
    'unterscheiden (Vertrag 2.14).');
  assert.equal(argumente.notifySubscribers, true,
    'notifySubscribers steht im Aufruf, aber nicht auf "benachrichtigen". ' +
    'Vertrag 2.14: kein Argument und keine Konfiguration schaltet es ab.');
}

// Faengt den Fehler, den eine Pruefung wirft, und gibt ihn zurueck. Es reicht
// nicht, dass etwas fliegt: die Meldung ist der halbe Nachweis, denn an ihr
// haengt, dass "fehlt" und "steht falsch" zwei Auskuenfte bleiben.
function faellt(pruefung, wobei) {
  try {
    pruefung();
  } catch (e) {
    assert.equal(e.name, 'AssertionError',
      'es ist etwas anderes gefallen als die Pruefung: ' + e.message);
    return e;
  }
  return assert.fail(wobei);
}

// Ein einziger echter `ladeVideoHoch`-Aufruf gegen eine Attrappe. Zurueck
// kommt das Argumentobjekt, das an `videos.insert` ginge.
async function insertArgumente() {
  const gesehen = [];
  const yt = {
    videos: {
      async insert(argumente) {
        gesehen.push(argumente);
        return { data: { id: DOPPEL_VIDEO,
          status: { privacyStatus: 'private', uploadStatus: 'uploaded' } } };
      },
    },
  };
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-notify-'));
  const pfad = path.join(ordner, 'nicht-wirklich-ein-video.mp4');
  fs.writeFileSync(pfad, 'Wegwerfbytes. Gelesen wird davon nichts.');
  try {
    await K.rohKanal(yt).ladeVideoHoch({
      pfad,
      titel: 'Ein Titel fuer den Doppelgaengerlauf',
      beschreibung: 'Eine Beschreibung fuer den Doppelgaengerlauf.',
      tags: ['doppelgaenger'],
      veroeffentlichung: {
        categoryId: '22', defaultLanguage: 'de', defaultAudioLanguage: 'de',
        selfDeclaredMadeForKids: false,
      },
    });
    assert.equal(gesehen.length, 1, 'es gab nicht genau einen videos.insert');
    // DER LESESTROM WIRD GESCHLOSSEN, UND ES WIRD DARAUF GEWARTET, bevor der
    // Wegwerfordner faellt. `fs.createReadStream` oeffnet die Datei erst im
    // naechsten Durchgang der Schleife; wer den Ordner vorher wegnimmt, laesst
    // ein ENOENT hinter dem Testende fliegen -- eine Arbeit, die niemandem
    // mehr gehoert, und der Testlaeufer rechnet sie zu Recht als Fehler.
    const koerper = gesehen[0] && gesehen[0].media && gesehen[0].media.body;
    if (koerper && typeof koerper.destroy === 'function') {
      await new Promise((fertig) => {
        koerper.on('error', () => {});
        koerper.on('close', fertig);
        koerper.destroy();
      });
    }
    return gesehen[0];
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
}

test('EP-N8 (ER): videos.insert schickt notifySubscribers ausdruecklich mit, auf true',
  async () => {
    const argumente = await insertArgumente();
    pruefeNotifySubscribers(argumente);
    // Und der Wert im Aufruf ist DER, den das Modul nach aussen nennt. Zwei
    // Fassungen einer Regel sind auf Dauer eineinhalb.
    assert.equal(argumente.notifySubscribers, K.NOTIFY_SUBSCRIBERS);
    assert.equal(K.NOTIFY_SUBSCRIBERS, true);
  });

test('EP-N8 (ER): das Gegenstueck -- die Pruefung faellt, wenn die Angabe verschwindet ODER kippt',
  async () => {
    const echt = await insertArgumente();

    // MUTANT 1: die Zeile ist weg. Das ist der Fall, der ohne diesen Nachweis
    // unbemerkt bliebe -- die API benachrichtigt weiter, und niemand hat es
    // mehr entschieden.
    const ohne = Object.assign({}, echt);
    delete ohne.notifySubscribers;
    const weggefallen = faellt(() => pruefeNotifySubscribers(ohne),
      'ein Aufruf OHNE notifySubscribers kommt durch die Pruefung');

    // MUTANT 2: die Zeile steht da und sagt das Gegenteil.
    const gekippt = Object.assign({}, echt, { notifySubscribers: false });
    const umgedreht = faellt(() => pruefeNotifySubscribers(gekippt),
      'ein Aufruf mit notifySubscribers: false kommt durch die Pruefung');

    // Die beiden Ausgaenge tragen VERSCHIEDENE Meldungen. "Fehlt" und "steht
    // falsch" sind zwei Lagen, und ein Satz fuer zwei Lagen ist der Umriss
    // jedes Fehlers dieser Reihe.
    assert.ok(String(weggefallen.message).includes('steht NICHT im Aufruf'));
    assert.ok(String(umgedreht.message).includes('nicht auf "benachrichtigen"'));
    assert.notEqual(String(weggefallen.message), String(umgedreht.message));

    // Und der echte Aufruf, an dem die beiden gemessen wurden, besteht sie.
    pruefeNotifySubscribers(echt);
  });
