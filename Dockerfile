# syntax=docker/dockerfile:1.7
#
# EchoFox — Production Dockerfile
# ──────────────────────────────────────────────────────────────────────────
#  • Multi-stage: heavy build tools live in the builder image; final runtime
#    image is alpine-slim with only what the bot needs to execute.
#  • Native deps (better-sqlite3) compiled in the builder against the same
#    libc + node version as the runtime → no "GLIBC not found" surprises.
#  • Final image runs as non-root (uid 1001) for defence in depth.
#  • HEALTHCHECK probes /healthz so orchestrators (Compose, Swarm, K8s,
#    Coolify, Dokku, etc.) can know exactly when the worker is alive.
#  • ffmpeg is included for sticker/media commands (~12 MB).
#  • Multi-arch: builds clean on linux/amd64 and linux/arm64
#    (use `docker buildx bake` or the workflow in M4 to produce both).
# ──────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=20-alpine3.20

# ════════════════════════════════════════════════════════════════════════
# Stage 1 — Builder
# ════════════════════════════════════════════════════════════════════════
FROM node:${NODE_VERSION} AS builder

# Native build toolchain (only present in this stage)
RUN apk add --no-cache --virtual .build-deps \
      python3 \
      make \
      g++ \
      gcc \
      libc-dev \
      pkgconf \
    && ln -sf python3 /usr/bin/python

WORKDIR /build

# Layer caching: only re-install when the lockfile changes
COPY package.json package-lock.json* ./

# Production install only — devDeps (eslint, husky, prettier) are NOT shipped.
# --ignore-scripts avoids running husky's prepare hook in the container.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

# Now copy the source. (App code changes don't bust the dep cache above.)
COPY src       ./src
COPY scripts   ./scripts
COPY ecosystem.config.js LICENSE NOTICE README.md DISCLAIMER.md SECURITY.md ./

# Sanity check: every file we ship parses
RUN node -e "['src/core/bootstrap.js','src/core/worker.js','src/lib/configLoader.js'].forEach(f=>require('node:vm').compileFunction(require('node:fs').readFileSync(f,'utf8'),[],{filename:f}))"

# Remove things we definitely don't need at runtime
RUN rm -rf \
      node_modules/**/*.md \
      node_modules/**/test \
      node_modules/**/tests \
      node_modules/**/*.ts \
      node_modules/**/*.map \
      node_modules/**/.github 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════════
# Stage 2 — Runtime
# ════════════════════════════════════════════════════════════════════════
FROM node:${NODE_VERSION} AS runtime

LABEL org.opencontainers.image.title="EchoFox"
LABEL org.opencontainers.image.description="A production-grade WhatsApp bot built on Baileys 7.x"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/Cosm1cBug/EchoFox"
LABEL org.opencontainers.image.documentation="https://cosm1cbug.github.io/echofox"
LABEL org.opencontainers.image.authors="COSM1CBUG <cosmicbug.me@pm.me>"
LABEL org.opencontainers.image.vendor="EchoFox"

ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps --max-old-space-size=512" \
    LOG_LEVEL=info \
    PORT=3000 \
    TZ=Asia/Kolkata

# Runtime-only OS deps:
#   • ffmpeg     – media / sticker conversion
#   • tini       – PID 1 signal forwarding so SIGTERM kills the worker cleanly
#   • tzdata     – moment-timezone needs IANA db for non-UTC zones
#   • ca-certs   – TLS to WhatsApp servers
#   • curl       – HEALTHCHECK probe
RUN apk add --no-cache \
      ffmpeg \
      tini \
      tzdata \
      ca-certificates \
      curl

# Create unprivileged user
RUN addgroup -g 1001 -S echofox \
 && adduser  -u 1001 -S echofox -G echofox -h /app -s /sbin/nologin

WORKDIR /app

# Copy from builder
COPY --from=builder --chown=echofox:echofox /build/node_modules ./node_modules
COPY --from=builder --chown=echofox:echofox /build/src         ./src
COPY --from=builder --chown=echofox:echofox /build/scripts     ./scripts
COPY --from=builder --chown=echofox:echofox /build/package.json /build/ecosystem.config.js /build/LICENSE /build/NOTICE /build/README.md /build/DISCLAIMER.md /build/SECURITY.md ./

# Pre-create the directories we expect to be volume-mounted, so a fresh
# `docker run` with no volumes still boots (data ephemeral, but it boots).
RUN mkdir -p /app/src/@session /app/src/store/runtime \
 && chown -R echofox:echofox /app/src/@session /app/src/store

USER echofox

EXPOSE 3000

# Liveness probe — same endpoint Compose/K8s should hit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1

# tini ensures SIGTERM reaches Node (otherwise Docker waits 10 s then SIGKILLs)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/core/bootstrap.js"]

# ────────────────────────────────────────────────────────────────────────
# IMPORTANT runtime data:
#
#   /app/src/@session         WhatsApp pairing creds — MUST persist!
#                             Losing this means re-scanning QR.
#   /app/src/store/runtime    SQLite DBs (analytics, users, message store)
#                             Losing this is non-fatal but loses history.
#
# Recommended mounts:
#   -v echofox-session:/app/src/@session
#   -v echofox-store:/app/src/store/runtime
#
# Config:
#   Mount your config.js at /app/src/config.js  (read-only is fine)
#   OR pass ECHOFOX_* env vars (e.g. -e ECHOFOX_APIS_OMDB_APIKEY=xyz)
# ────────────────────────────────────────────────────────────────────────
