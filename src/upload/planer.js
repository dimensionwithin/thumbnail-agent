'use strict';

// DN: Der Planer. Dritter Bewohner von src/upload/.
//
// Er liest die Freigabedatei EINER Aufnahme, verteilt die freigegebenen Shorts
// auf Termine und schreibt eine Planungsdatei. Mehr nicht.
//
// WAS ER NICHT TUT -- und zwar so, dass man es im Quelltext sehen kann:
// kein Netzaufruf, kein YouTube, kein Upload, kein Kindprozess, kein Aufruf
// eines anderen Skripts. Unten steht kein require('https'), kein
// require('googleapis'), kein spawnSync. Der Leser ruft einen Kindprozess auf,
// die Freigabeoberflaeche ruft den Leser auf -- der Planer ruft niemanden. Er
// bekommt eine Datei und legt eine Datei an.
//
// WARUM VORGABE TROCKENLAUF (ohne --execute wird nichts geschrieben):
// Der Planer schreibt keine Kanaldaten. Er legt aber fest, WAS spaeter
// geschrieben wird -- und die Planungsdatei ist danach der einzige Beleg
// dafuer, was zu welchem Zeitpunkt hochgehen sollte. Ein Plan, der beim
// Ausprobieren nebenbei entsteht, ist von einem gewollten Plan hinterher nicht
// zu unterscheiden. Darum muss man das Schreiben ausdruecklich verlangen.
//
// DIE ZEITRECHNUNG IST DER GEFAEHRLICHE TEIL. Ein falsch gerechneter Plan sieht
// aus wie ein richtiger: zwoelf Zeilen, aufsteigende Uhrzeiten, plausible
// Abstaende. Es gibt keinen Fehler, den man sieht -- es gibt nur Shorts, die um
// 06:00 morgens online gehen. Deshalb rechnet dieses Skript NICHT in UTC und
// addiert keine festen Stundenwerte auf Ortszeiten. Es rechnet in Instants
// (Millisekunden seit Epoche) und fragt fuer jede Umrechnung die Zonendatenbank
// ueber Intl. Und es prueft am Ende jeden einzelnen fertigen Termin noch einmal
// nach -- nicht anhand seiner eigenen Rechnung, sondern anhand dessen, was Intl
// aus dem fertigen Zeitstempel macht (siehe pruefePlan).
//
// DS: DER PLAN SETZT AN, WO DER LETZTE AUFHOERT. Bis DS begann das
// 24-Stunden-Fenster bei "jetzt", und der Planer las nur das Gedaechtnis SEINER
// Aufnahme. Zwei Aufnahmen, kurz hintereinander geplant, ergaben damit zwei
// Plaene, die einander ueberlagern -- und beide sahen fuer sich richtig aus.
// Seit DS ist der Startpunkt des Fensters das SPAETERE von "jetzt" und dem
// spaetesten noch ausstehenden Termin aus ALLEN Gedaechtnisdateien. Die Regel
// steht ausfuehrlich ueber gedaechtnisVerzeichnis; die Grenze, die sie hat,
// steht daneben und nicht in einer Fussnote.

const { pruefeArgumenteStrikt } = require('../publish/cli-args');

// pruefeArgumenteStrikt als ALLERERSTE Anweisung -- vor jedem Lesen, vor jedem
// Schreiben (CY Teil B).
const ERLAUBTE_ARGUMENTE = ['--freigabe=', '--execute', '--jetzt=', '--json'];

// DJb: pruefeKeineFreienArgumente kommt aus dem Leser und ist NICHT nachgebaut.
// Der Grund steht dort ausfuehrlich: --freigabe=2026-08-29 18-18-19 ohne
// Anfuehrungszeichen zerfaellt in zwei Argumente, das zweite beginnt nicht mit
// '-' und wird von pruefeArgumenteStrikt nie gesehen. Hier gilt das genauso:
// dieses Skript nimmt ausschliesslich benannte Argumente. AUFNAHME_FORM kommt
// aus demselben Grund von dort und nicht aus einer zweiten eigenen Zeile.
// DNa Punkt 1: Der Flagname geht als Parameter mit. Vorher stand in der
// Funktion '--aufnahme=' fest verdrahtet, und der Planer bekam damit einen
// Vorschlag, den er selbst nicht ausfuehren kann -- er heisst --freigabe=.
const { pruefeKeineFreienArgumente, AUFNAHME_FORM, EXIT } = require('./uebergabe-leser');

