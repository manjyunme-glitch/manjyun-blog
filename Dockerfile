FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ARG GIT_COMMIT=unknown
ARG GITHUB_REPOSITORY=manjyunme-glitch/manjyun-blog
ARG GITHUB_BRANCH=main
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GITHUB_REPOSITORY=${GITHUB_REPOSITORY}
ENV GITHUB_BRANCH=${GITHUB_BRANCH}
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
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.build-info.json ./.build-info.json
COPY --from=builder /app/scripts/reset-admin-password.mjs ./scripts/reset-admin-password.mjs
COPY --from=builder /app/scripts/validate-deployment-config.mjs ./scripts/validate-deployment-config.mjs
RUN install -d -o nextjs -g nodejs -m 0750 /app/data /app/uploads
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node scripts/validate-deployment-config.mjs && exec node server.js"]
