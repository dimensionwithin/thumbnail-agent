'use strict';

// CY Teil C.1: Freigabe-Check vor dem Commit.
//
// Dieses Repo ist OEFFENTLICH (siehe docs/warum-keine-video-ids-im-repo.md). Eine
// ungelistete videoId ist ein Zugriffsschluessel, kein Bezeichner. Geprueft wird
// deshalb jede Datei, die in den Commit soll, gegen:
//   1. videoIds nicht-oeffentlicher Videos (aus den Messdaten und der .env)
//   2. absolute Pfade dieses Rechners
//   3. Playlist- und Kanal-IDs
//   4. Tokens und Geheimnisse
//   5. .env-Schluessel, die als Vorgabewert im Quelltext stehen
//
// Vor jeder Pruefung laeuft eine Selbstpruefung (selbstpruefung()): jede Pruefart
// muss ihren erfundenen Vertreter melden und darf auf keine Negativkontrolle
// anschlagen. Faellt sie durch, bricht der Check mit Exit 2 ab und prueft gar
// nichts -- ein Check, der stillschweigend blind ist, ist schlimmer als keiner.
// Dazu gehoeren seit DFa (2026-08-31) die Binaerproben (beide Richtungen der
// NUL-Byte-Heuristik) und die Kataloghygiene (im Vertreterkatalog darf nichts
// Echtes stehen -- er ist der einzige Ort im Repo, den die Muster nicht sehen).
//
// Binaerdateien (NUL-Byte im Inhalt) sind von der MUSTERPRUEFUNG ausgenommen,
// vom Abgleich gegen die bekannten IDs NICHT. Jeder Lauf nennt, wie viele
// Dateien das betraf.
//
// Aufruf: node scripts/freigabe-check.cjs [--vollbaum]
//   ohne Schalter: der Commit-Kandidat
//                  (git status --porcelain --untracked-files=all) -- das Gate.
//   --vollbaum:    alle getrackten Dateien (git ls-files) -- ein ZUSAETZLICHER
//                  Lauf, kein Ersatz. Was einmal committet ist, sieht der
//                  Porcelain-Lauf nie wieder an.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// DF (2026-08-31): Die Vertreter stehen nicht mehr HIER, sondern in einer
// eigenen, getrackten Datei -- sie wurde vollstaendig geschrieben, BEVOR die
// Pfadmuster unten geaendert wurden. Grund (DE): die alten Vertreter entstanden
// zwei Stunden nach den Mustern und auf deren Wortlaut hin; eine Selbstpruefung,
// deren Vertreter aus dem Muster stammen, beweist nur, dass das Muster findet,
// was sein Autor im Sinn hatte.
const { VERTRETER, NEGATIVKONTROLLEN, BEKANNTE_ID_PROBE, BINAER_PROBEN } = require('./freigabe-vertreter.cjs');
// DPa: fuer wertgenaue Ausnahmen (nurSha256) -- siehe AUSNAHMEN.
const crypto = require('crypto');

const ENV_SCHLUESSEL = [
  'SHORTS_TEST_VIDEO_ID', 'NORMAL_TEST_VIDEO_ID', 'AUDIT_PRIVATE_VIDEO_ID',
  'INNER_CIRCLE_PLAYLIST_ID', 'LIVESTREAM_ARCHIVE_PLAYLIST_ID', 'YOUTUBE_CHANNEL_ID',
  'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'ANTHROPIC_API_KEY',
  'THUMBNAIL_SOURCE_DIR', 'THUMBNAIL_EXPORT_DIR', 'STATE_REPO_DIR',
];

// DF (2026-08-31), Auftrag Punkt 6b: Untergrenze fuer die Abgleichsliste.
// Gemessen am 2026-08-31: 1019 IDs, davon 10 aus .env, 294 aus
// schattenmessung.json, 12 aus short-erkennung-validierung.json und 703 aus
// _cache-videos.json (messung.json steuert 0 eigene bei). Die Messdateien
// liegen unter data/ und sind gitignored -- sie koennen jederzeit fehlen, und
// bis heute lief der Check dann still mit geschrumpfter Liste weiter.
// Die Grenze 900 ist so gewaehlt, dass der Wegfall JEDER der beiden grossen
// Quellen sie reisst (1019-703=316, 1019-294=725) und trotzdem rund 119 IDs
// Luft fuer normales Schrumpfen der ungetrackten Messdaten bleiben.
// BEKANNTE GRENZE, ausdruecklich nicht wegdefiniert: der Wegfall allein von
// short-erkennung-validierung.json (12 IDs) reisst 900 nicht. Deshalb nennt die
// Meldung unten zusaetzlich jede fehlende Quelle beim Namen.
const ID_UNTERGRENZE = 900;

function bekannteIds() {
  const ids = new Set();
  for (const k of ENV_SCHLUESSEL) if (process.env[k]) ids.add(process.env[k]);
  // videoIds aus allen Messdaten dieser Auftragsreihe
  const quellen = [
    'data/gating-repair/schattenmessung.json',
    'data/gating-check-audit/messung.json',
    'data/gating-repair/short-erkennung-validierung.json',
    'data/shorts-thumbnail-api-test/_cache-videos.json',
  ];
  const fehlend = [];
  for (const q of quellen) {
    if (!fs.existsSync(q)) { fehlend.push(q); continue; }
    try {
      const j = JSON.parse(fs.readFileSync(q, 'utf8'));
      const sammle = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(sammle);
        for (const [k, v] of Object.entries(o)) {
          if ((k === 'videoId' || k === 'id') && typeof v === 'string' && v.length === 11) ids.add(v);
          else sammle(v);
        }
      };
      sammle(j);
    } catch (_) { fehlend.push(`${q} (unlesbar)`); }
  }
  return { ids: [...ids].filter(Boolean), fehlend };
}

