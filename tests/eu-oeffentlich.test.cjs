'use strict';

// ---------------------------------------------------------------------------
// EU: DIE ZWEITE ERMAECHTIGUNG UND DAS OEFFENTLICHE STELLEN
// ---------------------------------------------------------------------------
//
// EP hat den Schritt gebaut, den man zuruecknehmen kann: ein privates Video
// laesst sich loeschen. Diese Datei deckt den, den man nicht zuruecknehmen
// kann. Was oeffentlich war, hat jemand gesehen.
//
// Sie fuehrt acht Dinge vor, und jedes so, dass die Sicherung dabei
// ZUSCHNAPPT -- ein Test, der nur zeigt, dass etwas geht, hat nichts gezeigt.
//
//   N1  DIE FALLE, AM SCHADEN VORGEFUEHRT. Der Aufruf wird einmal absichtlich
//       unvollstaendig gebaut, und gegen eine Attrappe, die die dokumentierte
//       Regel nachbildet, verschwinden Felder. Dann die richtige Fassung, die
//       sie erhaelt. Dann der Beleg, dass die unvollstaendige nicht mehr
//       baubar ist.
//   N2  GENAU EIN videos.update JE LAUF, gezaehlt im scharfen Lauf und nicht
//       nur im Test. Ein zweites wirft, bevor es geschieht.
//   N3  publishAt UND snippet KOMMEN IM KOERPER NICHT VOR -- als Test.
//   N4  DIE ZWEITE ERMAECHTIGUNG gilt einmal und nur fuer das Beurteilte.
//       Jeder Fall mit eigener Meldung, keine zwei teilen sich eine.
//   N5  DER ABBRUCH IN DER MITTE. Erst der SCHADEN -- was ohne den Vermerk
//       geschaehe --, dann dass es nicht mehr geht.
//   N6  KEIN ECHTER AUFRUF IST MOEGLICH. Jeder Netzweg scharf, voller
//       Durchlauf dagegen, und die Falle wird provoziert.
//   N7  WAS DER MUTATIONSLAUF GEFUNDEN HAT.
//   N8  DIE SHORTS-LINIE IST UNVERAENDERT. Byte fuer Byte gegen 94d5ab2.
//
// KEIN TEST HIER MACHT EINEN NETZAUFRUF, und N6 rechnet das nach, statt es zu
// behaupten. Alle Tests laufen gegen WEGWERFORDNER unter dem Temp-Verzeichnis.
//
// KEINE ECHTE KENNUNG. Die Kennungen der Attrappe sehen absichtlich nicht aus
// wie die von YouTube; ein Testdatum, das echt aussieht, ist das erste, das
// jemand fuer echt haelt (Vertrag 7, docs/warum-keine-video-ids-im-repo.md).

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

const DOPPEL_VIDEO = 'ATTRAPPE-VIDEO-OHNE-ECHTE-KENNUNG';
const DOPPEL_KANAL_ID = 'ATTRAPPE-KANAL-OHNE-ECHTE-KENNUNG';
const DOPPEL_KANAL_NAME = 'Attrappenkanal';
const TITEL = 'Ein Titel fuer den Attrappenlauf';
const BESCHREIBUNG_AM_VIDEO = 'Die Beschreibung, wie YouTube sie zurueckgibt.';

// ---------------------------------------------------------------------------
// WERKZEUG: DIE LAGE
// ---------------------------------------------------------------------------

function wegwerfordner(marke) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eu-' + marke + '-'));
}

function sha256(puffer) {
  return crypto.createHash('sha256').update(puffer).digest('hex');
}

// Der Arbeiter bricht seine Meldungen auf 74 Spalten um (U.umbrich). Ein Satz,
// der dabei ueber zwei Zeilen laeuft, ist derselbe Satz -- verglichen wird
// darum gegen den flachgelegten Text. Ein Test, der am Umbruch scheitert,
// prueft die Zeilenbreite und nicht die Meldung.
function flach(text) {
  return String(text).replace(/\s+/g, ' ');
}

function lage(marke, { bildbytes = 4096 } = {}) {
  const wurzel = wegwerfordner(marke + '-wurzel');
  const render = wegwerfordner(marke + '-render');
  const exp = wegwerfordner(marke + '-export');

  fs.mkdirSync(path.join(wurzel, 'config'), { recursive: true });
  for (const datei of [U.BESCHREIBUNG_DATEI, U.HASHTAGS_DATEI, U.VEROEFFENTLICHUNG_DATEI]) {
    fs.copyFileSync(path.join(WURZEL, datei), path.join(wurzel, datei));
  }

  const videoInhalt = Buffer.alloc(300000, 3);
  const videoPfad = path.join(render, AUFNAHME + '.matrix-cut.mp4');
  fs.writeFileSync(videoPfad, videoInhalt);
  for (const n of ['2026-08-28 10-00-00', '2026-08-27 10-00-00']) {
    fs.writeFileSync(path.join(render, n + '.matrix-cut.mp4'), Buffer.alloc(310000, 4));
  }

  const bildname = 'adw-' + marke + '.jpg';
  const bildInhalt = Buffer.alloc(bildbytes, 9);
  fs.writeFileSync(path.join(exp, bildname), bildInhalt);
  const zettelname = 'adw-' + marke + '.json';
  const zettel = {
    schema_version: Z.SCHEMA_VERSION,
    videotitel: TITEL,
    episode: 'EP. 17',
    datum: TAG,
    format: 'standard',
    chart_quelle: null,
    aufnahme: AUFNAHME,
    aufnahme_herkunft: 'bestaetigt',
    exportiert_am: TAG + 'T14:00:00+02:00',
    bild: { dateiname: bildname, bytes: bildInhalt.length, sha256: sha256(bildInhalt) },
  };
  fs.writeFileSync(path.join(exp, zettelname), JSON.stringify(zettel, null, 2));
  const t = new Date(TAG + 'T14:00:00');
  fs.utimesSync(path.join(exp, bildname), t, t);
  fs.utimesSync(path.join(exp, zettelname), t, t);

  return {
    wurzel, render, exp, bildname, zettelname,
    bildSha: sha256(bildInhalt),
    videoSha: sha256(videoInhalt),
    videoPfad,
    weg() {
      for (const o of [wurzel, render, exp]) fs.rmSync(o, { recursive: true, force: true });
    },
  };
}

function trocken(l) {
  return L.trockenlauf({
    aufnahme: AUFNAHME, zettel: null, projektwurzel: l.wurzel,
    renderWurzel: l.render, exportOrdner: l.exp,
  });
}

