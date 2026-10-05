#!/usr/bin/env bash
set -Eeuo pipefail

voice="${PIPER_VOICE:-pt_BR-jeff-medium}"
data_dir="${PIPER_DATA_DIR:-/voices}"
host="${PIPER_HOST:-0.0.0.0}"
port="${PIPER_PORT:-5000}"
model="${data_dir}/${voice}.onnx"
config="${model}.json"

mkdir -p "$data_dir"

if [[ ! -s "$model" || ! -s "$config" ]]; then
  echo "[piper] Baixando voz ${voice} para ${data_dir}..."
  python -m piper.download_voices --data-dir "$data_dir" "$voice"
fi

if [[ ! -s "$model" || ! -s "$config" ]]; then
  echo "[piper] Modelo de voz não foi encontrado após o download: ${model}" >&2
  exit 1
fi

echo "[piper] Iniciando voz ${voice} em ${host}:${port}"
exec python -m piper.http_server \
  --host "$host" \
  --port "$port" \
  --data-dir "$data_dir" \
  -m "$voice"
