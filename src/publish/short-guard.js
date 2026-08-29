'use strict';

// CX Teil D: Sperre gegen thumbnails.set auf Hochformat-Videos (Shorts).
//
// WARUM ES DIESE SPERRE BRAUCHT (gemessen in CV):
// thumbnails.set nimmt bei einem Short an und gibt HTTP 200 zurueck -- ersetzt
// aber nur die abgeleiteten 16:9-Groessen (default/mq/hq/sd/maxresdefault). Die
// 9:16-Fassung oardefault.jpg, die die Shorts-Oberflaeche benutzt, bleibt
// bitgenau unveraendert. Das Video traegt danach ZWEI verschiedene Bilder, und
// das gesetzte ist im Shorts-Feed unsichtbar. Kein Fehler, keine Warnung, und
// auf "automatisch" laesst es sich nicht zurueckdrehen.
//
// DIE ERKENNUNG:
// i.ytimg.com/vi/<id>/oardefault.jpg ("original aspect ratio") fuehrt YouTube nur
// fuer Videos, deren QUELLE nicht 16:9 ist. Die Sonde braucht weder OAuth noch
// API-Kontingent und laeuft ueber das Bild-CDN -- also NICHT ueber youtube.com,
// wo der Zustimmungsdialog sitzt, der in CV die /shorts/<id>-Pruefung zerstoert
// hat (siehe unlist-shorts.js:115). Genau deshalb ist diese Sonde der richtige
// Weg und nicht die naheliegende Watch-Seite.
//
// TRENNSCHAERFE, an einer beschrifteten Menge belegt (CX Teil D.1):
// Grundwahrheit waren die echten Videomasse aus ytInitialPlayerResponse.
// streamingData. 7 Hochformat-Videos -> alle 7 von der Sonde erkannt.
// 6 Querformat-Videos -> keines faelschlich als Short gemeldet.
// 0 Falsch-Positive, 0 Falsch-Negative. Beleg: data/gating-repair/.
//
// FAIL-CLOSED: Liefert die Sonde weder 200 noch 404 (Zeitueberschreitung,
// Netzfehler, 5xx), lautet das Ergebnis null -- und null sperrt. Lieber ein
// Thumbnail nicht setzen als eines unwiederbringlich falsch setzen.

const https = require('https');

const SONDE_TIMEOUT_MS = 10000;

function sondiere(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      res.resume(); // Koerper wird nicht gebraucht, nur der Status
      res.on('end', () => resolve({ code: res.statusCode }));
    });
    req.setTimeout(SONDE_TIMEOUT_MS, () => { req.destroy(); resolve({ code: 'timeout' }); });
    req.on('error', (e) => resolve({ code: 'error:' + e.message }));
  });
}

// -> { short: true | false | null, grund: string }
// null heisst ausdruecklich "nicht auswertbar", NICHT "kein Short".
//
// ZWEI Sonden, nicht eine. Ein 404 auf oardefault.jpg heisst naemlich zweierlei:
// "16:9-Quelle" ODER "dieses Video gibt es nicht" (falsche id, geloescht, noch
// nicht verarbeitet). Wer daraus allein "kein Short" ableitet, hat kein
// fail-closed, sondern rutscht bei jedem Abrufproblem in ein Ja.
// hqdefault.jpg fuehrt YouTube fuer JEDES existierende Video. Es dient hier als
// Existenzbeleg: erst "oardefault fehlt UND hqdefault ist da" ist die positive
// Aussage "existierendes Video mit 16:9-Quelle".
async function pruefeShort(videoId) {
  if (!videoId || typeof videoId !== 'string') {
    return { short: null, grund: 'keine verwertbare videoId' };
  }
  const cb = Date.now();
  const oar = await sondiere(`https://i.ytimg.com/vi/${videoId}/oardefault.jpg?cb=${cb}`);
  if (oar.code === 200) return { short: true, grund: 'oardefault.jpg vorhanden -> Hochformat-Quelle (Short)' };
  if (oar.code !== 404) return { short: null, grund: `Sonde oardefault nicht auswertbar (${oar.code})` };

  const hq = await sondiere(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg?cb=${cb}`);
  if (hq.code === 200) return { short: false, grund: 'oardefault.jpg fehlt, hqdefault.jpg vorhanden -> existierendes Video mit 16:9-Quelle' };
  if (hq.code === 404) return { short: null, grund: 'weder oardefault.jpg noch hqdefault.jpg vorhanden -> Video nicht auffindbar' };
  return { short: null, grund: `Sonde hqdefault nicht auswertbar (${hq.code})` };
}

// Entscheidung fuer den Aufrufer: darf fuer dieses Video ein Thumbnail gesetzt
// werden? Fail-closed -- alles ausser einem klaren "kein Short" sperrt.
// -> { erlaubt: boolean, status: 'ok' | 'short' | 'unauswertbar', grund: string }
async function darfThumbnailGesetztWerden(videoId) {
  const { short, grund } = await pruefeShort(videoId);
  if (short === false) return { erlaubt: true, status: 'ok', grund };
  if (short === true) {
    return {
      erlaubt: false,
      status: 'short',
      grund: `${grund}. thumbnails.set wuerde nur die 16:9-Ableitungen ersetzen und das Video mit zwei widersprechenden Bildern zuruecklassen (siehe CV).`,
    };
  }
  return { erlaubt: false, status: 'unauswertbar', grund: `${grund}. Fail-closed: es wird NICHT gesetzt.` };
}

// Harte Zusicherung unmittelbar vor einem thumbnails.set-Aufruf. Wirft, wenn
// nicht erlaubt. Zweite Verteidigungslinie: der Aufrufer soll die Pruefung schon
// beim Planen gemacht haben, aber ein Pfad, der daran vorbeikommt, darf nicht
// durchrutschen.
async function sperreShortsOderWirf(videoId) {
  const e = await darfThumbnailGesetztWerden(videoId);
  if (!e.erlaubt) {
    const err = new Error(`Short-Sperre (${e.status}): ${e.grund}`);
    err.shortGuard = e;
    throw err;
  }
  return e;
}

module.exports = { pruefeShort, darfThumbnailGesetztWerden, sperreShortsOderWirf };
