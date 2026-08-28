'use strict';

// SCHRITT 1 (Alt-Mitglieder-Meetings-Report): Ermittelt ALLE aktuell mitglieder-
// gesperrten Videos des Kanals und ordnet sie per actualStartTime (Europe/Berlin)
// in "alt" (vor CUTOFF_BERLIN) und "aktuell" (ab CUTOFF_BERLIN) ein.
//
// REIN LESEND. Ruft KEIN videos.update auf, schreibt in KEINE Playlist. Dient nur
// als Vorlage fuer die manuelle Freigabe (Schritt 2), bevor in Schritt 3 ueber das
// Muster aus src/publish/unlist-shorts.js irgendetwas geaendert wird.
//
// GATING-ERKENNUNG (zwei Quellen, UNION):
//  a) Mitgliedschaft in INNER_CIRCLE_PLAYLIST_ID -- bekannte Quelle, gilt OHNE
//     weiteren Check als gesperrt (spart unnoetige HTTP-Anfragen).
//  b) HTTP-playabilityStatus-Check (unauthentifiziertes Scraping der Watch-Seite,
//     erkennt offerId 'sponsors_only_video') -- NUR fuer Videos, die NICHT in der
//     IC-Playlist stehen.
// FAIL-CLOSED: liefert der HTTP-Check null (nicht auswertbar) und das Video steht
// NICHT in der IC-Playlist, wird es NICHT als gesperrt eingeordnet, sondern
// separat als UNGEPRUEFT gemeldet.
//
// KANDIDATENMENGE (bewusst NICHT "alle 1000+ Kanal-Videos"): Ein erster Testlauf
// ueber saemtliche Uploads (Shorts, Marktkommentare etc. eingeschlossen) hat nach
// ca. 500 sequenziellen Anfragen Googles Bot-Schutz ausgeloest (302 auf
// google.com/sorry/index -- die bekannte reCAPTCHA-Wand, siehe fetchWatchPageHtml
// unten). Das wird NICHT umgangen (kein CAPTCHA-Bypass). Stattdessen wird die
// HTTP-Check-Menge strukturell verkleinert auf das, was ueberhaupt ein "Mitglieder-
// Meeting" sein kann: (1) IC-Playlist-Videos brauchen gar keinen HTTP-Check (bereits
// bekannt gesperrt) und (2) alle anderen Kanal-Videos werden nur dann per HTTP
// geprueft, wenn sie laut liveStreamingDetails.actualStartTime tatsaechlich ein
// Livestream waren -- normale Uploads/Shorts koennen keine Meetings sein und
// werden gar nicht erst angefragt.
//
// CIRCUIT-BREAKER: Trifft der HTTP-Check mehrfach hintereinander auf die
// Bot-Schutz-Wand, bricht der Lauf sauber ab (kein Weiterspammen) und meldet die
// verbleibenden Kandidaten explizit als NICHT GEPRUEFT (Lauf abgebrochen), statt
// sie unauffaellig unter "UNGEPRUEFT" zu vermischen.
//
// STICHTAG: actualStartTime (Berlin) < 2026-01-01 => alt. Gesperrte Videos ohne
// actualStartTime (z.B. hochgeladene Meeting-Aufzeichnungen ohne echten Livestream)
// werden separat gemeldet -- der Stichtag ist per Definition nicht anwendbar.
//
// Flags:
//   (kein Flag)      Normaler Report-Lauf.
//   --limit=N        Maximal N HTTP-Check-Kandidaten pruefen (Debug).
//   --delay=MS       Pause zwischen HTTP-Checks (Default: 1200ms, kein Quota-Verbrauch).
//   --break-after=N  Circuit-Breaker-Schwelle fuer aufeinanderfolgende Bot-Wand-Treffer (Default: 4).
//   --out=DIR        Report-Verzeichnis (Default: backups).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('../youtube/auth');
const {
  youtubeAvailable, listUploadIds, listTargetPlaylistRaw, fetchVideoDetails,
  berlinDateParts,
} = require('../youtube/sync-livestream-archive');

const CUTOFF_BERLIN = '2026-01-01';
const CSV_HEADER = [
  'videoId', 'title', 'actualStartTimeBerlin', 'weekday', 'privacyStatus',
  'inIcPlaylist', 'httpCheck', 'gated', 'altOrAktuell',
];

