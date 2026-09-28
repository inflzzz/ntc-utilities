const crypto = require('node:crypto');
const { LIMITED_REWARDS } = require('./rng-events.cjs');

const THOUSAND_ROLL_BONUS_EVERY = 1000;
const THOUSAND_ROLL_BONUS_MULTIPLIER = 4;
const TEN_THOUSAND_ROLL_BONUS_EVERY = 10_000;
const TEN_THOUSAND_ROLL_BONUS_MULTIPLIER = 10;
const RNG_FRAGMENT_REWARDS = Object.freeze({ basic: 1, epic: 2, unique: 5, legendary: 10, mythic: 25, exalted: 50, glorious: 100, transcendent: 500, dimensional: 2_500, ntc: 10_000 });
const LIMITED_TITLE_FRAGMENT_REWARD = 1_000n;
const RNG_UPGRADE_INITIAL_COST = 50_000n;
const RNG_UPGRADE_COST_MULTIPLIER = 2n;
const RNG_UPGRADE_LUCK_BPS = 500;
const RNG_CONSUMABLE_COST = 5_000n;
const RNG_ROLL_BOOST_SIZE = 600;
const RNG_TIME_BOOST_SECONDS = 600;
const RNG_CONSUMABLE_TYPES = new Set(['rolls', 'time']);
const RNG_RELIC_COST = 50_000n;
const RNG_DUPLICATE_RELIC_REWARD = 25_000n;
const RNG_RELIC_SHOP_PRICES = Object.freeze({ 'echo-spring': 100_000n });
const RNG_EQUIPMENT_SLOTS = 6;
const RNG_RELIC_REMOVAL_VERSION = 3;
const RNG_SAVE_SCHEMA_VERSION = 1;
const RNG_LUCK_METRIC_VERSION = 1;
const RNG_NTC_ODDS_CEILING_DENOMINATOR = 10_000_000n;
const RNG_ALIGNMENT_HALF_LIFE_BPS = 25_000n;
const REMOVED_MISFORTUNE_RELIC_IDS = new Set(['misfortune-mark', 'cracked-die', 'drought-heart']);
const RNG_MANUAL_TIME_ACHIEVEMENT_SECONDS = 100 * 60 * 60;
const RNG_AUTO_TIME_ACHIEVEMENT_SECONDS = 1_000 * 60 * 60;
const RNG_RARE_RELIC_DROP_DENOMINATOR = 1_000n;
const RANDOM_RELIC_MIN_ROLLS = 8_000;
const RANDOM_RELIC_MAX_ROLLS = 12_000;

const RELICS = Object.freeze([
  { id: 'solar-clock', setId: 'celestial', name: 'Relógio da Vigília', icon: '☀', effect: 'Sorte ×1,12 entre 06h e 18h.', source: 'shop', luckMultiplierBps: 11_200 },
  { id: 'lunar-clock', setId: 'celestial', name: 'Relógio das Horas Mortas', icon: '☾', effect: 'Sorte ×1,12 entre 18h e 06h.', source: 'shop', luckMultiplierBps: 11_200 },
  { id: 'astrolabe', setId: 'celestial', name: 'Astrolábio de Ferro', icon: '✧', effect: 'Sorte ×1,10 o tempo todo.', source: 'shop', luckMultiplierBps: 11_000 },
  { id: 'twin-core', setId: 'echoes', name: 'Coração em Par', icon: '◈', effect: 'Dobra os resultados de cada ação.', source: 'random-drop', rare: true, resultMultiplier: 2 },
  { id: 'echo-spring', setId: 'echoes', name: 'Mola de Eco', icon: '↟', effect: 'Concede +1 resultado a cada 100 resultados.', source: 'shop', resultBonusEvery: 100, resultBonus: 1 },
  { id: 'fragment-pouch', setId: 'echoes', name: 'Bolsa de Fragmentos', icon: '◆', effect: 'Fragmentos recebidos ×1,25.', source: 'shop', fragmentMultiplierBps: 12_500 },
  { id: 'lucky-feather', name: 'Pena do Acaso', icon: '❧', effect: 'Sorte ×1,05 o tempo todo.', source: 'random-drop', luckMultiplierBps: 10_500 },
  { id: 'loose-gear', name: 'Engrenagem Solta', icon: '⚙', effect: '+1 resultado a cada 500 rolagens.', source: 'random-drop', resultBonusEvery: 500, resultBonus: 1 },
  { id: 'torn-pouch', name: 'Bolsa Remendada', icon: '▱', effect: 'Fragmentos recebidos ×1,10.', source: 'random-drop', fragmentMultiplierBps: 11_000 },
  { id: 'rain-comet', name: 'Estilhaço da Queda', icon: '☄', effect: 'Fragmentos recebidos ×1,20.', source: 'event', eventId: 'fragments', fragmentMultiplierBps: 12_000 },
  { id: 'new-moon-seal', name: 'Selo das Horas Mortas', icon: '◐', effect: 'Sorte ×1,10 o tempo todo.', source: 'event', eventId: 'fragments', luckMultiplierBps: 11_000 },
  { id: 'eclipse-prism', name: 'Prisma de Ônix', icon: '◉', effect: 'Sorte ×1,25 o tempo todo.', source: 'event', eventId: 'eclipse', luckMultiplierBps: 12_500 },
  { id: 'cartographers-medal', name: 'Medalha do Cartógrafo', icon: '⌖', effect: '+1 resultado em cada ação.', source: 'achievement', achievementId: 'unique-50', achievementGoal: 50, flatResults: 1 },
  { id: 'atlas-of-possibilities', name: 'Atlas das Rotas Perdidas', icon: '▤', effect: 'Sorte ×1,50 o tempo todo.', source: 'achievement', achievementId: 'unique-200', achievementGoal: 200, luckMultiplierBps: 15_000 }
]);
const RELIC_SETS = Object.freeze([
  { id: 'celestial', name: 'Relógios da Penitência', effect: 'Relógio da Vigília e Relógio das Horas Mortas permanecem ativos durante todo o dia.' },
  { id: 'echoes', name: 'Ecos', effect: 'Dobra novamente os resultados de cada ação.' }
]);
const relicById = new Map(RELICS.map(relic => [relic.id, relic]));
const PURCHASABLE_RELIC_IDS = RELICS.filter(relic => relic.source === 'shop').map(relic => relic.id);
const RANDOM_RELIC_IDS = RELICS.filter(relic => relic.source === 'random-drop').map(relic => relic.id);
const COMMON_RANDOM_RELIC_IDS = RANDOM_RELIC_IDS.filter(id => !relicById.get(id).rare);
const EVENT_RELIC_IDS_BY_EVENT = new Map(['fragments', 'eclipse'].map(eventId => [eventId, RELICS.filter(relic => relic.source === 'event' && relic.eventId === eventId).map(relic => relic.id)]));
const ACHIEVEMENT_RELICS = RELICS.filter(relic => relic.source === 'achievement');
const relicShopPrice = relicId => RNG_RELIC_SHOP_PRICES[relicId] ?? RNG_RELIC_COST;

const CATALOG_DATA = require('../content/rng-title-catalog.json');
const TIERS = CATALOG_DATA.tiers.map(({ id, label, rank }) => ({ id, label, rank }));

const POOL = 10n ** 80n;
const CATEGORY_MILESTONES = [
  { count: 5, bonusBps: 250 },
  { count: 10, bonusBps: 500 },
  { count: 20, bonusBps: 1_000 }
];
const ROLL_MILESTONES = [
  { count: 50, rollsPerCycle: 2 },
  { count: 100, rollsPerCycle: 3 }
];
const BONUS_MILESTONES = [
  { count: 0, multiplier: 2 },
  { count: 50, multiplier: 3 },
  { count: 100, multiplier: 5 },
  { count: 175, multiplier: 10 }
];
const ACHIEVEMENT_LUCK_REWARDS = Object.freeze({
  ...Object.fromEntries(Object.entries({ epic: 100, unique: 200, legendary: 500, mythic: 1_000, exalted: 2_000, glorious: 4_000, transcendent: 7_500, dimensional: 15_000, ntc: 50_000 }).map(([tierId, bonusBps]) => [`tier-${tierId}`, bonusBps])),
  'rolls-100000': 100,
  'rolls-1000000': 100,
  'rolls-5000000': 150,
  'rolls-10000000': 200,
  'manual-rolls-1000000': 150,
  'unique-200': 100,
  'streak-repeat-7': 50,
  'drought-10000': 0,
  'multiplier-100': 50,
  'events-10': 50,
  'limited-title': 50,
  'time-manual-100h': 500,
  'time-auto-1000h': 2_500
});
const CATEGORY_TIER_IDS = new Set(TIERS.map(tier => tier.id));
const wholeOddsFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const brazilClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const SECRETS = [
  { id: 'secret-77777', name: 'O Observador', hint: 'A rolagem exata.' },
  { id: 'secret-seven', name: 'Eco de Sete', hint: 'Sete vezes o mesmo destino.', luckBonusBps: 100 },
  { id: 'secret-pair', name: 'Dupla Singular', hint: 'Dois raros seguidos.' },
  { id: 'secret-million', name: 'Sorte Nua', hint: 'Um milhão sem bônus.' },
  { id: 'secret-hundred', name: 'Ironia Suprema', hint: 'O comum sob sorte extrema.' },
  { id: 'secret-autohour', name: 'Vigília Automática', hint: 'Uma hora sem pausa.' }
];

