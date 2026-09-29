#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const sources = require('./ambient-source-catalog.cjs');
const { PACK_IDS, validatePack, validateDistribution } = require('../src/ambient-schema.cjs');
const arg = name => { const i=process.argv.indexOf(name); return i<0 ? null : process.argv[i+1]; };
const sourceArg=arg('--source');
if (!sourceArg) throw new Error('Use --source <diretório NTC SOM ou raiz extraída>.');
const version=Number(arg('--version')||1);
if(!Number.isSafeInteger(version)||version<1)throw new Error('Versão do pack inválida.');
const release=`ambient-packs-v${version}`,releaseBase=`https://github.com/inflzzz/ntc-utilities/releases/download/${release}`;
const output=path.resolve(arg('--out') || path.join(__dirname,'..','out','ambient-packs'));
const sourceRoot=path.resolve(sourceArg);
const candidates=[sourceRoot,path.join(sourceRoot,'Essentials_Series_NOX_SOUND'),path.join(sourceRoot,'Essentials_Series_NOX_SOUND','Essentials_Series_NOX_SOUND')];
const root=candidates.find(dir=>fs.existsSync(path.join(dir,sources[0].source)));
if (!root) throw new Error('Masters NOX SOUND selecionados não encontrados no diretório informado.');
if (output===root || output.startsWith(root+path.sep) || root.startsWith(output+path.sep)) throw new Error('A saída deve ficar fora dos masters.');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,sample_rate,channels,bits_per_sample,bits_per_raw_sample','-select_streams','a:0','-of','json',file],{encoding:'utf8'}));
const info=[]; const distribution={schemaVersion:1,release,packs:[]};
fs.mkdirSync(output,{recursive:true});
for(const id of PACK_IDS){
  const selected=sources.filter(item=>item.pack===id);
  const zip=new AdmZip();let installedBytes=0,masterBytes=0;
  const manifest={schemaVersion:1,id,name:{'ambient-essentials':'Ambient Essentials',nature:'Nature',water:'Water'}[id],version,description:{'ambient-essentials':'Chuva, fogo, vento, floresta, mar e mais.',nature:'Variações de clima e natureza.',water:'Oceanos, rios, riachos, cachoeiras e fontes termais.'}[id],license:'CC0',sounds:[]};
  for(const item of selected){
    const master=path.join(root,...item.source.split('/'));
    if(!fs.existsSync(master))throw new Error(`Master ausente: ${item.source}`);
    const original=probe(master);const stream=original.streams?.[0];
    if(!stream || !stream.codec_name.startsWith('pcm_') || ![1,2].includes(stream.channels) || Number(original.format.duration)<2)throw new Error(`Master inválido: ${item.source}`);
    const target=path.join(output,`${item.id}.opus`);
    execFileSync('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-y','-i',master,'-map','0:a:0','-vn','-c:a','libopus','-ar','48000','-b:a',stream.channels===1?'64k':'144k','-vbr','on','-compression_level','10',target],{stdio:'pipe'});
    const encoded=probe(target);if(encoded.streams?.[0]?.codec_name!=='opus'||Number(encoded.streams[0].sample_rate)!==48000||encoded.streams[0].channels!==stream.channels)throw new Error(`Conversão inválida: ${item.id}`);
    execFileSync('ffmpeg',['-v','error','-xerror','-i',target,'-f','null','-'],{stdio:'pipe'});
    const file=`audio/${item.id}.opus`,bytes=fs.statSync(target).size;
    zip.addLocalFile(target,'audio',`${item.id}.opus`);installedBytes+=bytes;masterBytes+=fs.statSync(master).size;
    manifest.sounds.push({id:item.id,name:item.name,category:item.category,file,duration:Number(Number(encoded.format.duration).toFixed(3)),loop:true,defaultVolume:item.volume,tags:item.tags,source:item.source,sha256:digest(target),bytes});
    info.push({id:item.id,pack:id,source:item.source,masterBytes:fs.statSync(master).size,masterCodec:stream.codec_name,masterSampleRate:Number(stream.sample_rate),masterChannels:stream.channels,masterDuration:Number(original.format.duration),encodedBytes:bytes,encodedDuration:Number(encoded.format.duration),encodedCodec:'opus',encodedSampleRate:48000});
    console.log(`${item.id}: ${(bytes/1048576).toFixed(2)} MiB`);
  }
  validatePack(manifest);
  zip.addFile('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  const zipFile=path.join(output,`ntc-${id}-v${version}.zip`);zip.writeZip(zipFile);
  const bytes=fs.statSync(zipFile).size;
  distribution.packs.push({id,name:manifest.name,description:manifest.description,version,bytes,installedBytes,sha256:digest(zipFile),url:`${releaseBase}/ntc-${id}-v${version}.zip`});
  console.log(`${id}: ${(bytes/1048576).toFixed(2)} MiB download, ${(installedBytes/1048576).toFixed(2)} MiB installed, ${(masterBytes/1048576).toFixed(2)} MiB masters`);
}
validateDistribution(distribution);
fs.writeFileSync(path.join(output,'ambient-packs.json'),JSON.stringify(distribution,null,2)+'\n');
fs.writeFileSync(path.join(output,'asset-report.json'),JSON.stringify(info,null,2)+'\n');
console.log('Built:',output);
