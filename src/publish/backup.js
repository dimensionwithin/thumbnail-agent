'use strict';

// P5 / Schritt 1: BACKUP ZUERST. Laedt fuer alle Ziel-Videos (approved:true aus
// decisions.json) das aktuelle Original-Thumbnail nach backups/ und schreibt ein
// Manifest (videoId -> {originalUrl, localFile, fetchedAt}). Harte Regel:
// OHNE vollstaendiges Backup KEIN Publish (publish.js prueft das Manifest).
//
// Modus:
//   live  — echte YouTube-Reads + Download (braucht OAuth-Token + Client-ID).
//   mock  — simuliert: KEIN Netz, schreibt Platzhalter + Manifest (simulated:true).
//           Greift bei --dry-run ODER fehlenden Credentials.
//
// Flags:
//   --dry-run     Mock erzwingen (kein Netz).
//   --in=PATH     decisions.json (Default: data/decisions.json, sonst fixtures/…sample).
//   --out=DIR     Backup-Verzeichnis (Default: backups).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

function parseArgs(argv) {
  const a = { dryRun: false, in: null, out: 'backups' };
  for (const t of argv.slice(2)) {
    if (t === '--dry-run') a.dryRun = true;
    else if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
  }
  return a;
}

function resolveDecisions(explicit) {
  if (explicit) return path.resolve(explicit);
  const real = path.resolve('data', 'decisions.json');
  if (fs.existsSync(real)) return real;
  return path.resolve('fixtures', 'decisions.sample.json');
}

// Credentials vorhanden? (Token-Datei + Client-ID). Sonst -> mock.
function youtubeAvailable() {
  const tokenPath = process.env.YOUTUBE_TOKEN_PATH || '.youtube-token.json';
  return !!process.env.YOUTUBE_CLIENT_ID && fs.existsSync(path.resolve(tokenPath));
}

// Beste verfuegbare Aufloesung waehlen.
function pickThumbUrl(thumbs) {
  if (!thumbs) return null;
  for (const k of ['maxres', 'standard', 'high', 'medium', 'default']) {
    if (thumbs[k] && thumbs[k].url) return thumbs[k].url;
  }
  return null;
}

function downloadTo(url, file) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(file);
    https.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' fuer ' + url)); }
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(fs.statSync(file).size)));
    }).on('error', err => { fs.rm(file, () => {}); reject(err); });
  });
}

// LIVE: Thumbnail-URLs der Videos holen.
async function fetchThumbUrls(ids) {
  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('../youtube/auth');
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await yt.videos.list({ part: ['snippet'], id: chunk, maxResults: 50 });
    for (const v of res.data.items || []) {
      map[v.id] = pickThumbUrl(v.snippet && v.snippet.thumbnails);
    }
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv);
  const inPath = resolveDecisions(args.in);
  if (!fs.existsSync(inPath)) throw new Error(`decisions.json nicht gefunden: ${inPath}`);

  const decisions = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const targets = (decisions.items || []).filter(it => it.approved === true);
  const ids = targets.map(it => it.videoId);

  const mock = args.dryRun || !youtubeAvailable();
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Modus:   ${mock ? 'MOCK (kein Netz, simuliertes Backup)' : 'LIVE (Download)'}`);
  console.log(`Eingabe: ${inPath} — Ziel-Videos (approved): ${ids.length}\n`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: mock ? 'mock' : 'live',
    sourceDecisions: inPath,
    count: 0,
    videos: {},
  };

  const failed = [];

  if (mock) {
    for (const id of ids) {
      // Kanonische YouTube-Thumbnail-URL (nur als Referenz notiert, NICHT geladen).
      const originalUrl = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
      const localFile = path.join(outDir, `${id}.jpg.simulated`);
      fs.writeFileSync(localFile, `SIMULATED BACKUP fuer ${id}\nOriginal: ${originalUrl}\n`);
      manifest.videos[id] = {
        originalUrl, localFile, fetchedAt: new Date().toISOString(),
        bytes: fs.statSync(localFile).size, simulated: true,
      };
      console.log(`  [mock] ${id} -> ${path.relative(process.cwd(), localFile)}`);
    }
  } else {
    const urls = await fetchThumbUrls(ids);
    for (const id of ids) {
      const url = urls[id];
      if (!url) { failed.push(id); console.log(`  FEHLT ${id}: keine Thumbnail-URL`); continue; }
      const localFile = path.join(outDir, `${id}.jpg`);
      try {
        const bytes = await downloadTo(url, localFile);
        manifest.videos[id] = { originalUrl: url, localFile, fetchedAt: new Date().toISOString(), bytes };
        console.log(`  OK ${id} -> ${path.relative(process.cwd(), localFile)} (${bytes} B)`);
      } catch (e) {
        failed.push(id);
        console.log(`  FEHLER ${id}: ${e.message}`);
      }
    }
  }

  manifest.count = Object.keys(manifest.videos).length;
  manifest.complete = failed.length === 0 && manifest.count === ids.length;
  manifest.missing = ids.filter(id => !manifest.videos[id]);

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest: ${manifestPath}`);
  console.log(`Gesichert: ${manifest.count}/${ids.length}; vollstaendig: ${manifest.complete}`);
  if (!manifest.complete) {
    console.log(`WARN: Backup UNVOLLSTAENDIG -> Publish ist fuer fehlende Videos blockiert: ${manifest.missing.join(', ')}`);
  }
}

if (require.main === module) {
  main().catch(e => { console.error('Backup fehlgeschlagen:', e.message); process.exit(1); });
}

module.exports = { parseArgs, resolveDecisions, youtubeAvailable, pickThumbUrl };
