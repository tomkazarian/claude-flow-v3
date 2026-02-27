# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS builder

WORKDIR /app

# Install dependencies (cached unless package files change)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Prune to production-only deps
RUN npm prune --production

# ---------------------------------------------------------------------------
# Stage 2: Production
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Copy built output and production node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Install only Chromium (skip Firefox/WebKit to save ~800MB)
RUN npx playwright install chromium

# Create directories for runtime data
RUN mkdir -p /app/data /app/logs /app/screenshots \
    && chown -R pwuser:pwuser /app/data /app/logs /app/screenshots

ENV NODE_ENV=production
ENV BROWSER_HEADLESS=true

# Railway injects PORT at runtime; the app reads it from process.env.PORT
EXPOSE ${PORT:-3000}

CMD ["node", "dist/index.js"]
