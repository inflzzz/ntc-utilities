# Desinstalador — implementação e validação local

Data: 30/09/2026. Projeto: NTC Utilities. Nenhuma release, tag, commit ou publicação foi realizada nesta entrega. A versão do aplicativo permanece 1.3.0; o instalador gerado é uma build local de desenvolvimento, não uma nova atualização pública.

## Onde encontrar

**Sistema / Tela → Programas → Desinstalador**. Também disponível pela busca, favoritos e recentes do catálogo existente.

O fluxo é: selecionar programa → executar o desinstalador oficial → revisar sobras e evidências → confirmar a seleção em diálogo nativo → quarentena/backup → consultar o resultado, restaurar ou exportar o relatório.

## Escopo e limites importantes

### Refinamentos de interface — 30/09/2026

**Tamanhos automáticos:** a lista consulta manifests da Steam pelo AppID e caminho registrados e verifica as pastas de instalação em segundo plano, com dois cálculos simultâneos. Soma os tamanhos lógicos dos arquivos, inclusive subpastas, sem ler seu conteúdo nem limitar a contagem arbitrariamente. Os resultados atualizam a lista, os detalhes, os filtros e a ordenação; seleção e rolagem são preservadas. Raízes/junctions da instalação são resolvidas uma vez; links internos são excluídos e a medição aparece como parcial (`≥`). O cache dura dois minutos; **Atualizar lista** e **Recalcular tamanho** forçam nova verificação. A medição não fornece nem altera caminhos autorizados para limpeza.

Quando não existe InstallLocation, tenta a pasta do executável/ícone registrado, sem medir a raiz do disco ou diretórios genéricos. Tamanho apenas registrado é identificado como aproximado (`≈`) no fallback. Uma pasta inacessível ou impossível de atribuir recebe motivo explícito — **Acesso bloqueado** ou **Pasta não localizada** — nunca um zero inventado. Permissões não são alteradas e a medição não concede autorização para remover arquivos.

Validação real, somente leitura: Cyberpunk 2077 em `D:\SteamLibrary\steamapps\common\Cyberpunk 2077`: **98.147.215.030 bytes**, 188 arquivos, 12 ms; Clair Obscur: Expedition 33 em `D:\SteamLibrary\steamapps\common\Expedition 33`: **47.059.987.075 bytes**, 146 arquivos, 11 ms. Ambos conferem com os respectivos manifests, sem leitura parcial. A interface do NTC usa divisores de 1024 como nas outras ferramentas. Foram acrescentados seis testes de medição, um teste de autorização/imutabilidade de metadados e a verificação de atualização automática do tamanho na interface.

- Confirmações nativas identificadas como **NTC Utilities**, com texto separado por etapas, sem repetição do nome do programa e com **Cancelar** como opção padrão.
- Botões **Mais pesados** / **Mais leves** na lista de programas e ordenação por tamanho dentro de cada categoria da revisão de sobras. Tamanhos não informados ficam sempre no fim; ordenar não inicia uma análise nem muda a seleção de remoção.
- Atualização automática da lista ao terminar a fila de desinstalação, mantendo busca, filtros e ordenação. Quando o desinstalador oficial deixa um processo filho, a lista é verificada a cada cinco segundos por até dois minutos e novamente ao voltar ao aplicativo. Um programa só desaparece quando o registro de instalação deixa de constar no inventário.
- **Limpar histórico…** reúne os registros atuais em uma confirmação nativa. Backups e operações com registros pendentes são preservados por padrão. A exclusão permanente da quarentena e dos backups requer marcar explicitamente a opção correspondente. A operação revalida os registros após a confirmação; falhas permanecem visíveis e são informadas. Novos históricos criados depois da confirmação não entram na exclusão.
- Validação adicional: seis testes de serviço (incluindo cancelamento, backup criado durante a confirmação, exclusão autorizada e falha de exclusão) e teste de interface com ordenação, preservação da seleção e atualização automática. Esses testes usam dados simulados e não removem programas ou backups reais.

