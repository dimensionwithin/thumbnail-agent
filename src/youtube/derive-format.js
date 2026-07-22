'use strict';

// P2: Aus Video-Metadaten die SICHEREN Felder ableiten (preset, episode, date).
// "Sicher" = aus harten Signalen, nicht aus Interpretation. Stance/Headline kommen erst in P3.

// publishedAt (ISO 8601) -> "YYYY-MM-DD"
function dateFromPublishedAt(publishedAt) {
  if (!publishedAt) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(publishedAt);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

// Episode aus dem Titel. Inner-Circle-Folgen zaehlen eigenstaendig.
function episodeFromTitle(title, preset) {
  if (!title) return undefined;
  if (preset === 'innercircle') {
    const ic = /inner\s*circle\s*#?\s*(\d+)/i.exec(title);
    if (ic) return `INNER CIRCLE #${ic[1]}`;
  }
  const ep = /\bep(?:isode)?\.?\s*#?\s*(\d+)/i.exec(title);
  if (ep) return `EP. ${ep[1]}`;
  const folge = /\bfolge\s*#?\s*(\d+)/i.exec(title);
  if (folge) return `EP. ${folge[1]}`;
  const hash = /#\s*(\d+)/.exec(title);
  if (hash) return `#${hash[1]}`;
  return undefined;
}

// preset aus harten Signalen. REIHENFOLGE WICHTIG (nicht umdrehen):
//  1. Video in der Inner-Circle-Playlist -> innercircle
//  2. liveStreamingDetails vorhanden       -> livestream
//  3. sonst                                -> standard
// Inner Circle hat Vorrang, weil members-live-Sessions BEIDE Signale tragen
// (sie sind Livestreams UND liegen in der IC-Playlist). Pruefen wir live zuerst,
// wuerden members-live-Sessions faelschlich als 'livestream' statt 'innercircle' enden.
// nonchart bleibt eine manuelle Wahl im Review, keine Auto-Ableitung.
function presetFromSignals(video, innerCircleIds) {
  if (innerCircleIds && innerCircleIds.has(video.id)) return 'innercircle';
  if (video.liveStreamingDetails) return 'livestream';
  return 'standard';
}

// Inner-Circle-Episodennummern CHRONOLOGISCH vergeben (nicht aus dem Titel).
// Begruendung: Alte IC-Titel tragen keine Nummer; die Titel-Ableitung ist unzuverlaessig.
// Stattdessen: alle eindeutigen IC-Videos nach publishedAt AUFSTEIGEND sortieren und
// durchnummerieren -> "INNER CIRCLE #N", N=1 fuer das aelteste.
//
// Stabilitaet: Die Reihenfolge haengt allein am aufsteigenden Datum (Tiebreak: videoId),
// damit neue Folgen nur HINTEN anhaengen und bestehende Nummern sich NIE verschieben.
//
// videos: Array von { id, publishedAt, ... } (idealerweise die eindeutige Upload-Liste)
// innerCircleIds: Set<videoId>
// -> Map<videoId, "INNER CIRCLE #N">
function assignInnerCircleEpisodes(videos, innerCircleIds) {
  const map = new Map();
  if (!innerCircleIds || innerCircleIds.size === 0) return map;
  const seen = new Set();
  const ic = [];
  for (const v of videos || []) {
    if (!innerCircleIds.has(v.id) || seen.has(v.id)) continue; // eindeutig halten
    seen.add(v.id);
    ic.push(v);
  }
  ic.sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || 0;
    const tb = Date.parse(b.publishedAt) || 0;
    if (ta !== tb) return ta - tb;                 // aufsteigend nach Datum
    return String(a.id).localeCompare(String(b.id)); // deterministischer Tiebreak
  });
  ic.forEach((v, i) => map.set(v.id, `INNER CIRCLE #${i + 1}`));
  return map;
}

// Generischer chronologischer Nummerierer fuer eine eigenstaendige Serie (additiv).
// Gleiche Stabilitaetslogik wie IC: aufsteigend nach publishedAt, Tiebreak videoId,
// neue Folgen haengen nur HINTEN an. IC bleibt unberuehrt (eigener Namespace via prefix).
function assignSeriesEpisodes(videos, ids, prefix) {
  const map = new Map();
  if (!ids || ids.size === 0) return map;
  const seen = new Set();
  const list = [];
  for (const v of videos || []) {
    if (!ids.has(v.id) || seen.has(v.id)) continue; // eindeutig halten
    seen.add(v.id);
    list.push(v);
  }
  list.sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || 0;
    const tb = Date.parse(b.publishedAt) || 0;
    if (ta !== tb) return ta - tb;                 // aufsteigend nach Datum
    return String(a.id).localeCompare(String(b.id)); // deterministischer Tiebreak
  });
  list.forEach((v, i) => map.set(v.id, `${prefix} #${i + 1}`));
  return map;
}

// "DER AKTIONAER TV - Debunked" als eigene Serie: episode = "DEBUNKED #N", N=1 aeltestes.
function assignDebunkedEpisodes(videos, debunkedIds) {
  return assignSeriesEpisodes(videos, debunkedIds, 'DEBUNKED');
}

// video: { id, title, description, publishedAt, liveStreamingDetails, privacyStatus }
// innerCircleIds: Set<videoId>
// icEpisodes (optional): Map<videoId, episode> aus assignInnerCircleEpisodes().
// Wenn gesetzt, hat sie fuer IC-Videos Vorrang vor der Titel-Ableitung.
function deriveSafeFields(video, innerCircleIds, icEpisodes) {
  const preset = presetFromSignals(video, innerCircleIds);
  let episode = episodeFromTitle(video.title, preset);
  if (preset === 'innercircle' && icEpisodes && icEpisodes.has(video.id)) {
    episode = icEpisodes.get(video.id); // chronologische Nummer ueberschreibt Titel-Parsing
  } else if (preset === 'livestream') {
    episode = undefined; // Format-Konsistenz: Livestreams fuehren nur ein Datum, keine Nummer.
  }
  return {
    preset,
    episode,
    date: dateFromPublishedAt(video.publishedAt),
  };
}

module.exports = { deriveSafeFields, presetFromSignals, episodeFromTitle, dateFromPublishedAt, assignInnerCircleEpisodes, assignDebunkedEpisodes };
