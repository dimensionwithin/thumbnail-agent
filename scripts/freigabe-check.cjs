'use strict';

// CY Teil C.1: Freigabe-Check vor dem Commit.
//
// Dieses Repo ist OEFFENTLICH (siehe docs/warum-keine-video-ids-im-repo.md). Eine
// ungelistete videoId ist ein Zugriffsschluessel, kein Bezeichner. Geprueft wird
// deshalb jede Datei, die in den Commit soll, gegen:
//   1. videoIds nicht-oeffentlicher Videos (aus den Messdaten und der .env)
//   2. absolute Pfade dieses Rechners
//   3. Playlist- und Kanal-IDs
//   4. Tokens und Geheimnisse
//   5. .env-Schluessel, die als Vorgabewert im Quelltext stehen
//
// Aufruf: node scripts/freigabe-check.cjs

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ENV_SCHLUESSEL = [
  'SHORTS_TEST_VIDEO_ID', 'NORMAL_TEST_VIDEO_ID', 'AUDIT_PRIVATE_VIDEO_ID',
  'INNER_CIRCLE_PLAYLIST_ID', 'LIVESTREAM_ARCHIVE_PLAYLIST_ID', 'YOUTUBE_CHANNEL_ID',
  'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'ANTHROPIC_API_KEY',
  'THUMBNAIL_SOURCE_DIR', 'THUMBNAIL_EXPORT_DIR', 'STATE_REPO_DIR',
];

function bekannteIds() {
  const ids = new Set();
  for (const k of ENV_SCHLUESSEL) if (process.env[k]) ids.add(process.env[k]);
  // videoIds aus allen Messdaten dieser Auftragsreihe
  const quellen = [
    'data/gating-repair/schattenmessung.json',
    'data/gating-check-audit/messung.json',
    'data/gating-repair/short-erkennung-validierung.json',
    'data/shorts-thumbnail-api-test/_cache-videos.json',
  ];
  for (const q of quellen) {
    if (!fs.existsSync(q)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(q, 'utf8'));
      const sammle = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(sammle);
        for (const [k, v] of Object.entries(o)) {
          if ((k === 'videoId' || k === 'id') && typeof v === 'string' && v.length === 11) ids.add(v);
          else sammle(v);
        }
      };
      sammle(j);
    } catch (_) { /* unlesbare Messdatei ist kein Freigabe-Kriterium */ }
  }
  return [...ids].filter(Boolean);
}

const MUSTER = [
  { name: 'absoluter Windows-Pfad', re: /[A-Za-z]:\\{1,2}(?:Users|Dimension|Git)\b/g },
  { name: 'absoluter Unix-Heimpfad', re: /\/(?:home|Users)\/[A-Za-z0-9_.-]+\//g },
  { name: 'Laufwerkspfad P:/ oder C:/', re: /\b[A-Za-z]:\/(?:Users|Dimension|Git)\b/g },
  // Echte Playlist-/Kanal-IDs enthalten Klein- UND Grossbuchstaben. Ein reiner
  // Grossbuchstaben-Bezeichner wie PLAYLIST_SIZE_WARN ist ein Konstantenname und
  // kein Geheimnis -- ohne diese Bedingung meldet der Check ihn als Fund und
  // verliert an Glaubwuerdigkeit.
  { name: 'Playlist-ID', re: /\bPL(?![A-Z0-9_]+\b)[A-Za-z0-9_-]{16,}\b/g },
  { name: 'Kanal-ID', re: /\bUC(?![A-Z0-9_]+\b)[A-Za-z0-9_-]{22}\b/g },
  { name: 'OAuth-Zugriffstoken', re: /\bya29\.[A-Za-z0-9_-]{20,}/g },
  { name: 'Google-Client-Secret', re: /\bGOCSPX-[A-Za-z0-9_-]{10,}/g },
  { name: 'Anthropic-Schluessel', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'Client-ID', re: /\b\d{10,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com\b/g },
];

function main() {
  // Alles, was git als geaendert oder neu meldet -- also der Commit-Kandidat.
  //
  // KEIN .trim() auf die Gesamtausgabe: Porcelain-Zeilen beginnen bei
  // unstaged-Aenderungen mit einem Leerzeichen (" M pfad"). Ein Trim des ganzen
  // Blocks frisst genau dieses Zeichen in der ERSTEN Zeile, und ein danach
  // fester slice(3) schneidet den Pfad an -- die Datei faellt dann stillschweigend
  // aus der Pruefung. Genau so ist hier zuerst src/publish/publish.js
  // durchgerutscht. Deshalb zeilenweise und ueber die Statusbreite (2 Zeichen).
  const roh = execSync('git status --porcelain', { encoding: 'utf8' });
  const zeilen = roh.split('\n').filter((z) => z.length > 3);
  const dateien = zeilen
    .map((z) => z.slice(2).trim().replace(/^"|"$/g, ''))
    // Umbenennungen kommen als "alt -> neu"; geprueft wird das Ziel.
    .map((f) => (f.includes(' -> ') ? f.split(' -> ')[1] : f))
    .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());

  const uebersprungen = zeilen.length - dateien.length;
  if (uebersprungen > 0) {
    console.log(`Hinweis: ${uebersprungen} Eintrag/Eintraege sind keine vorhandenen Dateien (Verzeichnisse/geloescht) und werden nicht geprueft.\n`);
  }

  const ids = bekannteIds();
  console.log(`Zu pruefende Dateien: ${dateien.length}`);
  console.log(`Bekannte IDs im Abgleich: ${ids.length}\n`);

  let treffer = 0;
  for (const f of dateien) {
    const inhalt = fs.readFileSync(f, 'utf8');
    const funde = [];

    for (const id of ids) {
      if (inhalt.includes(id)) funde.push(`ID/Geheimnis aus .env oder Messdaten (${id.slice(0, 4)}…)`);
    }
    for (const m of MUSTER) {
      const g = inhalt.match(m.re);
      if (g) funde.push(`${m.name}: ${[...new Set(g)].slice(0, 3).join(', ')}`);
    }
    // .env-Schluessel duerfen GELESEN werden (process.env.X), aber nicht als
    // Vorgabewert dastehen: X = 'irgendwas' oder X="irgendwas".
    for (const k of ENV_SCHLUESSEL) {
      // DA (2026-08-29): Ein LEERES Literal ist kein Vorgabewert, sondern das
      // Gegenteil -- es macht den Schluessel im Kindprozess unsichtbar (siehe
      // scripts/verify-publish.cjs). Gemeldet wird deshalb nur noch ein Literal
      // MIT Inhalt: auf das oeffnende Anfuehrungszeichen muss ein anderes
      // Zeichen als das schliessende folgen.
      const re = new RegExp(`${k}\\s*[:=]\\s*('[^']|"[^"]|\`[^\`])`, 'g');
      if (re.test(inhalt)) funde.push(`.env-Schluessel ${k} mit Vorgabewert im Quelltext`);
    }

    if (funde.length) {
      treffer += funde.length;
      console.log(`FUND  ${f}`);
      for (const x of funde) console.log(`        ${x}`);
    } else {
      console.log(`ok    ${f}`);
    }
  }

  console.log(`\n${treffer === 0 ? 'FREIGABE: sauber — keine Funde.' : `FREIGABE VERWEIGERT: ${treffer} Fund(e).`}`);
  process.exit(treffer === 0 ? 0 : 1);
}

main();
