'use strict';

// Livestream-Archiv-Sync: ergaenzt ALLE vergangenen Livestreams/Premieren (die noch
// fehlen) additiv in LIVESTREAM_ARCHIVE_PLAYLIST_ID. Ergaenzt src/youtube/
// build-livestream-playlist.js, das bereits real 55 kuratierte Sonntags-Livestreams
// in DIESELBE Playlist eingefuegt hat (bestaetigt: .env LIVESTREAM_ARCHIVE_PLAYLIST_ID
// == backups/livestream-playlist-progress.json playlistId).
//
// SICHERHEIT (nicht verhandelbar):
//  - Ruft NIEMALS videos.update auf. privacyStatus jedes Videos bleibt unangetastet
//    (unlisted bleibt unlisted) — ausschliesslich playlistItems.insert.
//  - DEFAULT ist Dry-Run: gibt nur den Plan aus, schreibt NICHTS.
//  - Echter Insert-Lauf NUR mit --execute UND Tippen von "AUSFUEHREN".
//  - Quelle der Wahrheit: NIE search.list. channels.list(mine=true) ->
//    uploads-Playlist -> playlistItems.list voll paginiert -> videos.list Batches.
//    Zusaetzlich (Vollstaendigkeits-Korrektur, siehe data/livestream-catalog.json
//    .definition.source): data/livestream-catalog.json-IDs UND
//    liveBroadcasts.list(mine=true, broadcastStatus='completed') werden als
//    weitere Kandidatenquellen mit aufgenommen, weil der Uploads-Read grosser
//    Playlists nachweislich Eintraege verliert.
//    data/inventory.json wird NICHT verwendet (laut Auftrag veraltet).
//  - Ziel-Playlist wird ROH (ohne Dedup) gelesen, damit bestehende Duplikate
//    sichtbar bleiben und gemeldet werden koennen (nur Meldung, kein Loeschen
//    ausser im separaten --dedupe-Lauf).
//  - Resume-State + CSV-Zeile werden nach JEDEM einzelnen Insert geschrieben
//    (nicht gebatcht) -> kein inkonsistenter Zustand bei hartem Abbruch.
//  - Quota-Budget wird mitgezaehlt; vor jedem Insert geprueft; sauberer Stopp
//    statt Crash, falls das Budget nicht mehr reicht.
//  - PREMIEREN-AUSSCHLUSS (H4, 2026-08-14): actualEndTime allein erkennt KEINE
//    Livestreams zuverlaessig -- Premieren (fertige Datei wird abgespielt) haben das
//    Feld auch. Kandidat ist nur noch, was ZUSAETZLICH in liveBroadcasts.list steht
//    (siehe --classify: 25 bestaetigte Premieren per delta-Analyse + Studio-Abgleich
//    identifiziert und entfernt). fixtures/premieres-exclude.txt als Belt-and-
//    Suspenders zusaetzlich zur strukturellen Loesung.
//  - MITGLIEDER-AUSSCHLUSS (neue Regel, siehe fixtures/members-only-exclude.txt):
//    Mitglieder-Videos gehoeren NIE in LIVESTREAM_ARCHIVE_PLAYLIST_ID. privacyStatus
//    allein erkennt das NICHT zuverlaessig (bestaetigter Fall in
//    fixtures/members-only-exclude.txt: stand als "public", war laut YouTube Studio
//    aber Mitglieder-only). Ausschluss-Quelle ist
//    die UNION aus: (a) INNER_CIRCLE_PLAYLIST_ID roh gelesen (NUR LESEN, es wird dort
//    nie geschrieben) und (b) fixtures/members-only-exclude.txt (manuelle Ergaenzung
//    fuer Faelle, die nicht in der IC-Playlist stehen). Wird bei jedem Sync-Lauf aus
//    den Kandidaten UND aus dem Duplikat-/Entfernungs-Report ausgeschlossen bzw.
//    als Entfernungs-Kandidat markiert.
//
// Flags:
//   (kein Flag)     Dry-Run (Plan + CSV-Vorschau, 0 Inserts).
//   --execute       Echte Inserts — verlangt Credentials + Bestaetigung "AUSFUEHREN".
//   --dedupe        Separater Opt-in-Modus: meldet/loescht (nur mit --execute)
//                   ueberzaehlige Playlist-Duplikate (aeltester Eintrag bleibt).
//   --remove=ID,ID  Separater Opt-in-Modus: entfernt gezielt uebergebene
//                   playlistItemIds aus der Archiv-Playlist (Dry-Run-Default,
//                   nur mit --execute + Bestaetigung "AUSFUEHREN" wirksam).
//   --assign-members  Separater Opt-in-Modus (B1): fuegt Mo/Do-Mitglieder-Meetings
//                   vor MODO_CUTOFF_BERLIN per playlistItems.insert in
//                   INNER_CIRCLE_PLAYLIST_ID ein. EINZIGE Stelle im Projekt, die
//                   dort schreibt. Dry-Run-Default, --execute + Bestaetigung.
//   --assign-episode=videoId:nummer[,videoId:nummer,...]  Separater Opt-in-Modus
//                   (U2): bestaetigt einen vom Wochenlauf vorgeschlagenen
//                   Inner-Circle-Eintrag in data/series-registry.json (Titel/
//                   Datum werden per videos.list nachgeladen). EINZIGE Stelle,
//                   die dort einen vollen Eintrag schreibt. Dry-Run-Default,
//                   --execute + Bestaetigung.
//   --scan-members  Diagnose-Modus (E3): unauthentifizierter HTTP-Check der
//                   aktuellen Archiv-Playlist-Eintraege auf Mitglieder-Sperre.
//                   Read-only, kein API-Write, kein Quota-Verbrauch.
//   --classify      Reiner Analyse-Modus: prueft die Premieren-Hypothese
//                   (deltaSekunden = wallClock - duration) fuer alle aktuellen
//                   Archiv-Playlist-Eintraege UND gleicht die volle Erkennungs-
//                   menge gegen liveBroadcasts.list ab. Schreibt NUR eine CSV,
//                   KEINE Inserts/Deletes, ignoriert --execute/--yes komplett.
//   --weekly        LAUFENDER BETRIEB (siehe Abschnitt "WOCHENLAUF" unten):
//                   sortiert neue Livestreams ab WEEKLY_START_DATE_BERLIN
//                   anhand des festen Sendeplans + HTTP-Messung in die
//                   richtige Playlist. Dry-Run-Default, --execute + Bestaetigung.
//   --simulate-from=YYYY-MM-DD [--simulate-to=YYYY-MM-DD]
//                   K3-Backtest der Wochenlauf-Entscheidungslogik an echter
//                   Historie. NUR Dry-Run (mit --execute harter Abbruch),
//                   schreibt ausschliesslich eine CSV.
//   --max-insertable=N / --max-candidates=N
//                   K1-Schwellen des Wochenlaufs ueberschreiben (Defaults:
//                   WEEKLY_MAX_INSERTABLE / WEEKLY_MAX_CANDIDATES).
//   --yes           Bestaetigung ueberspringen (nur nicht-interaktiv; ohne
//                   --execute wirkungslos).
//   --limit=N       Maximal N fehlende Videos einfuegen (Default: alle).
//   --delay=MS      Pause zwischen Inserts/Deletes/Removes (Default: 1000).
//   --out=DIR       Backup-/Log-Verzeichnis (Default: backups).
//
// ===========================================================================
// WOCHENLAUF (--weekly, 2026-08-14): laufender Betrieb statt Rueckwirkung.
// ===========================================================================
// Der rueckwirkende Teil (Archiv-Aufbau, Premieren-/Mitglieder-Bereinigung) ist
// abgeschlossen: 214 oeffentliche Livestreams im Archiv, 67 Eintraege in der
// IC-Playlist. --weekly haelt diesen Zustand fort.
//
// SENDEPLAN (Regelfall, gilt als Hinweis, nicht als Schranke -- siehe B1 unten):
//   Mo, Di, Mi, Sa : Videos (laufen technisch als Stream) -> normalerweise keine Playlist
//   Do abends      : Mitglieder-Livestream               -> normalerweise IC-Playlist
//   Fr             : Freischaltung des Do-Inhalts fuer Supporter; bleibt
//                    mitgliedergesperrt, KEINE eigene Veroeffentlichung
//   So abends      : oeffentlicher Livestream            -> normalerweise Archiv-Playlist
//
// B1 (2026-08-27): NUR NOCH EIN SIGNAL entscheidet ueber das Ziel:
//   gated (HTTP-playabilityStatus-Check, checkMembersGatedHttp):
//     true  -> IC-Playlist
//     false -> Archiv-Playlist
//     null (nicht auswertbar) -> UNGEPRUEFT: nichts einfuegen (fail-closed, B2).
//   Wochentag/Uhrzeit sind reine Anzeige-Information ("ungewoehnlich" im Report),
//   sie blockieren nichts mehr. Frueher gab es ein zweites Signal (Sendeplan
//   nach Wochentag+Uhrzeit), das bei Abweichung KONFLIKT/OFF_SCHEDULE ausloeste
//   und nichts einfuegte -- das hat am 15.08.2026 einen echten Mitglieder-
//   Sonderstream (Samstag) blockiert, obwohl der Gated-Check
//   eindeutig war. Ein Sonderstream an einem ungewoehnlichen Tag gehoert genauso
//   in die richtige Playlist wie ein regulaerer Do/So-Termin.
//
// K1 (entscheidende Rahmenbedingung): ALLE Videos dieses Kanals gehen per
// Streamingsoftware raus und bestehen daher die H4-Regel. Pro Woche entstehen
// bis zu SECHS Kandidaten (Mo/Di/Mi/Do/Sa/So); die meisten sind nicht gated und
// gehen ins Archiv, der Rest (normalerweise Do+So) in die IC-Playlist. Deshalb
// ZWEI getrennte Schwellen statt einer (eine einzelne Gesamtschwelle von 5
// haette jeden Lauf abgebrochen).
//
// Der Sendeplan wird NIEMALS rueckwirkend angewendet: WEEKLY_START_DATE_BERLIN
// ist ein hartes Mindestdatum. Die Historie davor ist unregelmaessig und bereits
// manuell geklaert (u.a. Do-Mitgliederstream 13.08.2026 -> manuell in der
// IC-Playlist; keine offene Luecke zum letzten Archivlauf am 12.08.2026).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { durationToSeconds } = require('../publish/unlist-shorts');

const QUOTA_BUDGET = 9500; // Tagesquota 10000, etwas Puffer eingeplant.
const COST_LIST = 1;       // playlistItems.list / videos.list / playlists.list / channels.list je Call.
const COST_INSERT = 50;    // playlistItems.insert.
const COST_DELETE = 50;    // playlistItems.delete (--dedupe).
const PLAYLIST_SIZE_WARN = 4500; // Warnschwelle Richtung YouTube-Limit 5000.

const CSV_HEADER = ['videoId', 'title', 'publishedAt', 'privacyStatus', 'action', 'playlistItemId'];
const WEEKLY_CSV_HEADER = ['videoId', 'titel', 'actualStartTimeBerlin', 'wochentag', 'gated', 'zielPlaylist', 'hinweis', 'playlistItemId', 'action'];
const REMOVE_CSV_HEADER = ['videoId', 'title', 'playlistItemId', 'action'];
const ASSIGN_CSV_HEADER = ['videoId', 'actualStartTimeBerlin', 'weekday', 'title', 'playlistItemId', 'action'];
const MEMBERS_EXCLUDE_FILE = path.resolve('fixtures', 'members-only-exclude.txt');
const PREMIERES_EXCLUDE_FILE = path.resolve('fixtures', 'premieres-exclude.txt');
const MEMBER_MEETING_DATES_FILE = path.resolve('fixtures', 'member-meeting-dates.txt');
// G2: Flag-Schwelle (Berlin). Weekday ist laut Ground Truth KEIN verlaessliches
// Kriterium (2025-11-11/18 stehen in der Montags-Serie, sind aber Dienstage) --
// nur exakte Daten aus MEMBER_MEETING_DATES_FILE + Uhrzeit werden geprueft.
const MEMBER_MEETING_FLAG_MIN_HOUR = 19;

// B: Skool-Uebergang. Mo/Do-Mitglieder-Meetings vor diesem Berlin-Datum verloren beim
// Wechsel ihre technische Sperre. 09.09.2025 ist laut Nutzer der eindeutige Cutoff
// (September/November ergeben dieselbe Menge -> nicht sensitiv auf die exakte Wahl).
const MODO_CUTOFF_BERLIN = '2025-09-09';
const MODO_WEEKDAYS = new Set(['Montag', 'Donnerstag']);

// J4: Guardrail-Richtwert fuer liveBroadcasts.list (siehe detectPastLivestreams).
const LIVEBROADCASTS_MIN_EXPECTED = 200;

// J3: bekannte, bewusste Katalog-Abweichungen. Mitglieder-Livestreams erscheinen
// NIE in der (H4: liveBroadcasts.list-gestuetzten) Erkennung fuers oeffentliche
// Archiv; im Katalog stehen sie aber. Der Erwartungswert der Plausibilitaetspruefung
// liegt deshalb um genau diese Faelle unter der Katalogmenge -- nur Abweichungen
// DAVON sind ein Warnsignal.
//
// BL1 (2026-08-28): Die betroffene videoId stand hier frueher hartkodiert. Dieses
// Repo ist oeffentlich und es geht um Mitglieder-Content -- siehe
// docs/warum-keine-video-ids-im-repo.md. Die Liste kommt jetzt aus
// fixtures/members-only-exclude.txt (gitignored), wo sie ohnehin schon gepflegt wird.
const CATALOG_KNOWN_GAPS = new Set(loadMembersExcludeFile(MEMBERS_EXCLUDE_FILE));

// --- WOCHENLAUF (--weekly), siehe Abschnitt "WOCHENLAUF" im Kopfkommentar. ---

// K2: HARTES Mindestdatum (Berlin). Der Sendeplan gilt AUSSCHLIESSLICH fuer Videos
// ab diesem Tag und wird NIEMALS rueckwirkend angewendet -- die Historie davor ist
// unregelmaessig und bereits manuell geklaert. Diese Konstante ist die einzige
// Stelle, die das durchsetzt; sie darf nicht per Flag aufgeweicht werden.
// (--simulate-from umgeht sie bewusst, kann aber per Definition nichts schreiben.)
const WEEKLY_START_DATE_BERLIN = '2026-08-14';

// L2 (2026-08-27): NUR NOCH ANZEIGE. Frueher war das hier Signal A und hat ZUSAMMEN
// mit Signal B (HTTP-Gated-Check) ueber das Ziel entschieden -- jeder Kandidat
// ausserhalb Do/So-Abend wurde als OFF_SCHEDULE geblockt. Das hat den echten
// Mitglieder-Sonderstream vom 15.08.2026 (Samstag) faelschlich
// blockiert, obwohl der Gated-Check eindeutig war -- Mitglieder kamen ueber die
// Playlist nicht an den Stream. Wohin ein Video gehoert, entscheidet jetzt
// ausschliesslich Signal B (siehe classifyWeeklyCandidate). Wochentag/Uhrzeit
// bleiben als Hinweis im Report ("ungewoehnlich"), damit ein echter Sonderfall
// auffaellt, aber nichts mehr blockieren.
const WEEKLY_SCHEDULE = new Map([['Donnerstag', 'IC'], ['Sonntag', 'ARCHIVE']]);
const WEEKLY_MIN_HOUR_BERLIN = 17;

// K1: ZWEI getrennte Schwellen. Alle Videos laufen technisch als Stream, also sind
// bis zu 6 Kandidaten/Woche normal -- eine einzelne Gesamtschwelle wuerde jeden Lauf
// abbrechen. Ueberschreitung heisst NICHT "viel Arbeit", sondern "etwas ist kaputt"
// (Regel, Endpunkt, Auth) -> nichts einfuegen, melden, Exit-Code 2.
const WEEKLY_MAX_INSERTABLE = 3;  // A=Do/So UND B passend. Normalbetrieb: 2.
const WEEKLY_MAX_CANDIDATES = 12; // alle neuen Kandidaten. Normalbetrieb: bis 6.

// K4: Kurzzusammenfassung des jeweils letzten Laufs (wird ueberschrieben), damit
// der unbeaufsichtigte Aufgabenplanungs-Lauf ohne Logarchiv nachvollziehbar bleibt.
const WEEKLY_LAST_RUN_FILE = 'livestream-weekly-LAST.txt';

// K4: Exit-Codes. 0 = sauber, 1 = harter Fehler (Auth/Guardrail/Fehlbedienung),
// 2 = Lauf lief durch, braucht aber Aufmerksamkeit (Konflikt/Ungeprueft/Abbruch).
const EXIT_OK = 0;
const EXIT_ATTENTION = 2;

function parseArgs(argv) {
  const a = { execute: false, dedupe: false, remove: null, assignMembers: false, assignEpisode: null, scanMembers: false, classify: false, weekly: false, checkStandard: false, simulateFrom: null, simulateTo: null, maxInsertable: WEEKLY_MAX_INSERTABLE, maxCandidates: WEEKLY_MAX_CANDIDATES, only: null, yes: false, limit: Infinity, delay: 1000, out: 'backups' };
  for (const t of argv.slice(2)) {
    if (t === '--execute') a.execute = true;
    else if (t === '--dedupe') a.dedupe = true;
    else if (t === '--check-standard') a.checkStandard = true;
    else if (t === '--assign-members') a.assignMembers = true;
    else if (t.startsWith('--assign-episode=')) a.assignEpisode = t.slice('--assign-episode='.length);
    else if (t === '--scan-members') a.scanMembers = true;
    else if (t === '--classify') a.classify = true;
    else if (t === '--weekly') a.weekly = true;
    else if (t === '--yes') a.yes = true;
    else if (t.startsWith('--simulate-from=')) a.simulateFrom = t.slice(16).trim();
    else if (t.startsWith('--simulate-to=')) a.simulateTo = t.slice(14).trim();
    // Number(...) statt "|| default": 0 ist ein GUELTIGER Schwellenwert (Testfall
    // "--max-candidates=0 muss abbrechen"), darf also nicht auf den Default fallen.
    else if (t.startsWith('--max-insertable=')) a.maxInsertable = Number(t.slice(17));
    else if (t.startsWith('--max-candidates=')) a.maxCandidates = Number(t.slice(17));
    else if (t.startsWith('--remove=')) a.remove = t.slice(9).split(',').map(s => s.trim()).filter(Boolean);
    else if (t.startsWith('--only=')) a.only = t.slice(7).split(',').map(s => s.trim()).filter(Boolean);
    else if (t.startsWith('--limit=')) a.limit = Number(t.slice(8)) || Infinity;
    else if (t.startsWith('--delay=')) a.delay = Math.max(0, Number(t.slice(8)) || 0);
    else if (t.startsWith('--out=')) a.out = t.slice(6);
  }
  return a;
}

