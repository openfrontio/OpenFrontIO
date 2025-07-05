# Base image with Node for building
FROM node:24-slim AS builder

WORKDIR /app

# Copy and install deps (bypass Husky hooks)
ENV HUSKY=0
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
COPY package*.json ./
RUN npm ci

# Copy source and build app
COPY . .
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build-prod && echo "$GIT_COMMIT" > static/commit.txt


# Stage for installing system packages
FROM node:24-slim AS system-deps

RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    # git \
    curl \
    jq \
    wget \
    apache2-utils && \
    rm -rf /var/lib/apt/lists/*

# Install cloudflared
RUN curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb > cloudflared.deb \
    && dpkg -i cloudflared.deb \
    && rm cloudflared.deb


# Final image
FROM node:24-slim

WORKDIR /usr/src/app

# Copy system packages from the system-deps stage
COPY --from=system-deps /etc/nginx /etc/nginx
COPY --from=system-deps /usr/sbin/nginx /usr/sbin/nginx
COPY --from=system-deps /usr/bin/supervisord /usr/bin/supervisord
COPY --from=system-deps /usr/bin/supervisorctl /usr/bin/supervisorctl
COPY --from=system-deps /etc/supervisor /etc/supervisor
COPY --from=system-deps /usr/local/bin/cloudflared /usr/local/bin/cloudflared

# Copy built app from builder stage
COPY --from=builder /app/static ./static
COPY --from=builder /app/startup.sh /usr/local/bin/startup.sh
COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Optional: create supervisor log dir
RUN mkdir -p /var/log/supervisor

# Fix nginx worker_connections
RUN sed -i 's/worker_connections [0-9]*/worker_connections 8192/' /etc/nginx/nginx.conf || true

# Cloudflared config volume setup
RUN mkdir -p /etc/cloudflared && \
    chown -R node:node /etc/cloudflared && \
    chmod -R 755 /etc/cloudflared

ENV CF_CONFIG_PATH=/etc/cloudflared/config.yml
ENV CF_CREDS_PATH=/etc/cloudflared/creds.json

RUN chmod +x /usr/local/bin/startup.sh

ENTRYPOINT ["/usr/local/bin/startup.sh"]
