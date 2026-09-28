const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const YAML = require('yaml');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const mammoth = require('mammoth');
const AdmZip = require('adm-zip');
const tar = require('tar');
const { randomUUID } = require('node:crypto');
const { BrowserWindow } = require('electron');
const execFileAsync = promisify(execFile);

function initializeCatalogService({ app, ipcMain, dialog, getMainWindow, ffmpegPath }) {
  const owner = () => getMainWindow() || undefined;
  const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    if (!getMainWindow() || event.sender !== getMainWindow().webContents) throw new Error('Origem da solicitação inválida.');
    return action(event, ...args);
  });
  const ratePath = path.join(app.getPath('userData'), 'catalog-rates.json');
  let backgroundPipeline;
  const imageSessions = new Map();
  const fileSessions = new Map();
  const json = async (url, timeout = 10000) => { const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`Serviço indisponível (${response.status}).`); return response.json(); };
  const safeFilename = name => String(name || 'resultado.txt').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 120);
  const validHost = value => { const host = String(value || '').trim(); if (!/^(?:[a-z\d](?:[a-z\d.-]{0,251}[a-z\d])?|\[[a-f\d:]+\])$/i.test(host)) throw new Error('Informe um host ou domínio válido.'); return host; };
  const ownAddresses = () => new Set(['127.0.0.1', '::1', 'localhost', ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(x => x.address)]);
  function uniquePath(file) { if (!fs.existsSync(file)) return file; const ext = path.extname(file), base = file.slice(0, -ext.length); for (let i = 2; i < 1000; i++) { const candidate = `${base} (${i})${ext}`; if (!fs.existsSync(candidate)) return candidate; } throw new Error('Não foi possível criar um nome livre.'); }
  async function imagePreview(file) { const buffer = await sharp(file).rotate().resize({ width: 700, height: 500, fit: 'inside', withoutEnlargement: true }).png().toBuffer(); return `data:image/png;base64,${buffer.toString('base64')}`; }
  const imageOps = new Set(['imageConvert','batchResize','batchCompress','backgroundRemoval','exifStrip','imageWatermark','joinImages','cropImage','rotateImage','palette','favicon']);
  const imageFormats = { png: 'png', jpg: 'jpeg', webp: 'webp' };
  const escapeSvg = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[char]));
  async function closeImageSession(id) { const session=imageSessions.get(id); if(!session)return; imageSessions.delete(id); for(const file of session.tempFiles) await fs.promises.unlink(file).catch(()=>{}); }
  async function openImageInput(file) {
    if(!/\.(?:jpe?g|png|webp|avif|heic|heif|tiff?|bmp)$/i.test(file)) throw new Error(`Formato de imagem não suportado: ${path.basename(file)}`);
    if(!/\.hei[cf]$/i.test(file)) return { input:file, temp:null };
    const temp=path.join(app.getPath('temp'),`ntc-heic-${randomUUID()}.png`);
    await execFileAsync(ffmpegPath(),['-hide_banner','-loglevel','error','-i',file,'-frames:v','1',temp],{timeout:30000,windowsHide:true});
    return { input:temp, temp };
  }
  async function editorPalette(input) {
    const {data,info}=await sharp(input).rotate().resize(48,48,{fit:'inside'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const counts=new Map(); for(let i=0;i<data.length;i+=info.channels){const color=[data[i],data[i+1],data[i+2]].map(v=>(v&0xf0).toString(16).padStart(2,'0')).join('');counts.set(color,(counts.get(color)||0)+1);}
    return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([hex])=>`#${hex.toUpperCase()}`);
  }
  async function renderEditorBuffer(session,op,options={},cropRect=null,format='png') {
    if(!imageOps.has(op)) throw new Error('Operação de imagem desconhecida.');
    if(op==='palette') return {colors:await editorPalette(session.items[0].input)};
    if(op==='joinImages') {
      const sources=await Promise.all(session.items.map(async item=>{const input=await sharp(item.input).rotate().toBuffer();return{input,meta:await sharp(input).metadata()};}));
      if(sources.length<2) throw new Error('Selecione pelo menos duas imagens para juntar.');
      const vertical=options.direction==='vertical',width=vertical?Math.max(...sources.map(x=>x.meta.width)):sources.reduce((sum,x)=>sum+x.meta.width,0),height=vertical?sources.reduce((sum,x)=>sum+x.meta.height,0):Math.max(...sources.map(x=>x.meta.height));
      if(width*height>100_000_000) throw new Error('Composição grande demais.');
      let offset=0;const layers=sources.map(x=>{const layer={input:x.input,left:vertical?0:offset,top:vertical?offset:0};offset+=vertical?x.meta.height:x.meta.width;return layer;});
      const joined=sharp({create:{width,height,channels:4,background:'#fff'}}).composite(layers);if(format==='jpg')return joined.flatten({background:'#fff'}).jpeg({quality:90}).toBuffer();if(format==='webp')return joined.webp({quality:90}).toBuffer();return joined.png().toBuffer();
    }
    let pipe=sharp(session.items[0].input).rotate();
    if(op==='imageConvert') { /* The format is selected in the save step. */ }
    else if(op==='batchResize') { const width=Math.max(1,Math.min(16000,Number(options.width)||1920));pipe=pipe.resize({width,withoutEnlargement:true}); }
    else if(op==='batchCompress') { const quality=Math.max(1,Math.min(100,Number(options.quality)||75));options={...options,quality}; }
    else if(op==='exifStrip') { /* Re-encoding below drops the original metadata. */ }
    else if(op==='imageWatermark') { const width=session.items[0].width,height=session.items[0].height,label=escapeSvg(options.text||'MARCA D’ÁGUA'),fontSize=Math.max(18,Math.floor(width/15));const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" stroke="black" stroke-width="1" opacity="0.72" font-family="Arial" font-size="${fontSize}">${label}</text></svg>`);pipe=pipe.composite([{input:svg}]); }
    else if(op==='cropImage') {
      if(!cropRect||![cropRect.x,cropRect.y,cropRect.width,cropRect.height].every(Number.isFinite)) throw new Error('Arraste sobre a imagem para marcar a área que deseja recortar.');
      const meta=await pipe.metadata(),orientation=meta.orientation||1,swaps=orientation>=5&&orientation<=8,actualWidth=swaps?meta.height:meta.width,actualHeight=swaps?meta.width:meta.height;
      const left=Math.max(0,Math.min(actualWidth-1,Math.floor(cropRect.x*actualWidth))),top=Math.max(0,Math.min(actualHeight-1,Math.floor(cropRect.y*actualHeight))),width=Math.min(actualWidth-left,Math.max(1,Math.floor(cropRect.width*actualWidth))),height=Math.min(actualHeight-top,Math.max(1,Math.floor(cropRect.height*actualHeight)));
      if(width<2||height<2) throw new Error('Marque uma área maior na imagem.');
      pipe=pipe.extract({left,top,width,height});
    }
    else if(op==='rotateImage') { const degrees=Number(options.degrees)||0;if(![0,90,180,270].includes(degrees))throw new Error('Use 0, 90, 180 ou 270 graus.');pipe=sharp(session.items[0].input).rotate(degrees);if(options.flip==='horizontal')pipe=pipe.flop();if(options.flip==='vertical')pipe=pipe.flip(); }
    else if(op==='backgroundRemoval') { const {pipeline,env}=await import('@huggingface/transformers');env.cacheDir=path.join(app.getPath('userData'),'background-model');backgroundPipeline||=await pipeline('background-removal','Xenova/modnet',{dtype:'fp32'});const output=await backgroundPipeline(session.items[0].input);const result=Array.isArray(output)?output[0]:output;if(!result?.data||result.channels!==4)throw new Error('Não foi possível gerar a prévia sem fundo.');pipe=sharp(Buffer.from(result.data),{raw:{width:result.width,height:result.height,channels:4}}); }
    else if(op==='favicon') pipe=pipe.resize(64,64,{fit:'contain',background:'#00000000'});
    const target=imageFormats[format]||'png';
    if(target==='jpeg') return pipe.flatten({background:'#fff'}).jpeg({quality:Math.max(1,Math.min(100,Number(options.quality)||90))}).toBuffer();
    if(target==='webp') return pipe.webp({quality:Math.max(1,Math.min(100,Number(options.quality)||90))}).toBuffer();
    return pipe.png().toBuffer();
  }
  handle('catalog-image-open',async(_event,multiple)=>{
    const selection=await dialog.showOpenDialog(owner(),{title:multiple?'Escolha as imagens':'Escolha uma imagem',properties:['openFile',...(multiple?['multiSelections']:[])],filters:[{name:'Imagens',extensions:['jpg','jpeg','png','webp','avif','heic','heif','tif','tiff','bmp']}]});
    if(selection.canceled||!selection.filePaths.length)return null;
    if(selection.filePaths.length>20)throw new Error('Selecione no máximo 20 imagens por vez.');
    if(imageSessions.size>=8) await closeImageSession(imageSessions.keys().next().value);
    const items=[];try{for(const file of selection.filePaths.slice(0,multiple?20:1)){const opened=await openImageInput(file),meta=await sharp(opened.input).metadata(),orientation=meta.orientation||1,swaps=orientation>=5&&orientation<=8,stat=await fs.promises.stat(file);items.push({file,input:opened.input,temp:opened.temp,width:swaps?meta.height:meta.width,height:swaps?meta.width:meta.height,sourceBytes:stat.size,hasMetadata:Boolean(meta.exif||meta.xmp||meta.icc)});}const id=randomUUID();imageSessions.set(id,{items,tempFiles:items.map(x=>x.temp).filter(Boolean),createdAt:Date.now()});return{id,name:items.map(x=>path.basename(x.file)),count:items.length,width:items[0].width,height:items[0].height,sourceBytes:items[0].sourceBytes,hasMetadata:items[0].hasMetadata,preview:await imagePreview(items[0].input)};}catch(error){for(const item of items)if(item.temp)await fs.promises.unlink(item.temp).catch(()=>{});throw error;}
  });
  handle('catalog-image-preview',async(_event,payload)=>{
    const session=imageSessions.get(String(payload?.id||''));if(!session)throw new Error('A seleção expirou. Escolha a imagem novamente.');
    const format=imageFormats[payload?.format]?payload.format:'png',key=JSON.stringify({op:payload?.op,options:payload?.options||{},cropRect:payload?.cropRect||null,format});
    const result=await renderEditorBuffer(session,String(payload?.op||''),payload?.options||{},payload?.cropRect,format);
    if(result?.colors)return{colors:result.colors};
    session.lastRender=result.length<50_000_000?{key,buffer:result}:null;
    const metadata=await sharp(result).metadata();
    const buffer=await sharp(result).resize({width:900,height:650,fit:'inside',withoutEnlargement:true}).png().toBuffer();
    return{preview:`data:image/png;base64,${buffer.toString('base64')}`,width:metadata.width,height:metadata.height,bytes:result.length,format};
  });
  handle('catalog-image-save',async(_event,payload)=>{
    const id=String(payload?.id||''),session=imageSessions.get(id);if(!session)throw new Error('A seleção expirou. Escolha a imagem novamente.');
    const op=String(payload?.op||''),format=imageFormats[payload?.format]?payload.format:'png',extension=format==='jpg'?'jpg':format;
    if(session.items.length>1&&['batchResize','batchCompress'].includes(op)){
      const folder=await dialog.showOpenDialog(owner(),{title:`Salvar ${session.items.length} imagens editadas em`,properties:['openDirectory','createDirectory']});
      if(folder.canceled||!folder.filePaths[0])return null;
      const files=[],filePaths=[];for(const item of session.items){const buffer=await renderEditorBuffer({...session,items:[item]},op,payload?.options||{},null,format);const destination=uniquePath(path.join(folder.filePaths[0],`${path.basename(item.file,path.extname(item.file))}-editada.${extension}`));if(path.resolve(destination).toLowerCase()===path.resolve(item.file).toLowerCase())throw new Error('Escolha outro destino para preservar o original.');await fs.promises.writeFile(destination,buffer);files.push(path.basename(destination));filePaths.push(destination);}
      await closeImageSession(id);return{saved:true,fileName:`${files.length} imagens`,files,filePaths};
    }
    const defaultName=`${path.basename(session.items[0].file,path.extname(session.items[0].file))}-editada.${extension}`;
    const result=await dialog.showSaveDialog(owner(),{title:'Salvar imagem editada',defaultPath:path.join(path.dirname(session.items[0].file),defaultName),filters:[{name:`Imagem ${extension.toUpperCase()}` ,extensions:[extension]}]});
    if(result.canceled||!result.filePath)return null;
    if(path.extname(result.filePath).toLowerCase()!==`.${extension}`)throw new Error(`Use a extensão .${extension} para este formato.`);
    const key=JSON.stringify({op,options:payload?.options||{},cropRect:payload?.cropRect||null,format});
    const buffer=session.lastRender?.key===key?session.lastRender.buffer:await renderEditorBuffer(session,op,payload?.options||{},payload?.cropRect,format);
    if(buffer?.colors)throw new Error('Uma paleta de cores não é um arquivo de imagem.');
    if(session.items.some(item=>path.resolve(item.file).toLowerCase()===path.resolve(result.filePath).toLowerCase()))throw new Error('Escolha outro nome para preservar o arquivo original.');
    await fs.promises.writeFile(result.filePath,buffer);
    const fileName=path.basename(result.filePath);await closeImageSession(id);return{saved:true,fileName,filePath:result.filePath,size:buffer.length};
  });
  handle('catalog-image-close',async(_event,id)=>{await closeImageSession(String(id||''));return true;});
  handle('catalog-save', async (_event, payload) => {
    const filename = safeFilename(payload?.filename);
    const format=['png','jpg','svg'].includes(payload?.format)?payload.format:'svg';
    const extension=payload?.kind==='image'?format:path.extname(filename).slice(1)||'txt';
    const result = await dialog.showSaveDialog(owner(), { title: 'Salvar resultado', defaultPath: path.join(app.getPath('downloads'), payload?.kind==='image'?`${path.basename(filename,path.extname(filename))}.${extension}`:filename), filters:payload?.kind==='image'?[{name:`Imagem ${extension.toUpperCase()}`,extensions:[extension]}]:undefined });
    if (result.canceled || !result.filePath) return null;
    if(payload?.kind==='image'&&path.extname(result.filePath).toLowerCase()!==`.${extension}`)throw new Error(`Use a extensão .${extension} para este formato.`);
    let buffer;
    if (payload?.kind === 'image') { const match = /^data:image\/(?:png|jpeg|webp|svg\+xml);(?:charset=[^;]+;)?base64,([A-Za-z\d+/=]+)$/.exec(String(payload.value)); if (match) buffer = Buffer.from(match[1], 'base64'); else { const svg = /^data:image\/svg\+xml;charset=utf-8,(.+)$/.exec(String(payload.value)); if (!svg) throw new Error('Imagem inválida.'); buffer = Buffer.from(decodeURIComponent(svg[1]), 'utf8'); } if(format==='png')buffer=await sharp(buffer).png().toBuffer();else if(format==='jpg')buffer=await sharp(buffer).flatten({background:'#fff'}).jpeg({quality:92}).toBuffer(); }
    else buffer = Buffer.from(String(payload?.value || ''), 'utf8');
    if (buffer.length > 30 * 1024 * 1024) throw new Error('Resultado grande demais para salvar por esta ferramenta.');
    await fs.promises.writeFile(result.filePath, buffer); return {fileName:path.basename(result.filePath),filePath:result.filePath,size:buffer.length};
  });
  handle('catalog-qr', async (_event, value) => { const text = String(value || ''); if (!text || Buffer.byteLength(text) > 1600) throw new Error('Texto vazio ou longo demais para QR Code.'); const svg=await QRCode.toString(text,{type:'svg',width:480,margin:2,color:{dark:'#111111',light:'#ffffff'}}); return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
  handle('catalog-barcode', async (_event, value) => { const text = String(value || '').trim(); if (!text || text.length > 80 || /[^\x20-\x7e]/.test(text)) throw new Error('Use 1–80 caracteres ASCII imprimíveis.'); const png = await bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 20, includetext: true }); return `data:image/png;base64,${png.toString('base64')}`; });
  handle('catalog-structured', (_event, payload) => { const text = String(payload?.text || ''); if (text.length > 1_000_000) throw new Error('Texto grande demais.'); const direction = String(payload?.direction || ''); if (payload?.format === 'yaml') return direction.startsWith('JSON') ? YAML.stringify(JSON.parse(text)) : JSON.stringify(YAML.parse(text), null, 2); if (payload?.format === 'xml') return direction.startsWith('JSON') ? new XMLBuilder({ format: true, ignoreAttributes: false }).build({ root: JSON.parse(text) }) : JSON.stringify(new XMLParser({ ignoreAttributes: false }).parse(text), null, 2); throw new Error('Formato não suportado.'); });
  handle('catalog-currency', async (_event, payload) => {
    const amount = Number(payload?.amount), from = String(payload?.from || ''), to = String(payload?.to || '');
    if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error('Moeda ou valor inválido.');
    if (from === to) return { amount, date: new Date().toISOString().slice(0, 10), cached: false };
    const key = `${from}-${to}`; let cache = {}; try { cache = JSON.parse(fs.readFileSync(ratePath, 'utf8')); } catch {}
    try { const data = await json(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`); const rate = Number(data.rates?.[to]); if (!Number.isFinite(rate)) throw new Error('Cotação indisponível.'); cache[key] = { rate, date: data.date }; await fs.promises.writeFile(ratePath, JSON.stringify(cache)); return { amount: amount * rate, date: data.date, cached: false }; }
    catch (error) { if (cache[key]) return { amount: amount * cache[key].rate, date: cache[key].date, cached: true }; throw error; }
  });
  handle('catalog-network', async (_event, payload) => {
    const op = String(payload?.op || ''), value = String(payload?.value || '').trim();
    if (op === 'ip') { const local = [...ownAddresses()].filter(x => x !== 'localhost'); let publicIp = 'Indisponível'; try { publicIp = (await json('https://api.ipify.org?format=json')).ip; } catch {} return { local, publicIp }; }
    if (op === 'ping') { const host = validHost(value); let raw; try { raw = (await execFileAsync(process.platform === 'win32' ? 'ping.exe' : 'ping', process.platform === 'win32' ? ['-n','4',host] : ['-c','4',host], { timeout: 12000, windowsHide: true, maxBuffer: 100000, encoding:'buffer' })).stdout; } catch (error) { raw=error.stdout; if(!raw)throw new Error('Não foi possível executar o ping.'); } const source=Buffer.isBuffer(raw)?raw.toString('latin1'):String(raw); const times=[...source.matchAll(/(?:time|tempo)[=<]\s*(\d+)\s*ms/ig)].map(match=>Number(match[1])); const ttl=[...source.matchAll(/TTL\s*=\s*(\d+)/ig)].map(match=>Number(match[1])); return {text:`Destino: ${host}\nEnviados: 4 · Recebidos: ${times.length} · Perdidos: ${4-times.length}${times.length?`\nMínimo: ${Math.min(...times)} ms · Média: ${Math.round(times.reduce((sum,time)=>sum+time,0)/times.length)} ms · Máximo: ${Math.max(...times)} ms`:'\nSem resposta.'}${ttl.length?`\nTTL: ${ttl[0]}`:''}`}; }
    if (op === 'ports') { const host = value || '127.0.0.1'; if (!ownAddresses().has(host)) throw new Error('O scanner só aceita endereços deste computador.'); const start = Number(payload.start), end = Number(payload.end); if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || end < start || end - start > 999) throw new Error('Escolha até 1000 portas entre 1 e 65535.'); const open = []; let next = start; await Promise.all(Array.from({ length: Math.min(40, end-start+1) }, async () => { while (next <= end) { const port = next++; const opened = await new Promise(resolve => { const socket = net.connect({ host, port }); const finish = ok => { socket.destroy(); resolve(ok); }; socket.setTimeout(350, () => finish(false)); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); }); if (opened) open.push(port); } })); return { host, scanned: end-start+1, open: open.sort((a,b)=>a-b) }; }
    if (op === 'whois') { const domain = validHost(value).toLowerCase(); if(!domain.includes('.'))throw new Error('Informe um domínio completo.');const bootstrap=await json('https://data.iana.org/rdap/dns.json',12000);const service=bootstrap.services?.find(([domains])=>domains.some(suffix=>domain===suffix||domain.endsWith(`.${suffix}`)));const base=service?.[1]?.find(url=>url.startsWith('https://'));if(!base)throw new Error('O registro RDAP deste domínio não está disponível.');const data=await json(`${base.replace(/\/$/,'')}/domain/${encodeURIComponent(domain)}`,12000); return { name: data.ldhName || domain, status: data.status || [], registrar: data.entities?.find(e => e.roles?.includes('registrar'))?.vcardArray?.[1]?.find(x => x[0] === 'fn')?.[3] || 'Não informado', events: data.events || [],source:base }; }
    if (op === 'siteStatus') { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); if (!['http:','https:'].includes(url.protocol)) throw new Error('Use HTTP ou HTTPS.'); const started = performance.now(); let response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) }); if (response.status === 405) response = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) }); return { status: response.status, ok: response.ok, ms: Math.round(performance.now()-started), finalUrl: response.url }; }
    if (op === 'speedTest') { const started = performance.now(); const down = await fetch('https://speed.cloudflare.com/__down?bytes=5000000', { signal: AbortSignal.timeout(30000) }); if (!down.ok) throw new Error('Falha no teste de download.'); await down.arrayBuffer(); const seconds = (performance.now()-started)/1000; const upStarted = performance.now(); const upload = await fetch('https://speed.cloudflare.com/__up', { method: 'POST', body: Buffer.alloc(1_000_000), signal: AbortSignal.timeout(30000) }); if (!upload.ok) throw new Error('Falha no teste de upload.'); return { downloadMbps: +(5*8/seconds).toFixed(2), uploadMbps: +(8/((performance.now()-upStarted)/1000)).toFixed(2), transferredMb: 6, source: 'Cloudflare' }; }
    throw new Error('Consulta de rede desconhecida.');
  });
  handle('catalog-document', async () => {
    const selected = await dialog.showOpenDialog(owner(), { title: 'Escolha um documento', properties: ['openFile'], filters: [{ name: 'Documentos', extensions: ['docx','odt','rtf','txt','html','htm','md'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const source = selected.filePaths[0], ext = path.extname(source).toLowerCase();
    if((await fs.promises.stat(source)).size>20_000_000)throw new Error('Use documentos de até 20 MB nesta ferramenta.');
    let content;
    if (ext === '.docx') content = (await mammoth.extractRawText({ path: source })).value;
    else if (ext === '.odt') { const zip = new AdmZip(source); const xml = zip.getEntry('content.xml')?.getData().toString('utf8'); if (!xml) throw new Error('ODT sem conteúdo legível.'); content = xml.replace(/<text:p\b[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
    else { content = await fs.promises.readFile(source, 'utf8'); if (ext === '.rtf') content = content.replace(/\\par\b/g, '\n').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, ''); if (ext === '.html' || ext === '.htm') content = content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<\/(?:p|div|h[1-6]|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
    if(fileSessions.size>=8)fileSessions.delete(fileSessions.keys().next().value);
    const token=randomUUID();fileSessions.set(token,{kind:'document',source,content});
    return{token,name:path.basename(source),characters:content.length,preview:content.slice(0,6000),truncated:content.length>6000};
  });
  handle('catalog-document-save',async(_event,payload)=>{
    const token=String(payload?.token||''),session=fileSessions.get(token);if(session?.kind!=='document')throw new Error('Documento expirou. Escolha-o novamente.');
    const format=String(payload?.format||'pdf');if(!['pdf','txt'].includes(format))throw new Error('Formato inválido.');
    const {source,content}=session,ext=path.extname(source),pdf=format==='pdf';
    const selected=await dialog.showSaveDialog(owner(),{title:'Salvar cópia do documento',defaultPath:path.join(path.dirname(source),`${path.basename(source,ext)}-convertido.${format}`),filters:[{name:format.toUpperCase(),extensions:[format]}]});
    if(selected.canceled||!selected.filePath)return null;
    const destination=selected.filePath;if(path.extname(destination).toLowerCase()!==`.${format}`)throw new Error(`Use a extensão .${format}.`);
    if(path.resolve(destination).toLowerCase()===path.resolve(source).toLowerCase())throw new Error('Escolha outro nome para preservar o original.');
    if (!pdf) await fs.promises.writeFile(destination, content, 'utf8');
    else { const print = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }); try { const escaped = content.replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char])); await print.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:12pt Arial;white-space:pre-wrap;overflow-wrap:anywhere;margin:18mm}</style></head><body>${escaped}</body></html>`)}`); const buffer = await print.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }); await fs.promises.writeFile(destination, buffer); } finally { print.destroy(); } }
    fileSessions.delete(token);return{fileName:path.basename(destination),filePath:destination,size:(await fs.promises.stat(destination)).size,warning:'O texto foi convertido; estilos e layout do original podem mudar.'};
  });
  handle('catalog-archive', async () => {
    const selected = await dialog.showOpenDialog(owner(), { title: 'Escolha um arquivo compactado', properties: ['openFile'], filters: [{ name: 'Arquivos', extensions: ['zip','tar','gz'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const source = selected.filePaths[0], isZip = /\.zip$/i.test(source), isTar = /\.(?:tar|tar\.gz)$/i.test(source);
    if (!isZip && !isTar) throw new Error('Use ZIP, TAR ou TAR.GZ.');
    const stat=await fs.promises.stat(source),entries=[];let entryCount=0;
    if(isZip){for(const entry of new AdmZip(source).getEntries()){entryCount++;if(entries.length<30)entries.push(entry.entryName);}}
    else await tar.t({file:source,onReadEntry:entry=>{entryCount++;if(entries.length<30)entries.push(entry.path);}});
    if(fileSessions.size>=8)fileSessions.delete(fileSessions.keys().next().value);
    const token=randomUUID();fileSessions.set(token,{kind:'archive',source,isZip});
    return{token,name:path.basename(source),bytes:stat.size,format:isZip?'ZIP':/\.tar\.gz$/i.test(source)?'TAR.GZ':'TAR',outputFormat:isZip?'tar.gz':'zip',entries,entryCount};
  });
  handle('catalog-archive-save',async(_event,payload)=>{
    const token=String(payload?.token||''),session=fileSessions.get(token);if(session?.kind!=='archive')throw new Error('Arquivo expirou. Escolha-o novamente.');
    const {source,isZip}=session,extension=isZip?'tar.gz':'zip';
    const selected=await dialog.showSaveDialog(owner(),{title:'Salvar cópia convertida',defaultPath:`${source.replace(/\.(?:tar\.gz|zip|tar)$/i,'')}-convertido.${extension}`,filters:[{name:extension.toUpperCase(),extensions:[extension]}]});
    if(selected.canceled||!selected.filePath)return null;
    const destination=selected.filePath;if(!destination.toLowerCase().endsWith(`.${extension}`))throw new Error(`Use a extensão .${extension}.`);
    if(path.resolve(destination).toLowerCase()===path.resolve(source).toLowerCase())throw new Error('Escolha outro nome para preservar o original.');
    const tempRoot = path.resolve(app.getPath('temp'));
    const temp = await fs.promises.mkdtemp(path.join(tempRoot, 'ntc-archive-'));
    try {
      if (isZip) { const zip = new AdmZip(source); for (const entry of zip.getEntries()) { const destination = path.resolve(temp, entry.entryName); if (!(destination === temp || destination.startsWith(temp + path.sep))) throw new Error('Arquivo contém caminho inseguro.'); if (entry.isDirectory) await fs.promises.mkdir(destination, { recursive: true }); else { await fs.promises.mkdir(path.dirname(destination), { recursive: true }); await fs.promises.writeFile(destination, entry.getData()); } } }
      else await tar.x({ file: source, cwd: temp, strict: true, preservePaths: false });
      const files = await fs.promises.readdir(temp);
      if (isZip) await tar.c({ gzip: true, file: destination, cwd: temp }, files);
      else { const zip = new AdmZip(); const walk = async (dir, prefix='') => { for (const item of await fs.promises.readdir(dir,{withFileTypes:true})) { const full=path.join(dir,item.name); if(item.isDirectory()) await walk(full,path.join(prefix,item.name)); else if(item.isFile()) zip.addFile(path.join(prefix,item.name).replace(/\\/g,'/'),await fs.promises.readFile(full)); } }; await walk(temp); zip.writeZip(destination); }
      fileSessions.delete(token);return{fileName:path.basename(destination),filePath:destination,size:(await fs.promises.stat(destination)).size};
    } finally { const checked = path.resolve(temp); if (path.dirname(checked) === tempRoot && path.basename(checked).startsWith('ntc-archive-')) await fs.promises.rm(checked, { recursive: true, force: true }); }
  });
}
module.exports = { initializeCatalogService };
