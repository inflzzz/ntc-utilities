const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const AdmZip = require('adm-zip');

app.whenReady().then(async () => {
  const files=process.argv.slice(2);
  const zip=files.length?null:new AdmZip(path.resolve('out/ambient-packs/ntc-ambient-essentials-v1.zip'));
  const samples=files.length?files.map(file=>({name:path.basename(file),bytes:require('node:fs').readFileSync(path.resolve(file))})):[{name:'rain.light.opus',bytes:zip.getEntry('audio/rain.light.opus')?.getData()}];
  if(samples.some(sample=>!sample.bytes))throw new Error('Áudio de teste não encontrado.');
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await window.loadURL('data:text/html,<html><body></body></html>');
  for(const sample of samples){const result=await window.webContents.executeJavaScript(`(async()=>{const binary=atob('${sample.bytes.toString('base64')}');const array=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)array[i]=binary.charCodeAt(i);const context=new AudioContext();const buffer=await context.decodeAudioData(array.buffer);const result={channels:buffer.numberOfChannels,sampleRate:buffer.sampleRate,duration:buffer.duration};await context.close();return result;})()`);console.log(sample.name,JSON.stringify(result));}
  window.destroy();app.quit();
}).catch(error => { console.error(error);app.exit(1); });