function gedaechtnisVon(l) {
  const p = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------------------
// WERKZEUG: DIE YOUTUBE-ATTRAPPE
// ---------------------------------------------------------------------------
//
// SIE BILDET DIE REGEL NACH, UM DIE ES GEHT, und zwar woertlich die aus der
// Dokumentation (Vertrag 2.5):
//
//   "if your request is updating a private video, and the request's part
//    parameter value includes the status part, the video's privacy setting
//    will be updated to whatever value the request body specifies. If the
//    request body does not specify a value, the existing privacy setting will
//    be removed and the video will revert to the default privacy setting."
//
// Also: JEDES veraenderbare Feld des Teils `status`, das im Koerper fehlt,
// faellt auf seine Vorgabe zurueck. Die Attrappe tut genau das -- und nichts
// darueber hinaus. Sie ist nicht YouTube; sie ist die eine Regel, an der
// dieser Bau haengt, in ausfuehrbarer Form.
//
// WARUM SIE HIER UND NICHT IM DOPPELGAENGER STEHT: der Doppelgaenger
// antwortet, wie die API antwortet. Diese hier RECHNET, was die API mit einem
// Koerper macht. Das ist der Unterschied zwischen "der Aufruf ging hinaus" und
// "was hat er angerichtet", und der Nachweis 1 braucht das zweite.

// Die Vorgaben, auf die ein weggelassenes Feld zurueckfaellt. Sie stehen hier
// als ATTRAPPE und nicht als Wissen dieses Projekts: welchen Wert YouTube
// wirklich einsetzt, ist nicht gemessen (Vertrag 10). Fuer den Nachweis
// genuegt, DASS der gesetzte Wert verloren geht.
const VORGABEN = Object.freeze({
  privacyStatus: 'private',
  embeddable: true,
  license: 'youtube',
  publicStatsViewable: true,
  selfDeclaredMadeForKids: false,
  containsSyntheticMedia: false,
});

//
// `nachhinken`: die Leseantwort zeigt den Stand VOR dem letzten Update. Das
// ist kein erfundener Fall, sondern der, den Vertrag 10 offen laesst -- ob die
// API unmittelbar nach einem Update schon den neuen Stand meldet, ist NICHT
// GEMESSEN. Er ist genau der, in dem der Vermerk im Gedaechtnis die einzige
// Sicherung ist: die Leseantwort sagt dann "noch privat", und ein Bau, der ihr
// glaubt, macht ein ZWEITES Update auf ein Video, das schon oeffentlich ist.
function youtubeAttrappe(anfang, { nachhinken = false } = {}) {
  let status = Object.assign({}, anfang);
  let gezeigt = Object.assign({}, anfang);
  const aufrufe = [];
  return {
    stand: () => Object.assign({}, status),
    aufrufe: () => aufrufe.slice(),
    videos: {
      async list({ part, id }) {
        aufrufe.push({ was: 'videos.list', part: part.slice(), id: id.slice() });
        const eintrag = { id: id[0] };
        if (part.includes('status')) {
          eintrag.status = Object.assign({}, nachhinken ? gezeigt : status);
        }
        if (part.includes('snippet')) {
          eintrag.snippet = {
            title: TITEL,
            description: BESCHREIBUNG_AM_VIDEO,
            thumbnails: { high: { url: 'about:blank#attrappe', width: 480, height: 360 } },
          };
        }
        if (part.includes('processingDetails')) {
          eintrag.processingDetails = { processingStatus: 'succeeded' };
        }
        return { data: { items: [eintrag] } };
      },
      async update({ part, requestBody }) {
        aufrufe.push({ was: 'videos.update', part: part.slice(), requestBody });
        if (!Array.isArray(part) || !part.includes('status')) {
          throw new Error('ATTRAPPE: part nennt status nicht.');
        }
        // Ein `snippet` im Koerper waere hier ein Fehler und kein
        // stillschweigendes Uebergehen: es stuende nicht im part.
        for (const teil of Object.keys(requestBody || {})) {
          if (teil !== 'id' && teil !== 'status') {
            throw new Error('ATTRAPPE: der Koerper traegt den Teil "' + teil + '", der im ' +
              'part nicht genannt ist. Das ist genau der Fall, gegen den dieser Bau steht.');
          }
        }
        const koerper = (requestBody && requestBody.status) || {};
        // DIE REGEL. Fuer jedes Feld, das der Stand heute hat:
        const neu = {};
        for (const name of Object.keys(status)) {
          if (!K.STATUS_FELDER_SETZBAR.includes(name)) {
            // Nur lesbare Felder ruehrt kein Koerper an.
            neu[name] = status[name];
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(koerper, name)) {
            neu[name] = koerper[name];
          } else if (Object.prototype.hasOwnProperty.call(VORGABEN, name)) {
            neu[name] = VORGABEN[name];      // "revert to the default"
          }
          // sonst: das Feld ist weg.
        }
        for (const name of Object.keys(koerper)) {
          if (!Object.prototype.hasOwnProperty.call(neu, name)) neu[name] = koerper[name];
        }
        status = neu;
        if (!nachhinken) gezeigt = Object.assign({}, neu);
        return { data: { id: requestBody.id, status: Object.assign({}, status) } };
      },
      async insert() { throw new Error('ATTRAPPE: videos.insert gehoert nicht hierher.'); },
    },
    channels: {
      async list() {
        aufrufe.push({ was: 'channels.list' });
        return { data: { items: [{ id: DOPPEL_KANAL_ID, snippet: { title: DOPPEL_KANAL_NAME } }] } };
      },
    },
    thumbnails: {
      async set() { throw new Error('ATTRAPPE: thumbnails.set gehoert nicht hierher.'); },
    },
  };
}

// Ein Status, in dem JEDES uebertragbare Feld vom Vorgabewert abweicht. Nur so
// zeigt der Schaden sich: ein Feld, das ohnehin auf seiner Vorgabe steht,
// sieht nach dem Loeschen genauso aus wie vorher.
const STATUS_MIT_ABWEICHUNGEN = Object.freeze({
  privacyStatus: 'private',
  embeddable: false,
  license: 'creativeCommon',
  publicStatsViewable: false,
  selfDeclaredMadeForKids: true,
  containsSyntheticMedia: true,
  uploadStatus: 'processed',        // nur lesbar
});

// ---------------------------------------------------------------------------
// WERKZEUG: DER DOPPELGAENGER FUER DEN GANZEN WEG
// ---------------------------------------------------------------------------
//
// Er geht durch K.zaehlenderKanal() -- DIESELBE Zaehlung, die im scharfen Lauf
// greift, und nicht eine zweite, die ihr aehnlich sieht. Fuer den dritten
// Aufruf steckt die Attrappe darin: `stelleOeffentlich` und `liesStatus`
// gehen durch K.rohKanal() auf sie, also durch den ECHTEN Code.
const da = (w) => ({ da: true, wert: w });
const weg = () => ({ da: false, wert: null });

function doppelgaenger({
  attrappe = null,
  videoId = DOPPEL_VIDEO,
  privacyStatus = 'private',
  titel = TITEL,
  beschreibung = BESCHREIBUNG_AM_VIDEO,
  thumbnails = { high: { url: 'about:blank#attrappe', width: 480, height: 360 } },
  uploadStatus = 'processed',
  processingStatus = 'succeeded',
  gruende = {},
  gefunden = true,
  wirf = null,
  kanalId = DOPPEL_KANAL_ID,
  kanalName = DOPPEL_KANAL_NAME,
} = {}) {
  const pruefe = (name) => {
    if (wirf === name) throw new Error('DOPPELGAENGER: ' + name + ' bricht ab (nachgestellt)');
  };
  const echt = attrappe ? K.rohKanal(attrappe) : null;
  return K.zaehlenderKanal({
    async nenneKanal() {
      pruefe('nenneKanal');
      return { gefunden: true, id: kanalId, name: kanalName };
    },
    async ladeVideoHoch() {
      pruefe('ladeVideoHoch');
      return {
        videoId,
        status: { privacyStatus: 'private', uploadStatus: 'uploaded' },
        privacyStatus: da('private'), uploadStatus: da('uploaded'),
      };
    },
    async liesVerarbeitung() {
      pruefe('liesVerarbeitung');
      return {
        gefunden: true,
        status: { uploadStatus: 'uploaded' },
        processingDetails: { processingStatus: 'succeeded' },
        snippet: null,
        processingStatus: da('succeeded'), uploadStatus: da('uploaded'),
        rejectionReason: weg(), failureReason: weg(), processingFailureReason: weg(),
      };
    },
    async setzeThumbnail() { pruefe('setzeThumbnail'); return { items: [] }; },
    async liesVideoVoll() {
      pruefe('liesVideoVoll');
      if (!gefunden) {
        return {
          gefunden: false, status: null, processingDetails: null, snippet: null,
          processingStatus: weg(), uploadStatus: weg(), rejectionReason: weg(),
          failureReason: weg(), processingFailureReason: weg(),
        };
      }
      return {
        gefunden: true,
        status: { privacyStatus, uploadStatus },
        processingDetails: { processingStatus },
        snippet: { title: titel, description: beschreibung, thumbnails },
        processingStatus: processingStatus === null ? weg() : da(processingStatus),
        uploadStatus: uploadStatus === null ? weg() : da(uploadStatus),
        rejectionReason: gruende.rejectionReason === undefined
          ? weg() : da(gruende.rejectionReason),
        failureReason: gruende.failureReason === undefined ? weg() : da(gruende.failureReason),
        processingFailureReason: gruende.processingFailureReason === undefined
          ? weg() : da(gruende.processingFailureReason),
      };
    },
    async liesStatus(a) {
      pruefe('liesStatus');
      if (echt) return echt.liesStatus(a);
      return { gefunden: true, status: { privacyStatus } };
    },
    async stelleOeffentlich(a) {
      pruefe('stelleOeffentlich');
      if (echt) return echt.stelleOeffentlich(a);
      throw new Error('DOPPELGAENGER: ohne Attrappe gibt es hier keinen dritten Aufruf.');
    },
  });
}

// ---------------------------------------------------------------------------
// WERKZEUG: DIE BEIDEN ERMAECHTIGUNGEN
// ---------------------------------------------------------------------------

function schreibeErsteErmaechtigung(l, befund) {
  const b = L.bindungsZeile(befund);
  assert.equal(b.moeglich, true, 'diese Lage gibt keine erste Bindung her: ' + b.grund);
  const zufall = G.neuerZufall();
  const inhalt = G.neueErmaechtigung({
    aufnahme: b.aufnahme, videoSha256: b.video_sha256,
    bildDateiname: b.bild.dateiname, bildSha256: b.bild.sha256,
    zettelDateiname: b.zettel.dateiname, rang: b.zettel.rang,
    kanalId: DOPPEL_KANAL_ID, kanalName: DOPPEL_KANAL_NAME,
    zufall, jetzt: Date.now(),
  });
  const pfad = G.ermaechtigungPfad(l.wurzel, zufall);
  S.schreibeErmaechtigung(pfad, inhalt);
  return { pfad, inhalt, zufall };
}

// Sie wird ueber DIESELBEN Funktionen gebaut, die der Freigabedienst benutzt
// (G.neueZweiteErmaechtigung, G.ermaechtigungPfad, S.schreibeErmaechtigung).
// Ein hier nachgebauter Schreiber pruefte eine Form, die im Ernstfall niemand
// schreibt.
function schreibeZweiteErmaechtigung(l, befund, aenderungen = {}) {
  const b = aenderungen.bindung || L.zweiteBindungsZeile(befund);
  assert.equal(b.moeglich, true, 'diese Lage gibt keine zweite Bindung her: ' + b.grund);
  const zufall = aenderungen.zufall || G.neuerZufall();
  const inhalt = G.neueZweiteErmaechtigung({
    aufnahme: b.aufnahme,
    videoSha256: b.video_sha256,
    videoId: b.videoId,
    urteil: b.urteil,
    kanalId: aenderungen.kanalId || DOPPEL_KANAL_ID,
    kanalName: DOPPEL_KANAL_NAME,
    zweck: aenderungen.zweck || G.ZWECK_VEROEFFENTLICHEN,
    zufall,
    jetzt: aenderungen.jetzt === undefined ? Date.now() : aenderungen.jetzt,
  });
  // Die Verfaelschungen werden NACH dem Bauen eingesetzt, damit die Form die
  // echte bleibt und nur das eine Feld abweicht, um das es geht.
  for (const [pfadInDenFeldern, wert] of Object.entries(aenderungen.felder || {})) {
    const teile = pfadInDenFeldern.split('.');
    let ziel = inhalt;
    for (const t of teile.slice(0, -1)) ziel = ziel[t];
    ziel[teile[teile.length - 1]] = wert;
  }
  const pfad = aenderungen.pfad || G.ermaechtigungPfad(l.wurzel, zufall);
  S.schreibeErmaechtigung(pfad, inhalt);
  return { pfad, inhalt, zufall };
}

// Der ganze Weg bis zum privaten Video mit Bild -- durch DIESELBE Funktion,
// die main() ruft. Danach steht das Gedaechtnis auf `thumbnail_gesetzt`, und
// die Frage aus 2.4 steht an.
async function bisZumPrivatenVideo(l, opt = {}) {
  const befund = trocken(l);
  assert.equal(befund.abbruch, null, JSON.stringify(befund.abbruch));
  const e = schreibeErsteErmaechtigung(l, befund);
  const r = await L.scharferLauf({
    befund, projektwurzel: l.wurzel, exportOrdner: l.exp, bestaetigtDurch: e.pfad,
    baueKanal: async () => doppelgaenger(opt),
    schlafe: async () => {}, jetzt: () => Date.now(),
    melde: () => {}, meldeFehler: () => {}, abfrageabstandMs: 0,
  });
  assert.equal(r.code, L.EXIT_OK, 'der Weg bis zum privaten Video ist nicht durchgekommen');
  assert.equal(gedaechtnisVon(l).uploads[0].stand, 'thumbnail_gesetzt');
  return r;
}

// Ein scharfer Lauf des DRITTEN Aufrufs -- durch DIESELBE Funktion, die main()
// ruft. Nichts wird umgangen: Zweckweiche, Bindung, Ermaechtigung,
// Kanalvergleich, Verbrauch, Kontrollblick, Statusblock und die Aufrufe liegen
// alle darin.
async function scharfDritt(l, befund, ermPfad, { kanal, attrappe, jetzt, ...rest } = {}) {
  const k = kanal || doppelgaenger(Object.assign({ attrappe }, rest));
  const aus = [];
  const fehler = [];
  const ergebnis = await L.scharferLauf({
    befund, projektwurzel: l.wurzel, exportOrdner: l.exp, bestaetigtDurch: ermPfad,
    baueKanal: async () => k,
    schlafe: async () => {},
    jetzt: jetzt || (() => Date.now()),
    melde: (t) => aus.push(t),
    meldeFehler: (t) => fehler.push(t),
    abfrageabstandMs: 0,
  });
  return Object.assign({}, ergebnis, {
    kanal: k, aufrufe: k.aufrufnamen(),
    aus: aus.join('\n'), fehler: fehler.join('\n'),
  });
}

// ===========================================================================
// NACHWEIS 1: DIE FALLE, AM SCHADEN VORGEFUEHRT
// ===========================================================================
//
// Erst der Schaden, dann die Reparatur, dann der Beleg, dass die
// unvollstaendige Fassung nicht mehr baubar ist. In dieser Reihenfolge: eine
// Reparatur ohne vorgefuehrten Schaden ist eine Behauptung.

test('EU-N1: DER SCHADEN -- ein unvollstaendiger Koerper loescht fuenf Felder', async () => {
  const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
  const vorher = yt.stand();

  // Der Koerper, den ein Bau schickte, der "nur privacyStatus" schickt. Er
  // wird HIER von Hand gebaut, ausserhalb des Programms -- im Programm laesst
  // er sich nicht mehr bauen, und genau das ist die Sicherung (unten).
  await yt.videos.update({
    part: ['status'],
    requestBody: { id: DOPPEL_VIDEO, status: { privacyStatus: 'public' } },
  });
  const nachher = yt.stand();

  assert.equal(nachher.privacyStatus, 'public', 'das Video ist nicht oeffentlich geworden');

  // UND FUENF FELDER SIND WEG. Jedes einzeln benannt: eine Zusammenfassung
  // ("es hat sich etwas geaendert") ist genau die Auskunft, die diesen Schaden
  // unsichtbar macht.
  const verloren = [];
  for (const name of K.STATUS_FELDER_UEBERTRAGEN) {
    if (JSON.stringify(nachher[name]) !== JSON.stringify(vorher[name])) {
      verloren.push(name + ': ' + JSON.stringify(vorher[name]) + ' -> ' +
        JSON.stringify(nachher[name]));
    }
  }
  assert.deepEqual(verloren, [
    'embeddable: false -> true',
    'license: "creativeCommon" -> "youtube"',
    'publicStatsViewable: false -> true',
    'selfDeclaredMadeForKids: true -> false',
    'containsSyntheticMedia: true -> false',
  ], 'die Attrappe bildet die Regel aus Vertrag 2.5 nicht nach');
  assert.equal(verloren.length, 5);

  // Das nur lesbare Feld ist unberuehrt geblieben -- es ist nicht setzbar und
  // faellt darum nicht auf eine Vorgabe zurueck.
  assert.equal(nachher.uploadStatus, 'processed');
});

test('EU-N1: DIE REPARATUR -- der gebaute Koerper erhaelt jedes Feld', async () => {
  const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
  const vorher = yt.stand();

  // DURCH DEN ECHTEN CODE. rohKanal(yt).stelleOeffentlich() ist die Methode,
  // die auch im scharfen Lauf laeuft; sie baut den Koerper mit
  // baueStatusKoerper() aus dem gelesenen Block.
  const kanal = K.rohKanal(yt);
  const gelesen = await kanal.liesStatus({ videoId: DOPPEL_VIDEO });
  assert.deepEqual(gelesen.status, vorher, 'die Leseantwort ist nicht der Stand');

  const antwort = await kanal.stelleOeffentlich({
    videoId: DOPPEL_VIDEO, status: gelesen.status,
  });
  const nachher = yt.stand();

  assert.equal(nachher.privacyStatus, 'public');
  assert.equal(antwort.privacyStatus.da, true);
  assert.equal(antwort.privacyStatus.wert, 'public');

  // NICHTS AUSSER DER SICHTBARKEIT HAT SICH GEAENDERT -- Feld fuer Feld.
  const geaendert = [];
  for (const name of Object.keys(vorher)) {
    if (name === 'privacyStatus') continue;
    if (JSON.stringify(nachher[name]) !== JSON.stringify(vorher[name])) {
      geaendert.push(name + ': ' + JSON.stringify(vorher[name]) + ' -> ' +
        JSON.stringify(nachher[name]));
    }
  }
  assert.deepEqual(geaendert, [], 'der richtige Koerper hat trotzdem etwas geaendert');
  // Und es fehlt auch keines.
  assert.deepEqual(Object.keys(nachher).sort(), Object.keys(vorher).sort());
});

test('EU-N1: DER BELEG -- die unvollstaendige Fassung laesst sich nicht mehr bauen', () => {
  // DREI SPERREN, und jede fuer sich reicht.
  //
  // 1. Die Methode nimmt KEINEN Koerper entgegen. Der Parameter existiert
  //    nicht; wer einen unvollstaendigen schicken wollte, muesste die Datei
  //    aendern.
  const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
  const kanal = K.rohKanal(yt);
  assert.match(String(kanal.stelleOeffentlich),
    /async stelleOeffentlich\(\{ videoId, status \}\)/,
    'die Methode nimmt etwas anderes entgegen als videoId und status');
  for (const wort of ['requestBody:', 'koerper', 'body']) {
    assert.ok(!String(kanal.stelleOeffentlich).includes(wort + ' =') ,
      'die Methode hat einen Parameter ' + wort);
  }

  // 2. Der Koerper entsteht an GENAU EINER Stelle. Abgezaehlt im Quelltext
  //    des Kanalmoduls, ohne Kommentare.
  const kanalQuelle = fs.readFileSync(path.join(WURZEL, 'src/upload/longform-kanal.js'), 'utf8');
  const nurCode = kanalQuelle.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.equal((nurCode.match(/videos\.update\(/g) || []).length, 1,
    'videos.update wird an mehr oder weniger als einer Stelle gerufen');
  assert.equal((nurCode.match(/function baueStatusKoerper/g) || []).length, 1);
  assert.equal((nurCode.match(/baueStatusKoerper\(/g) || []).length, 2,
    'baueStatusKoerper wird an mehr oder weniger als einer Stelle gerufen (plus Definition)');

  // 3. KEINE ANDERE DATEI DIESES WEGES RUFT videos.update. Geprueft an der
  //    GELIEHENEN KETTE -- jeder Datei unter src/, die vom Arbeiter aus
  //    erreichbar ist -- und nicht an einer Liste, die jemand pflegt.
  //
  //    WARUM NICHT AN ALLEN QUELLEN DES PROJEKTS: src/publish/unlist-*.js
  //    rufen videos.update, seit es sie gibt. Sie gehoeren zum
  //    Back-Catalog-Weg, laufen von Hand und haben mit dem Longform-Weg keine
  //    Zeile gemeinsam -- der Arbeiter erreicht sie nicht, weder ueber ein
  //    require noch sonstwie. Ein Test, der sie hier verboete, verboete ein
  //    fremdes Werkzeug; die Gegenprobe unten prueft dafuer, dass sie
  //    wirklich ausserhalb der Kette liegen.
  const kette = Object.keys(require.cache)
    .filter((d) => d.startsWith(path.join(WURZEL, 'src') + path.sep)).sort();
  assert.ok(kette.length >= 8, 'die geliehene Kette hat nur ' + kette.length + ' Dateien');
  assert.ok(kette.some((d) => d.endsWith('longform-kanal.js')));
  const funde = [];
  for (const datei of kette) {
    if (datei.endsWith('longform-kanal.js')) continue;
    const text = fs.readFileSync(datei, 'utf8').split('\n')
      .filter((z) => !z.trim().startsWith('//') && !z.trim().startsWith('*')).join('\n');
    if (/videos\.update\(/.test(text)) funde.push(path.relative(WURZEL, datei));
  }
  assert.deepEqual(funde, [], 'eine zweite Datei der Kette ruft videos.update: ' +
    funde.join(', '));
  // Die Gegenprobe: die beiden Back-Catalog-Skripte rufen ihn wirklich, und
  // sie liegen wirklich ausserhalb der Kette. Waere eines von beiden nicht so,
  // stuende die Ausnahme oben ohne Gegenstand da.
  const fremde = alleQuellen().filter((d) => /unlist-/.test(d));
  assert.ok(fremde.length >= 1, 'die Back-Catalog-Skripte wurden nicht gefunden');
  assert.ok(fremde.some((d) => /videos\.update\(/.test(fs.readFileSync(d, 'utf8'))),
    'kein Back-Catalog-Skript ruft videos.update -- dann braucht es die Ausnahme nicht');
  for (const d of fremde) {
    assert.ok(!kette.includes(d),
      'ein Back-Catalog-Skript liegt in der geliehenen Kette des Arbeiters: ' + d);
  }

  // GEGENPROBE: der Schnitt findet die eine Stelle wirklich. Sonst praefte
  // dieser Test eine Abwesenheit, die niemand herstellen muss.
  assert.ok(nurCode.includes('yt.videos.update('),
    'der Aufruf steht nicht im Kanalmodul -- dann prueft dieser Test nichts');
});

test('EU-N1: baueStatusKoerper benennt, was NICHT mitgeht -- statt es zu verschweigen', () => {
  // DER FALL, DEN DIESER BAU NICHT HEILEN KANN: ein uebertragbares Feld stand
  // nicht im gelesenen Block. Dann kann es nicht zurueckgeschickt werden, und
  // laut Dokumentation faellt es auf seine Vorgabe. Der Bau erfindet dafuer
  // keinen Wert -- er NENNT das Feld.
  const halb = K.baueStatusKoerper({
    videoId: DOPPEL_VIDEO,
    status: { privacyStatus: 'private', embeddable: false, uploadStatus: 'processed' },
  });
  assert.equal(halb.ok, true);
  assert.deepEqual(halb.fehlend, ['license', 'publicStatsViewable',
    'selfDeclaredMadeForKids', 'containsSyntheticMedia']);
  assert.deepEqual(halb.verworfen, ['uploadStatus']);
  assert.deepEqual(halb.koerper.status, { embeddable: false, privacyStatus: 'public' });

  // Und der Lauf SAGT es, mit jedem Namen einzeln. Ein "einige Felder fehlten"
  // waere die Auskunft, die niemandem hilft.
  const voll = K.baueStatusKoerper({ videoId: DOPPEL_VIDEO, status: STATUS_MIT_ABWEICHUNGEN });
  assert.deepEqual(voll.fehlend, []);
  assert.deepEqual(voll.verworfen, ['uploadStatus']);
});

// Alle .js unter src/, ohne node_modules.
function alleQuellen() {
  const raus = [];
  const gehe = (ordner) => {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      const p = path.join(ordner, e.name);
      if (e.isDirectory()) { gehe(p); continue; }
      if (e.name.endsWith('.js') || e.name.endsWith('.cjs')) raus.push(p);
    }
  };
  gehe(path.join(WURZEL, 'src'));
  return raus.sort();
}

// ===========================================================================
// NACHWEIS 2: GENAU EIN videos.update JE LAUF
// ===========================================================================

test('EU-N2: der volle Weg macht GENAU die sieben Aufrufe, und der dritte ist einer',
  async () => {
    const l = lage('n2');
    try {
      await bisZumPrivatenVideo(l);
      const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
      const befund = trocken(l);
      assert.equal(befund.abbruch, null, JSON.stringify(befund.abbruch));
      const e = schreibeZweiteErmaechtigung(l, befund);
      const r = await scharfDritt(l, befund, e.pfad, { attrappe: yt });

      assert.equal(r.code, L.EXIT_OK, r.fehler);
      // DIE REIHENFOLGE IST DIE AUS VERTRAG 4 SCHRITT 16 -- abgezaehlt.
      assert.deepEqual(r.aufrufe, [
        'channels.list',    // Schritt 9: auf welchen Kanal?
        'videos.list',      // der Kontrollblick: hat sich etwas geaendert?
        'videos.list',      // part=status, unmittelbar vor dem Update (2.5)
        'videos.update',    // Aufruf 3
      ]);
      assert.equal(r.aufrufe.filter((a) => a === 'videos.update').length, 1,
        'videos.update ist nicht genau einmal gemacht worden');

      // Und im Gedaechtnis steht der Stand.
      const g = gedaechtnisVon(l).uploads[0];
      assert.equal(g.stand, 'oeffentlich');
      assert.equal(g.oeffentlich_privacystatus, 'public');
      assert.ok(g.oeffentlich_am);
      assert.ok(g.oeffentlich_versuch.begonnen_am);
      assert.equal(g.oeffentlich_versuch.beendet, true);
      // BEIDE ZEITPUNKTE, auf die Sekunde. Ohne sie liesse sich hinterher
      // nicht sagen, ob eine Abo-Benachrichtigung dazugehoerte.
      assert.match(g.oeffentlich_versuch.begonnen_am, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      assert.match(g.oeffentlich_am, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      assert.ok(Date.parse(g.oeffentlich_am) >= Date.parse(g.oeffentlich_versuch.begonnen_am));
    } finally { l.weg(); }
  });

test('EU-N2: die Zaehlung schnappt zu -- ein zweites videos.update wird NICHT gemacht',
  async () => {
    // DIE SICHERUNG IM PROGRAMM, nicht im Test: dasselbe zaehlenderKanal(),
    // das im scharfen Lauf sitzt. Sie wirft VOR dem Aufruf.
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const k = doppelgaenger({ attrappe: yt });
    const gelesen = await k.liesStatus({ videoId: DOPPEL_VIDEO });
    await k.stelleOeffentlich({ videoId: DOPPEL_VIDEO, status: gelesen.status });
    const standNachEinem = yt.stand();

    let gefangen = null;
    try {
      await k.stelleOeffentlich({ videoId: DOPPEL_VIDEO, status: gelesen.status });
    } catch (e) { gefangen = e; }
    assert.ok(gefangen, 'ein zweites videos.update ist durchgekommen');
    assert.match(gefangen.message, /SCHREIBSPERRE/);
    assert.match(gefangen.message, /videos\.update/);
    // Die Meldung nennt den ERSTEN Aufruf mit -- ein Abbruch, der nur "schon
    // einmal" sagt, laesst offen, was der erste bewirkt hat.
    assert.match(gefangen.message, /Aufruf Nr\. \d/);
    assert.match(gefangen.message, /stelleOeffentlich/);

    // UND DIE ATTRAPPE HAT DEN ZWEITEN NIE GESEHEN.
    assert.deepEqual(yt.stand(), standNachEinem);
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 1);
    assert.deepEqual(k.aufrufnamen(), ['videos.list', 'videos.update']);
  });

test('EU-N2: die Zaehlung steht im PROGRAMM und nicht nur im Test', () => {
  // Ein Zaehler, den nur der Test sieht, zaehlt dort, wo nichts passieren
  // kann. Diese drei Zeilen sagen, dass er im Programm steht.
  const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/longform-kanal.js'), 'utf8');
  const nurCode = quelle.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.ok(nurCode.includes('SCHREIBSPERRE'), 'die Sperre steht nicht im Programm');
  assert.ok(nurCode.includes("SCHREIBENDE_AUFRUFE.includes(aufruf)"));
  assert.ok(K.SCHREIBENDE_AUFRUFE.includes('videos.update'),
    'der dritte Aufruf steht nicht bei den gezaehlten schreibenden');
  // Und der Arbeiter geht durch den Zaehler und nicht am ihm vorbei: er ruft
  // ausschliesslich Methoden des Kanalobjekts.
  const arbeiter = fs.readFileSync(path.join(WURZEL, 'src/upload/longform-arbeiter.js'), 'utf8')
    .split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.ok(!/\byt\./.test(arbeiter), 'der Arbeiter greift auf einen API-Klienten zu');
  assert.ok(arbeiter.includes('kanal.stelleOeffentlich('),
    'der Arbeiter ruft den dritten Aufruf nicht ueber das Kanalobjekt');
});

// ===========================================================================
// NACHWEIS 3: publishAt UND snippet KOMMEN IM KOERPER NICHT VOR
// ===========================================================================
//
// Als Test, nicht als Zusicherung. Geprueft wird der KOERPER, der wirklich
// hinausgeht -- an der Attrappe abgefangen.

test('EU-N3: der Anfragekoerper traegt weder einen Termin noch ein snippet', async () => {
  const yt = youtubeAttrappe(Object.assign({}, STATUS_MIT_ABWEICHUNGEN));
  const kanal = K.rohKanal(yt);
  const gelesen = await kanal.liesStatus({ videoId: DOPPEL_VIDEO });
  await kanal.stelleOeffentlich({ videoId: DOPPEL_VIDEO, status: gelesen.status });

  const update = yt.aufrufe().find((a) => a.was === 'videos.update');
  assert.ok(update, 'es ging gar kein videos.update hinaus');

  // 1. part nennt NUR status.
  assert.deepEqual(update.part, ['status']);

  // 2. Der Koerper hat GENAU zwei Schluessel: id und status.
  assert.deepEqual(Object.keys(update.requestBody).sort(), ['id', 'status']);
  assert.equal(update.requestBody.snippet, undefined);

  // 3. Kein Termin -- weder gesetzt noch auf null noch als Schluessel.
  const felder = Object.keys(update.requestBody.status);
  assert.ok(!felder.includes(K.STATUS_FELDER_NIE[0]),
    'der Koerper traegt einen Veroeffentlichungstermin');
  assert.ok(!JSON.stringify(update.requestBody).includes(K.STATUS_FELDER_NIE[0]),
    'der Termin kommt im Koerper irgendwo vor');

  // 4. Und die Felder, die drin sind, sind genau die zugesagten.
  assert.deepEqual(felder.sort(),
    K.STATUS_FELDER_UEBERTRAGEN.concat([K.STATUS_FELD_PRIVACY]).slice().sort());
});

test('EU-N3: ein Termin IM GELESENEN BLOCK bricht den Lauf ab, statt mitzugehen', async () => {
  // Der Weg setzt nie einen (Vertrag 7). Steht einer da, hat ihn jemand
  // anders gesetzt -- und dann ist dieses Video ein terminiertes.
  const l = lage('n3-termin');
  try {
    await bisZumPrivatenVideo(l);
    const mitTermin = Object.assign({}, STATUS_MIT_ABWEICHUNGEN,
      { publishAt: '2099-01-01T00:00:00Z' });
    const yt = youtubeAttrappe(mitTermin);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);
    const r = await scharfDritt(l, befund, e.pfad, { attrappe: yt });

    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.abbruch.code, 'termin_im_statusblock');
    assert.ok(!r.aufrufe.includes('videos.update'),
      'es ging trotzdem ein Update hinaus: ' + r.aufrufe.join(', '));
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 0);
    // Das Video ist unberuehrt.
    assert.deepEqual(yt.stand(), mitTermin);
    // Und die Meldung sagt, worum es geht.
    const satz = r.abbruch.gruende.join(' ');
    assert.ok(satz.includes('VEROEFFENTLICHUNGSTERMIN'), satz);
    assert.ok(satz.includes('Es wurde NICHTS gesendet'), satz);
    // Der Stand bleibt stehen -- nichts wurde begonnen.
    const g = gedaechtnisVon(l).uploads[0];
    assert.equal(g.stand, 'thumbnail_gesetzt');
    assert.equal(g.oeffentlich_versuch, undefined);
  } finally { l.weg(); }
});

test('EU-N3: die Frage sperrt den Knopf, wenn im Statusblock ein Termin steht', () => {
  // Dieselbe Lage, eine Stufe frueher: schon die ANZEIGE darf dann keinen
  // Knopf anbieten. Ein Befund, der erst im scharfen Lauf faellt, laesst einen
  // Menschen klicken.
  const l = lage('n3-frage');
  try {
    return bisZumPrivatenVideo(l).then(() => {
      const p = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
      const g = JSON.parse(fs.readFileSync(p, 'utf8'));
      g.uploads[0].rueckgelesen.status = { privacyStatus: 'private',
        publishAt: '2099-01-01T00:00:00Z' };
      fs.writeFileSync(p, JSON.stringify(g, null, 2));
      const befund = trocken(l);
      const zb = L.zweiteBindungsZeile(befund);
      assert.equal(zb.moeglich, false);
      assert.ok(zb.grund.includes('VEROEFFENTLICHUNGSTERMIN'), zb.grund);
      assert.equal(befund.frage.sperrend, 1);
    }).finally(() => l.weg());
  } catch (e) { l.weg(); throw e; }
});

// ===========================================================================
// NACHWEIS 4: DIE ZWEITE ERMAECHTIGUNG GILT EINMAL UND NUR FUER DAS BEURTEILTE
// ===========================================================================
//
// Jeder Fall laeuft durch DIESELBE Funktion, die main() ruft. Und jeder muss
// dreierlei leisten:
//
//   1. Es wird NICHTS oeffentlich -- die Liste der Aufrufe traegt kein
//      videos.update, und die Attrappe hat keines gesehen.
//   2. Der Code benennt den Fall, und keine zwei Faelle teilen sich einen.
//   3. Die Meldung sagt, WELCHE Bindung nicht getragen hat -- keine zwei
//      Meldungen sind gleich.

test('EU-N4: vierzehn Faelle, vierzehn Meldungen, kein einziges Update', async () => {
  const l = lage('n4');
  try {
    await bisZumPrivatenVideo(l);
    const befund = trocken(l);
    const b = L.zweiteBindungsZeile(befund);
    assert.equal(b.moeglich, true, b.grund);

    const gerade = Date.now();
    const faelle = [
      ['zweite_pfad_leer', 'kein Pfad', { pfad: '' }],
      ['zweite_pfad_fremd', 'ein Pfad ausserhalb des Ordners',
        { pfad: path.join(l.wurzel, 'anderswo.json') }],
      ['zweite_fehlt', 'die Datei gibt es nicht',
        { pfad: G.ermaechtigungPfad(l.wurzel, 'a'.repeat(64)), nichtSchreiben: true }],
      ['zweite_fremder_typ', 'ein fremder artifact_type',
        { felder: { artifact_type: 'adw_etwas_anderes' } }],
      ['zweite_fremde_version', 'eine fremde schema_version',
        { felder: { schema_version: '9.9' } }],
      ['zweite_fremder_zweck', 'ein Zweck, den niemand einloest',
        { felder: { zweck: 'etwas_ganz_anderes' } }],
      ['zweite_zufall_form', 'ein Zufallswert, der keiner ist',
        { felder: { zufall: 'kurz' } }],
      ['zweite_zukunft', 'auf morgen datiert', { jetzt: gerade + 3600000 }],
      ['zweite_abgelaufen', 'vor einer Stunde ausgestellt', { jetzt: gerade - 3600000 }],
      ['zweite_fremde_aufnahme', 'eine andere Aufnahme',
        { felder: { aufnahme: '2026-08-30 09-12-00' } }],
      ['zweite_video_sha', 'eine andere Videodatei',
        { felder: { video_sha256: 'b'.repeat(64) } }],
      ['zweite_video_id', 'ein ANDERES Video auf dem Kanal',
        { felder: { videoId: 'ATTRAPPE-EIN-ANDERES-VIDEO' } }],
      ['zweite_urteil_bild_name', 'ein anderes Bild im Urteil',
        { felder: { 'urteil.thumbnail.dateiname': 'ein-anderes.jpg' } }],
      ['zweite_urteil_bild_sha_gedaechtnis', 'dasselbe Bild, andere Bytes im Urteil',
        { felder: { 'urteil.thumbnail.sha256': 'c'.repeat(64) } }],
    ];

    const gesehen = new Map();
    for (const [code, was, aenderungen] of faelle) {
      const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
      let pfad = aenderungen.pfad;
      if (!aenderungen.nichtSchreiben && aenderungen.pfad === undefined) {
        pfad = schreibeZweiteErmaechtigung(l, befund, aenderungen).pfad;
      } else if (!aenderungen.nichtSchreiben && aenderungen.pfad) {
        // Die Datei liegt woanders -- sie wird trotzdem geschrieben, damit
        // nicht "fehlt" statt "fremder Pfad" herauskommt.
        if (aenderungen.pfad !== '') {
          schreibeZweiteErmaechtigung(l, befund, aenderungen);
        }
      }
      const r = await scharfDritt(l, befund, pfad === undefined ? '' : pfad, { attrappe: yt });

      assert.equal(r.code, L.EXIT_BEFUND, was + ': der Lauf endete nicht mit 1');
      assert.equal(r.abbruch.code, code, was + ': erwartet ' + code + ', bekommen ' +
        r.abbruch.code);
      assert.ok(!r.aufrufe.includes('videos.update'),
        was + ': es ging ein Update hinaus -- ' + r.aufrufe.join(', '));
      assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 0,
        was + ': die Attrappe hat ein Update gesehen');
      assert.deepEqual(yt.stand(), STATUS_MIT_ABWEICHUNGEN, was + ': das Video hat sich geaendert');
      assert.equal(gedaechtnisVon(l).uploads[0].stand, 'thumbnail_gesetzt',
        was + ': der Stand hat sich geaendert');

      const meldung = r.abbruch.gruende.join(' ');
      assert.ok(meldung.length > 60, was + ': die Meldung ist zu duenn: ' + meldung);
      // KEINE ZWEI TEILEN SICH EINE MELDUNG.
      for (const [andererCode, anderText] of gesehen) {
        assert.notEqual(meldung, anderText,
          code + ' und ' + andererCode + ' teilen sich eine Meldung');
      }
      gesehen.set(code, meldung);
    }
    assert.equal(gesehen.size, faelle.length);
    // Und alle vierzehn Codes sind verschieden.
    assert.equal(new Set(faelle.map((f) => f[0])).size, faelle.length);
  } finally { l.weg(); }
});

test('EU-N4: ZWEITER LAUF MIT DERSELBEN -- kein Update', async () => {
  const l = lage('n4-zweimal');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);

    // Der erste Lauf geht durch.
    const r1 = await scharfDritt(l, befund, e.pfad, { attrappe: yt });
    assert.equal(r1.code, L.EXIT_OK, r1.fehler);
    assert.equal(yt.stand().privacyStatus, 'public');
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 1);

    // DIE DATEI IST WEG -- verbraucht und geloescht.
    assert.ok(!fs.existsSync(e.pfad), 'die Ermaechtigung liegt noch da');

    // SIE WIRD WIEDERHERGESTELLT, Byte fuer Byte. Das ist der Angriff, gegen
    // den die Verbrauchsliste steht: eine Kopie der Datei gilt nicht mehr.
    S.schreibeErmaechtigung(e.pfad, e.inhalt);
    const befund2 = trocken(l);
    const r2 = await scharfDritt(l, befund2, e.pfad, { attrappe: yt });

    assert.equal(r2.code, L.EXIT_BEFUND);
    // Der Stand ist schon `oeffentlich` -- der Trockenlauf bricht damit vor
    // der Ermaechtigung ab (Vertrag 5.3), und das ist die stringentere Sperre:
    // sie greift, bevor irgendetwas gelesen wird.
    assert.ok(befund2.abbruch, 'ein oeffentliches Video ist kein Abbruch');
    assert.equal(befund2.abbruch.code, 'video_schon_oeffentlich');
    assert.ok(!r2.aufrufe.includes('videos.update'));
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 1,
      'es ging ein zweites Update hinaus');
  } finally { l.weg(); }
});

