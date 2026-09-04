'use strict';

// ---------------------------------------------------------------------------
// EP: DER KANAL -- DIE EINZIGE STELLE, AN DER EIN AUFRUFNAME DER API STEHT
// ---------------------------------------------------------------------------
//
// WARUM DIESES MODUL UEBERHAUPT EXISTIERT.
//
// Ab EP schreibt dieser Weg auf einen echten Kanal. Die Frage, die ein Mensch
// dann stellt, ist nicht "ist der Code sauber", sondern: WAS KANN DIESES
// PROGRAMM AUF DEM KANAL TUN? Diese Frage soll sich beantworten lassen, indem
// man EINE Datei liest, und diese ist es. Hier stehen alle Aufrufnamen, hier
// wird `googleapis` geladen, hier steht das Literal `private`, und hier steht
// die Zaehlung, die einen zweiten Upload unmoeglich macht.
//
//   - EU: DER AUFRUF, DER EIN VIDEO OEFFENTLICH STELLT, STEHT JETZT HIER.
//     Bis EU stand an dieser Stelle der Satz, dass er hier NICHT vorkommt --
//     "nicht aufgerufen, nicht vorbereitet, und auch nicht als Name". Dieser
//     Satz ist nicht mehr wahr und wird darum BERICHTIGT statt weiter
//     behauptet. Was an seine Stelle tritt, ist enger als "es gibt ihn jetzt":
//
//       Er hat GENAU EINE Gestalt, und sie nimmt KEINEN Anfragekoerper
//       entgegen. Wer ihn aufruft, gibt ihm die videoId und den Statusblock,
//       den unmittelbar zuvor `videos.list` geliefert hat -- und sonst nichts.
//       Den Koerper baut baueStatusKoerper() weiter unten, an genau einer
//       Stelle, aus genau diesem Block. Es gibt keinen Weg, diesen Aufruf mit
//       einem selbstgebauten, unvollstaendigen Koerper zu machen: der
//       Parameter dafuer existiert nicht.
//
//     WARUM DAS DIE GANZE SACHE IST. Die Dokumentation zu `videos.update`
//     sagt, dass jedes veraenderbare Feld eines im `part` genannten Teils
//     GELOESCHT wird, wenn es im Koerper fehlt (Vertrag 2.5, dort woertlich
//     zitiert). Ein Aufruf, der nur `privacyStatus` schickt, loescht also
//     stillschweigend `embeddable`, `license`, `publicStatsViewable`,
//     `selfDeclaredMadeForKids` und `containsSyntheticMedia` -- an einem
//     Video, das danach oeffentlich ist. Die Sicherung dagegen ist nicht
//     Sorgfalt beim Hinschreiben, sondern dass es nichts hinzuschreiben gibt.
//     tests/eu-oeffentlich.test.cjs fuehrt den Schaden einmal vor und dann
//     den Beleg, dass die unvollstaendige Fassung nicht mehr baubar ist.
//
//   - ES GIBT WEITERHIN KEIN FELD FUER EINEN VEROEFFENTLICHUNGSTERMIN.
//     `publishAt` ist ein SETZBARES Feld des Teils `status` -- es waere also
//     genau das, was die Regel oben "mitzuschicken" verlangte. Es wird
//     trotzdem nie mitgeschickt (Vertrag 2.5 Punkt 3, Vertrag 7: "Nie, in
//     keinem Aufruf"), und der Name steht unten in genau einer Liste: der der
//     Felder, die NICHT uebernommen werden. Findet der Statusblock eines
//     Videos ihn trotzdem, ist das kein Feld zum Uebernehmen, sondern ein
//     Befund fuer einen Menschen -- der Arbeiter bricht dann ab.
//
//   - Ebenso wenig kommt weiterhin vor: Loeschen, Bewerten, Melden,
//     Wiedergabelisten, Untertitel, Kommentare, Livestreams, Wasserzeichen
//     (Vertrag 7). tests/eu-oeffentlich.test.cjs fuehrt die Liste der Namen,
//     die hier nicht vorkommen duerfen, und prueft sie an dieser Datei UND an
//     jeder, die von hier aus erreichbar ist. `videos.update` ist aus dieser
//     Liste herausgenommen worden und in die Liste der gezaehlten
//     SCHREIBENDEN Aufrufe gewandert; herausgenommen wurde genau der eine
//     Name und kein zweiter.
//   - Es gibt KEINEN allgemeinen Durchreicher. Die Methodenliste unten ist
//     abgeschlossen; ein Name, der nicht darin steht, hat keinen Weg nach
//     draussen. Der googleapis-Klient selbst wird in einer Schliessung
//     festgehalten und ist nie ein Feld des Kanalobjekts -- wer das Objekt in
//     der Hand hat, kann von ihm aus nichts erreichen, was hier nicht steht.
//
// WARUM DIE ZAEHLUNG IM PROGRAMM STEHT UND NICHT NUR IM TEST.
//
// Ein Zaehler, den nur der Test sieht, zaehlt genau dort, wo nichts passieren
// kann. Der hier ist derselbe im scharfen Lauf: ein zweites `videos.insert`
// wirft, BEVOR es die Bibliothek erreicht. Der Test benutzt denselben Zaehler
// um seinen Doppelgaenger herum -- er prueft damit die Sicherung, die auch im
// Ernstfall greift, und nicht eine zweite, die ihr aehnlich sieht.
//
// WAS DIESES MODUL NICHT ENTSCHEIDET: ob ueberhaupt hochgeladen werden darf.
// Das ist die Ermaechtigung (longform-gedaechtnis.js) und das Gedaechtnis. Hier
// steht nur, WAS ein Aufruf ist, und dass es von jeder schreibenden Sorte
// hoechstens einen gibt.
// ---------------------------------------------------------------------------