const { version: CATALOG_VERSION, bootstrapExpectedCount: BOOTSTRAP_EXPECTED_COUNT, titles } = CATALOG_DATA;
if (!Number.isSafeInteger(CATALOG_VERSION) || CATALOG_VERSION < 1 || !Number.isSafeInteger(BOOTSTRAP_EXPECTED_COUNT) || BOOTSTRAP_EXPECTED_COUNT < 1) throw new Error('Versão ou metadado de bootstrap do catálogo inválido.');
if (CATALOG_VERSION === 1 && titles.length !== BOOTSTRAP_EXPECTED_COUNT) throw new Error(`Bootstrap v1 deve conter ${BOOTSTRAP_EXPECTED_COUNT} títulos.`);
if (!Array.isArray(TIERS) || !TIERS.length || new Set(TIERS.map(tier => tier.id)).size !== TIERS.length || new Set(TIERS.map(tier => tier.rank)).size !== TIERS.length || TIERS.some(tier => !Number.isSafeInteger(tier.rank) || tier.rank < 0 || !String(tier.label || '').trim())) throw new Error('Catálogo de tiers inválido.');
const tierById = new Map(TIERS.map(tier => [tier.id, tier]));
const titleIds = new Set();
for (const title of titles) {
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(title.id) || titleIds.has(title.id)) throw new Error(`ID de título ausente ou duplicado: ${title.id}`);
  if (!String(title.name || '').trim() || !tierById.has(title.tier)) throw new Error(`Título inválido no catálogo: ${title.id}`);
  if (!['normal', 'event', 'limited', 'exclusive', 'unobtainable'].includes(title.acquisition)) throw new Error(`Aquisição inválida: ${title.id}`);
  if (title.eventId !== null && title.eventId !== undefined && (typeof title.eventId !== 'string' || title.eventId.length > 96)) throw new Error(`eventId inválido: ${title.id}`);
  if (title.acquisition === 'event' && !String(title.eventId || '').trim()) throw new Error(`Título de evento sem eventId: ${title.id}`);
  if (title.active !== undefined && typeof title.active !== 'boolean') throw new Error(`Estado active inválido: ${title.id}`);
  if (title.collectionEligible !== undefined && typeof title.collectionEligible !== 'boolean') throw new Error(`collectionEligible inválido: ${title.id}`);
  if (typeof title.description !== 'string' || title.description.length > 2_000) throw new Error(`Descrição inválida: ${title.id}`);
  if (!/^\d+$/.test(String(title.baseWeight)) || BigInt(title.baseWeight) <= 0n) throw new Error(`Peso-base inválido: ${title.id}`);
  if (title.baseDenominator !== null && (!/^\d+$/.test(String(title.baseDenominator)) || BigInt(title.baseDenominator) <= 0n)) throw new Error(`Odds-base inválida: ${title.id}`);
  titleIds.add(title.id);
  title.tierLabel = tierById.get(title.tier).label;
  title.tierRank = tierById.get(title.tier).rank;
  title.baseWeight = BigInt(title.baseWeight);
  title.denominator = title.baseDenominator === null ? null : BigInt(title.baseDenominator);
  title.sortOrder = Number.isSafeInteger(title.sortOrder) ? title.sortOrder : 0;
  title.active = title.active !== false;
  Object.freeze(title);
}
const normalRollTitles = titles.filter(title => title.active && title.acquisition === 'normal');
if (!normalRollTitles.length) throw new Error('O catálogo precisa ter ao menos um título disponível no RNG normal.');
const titleById = new Map(titles.map(title => [title.id, title]));
const basePoolWeight = titles.reduce((sum, title) => sum + title.baseWeight, 0n);
if (CATALOG_VERSION === 1 && (normalRollTitles.length !== BOOTSTRAP_EXPECTED_COUNT || basePoolWeight !== POOL)) throw new Error('O catálogo de bootstrap v1 precisa preservar o pool de odds original.');
const normalBaseWeightSum = normalRollTitles.reduce((sum, title) => sum + title.baseWeight, 0n);
const normalBaseWeights = normalBaseWeightSum === POOL
  ? new Map(normalRollTitles.map(title => [title.id, title.baseWeight]))
  : allocatePositiveWeights(normalRollTitles, POOL, title => title.baseWeight);
