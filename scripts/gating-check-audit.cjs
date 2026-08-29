'use strict';

// CW Schritt 1+2: Misst die ECHTE Gating-Erkennung, statt sie nachzubauen.
//
// Aufgerufen wird checkMembersGatedHttp() aus sync-livestream-archive.js -- also
// genau die Funktion, die der Wochenlauf benutzt, mit ihrem eigenen HTTP-Client,
// ihren Kopfzeilen und ihren Zeitgrenzen.
//
// Die Zusatzdiagnose (HTTP-Status, Endadresse nach Weiterleitungen, Laenge der
// Antwort, kommt "playabilityStatus" ueberhaupt vor) kommt NICHT aus einem
// zweiten Abruf, sondern aus einer Beobachtung von https.get: der Original-
// Aufruf wird durchgereicht und nur mitgeschrieben. Ein zweiter Abruf koennte
// anders ausfallen als der echte und wuerde genau das verschleiern, was hier
// gemessen werden soll.
//
// Nur lesend. Keine Playlist-Aenderung, kein videos.update, kein thumbnails.set.
// videoIds landen ausschliesslich in data/gating-check-audit/ (gitignored).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { google } = require('googleapis');
const { getAuthorizedClient } = require('../src/youtube/auth.js');

const OUT = path.join('data', 'gating-check-audit');

// --- https.get beobachten, nicht ersetzen -------------------------------------
const echtesGet = https.get;
let mitschrift = null;

https.get = function (...args) {
  const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].href) || '(unbekannt)';
  const req = echtesGet.apply(https, args);
  req.on('response', (res) => {
    if (!mitschrift) return;
    const eintrag = {
      angefragt: url,
      httpStatus: res.statusCode,
      weiterleitungZu: res.headers.location || null,
      inhaltstyp: res.headers['content-type'] || null,
      bytes: 0,
      hatPlayabilityStatus: false,
      hatYtInitialPlayerResponse: false,
      koerperAnfang: '',
    };
    let gesehen = '';
    res.on('data', (c) => {
      eintrag.bytes += c.length;
      gesehen += c.toString('utf8');
    });
    res.on('end', () => {
      eintrag.hatPlayabilityStatus = gesehen.includes('playabilityStatus');
      eintrag.hatYtInitialPlayerResponse = gesehen.includes('ytInitialPlayerResponse');
      eintrag.koerperAnfang = gesehen.slice(0, 300).replace(/\s+/g, ' ');
      // NUR Diagnose: welchen status trug die Seite? Der Pruefwert selbst kommt
      // weiterhin ausschliesslich aus checkMembersGatedHttp().
      const mm = /ytInitialPlayerResponse\s*=\s*(\{.*?\});(?:<\/script>|\s*var )/s.exec(gesehen);
      if (mm) {
        try {
          const ps = JSON.parse(mm[1]).playabilityStatus || {};
          eintrag.playabilityStatusWert = ps.status || null;
          eintrag.playabilityReason = ps.reason || null;
          eintrag.offerId = (ps.errorScreen && ps.errorScreen.playerLegacyDesktopYpcOfferRenderer && ps.errorScreen.playerLegacyDesktopYpcOfferRenderer.offerId) || null;
        } catch (e) { eintrag.parseFehler = e.message; }
      } else { eintrag.playabilityStatusWert = '(ytInitialPlayerResponse nicht gefunden)'; }
      mitschrift.push(eintrag);
    });
  });
  return req;
};

// Erst NACH dem Beobachten laden, damit das Modul die beobachtete Fassung sieht.
const sync = require('../src/youtube/sync-livestream-archive.js');

async function playlistVideoIds(yt, playlistId, limit) {
  const ids = [];
  let pageToken;
  do {
    const r = await yt.playlistItems.list({ part: ['contentDetails'], playlistId, maxResults: 50, pageToken });
    for (const it of r.data.items || []) ids.push(it.contentDetails.videoId);
    pageToken = r.data.nextPageToken;
  } while (pageToken && ids.length < limit * 4);
  return ids.slice(0, limit);
}

