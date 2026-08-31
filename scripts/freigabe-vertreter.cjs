'use strict';

// DF Teil 1: Der Vertreterkatalog des Freigabe-Checks.
//
// WARUM EIGENE DATEI. In DE ist aufgefallen, dass die Vertreter zwei Stunden
// NACH den Mustern entstanden und auf den reparierten Musterwortlaut hin
// geschrieben wurden. Eine Selbstpruefung, deren Vertreter aus dem Muster
// stammen, beweist nur, dass das Muster findet, was sein Autor im Sinn hatte.
// Diese Datei wurde deshalb VOLLSTAENDIG geschrieben, BEVOR eine einzige Zeile
// an den Pfadmustern in freigabe-check.cjs geaendert wurde. Sie ist die
// Vorgabe, nicht das Echo.
//
// HERKUNFT DER PFADVERTRETER. Die Positivvertreter der Pfadmuster stammen aus
// echten Pfadformen DIESER Umgebung (Laufwerke F:, P:, C:, Netzfreigaben,
// JSON-maskierte Pfade aus den Uebergabedateien) -- die Ordnernamen sind
// erfunden variiert. Kein Wert unten ist ein echter Pfad, eine echte ID oder
// ein echtes Geheimnis. DFa (2026-08-31) laesst das nicht mehr nur behaupten:
// katalogHygiene() in freigabe-check.cjs prueft es vor jedem Lauf nach.
//
// AUFBAU. Je Pruefart:
//   VERTRETER[name]         Zeilen, die genau dieses Muster melden MUSS.
//   NEGATIVKONTROLLEN[name] Zeilen, auf die KEIN Muster anschlagen darf.
// Die Zuordnung einer Negativkontrolle zu einem Namen sagt nur, WESSEN
// Gegenrichtung sie absichert -- geprueft wird jede gegen ALLE Muster. Punkt 5
// des Auftrags: fehlt einer Pruefart eines von beidem, bricht der Check mit
// Exit 2 ab, bevor er irgendeine Datei ansieht.
// Dazu seit DFa BINAER_PROBEN -- Proben, die BEIDE Richtungen der
// Binaerheuristik in einem Eintrag festhalten (siehe dort).
//
// Diese Datei enthaelt erfundene absolute Pfade und wird deshalb vom eigenen
// Muster gefunden. Sie hat dafuer eine benannte, begruendete Ausnahme in
// freigabe-check.cjs (AUSNAHMEN) -- keinen stillen Filter im Muster.

const R = String.raw;

// ---------------------------------------------------------------------------
// Positivvertreter
// ---------------------------------------------------------------------------
const VERTRETER = {
  // Die sieben Formen, die heute nachweislich durchrutschen (DE, Abschnitt D3:
  // 24 echte Pfade dieses Rechners blieben unentdeckt), plus die Randfaelle.
  'absoluter Laufwerkspfad': [
    R`F:\Video Rohablage\irgendwas`,                 // Leerzeichen im Ordnernamen
    R`P:\MatrixMarketAutoEditor\irgendwas`,          // Nachbarrepo, kein bekannter Ordnername
    R`C:\Program Files\irgendwas`,                   // Systemordner mit Leerzeichen
    R`f:\kleingeschrieben\irgendwas`,                // Kleinbuchstabe als Laufwerk
    'F:/mit-schraegstrich/irgendwas',                // Schraegstrich statt Backslash
    R`F:\\json-maskiert\\irgendwas`,                 // doppelte Backslashes wie in JSON
    R`P:\Erfundenwithin-Thumbnail-Beispiel\scripts`, // Projektordnerform, erfunden variiert
    R`C:\Users\erfundenernutzer\AppData\Local`,      // Heimatordner
    'D:/erfunden/state-repo',                        // Laufwerk, das der Check heute nicht kennt
    R`Q:\a`,                                         // Untergrenze: ein einziges Zeichen dahinter
    // Punkt 3 in der Gegenrichtung: ein echter Pfad im Klartext UNMITTELBAR
    // neben einer data:-URI muss weiterhin gefunden werden. Wer den Base64-
    // Nutzlastteil zu gierig ueberspringt, baut ein Loch statt eines Filters --
    // dieser Vertreter faellt dann durch.
    R`<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="> F:\Video Rohablage\danebenliegend`,
  ],

  // Der echte UNC-Pfad. In DE hat das breite UNC-Probemuster 16 Falschtreffer
  // erzeugt; die Gegenrichtung dazu steht unten in NEGATIVKONTROLLEN.
  'UNC-Pfad': [
    R`\\rechnername\freigabe\irgendwas`,
    R`\\erfundenserver\shorts-ablage`,
    R`\\\\rechner2\\freigabe\\json-maskiert`,        // UNC-Pfad, wie er in JSON steht
    R`\\ab\c`,                                       // Untergrenze: Name aus genau zwei Zeichen
  ],

  // Inhaltlich unveraendert uebernommen (Auftrag Punkt 2, letzter Absatz) --
  // aber ab jetzt gegen Vertreter UND Negativkontrolle gestellt.
  'absoluter Unix-Heimpfad': [
    '/home/erfundenernutzer/repo/',
    '/home/erfunden',                                // ohne abschliessenden Schraegstrich
    '/Users/erfundenernutzer/Projekte/beispiel',
  ],

  'Playlist-ID': ['PLerfundenErfundenErfundenAb'],
  'Kanal-ID': ['UCerfundenErfundenErfun2'],
  'OAuth-Zugriffstoken': ['ya29.erfundenErfundenErfunden'],
  'Google-Client-Secret': ['GOCSPX-erfundenErfunden'],
  'Anthropic-Schluessel': ['sk-ant-erfundenErfundenErfunden'],
  'Client-ID': ['1234567890123-erfundenabcdefghijklmno.apps.googleusercontent.com'],

  // Sonderpruefart 1: .env-Schluessel mit Vorgabewert im Quelltext.
  '.env-Vorgabewert': [
    "YOUTUBE_CLIENT_SECRET = 'erfunden'",
    'INNER_CIRCLE_PLAYLIST_ID: "erfunden"',
  ],

  // Sonderpruefart 2: Abgleich gegen die bekannten IDs aus .env und Messdaten.
  // Der Vertreter ist die Zeile mit der erfundenen ID; der Check stellt diese
  // ID beim Selbsttest in die Vergleichsliste (siehe BEKANNTE_ID_PROBE).
  'bekannte ID': ["const x = 'ERFUNDEN1234';"],
};

