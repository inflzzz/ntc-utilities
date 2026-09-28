# Câmara do Acaso

A apresentação antiga da esteira foi substituída por um arco gravado em Canvas,
com nomes seguindo uma trajetória contínua. O resultado continua sendo calculado
no processo principal antes de ser entregue à apresentação.

## Arquitetura

- `src/rng-roll-experience.js`: controlador isolado, uma única timeline/rAF,
  sequência decorativa limitada e callbacks de resultado/transição.
- `src/rng-roll-experience.css`: composição e estados visuais restritos ao painel.
- `src/app.js`: recebe snapshots, mantém a fila existente e entrega a primeira
  descoberta elegível à antecipação. As demais descobertas continuam na FIFO.
- `src/index.html`: Canvas decorativo com resultado textual acessível em DOM.

Manual: resposta imediata ao clique, percurso de aproximadamente 3,4–5,4 segundos,
aceleração inicial e aproximação longa até o resultado exato. Interrupções herdam
posição/velocidade, com limite matemático para impedir reversão.

Automático: fluxo contínuo independente do ciclo real de um segundo. Resultados
entram fora da região visível, atravessam o foco e atualizam a apresentação.
Existe uma latência visual de alguns segundos; o contador e a mecânica continuam
no tempo real. Rajadas de resultados comuns podem ser resumidas visualmente;
descobertas elegíveis não são descartadas, pois pertencem à fila externa.

Raridades reais superiores despertam a gravação e prolongam a antecipação.
Não há near-miss artificial obrigatório. Os pesos decorativos são independentes
dos pesos de títulos: 62/25/9/3/0,75/0,18/0,06/0,009/0,0009/0,0001, em ordem
de raridade. Há uma quebra local após quatro Básicos decorativos consecutivos.

Ao abrir um reveal, ocultar a área ou destruir o controlador, seu rAF é cancelado.
Reduzida mostra o resultado com uma breve reação luminosa; Desligada mostra-o
imediatamente. A preferência da rolagem é independente da revelação e começa em
Completa. A opção Seguir o Windows usa a preferência de movimento do sistema.

## Verificação

`node --test` — 173 testes passaram na implementação, incluindo testes de:

- trajetória, aterrissagem e interrupções sem movimento reverso;
- 1.200 rolls automáticos, memória limitada e apenas um rAF;
- snapshots repetidos, rajadas, descoberta anterior ao último resultado do batch;
- ocultação, retomada, reduzida/desligada, descarte do controlador;
- 100.000 amostras decorativas, sem acesso à matemática real.

`node scripts/preview-rng-roll.cjs` abre um servidor local em
`http://127.0.0.1:4387`. Usa o HTML/CSS e o controlador de produção, mas resultados
simulados e um modal de teste no lugar da cena de reveal. Não lê saves nem cria
uma ponte Electron. Os controles de teste não são empacotados no aplicativo.

Observados na prévia: manual Básico/Singular/Mítico/Além do NTC, automático por
dezenas de resultados, pausa, retomada, rajada de 100 resultados, ocultar/voltar,
Abissal durante auto, reduzida/desligada e painel estreito. A amostragem mostrou
intervalos de aproximadamente 13,34 ms (máximo 13,5 ms nas sequências observadas),
zero deslocamentos reversos e nenhum erro de console. A janela estreita foi
testada isolando o painel do mínimo global de 930 px do app.

Limite: a prévia não valida a renderização de toda a janela Electron sob carga,
nem observa diretamente as cenas cinematográficas existentes. A lógica, assets
e timelines dessas cenas, os saves e o RNG real não foram reformulados.
