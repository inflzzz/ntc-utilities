'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EVENTS } = require('../src/rng-events.cjs');
const { TITLES, TIERS, POOL, CATALOG_VERSION, BOOTSTRAP_EXPECTED_COUNT } = require('../src/rng.cjs');

const ids = new Set();
const tierIds = new Set(TIERS.map(tier => tier.id));
const eventIds = new Set(EVENTS.map(event => event.id));
const normalTitles = TITLES.filter(title => title.active && title.acquisition === 'normal');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'rng-icons.js'), 'utf8'), context, { filename: 'src/rng-icons.js' });
const icons = context.window.NTCRngIcons;

for (const title of TITLES) {
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(title.id) || ids.has(title.id)) throw new Error(`ID ausente, inválido ou duplicado: ${title.id}`);
  ids.add(title.id);
  if (!title.name.trim()) throw new Error(`Nome vazio: ${title.id}`);
  if (!tierIds.has(title.tier)) throw new Error(`Tier inexistente: ${title.id} → ${title.tier}`);
  if (!['normal', 'event', 'limited', 'exclusive', 'unobtainable'].includes(title.acquisition)) throw new Error(`Aquisição inválida: ${title.id}`);
  if (title.acquisition === 'normal' && !title.active) throw new Error(`Título normal inativo: ${title.id}`);
  if (['event', 'limited'].includes(title.acquisition) && (!title.eventId || !eventIds.has(title.eventId))) throw new Error(`Evento ausente ou inválido: ${title.id}`);
  if (title.acquisition === 'unobtainable' && title.eventId) throw new Error(`Título unobtainable ainda associado a evento: ${title.id}`);
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(title.assetId || '')) throw new Error(`assetId ausente ou inválido: ${title.id}`);
  const asset = icons.definition(title.assetId);
  if (!asset) throw new Error(`Asset não registrado: ${title.id} → ${title.assetId}`);
  if (asset.kind === 'raster' && !fs.existsSync(path.resolve(__dirname, '..', 'src', asset.src.replace(/^\.\//, '')))) throw new Error(`Arquivo de asset ausente: ${title.id} → ${asset.src}`);
  if (title.presentationId && !/^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(title.presentationId)) throw new Error(`presentationId inválido: ${title.id}`);
  if (title.baseWeight <= 0n) throw new Error(`Odds/peso-base inválido: ${title.id}`);
  if (title.denominator !== null && title.denominator <= 0n) throw new Error(`Denominador-base inválido: ${title.id}`);
}

if (!normalTitles.length || normalTitles.reduce((sum, title) => sum + title.baseWeight, 0n) !== POOL) throw new Error('Os títulos normais não formam um pool válido.');
if (CATALOG_VERSION === 1 && normalTitles.length !== BOOTSTRAP_EXPECTED_COUNT) throw new Error('O bootstrap v1 diverge da quantidade original de títulos normais.');
process.stdout.write(`Catálogo RNG válido · v${CATALOG_VERSION} · ${TITLES.length} títulos · ${normalTitles.length} no pool normal · ${ids.size} IDs únicos · assets/eventos conferidos.\n`);