A ferramenta não é um limpador genérico de registro. Não procura palavras semelhantes para apagá-las. Pastas de instalação compartilhadas, componentes críticos, drivers, COM e configurações que não podem ser restauradas com segurança ficam preservados. Dados pessoais não são selecionados automaticamente.

O monitoramento implementado compara snapshots delimitados. **Não é um rastreador ETW nem atribui alterações à árvore de processos do instalador.** O relatório informa essa limitação; correlação temporal isolada não autoriza remoção. Isso não equivale à cobertura integral do Revo Pro.

## Relatório solicitado — 50 pontos

1. **Arquitetura encontrada.** Electron, processo principal CommonJS, preload com contextBridge, renderer JavaScript/HTML/CSS e catálogo central. O build Windows usa electron-builder/NSIS e recursos externos em `resources/bin`. As outras ferramentas não foram refatoradas.

2. **Arquitetura implementada.** Interface local, serviço no processo principal, RPC limitado para um helper C# e ponte PowerShell de ações fixas. A interface envia IDs de programas/candidatos; comandos de desinstalação e alvos mutáveis são derivados e revalidados no helper. Operações privilegiadas usam uma sessão separada.

3. **Fontes de descoberta.** Registro Uninstall de HKCU/HKLM, visões 32/64 bits, metadados registrados de MSI e pacotes AppX/MSIX do usuário atual. Não usa Win32_Product nem dispara repair de todos os MSIs. Entradas equivalentes espelhadas são deduplicadas. Instalações portáteis não registradas exigem escolha manual; não são inventariadas automaticamente.

4. **EXE.** Executa o desinstalador registrado, preservando os argumentos fornecidos pelo fabricante. Reconhece caminhos não delimitados com espaços apenas quando existe um prefixo `.exe` inequívoco. Despachantes como cmd, PowerShell, rundll32 e scripts são recusados em vez de transformar texto do registro em comando arbitrário. Esse bloqueio pode limitar aplicativos legítimos que dependam desses despachantes.

5. **MSI.** Identifica WindowsInstaller/ProductCode e usa `msiexec /x {GUID} /norestart`, com `/qn` somente quando solicitado. Verifica novamente o registro depois da execução. Uma fixture MSI real por usuário foi instalada e desinstalada. Parâmetros sem espaços não recebem aspas indevidas — o teste detectou e corrigiu a abertura acidental da ajuda do Windows Installer.

6. **MSIX/AppX.** Inventário e remoção pelo mecanismo do Windows, apenas no usuário atual. Frameworks, recursos e componentes críticos ficam protegidos. A remoção é registrada no histórico. Não se aplica a esses pacotes a limpeza genérica de WindowsApps, e não há suporte a remover provisionamento/all-users. Validação real nesta máquina foi somente de leitura; nenhum pacote real foi desinstalado.

7. **Associação de sobras.** Usa localização registrada, ausência de sobreposição com outra instalação, caminhos diretos de comandos/atalhos/recursos, identidade de arquivo e conteúdo/tipo de valores do registro. Reanalisa as entradas antes de agir. Se não há pasta exclusiva confiável, informa a limitação e preserva os itens.

8. **Confiança.** Alta: associação direta a uma instalação exclusiva; média: alvo manual ou evidência corroborativa; baixa: coincidência textual. Cada candidato mostra motivos. Confiança baixa é não removível. Serviços/tarefas/firewall não ficam selecionados automaticamente mesmo quando elegíveis.

9. **Falsos positivos.** Pastas iguais, sobrepostas ou registradas por outro produto bloqueiam a propriedade exclusiva. Nome parecido ou fabricante igual não confere autorização. Caminhos gerais do sistema, dados do usuário e recursos compartilhados têm proteção adicional. Há testes ABC × ABC Studio, mesmo fabricante, pasta compartilhada, junction e alteração posterior à análise.

10. **Arquivos/pastas.** Analisa filhos da pasta exclusiva com limites explícitos. Árvores incompletas, links internos e entradas inacessíveis são preservadas. Antes de mover, compara identidade e digest de caminhos relativos/tamanhos/datas. A movimentação usa handles e valida o destino exato. Não faz limpeza recursiva de raízes genéricas como Windows ou Users.

