'use strict';
// Einmalige Verifikation fuer P5 (kein Teil der Pipeline). Prueft die Sicherheits-
// garantien: ohne --execute kein Upload, Backup-Regel, Manifest-Pflicht, Resume.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIX = 'fixtures/decisions.sample.json';

// DA (2026-08-29): Das Skript arbeitet in einem EIGENEN temporaeren Verzeichnis
// und fasst das echte backups/ nicht mehr an. Vorher stand hier
// path.resolve('backups') samt rmSync(recursive) -- in CZ hat dieser Lauf damit
// das Verzeichnis des Wochenlaufs mitsamt Inhalt geloescht. Der kleinere
// Eingriff waere gewesen, nur selbst angelegte Dateien zu entfernen; das haette
// aber eine Buchfuehrung ueber jede erzeugte Datei gebraucht (Manifest,
// Bilddateien, Progress-Dateien, alles aus Kindprozessen heraus). Ein eigenes
// Verzeichnis ist weniger Code und deckt auch Dateien ab, an die niemand denkt.
const BK = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-publish-'));
// Das echte backups/ liegt ab hier ausserhalb der Reichweite dieses Skripts.
const ECHTES_BACKUPS = path.resolve('backups');
let ok = true;
const fail = m => { ok = false; console.log('  FAIL: ' + m); };

function run(args, opts = {}) {
  try {
    return { code: 0, out: execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: OHNE_CRED, ...opts }) };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}
// Loescht NUR das eigene Temp-Verzeichnis. Die Zusicherung steht bewusst als
// harter Abbruch da und nicht als Kommentar: sollte BK je wieder auf das echte
// backups/ zeigen, endet der Lauf hier statt Daten zu vernichten.
function rmArbeitsdir() {
  if (BK === ECHTES_BACKUPS || !path.basename(BK).startsWith('verify-publish-')) {
    console.error('ABBRUCH: Arbeitsverzeichnis ist nicht das eigene Temp-Verzeichnis -- nichts geloescht.');
    process.exit(2);
  }
  fs.rmSync(BK, { recursive: true, force: true });
}
// Alle Kindprozesse muessen in BK arbeiten, sonst faellt einer auf den Default
// 'backups' zurueck. Deshalb haengt an JEDEM Aufruf eines dieser Flags.
const OUT = '--out=' + BK;
const BKF = '--backups=' + BK;

// --- DA (2026-08-29): Credential-Blindheit fuer ALLE Kindprozesse -----------
// Frueher erbten die Kindprozesse die Umgebung dieser Arbeitskopie, also die
// echte YOUTUBE_CLIENT_ID und das echte .youtube-token.json. Zwei Folgen:
//  1. Test 5 rief publish.js --execute --yes SCHARF auf. Dass nichts hochgeladen
//     wurde, lag allein daran, dass zufaellig kein Video freigegeben war.
//  2. backup.js lief im LIVE-Modus und fragte die echte API ab, obwohl alle
//     Erwartungen hier (simulated:true) den MOCK-Modus voraussetzen -- der Lauf
//     war also nicht nur scharf, sondern auch falsch.
// Beides haengt an derselben Annahme "es sind sowieso keine Credentials da".
// Diese Annahme wird jetzt ERZWUNGEN und vorher BEWIESEN:
//   YOUTUBE_CLIENT_ID='' -- leer; dotenv ueberschreibt keinen bereits gesetzten
//                           Schluessel, die .env kann ihn nicht zurueckbringen.
//   YOUTUBE_TOKEN_PATH   -- auf eine garantiert nicht existierende Datei.
// Zusammen ist youtubeAvailable() in publish.js/backup.js zwingend false.
const OHNE_CRED = {
  ...process.env,
  YOUTUBE_CLIENT_ID: '',
  YOUTUBE_TOKEN_PATH: path.join(BK, 'kein-token-absichtlich.json'),
};

// 0) Sauberer Start
fs.rmSync(BK, { recursive: true, force: true });
fs.mkdirSync(BK, { recursive: true });

// 0b) Vorprobe: erst beweisen, dass ein Kindprozess unter OHNE_CRED keine
// Credentials sieht -- mit derselben Pruefung, die publish.js selbst benutzt.
// Faellt die Probe aus, laeuft KEIN einziger Test; insbesondere kein --execute.
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

