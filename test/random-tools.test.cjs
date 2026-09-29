const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/random-core.js');
const stateApi = require('../src/random-tools-state.js');

test('random integer stays in inclusive bounds, including signed and large safe ranges', () => {
  for (const [min, max] of [[1, 6], [-8, 8], [0, Number.MAX_SAFE_INTEGER]]) {
    for (let i = 0; i < 250; i++) {
      const value = core.randomInteger(min, max);
      assert.ok(Number.isSafeInteger(value));
      assert.ok(value >= min && value <= max);
    }
  }
  assert.throws(() => core.randomInteger(1.2, 6), /limites inteiros/);
  assert.throws(() => core.randomInteger(2, 1), /limites inteiros/);
});

test('random character generation samples Unicode code points and rejects an empty alphabet', () => {
  const alphabet = ['A', 'é', '🎲'];
  for (let i = 0; i < 100; i++) assert.ok(alphabet.includes(core.randomCharacter(alphabet.join(''))));
  assert.throws(() => core.randomCharacter(''), /caractere/);
});

test('higher/lower ends and resets the live streak after a wrong or equal guess', () => {
  const wrong = core.resolveHigherLowerRound(11, 12, 'higher', 7);
  assert.equal(wrong.correct, false); assert.equal(wrong.streak, 0); assert.equal(wrong.endedStreak, 12); assert.equal(wrong.over, true);
  const equal = core.resolveHigherLowerRound(11, 3, 'lower', 11);
  assert.equal(equal.correct, false); assert.equal(equal.streak, 0); assert.equal(equal.over, true);
  const correct = core.resolveHigherLowerRound(11, 3, 'lower', 5);
  assert.equal(correct.correct, true); assert.equal(correct.streak, 4); assert.equal(correct.over, false);
  assert.throws(() => core.resolveHigherLowerRound(11, 0, 'sideways', 5), /inválida/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  assert.match(ui, /if\(!higherGame\|\|higherGame\.over\)return/);
  const render = ui.slice(ui.indexOf('function renderHigher()'), ui.indexOf('function renderReaction()'));
  assert.ok(render.indexOf("higherGame.over?actionButton('start-higher','Jogar novamente'") < render.indexOf("actionButton('higher-guess'"));
});

test('shuffle preserves every item exactly once and sampling without replacement never duplicates', () => {
  const input = Array.from({ length: 1000 }, (_, i) => `item-${i}`);
  const shuffled = core.shuffle(input);
  assert.notEqual(shuffled, input);
  assert.deepEqual([...shuffled].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))), input);
  assert.deepEqual(input, Array.from({ length: 1000 }, (_, i) => `item-${i}`));
  const picked = core.sampleWithoutReplacement(input, 250);
  assert.equal(picked.length, 250);
  assert.equal(new Set(picked).size, 250);
  assert.ok(picked.every(item => input.includes(item)));
  assert.throws(() => core.sampleWithoutReplacement(input, 1001), /excede/);
  assert.deepEqual(core.removeOccurrences(['Ana', 'Ana', 'Bia'], ['Ana']), ['Ana', 'Bia']);
  assert.deepEqual(core.removeOccurrences(['Ana', 'Ana', 'Bia'], ['Ana', 'Ana']), ['Bia']);
});

test('large integer-range sampling is unique without allocating the whole range', () => {
  const values = core.sampleIntegerRange(-1_000_000_000, 1_000_000_000, 1000);
  assert.equal(new Set(values).size, 1000);
  assert.ok(values.every(value => Number.isSafeInteger(value) && value >= -1_000_000_000 && value <= 1_000_000_000));
});

test('weighted choice validates positive integer weights and returns a configured option', () => {
  const options = [{ label: 'A', weight: 1 }, { label: 'B', weight: 3 }];
  for (let i = 0; i < 200; i++) assert.ok(options.includes(core.weightedChoice(options)));
  for (const weight of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => core.weightedChoice([{ label: 'bad', weight }, { label: 'other', weight: 1 }]), /pesos|soma/);
  assert.throws(() => core.weightedChoice([]), /opções/);
});

