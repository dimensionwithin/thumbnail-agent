'use strict';

// CV Phase 3: die Setz-Matrix. Vier Zellen, jede einzeln, mit vollstaendiger
// Fehlerausgabe. Bei Fehlern wird NICHT abgebrochen -- gerade die Fehlergruende
// trennen die Faelle voneinander:
//
//   Z1: T1 (16:9) auf das Short         -> trennt "Short wird abgelehnt" ab
//   Z2: T2 (9:16) auf das Normalvideo   -> trennt "Format wird abgelehnt" ab
//   Z3: T2 (9:16) auf das Short         -> der eigentliche Zielfall
//   Z4: T3 (9:16, 4,3 MB) auf das Short -> Groessenlimit der API
//
// ACHTUNG Reihenfolge: Z3 und Z4 schreiben auf dasselbe Video. Gelingen beide,
// steht am Ende T3. Das ist eingeplant und im Bericht vermerkt.
//
// thumbnails.set kostet 50 Kontingenteinheiten je Aufruf -> 200 fuer den Lauf.
// videoIds kommen ausschliesslich aus der .env (gitignored).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('../src/youtube/auth.js');

// CX: Short-Sperre. Dieses Werkzeug ist zwar dafuer gebaut, auf einem Short zu
// messen -- aber genau deshalb darf es nicht versehentlich auf einem beliebigen
// Video laufen. Ohne --erlaube-short wird gesperrt; mit dem Flag ist es eine
// bewusste Entscheidung und wird laut protokolliert.
const { pruefeArgumenteStrikt, TROCKENLAUF_FLAG } = require('../src/publish/cli-args');

// CY: Jedes Argument, das hier nicht steht, bricht ab (Exit 2) -- VOR jedem
// Netzaufruf. Ursache: in CX wurde ein erfundenes Flag stillschweigend ignoriert
// und ein als Pruefung gemeinter Aufruf lief scharf.
const ERLAUBTE_ARGUMENTE = [TROCKENLAUF_FLAG, '--erlaube-short'];
pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'scripts/shorts-thumbnail-matrix.cjs');
const NUR_PRUEFEN = process.argv.includes(TROCKENLAUF_FLAG);
// Freie Argumente ohne die Flags -- sonst wird '--nur-pruefen' als Dateiname gelesen.
const POSITIONAL = process.argv.slice(2).filter((t) => !t.startsWith('-'));

const { darfThumbnailGesetztWerden } = require('../src/publish/short-guard');
const ERLAUBE_SHORT = process.argv.includes('--erlaube-short');

async function sperrpruefung(videoId) {
  const e = await darfThumbnailGesetztWerden(videoId);
  if (e.erlaubt) return;
  if (ERLAUBE_SHORT) {
    console.warn(`  !! SHORT-SPERRE UEBERGANGEN (--erlaube-short): ${e.grund}`);
    return;
  }
  throw new Error(`Short-Sperre (${e.status}): ${e.grund}  [zum bewussten Uebergehen: --erlaube-short]`);
}


const OUT = path.join('data', 'shorts-thumbnail-api-test');
const PAUSE_MS = 60_000;

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function setze(yt, zelle, videoId, bildDatei) {
  const pfad = path.join(OUT, bildDatei);
  const bytes = fs.statSync(pfad).size;
  const start = Date.now();
  const eintrag = { zelle: zelle.name, ziel: zelle.ziel, bild: bildDatei, bytes, beschreibung: zelle.was };
  try {
    await sperrpruefung(videoId);
    const r = await yt.thumbnails.set({
      videoId,
      media: { mimeType: 'image/jpeg', body: fs.createReadStream(pfad) },
    });
    eintrag.httpStatus = r.status;
    eintrag.erfolg = true;
    eintrag.antwort = r.data;
  } catch (e) {
    eintrag.erfolg = false;
    eintrag.httpStatus = (e.response && e.response.status) || e.code || null;
    eintrag.meldung = e.message;
    // Vollstaendiger Fehlerkoerper -- reason/domain sind das, was die Faelle trennt.
    const d = e.response && e.response.data;
    if (d) {
      eintrag.fehlerkoerper = d;
      const err = d.error || {};
      eintrag.fehlerDetails = (err.errors || []).map((x) => ({
        reason: x.reason, domain: x.domain, message: x.message,
      }));
      eintrag.fehlerStatus = err.status;
    }
  }
  eintrag.dauerMs = Date.now() - start;
  return eintrag;
}

async function main() {
  const shortId = process.env.SHORTS_TEST_VIDEO_ID;
  const normalId = process.env.NORMAL_TEST_VIDEO_ID;
  if (!shortId || !normalId) throw new Error('Test-videoIds fehlen in der .env.');

  const zellen = [
    { name: 'Z1', ziel: 'Short-Testvideo',  id: shortId,  bild: 'T1.jpg', was: '16:9 auf ein Short -- wird das Short als solches abgelehnt?' },
    { name: 'Z2', ziel: 'Normal-Testvideo', id: normalId, bild: 'T2.jpg', was: '9:16 auf ein Querformatvideo -- wird das Format abgelehnt?' },
    { name: 'Z3', ziel: 'Short-Testvideo',  id: shortId,  bild: 'T2.jpg', was: '9:16 auf ein Short -- der Zielfall' },
    { name: 'Z4', ziel: 'Short-Testvideo',  id: shortId,  bild: 'T3.jpg', was: '9:16 in voller Studio-Vorgabe (4,3 MB) -- Groessenlimit' },
  ];

  if (NUR_PRUEFEN) {
    console.log(`TROCKENLAUF (${TROCKENLAUF_FLAG}): kein Netzaufruf, nichts gesetzt.`);
    for (const z of zellen) console.log(`  wuerde ${z.name}: ${z.bild} -> ${z.ziel}`);
    return;
  }

  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });

  const ergebnisse = [];
  for (let i = 0; i < zellen.length; i++) {
    const z = zellen[i];
    console.log(`\n--- ${z.name}: ${z.bild} -> ${z.ziel} ---`);
    const e = await setze(yt, z, z.id, z.bild);
    ergebnisse.push(e);
    console.log(`  ${e.erfolg ? 'ERFOLG' : 'FEHLER'}  HTTP ${e.httpStatus}  ${e.dauerMs} ms`);
    if (!e.erfolg) {
      console.log(`  Meldung: ${e.meldung}`);
      for (const d of e.fehlerDetails || []) {
        console.log(`  reason=${d.reason} domain=${d.domain}`);
        console.log(`  message=${d.message}`);
      }
    }
    if (i < zellen.length - 1) {
      console.log(`  ... ${PAUSE_MS / 1000}s Pause`);
      await schlaf(PAUSE_MS);
    }
  }

  const datei = path.join(OUT, 'matrix.json');
  fs.writeFileSync(datei, JSON.stringify({ zeit: new Date().toISOString(), ergebnisse }, null, 2));
  console.log(`\n=== ZUSAMMENFASSUNG ===`);
  for (const e of ergebnisse) {
    console.log(`${e.zelle}  ${e.erfolg ? 'ERFOLG' : 'FEHLER'}  HTTP ${e.httpStatus}  ${e.erfolg ? '' : (e.fehlerDetails || []).map((d) => d.reason).join(',')}`);
  }
  console.log(`geschrieben: ${datei}`);
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
