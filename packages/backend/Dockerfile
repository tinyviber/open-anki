# syntax=docker/dockerfile:1

FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1 AS production-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY bun.lock ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
