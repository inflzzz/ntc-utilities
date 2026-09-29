(() => {
  const DAY_LIMIT = 370;
  const allowedEvents = new Set(['conversions','generations','filesProcessed','approxFileBytes','musicPlays','musicListeningMs','randomDraws','diceRolls','coinFlips','projectsCreated','projectsExported']);
  const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const fresh = (now = new Date()) => ({ version:1, enabled:true, firstTrackedAt:now.toISOString(), sessions:0, totalActiveMs:0, longestSessionMs:0, currentSessionMs:0, toolOpens:{}, events:{}, hours:Array(24).fill(0), weekdays:Array(7).fill(0), activeHours:Array(24).fill(0), activeWeekdays:Array(7).fill(0), days:{} });
  function normalize(value, now = new Date()) {
    const result=fresh(now);
    if(!value||typeof value!=='object')return result;
    result.enabled=value.enabled!==false;
    result.firstTrackedAt=typeof value.firstTrackedAt==='string'&&Number.isFinite(Date.parse(value.firstTrackedAt))?value.firstTrackedAt:result.firstTrackedAt;
    const safeInt=n=>Number.isSafeInteger(n)&&n>=0?n:0;
    result.sessions=safeInt(value.sessions);
    result.totalActiveMs=safeInt(value.totalActiveMs);
    result.longestSessionMs=safeInt(value.longestSessionMs);
    result.currentSessionMs=0;
    if(value.toolOpens&&typeof value.toolOpens==='object')for(const [id,count] of Object.entries(value.toolOpens).slice(0,300))if(id!=='infiniteCanvas'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id))result.toolOpens[id]=safeInt(count);
    if(value.events&&typeof value.events==='object')for(const event of allowedEvents)result.events[event]=safeInt(value.events[event]);
    if(Array.isArray(value.hours))result.hours=Array.from({length:24},(_,i)=>safeInt(value.hours[i]));
    if(Array.isArray(value.weekdays))result.weekdays=Array.from({length:7},(_,i)=>safeInt(value.weekdays[i]));
    if(Array.isArray(value.activeHours))result.activeHours=Array.from({length:24},(_,i)=>safeInt(value.activeHours[i]));
    if(Array.isArray(value.activeWeekdays))result.activeWeekdays=Array.from({length:7},(_,i)=>safeInt(value.activeWeekdays[i]));
    if(value.days&&typeof value.days==='object')for(const [day,data] of Object.entries(value.days).sort(([a],[b])=>a.localeCompare(b)).slice(-DAY_LIMIT)){
      if(!/^\d{4}-\d\d-\d\d$/.test(day)||!data||typeof data!=='object')continue;
      result.days[day]={activeMs:safeInt(data.activeMs),opens:safeInt(data.opens),events:{}};
      for(const event of allowedEvents)result.days[day].events[event]=safeInt(data.events?.[event]);
    }
    return result;
  }
  function ensureDay(state,date=new Date()){
    const key=dayKey(date);
    state.days[key] ||= {activeMs:0,opens:0,events:{}};
    return state.days[key];
  }
  function recordOpen(state,toolId,date=new Date()){
    if(!state.enabled)return state;
    const id=String(toolId||'').slice(0,80);
    if(!/^[a-zA-Z0-9_-]+$/.test(id))return state;
    state.toolOpens[id]=(state.toolOpens[id]||0)+1;
    state.hours[date.getHours()]++;
    state.weekdays[date.getDay()]++;
    ensureDay(state,date).opens++;
    return state;
  }
  function recordEvent(state,event,count=1,date=new Date()){
    if(!state.enabled||!allowedEvents.has(event))return state;
    const amount=Number.isSafeInteger(count)&&count>0?Math.min(count,1e9):0;
    if(!amount)return state;
    state.events[event]=(state.events[event]||0)+amount;
    const day=ensureDay(state,date);day.events[event]=(day.events[event]||0)+amount;
    return state;
  }
  function addActive(state,milliseconds,date=new Date()){
    if(!state.enabled)return state;
    const ms=Number.isFinite(milliseconds)&&milliseconds>0?Math.min(Math.floor(milliseconds),60000):0;
    if(!ms)return state;
    state.totalActiveMs+=ms;
    state.currentSessionMs+=ms;
    state.longestSessionMs=Math.max(state.longestSessionMs,state.currentSessionMs);
    state.activeHours[date.getHours()]+=ms;
    state.activeWeekdays[date.getDay()]+=ms;
    ensureDay(state,date).activeMs+=ms;
    return state;
  }
  function formatDuration(milliseconds){
    if(milliseconds>0&&milliseconds<60000)return '<1 min';
    const totalMinutes=Math.floor(Math.max(0,milliseconds)/60000);
    const days=Math.floor(totalMinutes/1440),hours=Math.floor((totalMinutes%1440)/60),minutes=totalMinutes%60;
    if(days)return `${days}d ${hours}h ${minutes}min`;
    if(hours)return `${hours}h ${minutes}min`;
    return `${minutes}min`;
  }
  const api={fresh,normalize,recordOpen,recordEvent,addActive,formatDuration,allowedEvents:[...allowedEvents],dayKey};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.NTCLabsStatsModel=api;
})();
