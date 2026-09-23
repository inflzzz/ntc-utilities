# NTC Utilities

Utilitários desktop livres, privados e diretos ao ponto.

As ferramentas disponíveis são o **Downloader**, os **Editores de áudio e vídeo**, os **Conversores de vídeo e imagens**, o **Gravador de tela**, a **Captura de tela**, o **Compressor**, o **Gerador de QR Code** e o **NTC RNG**. Todo processamento de arquivos locais é feito no computador.

> O projeto está em desenvolvimento. A versão mais recente para Windows fica na aba **Releases** deste repositório.

## Instalação no Windows

1. Abra a aba **Releases** deste repositório.
2. Baixe o arquivo `NTC.Utilities.Setup.x.y.z.exe` mais recente.
3. Execute o instalador e escolha a pasta de instalação.
4. Abra **NTC Utilities** pelo menu Iniciar ou pelo atalho criado pelo instalador.

Não é necessário instalar Python, Node.js, `yt-dlp`, FFmpeg, FFprobe, Winget ou qualquer ferramenta separadamente. O instalador inclui tudo o que o app precisa para funcionar.

Quando uma nova versão for publicada, o aplicativo instalado verifica a disponibilidade ao abrir. O download e a instalação só começam depois da confirmação da pessoa, e o aviso mostra as novidades da versão antes de atualizar.

## O que o Downloader oferece

- Prévia do título, canal, duração e thumbnail antes de baixar.
- Áudio em MP3, M4A ou Opus, com qualidade Original, 128, 192, 256 ou 320 kbps.
- Vídeo em MP4 ou WebM, da melhor qualidade disponível até 2160p; MP4 prioriza H.264 + AAC para maior compatibilidade no Windows.
- Fila local de downloads, processada um item por vez.
- Playlists completas ou seleção apenas das faixas desejadas.
- Botão **Parar tudo** para cancelar a operação em andamento e limpar a fila.
- Histórico local, pasta configurável e opção para abrir a pasta ao concluir.

Use o aplicativo somente para conteúdos que você possui ou tem permissão para salvar.

## Editor de áudio

- Converte arquivos locais de áudio e extrai áudio de vídeos.
- Saída em MP3, M4A, AAC, WAV, FLAC, OGG, Opus, AIFF, WMA e AC3.
- Fila local, progresso, cancelamento e retry.
- Corte de início e fim, normalização, ganho, equalizador, marcadores, espectro, metadados e capa por arquivo.
- Mantém a pasta padrão, a regra de arquivos duplicados e a preferência de abrir a pasta ao concluir.

## Conversores locais

- **Vídeo:** MP4, MKV e WebM, com codec, resolução, qualidade e opção de preservar ou remover áudio.
- **Imagens:** JPG, PNG e WebP, com qualidade, escala, largura, altura, proporção e prévia comparativa.
- Ambos aceitam múltiplos arquivos por seleção ou arrastar e soltar e nunca sobrescrevem o original sem a regra de duplicatas escolhida.

## Editor de vídeo, gravador e compressor

- **Editor de vídeo:** player, waveform, cortes múltiplos, áudio original, músicas externas com volume, posição, corte e loop; exporta uma cópia em MP4 H.264.
- **Gravador de tela:** grava a tela em MP4 com áudio do computador e o microfone selecionado ativados automaticamente, resolução escolhida e atalho opcional. Se o microfone não estiver disponível, a gravação continua com o áudio do PC e um aviso.
- **Captura de tela:** editor em tela cheia, atalhos independentes para abrir o editor ou salvar direto na pasta, setas curvas editáveis, imagens movíveis/redimensionáveis, `Ctrl+C` para copiar e fechar e `Esc` para descartar.
- Fechar pelo X ou minimizar envia o app à bandeja do Windows; o Auto-roll continua ativo. Use o menu do ícone e **Sair do NTC Utilities** para encerrar.
- **NTC RNG:** coleção de 200 títulos e Auto-roll iniciado ao abrir o app; a abertura junto com o Windows vem ativada por padrão. Lucky Lad tem chance-base de 1 em 278.000.000; Luckiest Lad é exatamente 1 em 777.777.777. Coleção e estatísticas sobrevivem a atualizações e têm backup local.
- **Compressor:** reduz vídeos e áudios com controles específicos de resolução, FPS, qualidade, bitrate, formato e mono.

## Gerador de QR Code

- Gera QR Codes locais a partir de vários links, um por linha.
- Prévia atualizada com opções de cor, tamanho e saída PNG ou SVG.
- Fila mostra links inválidos e falhas sem bloquear os demais; permite tentar novamente.
- Histórico de QR Codes separado, com ações para abrir o arquivo, a pasta ou copiar o link.

## NTC RNG

- Jogo local de sorte com 200 títulos em português, probabilidades explícitas e auto-roll ao abrir o app.
- A coleção libera automaticamente bônus por raridade e ciclos de 2× a partir de 50 títulos e 3× a partir de 100; não há fragmentos, craft ou equipamentos.
- Destaca títulos inéditos e registra em qual número de rolagem cada descoberta aconteceu.
- Coleção, descobertas e estatísticas ficam salvas neste computador.

## Desenvolver localmente

Pré-requisitos: [Node.js](https://nodejs.org/) 20 ou superior e [pnpm](https://pnpm.io/).

```powershell
pnpm install
pnpm start
```

## Gerar o instalador

```powershell
pnpm package:win
```

O instalador da versão atual será criado em `dist/NTC.Utilities.Setup.0.6.0.exe`. Durante o build, o script baixa `yt-dlp`, FFmpeg e FFprobe para `resources/bin/`, inclui os três no instalador e mantém essa pasta fora do Git. O setup usa páginas brancas limpas, permite escolher a pasta e oferece a opção de remover outras cópias registradas do NTC Utilities. Atualizações silenciosas fazem essa limpeza automaticamente e preservam histórico, preferências e arquivos pessoais.

Para uma publicação oficial que suporte atualização dentro do app, use `pnpm release:win` com `GH_TOKEN` configurado. Esse comando envia o instalador e os arquivos de atualização necessários para a Release do GitHub.

## Página pública

O conteúdo da página está em [`docs/index.html`](docs/index.html). Depois de enviar o repositório ao GitHub, ative **Settings → Pages → GitHub Actions**. O workflow incluído publica essa página automaticamente a cada atualização da branch `main`.

## Licença e dependências

O código do NTC Utilities está sob a licença [MIT](LICENSE). O instalador contém componentes de terceiros com licenças próprias; consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) antes de uma distribuição pública.
