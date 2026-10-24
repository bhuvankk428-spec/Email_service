FROM node:22-alpine AS base

RUN apk add --no-cache libc6-compat

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install -g npm@11.6.2 && npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG API_PROXY_TARGET=http://api:4000
ARG NEXT_PUBLIC_DEV_AUTH_ENABLED=false
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV API_PROXY_TARGET=$API_PROXY_TARGET
ENV NEXT_PUBLIC_DEV_AUTH_ENABLED=$NEXT_PUBLIC_DEV_AUTH_ENABLED
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
