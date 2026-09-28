(() => {
  const specs = {};
  const f = (id, label, value = '', type = 'text', options) => ({ id, label, value, type, options });
  const output = (label, value, detail = '') => ({ label, value: String(value), detail });
  const num = x => { const v = Number(String(x ?? '').replace(',', '.')); if (!Number.isFinite(v)) throw new Error('Informe um número válido.'); return v; };
  const nice = x => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 10 }).format(x);
  const units = [
    ['Comprimento', { mm:.001, cm:.01, m:1, km:1000, in:.0254, ft:.3048, yd:.9144, mi:1609.344 }],
    ['Área', { 'mm²':1e-6, 'cm²':1e-4, 'm²':1, 'km²':1e6, ha:1e4, 'ft²':.09290304, acre:4046.8564224 }],
    ['Volume', { ml:.001, L:1, 'm³':1000, 'cm³':.001, 'gal EUA':3.785411784, 'fl oz EUA':.0295735295625 }],
    ['Massa', { mg:.000001, g:.001, kg:1, t:1000, oz:.028349523125, lb:.45359237 }],
    ['Temperatura', null],
    ['Tempo', { ms:.001, s:1, min:60, h:3600, dia:86400, semana:604800 }],
    ['Velocidade', { 'm/s':1, 'km/h':1/3.6, mph:.44704, knot:.5144444444, 'ft/s':.3048 }],
    ['Aceleração', { 'm/s²':1, 'ft/s²':.3048, g:9.80665 }],
    ['Força', { N:1, kN:1000, dyn:.00001, lbf:4.4482216153 }],
    ['Torque', { 'N·m':1, 'kgf·m':9.80665, 'lbf·ft':1.3558179483 }],
    ['Pressão', { Pa:1, kPa:1000, bar:100000, atm:101325, psi:6894.7572932, mmHg:133.3223874 }],
    ['Energia', { J:1, kJ:1000, cal:4.184, kcal:4184, Wh:3600, kWh:3600000, BTU:1055.05585262 }],
    ['Potência', { W:1, kW:1000, MW:1e6, hp:745.69987158, 'BTU/h':.29307107 }],
    ['Frequência', { Hz:1, kHz:1000, MHz:1e6, GHz:1e9, rpm:1/60 }],
    ['Densidade', { 'kg/m³':1, 'g/cm³':1000, 'g/L':1, 'lb/ft³':16.01846337 }],
    ['Vazão', { 'L/s':1, 'L/min':1/60, 'm³/h':1000/3600, 'gal EUA/min':3.785411784/60 }],
    ['Ângulos', { grau:1, radiano:180/Math.PI, volta:360, gradiano:.9 }],
    ['Medidas culinárias', { ml:1, L:1000, colher_chá:5, colher_sopa:15, xícara:240, 'fl oz EUA':29.5735295625 }]
  ];
  units.forEach(([, table], index) => {
    const choices = table ? Object.keys(table) : ['°C','°F','K'];
    specs[`unit${index}`] = { fields: [f('value','Valor',1,'number'),f('from','De',choices[0],'select',choices),f('to','Para',choices[1],'select',choices)], run(v) {
      const x=num(v.value);
      if(index===4) { const c=v.from==='°C'?x:v.from==='°F'?(x-32)*5/9:x-273.15; if(c < -273.15-1e-9) throw new Error('Abaixo do zero absoluto.'); return output('Resultado',`${nice(v.to==='°C'?c:v.to==='°F'?c*9/5+32:c+273.15)} ${v.to}`); }
      return output('Resultado',`${nice(x*table[v.from]/table[v.to])} ${v.to}`);
    } };
  });
  const dataUnits={ bit:1, byte:8, kbit:1000, kB:8000, Mbit:1e6, MB:8e6, Gbit:1e9, GB:8e9, Kibit:1024, KiB:8192, Mibit:1048576, MiB:8388608, Gibit:1073741824, GiB:8589934592 };
  for(const [id,table] of [['digitalStorage',dataUnits],['dataRate',Object.fromEntries(Object.entries(dataUnits).map(([k,v])=>[`${k}/s`,v]))]]) {
    const options=Object.keys(table);specs[id]={fields:[f('value','Valor',1,'number'),f('from','De',options[0],'select',options),f('to','Para',options[3],'select',options)],run:v=>output('Resultado',`${nice(num(v.value)*table[v.from]/table[v.to])} ${v.to}`)};
  }
  specs.resolution={fields:[f('width','Largura original',1920,'number'),f('height','Altura original',1080,'number'),f('newWidth','Nova largura',1280,'number')],run:v=>output('Nova resolução',`${num(v.newWidth)} × ${Math.round(num(v.height)*num(v.newWidth)/num(v.width))}`)};
  specs.pixelDensity={fields:[f('pixels','Pixels',1920,'number'),f('inches','Polegadas',15.6,'number')],run:v=>output('PPI',nice(num(v.pixels)/num(v.inches)))};
  specs.typography={fields:[f('value','Valor',12,'number'),f('dpi','DPI',96,'number'),f('from','De','pt','select',['pt','px']),f('to','Para','px','select',['pt','px'])],run:v=>output('Resultado',`${nice(v.from===v.to?num(v.value):v.from==='pt'?num(v.value)*num(v.dpi)/72:num(v.value)*72/num(v.dpi))} ${v.to}`)};
  specs.currency={fields:[f('value','Valor',100,'number'),f('from','De','BRL','select',['BRL','USD','EUR','GBP','JPY','CAD','AUD','CHF']),f('to','Para','USD','select',['BRL','USD','EUR','GBP','JPY','CAD','AUD','CHF'])],run:async v=>{const r=await window.ntc.catalogCurrency({amount:num(v.value),from:v.from,to:v.to});return output('Conversão',`${nice(r.amount)} ${v.to}`,`Cotação de ${r.date} · Frankfurter${r.cached?' · dados em cache':''}`);}};
  const zoneParts=(date,zone)=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  specs.timezones={fields:[f('value','Data e hora na origem','2026-09-24T12:00','datetime-local'),f('from','Fuso de origem','America/Sao_Paulo','select',['America/Sao_Paulo','UTC','Europe/Lisbon','Europe/London','America/New_York','Asia/Tokyo','Asia/Shanghai','Australia/Sydney']),f('to','Fuso de destino','Europe/Lisbon','select',['America/Sao_Paulo','UTC','Europe/Lisbon','Europe/London','America/New_York','Asia/Tokyo','Asia/Shanghai','Australia/Sydney'])],run:v=>{const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v.value);if(!match)throw new Error('Data inválida.');const [year,month,day,hour,minute]=match.slice(1).map(Number);const wall=Date.UTC(year,month-1,day,hour,minute);if(!Number.isFinite(wall))throw new Error('Data inválida.');let instant=wall;for(let i=0;i<4;i++){const p=zoneParts(new Date(instant),v.from);const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);instant+=wall-represented;}const check=zoneParts(new Date(instant),v.from);if([check.year,check.month,check.day,check.hour,check.minute].join(',')!==[year,month,day,hour,minute].join(','))throw new Error('Esse horário não existe no fuso de origem devido à mudança de horário de verão.');return output('Horário no destino',new Intl.DateTimeFormat('pt-BR',{timeZone:v.to,dateStyle:'full',timeStyle:'short'}).format(new Date(instant)),`De ${v.from} para ${v.to}.`);}};
  specs.dateFormats={fields:[f('date','Data','2026-09-24','date')],run:v=>{const d=new Date(`${v.date}T12:00:00`);if(Number.isNaN(d.getTime()))throw new Error('Data inválida.');return output('Formatos',`${d.toLocaleDateString('pt-BR')} · ${v.date} · ${d.toLocaleDateString('en-US')}`);}};
  specs.timestamp={fields:[f('value','ISO ou timestamp Unix','2026-09-24T12:00:00Z')],run:v=>{const number=Number(v.value);const d=/^\d{9,13}$/.test(v.value)?new Date(number<1e12?number*1000:number):new Date(v.value);if(Number.isNaN(d.getTime()))throw new Error('Data inválida.');return output('ISO · segundos Unix',`${d.toISOString()} · ${Math.floor(d.getTime()/1000)}`);}};
  const parseHex=h=>{const value=String(h).trim().replace('#','');if(!/^[a-f\d]{6}$/i.test(value))throw new Error('Use HEX com seis dígitos.');return [0,2,4].map(i=>parseInt(value.slice(i,i+2),16));};
  specs.colors={fields:[f('hex','Cor HEX','#4d8bca','color')],run:v=>{const [r,g,b]=parseHex(v.hex),R=r/255,G=g/255,B=b/255,max=Math.max(R,G,B),min=Math.min(R,G,B),delta=max-min;let h=0;if(delta){if(max===R)h=((G-B)/delta)%6;else if(max===G)h=(B-R)/delta+2;else h=(R-G)/delta+4;h=(h*60+360)%360;}const l=(max+min)/2,s=delta?delta/(1-Math.abs(2*l-1)):0,sv=max?delta/max:0,k=1-max;return {...output('RGB · HSL · HSV · CMYK',`rgb(${r}, ${g}, ${b}) · hsl(${Math.round(h)}°, ${Math.round(s*100)}%, ${Math.round(l*100)}%) · hsv(${Math.round(h)}°, ${Math.round(sv*100)}%, ${Math.round(max*100)}%) · cmyk(${Math.round((1-R-k)/(1-k||1)*100)}%, ${Math.round((1-G-k)/(1-k||1)*100)}%, ${Math.round((1-B-k)/(1-k||1)*100)}%, ${Math.round(k*100)}%)`),color:v.hex};}};
  specs.numberBases={fields:[f('value','Inteiro','255'),f('from','Base de entrada','10','select',['2','8','10','16'])],run:v=>{const base=Number(v.from),s=String(v.value).trim().toLowerCase(),digits='0123456789abcdef';if(!s||![...s.replace(/^-/,'')].every(x=>digits.indexOf(x)>=0&&digits.indexOf(x)<base))throw new Error('Número inválido para esta base.');let x=0n;for(const ch of s.replace(/^-/,''))x=x*BigInt(base)+BigInt(digits.indexOf(ch));if(s.startsWith('-'))x=-x;return output('Binário · octal · decimal · hexadecimal',`${x.toString(2)} · ${x.toString(8)} · ${x.toString(10)} · ${x.toString(16).toUpperCase()}`);}};
  const romanTable=[['M',1000],['CM',900],['D',500],['CD',400],['C',100],['XC',90],['L',50],['XL',40],['X',10],['IX',9],['V',5],['IV',4],['I',1]];
  specs.roman={fields:[f('value','Número (1–3999)','2026')],run:v=>{let x=Number(v.value);if(!Number.isInteger(x)||x<1||x>3999)throw new Error('Use inteiro entre 1 e 3999.');let text='';for(const [symbol,size] of romanTable)while(x>=size){text+=symbol;x-=size;}return output('Romano',text);}};
  specs.characters={fields:[f('value','Caractere ou código Unicode','A')],run:v=>{const raw=String(v.value),cp=/^(?:U\+|0x)?[0-9A-F]{4,6}$/i.test(raw)?parseInt(raw.replace(/^(?:U\+|0x)/i,''),16):raw.codePointAt(0);if(cp===undefined||cp>0x10ffff)throw new Error('Caractere inválido.');return output('Caractere · código',`${String.fromCodePoint(cp)} · U+${cp.toString(16).toUpperCase().padStart(4,'0')} · ${cp}`);}};
  const textSpec=(id,label,fn)=>{specs[id]={fields:[f('text',label,'Exemplo de texto','textarea')],run:v=>output('Resultado',fn(String(v.text)))};};
  textSpec('letterCase','Texto',x=>`MAIÚSCULAS: ${x.toLocaleUpperCase('pt-BR')}\nminúsculas: ${x.toLocaleLowerCase('pt-BR')}\nTítulo: ${x.toLocaleLowerCase('pt-BR').replace(/\b\p{L}/gu,s=>s.toLocaleUpperCase('pt-BR'))}`);
  textSpec('slug','Texto',x=>x.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''));
  textSpec('base64','Texto',x=>{const bytes=new TextEncoder().encode(x);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);});
  textSpec('urlEncoding','Texto',encodeURIComponent);
  textSpec('htmlEntities','Texto',x=>x.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])));
  specs.jsonFormat={fields:[f('text','JSON','{"ok":true}','textarea'),f('mode','Formato','Formatar','select',['Formatar','Minificar'])],run:v=>output('JSON',JSON.stringify(JSON.parse(v.text),null,v.mode==='Formatar'?2:0))};
  specs.jsonYaml={fields:[f('text','JSON ou YAML','{"nome":"Ana"}','textarea'),f('direction','Direção','JSON → YAML','select',['JSON → YAML','YAML → JSON'])],run:v=>{if(!window.ntc?.catalogStructured)throw new Error('Conversor estruturado indisponível.');return window.ntc.catalogStructured({format:'yaml',direction:v.direction,text:v.text}).then(r=>output('Resultado',r));}};
  specs.jsonXml={fields:[f('text','JSON ou XML','{"nome":"Ana"}','textarea'),f('direction','Direção','JSON → XML','select',['JSON → XML','XML → JSON'])],run:v=>{if(!window.ntc?.catalogStructured)throw new Error('Conversor estruturado indisponível.');return window.ntc.catalogStructured({format:'xml',direction:v.direction,text:v.text}).then(r=>output('Resultado',r));}};
  specs.subtitles={fields:[f('text','Conteúdo SRT ou VTT','1\n00:00:01,000 --> 00:00:03,000\nOlá!','textarea'),f('direction','Direção','SRT → VTT','select',['SRT → VTT','VTT → SRT'])],run:v=>{if(v.direction==='SRT → VTT')return output('WebVTT','WEBVTT\n\n'+v.text.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g,'$1.$2'));return output('SRT',v.text.replace(/^WEBVTT\s*/,'').replace(/(\d\d:\d\d:\d\d)\.(\d\d\d)/g,'$1,$2'));}};
  window.ntcConverterSpecs=specs;
})();
