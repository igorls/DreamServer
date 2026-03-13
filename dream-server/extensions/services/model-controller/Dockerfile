# Model Controller — Multi-stage Bun compiled binary
# Uses debian-slim runtime for glibc compatibility with Bun compiled binaries

FROM oven/bun:1-debian AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY src/ src/
RUN bun build src/index.ts --compile --outfile controller

FROM debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/Light-Heart-Labs/DreamServer"
LABEL org.opencontainers.image.description="Dream Server Model Controller"

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/controller /usr/local/bin/controller

RUN useradd -r -u 1000 controller
USER controller

ENV CONTROLLER_PORT=3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -sf http://localhost:${CONTROLLER_PORT}/health || exit 1

EXPOSE ${CONTROLLER_PORT}

ENTRYPOINT ["controller"]
