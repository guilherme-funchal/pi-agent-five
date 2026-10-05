# Migração da estrutura de um agente

Para transformar a instalação anterior no `agent1`, pare primeiro o projeto antigo e o novo:

```bash
docker compose down
```

A partir do diretório do projeto novo, copie os dados antigos substituindo `../pi-agent-dual-channel` pelo caminho real:

```bash
cp -a ../pi-agent-dual-channel/data/pi-home/. agents/agent1/data/pi-home/
cp -a ../pi-agent-dual-channel/data/app/. agents/agent1/data/app/
cp -a ../pi-agent-dual-channel/workspace/. agents/agent1/workspace/
```

Copie manualmente as credenciais antigas para:

```text
agents/agent1/.env
```

Não copie o mesmo token Telegram para os demais agentes. Cada agente que usa long polling precisa de um bot/token próprio.

Depois inicialize:

```bash
docker compose build --no-cache
docker compose up -d
```

Confira:

```bash
./scripts/status-all.sh
docker compose logs -f agent1
```

## Inclusão do `pi-memory`

A versão 2.1.0 adiciona `npm:pi-memory@0.4.0`. Após reconstruir a imagem, o entrypoint detecta a ausência do pacote nos volumes persistentes e sincroniza as extensões automaticamente. A memória de cada agente será criada em:

```text
agents/agentN/data/pi-home/agent/memory/
```

Use:

```bash
docker compose build --no-cache
docker compose up -d --force-recreate
```

## Atualização 2.2.0 — entrega multicanal

A versão 2.2.0 corrige a confirmação de agendamentos entregue somente no canal de origem.

Principais mudanças:

- a confirmação é enviada uma única vez, sem duplicar no Telegram;
- Telegram e Discord recebem o mesmo conteúdo;
- `DISCORD_NOTIFY_CHANNEL_IDS` vazio ou contendo espaços usa `DISCORD_ALLOWED_CHANNEL_IDS` como fallback;
- falhas de envio deixam de ser silenciosas;
- `/teste-notificacoes` testa os dois canais;
- `/status` mostra conexão e quantidade de destinos;
- o gateway aguarda o término do processamento assíncrono de `schedule_prompt` antes de finalizar a execução.

Em cada `agents/agentN/.env`, configure:

```dotenv
TELEGRAM_ALLOWED_CHAT_IDS=SEU_CHAT_ID
TELEGRAM_NOTIFY_CHAT_IDS=SEU_CHAT_ID

DISCORD_ALLOWED_CHANNEL_IDS=SEU_CANAL_ID
DISCORD_NOTIFY_CHANNEL_IDS=SEU_CANAL_ID
```

Depois execute:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
```

Teste pelo Telegram ou Discord:

```text
/teste-notificacoes
```

## Atualização 2.3.0 — redução de atraso nos agendamentos

A versão 2.3.0 muda o padrão dos agendamentos para subagentes independentes. Isso evita que uma tarefa agendada aguarde uma conversa interativa do mesmo agente terminar.

Adicione em cada `agents/agentN/.env`:

```dotenv
SCHEDULE_EXECUTION_MODE=subagent
PI_SCHEDULE_MODEL=local-llama/Qwen3.5-9B-Q4_K_M.gguf
PI_SCHEDULE_EXTENSIONS=pi-web-access,pi-subagents
SCHEDULE_START_NOTIFICATION=true
SCHEDULE_DELAY_WARNING_MS=30000
SCHEDULE_SUBAGENT_OUTPUT_CHARS=12000
```

Reconstrua e recrie os contêineres:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
```

Na inicialização, o entrypoint converte automaticamente as tarefas já existentes antes que o scheduler seja carregado:

```text
[entrypoint] Tarefas migradas: 3/3; mode=subagent; model=local-llama/Qwen3.5-9B-Q4_K_M.gguf
```

Valide os slots do llama.cpp:

```bash
docker compose exec agent1 /app/scripts/check-llama-slots.sh
```


## Versão 2.4.0 — recuperação automática do RPC

