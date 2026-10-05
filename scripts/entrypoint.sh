#!/usr/bin/env bash
set -Eeuo pipefail

export HOME=/home/pi
AGENT_ID="${AGENT_ID:-${PI_SESSION_NAME:-agent}}"
PI_AGENT_DIR="$HOME/.pi/agent"
WORKSPACE=/workspace
AGENT_CONFIG_DIR="${AGENT_CONFIG_DIR:-/agent-config}"

mkdir -p "$PI_AGENT_DIR" "$WORKSPACE/.pi" /data

echo "[entrypoint][$AGENT_ID] Inicializando agente isolado..."

# localhost dentro do contêiner não representa o host Docker.
if [[ "${PI_REWRITE_LOOPBACK_TO_HOST:-true}" =~ ^(1|true|yes|sim|on)$ ]] && [[ -n "${PI_BASE_URL:-}" ]]; then
  REWRITTEN_BASE_URL="$(node --input-type=module -e '
    const raw = process.env.PI_BASE_URL;
    const url = new URL(raw);
    if (["127.0.0.1", "localhost", "::1"].includes(url.hostname)) url.hostname = "host.docker.internal";
    process.stdout.write(url.toString().replace(/\/$/, ""));
  ')"
  if [[ "$REWRITTEN_BASE_URL" != "$PI_BASE_URL" ]]; then
    echo "[entrypoint][$AGENT_ID] PI_BASE_URL ajustado: $REWRITTEN_BASE_URL"
    export PI_BASE_URL="$REWRITTEN_BASE_URL"
  fi
fi

# Cada contêiner possui volume Pi próprio. Inicializa somente o volume deste agente.
if [[ ! -d "$PI_AGENT_DIR/npm" ]]; then
  echo "[entrypoint][$AGENT_ID] Copiando extensões Pi para o volume persistente..."
  cp -a /opt/pi-seed/.pi/agent/. "$PI_AGENT_DIR/"
fi

# Sincroniza as extensões quando a imagem for reconstruída com versões diferentes.
NEEDS_EXTENSION_SYNC="$(SEED_DIR=/opt/pi-seed/.pi/agent/npm/node_modules INSTALLED_DIR="$PI_AGENT_DIR/npm/node_modules" node --input-type=module <<'NODE'
import fs from 'node:fs';
const packages = ['pi-subagents', 'pi-web-access', 'pi-hermes-memory', 'pi-memory', 'pi-messenger-bridge', 'pi-schedule-prompt'];
function version(root, name) {
  try { return JSON.parse(fs.readFileSync(`${root}/${name}/package.json`, 'utf8')).version || 'unknown'; }
  catch { return 'missing'; }
}
const seed = process.env.SEED_DIR;
const installed = process.env.INSTALLED_DIR;
const differences = packages
  .map(name => ({ name, seed: version(seed, name), installed: version(installed, name) }))
  .filter(item => item.seed !== item.installed);
if (differences.length) {
  console.error(`[entrypoint] Extensões divergentes: ${differences.map(x => `${x.name}:${x.installed}->${x.seed}`).join(', ')}`);
  process.stdout.write('yes');
} else process.stdout.write('no');
NODE
)"

if [[ "$NEEDS_EXTENSION_SYNC" == "yes" ]]; then
  echo "[entrypoint][$AGENT_ID] Sincronizando extensões persistentes..."
  rm -rf "$PI_AGENT_DIR/npm"
  cp -a /opt/pi-seed/.pi/agent/npm "$PI_AGENT_DIR/"
  # Usa a lista de pacotes da imagem sem apagar outras preferências do agente.
  if [[ -f /opt/pi-seed/.pi/agent/settings.json ]]; then
    cp /opt/pi-seed/.pi/agent/settings.json "$PI_AGENT_DIR/settings.json"
  fi
fi

# pi-memory e pi-hermes-memory registram memory_search. O Pi não permite
# ferramentas duplicadas, portanto apenas um backend pode ser carregado.
export PI_MEMORY_BACKEND="${PI_MEMORY_BACKEND:-pi-memory}"
export PI_MEMORY_VERSION="${PI_MEMORY_VERSION:-0.4.0}"
node /app/scripts/configure-memory-backend.js

