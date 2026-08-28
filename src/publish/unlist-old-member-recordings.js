'use strict';

// SCHRITT 3 (Alt-Mitglieder-Meetings-Aufzeichnungen): setzt GENAU die 42 vom
// Nutzer freigegebenen alten Skool-Meeting-Aufzeichnungen (Juni-Dezember 2025,
// aktuell privacyStatus=public, alle in INNER_CIRCLE_PLAYLIST_ID) von "public"
// auf "unlisted". Baut auf der Freigabeliste aus Schritt 2 auf
// (backups/freigabeliste-44-alt.csv, N2 im Auftrag).
//
// BL1 (2026-08-28): Die Liste steht nicht mehr im Quelltext, sondern in
// fixtures/old-member-recordings.txt (gitignored). Dieses Repo ist oeffentlich
// und die Videos sind unlisted -- siehe docs/warum-keine-video-ids-im-repo.md.
//
// BEWUSST KEINE DYNAMISCHE KANDIDATEN-ERMITTLUNG: Die Zielmenge ist eine feste
// Liste von genau 42 videoIds -- exakt die vom Nutzer freigegebene Freigabeliste,
// keine Wiederholung von Uploads-Read/
// IC-Playlist-Scan/HTTP-Check. Das verhindert, dass ein spaeterer Kanal-Zustand
// (neue Uploads, geaenderte IC-Playlist) versehentlich zusaetzliche Videos in
// den Lauf hineinzieht. "Aendere AUSSCHLIESSLICH diese 42" ist damit strukturell
// durchgesetzt, nicht nur per Doku.
//
// Die zwei ALTEN echten Livestreams aus Schritt 1 stehen bereits auf "unlisted"
// und werden hier NICHT angefasst -- sie sind nicht Teil der 42. Ihre Pflege in
// fixtures/members-only-exclude.txt erfolgt separat manuell (nur Kommentar
// ergaenzen, siehe Auftrag O2); die videoIds stehen dort, nicht hier.
//
// BEKANNTER BEFUND (2026-08-25, echter --execute-Lauf gegen alle 42): videos.update
// scheitert fuer JEDES mitgliedergesperrte Video zuverlaessig mit HTTP 403,
// reason "forbiddenPrivacySetting" ("The request attempts to set an invalid
// privacy setting for the video."). Ursache: Die "Nur fuer Mitglieder"-Sperre ist
// ein eigenes, von privacyStatus GETRENNTES YouTube-Flag, das die Data API v3
// nicht offenlegt und dessen Aenderung sie aktiv blockiert, solange das Flag
// aktiv ist (siehe auch fixtures/members-only-exclude.txt, Kopfkommentar). DAS
// IST KEIN BUG UND KEINE TRANSIENTE EINSCHRAENKUNG -- kein spaeterer Automatisie-
// rungslauf sollte das erneut versuchen. Die Sperre kann NUR MANUELL in YouTube
// Studio entfernt werden (Inhalte -> Videos -> Filter Sichtbarkeit "Nur fuer
// Mitglieder"). Arbeitsliste dafuer: backups/manuell-studio-42.md. Nach manueller
// Umstellung: --verify-unlisted (siehe unten) bestaetigt den neuen Live-Status,
// bevor die Ausschlussdatei gepflegt wird.
//
// SICHERHEIT (identisch zur etablierten Linie aus src/publish/unlist-shorts.js):
//  - DEFAULT ist Dry-Run: listet nur auf, was geaendert WUERDE. Ruft NIE videos.update.
//  - Echte Aenderung NUR mit --execute UND interaktiver Bestaetigung ("AUSFUEHREN").
//  - VOR jeder Aenderung wird ein CSV-Log in backups/ geschrieben (alter Status je
//    Video) -> vollstaendig per --restore rueckgaengig zu machen.
//  - Live-Check VOR jedem Update: nur wenn privacyStatus aktuell noch "public" ist,
//    wird geaendert. Videos, die (aus welchem Grund auch immer) nicht mehr public
//    sind, werden uebersprungen und gemeldet -- kein Ueberschreiben unerwarteten Zustands.
//  - Fortschritts-Log mit Wiederaufnahme nach Abbruch (erledigte Videos werden uebersprungen).
//  - Rate-Limit/Quota: Retry mit exponentiellem Backoff; bei Quota-Fehler sauberer Abbruch
//    mit Resume-Hinweis.
//
// Flags:
//   (kein Flag)   Dry-Run (Plan + CSV-Vorschau, 0 Aenderungen).
//   --execute     Echte Aenderung -- verlangt Credentials + Bestaetigung "AUSFUEHREN".
//   --yes         Bestaetigung ueberspringen (nicht-interaktiv); ohne --execute wirkungslos.
//   --out=DIR     Backup-/Log-Verzeichnis (Default: backups).
//   --batch=N     Batch-Groesse fuer Updates (Default: 5).
//   --delay=MS    Pause zwischen Updates (Default: 1500).
//   --restore=CSV ROLLBACK: setzt die in der CSV protokollierten Videos auf ihren
//                 alten Status zurueck (verlangt ebenfalls --execute + "AUSFUEHREN").
//   --verify-unlisted  Reiner Lese-Check (kein --execute noetig): prueft live per
//                 videos.list, wie viele der 42 TARGETS bereits "unlisted" sind
//                 (nach manueller Umstellung in YouTube Studio) und welche noch
//                 offen (weiterhin "public") sind. Schreibt keine CSV, aendert nichts.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const TARGET_STATUS = 'unlisted';
const COST_UPDATE = 50; // videos.update je Video.