test('dice notation safely parses common and custom rolls and rejects malformed expressions without eval', () => {
  for (const [expression, count, sides, modifier] of [['1d6', 1, 6, 0], ['2d6', 2, 6, 0], ['1d20+5', 1, 20, 5], ['4d8-2', 4, 8, -2], ['10d10+15', 10, 10, 15], ['1d37', 1, 37, 0]]) {
    const result = core.rollDice(expression);
    assert.equal(result.values.length, count);
    assert.ok(result.values.every(value => value >= 1 && value <= sides));
    assert.equal(result.modifier, modifier);
    assert.equal(result.total, result.sum + modifier);
  }
  for (const expression of ['0d6', '2d0', 'abc', '2d6++1', '1d6;process.exit()', '10001d6']) assert.throws(() => core.rollDice(expression));
  assert.equal(core.parseDiceSides(37), 37);
  assert.throws(() => core.parseDiceSides(0), /lados/);
});

test('coin, cards and teams keep bounded and complete results', () => {
  for (let i = 0; i < 100; i++) assert.ok(['Cara', 'Coroa'].includes(core.randomChoice(['Cara', 'Coroa'])));
  const deck = core.createDeck(); const jokers = core.createDeck(true);
  assert.equal(deck.length, 52); assert.equal(new Set(deck.map(card => card.id)).size, 52);
  assert.equal(jokers.length, 54); assert.equal(new Set(jokers.map(card => card.id)).size, 54);
  const purchased = core.sampleWithoutReplacement(core.shuffle(deck), deck.length);
  assert.equal(purchased.length, 52); assert.equal(new Set(purchased.map(card => card.id)).size, 52);
  assert.throws(() => core.sampleWithoutReplacement(purchased, 53), /excede/);
  assert.equal(core.sampleWithoutReplacement(purchased, 0).length, 0);
  const people = Array.from({ length: 10 }, (_, i) => `Pessoa ${i + 1}`);
  for (const teamsCount of [2, 3]) {
    const teams = core.createTeams(people, teamsCount);
    assert.equal(teams.flat().length, 10);
    assert.deepEqual([...teams.flat()].sort(), [...people].sort());
    assert.ok(Math.max(...teams.map(team => team.length)) - Math.min(...teams.map(team => team.length)) <= 1);
  }
  const smallerThanTeams = core.createTeams(['Ana', 'Bia', 'Caio'], 5);
  assert.equal(smallerThanTeams.flat().length, 3);
  assert.equal(smallerThanTeams.length, 5);
  const duplicateParticipants = core.createTeams(['Ana', 'Ana', 'Bia'], 2).flat();
  assert.equal(duplicateParticipants.length, 3); assert.equal(duplicateParticipants.filter(name => name === 'Ana').length, 2);
  assert.throws(() => core.createTeams([], 2), /pelo menos uma pessoa/);
  assert.throws(() => core.createTeams(people, 0), /quantidade de equipes/);
});

test('list parsing makes duplicate behavior explicit and rock-paper-scissors modes are valid', () => {
  assert.deepEqual(core.parseList('Ana\nAna\n Bia \n'), ['Ana', 'Ana', 'Bia']);
  assert.deepEqual(core.parseList('Ana\nAna\n Bia \n', { dedupe: true }), ['Ana', 'Bia']);
  assert.throws(() => core.parseList(Array(10002).fill('x').join('\n')), /no máximo/);
  assert.equal(core.rpsResult('pedra', 'tesoura'), 'vitória');
  assert.equal(core.rpsResult('spock', 'lagarto', 'expanded'), 'derrota');
  assert.throws(() => core.rpsResult('spock', 'pedra'), /jogada válida/);
  assert.equal(core.resolveRpsMode('lagarto', 'classic'), 'expanded');
  assert.equal(core.resolveRpsMode('spock', 'classic'), 'expanded');
  assert.equal(core.resolveRpsMode('pedra', 'classic'), 'classic');
  assert.equal(core.resolveRpsMode('pedra', 'expanded'), 'expanded');
});