async function messen(id, erwartung) {
  mitschrift = [];
  const start = Date.now();
  const rueckgabe = await sync.checkMembersGatedHttp(id);
  const dauerMs = Date.now() - start;
  const abrufe = mitschrift;
  mitschrift = null;

  // Die Einstufung, die der Wochenlauf daraus ableiten WUERDE. Reine Funktion,
  // keine Seiteneffekte -- Wochentag/Uhrzeit sind hier ohne Belang (B1).
  const einstufung = sync.classifyWeeklyCandidate('Donnerstag', '20:00', rueckgabe);

  return {
    erwartung,
    rueckgabe,
    rueckgabeText: rueckgabe === null ? 'null (nicht auswertbar)' : String(rueckgabe),
    korrekt: rueckgabe === erwartung,
    dauerMs,
    entscheidung: einstufung.decision,
    ziel: einstufung.target,
    abrufe,
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const icPlaylist = process.env.INNER_CIRCLE_PLAYLIST_ID;
  const archivPlaylist = process.env.LIVESTREAM_ARCHIVE_PLAYLIST_ID;
  if (!icPlaylist || !archivPlaylist) throw new Error('Playlist-IDs fehlen in der .env.');

  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });

  const gated = await playlistVideoIds(yt, icPlaylist, 3);
  const offen = await playlistVideoIds(yt, archivPlaylist, 3);
  console.log(`Testmenge: ${gated.length} aus der IC-Playlist (erwartet gated), ${offen.length} aus dem Archiv (erwartet nicht gated)\n`);

  const ergebnisse = [];
  for (const [liste, erwartung, etikett] of [[gated, true, 'IC/gated'], [offen, false, 'Archiv/offen']]) {
    for (let i = 0; i < liste.length; i++) {
      const r = await messen(liste[i], erwartung);
      r.etikett = `${etikett} #${i + 1}`;
      r.videoId = liste[i];
      ergebnisse.push(r);
      const a = r.abrufe[0] || {};
      console.log(`${r.etikett.padEnd(14)} Rueckgabe=${r.rueckgabeText.padEnd(22)} ${r.korrekt ? 'KORREKT' : 'FALSCH '} | HTTP ${String(a.httpStatus).padEnd(4)} ${a.bytes} B  playabilityStatus=${a.hatPlayabilityStatus}  -> ${r.entscheidung}/${r.ziel || 'keine Playlist'}`);
      if (a.weiterleitungZu) console.log(`               Weiterleitung -> ${a.weiterleitungZu.slice(0, 100)}`);
      await new Promise((res) => setTimeout(res, 400));
    }
  }

  // --- Schritt 2: Gegenprobe. Nicht nur "kaputt", sondern die ganze Klasse
  // "Seite ist auswertbar, aber das Video ist nicht abspielbar". Genau dort
  // entscheidet sich, ob fail-closed haelt.
  console.log('\n--- Gegenprobe: Abrufe, die kein sauberes OK liefern ---');
  const sonderfaelle = [
    ['ZZZZ_kein_video', 'erfundene videoId'],
  ];
  if (process.env.AUDIT_PRIVATE_VIDEO_ID) {
    sonderfaelle.push([process.env.AUDIT_PRIVATE_VIDEO_ID, 'echtes PRIVATES Video']);
  }
  for (const [id, was] of sonderfaelle) {
    const k = await messen(id, null);
    k.etikett = was;
    k.videoId = id;
    ergebnisse.push(k);
    const ka = k.abrufe[0] || {};
    console.log(`${was.padEnd(22)} Rueckgabe=${k.rueckgabeText.padEnd(22)} HTTP ${ka.httpStatus}  ${ka.bytes} B  status=${ka.playabilityStatusWert}  reason=${(ka.playabilityReason || '').slice(0, 40)}`);
    console.log(`${' '.padEnd(22)} -> Wochenlauf wuerde machen: ${k.entscheidung} / ${k.ziel || 'KEINE Playlist'}`);
    await new Promise((res) => setTimeout(res, 400));
  }

  fs.writeFileSync(path.join(OUT, 'messung.json'), JSON.stringify({ zeit: new Date().toISOString(), ergebnisse }, null, 2));

  const falsch = ergebnisse.filter((r) => r.videoId !== '(kuenstlich)' && !r.korrekt);
  console.log(`\n=== ${ergebnisse.length - 1} echte Videos gemessen, ${falsch.length} falsch eingestuft ===`);
  const gefaehrlich = ergebnisse.filter((r) => r.erwartung === true && r.rueckgabe === false);
  if (gefaehrlich.length) {
    console.log(`!!! ${gefaehrlich.length} GATED-Video(s) wurden als NICHT gated gemeldet -> Ziel Archiv-Playlist. Das ist der schwere Fehler.`);
  }
  console.log(`geschrieben: ${path.join(OUT, 'messung.json')}`);
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
