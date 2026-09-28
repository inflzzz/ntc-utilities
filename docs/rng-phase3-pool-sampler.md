# RNG Luck 2.0 — Fase 3: Roll Plan e sampler isolado

Status: implementado e isolado para testes. O RNG legado permanece o único motor operacional; este módulo não é importado por `main.cjs` nem pelo roteador.

## Modelo do Roll Plan

Um Roll Plan publicado aponta para o hash e a versão exatos de um snapshot publicado. Cada componente declara `componentId`, `poolId`, massa global racional (`numerator`/`denominator`) e `origin`. O construtor valida que:

- todos os pools referenciados existem, estão `active` e têm massa interna positiva;
- a versão do pool fica presa ao componente;
- IDs de componentes são únicos;
- massas são racionais reduzidos, positivos, e somam exatamente 1;
- não há ajuste automático quando a soma fica abaixo ou acima de 1.

O snapshot vinculado e o Roll Plan são imutáveis. Uma nova versão do snapshot invalida o plano antigo; mudanças na participação global exigem publicar uma nova versão explícita do plano. Pools omitidos não entram no sorteio. Pools de evento sintéticos usam a mesma regra e não têm política de ativação própria.

## Algoritmo

1. Validar snapshot/planos publicados e a partição racional exata do Roll Plan.
2. Obter um fluxo criptográfico de bytes (`crypto.randomBytes`). Nos testes, a factory da fonte injeta bytes determinísticos; ela não é conectada ao app.
3. Selecionar componente do Roll Plan por partição racional exata.
4. Pedir ao backend MPFR apenas os pools referenciados e a precisão atual. Selecionar entre coortes com slots disponíveis e grupos de fallback/escrow pela massa racional exata; seus pesos somam exatamente o budget do pool.
5. Selecionar o título dentro da coorte/fallback usando os intervalos dyádicos MPFR RNDD/RNDU. O limite aleatório após `k` bits é `[j/2^k, (j+1)/2^k)`. Comparações usam `BigInt`; nenhum limiar passa por `Number`.
6. Retornar somente se o intervalo inteiro do número aleatório estiver no interior certificado de exatamente um slot. Em Auto neutro, o backend fornece racionais exatos e o sampler usa essa rota exata, inclusive em fronteiras dyádicas.

Os estágios usam segmentos consecutivos do mesmo fluxo de bits. Consumir um prefixo variável e continuar com os bits subsequentes mantém a independência dos estágios sob a hipótese criptográfica do fluxo. Não há modulo, arredondamento de fronteira ou seleção pelo valor mais próximo.

## Refinamento e erro

Precisão e prefixo de entropia começam em 128 bits e progridem por `128, 256, 512, 1024, 2048, 4096, 8192, 16384`. Valores 1–16384 são apenas tamanhos de precisão/entropia, não probabilidades. Se não houver decisão certificada no teto, o sampler lança `SamplerDecisionError` sem `titleId`/resultado. Erros do backend, da fonte ou da validação também falham fechados. Não há fallback para o RNG legado.

Slots de probabilidade zero são preservados na validação exata do snapshot, mas excluídos da transformação/sorteio. Slots `unobtainable` são retirados do grupo de aquisição e sua massa segue o fallback de escrow já registrado. A reserva livre também segue seu fallback. A seleção do grupo e a seleção interna usam fronteiras separadas; isso conserva trilha auditável para coorte ou fallback selecionado.

## Saída e auditabilidade

`prepareRoll({ snapshot, rollPlan, channels, mode })` valida e congela as entradas. A função `sample()` retorna `{ outcome, audit }`; o audit registra sampler/plan/snapshot/hash/versões, componente e massa, pool/coorte ou fallback, causa do fallback, modo, fórmula, Manual Power, ID/hash do MPFR certificado, precisão final, refinamentos por estágio e bits consumidos. Erros carregam `outcome: null`; nada é persistido.

`channels` aceita apenas Core, Build e Temporary Luck. Drop Luck não participa. Manual e Auto atravessam o mesmo algoritmo; Manual usa a versão e fator já implementados no backend.

## Limites

- O sampler exige que a orquestração futura forneça um Roll Plan publicado; não escolhe pools/eventos.
- O cache de distribuição fica restrito ao roll preparado e à instância MPFR existente; nenhuma decisão é salva.
- O teto pode devolver erro para uma entrada matematicamente ambígua. A política deliberada é não conceder título.
- A suíte mede caminhos com 200, 1.000 e 10.000 slots, mas 10.000 custa centenas de milissegundos no primeiro cálculo nesta máquina. Otimização do cache/árvore de prefixos é posterior e não pode enfraquecer a prova.
- A injeção determinística da fonte só existe para harnesses/testes; produção sem injeção usa o CSPRNG do Node.

## Medições de referência (Windows de desenvolvimento)

Observações não são metas de performance: medição em processo novo deu ~7 ms de require/módulo, ~28 ms de inicialização MPFR/WASM e ~35 ms até backend pronto. Em execuções repetidas, o primeiro roll de 200/1.000/10.000 slots ficou aproximadamente em 13–16/49–53/473–500 ms; rolls seguintes com a distribuição preparada ficaram em ~0,06–0,34 ms. Um caso `1e-1000` que precisou refinar entropia/precisão foi ~33 ms. O custo de 10.000 slots é visível; não foi sacrificado rigor para reduzi-lo.

## Limite da fase

Não há chamadas a `main.cjs`, `src/rng-engine-router.cjs`, `rollBatch`, saves, recompensa, UI, evento real, Supabase ou Ecos. `NTC_RNG_ENGINE=luck2` continua indisponível/fail-closed. Fase 4 continua separada e não iniciada.
