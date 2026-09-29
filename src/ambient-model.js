(() => {
  const legacy={ 'rain-light':'rain.light','rain-heavy':'rain.heavy',wind:'wind.soft',fire:'fire.fireplace',forest:'forest.day',ocean:'water.ocean',river:'water.river',waterfall:'water.waterfall',night:'forest.night',white:'noise.white',pink:'noise.pink',brown:'noise.brown' };
  const limit=value=>Math.max(0,Math.min(100,Number.isFinite(Number(value))?Number(value):35));
  function migrate(raw){
    const old=raw&&typeof raw==='object'?raw:{};const sounds={};
    for(const [id,value] of Object.entries(old.sounds&&typeof old.sounds==='object'?old.sounds:{})){const mapped=legacy[id]||id;if(!sounds[mapped]&&value&&typeof value==='object')sounds[mapped]={on:!!value.on,volume:limit(value.volume),muted:!!value.muted};}
    const presets=(Array.isArray(old.presets)?old.presets:[]).filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string').slice(0,30).map(item=>({id:item.id.slice(0,80),name:item.name.slice(0,48),sounds:Object.fromEntries(Object.entries(item.sounds&&typeof item.sounds==='object'?item.sounds:{}).map(([id,value])=>[legacy[id]||id,{on:!!value?.on,volume:limit(value?.volume)}]))}));
    return {version:2,master:limit(old.master??48),sounds,presets,selected:typeof old.selected==='string'?old.selected:'builtin-rain'};
  }
  const api={migrate,legacy,limit};if(typeof module!=='undefined'&&module.exports)module.exports=api;if(typeof window!=='undefined')window.NTCAmbientModel=api;
})();
