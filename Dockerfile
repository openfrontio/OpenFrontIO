# Use an official Node runtime as the base image
FROM node:24-slim AS base
WORKDIR /usr/src/app

# Build stage - install ALL dependencies and build
FROM base AS build
ENV HUSKY=0
# Copy package files first for better caching
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy only what's needed for build
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY eslint.config.js ./
COPY index.html ./
COPY resources ./resources
COPY proprietary ./proprietary
COPY src ./src

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT="$GIT_COMMIT"
RUN npm run build-prod

# Production dependencies stage - separate from build
FROM base AS prod-deps
ENV HUSKY=0
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Final production image
FROM base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    curl \
    wget \
    supervisor \
    apache2-utils \
    && rm -rf /var/lib/apt/lists/*

# Update worker_connections in nginx.conf
RUN sed -i 's/worker_connections [0-9]*/worker_connections 8192/' /etc/nginx/nginx.conf

# Setup supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Copy production node_modules from prod-deps stage (cached separately from build)
COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY package*.json ./

# Copy built artifacts from build stage
COPY --from=build /usr/src/app/static ./static

COPY resources ./resources

# Remove maps because they are not used by the server.
RUN rm -rf ./resources/maps
COPY tsconfig.json ./
COPY src ./src


ARG GIT_COMMIT=unknown
RUN echo "$GIT_COMMIT" > static/commit.txt

ENV GIT_COMMIT="$GIT_COMMIT"

RUN <<'EOF' tee /usr/local/bin/start.sh
#!/bin/sh
if [ "$DOMAIN" = openfront.dev ] && [ "$SUBDOMAIN" != main ]; then
    exec timeout 25h /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
else
    exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
EOF
RUN chmod +x /usr/local/bin/start.sh
ENTRYPOINT ["/usr/local/bin/start.sh"]
