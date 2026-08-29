'use strict';

// CX Teil A: Schattenmessung der strengeren Gating-Logik.
//
// Verglichen werden:
//   ALT  decideGatedLegacy()   -- die Fassung VOR der Umstellung
//   NEU  decideGatedStrict()   -- nur POSITIV entscheidend, sonst null (jetzt produktiv)
//
// EIN Abruf je Video, nicht zwei: beide Entscheidungen sind reine Funktionen und
// werden auf GENAU DIESELBE Seite angewandt. Zwei getrennte Abrufe koennten
// unterschiedlich ausfallen und die Abweichung verfaelschen, die hier gemessen
// werden soll -- ausserdem halbiert das die Last.
//
// Nur lesend. Keine Playlist-Aenderung, kein videos.update, kein thumbnails.set.
// videoIds landen ausschliesslich in data/gating-repair/ (gitignored).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('../src/youtube/auth.js');

const OUT = path.join('data', 'gating-repair');
const DROSSEL_MS = 600; // hoeflich genug, dass YouTube nicht blockt

const sync = require('../src/youtube/sync-livestream-archive.js');
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function playlistItems(yt, playlistId) {
  const out = [];
  let pageToken;
  do {
    const r = await yt.playlistItems.list({ part: ['contentDetails', 'snippet'], playlistId, maxResults: 50, pageToken });
    for (const it of r.data.items || []) out.push(it.contentDetails.videoId);
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  return out;
}

async function messen(id, menge) {
  // EIN Abruf, beide Entscheidungen auf derselben Seite. decideGatedLegacy und
  // decideGatedStrict sind reine Funktionen -- damit ist der Vergleich frei von
  // Zeit- und Netzunterschieden, die zwei getrennte Abrufe hineintragen wuerden.
  const seite = await sync.fetchWatchPageHtml(id);
  const ps = sync.extractPlayabilityStatus(seite.body);
  const alt = sync.decideGatedLegacy(ps);
  const neu = sync.decideGatedStrict(ps);
  return {
    videoId: id,
    menge,
    alt,
    neu,
    wechsel: alt !== neu,
    statusWert: ps ? (ps.status || null) : '(nicht auswertbar)',
    reason: ps ? (ps.reason || null) : null,
    httpStatus: seite.code,
    bytes: (seite.body || '').length,
    abrufFehlgeschlagen: !seite.body || seite.body.length < 1000,
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });

  const archiv = await playlistItems(yt, process.env.LIVESTREAM_ARCHIVE_PLAYLIST_ID);
  const ic = await playlistItems(yt, process.env.INNER_CIRCLE_PLAYLIST_ID);

  // Die 15 zuletzt veroeffentlichten Streams: genau die Art Video, die der
  // Wochenlauf tatsaechlich anfasst (liveStreamingDetails.actualStartTime).
  const me = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const uploads = me.data.items[0].contentDetails.relatedPlaylists.uploads;
  const letzteIds = [];
  let pt;
  do {
    const r = await yt.playlistItems.list({ part: ['contentDetails'], playlistId: uploads, maxResults: 50, pageToken: pt });
    for (const it of r.data.items || []) letzteIds.push(it.contentDetails.videoId);
    pt = r.data.nextPageToken;
  } while (pt && letzteIds.length < 200);
  const streams = [];
  for (let i = 0; i < letzteIds.length && streams.length < 15; i += 50) {
    const r = await yt.videos.list({ part: ['liveStreamingDetails', 'snippet'], id: letzteIds.slice(i, i + 50) });
    for (const v of r.data.items || []) {
      if (v.liveStreamingDetails && v.liveStreamingDetails.actualStartTime && streams.length < 15) streams.push(v.id);
    }
  }

  const mengen = [
    ['Archiv-Playlist', archiv],
    ['IC-Playlist', ic],
    ['letzte 15 Streams', streams],
  ];
  const gesamt = mengen.reduce((n, [, l]) => n + l.length, 0);
  console.log(`Schattenmessung ueber ${gesamt} Videos: Archiv ${archiv.length}, IC ${ic.length}, letzte Streams ${streams.length}`);
  console.log(`Drossel: ${DROSSEL_MS} ms je Video\n`);

  const ergebnisse = [];
  let n = 0;
  for (const [menge, liste] of mengen) {
    for (const id of liste) {
      const r = await messen(id, menge);
      ergebnisse.push(r);
      n++;
      if (r.wechsel || r.abrufFehlgeschlagen) {
        console.log(`  [${r.wechsel ? 'WECHSEL' : 'ABRUF-FEHLER'}] ${menge}: alt=${r.alt} neu=${r.neu} status=${r.statusWert} http=${r.httpStatus} ${r.bytes}B`);
      }
      if (n % 25 === 0) console.log(`  ... ${n}/${gesamt}`);
      await schlaf(DROSSEL_MS);
    }
  }

  fs.writeFileSync(path.join(OUT, 'schattenmessung.json'),
    JSON.stringify({ zeit: new Date().toISOString(), ergebnisse: ergebnisse.map(({ koerper, ...r }) => r) }, null, 2));

  // --- Auswertung ------------------------------------------------------------
  const zaehle = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const wechsel = ergebnisse.filter((r) => r.wechsel);
  const fehler = ergebnisse.filter((r) => r.abrufFehlgeschlagen);

  console.log(`\n=== AUSWERTUNG ===`);
  console.log(`Gemessen: ${ergebnisse.length} | Wechsel alt->neu: ${wechsel.length} | fehlgeschlagene Abrufe: ${fehler.length}`);
  console.log(`\nAlle vorkommenden playabilityStatus.status-Werte:`);
  for (const [k, v] of Object.entries(zaehle(ergebnisse, (r) => r.statusWert)).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(k).padEnd(28)} ${v}`);
  }
  console.log(`\nWechsel im Detail (alt -> neu, nach status):`);
  if (!wechsel.length) console.log('  KEINE. Alt und neu stimmen bei jedem gemessenen Video ueberein.');
  for (const [k, v] of Object.entries(zaehle(wechsel, (r) => `${r.alt} -> ${r.neu}  [status=${r.statusWert}]`)).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(46)} ${v}`);
  }
  console.log(`\nWechsel je Menge:`);
  for (const [k, v] of Object.entries(zaehle(wechsel, (r) => r.menge))) console.log(`  ${k.padEnd(22)} ${v}`);
  if (fehler.length) {
    console.log(`\nFehlgeschlagene Abrufe (http/bytes):`);
    for (const r of fehler.slice(0, 20)) console.log(`  ${r.menge}: http=${r.httpStatus} bytes=${r.bytes} status=${r.statusWert}`);
  }
  console.log(`\ngeschrieben: ${path.join(OUT, 'schattenmessung.json')}`);
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
