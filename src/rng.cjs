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
const RNG_RELIC_DROUGHT_PROGRESS_VERSION = 2;
const RNG_MANUAL_TIME_ACHIEVEMENT_SECONDS = 100 * 60 * 60;
const RNG_AUTO_TIME_ACHIEVEMENT_SECONDS = 1_000 * 60 * 60;
const RNG_RARE_RELIC_DROP_DENOMINATOR = 1_000n;
const RANDOM_RELIC_MIN_ROLLS = 8_000;
const RANDOM_RELIC_MAX_ROLLS = 12_000;

const RELICS = Object.freeze([
  { id: 'solar-clock', setId: 'celestial', name: 'Relógio Solar', icon: '☀', effect: 'Sorte ×1,12 entre 06h e 18h.', source: 'shop', luckMultiplierBps: 11_200 },
  { id: 'lunar-clock', setId: 'celestial', name: 'Relógio Lunar', icon: '☾', effect: 'Sorte ×1,12 entre 18h e 06h.', source: 'shop', luckMultiplierBps: 11_200 },
  { id: 'astrolabe', setId: 'celestial', name: 'Astrolábio', icon: '✧', effect: 'Sorte ×1,10 o tempo todo.', source: 'shop', luckMultiplierBps: 11_000 },
  { id: 'twin-core', setId: 'echoes', name: 'Núcleo Gêmeo', icon: '◈', effect: 'Dobra os resultados de cada ação.', source: 'random-drop', rare: true, resultMultiplier: 2 },
  { id: 'echo-spring', setId: 'echoes', name: 'Mola de Eco', icon: '↟', effect: 'Concede +1 resultado a cada 100 resultados.', source: 'shop', resultBonusEvery: 100, resultBonus: 1 },
  { id: 'fragment-pouch', setId: 'echoes', name: 'Bolsa de Fragmentos', icon: '◆', effect: 'Fragmentos recebidos ×1,25.', source: 'shop', fragmentMultiplierBps: 12_500 },
  { id: 'lucky-feather', name: 'Pena do Acaso', icon: '❧', effect: 'Sorte ×1,05 o tempo todo.', source: 'random-drop', luckMultiplierBps: 10_500 },
  { id: 'loose-gear', name: 'Engrenagem Solta', icon: '⚙', effect: '+1 resultado a cada 500 rolagens.', source: 'random-drop', resultBonusEvery: 500, resultBonus: 1 },
  { id: 'torn-pouch', name: 'Bolsa Remendada', icon: '▱', effect: 'Fragmentos recebidos ×1,10.', source: 'random-drop', fragmentMultiplierBps: 11_000 },
  { id: 'rain-comet', name: 'Cometa de Fragmentos', icon: '☄', effect: 'Fragmentos recebidos ×1,20.', source: 'event', eventId: 'fragments', fragmentMultiplierBps: 12_000 },
  { id: 'new-moon-seal', name: 'Selo da Lua Nova', icon: '◐', effect: 'Sorte ×1,10 o tempo todo.', source: 'event', eventId: 'fragments', luckMultiplierBps: 11_000 },
  { id: 'eclipse-prism', name: 'Prisma do Eclipse', icon: '◉', effect: 'Sorte ×1,25 o tempo todo.', source: 'event', eventId: 'eclipse', luckMultiplierBps: 12_500 },
  { id: 'cartographers-medal', name: 'Medalha do Cartógrafo', icon: '⌖', effect: '+1 resultado em cada ação.', source: 'achievement', achievementId: 'unique-50', achievementGoal: 50, flatResults: 1 },
  { id: 'atlas-of-possibilities', name: 'Atlas das Possibilidades', icon: '▤', effect: 'Sorte ×1,50 o tempo todo.', source: 'achievement', achievementId: 'unique-200', achievementGoal: 200, luckMultiplierBps: 15_000 },
  { id: 'misfortune-mark', setId: 'misfortune', name: 'Marca do Azar', icon: '♠', effect: 'Sorte ×1,25.', source: 'drought', droughtGoal: 15_000, luckMultiplierBps: 12_500 },
  { id: 'cracked-die', setId: 'misfortune', name: 'Dado Trincado', icon: '⚄', effect: '+1 resultado em cada ação.', source: 'drought', droughtGoal: 25_000, flatResults: 1 },
  { id: 'drought-heart', setId: 'misfortune', name: 'Coração da Seca', icon: '♥', effect: 'Fragmentos recebidos ×1,25.', source: 'drought', droughtGoal: 40_000, fragmentMultiplierBps: 12_500 }
]);
const RELIC_SETS = Object.freeze([
  { id: 'celestial', name: 'Relógios Celestes', effect: 'Solar e Lunar permanecem ativos durante todo o dia.' },
  { id: 'echoes', name: 'Ecos', effect: 'Dobra novamente os resultados de cada ação.' },
  { id: 'misfortune', name: 'Tríade do Azar', effect: 'A cada 1.000 rolls secos, a sorte dobra; a cada 5.000, +1 resultado por ação.' }
]);
const relicById = new Map(RELICS.map(relic => [relic.id, relic]));
const PURCHASABLE_RELIC_IDS = RELICS.filter(relic => relic.source === 'shop').map(relic => relic.id);
const RANDOM_RELIC_IDS = RELICS.filter(relic => relic.source === 'random-drop').map(relic => relic.id);
const COMMON_RANDOM_RELIC_IDS = RANDOM_RELIC_IDS.filter(id => !relicById.get(id).rare);
const EVENT_RELIC_IDS_BY_EVENT = new Map(['fragments', 'eclipse'].map(eventId => [eventId, RELICS.filter(relic => relic.source === 'event' && relic.eventId === eventId).map(relic => relic.id)]));
const ACHIEVEMENT_RELICS = RELICS.filter(relic => relic.source === 'achievement');
const DROUGHT_RELIC_IDS = RELICS.filter(relic => relic.source === 'drought').map(relic => relic.id);
const DROUGHT_RELIC_GOALS = RELICS.filter(relic => relic.source === 'drought').map(relic => relic.droughtGoal);
const relicShopPrice = relicId => RNG_RELIC_SHOP_PRICES[relicId] ?? RNG_RELIC_COST;

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
const ACHIEVEMENT_LUCK_REWARDS = Object.freeze({
  ...Object.fromEntries(Object.entries({ epic: 100, unique: 200, legendary: 500, mythic: 1_000, exalted: 2_000, glorious: 4_000, transcendent: 7_500, dimensional: 15_000, ntc: 50_000 }).map(([tierId, bonusBps]) => [`tier-${tierId}`, bonusBps])),
  'rolls-100000': 100,
  'rolls-1000000': 100,
  'rolls-5000000': 150,
  'rolls-10000000': 200,
  'manual-rolls-1000000': 150,
  'unique-200': 100,
  'streak-repeat-7': 50,
  'drought-10000': 50,
  'multiplier-100': 50,
  'events-10': 50,
  'limited-title': 50,
  'time-manual-100h': 500,
  'time-auto-1000h': 2_500
});
const CATEGORY_TIER_IDS = new Set(TIERS.map(tier => tier.id));
const BASIC_ODDS_SHAPES = [35n, 32n, 30n, 28n, 26n, 24n, 22n, 20n, 19n, 18n, 17n, 16n, 15n, 14n, 13n, 12n, 11n, 10n, 8n];
const BASIC_ODDS_SHAPE_TOTAL = BASIC_ODDS_SHAPES.reduce((sum, weight) => sum + weight, 0n);
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

