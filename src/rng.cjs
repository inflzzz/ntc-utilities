const crypto = require('node:crypto');
const { LIMITED_REWARDS } = require('./rng-events.cjs');

const THOUSAND_ROLL_BONUS_EVERY = 1000;
const THOUSAND_ROLL_BONUS_MULTIPLIER = 4;
const TEN_THOUSAND_ROLL_BONUS_EVERY = 10_000;
const TEN_THOUSAND_ROLL_BONUS_MULTIPLIER = 10;

const TIERS = [
  { id: 'basic', label: 'Básico' },
  { id: 'epic', label: 'Épico' },
  { id: 'unique', label: 'Singular' },
  { id: 'legendary', label: 'Lendário' },
  { id: 'mythic', label: 'Mítico' },
  { id: 'exalted', label: 'Exaltado' },
  { id: 'glorious', label: 'Glorioso' },
  { id: 'transcendent', label: 'Transcendente' },
  { id: 'dimensional', label: 'Dimensional' },
  { id: 'ntc', label: 'Além do NTC' }
];

const TITLE_NAMES = {
  basic: [
    'Primeira Faísca', 'Passos Suaves', 'Pequeno Encanto', 'Pedra Serena', 'Fio da Manhã', 'Coração de Brasa', 'Amanhecer de Bolso', 'Corrente Serena', 'Sino Distante', 'Garoa Âmbar',
    'Cometa de Papel', 'Gota de Veludo', 'Pequena Órbita', 'Hora Azul', 'Luz de Amora-do-Céu', 'Estática Suave', 'Pó de Devaneio', 'Canção Acobreada', 'Luz da Maré Baixa', 'Quase uma Estrela'
  ],
  epic: [
    'Lanterna do Crepúsculo', 'Cometa de Cobre', 'Deriva de Safira', 'Circuito Lunar', 'Nova de Veludo', 'Halo Vazio', 'Sinal de Geada', 'Asa de Cinzas', 'Temporal de Opala', 'Aurora Errante',
    'Resplendor de Prata', 'Flor de Vidro Noturno', 'Salmo Incandescente', 'Marés Índigo', 'Motor Estelar', 'Miragem Lúcida', 'Eclipse de Ouro Rosado', 'Pétala Trovejante', 'Guardião Astral', 'Coroa da Aurora'
  ],
  unique: [
    'Estática Lunar', 'Cometa de Cristal', 'Réquiem Solar', 'Paralaxe Violeta', 'A Nona Brasa', 'Luz Estelar Partida', 'Espectro Prismático', 'Lucky Lad', 'Peregrino de Néon', 'Amanhecer Congelado',
    'Devaneio de Cobalto', 'A Supernova Silenciosa', 'Porto-Fantasma', 'Órbita de Cinzas', 'Coroa de Fogo Azul', 'Singularidade de Veludo', 'O Meridiano Oculto', 'Aurora sem Fim', 'Canção de Ninar Obsidiana', 'Luckiest Lad'
  ],
  legendary: [
    'Ruína Celeste', 'Coroa do Ocaso', 'Monarca sem Estrelas', 'Tempestade de Éter', 'Meridiano em Chamas', 'Motor da Queda Celeste', 'Soberano do Eclipse', 'Trono de Cometas', 'Ermos Infinitos', 'Domínio Solar',
    'A Última Constelação', 'Fenda Empírea', 'Fonte da Noite', 'Coroa Além do Tempo', 'Veredito Astral', 'Luz que Parte Mundos', 'Rainha da Longa Aurora', 'Céu por Escrever', 'Titã da Quietude', 'Arquiteto da Noite Eterna'
  ],
  mythic: [
    'Florescer da Singularidade', 'Andarilho da Fenda Empírea', 'O Primeiro Firmamento', 'Êxtase das Estrelas', 'Astro do Abismo', 'Jardim Cósmico', 'Sonho do Vazio', 'Estrutura Eterna', 'Zênite Estilhaçado', 'Santo da Gravidade',
    'Aurora Milenar', 'Cometa Indomável', 'Colosso Noturno', 'Soberano do Além', 'Coração Forjado em Estrelas', 'Universo de Vidro Negro', 'Correnteza Celeste', 'Miríade de Fogo Solar', 'Juramento do Infinito', 'Herdeiro do Cosmos'
  ],
  exalted: [
    'Coroa do Desfazer', 'Modelo do Silêncio', 'O Grande Celéstio', 'Rompedor de Axiomas', 'Majestade do Céu Profundo', 'Trono Imarcescível', 'Monarca Tecelão do Destino', 'Fogo Estelar Absoluto', 'Horizonte Sagrado', 'Além da Primeira Luz',
    'Paralaxe Perene', 'Império Astral', 'Colapso Magnífico', 'Vontade do Firmamento', 'Regente Infinito', 'Catedral da Centelha Divina', 'A Última Grande Órbita', 'Equação Soberana', 'Céu Inumerável', 'O Desconhecido Exaltado'
  ],
  glorious: [
    'Glória no Vazio', 'O Desfazer Radiante', 'Grão-Rei do Silêncio', 'Mil Sóis sem Fim', 'Majestade no Limite', 'O Além Brilhante', 'Pós-Mundo Glorioso', 'Luz sem Origem', 'Juramento do Devorador de Estrelas', 'Primeiro entre Eternidades',
    'Infinito Áureo', 'Zênite Imortal', 'Colosso da Criação', 'Coroa de Todos os Amanhãs', 'Singularidade Dourada', 'Resplendor Livre', 'Imperador da Costa Distante', 'Firmamento sem Rival', 'Glória Incomensurável', 'Absoluto Sempre Radiante'
  ],
  transcendent: [
    'Além do Véu', 'Maré Transcendente', 'Eternidade em Flor', 'Aurora Inalcançável', 'Ascensão sem Nome', 'Origem da Última Luz', 'Criador Invisível', 'Devaneio sem Limites', 'Nenhum Céu Acima', 'Paradoxo Sublime',
    'O Ascendente Final', 'Para Sempre por Escrever', 'Um Universo à Parte', 'Chama Incognoscível', 'Silêncio Infinito', 'O Grande Além', 'Depois de Todo Horizonte', 'Ascensão sem Fim', 'O Primeiro Depois de Tudo', 'Ápice do Invisível'
  ],
  dimensional: [
    'Coroa Dimensional', 'Aquele sem Lugar', 'Além de Todos os Eixos', 'Fenda Chamada Eternidade', 'A Nona Realidade', 'Arquiteto do Além', 'Infinito Dobrado', 'Mundo Incontável', 'Monarca do Multiverso', 'Coordenada Final',
    'Em Todo Lugar ao Mesmo Tempo', 'Contínuo Impossível', 'Mundos entre Mundos', 'Dobra sem Limites', 'Guardião de Todos os Reinos', 'Axioma de Tudo', 'O Lado de Fora Infinito', 'Trono entre Dimensões', 'Além sem Fim', 'Realidade sem Bordas'
  ],
  ntc: [
    'NTC: Princípio Primeiro', 'NTC: Nada Absoluto', 'NTC: Fim da Probabilidade', 'NTC: Último Impossível', 'NTC: O Nunca Criado', 'NTC: Além da Última Rolagem', 'NTC: Silêncio Infinito', 'NTC: Ponto Zero Eterno', 'NTC: Fim dos Mundos', 'NTC: O Inalcançável',
    'NTC: Tudo que Nunca Existiu', 'NTC: Para Sempre Inencontrável', 'NTC: Luz sem Origem', 'NTC: Última Exceção', 'NTC: Nada Além Disto', 'NTC: Absoluto por Escrever', 'NTC: Um em Toda a Eternidade', 'NTC: Fora da Existência', 'NTC: Constante Final', 'NTC: Além de Tudo'
  ]
};

