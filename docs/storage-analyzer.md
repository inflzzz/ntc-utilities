# Analisador de Armazenamento — arquitetura e validação

## Decisão arquitetural

A análise roda em um `worker_thread` dedicado. Em volumes NTFS, o worker tenta iniciar o helper Windows empacotado, que enumera entradas em lotes e retorna tamanho lógico, alocação, atributos, timestamps e IDs de arquivo. Arquivos reparse são classificados individualmente; um item incompatível não descarta o restante do scan nativo. Em outros sistemas de arquivos, ou se o helper estiver ausente, não iniciar ou falhar, o worker registra o motivo e usa a caminhada iterativa `readdirSync`/`lstatSync`. Chamadas síncronas ficam isoladas no worker e não bloqueiam a janela. O cancelamento usa `SharedArrayBuffer` + `Atomics` e encerra o processo auxiliar quando necessário.

O renderer não recebe a árvore completa. O worker mantém um modelo compacto com strings de nomes, parent IDs e metadados em typed arrays. Consultas, ordenação, filtros e agregações permanecem no worker. Pelo IPC passam somente progresso, páginas de até 250 itens e um modelo de treemap podado em no máximo 5.000 nós. Não há IPC por arquivo.

O treemap usa Canvas 2D e particionamento binário balanceado: irmãos ordenados por tamanho são divididos em grupos próximos da metade do espaço e o corte segue o eixo mais longo. A ideia visual foi estudada no [relato do autor do SpaceMonger](https://www.werkema.com/2019/03/05/spacemonger-treemapping-redux/) e no [código público do SpaceMonger 1.x (MIT)](https://github.com/seanofw/spacemonger1), sem copiar código. A área de cada bloco continua proporcional ao tamanho. O renderer mostra no máximo dois níveis por vez, compacta cadeias de pastas com filho único e agrega itens menores que a resolução útil. Cada entrada em uma pasta solicita uma nova projeção ao worker, preservando a árvore real e mantendo o IPC em até 5.000 nós. Não cria DOM por arquivo; o hit testing usa os retângulos da última pintura.

## Alternativas avaliadas

As primeiras provas de conceito compararam estas abordagens. A versão atual usa o helper NTFS em lotes descrito acima e mantém o worker Node como fallback.

| Abordagem | Resultado local sobre a mesma árvore de dependências |
| --- | ---: |
| Node síncrono no processo de benchmark | 16.992 arquivos, 2.945 pastas, 514 ms |
| Node assíncrono sequencial (`opendir`/`stat`) | mesmos totais, 1.488 ms |
| Worker Node com modelo/agregações | 16.992 arquivos, 2.944 pastas sem contar a raiz, 760 ms internos / 796 ms de parede |
| Prova C# nativa (`Directory.EnumerateFileSystemEntries`) | 16.990 arquivos, 2.945 pastas, 2 erros, 1.719 ms |

Os números variam com cache do filesystem e não são comparação com produtos externos. A prova C# media somente enumeração e tamanho lógico; não demonstrou vantagem que justificasse um helper, compilação e distribuição adicionais. O worker Node foi escolhido pela combinação de correção observada, isolamento da UI, cancelamento atômico e build sem binário extra.

## Windows e correção

- `lstat` impede seguir links simbólicos e junctions; itens linkados são registrados, não atravessados.
- Hard links usam `dev + ino` quando `nlink > 1`. O tamanho lógico continua visível em cada nome, mas o espaço físico é contado uma vez.
- `blocks * 512` é usado para alocação física quando o valor é válido. Foram encontrados dois arquivos em um volume real nos quais o runtime devolveu valores sentinela enormes. A validação agora rejeita qualquer alocação não segura ou maior que o tamanho lógico mais uma margem de cluster, usa o tamanho lógico como estimativa e marca o item/agregado como estimado. O app nunca apresenta esses sentinelas como petabytes reais.
- Caminhos longos ficam sob as APIs do Node no Windows e foram testados com uma árvore acima do limite histórico de 260 caracteres.
- Erros individuais (`EACCES`, `ENOENT` e equivalentes) entram na lista de avisos e não encerram o scan.
- Arquivos e diretórios que desaparecem são tratados como erro individual.
- Ações do renderer usam IDs do scan. O processo principal resolve o caminho correspondente e recusa caminhos fora da raiz autorizada.
- Remoção usa `shell.trashItem`; não existe exclusão permanente na ferramenta.

## Benchmark sintético

Execução de 29/09/2026, Windows x64, Node 24.19.0. Os tempos abaixo são medições locais, não promessas de desempenho em outras máquinas.

| Entradas | Construção + consulta + mapa | Modelo estimado | Busca | Modelo do treemap (5.000 nós) | Layout Canvas |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10.011 | 42 ms | 0,69 MB | 2,6 ms | 5,7 ms | 12,8 ms |
| 100.101 | 110 ms | 7,08 MB | 6,3 ms | 8,4 ms | 6,1 ms |
| 1.001.001 | 835 ms | 72,84 MB | 60,8 ms | 4,2 ms | 3,8 ms |

O delta real de heap do processo para 1 milhão ficou perto de 102 MB. O benchmark pode ser repetido com `pnpm benchmark:storage`.

## Validação em volumes reais

Scans e perfis de volumes reais foram usados durante a validação local. Caminhos, inventários, contagens e tempos específicos de computadores pessoais não fazem parte da documentação pública; a suíte automatizada cobre os comportamentos relevantes sem armazenar dados dos discos.

## Referências estudadas

- SpaceSharp (MIT), especialmente decisões documentadas sobre caminhada em background, hard links, tamanho em disco, squarified treemap e poda: https://github.com/ClearanceClarence/SpaceSharp
- StorageAnalyzer (implementação C++/Python e relatório treemap): https://github.com/CameronCrow/StorageAnalyzer
- SpaceBrowser (MIT, visualização treemap): https://github.com/Kiord/SpaceBrowser
- Microsoft — hard links e junctions: https://learn.microsoft.com/windows/win32/fileio/hard-links-and-junctions
- Microsoft — efeitos de links simbólicos nas APIs de filesystem: https://learn.microsoft.com/windows/win32/fileio/symbolic-link-effects-on-file-systems-functions
- Node.js — `fs` e `worker_threads`: https://nodejs.org/api/fs.html e https://nodejs.org/api/worker_threads.html
- Electron — `shell.showItemInFolder`, `openPath` e `trashItem`: https://www.electronjs.org/docs/latest/api/shell

Nenhum código desses projetos foi copiado ou adaptado. Não foi adicionada dependência ou licença de terceiros. A implementação do scanner, modelo e treemap é original para o NTC; os projetos foram usados apenas como referência funcional e arquitetural.

## Recursos entregues e limites conscientes

O CORE inclui seleção de disco/pasta, scan isolado, progresso real sem porcentagem falsa, cancelamento real, agregações, tamanho lógico/físico, hard links, reparse points, treemap, drill-down, botão contextual para voltar ao nível anterior, breadcrumb clicável com truncamento inteligente, hover, tooltip, seleção, busca, filtros, arquivos, pastas, tipos, Achados, Explorer, copiar caminho, propriedades e Lixeira com confirmação.

Duplicados e snapshots foram deliberadamente adiados. Ambos exigem persistência e hashing próprios; incluí-los nesta rodada aumentaria risco de I/O, memória e falsos positivos no CORE. “Achados” contém apenas critérios transparentes e nunca recomenda exclusão automática.

## Relatório final solicitado

1. **Estado anterior:** não havia analisador dedicado, scanner, modelo de armazenamento nem treemap.
2. **Pesquisa:** foram comparadas arquiteturas Node, worker, prova nativa C# e referências de analisadores modernos.
3. **Projetos estudados:** SpaceSharp, StorageAnalyzer e SpaceBrowser, além da documentação oficial de Windows, Node e Electron.
4. **Arquitetura escolhida:** serviço seguro no processo principal, scanner/modelo em `worker_thread`, API estreita no preload e Canvas no renderer.
5. **Alternativas do scanner:** Node síncrono, Node assíncrono sequencial e helper C# foram medidos sobre a mesma árvore local.
6. **Benchmark anterior à decisão:** os resultados da tabela “Alternativas avaliadas” orientaram a escolha.
7. **Motivo:** o worker Node combinou menor complexidade de distribuição, cancelamento real, UI isolada e desempenho melhor que a prova nativa realizada.
8. **Helper nativo:** não existe.
9. **Tecnologia do helper:** não aplicável; a prova C# ficou apenas como benchmark reproduzível.
10. **Scanner:** caminhada iterativa com `readdirSync`/`lstatSync` dentro do worker, agregando no próprio processo de trabalho.
11. **Paralelismo:** um worker dedicado evita disputar a thread do renderer; não há explosão de tarefas por diretório.
12. **Cancelamento:** `SharedArrayBuffer` e `Atomics`, consultados durante a caminhada; o worker é encerrado ao trocar de scan ou fechar.
13. **Resultados progressivos:** contagens, bytes encontrados, caminho atual e tempo são emitidos com throttle; não há porcentagem falsa.
14. **Permissões:** falhas individuais viram avisos limitados e o scan continua.
15. **Caminhos longos:** exercitados em teste real de filesystem acima do limite histórico do Windows.
16. **Links/reparse points:** `lstat` identifica links e impede travessia, evitando ciclos.
17. **Hard links:** identidade `dev + ino`; tamanho lógico aparece em cada nome e alocação física é contabilizada uma vez.
18. **Tamanho lógico/físico:** `size` e `blocks * 512`; métricas físicas inválidas usam estimativa explicitamente marcada.
19. **Estrutura de dados:** IDs parentais, arrays de nomes e typed arrays para tipo, categoria, tamanhos, datas e contagens.
20. **Memória:** uma árvore canônica fica no worker; páginas e treemap podado evitam cópias integrais no renderer.
21. **IPC/batching:** eventos agregados, páginas de até 250 itens e treemap de até 5.000 nós; nunca há IPC por arquivo.
22. **Treemap:** interativo, com hover, seleção, duplo clique, drill-down, breadcrumb, histórico voltar/avançar e inspector.
23. **Renderização:** Canvas 2D, sem um nó DOM por arquivo.
24. **Layout:** squarified, com labels apenas quando existe área útil.
25. **Datasets grandes:** modelo e layout foram medidos até 1.001.001 entradas.
26. **Busca:** consulta o índice já coletado no worker, com debounce no campo da interface.
27. **Filtros:** caminho, extensão, categoria, tamanho mínimo/máximo, idade e tipo; preferências úteis são locais.
28. **Maiores arquivos:** lista paginada, pesquisável e ordenável, 100 linhas por página.
29. **Maiores pastas:** agregação correta, lista paginada e duplo clique para focar no mapa.
30. **Tipos/extensões:** quantidade, bytes físicos e participação por categoria e extensão.
31. **Lixeira:** confirmação explícita, aviso em áreas sensíveis, `shell.trashItem` e atualização das agregações somente após sucesso.
32. **Arquivos antigos:** filtros de 6 meses, 1 ano e 2 anos.
33. **Achados:** arquivos acima de 5 GB, antigos, compactados antigos e Downloads antigos; todos rotulados como informação.
34. **Duplicados:** deliberadamente adiados; nenhum falso “duplicado confirmado” foi introduzido.
35. **Snapshots:** deliberadamente adiados para não criar persistência pesada ou comparação superficial.
36. **SpaceSharp como referência:** scanner em background, tamanho alocado, hard links, poda e treemap squarified.
37. **Paridade:** CORE de uso diário, navegação visual, listas, tipos, busca, filtros e operações seguras.
38. **Diferenças intencionais:** integração visual NTC, uma única estratégia de mapa e ausência temporária de duplicados/snapshots.
39. **Código externo reutilizado:** nenhum.
40. **Licenças:** nenhuma licença nova; projetos MIT foram somente estudados e estão citados acima.
41. **Arquivos criados:** `storage-analyzer-core.cjs`, `storage-analyzer-worker.cjs`, `storage-analyzer-main.cjs`, `storage-treemap.js`, `storage-analyzer-ui.js`, `storage-analyzer.css`, teste, benchmark e este relatório.
42. **Arquivos modificados:** `main.cjs`, `preload.cjs`, `src/catalog.js`, `src/app.js`, `src/index.html`, `src/changelog.js`, `package.json` e teste de catálogo.
43. **Dependências adicionadas:** nenhuma.
44. **Testes adicionados:** modelo, agregação, busca, filtros, treemap, filesystem real, hard link, sparse, junction, caminho longo, cancelamento, serviço seguro e Lixeira.
45. **Suíte específica:** 10/10 testes aprovados.
46. **Suíte completa:** 467/467 testes aprovados.
47. **Benchmark 10k:** 10.011 entradas em 42 ms; modelo estimado em 0,69 MB.
48. **Benchmark 100k:** 100.101 entradas em 110 ms; modelo estimado em 7,08 MB.
49. **Benchmark 1M:** 1.001.001 entradas em 835 ms; modelo estimado em 72,84 MB.
50. **Scan real:** 396.390 arquivos, 35.038 pastas, 349,6 GB, cerca de 10 s e 1 item inacessível.
51. **Memória observada:** delta de heap perto de 102 MB no benchmark sintético de um milhão de entradas.
52. **Erros encontrados:** valores sentinela em `blocks`, pastas vazias por conversão de categoria `null` para zero e cores pouco informativas em diretórios.
53. **Correções:** validação/fallback da alocação, normalização explícita de categoria nula com regressão e categoria dominante agregada por pasta.
54. **Validação visual:** realizada no app-fonte e novamente no app empacotado, incluindo estado vazio, scan, mapa, arquivos, pastas, tipos e Achados.
55. **Build:** NSIS 1.1.0 gerado e o worker foi executado com sucesso a partir do `app.asar` em um scan completo.
56. **Limitações:** a métrica física depende do que o runtime/volume expõe; itens sem informação confiável ficam marcados como estimados.
57. **Extras adiados:** duplicados, snapshots, comparação entre scans e layouts alternativos, para preservar correção, memória e qualidade do CORE.