test('local persistence restores favorites, wheels, shared lists, records and preferences with bounds', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const store = stateApi.createStore(storage, 'ntc-random-tools-v1', ['coin', 'dice', 'wheel', 'teams']);
  const value = store.fresh();
  value.favorites = ['wheel', 'wheel', 'not-real']; value.recent = ['teams', 'dice']; value.skipMotion = true;
  value.coin.heads = 53; value.rps.wins = 4; value.records.reactionBest = 190; value.records.reactionSamples = [190, 230]; value.records.cpsBest = 7.5; value.records.higherBest = 12; value.records.guesses.normal = 6;
  value.wheels = [{ id: 'w1', name: 'Restaurantes', options: [{ label: 'Pizza', weight: 2 }], removeWinner: true }];
  value.lists = [{ id: 'l1', name: 'Amigos', items: ['Ana', 'Bia'] }];
  assert.equal(store.save(value), true);
  const loaded = store.load();
  assert.deepEqual(loaded.favorites, ['wheel']); assert.deepEqual(loaded.recent, ['teams', 'dice']); assert.equal(loaded.skipMotion, true);
  assert.equal(loaded.coin.heads, 53); assert.equal(loaded.rps.wins, 4); assert.equal(loaded.records.reactionBest, 190); assert.deepEqual(loaded.records.reactionSamples, [190, 230]);
  assert.equal(loaded.records.cpsBest, 7.5); assert.equal(loaded.records.higherBest, 12); assert.equal(loaded.records.guesses.normal, 6);
  assert.deepEqual(loaded.wheels[0], { id: 'w1', name: 'Restaurantes', options: [{ label: 'Pizza', weight: 2 }], removeWinner: true });
  assert.deepEqual(loaded.lists[0], { id: 'l1', name: 'Amigos', items: ['Ana', 'Bia'] });
  const corrupt = JSON.stringify({ version: 1, favorites: ['invalid'], lists: [{ id: 'l', name: 'Longa', items: Array(20000).fill('a') }], coin: { heads: -1, tails: 'NaN' }, records: { reactionSamples: Array(100).fill(20) } });
  saved.set('ntc-random-tools-v1', corrupt);
  const cleaned = store.load();
  assert.deepEqual(cleaned.favorites, []); assert.equal(cleaned.coin.heads, 0); assert.equal(cleaned.coin.tails, 0); assert.equal(cleaned.lists[0].items.length, 10000); assert.equal(cleaned.records.reactionSamples.length, 50);
});

