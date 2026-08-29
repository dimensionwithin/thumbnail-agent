'use strict';
// Einmalige Verifikation fuer restore.js (kein Teil der Pipeline). Prueft: Manifest-Pflicht,
// Dry-Run = 0 Uploads, simuliertes Backup wird blockiert, --execute ohne Creds blockiert, Resume.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// DA (2026-08-29): eigenes Temp-Verzeichnis statt des echten backups/ --
// Begruendung siehe scripts/verify-publish.cjs.
const BK = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-restore-'));
const ECHTES_BACKUPS = path.resolve('backups');
const BKF = '--backups=' + BK;
const MAN = path.join(BK, 'manifest.json');
const PROG = path.join(BK, 'restore-progress.json');
let ok = true;
const fail = m => { ok = false; console.log('  FAIL: ' + m); };

function run(args, opts = {}) {
  try { return { code: 0, out: execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: OHNE_CRED, ...opts }) }; }
  catch (e) { return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') }; }
}
// Loescht NUR das eigene Temp-Verzeichnis (harter Abbruch statt Kommentar).
function rmArbeitsdir() {
  if (BK === ECHTES_BACKUPS || !path.basename(BK).startsWith('verify-restore-')) {
    console.error('ABBRUCH: Arbeitsverzeichnis ist nicht das eigene Temp-Verzeichnis -- nichts geloescht.');
    process.exit(2);
  }
  fs.rmSync(BK, { recursive: true, force: true });
}

// "Echtes" Manifest: zeigt auf Ersatz-Originale (nicht simuliert).
// DA (2026-08-29): Die Ersatzdateien liegen jetzt im eigenen Temp-Verzeichnis
// statt in data/thumbnails/. Dort lagen sie nur, wenn der Render-Lauf fuer die
// Beispiel-Fixture vorher gelaufen war; data/ ist gitignored, und ohne die
// beiden PNGs ist das hier frueher mit einem statSync-Fehler abgestuerzt statt
// etwas zu melden. Der Inhalt spielt fuer den Datenweg keine Rolle -- geprueft
// wird, dass restore.js eine vorhandene, nicht simulierte Datei als READY sieht.
function writeRealManifest() {
  fs.mkdirSync(path.join(BK, 'originale'), { recursive: true });
  const f1 = path.join(BK, 'originale', 'original-1.png');
  const f2 = path.join(BK, 'originale', 'original-2.png');
  // 1x1-PNG, minimal aber echt (Signatur + IHDR/IDAT/IEND).
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  fs.writeFileSync(f1, PNG);
  fs.writeFileSync(f2, PNG);
  const m = {
    generatedAt: new Date().toISOString(), mode: 'live', count: 2,
    videos: {
      vid_bull_0001: { originalUrl: 'https://example/1.png', localFile: f1, fetchedAt: 'x', bytes: fs.statSync(f1).size },
      vid_live_0004: { originalUrl: 'https://example/2.png', localFile: f2, fetchedAt: 'x', bytes: fs.statSync(f2).size },
    }, complete: true, missing: [],
  };
  fs.writeFileSync(MAN, JSON.stringify(m, null, 2));
}

// --- DA (2026-08-29): Credential-Blindheit fuer ALLE Kindprozesse -----------
// Begruendung wortgleich zu scripts/verify-publish.cjs: Test 4 rief
// restore.js --execute --yes mit den echten Credentials dieser Arbeitskopie
// auf, und backup.js in Test 3 lief dadurch im LIVE- statt im MOCK-Modus,
// obwohl die Erwartung (BLOCKED:simulated) den MOCK-Modus voraussetzt.
const OHNE_CRED = {
  ...process.env,
  YOUTUBE_CLIENT_ID: '',
  YOUTUBE_TOKEN_PATH: path.join(BK, 'kein-token-absichtlich.json'),
};

// 0) sauber
fs.rmSync(BK, { recursive: true, force: true });
fs.mkdirSync(BK, { recursive: true });

