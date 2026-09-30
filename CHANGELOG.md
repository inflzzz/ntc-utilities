# Changelog

## 1.4.0 — NTC Utilities · 30 set. 2026

### Novo Desinstalador

- Consulte programas registrados no Windows, pacotes da Microsoft Store e jogos de bibliotecas Steam; filtre a lista e execute os desinstaladores oficiais individualmente ou em sequência.
- As pastas de instalação são medidas em segundo plano, com ordenação por tamanho, identificação de estimativas e resultados parciais e atualização automática após a desinstalação.
- Ícones reais são extraídos dos arquivos dos programas, incluindo ICO, executáveis e logos de pacotes da Microsoft Store.
- Revise sobras antes de confirmar a limpeza: dados pessoais ficam desmarcados por padrão, e recursos compartilhados, protegidos ou sem vínculo suficiente são preservados.
- Consulte o histórico, exporte relatórios e restaure itens disponíveis na quarentena. A limpeza do histórico preserva backups, salvo confirmação explícita de exclusão permanente.
- Instalações monitoradas comparam o estado anterior e posterior do sistema, sem atribuir automaticamente ao instalador as mudanças de outros programas.

### Atualizações mais claras

- O aviso reúne todas as versões entre a instalada e a disponível, com novidades agrupadas por versão e acesso ao histórico completo. Após atualizar, o resumo inclui apenas as versões ainda não vistas.
- Novas versões são verificadas a cada 15 minutos enquanto o aplicativo está aberto e ao retomar o computador. Dispensar o aviso evita sua repetição a cada checagem na mesma sessão.
- Download e instalação continuam dependendo da confirmação do usuário. O instalador, o arquivo incremental, os metadados e o histórico completo são publicados juntos.

### Compatibilidade e limites

- O novo comportamento do atualizador passa a funcionar após a instalação da versão 1.4.0. O histórico antes de atualizar depende da conexão; depois, também fica disponível offline.
- Restaurar sobras não reinstala o aplicativo original. Desinstaladores de terceiros podem exibir seus próprios avisos ou opções de reinicialização.
- Os pacotes do Ambient Mixer permanecem disponíveis separadamente, sem alterações no armazenamento, nos presets ou no áudio.

## 1.3.0 — NTC Utilities · 30 set. 2026

### Novas ferramentas

- **Luz da Tela:** ajuste a temperatura de cor por perfil, agenda diária ou controle manual; personalize horários, crie exceções por aplicativo e pause temporariamente. As alterações são aplicadas localmente e o aplicativo tenta restaurar a calibração original ao desligar ou encerrar.
- **Modificador de Voz:** transforme áudio de arquivos ou do microfone com ajuste de pitch e formantes, cadeia reordenável de efeitos, presets próprios, comparação A/B e exportação em WAV, MP3, FLAC ou Opus. O monitoramento começa desligado; nenhum áudio é enviado a servidores nem é criado um microfone virtual.

### Compatibilidade e limites

- A Luz da Tela atua sobre a rampa de cor do monitor, não sobre o brilho físico do painel. O suporte depende do Windows, do driver e do monitor; HDR e estados de cor não confirmados são bloqueados, e o aplicativo verifica a aplicação antes de indicar sucesso.
- No Modificador de Voz, pitch/formantes ao vivo podem acrescentar latência perceptível. A exportação usa processamento local; arquivos muito longos estão sujeitos ao limite de tamanho indicado pela ferramenta.
- Dependências, licenças e componentes necessários às duas ferramentas foram incluídos no pacote Windows.

## 1.2.1 — NTC Utilities · 29 set. 2026

- Revisão editorial do histórico de versões, com novidades organizadas por ferramenta e descrições mais diretas.

## 1.2.0 — NTC Utilities · 29 set. 2026

### Novas ferramentas

- **Analisador de Armazenamento:** explore discos e pastas em um mapa interativo; consulte arquivos, tipos e itens maiores e refine os resultados com filtros.
- **Lembrete de Medicamentos:** organize dias e horários, acompanhe as doses e consulte notificações e histórico locais.
- **Testes de microfone e webcam:** confira o nível e as características dos dispositivos, grave um teste de áudio, veja a prévia da câmera e capture fotos.
- **Jogos e Sorteios:** decisões, moedas, roletas, listas, equipes, cartas, dados e jogos rápidos em uma categoria própria.
- **NTC Labs:** Pessoa Aleatória, Estatísticas do NTC, Daily Random e comparações de medidas da vida real, além do Ambient Mixer.

### Melhorias

