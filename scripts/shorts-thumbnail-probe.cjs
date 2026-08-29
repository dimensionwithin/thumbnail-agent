'use strict';

// CV: Messwerkzeug fuer den Nachweis, ob thumbnails.set bei Shorts wirkt.
//
// Zwei bewusst getrennte Codepfade, weil ein HTTP 200 des Setz-Aufrufs nichts
// beweist -- in diesem Projekt ist mehrfach Code gelaufen, ohne zu wirken:
//   Nachweis A: authentifiziert ueber videos.list (was die API selbst behauptet).
//   Nachweis B: unauthentifiziert ueber i.ytimg.com und oEmbed (was oeffentlich
//               tatsaechlich ausgeliefert wird). Anderer Host, andere
//               Infrastruktur, kein OAuth.
//
// Weichen A und B voneinander ab, ist GENAU DAS das Ergebnis: dann setzt die API
// etwas, das beim Zuschauer nicht ankommt.
//
// Die videoIds kommen ausschliesslich aus der .env (gitignored) -- dieses Repo
// ist oeffentlich, und eine ungelistete videoId ist ein Zugriffsschluessel.
// Siehe docs/warum-keine-video-ids-im-repo.md.
//
// Aufruf:  node scripts/shorts-thumbnail-probe.cjs <messpunkt-name>

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('../src/youtube/auth.js');

const OUT = path.join('data', 'shorts-thumbnail-api-test');

// Die Groessen, die YouTube auf dem Bild-CDN fuehrt. oardefault ist die
// Hochformat-Fassung: sie existiert nur bei Videos, deren QUELLE nicht 16:9 ist,
// und ist damit unser verlaesslichster Hochformat-Nachweis. maxresdefault ist
// die abgeleitete 16:9-Fassung.
const CDN_NAMEN = ['default', 'mqdefault', 'hqdefault', 'sddefault', 'maxresdefault', 'oardefault'];

function holen(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const teile = [];
      res.on('data', (c) => teile.push(c));
      res.on('end', () => resolve({ code: res.statusCode, buf: Buffer.concat(teile) }));
    });
    req.setTimeout(15000, () => { req.destroy(); resolve({ code: 'timeout', buf: Buffer.alloc(0) }); });
    req.on('error', (e) => resolve({ code: 'error', fehler: e.message, buf: Buffer.alloc(0) }));
  });
}

// JPEG/PNG-Masse aus dem Kopf lesen -- ohne Bildbibliothek, damit das Werkzeug
// keine zusaetzliche Abhaengigkeit braucht.
function masse(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { breite: buf.readUInt32BE(16), hoehe: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      // SOF0..SOF15 ohne die Nicht-Rahmen-Marker DHT/JPG/DAC
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { hoehe: buf.readUInt16BE(i + 5), breite: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return { breite: null, hoehe: null };
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function bildAkte(url) {
  const r = await holen(url);
  if (r.code !== 200) return { url, code: r.code, vorhanden: false };
  const m = masse(r.buf);
  return {
    url, code: 200, vorhanden: true, bytes: r.buf.length,
    breite: m.breite, hoehe: m.hoehe,
    verhaeltnis: m.breite && m.hoehe ? +(m.breite / m.hoehe).toFixed(3) : null,
    sha256: sha(r.buf),
  };
}

async function messen(yt, videoId, etikett) {
  const cb = Date.now(); // Cache-Busting: das CDN liefert sonst die alte Fassung
  const ergebnis = { etikett, zeit: new Date().toISOString(), nachweisA: {}, nachweisB: {} };

  // --- Nachweis A: authentifiziert, ueber die API ---
  const r = await yt.videos.list({ part: ['snippet'], id: [videoId] });
  const v = r.data.items && r.data.items[0];
  if (!v) { ergebnis.nachweisA.fehler = 'Video nicht auffindbar'; return ergebnis; }
  ergebnis.nachweisA.thumbnails = {};
  for (const [name, t] of Object.entries(v.snippet.thumbnails || {})) {
    ergebnis.nachweisA.thumbnails[name] = {
      gemeldet: { breite: t.width, hoehe: t.height },
      ...(await bildAkte(`${t.url}${t.url.includes('?') ? '&' : '?'}cb=${cb}`)),
    };
  }

  // --- Nachweis B: unauthentifiziert, anderer Host ---
  ergebnis.nachweisB.cdn = {};
  for (const name of CDN_NAMEN) {
    ergebnis.nachweisB.cdn[name] = await bildAkte(`https://i.ytimg.com/vi/${videoId}/${name}.jpg?cb=${cb}`);
  }
  const oe = await holen(`https://www.youtube.com/oembed?url=https%3A//www.youtube.com/watch%3Fv%3D${videoId}&format=json`);
  ergebnis.nachweisB.oembed = { code: oe.code };
  if (oe.code === 200) {
    try {
      const j = JSON.parse(oe.buf.toString());
      ergebnis.nachweisB.oembed.thumbnail_url = j.thumbnail_url;
      ergebnis.nachweisB.oembed.bild = await bildAkte(`${j.thumbnail_url}?cb=${cb}`);
    } catch (e) { ergebnis.nachweisB.oembed.parseFehler = e.message; }
  }
  return ergebnis;
}

async function main() {
  const messpunkt = process.argv[2] || 'messung';
  const shortId = process.env.SHORTS_TEST_VIDEO_ID;
  const normalId = process.env.NORMAL_TEST_VIDEO_ID;
  if (!shortId || !normalId) {
    throw new Error('SHORTS_TEST_VIDEO_ID und NORMAL_TEST_VIDEO_ID muessen in der .env stehen.');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });

  const daten = {
    messpunkt,
    zeit: new Date().toISOString(),
    shortTestvideo: await messen(yt, shortId, 'Short-Testvideo'),
    normalTestvideo: await messen(yt, normalId, 'Normal-Testvideo'),
  };
  const datei = path.join(OUT, `messung-${messpunkt}.json`);
  fs.writeFileSync(datei, JSON.stringify(daten, null, 2));

  for (const schluessel of ['shortTestvideo', 'normalTestvideo']) {
    const d = daten[schluessel];
    console.log(`\n=== ${d.etikett} @ ${messpunkt} ===`);
    for (const [n, t] of Object.entries(d.nachweisA.thumbnails || {})) {
      console.log(`  A  ${n.padEnd(8)} ${String(t.breite || '?')}x${String(t.hoehe || '?')} ${String(t.bytes || '-').padStart(8)}B ${(t.sha256 || '').slice(0, 12)}`);
    }
    for (const [n, t] of Object.entries(d.nachweisB.cdn || {})) {
      console.log(`  B  ${n.padEnd(13)} ${t.vorhanden ? `${t.breite}x${t.hoehe} ${String(t.bytes).padStart(8)}B ${t.sha256.slice(0, 12)}` : `-> ${t.code}`}`);
    }
    console.log(`  B  oembed ${d.nachweisB.oembed.code}`);
  }
  console.log(`\ngeschrieben: ${datei}`);
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
