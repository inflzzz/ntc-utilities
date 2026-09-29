const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('../src/ntc-labs-stats-model.js');

test('estatísticas registram aberturas e apenas eventos agregados permitidos',()=>{
  const state=model.fresh(new Date('2026-09-29T12:00:00-03:00'));
  const date=new Date('2026-09-29T14:20:00');
  model.recordOpen(state,'ntcStats',date);
  model.recordOpen(state,'ntcStats',date);
  model.recordEvent(state,'conversions',3,date);
  model.recordEvent(state,'fileName',1,date);
  assert.equal(state.toolOpens.ntcStats,2);
  assert.equal(state.events.conversions,3);
  assert.equal(state.events.fileName,undefined,'conteúdo de arquivo não entra nas métricas');
  assert.equal(state.days[model.dayKey(date)].opens,2);
});

test('migração descarta estatísticas da ferramenta removida',()=>{
  const state=model.normalize({toolOpens:{infiniteCanvas:8,ntcStats:2}});
  assert.equal(state.toolOpens.infiniteCanvas,undefined);
  assert.equal(state.toolOpens.ntcStats,2);
});

test('tempo de uso é limitado a intervalos observados e obedece à opção de privacidade',()=>{
  const state=model.fresh();
  model.addActive(state,15000,new Date('2026-09-29T10:00:00'));
  model.addActive(state,10*60*60*1000,new Date('2026-09-29T10:00:15'));
  assert.equal(state.totalActiveMs,75000,'intervalo longo limitado para evitar contar suspensão como uso');
  assert.equal(state.activeHours[10],75000);
  assert.equal(state.activeWeekdays[new Date('2026-09-29T10:00:00').getDay()],75000);
  state.enabled=false;
  model.recordOpen(state,'randomTools');model.recordEvent(state,'randomDraws');model.addActive(state,15000);
  assert.equal(state.toolOpens.randomTools,undefined);
  assert.equal(state.events.randomDraws,undefined);
  assert.equal(state.totalActiveMs,75000);
});

test('normalização mantém apenas nomes de ferramenta e métricas conhecidas, e reset volta ao estado vazio',()=>{
  const normalized=model.normalize({sessions:4,toolOpens:{randomTools:3,'/caminho/privado':9},events:{musicPlays:2,trackTitle:'segredo'},days:{'2026-09-29':{activeMs:100,events:{generations:1,personName:9}}}});
  assert.equal(normalized.sessions,4);
  assert.deepEqual(normalized.toolOpens,{randomTools:3});
  assert.equal(normalized.events.musicPlays,2);
  assert.equal(normalized.events.trackTitle,undefined);
  assert.equal(normalized.days['2026-09-29'].events.generations,1);
  assert.equal(normalized.days['2026-09-29'].events.personName,undefined);
  const fresh=model.fresh();
  assert.equal(fresh.sessions,0);assert.equal(fresh.totalActiveMs,0);assert.deepEqual(fresh.toolOpens,{});assert.deepEqual(fresh.events,{});
});

test('formatação de tempo local é compacta e amigável',()=>{
  assert.equal(model.formatDuration(59000),'<1 min');
  assert.equal(model.formatDuration(3660000),'1h 1min');
  assert.equal(model.formatDuration(90061000),'1d 1h 1min');
});
