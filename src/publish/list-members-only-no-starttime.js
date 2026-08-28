'use strict';

// M1 (Zwischenschritt vor Schritt 2 des Alt-Mitglieder-Meetings-Auftrags):
// Report NUR ueber IC-Playlist-Videos OHNE actualStartTime (d.h. hochgeladene
// Meeting-Aufzeichnungen, keine echten Livestreams) -- der Hauptverdacht des
// Nutzers fuer den "Block" in seiner Kanal-Chronologie.
//
// REIN LESEND, KEIN HTTP-Scraping: Gating-Quelle ist AUSSCHLIESSLICH die
// Mitgliedschaft in INNER_CIRCLE_PLAYLIST_ID (kuratiert vom Kanal-Owner). Kostet
// nur YouTube-Data-API-Quota (playlistItems.list + videos.list), keine
// unauthentifizierten Watch-Page-Requests -- daher unabhaengig von der aktuell
// aktiven Google-Bot-Schutz-Sperre sofort lauffaehig.
//
// Ruft KEIN videos.update auf, schreibt in KEINE Playlist.
//
// STICHTAG: publishedAt (Berlin) < 2026-01-01 => "alt" (Ersatzkriterium fuer
// actualStartTime, das bei diesen Videos per Definition fehlt).
//
// Flags:
//   (kein Flag)   Normaler Report-Lauf.
//   --out=DIR     Report-Verzeichnis (Default: backups).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('../youtube/auth');
const {
  youtubeAvailable, listTargetPlaylistRaw, fetchVideoDetails, berlinDateParts,
} = require('../youtube/sync-livestream-archive');
const { durationToSeconds } = require('./unlist-shorts');

const CUTOFF_BERLIN = '2026-01-01';
const CSV_HEADER = ['videoId', 'title', 'publishedAtBerlin', 'weekday', 'durationSec', 'privacyStatus', 'inIcPlaylist', 'altOrAktuell'];

function parseArgs(argv) {
  const a = { out: 'backups' };
  for (const t of argv.slice(2)) {
    if (t.startsWith('--out=')) a.out = t.slice(6);
  }
  return a;
}

function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvCell).join(',') + '\n'; }

async function main() {
  const args = parseArgs(process.argv);

  if (!youtubeAvailable()) {
    console.error('Abbruch: kein OAuth-Token/Client-ID gefunden. Erst `npm run auth`.');
    process.exit(1);
  }
  const icPlaylistId = process.env.INNER_CIRCLE_PLAYLIST_ID;
  if (!icPlaylistId) {
    console.error('Abbruch: INNER_CIRCLE_PLAYLIST_ID fehlt in .env.');
    process.exit(1);
  }

  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  console.log('Modus:   Report (rein lesend, kein videos.update, keine Playlist-Schreibung, KEIN HTTP-Check)');
  console.log('Quelle:  ausschliesslich INNER_CIRCLE_PLAYLIST_ID (kuratiert)');
  console.log(`Stichtag: publishedAt (Berlin) < ${CUTOFF_BERLIN} = alt\n`);

  const icRaw = await listTargetPlaylistRaw(yt, icPlaylistId);
  const icIds = icRaw.map(it => it.videoId);
  console.log(`IC-Playlist (${icPlaylistId}): ${icIds.length} Video-IDs.`);

  const details = await fetchVideoDetails(yt, icIds);

  const rows = [];
  const noMetadata = [];
  for (const id of icIds) {
    const d = details.get(id);
    if (!d) { noMetadata.push(id); continue; }
    const hasActualStart = !!(d.liveStreamingDetails && d.liveStreamingDetails.actualStartTime);
    if (hasActualStart) continue; // echter Livestream -- gehoert nicht zu diesem M1-Report.
    const parts = berlinDateParts(d.publishedAt);
    rows.push({
      id, title: d.title, privacyStatus: d.privacyStatus,
      publishedAt: d.publishedAt,
      berlinDate: parts ? parts.date : '', berlinTime: parts ? parts.time : '', weekday: parts ? parts.weekday : '',
      durationSec: durationToSeconds(d.durationIso),
    });
  }

  rows.sort((a, b) => (a.berlinDate + a.berlinTime).localeCompare(b.berlinDate + b.berlinTime));

  const alt = rows.filter(r => r.berlinDate && r.berlinDate < CUTOFF_BERLIN);
  const aktuell = rows.filter(r => r.berlinDate && r.berlinDate >= CUTOFF_BERLIN);
  const noDate = rows.filter(r => !r.berlinDate);

  console.log(`\n=== IC-Playlist-Videos OHNE actualStartTime (hochgeladene Meeting-Aufzeichnungen): ${rows.length} ===\n`);
  for (const r of rows) {
    const tag = r.berlinDate < CUTOFF_BERLIN ? 'ALT' : 'AKTUELL';
    const dur = r.durationSec === null ? '?' : `${Math.round(r.durationSec / 60)}min`;
    console.log(`  [${tag}] ${r.id}  ${r.berlinDate} (${r.weekday})  ${dur}  privacy=${r.privacyStatus}`);
    console.log(`          ${r.title}`);
  }

  // Jahres-Verteilung (Berlin-Jahr von publishedAt).
  const byYear = new Map();
  for (const r of rows) {
    const y = r.berlinDate ? r.berlinDate.slice(0, 4) : 'unbekannt';
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  console.log(`\n--- Jahres-Verteilung ---`);
  for (const [y, c] of [...byYear.entries()].sort()) console.log(`  ${y}: ${c}`);

  console.log(`\n--- Zusammenfassung ---`);
  console.log(`IC-Playlist gesamt:              ${icIds.length}`);
  console.log(`Ohne Metadaten (geloescht?):      ${noMetadata.length}`);
  console.log(`Davon mit actualStartTime (echte Livestreams, NICHT in diesem Report): ${icIds.length - noMetadata.length - rows.length}`);
  console.log(`OHNE actualStartTime (dieser Report): ${rows.length}`);
  console.log(`  davon ALT (publishedAt Berlin < ${CUTOFF_BERLIN}):     ${alt.length}`);
  console.log(`  davon AKTUELL (publishedAt Berlin >= ${CUTOFF_BERLIN}): ${aktuell.length}`);
  if (noDate.length) console.log(`  davon ohne auswertbares Datum:    ${noDate.length}`);

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `members-no-starttime-report-${stamp}.csv`);
  let csv = csvRow(CSV_HEADER);
  for (const r of rows) {
    const tag = r.berlinDate < CUTOFF_BERLIN ? 'alt' : 'aktuell';
    csv += csvRow([r.id, r.title, `${r.berlinDate} ${r.berlinTime}`.trim(), r.weekday, r.durationSec, r.privacyStatus, 'ja', tag]);
  }
  fs.writeFileSync(csvPath, csv);
  console.log(`\nCSV-Report: ${csvPath}`);
  console.log('\nKEINE Aenderung vorgenommen.');
}

if (require.main === module) {
  main().catch(e => { console.error('list-members-only-no-starttime fehlgeschlagen:', e.message); process.exit(1); });
}

module.exports = { parseArgs, CUTOFF_BERLIN };