test('EU-N4: dieselbe Ermaechtigung auf einem Gedaechtnis, das noch nicht oeffentlich ist',
  async () => {
    // DIE VERBRAUCHSLISTE ALLEIN, ohne den Stand. Der Lauf oben bricht schon
    // am Stand ab; dieser hier stellt das Gedaechtnis zurueck und laesst nur
    // die Verbrauchsliste stehen -- dann muss die Ermaechtigung selbst
    // abgewiesen werden.
    const l = lage('n4-verbraucht');
    try {
      await bisZumPrivatenVideo(l);
      const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
      const befund = trocken(l);
      const e = schreibeZweiteErmaechtigung(l, befund);
      const p = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
      const vorher = fs.readFileSync(p, 'utf8');

      const r1 = await scharfDritt(l, befund, e.pfad, { attrappe: yt });
      assert.equal(r1.code, L.EXIT_OK, r1.fehler);

      // Das Gedaechtnis zurueck auf den Stand von vorher -- die
      // Verbrauchsliste bleibt.
      fs.writeFileSync(p, vorher);
      S.schreibeErmaechtigung(e.pfad, e.inhalt);
      const befund2 = trocken(l);
      assert.equal(befund2.abbruch, null);
      const r2 = await scharfDritt(l, befund2, e.pfad, { attrappe: yt });

      assert.equal(r2.code, L.EXIT_BEFUND);
      assert.equal(r2.abbruch.code, 'zweite_verbraucht');
      assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 1,
        'es ging ein zweites Update hinaus');
    } finally { l.weg(); }
  });

