'use strict';

// P5 / Rollback: RESTORE. Spielt die in backups/manifest.json gesicherten ORIGINAL-
// Thumbnails per thumbnails.set zurueck. Macht einen Publish-Batch in einem Befehl rueckgaengig.
//
// SICHERHEIT (identisch zu publish.js, nur umgekehrte Richtung):
//  - DEFAULT ist Dry-Run: nur Plan, ruft NIE thumbnails.set.
//  - Echter Upload NUR mit --execute UND interaktiver Bestaetigung (Tippen von "RESTORE").
//  - Ein simuliertes Backup (mock) wird im Execute-Pfad NIE hochgeladen.
//  - Fehlt die lokale Backup-Datei -> BLOCKED, Video wird nie angefasst.
//  - Ohne Manifest -> kompletter Abbruch.
//  - Kleine Batches, Pause (Quota), Fortschritts-Log mit Wiederaufnahme nach Abbruch.
//
// Flags:
//   (kein Flag)   Dry-Run (Plan, 0 Uploads).
//   --execute     Echter Upload — verlangt Credentials + Bestaetigung.
//   --backups=DIR Backup-Verzeichnis mit manifest.json (Default: backups).
//   --only=a,b    Nur diese videoIds zuruecksetzen (Default: alle im Manifest).
//   --batch=N     Batch-Groesse (Default: 5).
//   --delay=MS    Pause zwischen Uploads (Default: 1500).
//   --yes         Bestaetigung ueberspringen (nicht-interaktiv); ohne --execute wirkungslos.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { darfThumbnailGesetztWerden, sperreShortsOderWirf } = require('./short-guard');
const { pruefeArgumenteStrikt, TROCKENLAUF_FLAG } = require('./cli-args');

// CY: Jedes Argument, das hier nicht steht, bricht den Lauf ab (Exit 2).
const ERLAUBTE_ARGUMENTE = ['--execute', '--yes', TROCKENLAUF_FLAG,
  '--backups=', '--only=', '--batch=', '--delay='];

