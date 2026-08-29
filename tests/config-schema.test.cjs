'use strict';

// CN3: Die Emblem-Felder fielen zwischen Config und Engine heraus.
// render-harness.cjs las cfg.emblemVariant, aber toEngineConfig hatte das Feld
// eine Zeile vorher schon weggefiltert -- ENGINE_KEYS kannte kein einziges
// Emblem-Feld. Die Harness zeichnete deshalb IMMER den eingebetteten Rueckfall,
// und ihre Warnung "Variante nicht gefunden" konnte nie ausloesen.
// Diese Tests halten den Vertrag fest.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  ENGINE_KEYS, EMBLEM_VARIANTS, normalizeConfig, toEngineConfig,
} = require('../src/config-schema');

const EMBLEM_FIELDS = [
  'emblemVariant', 'emblemShow', 'emblemSide', 'emblemSize', 'emblemMargin', 'emblemY',
];

test('ENGINE_KEYS fuehrt alle Emblem-Felder', () => {
  for (const field of EMBLEM_FIELDS) {
    assert.ok(ENGINE_KEYS.includes(field), `${field} fehlt in ENGINE_KEYS`);
  }
});

test('emblemDataUri gehoert NICHT zum Vertrag', () => {
  // Das setzt die Harness selbst, nachdem sie die PNG-Datei gelesen hat.
  // Stuende es hier, koennte eine Config beliebige Daten in den Render tragen.
  assert.ok(!ENGINE_KEYS.includes('emblemDataUri'));
});

test('toEngineConfig reicht eine gewaehlte Variante durch', () => {
  const out = toEngineConfig({
    videoId: 'v1', emblemVariant: 'christkind', emblemShow: 'on',
    emblemSide: 'left', emblemSize: 480, emblemMargin: 16, emblemY: 720,
  });
  assert.equal(out.emblemVariant, 'christkind');
  assert.equal(out.emblemShow, 'on');
  assert.equal(out.emblemSide, 'left');
  assert.equal(out.emblemSize, 480);
  assert.equal(out.emblemMargin, 16);
  assert.equal(out.emblemY, 720);
});

test('normalizeConfig behaelt eine bekannte Variante', () => {
  const { config, warnings } = normalizeConfig({ videoId: 'v1', emblemVariant: 'sensenmann' });
  assert.equal(config.emblemVariant, 'sensenmann');
  assert.ok(!warnings.some((w) => w.includes('emblemVariant')));
});

test('normalizeConfig warnt bei unbekannter Variante statt sie durchzureichen', () => {
  const { config, warnings } = normalizeConfig({ videoId: 'v1', emblemVariant: 'gibtesnicht' });
  assert.equal(config.emblemVariant, undefined);
  assert.ok(warnings.some((w) => w.includes('emblemVariant="gibtesnicht"')));
});

test('normalizeConfig faengt ungueltige Enum- und Zahlwerte ab', () => {
  const { config, warnings } = normalizeConfig({
    videoId: 'v1', emblemSide: 'schraeg', emblemShow: 'vielleicht', emblemMargin: 'breit',
  });
  assert.equal(config.emblemSide, 'auto');
  assert.equal(config.emblemShow, 'auto');
  assert.equal(config.emblemMargin, undefined);
  assert.equal(warnings.length, 3);
});

test('EMBLEM_VARIANTS deckt sich mit den Dateien auf der Platte', () => {
  const dir = path.join(__dirname, '..', 'assets', 'branding', 'emblems');
  const onDisk = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => path.basename(f, '.png'))
    .sort();
  assert.deepEqual([...EMBLEM_VARIANTS].sort(), onDisk);
});

test('EMBLEM_VARIANTS deckt sich mit EMBLEM_META im Compositor', () => {
  // Der Compositor verwirft in applyConfig() jede Variante, die EMBLEM_META
  // nicht kennt. Laufen die Listen auseinander, waere eine schema-gueltige
  // Variante im Render still wirkungslos -- wieder ein stummer Rueckfall.
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'thumbnail-compositor.html'), 'utf8');
  const block = html.slice(html.indexOf('const EMBLEM_META = {'));
  const slugs = [...block.slice(0, block.indexOf('};')).matchAll(/'([a-z]+)':\s*\{/g)]
    .map((m) => m[1]).sort();
  assert.deepEqual([...EMBLEM_VARIANTS].sort(), slugs);
});
