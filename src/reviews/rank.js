'use strict';

// P2 (Review-Harvester): RANK. Liest data/comments-raw.json, wendet den Vorfilter an
// (filters.js) und klassifiziert jeden verbliebenen Kandidaten: Sentiment, Konkretheit,
// Ironie/Sarkasmus, Scam, Testimonial-Score 1-10 + Konfidenz. Ergebnis: die Top ~50
// nach data/comments-ranked.json.
//
// WICHTIG: Das sind VORSCHLAEGE, keine Wahrheit. Bei Ironie/Sarkasmus wird im Zweifel
// niedriger gescored; Scam/Werbung/Kontaktaufnahme fliegt aus den Top raus.
//
// Wiederverwendung des bestehenden Anthropic-Wrappers (keine zweite Client-Schicht):
//   callJSON / isMockMode / DEFAULT_MODEL  aus src/decision/client.js
// Mock-Modus (--dry-run oder kein ANTHROPIC_API_KEY): deterministische Heuristik,
// laeuft ohne Netz/Secret.
//
// Flags:
//   --in=PATH        Roh-Cache (Default: data/comments-raw.json)
//   --out=PATH       Ausgabe (Default: data/comments-ranked.json)
//   --top=N          Groesse der Top-Liste (Default: 50)
//   --min-words=N    Vorfilter-Mindestlaenge (Default: 6, siehe Kalibrierung)
//   --batch=N        Kommentare pro Klassifikations-Call (Default: 10)
//   --dry-run        Mock-Modus erzwingen (kein API-Call, kein Secret)
//   --limit=N        nur die ersten N Kandidaten klassifizieren (Debug)

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { prefilter } = require('./filters');
const { isMockMode, callJSON, DEFAULT_MODEL } = require('../decision/client');

function parseArgs(argv) {
  const a = {
    in: 'data/comments-raw.json',
    out: 'data/comments-ranked.json',
    top: 50, minWords: 6, batch: 10, dryRun: false, limit: Infinity,
    dumpCandidates: null, classifications: null,
  };
  for (const t of argv.slice(2)) {
    if (t === '--dry-run') a.dryRun = true;
    else if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
    else if (t.startsWith('--top=')) a.top = Number(t.slice(6)) || 50;
    else if (t.startsWith('--min-words=')) a.minWords = Number(t.slice(12));
    else if (t.startsWith('--batch=')) a.batch = Number(t.slice(8)) || 10;
    else if (t.startsWith('--limit=')) a.limit = Number(t.slice(8)) || Infinity;
    else if (t.startsWith('--dump-candidates=')) a.dumpCandidates = t.slice(18);
    else if (t.startsWith('--classifications=')) a.classifications = t.slice(18);
  }
  return a;
}

