#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Uso: $0 CAMINHO_DO_AUDIO" >&2
  exit 2
fi
curl --fail --silent --show-error \
  "http://127.0.0.1:${WHISPER_HTTP_PORT:-8086}/inference" \
  -F "file=@${file}" \
  -F "response_format=json" \
  -F "language=${WHISPER_LANGUAGE:-pt}"
echo
