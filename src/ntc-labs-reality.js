(() => {
  if(typeof document==='undefined'||!window.NTCLabsCore)return;
  const $=id=>document.getElementById(id),core=window.NTCLabsCore;
  const input=$('labsRealityInput'),output=$('labsRealityResult');
  const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const referenceNotes={time:'Ano médio adotado: 365,25 dias = 31.557.600 segundos.',distance:'Circunferência equatorial aproximada da Terra: 40.075 km; velocidade da luz: 299.792.458 m/s.',area:'Campo de referência: retângulo de 105 × 68 m (7.140 m²).',volume:'Piscina de referência idealizada: 50 × 25 × 2 m (2,5 milhões de litros).',mass:'Elefante de referência ilustrativo: 6.000 kg; massas reais variam bastante.',storage:'Conversões de armazenamento usam prefixos decimais SI (1 GB = 10⁹ bytes; 1 TB = 10¹² bytes).',count:'Referências ilustrativas: estádio de 70 mil lugares; livro de 300 páginas.',speed:'Velocidade do som aproximada no ar a 20 °C: 343 m/s.',energy:'Conversão exata de unidades: 1 Wh = 3.600 J; 1 kWh = 3,6 MJ.', 'money-brl':'Comparações monetárias são apenas divisões aritméticas; não representam poder de compra.', 'money-usd':'Comparações monetárias são apenas divisões aritméticas; não convertem moedas nem representam poder de compra.'};
  async function copy(text){try{await navigator.clipboard.writeText(text);}catch{await window.ntc?.copyText?.(text);}}
  function compare(){
    try{
      const result=core.compareMeasure(input.value);
      output.innerHTML=`<div class="labs-reality-heading"><div><span class="labs-eyebrow">GRANDEZA NORMALIZADA</span><h2>${esc(result.source)}</h2></div><button type="button" id="labsRealityCopy" class="outline-button">Copiar resultado</button></div><p class="labs-approx-note">Comparações aproximadas, mantidas dentro da mesma dimensão. Referências simplificadas estão identificadas abaixo.</p><div class="labs-reality-comparisons">${result.comparisons.map((item,index)=>`<article><span>COMPARAÇÃO ${index+1}</span><strong>${esc(item)}</strong></article>`).join('')}</div><details class="labs-references"><summary>Como essas referências foram calculadas</summary><p>${esc(referenceNotes[result.dimension]||'Conversão dimensional direta.')}</p><p>As referências são fixas e locais; não há consulta de preços, população, clima ou conteúdo na internet.</p></details>`;
      output.querySelector('#labsRealityCopy').onclick=async()=>{await copy(`${result.source}\n${result.comparisons.join('\n')}\n${referenceNotes[result.dimension]||''}`);output.querySelector('#labsRealityCopy').textContent='Copiado';};
      window.NTCLabsStats?.record('conversions');
    }catch(error){output.innerHTML=`<p class="labs-inline-error">${esc(error.message||'Não foi possível interpretar essa medida.')}</p><p class="labs-muted">Exemplo aceito: “1 bilhão de segundos”, “10 TB”, “100 toneladas” ou “384.400 km”.</p>`;}
  }
  $('labsRealityCompare').onclick=compare;
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();compare();}});
  document.querySelectorAll('[data-example]').forEach(button=>button.onclick=()=>{input.value=button.dataset.example;compare();});
})();
