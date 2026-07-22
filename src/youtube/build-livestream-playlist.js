'use strict';

// Baut aus data/livestream-catalog.json eine YouTube-Playlist (55 Sonntags-Livestreams, #1..#55).
//
// SICHERHEIT (nicht verhandelbar):
//  - DEFAULT ist DRY-RUN: gibt nur den Plan aus, erstellt NICHTS.
//  - Echte Erstellung NUR mit --execute UND interaktiver Bestaetigung ("PLAYLIST").
//  - Resume: legt backups/livestream-playlist-progress.json an (playlistId + erledigte videoIds);
//    erneuter Lauf erstellt KEINE zweite Playlist, sondern ergaenzt nur fehlende Videos.
//  - Reihenfolge = catalog #N aufsteigend; Pause zwischen Inserts.
//
// Flags:
//   (kein Flag)       Dry-Run (Plan, 0 Schreibvorgaenge).
//   --execute         Echte Erstellung — verlangt Credentials + Bestaetigung.
//   --in=PATH         Katalog (Default: data/livestream-catalog.json).
//   --title="..."     Playlist-Titel (Default unten).
//   --desc="..."      Playlist-Beschreibung.
//   --privacy=X       unlisted | public | private (Default: unlisted).
//   --delay=MS        Pause zwischen playlistItems.insert (Default: 800).
//   --yes             Bestaetigung ueberspringen (nur nicht-interaktiv; ohne --execute wirkungslos).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DEFAULT_TITLE = 'Sonntags-Livestreams';
const DEFAULT_DESC = 'Chronologische Reihe der Sonntags-Livestreams (kuratiert). Automatisch zusammengestellt.';

function parseArgs(argv) {
  const a = { execute: false, in: 'data/livestream-catalog.json', title: DEFAULT_TITLE, desc: DEFAULT_DESC, privacy: 'unlisted', delay: 800, yes: false };
  for (const t of argv.slice(2)) {
    if (t === '--execute') a.execute = true;
    else if (t === '--yes') a.yes = true;
    else if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--title=')) a.title = t.slice(8);
    else if (t.startsWith('--desc=')) a.desc = t.slice(7);
    else if (t.startsWith('--privacy=')) a.privacy = t.slice(10);
    else if (t.startsWith('--delay=')) a.delay = Math.max(0, Number(t.slice(8)) || 0);
  }
  return a;
}
function youtubeAvailable() {
  const tokenPath = process.env.YOUTUBE_TOKEN_PATH || '.youtube-token.json';
  return !!process.env.YOUTUBE_CLIENT_ID && fs.existsSync(path.resolve(tokenPath));
}
function ask(q) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) return resolve('');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, ans => { rl.close(); resolve(ans); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv);
  const PRIVS = ['public', 'unlisted', 'private'];
  if (!PRIVS.includes(args.privacy)) throw new Error(`--privacy muss public|unlisted|private sein (war: ${args.privacy})`);

  const inPath = path.resolve(args.in);
  if (!fs.existsSync(inPath)) throw new Error(`Katalog nicht gefunden: ${inPath}`);
  const catalog = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const items = (catalog.items || []).slice().sort((a, b) => a.n - b.n);
  let created = 0; // ZAEHLER echter Inserts

  const progressPath = path.resolve('backups', 'livestream-playlist-progress.json');
  const progress = fs.existsSync(progressPath) ? JSON.parse(fs.readFileSync(progressPath, 'utf8')) : { playlistId: null, done: [] };
  const doneSet = new Set(progress.done || []);

  console.log(`Modus:   ${args.execute ? 'EXECUTE (echte Playlist-Erstellung angefordert)' : 'DRY-RUN (Plan, nichts erstellt)'}`);
  console.log(`Katalog: ${inPath} — ${items.length} Folgen (#${items[0] && items[0].n}..#${items[items.length-1] && items[items.length-1].n})`);
  console.log(`Playlist: titel="${args.title}" | privacy=${args.privacy}`);
  console.log(`Beschreibung: ${args.desc}`);
  if (progress.playlistId) console.log(`Bestehende Playlist (Resume): ${progress.playlistId} | bereits drin: ${doneSet.size}`);
  console.log('');
  console.log('Plan (Reihenfolge #N):');
  for (const it of items) {
    const tag = doneSet.has(it.videoId) ? 'DONE ' : 'ADD  ';
    console.log(`  [${tag}] #${String(it.n).padStart(2)} ${it.videoId} | ${it.date} | ${it.privacyStatus.padEnd(8)} | ${(it.title||'').slice(0,52)}`);
  }
  const todo = items.filter(it => !doneSet.has(it.videoId));
  console.log(`\nHinzuzufuegen: ${todo.length} | bereits erledigt: ${items.length - todo.length}`);

  if (!args.execute) {
    console.log('\nDRY-RUN — es wurde KEINE Playlist erstellt und KEIN Video hinzugefuegt.');
    console.log('Fuer den echten Lauf: --execute  (Titel/Privacy via --title= / --privacy= anpassbar)');
    console.log('CREATED: 0');
    return;
  }

  // --- EXECUTE ---
  if (!youtubeAvailable()) { console.error('\nAbbruch: --execute verlangt YouTube-Credentials (OAuth-Token + Client-ID).'); console.log('CREATED: 0'); process.exit(1); }
  if (!args.yes) {
    const ans = await ask(`\nWirklich Playlist "${args.title}" (${args.privacy}) erstellen und ${todo.length} Video(s) am LIVE-Kanal hinzufuegen? Tippe "PLAYLIST" zum Bestaetigen: `);
    if (ans.trim() !== 'PLAYLIST') { console.log('Abgebrochen — keine Bestaetigung.'); console.log('CREATED: 0'); return; }
  }

  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('./auth');
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });
  const persist = () => fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  fs.mkdirSync(path.resolve('backups'), { recursive: true });

  // 1) Playlist anlegen (nur falls noch keine via Resume existiert)
  if (!progress.playlistId) {
    const res = await yt.playlists.insert({ part: ['snippet', 'status'], requestBody: { snippet: { title: args.title, description: args.desc }, status: { privacyStatus: args.privacy } } });
    progress.playlistId = res.data.id; persist();
    console.log(`\nPlaylist erstellt: ${progress.playlistId}`);
  } else {
    console.log(`\nNutze bestehende Playlist (Resume): ${progress.playlistId}`);
  }

  // 2) Videos in #N-Reihenfolge ergaenzen
  for (const it of items) {
    if (doneSet.has(it.videoId)) continue;
    try {
      await yt.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: { playlistId: progress.playlistId, resourceId: { kind: 'youtube#video', videoId: it.videoId } } } });
      created += 1; doneSet.add(it.videoId); progress.done = [...doneSet]; persist();
      console.log(`  OK #${it.n} ${it.videoId} (${created}/${todo.length})`);
    } catch (e) {
      console.error(`  FEHLER #${it.n} ${it.videoId}: ${e.message} — Abbruch. Wiederaufnahme: erneut --execute (erledigte werden uebersprungen).`);
      console.log('CREATED: ' + created); process.exit(1);
    }
    if (args.delay) await sleep(args.delay);
  }
  console.log(`\nFertig. Playlist: ${progress.playlistId} | CREATED: ${created}`);
}

if (require.main === module) {
  main().catch(e => { console.error('Playlist-Bau fehlgeschlagen:', e.message); console.log('CREATED: 0'); process.exit(1); });
}
module.exports = { parseArgs, youtubeAvailable };
