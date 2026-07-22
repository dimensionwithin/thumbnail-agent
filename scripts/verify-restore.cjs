'use strict';
// Einmalige Verifikation fuer restore.js (kein Teil der Pipeline). Prueft: Manifest-Pflicht,
// Dry-Run = 0 Uploads, simuliertes Backup wird blockiert, --execute ohne Creds blockiert, Resume.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BK = path.resolve('backups');
const MAN = path.join(BK, 'manifest.json');
const PROG = path.join(BK, 'restore-progress.json');
let ok = true;
const fail = m => { ok = false; console.log('  FAIL: ' + m); };

function run(args) {
  try { return { code: 0, out: execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') }; }
}
function rmBackups() { fs.rmSync(BK, { recursive: true, force: true }); }

// "Echtes" Manifest: zeigt auf vorhandene PNGs als Ersatz-Originale (nicht simuliert).
function writeRealManifest() {
  fs.mkdirSync(BK, { recursive: true });
  const f1 = path.resolve('data/thumbnails/adw-vid_bull_0001.png');
  const f2 = path.resolve('data/thumbnails/adw-vid_live_0004.png');
  const m = {
    generatedAt: new Date().toISOString(), mode: 'live', count: 2,
    videos: {
      vid_bull_0001: { originalUrl: 'https://example/1.png', localFile: f1, fetchedAt: 'x', bytes: fs.statSync(f1).size },
      vid_live_0004: { originalUrl: 'https://example/2.png', localFile: f2, fetchedAt: 'x', bytes: fs.statSync(f2).size },
    }, complete: true, missing: [],
  };
  fs.writeFileSync(MAN, JSON.stringify(m, null, 2));
}

// 0) sauber
rmBackups();

// 1) Restore ohne Manifest -> harter Abbruch, 0 Uploads
let r = run(['src/publish/restore.js']);
if (!/kein Backup-Manifest/i.test(r.out)) fail('Restore ohne Manifest bricht nicht ab');
if (!/UPLOADS: 0/.test(r.out) || r.code === 0) fail('Restore ohne Manifest: Exit!=0 & UPLOADS 0 erwartet');

// 2) Echtes Manifest -> Dry-Run: 2x READY, UPLOADS 0, kein thumbnails.set, keine Progress-Datei
writeRealManifest();
r = run(['src/publish/restore.js']);
if ((r.out.match(/\[READY /g) || []).length !== 2) fail('Dry-Run: erwartet 2x READY');
if (!/KEIN thumbnails\.set/.test(r.out)) fail('Dry-Run: fehlende No-Upload-Zusicherung');
if (!/UPLOADS: 0/.test(r.out)) fail('Dry-Run: UPLOADS != 0');
if (fs.existsSync(PROG)) fail('Dry-Run hat Fortschritts-Datei erzeugt (sollte nicht)');

// 3) Simuliertes (mock) Backup -> BLOCKED:simulated, nie hochgeladen
rmBackups();
run(['src/publish/backup.js', '--in=fixtures/decisions.sample.json']); // erzeugt simuliertes Manifest
r = run(['src/publish/restore.js']);
if (!/BLOCKED:simulated/.test(r.out)) fail('Simuliertes Backup nicht als BLOCKED:simulated markiert');
if (!/UPLOADS: 0/.test(r.out)) fail('Simuliert: UPLOADS != 0');

// 4) --execute --yes ohne Credentials -> Abbruch vor Upload, 0 Uploads
writeRealManifest();
r = run(['src/publish/restore.js', '--execute', '--yes']);
if (!/verlangt YouTube-Credentials/i.test(r.out)) fail('--execute ohne Credentials bricht nicht ab');
if (!/UPLOADS: 0/.test(r.out) || r.code === 0) fail('--execute ohne Creds: Exit!=0 & UPLOADS 0 erwartet');

// 5) Resume -> bereits erledigtes Video als DONE uebersprungen
writeRealManifest();
fs.writeFileSync(PROG, JSON.stringify({ done: ['vid_bull_0001'] }, null, 2));
r = run(['src/publish/restore.js']);
if (!/\[DONE  \] vid_bull_0001/.test(r.out)) fail('Resume: erledigtes Video nicht als DONE markiert');
if (!/Bereits erledigt: 1/.test(r.out)) fail('Resume: Zaehler falsch');

rmBackups();
console.log(ok
  ? 'RESTORE CHECKS BESTANDEN — Manifest-Pflicht, Dry-Run=0 Uploads, simuliertes Backup blockiert, --execute ohne Creds blockiert, Resume.'
  : 'RESTORE CHECKS FEHLGESCHLAGEN');
process.exit(ok ? 0 : 1);
