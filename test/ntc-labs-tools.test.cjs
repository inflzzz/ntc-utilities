const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'..','src',name),'utf8');
const html=()=>source('index.html');

test('Pessoa Aleatória salva, favorita, copia e exporta sem envio remoto',()=>{
  const code=source('ntc-labs-person.js'),view=html();
  for(const id of ['labsPersonSeed','labsPersonReferenceDate','labsGeneratePerson','labsPersonNewSeed','labsPersonResult','labsSavedPeople'])assert.ok(view.includes(`id="${id}"`),id);
  assert.match(code,/data-person-favorite/);assert.match(code,/data-person-export-json/);assert.match(code,/saveCurrent/);assert.match(code,/navigator\.clipboard\.writeText/);
  assert.doesNotMatch(code,/fetch\(|XMLHttpRequest|sendBeacon/);
});

test('Ambient Mixer usa gravações oficiais opcionais, três ruídos e mantém controles/timer/presets',()=>{
  const code=source('ntc-labs-ambient.js'),view=html(),catalog=require('../scripts/ambient-source-catalog.cjs');
  assert.equal(catalog.length,24);
  assert.equal((code.match(/id:'noise\.(?:white|pink|brown)'/g)||[]).length,3);
  for(const id of ['labsAmbientPlay','labsAmbientPause','labsAmbientStop','labsAmbientMaster','labsAmbientTimerStart','labsAmbientPresetCreate','labsAmbientPresetDuplicate','labsAmbientPresetRename','labsAmbientPresetDelete'])assert.ok(view.includes(`id="${id}"`),id);
  for(const id of ['labsAmbientPacks','labsAmbientAddReference','labsAmbientAddImport'])assert.ok(view.includes(`id="${id}"`),id);
  assert.match(code,/compressor\.connect\(context\.destination\)/);assert.match(code,/timerFading/);assert.match(code,/context\.suspend\(\)/);assert.match(code,/decodeAudioData/);assert.match(code,/source\.loop=true/);
  assert.doesNotMatch(code,/fetch\(|XMLHttpRequest|sendBeacon/);
});

test('Daily Random grava histórico local e repete o conjunto por data',()=>{
  const code=source('ntc-labs-daily.js'),view=html();
  for(const id of ['labsDailyDate','labsDailyResults','labsDailyHistory','labsDailyToday'])assert.ok(view.includes(`id="${id}"`),id);
  assert.match(code,/dailyRandom\(currentDate\)/);assert.match(code,/daily-history/);assert.match(code,/slice\(-120\)/);
});

test('Estatísticas ficam no armazenamento local, com reset confirmado e opção de desativar',()=>{
  const code=source('ntc-labs-stats.js'),view=html();
  assert.match(code,/ntc-labs-stats-v1/);assert.match(code,/localStorage\.setItem/);assert.match(code,/visibilitychange/);assert.match(code,/showModal\(\)/);
  assert.ok(view.includes('id="labsStatsOptOut"'));assert.ok(view.includes('id="labsStatsConfirm"'));
  assert.doesNotMatch(code,/fetch\(|XMLHttpRequest|sendBeacon/);
});

test('cinco ferramentas usam a folha dedicada de NTC Labs',()=>{
  const catalog=source('catalog.js'),index=html(),css=source('ntc-labs.css');
  assert.match(catalog,/\['labs', 'NTC Labs', 'spark'\]/);
  assert.match(index,/href="\.\/ntc-labs\.css"/);
  for(const id of ['randomPerson','ambientMixer','ntcStats','dailyRandom','realLife'])assert.ok(index.includes(`id="${id}View"`),id);
  assert.match(css,/\.labs-/);
});