// Berlin-Lokalzeit (DST-sicher via Intl) fuer ein UTC-ISO-Zeitstempel.
function berlinDateParts(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  const dtf = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
  });
  const map = {};
  for (const p of dtf.formatToParts(d)) map[p.type] = p.value;
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, weekday: map.weekday };
}

// Berlin-Lokalzeit MIT Sekunden (fuer --classify-CSV-Spalten). Separat von
// berlinDateParts (nur Minutenaufloesung), da Delta-Berechnungen weiter unten
// direkt auf den rohen UTC-ISO-Strings laufen (Sekunden-Praezision, TZ-egal).
function berlinISOWithSeconds(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const map = {};
  for (const p of dtf.formatToParts(d)) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
}

// B1/B2: Mo/Do-Mitglieder-Meeting vor dem Skool-Cutoff? Basiert auf actualStartTime
// (NICHT publishedAt), in Berlin-Lokalzeit.
function isPreMigrationModoMeeting(actualStartTimeIso) {
  const parts = berlinDateParts(actualStartTimeIso);
  if (!parts) return false;
  return MODO_WEEKDAYS.has(parts.weekday) && parts.date < MODO_CUTOFF_BERLIN;
}

// R2/H3: manuelle, permanente Ausschlussliste (eine videoId pro Zeile). Unterstuetzt
// sowohl volle Kommentarzeilen (# ...) als auch INLINE-Kommentare nach der videoId
// (videoId  # Begruendung) -- alles ab dem ersten # wird abgeschnitten, bevor getrimmt
// wird. Wiederverwendet fuer members-only-exclude.txt UND premieres-exclude.txt.
function loadMembersExcludeFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.split('#')[0].trim())
    .filter(Boolean);
}

// G2: exakte Meeting-Termine (Ground Truth aus Skool) -> Map<ISO-Datum, Serienname>.
// Serienname = letzter #-Kommentar vor dem Datum (fuer den Report).
function loadMemberMeetingDates(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  let series = null;
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#')) {
      const c = l.replace(/^#+\s*/, '');
      // Kurze Kommentarzeilen (<=40 Zeichen, keine Satzzeichen) = Serien-Ueberschrift;
      // laengere Erklaertexte im Datei-Header werden ignoriert.
      if (c.length > 0 && c.length <= 40 && !/[.:]/.test(c)) series = c;
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(l)) map.set(l, series || 'unbekannte Serie');
  }
  return map;
}

function youtubeAvailable() {
  const tokenPath = process.env.YOUTUBE_TOKEN_PATH || '.youtube-token.json';
  return !!process.env.YOUTUBE_CLIENT_ID && fs.existsSync(path.resolve(tokenPath));
}

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

function ask(question) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) return resolve('');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvCell).join(',') + '\n'; }

