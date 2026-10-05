
# Teste na console
docker compose exec -it -u pi -w /workspace agent5 pi   --name pi-agent-agent5

#Debug da IA
export LLAMA_API_KEY="$(sudo head -n 1 /etc/llama.cpp/api-keys)"

curl -sS \
  -H "Authorization: Bearer $LLAMA_API_KEY" \
  http://127.0.0.1:8001/slots |
jq -r '
.[] |
[
  .id,
  .is_processing,
  .id_task,
  .n_prompt_tokens,
  (.next_token[0].n_decoded // .next_token.n_decoded // 0),
  (.next_token[0].n_remain // .next_token.n_remain // 0)
] |
@tsv
' |
column -t -N SLOT,ATIVO,TAREFA,PROMPT,GERADOS,RESTANTES
