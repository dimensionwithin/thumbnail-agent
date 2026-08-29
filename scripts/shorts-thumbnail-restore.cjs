'use strict';

// CV Nachlauf: setzt ein Testvideo auf sein Ausgangsbild zurueck.
//
// WICHTIG und keine Formalie: thumbnails.set kann ein Thumbnail NICHT auf
// "automatisch" zuruecksetzen. Wiederherstellen heisst hier: das urspruengliche
// BILD erneut als Custom-Thumbnail setzen. Sichtbar ist das Ergebnis identisch,
// technisch bleibt es ein Custom-Thumbnail.
//
// Das geht nur, wenn das Ausgangsbild noch existiert. Bei einem Video, dessen
// Thumbnail YouTube automatisch aus einem Einzelbild erzeugt hatte, liegt es
// weiter unter i.ytimg.com/vi/<id>/maxres{1,2,3}.jpg -- diese drei Einzelbilder
// ueberschreibt ein Custom-Thumbnail NICHT. Bei einem Video, das vorher ein
// selbst hochgeladenes Thumbnail trug, ist das Original nach dem Ueberschreiben
// NICHT mehr von YouTube zu holen.
//
// Aufruf: node scripts/shorts-thumbnail-restore.cjs <short|normal> <bilddatei>

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
pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'scripts/shorts-thumbnail-restore.cjs');
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


async function main() {
  const welches = (POSITIONAL[0] || '').toLowerCase();
  const bild = POSITIONAL[1];
  if (!['short', 'normal'].includes(welches) || !bild) {
    throw new Error('Aufruf: node scripts/shorts-thumbnail-restore.cjs <short|normal> <bilddatei>');
  }
  const id = welches === 'short' ? process.env.SHORTS_TEST_VIDEO_ID : process.env.NORMAL_TEST_VIDEO_ID;
  if (!id) throw new Error('videoId fehlt in der .env.');
  if (!fs.existsSync(bild)) throw new Error(`Bilddatei nicht gefunden: ${bild}`);

  if (NUR_PRUEFEN) {
    console.log(`TROCKENLAUF (${TROCKENLAUF_FLAG}): kein Netzaufruf, nichts gesetzt.`);
    console.log(`  wuerde setzen: ${path.basename(bild)} (${fs.statSync(bild).size} B) auf das ${welches}-Testvideo`);
    return;
  }

  await sperrpruefung(id);
  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });
  const r = await yt.thumbnails.set({
    videoId: id,
    media: { mimeType: 'image/jpeg', body: fs.createReadStream(bild) },
  });
  console.log(`${welches}: HTTP ${r.status} -- ${path.basename(bild)} (${fs.statSync(bild).size} B) gesetzt.`);
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
