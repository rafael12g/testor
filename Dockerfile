# ── Stage 1 : Build frontend ────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2 : Production server ────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Only copy what's needed for the server
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY --from=builder /app/dist ./dist

# Persist SQLite DB outside the container via volume
RUN mkdir -p /app/server/data

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "server/index.js"]
