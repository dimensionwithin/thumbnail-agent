// Schreibt den Emblem-Block in thumbnail-compositor.html: eine Liste aller
// Varianten mit ihrer gemessenen Helligkeit, plus EINE eingebettete
// Rueckfall-Variante.
//
// CJ1: Frueher wurden ALLE Varianten als data:-URI eingebettet. Bei 14 Stueck
// waren das ~4,7 MB base64 in einer Datei, die bei jedem Start komplett geparst
// wird -- und die Bibliothek waechst weiter. Der Compositor holt die Varianten
// jetzt zur Laufzeit ueber /api/emblem vom lokalen Dienst; eingebettet bleibt nur
// der Rueckfall, damit ohne Dienst nicht emblemlos gerendert wird.
//
// Die Render-Harness laeuft ueber file:// ohne Dienst und bekommt die gewaehlte
// Variante als cfg.emblemDataUri mitgegeben (siehe render-harness.cjs).
//
// EINE VARIANTE ERGAENZEN: Datei in assets/branding/emblems/ ablegen, dieses
// Skript laufen lassen. Sonst nichts -- kein Manifest, keine Liste im Code. Der
// Dateiname ohne Endung ist der Schluessel und liefert zugleich die Beschriftung
// im Auswahlfeld ("nachdenklich.png" -> "Nachdenklich").
//
//   node scripts/embed-aiv-emblem.cjs
const fs = require('fs'), path = require('path');

// Auf diese Kantenlaenge wird vor dem Einbetten verkleinert. Das Emblem wird im
// 1280x720-Raum selten groesser als 420 gezeichnet und rendert @2x auf 840 px --
// 640 deckt das praktisch ab, waehrend die Originale (bis 2048 px, ~1 MB) die
// HTML um Megabytes aufblaehen wuerden. assets/branding/emblems/ bleibt die
// volle Quelle.
const MAX_EDGE = 640;
// Welche Variante eingebettet wird, wenn der Dienst nicht erreichbar ist.
const FALLBACK_SLUG = 'neutral';
// Ab dieser Helligkeit (Median der sichtbaren Pixel, 0-255) gilt ein Motiv als
// HELL und bekommt einen dunklen Schein statt eines hellen. CJ2: Die Kalibrierung
// wurde zweimal von Hand gemacht (Teufel dunkel -> heller Schein, Avatar fast
// schwarz -> heller Schein); mit den Jahreszeiten kommen helle Motive dazu.
// Gemessen liegen die Graustufen-Varianten bei 13-21, christkind bei 221 -- die
// Schwelle liegt weit von beiden Gruppen entfernt.
const HELL_SCHWELLE = 90;

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'branding', 'emblems');
const HTML = path.join(ROOT, 'thumbnail-compositor.html');
const BEGIN = '// >>> EMBLEM-DATA-URIS (erzeugt von scripts/embed-aiv-emblem.cjs -- nicht von Hand editieren)';
const END = '// <<< EMBLEM-DATA-URIS';

if (!fs.existsSync(DIR)) {
  console.error('ABBRUCH: ' + path.relative(ROOT, DIR) + ' fehlt.');
  console.error('Lege den Ordner an und dort mindestens eine transparente PNG-Datei ab.');
  process.exit(1);
}

const files = fs.readdirSync(DIR)
  .filter(f => f.toLowerCase().endsWith('.png'))
  .sort();

if (!files.length) {
  console.error('ABBRUCH: keine PNG-Datei in ' + path.relative(ROOT, DIR) + '.');
  console.error('Ohne Variante haette das Preset aiv kein Emblem -- es wurde NICHTS geaendert.');
  process.exit(1);
}

// Jede Datei einzeln pruefen. Ein PNG ohne Alpha legt eine deckende Kachel ueber
// das Thumbnail -- genau das ist beim ersten Versuch passiert, die Datei war ein
// Vorschaubild mit EINGEBRANNTEM Transparenz-Schachbrett (Farbtyp 2).
const variants = [];
for (const file of files) {
  const slug = file.replace(/\.png$/i, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error('ABBRUCH: "' + file + '" -- Dateiname nur aus Kleinbuchstaben, Ziffern und Bindestrich.');
    console.error('Der Name wird zum Schluessel und zur Beschriftung im Auswahlfeld.');
    process.exit(1);
  }
  const buffer = fs.readFileSync(path.join(DIR, file));
  if (buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    console.error('ABBRUCH: "' + file + '" ist kein PNG (Signatur passt nicht).');
    process.exit(1);
  }
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20), colorType = buffer[25];
  if (colorType !== 6 && colorType !== 4) {
    console.error('ABBRUCH: "' + file + '" hat Farbtyp ' + colorType + ', also KEINEN Alphakanal.');
    console.error('Ohne Transparenz landet ein deckender Kasten auf dem Thumbnail. Haeufige Ursache:');
    console.error('das Vorschaubild des Generators gespeichert (mit aufgemaltem Schachbrettmuster)');
    console.error('statt des echten PNG-Exports. Es wurde NICHTS eingebettet.');
    process.exit(1);
  }
  if (Math.max(width, height) < 512) {
    console.warn('WARNUNG: "' + file + '" nur ' + width + 'x' + height + ' -- @2x gerendert wird das weich.');
  }
  variants.push({ slug, file, buffer, width, height });
}

