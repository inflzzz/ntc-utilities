window.NTC_CHANGELOG = [
  {
    version: '1.4.0',
    date: '30 set. 2026',
    title: 'Novidades da versão 1.4.0',
    changes: [
      'Novo Desinstalador: consulte aplicativos do Windows e jogos de bibliotecas Steam, organize a lista por tamanho e execute os desinstaladores oficiais, individualmente ou em sequência.',
      'Os tamanhos das pastas de instalação são calculados em segundo plano. Estimativas e medições parciais são identificadas, e a lista é atualizada automaticamente após a desinstalação.',
      'A lista utiliza os ícones reais dos programas e jogos quando disponíveis, incluindo imagens ICO, recursos de executáveis e logos de aplicativos da Microsoft Store.',
      'Revise sobras antes de removê-las: dados pessoais ficam desmarcados por padrão, e itens compartilhados, protegidos ou sem vínculo suficiente são preservados.',
      'Histórico e quarentena permitem consultar resultados, exportar relatórios e restaurar os itens disponíveis. A limpeza do histórico preserva os backups, salvo confirmação explícita de exclusão permanente.',
      'Instalações monitoradas comparam o estado anterior e posterior do sistema para ajudar na revisão. Mudanças simultâneas de outros programas não são atribuídas automaticamente ao instalador.',
      'Atualizações agora apresentam as novidades de todas as versões entre a instalada e a disponível, agrupadas por versão. Após atualizar, o resumo mostra apenas as versões ainda não vistas.',
      'O NTC verifica novas versões a cada 15 minutos enquanto permanece aberto e ao retomar o computador. O aviso pode ser dispensado sem se repetir a cada verificação; baixar e instalar continuam sendo ações do usuário.'
    ]
  },
  {
    version: '1.3.0',
    date: '30 set. 2026',
    title: 'Novidades da versão 1.3.0',
    changes: [
      'Luz da Tela: ajuste a temperatura de cor manualmente, por perfis ou por uma agenda diária editável. Configure exceções por aplicativo, pause temporariamente e use o submenu da bandeja.',
      'A Luz da Tela confirma a aplicação da alteração e tenta restaurar a calibração anterior ao desligar ou encerrar. O ajuste atua na rampa de cor, não no brilho físico; o suporte varia conforme Windows, driver e monitor. HDR e estados não confirmados são bloqueados.',
      'Modificador de Voz: processe arquivos locais ou use o microfone com monitoramento opcional, medidores, comparação A/B e seleção de dispositivo.',
      'Monte e reordene cadeias de pitch, formantes, EQ, compressor, reverb, delay, distorção, chorus, flanger, modulação e filtros de telefone/rádio; crie presets próprios e exporte em WAV, MP3, FLAC ou Opus.',
      'O processamento é local e não cria um microfone virtual. Pitch e formantes ao vivo podem acrescentar latência perceptível; a ferramenta informa a estimativa.'
    ]
  },
  {
    version: '1.2.1',
    date: '29 set. 2026',
    title: 'Novidades da versão 1.2.1',
    changes: [
      'Revisamos a apresentação do histórico de versões para organizar melhor as novidades e facilitar a leitura.'
    ]
  },
  {
    version: '1.2.0',
    date: '29 set. 2026',
    title: 'Novidades da versão 1.2.0',
    changes: [
      'Analisador de Armazenamento: explore discos e pastas em um mapa interativo, consulte arquivos, tipos e itens maiores e refine os resultados com filtros.',
      'Em unidades NTFS compatíveis, o Fast Scan acelera a análise. O aplicativo informa qual método foi usado e, se necessário, por que recorreu ao scanner padrão.',
      'Navegação do mapa: volte ao nível anterior ou escolha um ponto do caminho sem executar a análise novamente.',
      'Ambient Mixer: biblioteca de sons em destaque e gerenciamento dos pacotes em uma área separada. Três pacotes opcionais reúnem 24 gravações CC0 para baixar e usar offline.',
      'Os pacotes têm verificação de integridade. Também é possível importar ou referenciar sons próprios, desmarcar todas as camadas e pausar ou retomar o ambiente.',
      'Lembrete de Medicamentos: organize dias e horários, acompanhe as doses e consulte notificações e histórico armazenados localmente.',
      'Testes de microfone e webcam: confira o nível e as características dos dispositivos, grave um teste de áudio, veja a prévia da câmera e capture fotos.',
      'Player de música renovado, com biblioteca local, playlists, fila e mini player.',
      'Jogos e Sorteios ganharam uma categoria própria, com decisões, moedas, roletas, listas, equipes, cartas, dados e jogos rápidos.',
      'NTC Labs reúne Pessoa Aleatória, Estatísticas do NTC, Daily Random e comparações de medidas da vida real, além do Ambient Mixer.',
      'Editor de vídeo: exportação em 4K e perfil Máxima, com qualidade aprimorada. Os arquivos podem ficar maiores e a exportação levar mais tempo.',
      'Controles de reprodução centralizados e melhor aproveitamento da área da timeline.'
    ]
  },
  {
    version: '1.1.0',
    date: '28 set. 2026',
    changes: [
      'Editor de vídeo: exportação UHD 4K (2160p) e opção Máxima, com H.264 CRF 12, codificação mais lenta e AAC 320 kb/s; arquivos podem ficar maiores e levar mais tempo.',
      'A resolução 4K amplia a saída, mas não recupera detalhes ausentes nos arquivos de origem.',
      'Controles de reprodução centralizados; a timeline vazia ocupa a área visível sem alterar a edição ou o relógio de reprodução.',
      'Histórico completo da série 1.0 mantido abaixo, incluindo o Editor de Áudio multifaixa, manutenção temporária do jogo, melhorias na Área de transferência e correções do Auto-clicker.'
    ]
  },
  {
    version: '1.0.1',
    date: '28 set. 2026',
    changes: [
      'O Editor de Áudio agora é único: o multifaixa substitui o clássico e oferece dez formatos, efeitos por clipe, trechos marcados, presets, metadados, capas e exportações separadas.',
      'Projetos antigos abrem no novo schema sem sobrescrita automática; o histórico e os downloads abrem diretamente no editor definitivo.',
      'Validados mixdowns reais de seis instrumentos, formatos de saída, metadados e capas com o FFmpeg incluído.',
      'Projetos de áudio longos mantêm a waveform leve e estável ao usar zoom na timeline.',
      'Corrigida a exportação multifaixa: um controle antigo de vídeo não interfere mais no áudio. Mixdowns WAV e MP3 com seis faixas foram validados.',
      'O editor de áudio exibe todos os clipes da faixa, mostra nomes longos por tooltip e permite usar o mesmo arquivo em mais de um clipe.',
      'Miniaturas da Área de transferência carregam ao entrar na região visível e preservam a proporção da imagem.',
      'Refinados os estados de ações dos conversores, o tempo de leitura dos avisos, a navegação e as larguras das páginas em janelas grandes.',
      'Auto-clicker instalado encontra os scripts PowerShell fora do app.asar; ambos os arquivos auxiliares são extraídos no pacote.',
      'O X mantém o aplicativo na bandeja; o menu do ícone oferece Sair do NTC Utilities.'
    ]
  },
  {
    version: '1.0.0',
    date: '28 set. 2026',
    changes: [
      'O jogo permanece visível na navegação, mas abre apenas a tela de manutenção; o progresso existente foi preservado.',
      'Editor de vídeo com workspace dedicado, timeline, prévia, propriedades e exportação. A navegação global se recolhe enquanto ele está aberto.',
      'Editor de áudio multifaixa: mixagem de stems em um WAV ou MP3, régua e zoom na timeline e reprodução que acompanha o tempo real ao minimizar e restaurar.',
      'Exportação de áudio mostra estados distintos para andamento, conclusão, cancelamento e erro, com ações para abrir a pasta ou tentar novamente.',
      'O Editor de áudio clássico continua disponível enquanto formatos, efeitos, marcadores, metadados e fila não têm paridade completa no multifaixa.',
      'Área de transferência: miniaturas de imagens carregadas sob demanda no histórico, links identificados e ações secundárias em menu compacto.',
      'Conversores e compressor: áreas de arrastar arquivos com foco de teclado e mensagens de falha mais claras.',
      'Novas ferramentas locais de documentos, PDF, estudos e segurança, com refinamentos de navegação e estabilidade.'
    ]
  },
  {
    version: '0.9.0',
    date: '24 set. 2026',
    changes: [
      'Nova área Relógios e tempo: relógios mundiais com clima, despertadores, temporizador e cronômetro em uma única ferramenta.',
      'Cidades, ordem dos cartões, alarmes e estado do temporizador e do cronômetro ficam salvos entre sessões e atualizações.',
      'Auto-clicker: envio de cliques em alta velocidade otimizado e contador de sessão atualizado com mais clareza.',
      'Player de música: a saída de áudio é reativada ao retomar a faixa restaurada depois de reabrir o aplicativo.',
      'O tema claro foi removido; o aplicativo mantém somente a aparência escura. A janela de novidades recebeu ajustes de espaçamento e alinhamento para facilitar a leitura.',
      'Os controles internos de desenvolvimento continuam disponíveis apenas na versão de desenvolvimento e não aparecem no instalador de produção.'
    ]
  },
  {
    version: '0.8.0',
    date: '24 set. 2026',
    changes: [
      'Player de música: importação de arquivos individuais, edição de nome e descrição das playlists, capas personalizadas e reordenação de faixas.',
      'Biblioteca de música: dados, capas e playlists permanecem salvos entre sessões; remover uma faixa do NTC Utilities não apaga o arquivo original do computador.',
      'Adicionados o Auto-clicker e o Seletor de cor, com controles dedicados para interação com a tela.',
      'Captura de tela: Ctrl+C volta a copiar o recorte e fechar o editor; os controles de ação foram alinhados.',
      'Ajustes de estabilidade e apresentação nas ferramentas. Controles internos de desenvolvimento não são exibidos na versão de produção.'
    ]
  },
  {
    version: '0.7.0',
    date: '23 set. 2026',
    changes: [
      'Novo Renomear arquivos em lote: arraste arquivos ou uma pasta, configure prefixo, busca/substituição e numeração, confira a prévia e aplique sem sobrescrever outros arquivos.',
      'Atalhos de captura aceitam Print Screen e o editor abre pronto para selecionar a área; refinamentos nas setas e nas interações das imagens inseridas.'
    ]
  },
  {
    version: '0.6.1',
    date: '23 set. 2026',
    changes: [
      'Os botões Agora não e Baixar atualização agora ficam alinhados e centralizados na mesma altura.'
    ]
  },
  {
    version: '0.6.0',
    date: '23 set. 2026',
    changes: [
      'Minimizar ou fechar pelo X mantém o NTC Utilities na bandeja; use o menu do ícone para reabrir o app ou sair de verdade.',
      'Preferências e arquivos pessoais ficam fora da pasta de instalação e são preservados nas atualizações. Usuários existentes veem este changelog uma vez após atualizar.',
      'Nova aba Captura de tela, com atalhos configuráveis para abrir o editor ou salvar capturas rápidas diretamente na pasta escolhida.',
      'Editor de capturas em tela cheia: caneta, formas, setas retas e curvas editáveis, texto, destaque, desfoque, pixelização, recorte, números e imagens movíveis/redimensionáveis.',
      'Branco como cor inicial das anotações; Ctrl+C copia a imagem e fecha o editor, enquanto Esc descarta. Limite da captura, setas e controles do editor foram refinados.',
      'Gravador inicia com áudio do computador e microfone selecionado; se o microfone falhar, avisa e mantém o áudio do PC.',
      'Novo Gerador de QR Code com prévia, cor e tamanho personalizáveis, exportação PNG/SVG e histórico separado.',
      'Ajustes de layout nas ferramentas maximizadas para reduzir bordas e espaços vazios.'
    ]
  },
  {
    version: '0.5.0',
    date: '23 set. 2026',
    changes: [
      'Novo Gerador de QR Code para links, com prévia ao vivo, personalização de cor e tamanho e exportação PNG/SVG.',
      'Geração em lote com validação por link, estados claros e nova tentativa após falha.',
      'Aba de QR Codes no Histórico, separada dos registros de arquivos, com ações para abrir, localizar e copiar links.'
    ]
  },
  {
    version: '0.4.0',
    date: '23 set. 2026',
    changes: [
      'Novo Editor de vídeo com player, timeline, cortes múltiplos e exportação em MP4 H.264.',
      'Músicas e áudios externos em várias faixas, com waveform, posição, corte, volume e loop.',
      'Novo Gravador de tela com qualidade, escolha de microfone, áudio do computador e salvamento em MP4.',
      'Novo Compressor para vídeos e áudios, com controles adequados para cada tipo de mídia.',
      'Downloads MP4 agora priorizam H.264 e AAC para abrir no Windows Media Player.',
      'Instalador oferece remover outras cópias registradas e preserva dados pessoais durante a limpeza.',
      'Ajustes visuais, correções de renderização e atalho do gravador opcional.'
    ]
  },
  {
    version: '0.3.0',
    date: '22 set. 2026',
    changes: [
      'Conversores locais de vídeo e imagens, com filas separadas e arrastar arquivos.',
      'Editor de áudio avançado com ganho, equalizador, marcadores, espectro e prévia em tempo real.',
      'Tema claro, prévia comparativa de imagens e confirmação para dimensões muito grandes.',
      'Erros de conversão mais claros, com card persistente e nova tentativa.',
      'Instalador refinado com opção de abrir o aplicativo ao concluir.'
    ]
  },
  {
    version: '0.2.5',
    date: '22 set. 2026',
    changes: [
      'Atualizações pelo próprio aplicativo, com novidades da versão antes de baixar.',
      'Changelog interno em Configurações.',
      'Metadados e capa agora ficam em um painel opcional e recolhido.',
      'Marca e ícone NTC atualizados.',
      'Zoom, atalhos e desfazer/refazer no Editor; fila de downloads mais completa.'
    ]
  },
  {
    version: '0.2.4',
    date: '22 set. 2026',
    changes: [
      'Central de utilidades refinada.',
      'Histórico com abertura de pasta e limpeza confirmada.',
      'Configurações com versão instalada e diagnóstico das ferramentas.'
    ]
  },
  {
    version: '0.2.3',
    date: '22 set. 2026',
    changes: [
      'Instalador simplificado, sem bloco visual no cabeçalho.',
      'Ícone do NTC mantido apenas no aplicativo e nos atalhos.'
    ]
  },
  {
    version: '0.2.2',
    date: '22 set. 2026',
    changes: [
      'Corrigido o cabeçalho visual do instalador.'
    ]
  },
  {
    version: '0.2.1',
    date: '22 set. 2026',
    changes: [
      'Pasta escolhida passou a ser mantida como padrão.',
      'Editor passou a criar cópias sem modificar o arquivo original.',
      'Melhorias no Downloader, nos erros e na waveform.'
    ]
  },
  {
    version: '0.2.0',
    date: '22 set. 2026',
    changes: [
      'Adicionado o Editor de áudio para arquivos locais.',
      'Corte visual, prévia, metadados, capa e normalização.',
      'Conversão para MP3, M4A, WAV, FLAC e Opus.'
    ]
  },
  {
    version: '0.1.0',
    date: '22 set. 2026',
    changes: ['Primeira versão pública do NTC Utilities para Windows.']
  }
];
