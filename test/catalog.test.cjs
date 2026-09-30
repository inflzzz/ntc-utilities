const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

function load(){
  const window={ntc:{catalogQr:async()=> 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E',catalogBarcode:async()=> 'data:image/png;base64,AA==',catalogCurrency:async({amount})=>({amount,date:'2026-09-24'}),catalogStructured:async()=> 'resultado'}};
  const context=vm.createContext({window,crypto:webcrypto,TextEncoder,btoa,Intl,Date,Math,Number,String,Array,Map,Set,BigInt,performance,URL,localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of ['catalog.js','utility-converters.js','utility-generators.js','utility-engine.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src',file),'utf8'),context,{filename:file});
  return window;
}

test('catalog has one category per tool and no removed entries',()=>{
  const app=load(),tools=app.ntcCatalog.tools,ids=tools.map(tool=>tool.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(app.ntcCatalog.categories.some(category=>category.id==='calculators'),false);
  for(const id of ['dns','tuner','bingo','markdownTable','sampleCsv','calendar','dateDiff','clickCounter','ascii','unicode','screenshotTranslate','ticTacToe','snake'])assert.equal(ids.includes(id),false,id);
  assert.equal(app.ntcCatalog.byId.has('reaction'),false,'the retired reaction game must not remain in navigation');
  for(const id of ['rng','history'])assert.equal(app.ntcCatalog.byId.get(id).category,null);
  for(const tool of tools)if(tool.category)assert.ok(app.ntcCatalog.categories.some(category=>category.id===tool.category),tool.id);
  const games=app.ntcCatalog.categories.find(category=>category.id==='games');
  const randomTool=app.ntcCatalog.byId.get('randomTools');
  assert.equal(games.name,'Jogos e Sorteios');
  assert.equal(randomTool.category,'games');
  assert.equal(randomTool.target,'randomTools');
  assert.equal(randomTool.visible,true);
  assert.equal(randomTool.panel,null);
  assert.equal(tools.filter(tool=>tool.id==='randomTools').length,1);
  assert.equal(tools.filter(tool=>tool.category==='games'&&tool.visible).length,1);
});

test('all catalog tools lead to a view, panel or functional spec',()=>{
  const app=load(),existing=new Set(['downloader','musicPlayer','converter','microphoneTest','voiceModifier','screenLight','uninstaller','videoEditor','video','recorder','webcamTest','documents','pdf','timeTools','studyTools','screenshot','autoclicker','renamer','compressor','clipboardHistory','security','colorPicker','randomTools','history','rng','randomPerson','ambientMixer','ntcStats','dailyRandom','realLife','storageAnalyzer','medicineReminders']);
  const panels=new Set(['image','converters','generators']);
  const labs=app.ntcCatalog.categories.find(category=>category.id==='labs');
  assert.equal(labs.name,'NTC Labs');
  assert.deepEqual(Array.from(app.ntcCatalog.tools.filter(tool=>tool.category==='labs').map(tool=>tool.id)),['randomPerson','ambientMixer','ntcStats','dailyRandom','realLife']);
  for(const id of ['randomPerson','ambientMixer','ntcStats','dailyRandom','realLife'])assert.ok(fs.readFileSync(path.join(__dirname,'..','src','index.html'),'utf8').includes(`id="${id}View"`),`${id} has a view`);
  assert.ok(fs.readFileSync(path.join(__dirname,'..','src','index.html'),'utf8').includes('id="voiceModifierView"'));
  for(const tool of app.ntcCatalog.tools){
    assert.ok(existing.has(tool.target)||panels.has(tool.panel)||app.ntcUtilitySpecs[tool.id]||app.ntcConverterSpecs[tool.id]||app.ntcGeneratorSpecs[tool.id],tool.id);
    if(tool.visible===false)assert.ok(tool.panel,`${tool.id} requires a parent panel`);
  }
});

test('Canvas Infinito foi removido e seu armazenamento local será limpo',()=>{
  const app=load(),index=fs.readFileSync(path.join(__dirname,'..','src','index.html'),'utf8');
  assert.equal(app.ntcCatalog.byId.has('infiniteCanvas'),false);
  assert.equal(index.includes('id="infiniteCanvasView"'),false);
  assert.equal(index.includes('ntc-labs-canvas-model.js'),false);
  assert.match(index,/indexedDB\.deleteDatabase\('ntc-labs-infinite-canvas'\)/);
});

test('converter defaults and generator output are usable',async()=>{
  const app=load();
  for(const [id,spec] of Object.entries({...app.ntcConverterSpecs,...app.ntcGeneratorSpecs})){
    const values=Object.fromEntries(spec.fields.map(field=>[field.id,String(field.value)]));
    const answer=await spec.run(values);
    assert.ok(answer?.value,id);
  }
  assert.notEqual(app.ntcGeneratorSpecs.testPhone.run({}).value,app.ntcGeneratorSpecs.testPhone.run({}).value);
  assert.ok(app.ntcGeneratorSpecs.randomColor.run({}).color);
  assert.ok(app.ntcGeneratorSpecs.colorPalette.run({count:5}).swatches.length===5);
  assert.deepEqual(Array.from(app.ntcGeneratorSpecs.placeholder.run({width:500,height:300,label:'Teste'}).formats),['png','jpg','svg']);
});

test('timezone conversion respects the selected origin',()=>{
  const spec=load().ntcConverterSpecs.timezones;
  assert.match(spec.run({value:'2026-09-24T12:00',from:'America/Sao_Paulo',to:'UTC'}).value,/15:00/);
  assert.match(spec.run({value:'2026-09-24T12:00',from:'UTC',to:'UTC'}).value,/12:00/);
  assert.throws(()=>spec.run({value:'2026-03-08T02:30',from:'America/New_York',to:'UTC'}),/não existe/);
});

test('category icons stay bounded and opening clocks starts the weather lookup',()=>{
  const source=name=>fs.readFileSync(path.join(__dirname,'..','src',name),'utf8');
  assert.match(source('utility-ui.js'),/const icon=name=>`<svg width="17" height="17"/);
  assert.match(source('catalog.css'),/\.home-view \.hero \.eyebrow svg\{width:14px;height:14px/);
  assert.match(source('app.js'),/if \(target === 'timeTools'\) window\.ntcWorldClock\?\.open\(\)/);
  assert.match(source('world-clock.js'),/window\.ntcWorldClock = \{ open: startWeatherUpdates \}/);
});

test('categories with a same-name single tool open it directly and submenus have no rail',()=>{
  const app=load(),duplicates=app.ntcCatalog.categories.filter(category=>{
    const visible=app.ntcCatalog.tools.filter(tool=>tool.visible&&tool.category===category.id);
    return visible.length===1&&visible[0].name===category.name;
  });
  assert.deepEqual(Array.from(duplicates,category=>category.name),['Conversores','Geradores']);
  const ui=fs.readFileSync(path.join(__dirname,'..','src','utility-ui.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','src','catalog.css'),'utf8');
  assert.match(ui,/const directToolForCategory=/);
  assert.match(ui,/if\(direct\)\{void openTool\(direct\.dataset\.directTool\);return;\}/);
  assert.doesNotMatch(css,/\.catalog-nav-children\{[^}]*border-left/);
});