test('EU-N4: VERAENDERTER TITEL SEIT DEM URTEIL -- kein Update', async () => {
  const l = lage('n4-titel');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);
    // Zwischen Urteil und Klick hat jemand im Studio umbenannt.
    const r = await scharfDritt(l, befund, e.pfad, {
      attrappe: yt, titel: 'Ein GANZ anderer Titel',
    });

    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.abbruch.code, 'urteil_titel');
    assert.ok(!r.aufrufe.includes('videos.update'));
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 0);
    const satz = r.abbruch.gruende.join(' ');
    assert.ok(satz.includes('DER TITEL HAT SICH SEIT DEM URTEIL GEAENDERT'), satz);
    assert.ok(satz.includes(TITEL) && satz.includes('Ein GANZ anderer Titel'),
      'die Meldung nennt nicht beide Titel');
    // Der Kontrollblick ist gemacht, der Statusblock NICHT gelesen worden --
    // der Lauf bricht ab, bevor er ihn braucht.
    assert.deepEqual(r.aufrufe, ['channels.list', 'videos.list']);
  } finally { l.weg(); }
});

test('EU-N4: VERAENDERTES THUMBNAIL SEIT DEM URTEIL -- kein Update', async () => {
  const l = lage('n4-bild');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);

    // Der Compositor hat unter demselben Namen neu exportiert -- zwischen dem
    // Urteil und dem Klick.
    const neu = Buffer.alloc(4096, 7);
    fs.writeFileSync(path.join(l.exp, l.bildname), neu);

    const r = await scharfDritt(l, befund, e.pfad, { attrappe: yt });
    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.abbruch.code, 'urteil_bild');
    assert.ok(!r.aufrufe.includes('videos.update'));
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 0);
    const satz = r.abbruch.gruende.join(' ');
    assert.ok(satz.includes('DAS THUMBNAIL AUF DER PLATTE HAT SICH SEIT DEM URTEIL GEAENDERT'),
      satz);
    assert.ok(satz.includes(l.bildSha) && satz.includes(sha256(neu)),
      'die Meldung nennt nicht beide Pruefsummen');
  } finally { l.weg(); }
});

test('EU-N4: der Lauf weigert sich auch, wenn YouTube das Video ablehnt oder nicht kennt',
  async () => {
    for (const [marke, opt, code] of [
      ['abgelehnt', { uploadStatus: 'rejected', gruende: { rejectionReason: 'copyright' } },
        'jetzt_abgelehnt'],
      ['fehlgeschlagen', { processingStatus: 'failed' }, 'jetzt_verarbeitung_schlecht'],
      ['verschwunden', { gefunden: false }, 'video_nicht_gefunden'],
      ['schon oeffentlich', { privacyStatus: 'public' }, 'nicht_mehr_privat'],
    ]) {
      const l = lage('n4-' + marke.replace(/ /g, '-'));
      try {
        await bisZumPrivatenVideo(l);
        const yt = youtubeAttrappe(Object.assign({}, STATUS_MIT_ABWEICHUNGEN,
          marke === 'schon oeffentlich' ? { privacyStatus: 'public' } : {}));
        const befund = trocken(l);
        const e = schreibeZweiteErmaechtigung(l, befund);
        const r = await scharfDritt(l, befund, e.pfad, Object.assign({ attrappe: yt }, opt));
        assert.equal(r.code, L.EXIT_BEFUND, marke);
        assert.equal(r.abbruch.code, code, marke + ': ' + r.abbruch.code);
        assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 0, marke);
      } finally { l.weg(); }
    }
  });

test('EU-N4: eine Ermaechtigung fuer den falschen Kanal wird abgewiesen', async () => {
  const l = lage('n4-kanal');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund, { kanalId: 'ATTRAPPE-FREMDER-KANAL' });
    const r = await scharfDritt(l, befund, e.pfad, { attrappe: yt });
    assert.equal(r.code, L.EXIT_BEFUND);
    assert.ok(!r.aufrufe.includes('videos.update'));
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 0);
    // Der Kanalvergleich ist geliehen (uploader.pruefeKanal); er faellt NACH
    // channels.list und vor jedem schreibenden Aufruf.
    assert.deepEqual(r.aufrufe, ['channels.list']);
  } finally { l.weg(); }
});

test('EU-N4: eine Ermaechtigung ZUM HOCHLADEN loest hier nichts ein -- und wird nicht ' +
  'verbraucht', async () => {
  // Der eine Fall der vierzehn, der NICHT mit 1 endet, und darum steht er
  // hier fuer sich. Die Datei nennt einen bekannten Zweck; der Lauf nimmt sie
  // beim Wort und geht den Upload-Weg. Dort ist nichts zu tun -- der Upload
  // ist fertig --, und "fertig" ist kein Befund (Vertrag 6).
  //
  // WAS ER TROTZDEM LEISTET: kein Update, kein Upload, und die Ermaechtigung
  // BLEIBT LIEGEN. Eine, die hier verbraucht wuerde, waere weg, ohne dass
  // jemand etwas davon haette -- und ein Mensch muesste zweimal klicken, um
  // einmal zu handeln.
  const l = lage('n4-upload-erm');
  try {
    // Die Upload-Ermaechtigung wird aus dem Befund VOR dem Upload gebaut --
    // danach gibt es keine erste Bindung mehr, und das ist der Punkt.
    const vorher = trocken(l);
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    assert.equal(L.bindungsZeile(befund).moeglich, false,
      'nach dem Upload gibt es noch eine erste Bindung');
    const e = schreibeErsteErmaechtigung(l, vorher);
    const r = await scharfDritt(l, befund, e.pfad, { attrappe: yt });

    assert.equal(r.code, L.EXIT_OK);
    assert.deepEqual(r.aufrufe, [], 'es ging ein Aufruf hinaus');
    assert.equal(yt.aufrufe().length, 0);
    assert.ok(r.aus.includes('NICHTS HOCHZULADEN'), r.aus);
    assert.ok(r.aus.includes('ZWEITE Ermaechtigung'), r.aus);
    assert.ok(fs.existsSync(e.pfad), 'die Upload-Ermaechtigung ist verbraucht worden');
    assert.equal(gedaechtnisVon(l).uploads[0].stand, 'thumbnail_gesetzt');
  } finally { l.weg(); }
});

// ===========================================================================
// DER DIENST UND DIE SEITE
// ===========================================================================
//
// Der Weg vom Klick zum Arbeiter. Er wird hier an der ECHTEN Sitzung geprueft,
// die der Dienst baut -- nicht an einer nachgebauten: was die Seite zeigt und
// was die Route annimmt, haengt an derselben Funktion, und eine zweite
// Bedingung waere eine Seite, die einen Knopf zeigt, den der Dienst ablehnt.