function loadRaw(inPath) {
  const p = path.resolve(inPath);
  if (!fs.existsSync(p)) {
    throw new Error(`Roh-Cache nicht gefunden: ${p} (erst 'npm run reviews:fetch' laufen lassen).`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Alle Top-Level-Kommentare flach aus dem Video-Cache ziehen.
function flattenComments(raw) {
  const out = [];
  for (const v of Object.values(raw.videos || {})) {
    for (const c of v.comments || []) {
      out.push({
        id: c.id,
        text: c.text,
        author: c.author,
        authorChannelUrl: c.authorChannelUrl,
        likeCount: c.likeCount || 0,
        publishedAt: c.publishedAt,
        videoId: c.videoId || v.videoId,
        videoTitle: c.videoTitle || v.title,
      });
    }
  }
  return out;
}

const SYSTEM_PROMPT = [
  'Du bewertest deutschsprachige YouTube-Kommentare eines Krypto-/Finanz-Kanals',
  'als moegliche TESTIMONIALS fuer eine Review-Webseite. Du lieferst VORSCHLAEGE,',
  'keine Wahrheit — der Mensch kuratiert danach selbst.',
  '',
  'Bewerte JEDEN Kommentar und gib pro Eintrag zurueck:',
  '  - sentiment: "positiv" | "neutral" | "negativ"',
  '  - concreteness: true, wenn der Kommentar etwas SPEZIFISCHES ueber Inhalt/Nutzen',
  '    nennt (konkrete Analyse, Lerneffekt, Mehrwert), sonst false (reine Hoeflichkeit).',
  '  - irony: true, wenn Ironie/Sarkasmus/Spott moeglich ist.',
  '  - scam: true bei Werbung, Kontaktaufnahme ("schreib mir", Telegram/WhatsApp, Links),',
  '    Broker-/Coach-Empfehlung, Impersonation, Bait-Fragen ("bester Weg Geld zu verdienen").',
  '  - testimonialScore: 1-10 (10 = perfektes, glaubwuerdiges, konkretes Lob).',
  '  - confidence: 0.0-1.0 (deine Sicherheit fuer diesen Eintrag).',
  '  - reason: ein kurzer deutscher Halbsatz.',
  '',
  'REGELN:',
  '  - Achte EXPLIZIT auf Ironie/Sarkasmus. Im Zweifel NIEDRIGER scoren.',
  '  - Scam/Werbung/Kontaktaufnahme => scam:true UND testimonialScore <= 2.',
  '  - Generische Hoeflichkeit ohne Substanz ("schoenes Video", "danke") => concreteness:false,',
  '    testimonialScore hoechstens 4-5.',
  '  - Negatives/neutrales Feedback ist KEIN Testimonial => niedriger Score.',
  '',
  'Antworte AUSSCHLIESSLICH mit JSON in genau dieser Form (keine Erklaerung davor/danach):',
  '{"results":[{"idx":0,"sentiment":"positiv","concreteness":true,"irony":false,',
  '"scam":false,"testimonialScore":8,"confidence":0.8,"reason":"..."}]}',
].join('\n');

function buildUserMessage(batch) {
  const lines = batch.map((c, i) =>
    `${i}. [likes:${c.likeCount}] ${String(c.text).replace(/\s+/g, ' ').trim()}`);
  return [
    'Bewerte diese Kommentare. Gib fuer JEDEN genau ein Ergebnis mit passendem idx zurueck.',
    '',
    ...lines,
  ].join('\n');
}

// --- Mock-Klassifikation (deterministisch, ohne Netz/Secret) ---
const POS = ['danke','super','toll','klasse','beste','bester','spitze','genial','hilfreich','wertvoll','interessant','top','empfehlenswert','grossartig','großartig','mega','perfekt','liebe','dankeschön','dankeschoen','wunderbar','lehrreich','informativ','qualität','qualitaet'];
const NEG = ['schlecht','enttäuscht','enttaeuscht','unsinn','quatsch','falsch','langweilig','blödsinn','bloedsinn','nervt','schwach','mist'];
const CONCRETE = ['analyse','erklärung','erklaerung','erklärt','erklaert','recherche','chart','lerne','gelernt','verstanden','verständlich','verstaendlich','mehrwert','wissen','nachvollziehbar','detail','session','strategie','perspektive'];
const IRONY = ['🙄','🤡','ironie','klar doch','natürlich nicht','ja klar','na klar'];

function mockClassify(batch) {
  return batch.map((c, i) => {
    const t = String(c.text || '').toLowerCase();
    const { looksLikeSpam } = require('./filters');
    const scam = looksLikeSpam(c.text);
    const pos = POS.filter(w => t.includes(w)).length;
    const neg = NEG.filter(w => t.includes(w)).length;
    const concrete = CONCRETE.some(w => t.includes(w));
    const irony = IRONY.some(w => t.includes(w));
    let sentiment = 'neutral';
    if (pos > neg) sentiment = 'positiv';
    else if (neg > pos) sentiment = 'negativ';
    let score;
    if (scam) score = 2;
    else if (sentiment === 'negativ') score = 3;
    else if (sentiment === 'neutral') score = 4;
    else score = concrete ? 8 : 6; // positiv
    if (irony) score = Math.max(1, score - 3);
    if (pos >= 2 && concrete && !scam && !irony) score = Math.min(10, score + 1);
    return {
      idx: i, sentiment, concreteness: concrete, irony, scam,
      testimonialScore: score,
      confidence: 0.55, // Mock ist nur Heuristik -> bewusst moderate Konfidenz.
      reason: 'mock-heuristik (kein modell)',
    };
  });
}

function clampScore(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(10, v));
}
function clampConf(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

async function classifyBatch(batch, { mock, batchIndex }) {
  if (mock) return mockClassify(batch);
  const maxTokens = 200 + batch.length * 120;
  let parsed;
  try {
    parsed = await callJSON({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(batch),
      maxTokens,
    });
  } catch (e) {
    console.warn(`  Batch ${batchIndex}: Modell-Call/Parse fehlgeschlagen (${e.message}) -> Mock-Fallback.`);
    return mockClassify(batch);
  }
  const results = Array.isArray(parsed) ? parsed : (parsed && parsed.results);
  if (!Array.isArray(results)) {
    console.warn(`  Batch ${batchIndex}: unerwartetes JSON -> Mock-Fallback.`);
    return mockClassify(batch);
  }
  // Nach idx zuordnen; fehlende Eintraege defensiv mit Mock fuellen.
  const byIdx = new Map(results.map(r => [Number(r.idx), r]));
  const mockFill = mockClassify(batch);
  return batch.map((_, i) => {
    const r = byIdx.get(i);
    if (!r) return mockFill[i];
    return {
      idx: i,
      sentiment: ['positiv', 'neutral', 'negativ'].includes(r.sentiment) ? r.sentiment : 'neutral',
      concreteness: !!r.concreteness,
      irony: !!r.irony,
      scam: !!r.scam,
      testimonialScore: clampScore(r.testimonialScore),
      confidence: clampConf(r.confidence),
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : '',
    };
  });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = loadRaw(args.in);
  const all = flattenComments(raw);

  // --- Vorfilter ---
  const funnel = { totalRaw: all.length, kept: 0 };
  const dropped = {};
  const candidates = [];
  for (const c of all) {
    const pf = prefilter(c, { minWords: args.minWords });
    if (!pf.keep) { dropped[pf.reason] = (dropped[pf.reason] || 0) + 1; continue; }
    candidates.push({ ...c, words: pf.words, lang: pf.lang, likeBoost: pf.likeBoost });
  }
  funnel.kept = candidates.length;

  // --- Modus: Kandidaten nur rausschreiben (fuer Sitzungs-/Sub-Agent-Bewertung via Max-Abo) ---
  if (args.dumpCandidates) {
    const dump = {
      generatedAt: new Date().toISOString(),
      source: path.resolve(args.in),
      minWords: args.minWords,
      funnel: { totalRaw: all.length, kept: candidates.length, dropped },
      count: candidates.length,
      candidates: candidates.map(c => ({
        id: c.id, text: c.text, author: c.author, likeCount: c.likeCount,
        videoId: c.videoId, videoTitle: c.videoTitle, words: c.words, lang: c.lang,
      })),
    };
    fs.mkdirSync(path.dirname(path.resolve(args.dumpCandidates)), { recursive: true });
    fs.writeFileSync(path.resolve(args.dumpCandidates), JSON.stringify(dump, null, 2));
    console.log(`Roh-Kommentare: ${all.length} -> Kandidaten: ${candidates.length} (verworfen: ${JSON.stringify(dropped)})`);
    console.log(`Kandidaten geschrieben: ${path.resolve(args.dumpCandidates)}`);
    return;
  }

  const toClassify = Number.isFinite(args.limit) ? candidates.slice(0, args.limit) : candidates;

  // Bewertungsquelle bestimmen: externe Klassifikationen (Max-Sitzung) > Mock > Live-API.
  const externalMap = args.classifications
    ? new Map(Object.entries(JSON.parse(fs.readFileSync(path.resolve(args.classifications), 'utf8'))))
    : null;
  const mock = isMockMode({ dryRun: args.dryRun });
  const modeLabel = externalMap ? 'EXTERN (Bewertung aus Max-Sitzung)'
    : (mock ? 'MOCK (Heuristik, kein API-Call)' : 'LIVE (' + DEFAULT_MODEL + ')');

  console.log(`Roh-Kommentare: ${all.length}`);
  console.log(`Vorfilter (min-words=${args.minWords}) -> Kandidaten: ${candidates.length}`);
  console.log('Verworfen:', JSON.stringify(dropped));
  console.log(`Modus: ${modeLabel}; bewerte ${toClassify.length} Kandidaten`);

  // --- Klassifikation ---
  const scored = [];
  let externalMissing = 0;
  if (externalMap) {
    // Externe Bewertungen pro Kommentar-id zuordnen; fehlende defensiv per Mock fuellen.
    const mockFill = mockClassify(toClassify);
    toClassify.forEach((c, i) => {
      const e = externalMap.get(c.id);
      let r;
      if (e) {
        r = {
          sentiment: ['positiv', 'neutral', 'negativ'].includes(e.sentiment) ? e.sentiment : 'neutral',
          concreteness: !!e.concreteness, irony: !!e.irony, scam: !!e.scam,
          testimonialScore: clampScore(e.testimonialScore), confidence: clampConf(e.confidence),
          reason: typeof e.reason === 'string' ? e.reason.slice(0, 200) : '',
        };
      } else { externalMissing++; r = mockFill[i]; }
      scored.push({
        ...c,
        classification: r,
        rankScore: Math.round((r.testimonialScore + (c.likeBoost || 0)) * 1000) / 1000,
      });
    });
    if (externalMissing) console.warn(`  WARN: ${externalMissing} Kandidat(en) ohne externe Bewertung -> Mock-Fallback.`);
  } else {
    const batches = chunk(toClassify, args.batch);
    for (let b = 0; b < batches.length; b++) {
      const res = await classifyBatch(batches[b], { mock, batchIndex: b });
      res.forEach((r, i) => {
        const c = batches[b][i];
        scored.push({
          ...c,
          classification: {
            sentiment: r.sentiment, concreteness: r.concreteness, irony: r.irony,
            scam: r.scam, testimonialScore: r.testimonialScore, confidence: r.confidence,
            reason: r.reason,
          },
          rankScore: Math.round((r.testimonialScore + (c.likeBoost || 0)) * 1000) / 1000,
        });
      });
      if ((b + 1) % 5 === 0 || b === batches.length - 1) {
        console.log(`  Batch ${b + 1}/${batches.length} fertig`);
      }
    }
  }

  // --- Ranking: Scam raus, dann nach rankScore / Konfidenz / Likes ---
  const scamCount = scored.filter(s => s.classification.scam).length;
  const ironyCount = scored.filter(s => s.classification.irony).length;
  const eligible = scored.filter(s => !s.classification.scam);
  eligible.sort((a, b) =>
    b.rankScore - a.rankScore ||
    b.classification.confidence - a.classification.confidence ||
    b.likeCount - a.likeCount);
  const top = eligible.slice(0, args.top);

  const output = {
    generatedAt: new Date().toISOString(),
    source: path.resolve(args.in),
    mode: externalMap ? 'external' : (mock ? 'mock' : 'live'),
    model: externalMap ? 'claude-opus-4-8 (Max-Sitzung)' : (mock ? null : DEFAULT_MODEL),
    note: 'Scores sind VORSCHLAEGE, keine Wahrheit. Scam-Eintraege sind aus der Top-Liste entfernt.',
    funnel: { ...funnel, dropped, classified: toClassify.length },
    stats: {
      scoredTotal: scored.length,
      externalMissing,
      scamExcluded: scamCount,
      ironyFlagged: ironyCount,
      eligible: eligible.length,
      topCount: top.length,
    },
    count: top.length,
    items: top,
  };

  fs.mkdirSync(path.resolve('data'), { recursive: true });
  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  // --- Report ---
  console.log(`\n=== P2 RANK Report ===`);
  console.log(`Roh -> Kandidaten:    ${all.length} -> ${candidates.length}`);
  console.log(`Verworfen:            ${JSON.stringify(dropped)}`);
  console.log(`Klassifiziert:        ${scored.length} (Modus: ${output.mode}${mock ? '' : ', ' + DEFAULT_MODEL})`);
  console.log(`Scam ausgeschlossen:  ${scamCount}`);
  console.log(`Ironie markiert:      ${ironyCount}`);
  console.log(`Top-Liste:            ${top.length}`);
  console.log(`\n--- Top 10 (Vorschau) ---`);
  top.slice(0, 10).forEach((s, i) => {
    const c = s.classification;
    console.log(`${String(i + 1).padStart(2)}. [${c.testimonialScore}/10 conf ${c.confidence} L${s.likeCount}] ${String(s.text).replace(/\s+/g, ' ').slice(0, 70)}`);
  });
  console.log(`\nGeschrieben: ${outPath}`);
  console.log(`Naechster Schritt nach Abnahme: npm run reviews:board`);
}

if (require.main === module) {
  main().catch(e => { console.error('RANK fehlgeschlagen:', e.message); process.exit(1); });
}

module.exports = { parseArgs, flattenComments, classifyBatch, mockClassify, buildUserMessage, SYSTEM_PROMPT };
