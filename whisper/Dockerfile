FROM debian:bookworm-slim AS build
ARG WHISPER_CPP_VERSION=v1.9.1
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake git \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_CPP_VERSION}" \
      https://github.com/ggml-org/whisper.cpp.git /src
RUN cmake -S /src -B /src/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_EXAMPLES=ON \
      -DGGML_NATIVE=OFF \
    && cmake --build /src/build --config Release --target whisper-server -j"$(nproc)"

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg libgomp1 tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY entrypoint.sh /usr/local/bin/whisper-entrypoint
RUN chmod +x /usr/local/bin/whisper-entrypoint
VOLUME ["/models"]
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/whisper-entrypoint"]
