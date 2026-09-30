const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { CompactStorageModel, categoryForName } = require('../src/storage-analyzer-core.cjs');
const { divide, layoutTree } = require('../src/storage-treemap.js');
const { StorageAnalyzerService, pathKey } = require('../src/storage-analyzer-main.cjs');

function temporary(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `ntc-storage-${name}-`)); }
function scan(root, cancelImmediately = false, scanOptions = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'src', 'storage-analyzer-worker.cjs'));
    const cancelBuffer = new SharedArrayBuffer(4), cancel = new Int32Array(cancelBuffer);
    let complete;
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error('scanner worker timeout'));},15000);
    const fail=error=>{clearTimeout(timeout);worker.terminate();reject(error);};
    worker.on('error', fail);
    worker.on('message', message => {
      if (message.type === 'ready') { worker.postMessage({ type: 'scan', rootPath: root, cancelBuffer, ...scanOptions }); if (cancelImmediately) Atomics.store(cancel, 0, 1); }
      if (message.type === 'failure') fail(new Error(message.payload?.message||'scanner worker failure'));
      if (message.type === 'complete' || message.type === 'cancelled') { complete = message; if (message.type === 'cancelled') { clearTimeout(timeout); worker.terminate(); resolve({ event: message }); } else worker.postMessage({ type: 'rpc', requestId: 1, action: 'treemap', payload: { rootId: 0, maxNodes: 5000 } }); }
      if (message.type === 'rpc' && message.requestId === 1) { clearTimeout(timeout); worker.terminate(); resolve({ event: complete, tree: message.result }); }
    });
  });
}

test('modelo agrega arquivo normal, vazio, diretório vazio e árvores profundas', () => {
  const model = new CompactStorageModel('C:\\fixture');
  const empty = model.addDirectory('vazia', 0); let parent = model.addDirectory('profunda', 0);
  for (let i = 0; i < 40; i++) parent = model.addDirectory(`nivel-${i}`, parent);
  model.addFile('normal.bin', parent, 100, 4096, 1000); model.addFile('vazio.txt', empty, 0, 0, 1000); model.finalize();
  assert.equal(model.item(0).logical, 100); assert.equal(model.item(0).allocated, 4096); assert.equal(model.item(0).files, 2); assert.equal(model.item(empty).files, 1); assert.equal(model.breadcrumbs(parent).length, 42);
});

test('modelo trata muitos irmãos, ordenação, busca, filtros, categorias e maiores itens', () => {
  const model = new CompactStorageModel('C:\\fixture');
  for (let i = 0; i < 1500; i++) model.addFile(`video-${i}.mp4`, 0, i, i * 4096, Date.now() - i * 86400000);
  model.addFile('arquivo.zip', 0, 99, 999999, Date.now() - 800 * 86400000); model.finalize();
  assert.equal(categoryForName('x.mp4').id, 1); assert.equal(categoryForName('x.zip').id, 4);
  const result = model.query({ kind:'files', query:'video-14', sort:'allocated', direction:'desc', filters:{ path:'fixture', extension:'mp4', minSize:0 }, limit:25 });
  assert.ok(result.total > 10); assert.ok(result.items.every(item => item.extension === 'mp4')); assert.ok(result.items[0].allocated >= result.items.at(-1).allocated);
  const archives = model.query({ kind:'files', filters:{ category:4, olderThan:63072000000 }, limit:10 }); assert.equal(archives.items[0].name, 'arquivo.zip');
  const folders = model.query({ kind:'folders', filters:{ category:null }, limit:10 });
  assert.equal(folders.total, 1, 'categoria nula não pode ser convertida silenciosamente em Outros');
  assert.equal(model.typeBreakdown().categories.find(item=>item.id===1).count, 1500); assert.ok(model.findings().some(item=>item.id==='old-archives'));
});

test('hard link duplicado mantém tamanho lógico e não duplica espaço físico', () => {
  const model = new CompactStorageModel('C:\\fixture'); model.addFile('a.bin',0,100,4096,0,false); model.addFile('b.bin',0,100,4096,0,true); model.finalize();
  assert.equal(model.item(0).logical,200); assert.equal(model.item(0).allocated,4096); assert.equal(model.item(2).duplicatePhysical,true);
});

