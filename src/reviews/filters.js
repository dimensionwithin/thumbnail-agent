'use strict';

// P2 (Review-Harvester): VORFILTER. Reine, testbare Heuristiken — KEIN Netz, KEIN Key.
// Entscheidet, welche Roh-Kommentare ueberhaupt an die (token-kostende) Klassifikation
// gehen. Bewusst konservativ: im Zweifel BEHALTEN und das Modell entscheiden lassen;
// nur klaren Muell (leer, zu kurz, reine Emojis, offensichtlicher Scam/Werbung) und
// klar nicht-deutsche Kommentare hart wegwerfen.
//
// Sprache: Deutsch bevorzugt (abgenommen). 'de' und 'unknown' bleiben drin,
// klar 'en' wird verworfen.

const URL_RE = /\b(?:https?:\/\/|www\.)|\b\w+\.(?:com|de|net|org|io|me|ru|info|biz|xyz)\b|t\.me\/|wa\.me\//i;
// Kontaktaufnahme / Solicitation / typische Krypto-Scam-Bait-Muster.
const SCAM_RE = new RegExp([
  'whats\\s?app', 'telegram', 't\\.me', 'schreib\\s+(?:mir|mich)', 'kontaktiere',
  'dm\\s+me', 'message\\s+me', 'inbox\\s+me', 'reach\\s+out',
  '\\+\\d[\\d\\s().-]{7,}',                       // Telefonnummern
  'broker', 'trading\\s*coach', 'expert(?:in|e)\\b', 'mentor(?:in)?\\b',
  'investier', 'gewinn\\w*\\s+garant', 'profit\\w*\\s+garant', 'verdoppel',
  'frau\\s+[A-Z]', 'herr\\s+[A-Z]', 'mrs?\\.?\\s+[A-Z]', 'mr\\.?\\s+[A-Z]',
].join('|'), 'i');

// Sprach-Signale (kleine, robuste Wortlisten + Umlaute).
const DE_WORDS = new Set(['und','der','die','das','ist','für','ich','nicht','mit','ein','eine','dein','deine','danke','immer','wie','sehr','was','auf','dem','den','zum','vielen','dank','super','toll','klasse','beste','bester','wieder','mal','schon','noch','aber','auch','von','bei','wird','sind','hast','habe','mir','mich','dich','du','wir','ihr','euch','uns','bitte','gut','gute','guten','grosse','große','grossen','großen','danken','weiter','so']);
const EN_WORDS = new Set(['the','you','your','this','that','is','are','was','were','what','thanks','thank','video','very','good','great','please','keep','best','love','really','much','for','with','and','have','will','from','about','channel','content','amazing','awesome']);

function wordCount(text) {
  return (String(text == null ? '' : text).trim().match(/\S+/g) || []).length;
}

function tokensLower(text) {
  return String(text == null ? '' : text).toLowerCase().match(/[a-zäöüß']+/gi) || [];
}

// Buchstaben (ohne Emojis/Satzzeichen/Whitespace) zaehlen -> reine-Emoji-Erkennung.
function letterCount(text) {
  return (String(text == null ? '' : text).match(/\p{L}/gu) || []).length;
}

function isMostlyEmoji(text) {
  const letters = letterCount(text);
  // Sehr wenige echte Buchstaben -> als reine Emoji-/Symbolzeile behandeln.
  return letters < 3;
}

function looksLikeSpam(text) {
  const t = String(text == null ? '' : text);
  if (URL_RE.test(t)) return true;
  if (SCAM_RE.test(t)) return true;
  return false;
}

// Heuristische Sprach-Schaetzung: 'de' | 'en' | 'unknown'.
function detectLanguage(text) {
  const t = String(text == null ? '' : text);
  const hasUmlaut = /[äöüßÄÖÜ]/.test(t);
  const toks = tokensLower(t);
  let de = 0, en = 0;
  for (const w of toks) {
    if (DE_WORDS.has(w)) de++;
    if (EN_WORDS.has(w)) en++;
  }
  if (hasUmlaut) de++;
  if (de > en) return 'de';
  // Klar englisch: mehrere EN-Signale, keine DE-Signale, keine Umlaute.
  if (en >= 2 && de === 0) return 'en';
  return 'unknown';
}

// Subtiler Like-Boost (max +0.5) — Likes sind Hinweis, nicht Wahrheit.
function likeBoost(likeCount) {
  const n = Math.max(0, Number(likeCount) || 0);
  return Math.min(n, 20) * 0.025;
}

// Haupt-Entscheidung. Liefert keep + Grund + abgeleitete Felder.
// opts.minWords (Default 6). Reihenfolge der Gruende ist die Drop-Reihenfolge.
function prefilter(comment, opts = {}) {
  const minWords = opts.minWords == null ? 6 : opts.minWords;
  const text = comment && comment.text;
  const words = wordCount(text);
  const lang = detectLanguage(text);

  let keep = true, reason = null;
  if (!text || !String(text).trim()) { keep = false; reason = 'empty'; }
  else if (words < minWords) { keep = false; reason = 'too-short'; }
  else if (isMostlyEmoji(text)) { keep = false; reason = 'mostly-emoji'; }
  else if (looksLikeSpam(text)) { keep = false; reason = 'spam'; }
  else if (lang === 'en') { keep = false; reason = 'non-german'; }

  return { keep, reason, words, lang, likeBoost: likeBoost(comment && comment.likeCount) };
}

module.exports = {
  wordCount, letterCount, isMostlyEmoji, looksLikeSpam, detectLanguage, likeBoost, prefilter,
};
