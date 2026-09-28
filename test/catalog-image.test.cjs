const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const sharp=require('sharp');
const {initializeCatalogService}=require('../src/catalog-main.cjs');
sharp.cache(false);

test('image crop is previewed before an explicit save and the original is preserved',async t=>{
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ntc-image-test-'));
  t.after(()=>fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const input=path.join(dir,'original.png'),output=path.join(dir,'recorte.jpg');
  await sharp({create:{width:200,height:100,channels:3,background:'#527fc2'}}).png().toFile(input);
  const before=await fs.promises.readFile(input),handlers=new Map(),webContents={};
  const ipcMain={handle:(name,handler)=>handlers.set(name,handler)};
  const dialog={showOpenDialog:async()=>({canceled:false,filePaths:[input]}),showSaveDialog:async()=>({canceled:false,filePath:output})};
  const app={getPath:()=>dir};
  initializeCatalogService({app,ipcMain,dialog,getMainWindow:()=>({webContents}),ffmpegPath:()=>''});
  const invoke=(name,payload)=>handlers.get(name)({sender:webContents},payload);
  const session=await invoke('catalog-image-open',false);
  assert.equal(session.width,200);
  const cropRect={x:.25,y:.25,width:.5,height:.5};
  const preview=await invoke('catalog-image-preview',{id:session.id,op:'cropImage',cropRect,format:'jpg'});
  assert.match(preview.preview,/^data:image\/png;base64,/);
  assert.equal(fs.existsSync(output),false);
  const saved=await invoke('catalog-image-save',{id:session.id,op:'cropImage',cropRect,format:'jpg'});
  assert.equal(saved.fileName,'recorte.jpg');
  assert.equal((await sharp(output).metadata()).format,'jpeg');
  assert.equal((await sharp(output).metadata()).width,100);
  assert.deepEqual(await fs.promises.readFile(input),before);
});

test('batch resize previews a representative image and saves copies only after folder selection',async t=>{
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ntc-image-batch-'));
  t.after(()=>fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const files=[path.join(dir,'um.png'),path.join(dir,'dois.png')],out=path.join(dir,'saida');
  await fs.promises.mkdir(out);
  for(const file of files)await sharp({create:{width:240,height:120,channels:3,background:'#93a59a'}}).png().toFile(file);
  const handlers=new Map(),webContents={};
  initializeCatalogService({app:{getPath:()=>dir},ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},dialog:{showOpenDialog:async(_owner,options)=>({canceled:false,filePaths:options.properties.includes('openDirectory')?[out]:files})},getMainWindow:()=>({webContents}),ffmpegPath:()=>''});
  const invoke=(name,payload)=>handlers.get(name)({sender:webContents},payload);
  const session=await invoke('catalog-image-open',true);
  assert.equal(session.count,2);
  await invoke('catalog-image-preview',{id:session.id,op:'batchResize',options:{width:120},format:'webp'});
  assert.deepEqual(await fs.promises.readdir(out),[]);
  const result=await invoke('catalog-image-save',{id:session.id,op:'batchResize',options:{width:120},format:'webp'});
  assert.equal(result.files.length,2);
  for(const name of result.files){const meta=await sharp(path.join(out,name)).metadata();assert.equal(meta.width,120);assert.equal(meta.format,'webp');}
});

test('generated SVG artwork can be saved as SVG, PNG or JPG',async t=>{
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ntc-generated-image-'));
  t.after(()=>fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const handlers=new Map(),webContents={};let format='svg';
  initializeCatalogService({app:{getPath:()=>dir},ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},dialog:{showSaveDialog:async()=>({canceled:false,filePath:path.join(dir,`placeholder.${format}`)})},getMainWindow:()=>({webContents}),ffmpegPath:()=>''});
  const source='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>');
  for(format of ['svg','png','jpg']){
    const saved=await handlers.get('catalog-save')({sender:webContents},{kind:'image',format,filename:'placeholder.svg',value:source});
    assert.equal(saved.fileName,`placeholder.${format}`);
    if(format==='svg')assert.match(await fs.promises.readFile(saved.filePath,'utf8'),/^<svg/);
    else assert.equal((await sharp(saved.filePath).metadata()).format,format==='jpg'?'jpeg':'png');
  }
});
