'use strict';

// CY Teil A.2/A.3: Laesst zwei bekannt problematische videoIds als Kandidaten
// durch die ECHTE Wochenlauf-Entscheidung laufen und rendert den Berichtstext,
// der daraus in LAST.txt entstuende.
//
// Benutzt werden ausschliesslich die produktiven Funktionen:
//   checkMembersGatedHttpDetailed()  -- der Check, den measureWeeklyCandidates ruft
//   classifyWeeklyCandidate()        -- die Entscheidung des Wochenlaufs
//   buildWeeklyLastText()            -- derselbe Renderer wie im Ernstfall
// Nichts davon ist hier nachgebaut. Ein Nachbau wuerde genau das verschleiern,
// was gezeigt werden soll.
//
// WARUM EIN EIGENES SKRIPT UND KEIN NEUES FLAG AM WOCHENLAUF:
// Der Wochenlauf laeuft Dienstag scharf. Ein zusaetzlicher Einschleus-Pfad in
// genau dieser Datei waere ein Risiko, das der Nachweis nicht wert ist. Dieses
// Skript kann per Konstruktion nichts schreiben -- es kennt weder playlistItems
// noch thumbnails und ruft keinen schreibenden Endpunkt auf.
//
// Geschrieben wird NUR nach data/gating-repair/ (gitignored), NICHT nach
// backups/livestream-weekly-LAST.txt -- der echte Bericht bleibt unberuehrt.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sync = require('../src/youtube/sync-livestream-archive.js');

const OUT = path.join('data', 'gating-repair');
const ERLAUBTE_ARGUMENTE = ['--nur-pruefen'];

function pruefeArgumente(argv) {
  const unbekannt = argv.slice(2).filter((a) => !ERLAUBTE_ARGUMENTE.includes(a));
  if (unbekannt.length) {
    console.error(`Abbruch: unbekannte Argumente: ${unbekannt.join(', ')}`);
    console.error(`Zulaessig: ${ERLAUBTE_ARGUMENTE.join(', ')}`);
    process.exit(2);
  }
  return { nurPruefen: argv.includes('--nur-pruefen') };
}

// videoIds durch Platzhalter ersetzen -- der Rohtext geht in einen Bericht.
function anonymisiere(text, ids) {
  let t = text;
  ids.forEach((id, i) => { t = t.split(id).join(`<videoId-${i + 1}>`); });
  return t;
}

async function main() {
  const args = pruefeArgumente(process.argv);
  fs.mkdirSync(OUT, { recursive: true });

  const faelle = [
    { id: process.env.AUDIT_PRIVATE_VIDEO_ID, titel: '<Titel des Streams>', was: 'privates Video' },
    { id: 'ZZZZ_kein_video', titel: '<Titel des Streams>', was: 'erfundene ID' },
  ].filter((f) => f.id);

  if (args.nurPruefen) {
    console.log('TROCKENLAUF: keine Netzabrufe, keine Dateien geschrieben.');
    console.log(`Wuerde ${faelle.length} Faelle pruefen: ${faelle.map((f) => f.was).join(', ')}`);
    return;
  }

  // Kandidatenzeilen in der Form, die measureWeeklyCandidates erzeugt.
  const rows = [];
  for (const f of faelle) {
    const { gated, grund } = await sync.checkMembersGatedHttpDetailed(f.id);
    const klass = sync.classifyWeeklyCandidate('Donnerstag', '20:04', gated);
    rows.push({
      id: f.id, title: f.titel, berlinDate: '2026-08-27', berlinTime: '20:04', weekday: 'Donnerstag',
      gated, gatedGrund: grund, ...klass,
    });
    console.log(`${f.was}: gated=${gated === null ? 'null' : gated} -> ${klass.decision} / ${klass.target || 'KEINE Playlist'}`);
    console.log(`  ${grund}`);
  }

  const unverified = rows.filter((r) => r.decision === 'UNVERIFIED');
  const summary = {
    status: unverified.length ? `${unverified.length} ungeprueft — bitte pruefen` : 'sauber',
    candidates: rows.length, insertedArchive: 0, insertedIC: 0,
    unusual: 0, unusualRows: [], unverified, icSuggestions: [],
    quota: 58, archiveTotal: 215, icTotal: 79,
  };
  const exitCode = unverified.length ? 2 : 0;
  const text = sync.buildWeeklyLastText(summary, exitCode, '<CSV-Pfad>', false);

  const anonym = anonymisiere(text, faelle.map((f) => f.id));
  fs.writeFileSync(path.join(OUT, 'cy-LAST-vorschau.txt'), anonym);

  console.log('\n=== Berichtstext, erste 25 Zeilen (videoIds durch Platzhalter ersetzt) ===');
  console.log('---8<---');
  console.log(anonym.split('\n').slice(0, 25).join('\n'));
  console.log('--->8---');
  console.log(`\nvollstaendig: ${path.join(OUT, 'cy-LAST-vorschau.txt')}`);
  console.log(`Exit-Code, den der Wochenlauf haette: ${exitCode}`);
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