if (require.main === module) {
  pruefeArgumenteStrikt(process.argv, ERLAUBTE_ARGUMENTE, 'src/upload/planer.js');
  pruefeKeineFreienArgumente(process.argv, 'src/upload/planer.js', '--freigabe=');
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// DNa Punkt 2c: Die Zahlen stehen an EINER Stelle -- in der Tabelle EXIT_CODES
// in uebergabe-leser.js. Hier stehen nur die Namen, unter denen dieses Skript
// seine Faelle kennt.
//
// Eigener Code fuer die Sperre: sie ist kein Mangel an den Daten und kein
// Fehler im Aufruf -- sie ist eine Weigerung. Wer den Planer aus einem Skript
// heraus ruft, soll die drei Faelle auseinanderhalten koennen. Dass 3 in der
// archivierten upload-probe einmal "konnte nicht fragen" hiess, ist in DNa
// entschieden worden: 3 gehoert der Sperre, "konnte nicht fragen" bekommt 4.
// Beides steht in der Tabelle, mit Begruendung.
const EXIT_OK = EXIT.OK;
const EXIT_MANGEL = EXIT.BEFUND;
const EXIT_AUFRUFFEHLER = EXIT.AUFRUF;
const EXIT_GESPERRT = EXIT.GESPERRT;

// ---------------------------------------------------------------------------
// DIE REGEL IN ZAHLEN
// ---------------------------------------------------------------------------

const ZONE = 'Europe/Berlin';

// Das Tagesfenster, in Minuten nach Ortsmitternacht. 08:00 bis 20:00.
const TAGESFENSTER_VON_MIN = 8 * 60;
const TAGESFENSTER_BIS_MIN = 20 * 60;

// Das Zeitfenster: 24 Stunden ab dem Planungszeitpunkt. Es laeuft in ECHTER
// verstrichener Zeit, nicht in Ortszeit -- an den Umstellungstagen faellt das
// auseinander, und das ist Absicht (Bericht DN, Entscheidung 1).
const VORLAUF_MS = 24 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

// Wochenenden zaehlen mit. Es gibt hier bewusst KEINE Wochentagspruefung; diese
// Zeile steht da, damit ihr Fehlen als Entscheidung lesbar ist und nicht als
// Vergessen.

const PLAN_ARTIFACT_TYPE = 'adw_shorts_plan';
const PLAN_SCHEMA_VERSION = '1.0';

// Die Fassungen der Freigabedatei, die dieser Planer lesen kann. Eine hoehere
// Nummer wird ABGELEHNT und nicht nach den Regeln der bekannten gelesen --
// dieselbe Haltung wie im Leser gegenueber der Uebergabedatei.
const FREIGABE_ARTIFACT_TYPE = 'adw_shorts_freigaben';
const BEKANNTE_FREIGABE_VERSIONEN = ['1.0'];

// DAS GEDAECHTNIS DES UPLOADERS -- data/uploads/<aufnahme>.json.
//
// Der Planer LIEST es und schreibt es nie. Es ist der Beleg dafuer, was
// wirklich auf dem Kanal steht: wer darin herumschreibt, faelscht diesen Beleg
// genauso, wie wer die Freigabedatei umschreibt (siehe leseFreigabe).
//
// Die beiden Werte stehen hier ein zweites Mal und kommen nicht per require aus
// dem Uploader: der Uploader laedt den Planer, ein require zurueck waere ein
// Ring. Damit die zwei Stellen nicht auseinanderlaufen, haelt ein Test in
// tests/planer.test.cjs sie gegeneinander.
const GEDAECHTNIS_ARTIFACT_TYPE = 'adw_shorts_uploads';
const BEKANNTE_GEDAECHTNIS_VERSIONEN = ['1.0'];

const SHA256_FORM = /^[0-9a-f]{64}$/;

// Die Form, in der publish_at im Gedaechtnis steht -- RFC 3339 in UTC, so wie
// der Uploader es geschrieben und an die API gegeben hat. Seit DS haengt der
// Startpunkt des Fensters an diesem Feld; es wird deshalb als Zeitstempel
// gelesen und nicht als Zeichenkette, die zufaellig sortierbar ist.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// --jetzt= verlangt einen Zonenversatz. Ohne Versatz waere die Angabe genau
// das, wogegen dieses Skript gebaut ist: eine Ortszeit ohne Zone.
const ISO_MIT_VERSATZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------
// DIE SPERRE
// ---------------------------------------------------------------------------
//
// Gebaut wie die benannten Ausnahmen in scripts/freigabe-check.cjs: eine Liste,
// jeder Eintrag benannt und begruendet, und die Liste prueft sich selbst mit
// (pruefeSperrliste). Kein stiller Filter -- ein stiller Filter waere hier das
// Schlimmste: die Aufnahme faellt weg, der Plan sieht vollstaendig aus, und
// niemand erfaehrt, dass acht Shorts nicht darin stehen.
//
// WIE EINE AUFNAHME HIER HINEINKOMMT: Wer feststellt, dass die Shorts einer
// Aufnahme nicht veroeffentlicht werden duerfen, traegt sie hier ein -- mit dem
// Aufnahmenamen in der Form JJJJ-MM-TT HH-MM-SS und mit einem Grund, der sagt,
// WAS an der Aufnahme falsch ist. "Nicht veroeffentlichen" ist kein Grund; wer
// den Eintrag in einem halben Jahr liest, muss daraus entscheiden koennen, ob
// er noch gilt.
//
// WER SIE WIEDER HERAUSNIMMT: der Kanal-Owner, und erst nachdem die Shorts der
// Aufnahme neu geliefert und einzeln nachgesehen wurden. Nicht der Planer,
// nicht ein Skript, nicht ein Flag -- es gibt hier absichtlich keinen Schalter,
// der die Sperre uebergeht. Wer sie aufheben will, aendert diese Liste, und
// diese Aenderung steht danach in der Versionsgeschichte.
//
// DIE FREIGABEDATEI DER GESPERRTEN AUFNAHME WIRD NICHT GELOESCHT. Sie enthaelt
// echte Urteile eines Menschen und ist der Testfall, an dem diese Sperre haengt.
const GESPERRTE_AUFNAHMEN = [
  {
    aufnahme: '2026-08-29 18-18-19',
    grund:
      'Diese Aufnahme stammt aus der Zeit VOR dem Korrekturlauf der Shorts-Linie. ' +
      'Ihre Shorts sind fehlerhaft geschnitten und duerfen nie veroeffentlicht ' +
      'werden. Sie wurde ausschliesslich zum Erproben der Freigabeoberflaeche ' +
      'freigegeben; ihre Freigabedatei traegt acht freigegebene Eintraege, die ' +
      'aussehen wie jede andere Freigabe -- am Inhalt der Datei ist der Unterschied ' +
      'nicht zu sehen, deshalb steht er hier.',
  },
];

// Die Sperrliste ist Teil der Selbstpruefung: ein Eintrag ohne Grund oder mit
// einem Aufnahmenamen, aus dem der Rest des Programms keinen Pfad bauen kann,
// bricht den Lauf ab. Eine kaputte Sperre ist ein Loch, von dem niemand weiss.
function pruefeSperrliste() {
  const fehler = [];
  const gesehen = new Set();
  for (const s of GESPERRTE_AUFNAHMEN) {
    if (typeof s.aufnahme !== 'string' || !AUFNAHME_FORM.test(s.aufnahme)) {
      fehler.push('Sperreintrag ' + JSON.stringify(s.aufnahme) +
        ' hat nicht die Form JJJJ-MM-TT HH-MM-SS');
    }
    if (typeof s.grund !== 'string' || s.grund.trim().length < 20) {
      fehler.push('Sperreintrag ' + JSON.stringify(s.aufnahme) +
        ' hat keine brauchbare Begruendung');
    }
    if (gesehen.has(s.aufnahme)) {
      fehler.push('Sperreintrag ' + JSON.stringify(s.aufnahme) + ' steht doppelt');
    }
    gesehen.add(s.aufnahme);
  }
  return fehler;
}

function sperreFuer(aufnahme) {
  return GESPERRTE_AUFNAHMEN.find((s) => s.aufnahme === aufnahme) || null;
}

// ---------------------------------------------------------------------------
// ZEITRECHNUNG
// ---------------------------------------------------------------------------
//
// Alles hier arbeitet auf Instants (Millisekunden seit Epoche). Ein Instant ist
// ein Zeitpunkt, kein Zifferblatt: er ist eindeutig, egal welche Zone gerade
// gilt. Ortszeiten entstehen ausschliesslich durch Formatieren eines Instants
// und werden ausschliesslich durch zonenTeile() wieder gelesen.
//
// WARUM KEIN FREMDPAKET (luxon, date-fns-tz): Node hat die Zonendatenbank ueber
// Intl bereits an Bord, und diese Datei braucht daraus genau zwei Dinge --
// "welchen Versatz hat die Zone zu diesem Instant" und "welche Ortszeit zeigt
// dieser Instant". Beides steht unten in zusammen rund vierzig Zeilen. Gemessen
// gegen die echten Umstellungstage 29.03.2026 und 25.10.2026 (siehe Tests):
// Intl liefert dort das Richtige. Ein Paket dafuer aufzunehmen hiesse, eine
// zweite Zonendatenbank zu pflegen, die von der des Betriebssystems abweichen
// kann.
//
// WARUM DIE ZONE FEST VERDRAHTET IST UND NICHT AUS process.env.TZ KOMMT: Der
// Kanal sendet nach Deutschland. Der Rechner, auf dem geplant wird, koennte
// woanders stehen oder mit gesetztem TZ laufen; der Plan darf davon nicht
// abhaengen. ZONE ist deshalb eine Konstante und wird nie aus der Umgebung
// gelesen.

const TEILE_FORMATIERER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Zerlegt einen Instant in die Ortszeit der Zone.
function zonenTeile(instant) {
  const p = {};
  for (const t of TEILE_FORMATIERER.formatToParts(new Date(instant))) p[t.type] = t.value;
  // hour12:false liefert in manchen Fassungen "24" fuer Mitternacht.
  let stunde = Number(p.hour);
  if (stunde === 24) stunde = 0;
  return {
    jahr: Number(p.year), monat: Number(p.month), tag: Number(p.day),
    stunde, minute: Number(p.minute), sekunde: Number(p.second),
  };
}

// Der Zonenversatz zu diesem Instant, in Minuten oestlich von UTC.
// (+60 = MEZ, +120 = MESZ.)
function versatzMinuten(instant) {
  const t = zonenTeile(instant);
  const alsWaereEsUtc = Date.UTC(t.jahr, t.monat - 1, t.tag, t.stunde, t.minute, t.sekunde);
  // Sekundengenau rechnen: der Millisekundenrest des Instants gehoert nicht
  // zum Versatz.
  const sekundengenau = Math.floor(instant / 1000) * 1000;
  return Math.round((alsWaereEsUtc - sekundengenau) / MINUTE_MS);
}

function versatzText(instant) {
  const v = versatzMinuten(instant);
  const z = v < 0 ? '-' : '+';
  const a = Math.abs(v);
  return 'UTC' + z + String(Math.floor(a / 60)).padStart(2, '0') + ':' +
    String(a % 60).padStart(2, '0');
}

// ORTSZEIT -> INSTANT. Der Teil, an dem eine Zeitrechnung ohne Zonendatenbank
// zerbricht.
//
// Eine Ortszeit ist nicht immer genau ein Instant:
//   - am Tag der Vorstellung faellt eine Stunde aus (29.03.2026: 02:00 bis
//     02:59 gibt es nicht) -- diese Ortszeiten haben NULL Instants;
//   - am Tag der Rueckstellung gibt es eine Stunde doppelt (25.10.2026: 02:00
//     bis 02:59 kommt zweimal) -- diese Ortszeiten haben ZWEI Instants.
//
// Diese Funktion RAET NICHT. Sie probiert die in Frage kommenden Versaetze
// durch und prueft jedes Ergebnis, indem sie es zurueckformatiert: nur was
// wieder genau auf die gefragte Ortszeit fuehrt, zaehlt. Was dabei
// herauskommt -- null, ein oder zwei Instants -- meldet sie unveraendert. Der
// Aufrufer entscheidet.
function instantsFuerOrtszeit(jahr, monat, tag, stunde, minute) {
  const naiv = Date.UTC(jahr, monat - 1, tag, stunde, minute, 0);
  // Kandidaten: der Versatz einen Tag davor, der zum naiven Wert, und der einen
  // Tag danach. Eine Umstellung liegt immer zwischen zweien davon.
  const kandidaten = new Set([
    versatzMinuten(naiv - 24 * 60 * MINUTE_MS),
    versatzMinuten(naiv),
    versatzMinuten(naiv + 24 * 60 * MINUTE_MS),
  ]);
  const treffer = [];
  for (const v of kandidaten) {
    const ts = naiv - v * MINUTE_MS;
    const t = zonenTeile(ts);
    if (t.jahr === jahr && t.monat === monat && t.tag === tag &&
        t.stunde === stunde && t.minute === minute && t.sekunde === 0) {
      if (!treffer.includes(ts)) treffer.push(ts);
    }
  }
  treffer.sort((a, b) => a - b);
  return treffer;
}

// Ortszeit als lesbares Feld. Der Zonenversatz steht dabei, weil ohne ihn
// "2026-03-29 08:00" und "2026-03-28 08:00" gleich aussehen und trotzdem eine
// Stunde verschiedene UTC-Zeiten sind.
function ortszeitText(instant) {
  const t = zonenTeile(instant);
  const zz = (n) => String(n).padStart(2, '0');
  return zz(t.jahr) + '-' + zz(t.monat) + '-' + zz(t.tag) + ' ' +
    zz(t.stunde) + ':' + zz(t.minute) + ' (' + versatzText(instant) + ')';
}

// Minuten nach Ortsmitternacht -- der Wert, gegen den das Tagesfenster prueft.
function ortsminuten(instant) {
  const t = zonenTeile(instant);
  return t.stunde * 60 + t.minute;
}

// ---------------------------------------------------------------------------
// DAS NUTZBARE FENSTER
// ---------------------------------------------------------------------------
//
// Nutzbare Zeit ist die Schnittmenge aus zwei Dingen:
//   (a) [Planungszeitpunkt, Planungszeitpunkt + 24 h]   -- echte Zeit
//   (b) jeden Tag 08:00 bis 20:00 Ortszeit              -- Zifferblatt
//
// Ergebnis ist eine Liste von Abschnitten. Bei Planung um 17:00 sind das zwei:
// heute 17:00-20:00 und morgen 08:00-17:00. Bei Planung um 23:00 ist es einer:
// morgen 08:00-20:00. Bei Planung um 07:00 ist es einer: heute 08:00-20:00 --
// der Rest des 24-h-Fensters liegt am Folgetag vor 07:00 und damit vor
// Fensterbeginn, der Folgetag traegt also nichts bei.
function nutzbareAbschnitte(planungszeitpunkt) {
  const ende = planungszeitpunkt + VORLAUF_MS;
  const abschnitte = [];
  const probleme = [];

  // Von einem Tag vor dem Planungszeitpunkt bis einen Tag nach dem Fensterende.
  // Zwei Kalendertage reichten rechnerisch; die zwei zusaetzlichen kosten
  // nichts und sparen eine Ueberlegung darueber, was an einem Umstellungstag
  // "der naechste Tag" ist. Abschnitte ausserhalb des Fensters fallen unten
  // ohnehin heraus.
  //
  // DER NAECHSTE TAG ENTSTEHT AUS DEM KALENDER, NICHT AUS 24 STUNDEN. Erst
  // stand hier ein Instant plus i*24h, und daraus wurde die Ortszeit gelesen.
  // Das ist genau der Fehler, gegen den diese Datei gebaut ist: der 29.03.2026
  // ist in Ortszeit nur 23 Stunden lang, also uebersprang die Schleife ihn --
  // gemessen bei Planung am 28.03. um 23:07, wo die Tage 27., 28., 30. und 31.
  // herauskamen und der 29. fehlte. Der Plan wurde dadurch nicht falsch
  // (pruefePlan haette ihn ohnehin nicht durchgelassen), aber er kam gar nicht
  // erst zustande. Date.UTC normalisiert einen Tagesueberlauf selbst; die
  // Zeitzone kommt hier nicht vor.
  const anker = zonenTeile(planungszeitpunkt);
  for (let i = -1; i <= 2; i++) {
    const kalender = new Date(Date.UTC(anker.jahr, anker.monat - 1, anker.tag + i));
    const t = {
      jahr: kalender.getUTCFullYear(),
      monat: kalender.getUTCMonth() + 1,
      tag: kalender.getUTCDate(),
    };
    const vonListe = instantsFuerOrtszeit(t.jahr, t.monat, t.tag,
      Math.floor(TAGESFENSTER_VON_MIN / 60), TAGESFENSTER_VON_MIN % 60);
    const bisListe = instantsFuerOrtszeit(t.jahr, t.monat, t.tag,
      Math.floor(TAGESFENSTER_BIS_MIN / 60), TAGESFENSTER_BIS_MIN % 60);
    const zz = (n) => String(n).padStart(2, '0');
    const datum = t.jahr + '-' + zz(t.monat) + '-' + zz(t.tag);

    // ES GIBT DIESE ORTSZEIT NICHT. In Europe/Berlin faellt die ausgelassene
    // Stunde auf 02:00 und liegt damit weit vor 08:00 -- dieser Zweig sollte
    // nie greifen (die Tests fahren dafuer jeden Tag von 2026 ab). Wenn er
    // doch greift, bricht der Planer ab, statt sich eine Grenze auszudenken:
    // eine Fenstergrenze, die es nicht gibt, laesst sich nicht ehrlich
    // anwenden, und ein stilles Verschieben um eine Stunde waere genau der
    // Fehler, den niemand sieht.
    if (vonListe.length === 0 || bisListe.length === 0) {
      probleme.push('Am ' + datum + ' gibt es in ' + ZONE + ' die Ortszeit ' +
        (vonListe.length === 0 ? '08:00' : '20:00') + ' nicht (Zeitumstellung). ' +
        'Der Planer denkt sich keine Fenstergrenze aus und bricht ab.');
      continue;
    }

    // ES GIBT DIESE ORTSZEIT ZWEIMAL. Dann ist der frueheste 08:00-Instant der
    // Anfang und der spaeteste 20:00-Instant das Ende: der Abschnitt enthaelt
    // damit GENAU die Instants, deren Zifferblatt zwischen 08:00 und 20:00
    // steht -- beide Durchlaeufe der doppelten Stunde eingeschlossen. Auch
    // dieser Zweig greift in Europe/Berlin nie (doppelt ist 02:00); er steht
    // hier, damit die Regel "die Stunden zwischen 08:00 und 20:00" auch dann
    // gilt, wenn eine Zone ihre Umstellung einmal verlegt.
    const von = vonListe[0];
    const bis = bisListe[bisListe.length - 1];
    const doppelt = vonListe.length > 1 || bisListe.length > 1;

    const a = Math.max(von, planungszeitpunkt);
    const b = Math.min(bis, ende);
    if (b > a) abschnitte.push({ von: a, bis: b, datum, grenzen_doppelt: doppelt });
  }

  abschnitte.sort((x, y) => x.von - y.von);
  return { abschnitte, ende, probleme };
}

// ---------------------------------------------------------------------------
// DIE VERTEILUNG
// ---------------------------------------------------------------------------
//
// Gleichmaessig ueber die nutzbaren Stunden heisst: die nutzbare Zeit wird in
// n+1 gleich grosse Luecken geteilt, und die Termine liegen auf den n
// Nahtstellen dazwischen.
//
// WARUM n+1 UND NICHT n:
//   - Mit n+1 liegt der erste Termin automatisch einen vollen Abstand NACH dem
//     Planungszeitpunkt. Genau das ist verlangt: sonst geht ein Short in
//     derselben Minute online, in der er geplant wurde.
//   - Mit n+1 liegt der letzte Termin einen vollen Abstand VOR dem Fensterende.
//     Mit n laege er exakt auf der 24-Stunden-Grenze -- und "exakt auf der
//     Grenze" ist der Wert, der beim naechsten Rundungsfehler darueber liegt.
//   - Alle n+1 Luecken sind gleich gross. Der Abstand ist also wirklich
//     konstant, auch am Anfang und am Ende.
// Zwoelf Shorts in zwoelf Stunden ergeben damit 720/13 = rund 55 Minuten
// Abstand, nicht exakt 60. Das ist das "rund eine Stunde" der Regel.
//
// DIE ABSCHNITTE WERDEN ANEINANDERGELEGT. Die Nacht dazwischen zaehlt nicht
// mit: bei zwei Abschnitten (heute 17:00-20:00, morgen 08:00-17:00) laeuft der
// Abstand ueber die Naht hinweg weiter, als waeren die zwoelf Stunden am
// Stueck. Anders waere "gleichmaessig ueber die nutzbaren Stunden" nicht zu
// haben.
function verteile(abschnitte, anzahl) {
  const gesamtMs = abschnitte.reduce((s, a) => s + (a.bis - a.von), 0);
  const schrittMs = gesamtMs / (anzahl + 1);
  const termine = [];
  for (let k = 1; k <= anzahl; k++) {
    const versatz = Math.round((k * gesamtMs) / (anzahl + 1));
    let rest = versatz;
    let instant = null;
    for (const a of abschnitte) {
      const laenge = a.bis - a.von;
      if (rest <= laenge) { instant = a.von + rest; break; }
      rest -= laenge;
    }
    if (instant === null) instant = abschnitte[abschnitte.length - 1].bis;
    // Auf die volle Minute abrunden. YouTube plant minutengenau, und ein
    // Zeitstempel mit Sekunden liest sich, als waere die Sekunde gemeint.
    // Abrunden verschiebt nach FRUEH, also nie ueber das Fensterende hinaus.
    termine.push(instant - (instant % MINUTE_MS));
  }
  return { termine, gesamtMs, schrittMs };
}

// ---------------------------------------------------------------------------
// DIE FREIGABEDATEI LESEN
// ---------------------------------------------------------------------------

function freigabePfad(projektwurzel, aufnahme) {
  // Dieselbe Formpruefung wie im Freigabe-Dienst und aus demselben Grund:
  // <aufnahme> geht in einen Dateinamen. "..\\.." hat diese Form nicht, ein
  // Laufwerksbuchstabe hat sie nicht, ein Schraegstrich hat sie nicht.
  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new Error('Aufnahmename hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '. Es wird kein Dateiname daraus gebaut.');
  }
  return path.join(projektwurzel, 'data', 'freigaben', aufnahme + '.json');
}

function planPfad(projektwurzel, aufnahme) {
  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new Error('Aufnahmename hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '. Es wird kein Dateiname daraus gebaut.');
  }
  return path.join(projektwurzel, 'data', 'plaene', aufnahme + '.json');
}

function gedaechtnisPfad(projektwurzel, aufnahme) {
  if (typeof aufnahme !== 'string' || !AUFNAHME_FORM.test(aufnahme)) {
    throw new Error('Aufnahmename hat nicht die Form JJJJ-MM-TT HH-MM-SS: ' +
      JSON.stringify(aufnahme) + '. Es wird kein Dateiname daraus gebaut.');
  }
  return path.join(projektwurzel, 'data', 'uploads', aufnahme + '.json');
}

// DIE FREIGABEDATEI WIRD GELESEN UND SONST NICHTS.
//
// Kein Zurueckschreiben, kein Vermerk, kein Haken "erledigt", kein Feld
// "geplant_am", kein "hochgeladen: true" -- weder hier noch irgendwo sonst in
// diesem Programm. Die Datei ist das Protokoll eines menschlichen Urteils: ein
// Mensch hat jeden Short einzeln angesehen und ja oder nein gesagt. Wer in
// dieses Protokoll einen Programmzustand hineinschreibt, faelscht das Urteil --
// hinterher ist an der Datei nicht mehr zu unterscheiden, was der Mensch
// entschieden hat und was ein Lauf dazugetan hat. Und nachsehen kann man es
// nirgends: es gibt keine zweite Fassung dieses Urteils.
//
// DER ZUSTAND "SCHON HOCHGELADEN" HAT SEINEN EIGENEN ORT: das Gedaechtnis in
// data/uploads/<aufnahme>.json, geschrieben vom Uploader, gelesen von
// leseGedaechtnis. Genau dafuer gibt es das Gedaechtnis. Der bequeme Weg waere
// gewesen, hier ein Feld zu setzen und die Freigabedatei als Merkzettel zu
// benutzen; er ist nicht genommen worden, und diese Zeilen stehen hier, damit
// das eine Entscheidung bleibt und nicht wie eine Luecke aussieht.
//
// Streng: was nicht der bekannten Form entspricht, wird abgelehnt und nicht
// zurechtgebogen. Gibt { fehler: [...] } oder { fehler: [], kopf, eintraege, sha256 }.
function leseFreigabe(text, aufnahme) {
  const fehler = [];
  let daten;
  try {
    daten = JSON.parse(text);
  } catch (e) {
    return { fehler: ['Die Freigabedatei ist kein JSON: ' + e.message] };
  }
  if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) {
    return { fehler: ['Die Freigabedatei enthaelt kein Objekt.'] };
  }
  if (daten.artifact_type !== FREIGABE_ARTIFACT_TYPE) {
    fehler.push('artifact_type ist ' + JSON.stringify(daten.artifact_type) +
      ', erwartet ' + JSON.stringify(FREIGABE_ARTIFACT_TYPE) + '.');
  }
  if (!BEKANNTE_FREIGABE_VERSIONEN.includes(daten.schema_version)) {
    fehler.push('schema_version ist ' + JSON.stringify(daten.schema_version) +
      '; bekannt sind ' + BEKANNTE_FREIGABE_VERSIONEN.join(', ') +
      '. Eine fremde Fassung wird nicht nach den Regeln der bekannten gelesen.');
  }
  if (daten.aufnahme !== aufnahme) {
    fehler.push('Die Datei nennt die Aufnahme ' + JSON.stringify(daten.aufnahme) +
      ', angefragt war ' + JSON.stringify(aufnahme) + '.');
  }
  if (!Array.isArray(daten.freigaben)) {
    fehler.push('freigaben ist keine Liste.');
    return { fehler };
  }
  const gesehen = new Set();
  const eintraege = [];
  daten.freigaben.forEach((e, i) => {
    const wo = 'freigaben[' + i + ']';
    if (e === null || typeof e !== 'object') { fehler.push(wo + ' ist kein Objekt.'); return; }
    if (typeof e.sha256 !== 'string' || !SHA256_FORM.test(e.sha256)) {
      fehler.push(wo + '.sha256 ist keine sha256-Summe.');
      return;
    }
    if (gesehen.has(e.sha256)) {
      // sha256 ist der Schluessel des Plans. Zwei Eintraege mit derselben Summe
      // liessen nicht entscheiden, welches Urteil und welcher Titel gilt.
      fehler.push(wo + '.sha256 steht ein zweites Mal in der Datei.');
      return;
    }
    gesehen.add(e.sha256);
    if (typeof e.freigegeben !== 'boolean') {
      fehler.push(wo + '.freigegeben ist kein Wahrheitswert (' +
        JSON.stringify(e.freigegeben) + ').');
      return;
    }
    if (typeof e.kennung !== 'string' || !e.kennung.trim()) {
      fehler.push(wo + '.kennung fehlt.');
      return;
    }
    // Der Titel wird nur bei freigegebenen Eintraegen gebraucht -- ein
    // abgelehnter Short darf einen leeren Titel haben.
    if (e.freigegeben === true && (typeof e.titel !== 'string' || !e.titel.trim())) {
      fehler.push(wo + ' ist freigegeben, hat aber keinen Titel.');
      return;
    }
    eintraege.push(e);
  });
  if (fehler.length) return { fehler };
  return {
    fehler: [],
    kopf: daten,
    eintraege,
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

// ---------------------------------------------------------------------------
// DAS GEDAECHTNIS LESEN
// ---------------------------------------------------------------------------
//
// Streng in der Form, mit EINEM bewussten Unterschied zum Uploader: der Planer
// prueft plan_sha256 NICHT.
//
// Der Uploader muss das pruefen. Er fragt: "gehoert dieses 'schon hochgeladen'
// zu dem Plan, den ich gerade abarbeite?" -- und wenn der Plan inzwischen ein
// anderer ist, kann er die Frage nicht beantworten und bricht ab.
//
// Der Planer fragt etwas anderes: "steht dieser Inhalt schon auf dem Kanal?"
// Darauf antwortet die sha256 des Shorts allein; welcher Plan ihn dorthin
// gebracht hat, aendert daran nichts. Ein Plan existiert in diesem Augenblick
// ohnehin nicht -- der Planer laeuft ja gerade, um einen zu bauen, und der
// bekommt zwangslaeufig eine andere Pruefsumme als der, aus dem hochgeladen
// wurde. Wuerde er plan_sha256 pruefen, koennte er nach einem erneuten Planen
// NIE etwas ueberspringen: also genau in dem Fall, fuer den das Ueberspringen
// gebaut ist.
//
// Gibt { fehler: [...] } oder { fehler: [], gedaechtnis, hochgeladen, sha256 }.
// hochgeladen ist eine Map von sha256 auf den Eintrag im Gedaechtnis.
function leseGedaechtnis(text, aufnahme) {
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return { fehler: ['Das Gedaechtnis data/uploads/' + aufnahme + '.json ist kein JSON: ' +
      e.message + '. Es wird weder repariert noch uebergangen: solange nicht feststeht, ' +
      'was schon hochgeladen ist, darf kein Plan entstehen.'] };
  }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return { fehler: ['Das Gedaechtnis enthaelt kein Objekt.'] };
  }
  const fehler = [];
  if (d.artifact_type !== GEDAECHTNIS_ARTIFACT_TYPE) {
    fehler.push('Gedaechtnis: artifact_type ist ' + JSON.stringify(d.artifact_type) +
      ', erwartet ' + JSON.stringify(GEDAECHTNIS_ARTIFACT_TYPE) + '.');
  }
  if (!BEKANNTE_GEDAECHTNIS_VERSIONEN.includes(d.schema_version)) {
    fehler.push('Gedaechtnis: schema_version ist ' + JSON.stringify(d.schema_version) +
      '; bekannt sind ' + BEKANNTE_GEDAECHTNIS_VERSIONEN.join(', ') +
      '. Eine fremde Fassung wird nicht nach den Regeln der bekannten gelesen.');
  }
  if (d.aufnahme !== aufnahme) {
    fehler.push('Gedaechtnis: nennt die Aufnahme ' + JSON.stringify(d.aufnahme) +
      ', geplant wird ' + JSON.stringify(aufnahme) + '.');
  }
  if (!Array.isArray(d.uploads)) {
    fehler.push('Gedaechtnis: uploads ist keine Liste.');
    return { fehler };
  }
  const hochgeladen = new Map();
  d.uploads.forEach((u, i) => {
    const wo = 'Gedaechtnis: uploads[' + i + ']';
    if (u === null || typeof u !== 'object') { fehler.push(wo + ' ist kein Objekt.'); return; }
    if (typeof u.sha256 !== 'string' || !SHA256_FORM.test(u.sha256)) {
      fehler.push(wo + '.sha256 ist keine sha256-Summe.');
      return;
    }
    // videoId wird auf VORHANDENSEIN geprueft und danach nicht mehr angefasst:
    // ein Eintrag ohne sie belegt keinen Upload. Ihr WERT geht in keinen Plan,
    // in keine Ausgabe und in keinen Bericht -- der Planer hat mit dem Kanal
    // nichts zu tun, und eine videoId, die er nirgends braucht, soll er auch
    // nirgends hinterlassen.
    if (typeof u.videoId !== 'string' || !u.videoId.trim()) {
      fehler.push(wo + ' hat keine videoId und belegt damit keinen Upload.');
      return;
    }
    if (hochgeladen.has(u.sha256)) {
      fehler.push(wo + '.sha256 steht ein zweites Mal im Gedaechtnis.');
      return;
    }
    // DS: publish_at und kennung werden seit DS GEBRAUCHT und darum geprueft.
    // Vorher stand beides im Gedaechtnis und wurde vom Planer nie angesehen;
    // jetzt haengt der Startpunkt des naechsten Plans daran (siehe
    // sammleAusstehende). Ein Eintrag ohne brauchbares publish_at duerfte nicht
    // stillschweigend als "steht nicht aus" durchgehen -- das waere wieder
    // genau der Plan, der sich ueber vergebene Termine legt.
    if (typeof u.publish_at !== 'string' || !ISO_UTC.test(u.publish_at) ||
        !Number.isFinite(Date.parse(u.publish_at))) {
      fehler.push(wo + '.publish_at ist kein Zeitstempel in UTC (RFC 3339 mit Z): ' +
        JSON.stringify(u.publish_at) + '. Ohne ihn ist nicht zu sagen, ob dieser Upload ' +
        'noch aussteht.');
      return;
    }
    if (typeof u.kennung !== 'string' || !u.kennung.trim()) {
      fehler.push(wo + '.kennung fehlt. Sie benennt den Termin, an den ein neuer Plan ' +
        'anschliesst; ein Anschluss ohne Namen liesse sich nicht nachpruefen.');
      return;
    }
    hochgeladen.set(u.sha256, u);
  });
  if (fehler.length) return { fehler };
  return {
    fehler: [],
    gedaechtnis: d,
    hochgeladen,
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

// ---------------------------------------------------------------------------
// DS: DER ANSCHLUSS -- WORAN EIN NEUER PLAN ANSETZT
// ---------------------------------------------------------------------------
//
// DER FEHLER, DEN ES HIER GAB, sah aus wie ein richtiger Plan. Der Planer las
// das Gedaechtnis SEINER Aufnahme und begann sein 24-Stunden-Fenster bei
// "jetzt". Eine zweite Aufnahme, kurz darauf geplant, legte ihre Termine damit
// ueber die noch ausstehenden der ersten. Gemessen an echten Daten: am
// 02.09.2026 bekam die Aufnahme 2026-09-02 12-10-37 Termine ab 17:56 Ortszeit,
// waehrend aus 2026-08-31 17-36-21 noch Termine bis zum 03.09. um 10:57 offen
// standen. An keiner der beiden Planungsdateien war das zu sehen: sie nannten
// die Termine der jeweils anderen nicht.
//
// DIE REGEL. Der Startpunkt des Fensters ist das SPAETERE von zweien:
//   (a) jetzt (beziehungsweise der mit --jetzt= vorgegebene Zeitpunkt)
//   (b) der spaeteste publish_at aus ALLEN Gedaechtnisdateien, der noch in der
//       Zukunft liegt
// Das 24-Stunden-Fenster laeuft ab diesem Startpunkt, nicht ab jetzt. Alles
// andere bleibt, wie es war: 08:00 bis 20:00 Ortszeit, Europe/Berlin,
// Wochenenden zaehlen mit, n+1 Luecken, Abrunden auf die volle Minute.
//
// WARUM DER ERSTE NEUE TERMIN DAMIT NICHT AM LETZTEN ALTEN KLEBT: die
// n+1-Teilung legt den ersten Termin einen vollen Abstand hinter den
// Fensteranfang (die Begruendung steht ueber verteile). Faellt der
// Fensteranfang auf den letzten ausstehenden Termin, ist der Abstand zwischen
// altem und erstem neuem Termin derselbe wie der Abstand innerhalb des neuen
// Plans. Gemessen wird dieser Abstand in NUTZBARER Zeit: liegt der ausstehende
// Termin ausserhalb von 08:00-20:00 -- etwa um 23:30 --, laeuft das
// 24-Stunden-Fenster trotzdem ab ihm, und der erste nutzbare Abschnitt beginnt
// am naechsten Morgen um 08:00.
//
// VERGANGENE TERMINE ZAEHLEN NICHT. Ein publish_at, das nicht mehr in der
// Zukunft liegt, ist veroeffentlicht. Danach zu planen hiesse, ohne Grund einen
// Tag zu verschenken.
//
// ES WIRD ABGEBROCHEN, NICHT UEBERGANGEN. Eine Gedaechtnisdatei, die sich nicht
// lesen laesst, sieht sonst genau aus wie "nichts ausstehend" -- und dann legt
// sich der Plan wieder ueber alles, und niemand sieht es. Darum bricht jede
// unlesbare oder unerwartete Datei den Lauf ab, mit ihrem Namen.
//
// DIE GRENZE DIESER REGEL -- sie steht hier, in der Planungsdatei und in der
// Ausgabe, und nicht in einer Fussnote:
// Der Planer sieht NUR, was DIESES Werkzeug hochgeladen hat, also was in
// data/uploads/ steht. Ein Video, das ein Mensch von Hand im YouTube-Studio
// einplant, kennt er nicht und kann er nicht kennen: er hat kein Netz, keine
// Zugangsdaten und fragt den Kanal nicht -- und das soll so bleiben (siehe den
// Kopf dieser Datei). Es wird hier ABSICHTLICH keine Abfrage gegen YouTube
// gebaut. Wer von Hand einplant, haelt diesen Plan selbst dagegen.
const GRENZE_HANDPLANUNG =
  'Der Planer sieht nur, was DIESES Werkzeug hochgeladen hat (data/uploads/). Ein ' +
  'Video, das von Hand im YouTube-Studio eingeplant wurde, steht dort nicht und kommt ' +
  'in dieser Rechnung nicht vor: der Planer hat kein Netz und fragt den Kanal nicht. ' +
  'Wer von Hand einplant, haelt diesen Plan selbst dagegen.';

function gedaechtnisVerzeichnis(projektwurzel) {
  return path.join(projektwurzel, 'data', 'uploads');
}

// ALLE Gedaechtnisdateien lesen. Nur Platte, kein Urteil -- das faellt in
// sammleAusstehende.
//
// WAS ALS GEDAECHTNISDATEI GILT: <aufnahme>.json, und <aufnahme> hat die Form
// JJJJ-MM-TT HH-MM-SS. Eine ANDERE Datei, die auf .json endet, gehoert dort
// nicht hin und wird nicht stillschweigend uebergangen: stuende darin ein
// Gedaechtnis, faenden seine ausstehenden Termine keinen Weg in diesen Plan.
// Was nicht auf .json endet, wird uebergangen -- die Temporaerdateien des
// atomaren Schreibens heissen .<name>.json.tmp.<pid>.<n> und fallen darunter.
//
// Gibt { fehler: [...] } oder { fehler: [], dateien: [{aufnahme, datei, pfad, text}] }.
function leseGedaechtnisverzeichnis(verzeichnis) {
  const fehler = [];
  const dateien = [];
  let namen;
  try {
    // Kein Vorfiltern auf "gewoehnliche Datei". Was auf .json endet, WIRD
    // gelesen -- und was sich nicht lesen laesst, faellt unten in den
    // Fangzweig und bricht ab. Ein Verzeichnis namens
    // "2026-01-01 00-00-00.json" wuerde ein isFile()-Filter stillschweigend
    // uebergehen; so meldet es sich als EISDIR und mit seinem Namen.
    namen = fs.readdirSync(verzeichnis).slice().sort();
  } catch (e) {
    // Kein Verzeichnis heisst: aus diesem Projekt wurde noch nie etwas
    // hochgeladen. Das ist der Normalfall vor dem ersten Upload und kein
    // Mangel. Jeder andere Fehler ist einer.
    if (e.code === 'ENOENT') return { fehler: [], dateien: [] };
    return { fehler: ['Das Verzeichnis der Gedaechtnisdateien ist nicht lesbar (' + e.code +
      '): ' + verzeichnis + '. Solange nicht feststeht, welche Termine noch ausstehen, ' +
      'entsteht kein Plan.'] };
  }
  for (const name of namen) {
    if (!name.endsWith('.json')) continue;
    const aufnahme = name.slice(0, name.length - 5);
    if (!AUFNAHME_FORM.test(aufnahme)) {
      fehler.push('In data/uploads/ liegt die Datei ' + JSON.stringify(name) + '. Ihr Name ' +
        'hat nicht die Form <JJJJ-MM-TT HH-MM-SS>.json. Sie wird nicht uebergangen: ' +
        'stuende darin ein Gedaechtnis, faenden seine ausstehenden Termine keinen Weg in ' +
        'diesen Plan.');
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(path.join(verzeichnis, name), 'utf8');
    } catch (x) {
      fehler.push('Die Gedaechtnisdatei data/uploads/' + name + ' liegt da, ist aber nicht ' +
        'lesbar (' + x.code + '). Sie wird nicht uebergangen: eine uebergangene Datei sieht ' +
        'aus wie "nichts ausstehend", und der Plan legte sich dann ueber Termine, die schon ' +
        'vergeben sind.');
      continue;
    }
    dateien.push({
      aufnahme,
      datei: 'data/uploads/' + name,
      pfad: path.join(verzeichnis, name),
      text,
    });
  }
  if (fehler.length) return { fehler };
  return { fehler: [], dateien };
}

// Aus den gelesenen Gedaechtnisdateien die Termine, die noch AUSSTEHEN.
//
// Je Datei streng, mit derselben Pruefung wie fuer das eigene Gedaechtnis
// (leseGedaechtnis) -- eine kaputte Datei bricht ab und wird nicht uebergangen.
// Der Dateiname steht vor jeder Meldung: bei sieben Dateien ist "kein JSON"
// ohne Namen keine Auskunft.
//
// grenze ist der Zeitpunkt, ab dem ein Termin als ausstehend gilt. Das ist der
// Planungszeitpunkt und nicht Date.now(): mit --jetzt= soll die Lage von damals
// herauskommen und nicht die von heute.
//
// Gibt { fehler: [...] } oder { fehler: [], ausstehend, termine_gesamt }.
// ausstehend ist aufsteigend nach Zeit sortiert.
function sammleAusstehende(dateien, grenze) {
  const fehler = [];
  const ausstehend = [];
  let termineGesamt = 0;
  for (const d of dateien) {
    const g = leseGedaechtnis(d.text, d.aufnahme);
    if (g.fehler.length) {
      for (const f of g.fehler) fehler.push(d.datei + ' -- ' + f);
      continue;
    }
    for (const u of g.gedaechtnis.uploads) {
      termineGesamt += 1;
      const ms = Date.parse(u.publish_at);
      if (ms <= grenze) continue;
      ausstehend.push({
        aufnahme: d.aufnahme,
        datei: d.datei,
        kennung: u.kennung,
        publish_at: new Date(ms).toISOString(),
        publish_at_ortszeit: ortszeitText(ms),
        ms,
        // Die videoId steht in der Gedaechtnisdatei und bleibt dort. Sie wird
        // hier nicht abgeschrieben -- aus demselben Grund wie ueber
        // leseGedaechtnis: der Planer hat mit dem Kanal nichts zu tun.
      });
    }
  }
  if (fehler.length) return { fehler };
  ausstehend.sort((a, b) => a.ms - b.ms);
  return { fehler: [], ausstehend, termine_gesamt: termineGesamt };
}

// Der Startpunkt: das SPAETERE von "jetzt" und dem spaetesten ausstehenden
// Termin. sammleAusstehende hat bereits auf "in der Zukunft" gefiltert; der
// Vergleich steht trotzdem ausgeschrieben da, weil die Regel "das spaetere von
// zweien" lautet und niemand sie sich aus einem Filter zusammenreimen soll.
function bestimmeStartpunkt(jetzt, ausstehend) {
  let spaetester = null;
  for (const a of ausstehend) {
    if (spaetester === null || a.ms > spaetester.ms) spaetester = a;
  }
  if (spaetester === null || spaetester.ms <= jetzt) {
    return { startpunkt: jetzt, grund: 'jetzt', anker: null };
  }
  return { startpunkt: spaetester.ms, grund: 'ausstehender_termin', anker: spaetester };
}

// ---------------------------------------------------------------------------
// DER PLAN
// ---------------------------------------------------------------------------
//
// REIHENFOLGE: die der Freigabedatei. Der Planer sortiert NICHT um. Die Datei
// traegt die Reihenfolge, in der ein Mensch entschieden hat; sie umzusortieren
// hiesse, eine Entscheidung zu treffen, die niemand getroffen hat.

// DS: ausstehende und gedaechtnisdateien kommen von aussen herein und werden
// hier NICHT von der Platte geholt. Damit bleibt diese Funktion pruefbar, ohne
// dass ein Test Dateien anlegen muesste -- und der Plattenzugriff steht an
// einer Stelle, in main().
//   ausstehende:        [{aufnahme, datei, kennung, publish_at,
//                         publish_at_ortszeit, ms}], aufsteigend, alle in der
//                       Zukunft (siehe sammleAusstehende)
//   gedaechtnisdateien: die Namen der Dateien, die dafuer gelesen wurden --
//                       sie gehoeren in den Kopf, damit nachvollziehbar ist,
//                       WORAUF die Zahl "ausstehend" beruht.
function planeAufnahme({ aufnahme, freigabeText, gedaechtnisText = null,
  planungszeitpunkt, vorgegeben = false, jetzt,
  ausstehende = [], gedaechtnisdateien = [] }) {
  const sperrfehler = pruefeSperrliste();
  if (sperrfehler.length) return { fehler: sperrfehler.map((f) => 'Sperrliste: ' + f) };

  const sperre = sperreFuer(aufnahme);
  if (sperre) return { gesperrt: sperre, fehler: [] };

  const gelesen = leseFreigabe(freigabeText, aufnahme);
  if (gelesen.fehler.length) return { fehler: gelesen.fehler };

  const freigegeben = gelesen.eintraege.filter((e) => e.freigegeben === true);
  const abgelehnt = gelesen.eintraege.length - freigegeben.length;

  if (freigegeben.length === 0) {
    // KEINE LEERE PLANUNGSDATEI. Eine Datei mit termine:[] sieht spaeter aus
    // wie ein Plan, der abgearbeitet ist -- und ist doch einer, der nie
    // entstehen durfte. Der Unterschied waere an der Datei nicht zu sehen.
    return {
      fehler: ['In ' + JSON.stringify(aufnahme) + ' ist kein Eintrag freigegeben (' +
        gelesen.eintraege.length + ' Eintraege, davon 0 freigegeben). Es wird KEINE ' +
        'Planungsdatei angelegt: eine Datei ohne Termine waere spaeter nicht von ' +
        'einem abgearbeiteten Plan zu unterscheiden.'],
    };
  }

  // DAS GEDAECHTNIS. Was hier drinsteht, ist hochgeladen. Ein zweiter Termin
  // dafuer waere ein zweiter Upload desselben Videos -- und der faellt niemandem
  // auf, bis er auf dem Kanal steht.
  //
  // gedaechtnisText === null heisst: es gab keine Datei. Das ist kein Mangel,
  // sondern der Normalfall vor dem ersten Upload. Ein leerer String waere etwas
  // anderes -- eine Datei, die es gibt und die nichts enthaelt -- und faellt
  // unten als "kein JSON" auf.
  let gedaechtnisSha = null;
  let hochgeladen = new Map();
  if (gedaechtnisText !== null) {
    const g = leseGedaechtnis(gedaechtnisText, aufnahme);
    if (g.fehler.length) return { fehler: g.fehler };
    gedaechtnisSha = g.sha256;
    hochgeladen = g.hochgeladen;
  }

  const uebersprungen = [];
  const offen = [];
  for (const e of freigegeben) {
    const u = hochgeladen.get(e.sha256);
    if (!u) { offen.push(e); continue; }
    uebersprungen.push({
      sha256: e.sha256,
      kennung: e.kennung,
      titel: e.titel,
      // Aus dem Gedaechtnis kommt NUR der Zeitpunkt. Die videoId steht dort und
      // bleibt dort (siehe leseGedaechtnis).
      hochgeladen_am: typeof u.hochgeladen_am === 'string' ? u.hochgeladen_am : null,
      grund: 'steht im Gedaechtnis: schon hochgeladen',
    });
  }

  if (offen.length === 0) {
    // KEINE LEERE PLANUNGSDATEI -- aus demselben Grund wie oben, und hier waere
    // sie noch schlimmer: ein Plan mit null Terminen neben einem Gedaechtnis
    // voller Uploads liest sich wie "hier war nie etwas zu tun". Der Aufrufer
    // bekommt keinen Plan, sondern diese Auskunft, und main() macht Klartext
    // daraus.
    return {
      fehler: [],
      alles_hochgeladen: {
        aufnahme,
        freigegeben: freigegeben.length,
        uebersprungen,
        gedaechtnis_sha256: gedaechtnisSha,
      },
    };
  }

  // DS: DER ANSCHLUSS. Das Fenster beginnt beim SPAETEREN von "jetzt" und dem
  // spaetesten noch ausstehenden Termin -- nicht bei "jetzt". Die Begruendung
  // steht ueber bestimmeStartpunkt.
  const anschluss = bestimmeStartpunkt(planungszeitpunkt, ausstehende);
  const startpunkt = anschluss.startpunkt;

  const { abschnitte, ende, probleme } = nutzbareAbschnitte(startpunkt);
  if (probleme.length) return { fehler: probleme };
  if (!abschnitte.length) {
    return { fehler: ['Zwischen ' + ortszeitText(startpunkt) + ' und ' +
      ortszeitText(ende) + ' liegt keine nutzbare Zeit im Tagesfenster 08:00-20:00.'] };
  }

  // Verteilt werden die OFFENEN, nicht alle freigegebenen: die uebersprungenen
  // haben ihren Termin laengst gehabt. Zwoelf Freigaben mit drei Uploads ergeben
  // neun Termine ueber das ganze Fenster, nicht neun auf den ersten neun
  // Plaetzen von zwoelf.
  const { termine, gesamtMs, schrittMs } = verteile(abschnitte, offen.length);

  const plan = {
    artifact_type: PLAN_ARTIFACT_TYPE,
    schema_version: PLAN_SCHEMA_VERSION,
    aufnahme,
    erzeugt_am: new Date(jetzt).toISOString(),
    planungszeitpunkt: new Date(planungszeitpunkt).toISOString(),
    planungszeitpunkt_ortszeit: ortszeitText(planungszeitpunkt),
    // Ein Plan, der mit vorgegebenem Planungszeitpunkt entstanden ist, bleibt
    // daran erkennbar -- sonst sieht ein Probelauf aus wie ein echter Plan.
    planungszeitpunkt_vorgegeben: vorgegeben === true,
    zeitzone: ZONE,
    // DS: WORAUF DER STARTPUNKT BERUHT -- in der Datei, nicht nur im Bericht.
    // Ein Mensch soll diesen Plan pruefen koennen, ohne nachzurechnen: er sieht
    // hier, ob das Fenster bei "jetzt" begann oder an einem ausstehenden
    // Termin, welche Aufnahme und welche Kennung diesen Termin traegt, wie
    // viele ausstehende Termine insgesamt gefunden wurden und aus welchen
    // Dateien sie stammen.
    //
    // schema_version bleibt bei 1.0: dieser Block kommt HINZU und aendert kein
    // vorhandenes Feld. Der Uploader liest den Plan streng, laesst ihm aber
    // unbekannte Kopffelder durch -- eine hoehere Nummer wuerde er dagegen
    // ablehnen, und dann liesse sich der Plan nicht mehr hochladen.
    anschluss: {
      startpunkt: new Date(startpunkt).toISOString(),
      startpunkt_ortszeit: ortszeitText(startpunkt),
      grund: anschluss.grund,
      erklaerung: anschluss.grund === 'jetzt'
        ? 'Der Startpunkt liegt bei JETZT (dem Planungszeitpunkt): in keiner ' +
          'Gedaechtnisdatei steht ein Termin, der noch in der Zukunft liegt.'
        : 'Der Startpunkt liegt auf einem AUSSTEHENDEN Termin -- dem spaetesten, der ' +
          'in allen Gedaechtnisdateien noch in der Zukunft liegt. Das 24-Stunden-Fenster ' +
          'laeuft ab ihm und nicht ab dem Planungszeitpunkt: sonst legten sich diese ' +
          'Termine ueber die schon vergebenen.',
      letzter_ausstehender: anschluss.anker === null ? null : {
        aufnahme: anschluss.anker.aufnahme,
        kennung: anschluss.anker.kennung,
        publish_at: anschluss.anker.publish_at,
        publish_at_ortszeit: anschluss.anker.publish_at_ortszeit,
        gedaechtnis_datei: anschluss.anker.datei,
      },
      ausstehende_termine_gesamt: ausstehende.length,
      // EINZELN, nicht nur gezaehlt -- aus demselben Grund wie bei den
      // uebersprungenen: "sieben ausstehend" laesst nicht nachsehen, WELCHE
      // sieben, und genau das ist die Frage, die man dazu stellt.
      ausstehende_termine: ausstehende.map((a) => ({
        aufnahme: a.aufnahme,
        kennung: a.kennung,
        publish_at: a.publish_at,
        publish_at_ortszeit: a.publish_at_ortszeit,
      })),
      gelesene_gedaechtnisdateien: gedaechtnisdateien,
      grenze: GRENZE_HANDPLANUNG,
    },
    // WELCHES FELD VERBINDLICH IST -- steht in der Datei, nicht nur im Bericht.
    verbindlich: 'publish_at',
    hinweis_ortszeit:
      'publish_at ist der verbindliche Wert und geht unveraendert an die ' +
      'YouTube-API (RFC 3339 in UTC). publish_at_ortszeit ist ausschliesslich ' +
      'zum Lesen da und wird von keinem Programm ausgewertet.',
    fenster: {
      vorlauf_stunden: VORLAUF_MS / (60 * 60 * 1000),
      // DS: der Anfang steht jetzt daneben. Vor DS war er immer der
      // Planungszeitpunkt und musste nicht genannt werden; seither koennen die
      // beiden auseinanderfallen, und dann ist "Fensterende" ohne "Fensteranfang"
      // eine Angabe, aus der sich nichts nachrechnen laesst.
      beginn: new Date(startpunkt).toISOString(),
      beginn_ortszeit: ortszeitText(startpunkt),
      ende: new Date(ende).toISOString(),
      ende_ortszeit: ortszeitText(ende),
      tagesfenster_von: '08:00',
      tagesfenster_bis: '20:00',
      wochenenden_zaehlen_mit: true,
      abschnitte: abschnitte.map((a) => ({
        datum: a.datum,
        von: new Date(a.von).toISOString(),
        von_ortszeit: ortszeitText(a.von),
        bis: new Date(a.bis).toISOString(),
        bis_ortszeit: ortszeitText(a.bis),
        minuten: Math.round((a.bis - a.von) / MINUTE_MS),
        grenzen_doppelt: a.grenzen_doppelt,
      })),
      nutzbare_minuten: Math.round(gesamtMs / MINUTE_MS),
      abstand_minuten: Math.round((schrittMs / MINUTE_MS) * 100) / 100,
      // Laeuft ueber diesen Plan eine Zeitumstellung? Wenn ja, ist das
      // 24-Stunden-Fenster in Ortszeit 23 oder 25 Stunden lang -- der Wert
      // steht hier, damit ein Mensch nicht ratlos vor der Uhrzeit steht.
      versatz_am_anfang: versatzText(startpunkt),
      versatz_am_ende: versatzText(ende),
      sommerzeitwechsel_im_fenster: versatzMinuten(startpunkt) !== versatzMinuten(ende),
    },
    freigabedatei: 'data/freigaben/' + aufnahme + '.json',
    freigabe_sha256: gelesen.sha256,
    // WELCHES GEDAECHTNIS BEIM PLANEN VORLAG -- als Pruefsumme, oder
    // ausdruecklich, dass keines dalag. Ohne diese Zeilen ist an einem Plan
    // spaeter nicht zu sehen, ob er neun Termine traegt, weil drei Shorts schon
    // hochgeladen waren, oder weil die Freigabe nur neun hatte. Das ist genau
    // die Frage, die man stellt, wenn drei Videos fehlen.
    gedaechtnis_datei: 'data/uploads/' + aufnahme + '.json',
    gedaechtnis_vorhanden: gedaechtnisSha !== null,
    gedaechtnis_sha256: gedaechtnisSha,
    hinweis_gedaechtnis: gedaechtnisSha === null
      ? 'Beim Planen lag KEIN Gedaechtnis vor -- data/uploads/' + aufnahme +
        '.json gab es nicht. Es wurde kein Eintrag uebersprungen; aus dieser ' +
        'Aufnahme war zu diesem Zeitpunkt nichts hochgeladen.'
      : 'Beim Planen lag das Gedaechtnis mit der oben genannten sha256 vor. Jeder ' +
        'freigegebene Eintrag, dessen sha256 darin steht, ist uebersprungen worden ' +
        'und steht einzeln unter uebersprungen_hochgeladen.',
    freigaben_gesamt: gelesen.eintraege.length,
    freigaben_geplant: offen.length,
    freigaben_abgelehnt: abgelehnt,
    freigaben_uebersprungen: uebersprungen.length,
    // EINZELN, nicht gezaehlt. Eine Zahl "3 uebersprungen" laesst nicht
    // nachsehen, WELCHE drei -- und das ist die einzige Frage, die dazu je
    // gestellt wird.
    uebersprungen_hochgeladen: uebersprungen,
    termine: offen.map((e, i) => ({
      sha256: e.sha256,
      kennung: e.kennung,
      titel: e.titel,
      publish_at: new Date(termine[i]).toISOString(),
      publish_at_ortszeit: ortszeitText(termine[i]),
    })),
  };

  const nachpruefung = pruefePlan(plan, startpunkt, hochgeladen);
  if (nachpruefung.length) return { fehler: nachpruefung, plan };
  return { fehler: [], plan };
}

// DIE NACHPRUEFUNG. Sie glaubt der Rechnung oben NICHT, sondern liest die
// fertigen Zeitstempel noch einmal ein und laesst sich von Intl sagen, welche
// Ortszeit dahintersteht. Eine Verteilung, die um eine Stunde daneben liegt,
// faellt hier auf -- und nicht erst dem Zuschauer um 06:00 morgens.
// hochgeladen (Map sha256 -> Eintrag) ist wahlweise; wird sie mitgegeben,
// prueft die Nachpruefung ausserdem, dass kein uebersprungener Short doch einen
// Termin bekommen hat. Das ist nicht dieselbe Rechnung wie oben noch einmal,
// sondern dieselbe FRAGE ein zweites Mal -- diesmal an das fertige Ergebnis.
//
// DS: der zweite Parameter ist der FENSTERANFANG, nicht der Planungszeitpunkt.
// Vor DS waren die beiden immer dasselbe; seither ist der Fensteranfang der
// Startpunkt aus dem Anschluss, und gegen ihn laufen die Grenzen "mindestens
// eine Minute danach" und "hoechstens 24 Stunden danach". Dazu kommt die
// DS-Frage selbst: kein Termin darf auf oder vor dem letzten ausstehenden
// Termin liegen. Sie wird hier an den FERTIGEN Zeitstempeln gestellt und nicht
// aus der Rechnung oben abgelesen.
function pruefePlan(plan, fensteranfang, hochgeladen = null) {
  const fehler = [];
  const ende = fensteranfang + VORLAUF_MS;

  // DS: der Anschluss muss zu dem passen, wogegen hier geprueft wird. Stuende
  // im Kopf ein anderer Startpunkt als der, mit dem gerechnet wurde, waere der
  // Kopf eine Auskunft, die nichts belegt.
  const an = plan.anschluss;
  let ankerMs = null;
  if (an === undefined || an === null || typeof an !== 'object') {
    fehler.push('Der Plan traegt keinen anschluss-Block. Ohne ihn ist nicht zu sehen, ' +
      'woran er anschliesst.');
  } else {
    const kopfStart = Date.parse(an.startpunkt);
    if (!Number.isFinite(kopfStart) || kopfStart !== fensteranfang) {
      fehler.push('anschluss.startpunkt (' + an.startpunkt + ') ist nicht der Anfang des ' +
        'Fensters, gegen das hier geprueft wird (' + new Date(fensteranfang).toISOString() + ').');
    }
    if (an.letzter_ausstehender !== null && an.letzter_ausstehender !== undefined) {
      ankerMs = Date.parse(an.letzter_ausstehender.publish_at);
      if (!Number.isFinite(ankerMs)) {
        fehler.push('anschluss.letzter_ausstehender.publish_at ist kein Zeitstempel.');
        ankerMs = null;
      }
    }
    if (Array.isArray(an.ausstehende_termine) &&
        an.ausstehende_termine.length !== an.ausstehende_termine_gesamt) {
      fehler.push('anschluss: ausstehende_termine hat ' + an.ausstehende_termine.length +
        ' Eintraege, ausstehende_termine_gesamt sagt ' + an.ausstehende_termine_gesamt + '.');
    }
  }
  if (plan.termine.length !== plan.freigaben_geplant) {
    fehler.push('termine hat ' + plan.termine.length + ' Eintraege, freigaben_geplant sagt ' +
      plan.freigaben_geplant + '.');
  }
  if (Array.isArray(plan.uebersprungen_hochgeladen) &&
      plan.uebersprungen_hochgeladen.length !== plan.freigaben_uebersprungen) {
    fehler.push('uebersprungen_hochgeladen hat ' + plan.uebersprungen_hochgeladen.length +
      ' Eintraege, freigaben_uebersprungen sagt ' + plan.freigaben_uebersprungen + '.');
  }
  // Die Rechnung muss aufgehen: geplant + uebersprungen + abgelehnt sind alle
  // Eintraege der Freigabedatei. Geht sie nicht auf, ist irgendwo ein Short
  // stillschweigend verschwunden -- und das ist der Fehler, den man nicht sieht.
  if (typeof plan.freigaben_uebersprungen === 'number' &&
      plan.freigaben_geplant + plan.freigaben_uebersprungen + plan.freigaben_abgelehnt !==
        plan.freigaben_gesamt) {
    fehler.push('Die Rechnung geht nicht auf: ' + plan.freigaben_geplant + ' geplant + ' +
      plan.freigaben_uebersprungen + ' uebersprungen + ' + plan.freigaben_abgelehnt +
      ' abgelehnt ergibt nicht ' + plan.freigaben_gesamt + ' Eintraege der Freigabedatei.');
  }
  let vorher = null;
  plan.termine.forEach((t, i) => {
    const wo = 'termine[' + i + '] (' + t.kennung + ')';
    if (hochgeladen && hochgeladen.has(t.sha256)) {
      fehler.push(wo + ': dieser Short steht schon im Gedaechtnis und haette ' +
        'uebersprungen werden muessen. Ein Termin dafuer waere ein zweiter Upload ' +
        'desselben Videos.');
    }
    const ms = Date.parse(t.publish_at);
    if (!Number.isFinite(ms)) { fehler.push(wo + ': publish_at ist kein Zeitstempel.'); return; }
    if (vorher !== null && ms <= vorher) {
      fehler.push(wo + ': publish_at liegt nicht nach dem vorigen Termin. Bei dieser Anzahl ' +
        'und diesem Fenster faellt der Abstand unter eine Minute -- so viele Shorts passen ' +
        'nicht in das nutzbare Fenster.');
    }
    vorher = ms;
    if (ms < fensteranfang + MINUTE_MS) {
      fehler.push(wo + ': publish_at liegt weniger als eine Minute nach dem Anfang des Fensters.');
    }
    if (ms > ende) {
      fehler.push(wo + ': publish_at liegt spaeter als 24 Stunden nach dem Anfang des Fensters (' +
        t.publish_at_ortszeit + ').');
    }
    // DS: DIE FRAGE, WEGEN DER ES DEN ANSCHLUSS GIBT. Ein Termin auf oder vor
    // dem letzten ausstehenden waere eine Ueberlappung mit dem, was schon auf
    // dem Kanal steht -- und die sieht man einem Plan nicht an.
    if (ankerMs !== null && ms <= ankerMs) {
      fehler.push(wo + ': publish_at liegt nicht nach dem letzten ausstehenden Termin (' +
        an.letzter_ausstehender.publish_at_ortszeit + ' aus ' +
        an.letzter_ausstehender.aufnahme + '). Dieser Plan legte sich ueber Termine, die ' +
        'schon vergeben sind.');
    }
    const min = ortsminuten(ms);
    if (min < TAGESFENSTER_VON_MIN || min > TAGESFENSTER_BIS_MIN) {
      fehler.push(wo + ': publish_at liegt in Ortszeit ausserhalb 08:00-20:00 (' +
        t.publish_at_ortszeit + ').');
    }
    if (t.publish_at_ortszeit !== ortszeitText(ms)) {
      fehler.push(wo + ': publish_at_ortszeit passt nicht zu publish_at.');
    }
  });
  return fehler;
}

// ---------------------------------------------------------------------------
// SCHREIBEN
// ---------------------------------------------------------------------------
//
// ATOMAR: temporaere Datei im SELBEN Verzeichnis, fsync, dann umbenennen --
// dieselbe Bauart wie im Freigabe-Dienst. Ein halb geschriebener Plan waere ein
// Plan, dem man nicht ansieht, dass er halb ist.
let tmpZaehler = 0;

function schreibePlanAtomar(pfad, plan) {
  const inhalt = JSON.stringify(plan, null, 2) + '\n';
  const verzeichnis = path.dirname(pfad);
  fs.mkdirSync(verzeichnis, { recursive: true });
  const tmp = path.join(verzeichnis,
    '.' + path.basename(pfad) + '.tmp.' + process.pid + '.' + (++tmpZaehler));
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, inhalt, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, pfad);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (x) { /* egal */ } }
    try { fs.unlinkSync(tmp); } catch (x) { /* war nie da */ }
    throw e;
  }
  return inhalt;
}

