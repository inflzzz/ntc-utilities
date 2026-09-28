// Isolated visual test page: no Electron bridge, real rolls, player data or save access.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { TIERS, TITLES, POOL } = require('../src/rng.cjs');
const data = { tiers: TIERS, titles: TIERS.map(tier => {
  const title = TITLES.find(item => item.tier === tier.id);
  return { id: title.id, name: title.name, tier: tier.id, tierLabel: tier.label, odds: String(title.denominator || POOL/title.baseWeight) };
}) };
function page() {
  const html = fs.readFileSync(path.join(root,'src/index.html'),'utf8');
  const start = html.indexOf('<section class="rng-roll-panel">');
  const panel = html.slice(start, html.indexOf('</section>',start)+10);
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><base href="/src/"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NTC · Ensaio da rolagem</title>
  <link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/theme.css"><link rel="stylesheet" href="/src/rng-icons.css"><link rel="stylesheet" href="/src/rng-theme.css"><link rel="stylesheet" href="/src/rng-roll-experience.css">
  <style>body{display:block;overflow:auto;padding:30px;background:#0b0a0b}main{max-width:1080px;margin:auto}.rng-view{display:block!important;padding:0!important}.preview-tools{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0;align-items:center}.preview-tools select,.preview-tools button{padding:9px;background:#241c20;color:#e9ded5;border:1px solid #665056;border-radius:5px}#metrics{white-space:pre-wrap;color:#bba9a1}dialog{background:#20191d;color:#f0e4dc;border:1px solid #957773;padding:35px;border-radius:10px}dialog::backdrop{background:#090608cf}</style>
  <main><section class="rng-view">${panel}</section><div class="preview-tools"><label>Resultado <select id="tier">${TIERS.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}</select></label><label>Movimento <select id="motion"><option value="full">Completo</option><option value="reduced">Reduzido</option><option value="off">Desligado</option></select></label><label><input id="reveal" type="checkbox"> Descoberta com reveal</label><button id="hide">Ocultar / voltar</button><button id="burst">100 resultados rápidos</button><button id="inspect">Métricas</button></div><pre id="metrics">Prévia isolada — nenhum save é lido.</pre><dialog id="revealDialog"><h2>Reveal recebeu a descoberta</h2><p id="revealResult"></p><button id="continue">Continuar</button></dialog></main>
  <script src="/src/rng-icons.js"></script><script src="/src/rng-roll-experience.js"></script><script>
  const fixture=${JSON.stringify(data)}; let roll=0, autoTimer=null, hidden=false, pendingReveal=false;
  const state={tiers:fixture.tiers,totalRolls:0,autoRollActive:false,latestResult:null};
  const $=s=>document.querySelector(s); const samples=[]; const errors=[];
  addEventListener('error',e=>errors.push(e.message));
  const controller=NTCRollExperience.create({root:$('#rngRollExperience'),onResult:r=>{
    $('#rngResultTitle').textContent=r.title.name; $('#rngResultCaption').textContent=(r.isNew?'NOVA DESCOBERTA · ':'RESULTADO · ')+r.title.tierLabel;
    $('#rngResultOdds').textContent='1 em '+new Intl.NumberFormat('pt-BR').format(BigInt(r.currentOdds));
    $('.rng-result-icon').innerHTML=NTCRngIcons.render('tier-'+r.title.tier,{size:42,animation:'none'});
  },onRevealReady:()=>{controller.setOccluded(true);$('#revealResult').textContent=state.latestResult.title.name;$('#revealDialog').showModal();}});
  const originalTick=controller.tick.bind(controller);controller.tick=now=>{const before=controller.position;originalTick(now);samples.push({time:now,position:controller.position,delta:controller.position-before});if(samples.length>2000)samples.shift();};
  function update(){controller.update(state,{reveal:pendingReveal,motion:$('#motion').value,visible:!hidden});pendingReveal=false;$('#rngRollCount').textContent=roll;}
  function receive(){const title=fixture.titles.find(t=>t.tier===$('#tier').value);state.totalRolls=++roll;state.latestResult={title,roll,currentOdds:title.odds,fragmentReward:'1',isNew:$('#reveal').checked};pendingReveal=$('#reveal').checked;update();}
  $('#rngRollButton').onclick=()=>{controller.beginRequest();setTimeout(receive,55);};
  $('#rngAutoButton').onclick=()=>{state.autoRollActive=!state.autoRollActive;$('#rngAutoButton').textContent=state.autoRollActive?'Pausar rolagem automática':'Iniciar rolagem automática';$('#rngRollButton').disabled=state.autoRollActive;if(autoTimer)clearInterval(autoTimer);autoTimer=null;if(state.autoRollActive){receive();autoTimer=setInterval(receive,1000);}else update();};
  $('#motion').onchange=update;
  $('#hide').onclick=()=>{hidden=!hidden;$('.rng-view').style.visibility=hidden?'hidden':'visible';controller.setVisible(!hidden);};
  $('#continue').onclick=()=>{$('#revealDialog').close();$('#reveal').checked=false;controller.setOccluded(false);};
  $('#burst').onclick=()=>{for(let i=0;i<100;i++)receive();};
  $('#inspect').onclick=()=>{const gaps=samples.slice(1).map((s,i)=>s.time-samples[i].time).filter(x=>x<250);$('#metrics').textContent=JSON.stringify({phase:controller.phase,position:controller.position,velocity:controller.velocity,labels:controller.labels.size,pending:controller.arrivals.size,activeFrame:controller.frame!==null,frames:samples.length,averageFrameMs:gaps.reduce((a,b)=>a+b,0)/gaps.length,maxFrameMs:Math.max(...gaps),backwardFrames:samples.filter(s=>s.delta<-.001).length,errors},null,2);};
  update();
  </script><style>html,body{min-width:0}</style></html>`;
}
const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page());return;}
  const filename=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!filename.startsWith(path.join(root,'src')+path.sep)){res.writeHead(404);res.end();return;}
  const types={'.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
  fs.readFile(filename,(err,bytes)=>{if(err){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');res.end(bytes);});
});
server.listen(4387,'127.0.0.1',()=>process.stdout.write('Preview: http://127.0.0.1:4387\n'));
