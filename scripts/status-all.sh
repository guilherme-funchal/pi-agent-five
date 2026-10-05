#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

# Carrega somente as portas conhecidas do .env da raiz.
read_env() {
  local key="$1" fallback="$2" value=""
  if [[ -f .env ]]; then
    value="$(sed -nE "s/^${key}=//p" .env | tail -n 1 | tr -d '\r')"
  fi
  printf '%s' "${value:-$fallback}"
}

for n in 1 2 3 4 5; do
  agent="agent$n"
  port="$(read_env "AGENT${n}_HTTP_PORT" "$((8080+n))")"
  printf '%-8s ' "$agent"
  if response="$(curl -fsS --max-time 3 "http://127.0.0.1:${port}/api/status" 2>/dev/null)"; then
    echo "$response" | jq -c '{agentId,piRunning,runKind,queueLength,model,timezone}'
  else
    echo "indisponível em http://127.0.0.1:${port}"
  fi
done
