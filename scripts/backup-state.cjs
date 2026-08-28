'use strict';
// Z3 (2026-08-28): Sichert den unwiederbringlichen Projektzustand ins PRIVATE
// State-Repo (dimensionwithin/thumbnail-agent-state) und pusht.
//
// Laeuft NACH dem Wochenlauf und IMMER -- auch wenn der Wochenlauf abgebrochen
// ist (AD3): dann ist der Stand erst recht schuetzenswert. Der eigentliche Job
// ist die Playlist-Pflege; dieses Skript ist Beiwerk und beendet sich deshalb
// IMMER mit Exit-Code 0 (AD2). Ein Fehler wird ausschliesslich als deutliche
// Zeile in backups/livestream-weekly-LAST.txt gemeldet.
//
// Warum diese sieben Dateien: sie stehen im oeffentlichen Hauptrepo unter
// .gitignore und waeren bei Plattenverlust NICHT aus der YouTube-API
// rekonstruierbar. Begruendung je Datei in der README des State-Repos.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config();

const ROOT = path.resolve(__dirname, '..');
// Pfad zum privaten State-Repo. Bewusst NICHT hier hartkodiert: dieses Repo ist
// oeffentlich, und ein lokaler Laufwerkspfad gehoert niemandem ausser dem
// Betreiber. Ohne STATE_REPO_DIR wird sauber uebersprungen statt geraten.
const TARGET = (process.env.STATE_REPO_DIR || '').trim();
const LAST_FILE = path.join(ROOT, 'backups', 'livestream-weekly-LAST.txt');

// Positivliste -- NUR diese Dateien werden angefasst. Kein Glob, kein
// Ordner-Sync: so kann weder .env noch .youtube-token.json mitrutschen.
const FILES = [
  'data/series-registry.json',
  'data/livestream-catalog.json',
  'data/livestream-headlines.json',
  'fixtures/ic-numbering-exclude.txt',
  'fixtures/members-only-exclude.txt',
  'fixtures/premieres-exclude.txt',
  'fixtures/member-meeting-dates.txt',
];

const VERBOTEN_NAMEN = /(\.env|token|secret|credential|\.pem|\.key|\.npmrc|id_rsa)/i;
const VERBOTEN_INHALT = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'Anthropic-API-Key'],
  [/ya29\.[A-Za-z0-9_-]{20,}/, 'Google-Access-Token'],
  [/1\/\/[A-Za-z0-9_-]{20,}/, 'Google-Refresh-Token'],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, 'Google-Client-Secret'],
  [/AIza[A-Za-z0-9_-]{30,}/, 'Google-API-Key'],
  [/[0-9]{10,}-[a-z0-9]{32}\.apps\.googleusercontent\.com/, 'Google-Client-ID'],
  [/"(access_token|refresh_token|client_secret|private_key|api_key)"\s*:/, 'Token-/Secret-Feld'],
  [/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/, 'privater Schluessel'],
];

const SERIES = ['innercircle', 'livestream', 'standard'];

function meldung(zeile) {
  const stamp = new Date().toISOString();
  try {
    fs.appendFileSync(LAST_FILE, `\nBackup ${stamp}: ${zeile}\n`, 'utf8');
  } catch (e) {
    console.error('LAST.txt nicht schreibbar:', e.message);
  }
  console.log(zeile);
}

function git(...args) {
  return execFileSync('git', ['-C', TARGET, ...args], { encoding: 'utf8' });
}

// --- Kennzahlen fuer die automatische Commit-Nachricht (AD4) ---------------
function kennzahlen(dir, istZiel) {
  const lies = (name) => {
    const p = istZiel ? path.join(dir, path.basename(name)) : path.join(dir, name);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
  };
  const k = {};
  const reg = lies('data/series-registry.json');
  if (reg) {
    const r = JSON.parse(reg);
    const counters = (r.lastAssigned && Number.isFinite(r.lastAssigned.number))
      ? { innercircle: r.lastAssigned } : (r.lastAssigned || {});
    for (const s of SERIES) {
      const entries = r[s] || [];
      const maxEntry = Math.max(0, ...entries.map(e => e.number || 0));
      const c = counters[s];
      const cn = (c && Number.isFinite(c.number)) ? c.number : 0;
      k[`${s}.eintraege`] = entries.length;
      k[`${s}.frei`] = Math.max(maxEntry, cn) + 1;
      k[`${s}.zaehler`] = cn;
    }
  }
  const cat = lies('data/livestream-catalog.json');
  if (cat) k['katalog.eintraege'] = (JSON.parse(cat).items || []).length;
  const hl = lies('data/livestream-headlines.json');
  if (hl) k['headlines.eintraege'] = Object.keys(JSON.parse(hl).headlines || {}).length;
  for (const f of FILES.filter(f => f.endsWith('.txt'))) {
    const t = lies(f);
    if (t !== null) {
      k[path.basename(f)] = t.split(/\r?\n/)
        .filter(l => l.trim() && !l.trim().startsWith('#')).length;
    }
  }
  return k;
}