test('tool integration has one dedicated Games and Draws category and stays local', () => {
  const catalogSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalog.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  assert.match(catalogSource, /\['games', 'Jogos e Sorteios', 'game'\]/);
  assert.match(catalogSource, /add\('games', 'Jogos e Sorteios', \[\['randomTools'/);
  assert.doesNotMatch(catalogSource, /add\('generators',[^\n]*randomTools/);
  assert.doesNotMatch(catalogSource, /\['reaction', 'Teste de reflexo'/);
  assert.equal((html.match(/data-open-tool="randomTools"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-view="randomTools"/);
  assert.doesNotMatch(html, /mini-games\.js/);
  assert.match(html, /random-tools-state\.js/);
  assert.match(ui, /coinLastSummary \? copyButton\(coinLastSummary\)/);
  assert.match(ui, /copyButton\(winner\.label\)/);
  assert.match(ui, /copyButton\(drawnCards\.map/);
  assert.match(ui, /copyButton\(`\$\{last\.question/);
  assert.match(ui, /\['reaction','Tempo de reação'/);
  assert.match(ui, /const stateStore = stateApi\.createStore\(localStorage, STORE_KEY/);
  assert.doesNotMatch(ui, /fetch\(|XMLHttpRequest|https?:\/\//);
});

test('coin reuses one copy button and updates its copied result after each flip', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  assert.match(ui, /function updateCopyButton\(container, value\)/);
  assert.match(ui, /const existing = container\.querySelector\('\[data-copy\]'\)/);
  assert.match(ui, /if \(copyCache\.has\(id\)\) \{ copyCache\.set\(id, String\(value\)\); return; \}/);
  assert.match(ui, /updateCopyButton\(coinActions,coinLastSummary\)/);
  assert.doesNotMatch(ui, /coinActions\.insertAdjacentHTML\('afterbegin',\s*copyButton\(/);
});

test('dice entry omits the verbose expression examples hint', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  assert.doesNotMatch(ui, /Exemplos: 1d20 · 2d6 · 4d8\+3 · 2d20-1 · 1d37/);
  assert.doesNotMatch(ui, /Até 10\.000 dados por lançamento/);
});

test('selected dice expression survives result and history rerenders', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  assert.match(ui, /diceHistory = \[\], diceExpression = '1d6'/);
  assert.match(ui, /value="\$\{esc\(diceExpression\)\}"/);
  assert.match(ui, /diceExpression=expression;diceHistory\.unshift\(answer\).*renderDice\(\)/);
  assert.match(ui, /diceExpression=preset\.dataset\.dicePreset/);
  assert.match(ui, /else if\(action==='clear-dice-history'\)\{diceHistory=\[\];renderDice\(\);\}/);
});

test('roulette computes winners from weighted options before visual animation and exposes CRUD actions', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  const spin = ui.slice(ui.indexOf('function spinWheel()'), ui.indexOf('function cardsMarkup'));
  assert.match(spin, /core\.weightedChoice\(options\)/);
  assert.ok(spin.indexOf('core.weightedChoice(options)') < spin.indexOf('canvas.style.transform'));
  assert.match(spin, /wheel\.options=wheel\.options\.filter\(item=>item!==winner\)/);
  for (const action of ['save-wheel', 'update-wheel', 'rename-wheel', 'duplicate-wheel', 'delete-wheel', 'wheel-duplicate']) assert.ok(ui.includes(action), action);
});

test('expanded RPS mode survives its rerender after a round', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  assert.match(ui, /let rpsMode = 'classic'/);
  assert.match(ui, /rpsMode=event\.target\.value==='expanded'\?'expanded':'classic'/);
  assert.match(ui, /value="expanded" \$\{rpsMode==='expanded'\?'selected':''\}/);
  assert.match(ui, /data-rps="\$\{id\}" \$\{\['lagarto','spock'\]\.includes\(id\)&&rpsMode!=='expanded'\?'hidden':''\}/);
  assert.match(ui, /function spinRps\(move\)\{rpsMode=core\.resolveRpsMode\(move,rpsMode\)/);
  assert.match(ui, /root\.addEventListener\('click',event=>\{const rps=event\.target\.closest\('\[data-rps\]'\);if\(rps\)\{spinRps\(rps\.dataset\.rps\);return;\}/);
  assert.match(ui, /class="rt-rps-footer"[\s\S]*actionButton\('reset-rps'/);
});

test('decision output uses a centered vertical layout with spacing', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.css'), 'utf8');
  assert.match(css, /\.rt-decision-result \{ display: grid; justify-items: center; align-content: center; gap: 12px;/);
});

test('random tool controls keep checkboxes attached, forms spaced and search input single-bordered', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.css'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  assert.match(css, /\.rt-form > label\.rt-check[\s\S]*display: inline-flex/);
  assert.match(css, /\.rt-search input\[type="search"\][\s\S]*border: 0/);
  assert.match(css, /\.rt-wheel-editor > \.rt-panel \{ display: grid;[\s\S]*gap: 12px/);
  assert.match(css, /\.rt-card-draw-panel \{ display: grid;[\s\S]*gap: 14px/);
  assert.match(ui, /function updateDeckControls\(\)/);
  assert.match(ui, /min="2" max="\$\{deck\.length\}" value="5"/);
  assert.match(ui, /count<2\|\|count>deck\.length/);
  assert.match(ui, /core\.randomCharacter\(chars\)/);
  assert.doesNotMatch(ui, /core\.randomChoice\(chars\)/);
});

test('returning to a mini-game does not let its expired timer redraw another active tool', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'random-tools.js'), 'utf8');
  assert.match(ui, /reactionGame\.message='Agora!';if\(current==='reaction'\)renderReaction\(\)/);
  assert.match(ui, /data\.records\.cpsBest=Math\.max\(data\.records\.cpsBest,cpsGame\.last\.cps\);save\(\);if\(current==='cps'\)renderCps\(\)/);
});