function longformSitzungMit(befund, lauf = null) {
  return {
    modus: S.MODUS_LONGFORM,
    aufnahme: AUFNAHME,
    port: 8799,
    projektwurzel: '.',
    token: 'x'.repeat(64),
    trocken: { befehl: 'node ...', code: 0, aus: 'vorschau', err: '' },
    ausgang: { code: 0, name: 'OK', bedeutung: 'b', zusatz: 'z', fehler: null },
    bild: { da: false, grund: 'in diesem Test ohne Bild' },
    bindung: L.bindungsZeile(befund),
    frage: befund.frage,
    zweiteBindung: L.zweiteBindungsZeile(befund),
    gedaechtnis: befund.gedaechtnis === null ? null : { satz: befund.gedaechtnis.satz },
    kanal: { ok: true, id: DOPPEL_KANAL_ID, name: DOPPEL_KANAL_NAME },
    knopfBereit: S.longformKnopfDa,
    dritterKnopfBereit: S.longformDritterKnopfDa,
    lauf,
  };
}

test('EU: auf einer Lage gibt es HOECHSTENS EINE Sorte Knopf', async () => {
  const l = lage('knoepfe');
  try {
    // VOR dem Upload: der Upload-Knopf, und die beiden anderen nicht.
    const vorher = trocken(l);
    assert.equal(S.longformKnopfDa(longformSitzungMit(vorher)).da, true);
    const dritt1 = S.longformDritterKnopfDa(longformSitzungMit(vorher));
    assert.equal(dritt1.da, false);
    assert.ok(dritt1.grund.includes('Frage'), dritt1.grund);

    // NACH dem Upload: die beiden anderen, und der Upload-Knopf nicht.
    await bisZumPrivatenVideo(l);
    const nachher = trocken(l);
    assert.equal(S.longformDritterKnopfDa(longformSitzungMit(nachher)).da, true);
    const auf = S.longformKnopfDa(longformSitzungMit(nachher));
    assert.equal(auf.da, false);
    assert.ok(auf.grund.includes('FERTIG'), auf.grund);
  } finally { l.weg(); }
});

test('EU: die Seite zeigt die Frage vollstaendig und beide Knoepfe', async () => {
  const l = lage('seite');
  try {
    await bisZumPrivatenVideo(l);
    const befund = trocken(l);
    const html = SEITE.baueLongformSeite(longformSitzungMit(befund));

    // Die Nutzlast traegt die Frage WOERTLICH -- nichts davon wird auf dem Weg
    // zur Seite gekuerzt oder ausgewaehlt.
    const marke = 'const DATEN = ';
    const von = html.indexOf(marke) + marke.length;
    // Die Maskierung wird ueber DIESELBE Tabelle zurueckgenommen, mit der die
    // Seite sie gesetzt hat (SEITE.SKRIPTBLOCK_MASKEN). Sie hier ein zweites
    // Mal hinzuschreiben hiesse, zwei Vorstellungen davon zu haben, was
    // maskiert ist -- und der Freigabe-Check haelt eine davon fuer einen
    // Laufwerkspfad.
    let roh = html.slice(von, html.indexOf(';' + String.fromCharCode(10), von));
    for (const [zeichen, maske] of Object.entries(SEITE.SKRIPTBLOCK_MASKEN)) {
      roh = roh.split(maske).join(zeichen);
    }
    const daten = JSON.parse(roh);
    assert.equal(daten.frage.moeglich, true);
    assert.equal(daten.frage.videoId, DOPPEL_VIDEO);
    assert.equal(daten.frage.titel.gesendet, TITEL);
    assert.equal(daten.frage.titel.laut_youtube, TITEL);
    assert.equal(daten.frage.titel.gleich, true);
    assert.equal(typeof daten.frage.beschreibung.heute_gebaut, 'string');
    assert.equal(daten.frage.beschreibung.gleich, true,
      'die heute gebaute Beschreibung ist nicht die gesendete');
    assert.equal(daten.frage.thumbnail.dateiname, l.bildname);
    assert.equal(daten.frage.thumbnail.auf_der_platte.ok, true);
    assert.equal(daten.frage.auskuenfte.length, L.YOUTUBE_AUSKUENFTE.length);
    assert.ok(daten.frage.status_roh, 'der rohe status-Block fehlt in der Nutzlast');
    assert.equal(daten.frage.sperrend, 0);
    assert.equal(daten.dritterKnopf.da, true);
    assert.ok(daten.dritterKnopf.beschriftung_echt.includes('nicht zurueckzunehmen'));
    assert.ok(daten.dritterKnopf.beschriftung_halt.includes('ANHALTEN'));

    // Und der Kasten der Frage ist wirklich in der Seite.
    assert.ok(html.includes('id="frageKasten"'));
    assert.ok(html.includes('id="knopfHalt"'));
    assert.ok(html.includes('id="knopfEcht"'));
  } finally { l.weg(); }
});

test('EU: eine sperrende Auffaelligkeit schliesst beide Knoepfe -- und sie steht da',
  async () => {
    const l = lage('sperrend');
    try {
      await bisZumPrivatenVideo(l);
      // Das Bild auf der Platte ist ein anderes geworden.
      fs.writeFileSync(path.join(l.exp, l.bildname), Buffer.alloc(4096, 7));
      const befund = trocken(l);
      assert.ok(befund.frage.sperrend >= 1, 'die Frage sieht die Abweichung nicht');
      const s = longformSitzungMit(befund);
      const dritt = S.longformDritterKnopfDa(s);
      assert.equal(dritt.da, false);
      assert.ok(dritt.grund.includes('Befund'), dritt.grund);

      const html = SEITE.baueLongformSeite(s);
      assert.ok(html.includes('id="drittGesperrt"'));
      // Der Grund steht in der Nutzlast, damit ihn ein Mensch liest.
      assert.ok(html.includes('BILDDATEI VON DER PLATTE') ||
        html.includes('drittGrund'), 'der Grund fehlt');
    } finally { l.weg(); }
  });

test('EU: der Dienst schreibt die zweite Ermaechtigung mit dem Zweck der ROUTE', () => {
  // Der Zweck kommt aus der Routentabelle und nicht aus der Anfrage. Das ist
  // die Stelle, an der ein Vertauschen ein Video oeffentlich machte, ohne dass
  // es jemandem auffiele.
  const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
  const nurCode = quelle.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  assert.match(nurCode,
    /pfad === '\/haltepunkt'[\s\S]{0,120}ZWECK_HALTEPUNKT/);
  assert.match(nurCode,
    /pfad === '\/veroeffentlichen'[\s\S]{0,120}ZWECK_VEROEFFENTLICHEN/);
  // UND NICHT VERTAUSCHT.
  assert.ok(!/pfad === '\/haltepunkt'[\s\S]{0,120}ZWECK_VEROEFFENTLICHEN/.test(nurCode),
    'die Haltepunkt-Route schreibt den Zweck zum Veroeffentlichen');
  // Der Zweck wird NIRGENDS aus einer Anfrage gelesen.
  const rumpf = nurCode.slice(nurCode.indexOf('function nimmLongformDrittenAufruf('),
    nurCode.indexOf('function liefereLongformLauf('));
  assert.ok(rumpf.length > 500, 'die Route wurde nicht gefunden');
  for (const wort of ['req.', 'JSON.parse', "on('data'", 'abfrage']) {
    assert.ok(!rumpf.includes(wort),
      'die Route liest etwas aus der Anfrage: ' + wort);
  }
  assert.ok(rumpf.includes('zweck,'), 'der Zweck geht nicht in die Ermaechtigung');
});

// ===========================================================================
// NACHWEIS 5: DER ABBRUCH IN DER MITTE
// ===========================================================================
//
// Zwischen videos.list und videos.update abbrechen, dann neu starten: kein
// zweites Update, kein Rueckfall auf privat, kein verlorener Statusblock.
// BEGINN MIT DEM SCHADEN.
//
// DIE LAGE, UM DIE ES GEHT, und sie ist enger als "der Prozess ist gestorben":
// der Aufruf ist HINAUSGEGANGEN, und was zurueckkam, war kein Erfolg -- ein
// Fehler, ein Abbruch der Verbindung, gar nichts. Ob YouTube ihn ausgefuehrt
// hat, weiss danach niemand.
//
// WARUM DIE FRISCHE LESEANTWORT NICHT REICHT. Der naechste Lauf liest den
// Statusblock neu, und meldet der "public", bricht er ohnehin ab. Das faengt
// den Fall, in dem die API sofort den neuen Stand zeigt. Ob sie das immer tut,
// ist NICHT GEMESSEN (Vertrag 10) -- und genau in der Luecke sitzt der
// Vermerk. Der Schaden unten wird darum gegen eine Attrappe vorgefuehrt, die
// NACHHINKT: sie hat das Update ausgefuehrt und meldet trotzdem noch "private".

// Ein Kanalobjekt, dessen dritter Aufruf HINAUSGEHT und dann abbricht -- der
// Aufruf ist gemacht, die Antwort verloren. Das ist der eine Ausgang, den kein
// Gedaechtnis von aussen unterscheiden kann.
function kanalDerNachDemAufrufAbstuerzt(yt) {
  const kanal = doppelgaenger({ attrappe: yt });
  let hinaus = 0;
  const aussen = Object.assign({}, kanal, {
    async stelleOeffentlich(a) {
      hinaus++;
      await yt.videos.update({
        part: ['status'],
        requestBody: K.baueStatusKoerper({ videoId: a.videoId, status: a.status }).koerper,
      });
      throw new Error('ATTRAPPE: die Verbindung bricht ab, nachdem der Aufruf hinausging');
    },
  });
  aussen.hinaus = () => hinaus;
  return aussen;
}

test('EU-N5: DER SCHADEN -- ohne den Vermerk macht ein zweiter Lauf ein ZWEITES Update',
  async () => {
    // WAS DIE SICHERUNG ABWENDET, hier einmal ohne sie. Der Vermerk wird nach
    // dem Absturz aus dem Gedaechtnis ENTFERNT -- genau der Zustand, den ein
    // Bau haette, der ihn erst NACH dem Aufruf schriebe.
    const l = lage('n5-schaden');
    try {
      await bisZumPrivatenVideo(l);
      const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN, { nachhinken: true });
      const befund = trocken(l);
      const e = schreibeZweiteErmaechtigung(l, befund);

      // LAUF 1: das Update geht hinaus, die Antwort geht verloren.
      const kanal = kanalDerNachDemAufrufAbstuerzt(yt);
      const r1 = await scharfDritt(l, befund, e.pfad, { kanal });
      assert.equal(r1.code, L.EXIT_BEFUND);
      assert.equal(r1.abbruch.code, 'update_fehlgeschlagen');
      assert.equal(kanal.hinaus(), 1);
      assert.equal(yt.stand().privacyStatus, 'public',
        'das Video ist nicht oeffentlich geworden');

      // DER SCHADEN: der Vermerk wird entfernt. Das Gedaechtnis sieht danach
      // aus wie "noch nicht angefangen".
      const p = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
      const g = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.ok(g.uploads[0].oeffentlich_versuch, 'der Vermerk fehlt schon');
      delete g.uploads[0].oeffentlich_versuch;
      fs.writeFileSync(p, JSON.stringify(g, null, 2));

      // LAUF 2 mit einer neuen Ermaechtigung. Die Leseantwort hinkt nach und
      // meldet weiter "private" -- der Lauf glaubt ihr und macht ein ZWEITES
      // Update auf ein Video, das schon oeffentlich ist.
      const befund2 = trocken(l);
      assert.equal(befund2.abbruch, null, 'ohne Vermerk sieht die Lage unauffaellig aus');
      assert.equal(L.zweiteBindungsZeile(befund2).moeglich, true,
        'ohne Vermerk gibt es sogar wieder einen Knopf');
      const e2 = schreibeZweiteErmaechtigung(l, befund2);
      const r2 = await scharfDritt(l, befund2, e2.pfad, { attrappe: yt });

      assert.equal(r2.code, L.EXIT_OK, 'der zweite Lauf ist nicht durchgekommen');
      assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 2,
        'OHNE DEN VERMERK IST KEIN ZWEITES UPDATE ENTSTANDEN -- dann wendet die Sicherung ' +
        'nichts ab, und der Nachweis darunter zeigt nichts');
    } finally { l.weg(); }
  });

test('EU-N5: DIE ABWEHR -- mit dem Vermerk bricht der zweite Lauf ab', async () => {
  const l = lage('n5-abwehr');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN, { nachhinken: true });
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);

    const kanal = kanalDerNachDemAufrufAbstuerzt(yt);
    const r1 = await scharfDritt(l, befund, e.pfad, { kanal });
    assert.equal(r1.abbruch.code, 'update_fehlgeschlagen');
    // Die Meldung sagt das Wichtigste zuerst. Verglichen wird gegen den
    // FLACHGELEGTEN Text: der Arbeiter bricht auf 74 Spalten um, und ein Satz,
    // der ueber zwei Zeilen laeuft, ist derselbe Satz.
    assert.ok(flach(r1.fehler).includes('ES IST NICHT SICHER, OB DAS VIDEO JETZT OEFFENTLICH IST'),
      r1.fehler);
    assert.ok(flach(r1.fehler).includes('IM STUDIO NACHSEHEN'), r1.fehler);

    // 1. DER STATUSBLOCK IST NICHT VERLOREN. Er steht im Vermerk, mit dem
    //    Koerper, der hinausging.
    const g = gedaechtnisVon(l).uploads[0];
    assert.deepEqual(g.oeffentlich_versuch.status_gelesen, STATUS_MIT_ABWEICHUNGEN);
    assert.equal(g.oeffentlich_versuch.koerper.status.privacyStatus, 'public');
    assert.equal(g.oeffentlich_versuch.beendet, false);
    assert.ok(g.oeffentlich_versuch.begonnen_am);
    assert.ok(g.oeffentlich_versuch.fehler);

    // 2. KEIN RUECKFALL AUF PRIVAT. Der Bau hat nichts zurueckgesetzt und
    //    nichts weggeraeumt.
    assert.equal(yt.stand().privacyStatus, 'public');
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 1);

    // 3. DER ZWEITE LAUF MACHT KEIN ZWEITES UPDATE. Er kommt gar nicht bis
    //    dorthin: der Trockenlauf bricht ab, und es gibt keinen Knopf mehr.
    const befund2 = trocken(l);
    assert.ok(befund2.abbruch, 'der offene Vermerk ist kein Abbruch');
    assert.equal(befund2.abbruch.code, 'oeffentlich_versuch_offen');
    assert.ok(befund2.saetze.join('\n').includes('BEGONNEN'), 'die Vorschau sagt es nicht');
    assert.ok(befund2.saetze.join('\n').includes('im Studio'), 'die Vorschau sagt nicht wohin');
    assert.equal(L.zweiteBindungsZeile(befund2).moeglich, false);
    assert.equal(L.bindungsZeile(befund2).moeglich, false);

    // 4. Und selbst mit einer trotzdem geschriebenen Ermaechtigung geschieht
    //    nichts: sie findet nichts, wogegen sie gilt.
    const e2 = schreibeZweiteErmaechtigung(l, befund, { bindung: L.zweiteBindungsZeile(befund) });
    const r2 = await scharfDritt(l, befund2, e2.pfad, { attrappe: yt });
    assert.equal(r2.code, L.EXIT_BEFUND);
    assert.equal(r2.abbruch.code, 'nichts_zu_veroeffentlichen');
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 1,
      'es ging ein zweites Update hinaus');
  } finally { l.weg(); }
});