const POOL = 10n ** 80n;
const RARITY_STARTS = [250n, 100_000n, 40_000_000n, 15_000_000_000n, 10_000_000_000_000n, 1_000_000_000_000_000_000n, 10n ** 21n, 10n ** 24n, 10n ** 27n];
const RARITY_RATIOS = [[132n, 100n], [130n, 100n], [130n, 100n], [134n, 100n], [130n, 100n], [130n, 100n], [130n, 100n], [130n, 100n], [150n, 100n]];
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
const CATEGORY_TIER_IDS = new Set(TIERS.map(tier => tier.id));
const BASIC_ODDS_SHAPES = [35n, 32n, 30n, 28n, 26n, 24n, 22n, 20n, 19n, 18n, 17n, 16n, 15n, 14n, 13n, 12n, 11n, 10n, 8n];
const BASIC_ODDS_SHAPE_TOTAL = BASIC_ODDS_SHAPES.reduce((sum, weight) => sum + weight, 0n);
const wholeOddsFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const brazilClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const SECRETS = [
  { id: 'secret-77777', name: 'O Observador', hint: 'A rolagem exata.' },
  { id: 'secret-seven', name: 'Eco de Sete', hint: 'Sete vezes o mesmo destino.' },
  { id: 'secret-pair', name: 'Dupla Singular', hint: 'Dois raros seguidos.' },
  { id: 'secret-million', name: 'Sorte Nua', hint: 'Um milhão sem bônus.' },
  { id: 'secret-hundred', name: 'Ironia Suprema', hint: 'O comum sob sorte extrema.' },
  { id: 'secret-autohour', name: 'Vigília Automática', hint: 'Uma hora sem pausa.' }
];

