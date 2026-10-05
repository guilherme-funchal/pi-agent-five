#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
mkdir -p whisper/models piper/voices
for agent in agent1 agent2 agent3 agent4 agent5; do
  mkdir -p "agents/$agent/data/pi-home" "agents/$agent/data/app" "agents/$agent/workspace/.pi" "agents/$agent/config"
  if [[ ! -f "agents/$agent/.env" ]]; then
    cp "agents/$agent/.env.example" "agents/$agent/.env"
    echo "Criado agents/$agent/.env"
  fi
done
[[ -f .env ]] || cp .env.example .env
echo "Estrutura dos cinco agentes inicializada."