const fs = require('fs');

// ---------------------------------------------------------------------------
// DIE AUFRUFE, ABGESCHLOSSEN
// ---------------------------------------------------------------------------
//
// Die beiden Listen stehen getrennt, weil die Regel verschieden ist: von einem
// LESENDEN Aufruf gibt es beliebig viele (das Warten fragt bis zu 45 Minuten
// lang nach), von einem SCHREIBENDEN hoechstens einen je Lauf.
const LESENDE_AUFRUFE = Object.freeze(['channels.list', 'videos.list']);
const SCHREIBENDE_AUFRUFE = Object.freeze(['videos.insert', 'thumbnails.set', 'videos.update']);
const ALLE_AUFRUFE = Object.freeze(LESENDE_AUFRUFE.concat(SCHREIBENDE_AUFRUFE));

// Die Methoden eines Kanalobjekts und der Aufruf, den jede macht. Diese
// Tabelle ist die ganze Oberflaeche: zaehlenderKanal() baut sein Ergebnis
// AUS ihr und nicht aus dem, was das innere Objekt zufaellig mitbringt.
const METHODEN = Object.freeze({
  nenneKanal: 'channels.list',
  ladeVideoHoch: 'videos.insert',
  liesVerarbeitung: 'videos.list',
  setzeThumbnail: 'thumbnails.set',
  liesVideoVoll: 'videos.list',
  // EU: die beiden des dritten Aufrufs. Sie stehen ZUSAMMEN und in dieser
  // Reihenfolge, weil sie nur zusammen richtig sind: liesStatus() holt den
  // Block, stelleOeffentlich() gibt ihn zurueck. Getrennt gelesen sieht das
  // eine wie eine ueberfluessige Abfrage aus und das andere wie ein Aufruf,
  // dem man auch etwas anderes geben koennte.
  liesStatus: 'videos.list',
  stelleOeffentlich: 'videos.update',
});
const METHODENNAMEN = Object.freeze(Object.keys(METHODEN));

// HART, AN GENAU EINER STELLE. Derselbe Satz wie im Shorts-Uploader
// (PRIVACY_STATUS): ein Wert, der nur durch Weglassen gilt, gilt bis zur
// naechsten Bibliotheksversion.
const PRIVACY_STATUS = 'private';

