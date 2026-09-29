const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const { PACK_IDS, REMOTE_MANIFEST_URL, validatePack, validateDistribution } = require('./ambient-schema.cjs');
const EXTENSIONS = new Set(['.wav','.mp3','.flac','.ogg','.opus']);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const idOK = id => typeof id === 'string' && PACK_IDS.includes(id);
const customID = id => typeof id === 'string' && /^custom\.[a-f0-9-]{36}$/.test(id);
const cleanName = name => String(name || '').trim().slice(0,80);
const errorText = error => error?.name === 'AbortError' ? 'Download cancelado.' : String(error?.message || error);

class AmbientPackService {
  constructor({ root, catalogFile, fetchImpl = globalThis.fetch, onProgress = () => {}, ffprobe = null }) {
    this.root=path.join(root,'ambient');this.catalogFile=catalogFile;this.fetch=fetchImpl;this.onProgress=onProgress;this.jobs=new Map();this.remote=null;this.ffprobe=ffprobe;
  }
  validateCustomAudio(file){if(!this.ffprobe)return;let value;try{value=JSON.parse(execFileSync(this.ffprobe,['-v','error','-select_streams','a:0','-show_entries','stream=codec_name,channels:format=duration','-of','json',file],{encoding:'utf8',timeout:10000,maxBuffer:100000}));}catch{throw new Error('Não foi possível ler o áudio selecionado.');}const duration=Number(value.format?.duration),channels=Number(value.streams?.[0]?.channels);if(!Number.isFinite(duration)||duration<1||duration>300||!Number.isInteger(channels)||channels<1||channels>2)throw new Error('Use áudio de até 5 minutos em mono ou estéreo.');}
  async initialize(){await fsp.mkdir(path.join(this.root,'packs'),{recursive:true});await fsp.mkdir(path.join(this.root,'custom'),{recursive:true});await fsp.mkdir(path.join(this.root,'staging'),{recursive:true});return this.state();}
  localCatalog(){return validateDistribution(JSON.parse(fs.readFileSync(this.catalogFile,'utf8')));}
  async refresh(){
    try { const response=await this.fetch(REMOTE_MANIFEST_URL,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'NTC-Utilities-Ambient/1'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.text();if(data.length>100000)throw new Error('Catálogo remoto grande demais.');this.remote=validateDistribution(JSON.parse(data));return {online:true,catalog:this.remote}; }
    catch(error){this.remote=null;return {online:false,catalog:this.localCatalog(),error:errorText(error)};}
  }
  async installed(){
    const result={};
    for(const id of PACK_IDS){
      const entries=await fsp.readdir(path.join(this.root,'packs'),{withFileTypes:true}).catch(()=>[]);
      const versions=entries.filter(entry=>entry.isDirectory()&&new RegExp(`^${id}-v[1-9][0-9]*$`).test(entry.name)).sort((a,b)=>Number(b.name.split('-v').pop())-Number(a.name.split('-v').pop()));
      for(const entry of versions){
        const dir=path.join(this.root,'packs',entry.name);
        try{const pack=validatePack(JSON.parse(await fsp.readFile(path.join(dir,'manifest.json'),'utf8')));if(pack.id!==id||entry.name!==`${id}-v${pack.version}`)continue;let valid=true;for(const sound of pack.sounds){const file=path.join(dir,sound.file);const stat=await fsp.stat(file).catch(()=>null);if(!stat?.isFile()||stat.size!==sound.bytes||sha(await fsp.readFile(file))!==sound.sha256){valid=false;break;}}if(valid){result[id]={version:pack.version,manifest:pack};break;}}catch{}
      }
    }
    return result;
  }
  async custom(){try{const value=JSON.parse(await fsp.readFile(path.join(this.root,'custom','library.json'),'utf8'));return Array.isArray(value)?value.filter(item=>customID(item.id)&&typeof item.path==='string'&&typeof item.name==='string'&&['reference','import'].includes(item.mode)).slice(0,200):[];}catch{return [];}}
  async saveCustom(value){const file=path.join(this.root,'custom','library.json'),tmp=`${file}.tmp`;await fsp.writeFile(tmp,JSON.stringify(value,null,2));await fsp.rename(tmp,file);}
  async state(){const catalog=this.remote||this.localCatalog();return {packs:catalog.packs,installed:await this.installed(),custom:await Promise.all((await this.custom()).map(async item=>({id:item.id,name:item.name,mode:item.mode,volume:item.volume,missing:!await fsp.stat(item.path).then(s=>s.isFile()).catch(()=>false)})))};}
  async download(id){
    if(!idOK(id))throw new Error('Pacote inválido.');if(this.jobs.has(id))throw new Error('Download já em andamento.');
    const pack=(this.remote||this.localCatalog()).packs.find(item=>item.id===id);if(!pack)throw new Error('Pacote não encontrado.');
    const controller=new AbortController(),job={controller};this.jobs.set(id,job);
    const token=crypto.randomUUID(),part=path.join(this.root,'staging',`${id}-${token}.part`),stage=path.join(this.root,'staging',`${id}-${token}`);
    const progress=(status,extra={})=>this.onProgress({id,status,...extra});
    try{
      progress('preparando');await fsp.mkdir(path.join(this.root,'packs'),{recursive:true});await fsp.mkdir(stage,{recursive:true});
      const response=await this.fetch(pack.url,{signal:controller.signal,headers:{'User-Agent':'NTC-Utilities-Ambient/1'}});if(!response.ok||!response.body)throw new Error(`Download indisponível (HTTP ${response.status}).`);
      const stream=fs.createWriteStream(part,{flags:'wx'}),hash=crypto.createHash('sha256');let received=0;const started=Date.now();
      try{for await(const chunk of response.body){if(controller.signal.aborted)throw new DOMException('Cancelado','AbortError');received+=chunk.length;if(received>pack.bytes||received>300_000_000)throw new Error('Tamanho do download excedido.');hash.update(chunk);if(!stream.write(chunk))await new Promise(resolve=>stream.once('drain',resolve));progress('baixando',{bytes:received,total:pack.bytes,speed:Math.round(received/Math.max(1,(Date.now()-started)/1000))});}await new Promise((resolve,reject)=>stream.end(error=>error?reject(error):resolve()));}catch(error){stream.destroy();throw error;}
      if(controller.signal.aborted)throw new DOMException('Download cancelado','AbortError');
      progress('verificando',{bytes:received,total:pack.bytes});if(received!==pack.bytes||hash.digest('hex')!==pack.sha256)throw new Error('Não foi possível verificar a integridade do pacote.');
      if(controller.signal.aborted)throw new DOMException('Download cancelado','AbortError');
      progress('instalando');const zip=new AdmZip(part),entries=zip.getEntries();if(entries.length>102)throw new Error('Pacote contém arquivos demais.');
      const names=new Set();let total=0;for(const entry of entries){const name=entry.entryName;if(entry.isDirectory||name.includes('\\')||name.startsWith('/')||name.includes('..')||name.includes(':')||names.has(name)||!(name==='manifest.json'||/^audio\/[a-z0-9][a-z0-9.-]*\.opus$/.test(name))||(entry.header.fileAttr>>>16&0xf000)===0xa000)throw new Error('Estrutura do pacote inválida.');names.add(name);total+=entry.header.size;if(total>500_000_000)throw new Error('Pacote extraído grande demais.');}
      if(!names.has('manifest.json'))throw new Error('Manifest ausente.');const manifest=validatePack(JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8')));if(manifest.id!==id||manifest.version!==pack.version||names.size!==manifest.sounds.length+1)throw new Error('Manifest incompatível.');
      for(const sound of manifest.sounds){const entry=zip.getEntry(sound.file);if(!entry)throw new Error('Áudio ausente.');const bytes=entry.getData();if(bytes.length!==sound.bytes||sha(bytes)!==sound.sha256)throw new Error('Áudio corrompido.');const target=path.join(stage,sound.file);await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.writeFile(target,bytes);}
      await fsp.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest));if(controller.signal.aborted)throw new DOMException('Download cancelado','AbortError');const final=path.join(this.root,'packs',`${id}-v${pack.version}`),backup=path.join(this.root,'staging',`${id}-${token}.backup`);
      if(fs.existsSync(final))await fsp.rename(final,backup);
      try{await fsp.rename(stage,final);}catch(error){if(fs.existsSync(backup))await fsp.rename(backup,final);throw error;}
      await fsp.rm(backup,{recursive:true,force:true}).catch(()=>{});
      for(const entry of await fsp.readdir(path.join(this.root,'packs'),{withFileTypes:true})){if(entry.isDirectory()&&new RegExp(`^${id}-v[1-9][0-9]*$`).test(entry.name)&&entry.name!==path.basename(final))await fsp.rm(path.join(this.root,'packs',entry.name),{recursive:true,force:true});}
      progress('instalado');return this.state();
    }catch(error){progress(controller.signal.aborted?'cancelado':'erro',{error:errorText(error)});throw error;}finally{this.jobs.delete(id);await fsp.rm(part,{force:true}).catch(()=>{});await fsp.rm(stage,{recursive:true,force:true}).catch(()=>{});}
  }
  cancel(id){if(!idOK(id))return false;const job=this.jobs.get(id);if(!job)return false;job.controller.abort();return true;}
  async remove(id){if(!idOK(id))throw new Error('Pacote inválido.');this.cancel(id);for(const entry of await fsp.readdir(path.join(this.root,'packs'),{withFileTypes:true})){if(entry.isDirectory()&&new RegExp(`^${id}-v[1-9][0-9]*$`).test(entry.name))await fsp.rm(path.join(this.root,'packs',entry.name),{recursive:true,force:true});}return this.state();}
  async addCustom(file,mode='reference'){
    if(!['reference','import'].includes(mode))throw new Error('Modo inválido.');const absolute=path.resolve(file);const ext=path.extname(absolute).toLowerCase();if(!EXTENSIONS.has(ext))throw new Error('Formato de áudio não suportado.');const stat=await fsp.stat(absolute);if(!stat.isFile()||stat.size>100_000_000)throw new Error('Arquivo inválido ou grande demais (máximo 100 MB).');this.validateCustomAudio(absolute);
    const items=await this.custom();if(items.length>=200)throw new Error('Limite de 200 sons próprios.');const id=`custom.${crypto.randomUUID()}`;let target=absolute;
    if(mode==='import'){target=path.join(this.root,'custom',`${id}${ext}`);await fsp.copyFile(absolute,target,fs.constants.COPYFILE_EXCL);}
    items.push({id,name:cleanName(path.basename(absolute,ext)),path:target,mode,volume:55});await this.saveCustom(items);return this.state();
  }
  async updateCustom(id,patch){if(!customID(id))throw new Error('Som inválido.');const items=await this.custom(),item=items.find(value=>value.id===id);if(!item)throw new Error('Som não encontrado.');if(patch.name!==undefined)item.name=cleanName(patch.name)||item.name;if(patch.volume!==undefined)item.volume=Math.min(100,Math.max(0,Number(patch.volume)||0));await this.saveCustom(items);return this.state();}
  async relink(id,file){if(!customID(id))throw new Error('Som inválido.');const items=await this.custom(),item=items.find(value=>value.id===id);if(!item||item.mode!=='reference')throw new Error('Som não referenciado.');const absolute=path.resolve(file),stat=await fsp.stat(absolute);if(!stat.isFile()||!EXTENSIONS.has(path.extname(absolute).toLowerCase())||stat.size>100_000_000)throw new Error('Arquivo inválido.');this.validateCustomAudio(absolute);item.path=absolute;await this.saveCustom(items);return this.state();}
  async removeCustom(id){if(!customID(id))throw new Error('Som inválido.');const items=await this.custom(),item=items.find(value=>value.id===id);if(!item)return this.state();await this.saveCustom(items.filter(value=>value.id!==id));if(item.mode==='import'&&path.dirname(item.path)===path.join(this.root,'custom')&&path.basename(item.path).startsWith(id+'.'))await fsp.rm(item.path,{force:true});return this.state();}
  async audio(id){
    let file,limit=100_000_000;
    if(customID(id)){const item=(await this.custom()).find(value=>value.id===id);if(!item)throw new Error('Som não encontrado.');file=item.path;}
    else{const installed=await this.installed();for(const [packId,value] of Object.entries(installed)){const sound=value.manifest.sounds.find(sound=>sound.id===id);if(sound){file=path.join(this.root,'packs',`${packId}-v${value.version}`,sound.file);limit=30_000_000;break;}}}
    if(!file)throw new Error('Som não instalado.');const stat=await fsp.stat(file).catch(()=>null);if(!stat?.isFile()||stat.size>limit)throw new Error('Arquivo de áudio não encontrado.');return fsp.readFile(file);
  }
}
module.exports={AmbientPackService};