const TARGETS_FILE = path.resolve('fixtures', 'old-member-recordings.txt');

// Die Zielmenge steht bewusst NICHT im Quelltext, sondern in
// fixtures/old-member-recordings.txt (gitignored). Dieses Repo ist oeffentlich und
// die Videos sind unlisted -- eine unlisted videoId ist ein Zugriffsschluessel,
// siehe docs/warum-keine-video-ids-im-repo.md. Format wie die uebrigen
// Ausschlussdateien: eine videoId pro Zeile, Datum und Titel als Kommentar
// dahinter (videoId  # YYYY-MM-DD  Titel). Datum/Titel dienen nur der
// Nachvollziehbarkeit in den Reports -- ausgefuehrt wird nur anhand der videoId.
//
// BEWUSST KEINE DYNAMISCHE KANDIDATEN-ERMITTLUNG: die Zielmenge bleibt eine feste,
// vom Nutzer freigegebene Liste. Nur ihr Speicherort hat sich geaendert.
function loadTargets(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  if (!fs.existsSync(filePath)) {
    console.error(`ABBRUCH: ${rel} fehlt.`);
    console.error('Die Zielmenge liegt nicht im Quelltext (oeffentliches Repo, unlisted videoIds).');
    console.error('Datei aus dem privaten State-Repo zurueckholen (siehe scripts/backup-state.cjs).');
    console.error('Es wurde NICHTS geprueft und NICHTS geaendert.');
    process.exit(1);
  }
  const targets = [];
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const hash = raw.indexOf('#');
    const id = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    if (!id) continue;
    const comment = hash === -1 ? '' : raw.slice(hash + 1).trim();
    const m = /^(\d{4}-\d{2}-\d{2})\s+(.*)$/.exec(comment);
    targets.push({ id, date: m ? m[1] : '', title: m ? m[2].trim() : comment });
  }
  // Leere Liste NICHT durchwinken: der Lauf wuerde sonst faelschlich
  // "nichts zu tun" melden, statt auf die fehlenden Daten hinzuweisen.
  if (!targets.length) {
    console.error(`ABBRUCH: ${rel} enthaelt keine videoId.`);
    console.error('Mit leerer Zielmenge waere die Meldung "nichts zu tun" irrefuehrend.');
    process.exit(1);
  }
  return targets;
}
const TARGETS = loadTargets(TARGETS_FILE);

function parseArgs(argv) {
  const a = { execute: false, yes: false, out: 'backups', batch: 5, delay: 1500, restore: null, verifyUnlisted: false };
  for (const t of argv.slice(2)) {
    if (t === '--execute') a.execute = true;
    else if (t === '--yes') a.yes = true;
    else if (t === '--verify-unlisted') a.verifyUnlisted = true;
    else if (t.startsWith('--out=')) a.out = t.slice(6);
    else if (t.startsWith('--batch=')) a.batch = Math.max(1, Number(t.slice(8)) || 5);
    else if (t.startsWith('--delay=')) a.delay = Math.max(0, Number(t.slice(8)) || 0);
    else if (t.startsWith('--restore=')) a.restore = t.slice(10);
  }
  return a;
}