A versão 2.4.0 adiciona handshake inicial por `get_state`, reinicialização automática do subprocesso Pi, healthcheck dependente do estado real do RPC e retenção de pedidos durante reinicializações.

Atualize a imagem e recrie os contêineres:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
```

Não é necessário apagar os diretórios `agents/agentN/data/pi-home`; sessões, memórias e agendamentos são preservados.


## Versão 2.5.0 — seleção do backend de memória

`pi-memory` e `pi-hermes-memory` não podem ser carregados simultaneamente porque ambos registram `memory_search`. Configure em cada agente:

```dotenv
PI_MEMORY_BACKEND=pi-memory
PI_SCHEDULE_EXTENSIONS=pi-web-access,pi-subagents
```

Também é possível selecionar:

```dotenv
PI_MEMORY_BACKEND=pi-hermes-memory
```

O entrypoint preserva os dois pacotes instalados, desativa os recursos do backend não selecionado em `~/.pi/agent/settings.json` e migra as extensões das tarefas agendadas para usar apenas o backend ativo.

Atualize sem apagar dados:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
```

## Versão 2.6.0 — pesquisas imediatas e agendamento somente por intenção explícita

A versão 2.6.0 impede que pedidos comuns de pesquisa, busca, consulta, análise ou resumo sejam transformados automaticamente em tarefas agendadas.

A proteção funciona em duas camadas:

1. o gateway classifica cada solicitação como `none`, `add` ou `manage` e inclui uma diretiva explícita no prompt;
2. a extensão local `schedule-intent-guard.ts` intercepta `schedule_prompt` no evento `tool_call` e bloqueia a chamada **antes da execução** quando a ação não foi autorizada.

Adicione em cada `agents/agentN/.env`:

```dotenv
SCHEDULE_INTENT_GUARD=true
SCHEDULE_AUTH_FILE=/data/schedule-intent-authorization.json
SCHEDULE_AUTH_TTL_MS=900000
```

Reconstrua a imagem para instalar o guardião no volume persistente de cada agente:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
```

Exemplos que executam imediatamente:

```text
Pesquise as notícias de política do G1 e faça um resumo.
Busque informações sobre o Pi Agent.
Analise as notícias de hoje.
```

Exemplos que criam agendamento:

```text
Agende uma pesquisa do G1 para amanhã às 9h.
Lembre-me daqui a 20 minutos de verificar os logs.
Pesquise notícias todos os dias às 8h.
/agendar pesquisar o G1 diariamente às 7h
```

O comando `/agora` força execução imediata, e `/agendar` força a interpretação como pedido de agendamento.

## Versão 2.8.0 — respostas em áudio com Piper

A versão 2.8.0 adiciona um serviço `piper` compartilhado. Preserve os diretórios dos agentes e acrescente ao `.env` da raiz:

```dotenv
PIPER_TTS_VERSION=1.6.0
PIPER_HTTP_PORT=8087
PIPER_VOICE=pt_BR-jeff-medium
```

Acrescente em cada `agents/agentN/.env` o bloco TTS presente no `.env.example`. Depois execute:

```bash
mkdir -p piper/voices
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
docker compose logs -f piper agent1
```

Não copie os arquivos `/data/response-modes.json` ou `/data/schedule-delivery.json` entre agentes, pois eles contêm preferências e modos de entrega específicos de cada agente.

## Versão 2.8.1 — validação semântica de cron

A versão 2.8.1 impede que horários sejam gravados com os campos deslocados. Adicione em cada `agents/agentN/.env`:

```dotenv
SCHEDULE_CRON_GUARD=true
```

Atualize sem apagar sessões, memória ou agendamentos:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
```

Na inicialização, procure por:

```text
Guardião de intenção e cron de agendamento instalado
```

Para corrigir o job já criado incorretamente:

```bash
node scripts/update-job-cron.js   agents/agent1/workspace/.pi/schedule-prompts.json   T8hIXK70T5   '0 30 7 * * *'

docker compose restart agent1
```

