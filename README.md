# NTC Utilities

<p align="center"><strong>COMUNICADO À COMUNIDADE</strong><br>O desenvolvimento do NTC Utilities está temporariamente pausado por questões financeiras. O projeto não foi abandonado; esperamos voltar a publicar novidades em breve, sem uma data confirmada por enquanto.</p>
<p align="center"><a href="https://inflzzz.github.io/ntc-utilities/pausa.html"><strong>Leia o comunicado e veja o resumo do projeto</strong></a> · <a href="https://github.com/inflzzz/ntc-utilities/releases/latest">Versão mais recente</a></p>

O **NTC Utilities** reúne ferramentas de mídia, produtividade, organização e segurança em um aplicativo desktop para Windows. O processamento de arquivos locais acontece no próprio computador; recursos que dependem de serviços externos — como downloads, clima e verificação de atualizações — precisam de conexão com a internet.

## Ferramentas

### Mídia e arquivos

- **Downloader:** consulta informações do conteúdo, permite baixar áudio ou vídeo e organizar downloads em fila, playlists e histórico. Use apenas conteúdo que você possui ou tem autorização para salvar.
- **Editor de áudio multifaixa:** organiza clipes em uma timeline, permite ajustar cortes, volume, ganho e equalização, usar marcadores e exportar mixdowns ou faixas separadas. Inclui metadados, capas e formatos como WAV, MP3, FLAC, AAC, OGG e Opus.
- **Player de música:** mantém uma biblioteca local, playlists, capas e organização das faixas para reprodução offline.
- **Editor de vídeo:** combina mídia visual e áudio em uma timeline com prévia, cortes, transformações e exportação MP4/H.264. Oferece saída UHD 4K (2160p) e qualidade Máxima, com arquivos maiores e codificação mais lenta.
- **Conversor de vídeo:** converte arquivos locais entre formatos e codecs, com opções de resolução, FPS e áudio.
- **Conversor de imagens:** salva cópias em JPG, PNG ou WebP, ajustando qualidade, escala, dimensões e proporção, com prévia antes de salvar.
- **Compressor:** oferece controles de tamanho/qualidade para vídeos e áudios.
- **Gravador de tela:** grava a tela com áudio do computador e microfone, quando disponíveis.
- **Captura de tela:** captura a tela e abre um editor para anotações, formas, setas, texto, recortes e ajustes de imagem.
- **Renomear arquivos:** aplica padrões de nome em lote com prévia antes de alterar os nomes.
- **Área de transferência:** histórico local de textos e imagens copiados, com busca e ações para reutilizar itens.

### Organização e produtividade

- **Relógios e tempo:** fusos horários, clima, alarmes, temporizador e cronômetro.
- **Documentos:** edição e formatação de textos, além de notas rápidas.
- **PDF:** leitura e ferramentas para organizar, editar ou converter documentos PDF.
- **Estudos:** sessões de foco e revisão por flashcards.
- **Gerador de QR Code:** cria códigos a partir de links, com prévia e saída PNG ou SVG.
- **Seletor de cor:** captura uma cor visível na tela e copia seus códigos.
- **Auto-clicker:** automatiza cliques conforme a configuração de ritmo, duração, atalhos e posições.

### Segurança e utilidades

- **Segurança:** ferramentas locais para hashes, geração de códigos/segredos, proteção de arquivos e remoção de metadados em cópias.
- **Histórico e bandeja do sistema:** consulte operações recentes; fechar pelo X mantém o aplicativo na bandeja do Windows. Use **Sair do NTC Utilities** no menu da bandeja para encerrar o processo.
- **Atualizações:** o aplicativo verifica versões publicadas e informa as novidades; o download e a instalação só começam após a confirmação da pessoa.

> **NTC RNG temporariamente em manutenção.** O jogo continua presente no projeto e na navegação, mas esta versão abre uma tela de manutenção em vez da interface do jogo. O código e os dados locais existentes não são removidos.

## Instalação no Windows

1. Abra [Releases](https://github.com/inflzzz/ntc-utilities/releases) e baixe `NTC.Utilities.Setup.x.y.z.exe` da versão mais recente.
2. Execute o instalador e siga as etapas apresentadas.
3. Abra **NTC Utilities** pelo menu Iniciar.

Não é necessário instalar Python, Node.js, yt-dlp, FFmpeg ou FFprobe separadamente; os componentes usados pelo aplicativo são incluídos no instalador. Preferências e dados do usuário ficam fora da pasta do programa para sobreviver a atualizações. O app não precisa ser executado como administrador.

O changelog completo está em [CHANGELOG.md](CHANGELOG.md) e também é exibido dentro do aplicativo. Consulte os avisos de terceiros em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Desenvolvimento

Requisitos: Node.js 20 ou superior e pnpm.

```powershell
pnpm install
pnpm start
pnpm test
```

Para criar o instalador Windows localmente:

```powershell
pnpm package:win
```

A publicação de uma versão com atualização pelo aplicativo usa `pnpm release:win` e credenciais GitHub configuradas localmente. Não inclua tokens ou segredos no repositório.

## Licença

O NTC Utilities está sob a licença [GNU GPL v3](LICENSE). Dependências e componentes de terceiros podem ter termos próprios; consulte os avisos distribuídos com o projeto.
