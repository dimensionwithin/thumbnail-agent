// Bettet assets/branding/aiv-emblem.png als data:-URI in thumbnail-compositor.html ein.
//
// Warum ueberhaupt einbetten: Der lokale Dienst liefert keine statischen
// Dateien aus (thumbnail_service.py kennt nur /, /api/health,
// /api/source/latest, /api/series-registry) und die Render-Harness laedt den
// Compositor ueber file:// mit hartem Offline-Routing -- ein <img src="assets/...">
// wuerde dort gar nicht laden bzw. das Canvas "tainten", womit toBlob() wirft.
// Die PNG-Datei bleibt die Quelle der Wahrheit, dieser Schritt ist wiederholbar.
//
//   node scripts/embed-aiv-emblem.cjs
const fs = require('fs'), path = require('path');

// Auf diese Kantenlaenge wird vor dem Einbetten verkleinert. Bei Default-Groesse
// 360 im 1280x720-Raum rendert das Emblem @2x auf 720 px -- 640 deckt das ab,
// waehrend das Original (2048 px, ~1 MB) die HTML um Megabytes aufblasen wuerde.
// assets/branding/aiv-emblem.png bleibt die volle Quelle der Wahrheit.
const MAX_EDGE = 640;

const ROOT = path.resolve(__dirname, '..');
const PNG = path.join(ROOT, 'assets', 'branding', 'aiv-emblem.png');
const HTML = path.join(ROOT, 'thumbnail-compositor.html');
const BEGIN = '// >>> AIV-EMBLEM-DATA-URI (erzeugt von scripts/embed-aiv-emblem.cjs -- nicht von Hand editieren)';
const END = '// <<< AIV-EMBLEM-DATA-URI';

if (!fs.existsSync(PNG)){
  console.error('Nicht gefunden: ' + path.relative(ROOT, PNG));
  console.error('Lege das quadratische, transparente PNG dort ab (>= 512 px) und starte erneut.');
  process.exit(1);
}
const png = fs.readFileSync(PNG);
if (png.slice(0, 8).toString('hex') !== '89504e470d0a1a0a'){
  console.error('Die Datei ist kein PNG (Signatur passt nicht).');
  process.exit(1);
}
// IHDR: Breite/Hoehe/Farbtyp stehen ab Byte 16. Farbtyp 6 = RGBA, 4 = Grau+Alpha.
const width = png.readUInt32BE(16), height = png.readUInt32BE(20), colorType = png[25];
if (width !== height) console.warn('WARNUNG: nicht quadratisch (' + width + 'x' + height + ') -- das Emblem wird trotzdem seitenrichtig eingepasst.');
if (width < 512) console.warn('WARNUNG: nur ' + width + ' px Kantenlaenge. Bei Default-Groesse 260 im 1280x720-Raum rendert das @2x auf 520 px -- feine Schraffur wird weich.');
// Harter Abbruch statt Warnung: ein PNG ohne Alpha legt eine deckende Kachel
// ueber das Thumbnail. Genau das ist beim ersten Versuch passiert -- die Datei
// war ein Vorschaubild mit EINGEBRANNTEM Transparenz-Schachbrett (Farbtyp 2).
if (colorType !== 6 && colorType !== 4){
  console.error('ABBRUCH: PNG-Farbtyp ' + colorType + ' -- die Datei hat KEINEN Alphakanal.');
  console.error('Ohne Transparenz landet ein deckender Kasten auf dem Thumbnail. Haeufige Ursache:');
  console.error('das Vorschaubild des Generators gespeichert (mit aufgemaltem Schachbrettmuster)');
  console.error('statt des echten PNG-Exports. Es wurde NICHTS eingebettet.');
  process.exit(1);
}

// Verkleinern ueber headless Chromium -- dieselbe Bildpipeline, die auch der
// Compositor benutzt, und Playwright ist ohnehin Projektabhaengigkeit. Alpha
// bleibt erhalten (transparentes Canvas, PNG raus).
async function scaleToMaxEdge(buffer){
  if (Math.max(width, height) <= MAX_EDGE) return buffer;
  const source = 'data:image/png;base64,' + buffer.toString('base64');
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const out = await page.evaluate(async ({ src, max }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = src; });
      const s = max / Math.max(img.naturalWidth, img.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * s);
      cv.height = Math.round(img.naturalHeight * s);
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png');
    }, { src: source, max: MAX_EDGE });
    return Buffer.from(out.split(',')[1], 'base64');
  } finally {
    await browser.close();
  }
}

(async () => {
const scaled = await scaleToMaxEdge(png);
if (scaled.length !== png.length) console.log('verkleinert auf max. ' + MAX_EDGE + ' px Kantenlaenge');
const html = fs.readFileSync(HTML, 'utf8');
const begin = html.indexOf(BEGIN), end = html.indexOf(END);
if (begin === -1 || end === -1 || end < begin){
  console.error('Die Markerzeilen fehlen in thumbnail-compositor.html.');
  process.exit(1);
}
const b64 = scaled.toString('base64');
const block = BEGIN + '\n' +
  'const AIV_EMBLEM_DATA_URI = \'data:image/png;base64,' + b64 + '\';\n';
fs.writeFileSync(HTML, html.slice(0, begin) + block + html.slice(end), 'utf8');
console.log('eingebettet: ' + path.relative(ROOT, PNG) + ' (Quelle ' + width + 'x' + height + ', eingebettet ' +
  (scaled.length/1024|0) + ' KB -> ' + (b64.length/1024|0) + ' KB base64)');
})().catch(error => { console.error(error); process.exit(1); });
