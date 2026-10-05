#!/usr/bin/env bash
set -Eeuo pipefail

model="${WHISPER_MODEL:-small}"
model_file="${WHISPER_MODEL_FILE:-/models/ggml-${model}.bin}"
model_url="${WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin}"
port="${WHISPER_PORT:-8080}"
host="${WHISPER_HOST:-0.0.0.0}"
language="${WHISPER_LANGUAGE:-pt}"
threads="${WHISPER_THREADS:-8}"

mkdir -p "$(dirname "$model_file")" /tmp/whisper
if [[ ! -s "$model_file" ]]; then
  echo "[whisper] Baixando modelo ${model}..."
  tmp="${model_file}.part"
  rm -f "$tmp"
  curl --fail --location --retry 5 --retry-delay 3 --connect-timeout 30 \
    --output "$tmp" "$model_url"
  mv "$tmp" "$model_file"
fi

args=(
  --host "$host"
  --port "$port"
  --model "$model_file"
  --language "$language"
  --threads "$threads"
  --inference-path /inference
  --tmp-dir /tmp/whisper
  --no-flash-attn
)

case "${WHISPER_NO_GPU:-true}" in
  1|true|TRUE|yes|YES|on|ON) args+=(--no-gpu) ;;
esac

if [[ -n "${WHISPER_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  extra=( ${WHISPER_EXTRA_ARGS} )
  args+=("${extra[@]}")
fi

echo "[whisper] Iniciando servidor com modelo ${model_file}, idioma ${language}, threads ${threads}"
exec /usr/local/bin/whisper-server "${args[@]}"
