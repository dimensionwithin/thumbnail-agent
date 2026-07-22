'use strict';

// P3 (Review-Harvester): BOARD. Baut aus data/comments-ranked.json eine statische
// review.comments.html im Kontaktbogen-Stil (wie der Thumbnail-Review): pro Kommentar
// Text, Autor, Likes, Quell-Video mit Link, Score + Reasoning. Pro Eintrag:
// Freigeben / Ablehnen, plus Checkbox "Autor anonymisieren" (Handle -> Vorname/Initialen,
// editierbar). Auswahl exportiert per Browser-Download nach data/decisions.json.
//
// Kein Netz, keine Keys. Flags:
//   --in=PATH    Ranking (Default: data/comments-ranked.json)
//   --out=PATH   HTML-Ausgabe (Default: review.comments.html im Projekt-Root)

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { in: 'data/comments-ranked.json', out: 'review.comments.html' };
  for (const t of argv.slice(2)) {
    if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
  }
  return a;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Heuristischer Anonymisierungs-Vorschlag (im Board editierbar): @Handle -> erster
// Namens-Token kapitalisiert, sonst Initialen. Nur ein Startwert, kein Automatismus.
function suggestAnon(handle) {
  const raw = String(handle || '').replace(/^@/, '');
  const tokens = raw.split(/[^A-Za-zÄÖÜäöüß]+/).filter(Boolean);
  if (tokens.length === 0) return 'Anonym';
  const first = tokens[0];
  if (first.length >= 3) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return tokens.map(t => t.charAt(0).toUpperCase()).join('.') + '.';
}

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function card(item, idx) {
  const c = item.classification || {};
  const url = videoUrl(item.videoId);
  const date = item.publishedAt ? String(item.publishedAt).slice(0, 10) : '';
  const anonSuggest = suggestAnon(item.author);
  const score = c.testimonialScore;
  const scoreClass = score >= 8 ? 'hi' : (score >= 6 ? 'mid' : 'lo');

  return `
  <article class="card" data-idx="${idx}"
           data-id="${esc(item.id)}"
           data-author="${esc(item.author)}"
           data-likes="${esc(item.likeCount)}"
           data-video-id="${esc(item.videoId)}"
           data-video-title="${esc(item.videoTitle)}"
           data-video-url="${esc(url)}"
           data-date="${esc(date)}"
           data-score="${esc(score)}">
    <div class="meta">
      <div class="row top">
        <span class="score ${scoreClass}">${esc(score)}/10</span>
        <span class="chip conf">conf ${esc(c.confidence)}</span>
        <span class="chip likes">&#9829; ${esc(item.likeCount)}</span>
        <span class="spacer"></span>
        <div class="decide">
          <button class="dc dc-approve" type="button">Freigeben</button>
          <button class="dc dc-reject" type="button">Ablehnen</button>
        </div>
      </div>

      <div class="badges">
        <span class="badge sentiment-${esc(c.sentiment)}">${esc(c.sentiment)}</span>
        ${c.concreteness ? '<span class="badge ok">konkret</span>' : '<span class="badge mute">generisch</span>'}
        ${c.irony ? '<span class="badge warn">&#9888; Ironie?</span>' : ''}
      </div>

      <blockquote class="quote">${esc(item.text)}</blockquote>
      ${c.reason ? `<div class="reason"><b>Begr&uuml;ndung (Vorschlag):</b> ${esc(c.reason)}</div>` : ''}

      <div class="author-row">
        <span class="handle">${esc(item.author)}</span>
        <label class="anon-toggle"><input type="checkbox" class="f-anon"> <span>Autor anonymisieren</span></label>
        <input type="text" class="f-anon-value" value="${esc(anonSuggest)}" title="Angezeigter Name, wenn anonymisiert">
      </div>

      <a class="video" href="${esc(url)}" target="_blank" rel="noopener">&#9654; ${esc(item.videoTitle)}</a>
    </div>
  </article>`;
}