for (const title of titles) {
  if (title.acquisition === 'normal' && !title.active) throw new Error(`Título inativo não pode estar no RNG normal: ${title.id}`);
  if (title.acquisition === 'unobtainable' && title.eventId) throw new Error(`Título unobtainable não pode manter evento ativo: ${title.id}`);
  if (title.assetId && !/^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(title.assetId)) throw new Error(`assetId inválido: ${title.id}`);
  if (title.presentationId && !/^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(title.presentationId)) throw new Error(`presentationId inválido: ${title.id}`);
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function nonNegativeBigIntString(value, fallback = '0') {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : fallback;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : fallback;
  return /^\d+$/.test(String(value ?? '')) ? String(value) : fallback;
}

function normalizeProfileDisplayName(value) {
  return [...String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 32).join('');
}

function validateProfileDisplayName(value) {
  const cleaned = String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  const length = [...cleaned].length;
  if (!length) return { ok: false, reason: 'name-empty', value: '' };
  if (length > 32) return { ok: false, reason: 'name-too-long', value: normalizeProfileDisplayName(cleaned) };
  return { ok: true, reason: null, value: cleaned };
}

function emptyLuckMetrics() {
  return {
    version: RNG_LUCK_METRIC_VERSION,
    measuredRolls: 0,
    singularPlusObserved: 0,
    singularPlusExpectedWeight: '0',
    singularPlusVarianceWeight: '0',
    byTier: Object.fromEntries(TIERS.map(tier => [tier.id, { observed: 0, expectedWeight: '0', varianceWeight: '0' }])),
    oddsBands: Array.from({ length: 81 }, (_, exponent) => ({ exponent, observed: 0, expectedWeight: '0', varianceWeight: '0' })),
    bestOutlier: null
  };
}

function normalizeLuckMetrics(value = {}) {
  const empty = emptyLuckMetrics();
  if (!value || value.version !== RNG_LUCK_METRIC_VERSION) return empty;
  const byTier = Object.fromEntries(TIERS.map(tier => {
    const band = value.byTier?.[tier.id] || {};
    return [tier.id, {
      observed: nonNegativeInteger(band.observed),
      expectedWeight: nonNegativeBigIntString(band.expectedWeight),
      varianceWeight: nonNegativeBigIntString(band.varianceWeight)
    }];
  }));
  const sourceBands = Array.isArray(value.oddsBands) ? value.oddsBands : [];
  const sourceBandsByExponent = new Map(sourceBands.filter(item => Number.isInteger(item?.exponent)).map(item => [item.exponent, item]));
  const oddsBands = empty.oddsBands.map(band => {
    const source = sourceBandsByExponent.get(band.exponent) || {};
    return { exponent: band.exponent, observed: nonNegativeInteger(source.observed), expectedWeight: nonNegativeBigIntString(source.expectedWeight), varianceWeight: nonNegativeBigIntString(source.varianceWeight) };
  });
  const outlier = value.bestOutlier;
  const bestOutlier = outlier && titleById.has(outlier.titleId) && nonNegativeInteger(outlier.roll) > 0 && /^\d+$/.test(String(outlier.weight || ''))
    ? { titleId: outlier.titleId, roll: nonNegativeInteger(outlier.roll), weight: String(outlier.weight) }
    : null;
  return {
    version: RNG_LUCK_METRIC_VERSION,
    measuredRolls: nonNegativeInteger(value.measuredRolls),
    singularPlusObserved: nonNegativeInteger(value.singularPlusObserved),
    singularPlusExpectedWeight: nonNegativeBigIntString(value.singularPlusExpectedWeight),
    singularPlusVarianceWeight: nonNegativeBigIntString(value.singularPlusVarianceWeight),
    byTier,
    oddsBands,
    bestOutlier
  };
}

function accumulateLuckMetrics(state, weights, selected, rollNumber) {
  const metrics = state.luckMetrics;
  const tierWeights = Object.fromEntries(TIERS.map(tier => [tier.id, 0n]));
  const oddsBandWeights = Array(81).fill(0n);
  for (const title of normalRollTitles) {
    const weight = weights.get(title.id);
    tierWeights[title.tier] += weight;
    const weightText = weight.toString();
    const digits = weightText.length;
    const exponent = Math.max(0, Math.min(80, 80 - digits + (/^10*$/.test(weightText) ? 1 : 0)));
    oddsBandWeights[exponent] += weight;
  }

  metrics.measuredRolls++;
  const selectedTierIndex = TIERS.findIndex(tier => tier.id === selected.tier);
  if (selectedTierIndex >= 2) metrics.singularPlusObserved++;
  let singularPlusWeight = 0n;
  for (let index = 2; index < TIERS.length; index++) singularPlusWeight += tierWeights[TIERS[index].id];
  const addExpectedVariance = (band, weight) => {
    band.expectedWeight = (BigInt(band.expectedWeight) + weight).toString();
    band.varianceWeight = (BigInt(band.varianceWeight) + weight * (POOL - weight) / POOL).toString();
  };
  metrics.singularPlusExpectedWeight = (BigInt(metrics.singularPlusExpectedWeight) + singularPlusWeight).toString();
  metrics.singularPlusVarianceWeight = (BigInt(metrics.singularPlusVarianceWeight) + singularPlusWeight * (POOL - singularPlusWeight) / POOL).toString();
  for (const tier of TIERS) {
    const band = metrics.byTier[tier.id];
    if (tier.id === selected.tier) band.observed++;
    addExpectedVariance(band, tierWeights[tier.id]);
  }
  const selectedWeight = weights.get(selected.id);
  const digits = selectedWeight.toString().length;
  const selectedExponent = Math.max(0, Math.min(80, 80 - digits + (/^10*$/.test(selectedWeight.toString()) ? 1 : 0)));
  for (let exponent = 0; exponent < 81; exponent++) {
    const band = metrics.oddsBands[exponent];
    const weight = oddsBandWeights[exponent];
    if (weight === 0n) continue;
    if (exponent === selectedExponent) band.observed++;
    addExpectedVariance(band, weight);
  }
  if (!metrics.bestOutlier || selectedWeight < BigInt(metrics.bestOutlier.weight)) {
    metrics.bestOutlier = { titleId: selected.id, roll: rollNumber, weight: String(selectedWeight) };
  }
}

function normalizeBoost(value) {
  if (!value || !RNG_CONSUMABLE_TYPES.has(value.type)) return null;
  const max = value.type === 'rolls' ? RNG_ROLL_BOOST_SIZE : RNG_TIME_BOOST_SECONDS;
  const remaining = Math.min(max, nonNegativeInteger(value.remaining));
  return remaining > 0 ? { type: value.type, remaining } : null;
}

function equalHourBonusAt(timestamp) {
  if (!Number.isFinite(timestamp)) return { active: false, multiplier: 1, time: '' };
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return { active: false, multiplier: 1, time: '' };
  const parts = Object.fromEntries(brazilClock.formatToParts(date).filter(part => part.type === 'hour' || part.type === 'minute').map(part => [part.type, Number(part.value)]));
  const hour = parts.hour;
  const minute = parts.minute;
  const active = hour === minute;
  return {
    active,
    multiplier: active ? 2 : 1,
    time: active ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : ''
  };
}

function normalizedLocalHour(value) {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : new Date().getHours();
}

function relicEffects(value = {}, { localHour } = {}) {
  const state = normalizeState(value);
  const equipped = new Set(state.equippedRelicIds);
  const completeSets = new Set(RELIC_SETS.filter(set => RELICS.filter(relic => relic.setId === set.id).every(relic => equipped.has(relic.id))).map(set => set.id));
  const hour = normalizedLocalHour(localHour);
  let luckMultiplierBps = 10_000n;
  let fragmentMultiplierBps = 10_000;
  let resultMultiplier = 1;
  let flatResults = 0;
  const activeEffects = [];
  const periodicResultBonuses = [];
  const celestialComplete = completeSets.has('celestial');
  for (const relicId of equipped) {
    const relic = relicById.get(relicId);
    if (!relic) continue;
    const clockIsActive = relicId === 'solar-clock'
      ? celestialComplete || (hour >= 6 && hour < 18)
      : relicId === 'lunar-clock' ? celestialComplete || hour < 6 || hour >= 18 : true;
    if (!clockIsActive) continue;
    if (relic.luckMultiplierBps) {
      luckMultiplierBps = luckMultiplierBps * BigInt(relic.luckMultiplierBps) / 10_000n;
      activeEffects.push(`${relic.name} · sorte ×${(relic.luckMultiplierBps / 10_000).toLocaleString('pt-BR')}`);
    }
    if (relic.fragmentMultiplierBps) fragmentMultiplierBps = Math.floor(fragmentMultiplierBps * relic.fragmentMultiplierBps / 10_000);
    if (relic.resultMultiplier) {
      resultMultiplier *= relic.resultMultiplier;
      activeEffects.push(`${relic.name} · resultados ×${relic.resultMultiplier}`);
    }
    if (relic.flatResults) {
      flatResults += relic.flatResults;
      activeEffects.push(`${relic.name} · +${relic.flatResults} resultado por ação`);
    }
    if (relic.resultBonusEvery && relic.resultBonus) {
      periodicResultBonuses.push({ every: relic.resultBonusEvery, amount: relic.resultBonus });
      activeEffects.push(`${relic.name} · +${relic.resultBonus} a cada ${new Intl.NumberFormat('pt-BR').format(relic.resultBonusEvery)} rolagens`);
    }
  }
  if (completeSets.has('echoes')) { resultMultiplier *= 2; activeEffects.push('Conjunto Ecos · resultados ×2'); }
  return { completeSetIds: [...completeSets], luckMultiplierBps, fragmentMultiplierBps, resultMultiplier, flatResults, periodicResultBonuses, activeEffects };
}

function normalizeState(value = {}) {
  const collectedIds = [...new Set((Array.isArray(value.collectedIds) ? value.collectedIds : []).filter(id => titleById.has(id)))];
  const collectedRarest = collectedIds.reduce((best, id) => { const title = titleById.get(id); return title.denominator && (!best || title.denominator > best.denominator) ? title : best; }, null);
  const totalRolls = nonNegativeInteger(value.totalRolls);
  const seenDiscoveries = new Set();
  const historySource = Array.isArray(value.titleHistory)
    ? [...value.titleHistory, ...(Array.isArray(value.recentDiscoveries) ? value.recentDiscoveries : [])]
    : (Array.isArray(value.recentDiscoveries) ? value.recentDiscoveries : []);
  const titleHistory = historySource
    .filter(discovery => {
      if (!discovery || !titleById.has(discovery.titleId) || !collectedIds.includes(discovery.titleId)) return false;
      const roll = nonNegativeInteger(discovery.roll);
      if (roll < 1 || roll > totalRolls || seenDiscoveries.has(discovery.titleId)) return false;
      seenDiscoveries.add(discovery.titleId);
      return true;
    })
    .map(discovery => ({
      titleId: discovery.titleId,
      titleNameAtDiscovery: String(discovery.titleNameAtDiscovery || titleById.get(discovery.titleId)?.name || '').slice(0, 100),
      tierAtDiscovery: tierById.has(discovery.tierAtDiscovery) ? discovery.tierAtDiscovery : titleById.get(discovery.titleId)?.tier,
      tierLabelAtDiscovery: String(discovery.tierLabelAtDiscovery || titleById.get(discovery.titleId)?.tierLabel || '').slice(0, 40),
      tierRankAtDiscovery: Number.isSafeInteger(discovery.tierRankAtDiscovery) && discovery.tierRankAtDiscovery >= 0 ? discovery.tierRankAtDiscovery : titleById.get(discovery.titleId)?.tierRank,
      catalogVersionAtDiscovery: nonNegativeInteger(discovery.catalogVersionAtDiscovery, CATALOG_VERSION),
      roll: nonNegativeInteger(discovery.roll),
      currentOdds: String(discovery.currentOdds || '').slice(0, 80),
      isBonusRoll: Boolean(discovery.isBonusRoll),
      rollBonusMultiplier: Math.max(1, Math.min(10, nonNegativeInteger(discovery.rollBonusMultiplier, 1))),
      isEqualHourBonus: Boolean(discovery.isEqualHourBonus),
      equalHourMultiplier: discovery.isEqualHourBonus ? 2 : 1,
      equalHourTime: discovery.isEqualHourBonus && /^(?:[01]\d|2[0-3]):(?:[01]\d|2[0-3])$/.test(String(discovery.equalHourTime || '')) && String(discovery.equalHourTime).slice(0, 2) === String(discovery.equalHourTime).slice(3, 5) ? String(discovery.equalHourTime) : '',
      isThousandRollBonus: Boolean(discovery.isThousandRollBonus),
      thousandRollMultiplier: discovery.isThousandRollBonus ? THOUSAND_ROLL_BONUS_MULTIPLIER : 1,
      isTenThousandRollBonus: Boolean(discovery.isTenThousandRollBonus),
      tenThousandRollMultiplier: discovery.isTenThousandRollBonus ? TEN_THOUSAND_ROLL_BONUS_MULTIPLIER : 1,
      consumableMultiplier: [2, 4].includes(discovery.consumableMultiplier) ? discovery.consumableMultiplier : 1,
      consumableBoostTypes: [...new Set((Array.isArray(discovery.consumableBoostTypes) ? discovery.consumableBoostTypes : []).filter(type => RNG_CONSUMABLE_TYPES.has(type)))],
      rolledAt: nonNegativeInteger(discovery.rolledAt),
      eventName: String(discovery.eventName || '').slice(0, 60),
      eventMultiplier: Math.max(1, Math.min(5, nonNegativeInteger(discovery.eventMultiplier, 1))),
      eventFocusTierLabel: String(discovery.eventFocusTierLabel || '').slice(0, 40),
      eventFocusMultiplier: Math.max(1, Math.min(3, nonNegativeInteger(discovery.eventFocusMultiplier, 1)))
    }))
    .slice(0, titles.length);
  const recentDiscoveries = titleHistory.slice(0, 8);
  const sinceSingular = value.sinceSingular === null || value.sinceSingular === undefined ? null : nonNegativeInteger(value.sinceSingular);
  const ownedRelicIds = [...new Set((Array.isArray(value.ownedRelicIds) ? value.ownedRelicIds : []).filter(id => relicById.has(id)))];
  const equippedRelicIds = [...new Set((Array.isArray(value.equippedRelicIds) ? value.equippedRelicIds : []).filter(id => ownedRelicIds.includes(id)))].slice(0, RNG_EQUIPMENT_SLOTS);
  const achievementRelicRewardedIds = [...new Set((Array.isArray(value.achievementRelicRewardedIds) ? value.achievementRelicRewardedIds : []).filter(id => ACHIEVEMENT_RELICS.some(relic => relic.achievementId === id)))];
  const randomRelicTarget = Number.isInteger(value.randomRelicTarget) && value.randomRelicTarget >= RANDOM_RELIC_MIN_ROLLS && value.randomRelicTarget <= RANDOM_RELIC_MAX_ROLLS ? value.randomRelicTarget : 0;
  let activeBoost = normalizeBoost(value.activeBoost);
  let parallelBoost = normalizeBoost(value.parallelBoost);
  const boostQueue = (Array.isArray(value.boostQueue) ? value.boostQueue : []).map(normalizeBoost).filter(Boolean);
  if (!activeBoost && parallelBoost) { activeBoost = parallelBoost; parallelBoost = null; }
  if (activeBoost && parallelBoost?.type === activeBoost.type) { boostQueue.unshift(parallelBoost); parallelBoost = null; }
  if (activeBoost && !parallelBoost) {
    const nextDifferentType = boostQueue.findIndex(boost => boost.type !== activeBoost.type);
    if (nextDifferentType >= 0) parallelBoost = boostQueue.splice(nextDifferentType, 1)[0];
  }
  return {
    schemaVersion: RNG_SAVE_SCHEMA_VERSION,
    profile: {
      displayName: normalizeProfileDisplayName(value.profile?.displayName),
      equippedTitleId: collectedIds.includes(value.profile?.equippedTitleId) ? value.profile.equippedTitleId : null
    },
    luckMetrics: normalizeLuckMetrics(value.luckMetrics),
    collectedIds,
    bonusRollCounter: nonNegativeInteger(value.bonusRollCounter) % 10,
    totalRolls,
    manualRolls: nonNegativeInteger(value.manualRolls),
    totalAppSeconds: nonNegativeInteger(value.totalAppSeconds),
    totalAutoRollSeconds: nonNegativeInteger(value.totalAutoRollSeconds),
    lastAutoRollSessionSeconds: nonNegativeInteger(value.lastAutoRollSessionSeconds),
    lastTitleId: titleById.has(value.lastTitleId) ? value.lastTitleId : null,
    recentDiscoveries,
    titleHistory,
    trackedRolls: nonNegativeInteger(value.trackedRolls),
    tierRolls: Object.fromEntries(TIERS.map(tier => [tier.id, nonNegativeInteger(value.tierRolls?.[tier.id])])),
    duplicateRolls: nonNegativeInteger(value.duplicateRolls),
    luckMultiplierSum: nonNegativeInteger(value.luckMultiplierSum),
    luckBpsSum: nonNegativeInteger(value.luckBpsSum),
    luckBpsSamples: nonNegativeInteger(value.luckBpsSamples),
    maxMultiplier: Math.max(1, nonNegativeInteger(value.maxMultiplier, 1)),
    sinceSingular,
    longestSingularDrought: nonNegativeInteger(value.longestSingularDrought),
    sameTitleStreak: nonNegativeInteger(value.sameTitleStreak),
    longestSameTitleStreak: nonNegativeInteger(value.longestSameTitleStreak),
    singularStreak: nonNegativeInteger(value.singularStreak),
    rarestOdds: collectedRarest ? String(collectedRarest.denominator) : /^\d+$/.test(String(value.rarestOdds || '')) ? String(value.rarestOdds) : '0',
    rarestTitleId: collectedRarest?.id || (titleById.has(value.rarestTitleId) ? value.rarestTitleId : null),
    luckiestOdds: /^\d+$/.test(String(value.luckiestOdds || '')) ? String(value.luckiestOdds) : '0',
    luckiestRoll: nonNegativeInteger(value.luckiestRoll),
    sessionBest: { rolls: nonNegativeInteger(value.sessionBest?.rolls), newTitles: nonNegativeInteger(value.sessionBest?.newTitles), bestOdds: String(value.sessionBest?.bestOdds || '0') },
    unlockedSecrets: [...new Set((Array.isArray(value.unlockedSecrets) ? value.unlockedSecrets : []).filter(id => SECRETS.some(secret => secret.id === id)))],
    limitedTitles: [...new Set((Array.isArray(value.limitedTitles) ? value.limitedTitles : []).filter(id => LIMITED_REWARDS.some(reward => reward.titleId === id)))],
    fragmentBalance: nonNegativeBigIntString(value.fragmentBalance),
    fragmentRewardRemainderBps: Math.min(9_999, nonNegativeInteger(value.fragmentRewardRemainderBps)),
    permanentUpgradeLevels: nonNegativeInteger(value.permanentUpgradeLevels),
    nextPermanentUpgradeCost: nonNegativeBigIntString(value.nextPermanentUpgradeCost, RNG_UPGRADE_INITIAL_COST.toString()),
    consumableInventory: {
      rolls: nonNegativeInteger(value.consumableInventory?.rolls),
      time: nonNegativeInteger(value.consumableInventory?.time)
    },
    activeBoost,
    parallelBoost,
    boostQueue,
    ownedRelicIds,
    equippedRelicIds,
    relicRemovalVersion: RNG_RELIC_REMOVAL_VERSION,
    achievementRelicRewardedIds,
    randomRelicProgress: randomRelicTarget ? Math.min(nonNegativeInteger(value.randomRelicProgress), randomRelicTarget - 1) : 0,
    randomRelicTarget,
    eventRelicRewardedWindows: [...new Set((Array.isArray(value.eventRelicRewardedWindows) ? value.eventRelicRewardedWindows : []).filter(id => typeof id === 'string').map(id => id.slice(0, 48)))].slice(-100),
    eventsParticipated: nonNegativeInteger(value.eventsParticipated),
    participation: typeof value.participation === 'string' ? value.participation.slice(0, 48) : null,
    eventRollProgress: {
      windowId: typeof value.eventRollProgress?.windowId === 'string' ? value.eventRollProgress.windowId.slice(0, 48) : '',
      rolls: nonNegativeInteger(value.eventRollProgress?.rolls)
    }
  };
}

function migrateRemovedMisfortuneRelics(value, fallbackValue = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const versionOf = state => Math.max(
    nonNegativeInteger(state?.relicRemovalVersion),
    nonNegativeInteger(state?.droughtRelicProgressVersion)
  );
  if (versionOf(value) >= RNG_RELIC_REMOVAL_VERSION) return value;

  const legacyOwnedIds = new Set([
    ...(Array.isArray(value.ownedRelicIds) ? value.ownedRelicIds : []),
    ...(Array.isArray(value.equippedRelicIds) ? value.equippedRelicIds : [])
  ].filter(id => REMOVED_MISFORTUNE_RELIC_IDS.has(id)));
  if (fallbackValue && versionOf(fallbackValue) < RNG_RELIC_REMOVAL_VERSION) {
    for (const id of [
      ...(Array.isArray(fallbackValue.ownedRelicIds) ? fallbackValue.ownedRelicIds : []),
      ...(Array.isArray(fallbackValue.equippedRelicIds) ? fallbackValue.equippedRelicIds : [])
    ]) {
      if (REMOVED_MISFORTUNE_RELIC_IDS.has(id)) legacyOwnedIds.add(id);
    }
  }
  const fragmentBalance = BigInt(nonNegativeBigIntString(value.fragmentBalance)) + RNG_DUPLICATE_RELIC_REWARD * BigInt(legacyOwnedIds.size);
  const { droughtRelicStage, droughtRelicProgress, droughtRelicProgressVersion, ...preserved } = value;
  return {
    ...preserved,
    ownedRelicIds: (Array.isArray(value.ownedRelicIds) ? value.ownedRelicIds : []).filter(id => !REMOVED_MISFORTUNE_RELIC_IDS.has(id)),
    equippedRelicIds: (Array.isArray(value.equippedRelicIds) ? value.equippedRelicIds : []).filter(id => !REMOVED_MISFORTUNE_RELIC_IDS.has(id)),
    fragmentBalance: fragmentBalance.toString(),
    relicRemovalVersion: RNG_RELIC_REMOVAL_VERSION
  };
}

function categoryBonusBps(value = {}, tierId) {
  const state = normalizeState(value);
  const collected = titles.reduce((count, title) => count + (title.tier === tierId && state.collectedIds.includes(title.id) ? 1 : 0), 0);
  return CATEGORY_MILESTONES.reduce((bonus, milestone) => collected >= milestone.count ? milestone.bonusBps : bonus, 0);
}

function achievementLuckRewardBps(achievementId) {
  return ACHIEVEMENT_LUCK_REWARDS[achievementId] || 0;
}

function unlockedAchievementLuckBps(state) {
  const unlockedTiers = new Set(state.collectedIds.map(id => titleById.get(id)?.tier));
  let bonusBps = 0;
  if (state.totalRolls >= 100_000) bonusBps += ACHIEVEMENT_LUCK_REWARDS['rolls-100000'];
  if (state.totalRolls >= 1_000_000) bonusBps += ACHIEVEMENT_LUCK_REWARDS['rolls-1000000'];
  if (state.totalRolls >= 5_000_000) bonusBps += ACHIEVEMENT_LUCK_REWARDS['rolls-5000000'];
  if (state.totalRolls >= 10_000_000) bonusBps += ACHIEVEMENT_LUCK_REWARDS['rolls-10000000'];
  if (state.manualRolls >= 1_000_000) bonusBps += ACHIEVEMENT_LUCK_REWARDS['manual-rolls-1000000'];
  if (state.collectedIds.length >= 200) bonusBps += ACHIEVEMENT_LUCK_REWARDS['unique-200'];
  for (const tier of TIERS) {
    if (tier.id !== 'basic' && unlockedTiers.has(tier.id)) bonusBps += ACHIEVEMENT_LUCK_REWARDS[`tier-${tier.id}`];
  }
  if (state.longestSameTitleStreak >= 7) bonusBps += ACHIEVEMENT_LUCK_REWARDS['streak-repeat-7'];
  if (state.longestSingularDrought >= 10_000) bonusBps += ACHIEVEMENT_LUCK_REWARDS['drought-10000'];
  if (state.maxMultiplier >= 100) bonusBps += ACHIEVEMENT_LUCK_REWARDS['multiplier-100'];
  if (state.eventsParticipated >= 10) bonusBps += ACHIEVEMENT_LUCK_REWARDS['events-10'];
  if (state.limitedTitles.length >= 1) bonusBps += ACHIEVEMENT_LUCK_REWARDS['limited-title'];
  if (Math.max(0, state.totalAppSeconds - state.totalAutoRollSeconds) >= RNG_MANUAL_TIME_ACHIEVEMENT_SECONDS) bonusBps += ACHIEVEMENT_LUCK_REWARDS['time-manual-100h'];
  if (state.totalAutoRollSeconds >= RNG_AUTO_TIME_ACHIEVEMENT_SECONDS) bonusBps += ACHIEVEMENT_LUCK_REWARDS['time-auto-1000h'];
  return bonusBps;
}

function unlockedSecretLuckBps(state) {
  return SECRETS.reduce((bonusBps, secret) => state.unlockedSecrets.includes(secret.id) ? bonusBps + (secret.luckBonusBps || 0) : bonusBps, 0);
}

function alignmentLuckScoreBps(state, { bonusRoll = false, equalHourBonus = false, thousandRollBonus = false, tenThousandRollBonus = false, eventMultiplier = 1, focusTierId = '', focusMultiplier = 1, consumableMultiplier = 1, localHour } = {}) {
  const nonNtcCollected = state.collectedIds.filter(id => titleById.get(id)?.tier !== 'ntc').length;
  const passiveBps = Math.min(10_000, Math.floor(nonNtcCollected / 2) * 100 + categoryBonusBps(state, 'basic'));
  let achievementBps = unlockedAchievementLuckBps(state);
  if (state.collectedIds.length >= 200) achievementBps -= ACHIEVEMENT_LUCK_REWARDS['unique-200'];
  if (state.collectedIds.some(id => titleById.get(id)?.tier === 'ntc')) achievementBps -= ACHIEVEMENT_LUCK_REWARDS['tier-ntc'];
  const categoryBps = TIERS.filter(tier => tier.id !== 'basic' && tier.id !== 'ntc')
    .reduce((total, tier) => total + categoryBonusBps(state, tier.id), 0);
  const upgradeBps = BigInt(state.permanentUpgradeLevels) * BigInt(RNG_UPGRADE_LUCK_BPS);
  const relicState = state.equippedRelicIds.includes('atlas-of-possibilities')
    ? { ...state, equippedRelicIds: state.equippedRelicIds.filter(id => id !== 'atlas-of-possibilities') }
    : state;
  const relicMultiplierBps = relicEffects(relicState, { localHour }).luckMultiplierBps;
  let luckBps = (10_000n + BigInt(passiveBps + achievementBps + unlockedSecretLuckBps(state) + categoryBps) + upgradeBps)
    * relicMultiplierBps / 10_000n;
  const milestones = luckForState(state, { localHour });
  const globalEventMultiplier = BigInt(Math.max(1, Math.min(5, nonNegativeInteger(eventMultiplier, 1))));
  const hasFocus = TIERS.some(tier => tier.id === focusTierId);
  const rarityFocusMultiplier = BigInt(hasFocus ? Math.max(1, Math.min(3, nonNegativeInteger(focusMultiplier, 1))) : 1);
  const temporaryMultiplier = BigInt(bonusRoll ? milestones.bonusMultiplier : 1)
    * BigInt(equalHourBonus ? 2 : 1)
    * BigInt(thousandRollBonus ? THOUSAND_ROLL_BONUS_MULTIPLIER : 1)
    * BigInt(tenThousandRollBonus ? TEN_THOUSAND_ROLL_BONUS_MULTIPLIER : 1)
    * BigInt([2, 4].includes(consumableMultiplier) ? consumableMultiplier : 1)
    * globalEventMultiplier
    * rarityFocusMultiplier;
  luckBps = luckBps * temporaryMultiplier;
  return luckBps > 10_000n ? luckBps - 10_000n : 0n;
}

function luckForState(value = {}, options = {}) {
  const state = normalizeState(value);
  const passiveBps = Math.min(10_000, Math.floor(state.collectedIds.length / 2) * 100 + categoryBonusBps(state, 'basic'));
  const achievementBonusBps = unlockedAchievementLuckBps(state);
  const secretBonusBps = unlockedSecretLuckBps(state);
  const permanentLuckBpsExact = BigInt(state.permanentUpgradeLevels) * BigInt(RNG_UPGRADE_LUCK_BPS);
  const permanentLuckBps = permanentLuckBpsExact > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(permanentLuckBpsExact);
  const collected = state.collectedIds.length;
  const rollMilestone = ROLL_MILESTONES.filter(item => collected >= item.count).at(-1);
  const bonusMilestone = BONUS_MILESTONES.filter(item => collected >= item.count).at(-1);
  const relics = relicEffects(state, options);
  const baseTotalBpsExact = 10_000n + BigInt(passiveBps + achievementBonusBps + secretBonusBps) + permanentLuckBpsExact;
  const baseTotalBps = baseTotalBpsExact > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(baseTotalBpsExact);
  const exactTotalBps = baseTotalBpsExact * relics.luckMultiplierBps / 10_000n;
  return {
    passiveBps,
    achievementBonusBps,
    secretBonusBps,
    permanentLuckBps,
    baseTotalBps,
    relicLuckMultiplierBps: relics.luckMultiplierBps.toString(),
    exactTotalBps: exactTotalBps.toString(),
    totalBps: exactTotalBps > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(exactTotalBps),
    rollsPerCycle: rollMilestone?.rollsPerCycle || 1,
    bonusMultiplier: bonusMilestone?.multiplier || 2,
    bonusRollEvery: 10,
    nextRollMilestone: ROLL_MILESTONES.find(item => collected < item.count) || null,
    nextBonusMilestone: BONUS_MILESTONES.find(item => collected < item.count) || null
  };
}

function allocatePositiveWeights(items, total, getRawWeight) {
  const minimum = BigInt(items.length);
  if (total < minimum) throw new RangeError('A distribuição não comporta todos os resultados.');
  const rawTotal = items.reduce((sum, item) => sum + getRawWeight(item), 0n);
  const distributable = total - minimum;
  const assigned = new Map();
  let used = 0n;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const weight = index === items.length - 1 ? total - used : 1n + distributable * getRawWeight(item) / (rawTotal || 1n);
    assigned.set(item.id, weight);
    used += weight;
  }
  return assigned;
}

