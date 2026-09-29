/* Shared, local cryptographic random primitives for Sorteios & Jogos. */
((root, factory) => {
  const cryptoProvider = root.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
  const api = factory(cryptoProvider);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCRandomCore = api;
})(globalThis, cryptoProviderFactory);

function cryptoProviderFactory(provider) {
  if (!provider?.getRandomValues) throw new Error('Fonte criptográfica aleatória indisponível.');
  function below(bound) {
    const limit = BigInt(bound);
    if (limit <= 0n) throw new RangeError('O limite aleatório precisa ser positivo.');
    const bits = limit.toString(2).length;
    const words = new Uint32Array(Math.ceil(bits / 32));
    const mask = (1n << BigInt(bits)) - 1n;
    for (;;) {
      provider.getRandomValues(words);
      let value = 0n;
      for (const word of words) value = (value << 32n) | BigInt(word);
      value &= mask;
      if (value < limit) return value;
    }
  }
  function randomInteger(min, max) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new RangeError('Informe limites inteiros válidos.');
    const width = BigInt(max) - BigInt(min) + 1n;
    return Number(BigInt(min) + below(width));
  }
  function randomChoice(items) {
    if (!Array.isArray(items) || !items.length) throw new RangeError('A lista está vazia.');
    return items[randomInteger(0, items.length - 1)];
  }
  function randomCharacter(characters) {
    const points = Array.from(String(characters ?? ''));
    if (!points.length) throw new RangeError('Informe pelo menos um caractere.');
    return points[randomInteger(0, points.length - 1)];
  }
  function shuffle(items) {
    const result = Array.from(items || []);
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomInteger(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function sampleWithoutReplacement(items, count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > items.length) throw new RangeError('A quantidade excede os itens disponíveis sem repetição.');
    const result = Array.from(items || []);
    for (let i = 0; i < count; i++) {
      const j = randomInteger(i, result.length - 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result.slice(0, count);
  }
  function removeOccurrences(items, selected) {
    if (!Array.isArray(items) || !Array.isArray(selected)) throw new TypeError('As listas precisam ser vetores.');
    const counts = new Map();
    for (const item of selected) counts.set(item, (counts.get(item) || 0) + 1);
    return items.filter(item => {
      const count = counts.get(item) || 0;
      if (!count) return true;
      if (count === 1) counts.delete(item); else counts.set(item, count - 1);
      return false;
    });
  }
  function sampleIntegerRange(min, max, count) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new RangeError('Informe uma faixa inteira válida.');
    const size = max - min + 1;
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(count) || count < 0 || count > size || count > 100000) throw new RangeError('Quantidade inválida para esta faixa sem repetição.');
    const swaps = new Map(); const result = [];
    for (let i = 0; i < count; i++) {
      const remaining = size - i; const pick = randomInteger(0, remaining - 1);
      const value = swaps.has(pick) ? swaps.get(pick) : pick;
      const last = remaining - 1;
      swaps.set(pick, swaps.has(last) ? swaps.get(last) : last);
      result.push(min + value);
    }
    return result;
  }
  function weightedChoice(options) {
    if (!Array.isArray(options) || !options.length) throw new RangeError('Adicione opções à roleta.');
    const weights = options.map(option => {
      const weight = Number(option.weight ?? 1);
      if (!Number.isSafeInteger(weight) || weight <= 0) throw new RangeError('Os pesos devem ser inteiros positivos.');
      return weight;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!Number.isSafeInteger(total)) throw new RangeError('A soma dos pesos é muito grande.');
    let ticket = randomInteger(1, total);
    for (let i = 0; i < options.length; i++) { ticket -= weights[i]; if (ticket <= 0) return options[i]; }
    throw new Error('Não foi possível resolver a opção sorteada.');
  }
  function rollDice(expression) {
    const match = String(expression || '').trim().match(/^(\d*)\s*d\s*(\d+)(?:\s*([+-])\s*(\d+))?$/i);
    if (!match) throw new Error('Use uma expressão como 2d6+3.');
    const count = Number(match[1] || 1), sides = Number(match[2]);
    const modifier = match[4] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0;
    if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new RangeError('Use de 1 a 10.000 dados.');
    if (!Number.isSafeInteger(sides) || sides < 2 || sides > 1_000_000_000) throw new RangeError('O dado precisa ter de 2 a 1.000.000.000 lados.');
    if (!Number.isSafeInteger(modifier) || Math.abs(modifier) > 1_000_000_000) throw new RangeError('Modificador fora do limite.');
    const values = Array.from({ length: count }, () => randomInteger(1, sides));
    const sum = values.reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(sum + modifier)) throw new RangeError('O resultado excede o limite numérico seguro.');
    return { expression: `${count}d${sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`, values, sum, modifier, total: sum + modifier };
  }
  function createDeck(jokers = false) {
    const deck = [];
    for (const suit of ['♠', '♥', '♦', '♣']) for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) deck.push({ rank, suit, id: `${rank}${suit}`, red: suit === '♥' || suit === '♦' });
    if (jokers) deck.push({ rank: 'Coringa', suit: '★', id: 'JOKER-1', red: false }, { rank: 'Coringa', suit: '★', id: 'JOKER-2', red: false });
    return deck;
  }
  function createTeams(participants, teamCount) {
    if (!Array.isArray(participants) || !participants.length) throw new RangeError('Adicione pelo menos uma pessoa.');
    if (!Number.isSafeInteger(teamCount) || teamCount < 1 || teamCount > 1000) throw new RangeError('A quantidade de equipes precisa ficar entre 1 e 1.000.');
    const teams = Array.from({ length: teamCount }, () => []);
    const teamOrder = shuffle(Array.from({ length: teamCount }, (_, index) => index));
    shuffle(participants).forEach((person, index) => teams[teamOrder[index % teamCount]].push(person));
    return teams;
  }
  function parseList(text, { dedupe = false, max = 10000 } = {}) {
    const items = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (items.length > max) throw new RangeError(`A lista pode ter no máximo ${max.toLocaleString('pt-BR')} itens.`);
    return dedupe ? [...new Set(items)] : items;
  }
  function parseDiceSides(value) {
    const sides = Number(value);
    if (!Number.isSafeInteger(sides) || sides < 2 || sides > 1_000_000_000) throw new RangeError('O dado precisa ter de 2 a 1.000.000.000 lados.');
    return sides;
  }
  function rpsResult(player, computer, mode = 'classic') {
    const moves = mode === 'expanded' ? ['pedra', 'papel', 'tesoura', 'lagarto', 'spock'] : ['pedra', 'papel', 'tesoura'];
    if (!moves.includes(player)) throw new RangeError('Escolha uma jogada válida.');
    const defeats = { pedra: ['tesoura', 'lagarto'], papel: ['pedra', 'spock'], tesoura: ['papel', 'lagarto'], lagarto: ['papel', 'spock'], spock: ['pedra', 'tesoura'] };
    return player === computer ? 'empate' : defeats[player].includes(computer) ? 'vitória' : 'derrota';
  }
  function resolveRpsMode(move, selectedMode = 'classic') {
    return move === 'lagarto' || move === 'spock' || selectedMode === 'expanded' ? 'expanded' : 'classic';
  }
  function resolveHigherLowerRound(current, streak, direction, next) {
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(next) || !Number.isSafeInteger(streak) || streak < 0 || !['higher', 'lower'].includes(direction)) throw new RangeError('Rodada de maior ou menor inválida.');
    const correct = direction === 'higher' ? next > current : next < current;
    return { correct, current: next, streak: correct ? streak + 1 : 0, endedStreak: correct ? null : streak, over: !correct, message: correct ? `Acertou: ${next}. Continue!` : `Não foi dessa vez: ${next}. Sequência final ${streak}.` };
  }
  return Object.freeze({ randomInteger, randomChoice, randomCharacter, shuffle, sampleWithoutReplacement, removeOccurrences, sampleIntegerRange, weightedChoice, rollDice, createDeck, createTeams, parseList, parseDiceSides, rpsResult, resolveRpsMode, resolveHigherLowerRound });
}
