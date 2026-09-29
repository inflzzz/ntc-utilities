(() => {
  if(typeof document==='undefined'||!window.NTCLabsCore||!window.NTCLabsStorage)return;
  const $=id=>document.getElementById(id),core=window.NTCLabsCore,storage=window.NTCLabsStorage;
  const key='daily-history',dateInput=$('labsDailyDate');
  let history=storage.read(key,[]);if(!Array.isArray(history))history=[];
  history=history.filter(value=>/^\d{4}-\d\d-\d\d$/.test(value)).slice(-120);
  let currentDate='';
  const items=[['Número do dia','number',value=>new Intl.NumberFormat('pt-BR').format(value)],['Cor do dia','color',value=>value],['Letra do dia','letter',value=>value],['Palavra do dia','word',value=>value],['Dado do dia','die',value=>`d20 → ${value}`],['Moeda do dia','coin',value=>value],['Carta do dia','card',value=>value],['Porcentagem do dia','percentage',value=>`${value}%`],['Emoji do dia','emoji',value=>value],['Desafio do dia','challenge',value=>value],['Escolha do dia','choice',value=>value]];
  const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function localDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  async function copy(text){try{await navigator.clipboard.writeText(text);}catch{await window.ntc?.copyText?.(text);}}
  function saveHistory(){history=[...new Set([...history,currentDate])].sort().slice(-120);storage.write(key,history);renderHistory();}
  function resultText(result){return items.map(([label,key,format])=>`${label}: ${format(result[key])}`).join('\n');}
  function render(){
    currentDate=dateInput.value||localDate();
    let result;try{result=core.dailyRandom(currentDate);}catch{$('labsDailyResults').innerHTML='<p class="labs-inline-error">Data inválida.</p>';return;}
    $('labsDailyResults').innerHTML=`<article class="labs-daily-date-banner"><span>DAILY RANDOM · DIA ${result.dayNumber}</span><strong>${new Date(`${currentDate}T12:00:00`).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</strong><button type="button" id="labsDailyCopyDate" class="outline-button">Copiar resultados deste dia</button></article>${items.map(([label,key,format])=>`<article class="labs-daily-card${key==='color'?' labs-daily-color':''}" ${key==='color'?`style="--daily-color:${esc(result.color)}"`:''}><div><span>${esc(label)}</span><strong>${esc(format(result[key]))}</strong></div><button type="button" data-copy-daily="${esc(key)}" aria-label="Copiar ${esc(label)}">Copiar</button></article>`).join('')}`;
    $('labsDailyCopyDate').onclick=()=>void copy(resultText(result));
    $('labsDailyResults').querySelectorAll('[data-copy-daily]').forEach(button=>button.onclick=()=>{const item=items.find(row=>row[1]===button.dataset.copyDaily);if(item){void copy(`${item[0]}: ${item[2](result[item[1]])}`);button.textContent='Copiado';setTimeout(()=>{if(button.isConnected)button.textContent='Copiar';},1200);}});
    saveHistory();
  }
  function renderHistory(){const host=$('labsDailyHistory');const entries=[...history].reverse().slice(0,18);host.innerHTML=entries.length?entries.map(date=>`<button type="button" data-daily-history="${date}" class="${date===currentDate?'active':''}">${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})}</button>`).join(''):'<span class="labs-muted">As datas consultadas ficam aqui.</span>';host.querySelectorAll('[data-daily-history]').forEach(button=>button.onclick=()=>{dateInput.value=button.dataset.dailyHistory;render();});}
  dateInput.value=localDate();dateInput.addEventListener('change',render);
  $('labsDailyToday').onclick=()=>{dateInput.value=localDate();render();};
  $('labsDailyCopyAll').onclick=async()=>{const result=core.dailyRandom(currentDate||localDate());await copy(resultText(result));$('labsDailyCopyAll').textContent='Copiado';setTimeout(()=>{$('labsDailyCopyAll').textContent='Copiar tudo';},1300);};
  render();
})();