function geometricOdds(start, numerator, denominator, index) {
  let value = start;
  for (let step = 0; step < index; step++) value = (value * numerator + denominator / 2n) / denominator;
  return value;
}

const titles = [];
for (let tierIndex = 0; tierIndex < TIERS.length; tierIndex++) {
  const tier = TIERS[tierIndex];
  for (let index = 0; index < 20; index++) {
    const denominator = tierIndex === 0 ? null : geometricOdds(RARITY_STARTS[tierIndex - 1], ...RARITY_RATIOS[tierIndex - 1], index);
    titles.push({
      id: `${tier.id}-${String(index + 1).padStart(2, '0')}`,
      name: TITLE_NAMES[tier.id][index],
      tier: tier.id,
      tierLabel: tier.label,
      index,
      denominator
    });
  }
}

const titleById = new Map(titles.map(title => [title.id, title]));
function moveTitleToTier(id, tierId) {
  const title = titleById.get(id);
  const tierIndex = TIERS.findIndex(tier => tier.id === tierId);
  title.tier = tierId;
  title.tierLabel = TIERS[tierIndex].label;
  title.denominator = geometricOdds(RARITY_STARTS[tierIndex - 1], ...RARITY_RATIOS[tierIndex - 1], title.index);
}

// These two outcomes sit in the legendary odds range; exchange their slots with
// two existing titles so every rarity continues to contain exactly 20 titles.
moveTitleToTier('unique-08', 'legendary');
moveTitleToTier('unique-20', 'legendary');
moveTitleToTier('legendary-08', 'unique');
moveTitleToTier('legendary-20', 'unique');

// This named result anchors the example shown in the design: at +100% passive luck,
// a 1-in-750-million outcome becomes exactly twice as likely.
titleById.get('legendary-12').denominator = 750_000_000n;
titleById.get('unique-08').denominator = 278_000_000n;
titleById.get('unique-20').denominator = 777_777_777n;

const basicTitles = titles.filter(title => title.tier === 'basic');
const rareTitles = titles.filter(title => title.tier !== 'basic');
for (const title of rareTitles) title.baseWeight = POOL / title.denominator;
const rarePoolWeight = rareTitles.reduce((sum, title) => sum + title.baseWeight, 0n);
const basicRemainder = POOL - rarePoolWeight - POOL / 2n;
basicTitles[0].baseWeight = POOL / 2n;
let assignedBasicRemainder = 0n;
for (let index = 1; index < basicTitles.length; index++) {
  const weight = index === basicTitles.length - 1
    ? basicRemainder - assignedBasicRemainder
    : basicRemainder * BASIC_ODDS_SHAPES[index - 1] / BASIC_ODDS_SHAPE_TOTAL;
  basicTitles[index].baseWeight = weight;
  assignedBasicRemainder += weight;
}

const basePoolWeight = titles.reduce((sum, title) => sum + title.baseWeight, 0n);

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
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
      rolledAt: nonNegativeInteger(discovery.rolledAt),
      eventName: String(discovery.eventName || '').slice(0, 60),
      eventMultiplier: Math.max(1, Math.min(5, nonNegativeInteger(discovery.eventMultiplier, 1))),
      eventFocusTierLabel: String(discovery.eventFocusTierLabel || '').slice(0, 40),
      eventFocusMultiplier: Math.max(1, Math.min(3, nonNegativeInteger(discovery.eventFocusMultiplier, 1)))
    }))
    .slice(0, titles.length);
  const recentDiscoveries = titleHistory.slice(0, 8);
  return {
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
    sinceSingular: value.sinceSingular === null || value.sinceSingular === undefined ? null : nonNegativeInteger(value.sinceSingular),
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
    eventsParticipated: nonNegativeInteger(value.eventsParticipated),
    participation: typeof value.participation === 'string' ? value.participation.slice(0, 48) : null,
    eventRollProgress: {
      windowId: typeof value.eventRollProgress?.windowId === 'string' ? value.eventRollProgress.windowId.slice(0, 48) : '',
      rolls: nonNegativeInteger(value.eventRollProgress?.rolls)
    }
  };
}

