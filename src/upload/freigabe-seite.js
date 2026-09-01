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
  padding: 10px 14px; border-radius: 6px; margin: 14px 20px 0; }
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

async function sende(karte, freigegeben, felder) {
  const antwort = { ok: false, meldung: '' };
  let res;
  try {
    res = await fetch('/urteil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Freigabe-Token': TOKEN },
      body: JSON.stringify({
        index: karte.index,
        freigegeben: freigegeben,
        titel: felder.titel.value,
        notiz: felder.notiz.value,
      }),
    });
  } catch (e) {
    antwort.meldung = 'Der Dienst antwortet nicht (' + e + '). Es wurde NICHTS gespeichert.';
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
    ja.disabled = true; nein.disabled = true;
    fehler.textContent = '';
    const a = await sende(karte, freigegeben, felder);
    ja.disabled = false; nein.disabled = false;
    if (!a.ok) { fehler.textContent = a.meldung; return; }
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

document.getElementById('beenden').addEventListener('click', async () => {
  const knopf = document.getElementById('beenden');
  knopf.disabled = true;
  try {
    await fetch('/beenden', { method: 'POST', headers: { 'X-Freigabe-Token': TOKEN } });
    document.getElementById('beendet').hidden = false;
  } catch (e) {
    knopf.disabled = false;
  }
});
`;

// sitzung: { aufnahme, freigabePfad, token, eingabeSha256, karten, stand }
function baueSeite(sitzung) {
  const nutzlast = {
    token: sitzung.token,
    karten: sitzung.karten,
    stand: sitzung.stand,
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
    '<button id="beenden">Dienst beenden</button>',
    '</div></header>',
    '<p class="warnung" id="beendet" hidden>Der Dienst ist beendet. Alle Urteile stehen ' +
      'auf der Platte &mdash; geschrieben wurde nach jedem einzelnen Klick. Diese Seite ' +
      'ist ab jetzt tot.</p>',
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
