'use strict';
// Einmalige Headless-Verifikation fuer P4 (kein Teil der Pipeline).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = 'file://' + path.resolve('review.html').split(path.sep).join('/');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 2400 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(url);
  // lazy-Images: durchscrollen und auf vollstaendiges Laden warten
  await p.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); }
  });
  await p.waitForFunction(() => Array.from(document.images).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 5000 });

  let ok = true;
  const fail = m => { ok = false; console.log('  FAIL: ' + m); };

  // 1) 6 Karten + 6 geladene Thumbnails; referenzierte PNGs existieren
  const cards = await p.$$eval('.card', els => els.map(e => e.getAttribute('data-video-id')));
  const imgs = await p.$$eval('.thumb img', els => els.map(e => ({ src: e.getAttribute('src'), w: e.naturalWidth })));
  if (cards.length !== 6) fail('Kartenzahl=' + cards.length);
  if (imgs.length !== 6) fail('Bildzahl=' + imgs.length);
  for (const im of imgs) {
    const file = path.resolve(decodeURIComponent(im.src));
    if (!fs.existsSync(file)) fail('Thumbnail-Datei fehlt: ' + im.src);
    if (im.w === 0) fail('Thumbnail nicht geladen (naturalWidth=0): ' + im.src);
  }

  // 2) Editieren + Freigeben: Karte 1 Headline aendern + approve, Karte 4 approve, Rest aus
  await p.evaluate(() => {
    const cs = document.querySelectorAll('.card');
    cs[0].querySelector('.f-headline').value = 'Bitcoin *explodiert*';
    cs[0].querySelector('.f-color').value = 'sage';
    cs[0].querySelector('.f-approved').checked = true;
    cs[3].querySelector('.f-approved').checked = true; // vid_live_0004
  });

  const decisions = await p.evaluate(() => window.__buildDecisions());

  // 3) Export: nur Freigaben, finale (editierte) Configs, approved:true
  if (decisions.count !== 2) fail('Export count=' + decisions.count + ' (erwartet 2)');
  const ids = decisions.items.map(i => i.videoId).sort();
  if (JSON.stringify(ids) !== JSON.stringify(['vid_bull_0001', 'vid_live_0004'])) fail('Export-IDs=' + ids.join(','));
  const v1 = decisions.items.find(i => i.videoId === 'vid_bull_0001');
  if (!v1 || v1.headline !== 'Bitcoin *explodiert*') fail('Edit nicht im Export: ' + (v1 && v1.headline));
  if (decisions.items.some(i => i.approved !== true)) fail('Nicht-approved im Export');
  if (decisions.items.some(i => i.videoId === 'vid_bear_0002')) fail('Nicht-freigegebenes Video im Export');
  for (const it of decisions.items) {
    for (const k of ['videoId', 'preset', 'color', 'chartForm', 'position', 'titleScale']) {
      if (it[k] == null) fail('Vertragsfeld fehlt (' + it.videoId + '): ' + k);
    }
  }
  if (errs.length) fail('JS-Fehler: ' + errs.join('; '));

  fs.mkdirSync(path.resolve('fixtures'), { recursive: true });
  fs.writeFileSync(path.resolve('fixtures', 'decisions.sample.json'), JSON.stringify(decisions, null, 2));
  console.log(ok
    ? 'P4 CHECKS BESTANDEN — 6 Thumbnails geladen, Edit wirkt auf Export, Export nur Freigaben (2). fixtures/decisions.sample.json geschrieben.'
    : 'P4 CHECKS FEHLGESCHLAGEN');
  await b.close();
  process.exit(ok ? 0 : 1);
})();
