/* Run explicitly with Electron; never operates the user's desktop or uninstalls software. */
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const fs = require('node:fs'); const path = require('node:path');
  app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests', 'ui-validation'));
  async function run() {
    await app.whenReady(); const window = new BrowserWindow({ width: 1350, height: 950, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadFile(path.join(__dirname, 'uninstaller-fixture.html'));
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const wait=()=>new Promise(resolve=>setTimeout(resolve,50)); const $=s=>document.querySelector(s); const ok=(v,m)=>{if(!v)throw new Error(m)};
      await NTCUninstaller.open(); ok(document.querySelectorAll('.un-row').length===2,'List failed');
      desktop.push({id:'heavy',name:'Pesado',size:3*1073741824,type:'EXE'}, {id:'zero',name:'Zero',size:0,type:'EXE'});
      $('[data-action="refresh"]').click(); await wait();
      const ids=()=>Array.from(document.querySelectorAll('.un-row')).map(row=>row.dataset.id).join();
      $('.un-row[data-id="abc"] input').click();
      $('[data-size-order="size"]').click(); ok(ids()==='heavy,abc,zero,studio','Descending size order failed');
      $('[data-size-order="size-asc"]').click(); ok(ids()==='zero,abc,heavy,studio','Ascending size/unknown order failed');
      ok($('.un-row[data-id="abc"] input').checked,'Sort lost selection');
      $('[data-sort]').value='name'; $('[data-sort]').dispatchEvent(new Event('change'));
      desktop.splice(2); $('[data-action="refresh"]').click(); await wait();
      $('.un-row-info').click(); $('.un-details details').open=true; $('[data-detail="estimate"]').click(); await wait(); ok($('.un-extra').textContent.includes('318'),'Estimate failed');
      $('[data-detail="analyze"]').click(); await wait(); ok($('[data-candidate="file"]').checked,'High candidate not selected'); ok(!$('[data-candidate="save"]').checked,'Personal data selected'); ok($('[data-candidate="low"]').disabled,'Low confidence enabled');
      scan.items.push({id:'small',category:'Arquivos',path:'C:/Fixture/small.bin',size:1,confidence:'high',eligible:true,selected:false,reasons:[],metadata:{}}, {id:'unknown',category:'Arquivos',path:'C:/Fixture/unknown.bin',size:null,confidence:'low',eligible:false,selected:false,reasons:[],metadata:{}});
      $('[data-detail="analyze"]').click(); await wait();
      $('[data-candidate="file"]').closest('.un-candidate').querySelector('details').open=true;
      const reviewIds=()=>Array.from(document.querySelectorAll('.un-group:first-of-type [data-candidate]')).map(row=>row.dataset.candidate).join();
      $('[data-review-sort]').value='size-asc'; $('[data-review-sort]').dispatchEvent(new Event('change')); ok(reviewIds()==='small,file,unknown','Review ascending order failed');
      ok($('[data-candidate="file"]').checked,'Review sort lost selection'); ok($('[data-candidate="file"]').closest('.un-candidate').querySelector('details').open,'Review sort lost expansion');
      $('[data-review-sort]').value='size'; $('[data-review-sort]').dispatchEvent(new Event('change')); ok(reviewIds()==='file,small,unknown','Review descending order failed');
      $('[data-review-sort]').value='original'; $('[data-review-sort]').dispatchEvent(new Event('change')); ok(reviewIds()==='file,small,unknown','Review original order failed');
      $('[data-clear-review]').click(); ok($('[data-clean]').disabled,'Empty cleanup enabled'); $('[data-candidate="file"]').click(); $('[data-clean]').click(); await wait(); ok(calls.find(c=>c[0]==='clean')[1][1].join()==='file','Cleanup IDs corrupted');
      $('[data-tab="history"]').click(); await wait(); ok($('.un-other').textContent.includes('Restaurar sobras'),'Restore missing'); ok($('.un-other').textContent.includes('Exportar relatório'),'Report missing');
      $('[data-clear-history]').click(); await wait(); ok(calls.some(call=>call[0]==='clearHistory'),'Clear history action missing'); ok($('.un-history'),'Canceled clear lost history');
      $('[data-tab="tracked"]').click(); await wait(); ok($('.un-other').textContent.includes('Startup'),'Resource changes missing');
      $('[data-tab="programs"]').click(); await wait(); $('.un-review').classList.add('hidden'); $('[data-query]').value='Studio'; $('[data-query]').dispatchEvent(new Event('input')); ok(document.querySelectorAll('.un-row').length===1,'Search failed'); $('[data-query]').value=''; $('[data-query]').dispatchEvent(new Event('input')); window.scrollTo(0,0);
      const first=document.querySelector('.un-check input'); const parent=first.parentElement.getBoundingClientRect(); const check=first.getBoundingClientRect(); ok(Math.abs(check.top+check.height/2-(parent.top+parent.height/2))<2,'Checkbox alignment');
      $('[data-sort]').value='size-asc'; $('[data-sort]').dispatchEvent(new Event('change'));
      emitJob({busy:true,results:[],index:1,total:1,stage:'Desinstalando'});
      desktop.splice(desktop.findIndex(row=>row.id==='abc'),1);
      emitJob({busy:false,results:[{id:'abc',name:'Programa de teste',stillRegistered:false}],index:1,total:1,stage:'Concluído'});
      await wait(); await wait(); ok(ids()==='studio','Automatic uninstall refresh failed'); ok($('[data-sort]').value==='size-asc','Automatic refresh lost sort');
      window.ntc.uninstaller.size=async()=>{await new Promise(resolve=>{window.finishSize=resolve});return {bytes:2*1073741824,source:'Pasta medida',status:'complete',root:'D:/Fixture'}};
      $('[data-action="refresh"]').click(); await wait(); ok($('.un-row-meta > span').textContent==='Calculando…','Pending size not shown');
      $('.un-row input').click(); $('.un-row-info').click(); window.finishSize(); await wait(); await wait(); await wait();
      ok($('.un-row-meta > span').textContent==='2 GB','Automatic folder size not shown'); ok($('.un-row input').checked,'Automatic size lost selection');
      ok($('.un-details dl dd:last-of-type').textContent==='2 GB','Details size not updated'); ok($('.un-row-meta > span').title.includes('Pasta medida'),'Size origin missing');
      return {list:true,search:true,review:true,personal:true,backup:true,report:true,monitor:true,alignment:true,sizeOrder:true,reviewSizeOrder:true,clearHistory:true,automaticRefresh:true,automaticSizes:true};
    })()`);
    const out = path.resolve('tmp/uninstaller-validation'); fs.mkdirSync(out, { recursive: true }); await new Promise(resolve=>setTimeout(resolve,150)); fs.writeFileSync(path.join(out, 'ui-desktop.png'), (await window.webContents.capturePage()).toPNG());
    await window.setSize(660,900); await new Promise(resolve=>setTimeout(resolve,150));
    const overflow=await window.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth + 1'); if(overflow) throw new Error('Narrow layout overflows');
    fs.writeFileSync(path.join(out, 'ui-narrow.png'), (await window.webContents.capturePage()).toPNG()); console.log(JSON.stringify(result)); window.destroy(); app.quit();
  }
  run().catch(error=>{console.error(error);app.exit(1)});
}
