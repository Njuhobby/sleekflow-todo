# Single app image: Fastify serves the API and the built SPA (T-6.4).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
COPY web/ web/
RUN npx prisma generate --schema server/prisma/schema.prisma
RUN npm run build --workspace web

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    WEB_DIST=/app/web/dist \
    PORT=3001
EXPOSE 3001
# Migrations run on boot so `docker compose up` is the whole story.
CMD ["sh", "-c", "npx prisma migrate deploy --schema server/prisma/schema.prisma && cd server && npx tsx src/server.ts"]
