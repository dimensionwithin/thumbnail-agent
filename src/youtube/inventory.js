'use strict';

// P2: YouTube-Inventar. Liest mit Owner-OAuth die Uploads + Metadaten und leitet die
// SICHEREN Felder (preset, episode, date) ab. Output: data/inventory.json.
//
// Flags:
//   --inspect   nur die ersten N Videos roh ausgeben (zur Verifikation, wie
//               liveStreamingDetails / IC-Playlist tatsaechlich aussehen) — schreibt NICHTS.
//   --limit=N   maximal N Videos verarbeiten (Default: alle).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('./auth');
const { deriveSafeFields, assignInnerCircleEpisodes, assignDebunkedEpisodes } = require('./derive-format');

function parseArgs(argv) {
  const a = { inspect: false, limit: Infinity, debunked: null };
  for (const t of argv.slice(2)) {
    if (t === '--inspect') a.inspect = true;
    else if (t.startsWith('--limit=')) a.limit = Number(t.slice(8)) || Infinity;
    else if (t.startsWith('--debunked=')) a.debunked = t.slice(11);
  }
  return a;
}

// Alle Items einer Playlist (videoId + publishedAt der Aufnahme in die Playlist).
async function listAllPlaylistItems(yt, playlistId) {
  const out = [];
  let pageToken;
  do {
    const res = await yt.playlistItems.list({
      part: ['contentDetails'],
      playlistId,
      maxResults: 50,
      pageToken,
    });
    for (const it of res.data.items || []) {
      if (it.contentDetails && it.contentDetails.videoId) out.push(it.contentDetails.videoId);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

// Metadaten in Batches von 50.
async function fetchVideos(yt, ids) {
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await yt.videos.list({
      part: ['snippet', 'liveStreamingDetails', 'status'],
      id: chunk,
      maxResults: 50,
    });
    for (const v of res.data.items || []) {
      videos.push({
        id: v.id,
        title: v.snippet && v.snippet.title,
        description: (v.snippet && v.snippet.description) || '',
        publishedAt: v.snippet && v.snippet.publishedAt,
        privacyStatus: v.status && v.status.privacyStatus,
        liveStreamingDetails: v.liveStreamingDetails || null,
      });
    }
  }
  return videos;
}

async function resolveUploadsPlaylist(yt) {
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const params = { part: ['contentDetails', 'snippet'] };
  if (channelId) params.id = [channelId]; else params.mine = true;
  const res = await yt.channels.list(params);
  const ch = res.data.items && res.data.items[0];
  if (!ch) throw new Error('Kanal nicht gefunden (pruefe YOUTUBE_CHANNEL_ID / OAuth).');
  return {
    channelId: ch.id,
    channelTitle: ch.snippet && ch.snippet.title,
    uploadsPlaylist: ch.contentDetails.relatedPlaylists.uploads,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  const { channelId, channelTitle, uploadsPlaylist } = await resolveUploadsPlaylist(yt);
  console.log(`Kanal: ${channelTitle} (${channelId}); Uploads-Playlist: ${uploadsPlaylist}`);

  const uploadIdsRaw = await listAllPlaylistItems(yt, uploadsPlaylist);
  let uploadIds = [...new Set(uploadIdsRaw)]; // Fix 1: Uploads-Playlist liefert bei vielen Uploads Doppel-Zeilen -> deduplizieren.
  const upDup = uploadIdsRaw.length - uploadIds.length;
  console.log(`Uploads gefunden: ${uploadIds.length} eindeutig (${uploadIdsRaw.length} roh, ${upDup} Duplikate entfernt)`);
  if (Number.isFinite(args.limit)) uploadIds = uploadIds.slice(0, args.limit);

  // Inner-Circle-Playlist als Quelle der Wahrheit (API hat kein members-only Flag).
  const icPlaylist = process.env.INNER_CIRCLE_PLAYLIST_ID;
  let innerCircleIds = new Set();
  if (icPlaylist) {
    const icIds = await listAllPlaylistItems(yt, icPlaylist);
    innerCircleIds = new Set(icIds);
    console.log(`Inner-Circle-Playlist (${icPlaylist}): ${innerCircleIds.size} Videos`);
  } else {
    console.warn('WARN: INNER_CIRCLE_PLAYLIST_ID nicht gesetzt -> kein Video wird als innercircle markiert.');
  }

  // "DER AKTIONAER TV - Debunked" als EIGENE stabile Quelle (additiv, getrennt von IC).
  // ID via --debunked=<PL...> oder env DEBUNKED_PLAYLIST_ID. Gleiches Muster wie IC.
  const debunkedPlaylist = args.debunked || process.env.DEBUNKED_PLAYLIST_ID || null;
  let debunkedIds = new Set();
  if (debunkedPlaylist) {
    const dbIds = await listAllPlaylistItems(yt, debunkedPlaylist);
    debunkedIds = new Set(dbIds);
    console.log(`Debunked-Playlist (${debunkedPlaylist}): ${debunkedIds.size} Videos`);
  }

  // Fix 2: Metadaten fuer die VEREINIGUNG aus (deduplizierten) Uploads UND IC-Playlist holen.
  // Begruendung: Der Uploads-Read der grossen Playlist ist unzuverlaessig (dupliziert/verliert
  // Eintraege). Wuerden wir IC nur ueber den Schnitt mit Uploads bestimmen, fielen IC-Videos
  // raus, die der Uploads-Read gerade nicht liefert. Die IC-Playlist selbst ist klein & stabil.
  const uploadSet = new Set(uploadIds);
  const icOnly = [...innerCircleIds].filter(id => !uploadSet.has(id));
  if (icOnly.length > 0) {
    console.log(`IC-Videos nicht im Uploads-Read (werden direkt ergaenzt): ${icOnly.length}`);
  }
  const dbOnly = [...debunkedIds].filter(id => !uploadSet.has(id));
  if (dbOnly.length > 0) {
    console.log(`Debunked-Videos nicht im Uploads-Read (werden direkt ergaenzt): ${dbOnly.length}`);
  }
  const fetchIds = [...new Set([...uploadIds, ...innerCircleIds, ...debunkedIds])];
  const videos = await fetchVideos(yt, fetchIds);

  // IC-Episodennummern chronologisch (aufsteigend nach publishedAt) ueber alle eindeutigen
  // IC-Videos. Ueberschreibt fuer IC bewusst das Titel-Parsing.
  const icEpisodes = assignInnerCircleEpisodes(videos, innerCircleIds);
  // DEBUNKED-Episodennummern chronologisch (eigener Namespace, additiv, aendert IC nicht).
  const debunkedEpisodes = assignDebunkedEpisodes(videos, debunkedIds);

  if (args.inspect) {
    const sample = videos.slice(0, 5).map(v => ({
      id: v.id,
      title: v.title,
      publishedAt: v.publishedAt,
      privacyStatus: v.privacyStatus,
      hasLiveStreamingDetails: !!v.liveStreamingDetails,
      liveStreamingDetails: v.liveStreamingDetails,
      inInnerCirclePlaylist: innerCircleIds.has(v.id),
    }));
    console.log('\n--- INSPECT (erste 5, nichts geschrieben) ---');
    console.log(JSON.stringify(sample, null, 2));
    console.log('\nPruefe: erscheinen echte Livestreams mit liveStreamingDetails? Sind IC-Videos korrekt markiert?');

    // IC-Episodennummern chronologisch verifizieren (aufsteigend nach Datum).
    // Defensiv nach videoId deduplizieren, damit etwaige Doppel-Eintraege die
    // Lueckenlosigkeits-Pruefung nicht verfaelschen.
    const seenIc = new Set();
    const icRows = videos
      .filter(v => innerCircleIds.has(v.id))
      .filter(v => (seenIc.has(v.id) ? false : (seenIc.add(v.id), true)))
      .map(v => ({ id: v.id, date: v.publishedAt, episode: icEpisodes.get(v.id), title: v.title }))
      .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
    console.log(`\n--- INNER CIRCLE: ${icRows.length} eindeutige Videos, chronologisch nummeriert (nichts geschrieben) ---`);
    for (const r of icRows) {
      console.log(`${String(r.episode).padEnd(18)} ${r.date}  ${r.id}  ${r.title}`);
    }
    // Lueckenlosigkeit pruefen: Nummern 1..N ohne Luecke?
    const nums = icRows.map(r => Number(/#(\d+)/.exec(r.episode || '')?.[1])).filter(Number.isFinite);
    const ok = nums.length === icRows.length &&
      nums[0] === 1 && nums[nums.length - 1] === icRows.length &&
      nums.every((n, i) => n === i + 1);
    console.log(`\nLueckenlos 1..${icRows.length}? ${ok ? 'JA' : 'NEIN'}  (aeltestes=#${nums[0]}, neuestes=#${nums[nums.length - 1]})`);
    // IC-Playlist-Videos, fuer die keine Metadaten kamen (geloescht/kein Zugriff)?
    const icMissing = [...innerCircleIds].filter(id => !seenIc.has(id));
    if (icMissing.length) {
      console.log(`WARN: ${icMissing.length} IC-Playlist-Video(s) ohne Metadaten/nicht abrufbar: ${icMissing.join(', ')}`);
    }

    // DEBUNKED-Serie verifizieren (additiv, eigener Namespace, getrennt von IC).
    if (debunkedIds.size > 0) {
      const dbAlsoIc = [...debunkedIds].filter(id => innerCircleIds.has(id));
      if (dbAlsoIc.length) {
        console.log(`\nWARN: ${dbAlsoIc.length} Debunked-Video(s) liegen AUCH in der IC-Playlist (Namespace-Ueberschneidung): ${dbAlsoIc.join(', ')}`);
      }
      const seenDb = new Set();
      const dbRows = videos
        .filter(v => debunkedIds.has(v.id))
        .filter(v => (seenDb.has(v.id) ? false : (seenDb.add(v.id), true)))
        .map(v => ({ id: v.id, date: v.publishedAt, episode: debunkedEpisodes.get(v.id), title: v.title }))
        .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
      console.log(`\n--- DEBUNKED: ${dbRows.length} eindeutige Videos, chronologisch nummeriert (nichts geschrieben) ---`);
      for (const r of dbRows) {
        const t = (r.title || '');
        const tShort = t.length > 70 ? t.slice(0, 67) + '...' : t;
        console.log(`${String(r.episode).padEnd(13)} ${r.date}  ${r.id}  ${tShort}`);
      }
      const dnums = dbRows.map(r => Number(/#(\d+)/.exec(r.episode || '')?.[1])).filter(Number.isFinite);
      const dok = dnums.length === dbRows.length &&
        dnums[0] === 1 && dnums[dnums.length - 1] === dbRows.length &&
        dnums.every((n, i) => n === i + 1);
      console.log(`\nDEBUNKED lueckenlos 1..${dbRows.length}? ${dok ? 'JA' : 'NEIN'}  (aeltestes=#${dnums[0]}, neuestes=#${dnums[dnums.length - 1]})`);
      const dbMissing = [...debunkedIds].filter(id => !seenDb.has(id));
      if (dbMissing.length) {
        console.log(`WARN: ${dbMissing.length} Debunked-Playlist-Video(s) ohne Metadaten/nicht abrufbar: ${dbMissing.join(', ')}`);
      } else {
        console.log('Alle Debunked-Playlist-Videos lieferten Metadaten (keine WARN-Zeile).');
      }
    } else {
      console.log('\n(Keine Debunked-Playlist angegeben -> DEBUNKED-Diagnose uebersprungen.)');
    }
    return;
  }

  const items = videos.map(v => {
    const safe = deriveSafeFields(v, innerCircleIds, icEpisodes);
    const item = {
      videoId: v.id,
      title: v.title,
      description: v.description,
      publishedAt: v.publishedAt,
      privacyStatus: v.privacyStatus,
      isLivestream: !!v.liveStreamingDetails,
      inInnerCircle: innerCircleIds.has(v.id),
      // abgeleitete sichere Felder:
      preset: safe.preset,
      episode: safe.episode,
      date: safe.date,
    };
    // DEBUNKED rein additiv (eigener Namespace): nur Debunked-Videos taggen, IC/Rest unberuehrt.
    if (debunkedIds.has(v.id)) {
      item.episode = debunkedEpisodes.get(v.id);
      item.inDebunked = true;
    }
    return item;
  });

  const inventory = {
    generatedAt: new Date().toISOString(),
    channelId,
    channelTitle,
    uploadsPlaylist,
    innerCirclePlaylist: icPlaylist || null,
    debunkedPlaylist: debunkedPlaylist || null,
    count: items.length,
    items,
  };

  fs.mkdirSync(path.resolve('data'), { recursive: true });
  const outPath = path.resolve('data', 'inventory.json');
  fs.writeFileSync(outPath, JSON.stringify(inventory, null, 2));

  const byPreset = items.reduce((m, it) => (m[it.preset] = (m[it.preset] || 0) + 1, m), {});
  console.log(`\nGeschrieben: ${outPath}`);
  console.log('Preset-Verteilung:', JSON.stringify(byPreset));
}

if (require.main === module) {
  main().catch(e => { console.error('Inventar fehlgeschlagen:', e.message); process.exit(1); });
}

module.exports = { listAllPlaylistItems, fetchVideos, resolveUploadsPlaylist };