test('métrica física indisponível é marcada como estimada sem inventar petabytes', () => {
  const model = new CompactStorageModel('C:\\fixture'); model.addFile('placeholder.bin',0,487,487,0,false,true); model.finalize();
  assert.equal(model.item(0).allocated,487); assert.equal(model.item(0).allocationUnknown,1); assert.equal(model.item(1).allocationEstimated,true);
});

test('erros parciais e remoções atualizam agregações sem derrubar o resultado', () => {
  const model = new CompactStorageModel('C:\\fixture'); const dir=model.addDirectory('pasta',0); const file=model.addFile('arquivo.bin',dir,10,4096); model.addError({path:'protegida',code:'EACCES'}); model.addError({path:'sumiu',code:'ENOENT'}); model.finalize();
  assert.equal(model.summary().errors,2); assert.equal(model.removeItem(file),true); assert.equal(model.item(0).allocated,0); assert.equal(model.query({kind:'files'}).total,0);
});

test('treemap conserva área e proporção no particionamento balanceado', () => {
  const rects=divide([{value:60,id:1},{value:30,id:2},{value:10,id:3}],{x:0,y:0,width:100,height:100});
  const area=rects.reduce((sum,item)=>sum+item.width*item.height,0);
  assert.ok(Math.abs(area-10000)<.001);
  for(const tile of rects) assert.ok(Math.abs(tile.width*tile.height-tile.item.value*100)<.001);
});

test('breadcrumb completo deriva dos níveis já escaneados', () => {
  const model=new CompactStorageModel('C:\\');
  const users=model.addDirectory('Users',0),administrator=model.addDirectory('Administrator',users),appData=model.addDirectory('AppData',administrator),local=model.addDirectory('Local',appData);
  model.finalize();
  const crumbs=model.breadcrumbs(local);
  assert.deepEqual(crumbs.map(item=>item.name),['C:\\','Users','Administrator','AppData','Local']);
  assert.deepEqual(crumbs.map(item=>item.id),[0,users,administrator,appData,local]);
  assert.equal(crumbs.at(-2).name,'AppData');
  const compact=require('../src/storage-breadcrumb.js').parts(crumbs,2);
  assert.deepEqual(compact.map(part=>part.kind==='segment'?part.item.name:'…'),['C:\\','…','AppData','Local']);
  assert.deepEqual(compact[1].items.map(item=>item.name),['Users','Administrator']);
});

test('hover em pasta mantém cursor normal e explica o duplo clique', () => {
  const ui=fs.readFileSync(path.join(__dirname,'..','src','storage-analyzer-ui.js'),'utf8');
  assert.doesNotMatch(ui,/cursor\s*=\s*node\?\.type\s*===\s*'folder'\s*\?\s*'zoom-in'/);
  assert.match(ui,/<span>Duplo clique para abrir<\/span>/);
});

test('treemap apresenta só dois níveis, compacta cadeia e permite abrir cada pasta real', () => {
  const model=new CompactStorageModel('C:\\fixture');let parent=0;
  for(let i=0;i<18;i++) parent=model.addDirectory(`nivel-${i}`,parent);
  model.addFile('grande.mp4',parent,750,750);model.addFile('pequeno.txt',parent,250,250);model.finalize();
  const tree=model.treemap(0,{},5000,'logical');
  const rects=layoutTree(tree,{sizeKey:'logical',bounds:{x:0,y:0,width:1000,height:600}});
  assert.ok(rects.every(rect=>rect.depth<=2));
  assert.ok(rects.some(rect=>rect.compacted&&rect.node.id===parent));
  assert.ok(rects.some(rect=>rect.node.name==='grande.mp4'));
  const opened=model.treemap(parent,{},5000,'logical');
  assert.equal(opened.root.id,parent);
  assert.deepEqual(opened.nodes.slice(1).map(node=>node.name).sort(),['grande.mp4','pequeno.txt']);
  assert.equal(opened.breadcrumbs.length,19);
});

test('treemap agrega milhares de arquivos pequenos sem ocultar arquivos grandes', () => {
  const model=new CompactStorageModel('C:\\fixture');
  model.addFile('enorme.iso',0,900000,900000);
  for(let i=0;i<2200;i++) model.addFile(`miudo-${i}.txt`,0,1,1);
  model.finalize();
  const tree=model.treemap(0,{},5000,'allocated');
  assert.equal(tree.nodes[0].childCount,2201);
  const rects=layoutTree(tree,{bounds:{x:0,y:0,width:900,height:600}});
  assert.ok(rects.length<100);
  assert.ok(rects.some(rect=>rect.node.name==='enorme.iso'));
  assert.ok(rects.some(rect=>rect.kind==='aggregate'&&rect.node.allocated>=2200));
  assert.ok(rects.every(rect=>rect.depth<=2));
});

