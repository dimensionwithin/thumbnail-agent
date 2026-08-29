'use strict';

// P5 / Schritt 2: PUBLISH. Liest decisions.json (nur approved:true) und das Backup-Manifest.
//
// SICHERHEIT (nicht verhandelbar):
//  - DEFAULT ist Dry-Run: gibt nur den Plan aus, ruft NIE thumbnails.set.
//  - Echter Upload NUR mit --execute UND interaktiver Bestaetigung.
//  - Ein Video OHNE Backup-Eintrag wird NIE angefasst (BLOCKED).
//  - Ohne Backup-Manifest ueberhaupt -> kompletter Abbruch.
//  - Kleine Batches, Pause zwischen Calls (Quota/Rate-Limit), Fortschritts-Log mit
//    Wiederaufnahme nach Abbruch (bereits erledigte Videos werden uebersprungen).
//
// Flags:
//   (kein Flag)   Dry-Run (Plan, 0 Uploads).
//   --execute     Echter Upload — verlangt Credentials + Bestaetigung.
//   --in=PATH     decisions.json (Default: data/decisions.json, sonst fixtures/…sample).
//   --thumbs=DIR  gerenderte PNGs (Default: data/thumbnails).
//   --backups=DIR Backup-Verzeichnis mit manifest.json (Default: backups).
//   --batch=N     Batch-Groesse (Default: 5).
//   --delay=MS    Pause zwischen Uploads (Default: 1500).
//   --yes         Bestaetigung ueberspringen (nur fuer nicht-interaktive Automation;
//                 hat OHNE --execute keinerlei Wirkung).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { darfThumbnailGesetztWerden, sperreShortsOderWirf } = require('./short-guard');
const { pruefeArgumenteStrikt, TROCKENLAUF_FLAG } = require('./cli-args');

// CY: Jedes Argument, das hier nicht steht, bricht den Lauf ab (Exit 2).
const ERLAUBTE_ARGUMENTE = ['--execute', '--yes', TROCKENLAUF_FLAG,
  '--in=', '--thumbs=', '--backups=', '--batch=', '--delay=', '--only='];

function parseArgs(argv) {
  const a = { execute: false, nurPruefen: false, in: null, thumbs: 'data/thumbnails', backups: 'backups', batch: 5, delay: 1500, yes: false, only: null };
  for (const t of argv.slice(2)) {
    if (t === '--execute') a.execute = true;
    else if (t === TROCKENLAUF_FLAG) a.nurPruefen = true;
    else if (t === '--yes') a.yes = true;
    else if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--thumbs=')) a.thumbs = t.slice(9);
    else if (t.startsWith('--backups=')) a.backups = t.slice(10);
    else if (t.startsWith('--batch=')) a.batch = Math.max(1, Number(t.slice(8)) || 5);
    else if (t.startsWith('--delay=')) a.delay = Math.max(0, Number(t.slice(8)) || 0);
    else if (t.startsWith('--only=')) a.only = t.slice(7).split(',').map(s => s.trim()).filter(Boolean);
  }
  return a;
}

function resolveDecisions(explicit) {
  if (explicit) return path.resolve(explicit);
  const real = path.resolve('data', 'decisions.json');
  if (fs.existsSync(real)) return real;
  return path.resolve('fixtures', 'decisions.sample.json');
}

function youtubeAvailable() {
  const tokenPath = process.env.YOUTUBE_TOKEN_PATH || '.youtube-token.json';
  return !!process.env.YOUTUBE_CLIENT_ID && fs.existsSync(path.resolve(tokenPath));
}

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

