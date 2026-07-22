'use strict';

// P1 (Review-Harvester): FETCH. Liest die Video-IDs aus dem bestehenden Inventar
// (data/inventory.json) und holt mit dem Owner-OAuth-Client die TOP-LEVEL-Kommentare
// aller in-Scope-Videos. Roh-Cache: data/comments-raw.json (inkrementell).
//
// Wiederverwendung (keine zweite Auth-/Inventar-Schicht):
//   - getAuthorizedClient aus src/youtube/auth.js  (Owner-OAuth, youtube.force-ssl)
//   - Video-IDs + Metadaten aus data/inventory.json (npm run inventory)
//
// Scope-Entscheidung (abgenommen): public + unlisted. private + members-only
// (inInnerCircle) werden NICHT angefasst, sondern sauber uebersprungen und im
// Report aufgelistet. Members-only-Kommentare holt der Owner manuell.
//
// Quota: commentThreads.list kostet 1 Unit/Seite (maxResults=100). Der Cache
// verhindert Doppel-Ziehung bei erneuten Laeufen.
//
// Flags:
//   --in=PATH       Inventar (Default: data/inventory.json)
//   --out=PATH      Roh-Cache (Default: data/comments-raw.json)
//   --refresh       bereits gecachte Videos erneut ziehen (sonst uebersprungen)
//   --limit=N       maximal N in-Scope-Videos verarbeiten (Default: alle)
//   --scope=a,b     Privacy-Stati im Scope (Default: public,unlisted)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('../youtube/auth');

function parseArgs(argv) {
  const a = {
    in: 'data/inventory.json',
    out: 'data/comments-raw.json',
    refresh: false,
    limit: Infinity,
    scope: ['public', 'unlisted'],
  };
  for (const t of argv.slice(2)) {
    if (t === '--refresh') a.refresh = true;
    else if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
    else if (t.startsWith('--limit=')) a.limit = Number(t.slice(8)) || Infinity;
    else if (t.startsWith('--scope=')) a.scope = t.slice(8).split(',').map(s => s.trim()).filter(Boolean);
  }
  return a;
}