// 1) Publish OHNE Manifest -> harter Abbruch, 0 Uploads
let r = run(['src/publish/publish.js', '--in=' + FIX, BKF]);
if (!/kein Backup-Manifest/i.test(r.out)) fail('Publish ohne Manifest bricht nicht ab');
if (!/UPLOADS: 0/.test(r.out) || r.code === 0) fail('Publish ohne Manifest: erwartet Exit!=0 & UPLOADS 0');

// 2) Backup (mock) -> Manifest vollstaendig (2 Eintraege, simulated)
r = run(['src/publish/backup.js', '--in=' + FIX, OUT]);
const manifest = JSON.parse(fs.readFileSync(path.join(BK, 'manifest.json'), 'utf8'));
if (manifest.count !== 2 || manifest.complete !== true) fail('Backup-Manifest nicht vollstaendig: ' + JSON.stringify({ c: manifest.count, complete: manifest.complete }));
if (!Object.values(manifest.videos).every(v => v.simulated === true)) fail('Mock-Backup nicht als simulated markiert');

// 3) Dry-Run (Default) -> beide READY, UPLOADS 0, kein thumbnails.set
r = run(['src/publish/publish.js', '--in=' + FIX, BKF]);
if ((r.out.match(/\[READY /g) || []).length !== 2) fail('Dry-Run: erwartet 2x READY');
if (!/KEIN thumbnails\.set/.test(r.out)) fail('Dry-Run: fehlende No-Upload-Zusicherung');
if (!/UPLOADS: 0/.test(r.out)) fail('Dry-Run: UPLOADS != 0');
if (fs.existsSync(path.join(BK, 'publish-progress.json'))) fail('Dry-Run hat Fortschritts-Datei erzeugt (sollte nicht)');

// 4) Backup-Regel: Eintrag entfernen -> Video wird BLOCKED, nie angefasst
const m2 = JSON.parse(fs.readFileSync(path.join(BK, 'manifest.json'), 'utf8'));
delete m2.videos['vid_live_0004'];
m2.complete = false;
fs.writeFileSync(path.join(BK, 'manifest.json'), JSON.stringify(m2, null, 2));
r = run(['src/publish/publish.js', '--in=' + FIX, BKF]);
if (!/BLOCK.*vid_live_0004|vid_live_0004.*BLOCKED:no-backup/s.test(r.out)) fail('Video ohne Backup nicht BLOCKED');
if (!/UPLOADS: 0/.test(r.out)) fail('BLOCKED-Fall: UPLOADS != 0');

// 5) --execute -> Abbruch vor jedem Upload, 0 Uploads.
// Sicher, weil die Vorprobe oben bewiesen hat, dass dieser Kindprozess keine
// Credentials sieht (siehe OHNE_CRED). Ohne diesen Beweis waere der Lauf schon
// vorher mit Exit 2 beendet worden.
r = run(['src/publish/publish.js', '--in=' + FIX, BKF, '--execute', '--yes']);
if (!/verlangt YouTube-Credentials/i.test(r.out)) fail('--execute ohne Credentials bricht nicht sauber ab');
if (!/UPLOADS: 0/.test(r.out) || r.code === 0) fail('--execute ohne Credentials: erwartet Exit!=0 & UPLOADS 0');

// 6) Resume: Manifest wiederherstellen + Fortschritt vortaeuschen -> Video DONE (uebersprungen)
r = run(['src/publish/backup.js', '--in=' + FIX, OUT]); // Manifest wieder vollstaendig
fs.writeFileSync(path.join(BK, 'publish-progress.json'), JSON.stringify({ done: ['vid_bull_0001'] }, null, 2));
r = run(['src/publish/publish.js', '--in=' + FIX, BKF]);
if (!/\[DONE  \] vid_bull_0001/.test(r.out)) fail('Resume: erledigtes Video nicht als DONE markiert');
if (!/Bereits erledigt: 1/.test(r.out)) fail('Resume: Zaehler "Bereits erledigt" falsch');

// 7) Gesamtgarantie: in KEINEM der obigen Laeufe wurde je etwas hochgeladen
rmArbeitsdir(); // nur das eigene Temp-Verzeichnis

console.log(ok
  ? 'P5 CHECKS BESTANDEN — Manifest-Pflicht, Mock-Backup, Dry-Run=0 Uploads, Backup-Regel (BLOCKED), --execute ohne Creds blockiert, Resume.'
  : 'P5 CHECKS FEHLGESCHLAGEN');
process.exit(ok ? 0 : 1);