// EU: DER EINE WERT, DER SICH AENDERT, ebenfalls hart und an genau einer
// Stelle. Er steht neben `private` und nicht anderswo: die beiden sind die
// Anfangs- und die Endlage dieses Weges, und wer wissen will, was er mit der
// Sichtbarkeit eines Videos tut, soll beide in einem Blick sehen.
const PRIVACY_OEFFENTLICH = 'public';

// Ausdruecklich im Aufruf und nicht als Vorgabe der Bibliothek (Vertrag 2.14).
// Kein Argument und keine Konfiguration schaltet es ab.
const NOTIFY_SUBSCRIBERS = true;

const VIDEO_MIME = 'video/mp4';

// ---------------------------------------------------------------------------
// EU: DIE FELDER DES TEILS `status` (Vertrag 2.5)
// ---------------------------------------------------------------------------
//
// DREI LISTEN, WEIL ES DREI SORTEN GIBT, und die Unterscheidung ist genau die,
// an der die Falle haengt:
//
//   SETZBAR       Was die Dokumentation als setzbare Felder des Teils `status`
//                 nennt. Fuer JEDES davon gilt die Regel: fehlt es im Koerper
//                 einer Anfrage, deren `part` `status` nennt, wird es
//                 GELOESCHT und faellt auf seine Vorgabe zurueck.
//   UEBERTRAGEN   Die, die mit genau dem gelesenen Wert zurueckgehen. Das sind
//                 die setzbaren MINUS die beiden, die anders behandelt werden:
//                 `privacyStatus` wird gesetzt, `publishAt` wird nie
//                 mitgeschickt.
//   NIE           `publishAt`, allein. Es steht als eigene Liste da und nicht
//                 als Ausnahme in einer Bedingung, damit die Frage "wird der
//                 Termin je mitgeschickt" eine Datenzeile beantwortet und
//                 keine Verzweigung.
//
// Alles, was im gelesenen Block steht und in KEINER dieser Listen vorkommt,
// ist ein nur lesbares Feld (`uploadStatus`, `rejectionReason`, ...). Es
// gehoert nicht in den Koerper (2.5 Punkt 4) und wird verworfen -- aber
// benannt: ein Feld, das lautlos verschwindet, ist eines, von dem hinterher
// niemand weiss, dass es da war.
const STATUS_FELDER_SETZBAR = Object.freeze([
  'privacyStatus', 'publishAt', 'embeddable', 'license', 'publicStatsViewable',
  'selfDeclaredMadeForKids', 'containsSyntheticMedia',
]);
const STATUS_FELDER_UEBERTRAGEN = Object.freeze([
  'embeddable', 'license', 'publicStatsViewable', 'selfDeclaredMadeForKids',
  'containsSyntheticMedia',
]);
const STATUS_FELD_PRIVACY = 'privacyStatus';
const STATUS_FELDER_NIE = Object.freeze(['publishAt']);

// ---------------------------------------------------------------------------
// ABWESEND IST NICHT LEER
// ---------------------------------------------------------------------------
//
// Vertrag 2.3, gemessen von DY an 21 Shorts: `rejectionReason` und
// `failureReason` sind ABWESEND, wenn nichts vorliegt -- nicht leer. Ein Bau,
// der beides gleich behandelt, kann "YouTube sagt nichts dazu" nicht von
// "YouTube sagt: leer" unterscheiden, und genau das muss die Anzeige koennen.
//
// Darum gibt jede Auskunft dieses Moduls { da, wert } zurueck und nie den
// blossen Wert. `da: false` heisst: das Feld stand nicht in der Antwort.
function feld(objekt, name) {
  if (objekt === null || typeof objekt !== 'object' ||
      !Object.prototype.hasOwnProperty.call(objekt, name)) {
    return { da: false, wert: null };
  }
  return { da: true, wert: objekt[name] };
}

