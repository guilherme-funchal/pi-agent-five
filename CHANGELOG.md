# Changelog

## 2.8.1

- Adiciona validação semântica de cron antes da execução de `schedule_prompt`.
- Extrai horário e recorrência do pedido original e gera uma agenda esperada.
- Bloqueia expressões deslocadas, como `30 7 * * * *` para um pedido diário às 07:30.
- Instrui o modelo a repetir a chamada com `0 30 7 * * *` antes de qualquer gravação.
- Detecta cron tradicional de cinco campos e informa a versão corrigida com o campo de segundos.
- Adiciona `SCHEDULE_CRON_GUARD=true`, testes automatizados e utilitário de correção de jobs existentes.

## 2.8.0

- Adiciona serviço compartilhado Piper TTS para os cinco agentes.
- Adiciona `/voz`, `/texto`, `/modo_voz` e `/tts`.
- Persiste o modo de resposta separadamente por chat Telegram e canal Discord.
- Envia voz em OGG/Opus ao Telegram e anexo OGG ao Discord.
- Associa o modo de entrega ao ID de cada tarefa agendada.
- Adiciona fallback automático para texto quando a síntese falha.
- Adiciona `notifier.status()`, ausente na versão anterior.
- Adiciona `test-piper.sh` e testes de modo de resposta.

## 2.7.0

- Adiciona serviço compartilhado `whisper.cpp` para os cinco agentes.
- Aceita mensagens Telegram `voice`, `audio` e documentos de áudio.
- Converte áudio com FFmpeg para WAV mono 16 kHz.
- Transcreve em português e encaminha o texto ao mesmo gateway Pi.
- Mantém a proteção: pesquisas faladas só viram agendamento quando o usuário solicita explicitamente.
- Adiciona comando `/audio`, menu de comandos Telegram e script `test-whisper.sh`.
- Mantém Telegram, Discord, sessões, workspaces, memórias e agendamentos separados por agente.
- Mantém somente um backend de memória ativo por agente para evitar conflito `memory_search`.
