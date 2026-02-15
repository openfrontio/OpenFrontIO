FROM node:24-slim AS base
WORKDIR /usr/src/app

FROM base AS build
ENV HUSKY=0
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY src ./src
RUN npm run build-prod

FROM base AS prod-deps
ENV HUSKY=0
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

FROM base
COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/static ./static
COPY package*.json ./
COPY src ./src
COPY data ./data
ENV PORT=3100
EXPOSE 3100
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/ingest/server.ts"]