// Die erfundene ID, die der Check fuer die Selbstpruefung in die
// Vergleichsliste stellt. Steht hier, damit Vertreter und Probewert nicht
// auseinanderlaufen koennen.
const BEKANNTE_ID_PROBE = 'ERFUNDEN1234';

// Ein einzelnes NUL-Byte, aus dem Zeichencode gebaut statt als Textliteral
// geschrieben. So enthaelt DIESE Datei selbst kein NUL und bleibt eine
// Textdatei, die voll geprueft wird -- sonst haette der Katalog sich mit der
// Heuristik, die er beweisen soll, selbst aus der Pruefung genommen.
const NUL = String.fromCharCode(0);

// ---------------------------------------------------------------------------
// Binaerproben -- DFa (2026-08-31), Auftrag Punkt 1b
// ---------------------------------------------------------------------------
// Die Musterpruefung ueberspringt ab jetzt Dateien mit einem NUL-Byte im
// Inhalt. Grund: die 19 PNG-Fundzeilen aus DF sind Zufallsfolgen aus
// komprimierten Bilddaten, kein einziger echter Pfad -- sie ertraenken jeden
// echten Fund.
//
// Eine Heuristik, die etwas ueberspringt, ist ein Loch, solange niemand beide
// Richtungen misst. Sie steht deshalb hier mit eigener Beweislast, und zwar in
// BEIDE Richtungen in EINEM Eintrag:
//   meldet      Pruefarten, die auf diesem Wert anschlagen MUESSEN.
//   meldetNicht Pruefarten, die auf diesem Wert NICHT anschlagen duerfen.
// Der ID-Abgleich ist von der Heuristik ausdruecklich NICHT betroffen: er
// laeuft auch ueber Binaerdateien und ueber den vollen, unveraenderten Inhalt.
const BINAER_PROBEN = [
  {
    // Ein Puffer, wie ihn eine PNG-Datei liefert: NUL-Bytes im Inhalt, darin
    // ein Klartextpfad UND die bekannte Probe-ID. Der Pfad darf NICHT gemeldet
    // werden -- sonst greift die Heuristik nicht. Die ID MUSS gemeldet werden
    // -- sonst haette die Heuristik den ID-Abgleich mit abgeschaltet, und
    // genau das waere ein Loch, in dem sich etwas Echtes verstecken koennte.
    name: 'Binaerpuffer mit Klartextpfad und bekannter ID',
    wert:
      'PNG\r\n\u001a\n' + NUL + NUL + NUL + 'IHDR' +
      R` F:\Video Rohablage\danebenliegend ` +
      BEKANNTE_ID_PROBE + NUL + NUL,
    meldet: ['bekannte ID'],
    meldetNicht: ['absoluter Laufwerkspfad'],
  },
  {
    // Die Gegenrichtung: ungewoehnliche Zeichen allein machen eine Datei NICHT
    // binaer. Umlaute, ANSI-Steuerzeichen und das Ersatzzeichen kommen in
    // echten Textdateien vor -- solange kein NUL darin steht, wird voll
    // geprueft. Faellt diese Probe durch, ist die Heuristik zu breit geworden.
    name: 'Text mit ungewoehnlichen Zeichen, aber ohne NUL',
    wert:
      'Umlaute \u00e4\u00f6\u00fc, Steuerzeichen \u0001\u0002\u001b[31m, ' +
      'Ersatzzeichen \ufffd, danach ein Pfad: ' +
      R`P:\Erfundenwithin-Thumbnail-Beispiel\scripts`,
    meldet: ['absoluter Laufwerkspfad'],
    meldetNicht: [],
  },
];

