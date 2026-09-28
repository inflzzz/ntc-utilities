# Fase 4 — catálogo canônico Pool 2.0 v1

Esta fase materializa e audita o catálogo atual; não ativa Luck 2.0. O único RNG conectado ao app continua sendo o legado.

## Artefatos

- `content/rng-pool2-catalog-v1.json`: 200 títulos, metadados de apresentação separados da identidade matemática, snapshot publicado, Roll Plan publicado e identidades/hash do catálogo, plano, fórmula, sampler e backend.
- `docs/rng-phase4-equivalence-v1.json`: comparação racional exata por título e por tier, incluindo a massa antes/depois da resolução do fallback e validação de contenção pelos intervalos MPFR certificados.
- `scripts/materialize-rng-pool2-v1.cjs`: reproduz os artefatos de forma determinística; `node scripts/materialize-rng-pool2-v1.cjs --check` verifica que os arquivos gerados estão atualizados sem escrevê-los.

## Snapshot e Roll Plan

Os títulos preservam `titleId`, peso-base e ordem legada. O snapshot `pool2-catalog-v1` possui uma coorte imutável para cada um dos dez tiers e um único pool normal de massa 1. O Roll Plan `normal-roll-v1` referencia somente esse pool, com massa global exata `1/1`; eventos e pools futuros não participam implicitamente.

Para cada título, a probabilidade-base legada é a fração exata `baseWeight / 10^80`. Nomes, descrições e assets ficam fora do hash matemático: podem mudar sem mudar a identidade de distribuição. O hash matemático inclui IDs, tier, aquisição, disponibilidade, ordem, peso, probabilidade e associação ao slot/coorte; a apresentação possui hash separado.

## Reserva de 5%

Seja `B` a massa Básica legada e `Pᵢ` a probabilidade-base de cada título Básico. A reserva livre é exatamente `R = 1/20`. O snapshot mantém no slot da coorte Básica `Pᵢ − R·Pᵢ/B`; o fallback mantém a partição fixa `R·Pᵢ/B` em cada Básico. Assim, sem conteúdo usando a reserva, o estado observável é:

`(Pᵢ − R·Pᵢ/B) + R·(Pᵢ/B) = Pᵢ`.

Não existe faixa de “sem resultado”. Os outros 180 títulos mantêm sua probabilidade-base integral. O Common Floor permanece `23/25` (92%) em Luck neutra.

No catálogo atual, `B` é exatamente
`49176615705079845332544249183000628305553152783720798187581927973879510477770871 / 50000000000000000000000000000000000000000000000000000000000000000000000000000000`.

Depois da contabilização inicial, a coorte Básica contém `B − 1/20`; a reserva livre de `1/20` continua resolvendo para os Básicos nas mesmas proporções. A massa Básica observável volta exatamente a `B`. A diferença entre `B` e o piso de 92% é o espaço aritmético ainda disponível para expansão futura; esta fase não consome reserva.

## Prova

O gerador valida todos os IDs, tiers, aquisições, pesos e estados contra `currentWeights({})` e o baseline da Fase 0 (`3fd426bc078d66b699100b51e2f4a47be731e6a92256b77cf378a6e9b05e1248`). Em seguida, a prova resolve cada contribuição de fallback como racional exato. O resultado é 200/200 títulos equivalentes e 10/10 massas agregadas por tier equivalentes, cada diferença `0/1`.

Separadamente, o backend MPFR certificado executa a transformação Auto neutra a 128 bits e cada um dos 200 intervalos direcionados contém a probabilidade racional observável correspondente. Isso complementa, mas não substitui, a prova racional.

O teste do sampler prepara vetores de entropia interiores e resolve deterministically cada um dos 200 IDs reais. Ele também confirma que nenhum resultado sai do conjunto de slots/fallback do snapshot. Odds raríssimas não são validadas por frequência empírica.

## Limites desta fase

Manual não é comparado ao legado: `manual-power-v1` permanece identificado no artefato e segue os testes isolados da Fase 3. Não foram migrados bônus antigos, saves, catálogo do Supabase, rolls reais ou telemetria de jogadores. `src/rng-shadow-contract.cjs` só define um comparador efêmero e puro; não é importado pelo app e não grava dados. Shadow mode e integração continuam pendentes de autorização/fase própria.
