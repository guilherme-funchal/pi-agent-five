#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:8080}"

echo "== Health =="
curl --fail --silent "$BASE_URL/health" | jq .

echo "== Status =="
curl --fail --silent "$BASE_URL/api/status" | jq .