// 0b) Vorprobe: ohne Beweis der Credential-Blindheit laeuft kein einziger Test.
const probe = run(['-e',
  "require('dotenv').config();" +
  "const fs=require('fs'),path=require('path');" +
  "const t=process.env.YOUTUBE_TOKEN_PATH||'.youtube-token.json';" +
  "console.log('CRED_SICHTBAR:'+(!!process.env.YOUTUBE_CLIENT_ID && fs.existsSync(path.resolve(t))));"
]);
if (!/CRED_SICHTBAR:false/.test(probe.out)) {
  console.error('ABBRUCH: Kindprozesse sehen weiterhin YouTube-Credentials -- es wurde NICHTS ausgefuehrt.');
  console.error(probe.out.trim());
  rmArbeitsdir();
  process.exit(2);
}
console.log('Vorprobe: Kindprozesse sehen keine YouTube-Credentials (CRED_SICHTBAR:false) -- MOCK-Modus erzwungen.');

// 1) Restore ohne Manifest -> harter Abbruch, 0 Uploads
let r = run(['src/publish/restore.js', BKF]);
if (!/kein Backup-Manifest/i.test(r.out)) fail('Restore ohne Manifest bricht nicht ab');
if (!/UPLOADS: 0/.test(r.out) || r.code === 0) fail('Restore ohne Manifest: Exit!=0 & UPLOADS 0 erwartet');

// 2) Echtes Manifest -> Dry-Run: 2x READY, UPLOADS 0, kein thumbnails.set, keine Progress-Datei
writeRealManifest();
r = run(['src/publish/restore.js', BKF]);
if ((r.out.match(/\[READY /g) || []).length !== 2) fail('Dry-Run: erwartet 2x READY');
if (!/KEIN thumbnails\.set/.test(r.out)) fail('Dry-Run: fehlende No-Upload-Zusicherung');
if (!/UPLOADS: 0/.test(r.out)) fail('Dry-Run: UPLOADS != 0');
if (fs.existsSync(PROG)) fail('Dry-Run hat Fortschritts-Datei erzeugt (sollte nicht)');

// 3) Simuliertes (mock) Backup -> BLOCKED:simulated, nie hochgeladen
fs.rmSync(BK, { recursive: true, force: true });
fs.mkdirSync(BK, { recursive: true });
run(['src/publish/backup.js', '--in=fixtures/decisions.sample.json', '--out=' + BK]); // erzeugt simuliertes Manifest
r = run(['src/publish/restore.js', BKF]);
if (!/BLOCKED:simulated/.test(r.out)) fail('Simuliertes Backup nicht als BLOCKED:simulated markiert');
if (!/UPLOADS: 0/.test(r.out)) fail('Simuliert: UPLOADS != 0');

// 4) --execute --yes -> Abbruch vor Upload, 0 Uploads.
// Sicher, weil die Vorprobe oben bewiesen hat, dass dieser Kindprozess keine
// Credentials sieht. Frueher lief genau dieser Aufruf mit den echten
// Credentials dieser Arbeitskopie und haette thumbnails.set am LIVE-Kanal
// ausgeloest, sobald der Manifest-Pfad durchgelaufen waere.
writeRealManifest();
r = run(['src/publish/restore.js', BKF, '--execute', '--yes']);
if (!/verlangt YouTube-Credentials/i.test(r.out)) fail('--execute ohne Credentials bricht nicht ab');
if (!/UPLOADS: 0/.test(r.out) || r.code === 0) fail('--execute ohne Creds: Exit!=0 & UPLOADS 0 erwartet');

// 5) Resume -> bereits erledigtes Video als DONE uebersprungen
writeRealManifest();
fs.writeFileSync(PROG, JSON.stringify({ done: ['vid_bull_0001'] }, null, 2));
r = run(['src/publish/restore.js', BKF]);
if (!/\[DONE  \] vid_bull_0001/.test(r.out)) fail('Resume: erledigtes Video nicht als DONE markiert');
if (!/Bereits erledigt: 1/.test(r.out)) fail('Resume: Zaehler falsch');

rmArbeitsdir();
console.log(ok
  ? 'RESTORE CHECKS BESTANDEN — Manifest-Pflicht, Dry-Run=0 Uploads, simuliertes Backup blockiert, --execute ohne Creds blockiert, Resume.'
  : 'RESTORE CHECKS FEHLGESCHLAGEN');
process.exit(ok ? 0 : 1);
