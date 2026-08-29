'use strict';

// CY Teil B: strikte Argumentpruefung fuer alle Skripte, die schreiben koennen.
//
// URSACHE, DIE DAS NOETIG MACHT (CX):
// Alle parseArgs-Schleifen dieses Projekts sind als Kette aus if/else-if gebaut
// und haben keinen else-Zweig. Ein unbekanntes Argument faellt damit stillschweigend
// hinten heraus. In CX wurde deshalb
//     node scripts/shorts-thumbnail-restore.cjs normal <bild> --nur-pruefen
// als SCHARFER Lauf ausgefuehrt: Das erfundene Flag wurde ignoriert, das Skript
// setzte ein Thumbnail auf ein echtes Video. Der Aufruf sah aus wie eine Pruefung
// und war ein Schreibzugriff.
//
// Diese Pruefung laeuft VOR jedem Netz- oder Schreibzugriff und beendet den
// Prozess mit Code 2, wenn ein Argument nicht bekannt ist.
//
// REGEL: Geprueft wird alles, was mit '-' beginnt. Freie Argumente (Dateinamen,
// Modusworte wie "short"/"normal") laesst die Pruefung durch -- die validiert das
// jeweilige Skript selbst. Wer auch Positionsargumente pruefen will, uebergibt
// maxPositional.

const EXIT_ARGUMENTFEHLER = 2;

// erlaubt: Liste aus exakten Flags ('--execute') und Praefixen ('--batch=').
// Ein Eintrag, der auf '=' endet, gilt als Praefix.
function unbekannteArgumente(argv, erlaubt) {
  const exakt = new Set(erlaubt.filter((e) => !e.endsWith('=')));
  const praefixe = erlaubt.filter((e) => e.endsWith('='));
  return argv.slice(2)
    .filter((t) => t.startsWith('-'))
    .filter((t) => !exakt.has(t) && !praefixe.some((p) => t.startsWith(p)));
}

// Beendet den Prozess bei unbekannten Argumenten. Gibt sonst nichts zurueck --
// das Parsen bleibt Sache des aufrufenden Skripts.
function pruefeArgumenteStrikt(argv, erlaubt, skriptname) {
  const unbekannt = unbekannteArgumente(argv, erlaubt);
  if (!unbekannt.length) return;
  console.error(`\nAbbruch: unbekannte(s) Argument(e): ${unbekannt.join(', ')}`);
  console.error(`Es wurde NICHTS geschrieben und kein Netzaufruf gemacht.\n`);
  console.error(`Zulaessige Argumente fuer ${skriptname}:`);
  for (const e of erlaubt) console.error(`  ${e}${e.endsWith('=') ? '<wert>' : ''}`);
  console.error('');
  process.exit(EXIT_ARGUMENTFEHLER);
}

// Der projektweit EINHEITLICHE Name fuer den Trockenlauf. Bewusst genau der
// String, der in CX erfunden wurde -- damit derselbe Tippfehler kuenftig das
// Richtige tut statt scharf zu laufen.
const TROCKENLAUF_FLAG = '--nur-pruefen';

module.exports = { pruefeArgumenteStrikt, unbekannteArgumente, TROCKENLAUF_FLAG, EXIT_ARGUMENTFEHLER };
