// P0 render harness: configs.json -> on-brand thumbnail PNGs, via the compositor (headless).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

(async () => {
  const COMPOSITOR = 'file://' + path.resolve('thumbnail-compositor.html');
  const configsPath = process.argv[2] || 'configs.sample.json';
  const outDir = process.argv[3] || 'out';
  // proposals.json fuehrt Agent-Metadaten (Konfidenz etc.) mit; nur die Engine-Felder rendern.
  let configs = JSON.parse(fs.readFileSync(configsPath,'utf8'));
  if (!Array.isArray(configs) && Array.isArray(configs.items)) configs = configs.items;
  try { configs = configs.map(require('./src/config-schema').toEngineConfig); } catch (_) {}
  fs.mkdirSync(outDir, { recursive:true });

  const b = await chromium.launch();
  const ctx = await b.newContext({ offline:true });
  // hard-offline: only local/data/blob (proves no CDN dependency)
  await ctx.route('**', r => { const u=r.request().url(); (u.startsWith('file:')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort(); });
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(COMPOSITOR);
  await p.waitForFunction(() => typeof window.adwRender === 'function');

  for (const cfg of configs){
    // CJ1: Die Emblem-Varianten liegen nicht mehr in der HTML, sondern werden vom
    // lokalen Dienst geholt -- den gibt es hier nicht (file://, hart offline).
    // Deshalb reicht die Harness die gewaehlte Variante als Data-URI durch; ohne
    // Angabe zeichnet der Compositor seinen eingebetteten Rueckfall.
    if (cfg.emblemVariant){
      const file = path.join('assets','branding','emblems', cfg.emblemVariant + '.png');
      if (fs.existsSync(file)) cfg.emblemDataUri = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
      else console.warn('WARNUNG: Variante "'+cfg.emblemVariant+'" nicht gefunden, Rueckfall wird gezeichnet.');
    }
    const dataUrl = await p.evaluate(c => window.adwRender(c), cfg);
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const file = path.join(outDir, 'adw-' + cfg.videoId + '.png');
    fs.writeFileSync(file, buf);
    console.log('rendered', cfg.videoId, '->', file, (buf.length/1024|0)+'KB', cfg.chartForm+'/'+cfg.color+'/'+cfg.preset);
  }
  console.log('ERRORS', JSON.stringify(errs));
  await b.close();
})();