function parseArgs(argv) {
  const a = { limit: Infinity, delay: 1200, breakAfter: 4, out: 'backups' };
  for (const t of argv.slice(2)) {
    if (t.startsWith('--limit=')) a.limit = Number(t.slice(8)) || Infinity;
    else if (t.startsWith('--delay=')) a.delay = Math.max(0, Number(t.slice(8)) || 0);
    else if (t.startsWith('--break-after=')) a.breakAfter = Math.max(1, Number(t.slice(14)) || 4);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
  }
  return a;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvCell).join(',') + '\n'; }

// Eigene Kopie statt Import aus sync-livestream-archive.js: erkennt zusaetzlich
// explizit die Google-Bot-Schutz-Wand (302 auf google.com/sorry/index), damit der
// Circuit-Breaker sie von anderen "nicht auswertbar"-Faellen unterscheiden kann.
function fetchWatchPageHtml(id) {
  return new Promise((resolve) => {
    const req = https.get(`https://www.youtube.com/watch?v=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(15000, () => { req.destroy(); resolve({ code: 'timeout', body: '' }); });
    req.on('error', e => resolve({ code: 'error:' + e.message, body: '' }));
  });
}
function extractPlayabilityStatus(html) {
  const m = /ytInitialPlayerResponse\s*=\s*(\{.*?\});(?:<\/script>|\s*var )/s.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]).playabilityStatus; } catch (e) { return null; }
}
// Rueckgabe: { gated: true|false|null, blocked: bool, reason: string }
async function checkMembersGatedHttpSafe(id) {
  const r = await fetchWatchPageHtml(id);
  const location = (r.headers && r.headers.location) || '';
  if (r.code === 302 && /google\.com\/sorry\//.test(location)) {
    return { gated: null, blocked: true, reason: 'Bot-Schutz-Wand (google.com/sorry)' };
  }
  const ps = extractPlayabilityStatus(r.body);
  if (!ps) return { gated: null, blocked: false, reason: `nicht auswertbar (code=${r.code})` };
  if (ps.status === 'OK') return { gated: false, blocked: false, reason: 'OK' };
  const offerId = ps.errorScreen && ps.errorScreen.playerLegacyDesktopYpcOfferRenderer && ps.errorScreen.playerLegacyDesktopYpcOfferRenderer.offerId;
  return { gated: offerId === 'sponsors_only_video', blocked: false, reason: `playabilityStatus=${ps.status}` };
}

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

  console.log('Modus:   Report (rein lesend, kein videos.update, keine Playlist-Schreibung)');
  console.log(`Stichtag: actualStartTime (Berlin) < ${CUTOFF_BERLIN} = alt\n`);

  const me = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const channel = me.data.items && me.data.items[0];
  if (!channel) throw new Error('Kein Kanal gefunden (mine=true).');
  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

  const uploadIds = await listUploadIds(yt, uploadsPlaylistId);
  console.log(`Uploads-Playlist: ${uploadIds.length} eindeutige Video-IDs.`);

  const icRaw = await listTargetPlaylistRaw(yt, icPlaylistId);
  const icSet = new Set(icRaw.map(it => it.videoId));
  console.log(`IC-Playlist (${icPlaylistId}): ${icSet.size} Video-IDs.`);

  const icOnly = [...icSet].filter(id => !uploadIds.includes(id));
  if (icOnly.length) console.log(`IC-Videos nicht im Uploads-Read (werden ergaenzt): ${icOnly.length}`);

  const allIds = [...new Set([...uploadIds, ...icSet])];
  console.log(`Kanal-Videos gesamt: ${allIds.length}`);

  const details = await fetchVideoDetails(yt, allIds);

  // Kandidatenmenge fuer den (teuren) HTTP-Check einschraenken: IC-Playlist-Videos
  // brauchen keinen Check (bereits bekannt gesperrt). Alles andere nur, wenn es
  // laut Metadaten ueberhaupt ein Livestream war -- normale Uploads/Shorts koennen
  // keine Mitglieder-Meetings sein.
  const httpCandidates = allIds.filter(id => {
    if (icSet.has(id)) return false;
    const d = details.get(id);
    return !!(d && d.liveStreamingDetails && d.liveStreamingDetails.actualStartTime);
  });
  console.log(`Davon IC-Playlist (kein HTTP-Check noetig): ${icSet.size}`);
  console.log(`Davon Livestream-Kandidaten fuer HTTP-Check (nicht in IC): ${httpCandidates.length}`);

  let checkList = httpCandidates;
  if (Number.isFinite(args.limit)) checkList = checkList.slice(0, args.limit);
  console.log(`HTTP-Checks in diesem Lauf: ${checkList.length}\n`);

  const gatedOld = [];
  const gatedCurrent = [];
  const gatedNoStartTime = [];
  const unchecked = [];
  const notRun = []; // Circuit-Breaker: nicht mehr geprueft.
  let httpFalseCount = 0;
  let consecutiveBlocked = 0;
  let breakerTripped = false;

  function classifyGated(id, d, inIc, httpResult) {
    const actualStartTime = d.liveStreamingDetails && d.liveStreamingDetails.actualStartTime;
    const parts = berlinDateParts(actualStartTime);
    const row = { id, title: d.title, privacyStatus: d.privacyStatus, actualStartTime, inIc, httpResult };
    if (!parts) { gatedNoStartTime.push(row); return; }
    row.berlinDate = parts.date;
    row.berlinTime = parts.time;
    row.weekday = parts.weekday;
    if (parts.date < CUTOFF_BERLIN) gatedOld.push(row); else gatedCurrent.push(row);
  }

  // 1) IC-Playlist-Videos: automatisch gesperrt, kein HTTP-Check.
  for (const id of allIds) {
    if (!icSet.has(id)) continue;
    const d = details.get(id);
    if (!d) { unchecked.push({ id, title: '(keine Metadaten -- geloescht/kein Zugriff)', reason: 'keine Metadaten' }); continue; }
    classifyGated(id, d, true, 'skipped(inIC)');
  }

  // 2) Nicht-IC-Kandidaten: HTTP-Check mit Circuit-Breaker.
  for (let i = 0; i < checkList.length; i++) {
    const id = checkList[i];
    const d = details.get(id);
    if (!d) { unchecked.push({ id, title: '(keine Metadaten -- geloescht/kein Zugriff)', reason: 'keine Metadaten' }); continue; }

    if (breakerTripped) { notRun.push({ id, title: d.title, reason: 'Lauf abgebrochen (Bot-Schutz-Wand)' }); continue; }

    const r = await checkMembersGatedHttpSafe(id);
    if (r.blocked) {
      consecutiveBlocked++;
      if (consecutiveBlocked >= args.breakAfter) {
        breakerTripped = true;
        console.log(`\nCIRCUIT-BREAKER: ${consecutiveBlocked}x hintereinander Bot-Schutz-Wand getroffen -- Abbruch der HTTP-Checks (Rest wird als NICHT GEPRUEFT gemeldet, nicht als "gesperrt=nein" gewertet).`);
      }
      notRun.push({ id, title: d.title, reason: r.reason });
      if (args.delay) await sleep(args.delay);
      continue;
    }
    consecutiveBlocked = 0;

    if (r.gated === true) {
      classifyGated(id, d, false, true);
    } else if (r.gated === false) {
      httpFalseCount++;
    } else {
      unchecked.push({ id, title: d.title, reason: r.reason });
    }

    if ((i + 1) % 25 === 0) console.log(`  ... HTTP-Check ${i + 1}/${checkList.length}`);
    if (args.delay) await sleep(args.delay);
  }

  gatedOld.sort((a, b) => (a.berlinDate + a.berlinTime).localeCompare(b.berlinDate + b.berlinTime));
  gatedCurrent.sort((a, b) => (a.berlinDate + a.berlinTime).localeCompare(b.berlinDate + b.berlinTime));

  console.log(`\n=== ALT (actualStartTime Berlin < ${CUTOFF_BERLIN}) — ${gatedOld.length} ===`);
  for (const r of gatedOld) {
    console.log(`  ${r.id}  ${r.berlinDate} (${r.weekday})  privacy=${r.privacyStatus}  inIC=${r.inIc ? 'ja' : 'nein'}`);
    console.log(`          ${r.title}`);
  }

  console.log(`\n=== AKTUELL (actualStartTime Berlin >= ${CUTOFF_BERLIN}) — ${gatedCurrent.length} ===`);
  for (const r of gatedCurrent) {
    console.log(`  ${r.id}  ${r.berlinDate} (${r.weekday})  privacy=${r.privacyStatus}  inIC=${r.inIc ? 'ja' : 'nein'}`);
    console.log(`          ${r.title}`);
  }

  if (gatedNoStartTime.length) {
    console.log(`\n=== GESPERRT, ABER KEIN actualStartTime (Stichtag nicht anwendbar) — ${gatedNoStartTime.length} ===`);
    for (const r of gatedNoStartTime) {
      console.log(`  ${r.id}  privacy=${r.privacyStatus}  inIC=${r.inIc ? 'ja' : 'nein'}  ${r.title}`);
    }
  }

  if (unchecked.length) {
    console.log(`\n=== UNGEPRUEFT (fail-closed, NICHT als gesperrt eingeordnet) — ${unchecked.length} ===`);
    for (const u of unchecked) console.log(`  ? ${u.id}  ${u.title}  (${u.reason})`);
  }

  if (notRun.length) {
    console.log(`\n=== NICHT GEPRUEFT (Circuit-Breaker-Abbruch, NICHT als gesperrt eingeordnet) — ${notRun.length} ===`);
    for (const u of notRun) console.log(`  ? ${u.id}  ${u.title}  (${u.reason})`);
  }

  console.log(`\n--- Zusammenfassung ---`);
  console.log(`Kanal-Videos gesamt:        ${allIds.length}`);
  console.log(`IC-Playlist (auto-gesperrt): ${icSet.size}`);
  console.log(`HTTP-Check-Kandidaten:      ${httpCandidates.length} (in diesem Lauf geprueft: ${checkList.length})`);
  console.log(`Gesperrt (alt):             ${gatedOld.length}`);
  console.log(`Gesperrt (aktuell):         ${gatedCurrent.length}`);
  console.log(`Gesperrt, kein Startzeit:   ${gatedNoStartTime.length}`);
  console.log(`Nicht gesperrt (HTTP):      ${httpFalseCount}`);
  console.log(`UNGEPRUEFT:                 ${unchecked.length}`);
  console.log(`NICHT GEPRUEFT (Abbruch):   ${notRun.length}`);
  if (breakerTripped) {
    console.log(`\nHINWEIS: Circuit-Breaker hat ausgeloest. Fuer einen vollstaendigen Lauf spaeter erneut starten (--delay hoeher setzen, z.B. --delay=2500) -- Google-Bot-Schutz baut sich ueber Zeit wieder ab.`);
  }

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `old-members-only-report-${stamp}.csv`);
  let csv = csvRow(CSV_HEADER);
  const writeRow = (r, tag) => csv += csvRow([
    r.id, r.title, r.actualStartTime ? `${r.berlinDate || ''} ${r.berlinTime || ''}`.trim() : '',
    r.weekday || '', r.privacyStatus, r.inIc ? 'ja' : 'nein', String(r.httpResult), 'ja', tag,
  ]);
  for (const r of gatedOld) writeRow(r, 'alt');
  for (const r of gatedCurrent) writeRow(r, 'aktuell');
  for (const r of gatedNoStartTime) writeRow(r, 'kein-startzeit');
  for (const u of unchecked) csv += csvRow([u.id, u.title, '', '', '', '', '', 'nein', 'ungeprueft']);
  for (const u of notRun) csv += csvRow([u.id, u.title, '', '', '', '', '', 'nein', 'nicht-geprueft-abbruch']);
  fs.writeFileSync(csvPath, csv);
  console.log(`\nCSV-Report: ${csvPath}`);
  console.log('\nKEINE Aenderung vorgenommen -- Schritt 2: bitte Report pruefen und Freigabe erteilen.');
}

if (require.main === module) {
  main().catch(e => { console.error('list-old-members-only fehlgeschlagen:', e.message); process.exit(1); });
}

module.exports = { parseArgs, CUTOFF_BERLIN, checkMembersGatedHttpSafe };
