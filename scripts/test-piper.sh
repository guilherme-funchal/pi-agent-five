#!/usr/bin/env bash
set -Eeuo pipefail
BASE_URL="${PIPER_BASE_URL:-http://127.0.0.1:8087}"
TEXT="${1:-Olá. Este é um teste de voz do agente Pi.}"
OUT="${2:-/tmp/pi-piper-test.wav}"
curl --fail --silent --show-error \
  -X POST \
  -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg text "$TEXT" '{text:$text}')" \
  -o "$OUT" \
  "${BASE_URL%/}/synthesize"
echo "Áudio gerado: $OUT"
file "$OUT" || true
