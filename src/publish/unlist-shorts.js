'use strict';

// KANAL-REWORK / Shorts-Unlisting: Alle SHORTS, die VOR 2026-01-01 (00:00 UTC)
// veroeffentlicht wurden, auf "unlisted" setzen (videos.update status.privacyStatus).
//
// Baut auf der bestehenden Infrastruktur auf (gleiche Auth, gleiche Backup-/Dry-Run-/
// Progress-Konventionen wie publish.js / backup.js / restore.js).
//
// SICHERHEIT (identisch zur etablierten Linie):
//  - DEFAULT ist Dry-Run: listet nur auf, was geaendert WUERDE. Ruft NIE videos.update.
//  - Echte Aenderung NUR mit --execute UND interaktiver Bestaetigung (Tippen von "AUSFUEHREN").
//  - VOR jeder Aenderung wird ein CSV-Log in backups/ geschrieben (alter Status je Video)
//    -> die ganze Aktion ist vollstaendig rueckgaengig zu machen (siehe --restore weiter unten).
//  - Fortschritts-Log mit Wiederaufnahme nach Abbruch (erledigte Videos werden uebersprungen).
//  - Rate-Limit/Quota: Retry mit exponentiellem Backoff; bei Quota-Fehler sauberer Abbruch.
//
// SHORTS-ERKENNUNG (kein API-Flag, daher Heuristik — NICHT 100% perfekt, wird gemeldet):
//  1. contentDetails.duration <= SHORT_CERTAIN_SEC (60s)  -> sicher Short.
//  2. Graubereich 60s < duration <= MAX_SHORT_SEC (180s)  -> Cross-Check:
//     HTTP-Status von https://www.youtube.com/shorts/<id> OHNE Redirect:
//       200          -> Short
//       30x -> /watch -> KEIN Short (kurzes Normalvideo)
//  3. duration > MAX_SHORT_SEC -> kein Short.
//
// QUELLE DER WAHRHEIT: data/inventory.json (bereits klassifiziert: Datum, privacyStatus,
// isLivestream, inInnerCircle, inDebunked). Dauer fehlt dort -> nur fuer die uebrig
// bleibenden Kandidaten live nachgeladen (videos.list part=contentDetails,snippet,status).
//
// AUSSCHLUESSE (wie im Projekt etabliert, werden NUR gemeldet, NIE angefasst):
//  - privacyStatus 'private' (so erscheinen members-only Videos).
//  - bereits 'unlisted'.
//  - kuratierte Sets: Inner Circle (inInnerCircle), DEBUNKED (inDebunked),
//    Livestreams (isLivestream) sowie alles im Livestream-Katalog (livestream-catalog.json).
//
// Flags:
//   (kein Flag)        Dry-Run (Plan + CSV-Vorschau, 0 Aenderungen).
//   --execute          Echte Aenderung — verlangt Credentials + Bestaetigung "AUSFUEHREN".
//   --inventory=PATH   Inventar (Default: data/inventory.json).
//   --catalog=PATH     Livestream-Katalog (Default: data/livestream-catalog.json).
//   --out=DIR          Backup-/Log-Verzeichnis (Default: backups).
//   --limit=N          Maximal N Kandidaten inspizieren (Default: alle).
//   --batch=N          Batch-Groesse fuer Updates (Default: 5).
//   --delay=MS         Pause zwischen Updates (Default: 1500).
//   --yes              Bestaetigung ueberspringen (nicht-interaktiv); ohne --execute wirkungslos.
//   --restore=CSV      ROLLBACK: setzt die in der CSV protokollierten Videos auf ihren
//                      alten Status zurueck (verlangt ebenfalls --execute + "AUSFUEHREN").

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

// --- Konstanten (oben, wie gefordert) ---
const MAX_SHORT_SEC = 180;       // Shorts seit Okt 2024 bis 3 Min moeglich; aeltere oft <=60.
const SHORT_CERTAIN_SEC = 60;    // <= 60s: ohne URL-Check sicher als Short gewertet.
const CUTOFF_ISO = '2026-01-01T00:00:00Z';
const CUTOFF = Date.parse(CUTOFF_ISO);
const TARGET_STATUS = 'unlisted';