test('treemap com muitas pastas, arquivos mistos e tamanhos semelhantes respeita limite visual', () => {
  const model=new CompactStorageModel('C:\\fixture');
  for(let i=0;i<180;i++){const folder=model.addDirectory(`pasta-${i}`,0);model.addFile(`foto-${i}.jpg`,folder,100,100);model.addFile(`video-${i}.mp4`,folder,100,100);}
  model.finalize();
  const tree=model.treemap(0,{},5000,'logical');
  const rects=layoutTree(tree,{sizeKey:'logical',bounds:{x:0,y:0,width:1200,height:700}});
  assert.ok(rects.length<=4000);
  assert.ok(rects.some(rect=>rect.kind==='aggregate'));
  assert.ok(rects.some(rect=>rect.kind==='folder'&&rect.depth===1));
  assert.ok(rects.every(rect=>rect.width>=0&&rect.height>=0));
});

test('scanner real lida com arquivo, vazio, sparse, caminho longo, hard link e junction sem ciclo', async t => {
  const root=temporary('filesystem');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'normal.txt'),'abc');fs.writeFileSync(path.join(root,'empty.bin'),'');
  const sparse=path.join(root,'sparse.bin'),handle=fs.openSync(sparse,'w');fs.ftruncateSync(handle,8*1024*1024);fs.closeSync(handle);
  fs.linkSync(path.join(root,'normal.txt'),path.join(root,'normal-hardlink.txt'));
  let deep=root;for(let i=0;i<7;i++){deep=path.join(deep,`segmento-${i}-${'x'.repeat(22)}`);fs.mkdirSync(deep);}fs.writeFileSync(path.join(deep,'fim.txt'),'fim');
  try{fs.symlinkSync(root,path.join(root,'ciclo'),'junction');}catch{}
  const result=await scan(root);assert.equal(result.event.type,'complete');assert.equal(result.event.payload.files,5);assert.ok(result.event.payload.logical>=8*1024*1024);assert.ok(result.event.payload.allocated<=result.event.payload.logical+16384);assert.ok(result.tree.nodes.length>=5);assert.ok(result.tree.nodes.every(node=>node.name!=='ciclo'));
});

