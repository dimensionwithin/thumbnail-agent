'use strict';

// P3: Anthropic-Client-Wrapper fuer den Decision-Layer.
//
// Zwei Modi:
//   live  — echter Claude-API-Call (braucht ANTHROPIC_API_KEY).
//   mock  — deterministische Beispiel-Outputs OHNE Netz/Secret (--dry-run oder kein Key).
//
// Der System-Prompt traegt die Marken-/Stilregeln und wird mit cache_control versehen
// (Prompt-Caching = Prefix-Match: stabiler Inhalt zuerst -> guenstigere Wiederholungen).

require('dotenv').config();

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

// Mock greift, wenn --dry-run gesetzt ist ODER kein API-Key vorliegt.
function isMockMode(opts = {}) {
  if (opts.dryRun) return true;
  return !process.env.ANTHROPIC_API_KEY;
}

// Lazy require, damit der Mock-Pfad ohne installiertes SDK / ohne Key laeuft.
function createClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt — live-Modus nicht moeglich.');
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey });
}

// Holt das erste {...}-JSON-Objekt aus einem Text (robust gegen Vor-/Nachgeplauder).
function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Keine JSON-Antwort gefunden: ' + text.slice(0, 200));
  }
  return JSON.parse(text.slice(start, end + 1));
}

// Ein JSON-liefernder Call. system wird gecacht; das Schema steht im Prompt-Text.
async function callJSON({ system, user, model = DEFAULT_MODEL, maxTokens = 400 }) {
  const client = createClient();
  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  const text = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return extractJSON(text);
}

module.exports = { isMockMode, createClient, callJSON, extractJSON, DEFAULT_MODEL };