function ask(question) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) return resolve(''); // nicht-interaktiv -> leere Antwort = Nein
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Plan pro Ziel-Video bauen.
// CX: async, weil die Short-Sperre eine Sonde auf das Bild-CDN braucht. Die
// Pruefung gehoert in die PLANUNG und nicht erst vor den Schreibaufruf -- sonst
// sieht der Trockenlauf ein READY, das in Wahrheit gesperrt ist, und der Bericht
// luegt. Vor dem Schreibaufruf steht trotzdem noch einmal eine harte Zusicherung
// (sperreShortsOderWirf), damit kein Pfad daran vorbeikommt.
async function buildPlan(targets, manifest, doneSet, thumbsDir) {
  const plan = [];
  for (const it of targets) {
    const id = it.videoId;
    const thumbFile = path.resolve(thumbsDir, `adw-${id}.png`);
    const hasBackup = !!(manifest.videos && manifest.videos[id]);
    const hasThumb = fs.existsSync(thumbFile);
    let status;
    let shortGrund = null;
    if (doneSet.has(id)) status = 'DONE';
    else if (!hasBackup) status = 'BLOCKED:no-backup';
    else if (!hasThumb) status = 'BLOCKED:no-thumbnail';
    else {
      const e = await darfThumbnailGesetztWerden(id);
      shortGrund = e.grund;
      if (e.erlaubt) status = 'READY';
      else status = e.status === 'short' ? 'BLOCKED:short' : 'BLOCKED:short-unauswertbar';
    }
    plan.push({ id, thumbFile, hasBackup, hasThumb, status, shortGrund });
  }
  return plan;
}