function nonNegativeBigIntString(value, fallback = '0') {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : fallback;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : fallback;
  return /^\d+$/.test(String(value ?? '')) ? String(value) : fallback;
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
      activeEffects.push(`${relic.name} · +${relic.resultBonus} a cada ${new Intl.NumberFormat('pt-BR').format(relic.resultBonusEvery)} rolls`);
    }
  }
  const droughtSteps = completeSets.has('misfortune') ? Math.floor((state.sinceSingular || 0) / 1_000) : 0;
  if (droughtSteps > 0) { luckMultiplierBps *= 2n ** BigInt(droughtSteps); activeEffects.push(`Tríade do Azar ×2^${droughtSteps}`); }
  if (completeSets.has('echoes')) { resultMultiplier *= 2; activeEffects.push('Set Ecos · resultados ×2'); }
  const droughtExtraResults = completeSets.has('misfortune') ? Math.floor((state.sinceSingular || 0) / 5_000) : 0;
  if (droughtExtraResults > 0) { flatResults += droughtExtraResults; activeEffects.push(`Tríade do Azar · +${droughtExtraResults} resultados por ação`); }
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
  const inferredDroughtStage = DROUGHT_RELIC_IDS.findIndex(id => !ownedRelicIds.includes(id));
  const minimumDroughtStage = inferredDroughtStage === -1 ? DROUGHT_RELIC_IDS.length : inferredDroughtStage;
  const savedDroughtStage = Math.min(DROUGHT_RELIC_IDS.length, nonNegativeInteger(value.droughtRelicStage));
  const droughtRelicStage = Math.max(minimumDroughtStage, savedDroughtStage);
  const isDroughtRelicProgressCurrent = nonNegativeInteger(value.droughtRelicProgressVersion) >= RNG_RELIC_DROUGHT_PROGRESS_VERSION;
  const migratedDroughtProgress = isDroughtRelicProgressCurrent ? nonNegativeInteger(value.droughtRelicProgress) : 0;
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
    droughtRelicStage,
    droughtRelicProgressVersion: RNG_RELIC_DROUGHT_PROGRESS_VERSION,
    droughtRelicProgress: droughtRelicStage >= DROUGHT_RELIC_IDS.length ? 0 : migratedDroughtProgress,
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

function migrateDroughtRelicProgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (nonNegativeInteger(value.droughtRelicProgressVersion) >= RNG_RELIC_DROUGHT_PROGRESS_VERSION) return value;
  const droughtRelicIds = new Set(DROUGHT_RELIC_IDS);
  return {
    ...value,
    ownedRelicIds: (Array.isArray(value.ownedRelicIds) ? value.ownedRelicIds : []).filter(id => !droughtRelicIds.has(id)),
    equippedRelicIds: (Array.isArray(value.equippedRelicIds) ? value.equippedRelicIds : []).filter(id => !droughtRelicIds.has(id)),
    droughtRelicStage: 0,
    droughtRelicProgress: 0,
    droughtRelicProgressVersion: RNG_RELIC_DROUGHT_PROGRESS_VERSION
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

function luckForState(value = {}, options = {}) {
  const state = normalizeState(value);
  const passiveBps = Math.min(10_000, Math.floor(state.collectedIds.length / 2) * 100 + categoryBonusBps(state, 'basic'));
  const achievementBonusBps = unlockedAchievementLuckBps(state);
  const secretBonusBps = unlockedSecretLuckBps(state);
  const permanentLuckBps = state.permanentUpgradeLevels * RNG_UPGRADE_LUCK_BPS;
  const collected = state.collectedIds.length;
  const rollMilestone = ROLL_MILESTONES.filter(item => collected >= item.count).at(-1);
  const bonusMilestone = BONUS_MILESTONES.filter(item => collected >= item.count).at(-1);
  const relics = relicEffects(state, options);
  const baseTotalBps = 10_000 + passiveBps + achievementBonusBps + secretBonusBps + permanentLuckBps;
  const exactTotalBps = BigInt(baseTotalBps) * relics.luckMultiplierBps / 10_000n;
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

function currentWeights(value = {}, { bonusRoll = false, equalHourBonus = false, thousandRollBonus = false, tenThousandRollBonus = false, eventMultiplier = 1, focusTierId = '', focusMultiplier = 1, consumableMultiplier = 1, localHour } = {}) {
  const state = normalizeState(value);
  const luck = luckForState(state, { localHour });
  const relics = relicEffects(state, { localHour });
  const activeLuckBps = BigInt(luck.baseTotalBps) * relics.luckMultiplierBps / 10_000n
    * BigInt(bonusRoll ? luck.bonusMultiplier : 1)
    * BigInt(equalHourBonus ? 2 : 1)
    * BigInt(thousandRollBonus ? THOUSAND_ROLL_BONUS_MULTIPLIER : 1)
    * BigInt(tenThousandRollBonus ? TEN_THOUSAND_ROLL_BONUS_MULTIPLIER : 1)
    * BigInt([2, 4].includes(consumableMultiplier) ? consumableMultiplier : 1);
  const tierBonuses = new Map(TIERS.map(tier => [tier.id, categoryBonusBps(state, tier.id)]));
  const weights = new Map();
  let boostedRareTotal = 0n;
  for (const title of rareTitles) {
    const categoryBonus = tierBonuses.get(title.tier) || 0;
    const categoryMultiplierBps = 10_000 + categoryBonus;
    const weight = title.baseWeight * activeLuckBps * BigInt(categoryMultiplierBps) / 100_000_000n;
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
  const maximumRareWeight = POOL - BigInt(basicTitles.length);
  if (boostedRareTotal > maximumRareWeight) {
    const scaled = allocatePositiveWeights(rareTitles, maximumRareWeight, title => weights.get(title.id));
    for (const title of rareTitles) weights.set(title.id, scaled.get(title.id));
    boostedRareTotal = rareTitles.reduce((sum, title) => sum + weights.get(title.id), 0n);
  }
  const remainingBasicWeight = POOL - boostedRareTotal;
  const basicWeights = allocatePositiveWeights(basicTitles, remainingBasicWeight, title => title.baseWeight);
  for (const title of basicTitles) weights.set(title.id, basicWeights.get(title.id));
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
  state.droughtRelicProgress = singularPlus || state.droughtRelicStage >= DROUGHT_RELIC_IDS.length ? 0 : state.droughtRelicProgress + 1;
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
  if (state.droughtRelicStage < DROUGHT_RELIC_IDS.length && state.droughtRelicProgress >= DROUGHT_RELIC_GOALS[state.droughtRelicStage]) {
    const relicId = DROUGHT_RELIC_IDS[state.droughtRelicStage];
    relicUnlocks.push(grantRelic(state, relicId, 'drought'));
    state.droughtRelicStage += 1;
    state.droughtRelicProgress = 0;
  }
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
  const boostedFragmentReward = baseFragmentReward * BigInt(relicsBeforeRoll.fragmentMultiplierBps) / 10_000n;
  const duplicateRelicReward = relicUnlocks.reduce((sum, unlock) => sum + BigInt(unlock.fragmentReward || 0), 0n);
  const fragmentReward = boostedFragmentReward + duplicateRelicReward;
  state.fragmentBalance = (BigInt(state.fragmentBalance) + fragmentReward).toString();
  const specialUnlocks = [
    ...SECRETS.filter(secret => !priorSecrets.has(secret.id) && state.unlockedSecrets.includes(secret.id)).map(secret => ({ id: secret.id, name: secret.name, tierLabel: 'Segredo', luckBonusBps: secret.luckBonusBps || 0 })),
    ...newlyLimited.map(reward => ({ id: reward.titleId, name: reward.name, tierLabel: 'Limitado', fragmentReward: Number(LIMITED_TITLE_FRAGMENT_REWARD) })),
    ...relicUnlocks
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
    baseOdds: oddsLabel(title.baseWeight),
    currentOdds: oddsLabel(odds.get(title.id)),
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
    return { id: tier.id, label: tier.label, count, total: 20, bonusBps: categoryBonusBps(state, tier.id), achieved, nextCount: next?.count || null, nextBonusBps: next?.bonusBps || null };
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
  RNG_RELIC_DROUGHT_PROGRESS_VERSION,
  RNG_MANUAL_TIME_ACHIEVEMENT_SECONDS,
  RNG_AUTO_TIME_ACHIEVEMENT_SECONDS,
  RANDOM_RELIC_MIN_ROLLS,
  RANDOM_RELIC_MAX_ROLLS,
  TIERS,
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
  migrateDroughtRelicProgress,
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
  publicRelicState,
  oddsLabel,
  debugGrantTitle,
  debugRemoveTitle,
  debugClearTitles,
  debugGrantTierTitles,
  debugGrantTotalTitles,
  debugReadyBonusRoll
};
