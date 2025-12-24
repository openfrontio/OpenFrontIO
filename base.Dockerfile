FROM node:24-slim

RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    git \
    curl \
    jq \
    wget \
    apache2-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb > cloudflared.deb \
    && dpkg -i cloudflared.deb \
    && rm cloudflared.deb

RUN sed -i 's/worker_connections [0-9]*/worker_connections 8192/' /etc/nginx/nginx.conf

RUN mkdir -p /var/log/supervisor /etc/cloudflared && \
    chown -R node:node /etc/cloudflared && \
    chmod -R 755 /etc/cloudflared


WORKDIR /usr/src/app