function categoryBonusBps(value = {}, tierId) {
  const state = normalizeState(value);
  const collected = titles.reduce((count, title) => count + (title.tier === tierId && state.collectedIds.includes(title.id) ? 1 : 0), 0);
  return CATEGORY_MILESTONES.reduce((bonus, milestone) => collected >= milestone.count ? milestone.bonusBps : bonus, 0);
}

function luckForState(value = {}) {
  const state = normalizeState(value);
  const passiveBps = Math.min(10_000, Math.floor(state.collectedIds.length / 2) * 100 + categoryBonusBps(state, 'basic'));
  const collected = state.collectedIds.length;
  const rollMilestone = ROLL_MILESTONES.filter(item => collected >= item.count).at(-1);
  const bonusMilestone = BONUS_MILESTONES.filter(item => collected >= item.count).at(-1);
  return {
    passiveBps,
    totalBps: 10_000 + passiveBps,
    rollsPerCycle: rollMilestone?.rollsPerCycle || 1,
    bonusMultiplier: bonusMilestone?.multiplier || 2,
    bonusRollEvery: 10,
    nextRollMilestone: ROLL_MILESTONES.find(item => collected < item.count) || null,
    nextBonusMilestone: BONUS_MILESTONES.find(item => collected < item.count) || null
  };
}