11. **Registro.** Remove apenas valores associados por caminho direto e, na análise forçada, a entrada exata do produto previamente congelada/revalidada. Chaves gerais permanecem somente leitura. Não apaga uma chave-pai compartilhada por ter encontrado um valor relacionado.

12. **Serviços.** Detecta por ImagePath. Pode parar/remover serviços standalone LocalSystem com configuração básica, sem subchaves/configurações avançadas, após seleção e confirmação. Backup antes da operação e restauração via Service Control Manager, incluindo descrição. Serviços compartilhados, drivers e configurações complexas são preservados. Não há suporte a reconstruir credenciais, configurações avançadas ou ACLs personalizados de serviço.

13. **Tarefas agendadas.** Compara todas as ações com a pasta exclusiva; ações mistas, tarefas do Windows e logons com credenciais não restauráveis são preservados. Faz backup do XML/principal/logon, desabilita e remove. Se a exclusão falha, tenta restaurar o estado habilitado. A restauração não sobrescreve uma tarefa existente.

14. **Startup.** Run/RunOnce HKCU/HKLM, nas duas visões, por comando associado diretamente. Backup de um valor com nome, tipo e dados antes da exclusão. Não é um gerenciador global de inicialização.

15. **Atalhos.** Detecta destinos reais de `.lnk` no Desktop e menu Iniciar do usuário/comuns. O destino é revalidado antes de colocar o atalho em quarentena. Restauração usa o nome/caminho exato e não substitui arquivo existente.

16. **Associações.** Localiza valores de comando em Software/Classes que apontam diretamente para o executável exclusivo. Remove o valor, não a árvore compartilhada inteira. Mantém metadados de hive/visão/chave/nome/tipo visíveis no motivo detalhado.

17. **Protocolos.** Mesmo mecanismo conservador das associações; um handler de protocolo descartável foi removido e restaurado no teste real. Não altera associações protegidas UserChoice nem força mudanças de aplicativo padrão.

18. **Shell extensions.** Identificação conservadora de COM/CLSID/shellex, somente leitura. Não há desregistro/re-registro de DLLs ou remoção automática de extensões do shell. Esses itens ficam preservados e explicados.

19. **Firewall.** Regras associadas diretamente por ApplicationName. Somente nomes exclusivos e configurações simples/restauráveis são elegíveis. Regras de serviço, duplicadas, restrições de identidade/autenticação/interface ou opções avançadas ficam preservadas. Usa INetFwRule3 explicitamente para verificar esses campos. Backup/restauração real de regra descartável validado, sem sobrescrever conflito.

20. **Drivers.** Identificados pelo tipo de serviço e preservados. Não remove pacotes de driver, DriverStore, filtro de dispositivo ou runtime compartilhado.

21. **Dados pessoais.** Saves, mods, workshop, screenshots, perfis, projetos, bancos/configurações conhecidos e arquivos potencialmente pessoais ficam desmarcados. A seleção explícita exige aviso adicional no diálogo nativo. Coincidências em AppData por nome continuam não removíveis. A identificação é heurística e não prova que todos os dados pessoais de qualquer aplicativo foram encontrados.

22. **Processos.** Identificação por executável dentro da pasta exclusiva, não pelo nome. Prévia antes do lote e fechamento normal de janelas mediante confirmação. O backend dispõe de encerramento forçado, também com confirmação e revalidação; não é oferecido como ação principal na interface. Não há rastreamento ETW de processos filhos.

23. **Arquivos bloqueados.** São preservados, com motivo no resultado. Não força desbloqueio, não mata processos pelo nome e não usa Restart Manager para listar todos os detentores. Teste de arquivo aberto sem compartilhamento confirmou preservação.

24. **Desinstalação forçada.** Programa registrado pode ser analisado sem o desinstalador oficial após aviso. Alvo manual precisa ser escolhido no diálogo do processo principal. A escolha manual não eleva a confiança a alta: candidatos ficam desmarcados e exigem revisão individual.

