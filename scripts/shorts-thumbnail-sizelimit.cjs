'use strict';

// CV Zusatz: Wo genau liegt die Dateigroessen-Obergrenze von thumbnails.set?
//
// Die API-Doku nennt 2 MB, YouTube Studio erlaubt laut Hilfeseite 50 MB. Z4 der
// Matrix scheiterte mit reason=invalidImage -- das ist KEIN eindeutiger
// Groessenfehler, es koennte auch an den Massen 2160x3840 liegen. Diese Leiter
// trennt beides:
//   S1  hat die grossen MASSE, aber eine kleine Datei -> faellt sie durch,
//       liegt es am Mass, nicht an der Groesse.
//   S2..S7 halten das Mass fest (1080x1920) und steigern nur die Dateigroesse.
//
// Schreibt auf das Short-Testvideo aus der .env, dessen Thumbnail zu diesem
// Zeitpunkt ohnehin schon gesetzt ist. Kontingent: 50 Einheiten je Aufruf.

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
pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'scripts/shorts-thumbnail-sizelimit.cjs');
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
const PAUSE_MS = 20_000;
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const id = process.env.SHORTS_TEST_VIDEO_ID;
  if (!id) throw new Error('SHORTS_TEST_VIDEO_ID fehlt in der .env.');

  // Welche Leiter gefahren wird: groessenleiter.json (grob) oder grenzleiter.json
  // (das enge Paar um 2 MiB). Default ist die grobe.
  const leiterDatei = POSITIONAL[0] || 'groessenleiter.json';
  const leiter = JSON.parse(fs.readFileSync(path.join(OUT, leiterDatei), 'utf8'))
    .sort((a, b) => a.bytes - b.bytes);
  console.log(`Leiter: ${leiterDatei} (${leiter.length} Stufen)\n`);
  if (NUR_PRUEFEN) {
    console.log(`TROCKENLAUF (${TROCKENLAUF_FLAG}): kein Netzaufruf, nichts gesetzt.`);
    for (const b of leiter) console.log(`  wuerde setzen: ${b.datei} ${b.breite}x${b.hoehe} ${b.mb} MB`);
    return;
  }

  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });
  const ergebnisse = [];

  for (let i = 0; i < leiter.length; i++) {
    const b = leiter[i];
    const eintrag = { ...b };
    try {
      await sperrpruefung(id);
      const r = await yt.thumbnails.set({
        videoId: id,
        media: { mimeType: 'image/jpeg', body: fs.createReadStream(path.join(OUT, b.datei)) },
      });
      eintrag.httpStatus = r.status;
      eintrag.erfolg = true;
    } catch (err) {
      eintrag.erfolg = false;
      eintrag.httpStatus = (err.response && err.response.status) || err.code || null;
      const d = err.response && err.response.data;
      if (d) {
        eintrag.fehlerkoerper = d;
        eintrag.reasons = ((d.error && d.error.errors) || []).map((x) => x.reason);
        eintrag.meldung = d.error && d.error.message;
      } else {
        eintrag.meldung = err.message;
      }
    }
    ergebnisse.push(eintrag);
    console.log(
      `${b.datei.padEnd(8)} ${b.breite}x${String(b.hoehe).padEnd(5)} ${String(b.mb).padStart(6)} MB -> ` +
      `${eintrag.erfolg ? 'OK   ' : 'FEHL '} HTTP ${eintrag.httpStatus} ${eintrag.reasons ? eintrag.reasons.join(',') : ''}`
    );
    if (i < leiter.length - 1) await schlaf(PAUSE_MS);
  }

  fs.writeFileSync(
    path.join(OUT, leiterDatei.replace('.json', '-ergebnis.json')),
    JSON.stringify({ zeit: new Date().toISOString(), leiter: leiterDatei, ergebnisse }, null, 2)
  );

  const ok = ergebnisse.filter((e) => e.erfolg);
  const fehl = ergebnisse.filter((e) => !e.erfolg);
  console.log('\n--- Grenze ---');
  console.log(`groesste angenommene Datei: ${ok.length ? ok[ok.length - 1].mb + ' MB (' + ok[ok.length - 1].datei + ')' : 'keine'}`);
  console.log(`kleinste abgelehnte Datei:  ${fehl.length ? fehl[0].mb + ' MB (' + fehl[0].datei + ')' : 'keine'}`);
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