function collectionCatalogCount(value = {}) {
  const collected = new Set(Array.isArray(value.collectedIds) ? value.collectedIds : []);
  return titles.filter(title => title.collectionEligible !== false && ((title.active && title.acquisition !== 'unobtainable') || collected.has(title.id))).length;
}

function currentWeights(value = {}, options = {}) {
  const state = normalizeState(value);
  const baseWeights = normalBaseWeights;
  const alignmentLuckBps = alignmentLuckScoreBps(state, options);
  if (alignmentLuckBps === 0n) return baseWeights;

  const basicTitles = normalRollTitles.filter(title => title.tier === 'basic');
  const rareTitles = normalRollTitles.filter(title => title.tier !== 'basic');
  const ntcTitles = normalRollTitles.filter(title => title.tier === 'ntc');
  if (!basicTitles.length || !rareTitles.length) return baseWeights;
  const rareAnchorWeight = rareTitles.reduce((largest, title) => baseWeights.get(title.id) > largest ? baseWeights.get(title.id) : largest, 0n);
  const rareBaseWeight = rareTitles.reduce((sum, title) => sum + baseWeights.get(title.id), 0n);
  const ntcBaseWeight = ntcTitles.reduce((sum, title) => sum + baseWeights.get(title.id), 0n);
  const rareLiftDelta = BigInt(rareTitles.length) * rareAnchorWeight - rareBaseWeight;
  const ntcLiftDelta = BigInt(ntcTitles.length) * rareAnchorWeight - ntcBaseWeight;
  const ntcOddsCeilingNumerator = POOL - ntcBaseWeight * RNG_NTC_ODDS_CEILING_DENOMINATOR;
  const ntcOddsCeilingDenominator = ntcLiftDelta * RNG_NTC_ODDS_CEILING_DENOMINATOR - rareLiftDelta;
  if (ntcOddsCeilingNumerator <= 0n || ntcOddsCeilingDenominator <= 0n) return baseWeights;
  const alignmentDenominator = alignmentLuckBps + RNG_ALIGNMENT_HALF_LIFE_BPS;
  const lambdaNumerator = ntcOddsCeilingNumerator * alignmentLuckBps;
  const lambdaDenominator = ntcOddsCeilingDenominator * alignmentDenominator;
  const rawWeights = new Map(normalRollTitles.map(title => {
    const baseWeight = baseWeights.get(title.id);
    if (title.tier === 'basic') return [title.id, baseWeight];
    const lift = (rareAnchorWeight - baseWeight) * lambdaNumerator / lambdaDenominator;
    return [title.id, baseWeight + lift];
  }));
  const weights = allocatePositiveWeights(normalRollTitles, POOL, title => rawWeights.get(title.id));
  const maxNtcWeight = POOL / RNG_NTC_ODDS_CEILING_DENOMINATOR;
  const ntcWeight = ntcTitles.reduce((total, title) => total + weights.get(title.id), 0n);
  if (ntcTitles.length && ntcWeight >= maxNtcWeight) {
    const excess = ntcWeight - (maxNtcWeight - 1n);
    const strongestNtc = ntcTitles[0];
    weights.set(strongestNtc.id, weights.get(strongestNtc.id) - excess);
    weights.set(basicTitles[0].id, weights.get(basicTitles[0].id) + excess);
  }
  return weights;
}

