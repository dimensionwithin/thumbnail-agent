'use strict';

// CX Teil D.1: Taugt die oardefault-Sonde als Short-Erkennung?
//
// Die Frage ist NICHT "gibt es oardefault bei Shorts", sondern die Gegenrichtung:
// gibt es oardefault AUCH bei normalen Querformat-Videos? Nur wenn nein, ist die
// Sonde trennscharf und als Sperre brauchbar.
//
// Grundwahrheit kommt NICHT aus der Sonde selbst (das waere zirkulaer), sondern
// aus den echten Videomassen in ytInitialPlayerResponse.streamingData der
// Watch-Seite. Dieser Weg ist in CW gemessen worden und funktioniert: /watch?v=
// liefert HTTP 200 ohne Zustimmungs-Weiterleitung (anders als /shorts/<id>).
//
// Nur lesend. videoIds landen ausschliesslich in data/gating-repair/ (gitignored).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('../src/youtube/auth.js');
const sync = require('../src/youtube/sync-livestream-archive.js');

const OUT = path.join('data', 'gating-repair');
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function sonde(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve({ code: res.statusCode, bytes: n }));
    });
    req.setTimeout(10000, () => { req.destroy(); resolve({ code: 'timeout', bytes: 0 }); });
    req.on('error', () => resolve({ code: 'error', bytes: 0 }));
  });
}

// Echte Videomasse aus der Watch-Seite -- die Grundwahrheit dieses Tests.
function masseAusPlayerResponse(html) {
  const m = /ytInitialPlayerResponse\s*=\s*(\{.*?\});(?:<\/script>|\s*var )/s.exec(html);
  if (!m) return null;
  try {
    const pr = JSON.parse(m[1]);
    const f = (pr.streamingData && (pr.streamingData.formats || pr.streamingData.adaptiveFormats)) || [];
    const mitMassen = f.filter((x) => x.width && x.height);
    if (!mitMassen.length) return null;
    // Groesstes Format entscheidet -- kleine Varianten koennen abweichen.
    const g = mitMassen.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    return { breite: g.width, hoehe: g.height, hochformat: g.height > g.width };
  } catch (e) { return null; }
}

const dauerSek = (iso) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(iso || '');
  return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : null;
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });

  // Kandidaten aus dem Kanal ziehen: kurze (Short-Verdacht) und lange (sicher normal).
  const me = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const uploads = me.data.items[0].contentDetails.relatedPlaylists.uploads;
  const ids = [];
  let pt;
  do {
    const r = await yt.playlistItems.list({ part: ['contentDetails'], playlistId: uploads, maxResults: 50, pageToken: pt });
    for (const it of r.data.items || []) ids.push(it.contentDetails.videoId);
    pt = r.data.nextPageToken;
  } while (pt && ids.length < 150);

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt.videos.list({ part: ['contentDetails', 'status', 'snippet'], id: ids.slice(i, i + 50) });
    for (const v of r.data.items || []) {
      if (v.status.privacyStatus !== 'public') continue;
      videos.push({ id: v.id, sek: dauerSek(v.contentDetails.duration) });
    }
  }
  const kurz = videos.filter((v) => v.sek !== null && v.sek <= 180).slice(0, 7);
  const lang = videos.filter((v) => v.sek !== null && v.sek > 300).slice(0, 7);
  console.log(`Pruefmenge: ${kurz.length} kurze + ${lang.length} lange oeffentliche Videos\n`);

  const zeilen = [];
  for (const [gruppe, liste] of [['kurz', kurz], ['lang', lang]]) {
    for (const v of liste) {
      const seite = await sync.fetchWatchPageHtml(v.id);
      const masse = masseAusPlayerResponse(seite.body);
      const oar = await sonde(`https://i.ytimg.com/vi/${v.id}/oardefault.jpg?cb=${Date.now()}`);
      const z = {
        gruppe,
        videoId: v.id,
        dauerSek: v.sek,
        masse: masse ? `${masse.breite}x${masse.hoehe}` : '(nicht auswertbar)',
        grundwahrheit: masse ? (masse.hochformat ? 'SHORT (hoch)' : 'NORMAL (quer)') : 'unbekannt',
        oardefaultCode: oar.code,
        oardefaultVorhanden: oar.code === 200,
      };
      z.sondeStimmt = masse ? (z.oardefaultVorhanden === masse.hochformat) : null;
      zeilen.push(z);
      console.log(`${gruppe.padEnd(5)} ${String(v.sek).padStart(5)}s  ${z.masse.padEnd(12)} ${z.grundwahrheit.padEnd(14)} oardefault=${String(z.oardefaultCode).padEnd(5)} ${z.sondeStimmt === null ? '?' : (z.sondeStimmt ? 'Sonde stimmt' : 'SONDE FALSCH')}`);
      await schlaf(500);
    }
  }

  fs.writeFileSync(path.join(OUT, 'short-erkennung-validierung.json'), JSON.stringify({ zeit: new Date().toISOString(), zeilen }, null, 2));

  const bewertbar = zeilen.filter((z) => z.sondeStimmt !== null);
  const shorts = bewertbar.filter((z) => z.grundwahrheit.startsWith('SHORT'));
  const normal = bewertbar.filter((z) => z.grundwahrheit.startsWith('NORMAL'));
  const falsePos = normal.filter((z) => z.oardefaultVorhanden);
  const falseNeg = shorts.filter((z) => !z.oardefaultVorhanden);

  console.log(`\n=== AUSWERTUNG oardefault-Sonde ===`);
  console.log(`Grundwahrheit SHORT (hochformat): ${shorts.length}  | davon von der Sonde erkannt: ${shorts.length - falseNeg.length}`);
  console.log(`Grundwahrheit NORMAL (quer):      ${normal.length}  | davon faelschlich als Short: ${falsePos.length}`);
  console.log(`Falsch-Positive (normal -> Sonde sagt Short): ${falsePos.length}`);
  console.log(`Falsch-Negative (Short -> Sonde sagt normal): ${falseNeg.length}`);
  console.log(falsePos.length === 0 && falseNeg.length === 0
    ? 'TRENNSCHARF: Die Sonde taugt als Sperre.'
    : 'NICHT TRENNSCHARF: Die Sonde allein reicht nicht.');
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
