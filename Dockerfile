# ══════════════════════════════════════════════════════════
# RODAID API · Dockerfile multi-stage
# Stage 1: deps    — instala solo dependencias de producción
# Stage 2: builder — compila TypeScript
# Stage 3: runner  — imagen final mínima (~180 MB)
# ══════════════════════════════════════════════════════════

# ── Stage 1: Dependencias de producción ──────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copiar lockfile primero (cache busting solo si cambian deps)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ── Stage 2: Compilación TypeScript ───────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Verificar que el output existe
RUN test -f dist/server.js || (echo "dist/server.js not found" && exit 1)

# ── Stage 3: Runner mínimo ────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Seguridad: no correr como root
RUN addgroup --system --gid 1001 rodaid \
 && adduser  --system --uid 1001 --ingroup rodaid rodaid

# curl para healthcheck de Docker/ECS
RUN apk add --no-cache curl dumb-init

# Copiar solo lo necesario
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY package.json ./


USER rodaid

EXPOSE 3001

# Healthcheck para Docker y orquestadores
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3001}/api/v1/health || exit 1

# dumb-init: manejo correcto de señales SIGTERM/SIGINT
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