// ---------------------------------------------------------------------------
// Negativkontrollen -- kein Muster darf hier anschlagen
// ---------------------------------------------------------------------------
const NEGATIVKONTROLLEN = {
  'absoluter Laufwerkspfad': [
    'https://i.ytimg.com/vi/BEISPIELVIDEO/hqdefault.jpg',   // URL, kein Pfad
    'http://127.0.0.1:8765/oauth2callback',                 // Port, kein Laufwerk
    './thumbnail-source',                                   // relativer Pfad
    '../thumbnail-agent-state',                             // relativer Pfad nach oben
    'siehe Abschnitt C: Freigabe',                          // Doppelpunkt ohne Trenner dahinter
  ],

  // Genau die Formen, an denen das breite UNC-Probemuster in DE gescheitert
  // ist: doppelt escapte Backslashes aus JavaScript- und Python-Regexen. Sie
  // stehen hier als das, was sie in der Datei sind -- zwei Backslashes.
  'UNC-Pfad': [
    R`\\b`,
    R`\\s+`,
    R`\\d`,
    R`\\.`,
    R`\\'`,
    R`\\]`,
    R`\\$&`,
    R`\\{1,2}`,
    R`const re = new RegExp('\\s+garant', 'i');`,
    R`text.replace(/x/g, '\\$&');`,
    R`if (p.match(/[\\/][^"']*/)) return;`,
    'https://dimensionwithin-reviews.com/index.html',
    './thumbnail-source',
  ],

  'absoluter Unix-Heimpfad': [
    'https://example.invalid/home',        // /home ohne Trenner dahinter
    './home-verzeichnis',                  // Bindestrich statt Trenner
    'const dir = os.homedir();',
  ],

  'Playlist-ID': [
    'const PLAYLIST_SIZE_WARN = 200;',     // reiner Grossbuchstaben-Bezeichner
    // Punkt 3: eine Zufallsfolge mitten in einer Base64-Nutzlast. In DE hat
    // genau diese Form die Fehlalarme in thumbnail-compositor.html erzeugt.
    "src: url(data:font/woff2;base64,PLerfundenBase64FolgeAbcdefgh) format('woff2');",
  ],

  'Kanal-ID': [
    'const UC_STATE_MAX = 5;',
    '<img src="data:image/png;base64,UCerfundenBase64FolgeAbcdef">',
  ],

  'OAuth-Zugriffstoken': [
    'const ya29 = null;',                  // kein Punkt hinter ya29
    "if (name.endsWith('.ya29')) return;",
  ],

  'Google-Client-Secret': ['const GOCSPX = process.env.YOUTUBE_CLIENT_SECRET;'],

  'Anthropic-Schluessel': ["const modell = 'sk-ant-kurz';"],  // zu kurz fuer das Muster

  'Client-ID': [
    'https://accounts.google.com/o/oauth2/v2/auth',
    "const host = 'apps.googleusercontent.com';",
  ],

  '.env-Vorgabewert': [
    'const env = { YOUTUBE_CLIENT_ID: "" };',        // leeres Literal ist kein Vorgabewert
    'const id = process.env.INNER_CIRCLE_PLAYLIST_ID;',
  ],

  'bekannte ID': ["const x = 'harmlos-und-erfunden';"],
};

module.exports = { VERTRETER, NEGATIVKONTROLLEN, BEKANNTE_ID_PROBE, BINAER_PROBEN };