function parseArgs(argv) {
  const a = { execute: false, nurPruefen: false, backups: 'backups', only: null, batch: 5, delay: 1500, yes: false };
  for (const t of argv.slice(2)) {
    if (t === '--execute') a.execute = true;
    else if (t === TROCKENLAUF_FLAG) a.nurPruefen = true;
    else if (t === '--yes') a.yes = true;
    else if (t.startsWith('--backups=')) a.backups = t.slice(10);
    else if (t.startsWith('--only=')) a.only = t.slice(7).split(',').map(s => s.trim()).filter(Boolean);
    else if (t.startsWith('--batch=')) a.batch = Math.max(1, Number(t.slice(8)) || 5);
    else if (t.startsWith('--delay=')) a.delay = Math.max(0, Number(t.slice(8)) || 0);
  }
  return a;
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
    if (!process.stdin.isTTY) return resolve(''); // nicht-interaktiv -> leer = Nein
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Plan pro Video aus dem Manifest.
async function buildPlan(manifest, only, doneSet) {
  const entries = Object.entries(manifest.videos || {});
  const filtered = only ? entries.filter(([id]) => only.includes(id)) : entries;
  // CX: Schleife statt map(), weil die Short-Sperre eine Sonde braucht und der
  // Plan deshalb asynchron entsteht.
  const plan = [];
  for (const [id, eintrag] of filtered) {
    const localFile = eintrag.localFile;
    const hasFile = !!localFile && fs.existsSync(localFile);
    const simulated = eintrag.simulated === true;
    let status;
    let shortGrund = null;
    if (doneSet.has(id)) status = 'DONE';
    else if (!hasFile) status = 'BLOCKED:no-backup-file';
    else if (simulated) status = 'BLOCKED:simulated';
    else {
      // CX: Auch die Wiederherstellung ist ein thumbnails.set. Bei einem Short
      // wuerde sie dieselbe Zwei-Bilder-Lage erzeugen wie das Setzen (siehe CV).
      const entscheidung = await darfThumbnailGesetztWerden(id);
      shortGrund = entscheidung.grund;
      if (entscheidung.erlaubt) status = 'READY';
      else status = entscheidung.status === 'short' ? 'BLOCKED:short' : 'BLOCKED:short-unauswertbar';
    }
    plan.push({ id, localFile, originalUrl: eintrag.originalUrl, hasFile, simulated, status, shortGrund });
  }
  return plan;
}

async function main() {
  // CY: VOR allem anderen -- kein Netzaufruf, kein Schreibzugriff davor.
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/publish/restore.js');
  const args = parseArgs(process.argv);
  if (args.nurPruefen && args.execute) {
    console.error(`Abbruch: ${TROCKENLAUF_FLAG} und --execute schliessen einander aus.`);
    process.exit(2);
  }
  if (args.nurPruefen) {
    args.execute = false;
    console.log(`TROCKENLAUF (${TROCKENLAUF_FLAG}): es wird geplant, aber nichts gesetzt.`);
  }
  let uploads = 0; // ZAEHLER echter thumbnails.set-Aufrufe.

  const backupsDir = path.resolve(args.backups);
  const manifestPath = path.join(backupsDir, 'manifest.json');
  const manifest = loadJSON(manifestPath, null);

  console.log(`Modus:   ${args.execute ? 'EXECUTE (echte Wiederherstellung angefordert)' : 'DRY-RUN (Plan, keine Uploads)'}`);
  console.log(`Backups: ${manifestPath}\n`);

  if (!manifest) {
    console.error('Abbruch: kein Backup-Manifest gefunden. Es gibt nichts wiederherzustellen.');
    console.log('UPLOADS: 0');
    process.exit(1);
  }

  const progressPath = path.join(backupsDir, 'restore-progress.json');
  const progress = loadJSON(progressPath, { done: [] });
  const doneSet = new Set(progress.done || []);

  const plan = await buildPlan(manifest, args.only, doneSet);
  if (plan.length === 0) { console.log('Keine passenden Videos im Manifest.'); console.log('UPLOADS: 0'); return; }

  for (const row of plan) {
    const tag = row.status === 'READY' ? 'READY ' : row.status === 'DONE' ? 'DONE  ' : 'BLOCK ';
    const src = row.localFile ? path.relative(process.cwd(), row.localFile) : '(keine Datei)';
    console.log(`  [${tag}] ${row.id} <- ${src}` + (row.status.startsWith('BLOCKED') ? `   (${row.status})` : ''));
  }
  const ready = plan.filter(r => r.status === 'READY');
  const blocked = plan.filter(r => r.status.startsWith('BLOCKED'));
  const done = plan.filter(r => r.status === 'DONE');
  console.log(`\nReady: ${ready.length} | Bereits erledigt: ${done.length} | Blockiert: ${blocked.length}`);
  if (blocked.length) console.log(`Blockiert (werden NICHT angefasst): ${blocked.map(b => b.id + ':' + b.status).join(', ')}`);

  // --- DRY-RUN: Schluss. Garantiert kein Upload. ---
  if (!args.execute) {
    console.log('\nDRY-RUN — es wurde KEIN thumbnails.set aufgerufen. Fuer die echte Wiederherstellung: --execute');
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
    console.log('\nNichts wiederherzustellen (0 READY).');
    console.log('UPLOADS: 0');
    return;
  }

  if (!args.yes) {
    const ans = await ask(`\nWirklich ${ready.length} ORIGINAL-Thumbnail(s) am LIVE-Kanal wiederherstellen? Tippe "RESTORE" zum Bestaetigen: `);
    if (ans.trim() !== 'RESTORE') { console.log('Abgebrochen — keine Bestaetigung.'); console.log('UPLOADS: 0'); return; }
  }

  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('../youtube/auth');
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  const persist = () => fs.writeFileSync(progressPath, JSON.stringify({ done: Array.from(doneSet), updatedAt: new Date().toISOString() }, null, 2));
  const mimeFor = f => (/\.png$/i.test(f) ? 'image/png' : 'image/jpeg');

  for (let i = 0; i < ready.length; i += args.batch) {
    const batch = ready.slice(i, i + args.batch);
    console.log(`\nBatch ${Math.floor(i / args.batch) + 1}: ${batch.map(b => b.id).join(', ')}`);
    for (const row of batch) {
      try {
        // CX: zweite Verteidigungslinie unmittelbar vor dem Schreibaufruf.
        await sperreShortsOderWirf(row.id);
        await yt.thumbnails.set({ videoId: row.id, media: { mimeType: mimeFor(row.localFile), body: fs.createReadStream(row.localFile) } });
        uploads += 1;
        doneSet.add(row.id);
        persist();
        console.log(`  OK ${row.id} (${uploads}/${ready.length})`);
      } catch (e) {
        console.error(`  FEHLER ${row.id}: ${e.message} — Abbruch. Wiederaufnahme: erneut starten (erledigte werden uebersprungen).`);
        console.log('UPLOADS: ' + uploads);
        process.exit(1);
      }
      if (args.delay) await sleep(args.delay);
    }
  }

  console.log(`\nFertig. UPLOADS: ${uploads}`);
}

if (require.main === module) {
  main().catch(e => { console.error('Restore fehlgeschlagen:', e.message); console.log('UPLOADS: 0'); process.exit(1); });
}

module.exports = { parseArgs, buildPlan, youtubeAvailable };
