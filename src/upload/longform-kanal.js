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
//   - DER AUFRUF, DER EIN VIDEO OEFFENTLICH STELLT, KOMMT HIER NICHT VOR.
//     Nicht aufgerufen, nicht vorbereitet, und auch nicht als Name -- diese
//     Datei buchstabiert ihn nirgends aus, denn ein Kommentar, der einen
//     Methodennamen traegt, ist die erste Zeile, die ihn enthaelt, und die
//     zweite ist die, die ihn benutzt. Er steht in Vertrag 2.5, er ist der
//     naechste Schritt, und die Grenze zwischen den beiden ist der Sinn dieses
//     Schnitts. tests/ep-privat.test.cjs fuehrt die Liste der Namen, die hier
//     nicht vorkommen duerfen, und prueft sie an dieser Datei UND an jeder,
//     die von hier aus erreichbar ist.
//   - Ebenso wenig kommt vor: Loeschen, Bewerten, Melden, Wiedergabelisten,
//     Untertitel, Kommentare, Livestreams, Wasserzeichen (Vertrag 7). Alle
//     unter ihrem deutschen Wort und aus demselben Grund.
//   - Es gibt auch KEIN Feld fuer einen Veroeffentlichungstermin. Nicht auf
//     null gesetzt, sondern gar nicht da: ein Feld, das existiert, kann ein
//     Argument eines Tages fuellen (Vertrag 7, "Nie, in keinem Aufruf").
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
const SCHREIBENDE_AUFRUFE = Object.freeze(['videos.insert', 'thumbnails.set']);
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
});
const METHODENNAMEN = Object.freeze(Object.keys(METHODEN));

// HART, AN GENAU EINER STELLE. Derselbe Satz wie im Shorts-Uploader
// (PRIVACY_STATUS): ein Wert, der nur durch Weglassen gilt, gilt bis zur
// naechsten Bibliotheksversion.
const PRIVACY_STATUS = 'private';

// Ausdruecklich im Aufruf und nicht als Vorgabe der Bibliothek (Vertrag 2.14).
// Kein Argument und keine Konfiguration schaltet es ab.
const NOTIFY_SUBSCRIBERS = true;

const VIDEO_MIME = 'video/mp4';

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
  PRIVACY_STATUS, NOTIFY_SUBSCRIBERS, VIDEO_MIME,
  feld, deuteVideoAntwort, zaehlenderKanal, rohKanal, baueEchtenKanal,
};
