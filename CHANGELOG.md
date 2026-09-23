# Changelog

## 0.6.0 — 2026-09-23

- Novo **NTC RNG** com coleção de 200 títulos em português, chances explícitas, histórico de descobertas e salvamento com backup. Lucky Lad agora é Lendário (1 em 278.000.000) e Luckiest Lad é Lendário (exatamente 1 em 777.777.777).
- A coleção aplica automaticamente bônus de sorte e ciclos extras de rolagem; o Auto-roll começa ao abrir o app, continua na bandeja e pode iniciar junto com o Windows.
- Minimizar ou fechar pelo X mantém o NTC Utilities na bandeja; o menu do ícone permite reabrir o app ou sair de verdade.
- Os dados pessoais e a coleção são mantidos fora da pasta de instalação e preservados ao atualizar. Usuários existentes veem este changelog uma vez após atualizar.
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