test('EU-N5: ein Abbruch VOR dem Update laesst gar nichts zurueck', async () => {
  // Der andere Abbruch in der Mitte: zwischen dem Kontrollblick und dem
  // Statusblock. Dann ist nichts hinausgegangen, nichts vermerkt, und ein
  // zweiter Lauf kann weitermachen.
  const l = lage('n5-vorher');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);
    const r = await scharfDritt(l, befund, e.pfad, { attrappe: yt, wirf: 'liesStatus' });

    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.abbruch.code, 'statusblock_nicht_lesbar');
    assert.ok(r.fehler.includes('Es wurde NICHTS geaendert'), r.fehler);
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 0);

    const g = gedaechtnisVon(l).uploads[0];
    assert.equal(g.stand, 'thumbnail_gesetzt');
    assert.equal(g.oeffentlich_versuch, undefined, 'es wurde ein Versuch vermerkt');

    // UND EIN ZWEITER LAUF KOMMT DURCH. Die Ermaechtigung ist verbraucht --
    // es braucht einen zweiten Klick, und dann sieht wieder ein Mensch hin.
    assert.ok(!fs.existsSync(e.pfad));
    const befund2 = trocken(l);
    assert.equal(befund2.abbruch, null);
    assert.equal(L.zweiteBindungsZeile(befund2).moeglich, true);
    const e2 = schreibeZweiteErmaechtigung(l, befund2);
    const r2 = await scharfDritt(l, befund2, e2.pfad, { attrappe: yt });
    assert.equal(r2.code, L.EXIT_OK, r2.fehler);
    assert.equal(yt.stand().privacyStatus, 'public');
  } finally { l.weg(); }
});

// ===========================================================================
// DER HALTEPUNKT
// ===========================================================================

test('EU: der Haltepunkt geht den ganzen Weg und macht KEIN Update', async () => {
  const l = lage('halt');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund, { zweck: G.ZWECK_HALTEPUNKT });
    const r = await scharfDritt(l, befund, e.pfad, { attrappe: yt });

    // ER ENDET MIT 1, ABSICHTLICH: er ist unterwegs stehengeblieben, und 0
    // hiesse "fertig".
    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.angehalten, true);
    // Alle lesenden Aufrufe sind gemacht, der schreibende nicht.
    assert.deepEqual(r.aufrufe, ['channels.list', 'videos.list', 'videos.list']);
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 0);
    assert.deepEqual(yt.stand(), STATUS_MIT_ABWEICHUNGEN, 'das Video hat sich geaendert');

    // WAS GESENDET WUERDE, STEHT DA -- Feld fuer Feld.
    assert.ok(r.fehler.includes('ANGEHALTEN'), r.fehler);
    assert.ok(r.fehler.includes('WAS GESENDET WUERDE'), r.fehler);
    assert.ok(r.fehler.includes('ES IST KEIN SCHREIBENDER AUFRUF DARUNTER'), r.fehler);
    for (const name of K.STATUS_FELDER_UEBERTRAGEN) {
      assert.ok(r.fehler.includes('status.' + name), 'das Feld ' + name + ' fehlt in der Anzeige');
    }

    // Und im Gedaechtnis steht der Haltepunkt -- aber KEIN Versuch.
    const g = gedaechtnisVon(l).uploads[0];
    assert.equal(g.stand, 'thumbnail_gesetzt');
    assert.equal(g.oeffentlich_versuch, undefined);
    assert.deepEqual(g.haltepunkt.status_gelesen, STATUS_MIT_ABWEICHUNGEN);
    assert.equal(g.haltepunkt.koerper.status.privacyStatus, 'public');
    assert.ok(g.haltepunkt.angehalten_am);

    // DIE ERMAECHTIGUNG IST TROTZDEM VERBRAUCHT.
    assert.ok(!fs.existsSync(e.pfad), 'die Haltepunkt-Ermaechtigung liegt noch da');

    // UND DANACH GEHT DER ECHTE LAUF -- mit einer NEUEN Ermaechtigung.
    const befund2 = trocken(l);
    const e2 = schreibeZweiteErmaechtigung(l, befund2);
    const r2 = await scharfDritt(l, befund2, e2.pfad, { attrappe: yt });
    assert.equal(r2.code, L.EXIT_OK, r2.fehler);
    assert.equal(yt.stand().privacyStatus, 'public');
  } finally { l.weg(); }
});

test('EU: eine Haltepunkt-Ermaechtigung kann auf KEINEM Weg veroeffentlichen', async () => {
  // DIE SICHERUNG IST DER ZWECK IN DER DATEI UND KEIN ARGUMENT. Es gibt kein
  // Argument, das den Haltepunkt aufhebt -- der Zweig, der das Update macht,
  // nimmt diesen Zweck nicht an.
  const l = lage('halt-sperre');
  try {
    await bisZumPrivatenVideo(l);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund, { zweck: G.ZWECK_HALTEPUNKT });

    // Erstens: der Arbeiter kennt kein Argument dafuer.
    const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/longform-arbeiter.js'), 'utf8');
    assert.deepEqual(L.ERLAUBTE_ARGUMENTE.slice().sort(),
      ['--aufnahme=', '--zettel=', '--befund-json', '--execute', '--bestaetigt-durch='].sort(),
      'der Arbeiter hat ein Argument dazubekommen');
    for (const wort of ['--halt', '--haltepunkt', '--anhalten', '--trocken-oeffentlich']) {
      assert.ok(!quelle.includes(wort), 'der Arbeiter kennt das Argument ' + wort);
    }

    // Zweitens: der Zweck entscheidet, und er steht in der Datei.
    assert.equal(G.liesZweck(l.wurzel, e.pfad), G.ZWECK_HALTEPUNKT);
    const geaendert = Object.assign({}, e.inhalt, { zweck: G.ZWECK_VEROEFFENTLICHEN });
    assert.notEqual(geaendert.zweck, e.inhalt.zweck);

    // Drittens: der Zweig, der das Update macht, prueft ihn woertlich.
    const arbeiterCode = quelle.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
    assert.ok(arbeiterCode.includes('ermaechtigung.zweck === G.ZWECK_HALTEPUNKT'),
      'der Haltepunkt wird nicht am Zweck erkannt');
    assert.ok(arbeiterCode.includes('if (haltepunkt) {'),
      'es gibt keinen Zweig, der beim Haltepunkt zurueckkehrt');
  } finally { l.weg(); }
});

// ===========================================================================
// NACHWEIS 6: KEIN ECHTER AUFRUF IST MOEGLICH
// ===========================================================================

const Module = require('node:module');

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

test('EU-N6: der volle Durchlauf bis zum oeffentlichen Video fasst keinen Netzweg an',
  async () => {
    const l = lage('n6');
    let waehrend = null;
    try {
      await bisZumPrivatenVideo(l);
      const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
      const befund = trocken(l);
      const e = schreibeZweiteErmaechtigung(l, befund);
      const falle = netzfalleStellen();
      let r;
      try {
        r = await scharfDritt(l, befund, e.pfad, { attrappe: yt });
      } finally {
        // Erst zaehlen, dann loesen -- sonst faende schon die Fehlerausgabe
        // einen Weg hinaus.
        waehrend = falle.beruehrt.slice();
        falle.loesen();
      }
      assert.deepEqual(waehrend, [],
        'der Lauf hat einen Netzweg angefasst: ' + waehrend.join(', '));

      // UND DER DURCHLAUF WAR EIN ECHTER, KEIN LEERER.
      assert.equal(r.code, L.EXIT_OK, r.fehler);
      assert.deepEqual(r.aufrufe,
        ['channels.list', 'videos.list', 'videos.list', 'videos.update']);
      assert.equal(gedaechtnisVon(l).uploads[0].stand, 'oeffentlich');
      assert.equal(yt.stand().privacyStatus, 'public');
    } finally { l.weg(); }
  });

test('EU-N6: die Falle schnappt zu -- vorgefuehrt an jedem einzelnen Weg', async () => {
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

  // UND DER WEG, DEN DIESES PROJEKT WIRKLICH GEHT.
  const falle2 = netzfalleStellen();
  let gefangen2 = null;
  try { await K.baueEchtenKanal(); } catch (e) { gefangen2 = e; } finally { falle2.loesen(); }
  assert.ok(gefangen2, 'baueEchtenKanal ist durchgekommen');
  assert.match(gefangen2.message, /NETZFALLE/);
});

test('EU-N6: die Netzbibliothek ist in diesem Testlauf nie geladen worden', () => {
  const geladen = Object.keys(require.cache).filter((k) => /googleapis|google-auth/.test(k));
  assert.deepEqual(geladen, [],
    'die Netzbibliothek ist geladen worden: ' + geladen.join(', '));
});

// ===========================================================================
// NACHWEIS 7: WAS DER MUTATIONSLAUF GEFUNDEN HAT
// ===========================================================================
//
// Der Mutationslauf ueber die zweiunddreissig Sicherungen dieses Auftrags hat
// FUENF gefunden, deren Ausbau nichts rot gemacht hat. Eine Sicherung, deren
// Ausbau nichts rot macht, ist keine -- sie steht da, sieht nach Sorgfalt aus
// und haelt nichts. Dieses Verfahren hat in EN, EP und ES je eine gefunden;
// hier waren es fuenf, und vier davon liegen an der gefaehrlichsten Stelle
// dieses Weges: NACH dem Aufruf.
//
// Die fuenf stehen hier, jede mit dem Schaden, den sie abwendet:
//
//   M3   Der Termin bleibt aus dem KOERPER. Ausgebaut fiel nichts auf: in der
//        Testlage steht nie einer im gelesenen Block, und wo einer steht,
//        bricht der Lauf vorher ab. Die zweite Sicherung deckte die erste zu.
//   M9   Der Vermerk steht VOR dem Aufruf. Ausgebaut fiel nichts auf, weil
//        der Fehlerzweig das Gedaechtnis ohnehin noch einmal schreibt -- und
//        genau der laeuft nicht, wenn der Prozess stirbt.
//   M19  Die Pruefung der ANTWORT. Meldet YouTube nach dem Update etwas
//        anderes als "public", muss ein Mensch sofort hinsehen.
//   M20  Der Vergleich Feld fuer Feld nach dem Aufruf. Er ist die einzige
//        Stelle, an der ein wirklich geloeschtes Feld im scharfen Lauf
//        sichtbar wuerde.
//   M33  Der Vergleich gegen den GELESENEN BLOCK statt gegen den gesendeten
//        Koerper. Diese Luecke habe ich beim Schreiben des Berichts selbst
//        gefunden, nicht der Mutationslauf: meldet YouTube eines Tages ein
//        SETZBARES Feld, das dieser Bau nicht kennt, wird es als "nur lesbar"
//        verworfen -- und geloescht. Ein Vergleich, der nur den Koerper kennt,
//        saehe davon nichts; das Feld ging ja nie hinaus.

test('EU-N7 (M3): der Termin bleibt aus dem Koerper, auch wenn er im gelesenen Block steht',
  () => {
    // Ohne diesen Test deckt die eine Sicherung die andere zu: der Arbeiter
    // bricht bei einem Termin im Block ab, also kommt baueStatusKoerper mit
    // einem Termin nie an die Reihe. Faellt der Abbruch eines Tages weg, ist
    // dies die Stelle, die den Termin trotzdem draussen haelt.
    const gebaut = K.baueStatusKoerper({
      videoId: DOPPEL_VIDEO,
      status: Object.assign({}, STATUS_MIT_ABWEICHUNGEN,
        { publishAt: '2099-01-01T00:00:00Z' }),
    });
    assert.equal(gebaut.ok, true);
    assert.equal(gebaut.termin.da, true, 'der Termin wird nicht einmal bemerkt');
    assert.equal(gebaut.termin.wert, '2099-01-01T00:00:00Z');
    // ER STEHT NICHT IM KOERPER -- weder als Feld noch irgendwo im JSON.
    assert.ok(!Object.prototype.hasOwnProperty.call(gebaut.koerper.status,
      K.STATUS_FELDER_NIE[0]), 'der Termin steht im Koerper');
    assert.ok(!JSON.stringify(gebaut.koerper).includes('2099'),
      'der Termin steht irgendwo im Koerper');
    // Und er ist auch nicht unter "verworfen" gelandet -- er ist SETZBAR und
    // wird trotzdem nie geschickt. Das ist der Unterschied zu uploadStatus.
    assert.ok(!gebaut.verworfen.includes(K.STATUS_FELDER_NIE[0]));
    assert.ok(K.STATUS_FELDER_SETZBAR.includes(K.STATUS_FELDER_NIE[0]),
      'der Termin gilt nicht als setzbar -- dann traegt die Liste nicht, worum es geht');
    // Die uebrigen Felder gehen unveraendert mit.
    assert.deepEqual(Object.keys(gebaut.koerper.status).sort(),
      K.STATUS_FELDER_UEBERTRAGEN.concat([K.STATUS_FELD_PRIVACY]).slice().sort());
  });