25. **Lote.** Fila sequencial, até 100 IDs válidos, progresso por programa e resultados individuais. Interrupção encerra a fila depois do desinstalador atual; não termina à força um instalador legítimo. O teste confirma que o segundo programa não inicia antes do primeiro e não é iniciado após cancelamento.

26. **Silencioso.** Usa QuietUninstallString registrado ou `/qn` para MSI. Sem quiet registrado, não inventa flags. Se o aplicativo fornecer apenas o comando quiet, usa esse comando registrado. Não promete esconder um desinstalador EXE que não ofereça esse modo.

27. **Monitor de instalação.** Seleciona EXE/MSI, registra identidade do instalador, baseline, executa, espera término do processo inicial e conclui com snapshot final/log. O usuário precisa concluir também instaladores filhos antes de finalizar. Os logs corroboram caminhos já associados, mas não criam autorização por timestamp. Alterações fora das fontes/pastas cobertas não são capturadas.

28. **Snapshots.** Metadados de arquivos e registros de programas/recursos associados, com limite de 60.000 arquivos distribuído entre as instalações. Também compara startup, associações, serviços, tarefas, atalhos, ambiente e firewall relacionados. Cobertura parcial é sinalizada. Não faz backup do conteúdo de todos os arquivos modificados nem captura o registro completo do Windows.

29. **Quarentena.** Movimentação atômica no mesmo volume, sem copiar gigabytes silenciosamente. Para outra unidade, usa uma área de quarentena protegida naquele volume, segregada por SID/operação. Na unidade do armazenamento, usa a pasta da operação. Journal gravado antes da mutação. A estratégia entre volumes está implementada, mas não foi exercitada com uma segunda unidade nesta validação.

30. **Restauração.** Recupera itens disponíveis sem sobrescrever conflitos; mantém erros para nova tentativa. Verifica conteúdo em quarentena antes de restaurar. Não reinstala o programa, não recupera arquivos que o desinstalador oficial tenha apagado e não restaura um backup já excluído manualmente.

31. **Backup do registro.** Snapshot estruturado de nomes, tipos, dados e subchaves para o alvo específico. Tipos String/ExpandString/MultiString/Binary/DWord/QWord têm conversão de restauração. Teste real validou valor Run e handler de protocolo. Não preserva ACLs personalizados de qualquer chave arbitrária, nem cria backup de todo o registro.

32. **System Restore.** Opcional e explicitamente confirmado. Usa Checkpoint-Computer e verifica que apareceu um novo ponto. Se proteção estiver desativada, limitada ou indisponível, mostra erro; não afirma sucesso. Não foi criado ponto real nesta validação para não alterar desnecessariamente a configuração do usuário.

33. **Histórico.** Journal local de execução oficial e limpezas, bytes efetivamente movidos, itens removidos/preservados/restaurados, conflitos, backups e candidatos não selecionados. Recuperação de journal interrompido existe para arquivos e registro; não é recuperação transacional completa de todos os recursos. Exportação JSON por diálogo nativo, sem publicar paths/logs.

34. **Elevação.** Helper de sistema separado via RunAs/UAC. HKCU/AppX continuam no helper normal; alvos HKLM usam a sessão privilegiada. Backups elevados ficam em ProgramData com proprietário/ACL de Administrators/System, não importados de journals editáveis pelo renderer. Em contas administrativas já elevadas, o Windows pode não mostrar UAC.

35. **IPC/helper.** Sender e mainFrame conferidos, IDs conhecidos, allowlist de ações, comandos não expostos pelo preload, fingerprint do produto conferido antes da execução, candidatos internos imutáveis e revalidação antes da limpeza. Canal elevado usa nome aleatório de 256 bits, ACL e PID do cliente. Não há promessa de isolamento contra um administrador local malicioso ou binários do próprio aplicativo adulterados.