async function main() {
  // CY: VOR allem anderen -- kein Netzaufruf, kein Schreibzugriff davor.
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/publish/publish.js');
  const args = parseArgs(process.argv);
  if (args.nurPruefen && args.execute) {
    console.error(`Abbruch: ${TROCKENLAUF_FLAG} und --execute schliessen einander aus.`);
    process.exit(2);
  }
  if (args.nurPruefen) {
    args.execute = false; // Trockenlauf gewinnt immer
    console.log(`TROCKENLAUF (${TROCKENLAUF_FLAG}): es wird geplant, aber nichts gesetzt.`);
  }
  let uploads = 0; // ZAEHLER echter thumbnails.set-Aufrufe — am Ende immer ausgegeben.

  const inPath = resolveDecisions(args.in);
  if (!fs.existsSync(inPath)) throw new Error(`decisions.json nicht gefunden: ${inPath}`);
  const decisions = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  let targets = (decisions.items || []).filter(it => it.approved === true);

  // Optionaler Batch-Filter: nur die per --only=<ids> angefragten (und approved) Videos.
  if (args.only && args.only.length) {
    const want = new Set(args.only);
    const unknown = args.only.filter(id => !targets.some(t => t.videoId === id));
    targets = targets.filter(t => want.has(t.videoId));
    console.log(`--only aktiv: ${targets.length} von ${args.only.length} angefragten Videos (approved & gefunden).`);
    if (unknown.length) console.log(`  Nicht gefunden / nicht approved (ignoriert): ${unknown.join(', ')}`);
  }

  const backupsDir = path.resolve(args.backups);
  const manifestPath = path.join(backupsDir, 'manifest.json');
  const manifest = loadJSON(manifestPath, null);

  console.log(`Modus:   ${args.execute ? 'EXECUTE (echter Upload angefordert)' : 'DRY-RUN (Plan, keine Uploads)'}`);
  console.log(`Eingabe: ${inPath} — Ziel-Videos (approved): ${targets.length}`);
  console.log(`Backups: ${manifestPath}\n`);

  // Harte Regel: ohne Manifest gar kein Publish.
  if (!manifest) {
    console.error('Abbruch: kein Backup-Manifest gefunden. Erst `npm run backup` ausfuehren.');
    console.log('UPLOADS: 0');
    process.exit(1);
  }

  const progressPath = path.join(backupsDir, 'publish-progress.json');
  const progress = loadJSON(progressPath, { done: [] });
  const doneSet = new Set(progress.done || []);

  const plan = await buildPlan(targets, manifest, doneSet, args.thumbs);
  for (const row of plan) {
    const tag = row.status === 'READY' ? 'READY ' : row.status === 'DONE' ? 'DONE  ' : 'BLOCK ';
    console.log(`  [${tag}] ${row.id} <- ${path.relative(process.cwd(), row.thumbFile)}` +
      (row.status.startsWith('BLOCKED') ? `   (${row.status})` : ''));
    // CX: Bei der Short-Sperre ist der Grund die eigentliche Information --
    // "BLOCKED" allein laesst den Leser raten, ob das Video ein Short ist oder
    // ob nur die Sonde nicht durchkam.
    if (row.shortGrund && row.status.startsWith('BLOCKED:short')) console.log(`           ${row.shortGrund}`);
  }
  const ready = plan.filter(r => r.status === 'READY');
  const blocked = plan.filter(r => r.status.startsWith('BLOCKED'));
  const done = plan.filter(r => r.status === 'DONE');
  console.log(`\nReady: ${ready.length} | Bereits erledigt: ${done.length} | Blockiert: ${blocked.length}`);
  if (blocked.length) console.log(`Blockiert (werden NICHT angefasst): ${blocked.map(b => b.id + ':' + b.status).join(', ')}`);

  // --- DRY-RUN: hier ist Schluss. Garantiert kein Upload. ---
  if (!args.execute) {
    console.log('\nDRY-RUN — es wurde KEIN thumbnails.set aufgerufen. Fuer den echten Lauf: --execute');
    console.log('UPLOADS: 0');
    return;
  }

  // --- EXECUTE-Pfad ---
  if (!youtubeAvailable()) {
    console.error('\nAbbruch: --execute verlangt YouTube-Credentials (OAuth-Token + Client-ID) — keine gefunden.');
    console.log('UPLOADS: 0');
    process.exit(1);
  }
  if (ready.length === 0) {
    console.log('\nNichts zu publizieren (0 READY).');
    console.log('UPLOADS: 0');
    return;
  }

  if (!args.yes) {
    const ans = await ask(`\nWirklich ${ready.length} Thumbnail(s) am LIVE-Kanal setzen? Tippe "PUBLISH" zum Bestaetigen: `);
    if (ans.trim() !== 'PUBLISH') {
      console.log('Abgebrochen — keine Bestaetigung.');
      console.log('UPLOADS: 0');
      return;
    }
  }

  // Echter Upload, in Batches, mit Fortschritts-Persistenz nach JEDEM Erfolg.
  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('../youtube/auth');
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  const persist = () => fs.writeFileSync(progressPath, JSON.stringify({ done: Array.from(doneSet), updatedAt: new Date().toISOString() }, null, 2));

  for (let i = 0; i < ready.length; i += args.batch) {
    const batch = ready.slice(i, i + args.batch);
    console.log(`\nBatch ${Math.floor(i / args.batch) + 1}: ${batch.map(b => b.id).join(', ')}`);
    for (const row of batch) {
      try {
        // CX: zweite Verteidigungslinie unmittelbar vor dem Schreibaufruf.
        await sperreShortsOderWirf(row.id);
        await yt.thumbnails.set({ videoId: row.id, media: { mimeType: 'image/png', body: fs.createReadStream(row.thumbFile) } });
        uploads += 1;
        doneSet.add(row.id);
        persist();
        console.log(`  OK ${row.id} (${uploads}/${ready.length})`);
      } catch (e) {
        console.error(`  FEHLER ${row.id}: ${e.message} — Abbruch des Batches. Wiederaufnahme: erneut starten (erledigte werden uebersprungen).`);
        console.log('UPLOADS: ' + uploads);
        process.exit(1);
      }
      if (args.delay) await sleep(args.delay);
    }
  }

  console.log(`\nFertig. UPLOADS: ${uploads}`);
}

if (require.main === module) {
  main().catch(e => { console.error('Publish fehlgeschlagen:', e.message); console.log('UPLOADS: 0'); process.exit(1); });
}

module.exports = { parseArgs, resolveDecisions, buildPlan, youtubeAvailable };
