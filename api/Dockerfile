# ─── Build stage ────────────────────────────────────────────
FROM node:18-alpine AS deps

WORKDIR /app

# Install only production dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Production image ────────────────────────────────────────
FROM node:18-alpine AS runner

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 yahweahcare

WORKDIR /app

# Copy deps from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY --chown=yahweahcare:nodejs . .

USER yahweahcare

# Azure App Service injects PORT — default 8080 for containers
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/api/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
