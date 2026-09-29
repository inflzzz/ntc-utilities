(() => {
  const prefix='ntc-labs-v1:';
  function read(name,fallback,maxChars=5_000_000){
    try{const raw=localStorage.getItem(prefix+name);if(!raw||raw.length>maxChars)return fallback;return JSON.parse(raw);}catch{return fallback;}
  }
  function write(name,value,maxChars=5_000_000){
    try{const raw=JSON.stringify(value);if(raw.length>maxChars)return false;localStorage.setItem(prefix+name,raw);return true;}catch{return false;}
  }
  function id(prefixName='item'){return `${prefixName}-${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`}`;}
  const api={read,write,id,prefix};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.NTCLabsStorage=api;
})();
