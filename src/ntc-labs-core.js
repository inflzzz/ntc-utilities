(() => {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  function hashSeed(seed) {
    let hash = 2166136261;
    for (const char of String(seed)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }
  function createRandom(seed) {
    let state = hashSeed(seed);
    return () => {
      state = (state + 0x6D2B79F5) | 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (random, items) => items[Math.floor(random() * items.length)];
  const int = (random, min, max) => min + Math.floor(random() * (max - min + 1));
  const cultures = {
    'pt-BR': { label:'Brasil', female:['Ana','Beatriz','Camila','Clara','Daniela','Elisa','Fernanda','Isabela','Júlia','Larissa','Marina','Nina','Olívia','Rafaela','Sofia','Vitória'], male:['André','Bruno','Caio','Daniel','Eduardo','Felipe','Gabriel','Heitor','João','Lucas','Mateus','Rafael','Samuel','Theo','Vinícius'], neutral:['Alex','Ariel','Dani','Noa','Sam'], surnames:['Almeida','Barbosa','Carvalho','Costa','Ferreira','Gomes','Lima','Martins','Melo','Nascimento','Oliveira','Pereira','Ribeiro','Santos','Souza'], places:['Belo Horizonte','Curitiba','Florianópolis','Fortaleza','Manaus','Porto Alegre','Recife','Rio de Janeiro','Salvador','São Paulo'], fictional:['Aurora do Sul','Boa Esperança','Campo das Nuvens','Vale Sereno'] },
    'pt-PT': { label:'Portugal', female:['Beatriz','Carolina','Catarina','Inês','Leonor','Lia','Matilde','Margarida','Mariana','Rita','Sofia','Teresa'], male:['Afonso','André','Diogo','Duarte','Francisco','Gonçalo','João','Martim','Miguel','Rafael','Tomás','Vicente'], neutral:['Alex','Dani','Noa','Sam'], surnames:['Alves','Carvalho','Coelho','Costa','Ferreira','Lopes','Martins','Mendes','Oliveira','Pereira','Rodrigues','Silva','Sousa'], places:['Braga','Coimbra','Faro','Lisboa','Porto','Setúbal'], fictional:['Baía Serena','Monte Claro','Vila das Flores'] },
    en: { label:'English', female:['Alice','Amelia','Ava','Charlotte','Evelyn','Grace','Harper','Iris','Maya','Nora','Ruby','Zoe'], male:['Arthur','Benjamin','Caleb','Ethan','Henry','Jack','Leo','Oliver','Owen','Theodore','William'], neutral:['Alex','Casey','Jordan','Morgan','Riley'], surnames:['Bennett','Brooks','Carter','Clark','Foster','Hayes','Lewis','Morgan','Parker','Reed','Turner','Wright'], places:['Bristol','Dublin','Leeds','London','Manchester','Portland','Seattle'], fictional:['Ashford Bay','Cedar Grove','New Haven'] }
  };
  const professions = {
    school:['estudante','aprendiz de desenho','pratica futebol na escola','tem curiosidade por ciência'],
    teen:['estudante do ensino médio','jovem aprendiz','faz estágio em design','presta apoio em informática'],
    adult:['trabalha com análise de sistemas','atua em arquitetura','trabalha com artesanato','atua em bibliotecas','chef de cozinha','atua como designer','trabalha em enfermagem','atua com fotografia','cuida de jardins','trabalha com mecânica','atua como docente','trabalha em laboratório','atua em medicina veterinária']
  };
  const traitSets = {
    positive:['demonstra atenção aos detalhes','mantém a curiosidade','costuma agir com determinação','observa antes de agir','tem paciência','valoriza a responsabilidade','gosta de conversar'],
    negative:['sente desconforto com mudanças','se distrai com facilidade','pode perder a paciência quando está cansado(a)','às vezes insiste demais nas próprias ideias','evita pedir ajuda','procrastina tarefas repetitivas','às vezes fala antes de pensar','pode buscar perfeição em excesso'],
    hobbies:['cozinhar','cuidar de plantas','caminhar','desenhar','fotografar','jogar tabuleiro','ler ficção','ouvir música','pedalar','programar','tocar violão','viajar'],
    interests:['astronomia','cinema','história local','natureza','tecnologia','culinária','música brasileira','arquitetura'],
    likes:['conversas longas','lugares tranquilos','comida caseira','dias chuvosos','trabalho em equipe','rotina bem organizada'],
    dislikes:['barulho muito alto','atrasos sem aviso','desperdício','lugares lotados','reuniões sem pauta','frio intenso'],
    fears:['decepcionar quem ama','altura','perder a memória','mudanças inesperadas','ficar sem tempo para a família'],
    habits:['anota ideias no celular','faz listas para tudo','leva um livro na bolsa','prepara café ao acordar','caminha para pensar','guarda lembranças de viagens'],
    talents:['explicar assuntos difíceis','improvisar receitas','lembrar rostos','perceber detalhes','resolver problemas práticos','contar histórias'],
    flaws:['guarda preocupações para si','demora a tomar decisões','se cobra demais','esquece onde deixou as chaves','tem dificuldade de dizer não'],
    goals:['aprender uma nova habilidade','conhecer outro país','guardar dinheiro para um projeto','ter mais tempo livre','concluir um curso'],
    dreams:['abrir um pequeno ateliê','morar perto da natureza','publicar um livro','viajar de trem pelo país','trabalhar com algo que ajude outras pessoas'],
    problems:['está tentando equilibrar trabalho e descanso','precisa organizar melhor as finanças','sente falta de um amigo que mora longe','está adiando uma conversa importante','anda com pouco tempo para um hobby'],
    facts:['tem uma receita de família que prepara em datas especiais','já fez uma viagem sem planejar quase nada','guarda ingressos de shows e museus','prefere mensagens de voz curtas','aprendeu uma habilidade nova no último ano','tem uma planta que recebeu de presente']
  };
  const biographies = ['Aprendeu cedo a gostar de observar como as coisas funcionam e costuma guardar histórias das pessoas que conhece.','Cresceu em uma família próxima e encontrou nos pequenos rituais do dia um jeito de manter a calma.','Mudou de cidade há alguns anos e ainda descobre novos lugares favoritos nos fins de semana.','Sempre gostou de aprender por conta própria e costuma compartilhar o que descobre com os amigos.','Tem um círculo pequeno de amizades, mas faz questão de estar presente quando alguém precisa.'];
  function parseReferenceDate(value){
    if(typeof value==='string'){const match=value.match(/^(\d{4})-(\d\d)-(\d\d)$/);if(match){const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12);if(date.getFullYear()===Number(match[1])&&date.getMonth()===Number(match[2])-1&&date.getDate()===Number(match[3]))return date;}}
    const parsed=value?new Date(value):new Date();return Number.isFinite(parsed.getTime())?parsed:new Date();
  }
  function birthDateForAge(age, random, referenceDate = new Date()) {
    const month = int(random, 0, 11);
    const day = int(random, 1, Math.min(28, new Date(referenceDate.getFullYear() - age, month + 1, 0).getDate()));
    const year = referenceDate.getFullYear() - age;
    return `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function makePerson(random, options = {}) {
    const cultureKey = cultures[options.culture] ? options.culture : 'pt-BR';
    const culture = cultures[cultureKey];
    const minimum=Math.max(0,Math.min(110,Math.trunc(Number(options.minAge??18))||0));
    const maximum=Math.max(minimum,Math.max(0,Math.min(110,Math.trunc(Number(options.maxAge??75))||0)));
    const age = Math.max(0, Math.min(110, Number.isInteger(options.age) ? options.age : int(random, minimum, maximum)));
    const gender = ['feminino','masculino','não binário'].includes(options.gender) && options.gender !== 'aleatório' ? options.gender : pick(random,['feminino','masculino','não binário']);
    const first = pick(random, gender === 'feminino' ? culture.female : gender === 'masculino' ? culture.male : culture.neutral);
    const surname = pick(random,culture.surnames);
    const secondSurname = random() > .42 ? pick(random,culture.surnames.filter(name => name !== surname)) : '';
    const level = ['essencial','equilibrado','detalhado'].includes(options.detail) ? options.detail : 'equilibrado';
    const profession = age < 13 ? pick(random,professions.school) : age < 18 ? pick(random,professions.teen) : pick(random,professions.adult);
    const education = age < 6 ? 'educação infantil' : age < 14 ? 'ensino fundamental' : age < 18 ? 'ensino médio em andamento' : pick(random,['ensino médio completo','curso técnico','graduação','pós-graduação','formação profissional']);
    const wealth = age < 18 ? 'dependente da família' : /análise|arquitetura|enfermagem|docente|veterinária|laboratório/.test(profession) ? pick(random,['estável','confortável','estável']) : pick(random,['em construção','estável','confortável','variável']);
    const take = (key, n) => [...new Set(Array.from({length:n},()=>pick(random,traitSets[key])))];
    const refDate = parseReferenceDate(options.referenceDate);
    const person = {
      id:`person-${Math.floor(random()*0xFFFFFFFF).toString(16).padStart(8,'0')}`,
      name:`${first} ${surname}${secondSurname ? ` ${secondSurname}` : ''}`,
      nickname:random() > .52 ? pick(random,['Bia','Cacá','Dani','Dudu','Jô','Lê','Lu','Nico','Rafa','Téo']) : '',
      age,birthDate:birthDateForAge(age,random,refDate),gender,
      location:`${pick(random,culture.places.concat(culture.fictional))}, ${culture.label}`,
      profession,financialSituation:wealth,education,
      maritalStatus:age < 15 ? 'solteiro(a)' : age < 20 ? pick(random,['solteiro(a)','namorando']) : pick(random,['solteiro(a)','namorando','casado(a)','divorciado(a)','em união estável']),
      personality:take('positive',2).join(', '),positiveTraits:take('positive',2),negativeTraits:take('negative',2),
      hobbies:take('hobbies',int(random,2,4)),interests:take('interests',int(random,2,3)),likes:take('likes',2),dislikes:take('dislikes',2),
      fears:take('fears',2),habits:take('habits',2),talents:take('talents',2),flaws:take('flaws',2),
      goals:take('goals',2),dreams:take('dreams',1),personalProblem:pick(random,traitSets.problems),
      relations:[],friends:[],partner:null,children:[],siblings:[],parents:[],
      biography:pick(random,biographies),facts:take('facts',2),culture:cultureKey
    };
    if (level === 'essencial') { person.interests=[]; person.likes=[]; person.dislikes=[]; person.fears=[]; person.habits=[]; person.talents=[]; person.flaws=[]; person.dreams=[]; person.personalProblem=''; person.facts=person.facts.slice(0,1); }
    if (level === 'equilibrado') { person.facts=person.facts.slice(0,1); person.dislikes=person.dislikes.slice(0,1); }
    return person;
  }
  function generatePerson(options = {}) {
    const seed = String(options.seed || `${Date.now()}-${Math.random()}`);
    const random = createRandom(seed);
    return makePerson(random, options);
  }
  function generateFamily(options = {}) {
    const seed = String(options.seed || `${Date.now()}-${Math.random()}`);
    const random = createRandom(seed);
    const size = Math.max(1,Math.min(8,Number(options.size)||4));
    const culture = cultures[options.culture] ? options.culture : 'pt-BR';
    const members=[];
    if(size===1){const person=makePerson(random,{culture,detail:options.detail,age:int(random,18,72)});person.maritalStatus='solteiro(a)';members.push(person);return {id:`family-${hashSeed(seed).toString(16)}`,name:'Família',seed,members};}
    const parentAge=int(random,29,60);
    const parent=makePerson(random,{culture,detail:options.detail,age:parentAge,gender:'feminino'});
    parent.familyRole='Mãe';parent.maritalStatus='casado(a)'; members.push(parent);
    const otherAge=Math.max(25,Math.min(65,parentAge+int(random,-8,8)));
    const partner=makePerson(random,{culture,detail:options.detail,age:otherAge,gender:'masculino'});
    partner.familyRole='Pai';partner.maritalStatus='casado(a)'; members.push(partner);
    parent.partner=partner.id;partner.partner=parent.id;
    parent.relations.push({personId:partner.id,kind:'parceiro(a)'});partner.relations.push({personId:parent.id,kind:'parceiro(a)'});
    const childCount=size-2;
    const maxChildAge=Math.max(0,Math.min(40,Math.min(parentAge,otherAge)-18));
    for(let index=0;index<childCount;index++){
      const gender=pick(random,['feminino','masculino','não binário']);
      const childAge=int(random,0,maxChildAge);
      const child=makePerson(random,{culture,detail:options.detail,age:childAge,gender});
      child.familyRole=index===0?'Filho(a)':`Filho(a) ${index+1}`;
      child.parents=[parent.id,partner.id];
      child.relations.push({personId:parent.id,kind:'mãe'},{personId:partner.id,kind:'pai'});
      parent.children.push(child.id);partner.children.push(child.id);
      parent.relations.push({personId:child.id,kind:'filho(a)'});partner.relations.push({personId:child.id,kind:'filho(a)'});
      for(const sibling of members.filter(member=>member.familyRole?.startsWith('Filho'))){child.siblings.push(sibling.id);sibling.siblings.push(child.id);child.relations.push({personId:sibling.id,kind:'irmão/irmã'});sibling.relations.push({personId:child.id,kind:'irmão/irmã'});}
      members.push(child);
    }
    return {id:`family-${hashSeed(seed).toString(16)}`,name:'Família',seed,members};
  }

  const challenges=['Ouça uma música que você não escuta há muito tempo.','Faça uma pausa de cinco minutos sem olhar para uma tela.','Descubra uma curiosidade sobre um lugar que gostaria de visitar.','Envie uma mensagem gentil para alguém de quem sente saudade.','Experimente um caminho diferente em uma tarefa simples.','Anote uma ideia que você costuma deixar para depois.','Leia algumas páginas de algo que desperte curiosidade.','Organize uma pequena área que você usa todos os dias.','Faça algo criativo por dez minutos, sem buscar perfeição.','Observe o céu por um minuto e descreva o que vê.','Aprenda uma palavra nova e tente usá-la hoje.','Prepare uma bebida com calma, sem fazer outra coisa ao mesmo tempo.','Agradeça a alguém por uma ajuda recente.','Escolha uma foto antiga e relembre a história por trás dela.','Alongue-se por dois minutos entre as tarefas.','Descubra uma música de um gênero que quase nunca ouve.','Faça uma pergunta interessante durante uma conversa.','Escreva três coisas que tornaram o dia um pouco melhor.','Experimente desenhar um objeto que esteja perto de você.','Deixe uma notificação não essencial para depois.','Planeje uma pequena coisa agradável para esta semana.','Faça uma pausa ao ar livre, mesmo que seja curta.','Reorganize uma playlist para combinar com seu humor.','Conte uma história curta da sua infância para alguém.','Pesquise a origem de uma palavra que usa muito.','Escolha um objeto e imagine como ele foi feito.','Faça uma tarefa pequena que estava sendo adiada.','Assista ao pôr do sol ou ao amanhecer, se puder.','Compartilhe uma recomendação cultural com alguém.','Passe alguns minutos sem pressa em uma atividade cotidiana.','Troque uma ideia com alguém sobre um tema novo.','Crie um título para o seu dia de hoje.','Faça uma lista curta de coisas que quer aprender.','Experimente uma receita simples que nunca fez.','Escolha uma lembrança e registre por que ela é importante.','Dê uma volta curta e repare em algo que normalmente passa despercebido.','Limpe uma superfície pequena e aproveite a sensação de espaço.','Faça uma pergunta cuja resposta você realmente queira ouvir.','Escolha uma cor e encontre três exemplos dela ao seu redor.','Separe dez minutos para um hobby que anda esquecido.'];
  const words=['acaso','brisa','calma','descoberta','encontro','faísca','horizonte','ideia','janela','luz','memória','nuvem','origem','pausa','quintal','rumo','sossego','travessia','universo','vontade'];
  const emojis=['🌙','🌿','☕','🪐','🌧️','🧩','📚','🪁','🐚','✨','🍊','🌻','🎧','🧭','🪴','🎨'];
  const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const suits=['Copas','Ouros','Paus','Espadas'];
  const ranks=['Ás','2','3','4','5','6','7','8','9','10','Valete','Dama','Rei'];
  function dailyRandom(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(`${String(dateValue).slice(0,10)}T12:00:00`);
    if (!Number.isFinite(date.getTime())) throw new Error('Data inválida.');
    const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const random=createRandom(`ntc-daily-v1:${key}`);
    const hex=()=>`#${Math.floor(random()*0x1000000).toString(16).padStart(6,'0').toUpperCase()}`;
    const result={date:key,dayNumber:Math.floor((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-Date.UTC(date.getFullYear(),0,0))/86400000),color:hex(),number:int(random,100,99999),letter:letters[Math.floor(random()*letters.length)],word:pick(random,words),die:int(random,1,20),coin:random()<.5?'Cara':'Coroa',card:`${pick(random,ranks)} de ${pick(random,suits)}`,percentage:int(random,1,100),emoji:pick(random,emojis),challenge:pick(random,challenges),choice:pick(random,['Sim','Não','Talvez','Mais tarde','Agora','Depende'])};
    return result;
  }

  const units = [
    {id:'ms',aliases:['milissegundo','milissegundos','ms'],dimension:'time',factor:.001,label:'milissegundos',base:'segundos'},
    {id:'s',aliases:['segundo','segundos','second','seconds','sec','s'],dimension:'time',factor:1,label:'segundos',base:'segundos'},
    {id:'min',aliases:['minuto','minutos','minute','minutes','min'],dimension:'time',factor:60,label:'minutos',base:'segundos'},
    {id:'h',aliases:['hora','horas','hour','hours','h'],dimension:'time',factor:3600,label:'horas',base:'segundos'},
    {id:'day',aliases:['dia','dias','day','days'],dimension:'time',factor:86400,label:'dias',base:'segundos'},
    {id:'year',aliases:['ano','anos','year','years'],dimension:'time',factor:31557600,label:'anos',base:'segundos'},
    {id:'mm',aliases:['milimetro','milimetros','mm'],dimension:'distance',factor:.001,label:'milímetros',base:'metros'},
    {id:'cm',aliases:['centimetro','centimetros','cm'],dimension:'distance',factor:.01,label:'centímetros',base:'metros'},
    {id:'m',aliases:['metro','metros','m'],dimension:'distance',factor:1,label:'metros',base:'metros'},
    {id:'km',aliases:['quilometro','quilometros','kilometro','kilometros','km'],dimension:'distance',factor:1000,label:'quilômetros',base:'metros'},
    {id:'mi',aliases:['milha','milhas','mile','miles','mi'],dimension:'distance',factor:1609.344,label:'milhas',base:'metros'},
    {id:'m2',aliases:['metro quadrado','metros quadrados','m2','m²'],dimension:'area',factor:1,label:'m²',base:'m²'},
    {id:'km2',aliases:['quilometro quadrado','quilometros quadrados','km2','km²'],dimension:'area',factor:1e6,label:'km²',base:'m²'},
    {id:'ha',aliases:['hectare','hectares','ha'],dimension:'area',factor:10000,label:'hectares',base:'m²'},
    {id:'ml',aliases:['mililitro','mililitros','ml'],dimension:'volume',factor:.001,label:'mililitros',base:'litros'},
    {id:'l',aliases:['litro','litros','l'],dimension:'volume',factor:1,label:'litros',base:'litros'},
    {id:'m3',aliases:['metro cubico','metros cubicos','m3','m³'],dimension:'volume',factor:1000,label:'m³',base:'litros'},
    {id:'g',aliases:['grama','gramas','g'],dimension:'mass',factor:.001,label:'gramas',base:'quilogramas'},
    {id:'kg',aliases:['quilo','quilos','quilograma','quilogramas','kg'],dimension:'mass',factor:1,label:'quilogramas',base:'quilogramas'},
    {id:'ton',aliases:['tonelada','toneladas','ton','t'],dimension:'mass',factor:1000,label:'toneladas',base:'quilogramas'},
    {id:'byte',aliases:['byte','bytes','b'],dimension:'storage',factor:1,label:'bytes',base:'bytes'},
    {id:'kb',aliases:['kb','kilobyte','kilobytes'],dimension:'storage',factor:1000,label:'KB',base:'bytes'},
    {id:'mb',aliases:['mb','megabyte','megabytes'],dimension:'storage',factor:1e6,label:'MB',base:'bytes'},
    {id:'gb',aliases:['gb','gigabyte','gigabytes'],dimension:'storage',factor:1e9,label:'GB',base:'bytes'},
    {id:'tb',aliases:['tb','terabyte','terabytes'],dimension:'storage',factor:1e12,label:'TB',base:'bytes'},
    {id:'person',aliases:['pessoa','pessoas','habitante','habitantes'],dimension:'people',factor:1,label:'pessoas',base:'pessoas'},
    {id:'page',aliases:['pagina','paginas','pagina de texto','paginas de texto'],dimension:'pages',factor:1,label:'páginas',base:'páginas'},
    {id:'item',aliases:['item','itens','unidade','unidades','objetos','livros'],dimension:'count',factor:1,label:'itens',base:'unidades'},
    {id:'brl',aliases:['real','reais','r$'],dimension:'money-brl',factor:1,label:'reais',base:'R$'},
    {id:'usd',aliases:['dolar','dolares','usd','us$','$'],dimension:'money-usd',factor:1,label:'dólares',base:'US$'},
    {id:'mspeed',aliases:['m/s','metro por segundo','metros por segundo'],dimension:'speed',factor:1,label:'m/s',base:'m/s'},
    {id:'kph',aliases:['km/h','quilometro por hora','quilometros por hora'],dimension:'speed',factor:1/3.6,label:'km/h',base:'m/s'},
    {id:'j',aliases:['j','joule','joules'],dimension:'energy',factor:1,label:'J',base:'joules'},
    {id:'kj',aliases:['kj','quilojoule','quilojoules'],dimension:'energy',factor:1000,label:'kJ',base:'joules'},
    {id:'mj',aliases:['mj','megajoule','megajoules'],dimension:'energy',factor:1e6,label:'MJ',base:'joules'},
    {id:'wh',aliases:['wh','watt hora','watt-hora'],dimension:'energy',factor:3600,label:'Wh',base:'joules'},
    {id:'kwh',aliases:['kwh','quilowatt hora','quilowatt-hora'],dimension:'energy',factor:3.6e6,label:'kWh',base:'joules'}
  ];
  const scales={'mil':1e3,'milhao':1e6,'milhoes':1e6,'bilhao':1e9,'bilhoes':1e9,'trilhao':1e12,'trilhoes':1e12};
  function parseLocalizedNumber(raw) {
    let value=String(raw).trim().replace(/\s/g,'');
    if(value.includes(',')){value=value.replace(/\./g,'').replace(',','.');}
    else if(/^\d{1,3}(\.\d{3})+$/.test(value)){value=value.replace(/\./g,'');}
    const number=Number(value);
    if(!Number.isFinite(number)||number<0)throw new Error('Digite uma quantidade positiva válida.');
    return number;
  }
  function parseMeasure(input) {
    const text=normalize(input).replace(/\bde\b/g,' ').replace(/\s+/g,' ').trim();
    const match=text.match(/^([\d.,]+)\s*(.*?)$/);
    if(!match)throw new Error('Use uma quantidade seguida de uma unidade, por exemplo “1 bilhão de segundos”.');
    let amount=parseLocalizedNumber(match[1]);
    let remainder=match[2].trim();
    const scaleWord=Object.keys(scales).sort((a,b)=>b.length-a.length).find(word=>new RegExp(`^${word}(?:\\s|$)`).test(remainder));
    if(scaleWord){amount*=scales[scaleWord];remainder=remainder.slice(scaleWord.length).trim();}
    const unit=units.filter(candidate=>candidate.aliases.includes(remainder)).sort((a,b)=>b.id.length-a.id.length)[0];
    if(!unit)throw new Error('Unidade não reconhecida. Confira o exemplo ou use uma unidade suportada.');
    if(amount>Number.MAX_SAFE_INTEGER||amount*unit.factor>Number.MAX_SAFE_INTEGER)throw new Error('O número é grande demais para uma comparação precisa.');
    return {amount,unit,valueBase:amount*unit.factor,dimension:unit.dimension,sourceLabel:`${new Intl.NumberFormat('pt-BR',{maximumSignificantDigits:8}).format(amount)} ${unit.label}`};
  }
  function format(value, maximumFractionDigits=2) {
    return new Intl.NumberFormat('pt-BR',{maximumFractionDigits,maximumSignificantDigits:7}).format(value);
  }
  // Comparações didáticas usam referências fixas, não universais: Terra ≈40.075 km no equador; campo ilustrativo 105×68 m dentro das faixas da IFAB; piscina idealizada 50×25×2 m; elefante de referência 6 t; estádio 70 mil lugares; livro 300 páginas; armazenamento decimal SI; ano médio 365,25 dias; som no ar seco a 20 °C ≈343 m/s. Valores monetários nunca consultam cotação.
  function compareMeasure(input) {
    const parsed=parseMeasure(input);
    if(!Number.isFinite(parsed.valueBase))throw new Error('O número é grande demais para uma comparação precisa.');
    const value=parsed.valueBase;
    const comparisons=[];
    const add=(quantity,label)=>{if(Number.isFinite(quantity)&&quantity>=0)comparisons.push(`≈ ${format(quantity)} ${label}`);};
    switch(parsed.dimension){
      case'time':{
        const seconds=value;
        if(parsed.unit.id!=='year')add(seconds/31557600,'anos (ano médio de 365,25 dias)');
        if(parsed.unit.id!=='day')add(seconds/86400,'dias');
        if(parsed.unit.id!=='h')add(seconds/3600,'horas');
        break;
      }
      case'distance':{
        if(parsed.unit.id!=='km')add(value/1000,'quilômetros');add(value/40075000,'voltas na circunferência equatorial da Terra (40.075 km)');add(value/299792458,'segundos-luz');
        break;
      }
      case'area':{
        if(parsed.unit.id!=='km2')add(value/1e6,'km²');add(value/7140,'campos de futebol de 105 × 68 m');add(value/10000,'hectares');
        break;
      }
      case'volume':{
        if(parsed.unit.id!=='m3')add(value/1000,'m³');add(value/2500000,'piscinas de 50 × 25 × 2 m');add(value,'garrafas de 1 litro');
        break;
      }
      case'mass':{
        if(parsed.unit.id!=='ton')add(value/1000,'toneladas');add(value/6000,'massas de elefantes de referência (6 t cada)');add(value,'pacotes de 1 kg');
        break;
      }
      case'storage':{
        if(parsed.unit.id!=='gb')add(value/1e9,'GB decimais');if(parsed.unit.id!=='tb')add(value/1e12,'TB decimais');add(value/700e6,'CDs de 700 MB (aprox.)');
        break;
      }
      case'people':{
        add(value/70000,'estádios com capacidade para 70 mil pessoas');add(value,'pessoas');
        break;
      }
      case'pages': add(value/300,'livros com 300 páginas');add(value,'páginas');break;
      case'count': add(value,'itens');break;
      case'money-brl': add(value,'R$');add(value/100,'grupos de R$ 100 (comparação aritmética)');break;
      case'money-usd': add(value,'US$');add(value/100,'grupos de US$ 100 (comparação aritmética)');break;
      case'speed': add(value*3.6,'km/h');add(value/343,'vezes a velocidade do som no ar a 20 °C (343 m/s)');break;
      case'energy': add(value/3.6e6,'kWh');add(value/1e6,'MJ');break;
      default: throw new Error('Esta dimensão ainda não possui comparações confiáveis.');
    }
    const unitLabel=parsed.unit.dimension==='money-brl'?'R$':parsed.unit.dimension==='money-usd'?'US$':parsed.unit.label;
    const normalized=`${format(parsed.amount)} ${unitLabel}`;
    const result={input:String(input),source:normalized,dimension:parsed.dimension,approximate:true,comparisons:comparisons.slice(0,3),references:{earthEquatorialCircumferenceKm:40075,footballPitchM2:105*68,olympicPoolLitres:50*25*2*1000,elephantMassKg:6000,stadiumSeats:70000,bookPages:300,decimalBytesPerGB:1e9,decimalBytesPerTB:1e12,secondsPerMeanYear:31557600,speedOfSoundMpsAt20C:343}};
    return result;
  }

  const api={hashSeed,createRandom,generatePerson,generateFamily,dailyRandom,parseMeasure,compareMeasure,cultures};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.NTCLabsCore=api;
})();
