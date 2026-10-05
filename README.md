# Pi Agent — cinco agentes independentes

Esta estrutura executa cinco agentes simultâneos:

- `agent1`
- `agent2`
- `agent3`
- `agent4`
- `agent5`

Cada agente possui contêiner, Telegram, Discord, configuração, workspace, sessões Pi, backend de memória selecionável, dados e tarefas agendadas separados. Um serviço `whisper.cpp` compartilhado converte mensagens de voz em texto, e um serviço Piper compartilhado converte as respostas do agente em áudio.

## Extensões instaladas

- `npm:pi-subagents`
- `npm:pi-web-access@0.14.0`
- `npm:pi-hermes-memory`
- `npm:pi-memory@0.4.0`
- `npm:pi-messenger-bridge`
- `npm:pi-schedule-prompt`

A versão `0.14.0` do `pi-web-access` é usada porque corrige a falha do Curator observada na `0.13.0` em ambiente Docker headless.

Os pacotes `pi-memory` e `pi-hermes-memory` permanecem instalados na imagem, mas **somente um é carregado por agente**. Ambos registram a ferramenta `memory_search`; carregar os dois simultaneamente faz o Pi abortar a inicialização por conflito de ferramenta.

O padrão é:

```dotenv
PI_MEMORY_BACKEND=pi-memory
```

Valores aceitos:

- `pi-memory`: memória Markdown, logs diários e scratchpad em `~/.pi/agent/memory`;
- `pi-hermes-memory`: memória Hermes, busca de sessões e aprendizado em `~/.pi/agent/pi-hermes-memory`;
- `none`: desativa os dois backends.

O entrypoint filtra `~/.pi/agent/settings.json` antes de iniciar o RPC e também remove o backend inativo da lista de extensões dos subagentes agendados. Portanto, configurações antigas que ainda listem os dois pacotes são corrigidas automaticamente.

## Isolamento

Cada agente utiliza:

```text
agents/agentN/.env                         credenciais e modelo
agents/agentN/config/                      instruções próprias
agents/agentN/data/pi-home/                sessões, extensões e memória selecionada
agents/agentN/data/app/                    dados do gateway
agents/agentN/workspace/                   arquivos e tarefas do agente
agents/agentN/workspace/.pi/schedule-prompts.json
```

Nenhum desses diretórios é montado em outro agente.

## Portas HTTP

| Agente | Porta padrão |
|---|---:|
| agent1 | 8081 |
| agent2 | 8082 |
| agent3 | 8083 |
| agent4 | 8084 |
| agent5 | 8085 |
| Whisper | 8086 |
| Piper TTS | 8087 |

As portas podem ser alteradas no `.env` da raiz.

## Configuração

Inicialize os diretórios e arquivos:

```bash
./scripts/init-agents.sh
```

Edite individualmente:

```bash
nano agents/agent1/.env
nano agents/agent2/.env
nano agents/agent3/.env
nano agents/agent4/.env
nano agents/agent5/.env
```

Para cada agente, configure seus próprios valores:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=
TELEGRAM_NOTIFY_CHAT_IDS=

