'use strict';
// Einmalige Verifikation fuer P5 (kein Teil der Pipeline). Prueft die Sicherheits-
// garantien: ohne --execute kein Upload, Backup-Regel, Manifest-Pflicht, Resume.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FIX = 'fixtures/decisions.sample.json';
const BK = path.resolve('backups');
let ok = true;
const fail = m => { ok = false; console.log('  FAIL: ' + m); };

function run(args, opts = {}) {
  try {
    return { code: 0, out: execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}
function rmBackups() { fs.rmSync(BK, { recursive: true, force: true }); }

// 0) Sauberer Start
rmBackups();

// 1) Publish OHNE Manifest -> harter Abbruch, 0 Uploads
let r = run(['src/publish/publish.js', '--in=' + FIX]);
if (!/kein Backup-Manifest/i.test(r.out)) fail('Publish ohne Manifest bricht nicht ab');
if (!/UPLOADS: 0/.test(r.out) || r.code === 0) fail('Publish ohne Manifest: erwartet Exit!=0 & UPLOADS 0');

// 2) Backup (mock) -> Manifest vollstaendig (2 Eintraege, simulated)
r = run(['src/publish/backup.js', '--in=' + FIX]);
const manifest = JSON.parse(fs.readFileSync(path.join(BK, 'manifest.json'), 'utf8'));
if (manifest.count !== 2 || manifest.complete !== true) fail('Backup-Manifest nicht vollstaendig: ' + JSON.stringify({ c: manifest.count, complete: manifest.complete }));
if (!Object.values(manifest.videos).every(v => v.simulated === true)) fail('Mock-Backup nicht als simulated markiert');

// 3) Dry-Run (Default) -> beide READY, UPLOADS 0, kein thumbnails.set
r = run(['src/publish/publish.js', '--in=' + FIX]);
if ((r.out.match(/\[READY /g) || []).length !== 2) fail('Dry-Run: erwartet 2x READY');
if (!/KEIN thumbnails\.set/.test(r.out)) fail('Dry-Run: fehlende No-Upload-Zusicherung');
if (!/UPLOADS: 0/.test(r.out)) fail('Dry-Run: UPLOADS != 0');
if (fs.existsSync(path.join(BK, 'publish-progress.json'))) fail('Dry-Run hat Fortschritts-Datei erzeugt (sollte nicht)');

// 4) Backup-Regel: Eintrag entfernen -> Video wird BLOCKED, nie angefasst
const m2 = JSON.parse(fs.readFileSync(path.join(BK, 'manifest.json'), 'utf8'));
delete m2.videos['vid_live_0004'];
m2.complete = false;
fs.writeFileSync(path.join(BK, 'manifest.json'), JSON.stringify(m2, null, 2));
r = run(['src/publish/publish.js', '--in=' + FIX]);
if (!/BLOCK.*vid_live_0004|vid_live_0004.*BLOCKED:no-backup/s.test(r.out)) fail('Video ohne Backup nicht BLOCKED');
if (!/UPLOADS: 0/.test(r.out)) fail('BLOCKED-Fall: UPLOADS != 0');

// 5) --execute OHNE Credentials -> Abbruch vor jedem Upload, 0 Uploads
r = run(['src/publish/publish.js', '--in=' + FIX, '--execute', '--yes']);
if (!/verlangt YouTube-Credentials/i.test(r.out)) fail('--execute ohne Credentials bricht nicht sauber ab');
if (!/UPLOADS: 0/.test(r.out) || r.code === 0) fail('--execute ohne Credentials: erwartet Exit!=0 & UPLOADS 0');

// 6) Resume: Manifest wiederherstellen + Fortschritt vortaeuschen -> Video DONE (uebersprungen)
r = run(['src/publish/backup.js', '--in=' + FIX]); // Manifest wieder vollstaendig
fs.writeFileSync(path.join(BK, 'publish-progress.json'), JSON.stringify({ done: ['vid_bull_0001'] }, null, 2));
r = run(['src/publish/publish.js', '--in=' + FIX]);
if (!/\[DONE  \] vid_bull_0001/.test(r.out)) fail('Resume: erledigtes Video nicht als DONE markiert');
if (!/Bereits erledigt: 1/.test(r.out)) fail('Resume: Zaehler "Bereits erledigt" falsch');

// 7) Gesamtgarantie: in KEINEM der obigen Laeufe wurde je etwas hochgeladen
rmBackups(); // aufraeumen (gitignored)

console.log(ok
  ? 'P5 CHECKS BESTANDEN — Manifest-Pflicht, Mock-Backup, Dry-Run=0 Uploads, Backup-Regel (BLOCKED), --execute ohne Creds blockiert, Resume.'
  : 'P5 CHECKS FEHLGESCHLAGEN');
process.exit(ok ? 0 : 1);
