'use strict';

// P4 (Review-Harvester): EXPORT. Liest data/decisions.json (die im Board freigegebenen
// Eintraege) und schreibt reviews.json in einem schlanken Web-Schema, das eine Webseite
// direkt konsumieren kann. KEINE Rohdaten, KEINE abgelehnten Eintraege, KEIN Auto-Publish.
//
// Endschema pro Eintrag:
//   { quote, author, authorAnonymized, likes, videoTitle, videoUrl, date }
//
// Datenschutz: Wenn ein Eintrag im Board als "anonymisieren" markiert wurde, taucht das
// echte @Handle NIRGENDS im Export auf — `author` traegt dann den anonymisierten Namen.
// `author` ist damit IMMER gefahrlos anzeigbar; `authorAnonymized` ist die anonyme Form.
//
// Flags:
//   --in=PATH    Freigaben (Default: data/decisions.json)
//   --out=PATH   Export (Default: reviews.json im Projekt-Root)

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { in: 'data/decisions.json', out: 'reviews.json' };
  for (const t of argv.slice(2)) {
    if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
  }
  return a;
}

// Bildet einen Freigabe-Eintrag auf das Web-Schema ab. Anonymisierung datenschutz-sicher.
function toReview(item) {
  const anon = (item.authorAnonymized && String(item.authorAnonymized).trim()) || 'Anonym';
  const anonymize = item.anonymize === true;
  return {
    quote: String(item.quote == null ? '' : item.quote).trim(),
    // author ist immer anzeigbar: echtes Handle nur wenn NICHT anonymisiert.
    author: anonymize ? anon : (item.author || anon),
    authorAnonymized: anon,
    likes: Number(item.likes) || 0,
    videoTitle: item.videoTitle || '',
    videoUrl: item.videoUrl || '',
    date: item.date || '',
  };
}

function main() {
  const args = parseArgs(process.argv);
  const inPath = path.resolve(args.in);
  if (!fs.existsSync(inPath)) {
    throw new Error(`Freigaben nicht gefunden: ${inPath} (erst im Board 'decisions.json exportieren' und nach data/ legen).`);
  }
  const decisions = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const items = Array.isArray(decisions.items) ? decisions.items : [];

  const reviews = items
    .filter(it => it && String(it.quote || '').trim()) // leere Zitate raus
    .map(toReview);

  const out = {
    generatedAt: new Date().toISOString(),
    count: reviews.length,
    reviews,
  };

  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  // --- Datenschutz-Sanity: Handles, die mal anonymisiert, mal offen exportiert werden ---
  const anonHandles = new Set(items.filter(i => i.anonymize === true).map(i => i.author));
  const leaked = items.filter(i => i.anonymize !== true && anonHandles.has(i.author));
  const anonCount = items.filter(i => i.anonymize === true).length;

  console.log(`=== P4 EXPORT Report ===`);
  console.log(`Freigegeben gelesen:  ${items.length}`);
  console.log(`Exportiert:           ${reviews.length}`);
  console.log(`Anonymisiert:         ${anonCount}`);
  console.log(`Geschrieben:          ${outPath}`);
  if (leaked.length) {
    console.log(`\n⚠ HINWEIS Datenschutz: ${leaked.length} Eintrag/Eintraege mit OFFENEM Handle, das du anderswo anonymisiert hast:`);
    for (const l of leaked) console.log(`   - ${l.author} (offen in: "${String(l.videoTitle).slice(0, 50)}")`);
    console.log(`   -> Falls dieses Handle generell anonym bleiben soll, im Board auch hier ankreuzen und neu exportieren.`);
  }
  console.log(`\nKein Auto-Publish. reviews.json ist die lokale Enddatei fuer deine Webseite.`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('Export fehlgeschlagen:', e.message); process.exit(1); }
}

module.exports = { toReview, parseArgs };