function secureRandomBelow(maximum) {
  if (maximum <= 0n) throw new RangeError('O intervalo de sorteio precisa ser positivo.');
  const bits = maximum.toString(2).length;
  const byteLength = Math.ceil(bits / 8);
  const mask = (1n << BigInt(bits)) - 1n;
  while (true) {
    const candidate = BigInt(`0x${crypto.randomBytes(byteLength).toString('hex')}`) & mask;
    if (candidate < maximum) return candidate;
  }
}

function promoteQueuedBoost(state) {
  while (state.boostQueue.length) {
    const activeTypes = new Set([state.activeBoost?.type, state.parallelBoost?.type].filter(Boolean));
    const nextIndex = state.boostQueue.findIndex(boost => !activeTypes.has(boost.type));
    if (nextIndex < 0) break;
    const next = state.boostQueue.splice(nextIndex, 1)[0];
    if (!state.activeBoost) state.activeBoost = next;
    else if (!state.parallelBoost) state.parallelBoost = next;
  }
  return state;
}

function advanceTimedBoost(value = {}, elapsedSeconds = 0) {
  const state = normalizeState(value);
  let remaining = nonNegativeInteger(elapsedSeconds);
  promoteQueuedBoost(state);
  while (remaining > 0) {
    const field = state.activeBoost?.type === 'time' ? 'activeBoost' : state.parallelBoost?.type === 'time' ? 'parallelBoost' : null;
    if (!field) break;
    if (remaining < state[field].remaining) {
      state[field].remaining -= remaining;
      remaining = 0;
    } else {
      remaining -= state[field].remaining;
      state[field] = null;
      promoteQueuedBoost(state);
    }
  }
  return normalizeState(state);
}

function permanentUpgradeCost(value = {}) {
  const state = normalizeState(value);
  return state.nextPermanentUpgradeCost || RNG_UPGRADE_INITIAL_COST.toString();
}