// --verify-unlisted: reiner Lese-Check der 42 TARGETS. Kein --execute noetig,
// keine Aenderung, keine CSV. Dient als Gegenprobe nach manueller Umstellung in
// YouTube Studio (siehe backups/manuell-studio-42.md), bevor die Ausschlussdatei
// gepflegt wird (P3/P4 im Auftrag).
async function runVerifyUnlisted(yt) {
  const ids = TARGETS.map(t => t.id);
  const statusMap = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await yt.videos.list({ part: ['status'], id: chunk, maxResults: 50 });
    for (const v of res.data.items || []) statusMap.set(v.id, v.status && v.status.privacyStatus);
  }

  const done = [];
  const open = [];
  const missing = [];
  for (const t of TARGETS) {
    if (!statusMap.has(t.id)) { missing.push(t); continue; }
    const live = statusMap.get(t.id);
    if (live === TARGET_STATUS) done.push({ ...t, live });
    else open.push({ ...t, live });
  }

  console.log(`Verifikation: ${TARGETS.length} Ziel-Videos live geprueft (nur videos.list, keine Aenderung).\n`);
  if (done.length) {
    console.log(`=== BEREITS ${TARGET_STATUS.toUpperCase()} (${done.length}) ===`);
    for (const d of done) console.log(`  [x] ${d.id}  ${d.date}  ${d.title}`);
  }
  if (open.length) {
    console.log(`\n=== NOCH OFFEN (${open.length}) ===`);
    for (const o of open) console.log(`  [ ] ${o.id}  ${o.date}  privacy=${o.live}  ${o.title}`);
  }
  if (missing.length) {
    console.log(`\n=== NICHT GEFUNDEN (${missing.length}) ===`);
    for (const m of missing) console.log(`  ? ${m.id}  ${m.date}  ${m.title}`);
  }

  console.log(`\n--- Zusammenfassung ---`);
  console.log(`Bereits ${TARGET_STATUS}: ${done.length}/${TARGETS.length}`);
  console.log(`Noch offen (public o.ae.): ${open.length}/${TARGETS.length}`);
  if (missing.length) console.log(`Nicht gefunden: ${missing.length}/${TARGETS.length}`);
  if (done.length === TARGETS.length) {
    console.log(`\nAlle ${TARGETS.length} sind umgestellt. Naechster Schritt: fixtures/members-only-exclude.txt pflegen (P3/O2).`);
  } else {
    console.log(`\nNoch nicht vollstaendig -- ${open.length} verbleiben in YouTube Studio umzustellen (siehe backups/manuell-studio-42.md).`);
  }
  console.log('VERIFIED_DONE: ' + done.length);
  console.log('VERIFIED_OPEN: ' + open.length);
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
    if (!process.stdin.isTTY) return resolve('');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvCell).join(',') + '\n'; }

const CSV_HEADER = ['videoId', 'oldStatus', 'newStatus', 'title', 'date'];