36. **Performance.** Trabalho nativo fora do renderer; inventário em lotes, sem chamada por arquivo ao Electron. Busca/ordenação locais. Ícones sob demanda para linhas visíveis. Cache de normalização de caminhos; scanners delimitados por fontes/pastas e limites. Snapshot amplo é mais lento que a lista e informa cobertura parcial. Não foi feito benchmark universal de milhares de configurações Windows.

37. **Arquivos criados.** `src/uninstaller-host.cs`, `src/uninstaller-windows.ps1`, `src/uninstaller-main.cjs`, `src/uninstaller-ui.js`, `src/uninstaller.css`, scripts de compilação/validação, fixtures e testes `test/uninstaller*`, e este relatório. Binários gerados em resources/bin e artefatos locais em tmp.

38. **Arquivos modificados.** main.cjs, preload.cjs, src/index.html, src/app.js, src/catalog.js, package.json e test/catalog.test.cjs. Integrações pontuais de navegação, lifecycle, recursos e catálogo. Treemap, scanner de armazenamento, presets e áudio não foram redesenhados ou refatorados.

39. **Dependências.** Nenhuma dependência npm de produção nova. Reutiliza Electron, estilos e catálogo do projeto.

40. **Helpers.** `uninstaller-host.exe` e `uninstaller-windows.ps1` explicitamente incluídos no filtro extraResources, em `resources/bin` no pacote. Falta de um asset gera erro visível, não fallback silencioso para outra ferramenta.

41. **Runtimes externos.** .NET Framework do Windows e Windows PowerShell 5.1. Sem requisito de instalar um runtime .NET moderno ou Visual C++ novo para este helper. Compilação local usa csc do Framework64. Windows desktop x64 é o alvo validado; não foi feito teste de VM Windows limpa, ARM64 ou Server Core.

42. **Testes adicionados.** Autorização de IPC/frame, seleção/confirmacão, EXE real, MSI real, lote/cancelamento, snapshots com ruído, arquivos/registro/quarentena/restauração e recursos de sistema descartáveis. Runners Electron separados para interface e assets instalados.

43. **Falsos positivos testados.** ABC versus ABC Studio, fabricante igual, pasta compartilhada, dados pessoais, junction para outro aplicativo, hard link e evidência de arquivo que mudou. Todos mantêm o recurso externo/pessoal não selecionado intacto. Não houve remoção de software real para validar.

44. **Testes específicos.** Os sete testes do Desinstalador passaram. O runner Electron confirmou lista/busca, tamanho estimado, seleção segura, baixo risco desabilitado, restauração/relatório, recursos de snapshots, alinhamento de checkbox e layout estreito. Os testes nativos confirmaram conteúdo, mtime relevante, Unicode, arquivo bloqueado, registro, serviço/descrição, tarefa habilitada, portas da regra e atalho/protocolo.

45. **Suíte completa.** `pnpm test`: **513 testes aprovados, zero falhas, cancelamentos ou skips**, duração de 126,1 segundos. Runners Electron sem execução sob Node não substituem seus testes explícitos; ambos foram executados separadamente.

46. **Build.** NSIS de produção gerado localmente, com helper e ponte. Não foi instalado por cima do NTC do usuário, nem enviado ao GitHub. O artefato público existente não foi substituído e não se gerou uma nova versão para o atualizador.

47. **DEV.** Helper compilado encontrado, health/bridge confirmados, inventário real lido e fixtures exercitadas. Nenhum software real foi desinstalado. Tempos e contagens são os desta máquina, não promessa de velocidade geral.

48. **Unpacked.** Assets e serviço/preload/renderer do app.asar exercitados por runner Electron isolado; inventário de programas e pacotes AppX retornou dados reais. Caminho do helper foi o do pacote, não o de desenvolvimento.

49. **Instalado.** NSIS de validação com AppID/nome próprios, sem o macro que remove outras cópias do NTC, instalado em diretório exclusivo de teste. Helper/ponte extraídos, hash comparado e serviço/preload/renderer empacotados testados de forma isolada. Isso valida os assets instalados e a ponte real; não é um teste manual de todas as ferramentas do aplicativo instalado nem uma simulação de UAC por usuário padrão.

