(() => {
  const catalog=window.ntcCatalog,home=document.querySelector('#homeView'),navigation=document.querySelector('.navigation'),sidebar=document.querySelector('.sidebar');
  if(!home||!navigation||!sidebar||!catalog)return;
  const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const icon=name=>`<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${catalog.icons[name]||catalog.icons.spark}</svg>`;
  const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
  const categoryFor=id=>catalog.categories.find(c=>c.id===id);
  const toolFor=id=>catalog.byId.get(id);
  const toolsInCategory=id=>catalog.tools.filter(t=>t.category===id);
  const directToolForCategory=category=>{const visible=toolsInCategory(category.id).filter(t=>t.visible);return visible.length===1&&visible[0].name===category.name?visible[0]:null;};
  const specFor=id=>window.ntcUtilitySpecs?.[id]||window.ntcConverterSpecs?.[id]||window.ntcGeneratorSpecs?.[id]||window.ntcGameSpecs?.[id];
  const recentStorageKey='ntc-catalog-recent-tools-v1';
  const favoritesStorageKey='ntc-catalog-favorites-v1';
  let recentToolIds=[];
  try{const saved=JSON.parse(localStorage.getItem(recentStorageKey)||'[]');if(Array.isArray(saved))recentToolIds=saved.filter((id,index)=>toolFor(id)?.category&&saved.indexOf(id)===index).slice(0,5);}catch{}
  let favoriteToolIds=[];
  try{const saved=JSON.parse(localStorage.getItem(favoritesStorageKey)||'[]');if(Array.isArray(saved))favoriteToolIds=saved.filter((id,index)=>toolFor(id)&&saved.indexOf(id)===index);}catch{}
  localStorage.removeItem('ntc-catalog-category');
  let activeCategory=null,activeTool=null,activeCatalogTool=null,activeNavigationSource='home',activeRecentTool=null,activeCleanup=null,searchIndex=-1,searchResults=[],viewRevision=0;
  const searchHost=document.createElement('div');searchHost.className='catalog-search-host no-drag';
  searchHost.innerHTML=`<label class="catalog-search-label" for="catalogSearch">${icon('search')}<span class="sr-only">Buscar ferramenta</span></label><input id="catalogSearch" type="search" autocomplete="off" placeholder="Buscar ferramentas…" aria-controls="catalogSuggestions" aria-expanded="false"><div class="catalog-suggestions hidden" id="catalogSuggestions" role="listbox"></div>`;
  sidebar.insertBefore(searchHost,navigation);
  const searchInput=searchHost.querySelector('input'),suggestions=searchHost.querySelector('#catalogSuggestions');
  const favoritesMenu=document.createElement('div');favoritesMenu.className='catalog-context-menu hidden';favoritesMenu.innerHTML=`<button type="button" role="menuitem">${icon('spark')}<span></span></button>`;favoritesMenu.setAttribute('role','menu');document.body.append(favoritesMenu);
  const favoritesMenuButton=favoritesMenu.querySelector('button');let contextToolId=null;
  function hideFavoritesMenu(){favoritesMenu.classList.add('hidden');contextToolId=null;}
  document.addEventListener('contextmenu',event=>{
    const target=event.target instanceof Element?event.target.closest('[data-catalog-tool],[data-recent-tool],[data-favorite-tool],[data-main-view],[data-direct-tool],#utilityPanelChoice,#imageOperation'):null;
    if(!target)return;
    const id=target.dataset.catalogTool||target.dataset.recentTool||target.dataset.favoriteTool||target.dataset.mainView||target.dataset.directTool||(['utilityPanelChoice','imageOperation'].includes(target.id)?target.value:'');
    if(!toolFor(id))return;
    event.preventDefault();contextToolId=id;favoritesMenuButton.querySelector('span').textContent=favoriteToolIds.includes(id)?'Remover dos Favoritos':'Adicionar aos Favoritos';favoritesMenu.classList.remove('hidden');
    const rect=favoritesMenu.getBoundingClientRect(),left=Math.max(8,Math.min(event.clientX,innerWidth-rect.width-8)),top=Math.max(8,Math.min(event.clientY,innerHeight-rect.height-8));favoritesMenu.style.left=`${left}px`;favoritesMenu.style.top=`${top}px`;
  });
  favoritesMenuButton.onclick=()=>{if(contextToolId)toggleFavorite(contextToolId);hideFavoritesMenu();};
  document.addEventListener('pointerdown',event=>{if(!favoritesMenu.contains(event.target))hideFavoritesMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideFavoritesMenu();});
  window.addEventListener('resize',hideFavoritesMenu);
  document.querySelector('.content-scroll').addEventListener('scroll',hideFavoritesMenu,{passive:true});
  const utility=document.createElement('section');utility.className='view utility-view';utility.id='utilityView';
  utility.innerHTML='<div class="hero compact"><div class="eyebrow" id="utilityEyebrow"></div><h1 id="utilityTitle"></h1></div><div class="utility-layout"><form id="utilityForm" class="utility-form"></form><section class="utility-result-card hidden" id="utilityOutput" aria-live="polite"><div id="utilityResult" class="utility-result-content"></div><p id="utilityDetail"></p><div class="utility-output-actions"><button class="outline-button hidden" id="utilityCopy" type="button">Copiar</button><label class="utility-format hidden" id="utilityFormatWrap">Formato<select id="utilityFormat"></select></label><button class="outline-button hidden" id="utilitySave" type="button">Salvar cópia</button></div></section></div>';
  document.querySelector('.content-scroll').append(utility);
  const groupsFor=items=>{const map=new Map();for(const item of items){if(!map.has(item.group))map.set(item.group,[]);map.get(item.group).push(item);}return map;};
  const masterFor=panel=>catalog.tools.find(t=>t.panel===panel&&t.visible)||null;
  const panelTools=panel=>catalog.tools.filter(t=>t.panel===panel&&t.id!==masterFor(panel)?.id);
  function closeSearch(){suggestions.classList.add('hidden');searchInput.setAttribute('aria-expanded','false');searchIndex=-1;}
  function renderFavorites(){
    const host=navigation.querySelector('#catalogFavorites');if(!host)return;
    host.innerHTML=`<span class="catalog-nav-caption">FAVORITOS</span>${favoriteToolIds.length?favoriteToolIds.map(id=>{const tool=toolFor(id);return`<button type="button" class="catalog-standalone catalog-favorite-tool" data-favorite-tool="${escape(id)}">${icon(categoryFor(tool.category)?.icon||'spark')}<span>${escape(tool.name)}</span></button>`;}).join(''):'<p class="catalog-favorite-empty">Clique com o botão direito numa ferramenta para adicioná-la.</p>'}`;
    host.querySelectorAll('[data-favorite-tool]').forEach(button=>button.onclick=()=>void openTool(button.dataset.favoriteTool,{fromFavorite:true}));
  }
  function toggleFavorite(id){
    if(!toolFor(id))return;
    favoriteToolIds=favoriteToolIds.includes(id)?favoriteToolIds.filter(item=>item!==id):[id,...favoriteToolIds];
    try{localStorage.setItem(favoritesStorageKey,JSON.stringify(favoriteToolIds));}catch{}
    renderFavorites();markNav();
  }
  function renderRecentTools(){
    const host=navigation.querySelector('#catalogRecentTools');if(!host)return;
    host.classList.toggle('hidden',recentToolIds.length===0);
    host.innerHTML=recentToolIds.length?`<span class="catalog-nav-caption">RECENTES</span>${recentToolIds.map(id=>{const tool=toolFor(id);return`<button type="button" class="catalog-standalone catalog-recent-tool${activeRecentTool===id?' active':''}" data-recent-tool="${escape(id)}">${icon(categoryFor(tool.category)?.icon||'spark')}<span>${escape(tool.name)}</span></button>`;}).join('')}`:'';
    host.querySelectorAll('[data-recent-tool]').forEach(button=>button.onclick=()=>void openTool(button.dataset.recentTool,{fromRecent:true}));
  }
  function rememberRecentTool(id){
    const tool=toolFor(id);if(!tool?.category)return;
    recentToolIds=[id,...recentToolIds.filter(previous=>previous!==id)].slice(0,5);
    try{localStorage.setItem(recentStorageKey,JSON.stringify(recentToolIds));}catch{}
    renderRecentTools();
  }
  function markNav(){
    const catalogSource=activeNavigationSource==='catalog';
    navigation.querySelectorAll('.catalog-nav-group').forEach(group=>{const selected=catalogSource&&group.dataset.category===activeCategory;group.classList.toggle('selected',selected);if(selected&&!group.classList.contains('direct')&&!group.classList.contains('expanded')){group.classList.add('expanded');group.querySelector('.catalog-nav-heading').setAttribute('aria-expanded','true');}});
    navigation.querySelectorAll('[data-catalog-tool]').forEach(button=>button.classList.toggle('active',catalogSource&&button.dataset.catalogTool===activeCatalogTool));
    navigation.querySelectorAll('[data-main-view]').forEach(button=>button.classList.toggle('active',button.dataset.mainView===activeTool));
    navigation.querySelectorAll('[data-recent-tool]').forEach(button=>button.classList.toggle('active',activeNavigationSource==='recent'&&button.dataset.recentTool===activeRecentTool));
    navigation.querySelectorAll('[data-favorite-tool]').forEach(button=>button.classList.toggle('active',activeNavigationSource==='favorite'&&button.dataset.favoriteTool===activeCatalogTool));
    navigation.querySelector('[data-catalog-home]')?.classList.toggle('active',!activeCategory&&!activeTool&&home.classList.contains('active'));
  }
  function childButtons(items){
    const groups=groupsFor(items.filter(t=>t.visible));return [...groups].map(([group,tools])=>`<div class="catalog-nav-subgroup">${groups.size>1?`<span>${escape(group)}</span>`:''}${tools.map(t=>`<button type="button" class="catalog-nav-tool" data-catalog-tool="${t.id}" title="${escape(t.name)}">${escape(t.name)}</button>`).join('')}</div>`).join('');
  }
  function renderNavigation(){
    navigation.innerHTML=`<button class="nav-item catalog-home-link" type="button" data-catalog-home>${icon('home')}<span>Início</span></button><button class="catalog-standalone rng-link" type="button" data-main-view="rng">${icon('rng')}<span>NTC RNG</span></button><div class="catalog-main-links"><button class="catalog-standalone" type="button" data-main-view="history">${icon('history')}<span>Histórico</span></button></div><div id="catalogFavorites" class="catalog-favorites"></div><div id="catalogRecentTools" class="catalog-recent-tools"></div><div class="catalog-nav-caption catalog-tools-caption">FERRAMENTAS</div>${catalog.categories.map(cat=>{const items=toolsInCategory(cat.id),direct=directToolForCategory(cat);return`<section class="catalog-nav-group${direct?' direct':''}" data-category="${cat.id}"><button class="catalog-nav-heading" type="button" ${direct?`data-direct-tool="${direct.id}"`:'aria-expanded="false"'}>${icon(cat.icon)}<span>${escape(cat.name)}</span>${direct?'':`<span class="catalog-chevron">${icon('chevron')}</span>`}</button>${direct?'':`<div class="catalog-nav-children">${childButtons(items)}</div>`}</section>`;}).join('')}<button class="nav-item catalog-settings-link" type="button" data-main-view="settings">${icon('settings')}<span>Configurações</span></button>`;
    renderFavorites();
    renderRecentTools();
    navigation.querySelector('[data-catalog-home]').onclick=()=>showCategory(null);
    navigation.querySelectorAll('[data-main-view]').forEach(button=>button.onclick=()=>{const id=button.dataset.mainView;if(id==='reaction')openTool('reaction');else openView(id);});
    navigation.querySelectorAll('.catalog-nav-group').forEach(group=>group.querySelector('.catalog-nav-heading').onclick=()=>{const direct=group.querySelector('[data-direct-tool]');if(direct){void openTool(direct.dataset.directTool);return;}const expanded=group.classList.toggle('expanded');group.querySelector('.catalog-nav-heading').setAttribute('aria-expanded',String(expanded));if(expanded)showCategory(group.dataset.category);});
    navigation.querySelectorAll('[data-catalog-tool]').forEach(button=>button.onclick=()=>openTool(button.dataset.catalogTool));
  }
function openView(view){viewRevision++;if(activeCleanup){activeCleanup();activeCleanup=null;}activeCategory=null;activeCatalogTool=null;activeNavigationSource='main';localStorage.removeItem('ntc-catalog-category');navigation.querySelectorAll('.catalog-nav-group').forEach(group=>{group.classList.remove('expanded','selected');group.querySelector('.catalog-nav-heading')?.setAttribute('aria-expanded','false');});activeTool=view;activeRecentTool=null;navigateToView(view);markNav();document.querySelector('.content-scroll').scrollTop=0;}
  function showCategory(id){viewRevision++;if(activeCleanup){activeCleanup();activeCleanup=null;}activeCategory=id;activeCatalogTool=null;activeNavigationSource=id?'catalog':'home';activeTool=null;activeRecentTool=null;if(id)localStorage.setItem('ntc-catalog-category',id);else localStorage.removeItem('ntc-catalog-category');renderHome();navigateToView('home');markNav();document.querySelector('.content-scroll').scrollTop=0;}
  function renderHome(){
    const cat=categoryFor(activeCategory);
    if(!cat){home.innerHTML=`<div class="hero compact"><div class="eyebrow">CATÁLOGO</div><h1>O que você quer fazer?</h1></div><div class="catalog-category-grid">${catalog.categories.map(c=>`<button class="catalog-category-card" type="button" data-open-category="${c.id}"><span class="catalog-category-icon">${icon(c.icon)}</span><span><strong>${escape(c.name)}</strong></span><span class="catalog-card-arrow">${icon('arrow')}</span></button>`).join('')}</div>`;home.querySelectorAll('[data-open-category]').forEach(button=>button.onclick=()=>{const category=categoryFor(button.dataset.openCategory),direct=directToolForCategory(category);if(direct)void openTool(direct.id);else showCategory(category.id);});return;}
    const visible=toolsInCategory(cat.id).filter(t=>t.visible),groups=groupsFor(visible);
    home.innerHTML=`<div class="hero compact"><div class="eyebrow">${icon(cat.icon)}<span>${escape(cat.name)}</span></div><h1>${escape(cat.name)}</h1></div>${[...groups].map(([group,items])=>`<section class="catalog-group"><h2>${escape(group)}</h2><div class="catalog-tool-grid">${items.map(t=>`<button type="button" class="catalog-tool-card" data-catalog-tool="${t.id}"><span>${icon(catalog.categories.find(c=>c.id===t.category)?.icon)}<strong>${escape(t.name)}</strong></span><span>${icon('arrow')}</span></button>`).join('')}</div></section>`).join('')}`;
    home.querySelectorAll('[data-catalog-tool]').forEach(button=>button.onclick=()=>openTool(button.dataset.catalogTool));
  }
  function renderField(field){
    const value=escape(field.value??'');
    const control=field.type==='select'?`<select name="${escape(field.id)}">${(field.options||[]).map(x=>`<option value="${escape(x)}" ${String(x)===String(field.value)?'selected':''}>${escape(x)}</option>`).join('')}</select>`:field.type==='textarea'?`<textarea name="${escape(field.id)}" rows="4">${value}</textarea>`:`<input name="${escape(field.id)}" type="${escape(field.type||'text')}" value="${value}" ${field.type==='number'?'step="any"':''}>`;
    return`<label class="utility-field"><span>${escape(field.label)}</span>${control}</label>`;
  }
  function resetOutput(){const output=utility.querySelector('#utilityOutput');output.classList.add('hidden');utility.querySelector('#utilityResult').replaceChildren();utility.querySelector('#utilityDetail').textContent='';utility.querySelector('#utilityCopy').classList.add('hidden');utility.querySelector('#utilitySave').classList.add('hidden');utility.querySelector('#utilityFormatWrap').classList.add('hidden');}
  function showConverterPending(form){
    const output=utility.querySelector('#utilityOutput'),result=utility.querySelector('#utilityResult'),choice=form.querySelector('#utilityPanelChoice')?.value;
    output.classList.remove('hidden');result.replaceChildren();result.className='utility-result-content';utility.querySelector('#utilityDetail').textContent='';
    utility.querySelector('#utilityCopy').classList.add('hidden');utility.querySelector('#utilitySave').classList.add('hidden');utility.querySelector('#utilityFormatWrap').classList.add('hidden');
    const label=document.createElement('span');label.className='utility-result-label';label.textContent='Resultado';result.append(label);
    const value=form.querySelector('[name="value"]')?.value||'—',from=form.querySelector('[name="from"]')?.value,to=form.querySelector('[name="to"]')?.value;
    if(from||to){const flow=document.createElement('div');flow.className='utility-converter-flow utility-converter-pending';flow.innerHTML=`<span>${escape(value)}${from?` <small>${escape(from)}</small>`:''}</span>${icon('arrow')}<span>${choice==='currency'?'Buscando cotação…':'Calculando…'}</span>`;result.append(flow);return;}
    const placeholder=document.createElement('div');placeholder.className='utility-result-placeholder';placeholder.textContent=choice==='documentFiles'?'Escolha um documento para ver a prévia.':choice==='archives'?'Escolha um arquivo para ver a prévia.':'O resultado aparecerá aqui.';result.append(placeholder);
  }
  function showResult(answer){
    if(!answer)return;
    const output=utility.querySelector('#utilityOutput'),result=utility.querySelector('#utilityResult');output.classList.remove('hidden');result.replaceChildren();
    const label=document.createElement('span');label.className='utility-result-label';label.textContent=answer.label||'Resultado';result.append(label);
    result.className='utility-result-content';utility.querySelector('#utilityDetail').textContent='';
    if(answer.kind==='image'){
      const img=document.createElement('img');img.src=answer.value;img.alt=answer.label||'Prévia gerada';img.className='utility-preview-image';result.append(img);
      const formats=answer.formats||(answer.value.startsWith('data:image/svg')?['svg','png','jpg']:['png','jpg']);fillFormat(formats);utility.querySelector('#utilityFormatWrap').classList.remove('hidden');utility.querySelector('#utilitySave').classList.remove('hidden');utility.querySelector('#utilitySave').dataset.mode='image';utility.querySelector('#utilitySave').dataset.filename=answer.filename||'imagem';utility.querySelector('#utilitySave').dataset.value=answer.value;
    }else if(answer.swatches){
      const swatches=document.createElement('div');swatches.className='utility-swatches';for(const color of answer.swatches){const chip=document.createElement('button');chip.type='button';chip.className='utility-swatch';chip.style.setProperty('--swatch',color);chip.title=`Copiar ${color}`;chip.innerHTML=`<span>${escape(color)}</span>`;chip.onclick=async()=>{await window.ntc.copyText(color);showToast(`${color} copiado.`);};swatches.append(chip);}result.append(swatches);
      const pre=document.createElement('pre');pre.textContent=answer.value;pre.className='utility-result-text';result.append(pre);
    }else{
      const pre=document.createElement('pre');pre.className='utility-result-text';pre.textContent=String(answer.value??'');result.append(pre);
    }
    if(activeTool==='speedTest'){
      const values=[...String(answer.value).matchAll(/(Download|Upload):\s*([\d.,]+)\s*Mbps/g)];
      if(values.length){const meters=document.createElement('div');meters.className='utility-speed-meters';const max=Math.max(...values.map(row=>Number(row[2].replace(',','.'))),1);for(const row of values){const line=document.createElement('div');line.innerHTML=`<span>${escape(row[1])}</span><strong>${escape(row[2])} <small>Mbps</small></strong><i style="--fill:${Math.max(4,Math.round(Number(row[2].replace(',','.'))/max*100))}%"></i>`;meters.append(line);}result.insertBefore(meters,result.querySelector('.utility-result-text'));result.querySelector('.utility-result-text')?.classList.add('hidden');}
    }else if(['siteStatus','ping','metronome','tapBpm','reaction'].includes(activeTool)){
      const badge=document.createElement('div');badge.className=`utility-status-visual${String(answer.value).includes('Online')||String(answer.value).includes('ligado')?' positive':''}`;badge.innerHTML=`${icon(['metronome','tapBpm'].includes(activeTool)?'audio':activeTool==='reaction'?'game':'network')}<strong>${escape(String(answer.value).split('\n')[0])}</strong>`;result.insertBefore(badge,result.querySelector('.utility-result-text'));if(!String(answer.value).includes('\n'))result.querySelector('.utility-result-text')?.classList.add('hidden');
    }else if(activeTool==='generatorPanel'){
      const choice=utility.querySelector('#utilityPanelChoice')?.value;
      if(['dice','coin','randomNumber'].includes(choice)){const chips=document.createElement('div');chips.className='utility-generated-chips';for(const value of String(answer.value).split(',').slice(0,30)){const chip=document.createElement('span');chip.textContent=value.trim();chips.append(chip);}result.insertBefore(chips,result.querySelector('.utility-result-text'));if(String(answer.value).split(',').length<=30)result.querySelector('.utility-result-text')?.classList.add('hidden');}
      else if(answer.kind!=='image'&&!answer.swatches&&!answer.color&&!answer.visual)result.classList.add('utility-token-result');
    }else if(['ip','ports','whois'].includes(activeTool)){
      result.classList.add('utility-network-result');
    }
    if(activeTool==='converterPanel'&&answer.kind!=='image'){
      const form=utility.querySelector('#utilityForm'),from=form.querySelector('[name="from"]')?.value,value=form.querySelector('[name="value"]')?.value,to=form.querySelector('[name="to"]')?.value;
      if(from&&to&&value){const flow=document.createElement('div');flow.className='utility-converter-flow';flow.innerHTML=`<span>${escape(value)} <small>${escape(from)}</small></span>${icon('arrow')}<span>${escape(String(answer.value))}</span>`;result.insertBefore(flow,result.querySelector('.utility-result-text'));result.querySelector('.utility-result-text')?.classList.add('hidden');}
    }
    if(answer.color){result.style.setProperty('--result-color',answer.color);result.classList.add('utility-color-result');}else{result.style.removeProperty('--result-color');result.classList.remove('utility-color-result');}
    if(answer.visual){const visual=document.createElement('div');visual.className=`utility-generated-visual ${answer.visual.type==='gradient'?'gradient-demo':'shadow-demo'}`;if(answer.visual.type==='gradient')visual.style.background=answer.visual.value;else visual.style.boxShadow=answer.visual.value;visual.setAttribute('aria-label',answer.visual.type==='gradient'?'Prévia do gradiente':'Prévia da sombra CSS');result.append(visual);}
    if(answer.detail){utility.querySelector('#utilityDetail').textContent=answer.detail;}
    const copy=utility.querySelector('#utilityCopy');copy.classList.toggle('hidden',!answer.copyable);copy.dataset.value=String(answer.value??'');
    if(answer.kind==='file-preview'){result.classList.add('utility-file-preview');const save=utility.querySelector('#utilitySave');save.dataset.mode=answer.fileMode;save.dataset.token=answer.token;save.classList.remove('hidden');save.textContent='Salvar cópia';fillFormat(answer.formats);utility.querySelector('#utilityFormatWrap').classList.toggle('hidden',answer.formats.length<2);}
    else if(answer.kind!=='image'){utility.querySelector('#utilitySave').classList.add('hidden');utility.querySelector('#utilityFormatWrap').classList.add('hidden');}
  }
  function fillFormat(formats){const select=utility.querySelector('#utilityFormat');select.replaceChildren(...formats.map(format=>{const option=document.createElement('option');option.value=format;option.textContent=format.toUpperCase();return option;}));}
  function rememberFiles(saved,format,quality,type){if(typeof addHistory!=='function')return;const paths=saved.filePaths||[saved.filePath].filter(Boolean);for(const file of paths)addHistory({title:file.split(/[\\/]/).pop(),type,format:format.toUpperCase(),quality,size:paths.length===1&&saved.size?formatBytes(saved.size):'—',file,time:'Agora',operation:'conversion'});}
  utility.querySelector('#utilityCopy').onclick=async event=>{const value=event.currentTarget.dataset.value;if(!value)return;try{await window.ntc.copyText(value);showToast('Copiado.');}catch(error){showToast(String(error.message||error));}};
  utility.querySelector('#utilitySave').onclick=async event=>{const button=event.currentTarget,format=utility.querySelector('#utilityFormat').value;button.disabled=true;try{let saved;if(button.dataset.mode==='document')saved=await window.ntc.catalogDocumentSave({token:button.dataset.token,format});else if(button.dataset.mode==='archive')saved=await window.ntc.catalogArchiveSave({token:button.dataset.token});else if(button.dataset.value)saved=await window.ntc.catalogSave({value:button.dataset.value,kind:'image',format,filename:button.dataset.filename||'imagem'});if(saved){const name=typeof saved==='string'?saved:saved.fileName;showToast(`Salvo: ${name}`);utility.querySelector('#utilityDetail').textContent=`Cópia salva: ${name}${saved.warning?` · ${saved.warning}`:''}`;rememberFiles(saved,format,button.dataset.mode==='image'?'gerado':'convertido',button.dataset.mode==='image'?'image':button.dataset.mode);if(button.dataset.mode!=='image')button.classList.add('hidden');}}catch(error){showToast(String(error.message||error));}finally{button.disabled=false;}};
  function fillPanelSelectors(form,panel,selectedId){
    const members=panelTools(panel),byGroup=groupsFor(members);form.querySelector('#utilityPanelGroup').innerHTML=[...byGroup.keys()].map(name=>`<option value="${escape(name)}">${escape(name)}</option>`).join('');
    const tool=members.find(item=>item.id===selectedId)||members[0],selectedGroup=tool?.group||byGroup.keys().next().value||'';form.querySelector('#utilityPanelGroup').value=selectedGroup;
    const fillTools=()=>{const group=form.querySelector('#utilityPanelGroup').value,items=byGroup.get(group)||[];form.querySelector('#utilityPanelChoice').innerHTML=items.map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('');if(items.some(item=>item.id===selectedId))form.querySelector('#utilityPanelChoice').value=selectedId;};
    fillTools();return fillTools;
  }
  function panelScaffold(panel,selectedId){
    const master=masterFor(panel),members=panelTools(panel),selected=toolFor(selectedId)||members[0];
    utility.querySelector('#utilityEyebrow').innerHTML=`${icon(categoryFor(master.category)?.icon)}<span>${escape(categoryFor(master.category)?.name||'Ferramenta')}</span>`;
    utility.querySelector('#utilityTitle').textContent=master.name;
    const form=utility.querySelector('#utilityForm');form.onsubmit=event=>event.preventDefault();resetOutput();
    if(panel==='image'){activeCleanup=mountImageEditor(form,selectedId);return;}
    form.innerHTML=`<div class="utility-panel-pickers"><label class="utility-field"><span>Grupo</span><select id="utilityPanelGroup"></select></label><label class="utility-field"><span>Ferramenta</span><select id="utilityPanelChoice"></select></label></div><div id="utilityPanelFields" class="utility-panel-fields"></div><button class="primary-button utility-run" id="utilityPanelRun" type="submit">Gerar resultado</button>`;
    const refill=fillPanelSelectors(form,panel,selected?.id);
    let liveTimer=0;
    const live=()=>{if(panel!=='converters')return;showConverterPending(form);clearTimeout(liveTimer);const id=form.querySelector('#utilityPanelChoice').value;if(['currency','documentFiles','archives'].includes(id))return;const spec=specFor(id);if(!spec||spec.customHtml)return;const revision=viewRevision;liveTimer=setTimeout(()=>{Promise.resolve(spec.run(Object.fromEntries(new FormData(form)),form)).then(answer=>{if(revision===viewRevision&&form.querySelector('#utilityPanelChoice')?.value===id)showResult(answer);}).catch(()=>{if(revision===viewRevision)showConverterPending(form);});},180);};
    const renderSelected=()=>{viewRevision++;if(activeCleanup){activeCleanup();activeCleanup=null;}clearTimeout(liveTimer);const id=form.querySelector('#utilityPanelChoice').value;activeTool=master.id;markNav();resetOutput();renderSpecFields(form,id);live();};
    form.querySelector('#utilityPanelGroup').onchange=()=>{refill();renderSelected();};
    form.querySelector('#utilityPanelChoice').onchange=renderSelected;
    form.querySelector('#utilityPanelFields').oninput=live;form.querySelector('#utilityPanelFields').onchange=live;renderSelected();updatePanelSubmit();
  }
  function renderSpecFields(form,id){
    const spec=specFor(id),fieldHost=form.querySelector('#utilityPanelFields'),run=form.querySelector('#utilityPanelRun');if(!spec){fieldHost.innerHTML='<p class="utility-empty">Esta opção não está disponível.</p>';run.classList.add('hidden');return;}
    run.classList.toggle('hidden',Boolean(spec.customHtml));run.textContent=spec.action||(activeTool==='converterPanel'?'Converter':'Gerar');
    if(spec.customHtml){fieldHost.innerHTML=spec.customHtml;const cleanup=spec.mount?.(fieldHost,showResult);if(cleanup)activeCleanup=cleanup;return;}
    fieldHost.innerHTML=(spec.fields||[]).map(renderField).join('');
  }
  function mountImageEditor(form,selectedId){
    let session=null,op='imageConvert',crop=null,cropStart=null,previewReady=false,previewTimer=0,previewSequence=0;
    const members=panelTools('image'),choices=[{...toolFor('imageConvert'),group:'Formato'},{...toolFor('batchResize'),group:'Tamanho'},{...toolFor('batchCompress'),group:'Tamanho'},...members.filter(item=>!['imageConvert','batchResize','batchCompress'].includes(item.id))].filter(item=>item.id&&item.id!=='image');
    if(selectedId!=='image'&&choices.some(item=>item.id===selectedId))op=selectedId;
    form.innerHTML=`<div class="image-editor-toolbar"><button type="button" class="outline-button" id="imageChoose">Escolher imagem</button><span id="imageFileLabel" class="image-file-label">Nenhuma imagem escolhida</span></div><label class="utility-field"><span>Ferramenta</span><select id="imageOperation">${[...groupsFor(choices)].map(([group,items])=>`<optgroup label="${escape(group)}">${items.map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('')}</optgroup>`).join('')}</select></label><div class="image-editor-options" id="imageOptions"></div><div class="image-crop-stage-wrap hidden" id="imageCropWrap"><div class="image-crop-stage" id="imageCropStage"><img id="imageOriginalPreview" alt="Imagem original para selecionar o recorte"><div class="image-crop-selection hidden" id="imageCropSelection"></div></div><p>Arraste sobre a imagem para marcar o recorte.</p></div><div class="image-editor-save-row"><label class="utility-field"><span>Formato</span><select id="imageFormat"><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WebP</option></select></label><button class="primary-button" id="imagePreviewButton" type="button">Pré-visualizar</button><button class="outline-button hidden" id="imageSaveButton" type="button">Salvar cópia</button></div><section class="image-preview-panel hidden" id="imagePreviewPanel" aria-live="polite"><div class="image-preview-topline"><strong id="imagePreviewTitle">Prévia</strong><span id="imagePreviewStatus"></span></div><img id="imageEditedPreview" alt="Prévia da imagem editada" class="hidden"><div class="image-palette-grid hidden" id="imagePaletteGrid"></div></section>`;
    const operation=form.querySelector('#imageOperation'),optionHost=form.querySelector('#imageOptions'),cropWrap=form.querySelector('#imageCropWrap'),stage=form.querySelector('#imageCropStage'),selection=form.querySelector('#imageCropSelection'),original=form.querySelector('#imageOriginalPreview'),preview=form.querySelector('#imageEditedPreview'),previewPanel=form.querySelector('#imagePreviewPanel'),status=form.querySelector('#imagePreviewStatus'),save=form.querySelector('#imageSaveButton');
    const currentFields=()=>operation.value==='cropImage'?[]:specFor(operation.value)?.fields||[];
    const optionValues=()=>Object.fromEntries(new FormData(form));
    const resetPreview=()=>{previewSequence++;previewReady=false;previewPanel.classList.add('hidden');preview.classList.add('hidden');save.classList.add('hidden');save.textContent='Salvar cópia';status.classList.remove('saved','save-error');form.querySelector('#imagePaletteGrid').classList.add('hidden');};
    const schedulePreview=()=>{clearTimeout(previewTimer);if(!session||['backgroundRemoval','cropImage'].includes(op)||op==='joinImages'&&session.count<2)return;previewTimer=setTimeout(()=>form.querySelector('#imagePreviewButton').click(),260);};
    const renderOptions=()=>{op=operation.value;optionHost.innerHTML=currentFields().map(renderField).join('');cropWrap.classList.toggle('hidden',op!=='cropImage'||!session);if(op!=='joinImages')crop=null;if(op==='backgroundRemoval'||op==='favicon')form.querySelector('#imageFormat').value='png';if(op==='batchCompress')form.querySelector('#imageFormat').value='webp';resetPreview();schedulePreview();};
    const setOriginal=()=>{if(!session)return;original.src=session.preview;stage.classList.remove('hidden');form.querySelector('#imageFileLabel').textContent=session.name.join(', ')+(session.count>1?` · ${session.count} imagens`: ` · ${session.width} × ${session.height}`);cropWrap.classList.toggle('hidden',op!=='cropImage');resetPreview();schedulePreview();};
    operation.value=op;operation.onchange=renderOptions;form.querySelector('#imageFormat').onchange=()=>{resetPreview();schedulePreview();};optionHost.oninput=()=>{resetPreview();schedulePreview();};optionHost.onchange=()=>{resetPreview();schedulePreview();};renderOptions();
    form.querySelector('#imageChoose').onclick=async()=>{try{const result=await window.ntc.catalogImageOpen(['joinImages','batchResize','batchCompress'].includes(operation.value));if(!result)return;if(session)await window.ntc.catalogImageClose(session.id);session=result;crop=null;setOriginal();}catch(error){showToast(String(error.message||error));}};
    const point=e=>{const rect=original.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))};};
    const paintCrop=()=>{if(!crop){selection.classList.add('hidden');return;}selection.classList.remove('hidden');selection.style.left=`${crop.x*100}%`;selection.style.top=`${crop.y*100}%`;selection.style.width=`${crop.width*100}%`;selection.style.height=`${crop.height*100}%`;};
    stage.onpointerdown=e=>{if(op!=='cropImage'||!session)return;e.preventDefault();stage.setPointerCapture(e.pointerId);cropStart=point(e);crop={x:cropStart.x,y:cropStart.y,width:0,height:0};paintCrop();};
    stage.onpointermove=e=>{if(!cropStart)return;const p=point(e);crop={x:Math.min(p.x,cropStart.x),y:Math.min(p.y,cropStart.y),width:Math.abs(p.x-cropStart.x),height:Math.abs(p.y-cropStart.y)};paintCrop();};
    stage.onpointerup=()=>{cropStart=null;resetPreview();if(crop?.width>=.01&&crop?.height>=.01)form.querySelector('#imagePreviewButton').click();};
    form.querySelector('#imagePreviewButton').onclick=async()=>{if(!session){showToast('Escolha uma imagem primeiro.');return;}if(op==='cropImage'&&(!crop||crop.width<.01||crop.height<.01)){showToast('Arraste sobre a imagem para selecionar a área.');return;}const button=form.querySelector('#imagePreviewButton'),sequence=++previewSequence;button.disabled=true;button.textContent='Preparando prévia…';status.textContent='';form.querySelector('#imagePreviewPanel').classList.remove('hidden');form.querySelector('#imagePreviewTitle').textContent=op==='backgroundRemoval'?'Remoção de fundo · prévia':'Prévia do resultado';try{const answer=await window.ntc.catalogImagePreview({id:session.id,op,options:optionValues(),cropRect:crop,format:form.querySelector('#imageFormat').value});if(sequence!==previewSequence)return;resetPreview();previewPanel.classList.remove('hidden');if(answer.colors){const grid=form.querySelector('#imagePaletteGrid');grid.replaceChildren(...answer.colors.map(color=>{const chip=document.createElement('button');chip.type='button';chip.className='image-color-chip';chip.style.setProperty('--swatch',color);chip.innerHTML=`<span>${escape(color)}</span>`;chip.onclick=async()=>{await window.ntc.copyText(color);showToast(`${color} copiado.`);};return chip;}));grid.classList.remove('hidden');form.querySelector('#imagePreviewTitle').textContent='Paleta extraída';status.textContent=`${answer.colors.length} cores`;previewReady=true;return;}preview.src=answer.preview;preview.classList.remove('hidden');preview.classList.toggle('favicon-preview',op==='favicon');form.querySelector('#imagePreviewTitle').textContent='Prévia do resultado';const detail=op==='exifStrip'?session.hasMetadata?' · metadados removidos':' · sem metadados detectados':op==='batchCompress'?` · original ${Math.max(1,Math.round(session.sourceBytes/1024))} KB`:'';status.textContent=`${answer.width} × ${answer.height} px · ${answer.format.toUpperCase()} · ${Math.max(1,Math.round(answer.bytes/1024))} KB${detail} · não salvo${session.count>1?` · amostra de ${session.count}`:''}`;previewReady=true;save.classList.remove('hidden');}catch(error){if(sequence===previewSequence){previewPanel.classList.add('hidden');showToast(String(error.message||error));}}finally{button.disabled=false;button.textContent='Atualizar prévia';if(sequence!==previewSequence&&!previewReady){if(op==='cropImage'&&crop?.width>=.01&&crop?.height>=.01)button.click();else schedulePreview();}}};
    save.onclick=async()=>{if(!previewReady||!session)return;save.disabled=true;save.textContent='Salvando…';try{const format=form.querySelector('#imageFormat').value,result=await window.ntc.catalogImageSave({id:session.id,op,options:optionValues(),cropRect:crop,format});if(!result){save.textContent='Salvar cópia';return;}status.textContent=`Salvo: ${result.fileName}`;status.classList.add('saved');save.textContent='Salvo';showToast(`Salvo: ${result.fileName}`);rememberFiles(result,format,operation.selectedOptions[0]?.textContent||'editada','image');session=null;}catch(error){status.textContent=String(error.message||error);status.classList.add('save-error');save.textContent='Salvar cópia';}finally{save.disabled=false;}};
    return()=>{clearTimeout(previewTimer);previewSequence++;if(session)void window.ntc.catalogImageClose(session.id);};
  }
  async function openTool(id,{fromRecent=false,fromFavorite=false}={}){
    viewRevision++;
    if(activeCleanup){activeCleanup();activeCleanup=null;}
    const tool=toolFor(id);if(!tool)return;activeCatalogTool=tool.id;activeNavigationSource=fromRecent?'recent':fromFavorite?'favorite':'catalog';activeRecentTool=fromRecent?tool.id:null;if(fromRecent)renderRecentTools();else rememberRecentTool(tool.id);
    activeTool=tool.panel?masterFor(tool.panel)?.id:tool.id;activeCategory=tool.category;
    if(tool.panel){closeSearch();utility.querySelector('.utility-layout').classList.toggle('wide',tool.panel==='image');panelScaffold(tool.panel,tool.id);navigateToView('utility');markNav();document.querySelector('.content-scroll').scrollTop=0;return;}
    if(tool.target==='reaction'||tool.kind==='game'){
      closeSearch();utility.querySelector('#utilityEyebrow').innerHTML=`${icon('game')}<span>Jogo rápido</span>`;utility.querySelector('#utilityTitle').textContent=tool.name;utility.querySelector('.utility-layout').classList.remove('wide');const spec=window.ntcGameSpecs?.reaction;if(spec){const form=utility.querySelector('#utilityForm');form.innerHTML=spec.customHtml;activeCleanup=spec.mount?.(form,showResult)||null;}resetOutput();navigateToView('utility');markNav();return;
    }
    const destination=document.getElementById(`${tool.target}View`);if(destination){navigateToView(tool.target);markNav();closeSearch();return;}
    const spec=specFor(id);if(!spec){showToast('Esta ferramenta não está disponível.');return;}
    closeSearch();utility.querySelector('.utility-layout').classList.remove('wide');
    utility.querySelector('#utilityEyebrow').innerHTML=`${icon(categoryFor(tool.category)?.icon||'spark')}<span>${escape(categoryFor(tool.category)?.name||'Principal')} · ${escape(tool.group)}</span>`;
    utility.querySelector('#utilityTitle').textContent=tool.name;
    const form=utility.querySelector('#utilityForm');resetOutput();
    form.innerHTML=spec.customHtml||(spec.fields||[]).map(renderField).join('')+`<button class="primary-button utility-run" type="submit">${escape(spec.action||'Executar')}</button>`;
    if(spec.mount)activeCleanup=spec.mount(form,showResult)||null;
    form.onsubmit=async event=>{event.preventDefault();const revision=viewRevision,button=form.querySelector('[type="submit"]');if(button){button.disabled=true;button.dataset.original=button.textContent;}try{const answer=await spec.run(Object.fromEntries(new FormData(form)),form);if(revision!==viewRevision)return;showResult(answer);if(spec===window.ntcUtilitySpecs?.metronome&&button){button.textContent=answer?.value?.startsWith('Metrônomo ligado')?'Parar metrônomo':'Iniciar metrônomo';button.setAttribute('aria-pressed',String(button.textContent==='Parar metrônomo'));}}catch(error){if(revision===viewRevision)showError(error);}finally{if(button)button.disabled=false;}};
    navigateToView('utility');markNav();document.querySelector('.content-scroll').scrollTop=0;
  }
  function showError(error){const output=utility.querySelector('#utilityOutput');output.classList.remove('hidden');utility.querySelector('#utilityCopy').classList.add('hidden');utility.querySelector('#utilitySave').classList.add('hidden');utility.querySelector('#utilityFormatWrap').classList.add('hidden');utility.querySelector('#utilityDetail').textContent='';const result=utility.querySelector('#utilityResult');result.replaceChildren();result.className='utility-result-content utility-result-error';result.textContent=String(error?.message||error||'Não foi possível concluir.').replace(/^Error invoking remote method '[^']+': Error:\s*/,'');}
  function showCategoryToolOutput(spec,form){const revision=viewRevision,run=form.querySelector('#utilityPanelRun');if(activeTool==='converterPanel')showConverterPending(form);else resetOutput();if(run){run.disabled=true;run.textContent='Processando…';}Promise.resolve().then(()=>spec.run(Object.fromEntries(new FormData(form)),form)).then(answer=>{if(revision===viewRevision)showResult(answer);}).catch(error=>{if(revision===viewRevision)showError(error);}).finally(()=>{if(run){run.disabled=false;run.textContent=spec.action||(activeTool==='converterPanel'?'Converter':'Gerar');}});}
  function updatePanelSubmit(){const form=utility.querySelector('#utilityForm');form.onsubmit=event=>{event.preventDefault();const spec=specFor(form.querySelector('#utilityPanelChoice').value);if(spec)showCategoryToolOutput(spec,form);};}
  document.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key.toLowerCase()==='k'){event.preventDefault();searchInput.focus();searchInput.select();}});
  searchInput.oninput=()=>{const query=normalize(searchInput.value);if(!query){closeSearch();return;}const rank=tool=>{const name=normalize(tool.name),aliases=tool.aliases.map(normalize);if(name.startsWith(query))return 0;if(aliases.some(x=>x.startsWith(query)))return 1;if(name.includes(query))return 2;if(aliases.some(x=>x.includes(query)))return 3;return 99;};searchResults=catalog.tools.map(tool=>({tool,rank:rank(tool)})).filter(item=>item.rank<99).sort((a,b)=>a.rank-b.rank||a.tool.name.localeCompare(b.tool.name,'pt-BR')).slice(0,10).map(item=>item.tool);searchIndex=-1;suggestions.innerHTML=searchResults.length?searchResults.map((tool,index)=>`<button role="option" class="catalog-suggestion" type="button" data-index="${index}" data-catalog-tool="${escape(tool.id)}"><strong>${escape(tool.name)}</strong><small>${escape(categoryFor(tool.category)?.name||'Principal')}</small></button>`).join(''):'<div class="catalog-search-empty">Nenhuma ferramenta encontrada.</div>';suggestions.classList.remove('hidden');searchInput.setAttribute('aria-expanded','true');suggestions.querySelectorAll('[data-index]').forEach(button=>button.onmousedown=event=>{event.preventDefault();void openTool(searchResults[Number(button.dataset.index)].id);searchInput.value='';});};
  searchInput.onkeydown=event=>{if(event.key==='Escape'){closeSearch();searchInput.blur();}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){if(!searchResults.length)return;event.preventDefault();searchIndex=(searchIndex+(event.key==='ArrowDown'?1:-1)+searchResults.length)%searchResults.length;suggestions.querySelectorAll('[data-index]').forEach((button,index)=>button.classList.toggle('selected',index===searchIndex));}else if(event.key==='Enter'&&searchResults.length){event.preventDefault();void openTool(searchResults[Math.max(0,searchIndex)].id);searchInput.value='';}};
  document.addEventListener('pointerdown',event=>{if(!searchHost.contains(event.target))closeSearch();});
  window.addEventListener('ntc-catalog-panel-selected',event=>{const form=utility.querySelector('#utilityForm'),panel=event.detail?.panel,id=event.detail?.id;if(panel&&id){const master=masterFor(panel);activeTool=panel;panelScaffold(panel,id);markNav();}});
  renderNavigation();renderHome();markNav();window.ntcCatalogUi={openTool,showCategory};
})();
