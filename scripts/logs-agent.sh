#!/usr/bin/env bash
set -Eeuo pipefail
agent="${1:-}"
case "$agent" in agent1|agent2|agent3|agent4|agent5) ;; *) echo "Uso: $0 agent1|agent2|agent3|agent4|agent5"; exit 2;; esac
exec docker compose logs -f --tail=200 "$agent"