// ---------------------------------------------------------------------------
// EU: DER KOERPER DES DRITTEN AUFRUFS -- DIE EINE STELLE
// ---------------------------------------------------------------------------
//
// SIE IST DER GANZE SCHUTZ VOR DER FALLE AUS VERTRAG 2.5, und sie ist es
// dadurch, dass es keine zweite gibt. `stelleOeffentlich()` unten nimmt keinen
// Koerper entgegen -- es nimmt die videoId und den gelesenen Statusblock und
// ruft DIESE Funktion. Wer einen unvollstaendigen Koerper schicken wollte,
// muesste `videos.update` an einer zweiten Stelle aufrufen, und die gibt es
// nicht (der Test rechnet es ueber die ganze Kette nach).
//
// SIE RECHNET NICHTS UND HOLT NICHTS. Sie oeffnet keine Datei, sie fragt kein
// Netz, sie kennt kein Gedaechtnis. Was hineingeht, ist der Block, den
// `videos.list` mit `part=status` unmittelbar vorher geliefert hat; was
// herauskommt, ist derselbe Block mit einem geaenderten Feld, ohne die nur
// lesbaren und ohne den Termin. Dieselben Eingaben ergeben immer dasselbe
// Ergebnis -- darum darf der Arbeiter sie fuer den Haltepunkt ein zweites Mal
// rufen, ohne dass zwei Fassungen entstehen koennen.
//
// WAS SIE MITGIBT, UND WARUM JEDES DAVON:
//
//   koerper       das, was gesendet wuerde. Vollstaendig, mit `id`.
//   uebernommen   welche Felder mit welchem Wert zurueckgehen. Der Beleg.
//   fehlend       welche UEBERTRAGBAREN Felder im gelesenen Block NICHT
//                 standen. Das ist die gefaehrliche Liste: was hier steht,
//                 kann dieser Bau nicht erhalten -- es stand nicht da, also
//                 geht es nicht mit, also faellt es laut Dokumentation auf
//                 seine Vorgabe. Der Arbeiter meldet jeden Namen einzeln.
//   verworfen     welche Felder des Blocks nur lesbar sind und darum
//                 draussen bleiben. Kein Schaden, aber benannt.
//   termin        ob im gelesenen Block ein Veroeffentlichungstermin stand.
//                 Er wird NIE
//                 uebernommen; dass er da war, ist ein Befund fuer einen
//                 Menschen (2.5 Punkt 3) und keine Kleinigkeit, die diese
//                 Funktion selbst entscheidet.
//   gelesen_privacy  was der Block ueber die Sichtbarkeit sagte. Der Arbeiter
//                 haelt es gegen `private`; hier wird nur weitergereicht.
function baueStatusKoerper({ videoId, status }) {
  const uebernommen = {};
  const fehlend = [];
  const verworfen = [];
  const termin = feld(status, STATUS_FELDER_NIE[0]);
  const gelesenPrivacy = feld(status, STATUS_FELD_PRIVACY);

  if (typeof videoId !== 'string' || !videoId) {
    return { ok: false, koerper: null, uebernommen, fehlend: STATUS_FELDER_UEBERTRAGEN.slice(),
      verworfen, termin, gelesen_privacy: gelesenPrivacy,
      grund: 'Es gibt keine Kennung des Videos. Ohne sie wird kein Koerper gebaut -- ein ' +
        'videos.update ohne id trifft nichts oder etwas Falsches.' };
  }
  if (status === null || typeof status !== 'object' || Array.isArray(status)) {
    return { ok: false, koerper: null, uebernommen, fehlend: STATUS_FELDER_UEBERTRAGEN.slice(),
      verworfen, termin, gelesen_privacy: gelesenPrivacy,
      grund: 'Der gelesene status-Block ist ' + JSON.stringify(status) + ' und kein Objekt. ' +
        'Aus nichts laesst sich kein vollstaendiger Koerper bauen, und ein unvollstaendiger ' +
        'LOESCHT die Felder, die er nicht nennt (Vertrag 2.5).' };
  }

  // ERST DURCH DEN GELESENEN BLOCK, nicht durch die Liste. Umgekehrt fiele ein
  // Feld, das YouTube heute meldet und diese Liste nicht kennt, gar nicht auf
  // -- es waere weder uebernommen noch verworfen, sondern unsichtbar.
  for (const name of Object.keys(status)) {
    if (STATUS_FELDER_NIE.includes(name)) continue;
    if (name === STATUS_FELD_PRIVACY) continue;
    if (STATUS_FELDER_UEBERTRAGEN.includes(name)) {
      uebernommen[name] = status[name];
      continue;
    }
    verworfen.push(name);
  }
  for (const name of STATUS_FELDER_UEBERTRAGEN) {
    if (!Object.prototype.hasOwnProperty.call(uebernommen, name)) fehlend.push(name);
  }

  // Der Koerper: erst das Uebernommene, dann das eine geaenderte Feld. In
  // dieser Reihenfolge, damit ein `privacyStatus` aus dem gelesenen Block --
  // den es hier gar nicht geben kann, weil er oben uebersprungen wird -- auch
  // dann nicht gewaenne, wenn sich das eines Tages aenderte.
  const koerper = { id: videoId, status: {} };
  for (const name of Object.keys(uebernommen)) koerper.status[name] = uebernommen[name];
  koerper.status[STATUS_FELD_PRIVACY] = PRIVACY_OEFFENTLICH;

  return { ok: true, koerper, uebernommen, fehlend, verworfen, termin,
    gelesen_privacy: gelesenPrivacy, grund: null };
}