function purchasePermanentUpgrade(value = {}) {
  const state = normalizeState(value);
  const cost = BigInt(permanentUpgradeCost(state));
  const balance = BigInt(state.fragmentBalance);
  if (balance < cost) return { state, ok: false, reason: 'insufficient-fragments', cost: cost.toString() };
  state.fragmentBalance = (balance - cost).toString();
  state.permanentUpgradeLevels += 1;
  state.nextPermanentUpgradeCost = (cost * RNG_UPGRADE_COST_MULTIPLIER).toString();
  return { state: normalizeState(state), ok: true, cost: cost.toString(), levels: state.permanentUpgradeLevels };
}

function purchaseConsumable(value = {}, type) {
  const state = normalizeState(value);
  if (!RNG_CONSUMABLE_TYPES.has(type)) return { state, ok: false, reason: 'invalid-consumable' };
  const balance = BigInt(state.fragmentBalance);
  if (balance < RNG_CONSUMABLE_COST) return { state, ok: false, reason: 'insufficient-fragments', cost: RNG_CONSUMABLE_COST.toString() };
  state.fragmentBalance = (balance - RNG_CONSUMABLE_COST).toString();
  state.consumableInventory[type] += 1;
  return { state: normalizeState(state), ok: true, type, cost: RNG_CONSUMABLE_COST.toString() };
}

function activateConsumable(value = {}, type) {
  const state = normalizeState(value);
  if (!RNG_CONSUMABLE_TYPES.has(type)) return { state, ok: false, reason: 'invalid-consumable' };
  if (state.consumableInventory[type] < 1) return { state, ok: false, reason: 'not-in-inventory' };
  state.consumableInventory[type] -= 1;
  const boost = { type, remaining: type === 'rolls' ? RNG_ROLL_BOOST_SIZE : RNG_TIME_BOOST_SECONDS };
  const alreadyActive = [state.activeBoost, state.parallelBoost].some(active => active?.type === type);
  const alreadyQueued = state.boostQueue.some(queuedBoost => queuedBoost.type === type);
  const queued = alreadyActive || alreadyQueued;
  if (queued) state.boostQueue.push(boost);
  else if (!state.activeBoost) state.activeBoost = boost;
  else state.parallelBoost = boost;
  return { state: normalizeState(state), ok: true, type, queued };
}

function purchaseRelic(value = {}, relicId) {
  const state = normalizeState(value);
  if (!PURCHASABLE_RELIC_IDS.includes(relicId)) return { state, ok: false, reason: 'invalid-relic' };
  if (state.ownedRelicIds.includes(relicId)) return { state, ok: false, reason: 'already-owned' };
  const cost = relicShopPrice(relicId);
  if (BigInt(state.fragmentBalance) < cost) return { state, ok: false, reason: 'insufficient-fragments', cost: cost.toString() };
  state.fragmentBalance = (BigInt(state.fragmentBalance) - cost).toString();
  state.ownedRelicIds.push(relicId);
  return { state: normalizeState(state), ok: true, relicId, cost: cost.toString() };
}

function equipRelic(value = {}, relicId) {
  const state = normalizeState(value);
  if (!relicById.has(relicId) || !state.ownedRelicIds.includes(relicId)) return { state, ok: false, reason: 'not-owned' };
  if (state.equippedRelicIds.includes(relicId)) return { state, ok: false, reason: 'already-equipped' };
  if (state.equippedRelicIds.length >= RNG_EQUIPMENT_SLOTS) return { state, ok: false, reason: 'no-free-slot' };
  state.equippedRelicIds.push(relicId);
  return { state: normalizeState(state), ok: true, relicId };
}

function unequipRelic(value = {}, relicId) {
  const state = normalizeState(value);
  if (!state.equippedRelicIds.includes(relicId)) return { state, ok: false, reason: 'not-equipped' };
  state.equippedRelicIds = state.equippedRelicIds.filter(id => id !== relicId);
  return { state: normalizeState(state), ok: true, relicId };
}

function randomIndex(length, injectedValue) {
  if (!length) return 0;
  if (injectedValue !== undefined) return Number(BigInt(injectedValue) % BigInt(length));
  return Number(secureRandomBelow(BigInt(length)));
}

function nextRandomRelicTarget(injectedValue) {
  const spread = RANDOM_RELIC_MAX_ROLLS - RANDOM_RELIC_MIN_ROLLS + 1;
  return RANDOM_RELIC_MIN_ROLLS + randomIndex(spread, injectedValue);
}

function randomDropRelicId(injectedValue) {
  const commonCount = BigInt(COMMON_RANDOM_RELIC_IDS.length);
  const drawRange = commonCount * RNG_RARE_RELIC_DROP_DENOMINATOR;
  const draw = injectedValue === undefined
    ? secureRandomBelow(drawRange)
    : ((BigInt(injectedValue) % drawRange) + drawRange) % drawRange;
  if (draw % RNG_RARE_RELIC_DROP_DENOMINATOR === RNG_RARE_RELIC_DROP_DENOMINATOR - 1n) return 'twin-core';
  return COMMON_RANDOM_RELIC_IDS[Number(draw / RNG_RARE_RELIC_DROP_DENOMINATOR)];
}

function grantRelic(state, relicId, source) {
  const relic = relicById.get(relicId);
  if (!relic) return null;
  const duplicate = state.ownedRelicIds.includes(relicId);
  if (!duplicate) state.ownedRelicIds.push(relicId);
  return { id: relic.id, name: relic.name, tierLabel: 'Relíquia', relicId, source, duplicate, fragmentReward: duplicate ? RNG_DUPLICATE_RELIC_REWARD.toString() : '0' };
}