50. **Limitações restantes.** Sem atribuição ETW/árvore de processos; sem remoção de drivers/COM/shell ou variáveis globais; sem varredura genérica de todo o disco para apps antigos; sem remoção atrasada no reboot; sem reaplicar ACLs/credenciais avançadas; sem suporte garantido a caminhos longos do Framework, todos os formatos de uninstaller ou todos os pacotes MSIX. Histórico anterior fornece âncoras de sobras antigas; nomes soltos não. Retenção é manual, sem expiração automática de 30 dias. Itens não suportados ficam preservados.

## Validação executada

- Leitura real: aproximadamente 190 registros tradicionais e 69 pacotes do usuário nesta máquina; componentes protegidos são ocultados por padrão na interface. Contagens variam conforme fixtures/instalação de validação.
- Testes específicos: **7/7 aprovados**, incluindo instalação/desinstalação MSI e EXE descartáveis e backup/restauração de recursos.
- Interface Electron: **8 verificações aprovadas**, com layouts desktop e estreito.
- Pacote unpacked: assets, health, lista, preload e renderer aprovados.
- Instalação NSIS isolada: assets, hash, health, lista, preload e renderer aprovados; repetida após as últimas correções do helper.
- Suíte completa: **513/513 aprovados**, zero falhas, cancelamentos ou skips.
- SHA-256 do helper idêntico em DEV, unpacked e instalação NSIS: `2B996A72D5817E969BB1539AB9C6D2DC13FC7ED5F769A2783D61E83E0527A88B`.
- Instalador local: `tmp/uninstaller-build/NTC.Utilities.Setup.1.3.0.exe`, 330.048.769 bytes. NSIS isolado: `tmp/uninstaller-installed-validation-build/NTC.Uninstaller.Validation.exe`. Não executar o instalador de validação como atualização pública.

Durante os testes, uma falta de terminação/padding no buffer de rename foi detectada pelo teste de restauração do atalho. Foi corrigida, junto com confirmação da identidade/caminho depois de mover. Dois atalhos descartáveis de testes anteriores ficaram no Desktop com sufixos inválidos; a tentativa de removê-los foi bloqueada pela política do ambiente. Não pertencem a aplicativos reais. Os nomes são `NTC-Disposable-3cd1d402-d681-4006-bc81-315842825481.lnk55]` e `NTC-Disposable-83f7d4bb-227d-4bf4-8e58-27d386b70a27.lnk]`.

A cópia isolada `NTC Uninstaller Validation` também foi mantida: sua tentativa de desinstalação silenciosa retornou código 2. Essa falha é da limpeza do ambiente de validação NSIS, não um teste aprovado de remoção dessa cópia. Ela não substituiu nem removeu instalações reais do NTC. Os resultados de helper/preload/renderer instalado acima foram obtidos antes dessa tentativa.

## Fontes técnicas

Arquitetura/decisões baseadas em documentação primária do Windows; interfaces Revo/BCU foram consultadas apenas como referência conceitual, sem copiar código proprietário.

- [Registro Uninstall e metadados MSI](https://learn.microsoft.com/en-us/windows/win32/msi/uninstall-registry-key)
- [Visões alternativas do registro](https://learn.microsoft.com/en-us/windows/win32/winprog64/accessing-an-alternate-registry-view)
- [msiexec](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec)
- [Remove-AppxPackage](https://learn.microsoft.com/en-us/powershell/module/appx/remove-appxpackage)
- [Exclusão de serviços](https://learn.microsoft.com/en-us/windows/win32/services/deleting-a-service)
- [Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)
- [INetFwRule3](https://learn.microsoft.com/en-us/windows/win32/api/netfw/nn-netfw-inetfwrule3)
- [Contrato Windows SDK de firewall](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/netfw.idl)
- [FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info)
- [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)
- [PID do cliente de named pipe](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid)
- [Verificação local de assinatura](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_data)
- [Referência conceitual Revo](https://www.revouninstaller.com/online-manual/uninstaller/) e [BCU](https://www.bcuninstaller.com/)
