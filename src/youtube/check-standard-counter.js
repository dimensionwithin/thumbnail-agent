'use strict';

// BB/BD (2026-08-28): Drift-Warnung fuer den Standard-EP.-Zaehler. Standard-Videos
// sind KEINE Livestreams (erscheinen nie im Studio-Livestreams-Reiter und tauchen
// im normalen Wochenlauf-Kandidatenpfad nie auf); der einzige Ort, an dem
// lastAssigned.standard vorwaerts laeuft, ist der Creator-Export
// (thumbnail_service.py, record_series_registry_export). Dieser Check ist REIN
// LESEND: er zaehlt, wie viele Standard-Videos seit dem Reihenstart aussehen wie
// ein durch den Compositor gelaufenes Long-Form-Video, und vergleicht diese
// Anzahl gegen registry.lastAssigned.standard.number. Er korrigiert nichts und
// beeinflusst den Exit-Code des Wochenlaufs nicht -- siehe Aufruf in
// sync-livestream-archive.js (das Ergebnis wird dort bewusst ignoriert).
//
// BD1 (verworfen): urspruenglich war ein Vision-Modell-Call geplant (wie beim
// manuellen Ablesen von LIVESTREAM #67-#76 und EP. 1-15 am 2026-08-28) --
// braucht aber ANTHROPIC_API_KEY, der beim Nutzer LEER ist. Eine Absicherung,
// die mangels Key nie pruefen kann, ist schlechter als keine (Nutzer-Vorgabe).
// Eine rein lokale Pixel-OCR (Kopfzeile aus dem Compositor: fester Font
// 'JetBrains Mono' 27px, aber die Startposition der Ziffern haengt von
// ctx.measureText()-Ergebnissen und JPEG-Kompressionsartefakten ab -- beim
// Kalibrieren an drei bekannten Bildern (EP. 1/12/14) hat sich gezeigt, dass
// das NICHT trivial an einem festen Spalten-Raster liegt, sondern eine robuste
// Zeichen-Segmentierung braeuchte) wurde probiert und als zu fragil verworfen,
// um sie ungetestet in einen unbeaufsichtigten Wochenlauf zu haengen.
//
// BD2 (umgesetzt): kein Bildlesen noetig. Bei der manuellen BA-Verifikation
// zeigte sich ein sehr klarer, rein metadatenbasierter Trenner: alle 6
// NICHT nummerierten Standard-Videos im Fenster (4 #shorts + 2
// Handy-Ankuendigungen) hatten eine Dauer von <= 41 Sekunden, alle 15
// nummerierten Long-Form-Videos >= 14 Minuten -- eine riesige Luecke.
// MIN_LONGFORM_SECONDS liegt mit grossem Sicherheitsabstand dazwischen.
// NACHTEIL (bewusst benannt, siehe BD2-Auftrag): das ist eine reine
// MENGEN-Pruefung, keine Identitaets-Pruefung. Sie erkennt NICHT, wenn sich
// ein Auslassungs- und ein Doppelfehler gegenseitig aufheben (Netto-Drift 0),
// und sie verlaesst sich darauf, dass Kurz-/Ankuendigungsvideos weiterhin
// deutlich unter der Schwelle bleiben -- aendert sich das Format (z.B.
// kuenftig 3-5-Minuten-Clips ohne Nummer), muss die Schwelle neu geprueft
// werden. Fuer die heutige, sehr grosse Luecke (41s vs. 14min+) ist das
// Risiko eines Grenzfalls aber gering.

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { presetFromSignals } = require('./derive-format');

const STANDARD_SERIES_START_DATE = '2026-08-04';
const SERIES_REGISTRY_FILE = path.resolve('data', 'series-registry.json');
// Beobachtete Werte am 2026-08-28: kuerzester numerierter Long-Form-Clip 14:09,
// laengster nicht-numerierter Clip 0:41 -- die Schwelle liegt mit grossem
// Sicherheitsabstand (Faktor ~20) in der Mitte.
const MIN_LONGFORM_SECONDS = 120;

function durationToSeconds(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = Number(m[1] || 0), min = Number(m[2] || 0), s = Number(m[3] || 0);
  return h * 3600 + min * 60 + s;
}

