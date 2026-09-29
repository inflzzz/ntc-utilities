(() => {
  if (typeof document === 'undefined' || !window.NTCLabsStatsModel) return;
  const Model=window.NTCLabsStatsModel;
  const key='ntc-labs-stats-v1';
  const read=()=>{try{return Model.normalize(JSON.parse(localStorage.getItem(key)||'null'));}catch{return Model.fresh();}};
  let state=read();
  let lastPerf=performance.now();
  let lastVisibility=document.visibilityState;
  const tools=()=>window.ntcCatalog?.tools||[];
  const categoryFor=id=>window.ntcCatalog?.byId?.get(id)?.category;
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function save(){
    try{
      const entries=Object.entries(state.days).sort(([a],[b])=>a.localeCompare(b)).slice(-370);
      state.days=Object.fromEntries(entries);
      localStorage.setItem(key,JSON.stringify(state));
      return true;
    }catch{return false;}
  }
  function flush(){
    const now=performance.now();
    if(state.enabled&&lastVisibility==='visible')Model.addActive(state,now-lastPerf,new Date());
    lastPerf=now;
    lastVisibility=document.visibilityState;
    save();
    if(document.querySelector('#ntcStatsView.active'))render();
  }
  function beginSession(){
    if(!state.enabled)return;
    state.sessions++;
    state.currentSessionMs=0;
    lastPerf=performance.now();
    save();
  }
  function recordToolOpen(id){
    if(!state.enabled)return;
    Model.recordOpen(state,id,new Date());save();
    if(document.querySelector('#ntcStatsView.active'))render();
  }
  function record(event,count=1){
    if(!state.enabled)return;
    Model.recordEvent(state,event,count,new Date());save();
    if(document.querySelector('#ntcStatsView.active'))render();
  }
  function fmt(value){return new Intl.NumberFormat('pt-BR').format(value||0);}
  function topLabel(map){const sorted=Object.entries(map||{}).filter(([,count])=>count>0).sort((a,b)=>b[1]-a[1]);if(!sorted.length)return 'Ainda sem dados';const tool=window.ntcCatalog?.byId?.get(sorted[0][0]);return tool?.name||sorted[0][0];}
  function render(){
    const summary=document.querySelector('#labsStatsSummary');if(!summary)return;
    const unique=Object.values(state.toolOpens).filter(value=>value>0).length;
    const data=[
      ['Tempo neste app',Model.formatDuration(state.totalActiveMs)],
      ['Sessões',fmt(state.sessions)],
      ['Ferramentas usadas',fmt(unique)],
      ['Mais aberta',topLabel(state.toolOpens)]
    ];
    summary.innerHTML=data.map(([label,value])=>`<article class="labs-stat-tile"><span>${escape(label)}</span><strong>${escape(value)}</strong></article>`).join('');
    const toolList=document.querySelector('#labsStatsToolList');
    const rows=Object.entries(state.toolOpens).filter(([,count])=>count>0).sort((a,b)=>b[1]-a[1]).slice(0,10);
    toolList.innerHTML=rows.length?rows.map(([id,count])=>{const tool=window.ntcCatalog?.byId?.get(id);return `<div class="labs-stat-row"><span>${escape(tool?.name||id)}</span><strong>${fmt(count)}</strong></div>`;}).join(''):'<p class="labs-muted">As ferramentas que você abrir aparecerão aqui.</p>';
    const days=document.querySelector('#labsStatsDays');
    const today=new Date();
    const list=Array.from({length:7},(_,index)=>{const day=new Date(today);day.setDate(today.getDate()-(6-index));const item=state.days[Model.dayKey(day)];return {label:new Intl.DateTimeFormat('pt-BR',{weekday:'short'}).format(day).replace('.',''),date:day,ms:item?.activeMs||0};});
    const max=Math.max(1,...list.map(item=>item.ms));
    days.innerHTML=list.map(item=>`<div class="labs-day-bar" title="${item.date.toLocaleDateString('pt-BR')}: ${Model.formatDuration(item.ms)}"><span>${escape(item.label)}</span><i style="--fill:${Math.max(item.ms?4:0,item.ms/max*100)}%"></i><b>${escape(Model.formatDuration(item.ms))}</b></div>`).join('');
    const bestHour=state.activeHours.indexOf(Math.max(0,...state.activeHours));
    const bestDay=state.activeWeekdays.indexOf(Math.max(0,...state.activeWeekdays));
    const weekdays=['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
    const eventLabels={conversions:'Conversões',generations:'Gerações',filesProcessed:'Arquivos processados',approxFileBytes:'Dados processados (aprox.)',musicPlays:'Reproduções de música',musicListeningMs:'Tempo de música',randomDraws:'Sorteios',diceRolls:'Rolagens de dados',coinFlips:'Jogadas de moeda',projectsCreated:'Boards criados',projectsExported:'Boards exportados'};
    const actions=Object.entries(state.events).filter(([,count])=>count>0).sort((a,b)=>b[1]-a[1]).map(([name,count])=>`${escape(eventLabels[name]||'Ações locais')}: ${escape(name==='musicListeningMs'?Model.formatDuration(count):fmt(count))}`).join(' · ');
    const hasActiveTime=state.totalActiveMs>0;
    document.querySelector('#labsStatsActivePeriod').textContent=`${hasActiveTime?`Horário mais ativo: ${String(bestHour).padStart(2,'0')}h · Dia mais ativo: ${weekdays[bestDay]}`:'Ainda sem tempo de uso registrado.'}${actions?` · ${actions}`:''}`;
    document.querySelector('#labsStatsOptOut').checked=!state.enabled;
    document.querySelector('#labsStatsRange').textContent=`Coleta iniciada em ${new Date(state.firstTrackedAt).toLocaleDateString('pt-BR')}`;
  }
  function setEnabled(enabled){
    if(state.enabled===enabled)return;
    if(!enabled)flush();
    state.enabled=enabled;
    if(enabled){state.sessions++;state.currentSessionMs=0;lastPerf=performance.now();lastVisibility=document.visibilityState;}
    save();render();
  }
  document.addEventListener('visibilitychange',flush);
  window.addEventListener('beforeunload',flush);
  setInterval(flush,15000);
  document.querySelector('#labsStatsReset')?.addEventListener('click',()=>document.querySelector('#labsStatsConfirm')?.showModal());
  document.querySelector('#labsStatsConfirm')?.addEventListener('close',event=>{
    if(event.target.returnValue!=='reset')return;
    const wasEnabled=state.enabled;
    state=Model.fresh();state.enabled=wasEnabled;
    if(wasEnabled){state.sessions=1;lastPerf=performance.now();lastVisibility=document.visibilityState;}
    save();render();
  });
  document.querySelector('#labsStatsOptOut')?.addEventListener('change',event=>setEnabled(!event.target.checked));
  beginSession();
  window.NTCLabsStats={recordToolOpen,record,render,reset:()=>{state=Model.fresh();save();render();},getSnapshot:()=>JSON.parse(JSON.stringify(state))};
})();