// liveBroadcasts.list(mine=true, broadcastStatus='completed') voll paginieren.
// Vollstaendigkeits-Korrektur zum Uploads-Read: exakt die Quelle, die laut
// data/livestream-catalog.json.definition.source beim Katalog-Bau verwendet
// wurde ("Uploads-Playlist + liveBroadcasts.mine"), weil der Uploads-Read
// grosser Playlists nachweislich Eintraege verliert (siehe auch inventory.js).
async function listCompletedBroadcastIds(yt, onListCall) {
  const out = [];
  let pageToken;
  do {
    // mine und broadcastStatus sind laut API mutuell exklusiv — broadcastStatus
    // allein liefert bereits ausschliesslich Broadcasts des authentifizierten Kanals.
    const res = await yt.liveBroadcasts.list({
      part: ['id', 'snippet'],
      broadcastStatus: 'completed',
      maxResults: 50,
      pageToken,
    });
    if (onListCall) onListCall();
    for (const b of res.data.items || []) {
      if (b.id) out.push(b.id);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return [...new Set(out)];
}

// Uploads-Playlist voll paginieren + deduplizieren (fuer die UPLOADS-Playlist ok,
// hier ist der Rohzustand nicht relevant — wir wollen nur die eindeutige Menge
// aller jemals hochgeladenen Video-IDs).
async function listUploadIds(yt, playlistId, onListCall) {
  const out = [];
  let pageToken;
  do {
    const res = await yt.playlistItems.list({ part: ['contentDetails'], playlistId, maxResults: 50, pageToken });
    if (onListCall) onListCall();
    for (const it of res.data.items || []) {
      if (it.contentDetails && it.contentDetails.videoId) out.push(it.contentDetails.videoId);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return [...new Set(out)];
}

// K1: Ziel-Playlist ROH lesen — KEIN Dedup hier, sonst werden bestehende
// Duplikate unsichtbar (genau die sollen gemeldet werden).
async function listTargetPlaylistRaw(yt, playlistId, onListCall) {
  const out = [];
  let pageToken;
  do {
    const res = await yt.playlistItems.list({
      part: ['snippet', 'contentDetails'],
      playlistId,
      maxResults: 50,
      pageToken,
    });
    if (onListCall) onListCall();
    for (const it of res.data.items || []) {
      const videoId = it.contentDetails && it.contentDetails.videoId;
      if (!videoId) continue;
      out.push({
        playlistItemId: it.id,
        videoId,
        title: (it.snippet && it.snippet.title) || '',
        publishedAt: it.contentDetails && it.contentDetails.videoPublishedAt,
      });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

async function fetchVideoDetails(yt, ids, onListCall) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await yt.videos.list({ part: ['snippet', 'contentDetails', 'status', 'liveStreamingDetails'], id: chunk, maxResults: 50 });
    if (onListCall) onListCall();
    for (const v of res.data.items || []) {
      map.set(v.id, {
        id: v.id,
        title: v.snippet && v.snippet.title,
        publishedAt: v.snippet && v.snippet.publishedAt,
        liveBroadcastContent: v.snippet && v.snippet.liveBroadcastContent,
        privacyStatus: v.status && v.status.privacyStatus,
        liveStreamingDetails: v.liveStreamingDetails || null,
        durationIso: v.contentDetails && v.contentDetails.duration,
      });
    }
  }
  return map;
}

// E3: unauthentifizierter Mitglieder-Check ueber die Watch-Seite (kein API-Call,
// kein Quota-Verbrauch). Validiert am 2026-08-11 gegen 65 bekannte IC-Playlist-Videos
// (65/65 erkannt) und 20 zufaellige Nicht-Mitglieder-Kandidaten (0 False Positives) +
// den bestaetigten Einzelfall aus fixtures/members-only-exclude.txt. Analog zum
// /shorts/<id>-Check in unlist-shorts.js:
// inoffizielles HTML-Scraping (kein dokumentiertes API-Feld), daher NUR Diagnose,
// keine automatische Aktion.
function fetchWatchPageHtml(id) {
  return new Promise((resolve) => {
    const req = https.get(`https://www.youtube.com/watch?v=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ code: res.statusCode, body }));
    });
    req.setTimeout(15000, () => { req.destroy(); resolve({ code: 'timeout', body: '' }); });
    req.on('error', e => resolve({ code: 'error:' + e.message, body: '' }));
  });
}
function extractPlayabilityStatus(html) {
  const m = /ytInitialPlayerResponse\s*=\s*(\{.*?\});(?:<\/script>|\s*var )/s.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]).playabilityStatus; } catch (e) { return null; }
}
// Das Sponsoren-Angebot im Fehlerbildschirm -- das einzige positive Kennzeichen
// eines Mitglieder-Videos, das die Watch-Seite unauthentifiziert hergibt.
function sponsorsOfferId(ps) {
  return ps && ps.errorScreen && ps.errorScreen.playerLegacyDesktopYpcOfferRenderer
    && ps.errorScreen.playerLegacyDesktopYpcOfferRenderer.offerId;
}

// CX (2026-08-29): Die Entscheidung faellt jetzt NUR NOCH POSITIV.
//
//   status === 'OK'                    -> false (sicher nicht gated)
//   offerId === 'sponsors_only_video'  -> true  (sicher gated)
//   alles Uebrige                      -> null  (weiss nicht -> fail-closed)
//
// Vorher (siehe decideGatedLegacy) fiel alles, was weder 'OK' noch das
// Sponsoren-Angebot war, auf `false` -- also auf die POSITIVE Aussage "nicht
// gated" mit Ziel OEFFENTLICHE Archiv-Playlist. In CW gemessen: ein privates
// Video liefert status='LOGIN_REQUIRED' und damit `false`, eine unbekannte
// videoId liefert status='ERROR' und ebenfalls `false`. Die Funktion wusste in
// beiden Faellen nichts und behauptete trotzdem etwas.
//
// Der Unterschied traegt genau dort, wo es zaehlt: Eine Zustimmungsseite
// (consent.youtube.com) traegt weder 'OK' noch den Sponsoren-Renderer und faellt
// damit zwingend auf null. Bisher haette sie, sofern ueberhaupt parsebar, ein
// `false` ergeben -- und ein gated Stream waere oeffentlich gelandet.
//
// Umgestellt nach einer Schattenmessung ueber 309 Videos (Archiv-Playlist,
// IC-Playlist, letzte 15 Streams): KEIN einziges Video wechselte das Ergebnis.
// Alle 44 UNPLAYABLE trugen das Sponsoren-Angebot, alle 265 uebrigen waren 'OK'.
// Beleg: data/gating-repair/ (scripts/gating-shadow-audit.cjs).
function decideGatedStrict(ps) {
  if (!ps) return null;
  if (ps.status === 'OK') return false;
  if (sponsorsOfferId(ps) === 'sponsors_only_video') return true;
  return null;
}

// Die Fassung VOR der Umstellung. Wird produktiv NICHT mehr aufgerufen und steht
// nur noch hier, damit der Schattenvergleich aus CX reproduzierbar bleibt
// (scripts/gating-shadow-audit.cjs vergleicht legacy gegen strict). Nicht
// benutzen: der letzte Ausdruck macht aus "weiss nicht" ein "nicht gated".
function decideGatedLegacy(ps) {
  if (!ps) return null;
  if (ps.status === 'OK') return false;
  return sponsorsOfferId(ps) === 'sponsors_only_video';
}

// CY: Der Grund landet im Wochenbericht, den auch ein Vorlesetask ausgibt.
// "playabilityStatus=LOGIN_REQUIRED" ist dort unbrauchbar -- wer das liest, muss
// wissen, was ein playabilityStatus ist. Deshalb Klartext zuerst, der technische
// Wert in Klammern hinterher (fuer die Fehlersuche bleibt er noetig).
const STATUS_KLARTEXT = {
  LOGIN_REQUIRED: 'nicht oeffentlich abspielbar (Anmeldung noetig — privat oder eingeschraenkt)',
  ERROR: 'Video nicht auffindbar (geloescht oder falsche ID)',
  UNPLAYABLE: 'nicht abspielbar',
  AGE_VERIFICATION_REQUIRED: 'Alterspruefung noetig',
  CONTENT_CHECK_REQUIRED: 'Inhaltswarnung — Bestaetigung noetig',
  LIVE_STREAM_OFFLINE: 'Livestream derzeit offline',
};
function klartextStatus(status) {
  return STATUS_KLARTEXT[status] || `unbekannter Zustand "${status || '?'}"`;
}

// Liefert zusaetzlich, WARUM die Entscheidung so ausfiel. Der Grund wird fuer den
// UNVERIFIED-Abschnitt im Wochenbericht gebraucht: "nicht auswertbar" allein sagt
// dem Leser nicht, ob das Video privat ist, geloescht, oder ob der Abruf scheiterte.
async function checkMembersGatedHttpDetailed(id) {
  const r = await fetchWatchPageHtml(id);
  const ps = extractPlayabilityStatus(r.body);
  const gated = decideGatedStrict(ps);
  let grund;
  if (gated === true) grund = 'nur fuer Mitglieder — Mitglieder-Angebot auf der Videoseite erkannt';
  else if (gated === false) grund = 'oeffentlich abspielbar';
  else if (!ps) grund = `Videoseite nicht auswertbar — Abruf lieferte HTTP ${r.code} mit ${(r.body || '').length} Bytes`;
  else grund = `${klartextStatus(ps.status)}${ps.reason ? ' — ' + String(ps.reason).slice(0, 120) : ''} [playabilityStatus=${ps.status || '?'}]`;
  return { gated, grund, status: ps ? (ps.status || null) : null, httpCode: r.code };
}

async function checkMembersGatedHttp(id) {
  return (await checkMembersGatedHttpDetailed(id)).gated;
}

// Retry/Backoff-Helfer fuer schreibende Calls (insert/delete). Analog zu
// updatePrivacy() in src/publish/unlist-shorts.js.
async function withRetry(fn) {
  let attempt = 0;
  const maxAttempts = 5;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const reason = (e && e.errors && e.errors[0] && e.errors[0].reason) || '';
      const code = e && e.code;
      const quota = reason === 'quotaExceeded' || reason === 'dailyLimitExceeded';
      if (quota) { const err = new Error('Quota erschoepft (' + reason + ')'); err.quota = true; throw err; }
      const retriable = code === 429 || code === 500 || code === 503 || code === 409 ||
        reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      attempt++;
      if (!retriable || attempt >= maxAttempts) throw e;
      const backoff = Math.min(30000, 1000 * Math.pow(2, attempt));
      console.log(`    Rate-Limit/Fehler (${reason || code}) — Retry ${attempt}/${maxAttempts - 1} in ${backoff}ms ...`);
      await sleep(backoff);
    }
  }
}

// ---------------------------------------------------------------------------
// --dedupe: separater Opt-in-Codepfad (nicht Teil des normalen Sync-Laufs).
// ---------------------------------------------------------------------------
async function runDedupe(args, yt, playlistId, rawItems) {
  // Pro videoId: aeltesten Eintrag (kleinste playlistItemId-Reihenfolge = zuerst
  // in der API-Antwort, das entspricht der Playlist-Reihenfolge) behalten, den
  // Rest als Loesch-Kandidaten markieren.
  const byVideo = new Map();
  for (const it of rawItems) {
    if (!byVideo.has(it.videoId)) byVideo.set(it.videoId, []);
    byVideo.get(it.videoId).push(it);
  }
  const toDelete = [];
  for (const [videoId, occ] of byVideo) {
    if (occ.length <= 1) continue;
    const [keep, ...rest] = occ; // erstes Vorkommen = aeltester Eintrag in Playlist-Reihenfolge
    for (const r of rest) toDelete.push({ ...r, keptPlaylistItemId: keep.playlistItemId });
  }

  console.log(`\n--- DEDUPE-Modus ---`);
  console.log(`Modus:   ${args.execute ? 'EXECUTE (echtes Loeschen angefordert)' : 'DRY-RUN (Plan, nichts geloescht)'}`);
  console.log(`Playlist: ${playlistId}`);
  console.log(`Loesch-Kandidaten: ${toDelete.length}\n`);
  for (const d of toDelete) {
    console.log(`  [PLAN-DELETE] ${d.videoId}  playlistItemId=${d.playlistItemId}  (behalten: ${d.keptPlaylistItemId})  ${d.title}`);
  }

  if (!args.execute) {
    console.log('\nDRY-RUN — es wurde KEIN playlistItems.delete aufgerufen. Fuer den echten Lauf: --dedupe --execute');
    console.log('DELETED: 0');
    return;
  }
  if (toDelete.length === 0) { console.log('\nNichts zu loeschen (0 Duplikate).'); console.log('DELETED: 0'); return; }
  if (!args.yes) {
    const ans = await ask(`\nWirklich ${toDelete.length} doppelte(n) Playlist-Eintrag/-Eintraege loeschen? Tippe "AUSFUEHREN": `);
    if (ans.trim() !== 'AUSFUEHREN') { console.log('Abgebrochen — keine Bestaetigung.'); console.log('DELETED: 0'); return; }
  }

  let quotaUsed = 0;
  let deleted = 0;
  for (const d of toDelete) {
    if (quotaUsed + COST_DELETE > QUOTA_BUDGET) {
      console.log(`\nQuota-Budget (${QUOTA_BUDGET}) erreicht — sauberer Stopp. Rest morgen weiterlaufen lassen (--dedupe erneut).`);
      break;
    }
    try {
      await withRetry(() => yt.playlistItems.delete({ id: d.playlistItemId }));
      quotaUsed += COST_DELETE;
      deleted++;
      console.log(`  OK gelöscht ${d.videoId} (playlistItemId=${d.playlistItemId}) (${deleted}/${toDelete.length})`);
    } catch (e) {
      if (e.quota) { console.error(`  QUOTA erschoepft: ${e.message} — sauberer Abbruch.`); break; }
      console.error(`  FEHLER ${d.videoId} (${d.playlistItemId}): ${e.message} — uebersprungen.`);
    }
    if (args.delay) await sleep(args.delay);
  }
  console.log(`\nFertig. DELETED: ${deleted} | Quota verbraucht: ~${quotaUsed}`);
}

// ---------------------------------------------------------------------------
// R5: --remove — separater Opt-in-Modus. Entfernt GEZIELT uebergebene
// playlistItemIds (nicht automatisch aus dem Ausschluss-Report). Dry-Run-Default,
// eigenes CSV-Log fuer Rollback, eigene Quota-Buchfuehrung (delete = 50 Einheiten).
// ---------------------------------------------------------------------------
async function runRemove(args, yt, playlistId, rawItems, outDir) {
  const requestedIds = args.remove || [];
  const byPlaylistItemId = new Map(rawItems.map(it => [it.playlistItemId, it]));
  const targets = requestedIds.map(id => ({ playlistItemId: id, item: byPlaylistItemId.get(id) || null }));
  const unknown = targets.filter(t => !t.item);

  console.log(`\n--- REMOVE-Modus ---`);
  console.log(`Modus:   ${args.execute ? 'EXECUTE (echtes Entfernen angefordert)' : 'DRY-RUN (Plan, nichts entfernt)'}`);
  console.log(`Playlist: ${playlistId}`);
  console.log(`Angefordert: ${requestedIds.length} playlistItemId(s)\n`);
  for (const t of targets) {
    if (t.item) console.log(`  [PLAN-REMOVE] ${t.item.videoId}  playlistItemId=${t.playlistItemId}  ${t.item.title}`);
    else console.log(`  [UNBEKANNT] playlistItemId=${t.playlistItemId} — nicht in der aktuellen Playlist gefunden, wird uebersprungen.`);
  }
  if (unknown.length) console.log(`\nWARNUNG: ${unknown.length} playlistItemId(s) nicht in der Playlist gefunden (evtl. bereits entfernt/falsche ID) — werden uebersprungen.`);

  const known = targets.filter(t => t.item);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `livestream-archive-remove-${stamp}.csv`);
  let csv = csvRow(REMOVE_CSV_HEADER);

  if (!args.execute) {
    for (const t of known) csv += csvRow([t.item.videoId, t.item.title, t.playlistItemId, 'WOULD_REMOVE']);
    fs.writeFileSync(csvPath, csv);
    console.log(`\nCSV (Dry-Run-Vorschau): ${csvPath}`);
    console.log('\nDRY-RUN — es wurde KEIN playlistItems.delete aufgerufen. Fuer den echten Lauf: --remove=... --execute');
    console.log('REMOVED: 0');
    return;
  }
  if (known.length === 0) {
    fs.writeFileSync(csvPath, csv);
    console.log('\nNichts zu entfernen (0 gueltige playlistItemIds).');
    console.log('REMOVED: 0');
    return;
  }
  if (!args.yes) {
    const ans = await ask(`\nWirklich ${known.length} Eintrag/Eintraege aus der Archiv-Playlist entfernen? Tippe "AUSFUEHREN": `);
    if (ans.trim() !== 'AUSFUEHREN') {
      fs.writeFileSync(csvPath, csv);
      console.log('Abgebrochen — keine Bestaetigung.');
      console.log('REMOVED: 0');
      return;
    }
  }

  const persistCsv = () => fs.writeFileSync(csvPath, csv);
  persistCsv();

  let quotaUsed = 0;
  let removed = 0;
  for (const t of known) {
    if (quotaUsed + COST_DELETE > QUOTA_BUDGET) {
      console.log(`\nQuota-Budget (${QUOTA_BUDGET}) erreicht — sauberer Stopp.`);
      break;
    }
    try {
      await withRetry(() => yt.playlistItems.delete({ id: t.playlistItemId }));
      quotaUsed += COST_DELETE;
      removed++;
      csv += csvRow([t.item.videoId, t.item.title, t.playlistItemId, 'REMOVED']);
      persistCsv();
      console.log(`  OK entfernt ${t.item.videoId} (playlistItemId=${t.playlistItemId}) (${removed}/${known.length})`);
    } catch (e) {
      if (e.quota) { console.error(`  QUOTA erschoepft: ${e.message} — sauberer Abbruch.`); break; }
      console.error(`  FEHLER ${t.item.videoId} (${t.playlistItemId}): ${e.message} — uebersprungen.`);
    }
    if (args.delay) await sleep(args.delay);
  }
  console.log(`\nFertig. REMOVED: ${removed} | Quota verbraucht: ~${quotaUsed}`);
  console.log(`CSV: ${csvPath}`);
}

// ---------------------------------------------------------------------------
// Geteilte Erkennungs-Pipeline (Quelle der Wahrheit): Uploads-Playlist + Katalog +
// liveBroadcasts -> videos.list -> Livestream-Filter. Von main() (Archiv-Sync) UND
// runAssignMembers() (B1) verwendet, damit beide dieselbe Kandidatenmenge sehen.
// ---------------------------------------------------------------------------
async function detectPastLivestreams(yt, channel, onListCall) {
  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
  const uploadIds = await listUploadIds(yt, uploadsPlaylistId, onListCall);
  console.log(`\nUploads-Playlist (${uploadsPlaylistId}): ${uploadIds.length} eindeutige Video-IDs.`);

  // Bekanntes Problem (siehe src/youtube/inventory.js): der Uploads-Read grosser
  // Playlists verliert vereinzelt Eintraege. Wie dort etabliert: bekannte
  // Zusatzquelle(n) ergaenzen, statt sich blind auf den Uploads-Read zu verlassen.
  const uploadSet = new Set(uploadIds);

  // 1) data/livestream-catalog.json ist eine per Hand kuratierte, stabile Liste
  //    bekannter Livestreams -> als Fallback-Kandidaten mit aufnehmen.
  const catPathForFetch = path.resolve('data', 'livestream-catalog.json');
  const catalogForFetch = loadJSON(catPathForFetch, null);
  const catalogIds = (catalogForFetch && Array.isArray(catalogForFetch.items)) ? catalogForFetch.items.map(i => i.videoId) : [];
  const catalogSet = new Set(catalogIds);
  const catalogOnly = catalogIds.filter(id => !uploadSet.has(id));
  if (catalogOnly.length) {
    console.log(`Katalog-Videos nicht im Uploads-Read (werden direkt ergaenzt): ${catalogOnly.length}`);
  }

  // 2) liveBroadcasts.list(mine=true, broadcastStatus='completed') — dieselbe
  //    Vollstaendigkeits-Korrektur, die laut Katalog-Definition beim Bau von
  //    data/livestream-catalog.json verwendet wurde. Deckt Livestreams ab, die
  //    WEDER im Uploads-Read NOCH im (nur 66 Eintraege umfassenden) Katalog stehen.
  const broadcastIds = await listCompletedBroadcastIds(yt, onListCall);

  // J4: GUARDRAIL. H4 macht die gesamte Erkennung abhaengig von liveBroadcasts.list.
  // Liefert der Endpunkt einmal deutlich weniger als erwartet, darf das NICHT
  // stillschweigend als "keine Livestreams gefunden" durchgehen -- sonst wuerde ein
  // API-Ausfall/-Aenderung die Archiv-Playlist faktisch leerlaufen lassen. Bekannte
  // Einschraenkung (J4, 2026-08-14): der Endpunkt ist selbst NICHT lueckenlos --
  // ein bestaetigter echter Mitglieder-Livestream (gefuehrt in
  // fixtures/members-only-exclude.txt) fehlte trotzdem in liveBroadcasts.list.
  // Dieser Guardrail faengt nur grobe Unterversorgung ab
  // (Richtwert < 200), keine einzelnen Luecken wie diese.
  if (broadcastIds.length < LIVEBROADCASTS_MIN_EXPECTED) {
    throw new Error(`liveBroadcasts.list lieferte nur ${broadcastIds.length} Video-IDs (Richtwert: mindestens ${LIVEBROADCASTS_MIN_EXPECTED}). Abbruch statt stillschweigender Fehlerkennung -- moeglicher API-Ausfall oder Endpunkt-Aenderung, bitte manuell pruefen.`);
  }

  const broadcastOnlyNew = broadcastIds.filter(id => !uploadSet.has(id) && !catalogSet.has(id));
  console.log(`liveBroadcasts.list (completed): ${broadcastIds.length} Video-IDs.`);
  console.log(`Davon NEU (weder im Uploads-Read noch im Katalog): ${broadcastOnlyNew.length}`);
  if (broadcastOnlyNew.length) {
    console.log(`  neue IDs via liveBroadcasts: ${broadcastOnlyNew.join(', ')}`);
  }

  const fetchIds = [...new Set([...uploadIds, ...catalogIds, ...broadcastIds])];
  const broadcastSet = new Set(broadcastIds);

  // --- Livestream-Erkennung. ---
  // H4 (2026-08-14): dauerhaft verschaerft. actualEndTime ALLEIN reicht nicht mehr --
  // Premieren haben das auch (siehe --classify, 2026-08-14: 25 bestaetigte Premieren
  // in der Archiv-Playlist, delta-Analyse + Abgleich gegen liveBroadcasts.list). Ein
  // Kandidat ist nur noch gueltig, wenn er ZUSAETZLICH in liveBroadcasts.list steht --
  // das ist die einzige API-Quelle, die echte Livestreams von Premieren trennt.
  const details = await fetchVideoDetails(yt, fetchIds, onListCall);
  const detected = [];
  let excludedPrivate = 0, excludedOngoing = 0, notLivestream = 0, noMetadata = 0, notInBroadcasts = 0;
  for (const id of fetchIds) {
    const d = details.get(id);
    if (!d) { noMetadata++; continue; }
    if (d.privacyStatus === 'private') { excludedPrivate++; continue; }
    if (d.liveBroadcastContent && d.liveBroadcastContent !== 'none') { excludedOngoing++; continue; }
    const hasEnded = !!(d.liveStreamingDetails && d.liveStreamingDetails.actualEndTime);
    if (!hasEnded) { notLivestream++; continue; }
    if (!broadcastSet.has(id)) { notInBroadcasts++; continue; }
    detected.push(d);
  }
  console.log(`\nGeprueft: ${fetchIds.length} | als vergangener Livestream (H4: actualEndTime UND liveBroadcasts.list) erkannt: ${detected.length}`);
  console.log(`Ausgeschlossen — kein Metadaten:        ${noMetadata}`);
  console.log(`Ausgeschlossen — privacyStatus=private: ${excludedPrivate}`);
  console.log(`Ausgeschlossen — laeuft/geplant:        ${excludedOngoing}`);
  console.log(`Kein Livestream (kein actualEndTime):   ${notLivestream}`);
  console.log(`H4: actualEndTime vorhanden, aber NICHT in liveBroadcasts.list (vermutlich Premieren, faellt jetzt weg): ${notInBroadcasts}`);

  // --- Plausibilitaets-Check gegen data/livestream-catalog.json. ---
  const catPath = path.resolve('data', 'livestream-catalog.json');
  const catalog = loadJSON(catPath, null);
  if (catalog && Array.isArray(catalog.items)) {
    const catIds = catalog.items.map(i => i.videoId);
    const detectedIds = new Set(detected.map(d => d.id));
    const missingFromDetected = catIds.filter(id => !detectedIds.has(id));
    const unexpectedGaps = missingFromDetected.filter(id => !CATALOG_KNOWN_GAPS.has(id));
    // Nur die bekannten Luecken zaehlen, die tatsaechlich IM Katalog stehen. Die
    // Ausschlussdatei fuehrt auch Mitglieder-Videos ausserhalb des Katalogs; deren
    // Zahl darf den Erwartungswert nicht verschieben (frueher stand hier genau eine
    // hartkodierte ID, weshalb .size gleichbedeutend war).
    const knownGapsInCatalog = catIds.filter(id => CATALOG_KNOWN_GAPS.has(id));
    const expected = catIds.length - knownGapsInCatalog.length;
    console.log(`\n--- Plausibilitaets-Check: data/livestream-catalog.json (${catIds.length} Katalog-Videos) ---`);
    console.log(`Davon in erkannter Livestream-Menge enthalten: ${catIds.length - missingFromDetected.length}/${catIds.length} (erwartet: ${expected}/${catIds.length} -- ${knownGapsInCatalog.join(', ')} ist Mitglieder-Content, bewusst nicht im Archiv, siehe J3)`);
    if (unexpectedGaps.length) {
      console.log(`WARNUNG: ${unexpectedGaps.length} Katalog-Video(s) UNERWARTET nicht in der erkannten Menge (Erkennung pruefen!): ${unexpectedGaps.join(', ')}`);
    } else {
      console.log(`Keine unerwarteten Abweichungen.`);
    }
  } else {
    console.log(`\n--- Plausibilitaets-Check uebersprungen: ${catPath} nicht lesbar. ---`);
  }

  detected.totalChecked = fetchIds.length; // fuer G3-Report (bleibt ein Array, nur zusaetzliches Feld).
  return detected;
}

// D1: verschaerfte Auswahl fuer --assign-members (praeziser als die breite B2/B3-Regel).
// Fakten vom Nutzer: TPC-Mitgliedschaft ab April 2024, REGELMAESSIGE Meetings erst ab
// Jahreswechsel 2024/25; Meetings waren IMMER Abendtermine (>=19:00 Berlin); Morgen-/
// Tagesstreams waren oeffentlich. Zusaetzlich: harter Ausschluss der nummerierten
// oeffentlichen Serie aus data/livestream-catalog.json (wird NIE angefasst).
const MEMBER_MEETING_START_DATE_BERLIN = '2025-01-01';
const MEMBER_MEETING_MIN_HOUR_BERLIN = 19;

// Klassifiziert einen breiten Mo/Do-Kandidaten (aus computeModoCandidates):
// null = erfuellt alle drei Kriterien -> echter --assign-members-Kandidat.
// sonst = Ausschlussgrund fuer die D2-Review-CSV ('im-katalog' | 'vor2025' | 'tagsueber').
function classifyModoCandidate(m, catalogIdSet) {
  if (catalogIdSet.has(m.id)) return 'im-katalog';
  if (m.berlinDate < MEMBER_MEETING_START_DATE_BERLIN) return 'vor2025';
  const hour = Number((m.berlinTime || '00:00').split(':')[0]);
  if (!(hour >= MEMBER_MEETING_MIN_HOUR_BERLIN)) return 'tagsueber';
  return null;
}

// B3/B1: Mo/Do-Mitglieder-Meetings vor MODO_CUTOFF_BERLIN aus einer erkannten
// Livestream-Menge herausfiltern, sortiert nach Berlin-Datum aufsteigend.
function computeModoCandidates(detected) {
  const out = [];
  for (const d of detected) {
    const actualStartTime = d.liveStreamingDetails && d.liveStreamingDetails.actualStartTime;
    if (!actualStartTime) continue;
    const parts = berlinDateParts(actualStartTime);
    if (!parts) continue;
    if (MODO_WEEKDAYS.has(parts.weekday) && parts.date < MODO_CUTOFF_BERLIN) {
      out.push({ id: d.id, title: d.title, privacyStatus: d.privacyStatus, actualStartTime, berlinDate: parts.date, berlinTime: parts.time, weekday: parts.weekday });
    }
  }
  out.sort((a, b) => (a.berlinDate + a.berlinTime).localeCompare(b.berlinDate + b.berlinTime));
  return out;
}

// ---------------------------------------------------------------------------
// B1: --assign-members — separater Opt-in-Modus. EINZIGE Stelle im Projekt, die in
// INNER_CIRCLE_PLAYLIST_ID schreibt (playlistItems.insert). Der normale Sync-Lauf
// bleibt read-only gegenueber dieser Playlist. Dry-Run-Default, eigenes CSV-Log,
// eigene Quota-Buchfuehrung, Insert-fuer-Insert-Persistenz wie der Archiv-Sync.
// ---------------------------------------------------------------------------
// J2: --assign-members --only=ID,ID -- direkter manueller Modus, keine Wochentags-
// Heuristik, kein Katalog-Ausschluss. Nur: existiert das Video, ist es schon in der
// IC-Playlist (dann uebersprungen), sonst eingefuegt. Gleiches CSV-/Progress-Schema
// wie der Haupt-Assign-Pfad.
async function runAssignMembersOnly(args, yt, icPlaylistId, icPlaylist, icVideoSet, onListCall) {
  const details = await fetchVideoDetails(yt, args.only, onListCall);
  const targets = args.only.map(id => {
    const d = details.get(id);
    return { id, title: (d && d.title) || '(unbekannt -- Video nicht gefunden)', found: !!d };
  });
  const notFound = targets.filter(t => !t.found);
  if (notFound.length) {
    console.log(`\nWARNUNG: ${notFound.length} videoId(s) nicht ueber videos.list gefunden (geloescht/kein Zugriff?): ${notFound.map(t => t.id).join(', ')}`);
  }

  console.log(`\n--- J2: --only-Modus (${targets.length} explizit angegebene videoId(s)) ---`);
  for (const t of targets) {
    const already = icVideoSet.has(t.id) ? ' [BEREITS IN IC-PLAYLIST]' : '';
    console.log(`  ${t.id}  ${t.title}${already}`);
  }

  const toAssign = targets.filter(t => t.found && !icVideoSet.has(t.id));
  console.log(`\nBereits in IC-Playlist (uebersprungen): ${targets.filter(t => icVideoSet.has(t.id)).length}`);
  console.log(`Neu zuzuweisen: ${toAssign.length}`);

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `livestream-members-assign-only-${stamp}.csv`);
  let csv = csvRow(['videoId', 'title', 'playlistItemId', 'action']);

  if (!args.execute) {
    for (const t of targets) {
      const action = !t.found ? 'NOT_FOUND' : icVideoSet.has(t.id) ? 'SKIP_ALREADY_MEMBER' : 'WOULD_INSERT';
      csv += csvRow([t.id, t.title, '', action]);
    }
    fs.writeFileSync(csvPath, csv);
    console.log(`\nCSV (Dry-Run-Vorschau): ${csvPath}`);
    console.log('\nDRY-RUN — es wurde KEIN playlistItems.insert aufgerufen.');
    console.log('Echter Lauf: --assign-members --only=... --execute  (danach Bestaetigung "AUSFUEHREN" tippen).');
    console.log('ASSIGNED: 0');
    return;
  }

  if (toAssign.length === 0) {
    fs.writeFileSync(csvPath, csv);
    console.log('\nNichts zuzuweisen.');
    console.log('ASSIGNED: 0');
    return;
  }
  if (!args.yes) {
    const ans = await ask(`\nWirklich ${toAssign.length} Video(s) in die MITGLIEDER-Playlist "${icPlaylist.snippet.title}" einfuegen? Tippe "AUSFUEHREN": `);
    if (ans.trim() !== 'AUSFUEHREN') {
      fs.writeFileSync(csvPath, csv);
      console.log('Abgebrochen — keine Bestaetigung.');
      console.log('ASSIGNED: 0');
      return;
    }
  }

  const persistCsv = () => fs.writeFileSync(csvPath, csv);
  persistCsv();
  let assigned = 0;
  let quotaUsed = 0;
  for (const t of toAssign) {
    try {
      const res = await withRetry(() => yt.playlistItems.insert({
        part: ['snippet'],
        requestBody: { snippet: { playlistId: icPlaylistId, resourceId: { kind: 'youtube#video', videoId: t.id } } },
      }));
      quotaUsed += COST_INSERT;
      assigned++;
      csv += csvRow([t.id, t.title, res.data.id, 'ASSIGNED']);
      persistCsv();
      console.log(`  OK ${t.id} -> playlistItemId=${res.data.id} (${assigned}/${toAssign.length})`);
    } catch (e) {
      if (e.quota) { console.error(`  QUOTA erschoepft bei ${t.id}: ${e.message} — Abbruch.`); break; }
      console.error(`  FEHLER ${t.id}: ${e.message} — uebersprungen.`);
    }
    if (args.delay) await sleep(args.delay);
  }
  console.log(`\nFertig. ASSIGNED: ${assigned} | Quota verbraucht: ~${quotaUsed}`);
  console.log(`CSV: ${csvPath}`);
}

async function runAssignMembers(args, yt, channel, onListCall) {
  const icPlaylistId = process.env.INNER_CIRCLE_PLAYLIST_ID;
  if (!icPlaylistId) {
    console.error('Abbruch: INNER_CIRCLE_PLAYLIST_ID fehlt in .env. --assign-members kann ohne Ziel-Playlist nicht laufen.');
    console.log('ASSIGNED: 0');
    process.exit(1);
  }

  const plRes = await yt.playlists.list({ part: ['snippet'], id: [icPlaylistId] });
  onListCall();
  const icPlaylist = plRes.data.items && plRes.data.items[0];
  if (!icPlaylist) { console.error(`Abbruch: Mitglieder-Playlist ${icPlaylistId} nicht gefunden.`); process.exit(1); }
  console.log(`Mitglieder-Playlist: "${icPlaylist.snippet.title}" (${icPlaylistId})`);
  console.log(`Modus:                ${args.execute ? 'EXECUTE (echte Inserts in die MITGLIEDER-Playlist angefordert)' : 'DRY-RUN (Plan, 0 Inserts)'}\n`);

  // Vor jedem Insert pruefen, ob die videoId schon in der IC-Playlist liegt (roh lesen).
  const icRawItems = await listTargetPlaylistRaw(yt, icPlaylistId, onListCall);
  const icVideoSet = new Set(icRawItems.map(it => it.videoId));
  console.log(`Mitglieder-Playlist aktuell: ${icRawItems.length} Eintraege (${icVideoSet.size} eindeutig).`);

  // J2: --only=ID,ID -- direkter, manueller Zielmodus. Umgeht die komplette Mo/Do-
  // Wochentags-Heuristik (D1/D2, siehe Header: "gestrichen, Heuristik widerlegt").
  // Fuer explizit vom Nutzer bestaetigte Einzelfaelle (J2; die betroffenen videoIds
  // stehen in fixtures/members-only-exclude.txt, nicht hier im Quelltext).
  if (args.only) {
    return runAssignMembersOnly(args, yt, icPlaylistId, icPlaylist, icVideoSet, onListCall);
  }

  const detected = await detectPastLivestreams(yt, channel, onListCall);
  const allModo = computeModoCandidates(detected); // breite B2/B3-Menge (unveraendert, D3 nutzt sie weiter)

  // D1: harter Katalog-Ausschluss + Klassifikation nach Datum/Uhrzeit.
  const catPathForAssign = path.resolve('data', 'livestream-catalog.json');
  const catalogForAssign = loadJSON(catPathForAssign, null);
  const catalogIdSet = new Set((catalogForAssign && Array.isArray(catalogForAssign.items)) ? catalogForAssign.items.map(i => i.videoId) : []);

  const classified = allModo.map(m => ({ ...m, grund: classifyModoCandidate(m, catalogIdSet) }));
  const strictCandidates = classified.filter(m => !m.grund);
  const reviewList = classified.filter(m => m.grund);

  console.log(`\n--- D1: verschaerfte --assign-members-Auswahl ---`);
  console.log(`Kriterien: actualStartTime(Berlin) >= ${MEMBER_MEETING_START_DATE_BERLIN} UND Uhrzeit(Berlin) >= ${MEMBER_MEETING_MIN_HOUR_BERLIN}:00 UND Mo/Do UND NICHT in data/livestream-catalog.json`);
  console.log(`Erwartet: 22 | Gefunden: ${strictCandidates.length}`);
  if (strictCandidates.length !== 22) {
    const diff = strictCandidates.length - 22;
    console.log(`ABWEICHUNG von den erwarteten 22: ${diff > 0 ? '+' : ''}${diff} — wird NICHT stillschweigend uebernommen, bitte pruefen.`);
  }
  for (const m of strictCandidates) {
    const already = icVideoSet.has(m.id) ? ' [BEREITS IN IC-PLAYLIST]' : '';
    console.log(`  ${m.berlinDate} ${m.berlinTime}  ${m.weekday.padEnd(10)}  ${m.privacyStatus.padEnd(9)}  ${m.id}  ${m.title}${already}`);
  }

  // D2: alle durch D1 herausgefallenen Kandidaten (Erwartung: 27) -> Review-CSV,
  // werden NICHT in IC- und NICHT in Archiv-Playlist geschrieben.
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reviewCsvPath = path.join(outDir, `livestream-review-${stamp}.csv`);
  let reviewCsv = csvRow(['videoId', 'datumZeitBerlin', 'wochentag', 'privacyStatus', 'titel', 'grund']);
  for (const m of reviewList) {
    reviewCsv += csvRow([m.id, `${m.berlinDate} ${m.berlinTime}`, m.weekday, m.privacyStatus, m.title, m.grund]);
  }
  fs.writeFileSync(reviewCsvPath, reviewCsv);
  console.log(`\n--- D2: Review-Liste (durch D1 ausgeschlossen, Erwartung 27) ---`);
  console.log(`Gefunden: ${reviewList.length}${reviewList.length !== 27 ? ` (ABWEICHUNG von erwarteten 27: ${reviewList.length - 27 > 0 ? '+' : ''}${reviewList.length - 27})` : ''}`);
  const byGrund = reviewList.reduce((acc, m) => (acc[m.grund] = (acc[m.grund] || 0) + 1, acc), {});
  console.log(`Nach Grund: ${JSON.stringify(byGrund)}`);
  for (const m of reviewList) {
    console.log(`  ${m.berlinDate} ${m.berlinTime}  ${m.weekday.padEnd(10)}  ${m.grund.padEnd(11)}  ${m.id}  ${m.title}`);
  }
  console.log(`Review-CSV: ${reviewCsvPath}`);

  const toAssign = strictCandidates.filter(m => !icVideoSet.has(m.id));
  const alreadyIn = strictCandidates.length - toAssign.length;
  console.log(`\nDavon (der 22) bereits in IC-Playlist (uebersprungen): ${alreadyIn}`);
  console.log(`Davon NEU zuzuweisen: ${toAssign.length}`);

  const csvPath = path.join(outDir, `livestream-members-assign-${stamp}.csv`);
  let csv = csvRow(ASSIGN_CSV_HEADER);

  const estListQuota = 0; // wird vom Aufrufer (main) separat gezaehlt via onListCall/counters
  const estInsertQuota = toAssign.length * COST_INSERT;
  console.log(`\nQuota-Schaetzung (nur Inserts, List-Calls s.o.): ~${estInsertQuota} Einheiten (${toAssign.length}x${COST_INSERT}, Budget: ${QUOTA_BUDGET}).`);

  if (!args.execute) {
    for (const m of strictCandidates) {
      const action = icVideoSet.has(m.id) ? 'SKIP_ALREADY_MEMBER' : 'WOULD_INSERT';
      csv += csvRow([m.id, `${m.berlinDate} ${m.berlinTime}`, m.weekday, m.title, '', action]);
    }
    fs.writeFileSync(csvPath, csv);
    console.log(`\nCSV (Dry-Run-Vorschau): ${csvPath}`);
    console.log('\nDRY-RUN — es wurde KEIN playlistItems.insert aufgerufen (auch nicht in die Mitglieder-Playlist).');
    console.log('Echter Lauf: --assign-members --execute  (danach Bestaetigung "AUSFUEHREN" tippen).');
    console.log('ASSIGNED: 0');
    return;
  }

  // --- EXECUTE-Pfad ---
  if (toAssign.length === 0) {
    fs.writeFileSync(csvPath, csv);
    console.log('\nNichts zuzuweisen (0 neu).');
    console.log('ASSIGNED: 0');
    return;
  }
  if (!args.yes) {
    const ans = await ask(`\nWirklich ${toAssign.length} Video(s) in die MITGLIEDER-Playlist "${icPlaylist.snippet.title}" einfuegen? Tippe "AUSFUEHREN": `);
    if (ans.trim() !== 'AUSFUEHREN') {
      fs.writeFileSync(csvPath, csv);
      console.log('Abgebrochen — keine Bestaetigung.');
      console.log('ASSIGNED: 0');
      return;
    }
  }

  const progressPath = path.join(outDir, 'livestream-members-assign-progress.json');
  const progress = loadJSON(progressPath, { done: [] });
  const doneSet = new Set(progress.done || []);
  const persistProgress = () => fs.writeFileSync(progressPath, JSON.stringify({ done: [...doneSet], updatedAt: new Date().toISOString() }, null, 2));
  const persistCsv = () => fs.writeFileSync(csvPath, csv);
  persistCsv();

  let quotaUsed = 0;
  let assigned = 0;
  const todo = toAssign.filter(m => !doneSet.has(m.id));
  if (toAssign.length - todo.length) console.log(`\nWiederaufnahme: ${toAssign.length - todo.length} bereits erledigt, ${todo.length} offen.`);

  for (const m of todo) {
    if (quotaUsed + COST_INSERT > QUOTA_BUDGET) {
      console.log(`\nQuota-Budget (${QUOTA_BUDGET}) erreicht — sauberer Stopp. Rest morgen weiterlaufen lassen.`);
      break;
    }
    // Doppel-Check direkt vor dem Insert (Playlist koennte sich seit dem Read veraendert haben).
    if (icVideoSet.has(m.id)) {
      console.log(`  UEBERSPRUNGEN ${m.id} — bereits in IC-Playlist.`);
      doneSet.add(m.id); persistProgress();
      continue;
    }
    try {
      const res = await withRetry(() => yt.playlistItems.insert({
        part: ['snippet'],
        requestBody: { snippet: { playlistId: icPlaylistId, resourceId: { kind: 'youtube#video', videoId: m.id } } },
      }));
      quotaUsed += COST_INSERT;
      assigned++;
      doneSet.add(m.id);
      icVideoSet.add(m.id);
      csv += csvRow([m.id, `${m.berlinDate} ${m.berlinTime}`, m.weekday, m.title, res.data.id, 'ASSIGNED']);
      persistCsv();
      persistProgress();
      console.log(`  OK ${m.id} -> playlistItemId=${res.data.id} (${assigned}/${todo.length})`);
    } catch (e) {
      if (e.quota) {
        console.error(`  QUOTA erschoepft bei ${m.id}: ${e.message} — sauberer Abbruch.`);
        break;
      }
      console.error(`  FEHLER ${m.id}: ${e.message} — uebersprungen.`);
    }
    if (args.delay) await sleep(args.delay);
  }

  console.log(`\nFertig. ASSIGNED: ${assigned} | Quota verbraucht: ~${quotaUsed}/${QUOTA_BUDGET}`);
  console.log(`CSV:   ${csvPath}`);
  console.log(`State: ${progressPath}`);
}

// ---------------------------------------------------------------------------
// U2 (2026-08-27): --assign-episode=videoId:nummer[,videoId:nummer,...] --
// bestaetigt eine vom Wochenlauf vorgeschlagene Inner-Circle-Nummer, OHNE
// data/series-registry.json von Hand zu bearbeiten. Der Wochenlauf selbst
// schreibt NIE automatisch eine Nummer (siehe classifyWeeklyCandidate/B1) --
// er schlaegt nur vor. Dieses Kommando ist der einzige Ort, an dem ein
// VOLLSTAENDIGER Registry-Eintrag (mit videoId) entsteht; der Thumbnail-Creator
// (thumbnail_service.py) schreibt beim Export nur den schlanken "lastAssigned"-
// Zaehler fuer die Anzeige, nie einen vollen Eintrag (siehe U1).
// Dry-Run-Default, --execute + Bestaetigung "AUSFUEHREN". Titel/Datum werden
// per videos.list nachgeladen (die videoId ist im Wochenlauf ohnehin bekannt),
// damit nichts manuell getippt werden muss ausser videoId und Nummer.
// ---------------------------------------------------------------------------
const SERIES_REGISTRY_FILE = path.resolve('data', 'series-registry.json');

function loadSeriesRegistryFull(filePath) {
  if (!fs.existsSync(filePath)) return { innercircle: [] };
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// V6 (2026-08-27): lastAssigned wird PRO SERIE gefuehrt. Frueher war es EIN
// Wert {number, at} und meinte implizit Inner Circle -- eine alte Datei wird
// hier transparent uebersetzt (gleiche Logik wie normalized_last_assigned() in
// thumbnail_service.py), damit ein Altstand nie als Zaehler einer anderen Serie
// gelesen wird. Ohne Eintrag fuer die Serie: 0, KEIN Ausweichen auf eine
// andere Serie.
function lastAssignedNumber(registry, series) {
  const raw = registry && registry.lastAssigned;
  if (!raw || typeof raw !== 'object') return 0;
  const counters = Number.isFinite(raw.number) ? { innercircle: raw } : raw;
  const counter = counters[series];
  return (counter && Number.isFinite(counter.number)) ? counter.number : 0;
}

async function runAssignEpisode(args, yt, onListCall) {
  const pairs = args.assignEpisode.split(',').map(s => s.trim()).filter(Boolean).map(spec => {
    const [videoId, numStr] = spec.split(':').map(s => (s || '').trim());
    return { videoId, number: Number(numStr) };
  });

  console.log(`\n=== U2: --assign-episode (${pairs.length} Zuordnung(en)) ===`);
  console.log(`Modus: ${args.execute ? 'EXECUTE' : 'DRY-RUN (Plan, 0 Schreibvorgaenge)'}\n`);

  const malformed = pairs.filter(p => !p.videoId || !Number.isInteger(p.number) || p.number <= 0);
  if (malformed.length) {
    console.error(`Abbruch: ungueltiges Format. Erwartet: --assign-episode=videoId:nummer[,videoId:nummer,...] (Nummer = positive ganze Zahl).`);
    process.exit(1);
  }

  const registry = loadSeriesRegistryFull(SERIES_REGISTRY_FILE);
  const entries = registry.innercircle || (registry.innercircle = []);
  const byNumber = new Map(entries.map(e => [e.number, e]));
  const byVideoId = new Map(entries.map(e => [e.videoId, e]));

  // Duplikate INNERHALB dieses Aufrufs zuerst abfangen (zwei Paare mit derselben
  // Nummer oder derselben videoId), bevor ueberhaupt gegen die Registry geprueft wird.
  const seenNumbers = new Set();
  const seenVideoIds = new Set();
  const plan = [];
  for (const p of pairs) {
    if (seenNumbers.has(p.number)) { plan.push({ ...p, skip: `Nummer #${p.number} taucht mehrfach in diesem Aufruf auf` }); continue; }
    if (seenVideoIds.has(p.videoId)) { plan.push({ ...p, skip: `${p.videoId} taucht mehrfach in diesem Aufruf auf` }); continue; }
    seenNumbers.add(p.number); seenVideoIds.add(p.videoId);
    const existingByNumber = byNumber.get(p.number);
    if (existingByNumber) { plan.push({ ...p, skip: `#${p.number} ist bereits vergeben an ${existingByNumber.videoId}` }); continue; }
    const existingByVideoId = byVideoId.get(p.videoId);
    if (existingByVideoId) { plan.push({ ...p, skip: `${p.videoId} hat bereits eine Nummer (#${existingByVideoId.number})` }); continue; }
    plan.push(p);
  }

  const pending = plan.filter(p => !p.skip);
  if (pending.length) {
    const res = await yt.videos.list({ part: ['snippet', 'liveStreamingDetails'], id: pending.map(p => p.videoId), maxResults: 50 });
    if (onListCall) onListCall();
    const details = new Map((res.data.items || []).map(v => [v.id, v]));
    for (const p of pending) {
      const v = details.get(p.videoId);
      if (!v) { p.skip = 'videoId bei videos.list nicht gefunden -- Tippfehler?'; continue; }
      const ast = v.liveStreamingDetails && v.liveStreamingDetails.actualStartTime;
      const parts = berlinDateParts(ast || v.snippet.publishedAt);
      p.date = parts ? parts.date : null;
      p.title = v.snippet.title;
    }
  }

  console.log('--- Plan ---');
  for (const p of plan) {
    if (p.skip) console.log(`  UEBERSPRUNGEN #${p.number} -> ${p.videoId}: ${p.skip}`);
    else console.log(`  #${p.number} -> ${p.videoId} (${p.date})  "${(p.title || '').slice(0, 60)}"`);
  }

  const toWrite = plan.filter(p => !p.skip);
  if (toWrite.length === 0) {
    console.log('\nNichts zu schreiben (0 gueltige Zuordnungen).');
    console.log('ASSIGNED: 0');
    return;
  }

  if (!args.execute) {
    console.log(`\nDRY-RUN — es wurde NICHTS in die Registry geschrieben.`);
    console.log('Echter Lauf: --assign-episode=... --execute  (danach Bestaetigung "AUSFUEHREN" tippen).');
    console.log('ASSIGNED: 0');
    return;
  }

  if (!args.yes) {
    const ans = await ask(`\nWirklich ${toWrite.length} Nummer(n) in data/series-registry.json eintragen? Tippe "AUSFUEHREN": `);
    if (ans.trim() !== 'AUSFUEHREN') {
      console.log('Abgebrochen — keine Bestaetigung.');
      console.log('ASSIGNED: 0');
      return;
    }
  }

  // Backup VOR dem Schreiben (Projekt-Konvention, analog zum Creator-Export in
  // thumbnail_service.py).
  const backupDir = path.resolve(args.out);
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(SERIES_REGISTRY_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(SERIES_REGISTRY_FILE, path.join(backupDir, `series-registry-${stamp}.json`));
  }

  for (const p of toWrite) {
    entries.push({ number: p.number, videoId: p.videoId, date: p.date, title: p.title });
  }
  entries.sort((a, b) => a.number - b.number);
  // registry.lastAssigned (vom Thumbnail-Creator gepflegt, siehe U1) bleibt hier
  // unangetastet -- dieses Kommando schreibt volle Eintraege, keinen Zaehler.
  // Es fasst ausserdem ausschliesslich registry.innercircle an; livestream und
  // standard werden von --assign-episode nie beruehrt.
  fs.writeFileSync(SERIES_REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n');

  console.log(`\nEingetragen: ${toWrite.length}`);
  console.log(`ASSIGNED: ${toWrite.length}`);
}

// ---------------------------------------------------------------------------
// E3: --scan-members — Diagnose-Modus (read-only, kein API-Write, kein Quota-Verbrauch
// ausser den beiden list-Calls zum Lesen der Ziel-Playlist). Prueft alle aktuellen
// Archiv-Playlist-Eintraege ueber den unauthentifizierten HTTP-Check (checkMembersGatedHttp).
// ---------------------------------------------------------------------------
async function runScanMembers(args, rawTargetItems) {
  console.log(`\n--- E3: HTTP-Mitglieder-Scan der ${rawTargetItems.length} Archiv-Playlist-Eintraege ---`);
  console.log('(unauthentifizierter Check, kein API-Quota-Verbrauch, kein Schreibvorgang)\n');
  const suspects = [];
  const unresolved = [];
  let checked = 0;
  for (const it of rawTargetItems) {
    const gated = await checkMembersGatedHttp(it.videoId);
    checked++;
    if (gated === true) { suspects.push(it); console.log(`  [VERDACHT] ${it.videoId}  playlistItemId=${it.playlistItemId}  ${it.title}`); }
    else if (gated === null) { unresolved.push(it); console.log(`  [UNKLAR] ${it.videoId} — Seite nicht auswertbar.`); }
    if (checked % 20 === 0) console.log(`  ... ${checked}/${rawTargetItems.length} geprueft`);
    if (args.delay) await sleep(Math.min(args.delay, 300)); // hoeflich, aber nicht so langsam wie API-Delay
  }
  console.log(`\nGeprueft: ${checked} | Verdachtsfaelle: ${suspects.length} | unklar: ${unresolved.length}`);
  if (suspects.length) {
    console.log(`\n--remove-Befehl zum Entfernen (Dry-Run zuerst!):`);
    console.log(`  node src/youtube/sync-livestream-archive.js --remove=${suspects.map(it => it.playlistItemId).join(',')}`);
  }
  console.log('SCAN_SUSPECTS: ' + suspects.length);
}

// ---------------------------------------------------------------------------
// --classify: reiner Analyse-Modus. KEINE Inserts, KEINE Deletes, kein --execute,
// kein --yes -- nur lesen + eine CSV schreiben. Prueft die Premieren-Hypothese
// (deltaSekunden = wallClockSekunden - durationSekunden) fuer die aktuellen
// Archiv-Playlist-Eintraege UND gleicht die volle Erkennungsmenge gegen
// liveBroadcasts.list ab (Studio-Naeherung). Rechnet durchgehend mit
// actualStartTime/actualEndTime (rohe UTC-ISO-Strings, Sekunden-praezise),
// NIE mit publishedAt.
// ---------------------------------------------------------------------------
function deltaBucket(delta) {
  if (delta === null || delta === undefined) return 'nicht berechenbar';
  if (delta < 60) return '0-60';
  if (delta < 180) return '60-180';
  if (delta < 600) return '180-600';
  return '600+';
}
function hourBucket(hour) {
  if (hour === null || hour === undefined) return 'unbekannt';
  if (hour < 6) return '00-06';
  if (hour < 12) return '06-12';
  if (hour < 18) return '12-18';
  return '18-24';
}
function median(nums) {
  const s = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function buildClassifyRow(videoId, playlistItemId, d) {
  const ast = d && d.liveStreamingDetails && d.liveStreamingDetails.actualStartTime;
  const aet = d && d.liveStreamingDetails && d.liveStreamingDetails.actualEndTime;
  const berlin = ast ? berlinDateParts(ast) : null;
  const wallClockSec = (ast && aet) ? Math.round((Date.parse(aet) - Date.parse(ast)) / 1000) : null;
  const durationSec = (d && d.durationIso) ? durationToSeconds(d.durationIso) : null;
  const delta = (wallClockSec !== null && durationSec !== null) ? (wallClockSec - durationSec) : null;
  return {
    videoId,
    title: (d && d.title) || '',
    actualStartTimeBerlin: ast ? berlinISOWithSeconds(ast) : '',
    wochentag: berlin ? berlin.weekday : '',
    uhrzeit: berlin ? berlin.time : '',
    actualEndTimeBerlin: aet ? berlinISOWithSeconds(aet) : '',
    wallClockSec,
    durationSec,
    delta,
    hour: berlin ? Number(berlin.time.split(':')[0]) : null,
    privacyStatus: (d && d.privacyStatus) || '',
    playlistItemId,
  };
}

async function runClassify(args, yt, channel, rawTargetItems, onListCall) {
  console.log(`\n--- --classify: reiner Analyse-Modus (keine Schreibvorgaenge) ---`);
  console.log(`Archiv-Playlist-Eintraege: ${rawTargetItems.length}\n`);

  // 1) Datenerhebung fuer alle aktuellen Archiv-Playlist-Eintraege.
  const ids = rawTargetItems.map(it => it.videoId);
  const details = await fetchVideoDetails(yt, ids, onListCall);
  const rows = rawTargetItems.map(it => buildClassifyRow(it.videoId, it.playlistItemId, details.get(it.videoId)));

  const missingStart = rows.filter(r => !r.actualStartTimeBerlin).length;
  const missingEnd = rows.filter(r => !r.actualEndTimeBerlin).length;
  const missingDuration = rows.filter(r => r.durationSec === null).length;
  const unresolvableDelta = rows.filter(r => r.delta === null).length;

  const CLASSIFY_CSV_HEADER = ['videoId', 'titel', 'actualStartTime', 'wochentag', 'uhrzeit', 'actualEndTime', 'wallClockSekunden', 'durationSekunden', 'deltaSekunden', 'privacyStatus', 'playlistItemId'];
  const sorted = rows.slice().sort((a, b) => {
    if (a.delta === null && b.delta === null) return 0;
    if (a.delta === null) return 1;
    if (b.delta === null) return -1;
    return a.delta - b.delta;
  });
  let csv = csvRow(CLASSIFY_CSV_HEADER);
  for (const r of sorted) {
    csv += csvRow([r.videoId, r.title, r.actualStartTimeBerlin, r.wochentag, r.uhrzeit, r.actualEndTimeBerlin,
      r.wallClockSec === null ? '' : r.wallClockSec, r.durationSec === null ? '' : r.durationSec,
      r.delta === null ? '' : r.delta, r.privacyStatus, r.playlistItemId]);
  }
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `livestream-classify-${stamp}.csv`);
  fs.writeFileSync(csvPath, csv);

  console.log(`Fehlende Felder: kein actualStartTime=${missingStart} | kein actualEndTime=${missingEnd} | keine Dauer=${missingDuration} | delta nicht berechenbar=${unresolvableDelta}`);
  console.log(`CSV: ${csvPath}\n`);

  // 2) Bucket-Verteilung deltaSekunden.
  const buckets = ['0-60', '60-180', '180-600', '600+', 'nicht berechenbar'];
  const byBucket = {};
  for (const b of buckets) byBucket[b] = [];
  for (const r of rows) byBucket[deltaBucket(r.delta)].push(r);
  console.log(`--- Auswertung a) Verteilung deltaSekunden ---`);
  for (const b of buckets) console.log(`  ${b.padEnd(20)} ${byBucket[b].length}`);
  const negDelta = rows.filter(r => r.delta !== null && r.delta < 0);
  if (negDelta.length) console.log(`  HINWEIS: ${negDelta.length} Zeile(n) mit NEGATIVEM delta (wallClock < duration) -- in "0-60" enthalten, gesondert pruefen.`);

  // b) Kreuztabelle Uhrzeit-Bucket x Delta-Bucket.
  const hourBuckets = ['00-06', '06-12', '12-18', '18-24', 'unbekannt'];
  const cross = {};
  for (const hb of hourBuckets) { cross[hb] = {}; for (const db of buckets) cross[hb][db] = 0; }
  for (const r of rows) cross[hourBucket(r.hour)][deltaBucket(r.delta)]++;
  console.log(`\n--- Auswertung b) Kreuztabelle Uhrzeit-Bucket (Berlin, actualStartTime) x Delta-Bucket ---`);
  console.log(`  ${'Uhrzeit'.padEnd(12)}${buckets.map(b => b.padEnd(20)).join('')}`);
  for (const hb of hourBuckets) {
    console.log(`  ${hb.padEnd(12)}${buckets.map(b => String(cross[hb][b]).padEnd(20)).join('')}`);
  }

  // c) Median durationSekunden je Uhrzeit-Bucket.
  console.log(`\n--- Auswertung c) Median durationSekunden je Uhrzeit-Bucket ---`);
  for (const hb of hourBuckets) {
    const durs = rows.filter(r => hourBucket(r.hour) === hb && r.durationSec !== null).map(r => r.durationSec);
    const m = median(durs);
    console.log(`  ${hb.padEnd(12)} n=${durs.length}  Median=${m === null ? 'n/a' : Math.round(m) + 's'}`);
  }

  // d) 5 Beispiele je Delta-Bucket.
  console.log(`\n--- Auswertung d) Beispiele je Delta-Bucket (max. 5) ---`);
  for (const b of buckets) {
    console.log(`  [${b}] (${byBucket[b].length} gesamt):`);
    for (const r of byBucket[b].slice(0, 5)) {
      console.log(`    ${r.actualStartTimeBerlin || '(kein actualStartTime)'}  ${(r.wochentag || '').padEnd(10)}  dauer=${r.durationSec === null ? 'n/a' : r.durationSec + 's'}  delta=${r.delta === null ? 'n/a' : r.delta + 's'}  ${r.title}`);
    }
  }

  // 4) Abgleich gegen Studio via liveBroadcasts.list (volle Erkennungsmenge, nicht nur Archiv-Playlist).
  console.log(`\n--- Abschnitt 4: Abgleich gegen liveBroadcasts.list (Studio-Naeherung) ---`);
  const detected = await detectPastLivestreams(yt, channel, onListCall);
  const broadcastIds = await listCompletedBroadcastIds(yt, onListCall);
  const broadcastSet = new Set(broadcastIds);
  console.log(`Erkannte Livestreams (detectPastLivestreams): ${detected.length}`);
  console.log(`liveBroadcasts.list (completed): ${broadcastIds.length}`);
  const overzaehlig = detected.filter(d => !broadcastSet.has(d.id));
  console.log(`NICHT in liveBroadcasts-Menge (Ueberzaehlige gegenueber Studio-Naeherung): ${overzaehlig.length}`);

  const overzaehligRows = overzaehlig.map(d => buildClassifyRow(d.id, '', d));
  const overzaehligByBucket = {};
  for (const b of buckets) overzaehligByBucket[b] = [];
  for (const r of overzaehligRows) overzaehligByBucket[deltaBucket(r.delta)].push(r);
  console.log(`\nDelta-Bucket-Verteilung der Ueberzaehligen:`);
  for (const b of buckets) console.log(`  ${b.padEnd(20)} ${overzaehligByBucket[b].length}`);

  const shortBuckets = overzaehligByBucket['0-60'].length + overzaehligByBucket['60-180'].length;
  const shortShare = overzaehligRows.length ? shortBuckets / overzaehligRows.length : 0;
  console.log(`\nAnteil der Ueberzaehligen in 0-180s: ${shortBuckets}/${overzaehligRows.length} (${(shortShare * 100).toFixed(0)}%)`);
  if (overzaehligRows.length === 0) {
    console.log('AUSSAGE: Keine Ueberzaehligen gegenueber liveBroadcasts gefunden -- Abgleich liefert keinen Hinweis auf Premieren.');
  } else if (shortShare >= 0.7) {
    console.log('AUSSAGE: Ueberzaehlige sammeln sich deutlich im Bucket 0-180s -- STUETZT die Premieren-Hypothese.');
  } else if (shortShare <= 0.3) {
    console.log('AUSSAGE: Ueberzaehlige sammeln sich NICHT im Bucket 0-180s -- WIDERSPRICHT der Premieren-Hypothese in dieser Form.');
  } else {
    console.log('AUSSAGE: Keine klare Sammlung im Bucket 0-180s -- Bild ist gemischt, keine eindeutige Aussage moeglich.');
  }
  for (const r of overzaehligRows.slice(0, 15)) {
    console.log(`    [${deltaBucket(r.delta)}] ${r.actualStartTimeBerlin || '(kein actualStartTime)'}  delta=${r.delta === null ? 'n/a' : r.delta + 's'}  ${r.videoId}  ${r.title}`);
  }

  console.log(`\nKEINE Klassifikation/Entscheidung wurde vorgenommen. Nichts entfernt, keine Ausschlussdatei geaendert.`);
  console.log('CLASSIFIED: ' + rows.length);
}

// ---------------------------------------------------------------------------
// L3: Auth-Vorsorge fuer den unbeaufsichtigten Betrieb.
// Der OAuth-Zustimmungsbildschirm laeuft (noch) im Testing-Modus -> das
// Refresh-Token verfaellt nach 7 Tagen. Ein woechentlicher Aufgabenplanungs-Lauf
// trifft das fast zwangslaeufig. In der Aufgabenplanung waere dann nur ein nackter
// Fehlercode sichtbar; deshalb wird der Grund im Klartext nach
// backups/livestream-weekly-LAST.txt geschrieben.
// ---------------------------------------------------------------------------
function isAuthError(e) {
  if (!e) return false;
  const msg = String(e.message || '');
  const reason = (e.errors && e.errors[0] && e.errors[0].reason) || '';
  const data = (e.response && e.response.data) || {};
  const oauthError = String(data.error || '');
  return /invalid_grant|invalid_client|invalid_token|unauthorized_client|Token has been expired or revoked|No refresh token|No access, refresh token/i.test(msg)
    || /invalid_grant|invalid_client|unauthorized_client/i.test(oauthError)
    || e.code === 401
    || reason === 'authError'
    || reason === 'unauthorized';
}

// Schreibt die Auth-Meldung in dieselbe Datei, die der Wochenlauf sonst pflegt --
// dort schaut der Nutzer nach, wenn die Aufgabenplanung einen Fehler zeigt.
function writeAuthFailureLast(outDir, detail) {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const lines = [
      'AUTH ABGELAUFEN - npm run auth noetig',
      '',
      `Zeitpunkt:  ${new Date().toISOString()}`,
      'Ergebnis:   ABBRUCH vor jeder Aenderung. Es wurde NICHTS eingefuegt.',
      'Exit-Code:  1',
      '',
      'Der Wochenlauf konnte sich nicht bei der YouTube API anmelden. Im',
      'Testing-Modus des OAuth-Zustimmungsbildschirms verfaellt das Refresh-Token',
      'nach 7 Tagen -- ein woechentlicher Lauf laeuft praktisch immer hinein.',
      '',
      'So wird der Lauf wieder gruen:',
      '  1) .youtube-token.json wegraeumen (umbenennen oder loeschen)',
      '  2) npm run auth   (einmal im Browser bestaetigen)',
      '  3) npm run livestreams:weekly',
      '',
      'Dauerhafte Loesung: OAuth-Zustimmungsbildschirm in der Google Cloud Console',
      'von "Testing" auf "In Produktion" umstellen -- dann entfaellt der 7-Tage-Ablauf.',
      '',
      `Technische Meldung: ${detail}`,
    ];
    fs.writeFileSync(path.join(outDir, WEEKLY_LAST_RUN_FILE), lines.join('\n') + '\n');
    return path.join(outDir, WEEKLY_LAST_RUN_FILE);
  } catch (_) {
    return null; // Vorsorge darf den eigentlichen Fehler nie ueberdecken.
  }
}

// ---------------------------------------------------------------------------
// WOCHENLAUF (--weekly) + K3-BACKTEST (--simulate-from).
// ---------------------------------------------------------------------------

// Reine Entscheidungsfunktion (keine I/O, keine Seiteneffekte) -- damit die
// Sendeplan-Logik isoliert nachvollziehbar und im Backtest identisch ist.
//   weekday    : deutscher Wochentagsname aus berlinDateParts() (actualStartTime)
//   berlinTime : "HH:MM" aus berlinDateParts() (nur noch fuer den Hinweistext)
//   gated      : Rueckgabe von checkMembersGatedHttp() -> true | false | null
// Zielorte sind 'IC' (Mitglieder-Playlist) und 'ARCHIVE' (Archiv-Playlist).
function classifyWeeklyCandidate(weekday, berlinTime, gated) {
  // B2 bleibt: ohne verwertbare Messung wird NICHT eingefuegt (fail-closed).
  if (gated === null) return { note: weeklyScheduleNote(weekday, berlinTime), decision: 'UNVERIFIED', target: null };
  // B1 (2026-08-27): Signal B entscheidet ALLEIN. Wochentag/Uhrzeit sind nur
  // noch ein Hinweis (siehe weeklyScheduleNote), kein Routing-Kriterium mehr.
  return { note: weeklyScheduleNote(weekday, berlinTime), decision: 'INSERT', target: gated ? 'IC' : 'ARCHIVE' };
}

// Rein informativ: weicht Wochentag/Uhrzeit vom Sendeplan ab, kommt ein Hinweis
// in Report und CSV -- ohne irgendetwas zu blockieren.
function weeklyScheduleNote(weekday, berlinTime) {
  const hour = Number(String(berlinTime || '').split(':')[0]);
  const onSchedule = WEEKLY_SCHEDULE.has(weekday) && Number.isFinite(hour) && hour >= WEEKLY_MIN_HOUR_BERLIN;
  return onSchedule ? null : `${weekday}, ungewoehnlich`;
}

const WEEKLY_TARGET_LABEL = { IC: 'IC-Playlist', ARCHIVE: 'Archiv-Playlist', NONE: 'keine Playlist' };
const signalLabel = s => (s === null ? 'nicht auswertbar' : WEEKLY_TARGET_LABEL[s] || s);

// Kandidaten der H4-Menge auf verwertbare actualStartTime + Berlin-Zeitfenster
// eindampfen. Ohne actualStartTime gibt es kein Signal A -> fail-closed verwerfen
// (und zaehlen, damit es im Report sichtbar bleibt).
function collectWeeklyCandidates(detected, fromDate, toDate) {
  const candidates = [];
  let noStartTime = 0;
  for (const d of detected) {
    const ast = d.liveStreamingDetails && d.liveStreamingDetails.actualStartTime;
    const parts = ast ? berlinDateParts(ast) : null;
    if (!parts) { noStartTime++; continue; }
    if (fromDate && parts.date < fromDate) continue;
    if (toDate && parts.date > toDate) continue;
    candidates.push({
      id: d.id,
      title: d.title || '',
      actualStartTime: ast,
      berlinDate: parts.date,
      berlinTime: parts.time,
      weekday: parts.weekday,
      privacyStatus: d.privacyStatus || '',
    });
  }
  candidates.sort((a, b) => (a.berlinDate + a.berlinTime).localeCompare(b.berlinDate + b.berlinTime));
  candidates.noStartTime = noStartTime;
  return candidates;
}

// Signal B fuer eine Kandidatenliste erheben. Unauthentifiziert -> KEIN Quota.
// Wird fuer JEDEN Kandidaten erhoben (auch OFF_SCHEDULE), damit der Report beide
// Signale zeigt und ein kaputter HTTP-Check sofort auffaellt.
async function measureWeeklyCandidates(candidates, label) {
  console.log(`\n--- Signal B: HTTP-playabilityStatus-Check fuer ${candidates.length} ${label} (unauthentifiziert, kein Quota) ---`);
  const out = [];
  let n = 0;
  for (const c of candidates) {
    const { gated, grund } = await checkMembersGatedHttpDetailed(c.id);
    out.push({ ...c, gated, gatedGrund: grund, ...classifyWeeklyCandidate(c.weekday, c.berlinTime, gated) });
    n++;
    if (n % 25 === 0) console.log(`  ... ${n}/${candidates.length} gemessen`);
    await sleep(150);
  }
  return out;
}

function weeklyCsvLine(r, action, playlistItemId) {
  return csvRow([r.id, r.title, `${r.berlinDate} ${r.berlinTime}`, r.weekday,
    r.gated === null ? 'nicht auswertbar' : (r.gated ? 'ja' : 'nein'),
    r.target ? WEEKLY_TARGET_LABEL[r.target] : '', r.note || '', playlistItemId || '', action]);
}

// ---------------------------------------------------------------------------
// K3: --simulate-from — Backtest der Entscheidungslogik an echter Historie.
// Umgeht bewusst das harte Mindestdatum, BEIDE Ausschlussdateien und den
// Bereits-vorhanden-Filter (es geht um die reine Signalauswertung). Kann per
// Konstruktion nichts schreiben: kein Insert, kein Resume-State, kein LAST.txt --
// nur eine CSV. Die Kombination mit --execute wird in main() hart abgelehnt.
// ---------------------------------------------------------------------------
async function runWeeklySimulate(args, yt, channel, onListCall) {
  const from = args.simulateFrom;
  const to = args.simulateTo || null;
  console.log(`\n--- K3: BACKTEST (--simulate-from=${from}${to ? ` --simulate-to=${to}` : ''}) ---`);
  console.log('Reiner Trockentest der Entscheidungslogik. KEINE Inserts, KEIN Resume-State,');
  console.log('KEIN LAST.txt. Mindestdatum, Ausschlussdateien und Playlist-Abgleich werden');
  console.log('bewusst IGNORIERT -- geprueft wird ausschliesslich der HTTP-Gated-Check.\n');

  const detected = await detectPastLivestreams(yt, channel, onListCall);
  const candidates = collectWeeklyCandidates(detected, from, to);
  console.log(`\nKandidaten im Zeitraum: ${candidates.length} (ohne actualStartTime verworfen: ${candidates.noStartTime})`);
  if (candidates.length === 0) {
    console.log('Keine Kandidaten im Zeitraum — nichts zu simulieren.');
    console.log('SIMULATED: 0');
    return EXIT_OK;
  }

  const rows = await measureWeeklyCandidates(candidates, 'Kandidaten');

  console.log(`\n--- Entscheidung je Kandidat ---`);
  for (const r of rows) {
    const gatedLabel = r.gated === null ? 'nicht auswertbar' : (r.gated ? 'gated' : 'nicht gated');
    console.log(`  ${r.berlinDate} ${r.berlinTime}  ${r.weekday.padEnd(10)}  gated=${gatedLabel.padEnd(16)} -> ${r.decision.padEnd(12)} ${signalLabel(r.target).padEnd(16)} ${r.note ? '(' + r.note + ')' : ''}  ${r.id}  ${(r.title || '').slice(0, 55)}`);
  }

  // Kreuztabelle Wochentag x Entscheidung -- zeigt jetzt auch Sonderstreams an
  // ungewoehnlichen Wochentagen als INSERT, statt sie wegzublocken (B1).
  const decisions = ['INSERT', 'UNVERIFIED'];
  const weekdayOrder = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const cross = {};
  for (const w of weekdayOrder) { cross[w] = {}; for (const d of decisions) cross[w][d] = 0; }
  for (const r of rows) { if (cross[r.weekday]) cross[r.weekday][r.decision]++; }
  console.log(`\n--- Kreuztabelle Wochentag x Entscheidung ---`);
  console.log(`  ${'Wochentag'.padEnd(12)}${decisions.map(d => d.padEnd(14)).join('')}gesamt`);
  for (const w of weekdayOrder) {
    const total = decisions.reduce((s, d) => s + cross[w][d], 0);
    if (total === 0) continue;
    console.log(`  ${w.padEnd(12)}${decisions.map(d => String(cross[w][d]).padEnd(14)).join('')}${total}`);
  }

  const unverified = rows.filter(r => r.decision === 'UNVERIFIED');
  const inserts = rows.filter(r => r.decision === 'INSERT');
  const unusual = inserts.filter(r => r.note);
  console.log(`\n--- Zusammenfassung Backtest ---`);
  console.log(`Kandidaten gesamt:  ${rows.length}`);
  console.log(`Wuerde einfuegen:   ${inserts.length} (Archiv: ${inserts.filter(r => r.target === 'ARCHIVE').length}, IC: ${inserts.filter(r => r.target === 'IC').length})`);
  console.log(`davon UNGEWOEHNLICH (nicht Do/So-Abend, aber trotzdem eingefuegt): ${unusual.length}`);
  console.log(`UNGEPRUEFT:         ${unverified.length}`);
  for (const r of unusual) {
    console.log(`  [UNGEWOEHNLICH] ${r.berlinDate} ${r.berlinTime} ${r.weekday}: ${r.note} -> trotzdem ${signalLabel(r.target)} — ${r.id} ${r.title}`);
  }
  for (const r of unverified) {
    console.log(`  [UNGEPRUEFT] ${r.berlinDate} ${r.berlinTime} ${r.weekday}: Messung nicht auswertbar — ${r.id} ${r.title}`);
  }

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `livestream-weekly-simulate-${stamp}.csv`);
  let csv = csvRow(WEEKLY_CSV_HEADER);
  for (const r of rows) csv += weeklyCsvLine(r, `SIMULATE_${r.decision}`, '');
  fs.writeFileSync(csvPath, csv);
  console.log(`\nCSV: ${csvPath}`);
  console.log('Es wurde NICHTS eingefuegt und keine andere Datei veraendert.');
  console.log('SIMULATED: ' + rows.length);
  // Backtest ist ein Diagnosewerkzeug: Ungeprueftes ist hier ein Befund, kein
  // Betriebsproblem -> trotzdem Exit 2, damit es nicht uebersehen wird.
  return unverified.length ? EXIT_ATTENTION : EXIT_OK;
}

// ---------------------------------------------------------------------------
// --weekly: der eigentliche Wochenlauf (dienstags).
// Schreibt in BEIDE Playlists (Archiv + IC) — aber ausschliesslich per
// playlistItems.insert und nur, wenn Sendeplan und Messung uebereinstimmen.
// G4: kein videos.update, kein playlistItems.delete. G5: Dry-Run ist Default.
// ---------------------------------------------------------------------------
// CY: aus der writeLast-Closure herausgeloest, damit derselbe Text auch ausserhalb
// eines scharfen Wochenlaufs erzeugt werden kann -- die UNVERIFIED-Sonde
// (scripts/gating-unverified-probe.cjs) rendert damit GENAU den Text, der im
// Ernstfall in LAST.txt landet, statt einen nachgebauten. Reine Funktion: sie
// schreibt nichts, sie liefert den Text.
function buildWeeklyLastText(summary, exitCode, csvPath, execute) {
  const lines = [
    `Letzter Wochenlauf: ${new Date().toISOString()}`,
    `Modus:              ${execute ? 'EXECUTE' : 'DRY-RUN'}`,
    `Ergebnis:           ${summary.status}`,
    `Exit-Code:          ${exitCode}${exitCode === EXIT_ATTENTION ? '  <-- BITTE PRUEFEN' : ''}`,
  ];
  // CX: UNVERIFIED steht GANZ OBEN, direkt unter dem Kopf. Ein Stream, den der
  // Check nicht einstufen konnte, ist der einzige Posten, der eine Handlung
  // verlangt -- er darf nicht unter Zahlenkolonnen und der UNGEWOEHNLICH-Liste
  // begraben sein. Seit der Umstellung auf decideGatedStrict landet hier auch,
  // was frueher stillschweigend ins oeffentliche Archiv gewandert waere.
  if (summary.unverified.length) {
    lines.push(
      '',
      `!!! UNVERIFIED: ${summary.unverified.length} Stream(s) NICHT einsortiert — bitte von Hand pruefen`,
      '    Grund: Der Mitglieder-Check konnte das Video nicht eindeutig einstufen.',
      '    Fail-closed: im Zweifel wird NICHT eingefuegt, weder ins Archiv noch in die IC-Playlist.',
    );
    for (const r of summary.unverified) {
      lines.push(`    - ${r.berlinDate} ${r.berlinTime} ${r.weekday} | ${r.title}`);
      lines.push(`      ${r.gatedGrund || 'Grund nicht erfasst'}`);
      lines.push(`      ${r.id}`);
    }
  }
  lines.push(
    '',
    `Neue Kandidaten:    ${summary.candidates}`,
    `Eingefuegt Archiv:  ${summary.insertedArchive}`,
    `Eingefuegt IC:      ${summary.insertedIC}`,
    `Ungewoehnlich:      ${summary.unusual}  (nicht Do/So-Abend, aber trotzdem eingefuegt -- Signal B war eindeutig)`,
    `Ungeprueft:         ${summary.unverified.length}`,
    `Quota verbraucht:   ~${summary.quota}/${QUOTA_BUDGET}`,
    '',
    `Archiv-Playlist danach: ${summary.archiveTotal} Eintraege`,
    `IC-Playlist danach:     ${summary.icTotal} Eintraege`,
    '',
    `CSV: ${csvPath}`,
  );
  if (summary.unusualRows && summary.unusualRows.length) {
    lines.push('', 'UNGEWOEHNLICH (trotzdem eingefuegt, nur zur Kenntnis):');
    for (const r of summary.unusualRows) lines.push(`  ${r.berlinDate} ${r.berlinTime} ${r.weekday}: ${r.note} -> ${signalLabel(r.target)} | ${r.id} | ${r.title}`);
  }
  // Die UNVERIFIED-Liste steht bewusst OBEN (siehe dort) und nicht mehr hier.
  if (summary.icSuggestions && summary.icSuggestions.length) {
    lines.push('', 'U2: NUMMERN-VORSCHLAEGE (nichts geschrieben, bitte bestaetigen):');
    for (const line of summary.icSuggestions) lines.push(`  ${line}`);
  }
  return lines.join('\n') + '\n';
}

async function runWeekly(args, yt, channel, targetPlaylistId, targetPlaylist, rawTargetItems, counters, onListCall) {
  const icPlaylistId = process.env.INNER_CIRCLE_PLAYLIST_ID;
  if (!icPlaylistId) {
    console.error('Abbruch: INNER_CIRCLE_PLAYLIST_ID fehlt in .env. Der Wochenlauf braucht BEIDE Playlists (Do -> IC, So -> Archiv).');
    console.log('WEEKLY_INSERTED: 0');
    process.exit(1);
  }

  const plRes = await yt.playlists.list({ part: ['snippet'], id: [icPlaylistId] });
  onListCall();
  const icPlaylist = plRes.data.items && plRes.data.items[0];
  if (!icPlaylist) { console.error(`Abbruch: Mitglieder-Playlist ${icPlaylistId} nicht gefunden.`); process.exit(1); }

  console.log(`\n=== WOCHENLAUF (--weekly) ===`);
  console.log(`Modus:            ${args.execute ? 'EXECUTE (echte Inserts angefordert)' : 'DRY-RUN (Plan, 0 Inserts)'}`);
  console.log(`Archiv-Playlist:  "${targetPlaylist.snippet.title}" (${targetPlaylistId})`);
  console.log(`IC-Playlist:      "${icPlaylist.snippet.title}" (${icPlaylistId})`);
  console.log(`Sendeplan gilt ab: ${WEEKLY_START_DATE_BERLIN} (hartes Mindestdatum, nie rueckwirkend)`);
  console.log(`Schwellen (K1):   max. ${args.maxInsertable} einfuegbar / max. ${args.maxCandidates} Kandidaten gesamt`);

  // --- 1) Live-Zustand BEIDER Playlists + beide Ausschlussdateien frisch lesen. ---
  const icRawItems = await listTargetPlaylistRaw(yt, icPlaylistId, onListCall);
  const archiveSet = new Set(rawTargetItems.map(it => it.videoId));
  const icSet = new Set(icRawItems.map(it => it.videoId));
  const manualExcludeIds = loadMembersExcludeFile(MEMBERS_EXCLUDE_FILE);
  const premieresExcludeIds = loadMembersExcludeFile(PREMIERES_EXCLUDE_FILE);
  const excludeSet = new Set([...manualExcludeIds, ...premieresExcludeIds]);
  console.log(`\nArchiv-Playlist: ${rawTargetItems.length} Eintraege (${archiveSet.size} eindeutig)`);
  console.log(`IC-Playlist:     ${icRawItems.length} Eintraege (${icSet.size} eindeutig)`);
  console.log(`Ausschlussdateien: members-only=${manualExcludeIds.length}, premieres=${premieresExcludeIds.length} (Union: ${excludeSet.size})`);

  // --- 2) H4-Kandidatenmenge (enthaelt den G2-Guardrail bei < 200 Broadcasts). ---
  const detected = await detectPastLivestreams(yt, channel, onListCall);

  // --- 3) Hartes Mindestdatum. ---
  const inWindow = collectWeeklyCandidates(detected, WEEKLY_START_DATE_BERLIN, null);
  console.log(`\n--- Filter ---`);
  console.log(`H4-Livestreams gesamt:                 ${detected.length}`);
  console.log(`davon ab ${WEEKLY_START_DATE_BERLIN} (Sendeplan-Fenster): ${inWindow.length}`);
  if (inWindow.noStartTime) console.log(`ohne actualStartTime verworfen (fail-closed): ${inWindow.noStartTime}`);

  // --- 4) Bereits vorhanden / dauerhaft ausgeschlossen. ---
  const already = inWindow.filter(c => archiveSet.has(c.id) || icSet.has(c.id));
  const excluded = inWindow.filter(c => !archiveSet.has(c.id) && !icSet.has(c.id) && excludeSet.has(c.id));
  const candidates = inWindow.filter(c => !archiveSet.has(c.id) && !icSet.has(c.id) && !excludeSet.has(c.id));
  console.log(`bereits in einer Playlist (uebersprungen): ${already.length}`);
  console.log(`in Ausschlussdatei (uebersprungen):        ${excluded.length}`);
  console.log(`NEUE Kandidaten:                          ${candidates.length}`);

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `livestream-weekly-${stamp}.csv`);
  const lastPath = path.join(outDir, WEEKLY_LAST_RUN_FILE);

  // K4: LAST.txt wird IMMER geschrieben (auch bei 0 Kandidaten und bei Abbruch),
  // damit "Datei ist alt" ein zuverlaessiges Zeichen fuer "Task lief nicht" ist.
  const writeLast = (summary, exitCode) => {
    fs.writeFileSync(lastPath, buildWeeklyLastText(summary, exitCode, csvPath, args.execute));
  };

  const baseSummary = {
    candidates: candidates.length, insertedArchive: 0, insertedIC: 0, unusual: 0,
    unusualRows: [], unverified: [], icSuggestions: [],
    quota: counters.listCalls * COST_LIST,
    archiveTotal: rawTargetItems.length, icTotal: icRawItems.length,
  };

  if (candidates.length === 0) {
    fs.writeFileSync(csvPath, csvRow(WEEKLY_CSV_HEADER));
    console.log(`\n--- REPORT ---`);
    console.log('Keine neuen Kandidaten — nichts zu tun.');
    console.log(`Archiv-Playlist: ${rawTargetItems.length} | IC-Playlist: ${icRawItems.length}`);
    console.log(`Quota verbraucht: ~${baseSummary.quota}/${QUOTA_BUDGET}`);
    console.log(`CSV: ${csvPath}`);
    writeLast({ ...baseSummary, status: 'sauber — keine neuen Kandidaten' }, EXIT_OK);
    console.log(`Kurzreport: ${lastPath}`);
    console.log('WEEKLY_INSERTED: 0');
    return EXIT_OK;
  }

  // --- 5) Signal B erheben + klassifizieren. ---
  const rows = await measureWeeklyCandidates(candidates, 'neue Kandidaten');
  const insertable = rows.filter(r => r.decision === 'INSERT');
  const unusual = insertable.filter(r => r.note);
  const unverified = rows.filter(r => r.decision === 'UNVERIFIED');

  console.log(`\n--- Entscheidung ---`);
  for (const r of insertable) {
    const hint = r.note ? `  (${r.note})` : '';
    console.log(`  [EINFUEGEN]    ${r.weekday} ${r.berlinDate} ${r.berlinTime} -> ${WEEKLY_TARGET_LABEL[r.target]}${hint}  ${r.id}  ${(r.title || '').slice(0, 55)}`);
  }
  for (const r of unverified) {
    console.log(`  [UNGEPRUEFT]   ${r.weekday} ${r.berlinDate} ${r.berlinTime}  Messung nicht auswertbar  ${r.id}  ${r.title}`);
  }

  Object.assign(baseSummary, { unusual: unusual.length, unusualRows: unusual, unverified });

  // --- 6) K1-Schwellen, NACH der Klassifikation (vorher ist unbekannt, was einfuegbar ist). ---
  const tripped = insertable.length > args.maxInsertable
    ? { action: 'ABORT_MAX_INSERTABLE', msg: `${insertable.length} einfuegbare Kandidaten > Schwelle ${args.maxInsertable}` }
    : candidates.length > args.maxCandidates
      ? { action: 'ABORT_MAX_CANDIDATES', msg: `${candidates.length} Kandidaten gesamt > Schwelle ${args.maxCandidates}` }
      : null;
  if (tripped) {
    let csv = csvRow(WEEKLY_CSV_HEADER);
    for (const r of rows) csv += weeklyCsvLine(r, tripped.action, '');
    fs.writeFileSync(csvPath, csv);
    console.log(`\n=== ABBRUCH (${tripped.action}) ===`);
    console.log(`${tripped.msg}.`);
    console.log('Normal sind 2 einfuegbare und bis zu 6 Kandidaten pro Woche. Mehr bedeutet,');
    console.log('dass etwas kaputt ist (Erkennungsregel, Endpunkt, Auth) — es wurde NICHTS eingefuegt.');
    console.log(`CSV: ${csvPath}`);
    writeLast({ ...baseSummary, status: `ABBRUCH: ${tripped.msg}` }, EXIT_ATTENTION);
    console.log(`Kurzreport: ${lastPath}`);
    console.log('WEEKLY_INSERTED: 0');
    return EXIT_ATTENTION;
  }

  const estInsertQuota = insertable.length * COST_INSERT;
  console.log(`\nQuota-Schaetzung: list-Calls ~${counters.listCalls * COST_LIST} + Inserts ~${estInsertQuota} = ~${counters.listCalls * COST_LIST + estInsertQuota} (Budget: ${QUOTA_BUDGET}).`);

  const finish = (status, exitCode, insertedArchive, insertedIC, quota, icSuggestions = []) => {
    const summary = {
      ...baseSummary, status, insertedArchive, insertedIC, quota, icSuggestions,
      archiveTotal: rawTargetItems.length + insertedArchive,
      icTotal: icRawItems.length + insertedIC,
    };
    console.log(`\n=== REPORT ===`);
    console.log(`Neue Kandidaten gesamt:  ${candidates.length}`);
    console.log(`Ins Archiv eingefuegt:   ${insertedArchive}`);
    console.log(`In die IC-Playlist:      ${insertedIC}`);
    console.log(`davon UNGEWOEHNLICH (nicht Do/So-Abend, trotzdem eingefuegt): ${unusual.length}`);
    console.log(`Uebersprungen — UNGEPRUEFT (HTTP-Check nicht auswertbar):   ${unverified.length}`);
    console.log(`Quota verbraucht:        ~${quota}/${QUOTA_BUDGET}`);
    console.log(`Archiv-Playlist danach:  ${summary.archiveTotal} Eintraege`);
    console.log(`IC-Playlist danach:      ${summary.icTotal} Eintraege`);
    console.log(`CSV: ${csvPath}`);
    writeLast(summary, exitCode);
    console.log(`Kurzreport: ${lastPath}`);
    console.log(`WEEKLY_INSERTED: ${insertedArchive + insertedIC}`);
    return exitCode;
  };

  // K4: Ungeprueftes ist kein Fehler, braucht aber einen Blick. Ungewoehnlich
  // (B1) ist explizit KEIN Grund fuer Exit 2 -- Signal B war eindeutig, das
  // Video gehoert dorthin, es ist nur ein Sonderfall im Kalender, kein Problem.
  const attention = unverified.length ? EXIT_ATTENTION : EXIT_OK;
  const status = attention === EXIT_ATTENTION
    ? `${unverified.length} ungeprueft — bitte pruefen`
    : 'sauber';

  // --- 7) Dry-Run (G5-Default). ---
  if (!args.execute) {
    let csv = csvRow(WEEKLY_CSV_HEADER);
    for (const r of rows) {
      csv += weeklyCsvLine(r, r.decision === 'INSERT' ? `WOULD_INSERT_${r.target}` : r.decision, '');
    }
    fs.writeFileSync(csvPath, csv);
    console.log('\nDRY-RUN — es wurde KEIN playlistItems.insert aufgerufen.');
    console.log('Echter Lauf: --weekly --execute  (danach Bestaetigung "AUSFUEHREN" tippen).');
    return finish(`DRY-RUN (${insertable.length} wuerden eingefuegt) — ${status}`, attention, 0, 0, baseSummary.quota);
  }

  // --- 8) EXECUTE-Pfad. ---
  if (insertable.length === 0) {
    fs.writeFileSync(csvPath, (() => { let c = csvRow(WEEKLY_CSV_HEADER); for (const r of rows) c += weeklyCsvLine(r, r.decision, ''); return c; })());
    console.log('\nNichts einzufuegen (0 Kandidaten mit uebereinstimmenden Signalen).');
    return finish(`nichts einzufuegen — ${status}`, attention, 0, 0, baseSummary.quota);
  }
  if (!args.yes) {
    const a = insertable.filter(r => r.target === 'ARCHIVE').length;
    const i = insertable.filter(r => r.target === 'IC').length;
    const ans = await ask(`\nWirklich ${insertable.length} Video(s) einfuegen (${a} ins Archiv, ${i} in die IC-Playlist)? Tippe "AUSFUEHREN": `);
    if (ans.trim() !== 'AUSFUEHREN') {
      fs.writeFileSync(csvPath, (() => { let c = csvRow(WEEKLY_CSV_HEADER); for (const r of rows) c += weeklyCsvLine(r, r.decision, ''); return c; })());
      console.log('Abgebrochen — keine Bestaetigung.');
      return finish('abgebrochen — keine Bestaetigung', attention, 0, 0, baseSummary.quota);
    }
  }

  // CSV: alles ausser den Inserts sofort schreiben, die Insert-Zeilen kommen
  // einzeln nach jedem erfolgreichen Call dazu (K3-Muster: kein inkonsistenter
  // Zustand bei hartem Abbruch).
  let csv = csvRow(WEEKLY_CSV_HEADER);
  for (const r of rows.filter(r => r.decision !== 'INSERT')) csv += weeklyCsvLine(r, r.decision, '');
  const persistCsv = () => fs.writeFileSync(csvPath, csv);
  persistCsv();

  const progressPath = path.join(outDir, 'livestream-weekly-progress.json');
  const progress = loadJSON(progressPath, { done: [] });
  const doneSet = new Set(progress.done || []);
  const persistProgress = () => fs.writeFileSync(progressPath, JSON.stringify({ done: [...doneSet], updatedAt: new Date().toISOString() }, null, 2));

  let quotaUsed = baseSummary.quota;
  let insertedArchive = 0, insertedIC = 0;
  const icInserted = []; // U2: fuer die Nummern-Vorschlaege nach der Schleife.
  for (const r of insertable) {
    if (doneSet.has(r.id)) {
      // Bereits in einem frueheren Lauf eingefuegt und danach offenbar manuell
      // wieder entfernt -> nicht gegen die Handentscheidung des Nutzers arbeiten.
      console.log(`  UEBERSPRUNGEN ${r.id} — steht im Resume-State (frueher schon eingefuegt).`);
      csv += weeklyCsvLine(r, 'SKIP_ALREADY_DONE', '');
      persistCsv();
      continue;
    }
    if (quotaUsed + COST_INSERT > QUOTA_BUDGET) {
      console.log(`\nQuota-Budget (${QUOTA_BUDGET}) erreicht — sauberer Stopp. Rest beim naechsten Lauf.`);
      break;
    }
    const playlistId = r.target === 'IC' ? icPlaylistId : targetPlaylistId;
    // Doppel-Check direkt vor dem Insert (Playlist koennte sich seit dem Read
    // veraendert haben) — nie einfuegen, was schon drin ist.
    if ((r.target === 'IC' ? icSet : archiveSet).has(r.id)) {
      console.log(`  UEBERSPRUNGEN ${r.id} — inzwischen bereits in ${WEEKLY_TARGET_LABEL[r.target]}.`);
      csv += weeklyCsvLine(r, 'SKIP_ALREADY_IN_PLAYLIST', '');
      persistCsv();
      continue;
    }
    try {
      const res = await withRetry(() => yt.playlistItems.insert({
        part: ['snippet'],
        requestBody: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId: r.id } } },
      }));
      quotaUsed += COST_INSERT;
      if (r.target === 'IC') { insertedIC++; icSet.add(r.id); icInserted.push(r); } else { insertedArchive++; archiveSet.add(r.id); }
      doneSet.add(r.id);
      csv += weeklyCsvLine(r, `INSERTED_${r.target}`, res.data.id);
      persistCsv();
      persistProgress();
      // G3: Wochentag + Uhrzeit (Berlin) + Zielort je eingefuegtem Video.
      console.log(`  OK ${r.weekday} ${r.berlinDate} ${r.berlinTime} -> ${WEEKLY_TARGET_LABEL[r.target]}  ${r.id} (playlistItemId=${res.data.id})`);
    } catch (e) {
      if (e.quota) { console.error(`  QUOTA erschoepft bei ${r.id}: ${e.message} — sauberer Abbruch.`); break; }
      console.error(`  FEHLER ${r.id}: ${e.message} — uebersprungen (naechster Lauf versucht es erneut).`);
      csv += weeklyCsvLine(r, 'ERROR', '');
      persistCsv();
    }
    if (args.delay) await sleep(args.delay);
  }

  // U2: Fuer jedes neu in die IC-Playlist eingefuegte Video EINEN Nummern-
  // Vorschlag ausgeben -- NIE automatisch schreiben (siehe classifyWeeklyCandidate/
  // B1: Wochentag ist kein verlaessliches Signal dafuer, ob es eine nummerierte
  // Folge ist -- #71 lief an einem Montag). Bestaetigung per
  // --assign-episode=videoId:nummer --execute, getrennt von diesem Lauf.
  const icSuggestions = [];
  if (icInserted.length) {
    const registryForHint = loadSeriesRegistryFull(SERIES_REGISTRY_FILE);
    const maxEntryNumber = Math.max(0, ...(registryForHint.innercircle || []).map(e => e.number || 0));
    let nextNumber = Math.max(maxEntryNumber, lastAssignedNumber(registryForHint, 'innercircle')) + 1;
    console.log(`\n--- U2: Nummern-Vorschlaege (nichts wurde geschrieben) ---`);
    for (const r of icInserted) {
      const line = `Kandidat fuer INNER CIRCLE #${nextNumber} -> ${r.id} (${r.weekday} ${r.berlinDate}) — bestaetigen mit: --assign-episode=${r.id}:${nextNumber} --execute`;
      console.log(`  ${line}`);
      icSuggestions.push(line);
      nextNumber++;
    }
  }

  console.log(`State: ${progressPath}`);
  const done = insertedArchive + insertedIC === insertable.length;
  return finish(done ? status : `unvollstaendig (${insertedArchive + insertedIC}/${insertable.length} eingefuegt) — ${status}`,
    done ? attention : EXIT_ATTENTION, insertedArchive, insertedIC, quotaUsed, icSuggestions);
}

// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);

  // K3: Der Backtest darf per Konstruktion nichts schreiben. Die Kombination mit
  // --execute wird abgelehnt, BEVOR irgendetwas gelesen oder geschrieben wird.
  if (args.simulateFrom && args.execute) {
    console.error('Abbruch: --simulate-from ist ein reiner Trockentest und laesst sich NICHT mit --execute kombinieren.');
    console.error('Fuer einen echten Lauf: --weekly --execute (ohne --simulate-from).');
    process.exit(1);
  }
  if (args.simulateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(args.simulateFrom)) {
    console.error(`Abbruch: --simulate-from=${args.simulateFrom} ist kein gueltiges Datum (Format: YYYY-MM-DD).`);
    process.exit(1);
  }
  if (args.simulateTo && !/^\d{4}-\d{2}-\d{2}$/.test(args.simulateTo)) {
    console.error(`Abbruch: --simulate-to=${args.simulateTo} ist kein gueltiges Datum (Format: YYYY-MM-DD).`);
    process.exit(1);
  }
  if (args.weekly && (!Number.isFinite(args.maxInsertable) || !Number.isFinite(args.maxCandidates))) {
    console.error('Abbruch: --max-insertable/--max-candidates erwarten eine Zahl.');
    process.exit(1);
  }

  if (!youtubeAvailable()) {
    console.error('Abbruch: kein OAuth-Token/Client-ID gefunden. Erst `npm run auth`.');
    // L3: fehlende Token-Datei ist derselbe Betriebsfall wie ein abgelaufenes Token.
    if (args.weekly) {
      const p = writeAuthFailureLast(path.resolve(args.out), 'kein OAuth-Token/Client-ID gefunden (.youtube-token.json fehlt?)');
      if (p) console.error(`Grund im Klartext: ${p}`);
    }
    process.exit(1);
  }

  const { google } = require('googleapis');
  const { getAuthorizedClient } = require('./auth');
  const oauth2 = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  const counters = { listCalls: 0 };
  const onListCall = () => { counters.listCalls++; };

  // --- Vorpruefung: Kanal bestaetigen, VOR jedem Schreibvorgang. ---
  const chRes = await yt.channels.list({ part: ['snippet', 'contentDetails'], mine: true });
  onListCall();
  const channel = chRes.data.items && chRes.data.items[0];
  if (!channel) { console.error('Abbruch: kein Kanal gefunden (mine=true).'); process.exit(1); }
  console.log(`Kanal:        ${channel.snippet.title} (${channel.id})`);

  // B1: --assign-members schreibt AUSSCHLIESSLICH in INNER_CIRCLE_PLAYLIST_ID und
  // braucht LIVESTREAM_ARCHIVE_PLAYLIST_ID dafuer nicht -> eigener Dispatch VOR der
  // Archiv-Playlist-Pruefung unten.
  if (args.assignMembers) {
    return runAssignMembers(args, yt, channel, onListCall);
  }

  // U2: --assign-episode schreibt AUSSCHLIESSLICH in data/series-registry.json,
  // braucht keine Playlist -> eigener Dispatch VOR der Archiv-Playlist-Pruefung.
  if (args.assignEpisode) {
    return runAssignEpisode(args, yt, onListCall);
  }

  // K3: der Backtest liest nur die Erkennungsmenge und braucht keine Ziel-Playlist
  // -> eigener Dispatch VOR der Archiv-Playlist-Pruefung.
  if (args.simulateFrom) {
    return runWeeklySimulate(args, yt, channel, onListCall);
  }

  // BB (2026-08-28): --check-standard fuer den manuellen/isolierten Test des
  // Standard-Zaehler-Drift-Checks, unabhaengig vom vollen Wochenlauf. Braucht
  // keine Archiv-Playlist -> eigener Dispatch VOR der Archiv-Playlist-Pruefung.
  // Im normalen Betrieb laeuft der Check automatisch als Teil von --weekly.
  if (args.checkStandard) {
    const { runStandardCounterDriftCheck } = require('./check-standard-counter');
    const icPlaylistIdForDrift = process.env.INNER_CIRCLE_PLAYLIST_ID;
    const innerCircleIdsForDrift = icPlaylistIdForDrift
      ? new Set((await listTargetPlaylistRaw(yt, icPlaylistIdForDrift, onListCall)).map(it => it.videoId))
      : new Set();
    await runStandardCounterDriftCheck(yt, channel, innerCircleIdsForDrift, onListCall);
    return EXIT_OK;
  }

  const targetPlaylistId = process.env.LIVESTREAM_ARCHIVE_PLAYLIST_ID;
  if (!targetPlaylistId) {
    console.error('Abbruch: LIVESTREAM_ARCHIVE_PLAYLIST_ID fehlt in .env. Keine andere ID wird geraten.');
    process.exit(1);
  }

  const plRes = await yt.playlists.list({ part: ['snippet'], id: [targetPlaylistId] });
  onListCall();
  const targetPlaylist = plRes.data.items && plRes.data.items[0];
  if (!targetPlaylist) { console.error(`Abbruch: Ziel-Playlist ${targetPlaylistId} nicht gefunden.`); process.exit(1); }
  console.log(`Ziel-Playlist: "${targetPlaylist.snippet.title}" (${targetPlaylistId})`);
  console.log(`Modus:         ${args.dedupe ? 'DEDUPE' : args.scanMembers ? 'SCAN-MEMBERS' : args.classify ? 'CLASSIFY (reine Analyse, keine Schreibvorgaenge)' : args.weekly ? 'WEEKLY (Wochenlauf)' : (args.execute ? 'EXECUTE (echte Inserts angefordert)' : 'DRY-RUN (Plan, 0 Inserts)')}\n`);

  // --- K1: Ziel-Playlist ROH lesen (kein Dedup-Helper). ---
  const rawTargetItems = await listTargetPlaylistRaw(yt, targetPlaylistId, onListCall);
  console.log(`Ziel-Playlist: ${rawTargetItems.length} Eintraege (roh, inkl. evtl. Duplikate).`);
  if (rawTargetItems.length >= PLAYLIST_SIZE_WARN) {
    console.log(`WARNUNG: Playlist naehert sich dem YouTube-Limit von 5000 Eintraegen (${rawTargetItems.length}).`);
  }

  if (args.dedupe) {
    return runDedupe(args, yt, targetPlaylistId, rawTargetItems);
  }
  if (args.remove) {
    return runRemove(args, yt, targetPlaylistId, rawTargetItems, path.resolve(args.out));
  }
  if (args.scanMembers) {
    return runScanMembers(args, rawTargetItems);
  }
  if (args.classify) {
    return runClassify(args, yt, channel, rawTargetItems, onListCall);
  }
  if (args.weekly) {
    const weeklyExitCode = await runWeekly(args, yt, channel, targetPlaylistId, targetPlaylist, rawTargetItems, counters, onListCall);
    // BB/BD (2026-08-28): Standard-Zaehler-Drift-Check haengt am Wochenlauf,
    // weil der ohnehin regelmaessig laeuft -- Standard-Videos selbst nehmen NIE
    // am Livestream-Kandidatenpfad oben teil. Rein lesend, meldet nur; das
    // Ergebnis wird hier BEWUSST ignoriert und darf den Wochenlauf-Exit-Code
    // nicht veraendern (siehe check-standard-counter.js). BD3: das Ergebnis
    // muss SICHTBAR in livestream-weekly-LAST.txt stehen, nicht nur in einer
    // separaten Datei -- deshalb wird die bereits geschriebene Datei hier
    // angehaengt statt eine zweite, leicht uebersehene Datei zu pflegen.
    try {
      const { runStandardCounterDriftCheck } = require('./check-standard-counter');
      const icPlaylistIdForDrift = process.env.INNER_CIRCLE_PLAYLIST_ID;
      const innerCircleIdsForDrift = icPlaylistIdForDrift
        ? new Set((await listTargetPlaylistRaw(yt, icPlaylistIdForDrift, onListCall)).map(it => it.videoId))
        : new Set();
      const driftResult = await runStandardCounterDriftCheck(yt, channel, innerCircleIdsForDrift, onListCall);
      const lastPath = path.join(path.resolve(args.out), WEEKLY_LAST_RUN_FILE);
      if (driftResult && driftResult.lines && driftResult.lines.length) {
        try {
          fs.appendFileSync(lastPath, driftResult.lines.join('\n') + '\n');
        } catch (e) {
          console.log(`\nKonnte Standard-Zaehler-Ergebnis nicht an ${lastPath} anhaengen: ${e.message}`);
        }
      }
    } catch (e) {
      // BD3: ein Ausfall des Checks selbst ist KEIN stiller Erfolg -- laut ins Log,
      // auch wenn (per Auftrag) der Wochenlauf-Exit-Code unangetastet bleibt.
      console.log(`\n⚠ Standard-Zaehler-Drift-Check fehlgeschlagen (rein lesend, kein Einfluss auf den Wochenlauf-Exit-Code, aber bitte pruefen): ${e.message}`);
      try {
        fs.appendFileSync(path.join(path.resolve(args.out), WEEKLY_LAST_RUN_FILE),
          `\n⚠ STANDARD-ZAEHLER-CHECK: ABGESTUERZT -- ${e.message}  <-- BITTE PRUEFEN\n`);
      } catch (_) { /* Datei nicht schreibbar -- Konsolenzeile oben bleibt die einzige Meldung */ }
    }
    return weeklyExitCode;
  }

  // --- R1: Mitglieder-Ausschluss-Set aus INNER_CIRCLE_PLAYLIST_ID (NUR LESEN). ---
  const icPlaylistId = process.env.INNER_CIRCLE_PLAYLIST_ID;
  let icMemberIds = [];
  if (icPlaylistId) {
    const icRawItems = await listTargetPlaylistRaw(yt, icPlaylistId, onListCall);
    icMemberIds = [...new Set(icRawItems.map(it => it.videoId))];
  } else {
    console.log('\nWARNUNG: INNER_CIRCLE_PLAYLIST_ID nicht gesetzt — Mitglieder-Ausschluss stuetzt sich nur auf fixtures/members-only-exclude.txt.');
  }
  // R2: manuelle, permanente Ausschlussliste (deckt Faelle ausserhalb der IC-Playlist ab).
  const manualExcludeIds = loadMembersExcludeFile(MEMBERS_EXCLUDE_FILE);
  // H3: separate Premieren-Ausschlussliste (belt-and-suspenders zu H4 -- H4 verhindert
  // strukturell, dass Premieren ueberhaupt als Kandidat erkannt werden; diese Liste faengt
  // trotzdem ab, falls sich liveBroadcasts.list mal aendert oder unvollstaendig ist).
  const premieresExcludeIds = loadMembersExcludeFile(PREMIERES_EXCLUDE_FILE);
  const excludeSet = new Set([...icMemberIds, ...manualExcludeIds, ...premieresExcludeIds]);

  console.log(`\n--- R4a: Ausschluss-Set (Mitglieder + Premieren) ---`);
  console.log(`INNER_CIRCLE_PLAYLIST_ID (nur gelesen, nie beschrieben): ${icMemberIds.length} videoIds${icPlaylistId ? ` (${icPlaylistId})` : ''}`);
  console.log(`fixtures/members-only-exclude.txt: ${manualExcludeIds.length} videoIds`);
  console.log(`fixtures/premieres-exclude.txt: ${premieresExcludeIds.length} videoIds`);
  console.log(`Ausschluss-Set gesamt (Union, dedupliziert): ${excludeSet.size} videoIds`);

  console.log(`\n--- R4b: Entfernungs-Kandidaten in Ziel-Playlist (Mitglieder-Videos, die dort NICHT liegen duerfen) ---`);
  const removalCandidates = rawTargetItems.filter(it => excludeSet.has(it.videoId));
  if (removalCandidates.length === 0) {
    console.log('Keine — kein aktueller Playlist-Eintrag steht im Mitglieder-Ausschluss-Set.');
  } else {
    for (const it of removalCandidates) {
      console.log(`  ${it.videoId}  playlistItemId=${it.playlistItemId}  ${it.title}`);
    }
    console.log(`\n--remove-Befehl zum Entfernen (Dry-Run zuerst!):`);
    console.log(`  node src/youtube/sync-livestream-archive.js --remove=${removalCandidates.map(it => it.playlistItemId).join(',')}`);
  }

  // Dedup-Set + E2-Duplikat-Report.
  const targetVideoSet = new Set(rawTargetItems.map(it => it.videoId));
  const byVideo = new Map();
  for (const it of rawTargetItems) {
    if (!byVideo.has(it.videoId)) byVideo.set(it.videoId, []);
    byVideo.get(it.videoId).push(it);
  }
  const dupes = [...byVideo.entries()]
    .filter(([, occ]) => occ.length > 1)
    .map(([videoId, occ]) => ({ videoId, title: occ[0].title, count: occ.length, playlistItemIds: occ.map(o => o.playlistItemId) }))
    .sort((a, b) => b.count - a.count);

  console.log(`Eindeutige videoIds in Ziel-Playlist: ${targetVideoSet.size}`);
  console.log(`\n--- E2: Duplikat-Report (nur Meldung, nichts geloescht) ---`);
  if (dupes.length === 0) {
    console.log('Keine Duplikate gefunden.');
  } else {
    for (const d of dupes) {
      console.log(`  ${d.videoId}  x${d.count}  ${d.title}`);
      console.log(`      playlistItemIds: ${d.playlistItemIds.join(', ')}`);
    }
  }

  // --- K2: Diagnose gegen alte Progress-Datei von build-livestream-playlist.js (NUR Anzeige). ---
  const oldProgressPath = path.resolve('backups', 'livestream-playlist-progress.json');
  const oldProgress = loadJSON(oldProgressPath, null);
  if (oldProgress && Array.isArray(oldProgress.done)) {
    const doneIds = oldProgress.done;
    const inPlaylist = doneIds.filter(id => targetVideoSet.has(id));
    const multi = doneIds.filter(id => (byVideo.get(id) || []).length > 1);
    const missing = doneIds.filter(id => !targetVideoSet.has(id));
    console.log(`\n--- K2: Diagnose gegen backups/livestream-playlist-progress.json (NUR Anzeige, keine Datenquelle) ---`);
    console.log(`done-IDs in alter Progress-Datei:        ${doneIds.length}`);
    console.log(`davon aktuell in Ziel-Playlist:           ${inPlaylist.length}`);
    console.log(`davon MEHRFACH in Ziel-Playlist:          ${multi.length}`);
    console.log(`davon GAR NICHT (mehr) in Ziel-Playlist:  ${missing.length}${missing.length ? ' (werden wie normale Kandidaten behandelt)' : ''}`);
    if (missing.length) console.log(`  fehlende IDs: ${missing.join(', ')}`);
  } else {
    console.log(`\n--- K2: Keine alte Progress-Datei gefunden (${oldProgressPath}) — Diagnose uebersprungen. ---`);
  }

  // --- Quelle der Wahrheit (geteilte Pipeline, siehe detectPastLivestreams). ---
  const detected = await detectPastLivestreams(yt, channel, onListCall);

  // --- Diff. G3: Wochentags-Heuristik (B2) ENTFERNT — Ground Truth (2026-08-11, 45
  // exakte Skool-Meeting-Termine) zeigte: von 176 Kandidaten war nur 1 ein echtes
  // Mitglieder-Meeting; der Rest der vormals 46 hart ausgeschlossenen Mo/Do-
  // Kandidaten war falsch ausgeschlossen. Dieser eine Fall steht jetzt via G1 in
  // fixtures/members-only-exclude.txt (nicht hier -- oeffentliches Repo). Die verbliebenen 45 Termine dienen nur noch
  // als Flag-Signal (G2), nicht mehr als Auto-Ausschluss. ---
  const alreadyInArchive = detected.filter(d => targetVideoSet.has(d.id)).length;
  let missing = detected.filter(d => !targetVideoSet.has(d.id));

  // R1+R2+H3: IC-Playlist + fixtures/members-only-exclude.txt + fixtures/premieres-exclude.txt
  // (getrennt gezaehlt fuers Reporting).
  const icMemberSet = new Set(icMemberIds);
  const manualExcludeSet = new Set(manualExcludeIds);
  const premieresExcludeSet = new Set(premieresExcludeIds);
  const excludedIC = missing.filter(d => icMemberSet.has(d.id));
  const excludedManualOnly = missing.filter(d => manualExcludeSet.has(d.id) && !icMemberSet.has(d.id));
  const excludedPremieresOnly = missing.filter(d => premieresExcludeSet.has(d.id) && !icMemberSet.has(d.id) && !manualExcludeSet.has(d.id));
  console.log(`\n--- R4c: Sync-Kandidaten im Ausschluss-Set (werden NICHT eingefuegt) ---`);
  console.log(`  ueber IC-Playlist: ${excludedIC.length} | ueber members-only-exclude.txt (zusaetzlich): ${excludedManualOnly.length} | ueber premieres-exclude.txt (zusaetzlich): ${excludedPremieresOnly.length}`);
  for (const m of missing.filter(d => excludeSet.has(d.id))) console.log(`  ${m.id}  ${(m.publishedAt || '').slice(0, 10)}  ${m.privacyStatus}  ${m.title}`);
  missing = missing.filter(d => !excludeSet.has(d.id));

  // G3/HTTP-Check: unauthentifizierter playabilityStatus-Check jetzt als ECHTE
  // Ausschluss-Quelle im normalen Sync (nicht mehr nur --scan-members-Diagnose).
  // Faengt Faelle, die weder R1 noch R2 (noch) kennen -- der bestaetigte Einzelfall
  // dazu steht in fixtures/members-only-exclude.txt.
  console.log(`\n--- HTTP-Check (E3): ${missing.length} verbleibende Kandidaten pruefen (unauthentifiziert, kein Quota) ---`);
  const httpExcluded = [];
  const stillCandidates = [];
  let httpChecked = 0;
  for (const m of missing) {
    const gated = await checkMembersGatedHttp(m.id);
    httpChecked++;
    if (gated === true) { httpExcluded.push(m); console.log(`  [GATED] ${m.id}  ${(m.publishedAt || '').slice(0, 10)}  ${m.title}`); }
    else stillCandidates.push(m);
    if (httpChecked % 25 === 0) console.log(`  ... ${httpChecked}/${missing.length} geprueft`);
    await sleep(150);
  }
  console.log(`HTTP-Check: ${httpChecked} geprueft, ${httpExcluded.length} als Mitglieder-gesperrt ausgeschlossen.`);
  missing = stillCandidates;

  // G2: Ground-Truth-Meeting-Termine als FLAG (kein Automatismus) — Kandidaten, deren
  // actualStartTime (Berlin) auf einen exakten Meeting-Tag UND >=19:00 faellt, bleiben
  // im Kandidaten-Set, werden aber separat zur manuellen Pruefung gemeldet.
  const meetingDates = loadMemberMeetingDates(MEMBER_MEETING_DATES_FILE);
  const flagged = [];
  for (const m of missing) {
    const parts = berlinDateParts(m.liveStreamingDetails && m.liveStreamingDetails.actualStartTime);
    if (!parts) continue;
    const hour = Number(parts.time.split(':')[0]);
    if (meetingDates.has(parts.date) && hour >= MEMBER_MEETING_FLAG_MIN_HOUR) {
      flagged.push({ ...m, berlinDate: parts.date, berlinTime: parts.time, series: meetingDates.get(parts.date) });
    }
  }
  console.log(`\n--- G2: zur manuellen Pruefung geflaggt (bleiben im Kandidaten-Set!) ---`);
  if (flagged.length === 0) {
    console.log('Keine.');
  } else {
    for (const f of flagged) console.log(`  [FLAG] ${f.berlinDate} ${f.berlinTime}  (${f.series})  ${f.id}  ${f.title}`);
  }

  if (Number.isFinite(args.limit)) missing = missing.slice(0, args.limit);
  console.log(`\nFehlend (werden ergaenzt): ${missing.length}${flagged.length ? ` (davon ${flagged.length} geflaggt, siehe G2 oben)` : ''}`);
  for (const m of missing) {
    console.log(`  [ADD] ${m.id}  ${(m.publishedAt || '').slice(0, 10)}  ${m.privacyStatus.padEnd(9)}  ${(m.title || '').slice(0, 60)}`);
  }

  console.log(`\n--- G3: Zusammenfassung ---`);
  console.log(`Gesamt geprueft:                ${detected.totalChecked}`);
  console.log(`Erkannt (Livestreams):          ${detected.length}`);
  console.log(`Bereits in Archiv-Playlist:     ${alreadyInArchive}`);
  console.log(`Ausgeschlossen — IC-Playlist:   ${excludedIC.length}`);
  console.log(`Ausgeschlossen — members-only-exclude.txt: ${excludedManualOnly.length}`);
  console.log(`Ausgeschlossen — premieres-exclude.txt: ${excludedPremieresOnly.length}`);
  console.log(`Ausgeschlossen — HTTP-Check:    ${httpExcluded.length}`);
  console.log(`Zur Pruefung geflaggt (G2):     ${flagged.length} (bleiben in "verbleibend")`);
  console.log(`Verbleibend:                    ${missing.length}`);

  // --- CSV (F2-Schema, einheitlich in Dry-Run und Execute). ---
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `livestream-archive-sync-${stamp}.csv`);
  let csv = csvRow(CSV_HEADER);

  const estListQuota = counters.listCalls * COST_LIST;
  const estInsertQuota = missing.length * COST_INSERT;
  console.log(`\nQuota-Schaetzung: list-Calls ~${estListQuota} (${counters.listCalls}x${COST_LIST}) + Inserts ~${estInsertQuota} (${missing.length}x${COST_INSERT}) = ~${estListQuota + estInsertQuota} Einheiten (Budget: ${QUOTA_BUDGET}).`);

  if (!args.execute) {
    for (const m of missing) csv += csvRow([m.id, m.title, m.publishedAt, m.privacyStatus, 'WOULD_INSERT', '']);
    fs.writeFileSync(csvPath, csv);
    console.log(`\nCSV (Dry-Run-Vorschau): ${csvPath}`);
    console.log('\nDRY-RUN — es wurde KEIN playlistItems.insert aufgerufen.');
    console.log('Echter Lauf: --execute  (danach Bestaetigung "AUSFUEHREN" tippen).');
    console.log('INSERTED: 0');
    return;
  }

  // --- EXECUTE-Pfad ---
  if (missing.length === 0) {
    fs.writeFileSync(csvPath, csv);
    console.log(`\nCSV: ${csvPath}`);
    console.log('\nNichts zu ergaenzen (0 fehlend).');
    console.log('INSERTED: 0');
    return;
  }
  if (!args.yes) {
    const ans = await ask(`\nWirklich ${missing.length} Video(s) zur Playlist "${targetPlaylist.snippet.title}" hinzufuegen? Tippe "AUSFUEHREN": `);
    if (ans.trim() !== 'AUSFUEHREN') {
      fs.writeFileSync(csvPath, csv);
      console.log('Abgebrochen — keine Bestaetigung.');
      console.log('INSERTED: 0');
      return;
    }
  }

  const progressPath = path.join(outDir, 'livestream-archive-sync-progress.json');
  const progress = loadJSON(progressPath, { done: [] });
  const doneSet = new Set(progress.done || []);
  const persistProgress = () => fs.writeFileSync(progressPath, JSON.stringify({ done: [...doneSet], updatedAt: new Date().toISOString() }, null, 2));
  const persistCsv = () => fs.writeFileSync(csvPath, csv);
  persistCsv(); // Header sofort schreiben, damit die Datei ab Sekunde 1 existiert.

  let quotaUsed = estListQuota;
  let inserted = 0, skippedAlreadyDone = 0;
  const todo = missing.filter(m => !doneSet.has(m.id));
  skippedAlreadyDone = missing.length - todo.length;
  if (skippedAlreadyDone) console.log(`\nWiederaufnahme: ${skippedAlreadyDone} bereits in diesem Sync erledigt (Resume-State), ${todo.length} offen.`);

  for (const m of todo) {
    if (quotaUsed + COST_INSERT > QUOTA_BUDGET) {
      console.log(`\nQuota-Budget (${QUOTA_BUDGET}) erreicht — sauberer Stopp. Rest morgen weiterlaufen lassen (erneut --execute, erledigte werden uebersprungen).`);
      break;
    }
    try {
      const res = await withRetry(() => yt.playlistItems.insert({
        part: ['snippet'],
        requestBody: { snippet: { playlistId: targetPlaylistId, resourceId: { kind: 'youtube#video', videoId: m.id } } },
      }));
      quotaUsed += COST_INSERT;
      inserted++;
      doneSet.add(m.id);
      targetVideoSet.add(m.id); // K1-Diff bleibt innerhalb dieses Laufs konsistent.
      // K3: CSV-Zeile + Resume-State sofort NACH jedem einzelnen Insert persistieren.
      csv += csvRow([m.id, m.title, m.publishedAt, m.privacyStatus, 'INSERTED', res.data.id]);
      persistCsv();
      persistProgress();
      console.log(`  OK ${m.id} -> playlistItemId=${res.data.id} (${inserted}/${todo.length})`);
    } catch (e) {
      if (e.quota) {
        console.error(`  QUOTA erschoepft bei ${m.id}: ${e.message} — sauberer Abbruch. Wiederaufnahme: erneut --execute.`);
        break;
      }
      console.error(`  FEHLER ${m.id}: ${e.message} — uebersprungen (naechster Lauf versucht es erneut, da noch nicht im Resume-State).`);
    }
    if (args.delay) await sleep(args.delay);
  }

  console.log(`\nFertig. INSERTED: ${inserted} | uebersprungen (bereits erledigt): ${skippedAlreadyDone} | Quota verbraucht: ~${quotaUsed}/${QUOTA_BUDGET}`);
  console.log(`Folgelauf noetig: ${inserted < todo.length ? 'JA (Budget/Fehler) — erneut --execute' : 'NEIN'}`);
  console.log(`CSV:   ${csvPath}`);
  console.log(`State: ${progressPath}`);
}

