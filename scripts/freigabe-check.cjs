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
// Vor jeder Pruefung laeuft eine Selbstpruefung (selbstpruefung()): jedes Muster
// muss einen erfundenen Vertreter melden und darf auf keine Negativkontrolle
// anschlagen. Faellt sie durch, bricht der Check mit Exit 2 ab und prueft gar
// nichts -- ein Check, der stillschweigend blind ist, ist schlimmer als keiner.
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
  // DB (2026-08-29): KEIN \b hinter der Alternation. Der Projektordner heisst
  // "Dimensionwithin-..."; auf "Dimension" folgt ein Wortzeichen, also gab es
  // dort keine Wortgrenze -- genau der Pfad DIESES Rechners fiel durch. Das ist
  // der dritte Fehler dieser Art (nach dem .trim() und dem leeren Literal); die
  // Selbstpruefung unten faengt einen vierten ab, bevor irgendetwas geprueft wird.
  { name: 'absoluter Windows-Pfad', re: /[A-Za-z]:\\{1,2}(?:Users|Dimension|Git)/g },
  // Ebenso ohne abschliessenden Schraegstrich: ein Heimatordner unter /home
  // oder /Users ist bereits ein absoluter Pfad, auch wenn nichts dahinter steht.
  { name: 'absoluter Unix-Heimpfad', re: /\/(?:home|Users)\/[A-Za-z0-9_.-]+/g },
  { name: 'Laufwerkspfad P:/ oder C:/', re: /\b[A-Za-z]:\/(?:Users|Dimension|Git)/g },
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

// Der Pruefkern. Selbstpruefung und echter Lauf gehen durch GENAU diese
// Funktion -- eine Selbstpruefung, die ihren eigenen Code prueft statt den
// benutzten, belegt nichts.
function pruefeInhalt(inhalt, ids) {
  const funde = [];
  for (const id of ids) {
    if (inhalt.includes(id)) funde.push({ muster: "bekannte ID", text: `ID/Geheimnis aus .env oder Messdaten (${id.slice(0, 4)}…)` });
  }
  for (const m of MUSTER) {
    const g = inhalt.match(m.re);
    if (g) funde.push({ muster: m.name, text: `${m.name}: ${[...new Set(g)].slice(0, 3).join(", ")}` });
  }
  // .env-Schluessel duerfen GELESEN werden (process.env.X), aber nicht als
  // Vorgabewert dastehen: X = "irgendwas".
  for (const k of ENV_SCHLUESSEL) {
    // DA (2026-08-29): Ein LEERES Literal ist kein Vorgabewert, sondern das
    // Gegenteil -- es macht den Schluessel im Kindprozess unsichtbar (siehe
    // scripts/verify-publish.cjs). Gemeldet wird deshalb nur noch ein Literal
    // MIT Inhalt: auf das oeffnende Anfuehrungszeichen muss ein anderes
    // Zeichen als das schliessende folgen.
    const re = new RegExp(`${k}\\s*[:=]\\s*('[^']|"[^"]|\`[^\`])`, "g");
    if (re.test(inhalt)) funde.push({ muster: ".env-Vorgabewert", text: `.env-Schluessel ${k} mit Vorgabewert im Quelltext` });
  }
  return funde;
}

// DB (2026-08-29): Selbstpruefung. Ein Freigabe-Check, der stillschweigend
// blind ist, ist schlimmer als keiner -- dreimal in dieser Reihe hat er sauber
// gemeldet und dabei nicht hingesehen (.trim() in CX, leeres Literal in DA,
// die Wortgrenze hier in DB). Vor jeder Pruefung laeuft deshalb jedes Muster
// gegen einen eigenen Vertreter. ALLE Werte unten sind erfunden; kein einziger
// stammt aus .env, Messdaten oder Fixtures.
// SELBSTPRUEFUNG-VERTRETER ANFANG -- siehe ohneVertreterBlock()
const VERTRETER = {
  'absoluter Windows-Pfad': [
    'P:\\Dimensionwithin-Erfunden\\unterordner',
    'C:\\Users\\erfunden\\x',
    'D:\\\\Git\\\\erfunden',
  ],
  'absoluter Unix-Heimpfad': ['/home/erfunden/repo/', '/home/erfunden', '/Users/erfunden/repo'],
  'Laufwerkspfad P:/ oder C:/': ['P:/Dimensionwithin-Erfunden/unterordner', 'C:/Users/erfunden/x'],
  'Playlist-ID': ['PLerfundenErfundenErfundenAb'],
  'Kanal-ID': ['UCerfundenErfundenErfun2'],
  'OAuth-Zugriffstoken': ['ya29.erfundenErfundenErfunden'],
  'Google-Client-Secret': ['GOCSPX-erfundenErfunden'],
  'Anthropic-Schluessel': ['sk-ant-erfundenErfundenErfunden'],
  'Client-ID': ['1234567890123-erfundenabcdefghijklmno.apps.googleusercontent.com'],
  '.env-Vorgabewert': ["YOUTUBE_CLIENT_SECRET = 'erfunden'", 'INNER_CIRCLE_PLAYLIST_ID: "erfunden"'],
};

