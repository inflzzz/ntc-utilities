(() => {
  if(typeof document==='undefined'||!window.NTCLabsCore||!window.NTCLabsStorage)return;
  const core=window.NTCLabsCore,storage=window.NTCLabsStorage;
  const $=id=>document.getElementById(id);
  const result=$('labsPersonResult'),saveKey='people';
  let mode='person',current=null,focusedMember='';
  let saved=storage.read(saveKey,[]);
  if(!Array.isArray(saved))saved=[];
  saved=saved.filter(item=>item&&typeof item==='object'&&typeof item.id==='string'&&['person','family'].includes(item.kind)).slice(0,100);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmtDate=value=>{const date=new Date(`${value}T12:00:00`);return Number.isFinite(date.getTime())?date.toLocaleDateString('pt-BR'):'—';};
  function asText(person,members=[]){
    const names=new Map(members.map(member=>[member.id,member.name]));
    const lines=[`${person.name}${person.nickname?` (“${person.nickname}”)`:''}`,`${person.age} anos · ${person.gender} · nasceu em ${fmtDate(person.birthDate)}`,`${person.location}`,`Profissão: ${person.profession}`,`Escolaridade: ${person.education}`,`Situação financeira: ${person.financialSituation}`,`Estado civil: ${person.maritalStatus}`];
    for(const [label,key] of [['Personalidade','personality'],['Características positivas','positiveTraits'],['Características negativas','negativeTraits'],['Hobbies','hobbies'],['Interesses','interests'],['Gosta','likes'],['Não gosta','dislikes'],['Medos','fears'],['Hábitos','habits'],['Talentos','talents'],['Defeitos','flaws'],['Objetivos','goals'],['Sonhos','dreams'],['Fatos','facts']]){const value=person[key];if(Array.isArray(value)&&value.length)lines.push(`${label}: ${value.join(', ')}`);else if(value)lines.push(`${label}: ${value}`);}
    if(person.personalProblem)lines.push(`Pequeno problema atual: ${person.personalProblem}`);
    if(person.biography)lines.push(`Biografia: ${person.biography}`);
    if(person.relations?.length)lines.push(`Relações: ${person.relations.map(relation=>`${relation.kind} (${names.get(relation.personId)||'pessoa relacionada'})`).join(', ')}`);
    return lines.join('\n');
  }
  function currentPerson(){
    if(!current)return null;
    if(current.kind==='person')return current.person;
    return current.family.members.find(member=>member.id===focusedMember)||current.family.members[0]||null;
  }
  function personCard(person, role=''){
    const list=(label,values)=>values?.length?`<section class="labs-person-detail-block"><h3>${label}</h3><p>${values.map(esc).join(' · ')}</p></section>`:'';
    return `<article class="labs-person-detail"><div class="labs-person-topline"><span class="labs-eyebrow">${esc(role||person.familyRole||'PERSONAGEM')}</span><span>${person.age} anos · ${esc(person.gender)}</span></div><h2>${esc(person.name)}${person.nickname?` <small>“${esc(person.nickname)}”</small>`:''}</h2><div class="labs-person-facts"><span>Nascimento <b>${fmtDate(person.birthDate)}</b></span><span>${esc(person.location)}</span><span>${esc(person.profession)} · ${esc(person.education)}</span><span>${esc(person.maritalStatus)} · finanças ${esc(person.financialSituation)}</span></div><section class="labs-person-detail-block"><h3>Retrato</h3><p>${esc(person.biography||'')}</p><p>${esc(person.personality||'')}</p></section><div class="labs-person-detail-grid">${list('Pontos fortes',person.positiveTraits)}${list('Pontos a melhorar',person.negativeTraits)}${list('Hobbies e interesses',[...(person.hobbies||[]),...(person.interests||[])])}${list('Gosta / evita',[...(person.likes||[]),...(person.dislikes||[])])}${list('Hábitos e talentos',[...(person.habits||[]),...(person.talents||[])])}${list('Objetivos e sonhos',[...(person.goals||[]),...(person.dreams||[])])}${list('Fatos curiosos',person.facts)}</div>${person.personalProblem?`<p class="labs-person-problem"><b>Pequena questão pessoal:</b> ${esc(person.personalProblem)}</p>`:''}</article>`;
  }
  function renderResult(){
    if(!current){result.innerHTML='<div class="labs-empty">Gere uma pessoa ou família para começar.</div>';return;}
    const person=currentPerson();
    const familyMarkup=current.kind==='family'?`<section class="labs-family-tree"><div class="labs-section-heading"><div><span class="labs-eyebrow">RELAÇÕES CONECTADAS</span><h2>${esc(current.family.name)}</h2></div><span>${current.family.members.length} membros</span></div><div class="labs-family-members">${current.family.members.map(member=>`<button type="button" data-open-family-person="${esc(member.id)}" class="labs-family-member${member.id===person?.id?' active':''}"><strong>${esc(member.name)}</strong><span>${esc(member.familyRole||'Membro')} · ${member.age} anos</span></button>`).join('')}</div><p class="labs-muted">Pais, filhos e irmãos apontam para o mesmo membro nos dois sentidos.</p></section>`:'';
    const actionLabel=current.kind==='family'?'Salvar família':'Salvar pessoa';
    result.innerHTML=`${familyMarkup}${person?personCard(person):''}<div class="labs-actions labs-person-result-actions"><button type="button" class="outline-button" data-person-copy>Copiar texto</button><button type="button" class="outline-button" data-person-save>${actionLabel}</button><button type="button" class="outline-button" data-person-favorite>${current.favorite?'Remover favorito':'Favoritar'}</button><button type="button" class="outline-button" data-person-export>Exportar TXT</button><button type="button" class="outline-button" data-person-export-json>Exportar JSON</button></div>`;
    result.querySelectorAll('[data-open-family-person]').forEach(button=>button.addEventListener('click',()=>{focusedMember=button.dataset.openFamilyPerson;renderResult();}));
    result.querySelector('[data-person-copy]').onclick=()=>void copyCurrent();
    result.querySelector('[data-person-save]').onclick=saveCurrent;
    result.querySelector('[data-person-favorite]').onclick=()=>{
      current.favorite=!current.favorite;
      if(current.favorite)saveCurrent();
      else{const stored=saved.find(item=>item.id===current.id);if(stored){stored.favorite=false;saveState();renderSaved();}renderResult();status('Removido dos favoritos.');}
    };
    result.querySelector('[data-person-export]').onclick=()=>downloadCurrent('txt');
    result.querySelector('[data-person-export-json]').onclick=()=>downloadCurrent('json');
  }
  function saveState(){if(!storage.write(saveKey,saved))status('Não foi possível salvar: o armazenamento local está cheio.');}
  function status(message){const node=result.querySelector('.labs-person-status')||document.createElement('p');node.className='labs-person-status labs-muted';node.textContent=message;if(!node.isConnected)result.append(node);}
  function snapshot(){return current.kind==='person'?{...current,person:structuredClone(current.person)}:{...current,family:structuredClone(current.family)};}
  function saveCurrent(){
    if(!current)return;
    const copy=snapshot(),index=saved.findIndex(item=>item.id===copy.id);
    if(index>=0)saved[index]=copy;else{if(saved.length>=100)saved=saved.slice(1);saved.unshift(copy);}
    saveState();renderSaved();status(current.favorite?'Salvo nos favoritos.':'Salvo neste dispositivo.');
  }
  function exportData(){return current.kind==='person'?current.person:{...current.family,selectedPerson:currentPerson()};}
  function downloadCurrent(type){
    if(!current)return;
    const data=exportData();
    const body=type==='json'?JSON.stringify(data,null,2):current.kind==='person'?asText(data):`${data.name}\n${data.members.map(member=>`${member.familyRole}: ${member.name} (${member.age})\n${asText(member,data.members)}`).join('\n\n')}`;
    const blob=new Blob([body],{type:type==='json'?'application/json;charset=utf-8':'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${(data.name||'pessoa').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()}.${type}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function copyCurrent(){if(!current)return;const data=exportData();const text=current.kind==='person'?asText(data):`${data.name}\n\n${data.members.map(member=>`${member.familyRole}:\n${asText(member,data.members)}`).join('\n\n')}`;try{await navigator.clipboard.writeText(text);status('Informações copiadas.');}catch{await window.ntc?.copyText?.(text);status('Informações copiadas.');}}
  function renderSaved(){
    const host=$('labsSavedPeople');$('labsPeopleCount').textContent=`${saved.length} itens`;
    if(!saved.length){host.innerHTML='<p class="labs-muted">Ainda não há itens salvos.</p>';return;}
    host.innerHTML=saved.map(item=>{const name=item.kind==='person'?item.person?.name:item.family?.name||'Família';const count=item.kind==='family'?item.family?.members?.length||0:1;return `<article class="labs-saved-person"><button type="button" data-load-saved="${esc(item.id)}"><strong>${item.favorite?'★ ':''}${esc(name||'Sem nome')}</strong><span>${item.kind==='family'?`Família · ${count} membros`:`Pessoa · ${item.person?.age??'?'} anos`}</span></button><button type="button" class="labs-saved-remove" data-remove-saved="${esc(item.id)}" aria-label="Excluir ${esc(name||'item')}">Excluir</button></article>`;}).join('');
    host.querySelectorAll('[data-load-saved]').forEach(button=>button.onclick=()=>{current=snapshotStored(saved.find(item=>item.id===button.dataset.loadSaved));focusedMember=current.kind==='family'?current.family.members[0]?.id:'';renderResult();});
    host.querySelectorAll('[data-remove-saved]').forEach(button=>button.onclick=()=>{saved=saved.filter(item=>item.id!==button.dataset.removeSaved);saveState();renderSaved();});
  }
  function snapshotStored(item){return item?structuredClone(item):null;}
  const localDate=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;};
  function generate(){
    const seed=$('labsPersonSeed').value.trim(),culture=$('labsPersonCulture').value,detail=$('labsPersonDetail').value;
    try{
      if(mode==='family'){
        const family=core.generateFamily({seed,culture,detail,referenceDate:$('labsPersonReferenceDate').value||localDate(),size:Math.max(1,Math.min(8,Number($('labsFamilySize').value)||4))});
        current={id:family.id,kind:'family',family,favorite:false};focusedMember=family.members[0]?.id||'';
      }else{
        const min=Math.max(0,Math.min(110,Number($('labsPersonMinAge').value)||0)),max=Math.max(0,Math.min(110,Number($('labsPersonMaxAge').value)||110));
        if(min>max)throw new Error('A idade mínima precisa ser menor ou igual à máxima.');
        const person=core.generatePerson({seed,culture,detail,gender:$('labsPersonGender').value,minAge:min,maxAge:max,referenceDate:$('labsPersonReferenceDate').value||localDate()});
        current={id:person.id,kind:'person',person,favorite:false};focusedMember='';
      }
      window.NTCLabsStats?.record('generations');renderResult();
    }catch(error){result.innerHTML=`<p class="labs-inline-error">${esc(error.message)}</p>`;}
  }
  document.querySelectorAll('[data-person-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.personMode;document.querySelectorAll('[data-person-mode]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button));});document.querySelectorAll('.labs-person-only').forEach(item=>item.classList.toggle('hidden',mode!=='person'));document.querySelectorAll('.labs-family-only').forEach(item=>item.classList.toggle('hidden',mode!=='family'));$('labsGeneratePerson').textContent=mode==='family'?'Gerar família':'Gerar pessoa';}));
  $('labsGeneratePerson').addEventListener('click',generate);
  $('labsPersonNewSeed').addEventListener('click',()=>{$('labsPersonSeed').value=storage.id('seed');});
  $('labsPersonReferenceDate').value=localDate();
  renderSaved();renderResult();
})();
