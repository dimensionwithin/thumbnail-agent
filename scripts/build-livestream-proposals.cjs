'use strict';
// Source-of-Truth-Generator von data/proposals.livestream.json — KEIN API/SDK, KEIN externer Call.
// Re-Freeze #1..#67 (Studio-validiert). Headlines je videoId (renumbering-fest):
// bestehende 55 TEXT-IDENTISCH (inkl. 5 Korrekturen), 12 Re-Freeze-Neuzugänge ergänzt.
// videoId/#N/date/Titel stammen aus data/livestream-catalog.json (eingefroren),
// die Headline-Tabelle aus data/livestream-headlines.json. BEIDE liegen bewusst
// unter data/ (gitignored) und NICHT im Quelltext: dieses Repo ist oeffentlich,
// und die Schluessel sind videoIds ungelisteter Videos. Nicht zurueckverdrahten --
// Begruendung in docs/warum-keine-video-ids-im-repo.md.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const readData = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));
const cat = readData('livestream-catalog.json');

// stance -> Farbe + Chart-Form (Compositor-Verankerung)
const STANCE_MAP = {
  bullish: { color: 'sage',    chartForm: 'expansion' },
  bearish: { color: 'oxblood', chartForm: 'collapse'  },
  neutral: { color: 'brass',   chartForm: 'fractal'   },
};

// Headlines je videoId -- Inhalt siehe data/livestream-headlines.json:
//   hl=Headline (kurz, ein *Akzentwort*); st=stance; fl=gekuerzt|interpretiert|mehrdeutig;
//   cH=confidence headline; reviewed=true -> manuell abgenommen (flag 'geprueft', kein Review).
const H = readData('livestream-headlines.json').headlines;

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