test('EU-N7 (M9): der Vermerk steht auf der PLATTE, bevor der Aufruf hinausgeht',
  async () => {
    // DER MUTATIONSLAUF HAT DIESE SICHERUNG GRUEN GEFUNDEN, und der Grund ist
    // lehrreich: der Fehlerzweig schreibt das Gedaechtnis ohnehin noch einmal,
    // also stand der Vermerk auch dann da, wenn er erst danach geschrieben
    // wurde. Nur laeuft dieser Zweig nicht, wenn der Prozess stirbt -- und
    // genau dafuer ist der Vermerk da.
    //
    // GEPRUEFT WIRD DARUM DER AUGENBLICK: die Attrappe liest das Gedaechtnis
    // VON DER PLATTE, waehrend der Aufruf laeuft.
    const l = lage('n7-m9');
    try {
      await bisZumPrivatenVideo(l);
      const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
      const befund = trocken(l);
      const e = schreibeZweiteErmaechtigung(l, befund);

      let beimAufruf = null;
      const kanal = doppelgaenger({ attrappe: yt });
      const echt = kanal.stelleOeffentlich;
      const aussen = Object.assign({}, kanal, {
        async stelleOeffentlich(a) {
          const p = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
          beimAufruf = JSON.parse(fs.readFileSync(p, 'utf8')).uploads[0];
          return echt(a);
        },
      });
      const r = await scharfDritt(l, befund, e.pfad, { kanal: aussen });
      assert.equal(r.code, L.EXIT_OK, r.fehler);

      assert.ok(beimAufruf, 'der dritte Aufruf ist nicht gemacht worden');
      assert.ok(beimAufruf.oeffentlich_versuch,
        'IM AUGENBLICK DES AUFRUFS STAND KEIN VERMERK AUF DER PLATTE. Stirbt der Prozess ' +
        'hier, sieht das Gedaechtnis aus wie "noch nicht angefangen" -- und der naechste ' +
        'Lauf macht ein zweites Update.');
      assert.equal(beimAufruf.oeffentlich_versuch.beendet, false);
      assert.ok(beimAufruf.oeffentlich_versuch.begonnen_am);
      // Der ganze Statusblock und der Koerper stehen schon darin.
      assert.deepEqual(beimAufruf.oeffentlich_versuch.status_gelesen, STATUS_MIT_ABWEICHUNGEN);
      assert.equal(beimAufruf.oeffentlich_versuch.koerper.status.privacyStatus, 'public');
      // Und der Stand war zu diesem Zeitpunkt noch nicht `oeffentlich`.
      assert.equal(beimAufruf.stand, 'thumbnail_gesetzt');
    } finally { l.weg(); }
  });

test('EU-N7 (M19): eine Antwort ungleich "public" bricht den Lauf LAUT ab', async () => {
  // Der eine Fall, in dem sofort ein Mensch hinsehen muss. Korrigieren kann
  // dieser Bau es nicht -- ein zweiter videos.update ist kein Teil dieses
  // Vertrags (2.5, 7).
  const l = lage('n7-m19');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);

    const kanal = doppelgaenger({ attrappe: yt });
    const echt = kanal.stelleOeffentlich;
    const aussen = Object.assign({}, kanal, {
      async stelleOeffentlich(a) {
        const antwort = await echt(a);
        // YouTube meldet etwas anderes zurueck, als es sollte.
        return Object.assign({}, antwort, {
          status: Object.assign({}, antwort.status, { privacyStatus: 'unlisted' }),
          privacyStatus: { da: true, wert: 'unlisted' },
        });
      },
    });
    const r = await scharfDritt(l, befund, e.pfad, { kanal: aussen });

    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.abbruch.code, 'antwort_nicht_oeffentlich');
    assert.ok(flach(r.fehler).includes('SOFORT IM STUDIO NACHSEHEN'), r.fehler);
    assert.ok(flach(r.fehler).includes('"unlisted"'), r.fehler);
    // DER AUFRUF IST TROTZDEM GEMACHT, und das Gedaechtnis sagt es: der Stand
    // ist `oeffentlich`, damit kein zweiter Lauf das Update wiederholt.
    const g = gedaechtnisVon(l).uploads[0];
    assert.equal(g.stand, 'oeffentlich');
    assert.equal(g.oeffentlich_privacystatus, 'unlisted');
    assert.equal(yt.aufrufe().filter((a) => a.was === 'videos.update').length, 1);
  } finally { l.weg(); }
});

test('EU-N7 (M19): fehlt der privacyStatus in der Antwort ganz, wird das GESAGT', async () => {
  const l = lage('n7-m19b');
  try {
    await bisZumPrivatenVideo(l);
    const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);

    const kanal = doppelgaenger({ attrappe: yt });
    const echt = kanal.stelleOeffentlich;
    const aussen = Object.assign({}, kanal, {
      async stelleOeffentlich(a) {
        const antwort = await echt(a);
        const ohne = Object.assign({}, antwort.status);
        delete ohne.privacyStatus;
        return Object.assign({}, antwort,
          { status: ohne, privacyStatus: { da: false, wert: null } });
      },
    });
    const r = await scharfDritt(l, befund, e.pfad, { kanal: aussen });

    assert.equal(r.code, L.EXIT_BEFUND);
    // ABWESEND IST NICHT "NEIN". Der Code sagt es, und die Meldung auch.
    assert.equal(r.abbruch.code, 'antwort_ohne_privacy');
    assert.ok(flach(r.fehler).includes('eine fehlende Auskunft'), r.fehler);
    assert.equal(gedaechtnisVon(l).uploads[0].oeffentlich_privacystatus, null);
  } finally { l.weg(); }
});

test('EU-N7 (M20/M33): ein Feld, das der gelesene Block trug und die Antwort nicht, ' +
  'faellt auf', async () => {
  // DER VERGLEICH LAEUFT GEGEN DEN GELESENEN BLOCK und nicht gegen den
  // gesendeten Koerper. Der Unterschied ist die Luecke:
  //
  //   Der Koerper traegt, was dieser Bau KENNT. Der gelesene Block traegt, was
  //   YouTube fuehrt. Meldet YouTube eines Tages ein SETZBARES Feld, das
  //   STATUS_FELDER_UEBERTRAGEN nicht kennt, wird es hier als "nur lesbar"
  //   verworfen -- und laut Dokumentation geloescht. Ein Vergleich, der nur
  //   den Koerper kennt, saehe davon nichts: das Feld ging ja nie hinaus.
  //
  // Genau dieser Fall wird hier gestellt: ein unbekanntes Feld im Block, das
  // die Antwort nicht mehr traegt.
  const l = lage('n7-m20');
  try {
    await bisZumPrivatenVideo(l);
    const mitUnbekanntem = Object.assign({}, STATUS_MIT_ABWEICHUNGEN,
      { einNeuesSetzbaresFeld: 'ein Wert, den niemand verlieren will' });
    const yt = youtubeAttrappe(mitUnbekanntem);
    const befund = trocken(l);
    const e = schreibeZweiteErmaechtigung(l, befund);

    const kanal = doppelgaenger({ attrappe: yt });
    const echt = kanal.stelleOeffentlich;
    const aussen = Object.assign({}, kanal, {
      async stelleOeffentlich(a) {
        const antwort = await echt(a);
        const ohne = Object.assign({}, antwort.status);
        delete ohne.einNeuesSetzbaresFeld;   // YouTube hat es geloescht
        return Object.assign({}, antwort, { status: ohne });
      },
    });
    const r = await scharfDritt(l, befund, e.pfad, { kanal: aussen });

    assert.equal(r.code, L.EXIT_BEFUND);
    assert.equal(r.abbruch.code, 'felder_verloren');
    const satz = flach(r.fehler);
    assert.ok(satz.includes('einNeuesSetzbaresFeld'), satz);
    assert.ok(satz.includes('steht in der Antwort NICHT MEHR'), satz);
    // UND DIE MELDUNG SAGT, WAS ZU TUN IST: das Feld gehoert in die Liste der
    // uebertragbaren, wenn es in Wahrheit setzbar ist.
    assert.ok(satz.includes('STATUS_FELDER_UEBERTRAGEN'), satz);
    // Es steht auch im Gedaechtnis -- eine Meldung, die nur auf dem Schirm
    // stand, ist am naechsten Tag weg.
    const g = gedaechtnisVon(l).uploads[0];
    assert.equal(g.stand, 'oeffentlich');
    assert.equal(g.oeffentlich_abweichungen.length, 1);
    assert.ok(g.oeffentlich_abweichungen[0].includes('einNeuesSetzbaresFeld'));
  } finally { l.weg(); }
});

test('EU-N7 (M20): ein uebertragenes Feld, das ANDERS zurueckkommt, faellt ebenfalls auf',
  async () => {
    const l = lage('n7-m20b');
    try {
      await bisZumPrivatenVideo(l);
      const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
      const befund = trocken(l);
      const e = schreibeZweiteErmaechtigung(l, befund);

      const kanal = doppelgaenger({ attrappe: yt });
      const echt = kanal.stelleOeffentlich;
      const aussen = Object.assign({}, kanal, {
        async stelleOeffentlich(a) {
          const antwort = await echt(a);
          return Object.assign({}, antwort, {
            status: Object.assign({}, antwort.status, { license: 'youtube' }),
          });
        },
      });
      const r = await scharfDritt(l, befund, e.pfad, { kanal: aussen });

      assert.equal(r.code, L.EXIT_BEFUND);
      assert.equal(r.abbruch.code, 'felder_verloren');
      const satz = flach(r.fehler);
      assert.ok(satz.includes('license'), satz);
      assert.ok(satz.includes('"creativeCommon"') && satz.includes('"youtube"'), satz);
    } finally { l.weg(); }
  });

test('EU-N7 (M20): ein NUR LESBARES Feld, das sich aendert, ist ein Hinweis und kein Abbruch',
  async () => {
    // DIE ANDERE SEITE DERSELBEN SICHERUNG. uploadStatus darf sich zwischen
    // zwei Aufrufen aendern -- das ist YouTubes Sache und kein Verlust. Ein
    // Bau, der auch das laut abbraeche, waere einer, der beim ersten echten
    // Lauf aus dem falschen Grund stehenbliebe.
    const l = lage('n7-m20c');
    try {
      await bisZumPrivatenVideo(l);
      const yt = youtubeAttrappe(STATUS_MIT_ABWEICHUNGEN);
      const befund = trocken(l);
      const e = schreibeZweiteErmaechtigung(l, befund);

      const kanal = doppelgaenger({ attrappe: yt });
      const echt = kanal.stelleOeffentlich;
      const aussen = Object.assign({}, kanal, {
        async stelleOeffentlich(a) {
          const antwort = await echt(a);
          return Object.assign({}, antwort, {
            status: Object.assign({}, antwort.status, { uploadStatus: 'uploaded' }),
          });
        },
      });
      const r = await scharfDritt(l, befund, e.pfad, { kanal: aussen });

      assert.equal(r.code, L.EXIT_OK, r.fehler);
      const g = gedaechtnisVon(l).uploads[0];
      assert.deepEqual(g.oeffentlich_abweichungen, []);
      assert.equal(g.oeffentlich_hinweise.length, 1);
      assert.ok(g.oeffentlich_hinweise[0].includes('uploadStatus'));
      assert.ok(g.oeffentlich_hinweise[0].includes('nur lesbare'));
      // Und der Hinweis steht auch auf dem Schirm.
      assert.ok(flach(r.aus).includes('Hinweis: Das nur lesbare Feld uploadStatus'), r.aus);
    } finally { l.weg(); }
  });


test('EU-N7 (M22): neueZweiteErmaechtigung schreibt keinen Zweck, den niemand einloest', () => {
  // DER MUTATIONSLAUF HAT DIESE SICHERUNG GRUEN GEFUNDEN. Sie steht an der
  // Stelle, an der eine Ermaechtigung ENTSTEHT -- und eine mit einem Zweck,
  // den kein Zweig annimmt, waere eine Datei, die herumliegt und nie
  // verbraucht wird. Schlimmer: waere der Zweck ein Tippfehler von
  // 'veroeffentlichen', faellt das erst dem Arbeiter auf, und der Mensch hat
  // schon geklickt.
  const felder = {
    aufnahme: AUFNAHME, videoSha256: 'a'.repeat(64), videoId: DOPPEL_VIDEO,
    urteil: { titel: TITEL, beschreibung_sha256: 'b'.repeat(64),
      thumbnail: { dateiname: 'x.jpg', sha256: 'c'.repeat(64) } },
    kanalId: DOPPEL_KANAL_ID, kanalName: DOPPEL_KANAL_NAME,
    zufall: 'd'.repeat(64), jetzt: Date.now(),
  };
  for (const zweck of [G.ZWECK_UPLOAD, 'veroeffentlichn', '', null, undefined, 'upload2']) {
    assert.throws(() => G.neueZweiteErmaechtigung(Object.assign({}, felder, { zweck })),
      /Zweck/, 'der Zweck ' + JSON.stringify(zweck) + ' wird angenommen');
  }
  // Die beiden zulaessigen gehen durch, und der Zweck steht in der Datei.
  for (const zweck of G.ZWECKE_DRITTER_AUFRUF) {
    const d = G.neueZweiteErmaechtigung(Object.assign({}, felder, { zweck }));
    assert.equal(d.zweck, zweck);
    assert.equal(d.artifact_type, G.ERMAECHTIGUNG_ARTIFACT_TYPE);
    // Und das `warum` sagt, was dieser Zweck bewirkt -- die beiden Texte sind
    // verschieden, denn die beiden Laeufe sind es.
    assert.ok(d.warum.length > 200);
  }
  const halt = G.neueZweiteErmaechtigung(
    Object.assign({}, felder, { zweck: G.ZWECK_HALTEPUNKT }));
  const echt = G.neueZweiteErmaechtigung(
    Object.assign({}, felder, { zweck: G.ZWECK_VEROEFFENTLICHEN }));
  assert.notEqual(halt.warum, echt.warum,
    'die beiden Zwecke tragen denselben Satz -- dann sagt er nichts');
  assert.ok(halt.warum.includes('stellt NICHTS oeffentlich'), halt.warum);
  assert.ok(echt.warum.includes('laesst sich nicht zuruecknehmen'), echt.warum);
});

