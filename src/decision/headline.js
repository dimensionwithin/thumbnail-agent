'use strict';

// P3: Headline-Verdichtung aus dem (langen) Video-Titel.
// Ziel: 2-5 Worte, GENAU EIN *Akzentwort* (zwischen Sternchen). Plus Konfidenz.
//
// Liefert { headline, confidence(0..1), reasoning }.

const { isMockMode, callJSON } = require('./client');

const SYSTEM = [
  'Du bist Thumbnail-Texter fuer den YouTube-Kanal "at dimension within" (Trading/Markt-Content).',
  'Verdichte den langen Video-Titel zu einer Thumbnail-Headline.',
  'Harte Regeln:',
  '- 2 bis 5 Worte, knackig, Deutsch.',
  '- GENAU EIN Akzentwort, in *Sternchen* eingefasst (z. B. "Bitcoin *bricht* aus").',
  '- Keine Episodennummern, keine Doppelpunkte, kein Drumherum.',
  'Antworte AUSSCHLIESSLICH als JSON: {"headline":"... *wort* ...","confidence":0.0,"reasoning":"kurz"}.',
].join('\n');

// --- Mock: deterministische Verdichtung (kein Netz, kein Secret) ---

// Bekannte Assets aus dem Titel ziehen; sonst "Markt".
const ASSETS = ['Bitcoin', 'BTC', 'Ethereum', 'ETH', 'S&P', 'Nasdaq', 'Dax', 'DAX', 'Gold', 'Silber', 'Oel', 'EUR', 'USD'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Wort-genau matchen, damit z. B. "EUR" nicht in "eure Fragen" anschlaegt.
function detectAsset(title) {
  const t = title || '';
  for (const a of ASSETS) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(a)}([^a-z0-9]|$)`, 'i');
    if (re.test(t)) return a;
  }
  return 'Markt';
}

// Headline-Templates pro Stance — jeweils genau ein *Akzentwort*, 2-3 Worte.
function mockHeadline(video, stance) {
  const asset = detectAsset(video.title);
  let headline;
  let confidence;
  switch (stance) {
    case 'bullish':
      headline = `${asset} *bricht* aus`;
      confidence = 0.82;
      break;
    case 'bearish':
      headline = `${asset} verliert *Halt*`;
      confidence = 0.82;
      break;
    default: // neutral / mehrdeutig
      headline = `${asset} bleibt *unentschieden*`;
      confidence = 0.55;
      break;
  }
  return { headline, confidence, reasoning: `mock: Template fuer ${stance} auf "${asset}"` };
}

async function deriveHeadline(video, opts = {}) {
  // stance wird im Mock genutzt, um das passende Template zu waehlen.
  const stance = opts.stance || 'neutral';
  if (isMockMode(opts)) return mockHeadline(video, stance);
  const user = `Titel: ${video.title || ''}\n\nBeschreibung: ${video.description || ''}`;
  const out = await callJSON({ system: SYSTEM, user, maxTokens: 120 });
  return {
    headline: out.headline,
    confidence: typeof out.confidence === 'number' ? out.confidence : 0.5,
    reasoning: out.reasoning || '',
  };
}

module.exports = { deriveHeadline, mockHeadline, detectAsset, SYSTEM };