function html(ranked) {
  const items = (ranked.items || []).slice();
  const cards = items.map((it, i) => card(it, i)).join('\n');
  const generated = new Date().toISOString();
  const mode = ranked.mode || 'unbekannt';

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review-Kuration — Testimonials — at dimension within</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; background: #14110d; color: #e8e2d6; }
  header { position: sticky; top: 0; z-index: 5; background: #1d1810; border-bottom: 1px solid #3a3020; padding: 14px 20px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .spacer { flex: 1; }
  .count { font-variant-numeric: tabular-nums; font-size: 13px; }
  .count b { font-size: 15px; }
  .count.app b { color: #a6c98a; }
  .count.rej b { color: #d89a9a; }
  .hint { font-size: 12px; color: #9a907a; }
  button { font: inherit; background: #a98246; color: #14110d; border: 0; border-radius: 6px; padding: 9px 16px; font-weight: 600; cursor: pointer; }
  button:hover { background: #c79a55; }
  main { padding: 20px; display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); }
  .card { background: #1d1810; border: 1px solid #3a3020; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; transition: border-color .15s, box-shadow .15s; }
  .card.approved { border-color: #6a8a6a; box-shadow: inset 0 0 0 1px #6a8a6a55; }
  .card.rejected { border-color: #6a3a3a; opacity: .5; }
  .meta { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 11px; }
  .row.top { display: flex; align-items: center; gap: 8px; }
  .score { font-weight: 700; font-size: 14px; padding: 3px 9px; border-radius: 6px; background: #2a2418; white-space: nowrap; }
  .score.hi { background: #28381f; color: #b6d99a; }
  .score.mid { background: #3a3416; color: #e3c46a; }
  .score.lo { background: #3a2418; color: #d8a98a; }
  .chip { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: #2a2418; color: #c9bfa6; white-space: nowrap; }
  .spacer { flex: 1; }
  .decide { display: flex; gap: 6px; }
  .dc { padding: 6px 12px; font-size: 13px; background: #2a2418; color: #c9bfa6; border: 1px solid #3a3020; }
  .dc:hover { background: #3a3020; }
  .dc-approve.on { background: #6a8a6a; color: #14110d; border-color: #6a8a6a; }
  .dc-reject.on { background: #b06a6a; color: #14110d; border-color: #b06a6a; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: #2a2418; color: #c9bfa6; }
  .badge.sentiment-positiv { background: #28381f; color: #a6c98a; }
  .badge.sentiment-negativ { background: #3a1f1f; color: #d89a9a; }
  .badge.ok { background: #233a2a; color: #9ad0b0; }
  .badge.mute { background: #2a2418; color: #9a907a; }
  .badge.warn { background: #4a3d12; color: #f5dd84; font-weight: 600; }
  .quote { margin: 0; padding: 10px 12px; background: #14110d; border-left: 3px solid #a98246; border-radius: 4px; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
  .reason { font-size: 12px; color: #b8ad97; }
  .author-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .handle { font-size: 13px; color: #b8ad97; font-weight: 600; }
  .anon-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; font-size: 12px; color: #9a907a; }
  .anon-toggle input { width: 16px; height: 16px; accent-color: #a98246; }
  .f-anon-value { font: inherit; font-size: 13px; background: #14110d; color: #e8e2d6; border: 1px solid #3a3020; border-radius: 5px; padding: 5px 8px; flex: 1; min-width: 120px; }
  .f-anon-value:focus { outline: 2px solid #a98246; }
  .f-anon-value:disabled { opacity: .4; }
  .video { font-size: 12px; color: #9ab4d0; text-decoration: none; padding-top: 2px; }
  .video:hover { text-decoration: underline; }
</style>
</head>
<body>
<header>
  <h1>Testimonial-Kuration</h1>
  <span class="count app"><b id="napp">0</b> freigegeben</span>
  <span class="count rej"><b id="nrej">0</b> abgelehnt</span>
  <span class="count">von ${items.length} (Quelle: ${esc(mode)})</span>
  <span class="hint">Scores sind Vorschl&auml;ge &mdash; du entscheidest.</span>
  <span class="spacer"></span>
  <button id="export">decisions.json exportieren</button>
</header>
<main id="cards">
${cards}
</main>
<script>
  var GENERATED = ${JSON.stringify(generated)};

  // Klick auf Freigeben/Ablehnen: toggelt den Karten-Zustand (an/aus).
  document.getElementById('cards').addEventListener('click', function (e) {
    var btn = e.target.closest('.dc');
    if (!btn) return;
    var card = btn.closest('.card');
    var approve = btn.classList.contains('dc-approve');
    var isApproved = card.classList.contains('approved');
    var isRejected = card.classList.contains('rejected');
    card.classList.remove('approved', 'rejected');
    card.querySelector('.dc-approve').classList.remove('on');
    card.querySelector('.dc-reject').classList.remove('on');
    if (approve && !isApproved) { card.classList.add('approved'); card.querySelector('.dc-approve').classList.add('on'); }
    else if (!approve && !isRejected) { card.classList.add('rejected'); card.querySelector('.dc-reject').classList.add('on'); }
    refreshCount();
  });

  // Anonymisieren-Checkbox aktiviert/deaktiviert das Namensfeld.
  document.getElementById('cards').addEventListener('change', function (e) {
    if (e.target && e.target.classList.contains('f-anon')) {
      var row = e.target.closest('.author-row');
      var input = row.querySelector('.f-anon-value');
      input.disabled = !e.target.checked;
    }
  });

  function refreshCount() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
    var app = 0, rej = 0;
    cards.forEach(function (c) {
      if (c.classList.contains('approved')) app++;
      else if (c.classList.contains('rejected')) rej++;
    });
    document.getElementById('napp').textContent = app;
    document.getElementById('nrej').textContent = rej;
  }

  function cardToDecision(card) {
    var anonOn = card.querySelector('.f-anon').checked;
    var anonVal = card.querySelector('.f-anon-value').value.trim();
    return {
      id: card.getAttribute('data-id'),
      quote: card.querySelector('.quote').textContent,
      author: card.getAttribute('data-author'),
      anonymize: anonOn,
      authorAnonymized: anonVal,
      likes: Number(card.getAttribute('data-likes')) || 0,
      videoId: card.getAttribute('data-video-id'),
      videoTitle: card.getAttribute('data-video-title'),
      videoUrl: card.getAttribute('data-video-url'),
      date: card.getAttribute('data-date'),
      score: Number(card.getAttribute('data-score')) || null
    };
  }

  // Liefert NUR die freigegebenen Eintraege.
  window.__buildDecisions = function () {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card.approved'));
    return {
      generatedAt: new Date().toISOString(),
      builtFrom: GENERATED,
      count: cards.length,
      items: cards.map(cardToDecision)
    };
  };

  document.getElementById('export').addEventListener('click', function () {
    var data = window.__buildDecisions();
    if (data.count === 0) { alert('Noch nichts freigegeben — kein Export.'); return; }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'decisions.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  refreshCount();
</script>
</body>
</html>`;
}

function main() {
  const args = parseArgs(process.argv);
  const inPath = path.resolve(args.in);
  if (!fs.existsSync(inPath)) {
    throw new Error(`Ranking nicht gefunden: ${inPath} (erst 'npm run reviews:rank' laufen lassen).`);
  }
  const ranked = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const out = html(ranked);
  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, out);
  console.log(`Review-Board geschrieben: ${outPath}`);
  console.log(`Eintraege: ${(ranked.items || []).length} (Quelle: ${ranked.mode || 'unbekannt'})`);
  console.log('Im Browser oeffnen, Freigeben/Ablehnen + ggf. anonymisieren, "decisions.json exportieren" -> Datei nach data/ legen.');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('Board fehlgeschlagen:', e.message); process.exit(1); }
}

module.exports = { html, card, suggestAnon, videoUrl, parseArgs };
