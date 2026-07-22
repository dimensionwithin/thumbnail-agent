'use strict';
// Review-Kontaktbogen für die 55 Livestreams -> review.livestream.html
// Gleiches Muster/Look wie src/review/build-contact-sheet.js (IC/DEBUNKED), aber mit den
// livestream-spezifischen Markern: flag, needsReview (⚑), und der titelbasierten
// stance/color-Einstufung (kein Transkript) zum gezielten Prüfen.
// Read-only Quellen: data/proposals.livestream.json + data/livestream-catalog.json (privacy).
// KEIN Backup, KEIN Publish. Schreibt nur review.livestream.html.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const props = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'proposals.livestream.json'), 'utf8'));
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'livestream-catalog.json'), 'utf8'));
const privacyById = Object.fromEntries(cat.items.map(v => [v.videoId, v.privacyStatus]));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function epNum(it) { const m = /#(\d+)/.exec(it.episode || ''); return m ? Number(m[1]) : Infinity; }

const FLAG_LABEL = {
  gekuerzt:      'gekürzt',
  interpretiert: 'interpretiert',
  mehrdeutig:    'mehrdeutig',
  geprueft:      'geprüft ✓',
};

function card(it, thumbsDir) {
  const img = `${thumbsDir}/adw-${it.videoId}.png`;
  const conf = it.confidence || {};
  const reasoning = it.reasoning || {};
  const review = it.needsReview === true;
  const privacy = privacyById[it.videoId] || '—';
  const partMatch = /\((\d\/2)\)/.exec(it.episode || '');
  const isDouble = !!partMatch;

  return `
  <article class="card${review ? ' review' : ''}${isDouble ? ' double' : ''}" data-flag="${esc(it.flag)}" data-review="${review ? '1' : '0'}">
    <div class="thumb"><img src="${esc(img)}" alt="${esc(it.videoId)}" loading="lazy"></div>
    <div class="meta">
      <div class="row id">
        <span class="ep">${esc(it.episode)}</span>
        <code>${esc(it.videoId)}</code>
        <span class="date">${esc(it.date)}</span>
        ${review ? '<span class="flagmark" title="Review empfohlen">&#9873; REVIEW</span>' : ''}
      </div>

      <div class="headline">${esc(it.headline)}</div>

      <div class="badges">
        <span class="badge privacy-${esc(privacy)}">${esc(privacy)}</span>
        <span class="badge stance-${esc(it.stance)}">stance: ${esc(it.stance)}</span>
        <span class="badge">color: ${esc(it.color)}</span>
        <span class="badge">chart: ${esc(it.chartForm)}</span>
        <span class="badge flag-${esc(it.flag)}">flag: ${esc(FLAG_LABEL[it.flag] || it.flag)}</span>
        ${isDouble ? `<span class="badge double-badge">Doppel-Sonntag ${esc(partMatch[1])}</span>` : ''}
      </div>

      <div class="badges">
        <span class="badge titlebased">&#9888; stance/color titelbasiert (kein Transkript) — prüfen</span>
        <span class="badge conf">conf · stance ${esc(conf.stance)} / headline ${esc(conf.headline)}</span>
      </div>

      ${reasoning.headline ? `<details class="reasoning"><summary>Reasoning</summary>
        <div><b>stance:</b> ${esc(reasoning.stance)}</div>
        <div><b>headline:</b> ${esc(reasoning.headline)}</div>
        <div><b>Originaltitel:</b> ${esc(it.sourceTitle)}</div></details>` : ''}
    </div>
  </article>`;
}

const items = props.items.slice().sort((a, b) => epNum(a) - epNum(b));
const reviewCount = items.filter(i => i.needsReview).length;
const doubleCount = items.filter(i => /\(\d\/2\)/.test(i.episode)).length;
const thumbsDir = 'data/thumbnails';
const cards = items.map(it => card(it, thumbsDir)).join('\n');
const generated = props.generatedAt;

const out = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Livestream-Katalog Review (55) — at dimension within</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; background: #14110d; color: #e8e2d6; }
  header { position: sticky; top: 0; z-index: 5; background: #1d1810; border-bottom: 1px solid #3a3020; padding: 14px 20px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .spacer { flex: 1; }
  .count { font-variant-numeric: tabular-nums; }
  .legend { font-size: 12px; color: #b8ad97; display: flex; gap: 14px; flex-wrap: wrap; }
  .legend b { color: #e8e2d6; }
  main { padding: 20px; display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); }
  .card { background: #1d1810; border: 1px solid #3a3020; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .card.review { outline: 2px solid #e3c46a; outline-offset: -2px; }
  .card.double { box-shadow: inset 4px 0 0 #7a9ad8; }
  .thumb { background: #000; aspect-ratio: 16/9; }
  .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .meta { padding: 12px 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .row.id { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  code { background: #14110d; padding: 2px 6px; border-radius: 4px; color: #b8ad97; font-size: 12px; }
  .date { font-size: 12px; color: #9a907a; font-variant-numeric: tabular-nums; }
  .flagmark { margin-left: auto; font-size: 11px; font-weight: 700; color: #14110d; background: #e3c46a; padding: 2px 9px; border-radius: 99px; letter-spacing: .04em; }
  .headline { font-size: 19px; font-weight: 600; color: #f3ecdd; }
  .headline { font-family: Georgia, "Times New Roman", serif; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: #2a2418; color: #c9bfa6; }
  .badge.stance-bullish { background: #28381f; color: #a6c98a; }
  .badge.stance-bearish { background: #3a1f1f; color: #d89a9a; }
  .badge.stance-neutral { background: #2a2418; color: #cabf9f; }
  .badge.privacy-public   { background: #1f3330; color: #8fd6c4; }
  .badge.privacy-unlisted { background: #33301f; color: #d8cb8f; }
  .badge.flag-mehrdeutig    { background: #4a3d12; color: #f5dd84; font-weight: 600; }
  .badge.flag-interpretiert { background: #45203a; color: #e79ac4; font-weight: 600; }
  .badge.flag-gekuerzt      { background: #2a2a3a; color: #b9b9d6; }
  .badge.flag-geprueft      { background: #1f331f; color: #9ad89a; font-weight: 600; }
  .badge.titlebased { background: #3a2e12; color: #e3c46a; }
  .badge.double-badge { background: #1f2a40; color: #9bb6e8; font-weight: 600; }
  .badge.conf { background: #181612; color: #8a8270; font-variant-numeric: tabular-nums; }
  .ep { font-weight: 700; font-size: 13px; color: #e8e2d6; background: #2a2418; padding: 2px 8px; border-radius: 5px; white-space: nowrap; }
  .reasoning { font-size: 12px; color: #b8ad97; }
  .reasoning summary { cursor: pointer; }
  .reasoning div { margin-top: 4px; }
  .card.review .ep { box-shadow: 0 0 0 1px #e3c46a; }
</style>
</head>
<body>
<header>
  <h1>Livestream-Katalog Review</h1>
  <span class="count"><b>${items.length}</b> Folgen (#1–#${items.length})</span>
  <span class="count" style="color:#f5dd84">&#9873; <b>${reviewCount}</b> Review</span>
  <span class="count" style="color:#9bb6e8"><b>${doubleCount}</b> Doppel-Sonntag</span>
  <span class="spacer"></span>
  <span class="legend">
    <span>&#9873; gelber Rahmen = Review empfohlen</span>
    <span>blaue Kante = Doppel-Sonntag</span>
    <span><b>jede</b> stance/color ist titelbasiert</span>
  </span>
</header>
<main id="cards">
${cards}
</main>
<footer style="padding:16px 20px;color:#8a8270;font-size:12px;border-top:1px solid #3a3020">
  Quelle: data/proposals.livestream.json (abgenommen) · Thumbnails: data/thumbnails/ · generiert aus ${esc(generated)} ·
  Nur-Lese-Ansicht, kein Export/Publish.
</footer>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'review.livestream.html'), out);
console.log('review.livestream.html geschrieben:', items.length, 'Karten,', reviewCount, 'Review,', doubleCount, 'Doppel-Sonntag');