// ---------------------------------------------------------------------------
// AUSGABE FUER MENSCHEN
// ---------------------------------------------------------------------------

function formatiere(plan) {
  const z = [];
  z.push('');
  z.push('Aufnahme:            ' + plan.aufnahme);
  z.push('Freigabedatei:       ' + plan.freigabedatei);
  z.push('  sha256:            ' + plan.freigabe_sha256);
  z.push('Gedaechtnis:         ' + plan.gedaechtnis_datei +
    (plan.gedaechtnis_vorhanden ? '' : '   (gab es nicht)'));
  z.push('  sha256:            ' + (plan.gedaechtnis_sha256 === null
    ? 'keines -- aus dieser Aufnahme war nichts hochgeladen'
    : plan.gedaechtnis_sha256));
  z.push('Planungszeitpunkt:   ' + plan.planungszeitpunkt + '   = ' + plan.planungszeitpunkt_ortszeit);
  if (plan.planungszeitpunkt_vorgegeben) {
    z.push('                     (vorgegeben mit --jetzt=, nicht die Uhr dieses Rechners)');
  }
  // DS: WORAN DIESER PLAN ANSCHLIESST -- oben, vor allen Zahlen. Wer den Plan
  // ansieht, soll nicht erst unten in der Terminliste merken, dass er
  // irgendwo anders anfaengt als heute.
  const an = plan.anschluss;
  z.push('Fensteranfang:       ' + an.startpunkt + '   = ' + an.startpunkt_ortszeit);
  if (an.grund === 'jetzt') {
    z.push('                     Grund: JETZT. In keiner Gedaechtnisdatei steht ein Termin,');
    z.push('                     der noch aussteht.');
  } else {
    const l = an.letzter_ausstehender;
    z.push('                     Grund: ANSCHLUSS an den letzten ausstehenden Termin --');
    z.push('                     das Fenster beginnt dort und nicht bei "jetzt".');
    z.push('                       Aufnahme:   ' + l.aufnahme);
    z.push('                       Kennung:    ' + l.kennung);
    z.push('                       publish_at: ' + l.publish_at + '   = ' + l.publish_at_ortszeit);
    z.push('                       laut:       ' + l.gedaechtnis_datei);
  }
  z.push('Fensterende (+24 h): ' + plan.fenster.ende + '   = ' + plan.fenster.ende_ortszeit);
  z.push('Zeitzone:            ' + plan.zeitzone + '  (' + plan.fenster.versatz_am_anfang +
    ' -> ' + plan.fenster.versatz_am_ende + ')');
  if (plan.fenster.sommerzeitwechsel_im_fenster) {
    z.push('                     ACHTUNG: im Fenster liegt eine Zeitumstellung. Das');
    z.push('                     24-Stunden-Fenster ist in Ortszeit deshalb nicht 24 Stunden lang.');
  }
  z.push('');
  z.push('Nutzbare Abschnitte (24-h-Fenster geschnitten mit 08:00-20:00 Ortszeit):');
  for (const a of plan.fenster.abschnitte) {
    z.push('  ' + a.datum + '   ' + a.von_ortszeit.slice(11, 16) + ' bis ' +
      a.bis_ortszeit.slice(11, 16) + '   ' + String(a.minuten).padStart(4) + ' Minuten');
  }
  z.push('  ' + '-'.repeat(43));
  z.push('  Summe' + ' '.repeat(26) + String(plan.fenster.nutzbare_minuten).padStart(4) + ' Minuten');
  z.push('');
  // DS: die ausstehenden Termine EINZELN. Wer nur die Zahl sieht, kann eine
  // Ueberlappung nicht erkennen -- und genau die hat am 02.09.2026 niemand
  // erkannt, weil die alten Termine nirgends standen.
  z.push('Ausstehende Termine aus frueheren Laeufen: ' + an.ausstehende_termine_gesamt +
    '   (gelesen: ' + (an.gelesene_gedaechtnisdateien.length === 0
      ? 'keine Gedaechtnisdatei'
      : an.gelesene_gedaechtnisdateien.length + ' Gedaechtnisdatei(en)') + ')');
  for (const d of an.gelesene_gedaechtnisdateien) z.push('  gelesen: ' + d);
  for (const a of an.ausstehende_termine) {
    z.push('  offen:   ' + a.publish_at + '  ' + a.publish_at_ortszeit + '   ' + a.kennung);
  }
  // DIE GRENZE. Sie steht hier, wo der Plan angesehen wird, und nicht als
  // Fussnote irgendwo hinten.
  z.push('');
  z.push('GRENZE:');
  for (const zeile of umbrich(an.grenze, 70)) z.push('  ' + zeile);
  z.push('');
  z.push('Eintraege der Freigabedatei: ' + plan.freigaben_gesamt +
    '   geplant: ' + plan.freigaben_geplant +
    '   abgelehnt: ' + plan.freigaben_abgelehnt +
    '   schon hochgeladen: ' + plan.freigaben_uebersprungen);
  z.push('Abstand: ' + plan.fenster.nutzbare_minuten + ' Minuten / (' +
    plan.freigaben_geplant + ' + 1) = ' + plan.fenster.abstand_minuten + ' Minuten');
  if (plan.freigaben_uebersprungen > 0) {
    // EINZELN. Wer hier "3 uebersprungen" liest und die drei nicht sieht, muss
    // in einer JSON-Datei nachschlagen, um zu erfahren, welche Shorts heute
    // NICHT online gehen.
    z.push('');
    z.push('Uebersprungen -- steht schon im Gedaechtnis, also schon hochgeladen:');
    for (const u of plan.uebersprungen_hochgeladen) {
      z.push('  - ' + u.kennung + '   schon hochgeladen' +
        (u.hochgeladen_am ? ' am ' + u.hochgeladen_am : ''));
      z.push('      ' + u.titel);
    }
    z.push('  Fuer diese Shorts entsteht KEIN zweiter Termin: das waere ein zweiter Upload.');
  }
  z.push('');
  z.push('   #  publish_at (verbindlich)  Ortszeit ' + ZONE);
  z.push('      Kennung / Titel');
  z.push('  ' + '-'.repeat(74));
  // DS: DIE NAHT. Der letzte ausstehende Termin steht als erste Zeile der
  // Tabelle -- mit "--" statt einer Nummer, weil er nicht zu diesem Plan
  // gehoert. Wer die Tabelle ansieht, sieht damit unmittelbar, woran der erste
  // neue Termin anschliesst; eine Ueberlappung faellt in derselben Zeile auf.
  if (an.letzter_ausstehender !== null) {
    const l = an.letzter_ausstehender;
    const ersteMs = plan.termine.length ? Date.parse(plan.termine[0].publish_at) : null;
    const ankerMs = Date.parse(l.publish_at);
    z.push('  --  ' + l.publish_at + '  ' + l.publish_at_ortszeit);
    z.push('      ' + l.kennung + '  |  steht schon auf dem Kanal (' + l.gedaechtnis_datei + ')');
    if (ersteMs !== null) {
      z.push('      ' + '.'.repeat(6) + ' Abstand bis zum ersten neuen Termin: ' +
        Math.round((ersteMs - ankerMs) / MINUTE_MS) + ' Minuten (Uhrzeit), ' +
        plan.fenster.abstand_minuten + ' Minuten nutzbare Zeit');
    }
    z.push('  ' + '-'.repeat(74));
  }
  plan.termine.forEach((t, i) => {
    z.push('  ' + String(i + 1).padStart(2) + '  ' + t.publish_at + '  ' + t.publish_at_ortszeit);
    z.push('      ' + t.kennung + '  |  ' + t.titel);
  });
  z.push('');
  return z.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function wertVon(argv, praefix) {
  const t = argv.slice(2).find((a) => a.startsWith(praefix));
  return t === undefined ? null : t.slice(praefix.length);
}

function main() {
  const argv = process.argv;
  const projektwurzel = path.join(__dirname, '..', '..');
  const alsJson = argv.includes('--json');
  const execute = argv.includes('--execute');

  const aufnahme = wertVon(argv, '--freigabe=');
  if (!aufnahme) {
    // Kein Einsammeln, kein Ordner absuchen, kein Erraten -- dieselbe Regel wie
    // beim Leser. Wer nichts benennt, plant nichts.
    console.error('\nAbbruch: --freigabe= fehlt.');
    console.error('Der Planer sucht sich keine Freigabedatei. Er plant genau die eine,');
    console.error('die im Aufruf steht.\n');
    console.error('  npm run shorts:planen -- --freigabe="2026-08-31 17-36-21"');
    console.error('  node src/upload/planer.js --freigabe="2026-08-31 17-36-21" --execute\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }
  if (!AUFNAHME_FORM.test(aufnahme)) {
    console.error('\nAbbruch: --freigabe=' + JSON.stringify(aufnahme) +
      ' hat nicht die Form JJJJ-MM-TT HH-MM-SS.');
    console.error('Es wird kein Dateiname daraus gebaut und nichts gelesen.\n');
    process.exit(EXIT_AUFRUFFEHLER);
  }

  const jetzt = Date.now();
  let planungszeitpunkt = jetzt;
  let vorgegeben = false;
  const jetztArg = wertVon(argv, '--jetzt=');
  if (jetztArg !== null) {
    if (!ISO_MIT_VERSATZ.test(jetztArg)) {
      console.error('\nAbbruch: --jetzt=' + JSON.stringify(jetztArg) +
        ' ist keine ISO-8601-Zeit MIT Zonenversatz.');
      console.error('Ohne Versatz waere die Angabe genau das, wogegen dieses Skript gebaut ist:');
      console.error('eine Ortszeit ohne Zone. Beispiel: --jetzt=2026-09-01T17:00:00+02:00\n');
      process.exit(EXIT_AUFRUFFEHLER);
    }
    planungszeitpunkt = Date.parse(jetztArg);
    if (!Number.isFinite(planungszeitpunkt)) {
      console.error('\nAbbruch: --jetzt=' + JSON.stringify(jetztArg) + ' ist kein Zeitpunkt.\n');
      process.exit(EXIT_AUFRUFFEHLER);
    }
    vorgegeben = true;
  }

  const sperre = sperreFuer(aufnahme);
  if (sperre) {
    // Die Sperre steht VOR dem Lesen der Freigabedatei. Eine gesperrte Aufnahme
    // wird nicht erst gelesen, gerechnet und dann verworfen -- sie wird gar
    // nicht angefasst.
    console.error('');
    console.error('ABBRUCH: Diese Aufnahme ist zum Planen GESPERRT.');
    console.error('');
    console.error('  Aufnahme: ' + sperre.aufnahme);
    console.error('  Grund:');
    for (const zeile of umbrich(sperre.grund, 68)) console.error('    ' + zeile);
    console.error('');
    console.error('Es wurde nichts gelesen, nichts gerechnet und keine Planungsdatei angelegt.');
    console.error('Die Sperre steht in GESPERRTE_AUFNAHMEN in src/upload/planer.js. Es gibt');
    console.error('kein Flag, das sie uebergeht: wer sie aufheben will, aendert die Liste.');
    console.error('');
    process.exit(EXIT_GESPERRT);
  }

  const quelle = freigabePfad(projektwurzel, aufnahme);
  if (!fs.existsSync(quelle)) {
    console.error('\nAbbruch: Freigabedatei nicht gefunden:\n  ' + quelle + '\n');
    process.exit(EXIT_MANGEL);
  }

  // BESTEHENDER PLAN -- die Pruefung steht VOR dem Rechnen und gilt auch im
  // Trockenlauf. Ein Trockenlauf, der "ginge" sagt und dessen scharfer Lauf
  // dann scheitert, ist kein Trockenlauf.
  //
  // ENTSCHEIDUNG: Der Planer ueberschreibt NICHT und legt auch keine zweite
  // Fassung daneben. Er bricht ab. Begruendung im Bericht DN, Entscheidung 2.
  const ziel = planPfad(projektwurzel, aufnahme);
  if (fs.existsSync(ziel)) {
    console.error('');
    console.error('ABBRUCH: Fuer diese Aufnahme gibt es schon einen Plan.');
    console.error('');
    console.error('  ' + ziel);
    console.error('');
    console.error('Er wird nicht ueberschrieben. Ein Plan ist spaeter der Beleg dafuer, was');
    console.error('wann hochgeladen werden sollte; ihn zu ersetzen loescht diesen Beleg, und');
    console.error('zwar genau dann, wenn man ihn braucht -- naemlich wenn etwas schiefging.');
    console.error('');
    console.error('Wer neu planen will, raeumt den alten Plan selbst weg (verschieben, nicht');
    console.error('loeschen). Das ist ein Handgriff, den ein Mensch bewusst macht. Es gibt');
    console.error('hier absichtlich kein --ersetzen: ein Flag waere ein zweiter Weg, den Beleg');
    console.error('zu verlieren, und der erste war schon einer zu viel.');
    console.error('');
    process.exit(EXIT_MANGEL);
  }

  // GELESEN, NICHT GESCHRIEBEN. readFileSync ist der einzige Zugriff dieses
  // Programms auf die Freigabedatei. Es gibt in dieser Datei kein
  // writeFileSync, das auf data/freigaben zeigt, und das ist Absicht -- die
  // Begruendung steht ueber leseFreigabe.
  let freigabeText;
  try {
    freigabeText = fs.readFileSync(quelle, 'utf8');
  } catch (e) {
    console.error('\nAbbruch: Freigabedatei nicht lesbar (' + e.code + '):\n  ' + quelle + '\n');
    process.exit(EXIT_MANGEL);
  }

  // DS: DAS GEDAECHTNIS -- ALLE Dateien, nicht nur die eigene.
  //
  // Das ist der einzige Plattenzugriff auf data/uploads/ in diesem Programm,
  // und er ist LESEND. Es gibt hier kein writeFileSync, das dorthin zeigt: das
  // Gedaechtnis gehoert dem Uploader, und wer darin herumschreibt, faelscht den
  // Beleg dafuer, was wirklich auf dem Kanal steht.
  //
  // Aus derselben Lesung kommen zwei verschiedene Auskuenfte:
  //   - das eigene Gedaechtnis: WAS aus DIESER Aufnahme schon hochgeladen ist
  //     (daraus werden Eintraege uebersprungen -- seit DOa);
  //   - die ausstehenden Termine ALLER Aufnahmen: WORAN dieser Plan anschliesst
  //     (daraus kommt der Startpunkt des Fensters -- seit DS).
  // Gelesen wird jede Datei genau einmal. Zwei Lesungen derselben Datei koennten
  // auseinanderlaufen, und dann stuende im Kopf etwas anderes, als gerechnet wurde.
  const gVerzeichnis = gedaechtnisVerzeichnis(projektwurzel);
  const verzeichnis = leseGedaechtnisverzeichnis(gVerzeichnis);
  if (verzeichnis.fehler.length) {
    console.error('');
    console.error('ABBRUCH: die Gedaechtnisdateien liessen sich nicht vollstaendig lesen.');
    console.error('');
    druckeFehlerliste(verzeichnis.fehler);
    console.error('');
    console.error('Es wurde keine Planungsdatei angelegt. Eine uebergangene Gedaechtnisdatei');
    console.error('sieht aus wie "nichts ausstehend" -- und dann legt sich der Plan ueber');
    console.error('Termine, die schon vergeben sind.');
    console.error('');
    process.exit(EXIT_MANGEL);
  }

  const gesammelt = sammleAusstehende(verzeichnis.dateien, planungszeitpunkt);
  if (gesammelt.fehler.length) {
    console.error('');
    console.error('ABBRUCH: eine Gedaechtnisdatei ist nicht zu lesen.');
    console.error('');
    druckeFehlerliste(gesammelt.fehler);
    console.error('');
    console.error('Solange nicht feststeht, welche Termine noch ausstehen, entsteht kein Plan.');
    console.error('');
    process.exit(EXIT_MANGEL);
  }

  // Das eigene Gedaechtnis wird aus derselben Lesung geholt -- ueber den Pfad,
  // den gedaechtnisPfad aus der FORM des Aufnahmenamens baut, nicht ueber einen
  // Namensvergleich. Ist es nicht dabei, gab es keines: kein Mangel, sondern der
  // Normalfall vor dem ersten Upload.
  const eigenerPfad = gedaechtnisPfad(projektwurzel, aufnahme);
  const eigenes = verzeichnis.dateien.find((d) => d.pfad === eigenerPfad) || null;
  const gedaechtnisText = eigenes === null ? null : eigenes.text;

  const ergebnis = planeAufnahme({
    aufnahme, freigabeText, gedaechtnisText, planungszeitpunkt, vorgegeben, jetzt,
    ausstehende: gesammelt.ausstehend,
    gedaechtnisdateien: verzeichnis.dateien.map((d) => d.datei),
  });

  // ALLES SCHON HOCHGELADEN. Kein Plan, keine leere Datei, Klartext.
  //
  // WARUM DER RUECKGABEWERT 1 (BEFUND) IST UND NICHT 0: Das Programm hat die
  // Lage angesehen und legt nichts an -- genau das sagt BEFUND, und der Grund
  // liegt im Zustand der Platte. Vor allem aber: wer "planen && hochladen"
  // hintereinanderhaengt, muss hier stehenbleiben. Mit 0 liefe der Uploader los
  // und suchte einen Plan, den es nicht gibt. Kaputt ist nichts, und die
  // Ausgabe sagt das auch -- sie geht darum auf stdout und nicht auf stderr.
  if (ergebnis.alles_hochgeladen) {
    const a = ergebnis.alles_hochgeladen;
    if (alsJson) {
      console.log(JSON.stringify({
        ergebnis: 'alles_hochgeladen',
        aufnahme: a.aufnahme,
        plan_geschrieben: false,
        freigegeben: a.freigegeben,
        uebersprungen_hochgeladen: a.uebersprungen,
        gedaechtnis_datei: 'data/uploads/' + a.aufnahme + '.json',
        gedaechtnis_sha256: a.gedaechtnis_sha256,
      }, null, 2));
    } else {
      console.log('');
      console.log('KEIN PLAN: alle freigegebenen Shorts dieser Aufnahme sind schon hochgeladen.');
      console.log('');
      console.log('  Aufnahme:                ' + a.aufnahme);
      console.log('  Freigegeben:             ' + a.freigegeben);
      console.log('  Davon schon hochgeladen: ' + a.uebersprungen.length);
      console.log('  Gedaechtnis:             data/uploads/' + a.aufnahme + '.json');
      console.log('    sha256:                ' + a.gedaechtnis_sha256);
      console.log('');
      for (const u of a.uebersprungen) {
        console.log('  - ' + u.kennung + '   schon hochgeladen' +
          (u.hochgeladen_am ? ' am ' + u.hochgeladen_am : ''));
        console.log('      ' + u.titel);
      }
      console.log('');
      console.log('Es wurde KEINE Planungsdatei angelegt -- auch keine leere. Eine Datei mit');
      console.log('null Terminen waere spaeter nicht von einem Plan zu unterscheiden, der nie');
      console.log('etwas zu tun hatte.');
      console.log('');
      console.log('Die Freigabedatei wurde nur gelesen. Wer diese Aufnahme wirklich noch einmal');
      console.log('hochladen will, raeumt das Gedaechtnis weg (verschieben, nicht loeschen: es');
      console.log('traegt die videoIds) -- die Freigabedatei bleibt, wie sie ist.');
      console.log('');
    }
    process.exit(EXIT_MANGEL);
  }

  if (ergebnis.fehler.length) {
    console.error('');
    console.error('ABBRUCH: der Plan wurde nicht erstellt.');
    console.error('');
    druckeFehlerliste(ergebnis.fehler);
    console.error('');
    console.error('Es wurde keine Planungsdatei angelegt.');
    console.error('');
    process.exit(EXIT_MANGEL);
  }

  const plan = ergebnis.plan;
  if (alsJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(formatiere(plan));
  }

  if (!execute) {
    console.log('TROCKENLAUF: es wurde NICHTS geschrieben.');
    console.log('Der Plan oben entsteht als Datei erst mit --execute:');
    console.log('  node src/upload/planer.js --freigabe="' + aufnahme + '" --execute');
    console.log('');
    process.exit(EXIT_OK);
  }

  schreibePlanAtomar(ziel, plan);
  console.log('GESCHRIEBEN: ' + ziel);
  console.log(plan.termine.length + ' Termine. Verbindlich ist publish_at (UTC), nicht die Ortszeit.');
  console.log('');
  process.exit(EXIT_OK);
}

// Eine Liste von Gruenden, jeder mit Spiegelstrich und umgebrochen. Sie steht
// an EINER Stelle, weil es seit DS drei Stellen gibt, die abbrechen -- und drei
// Abbrueche, die verschieden aussehen, liest man als drei verschiedene Lagen.
function druckeFehlerliste(fehler) {
  for (const f of fehler) {
    const zeilen = umbrich(f, 72);
    console.error('  - ' + zeilen[0]);
    for (const z of zeilen.slice(1)) console.error('    ' + z);
  }
}

// Umbruch fuer lange Meldungen. Eine Begruendung, die als eine Zeile von 400
// Zeichen im Terminal ankommt, wird nicht gelesen.
function umbrich(text, breite) {
  const zeilen = [];
  let aktuell = '';
  for (const wort of String(text).split(/\s+/)) {
    if (!aktuell.length) { aktuell = wort; continue; }
    if ((aktuell + ' ' + wort).length > breite) { zeilen.push(aktuell); aktuell = wort; }
    else aktuell += ' ' + wort;
  }
  if (aktuell.length) zeilen.push(aktuell);
  return zeilen;
}

if (require.main === module) main();

module.exports = {
  ZONE, TAGESFENSTER_VON_MIN, TAGESFENSTER_BIS_MIN, VORLAUF_MS, MINUTE_MS,
  PLAN_ARTIFACT_TYPE, PLAN_SCHEMA_VERSION,
  FREIGABE_ARTIFACT_TYPE, BEKANNTE_FREIGABE_VERSIONEN,
  GEDAECHTNIS_ARTIFACT_TYPE, BEKANNTE_GEDAECHTNIS_VERSIONEN,
  ERLAUBTE_ARGUMENTE, EXIT_OK, EXIT_MANGEL, EXIT_AUFRUFFEHLER, EXIT_GESPERRT,
  GESPERRTE_AUFNAHMEN, pruefeSperrliste, sperreFuer,
  zonenTeile, versatzMinuten, versatzText, instantsFuerOrtszeit, ortszeitText, ortsminuten,
  nutzbareAbschnitte, verteile,
  freigabePfad, planPfad, gedaechtnisPfad, leseFreigabe, leseGedaechtnis,
  gedaechtnisVerzeichnis, leseGedaechtnisverzeichnis, sammleAusstehende,
  bestimmeStartpunkt, GRENZE_HANDPLANUNG, ISO_UTC,
  planeAufnahme, pruefePlan,
  schreibePlanAtomar, formatiere, umbrich, druckeFehlerliste,
};
