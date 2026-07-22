'use strict';

// P3: Stance-Ableitung aus Titel (+Beschreibung).
//   bullish -> sage   / expansion
//   bearish -> oxblood/ collapse
//   neutral -> brass  / fractal   (auch der Low-Confidence-Default: "gold/standard")
//
// Liefert { stance, confidence(0..1), reasoning }. Der Aufrufer (decide.js) entscheidet
// anhand der Konfidenz, ob die Stance-Kopplung greift oder auf gold/standard zurueckfaellt.

const { isMockMode, callJSON } = require('./client');

const SYSTEM = [
  'Du bist Markt-Analyst fuer den YouTube-Kanal "at dimension within" (Trading/Markt-Content).',
  'Bestimme aus Titel und Beschreibung die Markt-Haltung (Stance) des Videos:',
  '- "bullish": klar steigend/optimistisch (Ausbruch, Rallye, Long, hoehere Hochs).',
  '- "bearish": klar fallend/defensiv (Crash, Short, tiefere Tiefs, Risk-Off, Bruch).',
  '- "neutral": seitwaerts, abwartend, oder WIDERSPRUECHLICH/mehrdeutig.',
  'confidence ist 0..1. Bei gemischten/mehrdeutigen Signalen niedrige confidence (<0.6) und "neutral".',
  'Antworte AUSSCHLIESSLICH als JSON: {"stance":"bullish|bearish|neutral","confidence":0.0,"reasoning":"kurz"}.',
].join('\n');

// --- Mock: deterministische Keyword-Heuristik (kein Netz, kein Secret) ---
const BULL = ['bullisch', 'bullish', 'rallye', 'rally', 'long', 'aufwaerts', 'steigend', 'hoehere hochs', 'asymmetrisch', 'konstruktiv', 'bricht aus', 'ausbricht'];
const BEAR = ['baerisch', 'bearish', 'crash', 'short', 'abwaerts', 'fallend', 'tiefere tiefs', 'verliert', 'faellt', 'risk-off', 'bricht weg'];

// Mehrdeutigkeit hat VORRANG: explizite Unentschlossenheit -> neutral, niedrige Konfidenz.
const AMBIG = ['beide seiten', 'wiege ab', 'abwaegen', 'ohne mich festzulegen', 'ohne sich festzulegen', 'schwer zu sagen', 'mehrdeutig', 'bullenfalle', 'zwischen ausbruch'];
// Klar seitwaerts/abwartend -> neutral, mittlere Konfidenz.
const NEUTRAL = ['seitwaerts', 'keine klare richtung', 'keine klare', 'range gebunden', 'range', 'abwartend', 'wartet auf', 'geduld', 'neutral'];

function countHits(text, words) {
  const t = text.toLowerCase();
  let n = 0;
  for (const w of words) if (t.includes(w)) n += 1;
  return n;
}

function mockStance(video) {
  const text = `${video.title || ''}\n${video.description || ''}`;
  const bull = countHits(text, BULL);
  const bear = countHits(text, BEAR);
  const ambig = countHits(text, AMBIG);
  const neutral = countHits(text, NEUTRAL);
  const margin = Math.abs(bull - bear);
  const total = bull + bear;

  // 1) Explizite Mehrdeutigkeit dominiert -> Low-Confidence-Default (gold/standard).
  if (ambig > 0) {
    return { stance: 'neutral', confidence: 0.35, reasoning: `mock: explizit mehrdeutig (ambig=${ambig})` };
  }
  // 2) Seitwaerts/abwartend ohne klare Richtung -> neutral.
  if (neutral > 0 && margin <= 1) {
    return { stance: 'neutral', confidence: 0.5, reasoning: `mock: seitwaerts/abwartend (neutral=${neutral})` };
  }
  // 3) Keine Richtungssignale -> neutral.
  if (total === 0) {
    return { stance: 'neutral', confidence: 0.5, reasoning: 'mock: keine klaren Richtungssignale' };
  }
  // 4) Beide Seiten ohne klaren Vorsprung -> neutral, niedrige Konfidenz.
  if (bull > 0 && bear > 0 && margin <= 1) {
    return { stance: 'neutral', confidence: 0.4, reasoning: `mock: gemischte Signale (bull=${bull}, bear=${bear})` };
  }
  if (bull > bear) {
    const confidence = Math.min(0.95, 0.6 + 0.12 * margin);
    return { stance: 'bullish', confidence, reasoning: `mock: bullische Signale ueberwiegen (bull=${bull}, bear=${bear})` };
  }
  if (bear > bull) {
    const confidence = Math.min(0.95, 0.6 + 0.12 * margin);
    return { stance: 'bearish', confidence, reasoning: `mock: baerische Signale ueberwiegen (bull=${bull}, bear=${bear})` };
  }
  return { stance: 'neutral', confidence: 0.5, reasoning: 'mock: ausgeglichen' };
}

async function deriveStance(video, opts = {}) {
  if (isMockMode(opts)) return mockStance(video);
  const user = `Titel: ${video.title || ''}\n\nBeschreibung: ${video.description || ''}`;
  const out = await callJSON({ system: SYSTEM, user, maxTokens: 200 });
  return {
    stance: out.stance,
    confidence: typeof out.confidence === 'number' ? out.confidence : 0.5,
    reasoning: out.reasoning || '',
  };
}

module.exports = { deriveStance, mockStance, SYSTEM };