function currentWeights(value = {}, { bonusRoll = false, equalHourBonus = false, thousandRollBonus = false, tenThousandRollBonus = false, eventMultiplier = 1, focusTierId = '', focusMultiplier = 1 } = {}) {
  const state = normalizeState(value);
  const { totalBps, bonusMultiplier } = luckForState(state);
  const activeLuckBps = totalBps * (bonusRoll ? bonusMultiplier : 1) * (equalHourBonus ? 2 : 1) * (thousandRollBonus ? THOUSAND_ROLL_BONUS_MULTIPLIER : 1) * (tenThousandRollBonus ? TEN_THOUSAND_ROLL_BONUS_MULTIPLIER : 1);
  const tierBonuses = new Map(TIERS.map(tier => [tier.id, categoryBonusBps(state, tier.id)]));
  const weights = new Map();
  let boostedRareTotal = 0n;
  for (const title of rareTitles) {
    const categoryBonus = tierBonuses.get(title.tier) || 0;
    const categoryMultiplierBps = 10_000 + categoryBonus;
    const weight = title.baseWeight * BigInt(activeLuckBps) * BigInt(categoryMultiplierBps) / 100_000_000n;
    weights.set(title.id, weight);
    boostedRareTotal += weight;
  }
  const baselineRareTotal = boostedRareTotal;
  const globalEventMultiplier = Math.max(1, Math.min(5, nonNegativeInteger(eventMultiplier, 1)));
  const rarityFocusMultiplier = Math.max(1, Math.min(3, nonNegativeInteger(focusMultiplier, 1)));
  if (globalEventMultiplier > 1 || (focusTierId && rarityFocusMultiplier > 1)) {
    let eventRareTotal = 0n;
    for (const title of rareTitles) {
      const focused = title.tier === focusTierId ? BigInt(rarityFocusMultiplier) : 1n;
      const eventWeight = weights.get(title.id) * BigInt(globalEventMultiplier) * focused;
      weights.set(title.id, eventWeight);
      eventRareTotal += eventWeight;
    }
    const rareChanceCap = baselineRareTotal > POOL / 2n ? baselineRareTotal : POOL / 2n;
    const cappedTotal = eventRareTotal < rareChanceCap ? eventRareTotal : rareChanceCap;
    for (const title of rareTitles) weights.set(title.id, weights.get(title.id) * cappedTotal / (eventRareTotal || 1n));
    boostedRareTotal = rareTitles.reduce((sum, title) => sum + weights.get(title.id), 0n);
  }
  if (boostedRareTotal > POOL) {
    for (const title of rareTitles) {
      const scaled = weights.get(title.id) * POOL / boostedRareTotal;
      weights.set(title.id, scaled);
    }
    boostedRareTotal = rareTitles.reduce((sum, title) => sum + weights.get(title.id), 0n);
  }
  const remainingBasicWeight = POOL - boostedRareTotal;
  const baseBasicTotal = basicTitles.reduce((sum, title) => sum + title.baseWeight, 0n);
  let assignedBasic = 0n;
  for (let index = 0; index < basicTitles.length; index++) {
    const title = basicTitles[index];
    const weight = index === basicTitles.length - 1
      ? remainingBasicWeight - assignedBasic
      : remainingBasicWeight * title.baseWeight / baseBasicTotal;
    weights.set(title.id, weight);
    assignedBasic += weight;
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

function rollTitle(value = {}, randomValue = secureRandomBelow(POOL), { rolledAt = null, event = null, autoRollSeconds = 0, limitedRewardValue } = {}) {
  const state = normalizeState(value);
  const priorSecrets = new Set(state.unlockedSecrets);
  const priorLimited = new Set(state.limitedTitles);
  const nextRoll = state.bonusRollCounter + 1;
  const bonusRoll = nextRoll >= 10;
  const rollBonusMultiplier = bonusRoll ? luckForState(state).bonusMultiplier : 1;
  const thousandRollBonus = (state.totalRolls + 1) % THOUSAND_ROLL_BONUS_EVERY === 0;
  const tenThousandRollBonus = (state.totalRolls + 1) % TEN_THOUSAND_ROLL_BONUS_EVERY === 0;
  const equalHourBonus = equalHourBonusAt(rolledAt);
  const eventMultiplier = event?.multiplier || 1;
  const eventFocusTierId = event?.focusTierId || '';
  const eventFocusTierLabel = event?.focusTierLabel || '';
  const eventFocusMultiplier = event?.focusMultiplier || 1;
  const weights = currentWeights(state, { bonusRoll, equalHourBonus: equalHourBonus.active, thousandRollBonus, tenThousandRollBonus, eventMultiplier, focusTierId: eventFocusTierId, focusMultiplier: eventFocusMultiplier });
  const roll = BigInt(randomValue);
  if (roll < 0n || roll >= POOL) throw new RangeError('O valor de sorteio está fora da distribuição.');
  let cumulative = 0n;
  let selected = titles[titles.length - 1];
  for (const title of titles) {
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
  const appliedFocusMultiplier = selected.tier === eventFocusTierId ? eventFocusMultiplier : 1;
  const multiplier = rollBonusMultiplier * equalHourBonus.multiplier * (thousandRollBonus ? 4 : 1) * (tenThousandRollBonus ? 10 : 1) * eventMultiplier * appliedFocusMultiplier;
  state.trackedRolls++;
  state.tierRolls[selected.tier]++;
  if (!isNew) state.duplicateRolls++;
  state.luckMultiplierSum += multiplier;
  state.luckBpsSum += luckForState(value).totalBps * multiplier;
  state.luckBpsSamples++;
  state.maxMultiplier = Math.max(state.maxMultiplier, multiplier);
  state.sinceSingular = TIERS.findIndex(tier => tier.id === selected.tier) >= 2 ? 0 : state.sinceSingular === null ? null : state.sinceSingular + 1;
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
  if (event?.eventId === 'fragments' && event.reward?.rollGoal) {
    if (state.eventRollProgress.windowId !== event.id) state.eventRollProgress = { windowId: event.id, rolls: 0 };
    state.eventRollProgress.rolls = Math.min(event.reward.rollGoal, state.eventRollProgress.rolls + 1);
    if (state.eventRollProgress.rolls >= event.reward.rollGoal && !state.limitedTitles.includes(event.reward.titleId)) state.limitedTitles.push(event.reward.titleId);
  } else if (event?.reward?.odds && !state.limitedTitles.includes(event.reward.titleId) && BigInt(limitedRewardValue === undefined ? secureRandomBelow(BigInt(event.reward.odds)) : limitedRewardValue) === 0n) {
    state.limitedTitles.push(event.reward.titleId);
  }
  const specialUnlocks = [
    ...SECRETS.filter(secret => !priorSecrets.has(secret.id) && state.unlockedSecrets.includes(secret.id)).map(secret => ({ id: secret.id, name: secret.name, tierLabel: 'Segredo' })),
    ...LIMITED_REWARDS.filter(reward => !priorLimited.has(reward.titleId) && state.limitedTitles.includes(reward.titleId)).map(reward => ({ id: reward.titleId, name: reward.name, tierLabel: 'Limitado' }))
  ];
  if (isNew) {
    const discovery = {
      titleId: selected.id,
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
      rolledAt: Number.isFinite(rolledAt) ? rolledAt : 0,
      eventName: event?.name || '',
      eventMultiplier,
      eventFocusTierLabel,
      eventFocusMultiplier: appliedFocusMultiplier
    };
    state.titleHistory = [discovery, ...state.titleHistory.filter(item => item.titleId !== selected.id)].slice(0, titles.length);
    state.recentDiscoveries = state.titleHistory.slice(0, 8);
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
    rolledAt: Number.isFinite(rolledAt) ? rolledAt : 0,
    eventName: event?.name || '',
    eventMultiplier,
    eventFocusTierLabel,
    eventFocusMultiplier: appliedFocusMultiplier,
    specialUnlocks
  };
}

function rollBatch(value = {}, randomValues, { rolledAt = null, event = null, autoRollSeconds = 0, limitedRewardValue } = {}) {
  const startingState = normalizeState(value);
  const rollsPerCycle = luckForState(startingState).rollsPerCycle;
  let state = startingState;
  const results = [];
  for (let index = 0; index < rollsPerCycle; index++) {
    const outcome = rollTitle(state, Array.isArray(randomValues) ? randomValues[index] : undefined, { rolledAt, event, autoRollSeconds, limitedRewardValue });
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
      rolledAt: outcome.rolledAt,
      eventName: outcome.eventName,
      eventMultiplier: outcome.eventMultiplier,
      eventFocusTierLabel: outcome.eventFocusTierLabel,
      eventFocusMultiplier: outcome.eventFocusMultiplier,
      specialUnlocks: outcome.specialUnlocks
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

function publicCatalog(value = {}) {
  const state = normalizeState(value);
  const odds = currentWeights(state);
  const collected = new Set(state.collectedIds);
  return titles.map(title => ({
    id: title.id,
    name: collected.has(title.id) ? title.name : '???',
    tier: title.tier,
    tierLabel: title.tierLabel,
    baseOdds: oddsLabel(title.baseWeight),
    currentOdds: oddsLabel(odds.get(title.id)),
    collected: collected.has(title.id),
    categoryBonusBps: categoryBonusBps(state, title.tier)
  }));
}

function publicProgress(value = {}) {
  const state = normalizeState(value);
  const collected = new Set(state.collectedIds);
  const tierProgress = TIERS.map(tier => {
    const count = titles.reduce((total, title) => total + (title.tier === tier.id && collected.has(title.id) ? 1 : 0), 0);
    const achieved = CATEGORY_MILESTONES.filter(milestone => count >= milestone.count).map(milestone => milestone.count);
    const next = CATEGORY_MILESTONES.find(milestone => count < milestone.count) || null;
    return { id: tier.id, label: tier.label, count, total: 20, bonusBps: categoryBonusBps(state, tier.id), achieved, nextCount: next?.count || null, nextBonusBps: next?.bonusBps || null };
  });
  const luck = luckForState(state);
  return {
    categoryMilestones: CATEGORY_MILESTONES.map(item => ({ ...item })),
    bonusRollCounter: state.bonusRollCounter,
    rollMilestones: ROLL_MILESTONES.map(item => ({ ...item })),
    bonusMilestones: BONUS_MILESTONES.map(item => ({ ...item })),
    rollsPerCycle: luck.rollsPerCycle,
    bonusMultiplier: luck.bonusMultiplier,
    nextRollMilestone: luck.nextRollMilestone,
    nextBonusMilestone: luck.nextBonusMilestone,
    tierProgress,
  };
}

function debugGrantTierTitles(value = {}, tierId, count = 5) {
  if (!CATEGORY_TIER_IDS.has(tierId)) throw new RangeError('A raridade escolhida não existe.');
  const state = normalizeState(value);
  const target = Math.max(0, Math.min(20, nonNegativeInteger(count)));
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
  THOUSAND_ROLL_BONUS_EVERY,
  THOUSAND_ROLL_BONUS_MULTIPLIER,
  TEN_THOUSAND_ROLL_BONUS_EVERY,
  TEN_THOUSAND_ROLL_BONUS_MULTIPLIER,
  TIERS,
  CATEGORY_MILESTONES,
  ROLL_MILESTONES,
  BONUS_MILESTONES,
  TITLES: titles,
  SECRETS,
  basePoolWeight,
  equalHourBonusAt,
  normalizeState,
  luckForState,
  currentWeights,
  rollTitle,
  rollBatch,
  publicCatalog,
  publicProgress,
  oddsLabel,
  debugGrantTitle,
  debugRemoveTitle,
  debugClearTitles,
  debugGrantTierTitles,
  debugGrantTotalTitles,
  debugReadyBonusRoll
};