- Em unidades NTFS compatíveis, o Fast Scan acelera a análise. O método utilizado e o motivo de um eventual fallback ficam visíveis; a navegação do mapa permite voltar ou escolher um nível sem refazer o scan.
- **Ambient Mixer:** biblioteca de sons separada do gerenciamento de pacotes. São três pacotes opcionais com 24 gravações CC0, download com verificação de integridade e reprodução offline. Também há suporte a sons próprios, pausar/retomar e desmarcar todas as camadas.
- **Player de música:** biblioteca local, playlists, fila de reprodução e mini player.
- **Editor de vídeo:** exportação em 4K e perfil Máxima, com qualidade aprimorada. Os arquivos podem ficar maiores e a exportação levar mais tempo.
- Controles de reprodução centralizados e melhor aproveitamento da área da timeline.

## 1.1.0 — NTC Utilities · 28 set. 2026

- **Editor de vídeo:** exportação em UHD 4K (2160p) e opção **Máxima**, com H.264 CRF 12, preset de codificação lento e AAC 320 kb/s. A saída pode ser maior e demorar mais; aumentar a resolução não recupera detalhes ausentes na mídia original.
- Centralizados os controles de reprodução e preenchida a largura visível da timeline vazia, sem alterar a mecânica de edição ou reprodução.
- Mantidos no mesmo histórico os recursos e correções da série 1.0, incluindo o Editor de Áudio multifaixa, manutenção temporária do NTC RNG, melhorias na Área de transferência e correções do Auto-clicker.

## 1.0.1 — NTC Utilities · 28 set. 2026

- O Editor de Áudio agora é único: o multifaixa substitui o clássico, com dez formatos de saída, qualidade contextual, efeitos por clipe, marcadores/trechos, presets existentes, metadados, capas e exportação de faixas separadas.
- Projetos de áudio antigos abrem com migração em memória para o schema v2, sem sobrescrever automaticamente o arquivo; o histórico e a sugestão após download abrem direto no editor definitivo.
- Validados mixdowns reais com seis instrumentos, formatos WAV/MP3 e os demais contêineres, metadados e capas usando o FFmpeg incluído.
- A waveform de projetos de áudio longos agora usa uma superfície de desenho limitada, evitando canvas excessivamente grande sem alterar o áudio exportado.
- Corrigida a exportação multifaixa: o fluxo de áudio não tenta mais ler um controle antigo de resolução de vídeo. Validada a saída WAV e MP3 com seis faixas em um único mix.
- Projetos de áudio mostram todos os clipes da faixa, preservam nomes longos com tooltip e mantêm reproduções independentes quando o mesmo arquivo é usado mais de uma vez.
- Miniaturas da Área de transferência agora aparecem imediatamente ao entrar na região visível, sem distorcer imagens verticais ou horizontais.
- Refinados estados desabilitados e ações de conclusão dos conversores, tempo de leitura dos avisos, alinhamento da navegação e largura das páginas em janelas grandes.
- O Auto-clicker instalado localiza corretamente o host PowerShell fora do `app.asar`; os arquivos `.ps1` e `.cs` são incluídos no caminho executável do pacote.
- O botão X mantém o aplicativo na bandeja; o menu da bandeja oferece a opção **Sair do NTC Utilities**.

## 1.0.0 — NTC Utilities · 28 set. 2026

- **NTC RNG em manutenção:** o jogo continua na navegação, mas abre apenas a tela de manutenção. O código e o progresso existente foram preservados.
- **Editor de vídeo:** workspace com timeline, prévia, propriedades e exportação; navegação global recolhida enquanto o editor está aberto. A implementação do editor não foi alterada nesta rodada de consolidação.
- **Editor de áudio multifaixa:** importação de stems, mixagem em um único WAV/MP3, régua e zoom da timeline, playhead e reprodução baseada em relógio monotônico para manter a posição ao minimizar/restaurar. Exportação agora diferencia progresso, conclusão, cancelamento e erro, com Abrir pasta e Tentar novamente.
- O **Editor de áudio clássico** permanece acessível: formatos, efeitos, marcadores, metadados e fila ainda não têm paridade integral no multifaixa.
- **Área de transferência:** imagens aparecem como miniaturas proporcionais diretamente no histórico, carregadas sob demanda; links copiados são identificados e ações secundárias ficam em um menu compacto. Os dados continuam locais.
- **Ergonomia:** áreas de arrastar arquivos nos conversores e no compressor agora têm identificação e foco de teclado claros; mensagens de falha orientam a usar o seletor correto.
- Incluídas ferramentas locais de documentos, PDF, estudos e segurança, além de refinamentos de navegação e estabilidade nas utilidades.

## 0.8.0 — NTC Utilities · 24 set. 2026

- **Player de música:** importação de arquivos individuais; edição do nome, descrição e capa de playlists; reordenação de faixas.
- **Biblioteca:** metadados, capas e playlists são persistidos entre sessões. Remover uma faixa do aplicativo não exclui o arquivo original do computador.
- **Ferramentas:** adicionados o Auto-clicker e o Seletor de cor; corrigido o fluxo de Ctrl+C no editor de captura para copiar e fechar.
- Refinamentos de estabilidade e interface. Controles internos de desenvolvimento não são exibidos na versão de produção.

## 0.7.0 — 23 set. 2026

