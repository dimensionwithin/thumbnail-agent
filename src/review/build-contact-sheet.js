'use strict';

// P4: Review-Kontaktbogen. Baut aus data/proposals.json + den gerenderten Thumbnails
// eine statische review.html: pro Video das Thumbnail, eine editierbare Config,
// Konfidenz/Reasoning sichtbar, und ein Approve-Toggle. Export -> data/decisions.json
// (nur approved:true, finale Configs nach Vertrag) per Browser-Download.
//
// Kein Netz, keine Keys. Flags:
//   --in=PATH    Vorschlaege (Default: data/proposals.json)
//   --out=PATH   HTML-Ausgabe (Default: review.html im Projekt-Root)
//   --thumbs=DIR Thumbnail-Verzeichnis relativ zur HTML (Default: data/thumbnails)

const fs = require('fs');
const path = require('path');
const {
  PRESETS, COLORS, CHART_FORMS, POSITIONS,
} = require('../config-schema');

function parseArgs(argv) {
  const a = { in: 'data/proposals.json', out: 'review.html', thumbs: 'data/thumbnails' };
  for (const t of argv.slice(2)) {
    if (t.startsWith('--in=')) a.in = t.slice(5);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
    else if (t.startsWith('--thumbs=')) a.thumbs = t.slice(9);
  }
  return a;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function optionList(values, selected) {
  return values.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function card(item, thumbsDir) {
  const img = `${thumbsDir}/adw-${item.videoId}.png`;
  const conf = item.confidence || {};
  const low = item.fellBackToDefault === true;
  const cs = typeof conf.stance === 'number' ? conf.stance : null;
  // Grenzfall: Stance-Konfidenz dicht an der 0.6-Schwelle (0.55-0.65) -> Haerchen-Call,
  // gezielt manuell pruefen. Visuell mit gelbem Ring + Badge markiert.
  const borderline = cs != null && cs >= 0.55 && cs <= 0.65;
  const fallback = item.basis === 'title-fallback';
  // Stance widerspricht dem Erwartungs-Bogen (nur Sanity-Check) -> gezielt pruefen.
  const conflict = item.expectationConflict === true;
  const reasoning = item.reasoning || {};
  const titleScale = item.titleScale == null ? 'auto' : item.titleScale;

  return `
  <article class="card${low ? ' low' : ''}${borderline ? ' borderline' : ''}${conflict ? ' conflict' : ''}" data-video-id="${esc(item.videoId)}"
           data-chart-seed="${item.chartSeed == null ? '' : esc(item.chartSeed)}"
           data-label="${esc(item.label == null ? '' : item.label)}">
    <div class="thumb"><img src="${esc(img)}" alt="${esc(item.videoId)}" loading="lazy"></div>
    <div class="meta">
      <div class="row id">
        <span class="ep">${esc(item.episode)}</span>
        <code>${esc(item.videoId)}</code>
        <label class="approve"><input type="checkbox" class="f-approved"${item.approved ? ' checked' : ''}> <span>Freigeben</span></label>
      </div>

      <div class="badges">
        <span class="badge stance-${esc(item.stance)}">stance: ${esc(item.stance)} (${esc(conf.stance)})</span>
        <span class="badge">headline-conf: ${esc(conf.headline)}</span>
        ${conflict ? `<span class="badge conflict-badge">&#9888; Stance&harr;Erwartung-Konflikt (erwartet: ${esc(item.expectation)})</span>` : ''}
        ${borderline ? '<span class="badge borderline-badge">&#9888; Grenzfall 0.55&ndash;0.65 &mdash; H&auml;rchen-Call</span>' : ''}
        ${fallback ? '<span class="badge fallback-badge">Titel-Fallback (keine ASR)</span>' : ''}
        ${low ? '<span class="badge warn">Low-Confidence &rarr; gold/standard-Default — bitte pruefen</span>' : ''}
      </div>
      ${reasoning.stance || reasoning.headline ? `<details class="reasoning"><summary>Reasoning</summary>
        <div><b>stance:</b> ${esc(reasoning.stance)}</div>
        <div><b>headline:</b> ${esc(reasoning.headline)}</div></details>` : ''}

      <label class="field"><span>headline</span>
        <input type="text" class="f-headline" value="${esc(item.headline)}"></label>

      <div class="grid">
        <label class="field"><span>color</span>
          <select class="f-color">${optionList(COLORS, item.color)}</select></label>
        <label class="field"><span>chartForm</span>
          <select class="f-chartForm">${optionList(CHART_FORMS, item.chartForm)}</select></label>
        <label class="field"><span>preset</span>
          <select class="f-preset">${optionList(PRESETS, item.preset)}</select></label>
        <label class="field"><span>position</span>
          <select class="f-position">${optionList(POSITIONS, item.position)}</select></label>
        <label class="field"><span>titleScale</span>
          <input type="text" class="f-titleScale" value="${esc(titleScale)}"></label>
        <label class="field"><span>episode</span>
          <input type="text" class="f-episode" value="${esc(item.episode)}"></label>
        <label class="field"><span>date</span>
          <input type="text" class="f-date" value="${esc(item.date)}"></label>
      </div>
    </div>
  </article>`;
}

function episodeNum(it) {
  const m = /#(\d+)/.exec(it.episode || '');
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function html(proposals, thumbsDir) {
  // Chronologisch nach Episode #1..#63 sortieren, damit der Makro-Bogen lesbar ist.
  const items = (proposals.items || []).slice().sort((a, b) => episodeNum(a) - episodeNum(b));
  const borderlineCount = items.filter(it => {
    const cs = it.confidence && it.confidence.stance;
    return typeof cs === 'number' && cs >= 0.55 && cs <= 0.65;
  }).length;
  const cards = items.map(it => card(it, thumbsDir)).join('\n');
  const generated = new Date().toISOString();

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Back-Catalog Review — at dimension within</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; background: #14110d; color: #e8e2d6; }
  header { position: sticky; top: 0; z-index: 5; background: #1d1810; border-bottom: 1px solid #3a3020; padding: 14px 20px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .spacer { flex: 1; }
  .count { font-variant-numeric: tabular-nums; }
  button { font: inherit; background: #a98246; color: #14110d; border: 0; border-radius: 6px; padding: 9px 16px; font-weight: 600; cursor: pointer; }
  button:hover { background: #c79a55; }
  main { padding: 20px; display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); }
  .card { background: #1d1810; border: 1px solid #3a3020; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .card.low { border-color: #8a6a2a; box-shadow: inset 0 0 0 1px #8a6a2a44; }
  .card.borderline { outline: 2px solid #e3c46a; outline-offset: -2px; }
  .card.conflict { box-shadow: 0 0 0 3px #c25b86, inset 0 0 0 1px #c25b8688; }
  .thumb { background: #000; aspect-ratio: 16/9; }
  .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .meta { padding: 12px 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .row.id { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  code { background: #14110d; padding: 2px 6px; border-radius: 4px; color: #b8ad97; font-size: 12px; }
  .approve { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .approve input { width: 18px; height: 18px; accent-color: #6a8a6a; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: #2a2418; color: #c9bfa6; }
  .badge.stance-bullish { background: #28381f; color: #a6c98a; }
  .badge.stance-bearish { background: #3a1f1f; color: #d89a9a; }
  .badge.warn { background: #3a2e12; color: #e3c46a; }
  .badge.borderline-badge { background: #4a3d12; color: #f5dd84; font-weight: 600; }
  .badge.conflict-badge { background: #45203a; color: #e79ac4; font-weight: 600; }
  .badge.fallback-badge { background: #2a2a3a; color: #b9b9d6; }
  .ep { font-weight: 700; font-size: 13px; color: #e8e2d6; background: #2a2418; padding: 2px 8px; border-radius: 5px; white-space: nowrap; }
  .row.id { justify-content: flex-start; }
  .row.id .approve { margin-left: auto; }
  .reasoning { font-size: 12px; color: #b8ad97; }
  .reasoning summary { cursor: pointer; }
  .field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #9a907a; }
  .field span { text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  .field input, .field select { font: inherit; font-size: 14px; background: #14110d; color: #e8e2d6; border: 1px solid #3a3020; border-radius: 5px; padding: 6px 8px; }
  .field input:focus, .field select:focus { outline: 2px solid #a98246; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .card.approved { border-color: #6a8a6a; }
</style>
</head>
<body>
<header>
  <h1>Back-Catalog Review</h1>
  <span class="count"><b id="napproved">0</b> / ${items.length} freigegeben</span>
  <span class="count borderline-count" title="Stance-Konfidenz 0.55–0.65 — gezielt pruefen">&#9888; <b>${borderlineCount}</b> Grenzf&auml;lle</span>
  <span class="spacer"></span>
  <button id="export">decisions.json exportieren</button>
</header>
<main id="cards">
${cards}
</main>
<script>
  var GENERATED = ${JSON.stringify(generated)};
  var SOURCE = ${JSON.stringify(proposals.source || null)};

  function val(card, cls) {
    var el = card.querySelector('.' + cls);
    return el ? el.value : undefined;
  }
  function normTitleScale(v) {
    if (v == null) return 'auto';
    var s = String(v).trim();
    if (s === '' || s.toLowerCase() === 'auto') return 'auto';
    var n = Number(s);
    return isFinite(n) ? n : 'auto';
  }
  function cardToConfig(card) {
    var cfg = {
      videoId: card.getAttribute('data-video-id'),
      preset: val(card, 'f-preset'),
      color: val(card, 'f-color'),
      chartForm: val(card, 'f-chartForm'),
      headline: val(card, 'f-headline'),
      episode: val(card, 'f-episode') || undefined,
      date: val(card, 'f-date') || undefined,
      position: val(card, 'f-position'),
      titleScale: normTitleScale(val(card, 'f-titleScale')),
      approved: true
    };
    var seed = card.getAttribute('data-chart-seed');
    if (seed) cfg.chartSeed = Number(seed);
    var label = card.getAttribute('data-label');
    if (label) cfg.label = label;
    // leere optionale Felder entfernen
    Object.keys(cfg).forEach(function (k) { if (cfg[k] === undefined) delete cfg[k]; });
    return cfg;
  }
  // Liefert NUR die freigegebenen Videos mit ihren (ggf. editierten) finalen Configs.
  window.__buildDecisions = function () {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
    var approved = cards.filter(function (c) { return c.querySelector('.f-approved').checked; });
    return {
      generatedAt: new Date().toISOString(),
      builtFrom: GENERATED,
      source: SOURCE,
      count: approved.length,
      items: approved.map(cardToConfig)
    };
  };
  function refreshCount() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
    var n = 0;
    cards.forEach(function (c) {
      var on = c.querySelector('.f-approved').checked;
      c.classList.toggle('approved', on);
      if (on) n++;
    });
    document.getElementById('napproved').textContent = n;
  }
  document.getElementById('cards').addEventListener('change', function (e) {
    if (e.target && e.target.classList.contains('f-approved')) refreshCount();
  });
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
    throw new Error(`Vorschlaege nicht gefunden: ${inPath} (erst 'npm run decide' laufen lassen).`);
  }
  const proposals = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const out = html(proposals, args.thumbs);
  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, out);
  console.log(`Review-Kontaktbogen geschrieben: ${outPath}`);
  console.log(`Videos: ${(proposals.items || []).length}; Thumbnails aus: ${args.thumbs}`);
  console.log('Im Browser oeffnen, pruefen/editieren, "decisions.json exportieren" -> Datei nach data/ legen.');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('Kontaktbogen fehlgeschlagen:', e.message); process.exit(1); }
}

module.exports = { html, card, parseArgs };
