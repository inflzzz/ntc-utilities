# Ambient Mixer — origem, seleção e distribuição

Verificado em 2026-09-29. Origem: **NOX SOUND — Essentials Series**, coleção baixada manualmente pelo proprietário e mantida, sem alterações, em `NTC SOM` no Desktop. O arquivo `Essentials_Series_README.pdf` contido no pacote declara que todos os sons são **CC0**. A [página oficial do autor](https://nox-sound-design.itch.io/essentials-series-sfx-nox-sound) confirma a licença CC0 e informa 1.644 sons. O pacote original e os WAVs masters não são redistribuídos no Git nem incluídos no instalador.

Foram inventariados 1.644 arquivos de áudio (Nature Essentials, Iceland Flows, São Miguel Flows e demais coleções). Cinquenta e sete candidatos de ambiência foram examinados tecnicamente quanto a duração, codec, canais, nível RMS, pico, silêncio e diferença no início/fim. O catálogo reproduzível dos 24 escolhidos, com coleção e caminho relativo de cada master, fica em `scripts/ambient-source-catalog.cjs`; `pnpm build:ambient-packs --source "<NTC SOM>"` gera `out/ambient-packs/asset-report.json` com os metadados FFprobe de cada original e derivado.

Critérios de exclusão: 1.587 efeitos sem utilidade para ambiência ou redundantes; candidatos com nível muito baixo (ex.: meadow birds, cerca de 78% de blocos abaixo de −55 dBFS), pico acima de 0 dBFS (Ocean Praia dos Moinhos 02) e emendas menos adequadas. Não há trovão real, cafeteria, teclado ou trânsito apropriados no pacote. Esses nomes não são anunciados como gravações disponíveis; presets antigos que dependam deles permanecem preservados como indisponíveis. A composição “Chuva e vento” usa as duas gravações reais, sem inventar trovão.

Os WAVs de origem são PCM de 24 bits, normalmente 48 kHz, com algumas gravações a 96 kHz e três fogueiras mono. Derivados: **Opus 48 kHz**, VBR, 144 kb/s estéreo ou 64 kb/s mono, sem transformar mono em estéreo. O pipeline valida codec, canais, duração e decodificação completa por FFmpeg. O Web Audio usa AudioBufferSourceNode com loop sem reinicialização de elemento HTML e sobreposição/crossfade de 60 ms na emenda; três tipos de ruído permanecem procedurais. Há ganho por faixa, master com headroom proporcional ao número de faixas e compressor como proteção. Os volumes iniciais ficam no manifest de cada pack; o mestre não é normalizado agressivamente.

| Pacote | Conteúdo | Masters selecionados | Download | Instalado |
| --- | --- | ---: | ---: | ---: |
| Ambient Essentials | 10: chuva leve/forte, vento, lareira, floresta, noite, rio, mar, cachoeira, cigarras | 72,58 MiB | 4,27 MiB | 4,27 MiB |
| Nature | 6: chuva nas folhas, vento nas árvores, duas fogueiras e duas cavernas | 43,85 MiB | 2,58 MiB | 2,58 MiB |
| Water | 8: riachos, rio, ondas, oceano, cachoeiras e fonte termal | 92,82 MiB | 4,22 MiB | 4,22 MiB |

Total aproximado: 209,25 MiB de masters selecionados para 11,07 MiB de downloads, redução de 94,7%. O manifest público versionado está em `content/ambient-packs.json`. Os ZIPs e intermediários ficam somente em `out/ambient-packs/` (ignorado pelo Git) e são distribuídos como GitHub Release Assets na release própria `ambient-packs-v1`. O aplicativo verifica tamanho e SHA-256 do ZIP, valida a estrutura e os hashes de cada áudio, extrai em staging e só então move para o armazenamento persistente do usuário. Os arquivos são lidos localmente após a instalação; não há streaming. Atualizações podem publicar um novo asset/versionamento em release `ambient-packs-vN` e atualizar o manifest remoto, sem alterar a release normal do aplicativo.

## Reconstrução

1. Mantenha `NTC SOM` intacta e informe seu caminho com `--source`; o script localiza a raiz extraída.
2. Execute `pnpm build:ambient-packs --source "<caminho>"`.
3. Revise `out/ambient-packs/asset-report.json`, os ZIPs e o manifest gerado. Publique os ZIPs na release dedicada e copie somente o pequeno manifest aprovado para `content/ambient-packs.json`.
4. Rode `node --test test/ambient-packs.test.cjs` e a suíte completa. Nunca adicione `out/`, masters, tokens ou material de usuário ao Git.