// Quota-Schaetzung (YouTube Data API v3 Kosten):
const COST_LIST = 1;             // videos.list je Call (bis 50 IDs).
const COST_UPDATE = 50;          // videos.update je Video.

function parseArgs(argv) {
  const a = {
    execute: false, inventory: 'data/inventory.json', catalog: 'data/livestream-catalog.json',
    out: 'backups', limit: Infinity, batch: 5, delay: 1500, yes: false, restore: null,
  };
  for (const t of argv.slice(2)) {
    if (t === '--execute') a.execute = true;
    else if (t === '--yes') a.yes = true;
    else if (t.startsWith('--inventory=')) a.inventory = t.slice(12);
    else if (t.startsWith('--catalog=')) a.catalog = t.slice(10);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
    else if (t.startsWith('--limit=')) a.limit = Number(t.slice(8)) || Infinity;
    else if (t.startsWith('--batch=')) a.batch = Math.max(1, Number(t.slice(8)) || 5);
    else if (t.startsWith('--delay=')) a.delay = Math.max(0, Number(t.slice(8)) || 0);
    else if (t.startsWith('--restore=')) a.restore = t.slice(10);
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

// ISO-8601-Dauer (PT#H#M#S) -> Sekunden. Live-/Sonderfaelle (z.B. "P0D") -> null.
function durationToSeconds(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = Number(m[1] || 0), min = Number(m[2] || 0), s = Number(m[3] || 0);
  return h * 3600 + min * 60 + s;
}

// Graubereich-Cross-Check: HTTP-Status von /shorts/<id> OHNE Redirect zu folgen.
// 200 -> Short; 30x -> kein Short. Rueckgabe: { isShort: bool|null, code }.
// null = nicht eindeutig (Netzfehler/Timeout) -> konservativ NICHT als Short werten.
function checkShortsUrl(id) {
  return new Promise(resolve => {
    const req = https.get(`https://www.youtube.com/shorts/${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; adw-rework/1.0)' },
      // Wichtig: KEIN automatisches Folgen von Redirects (Node folgt von sich aus nicht).
    }, res => {
      const code = res.statusCode;
      res.resume(); // Body verwerfen.
      if (code === 200) resolve({ isShort: true, code });
      else if (code >= 300 && code < 400) resolve({ isShort: false, code });
      else resolve({ isShort: null, code });
    });
    req.setTimeout(10000, () => { req.destroy(); resolve({ isShort: null, code: 'timeout' }); });
    req.on('error', () => resolve({ isShort: null, code: 'error' }));
  });
}

// videos.list in 50er-Batches: contentDetails (Dauer), snippet (Datum/Titel), status (Privacy).
async function fetchVideoDetails(yt, ids, onListCall) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await yt.videos.list({ part: ['contentDetails', 'snippet', 'status'], id: chunk, maxResults: 50 });
    if (onListCall) onListCall();
    for (const v of res.data.items || []) {
      map.set(v.id, {
        id: v.id,
        title: v.snippet && v.snippet.title,
        publishedAt: v.snippet && v.snippet.publishedAt,
        durationSec: durationToSeconds(v.contentDetails && v.contentDetails.duration),
        durationIso: v.contentDetails && v.contentDetails.duration,
        status: v.status || {},
      });
    }
  }
  return map;
}

// CSV-Helfer (minimal, RFC-konform genug: Felder mit , " \n werden gequotet).
function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvCell).join(',') + '\n'; }

const CSV_HEADER = ['videoId', 'oldStatus', 'newStatus', 'title', 'date', 'durationSec', 'shortCheck'];

function parseCsv(text) {
  // Einfacher Parser fuer unsere eigene, wohlgeformte CSV (Header + Zeilen).
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

// videos.update mit Retry/Backoff. Liefert true bei Erfolg; wirft bei Quota-Fehler
// einen Fehler mit .quota=true zum sauberen Abbruch.
async function updatePrivacy(yt, id, oldStatusObj, newPrivacy) {
  // Vollstaendiges status-Objekt erhalten und nur privacyStatus aendern (sonst koennten
  // andere status-Felder zurueckgesetzt werden). Nur die schreibbaren Felder senden.
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
      const backoff = Math.min(30000, 1000 * Math.pow(2, attempt)); // 2s,4s,8s,16s,30s
      console.log(`    Rate-Limit (${reason || code}) — Retry ${attempt}/${maxAttempts - 1} in ${backoff}ms ...`);
      await sleep(backoff);
    }
  }
}

// ---------------------------------------------------------------------------
// PLAN bauen: aus dem Inventar Kandidaten ableiten, dann Dauer live nachladen.
// ---------------------------------------------------------------------------
async function buildPlan(args, yt, counters) {
  const invPath = path.resolve(args.inventory);
  const inv = loadJSON(invPath, null);
  if (!inv || !Array.isArray(inv.items)) throw new Error(`Inventar nicht lesbar: ${invPath} (erst \`npm run inventory\`).`);
  const catPath = path.resolve(args.catalog);
  const cat = loadJSON(catPath, null);
  const catSet = new Set(((cat && cat.items) || []).map(i => i.videoId));

  const report = { checked: 0, excludedPrivate: 0, excludedUnlisted: 0, excludedCurated: 0, postCutoff: 0, notShort: 0, inconclusive: [] };
  const curatedHits = []; // nur Meldung

  // 1) Aus dem Inventar: pre-2026, nicht privat, nicht kuratiert, aktuell public -> inspizieren.
  const toInspect = [];
  for (const it of inv.items) {
    const t = Date.parse(it.publishedAt);
    if (!(t < CUTOFF)) { report.postCutoff++; continue; }      // Datumsfilter
    if (it.privacyStatus === 'private') { report.excludedPrivate++; continue; }
    const curated = it.inInnerCircle || it.inDebunked || it.isLivestream || catSet.has(it.videoId);
    if (curated) {
      report.excludedCurated++;
      curatedHits.push({ id: it.videoId, title: it.title, why: it.inInnerCircle ? 'innercircle' : it.inDebunked ? 'debunked' : 'livestream' });
      continue;
    }
    if (it.privacyStatus === 'unlisted') { report.excludedUnlisted++; continue; } // bereits Ziel-Status
    toInspect.push(it.videoId);
  }
  let inspectIds = toInspect;
  if (Number.isFinite(args.limit)) inspectIds = inspectIds.slice(0, args.limit);

  // 2) Dauer + LIVE-Status fuer die Kandidaten holen (Inventar-Status ist evtl. veraltet).
  const details = await fetchVideoDetails(yt, inspectIds, () => { counters.listCalls++; });

  // 3) Shorts-Entscheidung (inkl. Graubereich-URL-Check).
  const targets = [];
  for (const id of inspectIds) {
    const d = details.get(id);
    if (!d) { report.inconclusive.push({ id, why: 'keine Metadaten (geloescht/kein Zugriff)' }); continue; }
    report.checked++;
    // LIVE-Re-Checks (Status kann sich seit dem Inventar geaendert haben).
    if (Date.parse(d.publishedAt) >= CUTOFF) { report.postCutoff++; continue; }
    const live = d.status.privacyStatus;
    if (live === 'private') { report.excludedPrivate++; continue; }
    if (live === 'unlisted') { report.excludedUnlisted++; continue; }
    if (live !== 'public') { report.inconclusive.push({ id, why: 'unerwarteter Status ' + live }); continue; }

    const sec = d.durationSec;
    let isShort = false, check = '';
    if (sec === null) {
      report.inconclusive.push({ id, title: d.title, why: 'Dauer nicht parsebar (' + d.durationIso + ')' });
      continue;
    } else if (sec <= SHORT_CERTAIN_SEC) {
      isShort = true; check = `duration<=${SHORT_CERTAIN_SEC}s (${sec}s)`;
    } else if (sec <= MAX_SHORT_SEC) {
      const r = await checkShortsUrl(id);
      counters.urlChecks++;
      if (r.isShort === true) { isShort = true; check = `shorts-url:200 (${sec}s)`; }
      else if (r.isShort === false) { isShort = false; check = `shorts-url:${r.code}->kein Short (${sec}s)`; }
      else { report.inconclusive.push({ id, title: d.title, why: `shorts-url unklar (${r.code}), ${sec}s` }); continue; }
    } else {
      isShort = false; check = `duration>${MAX_SHORT_SEC}s (${sec}s)`;
    }

    if (!isShort) { report.notShort++; continue; }
    targets.push({
      id, title: d.title, date: (d.publishedAt || '').slice(0, 10),
      durationSec: sec, oldStatus: live, newStatus: TARGET_STATUS, check,
      statusObj: d.status,
    });
  }

  return { targets, report, curatedHits, inspectCount: inspectIds.length };
}

// ---------------------------------------------------------------------------
// ROLLBACK aus einer CSV (--restore).
// ---------------------------------------------------------------------------
async function runRestore(args) {
  const csvPath = path.resolve(args.restore);
  if (!fs.existsSync(csvPath)) throw new Error(`Restore-CSV nicht gefunden: ${csvPath}`);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const restorable = rows.filter(r => r.videoId && r.oldStatus && r.oldStatus !== r.newStatus);
  console.log(`ROLLBACK aus: ${csvPath}`);
  console.log(`Modus:   ${args.execute ? 'EXECUTE (echte Wiederherstellung angefordert)' : 'DRY-RUN (Plan, keine Aenderungen)'}`);
  console.log(`Zeilen:  ${rows.length} | wiederherstellbar: ${restorable.length}\n`);
  for (const r of restorable) console.log(`  [PLAN ] ${r.videoId}  ${r.newStatus} -> ${r.oldStatus}   ${r.title}`);

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
      // Aktuelles status-Objekt holen, damit andere Felder erhalten bleiben.
      const cur = await fetchVideoDetails(yt, [r.videoId]);
      const s = (cur.get(r.videoId) || {}).status || {};
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

// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const counters = { listCalls: 0, urlChecks: 0, updates: 0 };

  // Auth (Lesen reicht fuer den Plan; --execute prueft Credentials zusaetzlich).
  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('../youtube/auth');

  if (args.restore) {
    return runRestore(args);
  }

  if (!youtubeAvailable()) {
    console.error('Abbruch: kein OAuth-Token/Client-ID gefunden. Erst `npm run auth`.');
    process.exit(1);
  }
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  console.log(`Modus:    ${args.execute ? 'EXECUTE (echte Aenderung angefordert)' : 'DRY-RUN (Plan + CSV-Vorschau, keine Aenderungen)'}`);
  console.log(`Cutoff:   publishedAt < ${CUTOFF_ISO}`);
  console.log(`Shorts:   <=${SHORT_CERTAIN_SEC}s sicher | ${SHORT_CERTAIN_SEC}-${MAX_SHORT_SEC}s via /shorts/<id>-Check | >${MAX_SHORT_SEC}s kein Short`);
  console.log('HINWEIS:  Shorts-Erkennung ist heuristisch und NICHT 100% perfekt.\n');

  const { targets, report, curatedHits, inspectCount } = await buildPlan(args, yt, counters);

  console.log(`Inventar-Kandidaten (pre-2026, public, nicht kuratiert): ${inspectCount}`);
  console.log(`Davon live geprueft: ${report.checked}\n`);

  for (const t of targets) {
    console.log(`  [SHORT] ${t.id}  ${t.date}  ${String(t.durationSec).padStart(3)}s  ${t.oldStatus} -> ${t.newStatus}  | ${t.check}`);
    console.log(`          ${t.title}`);
  }

  console.log(`\n--- Zusammenfassung ---`);
  console.log(`Als Short erkannt & WUERDE geaendert: ${targets.length}`);
  console.log(`Kein Short (Dauer/URL):              ${report.notShort}`);
  console.log(`Uebersprungen — bereits unlisted:    ${report.excludedUnlisted}`);
  console.log(`Uebersprungen — private:             ${report.excludedPrivate}`);
  console.log(`Uebersprungen — kuratiert (IC/DEBUNKED/Livestream): ${report.excludedCurated}`);
  console.log(`Ausserhalb Zeitraum (>= Cutoff):     ${report.postCutoff}`);
  if (report.inconclusive.length) {
    console.log(`\nUNKLAR (NICHT angefasst, bitte manuell pruefen): ${report.inconclusive.length}`);
    for (const u of report.inconclusive) console.log(`  ? ${u.id} ${u.title ? '— ' + u.title : ''} (${u.why})`);
  }

  // Quota-Schaetzung loggen.
  const estUpdate = targets.length * COST_UPDATE;
  const estList = counters.listCalls * COST_LIST;
  console.log(`\nQuota-Schaetzung: videos.list ~${estList} (${counters.listCalls} Calls) + videos.update ~${estUpdate} (${targets.length}x${COST_UPDATE}) = ~${estList + estUpdate} Einheiten. URL-Checks: ${counters.urlChecks} (keine Quota).`);

  // CSV-Log schreiben (VOR jeder Aenderung -> Reversibilitaet). Auch im Dry-Run als Vorschau.
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `unlist-shorts-${stamp}.csv`);
  let csv = csvRow(CSV_HEADER);
  for (const t of targets) csv += csvRow([t.id, t.oldStatus, t.newStatus, t.title, t.date, t.durationSec, t.check]);
  fs.writeFileSync(csvPath, csv);
  console.log(`\nCSV-Log (Rollback-Quelle): ${csvPath}`);

  if (!args.execute) {
    console.log('\nDRY-RUN — es wurde KEIN videos.update aufgerufen.');
    console.log('Echter Lauf: --execute  (danach Bestaetigung "AUSFUEHREN" tippen).');
    console.log(`Rollback spaeter: node src/publish/unlist-shorts.js --restore=${path.relative(process.cwd(), csvPath)} --execute`);
    console.log('CHANGED: 0');
    return;
  }

  // --- EXECUTE-Pfad ---
  if (targets.length === 0) { console.log('\nNichts zu aendern (0 Shorts).'); console.log('CHANGED: 0'); return; }
  if (!args.yes) {
    const ans = await ask(`\nWirklich ${targets.length} Short(s) am LIVE-Kanal auf "${TARGET_STATUS}" setzen? Tippe "AUSFUEHREN" zum Bestaetigen: `);
    if (ans.trim() !== 'AUSFUEHREN') { console.log('Abgebrochen — keine Bestaetigung.'); console.log('CHANGED: 0'); return; }
  }

  // Fortschritt fuer Wiederaufnahme.
  const progressPath = path.join(outDir, 'unlist-shorts-progress.json');
  const progress = loadJSON(progressPath, { done: [] });
  const doneSet = new Set(progress.done || []);
  const persist = () => fs.writeFileSync(progressPath, JSON.stringify({ done: Array.from(doneSet), updatedAt: new Date().toISOString() }, null, 2));

  let changed = 0;
  const todo = targets.filter(t => !doneSet.has(t.id));
  if (todo.length < targets.length) console.log(`Wiederaufnahme: ${targets.length - todo.length} bereits erledigt, ${todo.length} offen.`);

  for (let i = 0; i < todo.length; i += args.batch) {
    const batch = todo.slice(i, i + args.batch);
    console.log(`\nBatch ${Math.floor(i / args.batch) + 1}: ${batch.map(b => b.id).join(', ')}`);
    for (const t of batch) {
      try {
        await updatePrivacy(yt, t.id, t.statusObj, TARGET_STATUS);
        counters.updates++; changed++;
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
  console.log(`Rollback: node src/publish/unlist-shorts.js --restore=${path.relative(process.cwd(), csvPath)} --execute`);
}

if (require.main === module) {
  main().catch(e => { console.error('unlist-shorts fehlgeschlagen:', e.message); console.log('CHANGED: 0'); process.exit(1); });
}

module.exports = { parseArgs, durationToSeconds, checkShortsUrl, buildPlan, youtubeAvailable };
