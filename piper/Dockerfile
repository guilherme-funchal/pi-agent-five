FROM python:3.12-slim

ARG PIPER_TTS_VERSION=1.6.0

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir "piper-tts[http]==${PIPER_TTS_VERSION}"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