# Remove os dois backends da lista informada e acrescenta somente o selecionado.
export PI_SCHEDULE_EXTENSIONS="$(node --input-type=module <<'NODE'
const selected = String(process.env.PI_MEMORY_BACKEND || 'pi-memory').toLowerCase();
const selectedPackage = ['hermes', 'pi-hermes-memory'].includes(selected)
  ? 'pi-hermes-memory'
  : ['none', 'off', 'disabled'].includes(selected)
    ? null
    : 'pi-memory';
const raw = String(process.env.PI_SCHEDULE_EXTENSIONS || 'pi-web-access,pi-subagents')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .filter((item) => !['pi-memory', 'pi-hermes-memory'].includes(item));
if (selectedPackage) raw.push(selectedPackage);
process.stdout.write([...new Set(raw)].join(','));
NODE
)"
echo "[entrypoint][$AGENT_ID] Extensões dos subagentes: $PI_SCHEDULE_EXTENSIONS"

# O Curator depende de navegador; em Docker/RPC os resultados voltam ao agente.
export PI_WEB_WORKFLOW="${PI_WEB_WORKFLOW:-none}"
node --input-type=module <<'NODE'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const source = '/agent-config/web-search.json';
const target = '/home/pi/.pi/web-search.json';
let config = {};
for (const candidate of [target, source]) {
  if (!existsSync(candidate)) continue;
  try { config = { ...config, ...JSON.parse(readFileSync(candidate, 'utf8')) }; }
  catch (error) { console.warn(`[entrypoint] Ignorando ${candidate}: ${error.message}`); }
}
config.workflow = process.env.PI_WEB_WORKFLOW || 'none';
config.webSearch = { ...(config.webSearch || {}), enabled: true };
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
console.log(`[entrypoint] pi-web-access workflow=${config.workflow}`);
NODE

# Cada agente pode possuir instruções e configuração de agendamento próprias.
SYSTEM_SOURCE="$AGENT_CONFIG_DIR/SYSTEM.md"
AGENTS_SOURCE="$AGENT_CONFIG_DIR/AGENTS.md"
SCHEDULE_SOURCE="$AGENT_CONFIG_DIR/schedule-prompts-settings.json"
[[ -f "$SYSTEM_SOURCE" ]] || SYSTEM_SOURCE=/app/config/SYSTEM.md
[[ -f "$AGENTS_SOURCE" ]] || AGENTS_SOURCE=/app/config/AGENTS.md
[[ -f "$SCHEDULE_SOURCE" ]] || SCHEDULE_SOURCE=/app/config/schedule-prompts-settings.json

cp "$SYSTEM_SOURCE" "$WORKSPACE/SYSTEM.md"
cp "$AGENTS_SOURCE" "$WORKSPACE/AGENTS.md"
node /app/scripts/render-system.js "$WORKSPACE/SYSTEM.md"
node /app/scripts/patch-schedule-prompt.js
node /app/scripts/migrate-schedules.js
if [[ ! -f "$WORKSPACE/.pi/schedule-prompts-settings.json" ]]; then
  cp "$SCHEDULE_SOURCE" "$WORKSPACE/.pi/schedule-prompts-settings.json" 2>/dev/null || true
fi

# O diretório pi-memory só é usado quando esse backend está ativo.
export PI_MEMORY_DIR="${PI_MEMORY_DIR:-$PI_AGENT_DIR/memory}"
export PI_MEMORY_SNAPSHOT="${PI_MEMORY_SNAPSHOT:-stable}"
export PI_MEMORY_QMD_UPDATE="${PI_MEMORY_QMD_UPDATE:-off}"
mkdir -p "$PI_MEMORY_DIR"

# Guardião local: bloqueia schedule_prompt sem intenção explícita e valida
# semanticamente tipo/cron antes de qualquer gravação.
mkdir -p "$PI_AGENT_DIR/extensions"
install -m 0644 /app/extensions/schedule-intent-guard.ts "$PI_AGENT_DIR/extensions/schedule-intent-guard.ts"
rm -f "${SCHEDULE_AUTH_FILE:-/data/schedule-intent-authorization.json}"
echo "[entrypoint][$AGENT_ID] Guardião de intenção e cron de agendamento instalado"

node /app/scripts/render-models.js
node /app/scripts/disable-native-bridge.js

chown -R pi:pi "$HOME/.pi" "$WORKSPACE" /data
exec gosu pi:pi node /app/src/index.js
