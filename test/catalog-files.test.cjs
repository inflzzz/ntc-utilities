const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const AdmZip=require('adm-zip');
const tar=require('tar');
const {initializeCatalogService}=require('../src/catalog-main.cjs');

function setup(dir,input,output){
  const handlers=new Map(),webContents={};
  initializeCatalogService({app:{getPath:()=>dir},ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[input]}),showSaveDialog:async()=>({canceled:false,filePath:output})},getMainWindow:()=>({webContents}),ffmpegPath:()=>''});
  return(name,payload)=>handlers.get(name)({sender:webContents},payload);
}

test('document conversion shows its text before saving a copy',async t=>{
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ntc-document-preview-'));
  t.after(()=>fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const input=path.join(dir,'anotacoes.txt'),output=path.join(dir,'anotacoes-convertido.txt'),content='Olá, este texto só deve ser salvo após confirmação.';
  await fs.promises.writeFile(input,content);
  const invoke=setup(dir,input,output),preview=await invoke('catalog-document');
  assert.equal(preview.preview,content);
  assert.equal(fs.existsSync(output),false);
  const saved=await invoke('catalog-document-save',{token:preview.token,format:'txt'});
  assert.equal(saved.fileName,'anotacoes-convertido.txt');
  assert.equal(await fs.promises.readFile(output,'utf8'),content);
  assert.equal(await fs.promises.readFile(input,'utf8'),content);
});

test('archive conversion lists contents before saving a separate archive',async t=>{
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ntc-archive-preview-'));
  t.after(()=>fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const input=path.join(dir,'dados.zip'),output=path.join(dir,'dados-convertido.tar.gz');
  const zip=new AdmZip();zip.addFile('exemplo.txt',Buffer.from('Conteúdo de exemplo'));zip.writeZip(input);
  const source=await fs.promises.readFile(input),invoke=setup(dir,input,output),preview=await invoke('catalog-archive');
  assert.deepEqual(preview.entries,['exemplo.txt']);
  assert.equal(fs.existsSync(output),false);
  const saved=await invoke('catalog-archive-save',{token:preview.token});
  assert.equal(saved.fileName,'dados-convertido.tar.gz');
  const entries=[];await tar.t({file:output,onReadEntry:entry=>entries.push(entry.path)});
  assert.deepEqual(entries,['exemplo.txt']);
  assert.deepEqual(await fs.promises.readFile(input),source);
});