// Gegenrichtung: Zeilen, die KEIN Muster melden darf. Jeder Fehlalarm hier
// kostet den Check seine Glaubwuerdigkeit, und ein Check, dem man nicht mehr
// glaubt, wird uebergangen.
const NEGATIVKONTROLLEN = [
  'const PLAYLIST_SIZE_WARN = 200;',
  'const UC_STATE_MAX = 5;',
  'https://i.ytimg.com/vi/${videoId}/hqdefault.jpg',
  'const env = { YOUTUBE_CLIENT_ID: "" };',
  'const id = process.env.INNER_CIRCLE_PLAYLIST_ID;',
];
// SELBSTPRUEFUNG-VERTRETER ENDE

// Die Vertreter oben sehen absichtlich aus wie das, was sie fangen sollen --
// beim Lauf ueber DIESE Datei meldet der Check sonst seine eigene Tabelle und
// koennte nie sauber sein. Fuer die Musterpruefung wird der markierte Block
// deshalb nur in dieser einen Datei ausgeblendet. Der Abgleich gegen die
// bekannten IDs aus .env und Messdaten laeuft weiterhin ueber den GANZEN Text,
// damit sich hier drin nichts Echtes verstecken kann.
const EIGENE_DATEI = 'scripts/freigabe-check.cjs';
function ohneVertreterBlock(text) {
  return text.replace(/\/\/ SELBSTPRUEFUNG-VERTRETER ANFANG[\s\S]*?\/\/ SELBSTPRUEFUNG-VERTRETER ENDE/, '');
}

function selbstpruefung() {
  const fehler = [];
  for (const m of MUSTER) {
    const vs = VERTRETER[m.name];
    if (!vs || !vs.length) { fehler.push(`Muster "${m.name}" hat keinen Vertreter in VERTRETER`); continue; }
    for (const v of vs) {
      if (!pruefeInhalt(v, []).some((f) => f.muster === m.name)) {
        fehler.push(`Muster "${m.name}" meldet seinen eigenen Vertreter nicht: ${v}`);
      }
    }
  }
  for (const v of VERTRETER[".env-Vorgabewert"] || []) {
    if (!pruefeInhalt(v, []).some((f) => f.muster === ".env-Vorgabewert")) {
      fehler.push(`.env-Vorgabewert wird nicht gemeldet: ${v}`);
    }
  }
  for (const v of NEGATIVKONTROLLEN) {
    const f = pruefeInhalt(v, []);
    if (f.length) fehler.push(`Fehlalarm auf "${v}": ${f.map((x) => x.muster).join(", ")}`);
  }
  // Und der Abgleich gegen bekannte IDs selbst -- mit einer erfundenen ID.
  if (!pruefeInhalt("const x = " + String.fromCharCode(39) + "ERFUNDEN1234" + String.fromCharCode(39) + ";", ["ERFUNDEN1234"]).length) {
    fehler.push("Abgleich gegen bekannte IDs greift nicht");
  }
  if (fehler.length) {
    console.error("SELBSTPRUEFUNG FEHLGESCHLAGEN -- es wurde NICHTS geprueft:");
    for (const f of fehler) console.error("  " + f);
    process.exit(2);
  }
  console.log(`Selbstpruefung: ${MUSTER.length} Muster + ${NEGATIVKONTROLLEN.length} Negativkontrollen bestanden.`);
}

function main() {
  // Erst beweisen, dass die Muster sehen -- dann erst pruefen.
  selbstpruefung();

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
    const roh = fs.readFileSync(f, 'utf8');
    const text = f.split('\\').join('/').endsWith(EIGENE_DATEI) ? ohneVertreterBlock(roh) : roh;
    const funde = [
      ...pruefeInhalt(text, []),
      ...pruefeInhalt(roh, ids).filter((x) => x.muster === 'bekannte ID'),
    ].map((x) => x.text);

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
