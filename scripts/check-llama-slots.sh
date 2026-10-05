#!/usr/bin/env bash
set -Eeuo pipefail
BASE_URL="${PI_BASE_URL:-http://host.docker.internal:8001/v1}"
ROOT="${BASE_URL%/}"
ROOT="${ROOT%/v1}"
URL="$ROOT/slots"

echo "Consultando $URL"
JSON="$(curl -fsS "$URL")"
printf '%s\n' "$JSON" | jq '{
  total: length,
  processando: ([.[] | select(.is_processing == true)] | length),
  livres: ([.[] | select(.is_processing == false)] | length),
  slots: [.[] | {
    id: (.id // .id_slot // null),
    processando: .is_processing,
    tokens_prompt: (.n_prompt_tokens_processed // .n_past // null),
    tokens_gerados: (.n_decoded // null)
  }]
}'
