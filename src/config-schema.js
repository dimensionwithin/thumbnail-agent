'use strict';

// Der Vertrag zwischen Agent-Schicht und Render-Engine (window.adwRender).
// Spiegelt applyConfig() in thumbnail-compositor.html. Single source of truth.
// Der Render-Kern wird NICHT geaendert — hier nur validieren/normalisieren.

const PRESETS = ['standard', 'innercircle', 'livestream', 'nonchart', 'aiv', 'memberlive'];
const COLORS = ['brass', 'sage', 'oxblood'];
const CHART_FORMS = ['collapse', 'expansion', 'fractal'];
const POSITIONS = ['auto', 'top', 'bottom', 'left', 'right'];
const STANCES = ['bullish', 'bearish', 'neutral'];
// CN3: Die 14 Emblem-Varianten -- Dateiname ohne Endung in
// assets/branding/emblems/, gespiegelt aus EMBLEM_META im Compositor.
const EMBLEM_VARIANTS = [
  'christkind', 'cowboyhut', 'ernst', 'feiern', 'lachen', 'neutral', 'schock',
  'sensenmann', 'skeptisch', 'triumphierend', 'ueberrascht', 'verliebt',
  'verwirrt', 'weihnachtsmann',
];
const EMBLEM_SHOW = ['auto', 'on', 'off'];
const EMBLEM_SIDES = ['auto', 'left', 'right'];

// Stance -> Farbe + Chart-Form (im Compositor verankert):
// bearish -> Collapse/Oxblood, bullish -> Expansion/Sage, neutral -> Fractal/Brass.
const STANCE_MAP = {
  bullish: { color: 'sage', chartForm: 'expansion' },
  bearish: { color: 'oxblood', chartForm: 'collapse' },
  neutral: { color: 'brass', chartForm: 'fractal' },
};

// Default im Zweifel: Gold / Standard.
const DEFAULTS = {
  preset: 'standard',
  color: 'brass',
  chartForm: 'fractal',
  position: 'auto',
  titleScale: 'auto',
  approved: false,
};

function stanceToConfig(stance) {
  return STANCE_MAP[stance] || STANCE_MAP.neutral;
}

// Liefert { config, warnings }. Unbekannte Enum-Werte fallen auf Default mit Warnung zurueck.
function normalizeConfig(raw) {
  const warnings = [];
  const cfg = {};

  if (!raw || typeof raw !== 'object') {
    throw new Error('config muss ein Objekt sein');
  }
  if (!raw.videoId || typeof raw.videoId !== 'string') {
    throw new Error('config.videoId (string) ist erforderlich');
  }
  cfg.videoId = raw.videoId;

  const pickEnum = (key, allowed, fallback) => {
    const v = raw[key];
    if (v == null) return fallback;
    if (allowed.includes(v)) return v;
    warnings.push(`${key}="${v}" ungueltig -> Default "${fallback}"`);
    return fallback;
  };

  cfg.preset = pickEnum('preset', PRESETS, DEFAULTS.preset);
  cfg.color = pickEnum('color', COLORS, DEFAULTS.color);
  cfg.chartForm = pickEnum('chartForm', CHART_FORMS, DEFAULTS.chartForm);
  cfg.position = pickEnum('position', POSITIONS, DEFAULTS.position);

  if (typeof raw.headline === 'string') cfg.headline = raw.headline;
  if (raw.episode != null) cfg.episode = String(raw.episode);
  if (raw.date != null) cfg.date = String(raw.date);
  if (raw.label != null) cfg.label = String(raw.label);
  if (raw.chartSeed != null && Number.isFinite(+raw.chartSeed)) cfg.chartSeed = +raw.chartSeed;

  // titleScale: 'auto' oder Zahl (Prozent)
  if (raw.titleScale == null || raw.titleScale === 'auto') {
    cfg.titleScale = 'auto';
  } else if (Number.isFinite(+raw.titleScale)) {
    cfg.titleScale = +raw.titleScale;
  } else {
    warnings.push(`titleScale="${raw.titleScale}" ungueltig -> "auto"`);
    cfg.titleScale = 'auto';
  }

  // CN3: Ohne diese Felder filterte toEngineConfig jede Emblem-Wahl weg -- die
  // Harness las cfg.emblemVariant, das da nie ankam, und zeichnete still den
  // eingebetteten Rueckfall. Die Warnung "Variante nicht gefunden" konnte
  // deshalb nie ausloesen.
  cfg.emblemShow = pickEnum('emblemShow', EMBLEM_SHOW, 'auto');
  cfg.emblemSide = pickEnum('emblemSide', EMBLEM_SIDES, 'auto');
  if (raw.emblemVariant != null) {
    if (EMBLEM_VARIANTS.includes(raw.emblemVariant)) {
      cfg.emblemVariant = raw.emblemVariant;
    } else {
      warnings.push(`emblemVariant="${raw.emblemVariant}" unbekannt -> Rueckfall wird gezeichnet`);
    }
  }
  for (const key of ['emblemSize', 'emblemMargin', 'emblemY']) {
    if (raw[key] == null) continue;
    if (Number.isFinite(+raw[key])) cfg[key] = +raw[key];
    else warnings.push(`${key}="${raw[key]}" ist keine Zahl -> Vorgabe der Engine gilt`);
  }

  cfg.approved = raw.approved === true;

  // headline-Hinweis: genau ein *Akzentwort* erwartet (nur Warnung, nicht blockierend).
  if (typeof cfg.headline === 'string') {
    const accents = (cfg.headline.match(/\*[^*]+\*/g) || []).length;
    if (accents !== 1) warnings.push(`headline hat ${accents} Akzent-Markierungen (erwartet: 1)`);
  }

  return { config: cfg, warnings };
}

// Nur die Felder, die die Engine konsumiert — ohne Agent-Metadaten (Konfidenz etc.).
const ENGINE_KEYS = [
  'videoId', 'preset', 'color', 'chartForm', 'chartSeed', 'headline', 'episode',
  'date', 'label', 'position', 'titleScale',
  // CN3: Emblem-Felder gehoeren zum Vertrag -- applyConfig() im Compositor liest
  // sie. 'emblemDataUri' steht bewusst NICHT hier: das ist kein Config-Feld,
  // sondern setzt die Harness selbst, nachdem sie die PNG-Datei gelesen hat.
  'emblemVariant', 'emblemShow', 'emblemSide', 'emblemSize', 'emblemMargin', 'emblemY',
];

function toEngineConfig(cfg) {
  const out = {};
  for (const k of ENGINE_KEYS) if (cfg[k] != null) out[k] = cfg[k];
  return out;
}

module.exports = {
  PRESETS, COLORS, CHART_FORMS, POSITIONS, STANCES,
  EMBLEM_VARIANTS, EMBLEM_SHOW, EMBLEM_SIDES,
  STANCE_MAP, DEFAULTS, ENGINE_KEYS,
  stanceToConfig, normalizeConfig, toEngineConfig,
};
