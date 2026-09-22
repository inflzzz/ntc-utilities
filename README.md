# NTC Utilities

Utilitários desktop livres, privados e diretos ao ponto.

O primeiro módulo disponível é o **Downloader**: ele salva áudios e vídeos permitidos em uma pasta escolhida pelo usuário, com prévia, seleção de formato e qualidade, fila, progresso, histórico e suporte a playlists.

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

## Desenvolver localmente

Pré-requisitos: [Node.js](https://nodejs.org/) 20 ou superior e [pnpm](https://pnpm.io/).

```powershell
pnpm install
pnpm start
```

Também é possível abrir o arquivo `Abrir NTC Utilities.bat` depois de instalar as dependências do projeto.

## Gerar o instalador

```powershell
pnpm package:win
```

O instalador será criado em `dist/NTC Utilities Setup 0.1.0.exe`. Durante o build, o script baixa `yt-dlp`, FFmpeg e FFprobe para `resources/bin/`, inclui os três no instalador e mantém essa pasta fora do Git.

## Página pública

O conteúdo da página está em [`docs/index.html`](docs/index.html). Depois de enviar o repositório ao GitHub, ative **Settings → Pages → GitHub Actions**. O workflow incluído publica essa página automaticamente a cada atualização da branch `main`.

## Licença e dependências

O código do NTC Utilities está sob a licença [MIT](LICENSE). O instalador contém componentes de terceiros com licenças próprias; consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) antes de uma distribuição pública.