// Aktueller lastAssigned.standard-Zaehler aus der Registry. null, wenn (noch)
// keiner gesetzt ist (Migration/Erststart) -- der Check wird dann als
// UNGEPRUEFT gemeldet (BD3: NIE stillschweigend, siehe runStandardCounterDriftCheck).
function loadRegistryStandardCounter(registryFile = SERIES_REGISTRY_FILE) {
  if (!fs.existsSync(registryFile)) return { ok: false, reason: `Registry nicht gefunden: ${registryFile}` };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  } catch (e) {
    return { ok: false, reason: `Registry nicht lesbar: ${e.message}` };
  }
  const raw = data.lastAssigned;
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'lastAssigned fehlt in der Registry' };
  if ('number' in raw) return { ok: false, reason: 'Registry im alten V1-Format (kein Standard-Zaehler)' };
  const entry = raw.standard;
  if (!entry || !Number.isFinite(entry.number)) return { ok: false, reason: 'lastAssigned.standard fehlt in der Registry' };
  return { ok: true, number: entry.number };
}

// Alle Uploads mit preset=standard ab STANDARD_SERIES_START_DATE, MIT Dauer.
// Liest die volle Uploads-Playlist (paginiert) -- anders als bei Livestreams
// gibt es fuer Standard-Videos keine kleinere Kandidatenmenge, gegen die man
// zuerst filtern koennte.
async function collectStandardCandidatesWithDuration(yt, uploadsPlaylistId, innerCircleIds, onListCall) {
  const ids = [];
  let pageToken;
  do {
    const res = await yt.playlistItems.list({
      part: ['contentDetails'], playlistId: uploadsPlaylistId, maxResults: 50, pageToken,
    });
    if (onListCall) onListCall();
    for (const it of res.data.items || []) {
      const id = it.contentDetails && it.contentDetails.videoId;
      if (id) ids.push(id);
    }
    pageToken = res.data.nextPageToken;
    // Frueher Abbruch: die Uploads-Playlist ist neueste-zuerst sortiert, sobald
    // eine ganze Seite VOR STANDARD_SERIES_START_DATE liegt, kann nichts Neueres
    // mehr folgen -- spart Quota bei einer inzwischen fast 1000 Videos grossen Playlist.
    const lastPublished = res.data.items && res.data.items.length
      ? (res.data.items[res.data.items.length - 1].contentDetails.videoPublishedAt || '')
      : null;
    if (lastPublished && lastPublished.slice(0, 10) < STANDARD_SERIES_START_DATE) break;
  } while (pageToken);

  const uniqueIds = [...new Set(ids)];
  const videos = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    const res = await yt.videos.list({ part: ['snippet', 'contentDetails', 'liveStreamingDetails'], id: chunk, maxResults: 50 });
    if (onListCall) onListCall();
    for (const v of res.data.items || []) {
      videos.push({
        id: v.id,
        title: v.snippet && v.snippet.title,
        publishedAt: v.snippet && v.snippet.publishedAt,
        liveStreamingDetails: v.liveStreamingDetails || null,
        durationSeconds: durationToSeconds(v.contentDetails && v.contentDetails.duration),
      });
    }
  }

  return videos
    .map(v => ({ ...v, date: (v.publishedAt || '').slice(0, 10) }))
    .filter(v => v.date >= STANDARD_SERIES_START_DATE)
    .filter(v => presetFromSignals(v, innerCircleIds) === 'standard')
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