function parseCsv(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQ = false;
  const pushF = () => { row.push(field); field = ''; };
  const pushR = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { pushF(); i++; continue; }
    if (c === '\n') { pushF(); pushR(); i++; continue; }
    if (c === '\r') { i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { pushF(); pushR(); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter(r => r.length && r.some(x => x !== '')).map(r => {
    const o = {}; header.forEach((h, idx) => { o[h] = r[idx]; }); return o;
  });
}

// videos.update mit Retry/Backoff (identisch zum etablierten Muster).
async function updatePrivacy(yt, id, oldStatusObj, newPrivacy) {
  const s = oldStatusObj || {};
  const body = { privacyStatus: newPrivacy };
  if (s.license !== undefined) body.license = s.license;
  if (s.embeddable !== undefined) body.embeddable = s.embeddable;
  if (s.publicStatsViewable !== undefined) body.publicStatsViewable = s.publicStatsViewable;
  const sdmfk = s.selfDeclaredMadeForKids !== undefined ? s.selfDeclaredMadeForKids : s.madeForKids;
  if (sdmfk !== undefined) body.selfDeclaredMadeForKids = sdmfk;

  let attempt = 0;
  const maxAttempts = 5;
  for (;;) {
    try {
      await yt.videos.update({ part: ['status'], requestBody: { id, status: body } });
      return true;
    } catch (e) {
      const reason = (e && e.errors && e.errors[0] && e.errors[0].reason) || '';
      const code = e && e.code;
      const quota = reason === 'quotaExceeded' || reason === 'dailyLimitExceeded';
      if (quota) { const err = new Error('Quota erschoepft (' + reason + ')'); err.quota = true; throw err; }
      const retriable = code === 429 || code === 500 || code === 503 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      attempt++;
      if (!retriable || attempt >= maxAttempts) throw e;
      const backoff = Math.min(30000, 1000 * Math.pow(2, attempt));
      console.log(`    Rate-Limit (${reason || code}) — Retry ${attempt}/${maxAttempts - 1} in ${backoff}ms ...`);
      await sleep(backoff);
    }
  }
}

async function runRestore(args) {
  const csvPath = path.resolve(args.restore);
  if (!fs.existsSync(csvPath)) throw new Error(`Restore-CSV nicht gefunden: ${csvPath}`);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const restorable = rows.filter(r => r.videoId && r.oldStatus && r.oldStatus !== r.newStatus);
  console.log(`ROLLBACK aus: ${csvPath}`);
  console.log(`Modus:   ${args.execute ? 'EXECUTE (echte Wiederherstellung angefordert)' : 'DRY-RUN (Plan, keine Aenderungen)'}`);
  console.log(`Zeilen:  ${rows.length} | wiederherstellbar: ${restorable.length}\n`);
  for (const r of restorable) console.log(`  [PLAN] ${r.videoId}  ${r.newStatus} -> ${r.oldStatus}   ${r.title}`);

  if (!args.execute) { console.log('\nDRY-RUN — kein videos.update aufgerufen. Fuer echten Rollback: --execute'); console.log('CHANGED: 0'); return; }
  if (!youtubeAvailable()) { console.error('\nAbbruch: --execute verlangt YouTube-Credentials.'); console.log('CHANGED: 0'); process.exit(1); }
  if (restorable.length === 0) { console.log('Nichts wiederherzustellen.'); console.log('CHANGED: 0'); return; }
  if (!args.yes) {
    const ans = await ask(`\nWirklich ${restorable.length} Video(s) auf ihren alten Status zuruecksetzen? Tippe "AUSFUEHREN": `);
    if (ans.trim() !== 'AUSFUEHREN') { console.log('Abgebrochen — keine Bestaetigung.'); console.log('CHANGED: 0'); return; }
  }
  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('../youtube/auth');
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  let changed = 0;
  for (const r of restorable) {
    try {
      const cur = await yt.videos.list({ part: ['status'], id: [r.videoId] });
      const s = (cur.data.items && cur.data.items[0] && cur.data.items[0].status) || {};
      await updatePrivacy(yt, r.videoId, s, r.oldStatus);
      changed++;
      console.log(`  OK ${r.videoId} -> ${r.oldStatus} (${changed}/${restorable.length})`);
    } catch (e) {
      console.error(`  FEHLER ${r.videoId}: ${e.message}${e.quota ? ' (QUOTA — Abbruch)' : ''}`);
      if (e.quota) break;
    }
    if (args.delay) await sleep(args.delay);
  }
  console.log(`\nFertig. CHANGED: ${changed}`);
}

async function main() {
  const args = parseArgs(process.argv);

  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('../youtube/auth');

  if (args.restore) return runRestore(args);

  if (!youtubeAvailable()) {
    console.error('Abbruch: kein OAuth-Token/Client-ID gefunden. Erst `npm run auth`.');
    process.exit(1);
  }
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  if (args.verifyUnlisted) return runVerifyUnlisted(yt);

  console.log(`Modus:    ${args.execute ? 'EXECUTE (echte Aenderung angefordert)' : 'DRY-RUN (Plan + CSV-Vorschau, keine Aenderungen)'}`);
  console.log(`Ziel:     ${TARGETS.length} fest freigegebene alte Meeting-Aufzeichnungen -> ${TARGET_STATUS}`);
  console.log('HINWEIS:  Kandidatenliste ist hardcodiert (keine dynamische Neuermittlung).\n');

  // Live-Status ALLER 42 vorab pruefen (fuer Plan UND als Vorbedingung fuers Update).
  const ids = TARGETS.map(t => t.id);
  const statusMap = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await yt.videos.list({ part: ['status', 'snippet'], id: chunk, maxResults: 50 });
    for (const v of res.data.items || []) statusMap.set(v.id, v);
  }

  const plan = [];
  const skipped = [];
  for (const t of TARGETS) {
    const v = statusMap.get(t.id);
    if (!v) { skipped.push({ ...t, why: 'nicht gefunden (geloescht/kein Zugriff)' }); continue; }
    const live = v.status && v.status.privacyStatus;
    if (live !== 'public') { skipped.push({ ...t, why: `aktueller Status ist "${live}", nicht "public" — uebersprungen (kein Ueberschreiben unerwarteten Zustands)` }); continue; }
    plan.push({ ...t, oldStatus: live, statusObj: v.status });
  }

  for (const p of plan) console.log(`  [PLAN] ${p.id}  ${p.date}  public -> ${TARGET_STATUS}   ${p.title}`);
  if (skipped.length) {
    console.log(`\nUEBERSPRUNGEN (${skipped.length}):`);
    for (const s of skipped) console.log(`  ? ${s.id}  ${s.date}  ${s.title}  — ${s.why}`);
  }

  console.log(`\n--- Zusammenfassung ---`);
  console.log(`Freigegebene Zielmenge:  ${TARGETS.length}`);
  console.log(`WUERDE geaendert:        ${plan.length}`);
  console.log(`Uebersprungen:           ${skipped.length}`);
  console.log(`Quota-Schaetzung: videos.update ~${plan.length * COST_UPDATE} (${plan.length}x${COST_UPDATE}) Einheiten.`);

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `unlist-old-member-recordings-${stamp}.csv`);
  let csv = csvRow(CSV_HEADER);
  for (const p of plan) csv += csvRow([p.id, p.oldStatus, TARGET_STATUS, p.title, p.date]);
  fs.writeFileSync(csvPath, csv);
  console.log(`\nCSV-Log (Rollback-Quelle): ${csvPath}`);

  if (!args.execute) {
    console.log('\nDRY-RUN — es wurde KEIN videos.update aufgerufen.');
    console.log('Echter Lauf: --execute  (danach Bestaetigung "AUSFUEHREN" tippen).');
    console.log(`Rollback spaeter: node src/publish/unlist-old-member-recordings.js --restore=${path.relative(process.cwd(), csvPath)} --execute`);
    console.log('CHANGED: 0');
    return;
  }

  if (plan.length === 0) { console.log('\nNichts zu aendern.'); console.log('CHANGED: 0'); return; }
  if (!args.yes) {
    const ans = await ask(`\nWirklich ${plan.length} Video(s) am LIVE-Kanal auf "${TARGET_STATUS}" setzen? Tippe "AUSFUEHREN" zum Bestaetigen: `);
    if (ans.trim() !== 'AUSFUEHREN') { console.log('Abgebrochen — keine Bestaetigung.'); console.log('CHANGED: 0'); return; }
  }

  const progressPath = path.join(outDir, 'unlist-old-member-recordings-progress.json');
  const progress = loadJSON(progressPath, { done: [] });
  const doneSet = new Set(progress.done || []);
  const persist = () => fs.writeFileSync(progressPath, JSON.stringify({ done: Array.from(doneSet), updatedAt: new Date().toISOString() }, null, 2));

  let changed = 0;
  const todo = plan.filter(p => !doneSet.has(p.id));
  if (todo.length < plan.length) console.log(`Wiederaufnahme: ${plan.length - todo.length} bereits erledigt, ${todo.length} offen.`);

  for (let i = 0; i < todo.length; i += args.batch) {
    const batch = todo.slice(i, i + args.batch);
    console.log(`\nBatch ${Math.floor(i / args.batch) + 1}: ${batch.map(b => b.id).join(', ')}`);
    for (const t of batch) {
      try {
        await updatePrivacy(yt, t.id, t.statusObj, TARGET_STATUS);
        changed++;
        doneSet.add(t.id); persist();
        console.log(`  OK ${t.id} -> ${TARGET_STATUS} (${changed}/${todo.length})`);
      } catch (e) {
        if (e.quota) {
          console.error(`  QUOTA erschoepft bei ${t.id}: ${e.message} — sauberer Abbruch. Wiederaufnahme: erneut mit --execute starten (erledigte werden uebersprungen).`);
          console.log('CHANGED: ' + changed);
          process.exit(2);
        }
        console.error(`  FEHLER ${t.id}: ${e.message} — uebersprungen.`);
      }
      if (args.delay) await sleep(args.delay);
    }
  }

  console.log(`\nFertig. CHANGED: ${changed}`);
  console.log(`Rollback: node src/publish/unlist-old-member-recordings.js --restore=${path.relative(process.cwd(), csvPath)} --execute`);
}

if (require.main === module) {
  main().catch(e => { console.error('unlist-old-member-recordings fehlgeschlagen:', e.message); console.log('CHANGED: 0'); process.exit(1); });
}

module.exports = { parseArgs, TARGETS, youtubeAvailable };
