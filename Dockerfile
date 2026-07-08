FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ARG GIT_COMMIT=unknown
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_COMMIT=${GIT_COMMIT}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node scripts/write-build-info.mjs
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV GIT_COMMIT=${GIT_COMMIT}
LABEL org.opencontainers.image.revision=${GIT_COMMIT}
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.build-info.json ./.build-info.json
RUN mkdir -p /app/data /app/uploads && chown -R nextjs:nodejs /app/data /app/uploads
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
