'use strict';

// DJ: Die Seite der Freigabeoberflaeche. Reiner Textbau, kein Zustand, kein
// Plattenzugriff, kein Netz. Dieses Modul kennt weder fs noch http -- es
// bekommt eine Sitzung als Daten und gibt HTML zurueck.
//
// WARUM DIE KARTEN IM BROWSER GEBAUT WERDEN UND NICHT HIER:
// Kein einziges Feld der Lieferung wird in HTML eingesetzt. Titelvorschlag,
// Transkript und Kennung kommen aus einer fremden Datei; wuerden sie hier in
// Markup eingeklebt, muesste jede einzelne Einsetzstelle maskiert sein, und
// eine vergessene reichte. Stattdessen geht alles genau EINMAL als JSON in
// einen Skriptblock, und die Seite setzt jedes Feld ueber textContent oder
// input.value in den Baum. Beide maskieren selbst. Es gibt damit keine
// Einsetzstelle, die man vergessen koennte.
//
// Die einzige Gefahrenstelle, die dabei bleibt, ist der Skriptblock selbst --
// dafuer jsonFuerSkriptblock() unten.

// Die drei Zeichen, mit denen sich ein Text aus einem <script>-Block
// heraussprengen laesst. JSON.stringify laesst sie stehen: es maskiert fuer
// JavaScript, der HTML-Parser des Browsers aber sucht das Ende des Blocks rein
// textlich, bevor JavaScript ueberhaupt liest. Aus "</script>" wird so
// "</script>" -- der Block bleibt heil, und im Baum steht hinterher
// wieder das echte "</script>" als Text.
//
// GENAU EINMAL maskiert. Eine zweite Maskierung (etwa zusaetzlich mit einer
// HTML-Escape-Funktion) waere kein doppelter Schutz, sondern ein Fehler: der
// Browser packt nur einmal aus, und im Titelfeld staende dann "&#x27;" statt
// eines Apostrophs -- und ginge so auch in die Freigabedatei zurueck. Diese
// Lektion steht im Vorbild (judge.py, _json_fuer_skriptblock) und ist der
// Grund, warum hier nirgends eine HTML-Escape-Funktion vorkommt.
const SKRIPTBLOCK_MASKEN = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' };

function jsonFuerSkriptblock(daten) {
  let roh = JSON.stringify(daten);
  for (const [zeichen, maske] of Object.entries(SKRIPTBLOCK_MASKEN)) {
    roh = roh.split(zeichen).join(maske);
  }
  return roh;
}

// Alles unter STIL und SKRIPT ist woertlicher Text der Seite. Er enthaelt
// bewusst KEINE Werte aus der Lieferung -- die kommen ausschliesslich ueber den
// einen JSON-Block.

const STIL = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #14161a; color: #e6e8ec;
  font: 15px/1.55 "Segoe UI", system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 5; background: #1b1e24;
  border-bottom: 1px solid #2e333c; padding: 14px 20px; }