function rollTitle(value = {}, randomValue = secureRandomBelow(POOL), { rolledAt = null, event = null, autoRollSeconds = 0, limitedRewardValue, localHour, randomRelicTargetValue, randomRelicChoiceValue, eventRelicChoiceValue } = {}) {
  const state = normalizeState(value);
  const relicsBeforeRoll = relicEffects(state, { localHour });
  const activeConsumableBoosts = [state.activeBoost, state.parallelBoost].filter(Boolean);
  const consumableBoostTypes = activeConsumableBoosts.map(boost => boost.type);
  const consumableMultiplier = 2 ** activeConsumableBoosts.length;
  const priorSecrets = new Set(state.unlockedSecrets);
  const priorLimited = new Set(state.limitedTitles);
  const nextRoll = state.bonusRollCounter + 1;
  const bonusRoll = nextRoll >= 10;
  const rollBonusMultiplier = bonusRoll ? luckForState(state, { localHour }).bonusMultiplier : 1;
  const thousandRollBonus = (state.totalRolls + 1) % THOUSAND_ROLL_BONUS_EVERY === 0;
  const tenThousandRollBonus = (state.totalRolls + 1) % TEN_THOUSAND_ROLL_BONUS_EVERY === 0;
  const equalHourBonus = equalHourBonusAt(rolledAt);
  const eventMultiplier = event?.multiplier || 1;
  const eventFocusTierId = event?.focusTierId || '';
  const eventFocusTierLabel = event?.focusTierLabel || '';
  const eventFocusMultiplier = event?.focusMultiplier || 1;
  const weights = currentWeights(state, { bonusRoll, equalHourBonus: equalHourBonus.active, thousandRollBonus, tenThousandRollBonus, eventMultiplier, focusTierId: eventFocusTierId, focusMultiplier: eventFocusMultiplier, consumableMultiplier, localHour });
  const roll = BigInt(randomValue);
  if (roll < 0n || roll >= POOL) throw new RangeError('O valor de sorteio está fora da distribuição.');
  let cumulative = 0n;
  let selected = normalRollTitles[normalRollTitles.length - 1];
  for (const title of normalRollTitles) {
    cumulative += weights.get(title.id);
    if (roll < cumulative) { selected = title; break; }
  }
  const isNew = !state.collectedIds.includes(selected.id);
  const previousTitleId = state.lastTitleId;
  if (isNew) state.collectedIds.push(selected.id);
  state.totalRolls += 1;
  state.lastTitleId = selected.id;
  state.bonusRollCounter = bonusRoll ? 0 : nextRoll;
  const odds = (POOL * 2n + weights.get(selected.id)) / (weights.get(selected.id) * 2n);
  accumulateLuckMetrics(state, weights, selected, state.totalRolls);
  const appliedFocusMultiplier = selected.tier === eventFocusTierId ? eventFocusMultiplier : 1;
  const multiplier = rollBonusMultiplier * equalHourBonus.multiplier * (thousandRollBonus ? 4 : 1) * (tenThousandRollBonus ? 10 : 1) * eventMultiplier * appliedFocusMultiplier * consumableMultiplier;
  state.trackedRolls++;
  state.tierRolls[selected.tier]++;
  if (!isNew) state.duplicateRolls++;
  state.luckMultiplierSum += multiplier;
  state.luckBpsSum += luckForState(value, { localHour }).totalBps * multiplier;
  state.luckBpsSamples++;
  state.maxMultiplier = Math.max(state.maxMultiplier, multiplier);
  const singularPlus = TIERS.findIndex(tier => tier.id === selected.tier) >= 2;
  state.sinceSingular = singularPlus ? 0 : (state.sinceSingular ?? 0) + 1;
  state.longestSingularDrought = Math.max(state.longestSingularDrought, state.sinceSingular || 0);
  state.sameTitleStreak = previousTitleId === selected.id ? state.sameTitleStreak + 1 : 1;
  state.longestSameTitleStreak = Math.max(state.longestSameTitleStreak, state.sameTitleStreak);
  state.singularStreak = TIERS.findIndex(tier => tier.id === selected.tier) >= 2 ? state.singularStreak + 1 : 0;
  if (BigInt(state.rarestOdds) < selected.denominator && selected.denominator) { state.rarestOdds = String(selected.denominator); state.rarestTitleId = selected.id; }
  if (BigInt(state.luckiestOdds) < odds) { state.luckiestOdds = String(odds); state.luckiestRoll = state.totalRolls; }
  const unlock = id => { if (!state.unlockedSecrets.includes(id)) state.unlockedSecrets.push(id); };
  if (state.totalRolls === 77_777) unlock('secret-77777');
  if (state.sameTitleStreak >= 7) unlock('secret-seven');
  if (state.singularStreak >= 2) unlock('secret-pair');
  if (selected.denominator && selected.denominator >= 1_000_000n && multiplier === 1) unlock('secret-million');
  if (selected.tier === 'basic' && multiplier >= 100) unlock('secret-hundred');
  if (autoRollSeconds >= 3600) unlock('secret-autohour');
  let completedFragmentEventNow = false;
  if (event?.eventId === 'fragments' && event.reward?.rollGoal) {
    if (state.eventRollProgress.windowId !== event.id) state.eventRollProgress = { windowId: event.id, rolls: 0 };
    const previousEventRolls = state.eventRollProgress.rolls;
    state.eventRollProgress.rolls = Math.min(event.reward.rollGoal, state.eventRollProgress.rolls + 1);
    completedFragmentEventNow = previousEventRolls < event.reward.rollGoal && state.eventRollProgress.rolls >= event.reward.rollGoal;
    if (state.eventRollProgress.rolls >= event.reward.rollGoal && !state.limitedTitles.includes(event.reward.titleId)) state.limitedTitles.push(event.reward.titleId);
  } else if (event?.reward?.odds && !state.limitedTitles.includes(event.reward.titleId) && BigInt(limitedRewardValue === undefined ? secureRandomBelow(BigInt(event.reward.odds)) : limitedRewardValue) === 0n) {
    state.limitedTitles.push(event.reward.titleId);
  }
  const newlyLimited = LIMITED_REWARDS.filter(reward => !priorLimited.has(reward.titleId) && state.limitedTitles.includes(reward.titleId));
  const relicUnlocks = [];
  if (!state.randomRelicTarget) state.randomRelicTarget = nextRandomRelicTarget(randomRelicTargetValue);
  state.randomRelicProgress += 1;
  if (state.randomRelicProgress >= state.randomRelicTarget) {
    const relicId = randomDropRelicId(randomRelicChoiceValue);
    relicUnlocks.push(grantRelic(state, relicId, 'random-drop'));
    state.randomRelicProgress = 0;
    state.randomRelicTarget = nextRandomRelicTarget(randomRelicTargetValue);
  }
  const eventRelicIds = EVENT_RELIC_IDS_BY_EVENT.get(event?.eventId) || [];
  const eventRelicReady = event?.eventId === 'fragments' ? completedFragmentEventNow : eventRelicIds.length > 0;
  if (eventRelicReady && eventRelicIds.length && !state.eventRelicRewardedWindows.includes(event.id)) {
    const relicId = eventRelicIds[randomIndex(eventRelicIds.length, eventRelicChoiceValue)];
    relicUnlocks.push(grantRelic(state, relicId, 'event'));
    state.eventRelicRewardedWindows.push(event.id);
  }
  for (const relic of ACHIEVEMENT_RELICS) {
    if (state.collectedIds.length < relic.achievementGoal || state.achievementRelicRewardedIds.includes(relic.achievementId)) continue;
    relicUnlocks.push(grantRelic(state, relic.id, 'achievement'));
    state.achievementRelicRewardedIds.push(relic.achievementId);
  }
  const baseFragmentReward = BigInt(RNG_FRAGMENT_REWARDS[selected.tier] || 0) * (isNew ? 2n : 1n) + LIMITED_TITLE_FRAGMENT_REWARD * BigInt(newlyLimited.length);
  const duplicateRelicReward = relicUnlocks.reduce((sum, unlock) => sum + BigInt(unlock.fragmentReward || 0), 0n);
  const fragmentRewardNumerator = (baseFragmentReward + duplicateRelicReward) * BigInt(relicsBeforeRoll.fragmentMultiplierBps) + BigInt(state.fragmentRewardRemainderBps);
  const fragmentReward = fragmentRewardNumerator / 10_000n;
  state.fragmentRewardRemainderBps = Number(fragmentRewardNumerator % 10_000n);
  state.fragmentBalance = (BigInt(state.fragmentBalance) + fragmentReward).toString();
  const specialUnlocks = [
    ...SECRETS.filter(secret => !priorSecrets.has(secret.id) && state.unlockedSecrets.includes(secret.id)).map(secret => ({ id: secret.id, name: secret.name, tierLabel: 'Segredo', luckBonusBps: secret.luckBonusBps || 0 })),
    ...newlyLimited.map(reward => ({ id: reward.titleId, name: reward.name, tierLabel: 'Limitado', fragmentReward: Number(LIMITED_TITLE_FRAGMENT_REWARD) })),
    ...relicUnlocks
  ];
  if (isNew) {
    const discovery = {
      titleId: selected.id,
      titleNameAtDiscovery: selected.name,
      tierAtDiscovery: selected.tier,
      tierLabelAtDiscovery: selected.tierLabel,
      tierRankAtDiscovery: selected.tierRank,
      catalogVersionAtDiscovery: CATALOG_VERSION,
      roll: state.totalRolls,
      currentOdds: oddsLabel(weights.get(selected.id)),
      isBonusRoll: bonusRoll,
      rollBonusMultiplier,
      isEqualHourBonus: equalHourBonus.active,
      equalHourMultiplier: equalHourBonus.multiplier,
      equalHourTime: equalHourBonus.time,
      isThousandRollBonus: thousandRollBonus,
      thousandRollMultiplier: thousandRollBonus ? THOUSAND_ROLL_BONUS_MULTIPLIER : 1,
      isTenThousandRollBonus: tenThousandRollBonus,
      tenThousandRollMultiplier: tenThousandRollBonus ? TEN_THOUSAND_ROLL_BONUS_MULTIPLIER : 1,
      consumableMultiplier,
      consumableBoostTypes,
      rolledAt: Number.isFinite(rolledAt) ? rolledAt : 0,
      eventName: event?.name || '',
      eventMultiplier,
      eventFocusTierLabel,
      eventFocusMultiplier: appliedFocusMultiplier
    };
    state.titleHistory = [discovery, ...state.titleHistory.filter(item => item.titleId !== selected.id)].slice(0, titles.length);
    state.recentDiscoveries = state.titleHistory.slice(0, 8);
  }
  const rollBoostField = state.activeBoost?.type === 'rolls' ? 'activeBoost' : state.parallelBoost?.type === 'rolls' ? 'parallelBoost' : null;
  if (rollBoostField) {
    state[rollBoostField].remaining -= 1;
    if (state[rollBoostField].remaining <= 0) state[rollBoostField] = null;
    promoteQueuedBoost(state);
  }
  return {
    state,
    title: selected,
    isNew,
    weight: weights.get(selected.id),
    currentOdds: oddsLabel(weights.get(selected.id)),
    isBonusRoll: bonusRoll,
    rollBonusMultiplier,
    isEqualHourBonus: equalHourBonus.active,
    equalHourMultiplier: equalHourBonus.multiplier,
    equalHourTime: equalHourBonus.time,
    isThousandRollBonus: thousandRollBonus,
    thousandRollMultiplier: thousandRollBonus ? THOUSAND_ROLL_BONUS_MULTIPLIER : 1,
    isTenThousandRollBonus: tenThousandRollBonus,
    tenThousandRollMultiplier: tenThousandRollBonus ? TEN_THOUSAND_ROLL_BONUS_MULTIPLIER : 1,
    consumableMultiplier,
    rolledAt: Number.isFinite(rolledAt) ? rolledAt : 0,
    eventName: event?.name || '',
    eventMultiplier,
    eventFocusTierLabel,
    eventFocusMultiplier: appliedFocusMultiplier,
    specialUnlocks,
    fragmentReward: fragmentReward.toString(),
    consumableBoostType: consumableBoostTypes.length > 1 ? consumableBoostTypes.join('+') : consumableBoostTypes[0] || null,
    consumableBoostTypes,
    consumableBoostMultiplier: consumableMultiplier
  };
}

function rollsPerAction(value = {}, options = {}) {
  const state = normalizeState(value);
  const relics = relicEffects(state, options);
  const baseResults = luckForState(state, options).rollsPerCycle * relics.resultMultiplier + relics.flatResults;
  const periodicResults = relics.periodicResultBonuses.reduce((sum, bonus) => sum + (Math.floor((state.totalRolls + baseResults) / bonus.every) - Math.floor(state.totalRolls / bonus.every)) * bonus.amount, 0);
  return Math.max(1, baseResults + periodicResults);
}

function rollBatch(value = {}, randomValues, { rolledAt = null, event = null, autoRollSeconds = 0, limitedRewardValue, localHour, randomRelicTargetValue, randomRelicChoiceValue, eventRelicChoiceValue } = {}) {
  const startingState = normalizeState(value);
  const rollsPerCycle = rollsPerAction(startingState, { localHour });
  let state = startingState;
  const results = [];
  for (let index = 0; index < rollsPerCycle; index++) {
    const outcome = rollTitle(state, Array.isArray(randomValues) ? randomValues[index] : undefined, { rolledAt, event, autoRollSeconds, limitedRewardValue, localHour, randomRelicTargetValue, randomRelicChoiceValue, eventRelicChoiceValue });
    state = outcome.state;
    results.push({
      title: outcome.title,
      isNew: outcome.isNew,
      currentOdds: outcome.currentOdds,
      roll: state.totalRolls,
      isBonusRoll: outcome.isBonusRoll,
      rollBonusMultiplier: outcome.rollBonusMultiplier,
      isEqualHourBonus: outcome.isEqualHourBonus,
      equalHourMultiplier: outcome.equalHourMultiplier,
      equalHourTime: outcome.equalHourTime,
      isThousandRollBonus: outcome.isThousandRollBonus,
      thousandRollMultiplier: outcome.thousandRollMultiplier,
      isTenThousandRollBonus: outcome.isTenThousandRollBonus,
      tenThousandRollMultiplier: outcome.tenThousandRollMultiplier,
      consumableMultiplier: outcome.consumableMultiplier,
      rolledAt: outcome.rolledAt,
      eventName: outcome.eventName,
      eventMultiplier: outcome.eventMultiplier,
      eventFocusTierLabel: outcome.eventFocusTierLabel,
      eventFocusMultiplier: outcome.eventFocusMultiplier,
      specialUnlocks: outcome.specialUnlocks,
      fragmentReward: outcome.fragmentReward,
      consumableBoostType: outcome.consumableBoostType,
      consumableBoostMultiplier: outcome.consumableBoostMultiplier
    });
  }
  return { state, results };
}