test('EU-N7 (M25): POST /veroeffentlichen prueft SERVERSEITIG, ob es einen Knopf gibt',
  async () => {
    // DER MUTATIONSLAUF HAT DIESE SICHERUNG GRUEN GEFUNDEN: der Test darueber
    // liest den Quelltext, und ein Quelltexttest merkt nicht, ob die Zeile
    // WIRKT. Dieser hier schickt eine echte Anfrage.
    //
    // Der Browser sperrt die Knoepfe zusaetzlich, aber das ist Bequemlichkeit.
    // Diese Zeile ist die Zusage: eine Anfrage, die den Browser umgeht, faellt
    // hier -- und nur hier.
    //
    // DIE SITZUNG LAEUFT AUF DER ECHTEN PROJEKTWURZEL. Anders ginge es nicht:
    // fremdeWurzel() faengt eine Wegwerfwurzel schon vorher ab. Damit dabei
    // nichts Echtes entstehen kann, ist waehrend der Anfrage JEDER Schreibweg
    // des Dateisystems scharfgestellt -- kaeme die Anfrage durch, schriebe sie
    // nicht, sondern fiele in die Falle.
    const trockenErfunden = {
      befehl: 'node src/upload/longform-arbeiter.js --aufnahme="' + AUFNAHME + '"',
      code: 0, fehler: null, aus: 'VORSCHAU', err: '',
      befund: null,          // KEINE Befundzeile -> keine zweite Bindung -> kein Knopf
    };
    const sitzung = S.baueLongformSitzung({
      aufnahme: AUFNAHME, projektwurzel: WURZEL, port: 0, trocken: trockenErfunden,
    });
    assert.equal(sitzung.zweiteBindung.moeglich, false,
      'diese Sitzung traegt eine zweite Bindung');
    assert.equal(S.longformDritterKnopfDa(sitzung).da, false);

    const dienst = S.baueDienst(sitzung);
    await new Promise((f) => dienst.listen(0, S.HOST, f));
    sitzung.port = dienst.address().port;

    const schreibend = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync',
      'unlinkSync', 'rmSync', 'copyFileSync', 'createWriteStream', 'writeSync'];
    const echt = {};
    const beruehrt = [];
    const antworten = {};
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

      // BEIDE Routen, nicht nur eine: die gefaehrliche ist die zweite, und ein
      // Test, der nur die erste faehrt, deckt sie nicht.
      for (const route of ['/haltepunkt', '/veroeffentlichen']) {
        // eslint-disable-next-line no-await-in-loop
        antworten[route] = await new Promise((fertig, schief) => {
          const req = require('node:http').request({
            host: S.HOST, port: sitzung.port, method: 'POST', path: route,
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
      }
    } finally {
      for (const name of Object.keys(echt)) fs[name] = echt[name];
      await new Promise((f) => dienst.close(f));
    }

    for (const route of ['/haltepunkt', '/veroeffentlichen']) {
      const a = antworten[route];
      assert.equal(a.status, 409, 'POST ' + route + ' antwortet mit ' + a.status +
        ' statt 409 -- ohne Bindung darf es keinen Knopf geben. Leib: ' + a.text);
      assert.ok(a.text.includes('kein_knopf'), a.text);
      assert.ok(a.text.includes('keine Ermaechtigung ausgestellt'), a.text);
    }
    assert.deepEqual(beruehrt, [],
      'eine der Routen hat geschrieben, obwohl es keinen Knopf gab: ' + beruehrt.join(', '));
  });

test('EU-N7 (M25): und die Knoepfe sind auch zu, solange ein Lauf laeuft oder gelaufen ist',
  () => {
    // Die uebrigen Zweige derselben Zusage. Die Route oben faehrt nur einen.
    const bindung = { moeglich: true, aufnahme: AUFNAHME, video_sha256: 'a'.repeat(64),
      videoId: DOPPEL_VIDEO,
      urteil: { titel: TITEL, beschreibung_sha256: 'b'.repeat(64),
        thumbnail: { dateiname: 'x.jpg', sha256: 'c'.repeat(64) } } };
    const kanal = { ok: true, id: DOPPEL_KANAL_ID, name: DOPPEL_KANAL_NAME };

    const laeuft = S.longformDritterKnopfDa({ lauf: { laeuft: true },
      zweiteBindung: bindung, kanal });
    assert.equal(laeuft.da, false);
    assert.ok(laeuft.grund.includes('Zwei gleichzeitig gibt es nicht'));

    const fertig = S.longformDritterKnopfDa({ lauf: { laeuft: false, ende: { code: 0 } },
      zweiteBindung: bindung, kanal });
    assert.equal(fertig.da, false);
    assert.ok(fertig.grund.includes('neuen Start des Dienstes'),
      'es wird nicht gesagt, wie ein zweiter Lauf zustande kaeme');
    assert.ok(fertig.grund.includes('veralteten Frage'),
      'der Grund fehlt: eine Ermaechtigung auf einer alten Frage bezeugte nichts');

    const ohneKanal = S.longformDritterKnopfDa({ lauf: null, zweiteBindung: bindung,
      kanal: { ok: false, grund: 'data/inventory.json fehlt.' } });
    assert.equal(ohneKanal.da, false);
    assert.ok(ohneKanal.grund.includes('nicht sagt, WO'),
      'ein Knopf ohne Kanalnamen wird nicht als das benannt, was er ist');

    const ohneBindung = S.longformDritterKnopfDa({ lauf: null,
      zweiteBindung: { moeglich: false, grund: 'kein Video oben.' }, kanal });
    assert.equal(ohneBindung.da, false);
    assert.ok(ohneBindung.grund.includes('kein Video oben'));

    const offen = S.longformDritterKnopfDa({ lauf: null, zweiteBindung: bindung, kanal });
    assert.equal(offen.da, true, offen.grund);

    // Und die vier Gruende sind verschieden -- zwei Lagen unter einem Satz
    // sind der Umriss jedes Fehlers dieser Reihe.
    const saetze = [laeuft.grund, fertig.grund, ohneKanal.grund, ohneBindung.grund];
    assert.equal(new Set(saetze).size, 4, 'zwei Gruende teilen sich einen Satz');
  });

test('EU-N7 (M28/M31): die Frage sperrt, wenn YouTube ablehnt oder das Video nicht ' +
  'mehr privat ist', async () => {
  // BEIDE SICHERUNGEN HAT DER MUTATIONSLAUF GRUEN GEFUNDEN, und beide sitzen
  // eine Stufe VOR dem scharfen Lauf: der Arbeiter faengt dieselben Lagen
  // spaeter noch einmal -- aber dann hat ein Mensch schon geklickt. Die Frage
  // ist die Stelle, an der er es nicht tun soll.
  //
  // Geprueft wird an einem Gedaechtnis, in dem die Rueckleseantwort die
  // betreffende Lage traegt. Das ist kein Kunstgriff: genau so kaeme sie aus
  // Schritt 13.
  const faelle = [
    ['abgelehnt', { uploadStatus: 'rejected', privacyStatus: 'private' }, null,
      'YOUTUBE MELDET uploadStatus "rejected"'],
    ['fehlgeschlagen', { uploadStatus: 'processed', privacyStatus: 'private' },
      { processingStatus: 'failed' }, 'YOUTUBE MELDET processingStatus "failed"'],
    ['terminiert', { uploadStatus: 'processed', privacyStatus: 'private' },
      { processingStatus: 'terminated' }, 'YOUTUBE MELDET processingStatus "terminated"'],
    ['schon oeffentlich', { uploadStatus: 'processed', privacyStatus: 'public' }, null,
      'DIE SICHTBARKEIT IST SCHON "public"'],
    ['ohne Sichtbarkeit', { uploadStatus: 'processed' }, null,
      'nennt keinen privacyStatus'],
  ];
  for (const [marke, status, pd, satzteil] of faelle) {
    const l = lage('n7-frage-' + marke.replace(/ /g, '-'));
    try {
      // eslint-disable-next-line no-await-in-loop
      await bisZumPrivatenVideo(l);
      const p = G.gedaechtnisPfad(l.wurzel, AUFNAHME);
      const g = JSON.parse(fs.readFileSync(p, 'utf8'));
      g.uploads[0].rueckgelesen.status = status;
      if (pd) g.uploads[0].rueckgelesen.processingDetails = pd;
      g.uploads[0].verarbeitung = null;      // sonst deckt der aeltere Stand den neuen zu
      fs.writeFileSync(p, JSON.stringify(g, null, 2));

      const befund = trocken(l);
      const f = befund.frage;
      assert.equal(f.moeglich, true, marke + ': die Frage steht gar nicht an');
      const saetze = f.auffaelligkeiten.map((a) => a.schwere + ' ' + a.satz).join(' | ');
      if (marke === 'ohne Sichtbarkeit') {
        // Eine fehlende Auskunft ist KEIN Nein -- aber sie wird gesagt.
        assert.ok(saetze.includes(satzteil), marke + ': ' + saetze);
        assert.equal(f.sperrend, 0, marke + ': eine fehlende Auskunft sperrt');
      } else {
        assert.ok(f.sperrend >= 1, marke + ': nichts sperrt -- ' + saetze);
        assert.ok(saetze.includes(satzteil), marke + ': ' + saetze);
        assert.equal(L.zweiteBindungsZeile(befund).moeglich, false,
          marke + ': es gibt trotzdem einen Knopf');
      }
    } finally { l.weg(); }
  }
});

// ===========================================================================
// NACHWEIS 8: DIE SHORTS-LINIE IST UNVERAENDERT
// ===========================================================================

const STAND_VOR_EU = '94d5ab2';

function ausGit(datei) {
  const g = spawnSync('git', ['show', STAND_VOR_EU + ':' + datei],
    { cwd: WURZEL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (g.error || g.status !== 0) return null;
  return g.stdout;
}

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

test('EU-N8: die ausgelieferte Shorts-Seite ist Byte fuer Byte die von ' + STAND_VOR_EU, () => {
  const alt = ausGit('src/upload/freigabe-seite.js');
  if (alt === null) {
    assert.fail('Der Stand ' + STAND_VOR_EU + ' ist aus git nicht zu holen. Dieser Test ' +
      'kann so nicht laufen, und er wird nicht als bestanden gezaehlt.');
  }
  const ordner = wegwerfordner('n8');
  try {
    const altDatei = path.join(ordner, 'freigabe-seite-alt.cjs');
    fs.writeFileSync(altDatei, alt);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const ALT = require(altDatei);

    const sitzung = shortsSitzungFuerVergleich(ordner);
    const vorher = Buffer.from(ALT.baueSeite(sitzung), 'utf8');
    const nachher = Buffer.from(SEITE.baueSeite(sitzung), 'utf8');

    assert.equal(nachher.length, vorher.length,
      'die Shorts-Seite ist ' + nachher.length + ' Bytes gross, vor EU waren es ' +
      vorher.length);
    if (!nachher.equals(vorher)) {
      let i = 0;
      while (i < vorher.length && vorher[i] === nachher[i]) i++;
      assert.fail('Die Shorts-Seite weicht ab Byte ' + i + ' ab.\n' +
        '  vorher:  ' + JSON.stringify(vorher.toString('utf8', Math.max(0, i - 60), i + 60)) +
        '\n  nachher: ' + JSON.stringify(nachher.toString('utf8', Math.max(0, i - 60),
          i + 60)));
    }

    // GEGENPROBE: der Vergleich muss zuschnappen.
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

test('EU-N8: der Shorts-Uploader und seine Nachbarn sind unberuehrt', () => {
  const unberuehrt = [
    'src/upload/uploader.js',
    'src/upload/planer.js',
    'src/upload/uebergabe-leser.js',
    'src/upload/zettel-leser.js',
    'src/upload/uebersicht.js',
    'src/publish/cli-args.js',
    'src/youtube/auth.js',
  ];
  const g = spawnSync('git', ['diff', '--name-only', STAND_VOR_EU, '--'].concat(unberuehrt),
    { cwd: WURZEL, encoding: 'utf8' });
  if (g.error || g.status !== 0) {
    assert.fail('git diff gegen ' + STAND_VOR_EU + ' ist nicht gelaufen. Dieser Test wird ' +
      'nicht als bestanden gezaehlt.');
  }
  const geaendert = g.stdout.split('\n').map((z) => z.trim()).filter(Boolean);
  assert.deepEqual(geaendert, [],
    'die Shorts-Linie ist angefasst worden: ' + geaendert.join(', '));

  // GEGENPROBE: derselbe Aufruf auf eine Datei, die sich SEHR WOHL geaendert
  // hat. Zeigt er dort auch nichts, prueft er nichts.
  const g2 = spawnSync('git', ['diff', '--name-only', STAND_VOR_EU, '--',
    'src/upload/longform-arbeiter.js'], { cwd: WURZEL, encoding: 'utf8' });
  assert.equal(g2.status, 0);
  assert.equal(g2.stdout.trim(), 'src/upload/longform-arbeiter.js',
    'der Vergleich sieht nicht einmal die Datei, die dieser Auftrag umgebaut hat');
});

test('EU-N8: der Shorts-Modus des Dienstes hat dieselben Routen wie vor EU', () => {
  const quelle = fs.readFileSync(path.join(WURZEL, 'src/upload/freigabe-server.js'), 'utf8');
  assert.ok(quelle.includes(
    "[MODUS_SHORTS]: new Set(['/', '/video', '/stand', '/kette', '/lauf']),"),
  'die GET-Routen des Shorts-Modus haben sich geaendert');
  assert.ok(quelle.includes(
    "[MODUS_SHORTS]: new Set(['/urteil', '/beenden', '/planen', '/archivieren', " +
    "'/hochladen']),"),
  'die POST-Routen des Shorts-Modus haben sich geaendert');
  // Der Shorts-Uploader hat den dritten Aufruf nicht -- und bekommt ihn nicht.
  const uploader = fs.readFileSync(path.join(WURZEL, 'src/upload/uploader.js'), 'utf8');
  assert.ok(!uploader.includes('videos.update('),
    'der Shorts-Uploader ruft videos.update');
});
