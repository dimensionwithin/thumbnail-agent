'use strict';
// Source-of-Truth-Generator von data/proposals.livestream.json — KEIN API/SDK, KEIN externer Call.
// Re-Freeze #1..#67 (Studio-validiert). Headlines je videoId (renumbering-fest):
// bestehende 55 TEXT-IDENTISCH (inkl. 5 Korrekturen), 12 Re-Freeze-Neuzugänge ergänzt.
// videoId/#N/date/Titel stammen aus data/livestream-catalog.json (eingefroren).
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'livestream-catalog.json'), 'utf8'));

// stance -> Farbe + Chart-Form (Compositor-Verankerung)
const STANCE_MAP = {
  bullish: { color: 'sage',    chartForm: 'expansion' },
  bearish: { color: 'oxblood', chartForm: 'collapse'  },
  neutral: { color: 'brass',   chartForm: 'fractal'   },
};

// Headlines je videoId.
//   hl=NEUE Headline (kurz, ein *Akzentwort*); st=stance; fl=gekuerzt|interpretiert|mehrdeutig;
//   cH=confidence headline; reviewed=true -> manuell abgenommen (flag 'geprueft', kein Review).
const H = {
  'RSG6VgX0qmI': { hl: "XRP wie *angekündigt*", st: 'neutral', fl: 'interpretiert', cH: 0.55 },
  'aMFBdnETJug': { hl: "XRP *Dump* heute Nacht?", st: 'bearish', fl: 'gekuerzt', cH: 0.72 },
  '5CStITuzkGw': { hl: "XRP — *lokaler Boden*?", st: 'neutral', fl: 'interpretiert', cH: 0.55 },  // NEU (Re-Freeze)
  'EMlVWux66Jo': { hl: "*Liq Hunt* oder Pump?", st: 'neutral', fl: 'gekuerzt', cH: 0.64 },  // NEU (Re-Freeze)
  'kqSyPQ1WznI': { hl: "XRP — *Crash* oder Pump?", st: 'neutral', fl: 'gekuerzt', cH: 0.64 },  // NEU (Re-Freeze)
  'b19Yk4pwhBA': { hl: "Wieder *Krypto-Dump*?", st: 'bearish', fl: 'gekuerzt', cH: 0.72 },
  'Mfaj0Bs3Kkc': { hl: "*Bärenmarkt* für XRP?", st: 'bearish', fl: 'gekuerzt', cH: 0.72 },
  'xOuKxDZ-Nvs': { hl: "ETH-Hack vor dem *Crash*?", st: 'bearish', fl: 'gekuerzt', cH: 0.7 },
  'GB3oD5v-YBM': { hl: "XRP +25%, *recht* gehabt", st: 'bullish', fl: 'gekuerzt', cH: 0.72 },
  'ieQca2BdocU': { hl: "Krypto weiter *runter*?", st: 'bearish', fl: 'gekuerzt', cH: 0.68 },
  'JtHdBMYIDyE': { hl: "Markt in *Panik*", st: 'bearish', fl: 'gekuerzt', cH: 0.7 },
  '8l67-wbAf2U': { hl: "Krypto in der *Bodenbildung*", st: 'neutral', fl: 'gekuerzt', cH: 0.7 },
  'OqzrzIxrw-s': { hl: "Seitwärts, dann *Bullrun*", st: 'bullish', fl: 'interpretiert', cH: 0.62 },
  'Qz2G6GlJhMQ': { hl: "Krypto vorm *Ende*?", st: 'bearish', fl: 'gekuerzt', cH: 0.68 },
  '0i6vuV5XqRg': { hl: "Die *Rotation* wird klar", st: 'neutral', fl: 'gekuerzt', cH: 0.66 },
  'xLhJQogP2C4': { hl: "Wer hat mehr *Geduld*?", st: 'neutral', fl: 'mehrdeutig', cH: 0.6 },
  '3CutnKHTWaE': { hl: "Krypto *lädt*", st: 'neutral', fl: 'mehrdeutig', cH: 0.55 },
  'WonBODArfE0': { hl: "XRP heißt *Schmerzen*", st: 'bearish', fl: 'interpretiert', cH: 0.62 },
  'QD0bfy752Cs': { hl: "Markt in der *Ungewissheit*", st: 'neutral', fl: 'gekuerzt', cH: 0.68 },
  'KVuiRE2mz-Y': { hl: "Krypto vorm *Ausrasten*?", st: 'neutral', fl: 'mehrdeutig', cH: 0.6 },
  'WUukhyJ8614': { hl: "Angst, aber *Boden* kommt", st: 'bullish', fl: 'gekuerzt', cH: 0.64 },  // NEU (Re-Freeze)
  'dIURIiMUBT8': { hl: "Bitcoin-Zyklus *entschlüsselt*", st: 'neutral', fl: 'gekuerzt', cH: 0.7 },
  'VYlV-5p1pw4': { hl: "Wann *moont* XRP?", st: 'neutral', fl: 'mehrdeutig', cH: 0.6 },
  'ygnpUBS7zR0': { hl: "XRP *Moon* im Gange", st: 'bullish', fl: 'gekuerzt', cH: 0.7 },  // NEU (Re-Freeze)
  'DTN7fy-nrwU': { hl: "Fraktale *manifestieren* sich", st: 'neutral', fl: 'gekuerzt', cH: 0.68 },
  '8yuG3iurpRw': { hl: "Der Markt macht sich *bereit*", st: 'bullish', fl: 'gekuerzt', cH: 0.66 },
  '6-VXFu3FmzU': { hl: "*Altseason* startet", st: 'bullish', fl: 'gekuerzt', cH: 0.74 },
  '-EXMUHnSk_4': { hl: "Jetzt sind wir im *Timeframe*", st: 'bullish', fl: 'mehrdeutig', cH: 0.5, reviewed: true },
  'ljLZRPXAT8Y': { hl: "Kurz vor dem *Durchbruch*", st: 'bullish', fl: 'gekuerzt', cH: 0.68 },
  '70i_f7baMCw': { hl: "Der historische *Zug*", st: 'bullish', fl: 'mehrdeutig', cH: 0.6, reviewed: true },
  'AZ6hbzFmpJk': { hl: "Vor der finalen *Euphorie*?", st: 'bullish', fl: 'gekuerzt', cH: 0.66 },  // NEU (Re-Freeze)
  'bbYPpmEkL5w': { hl: "Washout vor der *Euphorie*?", st: 'neutral', fl: 'mehrdeutig', cH: 0.58 },  // NEU (Re-Freeze)
  'FbCfF8FXYTA': { hl: "Geht es in die *Expansion*?", st: 'neutral', fl: 'mehrdeutig', cH: 0.6 },  // NEU (Re-Freeze)
  'xIETv_E2ssA': { hl: "Noch *Expansion*?", st: 'neutral', fl: 'mehrdeutig', cH: 0.56 },  // NEU (Re-Freeze)
  'W7VfXKWrytQ': { hl: "*Entscheidungszeit* am Markt", st: 'neutral', fl: 'gekuerzt', cH: 0.7 },
  'v1kvmZ8WQrE': { hl: "XRP im *Bounce*", st: 'bullish', fl: 'mehrdeutig', cH: 0.62 },
  'leOo2swxJBY': { hl: "Zurück, *Entscheidungszeit*", st: 'neutral', fl: 'mehrdeutig', cH: 0.58 },
  'sCGI94J6P4s': { hl: "Der Markt *kocht*", st: 'bullish', fl: 'interpretiert', cH: 0.62 },
  'DhUxHaXEnJo': { hl: "Die Masse *schockiert*", st: 'bearish', fl: 'gekuerzt', cH: 0.64 },
  'aVcshMJJi8U': { hl: "*Numerologie* wirkt", st: 'neutral', fl: 'mehrdeutig', cH: 0.58 },  // NEU (Re-Freeze)
  'tiXwtp0KVB8': { hl: "Fraktale *formen* Realität", st: 'neutral', fl: 'interpretiert', cH: 0.6 },
  'IbjUQ9RJ0Q4': { hl: "Fraktale & *Numerologie*", st: 'neutral', fl: 'mehrdeutig', cH: 0.58 },
  'QwTTksUo44w': { hl: "Numerologie, *andere* Ebene", st: 'neutral', fl: 'mehrdeutig', cH: 0.58 },
  'pMbLJ0GFKeI': { hl: "Top 1% *Polymarket*-Trader", st: 'bullish', fl: 'gekuerzt', cH: 0.7 },
  '_37CitRtb_s': { hl: "*Aufbruch* oder Retracement?", st: 'neutral', fl: 'gekuerzt', cH: 0.66 },
  'H7IzK4YeC2E': { hl: "Darauf *unvorbereitet*", st: 'neutral', fl: 'mehrdeutig', cH: 0.58 },  // NEU (Re-Freeze)
  'FKZ67Sj0OyQ': { hl: "Markt *unvorbereitet*", st: 'neutral', fl: 'gekuerzt', cH: 0.66 },
  'kih74VbQdmk': { hl: "Die Bros sind *unvorbereitet*", st: 'neutral', fl: 'mehrdeutig', cH: 0.6 },
  '3Bu6xf-ams4': { hl: "Influencer im *Crash*", st: 'bearish', fl: 'mehrdeutig', cH: 0.6 },
  'fKWH2tAgS9c': { hl: "Noch ein *Crash*?", st: 'bearish', fl: 'mehrdeutig', cH: 0.6 },  // NEU (Re-Freeze)
  'eMTEyBy8eJU': { hl: "*Crash* durch News?", st: 'bearish', fl: 'gekuerzt', cH: 0.64 },
  'bVu-21kV3SU': { hl: "Bitcoin, die *Sonne*", st: 'bullish', fl: 'interpretiert', cH: 0.6 },
  'gm_dZ6_IptU': { hl: "Boden oder noch *tiefer*?", st: 'bearish', fl: 'gekuerzt', cH: 0.66 },
  'juUOMHY2PKU': { hl: "Wohin gehen *BTC, ETH, XRP*?", st: 'neutral', fl: 'mehrdeutig', cH: 0.55 },
  '6WvRq9cAuIE': { hl: "Bricht Bitcoin die *Range*?", st: 'neutral', fl: 'gekuerzt', cH: 0.68 },
  '-jYOHWaZ45E': { hl: "*Dump* oder seitwärts?", st: 'bearish', fl: 'gekuerzt', cH: 0.66 },
  '7jk1wR4jSn4': { hl: "Letzte *Wyckoff*-Phase?", st: 'bullish', fl: 'gekuerzt', cH: 0.68 },
  'kvIrcWv4cSE': { hl: "*Quit* oder Build?", st: 'neutral', fl: 'gekuerzt', cH: 0.66 },
  'Lxb6OkQY49A': { hl: "BTC, ETH, XRP, *HYPE*?", st: 'neutral', fl: 'mehrdeutig', cH: 0.58, reviewed: true },
  'k_rX-FzCVqU': { hl: "Kommt *Hyperliquid*?", st: 'neutral', fl: 'mehrdeutig', cH: 0.58, reviewed: true },
  'qRFdVxNXnVY': { hl: "Niemand ist *bullish*", st: 'bullish', fl: 'gekuerzt', cH: 0.64 },
  'Ik10ePQuZTM': { hl: "Crypto *signalisiert*", st: 'neutral', fl: 'mehrdeutig', cH: 0.55 },
  'jy3nboZgISE': { hl: "Was jeder *übersieht*", st: 'neutral', fl: 'interpretiert', cH: 0.6 },
  'fWjMwPCi7dU': { hl: "Keiner kennt den *Zyklus*", st: 'neutral', fl: 'gekuerzt', cH: 0.62 },
  'l-kqEUMDG4U': { hl: "*Sommerpause* oder Breakout?", st: 'neutral', fl: 'gekuerzt', cH: 0.64 },
  'fbgeK33dCLk': { hl: "Crypto und *HYPE*", st: 'neutral', fl: 'mehrdeutig', cH: 0.56, reviewed: true },
};