function oddsLabel(weight) {
  const roundedOdds = (POOL * 2n + weight) / (weight * 2n);
  if (roundedOdds < 1_000_000_000_000_000n) return `1 em ${wholeOddsFormatter.format(roundedOdds)}`;
  let exponent = roundedOdds.toString().length - 3;
  const unit = 10n ** BigInt(exponent);
  let coefficient = (roundedOdds + unit / 2n) / unit;
  if (coefficient >= 1000n) { coefficient /= 10n; exponent++; }
  const superscript = String(exponent).replace(/[0-9-]/g, digit => ({ '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' })[digit]);
  return `1 em ${wholeOddsFormatter.format(coefficient)} × 10${superscript}`;
}

function publicCatalog(value = {}, options = {}) {
  const state = normalizeState(value);
  const odds = currentWeights(state, options);
  const collected = new Set(state.collectedIds);
  return titles.map(title => ({
    id: title.id,
    name: collected.has(title.id) ? title.name : '???',
    tier: title.tier,
    tierLabel: title.tierLabel,
    description: title.description || '',
    acquisition: title.acquisition,
    active: title.active,
    eventId: title.eventId || null,
    assetId: title.assetId || null,
    presentationId: title.presentationId || title.tier,
    baseOdds: title.acquisition === 'normal' ? oddsLabel(normalBaseWeights.get(title.id)) : '',
    currentOdds: odds.has(title.id) ? oddsLabel(odds.get(title.id)) : '',
    collected: collected.has(title.id),
    categoryBonusBps: categoryBonusBps(state, title.tier)
  }));
}

function publicProgress(value = {}, options = {}) {
  const state = normalizeState(value);
  const collected = new Set(state.collectedIds);
  const tierProgress = TIERS.map(tier => {
    const count = titles.reduce((total, title) => total + (title.tier === tier.id && collected.has(title.id) ? 1 : 0), 0);
    const achieved = CATEGORY_MILESTONES.filter(milestone => count >= milestone.count).map(milestone => milestone.count);
    const next = CATEGORY_MILESTONES.find(milestone => count < milestone.count) || null;
    return { id: tier.id, label: tier.label, count, total: titles.filter(title => title.tier === tier.id && title.collectionEligible !== false && ((title.active && title.acquisition !== 'unobtainable') || collected.has(title.id))).length, bonusBps: categoryBonusBps(state, tier.id), achieved, nextCount: next?.count || null, nextBonusBps: next?.bonusBps || null };
  });
  const luck = luckForState(state, options);
  return {
    categoryMilestones: CATEGORY_MILESTONES.map(item => ({ ...item })),
    bonusRollCounter: state.bonusRollCounter,
    rollMilestones: ROLL_MILESTONES.map(item => ({ ...item })),
    bonusMilestones: BONUS_MILESTONES.map(item => ({ ...item })),
    rollsPerCycle: rollsPerAction(state, options),
    bonusMultiplier: luck.bonusMultiplier,
    nextRollMilestone: luck.nextRollMilestone,
    nextBonusMilestone: luck.nextBonusMilestone,
    tierProgress,
  };
}

function publicRelicState(value = {}, options = {}) {
  const state = normalizeState(value);
  const equipped = new Set(state.equippedRelicIds);
  const owned = new Set(state.ownedRelicIds);
  const effects = relicEffects(state, options);
  const sets = RELIC_SETS.map(set => {
    const pieces = RELICS.filter(relic => relic.setId === set.id);
    const equippedCount = pieces.filter(relic => equipped.has(relic.id)).length;
    return { ...set, pieceIds: pieces.map(relic => relic.id), equippedCount, complete: equippedCount === pieces.length };
  });
  return {
    slots: Array.from({ length: RNG_EQUIPMENT_SLOTS }, (_, index) => state.equippedRelicIds[index] || null),
    catalog: RELICS.map(relic => ({ ...relic, owned: owned.has(relic.id), equipped: equipped.has(relic.id), purchasable: relic.source === 'shop', price: relic.source === 'shop' ? relicShopPrice(relic.id).toString() : null })),
    sets,
    activeEffects: effects.activeEffects,
    fragmentMultiplierBps: effects.fragmentMultiplierBps,
    ownedCount: state.ownedRelicIds.length
  };
}

function debugGrantTierTitles(value = {}, tierId, count = 5) {
  if (!CATEGORY_TIER_IDS.has(tierId)) throw new RangeError('A raridade escolhida não existe.');
  const state = normalizeState(value);
  const target = Math.max(0, Math.min(titles.filter(title => title.tier === tierId).length, nonNegativeInteger(count)));
  const currentCount = state.collectedIds.reduce((total, id) => total + (titleById.get(id)?.tier === tierId ? 1 : 0), 0);
  const needed = Math.max(0, target - currentCount);
  const newTitles = titles.filter(title => title.tier === tierId && !state.collectedIds.includes(title.id)).slice(0, needed);
  state.collectedIds.push(...newTitles.map(title => title.id));
  return { state: normalizeState(state), granted: newTitles.length, tierId, target };
}

function debugGrantTotalTitles(value = {}, count = 25) {
  const state = normalizeState(value);
  const target = Math.max(0, Math.min(titles.length, nonNegativeInteger(count)));
  const needed = Math.max(0, target - state.collectedIds.length);
  const newTitles = titles.filter(title => !state.collectedIds.includes(title.id)).slice(0, needed);
  state.collectedIds.push(...newTitles.map(title => title.id));
  return { state: normalizeState(state), granted: newTitles.length, target };
}

function debugReadyBonusRoll(value = {}) {
  const state = normalizeState(value);
  state.bonusRollCounter = 9;
  return normalizeState(state);
}

function debugGrantTitle(value = {}, titleId) {
  const title = titleById.get(titleId);
  if (!title) throw new RangeError('O título escolhido não existe.');
  const state = normalizeState(value);
  const added = !state.collectedIds.includes(titleId);
  if (added) state.collectedIds.push(titleId);
  return { state: normalizeState(state), title, added };
}

function debugRemoveTitle(value = {}, titleId) {
  const title = titleById.get(titleId);
  if (!title) throw new RangeError('O título escolhido não existe.');
  const state = normalizeState(value);
  const removed = state.collectedIds.includes(titleId);
  state.collectedIds = state.collectedIds.filter(id => id !== titleId);
  state.recentDiscoveries = state.recentDiscoveries.filter(discovery => discovery.titleId !== titleId);
  state.titleHistory = state.titleHistory.filter(discovery => discovery.titleId !== titleId);
  return { state: normalizeState(state), title, removed };
}

function debugClearTitles(value = {}) {
  const state = normalizeState(value);
  const removedCount = state.collectedIds.length;
  state.collectedIds = [];
  state.recentDiscoveries = [];
  state.titleHistory = [];
  return { state: normalizeState(state), removedCount };
}

module.exports = {
  POOL,
  RNG_SAVE_SCHEMA_VERSION,
  RNG_LUCK_METRIC_VERSION,
  THOUSAND_ROLL_BONUS_EVERY,
  THOUSAND_ROLL_BONUS_MULTIPLIER,
  TEN_THOUSAND_ROLL_BONUS_EVERY,
  TEN_THOUSAND_ROLL_BONUS_MULTIPLIER,
  RNG_FRAGMENT_REWARDS,
  LIMITED_TITLE_FRAGMENT_REWARD,
  RNG_UPGRADE_INITIAL_COST,
  RNG_UPGRADE_LUCK_BPS,
  RNG_CONSUMABLE_COST,
  RNG_ROLL_BOOST_SIZE,
  RNG_TIME_BOOST_SECONDS,
  RNG_RELIC_COST,
  RNG_DUPLICATE_RELIC_REWARD,
  RNG_EQUIPMENT_SLOTS,
  RNG_RELIC_REMOVAL_VERSION,
  RNG_NTC_ODDS_CEILING_DENOMINATOR,
  RNG_ALIGNMENT_HALF_LIFE_BPS,
  RNG_MANUAL_TIME_ACHIEVEMENT_SECONDS,
  RNG_AUTO_TIME_ACHIEVEMENT_SECONDS,
  RANDOM_RELIC_MIN_ROLLS,
  RANDOM_RELIC_MAX_ROLLS,
  TIERS,
  CATALOG_VERSION,
  BOOTSTRAP_EXPECTED_COUNT,
  CATEGORY_MILESTONES,
  ROLL_MILESTONES,
  BONUS_MILESTONES,
  TITLES: titles,
  SECRETS,
  RELICS,
  RELIC_SETS,
  basePoolWeight,
  equalHourBonusAt,
  normalizeState,
  normalizeProfileDisplayName,
  validateProfileDisplayName,
  normalizeLuckMetrics,
  migrateRemovedMisfortuneRelics,
  achievementLuckRewardBps,
  luckForState,
  currentWeights,
  permanentUpgradeCost,
  purchasePermanentUpgrade,
  purchaseConsumable,
  activateConsumable,
  purchaseRelic,
  equipRelic,
  unequipRelic,
  relicEffects,
  rollsPerAction,
  advanceTimedBoost,
  rollTitle,
  rollBatch,
  publicCatalog,
  publicProgress,
  collectionCatalogCount,
  publicRelicState,
  oddsLabel,
  debugGrantTitle,
  debugRemoveTitle,
  debugClearTitles,
  debugGrantTierTitles,
  debugGrantTotalTitles,
  debugReadyBonusRoll
};
