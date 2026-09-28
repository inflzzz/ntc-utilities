# NTC RNG — Account Level v1

Esta primeira etapa adiciona somente nível global da conta e XP. Não há recompensas de nível, Luck, quests, prestige ou integração com as probabilidades do RNG.

## Regra e curva

Cada roll real processado concede exatamente 1 XP. A quantidade é o delta do contador semântico `totalRolls` entre o estado anterior e o estado devolvido pelo batch — nunca `results.length`. Portanto, resultados adicionais produzidos por um roll não aumentam o XP. Shadow rolls, tentativas interrompidas antes do retorno do batch e fontes que não sejam rolls reais não concedem XP.

O custo para avançar do nível `L` para `L + 1` é:

```text
XP_próximo(L) = 10 × L
```

O XP vitalício acumulado necessário para alcançar o nível `L` (começando no nível 1) é:

```text
XP_acumulado(L) = 5 × L × (L - 1)
```

A curva é estritamente crescente e sem cap. Os exemplos iniciais:

| Nível alcançado | XP acumulado | XP do nível seguinte |
|---:|---:|---:|
| 2 | 10 | 20 |
| 3 | 30 | 30 |
| 4 | 60 | 40 |
| 5 | 100 | 50 |
| 6 | 150 | 60 |
| 7 | 210 | 70 |
| 8 | 280 | 80 |
| 9 | 360 | 90 |
| 10 | 450 | 100 |

Como cada roll real concede 1 XP, alcançar os níveis 5, 10, 25, 50 e 100 exige, respectivamente, **100, 450, 3.000, 12.250 e 49.500 rolls**. A 1 roll/s constante isso corresponde aproximadamente a 1m40s, 7m30s, 50m, 3h24m e 13h45m. São referências de protótipo, não promessas de duração: rolls por ação e uso de Auto variam.

## Representação e persistência

`accountLevel`, `accountXp` (XP dentro do nível atual) e `lifetimeAccountXp` são persistidos como strings decimais canônicas em um nó `accountProgress` separado, montado pelo processo principal junto do save JSON. A aritmética usa `BigInt`; portanto não depende da precisão finita de `Number`, mantém os valores serializáveis em JSON e aceita XP futuro em quantidades maiores. O progresso público também expõe `xpToNextLevel` e `progressBasisPoints` para a interface.

O XP vitalício é a fonte de verdade. Na leitura do save, nível e XP corrente são recalculados exatamente a partir dele. O schema e a normalização de `src/rng.cjs` permanecem inalterados; saves anteriores sem `accountProgress` iniciam no nível 1 com zero XP, sem migrar rolls, coleção ou histórico. Se um save contiver os campos top-level gravados pela primeira versão desta feature, o processo principal os incorpora ao nó `accountProgress` na próxima persistência. A gravação atômica com backup já existente continua sendo usada.

O nível pode ser recuperado sem iterar por cada nível: para XP vitalício `T`, usa-se a raiz quadrada inteira de `1 + floor(4T/5)` e `L = floor((1 + raiz)/2)`. Isso também permite conceder múltiplos níveis com um único acréscimo de XP.

## Fronteira com o RNG

O XP é concedido em `performRngRoll`, somente depois que o roteador e o bridge shadow retornam um batch legado bem-sucedido. A quantidade é o delta de `totalRolls` antes/depois do batch, calculado por `countProcessedRolls`; o resultado visual não determina XP. O caminho Manual continua chamando a mesma função com `manual: true`; Auto usa o mesmo batch sem essa opção. O estado de XP não é usado por `currentWeights`, pelo sampler, pelo roll plan nem pelo motor shadow.
