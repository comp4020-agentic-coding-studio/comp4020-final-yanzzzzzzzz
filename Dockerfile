# syntax = docker/dockerfile:1

# Builder: installs dependencies and bundles the TypeScript server into one
# file with esbuild. node:sqlite is built into Node itself, so there's no
# native toolchain to carry into the runtime stage.
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Runtime: only the bundle, static assets and README.md (served verbatim at
# /readme/, per spec/README.md). Serves HTTP on 0.0.0.0:$PORT; Fly's proxy
# terminates TLS in front of it, so the app itself sees plain http.
#
# Stays root: the /data volume's ownership on first mount isn't something
# this Dockerfile controls, and there's no second tenant on this single
# machine to isolate from — simplicity over unverifiable hardening here.
FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/dist/server.js ./dist/server.js
COPY public ./public
COPY README.md ./
CMD ["node", "dist/server.js"]
