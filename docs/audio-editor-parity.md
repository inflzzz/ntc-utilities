# Paridade do Editor de Áudio (auditoria de código)

Esta matriz descreve o comportamento do conversor clássico em `src/app.js` e
`main.cjs` antes de sua remoção. O objetivo é verificar comportamento, não só
presença de controles.

| Capacidade clássica | Implementação existente | Situação no multifaixa antes da migração |
| --- | --- | --- |
| Entrada de vários arquivos de áudio e vídeos com áudio | `choose-media-files`, `inspect-media`/FFprobe, fila de conversões independentes | Oito extensões de áudio, sem vídeos como fonte |
| Dez saídas | MP3, M4A/AAC, AAC, OGG Vorbis, Opus, WAV, FLAC, AIFF, WMA, AC-3; `codecArgs` FFmpeg | WAV e MP3 |
| Qualidade | 128/192/256/320 kbps nos formatos com perdas; sem perdas nos outros | MP3 fixo em 192 kbps, WAV PCM 16-bit |
| Corte visual | Início/fim, arrastar marcadores da waveform, zoom pelo scroll | Trim dos clipes na timeline, zoom por slider |
| Reprodução da seleção | Play/pause, posição, ±5 s, Space e setas | Playback conjunto, seek, Space e timeline |
| Ganho e EQ | Volume em dB e bandas 100/1000/6000 Hz por arquivo; Web Audio na prévia, FFmpeg na saída | Volume por clipe/faixa sem EQ |
| Normalização e remoção de silêncio | `loudnorm=I=-16:TP=-1.5:LRA=11` e `silenceremove` por arquivo, FFmpeg na saída | Ausentes |
| Marcadores de intervalo | Nome, começo/fim, editar/remover, duplicar em fila para exportar cada trecho | Ausentes |
| Presets | Voz, Música, Podcast; presets próprios em `ntc-audio-presets`, compartilhados com Player | Ausentes |
| Aplicar ajustes à fila | Copia ganho/EQ/normalização/silêncio para itens prontos | Ausente |
| Metadados | Título, artista, álbum, ano e gênero; gravados por FFmpeg | Ausentes |
| Capa | Escolher/remover JPG/PNG ou preservar capa embutida; MP3/M4A/FLAC | Ausente |
| Undo/redo | Até 80 snapshots do formulário, Ctrl+Z/Y | Ausente |
| Exportação em fila | Cada arquivo/trecho independente, progresso, ETA, cancelar/retry, pasta/nome, sem sobrescrever origem | Um mix WAV/MP3, progresso/cancelar/retry |
| Espectro | Alterna barras derivadas da amplitude da waveform; **não** calcula espectro de frequências | Ausente; visualização antiga não é análise espectral confiável |

O clássico não expõe controle de sample rate ou canais. Ambos seguem os defaults
dos codecs escolhidos pelo FFmpeg. Também não implementa fade ou solo; esses
termos não devem ser apresentados como paridade clássica.

## Resolução na v1.0.1 local

- A importação do editor definitivo aceita áudio e vídeos com fluxo de áudio validado pelo FFprobe. Os arquivos entram em faixas independentes; exportar faixas separadas substitui a fila de conversões do clássico.
- Os dez contêineres e quatro bitrates existentes são opções contextuais. O FFmpeg continua escolhendo sample rate e canais por codec, como no clássico.
- Ganho e equalização pertencem ao clipe. A prévia usa Web Audio; o render usa os filtros FFmpeg. Normalização e remoção de silêncio são declaradas como efeitos exclusivos da exportação.
- Marcadores de início/fim usam o tempo global da timeline, aparecem na régua, podem ser editados/removidos, sobrevivem ao save/load e exportam trechos sequencialmente.
- Presets padrão e presets do usuário continuam com a chave local `ntc-audio-presets`, também usada pelo Player. A opção de aplicar efeitos a todos os clipes substitui “Aplicar à fila”.
- Metadados, capa própria ou capa embutida na origem são opções de exportação. O botão de remover capa desliga a preservação automática naquele projeto.
- Undo/redo registra até 80 snapshots de alterações estruturais/efeitos; os projetos de áudio passam do schema v1 para v2 em memória, sem salvar automaticamente o arquivo aberto.
- O “espectro” antigo era uma segunda pintura da amplitude, não uma análise de frequências. Foi removido para não oferecer uma leitura enganosa.