test('scanner nativo Windows mantém totais do fallback em arquivos sparse e hard links', { skip: process.platform !== 'win32' || !fs.existsSync(path.join(__dirname, '..', 'resources', 'bin', 'storage-scan-fast.exe')) }, async t => {
  const root=temporary('native-parity');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const folder=path.join(root,'subpasta');fs.mkdirSync(folder);
  fs.writeFileSync(path.join(root,'normal.bin'),'x'.repeat(8193));fs.linkSync(path.join(root,'normal.bin'),path.join(folder,'hardlink.bin'));
  const sparse=path.join(folder,'sparse.bin'),handle=fs.openSync(sparse,'w');fs.ftruncateSync(handle,12*1024*1024);fs.closeSync(handle);
  let deep=root;for(let i=0;i<7;i++){deep=path.join(deep,`segmento-${i}-${'x'.repeat(22)}`);fs.mkdirSync(deep);}fs.writeFileSync(path.join(deep,'fim.txt'),'fim');
  const fallback=await scan(root,false,{profile:true});
  const native=await scan(root,false,{profile:true,verifyNative:true,helperPath:path.join(__dirname,'..','resources','bin','storage-scan-fast.exe')});
  assert.equal(fallback.event.type,'complete');assert.equal(native.event.type,'complete');
  for(const key of ['files','folders','links','logical','errors']) assert.equal(native.event.payload[key],fallback.event.payload[key],`campo ${key} deve coincidir com o fallback`);
  assert.ok(native.event.payload.allocated>=fallback.event.payload.allocated,'AllocationSize do NTFS não deve subestimar a aproximação stat');
  assert.ok(native.event.payload.allocated-fallback.event.payload.allocated<=native.event.payload.files*65536,'a diferença de alocação deve ficar limitada à granularidade de cluster por arquivo');
  assert.equal(native.event.payload.profile.nativeUsed,true);
  assert.equal(native.event.payload.scanMethod,'fast-ntfs');assert.equal(native.event.payload.fallbackReason,'');assert.ok(native.event.payload.profile.verifyFiles>0);assert.ok(Number.isFinite(native.event.payload.profile.verifyFallbackExtraBytes));assert.equal(native.event.payload.profile.verifyNativeAllocatedBytes,native.event.payload.allocated,'a soma nativa da verificação deve refletir exatamente o total do modelo');
  assert.equal(native.tree.nodes.length,fallback.tree.nodes.length);
  const missing=await scan(root,false,{profile:true,helperPath:path.join(root,'helper-inexistente.exe')});
  assert.equal(missing.event.payload.profile.nativeUsed,false);assert.equal(missing.event.payload.profile.nativeFallback,true);
  assert.match(missing.event.payload.fallbackReason,/^helper_not_found:/);
  assert.equal(missing.event.payload.profile.helperExists,false);
  const cancelled=await scan(root,true,{helperPath:path.join(__dirname,'..','resources','bin','storage-scan-fast.exe')});
  assert.equal(cancelled.event.type,'cancelled','o processo auxiliar deve parar ao cancelar');
  let junctionCreated=false;try{fs.symlinkSync(root,path.join(root,'junction'),'junction');junctionCreated=true;}catch{}
  if(junctionCreated){
    const fallbackWithJunction=await scan(root),nativeWithJunction=await scan(root,false,{profile:true,helperPath:path.join(__dirname,'..','resources','bin','storage-scan-fast.exe')});
    assert.equal(nativeWithJunction.event.payload.links,fallbackWithJunction.event.payload.links);
    assert.equal(nativeWithJunction.event.payload.profile.nativeUsed,true,'junctions de diretório não devem disparar fallback nem ciclos');
  }
  let fileSymlinkCreated=false;try{fs.symlinkSync(path.join(root,'normal.bin'),path.join(root,'arquivo-link.bin'),'file');fileSymlinkCreated=true;}catch{}
  if(fileSymlinkCreated){
    const fallbackWithLink=await scan(root),nativeWithLink=await scan(root,false,{profile:true,helperPath:path.join(__dirname,'..','resources','bin','storage-scan-fast.exe')});
    assert.equal(nativeWithLink.event.payload.files,fallbackWithLink.event.payload.files);
    assert.equal(nativeWithLink.event.payload.links,fallbackWithLink.event.payload.links);
    assert.equal(nativeWithLink.event.payload.profile.nativeUsed,true,'um reparse point de arquivo não deve reiniciar o scan inteiro');
    assert.equal(nativeWithLink.event.payload.fallbackReason,'');
    assert.ok(nativeWithLink.event.payload.profile.reparseLstatCalls>=1,'apenas o reparse point deve receber lstat para classificação exata');
    assert.equal(nativeWithLink.event.payload.profile.fallbackEntriesVisited,0,'o fallback completo não deve percorrer novamente a árvore');
  }
  const brokenHelper=path.join(root,'helper-invalido.exe');fs.writeFileSync(brokenHelper,'not an executable');
  const crashed=await scan(root,false,{profile:true,helperPath:brokenHelper});
  assert.equal(crashed.event.type,'complete');assert.equal(crashed.event.payload.profile.nativeFallback,true,'helper ausente/inválido deve cair no scanner padrão');
  assert.match(crashed.event.payload.fallbackReason,/^(spawn_failed|spawn_error|helper_exit_code):/);
});

test('mapa de árvore real mista preserva gigantes, agrega miúdos e detalha no drill-down', async t => {
  const root=temporary('treemap-mixed');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const many=path.join(root,'muitos-arquivos');fs.mkdirSync(many);
  for(let i=0;i<1100;i++)fs.writeFileSync(path.join(many,`miudo-${i}.txt`),'x');
  for(let i=0;i<45;i++){const folder=path.join(root,`subpasta-${i}`);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'conteudo.bin'),'x'.repeat(100));}
  let chain=path.join(root,'cadeia');fs.mkdirSync(chain);
  for(let i=0;i<12;i++){chain=path.join(chain,`nivel-${i}`);fs.mkdirSync(chain);}
  fs.writeFileSync(path.join(chain,'final.mp4'),'x'.repeat(200));
  for(const name of ['gigante-a.iso','gigante-b.iso']){const handle=fs.openSync(path.join(root,name),'w');fs.ftruncateSync(handle,2*1024*1024);fs.closeSync(handle);}
  const result=await scan(root);assert.equal(result.event.type,'complete');
  const rootId=result.tree.rootId;
  const layout=layoutTree(result.tree,{sizeKey:'logical',bounds:{x:0,y:0,width:1200,height:750}});
  assert.ok(layout.some(tile=>tile.node.name==='gigante-a.iso'));
  assert.ok(layout.some(tile=>tile.node.name==='gigante-b.iso'));
  assert.ok(layout.some(tile=>tile.node.name==='muitos-arquivos'));
  assert.ok(layout.some(tile=>tile.kind==='aggregate'));
  assert.ok(layout.length<150);
  assert.ok(layout.every(tile=>tile.depth<=2));
  assert.equal(rootId,0);
});