const STANCE_CONF = { bullish: 0.6, bearish: 0.6, neutral: 0.45 };
const FLAG_REASON = {
  gekuerzt:      'Langer Originaltitel auf 2-4 Worte mit einem Akzentwort verdichtet.',
  interpretiert: 'Aussage über den Wortlaut hinaus interpretiert/zugespitzt — gegen den Titel prüfen.',
  mehrdeutig:    'Titel vage oder nahe an einer Nachbarfolge — Headline ist eine Lesart, bitte prüfen.',
};

const items = cat.items.map(v => {
  const h = H[v.videoId];
  if (!h) throw new Error('keine Headline für ' + v.videoId);
  const sc = STANCE_MAP[h.st];
  const flag = h.reviewed ? 'geprueft' : h.fl;
  const needsReview = h.reviewed ? false : (h.fl !== 'gekuerzt' || h.cH < 0.62);
  return {
    videoId: v.videoId,
    preset: 'livestream',
    color: sc.color,
    chartForm: sc.chartForm,
    position: 'auto',
    headline: h.hl,
    episode: v.episode,
    date: v.date,
    titleScale: 'auto',
    approved: false,
    basis: 'youtube-title',
    stance: h.st,
    confidence: { stance: STANCE_CONF[h.st], headline: h.cH },
    flag,
    needsReview,
    fellBackToDefault: h.st === 'neutral',
    reasoning: {
      stance: 'Aus dem YouTube-Titel abgeleitet (kein Transkript vorhanden).',
      headline: FLAG_REASON[h.fl],
    },
    sourceTitle: v.title,
    warnings: [],
  };
});

// Headline-Invariante: genau ein Akzentwort pro Headline.
for (const it of items) {
  const n = (it.headline.match(/\*[^*]+\*/g) || []).length;
  if (n !== 1) throw new Error('Akzent-Anzahl ' + n + ' bei ' + it.episode);
}

const out = {
  generatedAt: cat.generatedAt,
  mode: 'manual',
  model: 'claude (Claude Code, Max-Abo — manuell aus YouTube-Titeln, ohne API/SDK)',
  source: 'data/livestream-catalog.json (67) — Titel als Kontext, Nummern eingefroren (Re-Freeze #1..#67)',
  series: 'livestream',
  threshold: 0.6,
  count: items.length,
  items,
};

fs.writeFileSync(path.join(ROOT, 'data', 'proposals.livestream.json'), JSON.stringify(out, null, 2) + '\n');
console.log('proposals.livestream.json:', items.length, 'Einträge geschrieben.');
console.log('flag review:', items.filter(i => i.needsReview).length, 'von', items.length);
