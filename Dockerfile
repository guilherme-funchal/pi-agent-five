FROM node:22-bookworm-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG PI_CODING_AGENT_VERSION=latest
ARG PI_WEB_ACCESS_VERSION=0.14.0
ARG PI_MEMORY_VERSION=0.4.0

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    TZ=America/Sao_Paulo

# Dependências do sistema, Python e ferramentas de compilação
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       ffmpeg \
       git \
       gosu \
       jq \
       tini \
       tzdata \
       unzip \
       python3 \
       python3-pip \
       python3-venv \
       python-is-python3 \
       build-essential \
    && rm -rf /var/lib/apt/lists/*

# Validar Node.js, npm e Python
RUN node --version \
    && npm --version \
    && python --version \
    && python3 --version \
    && pip3 --version

# Ambiente virtual Python
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

RUN python3 -m venv "${VIRTUAL_ENV}" \
    && python -m pip install --no-cache-dir --upgrade pip

# Pi Agent e ferramentas auxiliares
RUN npm install -g --ignore-scripts \
       "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
    && npm install -g @tobilu/qmd

# Preparação das extensões na imagem-semente
ENV HOME=/opt/pi-seed

RUN mkdir -p /opt/pi-seed/.pi/agent \
    && pi install npm:pi-subagents \
    && pi install "npm:pi-web-access@${PI_WEB_ACCESS_VERSION}" \
    && pi install npm:pi-hermes-memory \
    && pi install "npm:pi-memory@${PI_MEMORY_VERSION}" \
    && pi install npm:pi-messenger-bridge \
    && pi install npm:pi-schedule-prompt \
    && pi install npm:@k3_2o/pi-composio

# Corrigir typebox no pi-web-access, se necessário
RUN node <<'NODE'
const fs = require("node:fs");

const file =
  "/opt/pi-seed/.pi/agent/npm/node_modules/pi-web-access/package.json";

if (!fs.existsSync(file)) {
  console.error(
    "ERRO: package.json do pi-web-access não encontrado:",
    file
  );
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
const dependencies = pkg.dependencies || {};
const peers = pkg.peerDependencies || {};

if (Object.prototype.hasOwnProperty.call(dependencies, "typebox")) {
  delete dependencies.typebox;
  peers.typebox = "*";

  pkg.dependencies = dependencies;
  pkg.peerDependencies = peers;

  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log("Corrigido: typebox declarado em peerDependencies.");
} else if (peers.typebox === "*") {
  console.log("OK: typebox já está declarado em peerDependencies.");
} else {
  console.warn(
    "A declaração de typebox não corresponde ao caso esperado.",
    "dependencies:", dependencies.typebox,
    "peerDependencies:", peers.typebox
  );
}
NODE

# Usuário de execução
RUN set -eux; \
    if id -u pi >/dev/null 2>&1; then \
        echo "Usuário pi já existe"; \
    elif id -u node >/dev/null 2>&1; then \
        NODE_GROUP="$(id -gn node)"; \
        usermod --login pi --home /home/pi --move-home --shell /bin/bash node; \
        if [ "$NODE_GROUP" != "pi" ]; then \
            groupmod --new-name pi "$NODE_GROUP"; \
        fi; \
    else \
        useradd --create-home --shell /bin/bash pi; \
    fi

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY scripts ./scripts
COPY config ./config
COPY extensions ./extensions

RUN chmod +x /app/scripts/*.sh

# Ambiente final do agente
ENV HOME=/home/pi

WORKDIR /workspace

EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/entrypoint.sh"]