const MUSTER = [
  // DF (2026-08-31): Erkennung nach FORM statt nach Ordnername. Die drei alten
  // Pfadmuster verlangten hinter dem Laufwerk einen von drei bekannten Ordnern
  // (Users|Dimension|Git). Genau daran waren sie blind: DE hat 24 echte Pfade
  // dieses Rechners in den Uebergabedateien gemessen, die kein einziges der
  // alten Muster sah -- eine Rohablage auf einem Videolaufwerk, das Nachbarrepo,
  // JSON-maskierte Pfade mit doppelten Backslashes. Ein Muster, das eine
  // Ordnerliste pflegen muss, ist morgen wieder blind. (Die Pfade stehen hier
  // bewusst NICHT im Wortlaut: dieser Kommentar liegt ausserhalb des
  // ausgeblendeten Blocks und wuerde sich sonst selbst melden -- gemessen in DF.)
  //
  // Laufwerkspfad: einzelner Buchstabe, kein Wortzeichen davor (sonst schlaegt
  // jedes "https:/" an), Doppelpunkt, ein oder zwei Backslashes ODER ein
  // Schraegstrich, dann mindestens ein Zeichen, das kein Leerzeichen ist.
  { name: 'absoluter Laufwerkspfad', re: /(?<!\w)[A-Za-z]:(?:\\{1,2}|\/)\S+/g },
  // UNC: nicht weggelassen, sondern VERENGT. Ein breites \\<irgendwas> hat in
  // DE 16 Falschtreffer erzeugt -- jeder doppelt escapte Backslash aus einem
  // JavaScript- oder Python-Regex (\\b, \\s+, \\d, \\$&) sah aus wie ein
  // Pfadanfang. Verlangt werden deshalb: zwei Backslashes, ein Rechnername von
  // MINDESTENS ZWEI Zeichen, ein Trenner, ein Freigabename. \\b und \\d haben
  // nur ein Zeichen, \\s+ und \\$& scheitern am zweiten. Der Trenner darf
  // doppelt sein, damit auch der JSON-maskierte UNC-Pfad erkannt wird.
  { name: 'UNC-Pfad', re: /(?<!\w)\\{2}[A-Za-z0-9_.-]{2,}[\\/]{1,2}[A-Za-z0-9_.-]+/g },
  // Ebenso ohne abschliessenden Schraegstrich: ein Heimatordner unter /home
  // oder /Users ist bereits ein absoluter Pfad, auch wenn nichts dahinter steht.
  // Inhaltlich unveraendert; neu ist nur, dass er jetzt auch gegen eine
  // Negativkontrolle steht.
  { name: 'absoluter Unix-Heimpfad', re: /\/(?:home|Users)\/[A-Za-z0-9_.-]+/g },
  // Echte Playlist-/Kanal-IDs enthalten Klein- UND Grossbuchstaben. Ein reiner
  // Grossbuchstaben-Bezeichner wie PLAYLIST_SIZE_WARN ist ein Konstantenname und
  // kein Geheimnis -- ohne diese Bedingung meldet der Check ihn als Fund und
  // verliert an Glaubwuerdigkeit.
  { name: 'Playlist-ID', re: /\bPL(?![A-Z0-9_]+\b)[A-Za-z0-9_-]{16,}\b/g },
  { name: 'Kanal-ID', re: /\bUC(?![A-Z0-9_]+\b)[A-Za-z0-9_-]{22}\b/g },
  { name: 'OAuth-Zugriffstoken', re: /\bya29\.[A-Za-z0-9_-]{20,}/g },
  { name: 'Google-Client-Secret', re: /\bGOCSPX-[A-Za-z0-9_-]{10,}/g },
  { name: 'Anthropic-Schluessel', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'Client-ID', re: /\b\d{10,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com\b/g },
];

// Die beiden Sonderpruefarten -- sie stehen nicht in MUSTER, unterliegen aber
// derselben Beweislast (Punkt 5: Vertreter UND Negativkontrolle).
const SONDERPRUEFARTEN = ['.env-Vorgabewert', 'bekannte ID'];
const ALLE_PRUEFARTEN = [...MUSTER.map((m) => m.name), ...SONDERPRUEFARTEN];

// DF (2026-08-31), Auftrag Punkt 3: Base64-Nutzlast ueberspringen.
// DE hat in thumbnail-compositor.html Fehlalarme gefunden, die mitten in
// data:font/woff2;base64,… und data:image/png;base64,… lagen: Zufallsfolgen aus
// dem Base64-Alphabet, die zufaellig mit PL beginnen. Uebersprungen wird NUR die
// Nutzlast, das Praefix bleibt stehen -- und die Zeichenklasse enthaelt KEIN
// Leerzeichen, damit der Ersatz nicht ueber das Ende der URI hinaus in echten
// Text laeuft. Ein Klartextpfad unmittelbar neben einer data:-URI muss weiter
// gefunden werden; genau dafuer steht ein eigener Vertreter im Katalog.
const BASE64_NUTZLAST = /(data:[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+;base64,)[A-Za-z0-9+/=]+/g;
function ohneBase64Nutzlast(text) {
  return text.replace(BASE64_NUTZLAST, '$1');
}

// DF (2026-08-31), Auftrag Punkt 4: Ausnahmen -- benannt, begruendet,
// dateibezogen. Keine Ausnahme wirkt allgemein; jede haengt an genau einer
// Datei und an namentlich genannten Pruefarten. Gegen den Abgleich mit den
// bekannten IDs gibt es KEINE Ausnahme (pruefAusnahmen() erzwingt das) -- dort
// darf sich auch in einer Ausnahmedatei nichts Echtes verstecken.
// Die Liste ist Teil der Selbstpruefung: eine Ausnahme, deren Datei es nicht
// mehr gibt, und eine Ausnahme auf einen Pruefartnamen, den es nicht gibt,
// brechen den Check ab -- eine tote Ausnahme ist ein Loch, von dem niemand weiss.
const AUSNAHMEN = [
  {
    datei: 'tests/test_thumbnail_service.py',
    muster: ['absoluter Laufwerkspfad'],
    grund:
      'Sieben Windows-Systempfade als Testkonstanten (Systemordner, Python-Ordner ' +
      'und ein bewusst fremder Ordner). Sie sind Eingabedaten der Dienst-Tests, ' +
      'keine Pfade DIESES Rechners: DE hat alle sieben Stellen einzeln eingeordnet ' +
      'und keinen echten Pfad darunter gefunden.',
  },
  {
    // DFa (2026-08-31), Auftrag Punkt 4 -- Befund C aus DF. Bewusst ein
    // ZWEITER Eintrag fuer dieselbe Datei statt eines Anhaengsels am ersten:
    // so bleibt jede Begruendung an genau der Pruefart haengen, die sie deckt.
    // ausnahmenFuer() vereinigt beide Eintraege ohnehin.
    datei: 'tests/test_thumbnail_service.py',
    muster: ['.env-Vorgabewert'],
    grund:
      'Eingabedaten des .env-Parser-Tests. Der Test schreibt sich eine .env-Datei ' +
      'aus Zeilen wie THUMBNAIL_SOURCE_DIR=... und prueft, was der Parser daraus ' +
      'macht -- ohne diese Zeilen im Test gaebe es nichts zu parsen. Betroffen sind ' +
      'nur THUMBNAIL_SOURCE_DIR und THUMBNAIL_EXPORT_DIR, und die Werte sind ' +
      'Platzhalter ("ordner-quelle", "ordner-ziel", "ordner mit leerzeichen"), ' +
      'keine Ordner dieses Rechners. Die Ausnahme gilt AUSSCHLIESSLICH fuer die ' +
      'Pruefart ".env-Vorgabewert": die Pfadmuster und der ID-Abgleich laufen ueber ' +
      'diese Datei unveraendert weiter.',
  },
  {
    // DPa (2026-09-02), Auftrag Punkt 2. Der Mitgliedschafts-Link in Joshuas
    // Videobeschreibung.
    //
    // WAS HIER AUSGENOMMEN WIRD UND WAS NICHT. Ausgenommen ist die Pruefart
    // "Kanal-ID" -- und auch die nur fuer GENAU EINEN Wert, naemlich den, dessen
    // sha256 unten steht. Jede andere Kanal-ID in derselben Datei wird
    // weiterhin gemeldet; der Abgleich gegen die bekannten IDs laeuft ueber
    // diese Datei unveraendert weiter und ist ohnehin nicht ausnehmbar
    // (pruefAusnahmen erzwingt das seit DF).
    //
    // WARUM UEBERHAUPT. Die Datei ist die Videobeschreibung, die unter JEDEM
    // Short steht. Darin ist ein Link zur Kanalmitgliedschaft, und der hat bei
    // YouTube die Form youtube.com/channel/<ID>/join -- die Kanal-ID ist Teil
    // der Adresse. Sie steht damit absichtlich unter jedem Video und ist aus
    // jeder Kanal-URL ablesbar; sie ist keine Kennung, die irgendetwas
    // aufschliesst. Der Check kann einer Kanal-ID nicht ansehen, ob sie
    // versehentlich im Quelltext gelandet ist oder absichtlich veroeffentlicht
    // wird -- deshalb entscheidet das hier ein Mensch, einmal, benannt.
    //
    // WARUM DIE PRUEFSUMME UND NICHT DER WERT. Stuende die ID hier im Wortlaut,
    // meldete der Check beim naechsten Lauf sich selbst -- fuer
    // scripts/freigabe-check.cjs gibt es keine Kanal-ID-Ausnahme, und in den
    // Vertreterkatalog gehoert sie nicht: katalogHygiene() prueft dort auf
    // echte IDs. Die Pruefsumme bindet die Ausnahme genauso genau an einen
    // Wert, ohne ihn zu nennen.
    //
    // WENN JOSHUA DEN LINK AENDERT, greift die Ausnahme nicht mehr und der
    // Check meldet. Das ist Absicht: eine neue ID ist eine neue Entscheidung.
    datei: 'config/beschreibung.txt',
    muster: ['Kanal-ID'],
    nurSha256: ['0072c49e0bd6c0d316273e8c65a0e0ad845920a89afccf02791e86b457c2af16'],
    grund:
      'Der Mitgliedschafts-Link der Videobeschreibung. YouTube adressiert die ' +
      'Kanalmitgliedschaft als youtube.com/channel/<Kanal-ID>/join; die Kanal-ID ' +
      'ist Teil dieser Adresse und steht damit absichtlich unter jedem Short. Sie ' +
      'ist aus jeder Kanal-URL ablesbar und schliesst nichts auf. Die Ausnahme gilt ' +
      'AUSSCHLIESSLICH fuer die Pruefart "Kanal-ID" und darin nur fuer den einen ' +
      'Wert mit der oben genannten Pruefsumme: jede andere Kanal-ID in dieser Datei ' +
      'wird gemeldet, und der Abgleich gegen die bekannten IDs laeuft unveraendert ' +
      'weiter.',
  },
  {
    datei: 'scripts/freigabe-vertreter.cjs',
    muster: [
      'absoluter Laufwerkspfad', 'UNC-Pfad', 'absoluter Unix-Heimpfad',
      'Playlist-ID', 'Kanal-ID', 'OAuth-Zugriffstoken', 'Google-Client-Secret',
      'Anthropic-Schluessel', 'Client-ID', '.env-Vorgabewert',
    ],
    grund:
      'Der Vertreterkatalog selbst. Er enthaelt zu JEDER Pruefart einen erfundenen ' +
      'Vertreter und wird deshalb zwangslaeufig vom eigenen Muster gefunden -- das ' +
      'ist der Beweis, dass die Muster sehen, nicht ein Befund. Alle Werte dort sind ' +
      'erfunden; der Abgleich gegen die bekannten IDs laeuft auch ueber diese Datei ' +
      'weiter und ist NICHT ausgenommen.',
  },
];

function ausnahmenFuer(datei) {
  const norm = datei.split('\\').join('/');
  return AUSNAHMEN.filter((a) => norm === a.datei || norm.endsWith('/' + a.datei));
}

// DPa: Greift eine der Ausnahmen dieser Datei auf diesen Fund?
//
// OHNE nurSha256 gilt wie bisher: der Pruefartname genuegt, der ganze Fund ist
// unterdrueckt. MIT nurSha256 muss JEDER gefundene Wert in der erlaubten Liste
// stehen -- ein einziger fremder Wert laesst den ganzen Fund stehen. Das ist
// die Richtung, in der man sich nicht irren darf: lieber ein Fund zu viel als
// eine Ausnahme, die einen unbekannten Wert mit durchtraegt.
function istAusgenommen(fund, eintraege) {
  const passend = eintraege.filter((a) => a.muster.includes(fund.muster));
  if (!passend.length) return false;
  // Ein Eintrag ohne Wertbindung nimmt die Pruefart ganz aus (Bauart aus DF).
  if (passend.some((a) => !a.nurSha256)) return true;
  const erlaubt = new Set(passend.flatMap((a) => a.nurSha256));
  // Ein Fund ohne Werte laesst sich nicht wertgenau pruefen -- dann wird NICHT
  // unterdrueckt. Sonst waere eine Wertbindung auf einer Pruefart ohne Werte
  // eine Ausnahme, die alles durchlaesst, ohne dass man es sieht.
  if (!Array.isArray(fund.werte) || !fund.werte.length) return false;
  return fund.werte.every((w) =>
    erlaubt.has(crypto.createHash('sha256').update(String(w), 'utf8').digest('hex')));
}

// DFa (2026-08-31), Auftrag Punkt 1: Binaerdateien von der MUSTERPRUEFUNG
// ausnehmen. In DF meldete der Vollbaumlauf 19 PNG-Dateien mit zusammen 85
// Rohtreffern auf "absoluter Laufwerkspfad" -- Zufallsfolgen aus komprimierten
// Bilddaten, in denen irgendwo ein Buchstabe, ein Doppelpunkt und ein
// Schraegstrich nebeneinanderfielen. Kein einziger echter Pfad darunter. Ein
// Check, dessen Fundliste zu 19 von 22 Zeilen aus Bildrauschen besteht, wird
// ueberblaettert -- und dann faellt der eine echte Fund mit durch.
//
// Die Heuristik ist bewusst die einfachste, die es gibt: ein NUL-Byte im
// Inhalt. Textdateien enthalten keines, Bild-, Archiv- und Schriftdateien
// praktisch immer eines. Gemessen am 2026-08-31 ueber alle 89 getrackten
// Dateien: genau die 20 PNGs werden so eingestuft, keine einzige der 69
// Textdateien.
//
// WAS DIE HEURISTIK NICHT ANFASST: den Abgleich gegen die bekannten IDs. Der
// laeuft weiter ueber den vollen, unveraenderten Inhalt JEDER Datei -- auch
// ueber die binaeren. Eine videoId in einer PNG-Datei ist genauso ein
// Zugriffsschluessel wie eine im Quelltext. Beide Richtungen stehen als
// BINAER_PROBEN im Katalog und werden vor jedem Lauf nachgemessen.
function istBinaer(inhalt) {
  return inhalt.includes('\u0000');
}

// Der Pruefkern. Selbstpruefung und echter Lauf gehen durch GENAU diese
// Funktion -- eine Selbstpruefung, die ihren eigenen Code prueft statt den
// benutzten, belegt nichts. Das gilt seit DFa auch fuer die Binaerheuristik:
// sie steht HIER drin und nicht in der Dateischleife, damit die Binaerproben
// des Katalogs denselben Weg nehmen wie eine echte PNG-Datei.
function pruefeInhalt(inhalt, ids) {
  const funde = [];
  // Der Abgleich gegen bekannte IDs laeuft ueber den UNVERAENDERTEN Text --
  // eine ID, die in einer Base64-Nutzlast steht, ist trotzdem eine ID.
  for (const id of ids) {
    if (inhalt.includes(id)) funde.push({ muster: "bekannte ID", text: `ID/Geheimnis aus .env oder Messdaten (${id.slice(0, 4)}…)` });
  }
  if (istBinaer(inhalt)) return funde;
  const text = ohneBase64Nutzlast(inhalt);
  for (const m of MUSTER) {
    const g = text.match(m.re);
    // DFa (2026-08-31), Auftrag Punkt 2: die Anzahl bleibt vollstaendig
    // sichtbar. Vorher schnitt ein blosses slice(0,3) die Liste ab, ohne zu
    // sagen, dass sie abgeschnitten ist -- in DE sind so vier Base64-
    // Fehlalarme als drei in den Bericht gewandert. Gezeigt werden weiter
    // hoechstens drei Werte, aber der Rest wird gezaehlt und genannt.
    if (g) {
      const eindeutig = [...new Set(g)];
      const gezeigt = eindeutig.slice(0, 3);
      const rest = eindeutig.length - gezeigt.length;
      funde.push({
        muster: m.name,
        // DPa: die gefundenen Werte gehen MIT. Ohne sie kann eine Ausnahme nur
        // pauschal nach Pruefartnamen unterdruecken -- also alles, was dieses
        // Muster in dieser Datei je findet. Mit ihnen laesst sich eine Ausnahme
        // an genau einen Wert binden (nurSha256).
        werte: eindeutig,
        text: `${m.name}: ${gezeigt.join(", ")}${rest > 0 ? ` und ${rest} weitere` : ''}`,
      });
    }
  }
  // .env-Schluessel duerfen GELESEN werden (process.env.X), aber nicht als
  // Vorgabewert dastehen: X = "irgendwas".
  for (const k of ENV_SCHLUESSEL) {
    // DA (2026-08-29): Ein LEERES Literal ist kein Vorgabewert, sondern das
    // Gegenteil -- es macht den Schluessel im Kindprozess unsichtbar (siehe
    // scripts/verify-publish.cjs). Gemeldet wird deshalb nur noch ein Literal
    // MIT Inhalt: auf das oeffnende Anfuehrungszeichen muss ein anderes
    // Zeichen als das schliessende folgen.
    const re = new RegExp(`${k}\\s*[:=]\\s*('[^']|"[^"]|\`[^\`])`, "g");
    if (re.test(text)) funde.push({ muster: ".env-Vorgabewert", text: `.env-Schluessel ${k} mit Vorgabewert im Quelltext` });
  }
  return funde;
}

// DB (2026-08-29): Selbstpruefung. Ein Freigabe-Check, der stillschweigend
// blind ist, ist schlimmer als keiner -- dreimal in dieser Reihe hat er sauber
// gemeldet und dabei nicht hingesehen (.trim() in CX, leeres Literal in DA,
// die Wortgrenze in DB). Vor jeder Pruefung laeuft deshalb jede Pruefart gegen
// einen eigenen Vertreter.
//
// DFa (2026-08-31), Auftrag Punkt 6: die Markierung SELBSTPRUEFUNG-VERTRETER
// und ohneVertreterBlock() sind ERSATZLOS ENTFALLEN. Sie stammten aus der Zeit,
// als die Vertreter in DIESER Datei standen und der Check beim Lauf ueber sich
// selbst seine eigene Tabelle gemeldet haette. Seit DF liegen sie im Katalog
// nebenan, und der hat eine benannte, begruendete Ausnahme. Gemessen vor dem
// Rueckbau: dieselbe Datei einmal mit und einmal ohne Ausblendung durch
// dieselben neun Muster geschickt -- beide Male null Fundzeilen. Die Markierung
// umschloss zuletzt nur noch acht Kommentarzeilen und ein require.
// Zwei Mechaniken zum Unterdruecken von Treffern waren eine zu viel: es bleibt
// der AUSNAHMEN-Block, benannt und begruendet und selbst mitgeprueft.
const EIGENE_DATEI = 'scripts/freigabe-check.cjs';

// DF (2026-08-31), Auftrag Punkt 5: die META-Pruefung.
// Bis heute erzwang die Selbstpruefung nur, dass jedes MUSTER einen Vertreter
// hat -- Negativkontrollen gab es fuenf fuer neun Muster, ohne jede Zuordnung.
// Ein neues Muster konnte also ohne Gegenrichtung hinzukommen und beliebig
// breit sein, ohne dass es auffiel. Neu: JEDE Pruefart braucht beides. Fehlt
// eines, bricht der Check ab, bevor er irgendeine Datei ansieht.
function metaPruefung() {
  const fehler = [];
  for (const name of ALLE_PRUEFARTEN) {
    const vs = VERTRETER[name];
    const ns = NEGATIVKONTROLLEN[name];
    if (!Array.isArray(vs) || !vs.length) fehler.push(`Pruefart "${name}" hat keinen Vertreter im Katalog`);
    if (!Array.isArray(ns) || !ns.length) fehler.push(`Pruefart "${name}" hat keine Negativkontrolle im Katalog`);
  }
  // Ein Katalogeintrag auf einen Namen, den es nicht gibt, ist ein Tippfehler
  // mit Folgen: der Vertreter laeuft ins Leere und die Deckung sinkt lautlos.
  for (const quelle of [['VERTRETER', VERTRETER], ['NEGATIVKONTROLLEN', NEGATIVKONTROLLEN]]) {
    for (const name of Object.keys(quelle[1])) {
      if (!ALLE_PRUEFARTEN.includes(name)) fehler.push(`${quelle[0]}["${name}"] gehoert zu keiner Pruefart`);
    }
  }
  // DFa, Punkt 1b: dieselbe Buchfuehrung fuer die Binaerproben. Eine Probe, die
  // eine Pruefart nennt, die es nicht gibt, laeuft ins Leere -- und eine leere
  // Probe beweist gar nichts.
  for (const p of BINAER_PROBEN) {
    if (!p.wert) fehler.push(`BINAER_PROBEN["${p.name}"] hat keinen Wert`);
    if (!p.meldet.length && !p.meldetNicht.length) fehler.push(`BINAER_PROBEN["${p.name}"] behauptet in keine Richtung etwas`);
    for (const m of [...p.meldet, ...p.meldetNicht]) {
      if (!ALLE_PRUEFARTEN.includes(m)) fehler.push(`BINAER_PROBEN["${p.name}"] nennt die unbekannte Pruefart "${m}"`);
    }
  }
  return fehler;
}

// DFa (2026-08-31), Auftrag Punkt 5: der blinde Fleck des Katalogs.
//
// scripts/freigabe-vertreter.cjs ist von neun Mustern und vom .env-Vorgabewert
// ausgenommen -- notwendig, denn der Katalog enthaelt zu jeder Pruefart einen
// Vertreter, der genau wie das aussieht, was er fangen soll. Der Preis dafuer:
// landet dort versehentlich etwas ECHTES -- ein Pfad dieses Rechners, ein Wert
// aus der .env --, meldet es nie jemand. Die Ausnahme, die den Katalog moeglich
// macht, macht ihn zugleich zum einzigen Ort im Repo, an dem sich ein Geheimnis
// unbemerkt halten kann.
//
// Diese Pruefung schliesst das Loch. Sie laeuft VOR jeder Dateipruefung und
// bricht mit Exit 2 ab.
//
// KEINE ECHTEN PFADE IM QUELLTEXT. Die Vergleichswerte werden zur Laufzeit
// hergeleitet, nicht hier hingeschrieben -- ein Check, der die zu schuetzenden
// Pfade im Klartext enthaelt, meldet sich sonst selbst:
//   .env-Werte      aus process.env ueber ENV_SCHLUESSEL,
//   echte Pfade     aus process.cwd() (dieses Repo) und den unmittelbaren
//                   Unterordnern seines Elternverzeichnisses. Die beiden
//                   Nachbarrepos liegen dort; ihre Namen stehen nirgends im
//                   Quelltext, es wird auch in keines hineingesehen -- nur die
//                   Ordnernamen der Ebene darueber werden gelesen.
// BEKANNTE GRENZE, ausdruecklich nicht wegdefiniert: erfasst wird die
// Laufwerksebene DIESES Repos. Ein echter Ordner auf einem anderen Laufwerk
// faellt nicht darunter.
function pfadNorm(s) {
  return s.split('/').join('\\').replace(/\\{2,}/g, '\\').toLowerCase();
}

// Ein Pfad gilt als enthalten, wenn er als VOLLSTAENDIGES Segment vorkommt:
// direkt dahinter muss ein Trenner oder das Ende der Zeichenkette stehen. Ohne
// diese Bedingung wuerde ein Nachbarordner mit einbuchstabigem Namen jeden
// erfundenen Pfad treffen, der zufaellig mit demselben Buchstaben weitergeht.
function enthaeltPfad(wert, pfad) {
  const w = pfadNorm(wert);
  const p = pfadNorm(pfad);
  for (let i = w.indexOf(p); i !== -1; i = w.indexOf(p, i + 1)) {
    const danach = w[i + p.length];
    if (danach === undefined || danach === '\\') return true;
  }
  return false;
}

function katalogHygiene() {
  const fehler = [];
  const werte = [
    ...Object.entries(VERTRETER).flatMap(([n, l]) => l.map((w) => [`VERTRETER["${n}"]`, w])),
    ...Object.entries(NEGATIVKONTROLLEN).flatMap(([n, l]) => l.map((w) => [`NEGATIVKONTROLLEN["${n}"]`, w])),
    ...BINAER_PROBEN.map((p) => [`BINAER_PROBEN["${p.name}"]`, p.wert]),
    ['BEKANNTE_ID_PROBE', BEKANNTE_ID_PROBE],
  ];

  // 1. Kein Wert aus der .env.
  for (const k of ENV_SCHLUESSEL) {
    const v = process.env[k];
    if (!v) continue;
    for (const [ort, w] of werte) {
      if (w.includes(v)) fehler.push(`${ort} enthaelt den Wert von ${k} aus der .env`);
    }
  }

  // 2. Kein tatsaechlicher Pfad dieses Rechners.
  const echtePfade = [process.cwd()];
  const eltern = path.dirname(process.cwd());
  if (eltern && eltern !== process.cwd()) {
    try {
      for (const e of fs.readdirSync(eltern, { withFileTypes: true })) {
        if (e.isDirectory()) echtePfade.push(path.join(eltern, e.name));
      }
    } catch (e) {
      // Auch hier gilt: lieber laut abbrechen als leise weniger pruefen.
      fehler.push(`Das Elternverzeichnis dieses Repos ist nicht lesbar (${e.code}) -- die Pfadhygiene des Katalogs kann nicht geprueft werden`);
    }
  }
  for (const [ort, w] of werte) {
    for (const p of echtePfade) {
      if (enthaeltPfad(w, p)) { fehler.push(`${ort} enthaelt einen tatsaechlichen Pfad dieses Rechners`); break; }
    }
  }

  // Absichtlich wird NUR die Fundstelle genannt, nie der Wert: die Meldung
  // geht auf die Konsole, und ein echter Pfad oder ein echtes Geheimnis
  // gehoert auch dorthin nicht. Wer die Stelle kennt, sieht sie im Katalog.
  return fehler;
}

// Auftrag Punkt 4, zweiter Teil: die Ausnahmeliste prueft sich mit.
function pruefAusnahmen() {
  const fehler = [];
  for (const a of AUSNAHMEN) {
    if (!fs.existsSync(a.datei)) fehler.push(`Ausnahme fuer "${a.datei}" zeigt auf eine Datei, die es nicht gibt`);
    if (!a.grund || !a.grund.trim()) fehler.push(`Ausnahme fuer "${a.datei}" hat keine Begruendung`);
    for (const m of a.muster) {
      if (m === 'bekannte ID') fehler.push(`Ausnahme fuer "${a.datei}" nimmt den Abgleich gegen bekannte IDs aus -- das ist nicht zulaessig`);
      else if (!ALLE_PRUEFARTEN.includes(m)) fehler.push(`Ausnahme fuer "${a.datei}" nennt die unbekannte Pruefart "${m}"`);
    }
    // DPa: die Wertbindung prueft sich mit.
    if (a.nurSha256 !== undefined) {
      if (!Array.isArray(a.nurSha256) || !a.nurSha256.length) {
        fehler.push(`Ausnahme fuer "${a.datei}": nurSha256 ist keine nicht-leere Liste`);
      } else {
        for (const h of a.nurSha256) {
          if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) {
            fehler.push(`Ausnahme fuer "${a.datei}": nurSha256 enthaelt keine sha256-Summe`);
          }
        }
      }
      // Eine Wertbindung auf einer Pruefart, die keine Werte liefert, waere
      // eine Ausnahme, die nie greift -- eine tote Ausnahme, also ein Loch,
      // von dem niemand weiss (dieselbe Haltung wie bei der toten Datei).
      for (const m of a.muster) {
        if (!MUSTER.some((x) => x.name === m)) {
          fehler.push(`Ausnahme fuer "${a.datei}": nurSha256 auf der Pruefart "${m}", die keine Werte liefert`);
        }
      }
    }
  }
  return fehler;
}

function selbstpruefung() {
  const fehler = [...metaPruefung(), ...pruefAusnahmen(), ...katalogHygiene()];
  // Erst wenn die Buchfuehrung stimmt, hat das Messen Sinn.
  if (!fehler.length) {
    for (const name of ALLE_PRUEFARTEN) {
      // Die Sonderpruefart "bekannte ID" braucht ihren Probewert in der
      // Vergleichsliste -- sonst kann sie gar nicht anschlagen.
      const ids = name === 'bekannte ID' ? [BEKANNTE_ID_PROBE] : [];
      for (const v of VERTRETER[name]) {
        if (!pruefeInhalt(v, ids).some((f) => f.muster === name)) {
          fehler.push(`Pruefart "${name}" meldet ihren eigenen Vertreter nicht: ${v}`);
        }
      }
    }
    // Jede Negativkontrolle steht gegen ALLE Pruefarten, nicht nur gegen die,
    // unter der sie im Katalog eingeordnet ist. Der Probewert liegt dabei in
    // der Vergleichsliste, damit auch der ID-Abgleich seine Gegenrichtung hat.
    for (const [name, liste] of Object.entries(NEGATIVKONTROLLEN)) {
      for (const v of liste) {
        const f = pruefeInhalt(v, [BEKANNTE_ID_PROBE]);
        if (f.length) fehler.push(`Fehlalarm auf Negativkontrolle (${name}) "${v}": ${f.map((x) => x.muster).join(", ")}`);
      }
    }
    // DPa: eine wertgebundene Ausnahme muss ein FENSTER sein, kein Tor. Fuer
    // jede pruefen wir hier, dass ein FREMDER Wert derselben Pruefart NICHT
    // unterdrueckt wird. Ohne diese Probe koennte ein Tippfehler in
    // istAusgenommen die Bindung stillschweigend ausser Kraft setzen, und die
    // Ausnahme naehme dann alles mit.
    for (const a of AUSNAHMEN.filter((x) => x.nurSha256)) {
      for (const m of a.muster) {
        const fremd = { muster: m, werte: ['fremder-wert-den-es-nicht-gibt'], text: 'Probe' };
        if (istAusgenommen(fremd, [a])) {
          fehler.push(`Ausnahme fuer "${a.datei}" unterdrueckt bei "${m}" auch fremde Werte -- sie ist ein Tor, kein Fenster`);
        }
        const gemischt = { muster: m, werte: ['fremder-wert-den-es-nicht-gibt', 'noch-einer'], text: 'Probe' };
        if (istAusgenommen(gemischt, [a])) {
          fehler.push(`Ausnahme fuer "${a.datei}" unterdrueckt bei "${m}" auch gemischte Funde`);
        }
        const ohneWerte = { muster: m, text: 'Probe' };
        if (istAusgenommen(ohneWerte, [a])) {
          fehler.push(`Ausnahme fuer "${a.datei}" unterdrueckt bei "${m}" einen Fund ohne Werte`);
        }
      }
    }
    // DFa, Punkt 1b: die Binaerheuristik in BEIDE Richtungen. Beide Proben
    // laufen durch dieselbe pruefeInhalt(), die auch die Dateien sieht.
    for (const p of BINAER_PROBEN) {
      const gemeldet = new Set(pruefeInhalt(p.wert, [BEKANNTE_ID_PROBE]).map((x) => x.muster));
      for (const m of p.meldet) {
        if (!gemeldet.has(m)) fehler.push(`Binaerprobe "${p.name}" meldet "${m}" nicht, obwohl sie es muss`);
      }
      for (const m of p.meldetNicht) {
        if (gemeldet.has(m)) fehler.push(`Binaerprobe "${p.name}" meldet "${m}", obwohl sie es nicht darf`);
      }
    }
  }
  if (fehler.length) {
    console.error("SELBSTPRUEFUNG FEHLGESCHLAGEN -- es wurde NICHTS geprueft:");
    for (const f of fehler) console.error("  " + f);
    process.exit(2);
  }
  const vz = Object.values(VERTRETER).flat().length;
  const nz = Object.values(NEGATIVKONTROLLEN).flat().length;
  console.log(`Selbstpruefung: ${ALLE_PRUEFARTEN.length} Pruefarten, ${vz} Vertreter, ${nz} Negativkontrollen, ${BINAER_PROBEN.length} Binaerproben, ${AUSNAHMEN.length} Ausnahmen, Kataloghygiene bestanden.`);
}

// Der Commit-Kandidat -- dieser Lauf ist das Gate.
//
// KEIN .trim() auf die Gesamtausgabe: Porcelain-Zeilen beginnen bei
// unstaged-Aenderungen mit einem Leerzeichen (" M pfad"). Ein Trim des ganzen
// Blocks frisst genau dieses Zeichen in der ERSTEN Zeile, und ein danach
// fester slice(3) schneidet den Pfad an -- die Datei faellt dann stillschweigend
// aus der Pruefung. Genau so ist hier zuerst src/publish/publish.js
// durchgerutscht. Deshalb zeilenweise und ueber die Statusbreite (2 Zeichen).
//
// DHa (2026-08-31), Auftrag Punkt 2a: --untracked-files=all.
//
// URSACHE: git status --porcelain klappt ein ungetracktes VERZEICHNIS zu einem
// einzigen Eintrag zusammen ("?? src/upload/"). Der faellt hier in den Zweig
// "keine vorhandene Datei" und wird uebersprungen -- mitsamt allem, was darin
// liegt. Und --vollbaum hilft nicht: der liest git ls-files und sieht nur
// Getracktes. Ein neues, ungetracktes Verzeichnis sah also KEINER der beiden
// Modi. Gemessen in DH: der Lauf meldete "Zu pruefende Dateien: 4" und hatte
// dabei ein neues Modul und 18 neue Fixtures nie angesehen. Der Check war
// genau bei dem blind, was ein Auftrag neu anlegt -- also bei dem, was am
// wahrscheinlichsten noch nie jemand angesehen hat.
//
// DHa, Auftrag Punkt 2b: die uebersprungenen Eintraege werden EINZELN genannt,
// nicht nur gezaehlt. Dieselbe Regel wie DFa Punkt 2: eine Zahl ohne ihre
// Posten liest sich wie "nichts Wichtiges", und genau darunter lag hier die
// Blindheit. Deshalb steht neben jedem Eintrag auch, warum er wegfaellt.
function porcelainDateien() {
  const roh = execSync('git status --porcelain --untracked-files=all', { encoding: 'utf8' });

  // DQ Punkt 4: Bis hierher stand an dieser Stelle
  //     .filter((z) => z.length > 3)
  // ohne Zaehler und ohne Meldung. Der Filter ist richtig -- eine Porcelain-
  // Zeile ist "XY pfad" und damit mindestens vier Zeichen lang -- aber er hat
  // NICHT gesagt, was er wegwirft. Dieselbe Regel wie in DFa Punkt 2 und ein
  // paar Zeilen weiter unten: was eine Pruefung nicht ansieht, muss sie beim
  // Namen nennen, sonst liest sich ihr Ergebnis vollstaendiger, als es ist.
  //
  // Die LEERE Schlusszeile ist die einzige Ausnahme, und sie ist eine echte:
  // split('\n') erzeugt sie bei jedem Lauf, sie traegt keine Information, und
  // sie in jedem Lauf zu melden wuerde die Meldung entwerten, auf die es
  // ankommt. Alles andere Kurze wird genannt -- auch wenn es heute nie kommt.
  const zeilen = [];
  const zuKurz = [];
  for (const z of roh.split('\n')) {
    if (z.length > 3) zeilen.push(z);
    else if (z.trim() !== '') zuKurz.push(z);
  }
  if (zuKurz.length > 0) {
    console.log(`Hinweis: ${zuKurz.length} Zeile(n) aus git status sind zu kurz fuer ` +
      `"XY pfad" und werden nicht geprueft:`);
    for (const z of zuKurz) console.log(`  ${JSON.stringify(z)} (${z.length} Zeichen)`);
    console.log('');
  }

  const dateien = [];
  const uebersprungen = [];
  for (const z of zeilen) {
    const status = z.slice(0, 2);
    let f = z.slice(2).trim().replace(/^"|"$/g, '');
    // Umbenennungen kommen als "alt -> neu"; geprueft wird das Ziel.
    if (f.includes(' -> ')) f = f.split(' -> ')[1];

    if (!fs.existsSync(f)) {
      uebersprungen.push({ status, f, grund: 'nicht vorhanden (geloescht oder verschoben)' });
    } else if (!fs.statSync(f).isFile()) {
      // Mit --untracked-files=all sollte hier nichts mehr ankommen; bleibt als
      // Netz fuer Sonderfaelle (z. B. ein eigenes Repo in einem Unterordner).
      uebersprungen.push({ status, f, grund: 'Verzeichnis -- sein Inhalt wurde NICHT geprueft' });
    } else {
      dateien.push(f);
    }
  }

  if (uebersprungen.length > 0) {
    console.log(`Hinweis: ${uebersprungen.length} Eintrag/Eintraege sind keine vorhandenen Dateien und werden nicht geprueft:`);
    for (const u of uebersprungen) console.log(`  [${u.status}] ${u.f} -- ${u.grund}`);
    console.log('');
  }
  return dateien;
}

// DF (2026-08-31), Auftrag Punkt 7: der Vollbaum als EIGENER Schalter.
// Das Commit-Gate bleibt auf dem Porcelain-Lauf. Dieser hier ist zusaetzlich:
// er sieht auch an, was laengst committet ist und deshalb nie wieder geprueft
// wird. -z, damit Pfade mit Leerzeichen nicht zerfallen.
//
// DQ Punkt 4: auch hier wurde still gekuerzt. Der Filter
//     .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile())
// warf jeden Eintrag weg, den git kennt und die Platte nicht -- geloescht und
// noch nicht committet, ein Symlink ins Leere, ein nicht ausgecheckter
// Submodul-Pfad -- und sagte darueber kein Wort. Der Vollbaum-Lauf meldete
// dann "Zu pruefende Dateien: N" mit einem N, das kleiner war als das, was
// git ls-files genannt hatte, und niemand konnte die Differenz sehen.
// Dieselbe Regel wie in porcelainDateien(): nennen, was wegfaellt, und warum.
function vollbaumDateien() {
  const roh = execSync('git ls-files -z', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const alle = roh.split('\0').filter(Boolean);

  const dateien = [];
  const uebersprungen = [];
  for (const f of alle) {
    if (!fs.existsSync(f)) {
      uebersprungen.push({ f, grund: 'von git gefuehrt, aber nicht auf der Platte' });
    } else if (!fs.statSync(f).isFile()) {
      uebersprungen.push({ f, grund: 'keine regulaere Datei -- Inhalt NICHT geprueft' });
    } else {
      dateien.push(f);
    }
  }

  if (uebersprungen.length > 0) {
    console.log(`Hinweis: ${uebersprungen.length} von ${alle.length} Eintraegen aus ` +
      `git ls-files werden nicht geprueft:`);
    for (const u of uebersprungen) console.log(`  ${u.f} -- ${u.grund}`);
    console.log('');
  }
  return dateien;
}

function main() {
  const vollbaum = process.argv.includes('--vollbaum');

  // Erst beweisen, dass die Muster sehen -- dann erst pruefen.
  selbstpruefung();

  const dateien = vollbaum ? vollbaumDateien() : porcelainDateien();

  const { ids, fehlend } = bekannteIds();
  // Auftrag Punkt 6b: eine geschrumpfte Abgleichsliste ist Blindheit, die sich
  // als Ergebnis tarnt. Lieber laut abbrechen als leise weniger pruefen.
  if (ids.length < ID_UNTERGRENZE) {
    console.error(`ABBRUCH: die Abgleichsliste hat nur ${ids.length} IDs, erwartet sind mindestens ${ID_UNTERGRENZE}.`);
    if (fehlend.length) {
      console.error('Fehlende oder unlesbare Messdatei(en):');
      for (const q of fehlend) console.error('  ' + q);
    } else {
      console.error('Alle vier Messdateien sind lesbar -- die Liste ist trotzdem zu kurz. Bitte nachsehen, bevor committet wird.');
    }
    console.error('Es wurde NICHTS geprueft.');
    process.exit(2);
  }
  if (fehlend.length) {
    console.log(`Hinweis: ${fehlend.length} Messdatei(en) fehlen; die Abgleichsliste bleibt mit ${ids.length} IDs ueber der Untergrenze ${ID_UNTERGRENZE}.`);
    for (const q of fehlend) console.log('  ' + q);
  }

  console.log(`Modus: ${vollbaum ? 'Vollbaum (git ls-files) -- zusaetzlicher Lauf, NICHT das Commit-Gate' : 'Commit-Kandidat (git status --porcelain --untracked-files=all)'}`);
  console.log(`Zu pruefende Dateien: ${dateien.length}`);
  console.log(`Bekannte IDs im Abgleich: ${ids.length}\n`);

  let treffer = 0;
  let ausgenommen = 0;
  let binaer = 0;
  for (const f of dateien) {
    const roh = fs.readFileSync(f, 'utf8');
    // DFa, Punkt 1a: was uebersprungen wird, wird gezaehlt und genannt -- an
    // der Datei selbst und unten als Summe. Ein stiller Filter waere genau der
    // Fehler, den diese Auftragsreihe zweimal gemacht hat.
    const binaerHier = istBinaer(roh);
    if (binaerHier) binaer++;
    const marke = binaerHier ? '   (binaer -- nur ID-Abgleich, keine Musterpruefung)' : '';
    const aus = ausnahmenFuer(f);
    const alle = [
      ...pruefeInhalt(roh, []),
      ...pruefeInhalt(roh, ids).filter((x) => x.muster === 'bekannte ID'),
    ];
    // Ausnahmen greifen NUR gegen Muster und .env-Vorgabewert, nie gegen den
    // ID-Abgleich (pruefAusnahmen() haelt das offen).
    const unterdrueckt = alle.filter((x) => istAusgenommen(x, aus));
    const funde = alle.filter((x) => !istAusgenommen(x, aus)).map((x) => x.text);
    ausgenommen += unterdrueckt.length;

    if (funde.length) {
      treffer += funde.length;
      console.log(`FUND  ${f}${marke}`);
      for (const x of funde) console.log(`        ${x}`);
    } else {
      console.log(`ok    ${f}${marke}`);
    }
    // DPa: unterdrueckte Treffer werden AN DER DATEI genannt, nicht nur unten
    // gezaehlt. Eine Ausnahme, die man erst in der Summenzeile bemerkt, ist
    // eine, die niemand nachliest.
    for (const x of unterdrueckt) {
      console.log(`        (Ausnahme: ${x.muster} -- benannt und begruendet in ${EIGENE_DATEI})`);
    }
  }

  if (binaer > 0) {
    console.log(`\n${binaer} Dateien als binaer uebersprungen (NUL-Byte im Inhalt): dort lief nur der Abgleich gegen die bekannten IDs, nicht die Musterpruefung.`);
  }
  if (ausgenommen > 0) {
    console.log(`\n${ausgenommen} Treffer durch benannte Ausnahmen unterdrueckt (siehe AUSNAHMEN in ${EIGENE_DATEI}).`);
  }
  console.log(`\n${treffer === 0 ? 'FREIGABE: sauber — keine Funde.' : `FREIGABE VERWEIGERT: ${treffer} Fund(e).`}`);
  process.exit(treffer === 0 ? 0 : 1);
}

main();