test('cancelamento usa sinal compartilhado e interrompe o scanner de verdade', async t => {
  const root=temporary('cancel');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(let i=0;i<300;i++)fs.writeFileSync(path.join(root,`${i}.txt`),'x');
  const result=await scan(root,true);assert.equal(result.event.type,'cancelled');assert.equal(result.event.payload.status,'cancelled');
});

test('serviço autoriza apenas raízes escolhidas e Lixeira opera por id derivado do scan', async t => {
  const root=temporary('service'),file=path.join(root,'remove.txt');fs.writeFileSync(file,'remove');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const listeners=new Map(),ipcMain={handle:(name,fn)=>listeners.set(name,fn)},events=[];
  const shell={openPath:async()=>'',showItemInFolder:()=>{},trashItem:async target=>fs.unlinkSync(target)};
  const fakeWindow={isDestroyed:()=>false,webContents:{send:(channel,payload)=>events.push({channel,payload})}};
  const service=new StorageAnalyzerService({ipcMain,dialog:{},shell,clipboard:{writeText:()=>{}},getWindow:()=>fakeWindow}).register();t.after(()=>service.dispose());
  assert.throws(()=>service.validateRoot(root));service.authorizedRoots.add(pathKey(root));await service.start(root);
  await new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const timer=setInterval(()=>{if(service.status.status==='complete'){clearInterval(timer);resolve();}else if(Date.now()>deadline){clearInterval(timer);reject(new Error('timeout'));}},20);});
  assert.equal(service.status.scanMethod,'standard');assert.match(service.status.fallbackReason,/helper_path_not_configured/);assert.ok(service.status.profile,'o app deve manter o perfil detalhado do scan concluído');assert.ok(service.status.profile.workerToMainIpcMessages>0);
  const list=await service.rpc('query',{kind:'files'});assert.equal(list.items.length,1);const outcome=await service.action('trash',list.items[0].id);assert.equal(outcome.removed,true);assert.equal(fs.existsSync(file),false);
});

test('inspetor do treemap abre no lado oposto ao clique', () => {
  const ui=fs.readFileSync(path.join(__dirname,'..','src','storage-analyzer-ui.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','src','storage-analyzer.css'),'utf8');
  assert.match(ui,/function positionInspector\(panel,event\).*clientX>=rect\.left\+rect\.width\/2;panel\.classList\.toggle\('storage-inspector-left',Boolean\(clickedRight\)\)/);
  assert.match(ui,/canvas\.onclick=event=>selectNode\(hitTest\(canvasPoint\(event\)\),event\)/);
  assert.match(css,/\.storage-inspector\.storage-inspector-left\{right:auto;left:10px\}/);
});

test('integração permanece segura: renderer isolado, argumentos por IPC e worker incluído pelo build', () => {
  const packageJson=require('../package.json'),main=fs.readFileSync(path.join(__dirname,'..','main.cjs'),'utf8'),preload=fs.readFileSync(path.join(__dirname,'..','preload.cjs'),'utf8');
  assert.match(main,/contextIsolation: true, nodeIntegration: false/);assert.match(main,/StorageAnalyzerService/);assert.match(main,/app\.isPackaged \? path\.join\(process\.resourcesPath, 'bin', 'storage-scan-fast\.exe'\)/);assert.match(preload,/storageAnalyzer: Object\.freeze/);assert.ok(packageJson.build.files.includes('src/**'));assert.ok(packageJson.build.extraResources.some(item=>item.filter?.includes('storage-scan-fast.exe')));assert.match(packageJson.scripts['package:win'],/build:storage-helper/);
});
