'use strict';

// P3: Decision-Layer-Einstieg. Liest das Inventar, erzeugt pro Video einen Vorschlag
// (Headline + Stance -> color/chartForm) und schreibt data/proposals.json (Vertrag,
// approved:false, inkl. Konfidenzwerten).
//
// DQ Punkt 2: --dry-run SCHREIBT NICHT MEHR.
//
// GEMESSEN: `node src/decision/decide.js --dry-run` hat data/proposals.json
// (658 KB) neu geschrieben -- sha256 8ddec42f... -> e4557d77.... Das Flag hiess
// "dry" und war es nicht. Wer es tippte, um nachzusehen, was herauskaeme,
// ueberschrieb dabei das, was da war.
//
// DIE WAHL, UND WARUM SO: --dry-run behaelt seine Mock-Bedeutung und schreibt
// zusaetzlich nicht mehr. Die Alternative waere gewesen, es umzubenennen. Das
// waere hier falsch: --dry-run heisst in DIESEM Projekt an vier Stellen
// dasselbe -- decide.js, backup.js, reviews/rank.js und decision/client.js
// meinen alle "Mock, kein Netz, kein Secret". Nur decide.js umzubenennen haette
// die Uneinheitlichkeit verschoben statt sie zu beseitigen, und ueberall
// umzubenennen war in DQ nicht moeglich (rank.js und client.js standen nicht
// zur Aenderung frei). Die Mock-Bedeutung bleibt also, wo sie ist; dazu kommt,
// was jeder erwartet, der das Wort "dry" liest.
//
// Ein Mock-Lauf, der SCHREIBEN soll, geht weiter -- er braucht das Flag gar
// nicht: ohne ANTHROPIC_API_KEY greift der Mock ohnehin (isMockMode).
// Gezielt woanders hin schreibt --out=.
//
// Flags:
//   --dry-run         Mock-Modus erzwingen (kein API-Call, kein Secret) UND
//                     Trockenlauf: es wird NICHTS geschrieben. Der Mock greift
//                     auch ohne dieses Flag, wenn ANTHROPIC_API_KEY fehlt.
//   --nur-pruefen     Trockenlauf: es wird NICHTS geschrieben. Der Modus bleibt,
//                     wie er ohne das Flag waere (live, wenn ein Key da ist).
//                     Das ist der projektweit einheitliche Name (cli-args.js).
//   --in=PATH         Eingabe-Inventar (Default: data/inventory.json, sonst .sample).
//   --out=PATH        Ausgabe (Default: data/proposals.json).
//   --threshold=0.6   Stance-Konfidenz-Schwelle; darunter -> gold/standard.

// DQ Punkt 2: Ohne strikte Argumentpruefung waere die Zusage oben loechrig --
// ein vertipptes `--dryrun` faellt durch jede if/else-Kette dieses Projekts
// hindurch (sie hat keinen else-Zweig) und haette weiter geschrieben, bei
// vorhandenem Key sogar live. Dieselbe Regel wie in cli-args.js: geprueft wird
// VOR dem ersten Lesen und Schreiben.
const { pruefeArgumenteStrikt, TROCKENLAUF_FLAG } = require('../publish/cli-args');
// pruefeKeineFreienArgumente kommt aus dem Leser und ist NICHT nachgebaut;
// sie faengt, was startsWith('-') nicht sieht.
const { pruefeKeineFreienArgumente } = require('../upload/uebergabe-leser');

const ERLAUBTE_ARGUMENTE = ['--dry-run', TROCKENLAUF_FLAG, '--in=', '--out=', '--threshold='];

if (require.main === module) {
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/decision/decide.js');
  pruefeKeineFreienArgumente(process.argv, 'src/decision/decide.js', '--in=');
}

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { isMockMode, DEFAULT_MODEL } = require('./client');
const { deriveStance } = require('./stance');
const { deriveHeadline } = require('./headline');
const { stanceToConfig, normalizeConfig, DEFAULTS } = require('../config-schema');

function parseArgs(argv) {
  const a = { dryRun: false, nurPruefen: false, in: null, out: null, threshold: 0.6 };
  for (const t of argv.slice(2)) {
    if (t === '--dry-run') a.dryRun = true;
    else if (t === TROCKENLAUF_FLAG) a.nurPruefen = true;
    else if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
    else if (t.startsWith('--threshold=')) a.threshold = Number(t.slice(12)) || 0.6;
  }
  return a;
}

function resolveInput(explicit) {
  if (explicit) return path.resolve(explicit);
  const real = path.resolve('data', 'inventory.json');
  if (fs.existsSync(real)) return real;
  // Fallback: getrackte Mock-Fixture (data/ ist gitignored).
  return path.resolve('fixtures', 'inventory.sample.json');
}

