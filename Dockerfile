# syntax=docker/dockerfile:1
# Ahanportal API (NestJS). Migrations in drizzle/ run on startup; uploaded files
# live in /app/uploads (mount a volume there). All settings come from environment
# variables (see docker-compose.yml next to the frontend and backend folders).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Read at startup by the migrator (process.cwd()/drizzle)
COPY --from=build /app/drizzle ./drizzle
# One-off tools: npm run admin:hash, import:ahanonline, slugs:rebuild
COPY --from=build /app/scripts ./scripts
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 4010
CMD ["node", "dist/main"]
