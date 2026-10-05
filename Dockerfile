FROM node:22-bookworm-slim

# bash com pipefail: o build falha se o curl falhar dentro de um "curl | bash"
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG PI_CODING_AGENT_VERSION=latest
ARG PI_WEB_ACCESS_VERSION=0.14.0
ARG PI_MEMORY_VERSION=0.4.0

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    TZ=America/Sao_Paulo

# unzip é necessário para o instalador do Composio
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl ffmpeg git gosu jq tini tzdata unzip \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}"

# Extensões pré-instaladas em uma área-semente. Cada agente recebe uma cópia
# própria no volume /home/pi/.pi durante sua primeira inicialização.
ENV HOME=/opt/pi-seed
RUN mkdir -p /opt/pi-seed/.pi/agent \
    && pi install npm:pi-subagents \
    && pi install "npm:pi-web-access@${PI_WEB_ACCESS_VERSION}" \
    && pi install npm:pi-hermes-memory \
    && pi install "npm:pi-memory@${PI_MEMORY_VERSION}" \
    && pi install npm:pi-messenger-bridge \
    && pi install npm:pi-schedule-prompt

# Composio CLI: o instalador grava em $HOME (/opt/pi-seed), então copiamos o
# binário para /usr/local/bin, que fica no PATH de qualquer usuário.
RUN curl -fsSL https://composio.dev/install | bash \
    && COMPOSIO_BIN="$(find /opt/pi-seed -maxdepth 4 -name composio -type f | head -n1)" \
    && test -n "$COMPOSIO_BIN" \
    && install -m 0755 "$COMPOSIO_BIN" /usr/local/bin/composio \
    && composio --version

# A imagem Node já possui normalmente o usuário node com UID 1000.
RUN set -eux; \
    if id -u pi >/dev/null 2>&1; then \
        echo "Usuário pi já existe"; \
    elif id -u node >/dev/null 2>&1; then \
        NODE_GROUP="$(id -gn node)"; \
        usermod --login pi --home /home/pi --move-home --shell /bin/bash node; \
        if [ "$NODE_GROUP" != "pi" ]; then groupmod --new-name pi "$NODE_GROUP"; fi; \
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

ENV HOME=/home/pi
WORKDIR /workspace
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/entrypoint.sh"]