DISCORD_BOT_TOKEN=
DISCORD_ALLOWED_USER_IDS=
DISCORD_ALLOWED_CHANNEL_IDS=
DISCORD_NOTIFY_CHANNEL_IDS=
DISCORD_REQUIRE_MENTION=true
```

### Telegram

Use um bot/token diferente para cada agente. Dois processos não devem executar long polling com o mesmo token simultaneamente.

### Discord

É recomendado criar um bot diferente para cada agente. Também é possível usar o mesmo bot com canais de entrada não sobrepostos, mas cada instância continuará conectada ao Gateway do Discord.

Habilite `Message Content Intent` em cada aplicação Discord e conceda ao bot:

- View Channel;
- Send Messages;
- Read Message History.

## Modelo local

Por padrão, todos usam:

```dotenv
PI_BASE_URL=http://host.docker.internal:8001/v1
PI_MODEL=Qwen3.5-9B-Q4_K_M.gguf
```

Cada agente pode ter endpoint ou modelo diferente no próprio `.env`.

Para cinco execuções realmente simultâneas no mesmo llama.cpp, o servidor precisa ter slots suficientes. Exemplo conceitual:

```bash
llama-server ... --parallel 5
```

O consumo de contexto é multiplicado pelos slots. Ajuste `--ctx-size`, memória e número de slots conforme o hardware. Se o servidor tiver menos slots, os cinco agentes continuarão independentes, mas as requisições ao modelo poderão esperar em fila no llama.cpp.

## Backend de memória

Cada arquivo `agents/agentN/.env` contém:

```dotenv
PI_MEMORY_BACKEND=pi-memory
PI_MEMORY_DIR=/home/pi/.pi/agent/memory
PI_MEMORY_SNAPSHOT=stable
PI_MEMORY_QMD_UPDATE=off
```

Para usar Hermes em um agente específico:

```dotenv
PI_MEMORY_BACKEND=pi-hermes-memory
```

Não inclua manualmente os dois backends em `PI_SCHEDULE_EXTENSIONS`; o entrypoint acrescenta somente o backend selecionado.

Arquivos persistentes de cada agente:

```text
agents/agentN/data/pi-home/agent/memory/MEMORY.md
agents/agentN/data/pi-home/agent/memory/SCRATCHPAD.md
agents/agentN/data/pi-home/agent/memory/daily/
```

Verifique a extensão dentro de um contêiner:

```bash
docker compose exec agent1 pi list
docker compose exec agent1 find /home/pi/.pi/agent/memory -maxdepth 2 -type f -print
```

## Correção do conflito `memory_search` — versão 2.5.0

Sintoma:

```text
Tool "memory_search" conflicts with ... pi-hermes-memory
Pi RPC terminou
```

Causa: `pi-memory` e `pi-hermes-memory` foram carregados ao mesmo tempo. A versão 2.5.0 mantém ambos instalados, mas ativa apenas o backend definido por `PI_MEMORY_BACKEND`.

Após atualizar, o log esperado é:

```text
Backend de memória ativo: pi-memory; desativado(s): pi-hermes-memory
Extensões dos subagentes: pi-web-access,pi-subagents,pi-memory
Pi RPC pronto
```

## Inicialização

```bash
docker compose build --no-cache
docker compose up -d
docker compose ps
```

Logs de todos:

```bash
docker compose logs -f
```

Logs de um agente:

```bash
./scripts/logs-agent.sh agent3
```

## Operações individuais

```bash
docker compose restart agent2
docker compose stop agent4
docker compose up -d agent4
docker compose logs -f agent5
```

Recriar somente um agente:

```bash
docker compose up -d --build --force-recreate agent1
```

## Diagnóstico

```bash
./scripts/status-all.sh
```

Ou consulte diretamente:

```bash
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8081/api/status
```

Teste de acesso ao modelo a partir de um agente:

```bash
docker compose exec agent1 curl -sS http://host.docker.internal:8001/v1/models | jq
```



## Supervisão e recuperação do Pi RPC

O gateway não aceita mensagens antes de o subprocesso Pi responder ao comando `get_state`. Se o processo encerrar posteriormente, cada contêiner:

1. marca o RPC como indisponível;
2. preserva o pedido interativo atual;
3. reinicia o Pi com backoff exponencial;
4. confirma novamente o estado por `get_state`;
5. retoma automaticamente o pedido pendente.

Variáveis disponíveis em cada `agents/agentN/.env`:

```dotenv
PI_RPC_STARTUP_TIMEOUT_MS=60000
PI_RPC_READY_WAIT_TIMEOUT_MS=90000
PI_RPC_PROBE_TIMEOUT_MS=5000
PI_RPC_PROBE_INTERVAL_MS=500
PI_RPC_AUTO_RESTART=true
PI_RPC_RESTART_BASE_MS=1000
PI_RPC_RESTART_MAX_MS=30000
PI_RPC_TASK_RETRIES=2
```

Logs esperados em uma inicialização saudável:

```text
Processo Pi RPC criado
Pi RPC pronto
Discord conectado
Aplicação pronta
```

Quando houver queda do subprocesso:

```text
Pi RPC terminou
Reinicialização do Pi RPC agendada
Processo Pi RPC criado
Pi RPC pronto
Gateway detectou Pi RPC pronto
```

O endpoint `/health` responde HTTP `200` somente quando o RPC está pronto. Durante a recuperação, responde HTTP `503`, permitindo que o healthcheck do Docker detecte corretamente a indisponibilidade.

## Entrega multicanal de agendamentos

A confirmação de criação e o resultado de cada tarefa agendada são enviados uma única vez para os destinos configurados nos dois mensageiros.

Para o Discord receber uma tarefa criada pelo Telegram, informe obrigatoriamente um canal de destino:

```dotenv
DISCORD_ALLOWED_CHANNEL_IDS=123456789012345678
DISCORD_NOTIFY_CHANNEL_IDS=123456789012345678
```

Se `DISCORD_NOTIFY_CHANNEL_IDS` estiver vazio ou contiver somente espaços, o gateway usa `DISCORD_ALLOWED_CHANNEL_IDS`. Se as duas variáveis estiverem vazias, não existe um canal Discord para o qual o agente possa publicar proativamente.

Verifique os destinos configurados com:

```text
/status
```

Nos logs, procure por `Falha ao notificar Telegram`, `Falha ao notificar Discord` ou avisos de canal sem permissão.

## Agendamentos

Cada contêiner mantém uma sessão RPC aberta. O `pi-schedule-prompt` interpreta os horários em `America/Sao_Paulo` e grava os dados no workspace daquele agente.

Exemplo enviado ao Telegram ou Discord do `agent2`:

```text
Agende para amanhã às 9h uma pesquisa das notícias de segurança e envie um resumo.
```

Somente o `agent2` armazenará e executará essa tarefa. O alerta de criação e o resultado serão enviados apenas ao Telegram e Discord configurados em `agents/agent2/.env`.

## Backup

Backup completo do `agent3`:

```bash
tar -czf agent3-backup.tar.gz agents/agent3
```

Restaurar:

```bash
docker compose stop agent3
rm -rf agents/agent3
tar -xzf agent3-backup.tar.gz
docker compose up -d agent3
```

## Remoção dos dados de um agente

```bash
docker compose stop agent5
rm -rf agents/agent5/data/pi-home/* agents/agent5/data/app/* agents/agent5/workspace/*
./scripts/init-agents.sh
docker compose up -d agent5
```

Essa operação apaga sessões, memória e agendamentos somente do agente escolhido.

## Confirmação determinística de agendamentos

As confirmações de tarefas são produzidas pelo gateway a partir dos argumentos reais enviados à ferramenta `schedule_prompt`. O texto livre do modelo não é usado para determinar dia da semana, horário, cron ou ID. Isso evita mensagens contraditórias como “quinta-feira” em uma linha e “quarta-feira” em outra.

No Telegram, títulos, negrito, código e listas Markdown são convertidos para HTML compatível. Caso a API do Telegram rejeite a formatação, o gateway repete automaticamente o envio como texto simples.


## Execução rápida e diagnóstico de atrasos — versão 2.3.0

Por padrão, as novas tarefas são criadas em modo `subagent`:

```dotenv
SCHEDULE_EXECUTION_MODE=subagent
PI_SCHEDULE_MODEL=local-llama/Qwen3.5-9B-Q4_K_M.gguf
PI_SCHEDULE_EXTENSIONS=pi-web-access,pi-subagents
SCHEDULE_START_NOTIFICATION=true
SCHEDULE_DELAY_WARNING_MS=30000
SCHEDULE_SUBAGENT_OUTPUT_CHARS=12000
```

Nesse modo, o agendamento não precisa aguardar uma conversa interativa do agente principal terminar. O gateway observa os marcadores `subagent_start`, `subagent_done` e `subagent_error` produzidos por `pi-schedule-prompt` e envia diretamente:

1. um aviso imediato quando o horário dispara;
2. o resultado final para Telegram e Discord;
3. a duração total da execução.

O entrypoint também migra tarefas existentes antes de iniciar o Pi. Ele acrescenta `model`, `notify=false` e as extensões configuradas em cada item de:

```text
agents/agentN/workspace/.pi/schedule-prompts.json
```

Nos logs, procure por:

```text
Tarefas migradas: ... mode=subagent
Evento de tarefa agendada ... mode=subagent_start
Evento de tarefa agendada ... mode=subagent_done
```

O `/status` informa:

```text
Modo padrão dos agendamentos: subagent
Subagentes agendados ativos: 0
Última tarefa: ...
```

### Verificar a fila do llama.cpp

Mesmo em subagente, a execução pode aguardar se o servidor do modelo não tiver slot livre. Verifique de dentro de qualquer contêiner:

```bash
docker compose exec agent1 /app/scripts/check-llama-slots.sh
```

O resultado apresenta o total de slots, quantos estão processando e quantos estão livres.

Para cinco requisições realmente simultâneas, o llama.cpp precisa ser iniciado com quantidade compatível de slots, por exemplo:

```bash
llama-server ... --parallel 5 --cont-batching
```

Cinco slots aumentam o uso de memória. Se o equipamento não comportar essa configuração, use menos slots e distribua os horários das tarefas entre os agentes.

### Voltar ao comportamento inline

No `.env` do agente:

```dotenv
SCHEDULE_EXECUTION_MODE=inline
```

Depois recrie o contêiner. O entrypoint remove os campos de subagente das tarefas existentes. Nesse modo, uma tarefa disparada durante uma conversa ativa pode aguardar o turno atual terminar.

## Proteção de intenção de agendamento — versão 2.6.0

Pedidos de pesquisa são executados imediatamente. O agente não deve criar um agendamento apenas porque o pedido usa pesquisa web, pode demorar, menciona notícias, contém a palavra “tarefa” ou fala de “hoje”.

Exemplos imediatos:

```text
Pesquise as notícias de política do G1 e faça um resumo.
Busque na web informações sobre o Pi Agent.
Analise as notícias de hoje.
```

Somente pedidos explícitos de execução futura, recorrência ou lembrete podem usar `schedule_prompt action=add`:

```text
Agende uma pesquisa para amanhã às 9h.
Lembre-me daqui a 10 minutos de verificar os logs.
Pesquise notícias todos os dias às 8h.
```

A proteção possui duas camadas:

- o gateway classifica a intenção e injeta uma autorização com token exclusivo na solicitação;
- `schedule-intent-guard.ts` intercepta o evento `tool_call` e bloqueia `schedule_prompt` antes de a ferramenta criar a tarefa, quando o token ou a ação não estiverem autorizados. O Pi suporta bloqueio preventivo de ferramentas por extensões no evento `tool_call`.

Configuração por agente:

```dotenv
SCHEDULE_INTENT_GUARD=true
SCHEDULE_AUTH_FILE=/data/schedule-intent-authorization.json
SCHEDULE_AUTH_TTL_MS=900000
```

Comandos de força:

```text
/agendar <pedido>   força a interpretação como agendamento
/agora <pedido>     força execução imediata
/tarefas            autoriza somente a listagem de agendamentos
```

Validação local do classificador e do guardião:

```bash
docker compose run --rm agent1 npm run check
```

Nos logs, uma pesquisa comum deve mostrar:

```text
Intenção de agendamento classificada | mode=none
```

Um pedido explícito deve mostrar:

```text
Intenção de agendamento classificada | mode=add
```


## Validação de cron — versão 2.8.1

Além da proteção de intenção, o gateway agora extrai do pedido o horário e a recorrência esperados. O guardião valida os argumentos de `schedule_prompt` antes de a extensão persistir o job.

Exemplo:

```text
Agende as notícias todos os dias às 07:30.
```

Agenda obrigatória calculada pelo gateway:

```text
0 30 7 * * *
```

Se o modelo tentar usar:

```text
30 7 * * * *
```

a chamada é bloqueada antes da gravação, e o modelo recebe a correção exata para repetir a ferramenta. Isso evita a interpretação incorreta “a cada hora em HH:07:30”.

Ative por agente:

```dotenv
SCHEDULE_INTENT_GUARD=true
SCHEDULE_CRON_GUARD=true
```

Ordem obrigatória dos seis campos:

```text
segundo minuto hora dia-do-mês mês dia-da-semana
```

Exemplos:

```text
0 30 7 * * *      todos os dias às 07:30
0 50 17 * * 4     quinta-feira às 17:50
0 0 9 * * 1-5     segunda a sexta às 09:00
0 0 * * * *       a cada hora
```

Para corrigir manualmente um job já existente:

```bash
node scripts/update-job-cron.js   agents/agent1/workspace/.pi/schedule-prompts.json   T8hIXK70T5   '0 30 7 * * *'

docker compose restart agent1
```

O script cria um backup e remove `nextRun`, permitindo que o scheduler recalcule a próxima execução.


## Áudio no Telegram — versão 2.7.0

O pacote aceita:

- mensagens de voz (`voice`);
- arquivos enviados como áudio (`audio`);
- documentos com MIME ou extensão de áudio, quando `TELEGRAM_AUDIO_ACCEPT_DOCUMENTS=true`.

Fluxo:

```text
Telegram -> download do arquivo -> FFmpeg/WAV mono 16 kHz -> whisper.cpp -> texto -> Gateway Pi
```

A transcrição passa pelo mesmo classificador de intenção. Uma frase falada só vira tarefa agendada quando contém uma solicitação explícita de agendamento.

### Serviço Whisper compartilhado

O Compose cria `pi-whisper` na porta interna `8080` e publica a porta `8086` no host. Na primeira inicialização, ele baixa o modelo multilíngue configurado para `whisper/models/`.

Configuração da raiz:

```dotenv
WHISPER_CPP_VERSION=v1.9.1
WHISPER_HTTP_PORT=8086
WHISPER_MODEL=small
WHISPER_LANGUAGE=pt
WHISPER_THREADS=8
WHISPER_NO_GPU=true
WHISPER_MODEL_URL=
```

Configuração por agente:

```dotenv
TELEGRAM_AUDIO_ENABLED=true
TELEGRAM_AUDIO_SHOW_TRANSCRIPT=true
TELEGRAM_AUDIO_ACCEPT_DOCUMENTS=true
TELEGRAM_AUDIO_MAX_MB=20
TELEGRAM_AUDIO_MAX_DURATION_SECONDS=600
WHISPER_BASE_URL=http://whisper:8080
WHISPER_INFERENCE_PATH=/inference
WHISPER_LANGUAGE=pt
WHISPER_RESPONSE_FORMAT=json
WHISPER_TIMEOUT_MS=300000
WHISPER_KEEP_TEMP_FILES=false
```

O limite padrão de 20 MB acompanha o limite de download do `getFile` da Bot API do Telegram.

### Inicialização

```bash
./scripts/init-agents.sh
docker compose build --no-cache
docker compose up -d
docker compose logs -f whisper agent1
```

A primeira inicialização é mais demorada porque compila o `whisper.cpp` e baixa o modelo. Os próximos inícios reutilizam `whisper/models/ggml-small.bin`.

### Teste do Whisper

```bash
./scripts/test-whisper.sh /caminho/para/audio.wav
```

Teste pelo Telegram enviando uma mensagem de voz, por exemplo:

```text
Pesquise agora as notícias de tecnologia e faça um resumo.
```

O bot responde primeiro com o aviso de transcrição, opcionalmente mostra o texto reconhecido e então processa a solicitação normalmente.

Comando de diagnóstico:

```text
/audio
```

Ele mostra se o áudio está habilitado, limite, idioma e endpoint Whisper.

### Diagnóstico

```bash
docker compose ps
docker compose logs -f whisper
docker compose exec agent1 ffmpeg -version
docker compose exec agent1 curl -sS http://whisper:8080/ | head
```

Erros comuns:

- `Whisper retornou HTTP 500`: confira o log do serviço e se o modelo terminou de baixar;
- `ECONNREFUSED whisper:8080`: o serviço de transcrição ainda não iniciou;
- `ffmpeg terminou com código ...`: formato corrompido ou áudio sem faixa válida;
- arquivo maior que 20 MB: reduza ou divida o áudio.

## Respostas em áudio — versão 2.8.0

O serviço compartilhado Piper transforma a resposta final do Pi em WAV. O agente usa FFmpeg para converter o WAV para OGG/Opus e envia o arquivo como mensagem de voz no Telegram e como anexo de áudio no Discord.

### Configuração da raiz

```dotenv
PIPER_TTS_VERSION=1.6.0
PIPER_HTTP_PORT=8087
PIPER_VOICE=pt_BR-jeff-medium
```

Na primeira inicialização, o contêiner baixa os arquivos da voz para:

```text
piper/voices/pt_BR-jeff-medium.onnx
piper/voices/pt_BR-jeff-medium.onnx.json
```

Os modelos não fazem parte do ZIP e permanecem no volume local.

### Configuração por agente

```dotenv
TELEGRAM_TTS_ENABLED=true
TTS_BASE_URL=http://piper:5000
TTS_SYNTHESIS_PATH=/synthesize
TTS_VOICE=pt_BR-jeff-medium
TTS_TIMEOUT_MS=300000
TTS_MAX_CHARS=5000
TTS_LENGTH_SCALE=1.0
TTS_NOISE_SCALE=0.667
TTS_NOISE_W_SCALE=0.8
TTS_OPUS_BITRATE=32k
TTS_VOICE_COMMAND_MODE=both
TTS_SEND_TEXT_WITH_AUDIO=true
TTS_DEFAULT_MODE=text
TTS_RESPONSE_MODE_FILE=/data/response-modes.json
TTS_KEEP_TEMP_FILES=false
SCHEDULE_DELIVERY_FILE=/data/schedule-delivery.json
```

### Comandos

Resposta única em texto e áudio:

```text
/voz Explique como funciona a memória do Pi Agent
```

Resposta única somente em texto, mesmo quando o chat está em modo de voz:

```text
/texto Liste as tarefas agendadas
```

Ativar texto e áudio para as próximas respostas daquele chat ou canal:

```text
/modo_voz on
```

Ativar somente áudio:

```text
/modo_voz audio
```

Voltar para texto:

```text
/modo_voz off
```

Consultar o modo atual e o estado do Piper:

```text
/modo_voz status
/tts
```

Também é possível escrever naturalmente:

```text
Pesquise as notícias de tecnologia e responda em áudio.
```

### Tarefas agendadas com entrega em áudio

O modo de entrega é gravado separadamente por ID de tarefa em `/data/schedule-delivery.json`. Exemplo:

```text
Agende para todos os dias às 8h uma pesquisa das notícias e envie o resultado em áudio.
```

A confirmação continua sendo enviada em texto. Quando a tarefa terminar, o resultado será enviado ao Telegram e Discord no modo configurado para aquela tarefa.

### Testes e diagnóstico

```bash
docker compose logs -f piper agent1
curl -sS http://127.0.0.1:8087/info | jq
./scripts/test-piper.sh "Olá. Este é um teste do agente Pi."
```

Se o Piper falhar, o gateway registra o erro e envia o resultado em texto para não perder a resposta. Respostas maiores que `TTS_MAX_CHARS` são faladas parcialmente; quando `TTS_SEND_TEXT_WITH_AUDIO=true`, o texto completo também é enviado.