- Novo **Renomear arquivos** em lote: arraste arquivos ou uma pasta, configure prefixo, busca/substituição e numeração, confira a prévia e aplique sem sobrescrever outros arquivos.
- Atalhos de captura aceitam Print Screen e o editor abre pronto para selecionar a área; refinamentos nas setas e nas interações das imagens inseridas.

## 0.6.1 — 2026-09-23

- Alinhados verticalmente os botões **Agora não** e **Baixar atualização**, removendo a margem herdada que deslocava o texto.

## 0.6.0 — 2026-09-23

- Minimizar ou fechar pelo X mantém o NTC Utilities na bandeja; o menu do ícone permite reabrir o app ou sair de verdade.
- Preferências e arquivos pessoais são mantidos fora da pasta de instalação e preservados ao atualizar. Usuários existentes veem este changelog uma vez após atualizar.
- Nova aba **Captura de tela**, com atalhos configuráveis para captura com editor e captura rápida direto para a pasta escolhida.
- Editor de capturas em tela cheia com caneta, formas, setas retas e curvas editáveis, texto, destaque, desfoque, pixelização, recorte, numeração e imagens que podem ser movidas/redimensionadas. Ctrl+C copia e fecha; Esc descarta.
- As ferramentas de anotação usam branco como cor inicial; controles, setas e janela do editor foram refinados para deixar claro o limite da captura.
- Gravador de tela inicia com áudio do computador e o microfone selecionado; se o microfone falhar, avisa e mantém o áudio do PC.
- Novo **Gerador de QR Code** com prévia, opções de cor/tamanho, exportação PNG/SVG e histórico separado.
- Ajustes de layout nas ferramentas para aproveitar a janela maximizada sem bordas e espaços vazios desnecessários.

## 0.2.5 — 2026-09-22

- Adicionado sistema de atualização pelo próprio aplicativo: ao abrir uma versão desatualizada, o NTC Utilities mostra a nova versão, as novidades e permite baixar a atualização com um clique.
- Incluído changelog interno em **Configurações**, sem redirecionar para o navegador.
- Refinada a identidade visual com a marca NTC e o ícone do aplicativo atualizados.
- Metadados e capa no Editor de áudio agora ficam em um painel opcional e recolhido por padrão.
- Removido o sistema de fade do Editor de áudio para manter o fluxo de corte mais direto.
- Editor ganhou zoom na waveform pelo scroll, atalhos de reprodução e navegação, desfazer/refazer e prévia da seleção.
- Downloader passou a exibir miniaturas na fila, estimativa de tamanho, limite de velocidade e retomada de itens pausados.
- Histórico ganhou filtros, abertura de pasta e a opção de reabrir uma conversão anterior no Editor.

## 0.2.4 — 2026-09-22

- Refinada a central de utilidades e removida a frase promocional da tela inicial.
- Adicionados feedbacks discretos e confirmações para ações de histórico e preferências.
- Histórico agora oferece abertura da pasta e limpeza com confirmação.
- Configurações passaram a exibir a versão instalada e o diagnóstico de yt-dlp, FFmpeg e FFprobe.
- Atualizada a página pública com uma apresentação mais objetiva do aplicativo e da instalação.

## 0.2.3 — 2026-09-22

- Removida a marca do cabeçalho do instalador; o assistente agora fica totalmente limpo.
- Mantido o ícone do NTC apenas no executável e nos atalhos do aplicativo.

## 0.2.2 — 2026-09-22

- Corrigido o bloco preto que aparecia no cabeçalho do instalador.
- Cabeçalho do setup agora usa fundo claro e a marca NTC em contraste discreto.

## 0.2.1 — 2026-09-22

- Consolidada a experiência do Downloader e do Editor de áudio com a pasta escolhida persistida como padrão.
- Separado o nome do arquivo físico editado dos metadados; o original nunca é sobrescrito.
- Corrigida a detecção do arquivo final do Downloader e aprimoradas as mensagens de erro.
- O aviso para abrir um áudio no Editor agora é discreto e não interrompe o fluxo.
- O botão **Parar tudo** aparece somente quando existe uma conversão ativa.
- Ajustados os seletores e o Editor com waveform, cursor arrastável e play/pausa.
- Instalador NSIS com identidade monocromática, logo, textos em português e atalhos configuráveis.

## 0.2.0 — 2026-09-22

- Adicionado o Editor de áudio para arquivos locais de áudio e vídeo.
- Incluídos waveform, corte visual, prévia com cursor de reprodução e atalho de espaço para play/pausa.
- Adicionados metadados, capa, normalização, fila, histórico e criação segura de cópias editadas.
- Downloader agora localiza o arquivo final após a conversão e mostra erros de forma mais clara.
- Após baixar um áudio, uma sugestão discreta permite abri-lo diretamente no Editor de áudio.

## 0.1.0 — 2026-09-22

- Primeira versão pública do NTC Utilities para Windows.