function zusammenfassung(vorher, nachher) {
  const zeilen = [];
  const label = {
    'innercircle.eintraege': 'innercircle', 'livestream.eintraege': 'livestream',
    'standard.eintraege': 'standard', 'katalog.eintraege': 'Katalog',
    'headlines.eintraege': 'Headlines',
  };
  for (const [key, name] of Object.entries(label)) {
    const a = vorher[key], b = nachher[key];
    if (a === undefined && b === undefined) continue;
    if (a !== b) zeilen.push(`${name} ${a === undefined ? 'neu' : a} -> ${b} Eintraege`);
  }
  for (const s of SERIES) {
    const a = vorher[`${s}.zaehler`], b = nachher[`${s}.zaehler`];
    if (a !== b && b !== undefined) zeilen.push(`${s} Zaehler ${a === undefined ? 'neu' : a} -> ${b}`);
  }
  for (const f of FILES.filter(f => f.endsWith('.txt'))) {
    const n = path.basename(f);
    const a = vorher[n], b = nachher[n];
    if (a !== b && b !== undefined) zeilen.push(`${n} ${a === undefined ? 'neu' : a} -> ${b} Eintraege`);
  }
  return zeilen;
}

// --- Hauptlauf -------------------------------------------------------------
function main() {
  if (!TARGET) {
    meldung('BACKUP UEBERSPRUNGEN -- STATE_REPO_DIR ist nicht gesetzt (siehe .env.example).');
    return;
  }
  if (!fs.existsSync(path.join(TARGET, '.git'))) {
    meldung(`BACKUP UEBERSPRUNGEN -- ${TARGET} ist kein Git-Repo.`);
    return;
  }

  // Sicherheitspruefung VOR jedem Schreibvorgang.
  for (const rel of FILES) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) { meldung(`BACKUP ABGEBROCHEN -- ${rel} fehlt.`); return; }
    if (VERBOTEN_NAMEN.test(path.basename(rel))) {
      meldung(`BACKUP ABGEBROCHEN -- Dateiname ${rel} sieht nach Credentials aus.`); return;
    }
    const text = fs.readFileSync(src, 'utf8');
    for (const [pat, name] of VERBOTEN_INHALT) {
      if (pat.test(text)) { meldung(`BACKUP ABGEBROCHEN -- ${rel} enthaelt offenbar ${name}.`); return; }
    }
  }

  const vorher = kennzahlen(TARGET, true);
  for (const rel of FILES) {
    fs.copyFileSync(path.join(ROOT, rel), path.join(TARGET, path.basename(rel)));
  }
  const nachher = kennzahlen(ROOT, false);

  git('add', '-A');
  const staged = git('diff', '--cached', '--name-only').split(/\r?\n/).filter(Boolean);

  // AD2: keine Aenderung -> kein Leer-Commit.
  if (staged.length === 0) {
    meldung('nichts zu sichern (keine Datei geaendert).');
    return;
  }
  // Zweite Verteidigungslinie: was da wirklich gestaged wurde.
  const erlaubt = new Set(FILES.map(f => path.basename(f)).concat(['README.md']));
  const fremd = staged.filter(n => !erlaubt.has(n) || VERBOTEN_NAMEN.test(n));
  if (fremd.length) {
    try { git('reset'); } catch (e) { /* Staging zurueckdrehen, sonst nichts */ }
    meldung(`BACKUP ABGEBROCHEN -- unerwartete Datei im Staging: ${fremd.join(', ')}`);
    return;
  }

  const zeilen = zusammenfassung(vorher, nachher);
  const datum = new Date().toISOString().slice(0, 10);
  const msg = [
    `Backup ${datum}`,
    '',
    ...(zeilen.length ? zeilen : ['Inhaltliche Aenderung ohne Kennzahlensprung.']),
    '',
    `Geaenderte Dateien: ${staged.join(', ')}`,
    'Automatisch nach dem Wochenlauf erzeugt (scripts/backup-state.cjs).',
    '',
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>',
    '',
  ].join('\n');

  try {
    execFileSync('git', ['-C', TARGET, 'commit', '-F', '-'], { input: msg, encoding: 'utf8' });
  } catch (e) {
    meldung(`BACKUP-COMMIT FEHLGESCHLAGEN -- ${(e.message || '').split('\n')[0]}`);
    return;
  }
  const sha = git('rev-parse', '--short', 'HEAD').trim();

  try {
    execFileSync('git', ['-C', TARGET, 'push'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    const detail = ((e.stderr || '') + (e.message || '')).split('\n')[0].slice(0, 160);
    meldung(`BACKUP-PUSH FEHLGESCHLAGEN -- Commit ${sha} liegt LOKAL in ${TARGET}, bitte von Hand pushen. (${detail})`);
    return;
  }
  meldung(`gesichert und gepusht (${sha}): ${zeilen.join('; ') || staged.join(', ')}`);
}

try {
  main();
} catch (e) {
  // AD2: nichts darf den Wochenlauf rot machen.
  meldung(`BACKUP FEHLGESCHLAGEN -- unerwarteter Fehler: ${(e.message || String(e)).split('\n')[0]}`);
}
process.exit(0);