if (require.main === module) {
  // K4: --weekly/--simulate-from geben einen Exit-Code zurueck (0 = sauber,
  // 2 = braucht Aufmerksamkeit). Alle anderen Modi geben undefined zurueck und
  // behalten damit Exit 0. process.exitCode statt process.exit(), damit stdout
  // vollstaendig geflusht wird (die Aufgabenplanung leitet in eine Logdatei um).
  main()
    .then(code => { if (Number.isInteger(code) && code !== 0) process.exitCode = code; })
    .catch(e => {
      const args = parseArgs(process.argv);
      // L3: Auth-Fehler im Klartext hinterlegen -- sonst sieht der Nutzer in der
      // Aufgabenplanung nur einen nackten Fehlercode ohne Grund.
      if (args.weekly && isAuthError(e)) {
        console.error('AUTH ABGELAUFEN — npm run auth noetig.');
        console.error(`Details: ${e.message}`);
        const p = writeAuthFailureLast(path.resolve(args.out), e.message);
        if (p) console.error(`Grund im Klartext: ${p}`);
        console.log('WEEKLY_INSERTED: 0');
        process.exit(1);
      }
      console.error('Livestream-Archiv-Sync fehlgeschlagen:', e.message);
      console.log('INSERTED: 0');
      process.exit(1);
    });
}

module.exports = {
  parseArgs, youtubeAvailable, listUploadIds, listTargetPlaylistRaw, fetchVideoDetails,
  listCompletedBroadcastIds, loadMembersExcludeFile, berlinDateParts, isPreMigrationModoMeeting,
  computeModoCandidates, checkMembersGatedHttp, loadMemberMeetingDates, detectPastLivestreams,
  decideGatedStrict, decideGatedLegacy, extractPlayabilityStatus, fetchWatchPageHtml, buildWeeklyLastText,
  checkMembersGatedHttpDetailed,
  classifyWeeklyCandidate, collectWeeklyCandidates, runWeekly, runWeeklySimulate,
  runAssignEpisode, loadSeriesRegistryFull,
  isAuthError, writeAuthFailureLast,
  WEEKLY_START_DATE_BERLIN, WEEKLY_SCHEDULE, WEEKLY_MIN_HOUR_BERLIN, SERIES_REGISTRY_FILE,
};