// Fuehrt den Check aus, loggt (console) und gibt ZUSAETZLICH fertig formatierte
// Zeilen zurueck, die der Aufrufer in livestream-weekly-LAST.txt einhaengen
// kann (BD3: das Ergebnis muss dort sichtbar stehen, nicht in einer separaten,
// leicht uebersehenen Datei). Gibt niemals "unentschieden" als Normalzustand
// zurueck -- entweder ein klares OK/DRIFT, oder ein klar als Fehler markierter
// Ausfall (z.B. API nicht erreichbar).
async function runStandardCounterDriftCheck(yt, channel, innerCircleIds, onListCall) {
  console.log(`\n=== BB: Standard-Zaehler-Drift-Check (rein lesend, beeinflusst nichts) ===`);

  const registry = loadRegistryStandardCounter();
  if (!registry.ok) {
    const msg = `WARNUNG: Standard-Zaehler-Check konnte NICHT laufen -- ${registry.reason}.`;
    console.log(msg);
    return { ok: false, lines: ['', `⚠ STANDARD-ZAEHLER-CHECK: NICHT GEPRUEFT -- ${registry.reason}  <-- BITTE PRUEFEN`] };
  }

  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
  let candidates;
  try {
    candidates = await collectStandardCandidatesWithDuration(yt, uploadsPlaylistId, innerCircleIds || new Set(), onListCall);
  } catch (e) {
    const msg = `WARNUNG: Standard-Zaehler-Check konnte NICHT laufen (API-Fehler): ${e.message}`;
    console.log(msg);
    return { ok: false, lines: ['', `⚠ STANDARD-ZAEHLER-CHECK: NICHT GEPRUEFT -- API-Fehler: ${e.message}  <-- BITTE PRUEFEN`] };
  }

  const longform = candidates.filter(c => Number.isFinite(c.durationSeconds) && c.durationSeconds >= MIN_LONGFORM_SECONDS);
  const short = candidates.filter(c => !Number.isFinite(c.durationSeconds) || c.durationSeconds < MIN_LONGFORM_SECONDS);
  const noDuration = candidates.filter(c => !Number.isFinite(c.durationSeconds));

  console.log(`Standard-Videos ab ${STANDARD_SERIES_START_DATE} gesamt: ${candidates.length}`);
  console.log(`Davon Long-Form (Dauer >= ${MIN_LONGFORM_SECONDS}s, zaehlt als nummeriert): ${longform.length}`);
  console.log(`Davon kurz/ohne Dauer (zaehlt NICHT, normal bei Shorts/Ankuendigungen): ${short.length}`);
  if (noDuration.length) {
    console.log(`WARNUNG: ${noDuration.length} Video(s) ohne auswertbare Dauer -- ${noDuration.map(v => v.id).join(', ')}`);
  }
  console.log(`lastAssigned.standard (Registry): ${registry.number}`);

  const drift = longform.length !== registry.number;
  const lines = ['', '--- Standard-Zaehler-Check (rein lesend, mengenbasiert, siehe check-standard-counter.js) ---'];
  if (drift) {
    console.log(`WARNUNG (DRIFT): Long-Form-Standard-Videos seit ${STANDARD_SERIES_START_DATE} = ${longform.length}, aber lastAssigned.standard = ${registry.number}. Nur gemeldet, nichts wurde geaendert.`);
    lines.push(`⚠ STANDARD-ZAEHLER-DRIFT: gezaehlt=${longform.length} (Long-Form ab ${STANDARD_SERIES_START_DATE}) vs. Registry=${registry.number}  <-- BITTE PRUEFEN`);
  } else {
    console.log(`OK: Long-Form-Standard-Videos (${longform.length}) stimmen mit lastAssigned.standard ueberein.`);
    lines.push(`OK: Standard-Zaehler stimmt -- gezaehlt=${longform.length} == Registry=${registry.number}`);
  }
  lines.push(`  Geprueft: ${candidates.length} Standard-Videos ab ${STANDARD_SERIES_START_DATE}, davon ${longform.length} Long-Form (>= ${MIN_LONGFORM_SECONDS}s), ${short.length} kurz/Ankuendigung.`);
  if (noDuration.length) {
    lines.push(`  WARNUNG: ${noDuration.length} Video(s) ohne auswertbare Dauer: ${noDuration.map(v => v.id).join(', ')}`);
  }
  lines.push('  Hinweis: reine Mengen-Pruefung, keine Identitaets-Pruefung (siehe Kopfkommentar der Datei).');

  return { ok: true, drift, longformCount: longform.length, registryNumber: registry.number, lines };
}

module.exports = {
  runStandardCounterDriftCheck,
  collectStandardCandidatesWithDuration,
  loadRegistryStandardCounter,
  STANDARD_SERIES_START_DATE,
  MIN_LONGFORM_SECONDS,
};