// Verkleinern ueber headless Chromium -- dieselbe Bildpipeline, die auch der
// Compositor benutzt, und Playwright ist ohnehin Projektabhaengigkeit. Alpha
// bleibt erhalten (transparentes Canvas, PNG raus). Das Seitenverhaeltnis bleibt
// unangetastet: begrenzt wird die laengere Kante, genau wie drawEmblem() spaeter
// ueber Math.max(iw, ih) skaliert.
// Prueft zugleich, ob das Motiv an den Bildrand stoesst (also angeschnitten ist).
//
// Die UNTERkante ist ausdruecklich erlaubt und wird nicht gemeldet: das Emblem
// sitzt unten rechts mit buendiger Unterkante, dort liest sich der Anschnitt so,
// als schaue die Figur ins Bild hinein. Oben, links und rechts sind dagegen echte
// Zuschneidefehler -- dort entstuende mitten in der Flaeche eine gerade Kante, die
// aus dem Emblem eine aufgeklebte Karte macht. Gefunden wurde das erst an einem
// fertigen Render; die Warnung holt den Befund an die Stelle, wo man ihn behebt.
async function processAll(list) {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const v of list) {
      // Helligkeit UND Randberuehrung in einem Durchgang.
      v.mess = await page.evaluate(async ({ src }) => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = src; });
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        const alphaAt = (x, y) => d[(y * cv.width + x) * 4 + 3];
        const share = (pts) => pts.filter(a => a > 250).length / pts.length;
        const top = [], bottom = [], left = [], right = [];
        for (let x = 0; x < cv.width; x++) { top.push(alphaAt(x, 0)); bottom.push(alphaAt(x, cv.height - 1)); }
        for (let y = 0; y < cv.height; y++) { left.push(alphaAt(0, y)); right.push(alphaAt(cv.width - 1, y)); }
        // Median der Helligkeit ueber die deckenden Pixel
        const lums = [];
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 250) lums.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        }
        lums.sort((a, b) => a - b);
        const median = lums.length ? lums[Math.floor(lums.length / 2)] : 0;
        return { median, kanten: { oben: share(top), unten: share(bottom), links: share(left), rechts: share(right) } };
      }, { src: 'data:image/png;base64,' + v.buffer.toString('base64') });
      v.touching = v.mess.kanten;
      v.median = Math.round(v.mess.median);
    }
    for (const v of list) {
      if (Math.max(v.width, v.height) <= MAX_EDGE) continue;
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
      }, { src: 'data:image/png;base64,' + v.buffer.toString('base64'), max: MAX_EDGE });
      v.buffer = Buffer.from(out.split(',')[1], 'base64');
      v.scaled = true;
    }
  } finally {
    await browser.close();
  }
}

(async () => {
  await processAll(variants);

  for (const v of variants) {
    const cut = Object.entries(v.touching)
      .filter(([edge, share]) => edge !== 'unten' && share > 0.02);
    if (!cut.length) continue;
    console.warn('WARNUNG: "' + v.file + '" beruehrt den Bildrand an einer Kante, die frei sein sollte:');
    for (const [edge, share] of cut) console.warn('  ' + edge + ': ' + Math.round(share * 100) + ' % der Kante deckend');
    console.warn('  Dort entsteht im Thumbnail eine gerade Kante mitten in der Flaeche, die sich als');
    console.warn('  aufgeklebte Karte liest. Die Unterkante ist davon ausgenommen -- das Emblem sitzt');
    console.warn('  buendig am unteren Bildrand, dort ist der Anschnitt gewollt. Eingebettet wird trotzdem.');
  }

  const html = fs.readFileSync(HTML, 'utf8');
  const begin = html.indexOf(BEGIN), end = html.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    console.error('ABBRUCH: die Markerzeilen fehlen in thumbnail-compositor.html.');
    process.exit(1);
  }

  const fallback = variants.find(v => v.slug === FALLBACK_SLUG) || variants[0];
  if (!variants.some(v => v.slug === FALLBACK_SLUG)) {
    console.warn('WARNUNG: ' + FALLBACK_SLUG + '.png fehlt -- eingebettet wird stattdessen "'
      + fallback.slug + '". Ohne Dienst zeigt der Compositor dann diese Variante.');
  }

  const meta = variants.map(v =>
    "  '" + v.slug + "': { median: " + v.median + ", hell: " + (v.median > HELL_SCHWELLE) + " },");
  const block = [
    BEGIN,
    '// Alle Varianten mit gemessener Helligkeit. Die Bilddaten holt der Compositor',
    '// zur Laufzeit ueber /api/emblem; hier steht nur, WELCHE es gibt und wie hell',
    '// sie sind (fuer die Wahl der Scheinfarbe).',
    'const EMBLEM_META = {',
    ...meta,
    '};',
    "// Rueckfall fuer den Betrieb ohne Dienst (file://, Render-Harness ohne Config).",
    "const EMBLEM_FALLBACK_SLUG = '" + fallback.slug + "';",
    "const EMBLEM_FALLBACK_URI = 'data:image/png;base64," + fallback.buffer.toString('base64') + "';",
    '',
  ].join('\n');
  fs.writeFileSync(HTML, html.slice(0, begin) + block + html.slice(end), 'utf8');

  console.log('Varianten (Helligkeit -> Schein):');
  for (const v of variants) {
    console.log('  ' + v.slug.padEnd(16) + String(v.median).padStart(4)
      + '  -> ' + (v.median > HELL_SCHWELLE ? 'DUNKLER Schein (helles Motiv)' : 'heller Schein'));
  }
  const kb = Math.round(fallback.buffer.toString('base64').length / 1024);
  console.log('');
  console.log('eingebettet: nur ' + fallback.slug + ' als Rueckfall (' + kb + ' KB base64)');
  console.log('zur Laufzeit ueber /api/emblem: ' + variants.length + ' Variante(n)');
})().catch(error => { console.error(error); process.exit(1); });
