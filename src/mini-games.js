(() => {
  const key='ntc-minigame-reaction-best';
  const reaction={
    fields:[],
    customHtml:'<button type="button" class="reaction-pad" id="reactionPad">Clique para começar</button>',
    mount(form,show){
      const pad=form.querySelector('#reactionPad');let state='idle',started=0,timer=null;
      pad.onclick=()=>{
        if(state==='idle'||state==='done'){
          state='waiting';pad.className='reaction-pad waiting';pad.textContent='Aguarde o sinal';
          const delay=1000+crypto.getRandomValues(new Uint32Array(1))[0]%3500;
          timer=setTimeout(()=>{state='ready';started=performance.now();pad.className='reaction-pad ready';pad.textContent='CLIQUE!';},delay);
          return;
        }
        if(state==='waiting'){
          clearTimeout(timer);state='done';pad.className='reaction-pad';pad.textContent='Cedo demais · tentar novamente';
          show({label:'Teste de reflexo',value:'Você clicou antes do sinal.'});return;
        }
        const ms=Math.round(performance.now()-started),previous=Number(localStorage.getItem(key));
        if(!previous||ms<previous)localStorage.setItem(key,String(ms));
        state='done';pad.className='reaction-pad';pad.textContent='Jogar de novo';
        show({label:'Tempo de reação',value:`${ms} ms`,detail:`Melhor marca neste computador: ${localStorage.getItem(key)} ms`});
      };
      return()=>clearTimeout(timer);
    }
  };
  window.ntcGameSpecs={reaction};
})();
