# Atualizador e histórico acumulado

O atualizador usa o provedor GitHub do electron-updater, sem download automático nem instalação ao fechar. Faz uma checagem ao iniciar, a cada 15 minutos e ao recuperar o foco quando a última checagem tem pelo menos 15 minutos. Retomar da suspensão permite uma checagem após um minuto. Checagens simultâneas são unificadas; durante download ou com instalador pronto não são iniciadas novas checagens.

Cada release deve incluir `changelog.json`, gerado com `node scripts/build-release-history.cjs <diretório dos artefatos>`. Esse arquivo inclui o histórico completo, permitindo mostrar todas as versões intermediárias sem depender do limite do feed Atom. O cliente aceita somente JSON com schema 1, versão correspondente, tamanho até 2 MB e versões estáveis válidas; renderiza apenas texto, nunca HTML remoto. A requisição tem prazo de 12 segundos. Falha na leitura não bloqueia a atualização: o feed GitHub com `fullChangelog` é usado como alternativa.

O aviso é não bloqueante e não rouba o foco. “Agora não” suprime a mesma versão/etapa na sessão; uma nova versão ou a conclusão do download pode aparecer. Uma checagem manual permite reabrir o aviso. Resultados periódicos sem novidades e falhas de rede não geram toasts. A versão atual, destino e notas permanecem disponíveis durante o download.

O resumo pós-atualização usa o histórico incluído no aplicativo, selecionando versões maiores que a última visualizada e até a instalada. O marcador é salvo somente ao fechar o resumo. Consultar uma atualização ainda não instalada não altera esse marcador. O botão de histórico nas configurações mantém acesso a todas as versões.

Publicação: validar os testes, gerar o instalador e seu blockmap, gerar o histórico, verificar a versão/hash em latest.yml e publicar os quatro arquivos juntos em um release inicialmente draft. Não publicar latest.yml antes do instalador. Builds antigos só recebem esse comportamento após instalar uma versão que o contenha.