header h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
.kopfzeile { color: #9aa3b2; font-size: 13px; }
.kopfwerkzeug { margin-top: 10px; display: flex; gap: 12px; align-items: center;
  flex-wrap: wrap; }
#fortschritt { font-variant-numeric: tabular-nums; }
main { padding: 20px; display: flex; flex-direction: column; gap: 18px;
  max-width: 1180px; }
.karte { border: 1px solid #2e333c; border-radius: 8px; background: #191c22;
  padding: 16px; display: grid; grid-template-columns: 320px 1fr; gap: 18px; }
.karte.gewaehlt { border-color: #5b8cff; box-shadow: 0 0 0 1px #5b8cff inset; }
.karte.freigegeben { border-left: 5px solid #3fa45b; }
.karte.abgelehnt { border-left: 5px solid #b4543a; }
.karte.gesperrt { grid-template-columns: 1fr; border-left: 5px solid #6b7280;
  background: #171a1f; }
.karte video { width: 100%; max-height: 460px; background: #000; border-radius: 6px; }
.kopfLinks { display: flex; flex-direction: column; gap: 10px; }
.rechts { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.zeile { display: flex; gap: 14px; flex-wrap: wrap; color: #9aa3b2; font-size: 13px;
  align-items: baseline; }
.zeile b { color: #c8d0dd; font-weight: 600; }
.kennung { font-size: 15px; color: #e6e8ec; font-weight: 600; }
.transkript { background: #12141a; border: 1px solid #262b33; border-radius: 6px;
  padding: 10px 12px; color: #b8c0cd; font-size: 14px; max-height: 150px;
  overflow: auto; white-space: pre-wrap; }
label { font-size: 12px; color: #9aa3b2; display: block; margin-bottom: 4px;
  text-transform: uppercase; letter-spacing: 0.04em; }
input[type=text], textarea { width: 100%; background: #0f1116; color: #e6e8ec;
  border: 1px solid #333a45; border-radius: 6px; padding: 8px 10px; font: inherit; }
textarea { min-height: 54px; resize: vertical; }
input[type=text]:focus, textarea:focus { outline: 2px solid #5b8cff; border-color: #5b8cff; }
.zaehler { font-size: 12px; color: #7d8697; margin-top: 3px; }
.knoepfe { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
button { font: inherit; padding: 8px 16px; border-radius: 6px; cursor: pointer;
  border: 1px solid #3a424f; background: #232833; color: #e6e8ec; }
button:hover { background: #2c323f; }
button.ja { border-color: #3fa45b; }
button.ja[aria-pressed=true] { background: #235c37; border-color: #58c97a; }
button.nein { border-color: #b4543a; }
button.nein[aria-pressed=true] { background: #6d2f1f; border-color: #dd7c5e; }
.stand { font-size: 13px; color: #9aa3b2; }
.stand.ja { color: #7bd79a; }
.stand.nein { color: #e79a80; }
.fehler { color: #ff9a86; font-size: 13px; min-height: 18px; white-space: pre-wrap; }
.mangel { color: #e79a80; font-size: 13px; margin: 2px 0 0 0; }
.gesperrtHinweis { color: #cbd2de; font-size: 14px; margin: 0; }
kbd { background: #262b33; border: 1px solid #3a424f; border-bottom-width: 2px;
  border-radius: 4px; padding: 1px 6px; font-size: 12px; font-family: inherit; }
.warnung { background: #3a2a17; border: 1px solid #6b4a1f; color: #f0d3a6;
  padding: 12px 16px; border-radius: 6px; margin: 14px 20px 0; }
.warnung p { margin: 6px 0 0; }
.warnung code { display: inline-block; margin-top: 4px; background: #12141a;
  border: 1px solid #262b33; border-radius: 4px; padding: 4px 8px; color: #c8d0dd; }
.warnung.ende { background: #16301f; border-color: #2f6b45; color: #cdebd8; }
.warnung.weg { background: #3a1c17; border-color: #7a3226; color: #f4c9be; }
#karten.vorbei { opacity: 0.55; }
#karten.vorbei .karte { filter: grayscale(0.6); }
.karte.nichtgespeichert { border-color: #dd7c5e; box-shadow: 0 0 0 1px #dd7c5e inset; }

/* DR: die Kette unterhalb der Karten */
#kette { border-top: 2px solid #2e333c; margin: 26px 20px 40px; padding-top: 20px;
  max-width: 1180px; }
#kette h2 { font-size: 16px; margin: 0 0 6px; }
#kette .erklaerung { color: #9aa3b2; font-size: 13px; margin: 0 0 14px; max-width: 90ch; }
.schritt { border: 1px solid #2e333c; border-radius: 8px; background: #191c22;
  padding: 14px 16px; margin-bottom: 14px; }
.schritt.aus { opacity: 0.5; }
.schritt h3 { font-size: 14px; margin: 0 0 8px; color: #c8d0dd; }
.schritt p { margin: 6px 0; color: #9aa3b2; font-size: 13px; }
button.gross { padding: 10px 20px; font-weight: 600; }
button.scharf { border-color: #b4543a; background: #2a1d19; }
button.scharf:enabled:hover { background: #3a2620; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
.vorschauBloecke { max-height: 460px; overflow: auto; border: 1px solid #262b33;
  border-radius: 6px; background: #101218; padding: 10px; }
.vorschauBloecke .block { border: 1px solid #262b33; border-radius: 6px; background: #14161c;
  margin-bottom: 10px; }
.vorschauBloecke .block > h4 { margin: 0; padding: 7px 12px; font-size: 13px;
  background: #1b1f27; border-bottom: 1px solid #262b33; color: #e6e8ec; }
.vorschauBloecke pre { margin: 0; padding: 10px 12px; white-space: pre-wrap;
  word-break: break-word; font: 12.5px/1.5 "Cascadia Mono", Consolas, monospace;
  color: #c8d0dd; }
/* DT: Der Termin in eigener Farbe. Beide Zeilen -- UTC und Ortszeit -- bleiben
   stehen und bekommen dieselbe Farbe: verbindlich ist weiterhin UTC, und eine
   Farbe, die nur eine der beiden Zeilen traefe, waere eine Auswahl und keine
   Hervorhebung. Warmes Gelb gegen das kuehle Grau ringsum; dazu halbfett,
   damit die Zeile auch dann auffaellt, wenn jemand Farben nicht unterscheidet. */
.vorschauBloecke .termin { color: #ffd479; font-weight: 600; }
/* DT: Der Kopf des gemeinsamen Teils -- Knopf und Erklaerung bleiben sichtbar,
   nur der Wortlaut darunter klappt weg. */
.vorschauBloecke .aufklapp { padding: 8px 12px; border-top: 1px solid #262b33; }
.vorschauBloecke .aufklapp button { font: inherit; font-size: 12.5px; padding: 5px 12px; }
.gelesen { font-size: 13px; margin-top: 8px; }
.gelesen.nein { color: #f0d3a6; }
.gelesen.ja { color: #7bd79a; }
#laufZeilen { max-height: 420px; overflow: auto; margin: 0; padding: 10px 12px;
  background: #101218; border: 1px solid #262b33; border-radius: 6px;
  white-space: pre-wrap; word-break: break-word;
  font: 12.5px/1.5 "Cascadia Mono", Consolas, monospace; color: #c8d0dd; }
#laufZeilen .err { color: #f0b49a; }
#laufZeilen .dienst { color: #8fb0ff; }
.kettezeile { font-size: 13px; color: #9aa3b2; }
.kettezeile b { color: #c8d0dd; }
/* DS: Der Anschluss und seine Grenze. Ein eigener Rahmen, damit die beiden
   Absaetze nicht als Kleingedrucktes zwischen den Schritten untergehen --
   ueberlesen worden ist diese Auskunft schon einmal, und danach lagen zwei
   Plaene uebereinander. */
.anschluss { border-left: 3px solid #5b8cff; background: #171c26; border-radius: 0 6px 6px 0;
  padding: 10px 14px; margin: 0 0 14px; color: #b8c0cd; font-size: 13px; max-width: 90ch; }
.anschluss b { color: #e6e8ec; }
.anschluss.grenze { border-left-color: #b4823a; background: #221c14; }
.anschluss p { margin: 6px 0 0; }
.anschluss code { background: #12141a; border: 1px solid #262b33; border-radius: 4px;
  padding: 1px 5px; }
`;

const SKRIPT = String.raw`
// Nichts an dieser Seite prueft einen Titel, bevor er zum Dienst geht. Die
// Laengengrenze, das Verbot von < und >, die Leerpruefung -- alles das
// entscheidet der Dienst und nur der Dienst. Das Zeichenzaehlfeld unten zaehlt
// und faerbt, es haelt nichts auf. Auch das Titelfeld traegt bewusst KEIN
// maxlength, kein pattern und kein required: ein Browser, der 101 Zeichen gar
// nicht erst zulaesst, macht die serverseitige Pruefung untestbar -- und was
// nicht mehr geprueft werden kann, ist auf Dauer nicht mehr wahr.

const K = DATEN.karten;
const TOKEN = DATEN.token;
const stand = DATEN.stand;      // sha256 -> {freigegeben, titel, notiz, entschieden_am}
let gewaehlt = K.findIndex((k) => k.freigebbar);

function ms(v) {
  const gesamt = Math.max(0, Math.round(v));
  const msTeil = String(gesamt % 1000).padStart(3, '0');
  const s = Math.floor(gesamt / 1000);
  const std = Math.floor(s / 3600);
  const min = String(Math.floor((s % 3600) / 60)).padStart(std ? 2 : 1, '0');
  const sek = String(s % 60).padStart(2, '0');
  return (std ? std + ':' : '') + min + ':' + sek + '.' + msTeil;
}

function el(tag, klasse, text) {
  const n = document.createElement(tag);
  if (klasse) n.className = klasse;
  if (text !== undefined) n.textContent = text;   // maskiert selbst
  return n;
}

function paar(beschriftung, wert) {
  const s = el('span');
  s.append(el('b', null, beschriftung));
  s.append(document.createTextNode(wert));
  return s;
}

// DJb: Eine Anfrage, die NIE ankommt, ist der gefaehrlichere Fall -- gefaehrlicher
// als eine, die abgelehnt wird. Ohne Zeitgrenze wartet fetch endlos: die Knoepfe
// blieben gesperrt, es erschiene keine Meldung, und die Karte saehe aus, als
// werde noch gearbeitet. Ein abgestuerzter Dienst sieht dann genauso aus wie ein
// langsamer.
const ZEITGRENZE_MS = 8000;

async function sende(karte, freigegeben, felder) {
  const antwort = { ok: false, meldung: '', erreichbar: true };
  let res;
  try {
    res = await fetch('/urteil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Freigabe-Token': TOKEN },
      signal: AbortSignal.timeout(ZEITGRENZE_MS),
      body: JSON.stringify({
        index: karte.index,
        freigegeben: freigegeben,
        titel: felder.titel.value,
        notiz: felder.notiz.value,
      }),
    });
  } catch (e) {
    // Zwei Faelle, die von aussen gleich aussehen und es nicht sind: der Dienst
    // ist weg, oder er antwortet nur nicht rechtzeitig. Beide heissen fuer die
    // Karte dasselbe -- NICHTS gespeichert --, aber sie werden benannt.
    const zeit = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    antwort.erreichbar = false;
    antwort.meldung = zeit
      ? 'NICHT GESPEICHERT: der Dienst hat innerhalb von ' + (ZEITGRENZE_MS / 1000) +
        ' Sekunden nicht geantwortet. Es steht NICHTS in der Freigabedatei.'
      : 'NICHT GESPEICHERT: der Dienst antwortet nicht (' + (e && e.name ? e.name : e) +
        '). Es steht NICHTS in der Freigabedatei.';
    return antwort;
  }
  let leib = null;
  try { leib = await res.json(); } catch (e) { leib = null; }
  if (!res.ok) {
    antwort.meldung = 'NICHT GESPEICHERT (HTTP ' + res.status + '): ' +
      ((leib && leib.meldung) ? leib.meldung : 'ohne Begruendung.');
    return antwort;
  }
  antwort.ok = true;
  antwort.eintrag = leib && leib.eintrag ? leib.eintrag : null;
  return antwort;
}

function fortschritt() {
  const frei = K.filter((k) => k.freigebbar);
  const entschieden = frei.filter((k) => stand[k.sha256] !== undefined).length;
  const ja = frei.filter((k) => stand[k.sha256] && stand[k.sha256].freigegeben).length;
  document.getElementById('fortschritt').textContent =
    entschieden + ' von ' + frei.length + ' entschieden — ' + ja + ' freigegeben, ' +
    (entschieden - ja) + ' abgelehnt';
}

function baueKarte(karte) {
  const knoten = el('div', 'karte');
  knoten.id = 'karte-' + karte.index;
  knoten.dataset.index = String(karte.index);

  if (!karte.freigebbar) {
    // Der Leser hat diesen Eintrag abgelehnt. Er wird GEZEIGT -- verschwiegen
    // waere schlimmer als abgelehnt --, aber er ist nicht abspielbar und nicht
    // freigebbar: es gibt weder ein <video> noch ein Formular, und der Dienst
    // weist ein Urteil zu diesem Index ohnehin ab.
    knoten.classList.add('gesperrt');
    const kopf = el('div', 'zeile');
    kopf.append(el('span', 'kennung', '[' + karte.index + ']  ' + karte.kennung));
    kopf.append(el('b', null, 'VOM LESER ABGELEHNT'));
    knoten.append(kopf);
    knoten.append(el('p', 'gesperrtHinweis',
      'Nicht abspielbar und nicht freigebbar. Der Leser hat diesen Eintrag nicht ' +
      'angenommen, also gibt es keine geprueften Daten — weder einen Pfad zum ' +
      'Abspielen noch einen Titelvorschlag. Es wird nichts geraten und nichts ergaenzt.'));
    for (const m of karte.ablehnungsgruende) knoten.append(el('p', 'mangel', '• ' + m));
    return knoten;
  }

  const links = el('div', 'kopfLinks');
  const video = document.createElement('video');
  video.id = 'video-' + karte.index;
  video.controls = true;
  // preload="none": vierzig Karten haetten sonst vierzig gleichzeitig ladende
  // Videos. Geladen wird erst, wenn jemand abspielt.
  video.preload = 'none';
  // DJb: SCHLEIFE, Vorgabe und kein Schalter. Ein Short laeuft auf YouTube in
  // Schleife; wer beurteilt, ob der Schnitt taugt, muss den Uebergang vom Ende
  // zum Anfang sehen -- genau dort faellt ein verzogener Schnitt auf, und genau
  // den bekommt man bei einmaligem Abspielen nie zu sehen.
  //
  // loop hebt preload nicht auf: es beschreibt, was NACH dem Ende geschieht,
  // und ein Video, das nie gestartet wurde, endet nie. Ein nie angeklicktes
  // Video laedt weiterhin nichts (in DJb an Netzdaten gemessen).
  video.loop = true;
  video.src = '/video?i=' + karte.index + '&t=' + encodeURIComponent(TOKEN);
  links.append(video);
  knoten.append(links);

  const rechts = el('div', 'rechts');
  rechts.append(el('div', 'kennung', '[' + karte.index + ']  ' + karte.kennung));

  // Zeitbereich, Dauer und Masse sind ANZEIGE. Es gibt hier bewusst kein
  // Eingabefeld: wer den Schnitt aendern will, aendert ihn beim Cutter.
  const z1 = el('div', 'zeile');
  z1.append(paar('Zeitbereich: ', ms(karte.quelle_von_ms) + ' bis ' + ms(karte.quelle_bis_ms)));
  z1.append(paar('Dauer: ', ms(karte.dauer_ms)));
  z1.append(paar('Bild: ', karte.breite + '×' + karte.hoehe));
  z1.append(paar('Groesse: ', (karte.groesse_bytes / 1048576).toFixed(2) + ' MiB'));
  rechts.append(z1);

  const t = el('div');
  t.append(el('label', null, 'Transkript'));
  t.append(el('div', 'transkript', karte.transkript));
  rechts.append(t);

  const tf = el('div');
  tf.append(el('label', null, 'Titel  —  Vorschlag der Lieferung, KEIN fertiger YouTube-Titel'));
  const titel = document.createElement('input');
  titel.type = 'text';
  titel.id = 'titel-' + karte.index;
  const vorhanden = stand[karte.sha256];
  titel.value = vorhanden ? vorhanden.titel : karte.titel_vorschlag;
  tf.append(titel);
  const zaehler = el('div', 'zaehler');
  tf.append(zaehler);
  rechts.append(tf);

  const nf = el('div');
  nf.append(el('label', null, 'Notiz'));
  const notiz = document.createElement('textarea');
  notiz.id = 'notiz-' + karte.index;
  notiz.value = vorhanden ? vorhanden.notiz : '';
  nf.append(notiz);
  rechts.append(nf);

  const knoepfe = el('div', 'knoepfe');
  const ja = el('button', 'ja', 'Freigeben');
  const nein = el('button', 'nein', 'Ablehnen');
  const standText = el('span', 'stand');
  knoepfe.append(ja, nein, standText);
  rechts.append(knoepfe);
  const fehler = el('div', 'fehler', '');
  rechts.append(fehler);
  knoten.append(rechts);

  const felder = { titel: titel, notiz: notiz };

  function zaehle() {
    const n = Array.from(titel.value).length;
    zaehler.textContent = n + ' von hoechstens 100 Zeichen' +
      (n > 100 ? ' — der Dienst wird das ablehnen.' : '');
    zaehler.style.color = n > 100 ? '#ff9a86' : '#7d8697';
  }
  titel.addEventListener('input', zaehle);
  zaehle();

  function zeigeStand() {
    const e = stand[karte.sha256];
    knoten.classList.remove('freigegeben', 'abgelehnt');
    ja.setAttribute('aria-pressed', String(!!(e && e.freigegeben === true)));
    nein.setAttribute('aria-pressed', String(!!(e && e.freigegeben === false)));
    standText.className = 'stand';
    if (!e) { standText.textContent = 'noch nicht entschieden'; return; }
    knoten.classList.add(e.freigegeben ? 'freigegeben' : 'abgelehnt');
    standText.classList.add(e.freigegeben ? 'ja' : 'nein');
    standText.textContent = (e.freigegeben ? 'FREIGEGEBEN' : 'ABGELEHNT') +
      ' am ' + e.entschieden_am;
  }

  async function urteile(freigegeben) {
    if (sitzungVorbei) return;
    ja.disabled = true; nein.disabled = true;
    fehler.textContent = '';
    knoten.classList.remove('nichtgespeichert');
    const a = await sende(karte, freigegeben, felder);
    if (sitzungVorbei) return;
    ja.disabled = false; nein.disabled = false;
    if (!a.ok) {
      // Der Stand der Karte wird NICHT angefasst. Sie bleibt genau so stehen,
      // wie sie vorher war -- gruen wird sie nur, wenn der Dienst das Urteil
      // bestaetigt hat.
      fehler.textContent = a.meldung;
      knoten.classList.add('nichtgespeichert');
      if (!a.erreichbar) zeigeDienstWeg();
      return;
    }
    stand[karte.sha256] = a.eintrag;
    zeigeStand();
    fortschritt();
  }

  ja.addEventListener('click', function () { urteile(true); });
  nein.addEventListener('click', function () { urteile(false); });
  knoten.addEventListener('mousedown', function () { gewaehlt = karte.index; zeichneWahl(); });
  knoten.__urteile = urteile;
  zeigeStand();
  return knoten;
}

function zeichneWahl() {
  const alle = document.querySelectorAll('.karte');
  for (let i = 0; i < alle.length; i++) {
    alle[i].classList.toggle('gewaehlt', Number(alle[i].dataset.index) === gewaehlt);
  }
}

const haupt = document.getElementById('karten');
for (const karte of K) haupt.append(baueKarte(karte));
zeichneWahl();
fortschritt();

// Tastenfuehrung ist ein BESCHLEUNIGER. Jede Handlung hier hat einen Knopf
// daneben, den man mit der Maus druecken kann; keine Handlung ist nur ueber die
// Tastatur erreichbar.
function naechsteFreigebbare(von, richtung) {
  const frei = K.filter((k) => k.freigebbar).map((k) => k.index);
  if (!frei.length) return von;
  const pos = frei.indexOf(von);
  if (pos === -1) return frei[0];
  return frei[Math.min(frei.length - 1, Math.max(0, pos + richtung))];
}

function springe(richtung) {
  gewaehlt = naechsteFreigebbare(gewaehlt, richtung);
  zeichneWahl();
  const k = document.getElementById('karte-' + gewaehlt);
  if (k) k.scrollIntoView({ block: 'center' });
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  const karte = document.getElementById('karte-' + gewaehlt);
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); springe(1); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); springe(-1); }
  else if (e.code === 'Space') {
    e.preventDefault();
    const v = document.getElementById('video-' + gewaehlt);
    if (v) { if (v.paused) v.play(); else v.pause(); }
  } else if (e.key === '1') {
    e.preventDefault(); if (karte && karte.__urteile) karte.__urteile(true);
  } else if (e.key === '2') {
    e.preventDefault(); if (karte && karte.__urteile) karte.__urteile(false);
  }
});

// DJb: ZWEI ZUSTAENDE, DIE NICHT MEHR GLEICH AUSSEHEN DUERFEN.
//
// Bis hierher blieb die Seite nach einem gelungenen Beenden unveraendert
// stehen. Fuer den Menschen sah ein sauber abgeschalteter Dienst damit genauso
// aus wie ein kaputter Knopf -- dasselbe Muster wie Zeile 43 gegen Zeile 104 im
// Freigabeskript und wie netstat in DJa.
//
// Ausgeloest wird das hier ausschliesslich von einer ANTWORT: der auf
// POST /beenden, oder einer ausbleibenden auf POST /urteil. Die Seite erfaehrt
// nur, was auf ihre eigenen Anfragen zurueckkommt.
//
// DR: Bis hierher hiess diese Zusage zusaetzlich "holt keinen neuen Stand, hat
// kein setInterval und bekommt keines". Der erste Teil stimmt so nicht mehr,
// und er wird berichtigt statt weiter behauptet: die Seite fragt beim Laden
// einmal /kette ab und waehrend eines LAUFENDEN Uploads wiederholt /lauf.
//
// Was gleich bleibt und der eigentliche Punkt war: die Seite fragt nie im
// Hintergrund nach einem Zustand, den niemand angestossen hat. Der einzige
// wiederholte Aufruf ist /lauf; er beginnt mit einem Klick auf Schritt 3 (oder
// mit dem Laden einer Seite, waehrend ein Lauf schon laeuft), und er endet an
// der Antwort des Dienstes -- laeuft:false --, nicht an einer Zeitrechnung
// hier. Es gibt weiterhin kein setInterval, kein Neuladen, kein EventSource
// und kein WebSocket, und die Karten holen sich weiterhin nichts.
let sitzungVorbei = false;

function sperreAlleKarten() {
  const felder = document.querySelectorAll('#karten input, #karten textarea, #karten button');
  for (let i = 0; i < felder.length; i++) felder[i].disabled = true;
  document.getElementById('karten').classList.add('vorbei');
  // DR: Die Kette gehoert dazu. Ihre Knoepfe sprechen mit demselben Dienst;
  // nach dem Abschalten haetten sie nur noch "antwortet nicht" zu bieten, und
  // ein Knopf, der ins Leere greift, sieht aus wie ein kaputter.
  const kette = document.getElementById('kette');
  if (kette) {
    const kk = kette.querySelectorAll('button');
    for (let i = 0; i < kk.length; i++) kk[i].disabled = true;
    kette.classList.add('vorbei');
  }
}

function zeigeSitzungsende() {
  sitzungVorbei = true;
  sperreAlleKarten();
  const knopf = document.getElementById('beenden');
  knopf.disabled = true;
  knopf.textContent = 'Sitzung beendet';
  const kasten = document.getElementById('beendet');
  kasten.hidden = false;
  kasten.className = 'warnung ende';
  kasten.textContent = '';
  const frei = K.filter((k) => k.freigebbar);
  const ja = frei.filter((k) => stand[k.sha256] && stand[k.sha256].freigegeben).length;
  const nein = frei.filter((k) => stand[k.sha256] && stand[k.sha256].freigegeben === false).length;
  const offen = frei.length - ja - nein;
  kasten.append(el('b', null, 'Die Sitzung ist beendet. Der Dienst laeuft nicht mehr.'));
  kasten.append(el('p', null,
    ja + ' freigegeben, ' + nein + ' abgelehnt, ' + offen + ' ohne Urteil. ' +
    'Geschrieben wurde nach jedem einzelnen Klick, nicht jetzt -- dieser Knopf hat ' +
    'nichts gespeichert, er hat nur abgeschaltet.'));
  kasten.append(el('p', null, 'Die Urteile stehen in:'));
  kasten.append(el('code', null, DATEN.freigabePfad));
  kasten.append(el('p', null,
    'Diese Seite ist ab jetzt tot: sie kann nichts mehr speichern, und die Karten ' +
    'nehmen darum nichts mehr an. Zum Weiterarbeiten den Dienst neu starten -- die ' +
    'Urteile von eben stehen dann wieder auf ihren Karten.'));
  window.scrollTo({ top: 0 });
}

// Der andere Weg in denselben Zustand: der Dienst ist weg, ohne dass ihn
// jemand beendet haette. Die Karten bleiben hier BEDIENBAR -- vielleicht kommt
// er zurueck --, aber niemand soll glauben, es werde noch gespeichert.
let dienstWegGemeldet = false;
function zeigeDienstWeg() {
  if (dienstWegGemeldet || sitzungVorbei) return;
  dienstWegGemeldet = true;
  const kasten = document.getElementById('beendet');
  kasten.hidden = false;
  kasten.className = 'warnung weg';
  kasten.textContent = '';
  kasten.append(el('b', null, 'Der Dienst antwortet nicht.'));
  kasten.append(el('p', null,
    'Seit dieser Meldung wird NICHTS mehr gespeichert. Was vorher gruen oder rot ' +
    'wurde, steht in der Freigabedatei; alles danach nicht. Starte den Dienst neu ' +
    'und lade die Seite unter der neuen Adresse -- das Sitzungstoken dieser Seite ' +
    'gilt nur fuer den Start, der gerade weg ist.'));
  kasten.append(el('code', null, DATEN.freigabePfad));
  window.scrollTo({ top: 0 });
}

document.getElementById('beenden').addEventListener('click', async () => {
  const knopf = document.getElementById('beenden');
  // Punkt 6: eine Rueckfrage, und sie nennt die Zahl. "Willst du wirklich?"
  // ohne Zahl ist eine Frage, die man wegklickt.
  const frei = K.filter((k) => k.freigebbar);
  const offen = frei.filter((k) => stand[k.sha256] === undefined).length;
  if (offen > 0) {
    const weiter = window.confirm(
      offen + ' von ' + frei.length + ' Karten haben noch kein Urteil.\n\n' +
      'Sitzung trotzdem beenden? Die bereits gefaellten Urteile sind gespeichert ' +
      'und bleiben es -- die offenen bleiben offen.');
    if (!weiter) return;
  }
  knopf.disabled = true;
  knopf.textContent = 'beende ...';
  try {
    const res = await fetch('/beenden', {
      method: 'POST', headers: { 'X-Freigabe-Token': TOKEN },
      signal: AbortSignal.timeout(ZEITGRENZE_MS),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    zeigeSitzungsende();
  } catch (e) {
    // Auch das Scheitern wird benannt. Ein Knopf, der zurueckspringt und sonst
    // nichts tut, ist genau der Zustand, den Punkt 5 abschafft.
    knopf.disabled = false;
    knopf.textContent = 'Sitzung beenden';
    zeigeDienstWeg();
  }
});

// ---------------------------------------------------------------------------
// DR: DIE KETTE -- Einplanen, Vorschau lesen, Hochladen
// ---------------------------------------------------------------------------
//
// Bis DR endete diese Seite an den Karten, und danach tippte ein Mensch zwei
// Befehle ins Terminal. Hier stehen jetzt drei Schritte. Was diese Seite dabei
// NICHT tut, ist der Punkt:
//
//   - Sie entscheidet nichts. Ob Schritt 3 gehen darf, sagt der Dienst
//     (Feld schritt3 aus /kette); der Knopf hier ist gesperrt, WEIL der Dienst
//     das sagt, und nicht damit der Dienst es nicht mehr sagen muss. Eine
//     Anfrage, die diesen Browser umgeht, faellt dort und nicht hier.
//   - Sie baut keine Vorschau. Was in den Bloecken steht, ist woertlich die
//     Ausgabe des Trockenlaufs, wie sie im Terminal stuende -- ueber
//     textContent in den Baum gesetzt, nicht als Markup.
//     DT: Sie kuerzt sie auch nicht. Dass je Short nur die erste und die
//     letzte Zeile des Textes unter dem Video dasteht und der gemeinsame Teil
//     einmal am Ende, entscheidet der Uploader; diese Seite klappt den einen
//     Block zusammen und faerbt die beiden Terminzeilen -- mehr nicht. Der
//     Wortlaut bleibt Zeichen fuer Zeichen der des Trockenlaufs, auch der
//     zugeklappte.
//   - Sie kennt keinen Kanal, keine Pruefsumme und keine Zahl, die sie sich
//     selbst ausgerechnet haette.
//
// ZEITGRENZEN: Schritt 1 startet den Planer und einen Trockenlauf, der ueber
// jede Videodatei eine sha256 rechnet. Acht Sekunden reichen dafuer nicht --
// darum eine eigene, lange Grenze. Ohne Grenze bliebe der Knopf bei einem
// abgestuerzten Dienst fuer immer im Zustand "laeuft", und das ist genau das
// Fehlerbild, gegen das ZEITGRENZE_MS oben gebaut ist.
const ZEITGRENZE_KETTE_MS = 300000;
const ZEITGRENZE_LAUF_MS = 15000;

let kette = null;
let vorschauGelesen = false;
// DT: Der gemeinsame Teil des Textes unter dem Video -- ob er in dieser
// Vorschau ueberhaupt vorkommt, und ob ihn jemand aufgeklappt hat. Beides geht
// in die Lesesperre ein; warum, steht bei pruefeGelesen().
let gemeinsamVorhanden = false;
let gemeinsamAufgeklappt = false;
let laufAb = 0;
let laufSchleifeLaeuft = false;

function kel(id) { return document.getElementById(id); }

async function hole(pfad, verfahren, grenze) {
  const res = await fetch(pfad, {
    method: verfahren,
    headers: { 'X-Freigabe-Token': TOKEN },
    signal: AbortSignal.timeout(grenze),
  });
  let leib = null;
  try { leib = await res.json(); } catch (e) { leib = null; }
  if (!res.ok) {
    const e = new Error((leib && leib.meldung) ? leib.meldung : 'HTTP ' + res.status);
    e.status = res.status;
    throw e;
  }
  return leib;
}

function setzeMeldung(m) {
  const kasten = kel('kettemeldung');
  if (!m) { kasten.hidden = true; return; }
  kasten.hidden = false;
  kasten.className = 'warnung' + (m.art === 'bereit' ? ' ende' : (m.art === 'fehler' || m.art === 'gesperrt' ? ' weg' : ''));
  kasten.textContent = '';
  kasten.append(el('b', null, m.ueberschrift));
  if (m.text) kasten.append(el('pre', null, m.text));
  if (m.befehl) {
    kasten.append(el('p', null, 'Derselbe Schritt im Terminal:'));
    kasten.append(el('code', null, m.befehl));
  }
}

// DT: DIE BEIDEN MARKEN AUS DEM UPLOADER.
//
// Woertlich dieselben Zeichenketten stehen in src/upload/uploader.js als
// GEMEINSAM_UEBERSCHRIFT und GEMEINSAM_BEFUND -- dort werden sie geschrieben,
// hier gesucht. Sie stehen hier ein zweites Mal und nicht per require, weil
// dieser Text im Browser laeuft und dieses Modul absichtlich weder fs noch
// den Uploader kennt. Dass beide Stellen dasselbe sagen, prueft
// tests/dt-vorschau.test.cjs -- laufen sie auseinander, schlaegt der Test an,
// und nicht erst ein Mensch, dem der Knopf fehlt.
const GEMEINSAM_MARKE = 'DER GEMEINSAME TEIL DER BESCHREIBUNG';
const BEFUND_MARKE = 'BEFUND: DER GEMEINSAME TEIL IST NICHT BEI ALLEN SHORTS GLEICH';

// DT: Die Terminzeilen des Trockenlaufs. Erkannt am Wortlaut, den der Uploader
// schreibt -- nicht an einer Position und nicht an einem Datumsmuster.
const TERMINZEILE = /^\s*publishAt (UTC|Ortszeit):/;

// DT: Faerbt die Terminzeilen in einem <pre>, das seinen Text bereits hat.
//
// ERST DER TEXT, DANN DIE FARBE -- und in dieser Reihenfolge aus einem Grund:
// der Block geht unveraendert ueber textContent in den Baum, so wie vor DT.
// Was danach hier geschieht, ist reines Umhaengen: derselbe Text wird
// zeilenweise wieder eingesetzt, zwei Zeilen davon in einem <span>. Vorher und
// nachher ist textContent Zeichen fuer Zeichen derselbe. Die Seite faerbt --
// sie formuliert nicht, sie kuerzt nicht, und sie kann es hier auch nicht,
// weil sie nur wieder einsetzt, was sie vorgefunden hat.
function faerbeTermine(pre) {
  const zeilen = pre.textContent.split('\n');
  if (!zeilen.some((z) => TERMINZEILE.test(z))) return pre;
  pre.textContent = '';
  zeilen.forEach((zeile, i) => {
    const inhalt = zeile + (i < zeilen.length - 1 ? '\n' : '');
    if (TERMINZEILE.test(zeile)) pre.append(el('span', 'termin', inhalt));
    else pre.append(document.createTextNode(inhalt));
  });
  return pre;
}

// Die Vorschau in Bloecken statt als Klumpen. Der Trockenlauf trennt seine
// Shorts mit einer Zeile aus 78 Gleichheitszeichen; genau daran wird
// geschnitten. Faende sich keine, stuende alles in einem Block -- dann waere
// die Ausgabe ein Klumpen, und das saehe man auch.
function baueVorschau(v) {
  const bereich = kel('vorschauBloecke');
  bereich.textContent = '';
  gemeinsamVorhanden = false;
  gemeinsamAufgeklappt = false;
  const teile = v.text.split(/\n=+\n/);
  let nr = 0;
  for (const teil of teile) {
    if (!teil.trim()) continue;
    const block = el('div', 'block');
    const ersteZeile = teil.trim().split('\n')[0].trim();
    const istShort = /^\[\d+\/\d+\]/.test(ersteZeile);
    const istGemeinsam = ersteZeile.indexOf(GEMEINSAM_MARKE) === 0;
    const istBefund = ersteZeile.indexOf(BEFUND_MARKE) === 0;
    if (istShort) nr += 1;
    // Vor dem ersten Short steht die Lage des Laufs, danach die Schlusszeilen
    // des Trockenlaufs. Beide sind keine Shorts und bekommen darum eine
    // Ueberschrift, die sagt, was sie sind -- zweimal "Lage dieses Laufs"
    // waere eine Ueberschrift, die luegt.
    block.append(el('h4', null,
      istShort ? ersteZeile
        : istGemeinsam ? 'Der gemeinsame Teil — er steht unter jedem dieser Videos'
        : istBefund ? 'BEFUND — der gemeinsame Teil ist nicht bei allen gleich'
        : (nr === 0 ? 'Lage dieses Laufs' : 'Was der Trockenlauf zum Schluss sagt')));
    // DT: Der gemeinsame Teil wird an der ersten Zeile geteilt, die der
    // Uploader mit "| " einrueckt -- das ist bei ihm die erste Zeile des
    // Wortlauts. Die Erklaerung darueber bleibt sichtbar, der Wortlaut klappt
    // weg. Findet sich keine solche Zeile, bleibt alles sichtbar: lieber zu
    // viel Text als ein Knopf, hinter dem nichts ist.
    const zeilen = teil.replace(/^\n+|\n+$/g, '').split('\n');
    let ab = -1;
    if (istGemeinsam) {
      for (let i = 0; i < zeilen.length; i++) {
        if (/^\s*\| /.test(zeilen[i])) { ab = i; break; }
      }
    }
    if (ab > 0) {
      block.append(el('pre', null, zeilen.slice(0, ab).join('\n')));
      const wortlaut = el('pre', null, zeilen.slice(ab).join('\n'));
      wortlaut.hidden = true;
      const leiste = el('div', 'aufklapp');
      const knopf = el('button', null, 'Den gemeinsamen Teil aufklappen');
      knopf.addEventListener('click', () => {
        wortlaut.hidden = !wortlaut.hidden;
        knopf.textContent = wortlaut.hidden
          ? 'Den gemeinsamen Teil aufklappen'
          : 'Den gemeinsamen Teil zuklappen';
        if (!wortlaut.hidden) gemeinsamAufgeklappt = true;
        pruefeGelesen();
      });
      leiste.append(knopf);
      block.append(leiste);
      block.append(wortlaut);
      gemeinsamVorhanden = true;
    } else {
      // Woertlich wie vor DT: der Block geht als EIN Text ueber textContent in
      // den Baum, und zwar bevor irgendetwas gefaerbt wird.
      block.append(el('pre', null, teil.replace(/^\n+|\n+$/g, '')));
    }
    for (const pre of block.querySelectorAll('pre')) faerbeTermine(pre);
    bereich.append(block);
  }
  kel('vorschau').hidden = false;
  kel('vorschauKopf').textContent =
    v.anzahl + ' Short(s) in diesem Lauf, ' + v.termine_im_plan + ' Termine im Plan, ' +
    v.schon_hochgeladen + ' schon hochgeladen. Plan-sha256 ' + v.plan_sha256 + '. ' +
    'Erzeugt ' + v.erstellt_am + ' -- woertlich die Ausgabe von: ' + (v.befehl || '');
  vorschauGelesen = false;
  pruefeGelesen();
}

// "Wer sie ueberspringt, soll das merken." Der scharfe Knopf bleibt gesperrt,
// bis die Vorschau einmal bis unten durchgelaufen ist. Passt sie ohnehin ganz
// ins Feld, gibt es nichts zu scrollen und sie gilt sofort als gesehen -- eine
// Huerde, die sich nicht ueberwinden LAESST, waere keine Huerde, sondern ein
// Fehler.
//
// DT: DER ZUGEKLAPPTE TEIL ZAEHLT MIT -- ER MUSS AUFGEKLAPPT GEWESEN SEIN.
//
// Seit DT ist die Vorschau kuerzer, und das ist beabsichtigt: eine Huerde, die
// leichter zu nehmen ist, weil weniger Wand davorsteht, bleibt eine Huerde.
// Was sie NICHT werden darf, ist eine Formalitaet. Genau das waere passiert,
// haette der zugeklappte Teil nicht mitgezaehlt: zugeklappt passt die Vorschau
// womoeglich ganz ins Feld, gaelte damit im selben Augenblick als gesehen --
// und der eine Text, der unter JEDEM der Videos steht, waere der einzige, den
// niemand mehr zu Gesicht bekaeme. Das Feld, auf das die Sperre zielt, waere
// das einzige geworden, das sie nicht mehr deckt.
//
// Darum: solange ein gemeinsamer Teil da ist und zugeklappt, gilt die Vorschau
// nicht als gelesen -- weder durch Scrollen noch dadurch, dass sie ins Feld
// passt. Ein Klick, danach gilt die alte Regel unveraendert weiter. Gibt es
// keinen gemeinsamen Teil (ein Short, ein Befund, eine Vorlage ohne
// Mittelteil), gibt es auch nichts aufzuklappen, und es bleibt bei der alten
// Regel -- eine Huerde, die sich nicht nehmen laesst, waere wieder ein Fehler.
function pruefeGelesen() {
  const bereich = kel('vorschauBloecke');
  const offen = !gemeinsamVorhanden || gemeinsamAufgeklappt;
  if (!vorschauGelesen && offen && bereich.scrollHeight - bereich.clientHeight <= 4) vorschauGelesen = true;
  const hinweis = kel('gelesen');
  hinweis.className = 'gelesen ' + (vorschauGelesen ? 'ja' : 'nein');
  hinweis.textContent = vorschauGelesen
    ? 'Vorschau bis zum Ende gesehen.'
    : (!offen
      ? 'Der gemeinsame Teil ist noch zugeklappt. Er ist der Text, der unter JEDEM dieser ' +
        'Videos steht -- der Knopf "Hochladen" bleibt gesperrt, bis er einmal aufgeklappt ' +
        'und die Vorschau bis unten durchgelaufen ist.'
      : 'Die Vorschau ist laenger als das Feld. Der Knopf "Hochladen" bleibt gesperrt, bis sie ' +
        'einmal bis unten durchgelaufen ist -- was gleich veroeffentlicht wird, steht darin.');
  zeichneKette();
}

function zeichneKette() {
  if (kette === null) return;
  // Nach dem Sitzungsende bleibt gesperrt, was gesperrt wurde.
  if (sitzungVorbei) return;
  const k = kette;

  kel('ketteLage').textContent =
    'Aufnahme ' + k.aufnahme + '   —   Plan: ' +
    (k.plan_vorhanden ? 'vorhanden (' + k.plan_pfad + ')' : 'noch keiner');

  const s1 = kel('schritt1');
  s1.disabled = !!(k.lauf && k.lauf.laeuft) || !k.eigene_projektwurzel;

  const arch = kel('archivieren');
  arch.hidden = !k.plan_vorhanden;
  arch.disabled = !!(k.lauf && k.lauf.laeuft);

  const s3 = kel('schritt3');
  const v = k.vorschau;
  s3.textContent = (v && v.anzahl)
    ? 'Schritt 3: ' + v.anzahl + ' Short(s) hochladen — als PRIVAT auf den Kanal "' +
      (v.kanal_name || '?') + '"'
    : 'Schritt 3: Hochladen';
  const serverBereit = k.schritt3 && k.schritt3.bereit;
  s3.disabled = !serverBereit || !vorschauGelesen;
  kel('schritt3grund').textContent = serverBereit
    ? (vorschauGelesen
      ? 'Ein Klick, kein getipptes Wort. Der Dienst schreibt dabei eine Einmal-Ermaechtigung; ' +
        'der Uploader prueft sie, verbraucht sie und loescht sie.'
      : 'Erst die Vorschau lesen.')
    : (k.schritt3 ? k.schritt3.grund : '');

  const kanalzeile = kel('kanalzeile');
  if (v && v.kanal_bekannt) {
    kanalzeile.textContent = 'Kanal laut data/inventory.json: "' + v.kanal_name + '"' +
      (v.kanal_erzeugt_am ? ' (Stand ' + v.kanal_erzeugt_am + ')' : '') +
      '. Die Kanalkennung geht in die Ermaechtigung; der Uploader haelt sie gegen den ' +
      'angemeldeten Kanal und laedt nichts hoch, wenn sie abweicht.';
  } else if (v) {
    kanalzeile.textContent = 'KEIN KANAL ZU BENENNEN: ' + v.kanal_grund;
  } else {
    kanalzeile.textContent = '';
  }
}

function zeichneLauf(daten) {
  kel('lauf').hidden = false;
  const kopf = kel('laufKopf');
  kopf.textContent = '';
  if (daten.lauf) {
    kopf.append(el('p', 'kettezeile',
      'Gestartet ' + daten.lauf.gestartet_am + ' — ' + daten.lauf.anzahl +
      ' Short(s) auf "' + daten.lauf.kanal + '".'));
    kopf.append(el('code', null, daten.lauf.befehl));
  }
  const ziel = kel('laufZeilen');
  for (const z of daten.zeilen) {
    const zeile = el('div', z.art === 'err' ? 'err' : (z.art === 'dienst' ? 'dienst' : ''), z.zeile);
    ziel.append(zeile);
  }
  ziel.scrollTop = ziel.scrollHeight;
  laufAb = daten.gesamt !== undefined ? daten.gesamt : laufAb;

  const ende = kel('laufEnde');
  if (daten.ende) {
    ende.hidden = false;
    ende.className = 'warnung ' + (daten.ende.code === 0 ? 'ende' : 'weg');
    ende.textContent = '';
    ende.append(el('b', null, daten.ende.code === 0
      ? 'Der Uploader ist sauber durchgelaufen (Rueckgabewert 0).'
      : 'Der Uploader ist mit Rueckgabewert ' + daten.ende.code + ' beendet.'));
    ende.append(el('p', null,
      daten.ende.code === 0
        ? 'Was hochgeladen wurde, was uebersprungen und wo das Gedaechtnis liegt, steht in den ' +
          'letzten Zeilen oben — sie sind woertlich die des Uploaders.'
        : 'Der Grund steht oben im Wortlaut. Es ist nichts geraten und nichts ergaenzt.'));
    ende.append(el('p', null, daten.ende.ermaechtigung_noch_da
      ? 'ACHTUNG: die Ermaechtigungsdatei liegt noch da — der Uploader hat sie nicht ' +
        'verbraucht. Sie laeuft von selbst ab.'
      : 'Die Ermaechtigung ist verbraucht und geloescht. Ein weiterer Upload braucht wieder ' +
        'Schritt 1 und Schritt 3.'));
  }
}

function schlaf(ms) { return new Promise((f) => setTimeout(f, ms)); }

// Der einzige wiederholte Aufruf dieser Seite -- und er laeuft NUR, solange
// ein Lauf laeuft, den dieser Browser selbst angestossen hat. Er hoert von
// selbst auf: das Ende kommt aus der Antwort des Dienstes, nicht aus einer
// Zeitrechnung hier.
async function verfolgeLauf() {
  if (laufSchleifeLaeuft) return;
  laufSchleifeLaeuft = true;
  try {
    for (;;) {
      let daten;
      try {
        daten = await hole('/lauf?ab=' + laufAb, 'GET', ZEITGRENZE_LAUF_MS);
      } catch (e) {
        kel('laufEnde').hidden = false;
        kel('laufEnde').className = 'warnung weg';
        kel('laufEnde').textContent =
          'Der Dienst antwortet nicht mehr (' + e.message + '). Was der Uploader tut, ist von ' +
          'hier aus nicht mehr zu sehen — im Terminal des Dienstes steht es weiter.';
        return;
      }
      zeichneLauf(daten);
      if (!daten.laeuft) {
        kette = await hole('/kette', 'GET', ZEITGRENZE_LAUF_MS);
        zeichneKette();
        return;
      }
      await schlaf(700);
    }
  } finally {
    laufSchleifeLaeuft = false;
  }
}

async function ladeKette() {
  try {
    kette = await hole('/kette', 'GET', ZEITGRENZE_LAUF_MS);
  } catch (e) {
    kel('ketteLage').textContent = 'Der Zustand der Kette ist nicht abrufbar: ' + e.message;
    return;
  }
  setzeMeldung(kette.meldung);
  if (kette.vorschau) baueVorschau(kette.vorschau);
  zeichneKette();
  if (kette.lauf) { laufAb = 0; kel('laufZeilen').textContent = ''; verfolgeLauf(); }
}

kel('vorschauBloecke').addEventListener('scroll', () => {
  const b = kel('vorschauBloecke');
  // DT: Bis unten gescrollt zaehlt nur, wenn der gemeinsame Teil dabei offen
  // war. Sonst waere "bis unten" das Ende einer Vorschau, aus der genau der
  // Text herausgeklappt ist, um den es geht.
  if (gemeinsamVorhanden && !gemeinsamAufgeklappt) return;
  if (b.scrollTop + b.clientHeight >= b.scrollHeight - 4) {
    if (!vorschauGelesen) { vorschauGelesen = true; pruefeGelesen(); }
  }
});

async function knopfLauf(knopf, text, arbeit) {
  const alt = knopf.textContent;
  knopf.disabled = true;
  knopf.textContent = text;
  try {
    await arbeit();
  } catch (e) {
    setzeMeldung({ art: 'fehler', ueberschrift: 'Der Schritt ist nicht durchgelaufen.',
      text: e.message, befehl: null });
  } finally {
    knopf.textContent = alt;
    zeichneKette();
  }
}

kel('schritt1').addEventListener('click', () => knopfLauf(kel('schritt1'),
  'plane ein und rechne die Vorschau ...', async () => {
    kel('vorschau').hidden = true;
    kel('lauf').hidden = true;
    kette = await hole('/planen', 'POST', ZEITGRENZE_KETTE_MS);
    setzeMeldung(kette.meldung);
    if (kette.vorschau) baueVorschau(kette.vorschau);
  }));

kel('archivieren').addEventListener('click', () => {
  const weiter = window.confirm(
    'Den bestehenden Plan nach data/plaene/archiv/ verschieben und danach neu planen?\n\n' +
    'Er wird verschoben, nicht geloescht. Ein Plan ist der Beleg dafuer, was hochgeladen ' +
    'werden sollte — deshalb ist das ein eigener Knopf und kein Zwischenschritt.');
  if (!weiter) return;
  knopfLauf(kel('archivieren'), 'archiviere ...', async () => {
    kel('vorschau').hidden = true;
    kette = await hole('/archivieren', 'POST', ZEITGRENZE_KETTE_MS);
    setzeMeldung(kette.meldung);
  });
});

kel('schritt3').addEventListener('click', () => knopfLauf(kel('schritt3'),
  'starte den Uploader ...', async () => {
    laufAb = 0;
    kel('laufZeilen').textContent = '';
    kel('laufEnde').hidden = true;
    await hole('/hochladen', 'POST', ZEITGRENZE_LAUF_MS);
    kette = await hole('/kette', 'GET', ZEITGRENZE_LAUF_MS);
    zeichneKette();
    verfolgeLauf();
  }));

ladeKette();
`;

// sitzung: { aufnahme, freigabePfad, token, eingabeSha256, karten, stand }
function baueSeite(sitzung) {
  const nutzlast = {
    token: sitzung.token,
    karten: sitzung.karten,
    stand: sitzung.stand,
    // DJb: Am Ende der Sitzung soll dort stehen, WO die Urteile liegen. Der
    // Pfad steht zwar schon in der Kopfzeile, aber der Kasten am Ende ist die
    // Stelle, die ein Mensch tatsaechlich liest.
    freigabePfad: sitzung.freigabePfad,
  };
  const freigebbar = sitzung.karten.filter((k) => k.freigebbar).length;
  const gesperrt = sitzung.karten.length - freigebbar;
  const kopf1 = 'Aufnahme ' + sitzung.aufnahme + ' — ' + sitzung.karten.length +
    ' Eintraege, ' + freigebbar + ' freigebbar, ' + gesperrt + ' vom Leser abgelehnt';
  const kopf2 = 'Freigabedatei: ' + sitzung.freigabePfad +
    '   —   sha256 der Lesereingabe: ' + sitzung.eingabeSha256;
  return [
    '<!doctype html>',
    '<html lang="de"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // Keine fremde Quelle, kein Inline-Ereignisattribut, kein Formular. Die
    // Seite laedt nichts nach und ruft nichts nach draussen.
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
      'style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; media-src \'self\'; ' +
      'connect-src \'self\'; form-action \'none\'; base-uri \'none\'">',
    '<title>Shorts-Freigabe</title>',
    '<style>' + STIL + '</style></head><body>',
    '<header>',
    '<h1>Shorts-Freigabe</h1>',
    '<div class="kopfzeile" id="kopf1"></div>',
    '<div class="kopfzeile" id="kopf2"></div>',
    '<div class="kopfwerkzeug">',
    '<span id="fortschritt"></span>',
    '<span class="kopfzeile"><kbd>&#8593;</kbd>/<kbd>&#8595;</kbd> Karte &middot; ' +
      '<kbd>Leer</kbd> abspielen &middot; <kbd>1</kbd> freigeben &middot; ' +
      '<kbd>2</kbd> ablehnen &mdash; jede dieser Handlungen geht auch mit der Maus</span>',
    '<button id="beenden">Sitzung beenden</button>',
    '<span class="kopfzeile">Die Urteile sind bereits gespeichert &mdash; dieser Knopf ' +
      'speichert nichts, er schliesst nur.</span>',
    '</div></header>',
    // Der Kasten ist leer und versteckt. Was drinsteht, entscheidet sich erst
    // an einer Antwort des Dienstes -- Sitzungsende oder "antwortet nicht".
    '<div class="warnung" id="beendet" hidden></div>',
    '<main id="karten"></main>',
    // DR: Die Kette. Sie steht UNTERHALB der Karten und nicht darueber: erst
    // wird geurteilt, dann geplant, dann hochgeladen. Wer hier oben anfaengt,
    // plant Urteile ein, die noch niemand gefaellt hat.
    '<section id="kette">',
    '<h2>Nach der Freigabe &mdash; einplanen, lesen, hochladen</h2>',
    '<p class="erklaerung">Diese drei Schritte ersetzen die beiden Befehle, die bisher ins ' +
      'Terminal getippt wurden. Der Terminalweg bleibt vollstaendig bestehen und verlangt ' +
      'dort weiterhin das getippte Wort &mdash; er ist der Rueckfallweg, wenn dieser Dienst ' +
      'nicht laeuft. Was hier wegfaellt, ist das Tippen. Was nicht wegfaellt: dass ein ' +
      'Mensch unmittelbar vorher sieht, was veroeffentlicht wird.</p>',
    '<p class="kettezeile" id="ketteLage"></p>',
    '<div class="schritt">',
    '<h3>Schritt 1 &mdash; einplanen und Vorschau rechnen</h3>',
    '<p>Ruft den Planer (schreibt <code>data/plaene/&lt;aufnahme&gt;.json</code>) und danach ' +
      'den Trockenlauf des Uploaders. Der Trockenlauf macht keinen Netzaufruf und laedt ' +
      'nichts hoch.</p>',
    // DS: WORAN DER PLAN ANSCHLIESST -- an der Stelle, an der geplant wird.
    // Diese beiden Absaetze sind woertlicher Text der Seite und enthalten
    // keinen Wert aus der Lieferung; sie duerfen darum als Markup hier stehen
    // (siehe den Kopf dieser Datei). Was sie sagen, sagt der Planer in seiner
    // Ausgabe und im Kopf der Planungsdatei noch einmal -- diese Seite ist
    // nicht die einzige Stelle, an der es steht.
    '<div class="anschluss">',
    '<b>Woran der Plan anschliesst.</b> Der Planer setzt den Anfang seines ' +
      '24-Stunden-Fensters auf das <b>spaetere</b> von zwei Zeitpunkten: auf jetzt, oder ' +
      'auf den spaetesten Termin, der aus einem frueheren Lauf noch aussteht. So legen ' +
      'sich neue Termine nicht ueber schon vergebene.',
    '<p>Woran <em>dieser</em> Lauf angeschlossen hat, steht im Kopf der Planungsdatei ' +
      'unter <code>anschluss</code>: der letzte ausstehende Termin mit seiner Aufnahme und ' +
      'seiner Kennung, alle ausstehenden Termine einzeln, und aus welchen ' +
      'Gedaechtnisdateien sie stammen. Dieselbe Auskunft steht in der Ausgabe des Planers ' +
      '&mdash; im Terminal unter dem Befehl, der im Kasten oben genannt wird.</p>',
    '</div>',
    '<div class="anschluss grenze">',
    '<b>Die Grenze dieser Regel.</b> Der Planer sieht nur, was <b>dieses Werkzeug</b> ' +
      'hochgeladen hat (<code>data/uploads/</code>). Ein Video, das von Hand im ' +
      'YouTube-Studio eingeplant wurde, steht dort nicht und kommt in der Rechnung nicht ' +
      'vor: der Planer hat kein Netz, keine Zugangsdaten und fragt den Kanal nicht ' +
      '&mdash; und das soll so bleiben.',
    '<p>Wer von Hand einplant, haelt den Plan selbst dagegen. Diese eine Frage nimmt ' +
      'einem dieser Bildschirm nicht ab.</p>',
    '</div>',
    '<div class="knoepfe">',
    '<button id="schritt1" class="gross">Einplanen und Vorschau</button>',
    '<button id="archivieren" hidden>Alten Plan archivieren und neu planen</button>',
    '</div>',
    '<div class="warnung" id="kettemeldung" hidden></div>',
    '</div>',
    '<div class="schritt" id="vorschau" hidden>',
    '<h3>Schritt 2 &mdash; die Vorschau lesen</h3>',
    // DS: WAS HIER STEHT UND WAS NICHT. Die Bloecke unten sind woertlich die
    // Ausgabe des Uploader-Trockenlaufs. Der kennt den Plan DIESER Aufnahme
    // und sonst nichts -- die noch ausstehenden Termine anderer Aufnahmen
    // kommen darin nicht vor. Wer das nicht weiss, liest die Liste unten als
    // "alles, was ansteht", und genau so ist am 02.09.2026 eine Ueberlappung
    // durchgegangen.
    '<div class="anschluss">',
    '<b>Was hier steht.</b> Die Bloecke unten sind woertlich die Ausgabe des ' +
      'Trockenlaufs. Er nennt die Termine <b>dieses</b> Laufs. Die Termine, die aus ' +
      'frueheren Laeufen noch ausstehen, stehen nicht darin &mdash; sie stehen in der ' +
      'Planungsdatei unter <code>anschluss.ausstehende_termine</code> und in der Ausgabe ' +
      'des Planers, zusammen mit dem Abstand ueber die Naht.',
    // DT: Warum je Short nur zwei Zeilen des Textes unter dem Video dastehen.
    // Kein Feldname des Uploaders steht in diesem Absatz, und das ist keine
    // Umstaendlichkeit: auf diese Seite gehoert keines seiner Metadatenfelder
    // (tests/freigabe-server.test.cjs haelt das fest). Gesagt wird, was ein
    // Mensch sieht -- der Text unter dem Video -- und nicht, wie das Feld bei
    // YouTube heisst.
    '<p>Von dem Text unter dem Video steht je Short nur, was sich <b>unterscheidet</b>: die ' +
      'erste Zeile (der Titel) und die Hashtag-Zeile am Schluss. Der Teil dazwischen ist bei ' +
      'allen derselbe &mdash; er steht einmal, ganz unten, vollstaendig und im Wortlaut, ' +
      'hinter dem Knopf &bdquo;Den gemeinsamen Teil aufklappen&ldquo;. Er muss einmal ' +
      'aufgeklappt gewesen sein, sonst bleibt Schritt 3 gesperrt: er steht unter ' +
      '<em>jedem</em> dieser Videos, und er aendert sich, sobald jemand ' +
      '<code>config/beschreibung.txt</code> anfasst.</p>',
    '</div>',
    '<p class="kettezeile" id="vorschauKopf"></p>',
    '<div class="vorschauBloecke" id="vorschauBloecke"></div>',
    '<p class="gelesen nein" id="gelesen"></p>',
    '</div>',
    '<div class="schritt">',
    '<h3>Schritt 3 &mdash; hochladen</h3>',
    '<p class="kettezeile" id="kanalzeile"></p>',
    '<div class="knoepfe">',
    '<button id="schritt3" class="gross scharf" disabled>Schritt 3: Hochladen</button>',
    '</div>',
    '<p class="kettezeile" id="schritt3grund"></p>',
    '</div>',
    '<div class="schritt" id="lauf" hidden>',
    '<h3>Der Lauf</h3>',
    '<div id="laufKopf"></div>',
    '<pre id="laufZeilen"></pre>',
    '<div class="warnung" id="laufEnde" hidden></div>',
    '</div>',
    '</section>',
    '<script>',
    'const DATEN = ' + jsonFuerSkriptblock(nutzlast) + ';',
    // Auch die beiden Kopfzeilen gehen ueber textContent, nicht ueber Markup:
    // in kopf1 steht der Aufnahmename und in kopf2 ein Pfad, beides Werte, die
    // dieses Modul nicht selbst gebildet hat.
    'document.getElementById("kopf1").textContent = ' + jsonFuerSkriptblock(kopf1) + ';',
    'document.getElementById("kopf2").textContent = ' + jsonFuerSkriptblock(kopf2) + ';',
    SKRIPT,
    '<\/script></body></html>',
  ].join('\n');
}

// ===========================================================================
// EL: DIE LONGFORM-ANSICHT
// ===========================================================================
//
// Sie zeigt EINEN Text: die Ausgabe des Longform-Arbeiters im Trockenlauf,
// woertlich. Und sie sagt, wo sie aufhoert.
//
// WARUM SIE DEN TEXT NICHT ZERLEGT, obwohl die Shorts-Vorschau darueber das
// Gegenteil tut (baueVorschau schneidet an den Trennlinien, setzt
// Ueberschriften und klappt einen Teil weg):
//
// Der Uploader-Trockenlauf hat eine Form, die sich zerlegen laesst -- je Short
// ein Block, und die Bloecke sind fast gleich. Der Longform-Trockenlauf hat
// die nicht: er ist EIN Befund ueber EIN Video, und was darin steht, haengt an
// einer Zustandsmatrix mit 37 Zeilen (Vertrag 2.7). Wer ihn zerlegte, muesste
// erkennen, welcher Abschnitt was ist -- an seinem Wortlaut. Das waere eine
// zweite Stelle, an der die Regeln des Arbeiters ausgelegt werden, und die
// zweite waere ausgerechnet die, die ein Mensch vor Augen hat.
//
// Diese Ansicht kennt darum KEIN einziges Wort aus der Ausgabe des Arbeiters.
// Sie setzt seinen Text als ein Stueck ueber textContent in den Baum und tut
// sonst nichts damit: nicht kuerzen, nicht einklappen, nicht umsortieren,
// nicht faerben, nicht zusammenfuegen. tests/el-longform-ansicht.test.cjs
// rechnet beides nach -- dass keines seiner Woerter hier vorkommt, und dass
// jede seiner Zeilen in der ausgelieferten Seite steht.
//
// WAS DIESE ANSICHT SELBST SAGT, und nur das:
//   - welcher Befehl gelaufen ist und mit welchem Rueckgabewert,
//   - was dieser Rueckgabewert heisst (aus der EINEN Tabelle, ueber den Dienst
//     hereingereicht -- dieses Modul liest nichts),
//   - dass die beiden Stroeme getrennt stehen und warum,
//   - wo sie aufhoert, was als Naechstes kaeme und dass es das nicht gibt.
//
// KEINE ZUSTIMMUNGSFARBE, NIRGENDS. Die Shorts-Seite faerbt ein gefaelltes
// Urteil gruen; hier gibt es kein Urteil zu faellen, und ein gruener Kasten
// ueber einem Trockenlauf, der mit 0 endete, hiesse "in Ordnung". Er ist es
// nicht -- er ist zu Ende gelaufen. Ein Zustand, der gut aussieht, obwohl er
// es nicht ist, ist der Fehler, gegen den dieses ganze Projekt gebaut ist.

// Der Zusatzstil. Der Grundstil oben wird GETEILT und nicht nachgebaut: es ist
// dieselbe Oberflaeche desselben Dienstes, und zwei Fassungen von Schrift und
// Farbe laufen mit dem ersten Nachtrag auseinander.
//
// WARUM DER TEXT DES ARBEITERS UMBROCHEN WIRD (pre-wrap), obwohl er seine
// eigenen 78 Spalten setzt -- gemessen am echten Lauf vom 04.09.2026: von 98
// Zeilen sind 8 laenger als 78 Spalten, die laengste hat 207. Sie stammen aus
// dem geliehenen Modul hinter Vertrag 2.7, das nicht auf 78 umbricht. Ohne
// pre-wrap liefen sie rechts aus dem Bild und waeren nur ueber einen
// waagerechten Rollbalken zu finden -- und die laengste von allen ist die
// Zeile mit dem Abbruchgrund. Eine Ansicht, auf der ausgerechnet die halb im
// Verborgenen steht, waere genau der Zustand, gegen den dieser Bildschirm
// gebaut ist.
//
// BENANNTE GRENZE: eine umbrochene Zeile sieht damit aus wie zwei. Das ist der
// Preis, und er ist der kleinere -- eine Zeile, die man falsch zaehlt, ist
// besser als eine, die man nicht sieht. Dieselbe Wahl trifft die
// Shorts-Vorschau seit DT, aus demselben Grund.
//
// DIE KOMMENTARE HIER DRIN SIND KURZ, und das ist kein Geiz: alles zwischen
// den Anfuehrungsstrichen unten geht bei jedem Aufruf ueber die Leitung und
// steht im Browser eines Menschen. Die Begruendungen gehoeren hierher, vor die
// Konstante, und nicht hinein.
const LONGFORM_STIL = `
main.lf { max-width: none; }
.lf-ausgang { border: 1px solid #6b4a1f; background: #241d13; border-radius: 8px;
  padding: 14px 18px; max-width: 100ch; }
.lf-ausgang h2 { margin: 0 0 8px; font-size: 16px; color: #f0d3a6; }
.lf-ausgang p { margin: 6px 0 0; color: #cbd2de; font-size: 14px; }
.lf-ausgang p.fehler { color: #ff9a86; }
.lf-abschnitt { border-top: 1px solid #2e333c; padding-top: 16px; }
.lf-abschnitt h2 { margin: 0 0 6px; font-size: 16px; }
.lf-abschnitt h3 { margin: 16px 0 6px; font-size: 13px; color: #9aa3b2;
  text-transform: uppercase; letter-spacing: 0.04em; }
.lf-abschnitt > p { color: #9aa3b2; font-size: 13px; margin: 0 0 6px; max-width: 100ch; }
/* Kein eigener Rollbalken, keine Hoehengrenze, umbrochen statt abgeschnitten.
   Warum: siehe den Kommentar ueber dieser Konstante. */
pre.lf-strom { margin: 0; padding: 12px 14px;
  background: #101218; border: 1px solid #262b33; border-radius: 6px;
  white-space: pre-wrap; word-break: break-word;
  font: 12.5px/1.5 "Cascadia Mono", Consolas, monospace;
  color: #c8d0dd; }
.lf-ende { border-top: 2px solid #6b4a1f; margin-top: 8px; padding-top: 16px;
  max-width: 100ch; }
.lf-ende h2 { margin: 0 0 8px; font-size: 16px; color: #f0d3a6; }
.lf-ende p { color: #b8c0cd; font-size: 13.5px; margin: 8px 0 0; }
.lf-ende b { color: #e6e8ec; }
.lf-ende code { background: #12141a; border: 1px solid #262b33; border-radius: 4px;
  padding: 1px 5px; }

/* EN: DAS BILD UND SEINE ANGABEN.
   Das Bild steht LINKS und die Angaben RECHTS DANEBEN, nicht darunter: wer
   scrollen muss, um zu sehen, ob das Bild eine Regel oder ein Vorschlag ist,
   sieht es beim zweiten Mal nicht mehr. Auf schmalem Schirm bricht die Spalte
   um -- dann stehen die Angaben ZUERST und das Bild darunter, aus demselben
   Grund. */
.lf-bild { display: flex; flex-wrap: wrap-reverse; gap: 18px; align-items: flex-start; }
.lf-bild-rahmen { flex: 1 1 420px; min-width: 300px; }
.lf-bild-rahmen img { display: block; width: 100%; height: auto;
  border: 1px solid #262b33; border-radius: 6px; background: #101218; }
.lf-bild-angaben { flex: 1 1 340px; min-width: 280px; }
/* Die Kopfzeile der Angaben traegt die Farbe der ART und nicht des Geschmacks:
   eine Regel wird ohne Rueckfrage genommen, ein Vorschlag nie. Beide bekommen
   AUSSER der Farbe dasselbe Wort daneben -- Farbe allein ist keine Auskunft,
   und wer sie nicht unterscheiden kann, liest den Satz. */
.lf-art { display: inline-block; border-radius: 4px; padding: 3px 9px;
  font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
.lf-art.regel { background: #24301d; border: 1px solid #4d6b3a; color: #cfe8bb; }
.lf-art.vorschlag { background: #241d13; border: 1px solid #6b4a1f; color: #f0d3a6; }
.lf-bild-angaben dl { display: grid; grid-template-columns: max-content 1fr;
  gap: 4px 12px; margin: 12px 0 0; font-size: 13px; }
.lf-bild-angaben dt { color: #9aa3b2; }
.lf-bild-angaben dd { margin: 0; color: #e6e8ec; word-break: break-all;
  font-family: "Cascadia Mono", Consolas, monospace; font-size: 12.5px; }
/* Die Hinweise sind EIN Textblock und keine gebaute Liste. Grund: das Skript
   dieser Seite hat genau eine Stelle, an der Text in den Baum geht (setze),
   und die soll es behalten -- eine Schleife, die <li> baut, waere die zweite,
   und beim Mutationslauf zu EL ist genau an so einer zweiten Stelle eine
   Kuerzung durchgerutscht. Die Punkte trennt eine Leerzeile, der Strich links
   kommt aus dem Stil. */
.lf-hinweise { margin: 14px 0 0; color: #cbd2de; font-size: 13px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
  border-left: 2px solid #3a4150; padding: 2px 0 2px 12px; }
.lf-kein-bild { color: #ff9a86; font-size: 13.5px; margin: 6px 0 0; max-width: 100ch; }
`;

// Das Skript der Longform-Ansicht. Es setzt Werte in den Baum und tut sonst
// NICHTS: kein fetch, kein XMLHttpRequest, kein Ereignis, kein Zeitgeber,
// keine Tastenbelegung. Es gibt in diesem Modus keine Route, an die es sich
// wenden koennte, und es soll auch keine geben (freigabe-server.js,
// ROUTEN_POST).
const LONGFORM_SKRIPT = String.raw`
const D = DATEN;

const kel = (id) => document.getElementById(id);

// DIE EINE STELLE, AN DER TEXT IN DEN BAUM GEHT -- und zwar wirklich die eine:
// die Kopfzeilen, der Ausgang und die beiden Stroeme des Arbeiters gehen alle
// hier hindurch. Zwei Stellen waeren zwei Gelegenheiten, an genau einer davon
// zu kuerzen; beim Mutationslauf zu EL ist das aufgefallen, als eine
// eingebaute Kuerzung nur die Kopfzeilen traf und der Text des Arbeiters heil
// blieb -- der Test sah gruen aus und hatte den Weg gar nicht angesehen.
//
// textContent, nicht innerHTML: hier laufen Werte durch, die dieses Modul
// nicht gebildet hat -- ein Aufnahmename, ein Pfad, und der ganze Text eines
// fremden Programms. textContent maskiert selbst, und es gibt damit keine
// Einsetzstelle, die man vergessen koennte. Der Text wird UNVERAENDERT
// gesetzt: nichts wird geteilt, gesucht, ersetzt oder beschnitten.
function setze(element, text) {
  element.textContent = text;
  return element;
}

// EN: DIE EINE STELLE, AN DER EINE ADRESSE IN DEN BAUM GEHT. Sie steht neben
// setze() und nicht darin, weil ein src kein Text ist: textContent maskiert,
// ein Attribut nicht. Es gibt genau einen Aufruf, er zeigt auf die eine
// lesende Bildroute dieses Dienstes, und die Adresse wird hier gebildet und
// nicht anderswo -- damit es keine zweite Stelle gibt, an der jemand ein
// Sitzungstoken in eine Adresse haengt.
function setzeQuelle(element, adresse) {
  element.src = adresse;
  return element;
}

setze(kel('kopf1'), 'Aufnahme ' + D.aufnahme + ' — Betriebsmodus Longform, Trockenlauf');
setze(kel('kopf2'), 'Woertlich die Ausgabe von:  ' + D.befehl);

setze(kel('ausgangKopf'), 'Der Arbeiter endete mit ' + D.ausgang.code +
  (D.ausgang.name ? ' (' + D.ausgang.name + ')' : ''));
setze(kel('ausgangBedeutung'), D.ausgang.bedeutung || '');
setze(kel('ausgangZusatz'), D.ausgang.zusatz || '');
if (D.ausgang.fehler) setze(kel('ausgangFehler'), D.ausgang.fehler).hidden = false;

// EN: DAS BILD UND SEINE ANGABEN.
//
// ZUERST DIE ANGABEN, DANN DAS BILD -- in dieser Reihenfolge im Code, damit
// beim Lesen auffiele, wenn eine Fassung das Bild setzte und die Angaben
// vergaesse. Ein Bild ohne Rang und Art saehe im Zweifelsfall genauso aus wie
// eines aus Rang 1, und dann urteilt ein Mensch ueber etwas anderes, als er
// glaubt: DAS ist der Fehler, gegen den dieser Teil gebaut ist.
if (D.bild && D.bild.da) {
  kel('bildKasten').hidden = false;
  setze(kel('bildArt'), D.bild.art === 'regel' ? 'Regel' : 'Vorschlag');
  kel('bildArt').className = 'lf-art ' + (D.bild.art === 'regel' ? 'regel' : 'vorschlag');
  setze(kel('bildRang'), 'Rang ' + D.bild.rang);
  for (const [id, wert] of [
    ['bildName', D.bild.dateiname],
    ['bildSha', D.bild.sha256 === null ? '(keine)' : D.bild.sha256],
    ['bildShaHer', D.bild.sha256_herkunft],
    ['bildBytes', D.bild.bytes === null ? '(unbekannt)' : D.bild.bytes + ' Bytes'],
    ['bildZettel', D.bild.zettel === null ? '(keiner)' : D.bild.zettel],
  ]) setze(kel(id), String(wert));
  // Die Hinweise als EIN Stueck, durch Leerzeilen getrennt. Sie stammen Wort
  // fuer Wort aus der Befundzeile des Arbeiters; diese Seite setzt nur den
  // Strich davor.
  setze(kel('bildHinweise'), D.bild.hinweise.map((h) => '- ' + h).join('\n\n'));
  // Zuletzt die Adresse. Wer hier kuerzt, kuerzt das Bild weg und laesst die
  // Angaben stehen -- das faellt auf; umgekehrt fiele es nicht auf.
  setzeQuelle(kel('bild'), D.bildAdresse);
} else {
  kel('keinBild').hidden = false;
  setze(kel('keinBild'), 'Kein Bild. ' + ((D.bild && D.bild.grund) || '') +
    ' Diese Seite zeigt keines, das der Arbeiter nicht bestimmt hat.');
}

// Die beiden Stroeme, getrennt und jeder als EIN Stueck. Ein leerer Strom
// bekommt keinen leeren Kasten: ein Rahmen ohne Inhalt sieht aus wie ein
// Inhalt, den man nicht liest.
let etwasDa = false;
for (const [id, text] of [['stromAus', D.aus], ['stromErr', D.err]]) {
  if (text === '') continue;
  etwasDa = true;
  kel(id).hidden = false;
  setze(document.querySelector('#' + id + ' pre'), text);
}
if (!etwasDa) kel('keinStrom').hidden = false;
`;

// sitzung: { modus, aufnahme, token, trocken: {befehl, code, aus, err, fehler},
//            ausgang: {code, name, bedeutung, zusatz, fehler},
//            bild: {da, grund, dateiname, sha256, ...} }
//
// EN: DER TOKEN GEHT JETZT IN DIE NUTZLAST -- an genau einer Stelle und fuer
// genau einen Zweck. Bis EN stand hier "der Token geht NICHT in die Nutzlast,
// diese Seite macht keinen einzigen Aufruf"; seit sie das Thumbnail zeigt,
// stimmt der zweite Halbsatz nicht mehr, und der erste wandert mit, statt
// weiter behauptet zu werden.
//
// Er steht in der Adresse und nicht in einer Kopfzeile, weil ein <img> keine
// setzen kann -- derselbe Grund und derselbe Weg wie beim <video src> der
// Shorts-Seite (freigabe-server.js, Torwaechter Schritt 2). Die Seite baut die
// Adresse EINMAL, hier, und das Skript setzt sie EINMAL; es gibt keine zweite
// Stelle, die ein Token an eine Adresse haengt.
//
// Ein Aufruf ist das trotzdem keiner: das Bild wird angezeigt, nicht abgeholt
// und weiterverarbeitet. Die Seite traegt weiterhin kein fetch, kein Formular,
// keinen Knopf und kein Ereignis, und der Modus hat weiterhin keine POST-Route.
function baueLongformSeite(sitzung) {
  const t = sitzung.trocken;
  const bild = sitzung.bild || { da: false, grund: 'Diese Sitzung traegt kein Bild.' };
  const nutzlast = {
    aufnahme: sitzung.aufnahme,
    befehl: t.befehl,
    ausgang: sitzung.ausgang,
    aus: t.aus,
    err: t.err,
    // Nur die Angaben, die neben dem Bild stehen. Der PFAD gehoert nicht dazu
    // und steht ausdruecklich nicht in der Seite: der Browser braucht ihn
    // nicht, die Route nimmt ihn nicht entgegen, und ein Pfad, der im Baum
    // liegt, ohne dass ihn jemand benutzt, ist die Einladung, ihn eines Tages
    // zu benutzen.
    bild: bild.da ? {
      da: true,
      dateiname: bild.dateiname,
      sha256: bild.sha256,
      sha256_herkunft: bild.sha256_herkunft,
      bytes: bild.bytes,
      rang: bild.rang,
      art: bild.art,
      zettel: bild.zettel,
      hinweise: bild.hinweise,
    } : { da: false, grund: bild.grund },
    bildAdresse: bild.da ? '/bild?t=' + sitzung.token : null,
  };
  return [
    '<!doctype html>',
    '<html lang="de"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // ENGER ALS DIE SHORTS-SEITE: kein media-src (diese Seite bindet kein
    // Video ein) und kein connect-src (sie ruft nichts auf). Beide fallen auf
    // default-src 'none'. Die Sicherung ist dieselbe wie drueben; sie ist nur
    // um das gekuerzt, was hier nicht vorkommt -- eine Erlaubnis, die niemand
    // braucht, wird nicht "zur Sicherheit" mitgeschleppt.
    //
    // EN: img-src 'self' KOMMT DAZU, und nur das. 'self' ist dieser Dienst
    // unter dieser Adresse -- also die eine lesende Bildroute und sonst
    // nichts; kein data:, kein blob:, kein fremder Rechner. Ein Bild von
    // woanders soll auf dieser Seite nicht darstellbar sein, auch nicht
    // versehentlich. connect-src bleibt weg: dass die Seite ein Bild ANZEIGT,
    // heisst nicht, dass sie etwas AUFRUFEN darf.
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
      'img-src \'self\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; ' +
      'form-action \'none\'; base-uri \'none\'">',
    '<title>Longform-Trockenlauf</title>',
    '<style>' + STIL + LONGFORM_STIL + '</style></head><body>',
    '<header>',
    '<h1>Longform &mdash; der Trockenlauf</h1>',
    '<div class="kopfzeile" id="kopf1"></div>',
    '<div class="kopfzeile" id="kopf2"></div>',
    '<div class="kopfwerkzeug">',
    '<span class="kopfzeile">Diese Seite schickt nichts an den Dienst zurueck &mdash; sie ' +
      'hat weder Knopf noch Feld. Beenden: <kbd>Strg</kbd>+<kbd>C</kbd> in dem Terminal, ' +
      'in dem der Dienst laeuft. Er gibt dabei seine Sperre frei.</span>',
    '</div></header>',
    '<main class="lf">',

    // 1. DER AUSGANG, GANZ OBEN. Der Text darunter ist rund hundert Zeilen
    //    lang; ein Satz dahinter ist ein Satz, den man ueberliest. Denselben
    //    Grund nennt der Uploader fuer seinen Befund ("Am Ende, hinter neun
    //    vollstaendigen Beschreibungen, waere er genau das, was er nicht sein
    //    darf"), und er hat dort recht behalten.
    '<section class="lf-ausgang">',
    '<h2 id="ausgangKopf"></h2>',
    '<p id="ausgangBedeutung"></p>',
    '<p id="ausgangZusatz"></p>',
    '<p class="fehler" id="ausgangFehler" hidden></p>',
    '</section>',

    // 2. EN: DAS THUMBNAIL. Vor dem Text des Arbeiters und nicht dahinter --
    //    Vertrag 4, Schritt 7 verlangt, dass der Mensch das Bild sieht, BEVOR
    //    er urteilt, und hinter hundert Zeilen Text saehe er es beim zweiten
    //    Mal nicht mehr. Es steht hinter dem Ausgang, weil ein Bild neben
    //    einem Lauf, der abgebrochen ist, ohne diesen Ausgang falsch gelesen
    //    wuerde.
    '<section class="lf-abschnitt">',
    '<h2>Das Thumbnail</h2>',
    '<p>Das ist die Datei, die dieser Lauf bestimmt hat &mdash; <b>die Bytes von der ' +
      'Platte</b>, nicht eine Vorschau davon und keine Kopie. Welche es ist, hat der ' +
      'Arbeiter ausdruecklich benannt; diese Seite hat sie nicht aus seinem Text ' +
      'herausgesucht und keinen Ordner danach abgesucht.</p>',
    '<p><b>Nicht dabei:</b> das Standbild des Videos, das Vertrag 4 Schritt 7 daneben ' +
      'verlangt. Es ist nicht gebaut &mdash; es braeuchte ffmpeg und eine zweite Datei auf ' +
      'der Platte, und dieser Dienst schreibt genau eine.</p>',
    '<div class="lf-bild" id="bildKasten" hidden>',
    '<div class="lf-bild-rahmen">',
    // alt bleibt leer und ist es absichtlich: was auf dem Bild zu sehen ist,
    // weiss diese Seite nicht, und ein erfundener Ersatztext waere eine
    // Behauptung darueber. Was ueber das Bild bekannt ist, steht daneben als
    // Text -- lesbar auch dann, wenn das Bild nicht ankommt.
    '<img id="bild" alt="">',
    '</div>',
    '<div class="lf-bild-angaben">',
    '<span class="lf-art" id="bildArt"></span> <span id="bildRang"></span>',
    '<dl>',
    '<dt>Datei</dt><dd id="bildName"></dd>',
    '<dt>sha256</dt><dd id="bildSha"></dd>',
    '<dt>woher</dt><dd id="bildShaHer"></dd>',
    '<dt>Groesse</dt><dd id="bildBytes"></dd>',
    '<dt>Zettel</dt><dd id="bildZettel"></dd>',
    '</dl>',
    '<div class="lf-hinweise" id="bildHinweise"></div>',
    '</div>',
    '</div>',
    '<p class="lf-kein-bild" id="keinBild" hidden></p>',
    '</section>',

    // 3. DER TEXT DES ARBEITERS, ungekuerzt.
    '<section class="lf-abschnitt">',
    '<h2>Was der Trockenlauf ausgegeben hat</h2>',
    '<p>Der Text unten ist <b>woertlich</b> seine Ausgabe. Diese Seite formuliert nichts ' +
      'davon um, kuerzt nichts, klappt nichts weg und hebt nichts hervor &mdash; auch dann ' +
      'nicht, wenn eine Zeile wichtiger aussieht als die anderen. Was der Arbeiter nicht ' +
      'sagt, sagt diese Seite auch nicht; was er sagt, steht hier vollstaendig.</p>',
    '<p>Er schreibt auf <b>zwei</b> Kanaele: die Vorschau auf stdout, wenn der Lauf ' +
      'durchkommt, und auf stderr, wenn er mit einem Befund endet. Beide stehen hier ' +
      'getrennt und in voller Laenge. Zusammengefuegt werden sie nicht &mdash; zwischen ' +
      'zwei Stroemen gibt es keine Reihenfolge, und eine erfundene waere eine Behauptung ' +
      'darueber, was zuerst geschah.</p>',
    '<div id="stromAus" hidden><h3>stdout</h3><pre class="lf-strom"></pre></div>',
    '<div id="stromErr" hidden><h3>stderr</h3><pre class="lf-strom"></pre></div>',
    '<p id="keinStrom" hidden>Der Arbeiter hat auf beiden Kanaelen nichts geschrieben. Das ' +
      'ist kein guter Zustand, sondern ein unerklaerter: ein Lauf, der endet, ohne etwas ' +
      'zu sagen, ist im Terminal nachzusehen.</p>',
    '</section>',

    // 4. WO DIESE SEITE AUFHOERT. Sie steht als eigener Abschnitt und nicht als
    //    Fussnote: dass hier nichts weitergeht, ist die wichtigste Auskunft
    //    dieser Seite nach dem Ausgang oben.
    '<section class="lf-ende">',
    '<h2>Hier hoert diese Seite auf</h2>',
    '<p><b>Was als Naechstes kaeme</b> (Vertrag 4, Schritte 8 bis 17): ein Knopf ' +
      '&bdquo;Hochladen&ldquo; mit dem Dateinamen des Bildes darauf. Beim Klick schriebe ' +
      'die Seite eine <b>Einmal-Ermaechtigung</b> und startete den Arbeiter mit ' +
      '<code>--execute</code>. Der lieferte das Video privat ab, wartete bis zu 45 Minuten ' +
      'auf die Verarbeitung, heftete das Thumbnail an und meldete sich zurueck. Danach ' +
      'zeigte die Seite die <b>zweite</b> Frage, mit Titel und Kennung des Videos darauf, ' +
      'und erst ein zweites Ja stellte es oeffentlich.</p>',
    '<p><b>Nichts davon ist gebaut.</b> Nicht der Knopf, nicht die Ermaechtigung, nicht ' +
      'die schreibende Haelfte des Arbeiters. Es gibt in diesem Betriebsmodus keine Route, ' +
      'die etwas entgegennimmt, und diese Seite traegt kein Element, das eine ansprechen ' +
      'koennte &mdash; kein Formular, keinen Knopf, kein Eingabefeld, keinen einzigen ' +
      'Aufruf zurueck an den Dienst.</p>',
    '<p><b>Warum hier kein Knopf steht, der schon einmal die Ermaechtigung schriebe.</b> ' +
      'Eine Einmal-Ermaechtigung ohne Empfaenger liegt herum, bis jemand sie einloest. Sie ' +
      'kommt mit dem Arbeiter, der sie einloest, und keinen Schritt frueher.</p>',
    '<p>Was dieser Dienst in dieser Sitzung geschrieben hat: <b>eine</b> Datei, seine ' +
      'eigene Sperre unter <code>data/freigaben/</code>. Sie wird beim Beenden wieder ' +
      'geloescht. Sonst nichts &mdash; kein Plan, keine Freigabedatei, kein Gedaechtnis, ' +
      'keine Ermaechtigung.</p>',
    '</section>',
    '</main>',
    '<script>',
    'const DATEN = ' + jsonFuerSkriptblock(nutzlast) + ';',
    LONGFORM_SKRIPT,
    '<\/script></body></html>',
  ].join('\n');
}

module.exports = {
  baueSeite, baueLongformSeite, jsonFuerSkriptblock, SKRIPTBLOCK_MASKEN,
};
