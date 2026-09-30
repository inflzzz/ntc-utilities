# Luz da Tela — implementação e limites

## Arquitetura

A interface (`src/screen-light-ui.js`) controla a configuração por IPC. O serviço do processo principal (`src/screen-light-main.cjs`) persiste um schema versionado em `screen-light.json`, resolve o alvo por horário/perfil/exceção e continua ativo sem a página aberta. Um helper nativo Windows (`src/screen-light-host.cpp`) enumera os monitores, guarda a rampa de gamma original e usa as exportações internas de gerenciamento de cor `InternalSetDeviceGammaRamp` e `InternalGetAppliedGammaRamp` de `mscms.dll`, com fallback para GDI. Essas funções são carregadas dinamicamente apenas da pasta System32. Não há janela/overlay, serviço externo, conta nem localização automática.

O build MSVC estático é feito por `pnpm run build:screen-light`. `package:win` o executa antes de empacotar; `extraResources` coloca `screen-light-host.exe` em `resources/bin` do aplicativo instalado. O helper usa apenas DLLs padrão do Windows (`USER32`, `GDI32`, `KERNEL32`), sem runtime VC++ redistribuível. O caminho de produção é `process.resourcesPath/bin/screen-light-host.exe`.

## Segurança e recuperação

- O helper só altera um display SDR cujo estado de cor e suporte de gamma foram confirmados. HDR, SDR com cor avançada/gama ampla e estado desconhecido ficam bloqueados; não existe fallback visual por overlay.
- A rampa anterior é salva em arquivo binário antes da primeira alteração. Desligar a ferramenta, sair do NTC, reprovar monitores ou pausar restaura a rampa. O helper também observa o processo pai e tenta restaurar se ele terminar inesperadamente. Uma nova inicialização tenta recuperar um backup pendente antes de qualquer novo ajuste.
- O caminho de gerenciamento de cor recebe a rampa completa e lê o resultado com o getter correspondente antes de aceitar a aplicação. O getter público GDI pode ler outra tabela de calibração; ele não serve como verificação desse caminho. A tentativa anterior com D3DKMT foi removida porque retornava sucesso sem afetar o desktop neste PC.
- As exportações de `mscms` são internas e não têm contrato público de compatibilidade: podem mudar em atualizações do Windows. Quando ausentes, o helper usa `SetDeviceGammaRamp` e confirma a leitura com `GetDeviceGammaRamp`. Se a leitura não confirmar, o serviço tenta intensidades menores e informa o limite. Se nenhum caminho aceitar o ajuste, restaura as rampas e apresenta erro.
- Uma troca para HDR ou do dispositivo gráfico pode impedir uma restauração imediatamente verificável; o backup é preservado para outra tentativa. O Windows e o driver também podem redefinir gamma por conta própria. A interface não afirma controle quando não há confirmação.

## Agendamento e interação

- Seis pontos iniciais de 24 horas, editáveis e arrastáveis, interpolam a temperatura inclusive atravessando a meia-noite. O cálculo solar usa latitude/longitude informadas manualmente e equações locais aproximadas; não há busca de cidade nem requisição diária.
- A configuração de transição longa é usada no automático. Ajustes manuais respondem em até 1 segundo; perfis e exceções usam até 3 segundos. A opção Instantânea continua disponível.
- Perfis oficiais e personalizados, pausa temporária, exceções do aplicativo em primeiro plano, opção experimental de tela cheia, sobrescritas por monitor, atalhos opcionais e submenu no tray existente.
- Verificação base de 30 s quando ligada; somente com exceções/tela cheia ativadas, consulta de contexto a cada 4 s. A temperatura só é reaplicada se o alvo mudar. Suspensão/retomada, desbloqueio e eventos de display disparam nova detecção.
- O início com Windows usa a configuração já existente do NTC: a ferramenta persistida como ligada retoma ao iniciar o aplicativo.

## Limites deliberados

- `SetDeviceGammaRamp` não define a temperatura física real do painel; modifica a tabela de saída de cor. A intensidade pode ser limitada ou bloqueada pelo driver/GPU. Valores de Kelvin são alvos aproximados de aparência, não medições colorimétricas.
- “Redução por software” atenua a rampa de cor; não altera a luminância física. Brilho interno de notebook e DDC/CI não são oferecidos: a API/monitor podem falhar ou causar comportamento indesejado, e não há validação para o hardware de destino. Sem suporte, não mostramos um controle falso de brilho físico.
- A sincronização com o tema do Windows não foi implementada. A ferramenta não modifica preferências do sistema via chaves de registro não documentadas.
- A detecção de tela cheia é opcional e desligada por padrão. Exceções são verificadas para o aplicativo em primeiro plano, não para qualquer processo em execução.
- Não foi realizado teste de suspensão física nem inspeção visual automatizada da tela. Os testes reais confirmam rampas por leitura técnica. A confirmação subjetiva da aparência deve ser feita pelo usuário no monitor pretendido.

## Validação

`pnpm test` cobre modelo e serviço com falhas simuladas. `pnpm exec electron test/screen-light-ui-electron.cjs` verifica a interface real em renderer isolado. `node scripts/test-screen-light-recovery.cjs --allow-display-mutation` é um teste explícito que altera a rampa real, encerra o helper à força e verifica restauração na próxima inicialização. O script requer opt-in porque muda temporariamente a aparência do monitor.

Fontes técnicas: [Microsoft — SetDeviceGammaRamp](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setdevicegammaramp), [Microsoft — gamma correction](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/using-gamma-correction), [Microsoft — Advanced Color](https://learn.microsoft.com/en-us/windows/win32/direct3darticles/high-dynamic-range), [Microsoft — DDC/CI brightness](https://learn.microsoft.com/en-us/windows/win32/api/highlevelmonitorconfigurationapi/nf-highlevelmonitorconfigurationapi-getmonitorbrightness), [NOAA — solar calculations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF). A assinatura das exportações internas foi investigada em fontes técnicas e validada neste Windows; não foi incorporado código de ferramentas proprietárias.