function loadInventory(inPath) {
  const p = path.resolve(inPath);
  if (!fs.existsSync(p)) {
    throw new Error(`Inventar nicht gefunden: ${p} (erst 'npm run inventory' laufen lassen).`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadCache(outPath) {
  const p = path.resolve(outPath);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function saveCache(outPath, cache) {
  const p = path.resolve(outPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cache, null, 2));
}

// Grund, warum ein Video gar nicht erst abgefragt wird (vor dem API-Call entschieden).
function preSkipReason(item, scope) {
  if (item.inInnerCircle) return 'members-only';
  if (!scope.includes(item.privacyStatus)) return `out-of-scope (${item.privacyStatus})`;
  return null;
}

// Reason-Code aus einem googleapis-Fehler herausziehen (commentsDisabled etc.).
function apiErrorReason(err) {
  const reason = err && err.errors && err.errors[0] && err.errors[0].reason;
  if (reason) return reason;
  const code = err && err.code;
  if (code === 403) return 'forbidden';
  if (code === 404) return 'notFound';
  return (err && err.message) ? `error: ${err.message}` : 'unknown-error';
}

// Alle Top-Level-Kommentare eines Videos, sauber paginiert.
async function fetchTopLevelComments(yt, videoId, videoTitle) {
  const comments = [];
  let pageToken;
  do {
    const res = await yt.commentThreads.list({
      part: ['snippet'],
      videoId,
      maxResults: 100,
      textFormat: 'plainText',
      pageToken,
    });
    for (const it of res.data.items || []) {
      const c = it.snippet && it.snippet.topLevelComment && it.snippet.topLevelComment.snippet;
      if (!c) continue;
      comments.push({
        id: it.snippet.topLevelComment.id,
        text: c.textOriginal != null ? c.textOriginal : (c.textDisplay || ''),
        author: c.authorDisplayName || '',
        authorChannelUrl: c.authorChannelUrl || '',
        likeCount: typeof c.likeCount === 'number' ? c.likeCount : 0,
        publishedAt: c.publishedAt || null,
        totalReplyCount: it.snippet.totalReplyCount || 0,
        videoId,
        videoTitle,
      });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return comments;
}

async function main() {
  const args = parseArgs(process.argv);
  const inventory = loadInventory(args.in);
  const items = inventory.items || [];

  // Kandidaten + Vorab-Skips bestimmen (members-only / out-of-scope).
  const candidates = [];
  const skipped = [];
  for (const it of items) {
    const reason = preSkipReason(it, args.scope);
    if (reason) {
      skipped.push({ videoId: it.videoId, title: it.title, reason });
    } else {
      candidates.push(it);
    }
  }

  const limited = Number.isFinite(args.limit) ? candidates.slice(0, args.limit) : candidates;

  // Bestehenden Cache laden (inkrementell weiterfuehren).
  const prev = loadCache(args.out);
  const cache = {
    generatedAt: new Date().toISOString(),
    source: path.resolve(args.in),
    channelTitle: inventory.channelTitle || null,
    scope: args.scope,
    videos: (prev && prev.videos) || {},
    skipped: [], // wird unten frisch aufgebaut (Vorab-Skips + API-Skips)
  };
  cache.skipped.push(...skipped);

  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  console.log(`Inventar: ${items.length} Videos; im Scope (${args.scope.join('+')}): ${candidates.length}; vorab uebersprungen: ${skipped.length}`);
  if (Number.isFinite(args.limit)) console.log(`--limit=${args.limit} -> verarbeite ${limited.length}`);

  let processed = 0, fromCache = 0, fetched = 0, apiSkipped = 0, totalComments = 0;

  for (let i = 0; i < limited.length; i++) {
    const it = limited[i];
    const cached = cache.videos[it.videoId];
    if (cached && !args.refresh) {
      fromCache++;
      totalComments += (cached.comments || []).length;
      continue;
    }
    try {
      const comments = await fetchTopLevelComments(yt, it.videoId, it.title);
      cache.videos[it.videoId] = {
        videoId: it.videoId,
        title: it.title,
        privacyStatus: it.privacyStatus,
        isLivestream: !!it.isLivestream,
        date: it.date || (it.publishedAt ? String(it.publishedAt).slice(0, 10) : null),
        publishedAt: it.publishedAt || null,
        fetchedAt: new Date().toISOString(),
        commentCount: comments.length,
        comments,
      };
      fetched++;
      totalComments += comments.length;
      if ((i + 1) % 25 === 0 || comments.length > 500) {
        console.log(`  [${i + 1}/${limited.length}] ${it.videoId} (+${comments.length})`);
      }
    } catch (err) {
      const reason = apiErrorReason(err);
      cache.skipped.push({ videoId: it.videoId, title: it.title, reason });
      apiSkipped++;
      // commentsDisabled ist erwartbar und harmlos -> leise; alles andere sichtbar.
      if (reason !== 'commentsDisabled') {
        console.warn(`  SKIP ${it.videoId}: ${reason}`);
      }
    }
    processed++;
    // Inkrementell sichern, damit ein Abbruch keinen Fortschritt verliert.
    if (processed % 20 === 0) saveCache(args.out, cache);
  }

  cache.generatedAt = new Date().toISOString();
  cache.totals = {
    videosInScope: candidates.length,
    videosProcessed: limited.length,
    videosFetchedNow: fetched,
    videosFromCache: fromCache,
    videosWithComments: Object.keys(cache.videos).length,
    totalComments,
    skippedTotal: cache.skipped.length,
  };
  saveCache(args.out, cache);

  // --- Report ---
  const byReason = cache.skipped.reduce((m, s) => (m[s.reason] = (m[s.reason] || 0) + 1, m), {});
  console.log(`\n=== P1 FETCH Report ===`);
  console.log(`Kanal:                ${cache.channelTitle || '(unbekannt)'}`);
  console.log(`Im Scope (${args.scope.join('+')}): ${candidates.length} Videos`);
  console.log(`Jetzt geholt:         ${fetched}`);
  console.log(`Aus Cache:            ${fromCache}`);
  console.log(`Kommentare gesamt:    ${totalComments}`);
  console.log(`Videos mit Cache:     ${Object.keys(cache.videos).length}`);
  console.log(`Uebersprungen:        ${cache.skipped.length}`);
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`   - ${reason}: ${n}`);
  }
  console.log(`\nGeschrieben: ${path.resolve(args.out)}`);
  console.log(`Naechster Schritt nach Abnahme: npm run reviews:rank`);
}

if (require.main === module) {
  main().catch(e => { console.error('FETCH fehlgeschlagen:', e.message); process.exit(1); });
}

module.exports = { parseArgs, preSkipReason, apiErrorReason, fetchTopLevelComments, loadInventory };
