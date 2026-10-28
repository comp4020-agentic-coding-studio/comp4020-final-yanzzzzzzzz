# syntax = docker/dockerfile:1

# Builder: installs dependencies and bundles the TypeScript server into one
# file with esbuild. node:sqlite is built into Node itself, so there's no
# native toolchain to carry into the runtime stage.
#
# `sharp` (cover-image validation/resize/re-encode, src/uploads.ts) is the
# one dependency esbuild can't bundle — it's a thin JS wrapper around a
# native libvips binary, shipped as a separate optional-dependency package
# per OS/libc/arch (@img/sharp-linuxmusl-x64 for this base image). Marking
# it `--external` here is what keeps the bundle itself pure JS; the actual
# binary comes from a SEPARATE `pnpm install --prod` below, run on this same
# alpine (musl) base, so pnpm resolves the musl build rather than whatever
# binary happens to match the host machine that ran this Dockerfile.
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Installs ONLY production dependencies (sharp + its musl binary, hono,
# @hono/node-server) in a throwaway layer on the exact same alpine base the
# runtime stage below uses — this is what's actually verified to produce a
# working `node_modules/sharp` for this platform: `pnpm install --prod` here
# resolves and downloads @img/sharp-linuxmusl-x64 (not the glibc build),
# since it runs ON alpine, not cross-compiled from the builder stage above
# (which is also alpine, so today they'd match either way, but this stage
# existing independently is what keeps that true if the base image ever
# changes only for one stage and not the other).
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Runtime: the bundle, its one native dependency's node_modules, static
# assets and README.md (served verbatim at /readme/, per spec/README.md).
# Serves HTTP on 0.0.0.0:$PORT; Fly's proxy terminates TLS in front of it,
# so the app itself sees plain http.
#
# Stays root: the /data volume's ownership on first mount isn't something
# this Dockerfile controls, and there's no second tenant on this single
# machine to isolate from — simplicity over unverifiable hardening here.
FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/dist/server.js ./dist/server.js
COPY --from=deps /app/node_modules ./node_modules
COPY public ./public
COPY README.md ./
CMD ["node", "dist/server.js"]
