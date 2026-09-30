# Modificador de Voz

## Arquitetura

O catálogo registra `voiceModifier` em Áudio e Música. A interface está em `src/voice-modifier.js` e `src/voice-modifier.css`; `src/voice-model.js` normaliza cadeias e presets com schema versionado. `src/voice-engine.mjs` monta a cadeia Web Audio conforme a ordem dos módulos. `src/voice-export.cjs` recebe WAV renderizado pelo renderer e oferece salvamento local ou conversão com o FFmpeg já empacotado.

O fluxo de microfone é `MediaStreamAudioSourceNode → VoiceEngine.input → efeitos → compressor de segurança → soft clipper → saída`. O monitoramento começa desligado. Ao parar ou sair, todas as `MediaStreamTrack`s são interrompidas, fontes e nós são desconectados, o loop dos medidores é cancelado e o `AudioContext` é fechado. Trocar o microfone encerra a captura anterior antes de abrir a nova. O modo arquivo usa a mesma cadeia para preview e `OfflineAudioContext` para exportação. O original nunca é enviado a servidores nem é escolhido como destino de exportação.

Pitch usa SoundTouchJS AudioWorklet com WSOLA para transpor a frequência sem acelerar o arquivo. A correção de formant usa LPC no worklet. O controle independente de formant aplica uma transposição bruta e, em seguida, a transposição inversa com correção LPC; assim, a frequência fundamental volta ao valor anterior enquanto o envelope espectral muda. Em sinais de teste a 48 kHz, +12 semitons produziram aproximadamente 873 Hz a partir de 440 Hz e −12 produziram aproximadamente 220 Hz, com a mesma duração. Em sinal harmônico de teste, formant +4 e −4 mantiveram a frequência fundamental e alteraram o centro espectral em sentidos opostos.

Os módulos nativos são EQ, compressor, reverb por convolução, delay, distorção, chorus, flanger, ring modulation para robô e filtros de telefone/rádio. O gate roda em um pequeno AudioWorklet próprio. O processador de pitch, o de correção de formant e o gate são assets locais. O script `scripts/build-voice-vendor.cjs` empacota as APIs e copia os worklets e respectivas licenças para `src/`. `src/**` entra no `app.asar`; o teste de DSP foi executado também importando `voice-engine.mjs` e seus worklets diretamente do `app.asar` criado pelo build Windows.

## Latência e limites

O teste sintético de início de sinal a 48 kHz mediu cerca de 50 ms adicionais no estágio de pitch e 246 ms no estágio independente de formant, além da latência da entrada/saída e do dispositivo. Formant em monitoramento ao vivo pode ser perceptivelmente atrasado, especialmente junto de pitch; a interface mostra uma estimativa. Estes valores não são uma medição de latência de hardware. Um teste local capturou um microfone físico por 350 ms (2 canais, 48 kHz), processou com o monitor silenciado e confirmou que as tracks e o `AudioContext` foram encerrados. Não houve avaliação auditiva pelo alto-falante ou fones.

O teste automatizado da interface no Electron usou streams de microfone simuladas: carregou um WAV, reproduziu, alternou A/B, confirmou monitoramento desligado por padrão, trocou de entrada, verificou que a track antiga e a atual foram encerradas e exibiu o erro de permissão negada. Isso valida o fluxo de controle e cleanup, sem substituir um teste com hardware físico.

O teste no Electron confirmou decodificação de WAV, MP3, FLAC, Opus, AAC e M4A curtos gerados pelo FFmpeg. A exportação oferece WAV PCM 16 bit, MP3, FLAC e Opus; os três últimos usam o FFmpeg incluído no NTC. A exportação de arquivos muito longos é limitada a 250 MB de WAV gerado por operação. Reverb e delay têm a cauda cortada no final exato da duração do arquivo. Nenhum microfone virtual do Windows é criado.

## Expansão futura

`VoiceEngine.output` é o ponto de saída do motor. Um futuro backend de microfone virtual poderia consumir um `MediaStreamAudioDestinationNode` conectado ali e encaminhar o PCM por um serviço/driver instalado explicitamente. O motor e os presets não dependem de Discord, jogos ou driver de terceiros. Um efeito futuro pode entrar no registro de `voice-model.js` e no construtor de módulos em `voice-engine.mjs`. Presets com tipos ainda desconhecidos são mantidos nos dados locais e passam pelo áudio sem processamento até o efeito estar disponível.