// ---------------------------------------------------------------------------
// DER ZAEHLER
// ---------------------------------------------------------------------------
//
// Er legt sich um EIN Kanalobjekt -- das echte im scharfen Lauf, den
// Doppelgaenger im Test -- und tut drei Dinge:
//
//   1. Er baut ein NEUES Objekt mit genau den Methoden aus METHODEN. Was das
//      innere Objekt sonst noch traegt, ist von aussen nicht erreichbar.
//   2. Er schreibt jeden Aufruf mit, in der Reihenfolge, mit Name und
//      Methodennamen.
//   3. Er WIRFT beim zweiten Aufruf derselben schreibenden Sorte -- vor dem
//      Aufruf, nicht danach. Zwei `videos.insert` in einem Lauf sind kein
//      Fehler, den man hinterher meldet; sie sind ein zweites Video.
//
// DER FEHLER IST LAUT UND NENNT DEN ERSTEN AUFRUF MIT. Ein Abbruch, der nur
// sagt "schon einmal", laesst offen, ob das erste Video existiert.
function zaehlenderKanal(innen) {
  if (innen === null || typeof innen !== 'object') {
    throw new TypeError('zaehlenderKanal braucht ein Kanalobjekt.');
  }
  for (const name of METHODENNAMEN) {
    if (typeof innen[name] !== 'function') {
      throw new TypeError('Dem Kanalobjekt fehlt die Methode ' + name + '. Die Liste der ' +
        'Methoden ist abgeschlossen (METHODEN in src/upload/longform-kanal.js); ein ' +
        'halbes Kanalobjekt wird nicht angenommen -- es saehe aus wie ein ganzes, bis der ' +
        'fehlende Aufruf an der Reihe ist.');
    }
  }

  const aufrufe = [];

  const aussen = {};
  for (const methode of METHODENNAMEN) {
    const aufruf = METHODEN[methode];
    aussen[methode] = async function (...args) {
      if (SCHREIBENDE_AUFRUFE.includes(aufruf)) {
        const schon = aufrufe.find((a) => a.aufruf === aufruf);
        if (schon) {
          throw new Error('SCHREIBSPERRE: ' + aufruf + ' ist in diesem Lauf schon ' +
            'gemacht worden (Aufruf Nr. ' + schon.nr + ', Methode ' + schon.methode + ', ' +
            'um ' + schon.zeit + '). Es gibt je Lauf hoechstens EINEN Aufruf jeder ' +
            'schreibenden Sorte. Der zweite wird NICHT gemacht -- er waere bei ' +
            'videos.insert ein zweites Video auf dem Kanal. Was der erste bewirkt hat, ' +
            'steht im Gedaechtnis; ein neuer Lauf setzt dort an (Vertrag 5.3).');
        }
      }
      const eintrag = {
        nr: aufrufe.length + 1,
        aufruf,
        methode,
        zeit: new Date().toISOString(),
        // NUR die Kennung, nicht die Argumente. Hier laufen ein Titel, eine
        // Beschreibung und ein Dateistrom durch; sie in eine Liste zu legen,
        // die spaeter jemand ausgibt, waere eine zweite Kopie an einer Stelle,
        // die niemand dafuer haelt.
        videoId: (args[0] && typeof args[0] === 'object' && typeof args[0].videoId === 'string')
          ? args[0].videoId : null,
      };
      aufrufe.push(eintrag);
      return innen[methode](...args);
    };
  }

  // Die Liste als KOPIE. Wer sie bekommt, kann nicht in die Zaehlung schreiben.
  aussen.aufrufe = () => aufrufe.map((a) => Object.assign({}, a));
  aussen.aufrufnamen = () => aufrufe.map((a) => a.aufruf);
  return aussen;
}

