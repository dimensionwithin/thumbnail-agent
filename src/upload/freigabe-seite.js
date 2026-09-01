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
// POST /beenden, oder einer ausbleibenden auf POST /urteil. Die Seite holt
// keinen neuen Stand, hat kein setInterval und bekommt keines -- sie erfaehrt
// nur, was auf ihre eigenen Anfragen zurueckkommt.
let sitzungVorbei = false;

function sperreAlleKarten() {
  const felder = document.querySelectorAll('#karten input, #karten textarea, #karten button');
  for (let i = 0; i < felder.length; i++) felder[i].disabled = true;
  document.getElementById('karten').classList.add('vorbei');
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

module.exports = { baueSeite, jsonFuerSkriptblock, SKRIPTBLOCK_MASKEN };
