/* Single source of truth for navigation, search, and grouped tool panels. */
(() => {
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    network: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
    document: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
    swap: '<path d="M4 7h15l-3-3M20 17H5l3 3"/><path d="M19 7v4M5 17v-4"/>',
    spark: '<path d="m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    productivity: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 8h8v8H8zM8 2v4M16 2v4M8 18v4M16 18v4"/>',
    health: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"/><path d="M3.5 12h5l2-3 3 6 2-3h5"/>',
    display: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/>',
    game: '<path d="M6 9h12a4 4 0 0 1 3.8 5.2l-.8 2.5a2 2 0 0 1-3.3.8L15 15H9l-2.7 2.5a2 2 0 0 1-3.3-.8l-.8-2.5A4 4 0 0 1 6 9z"/><path d="M7 11v4M5 13h4M16 12h.01M19 14h.01"/>',
    history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    rng: '<path d="m12 3 2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5zM19 16v6M16 19h6"/>',
    randomPerson: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0M18 4a3 3 0 0 1 0 6M20 14a5 5 0 0 1 2 4"/>',
    ambientMixer: '<path d="M3 9h3l4-4v14l-4-4H3zM14 9a4 4 0 0 1 0 6M16.5 6.5a8 8 0 0 1 0 11"/>',
    ntcStats: '<path d="M4 19V5M4 19h17M8 16v-4M13 16V8M18 16V4"/>',
    dailyRandom: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    realLife: '<path d="M3 6h18M6 3v6M18 3v6M5 10l3 10h8l3-10M9 15h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.8 1L15.7 21h-2.8l-.3-2a8 8 0 0 1-1.8-1l-1.7.6-1.4-2.4L9.1 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.8-1l.3-2h2.8l.3 2a8 8 0 0 1 1.8 1l1.7-.6 1.4 2.4L19.5 13a8 8 0 0 1-.1 2z"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    qr: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14v2M14 19h2M19 19h2v2"/>',
    color: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.7-3.1l-.2-.3a1.5 1.5 0 0 1 1.2-2.3H18a3 3 0 0 0 3-3c0-5.1-4-9.3-9-9.3z"/><path d="M7.5 11h.01M10 7.5h.01M15 8h.01"/>'
  };
  const categories = [
    ['network', 'Internet e Rede', 'network'], ['images', 'Imagens', 'image'],
    ['audio', 'Áudio e Música', 'audio'], ['video', 'Vídeo', 'video'],
    ['documents', 'Documentos', 'document'], ['pdf', 'PDF', 'pdf'],
    ['time', 'Relógios e Estudos', 'clock'], ['productivity', 'Produtividade', 'productivity'],
    ['health', 'Saúde e bem-estar', 'health'], ['system', 'Sistema / Tela', 'display'], ['security', 'Segurança', 'shield'], ['converters', 'Conversores', 'swap'],
    ['generators', 'Geradores', 'spark'], ['games', 'Jogos e Sorteios', 'game'], ['labs', 'NTC Labs', 'spark']
  ].map(([id, name, icon]) => ({ id, name, icon }));
  const tools = [];
  function add(category, group, items, kind = 'utility') {
    for (const item of items) {
      const [id, name, target = '', aliases = '', panel = '', visible = true] = item;
      tools.push({ id, name, category, group, kind, target: target || id, aliases: aliases.split('|').filter(Boolean), panel: panel || null, visible });
    }
  }
  add('network', 'Conexão', [
    ['downloader', 'Downloader', 'downloader', 'baixar vídeos|youtube'],
    ['speedTest', 'Teste de velocidade', '', 'internet|download|upload'], ['ping', 'Ping'],
    ['ip', 'IP público e local'], ['ports', 'Portas abertas neste PC', '', 'localhost|portas locais'],
    ['whois', 'Registro de domínio', '', 'whois|rdap'], ['siteStatus', 'Verificar site', '', 'site online|disponibilidade']
  ], 'mixed');
  add('images', 'Edição', [
    ['image', 'Editor de imagem', '', 'recortar|cortar|girar|paleta|remover fundo|exif|marca d’água|redimensionar|comprimir|juntar|favicon', 'image'],
    ['imageConvert', 'Converter formato', '', 'png|jpg|jpeg|webp|heic|avif', 'image', false],
    ['backgroundRemoval', 'Remover fundo', '', 'recorte automático', 'image', false],
    ['batchResize', 'Redimensionar', '', 'lote', 'image', false],
    ['batchCompress', 'Comprimir', '', 'lote', 'image', false],
    ['exifStrip', 'Remover metadados', '', 'exif', 'image', false],
    ['imageWatermark', 'Marca d’água', '', '', 'image', false],
    ['joinImages', 'Juntar imagens', '', '', 'image', false],
    ['cropImage', 'Recortar', '', 'cortar', 'image', false],
    ['rotateImage', 'Girar ou espelhar', '', '', 'image', false],
    ['favicon', 'Favicon', '', '', 'image', false],
    ['palette', 'Paleta de uma imagem', '', 'extrair cores', 'image', false]
  ], 'mixed');
  add('images', 'Ferramenta de tela', [['colorPicker', 'Seletor de cor da tela', 'colorPicker', 'conta-gotas']], 'existing');
  add('audio', 'Áudio', [
    ['musicPlayer', 'Player de música', 'musicPlayer'], ['converter', 'Editor de áudio', 'converter'],
    ['microphoneTest', 'Teste de microfone', 'microphoneTest'],
    ['voiceModifier', 'Modificador de Voz', 'voiceModifier', 'voz|pitch|formant|efeitos de voz|microfone'],
    ['metronome', 'Metrônomo'], ['tapBpm', 'BPM por toques']
  ], 'mixed');
  add('video', 'Vídeo', [
    ['videoEditor', 'Editor de vídeo', 'videoEditor'], ['video', 'Conversor de vídeo', 'video'],
    ['recorder', 'Gravar tela', 'recorder'], ['webcamTest', 'Teste de webcam', 'webcamTest']
  ], 'existing');
  add('documents', 'Escrita', [['documents', 'Editor de documentos e notas', 'documents']], 'existing');
  add('pdf', 'PDF', [['pdf', 'Leitor e ferramentas de PDF', 'pdf']], 'existing');
  add('time', 'Tempo e estudo', [
    ['timeTools', 'Relógio mundial, clima e alarmes', 'timeTools'], ['studyTools', 'Pomodoro e flashcards', 'studyTools']
  ], 'existing');
  add('productivity', 'Arquivos e captura', [
    ['screenshot', 'Captura de tela', 'screenshot'], ['autoclicker', 'Auto-clicker', 'autoclicker'],
    ['renamer', 'Renomear arquivos', 'renamer'], ['compressor', 'Compressor de mídia', 'compressor'],
    ['clipboardHistory', 'Área de transferência', 'clipboardHistory'],
    ['storageAnalyzer', 'Analisador de Armazenamento', 'storageAnalyzer', 'disco|ssd|hd|espaço|treemap|maiores arquivos|tamanho em disco']
  ], 'existing');
  add('health', 'Saúde e bem-estar', [['medicineReminders', 'Lembrete de Medicamentos', 'medicineReminders', 'remédios|doses|horários de medicamentos|lembrete de remédio']], 'existing');
  add('system', 'Tela', [['screenLight', 'Luz da Tela', 'screenLight', 'temperatura de cor|luz noturna|gamma|brilho|monitor']], 'existing');
  add('system', 'Programas', [['uninstaller', 'Desinstalador', 'uninstaller', 'desinstalar|remover programas|sobras|quarentena|revo|aplicativos instalados']], 'existing');
  add('security', 'Privacidade', [['security', 'Senhas, hash e proteção de arquivos', 'security']], 'existing');

  add('converters', 'Ferramentas', [['converterPanel', 'Conversores', '', 'medidas|unidades|moedas|datas|cores|texto|números|arquivos', 'converters']]);
  const converterGroups = [
    ['Medidas', [['unit0','Comprimento'],['unit1','Área'],['unit2','Volume'],['unit3','Massa'],['unit4','Temperatura'],['unit5','Tempo'],['unit6','Velocidade'],['unit7','Aceleração'],['unit8','Força'],['unit9','Torque'],['unit10','Pressão'],['unit11','Energia'],['unit12','Potência'],['unit13','Frequência'],['unit14','Densidade'],['unit15','Vazão'],['unit16','Ângulos'],['unit17','Medidas culinárias']]],
    ['Tecnologia e tempo', [['digitalStorage','Bits e bytes'],['dataRate','Taxa de dados'],['resolution','Resolução'],['pixelDensity','DPI e PPI'],['typography','Pixels e pontos'],['currency','Moedas'],['timezones','Fusos horários'],['dateFormats','Formatos de data'],['timestamp','Timestamp']]],
    ['Cores e números', [['colors','Cor e formatos'],['numberBases','Bases numéricas'],['roman','Números romanos'],['characters','Caractere Unicode']]],
    ['Texto e dados', [['letterCase','Maiúsculas e minúsculas'],['slug','Slug'],['base64','Base64'],['urlEncoding','Codificação de URL'],['htmlEntities','Entidades HTML'],['jsonFormat','Formatar JSON'],['jsonYaml','JSON e YAML'],['jsonXml','JSON e XML'],['subtitles','Legendas SRT e VTT'],['archives','ZIP e TAR'],['documentFiles','Documento para texto ou PDF']]]
  ];
  for (const [group, rows] of converterGroups) for (const [id, name] of rows) tools.push({ id, name, category:'converters', group, kind:'utility', target:id, aliases:[], panel:'converters', visible:false });

  add('generators', 'Ferramentas', [['generatorPanel', 'Geradores', '', 'senhas|identificadores|sorteios|códigos|design|dados fictícios', 'generators']]);
  const generatorGroups = [
    ['Segredos', [['password','Senha forte'],['passphrase','Frase-senha'],['pin','PIN'],['recovery','Códigos de recuperação'],['token','Token aleatório'],['uuid4','UUID v4'],['uuid7','UUID v7'],['ulid','ULID'],['shortId','Identificador curto'],['textHash','Hash de texto']]],
    ['Pessoas e dados de teste', [['fakeName','Nome fictício'],['username','Username'],['nickname','Apelido'],['testEmail','Email de teste'],['fakeProfile','Perfil fictício'],['cpf','CPF sintético'],['cnpj','CNPJ sintético'],['testPhone','Telefone de exemplo'],['fakeAddress','Endereço fictício'],['fakeMac','MAC fictício'],['testIp','IP para documentação']]],
    ['Sorteios', [['randomNumber','Número aleatório'],['shuffle','Embaralhar lista'],['dice','Dado'],['coin','Cara ou coroa'],['teams','Equipes aleatórias'],['pairs','Pares aleatórios'],['weighted','Escolha ponderada']]],
    ['QR e códigos', [['qrLink','QR de link'],['qrWifi','QR de Wi-Fi'],['qrContact','QR de contato'],['qrEvent','QR de evento'],['qrEmail','QR de email'],['qrText','QR de texto'],['barcode','Código de barras']]],
    ['Conteúdo', [['lorem','Lorem Ipsum'],['samplePt','Texto de exemplo'],['sampleJson','JSON de exemplo']]],
    ['Design', [['randomColor','Cor aleatória'],['colorPalette','Paleta de cores'],['cssGradient','Gradiente CSS'],['cssShadow','Sombra CSS'],['svgPattern','Padrão SVG'],['identicon','Identicon'],['initials','Avatar com iniciais'],['placeholder','Imagem placeholder']]]
  ];
  for (const [group, rows] of generatorGroups) for (const [id, name] of rows) tools.push({ id, name, category:'generators', group, kind:'utility', target:id, aliases:[], panel:'generators', visible:false });
  add('games', 'Jogos e Sorteios', [['randomTools', 'Sorteios & Jogos', 'randomTools', 'decisão|moeda|roleta|equipes|cartas', '', true]]);
  add('labs', 'NTC Labs', [
    ['randomPerson', 'Pessoa Aleatória', 'randomPerson', 'pessoa fictícia|família|personagem'],
    ['ambientMixer', 'Ambient Mixer', 'ambientMixer', 'sons ambientes|chuva|ruído branco'],
    ['ntcStats', 'Estatísticas do NTC', 'ntcStats', 'uso local|tempo de uso|ferramenta favorita'],
    ['dailyRandom', 'Daily Random', 'dailyRandom', 'aleatório do dia|desafio diário'],
    ['realLife', 'Quanto é isso na vida real?', 'realLife', 'comparar medidas|imaginar números']
  ], 'existing');

  tools.push({ id:'history',name:'Histórico',category:null,group:'',kind:'existing',target:'history',aliases:['arquivos recentes'],panel:null,visible:true });
  tools.push({ id:'rng',name:'NTC RNG',category:null,group:'',kind:'existing',target:'rng',aliases:['jogo de sorte'],panel:null,visible:true });
  const byId = new Map();
  for (const tool of tools) if (!byId.has(tool.id)) byId.set(tool.id, tool);
  window.ntcCatalog = { categories, tools: [...byId.values()], byId, icons };
})();