// ---------------------------------------------------------------------------
// DAS ECHTE KANALOBJEKT
// ---------------------------------------------------------------------------
//
// `googleapis` und die Anmeldung werden ERST HIER geladen -- in der Funktion,
// nicht im Kopf der Datei. Ein Trockenlauf kommt nie hierher und laedt darum
// nicht einmal die Bibliothek (Vertrag 3.1: "ohne --execute kein Netz, nicht
// einmal googleapis geladen"). Der Test rechnet nach, dass nach dem Laden des
// Arbeiters kein googleapis in require.cache steht.
//
// `yt` bleibt in dieser Schliessung. Es ist kein Feld des zurueckgegebenen
// Objekts und wird nicht weitergereicht: von aussen fuehrt kein Weg zu ihm,
// und damit auch keiner zu einem Aufruf, der hier nicht steht.
function rohKanal(yt) {
  return {
    // LESEND. Auf welchen Kanal? Die Frage stand im Shorts-Uploader in der
    // getippten Rueckfrage; hier steht die Antwort auf dem Knopf und wird
    // gegen diesen Aufruf gehalten (Vertrag 4, Schritt 9).
    async nenneKanal() {
      const antwort = await yt.channels.list({ part: ['snippet'], mine: true });
      const k = (antwort.data && antwort.data.items && antwort.data.items[0]) || null;
      if (!k) return { gefunden: false, id: null, name: null };
      return { gefunden: true, id: k.id, name: k.snippet ? k.snippet.title : null };
    },

    // AUFRUF 1 (Vertrag 4, Schritt 10). Privat, ohne Termin, mit
    // Benachrichtigung.
    //
    // ES GIBT HIER KEIN FELD FUER EINEN VEROEFFENTLICHUNGSTERMIN, und es gibt
    // auch keinen Parameter, aus dem eines werden koennte. Vertrag 7 nennt es
    // beim Namen und sagt: nie, in keinem Aufruf. Der Weg dahin ist nicht, den
    // Wert auf null zu setzen -- dann stuende das Feld da, und ein Argument
    // koennte es eines Tages fuellen. Der Weg ist, dass es das Feld nicht
    // gibt.
    async ladeVideoHoch({ pfad, titel, beschreibung, tags, veroeffentlichung }) {
      const antwort = await yt.videos.insert({
        part: ['snippet', 'status'],
        notifySubscribers: NOTIFY_SUBSCRIBERS,
        requestBody: {
          snippet: {
            title: titel,
            description: beschreibung,
            tags,
            categoryId: veroeffentlichung.categoryId,
            defaultLanguage: veroeffentlichung.defaultLanguage,
            defaultAudioLanguage: veroeffentlichung.defaultAudioLanguage,
          },
          status: {
            privacyStatus: PRIVACY_STATUS,
            selfDeclaredMadeForKids: veroeffentlichung.selfDeclaredMadeForKids,
          },
        },
        media: { mimeType: VIDEO_MIME, body: fs.createReadStream(pfad) },
      });
      const d = antwort.data || {};
      return {
        videoId: typeof d.id === 'string' ? d.id : null,
        status: d.status || null,
        privacyStatus: feld(d.status, 'privacyStatus'),
        uploadStatus: feld(d.status, 'uploadStatus'),
      };
    },

    // DAS WARTEN (Vertrag 2.3). part=processingDetails,status, woertlich.
    async liesVerarbeitung({ videoId }) {
      const antwort = await yt.videos.list({
        part: ['processingDetails', 'status'], id: [videoId],
      });
      return deuteVideoAntwort(antwort);
    },

    // AUFRUF 2 (Vertrag 2.10). Der Typ kommt aus der Dateiendung und nicht aus
    // einer Konstante -- bestimmt hat ihn der Arbeiter, hier wird er nur
    // durchgereicht.
    async setzeThumbnail({ videoId, pfad, mimeType }) {
      const antwort = await yt.thumbnails.set({
        videoId,
        media: { mimeType, body: fs.createReadStream(pfad) },
      });
      const d = antwort.data || {};
      return { items: Array.isArray(d.items) ? d.items : [] };
    },

    // SCHRITT 13 (Vertrag 2.4, 2.10). part=snippet,status,processingDetails.
    async liesVideoVoll({ videoId }) {
      const antwort = await yt.videos.list({
        part: ['snippet', 'status', 'processingDetails'], id: [videoId],
      });
      return deuteVideoAntwort(antwort);
    },

    // EU: DER STAND, WIE YOUTUBE IHN FUEHRT (Vertrag 2.5 Punkt 1).
    //
    // part=status, WOERTLICH und allein. Nicht snippet, nicht
    // processingDetails, nicht "wir haben es sowieso schon". Der Grund steht
    // im Vertrag: "Das ist der Stand, wie YouTube ihn fuehrt, nicht der, den
    // der Upload geschickt hat" -- und nicht der von vor fuenf Minuten. Dieser
    // Aufruf liegt UNMITTELBAR vor dem dritten; was zwischen ihm und dem
    // Update noch geschieht, ist das Bauen des Koerpers und sonst nichts.
    //
    // Er gibt den ROHEN Block zurueck und nicht eine Auslegung davon. Was
    // darin steht, geht in den Koerper und ins Gedaechtnis; ein Feld, das
    // dieser Bau nicht kennt, darf hier nicht verlorengehen -- es ist
    // vielleicht genau das, das sonst geloescht wuerde.
    async liesStatus({ videoId }) {
      const antwort = await yt.videos.list({ part: ['status'], id: [videoId] });
      const d = (antwort && antwort.data) || {};
      const eintrag = (Array.isArray(d.items) && d.items[0]) || null;
      if (!eintrag) return { gefunden: false, status: null };
      return { gefunden: true, status: eintrag.status || null };
    },

    // EU: AUFRUF 3 (Vertrag 2.5, 4 Schritt 16). DER, DEN MAN NICHT
    // ZURUECKNEHMEN KANN.
    //
    // ER NIMMT KEINEN KOERPER ENTGEGEN, und das ist die Sicherung. Er bekommt
    // die videoId und den Block, den `liesStatus` eben geliefert hat; den
    // Koerper baut baueStatusKoerper() -- dieselbe Funktion, die der Arbeiter
    // fuer den Haltepunkt und fuer die Anzeige ruft. Es gibt damit keine
    // Fassung dieses Aufrufs, in der ein Feld fehlen koennte, weil jemand es
    // beim Hinschreiben vergessen hat: es wird nichts hingeschrieben.
    //
    // `part` ist ['status'] und sonst nichts. Nie snippet -- dort gilt
    // dieselbe Loeschregel, und dann muessten Titel, Beschreibung, Kategorie,
    // Sprache und Tags alle noch einmal mit (2.5, 7).
    //
    // Zurueck geht der ROHE Statusblock der Antwort. Der Arbeiter haelt ihn
    // Feld fuer Feld gegen den gesendeten; das ist der Punkt, an dem die Falle
    // im scharfen Lauf sichtbar wuerde, falls sie doch zuschluege.
    async stelleOeffentlich({ videoId, status }) {
      const gebaut = baueStatusKoerper({ videoId, status });
      if (!gebaut.ok) throw new Error('Der Koerper des dritten Aufrufs liess sich nicht ' +
        'bauen: ' + gebaut.grund + ' Es wurde NICHTS gesendet.');
      const antwort = await yt.videos.update({ part: ['status'], requestBody: gebaut.koerper });
      const d = antwort.data || {};
      return {
        videoId: typeof d.id === 'string' ? d.id : null,
        status: d.status || null,
        privacyStatus: feld(d.status, 'privacyStatus'),
        gesendet: gebaut.koerper,
      };
    },
  };
}

