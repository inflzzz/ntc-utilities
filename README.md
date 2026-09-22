# NTC Utilities

Utilitários desktop livres, privados e diretos ao ponto.

As ferramentas disponíveis são o **Downloader**, para mídias autorizadas do YouTube, e o **Editor de áudio**, para editar, converter arquivos locais de áudio ou extrair o som de vídeos.

> O projeto está em desenvolvimento. A primeira versão pública para Windows será disponibilizada na aba **Releases** deste repositório.

## Instalação no Windows

1. Abra a aba **Releases** deste repositório.
2. Baixe o arquivo `NTC Utilities Setup x.y.z.exe` mais recente.
3. Execute o instalador e escolha a pasta de instalação.
4. Abra **NTC Utilities** pelo menu Iniciar ou pelo atalho criado pelo instalador.

Não é necessário instalar Python, Node.js, `yt-dlp`, FFmpeg, FFprobe, Winget ou qualquer ferramenta separadamente. O instalador inclui tudo o que o app precisa para funcionar.

## O que o Downloader oferece

- Prévia do título, canal, duração e thumbnail antes de baixar.
- Áudio em MP3, M4A ou Opus, com qualidade Original, 128, 192, 256 ou 320 kbps.
- Vídeo em MP4 ou WebM, da melhor qualidade disponível até 2160p.
- Fila local de downloads, processada um item por vez.
- Playlists completas ou seleção apenas das faixas desejadas.
- Botão **Parar tudo** para cancelar a operação em andamento e limpar a fila.
- Histórico local, pasta configurável e opção para abrir a pasta ao concluir.

Use o aplicativo somente para conteúdos que você possui ou tem permissão para salvar.

## Editor de áudio

- Converte arquivos locais de áudio e extrai áudio de vídeos.
- Saída em MP3, M4A, WAV, FLAC e Opus.
- Fila local, progresso, cancelamento e retry.
- Corte de início e fim, normalização de volume, metadados e capa por arquivo.
- Mantém a pasta padrão, a regra de arquivos duplicados e a preferência de abrir a pasta ao concluir.

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

O instalador será criado em `dist/NTC Utilities Setup 0.2.3.exe`. Durante o build, o script baixa `yt-dlp`, FFmpeg e FFprobe para `resources/bin/`, inclui os três no instalador e mantém essa pasta fora do Git. O setup tem tema monocromático próprio, permite escolher a pasta e oferece atalhos no Menu Iniciar e, opcionalmente, na área de trabalho.

## Página pública

O conteúdo da página está em [`docs/index.html`](docs/index.html). Depois de enviar o repositório ao GitHub, ative **Settings → Pages → GitHub Actions**. O workflow incluído publica essa página automaticamente a cada atualização da branch `main`.

## Licença e dependências

O código do NTC Utilities está sob a licença [MIT](LICENSE). O instalador contém componentes de terceiros com licenças próprias; consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) antes de uma distribuição pública.
