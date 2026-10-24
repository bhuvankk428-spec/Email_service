FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM builder AS migrator
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/dist ./dist

ENV PORT=4000

USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