// Die eine Deutung einer Videoantwort -- fuer beide lesenden Aufrufe dieselbe.
// Zwei Deutungen waeren zwei Vorstellungen davon, was "nicht vorhanden" heisst,
// und das ist genau die Unterscheidung, um die es hier geht.
function deuteVideoAntwort(antwort) {
  const d = (antwort && antwort.data) || {};
  const eintrag = (Array.isArray(d.items) && d.items[0]) || null;
  if (!eintrag) {
    return {
      gefunden: false, status: null, processingDetails: null, snippet: null,
      processingStatus: { da: false, wert: null },
      uploadStatus: { da: false, wert: null },
      rejectionReason: { da: false, wert: null },
      failureReason: { da: false, wert: null },
      processingFailureReason: { da: false, wert: null },
    };
  }
  const status = eintrag.status || null;
  const pd = eintrag.processingDetails || null;
  return {
    gefunden: true,
    // Die Rohobjekte gehen MIT. Was YouTube sonst noch meldet -- ein Feld, das
    // dieser Bau nicht kennt -- landet damit im Gedaechtnis und in der
    // Anzeige, statt hier lautlos zu verschwinden.
    status,
    processingDetails: pd,
    snippet: eintrag.snippet || null,
    processingStatus: feld(pd, 'processingStatus'),
    uploadStatus: feld(status, 'uploadStatus'),
    rejectionReason: feld(status, 'rejectionReason'),
    failureReason: feld(status, 'failureReason'),
    processingFailureReason: feld(pd, 'processingFailureReason'),
  };
}

// Baut das echte, gezaehlte Kanalobjekt. Diese Funktion ist der EINZIGE Weg,
// auf dem in diesem Projekt ein Longform-Aufruf ans Netz kommt.
async function baueEchtenKanal() {
  // eslint-disable-next-line global-require
  const { google } = require('googleapis');
  // eslint-disable-next-line global-require
  const { getAuthorizedClient } = require('../youtube/auth');
  const auth = await getAuthorizedClient({ interactive: false });
  const yt = google.youtube({ version: 'v3', auth });
  return zaehlenderKanal(rohKanal(yt));
}

module.exports = {
  LESENDE_AUFRUFE, SCHREIBENDE_AUFRUFE, ALLE_AUFRUFE, METHODEN, METHODENNAMEN,
  PRIVACY_STATUS, PRIVACY_OEFFENTLICH, NOTIFY_SUBSCRIBERS, VIDEO_MIME,
  STATUS_FELDER_SETZBAR, STATUS_FELDER_UEBERTRAGEN, STATUS_FELDER_NIE, STATUS_FELD_PRIVACY,
  feld, deuteVideoAntwort, baueStatusKoerper, zaehlenderKanal, rohKanal, baueEchtenKanal,
};