async function proposeForVideo(video, opts) {
  const stanceRes = await deriveStance(video, opts);
  const headlineRes = await deriveHeadline(video, { ...opts, stance: stanceRes.stance });

  // Low-Confidence-Default: unter der Schwelle faellt color/chartForm auf gold/standard
  // (brass/fractal), unabhaengig von der (unsicheren) Stance.
  const lowConfidence = stanceRes.confidence < opts.threshold;
  const coupling = lowConfidence
    ? { color: DEFAULTS.color, chartForm: DEFAULTS.chartForm }
    : stanceToConfig(stanceRes.stance);

  const raw = {
    videoId: video.videoId,
    preset: video.preset || DEFAULTS.preset,
    color: coupling.color,
    chartForm: coupling.chartForm,
    headline: headlineRes.headline,
    episode: video.episode,
    date: video.date,
    position: 'auto',
    titleScale: 'auto',
    approved: false,
  };

  const { config, warnings } = normalizeConfig(raw);

  return {
    ...config,
    // Agent-Metadaten (nicht Teil des Engine-Vertrags; toEngineConfig filtert sie raus):
    stance: stanceRes.stance,
    confidence: {
      stance: round2(stanceRes.confidence),
      headline: round2(headlineRes.confidence),
    },
    fellBackToDefault: lowConfidence,
    reasoning: {
      stance: stanceRes.reasoning,
      headline: headlineRes.reasoning,
    },
    warnings,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const args = parseArgs(process.argv);
  const opts = { dryRun: args.dryRun, threshold: args.threshold };
  const mock = isMockMode(opts);

  const inPath = resolveInput(args.in);
  const outPath = args.out ? path.resolve(args.out) : path.resolve('data', 'proposals.json');

  if (!fs.existsSync(inPath)) {
    throw new Error(`Inventar nicht gefunden: ${inPath} (erst P2 laufen lassen oder --in= setzen).`);
  }

  const inventory = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const videos = inventory.items || [];

  console.log(`Modus:   ${mock ? 'MOCK (kein API-Call)' : 'LIVE (Claude ' + DEFAULT_MODEL + ')'}`);
  console.log(`Eingabe: ${inPath} (${videos.length} Videos)`);
  console.log(`Schwelle: ${args.threshold} (Stance-Konfidenz darunter -> gold/standard)\n`);

  const items = [];
  for (const v of videos) {
    const proposal = await proposeForVideo(v, opts);
    items.push(proposal);
    const flag = proposal.fellBackToDefault ? '  [gold/standard-Default]' : '';
    console.log(
      `- ${v.videoId}: ${proposal.stance} (${proposal.confidence.stance}) ` +
      `-> ${proposal.color}/${proposal.chartForm} | "${proposal.headline}"${flag}`
    );
    if (proposal.warnings.length) {
      for (const w of proposal.warnings) console.log(`    WARN: ${w}`);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    mode: mock ? 'mock' : 'live',
    model: mock ? null : DEFAULT_MODEL,
    source: inPath,
    threshold: args.threshold,
    count: items.length,
    items,
  };

  // DQ Punkt 2: Der Trockenlauf endet HIER -- vor mkdirSync, vor writeFileSync.
  // Beide Flags fuehren hierher: --dry-run (Mock UND Trockenlauf) und
  // --nur-pruefen (nur Trockenlauf). Was NICHT geschrieben wurde, wird beim
  // Namen genannt, samt Pfad: ein Lauf, der schweigend nichts tut, ist von
  // einem, der schweigend etwas tut, nicht zu unterscheiden.
  const trockenlauf = args.dryRun || args.nurPruefen;
  if (trockenlauf) {
    const warum = args.dryRun && args.nurPruefen ? '--dry-run und ' + TROCKENLAUF_FLAG
      : args.dryRun ? '--dry-run' : TROCKENLAUF_FLAG;
    console.log(`\nTROCKENLAUF (${warum}): es wurde NICHTS geschrieben.`);
    console.log(`  Geschrieben worden waere: ${outPath} (${items.length} Vorschlaege)`);
    console.log('Farb-Verteilung:',
      JSON.stringify(items.reduce((m, it) => (m[it.color] = (m[it.color] || 0) + 1, m), {})));
    return;
  }

  fs.mkdirSync(path.resolve('data'), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nGeschrieben: ${outPath}`);

  const byColor = items.reduce((m, it) => (m[it.color] = (m[it.color] || 0) + 1, m), {});
  console.log('Farb-Verteilung:', JSON.stringify(byColor));
}

if (require.main === module) {
  main().catch(e => { console.error('Decide fehlgeschlagen:', e.message); process.exit(1); });
}

module.exports = { proposeForVideo, parseArgs, resolveInput };
