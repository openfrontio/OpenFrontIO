# Use an official Node runtime as the base image
FROM node:24-slim AS base

# Create dependency layer
FROM base AS dependencies
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

# Final image
FROM base

# Copy installed packages from dependencies stage
COPY --from=dependencies / /

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies while bypassing Husky hooks
ENV HUSKY=0
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
RUN mkdir -p .git && npm install

# Copy the rest of the application code
COPY . .

# Build the client-side application
RUN npm run build-prod

# So we can see which commit was used to build the container
# https://openfront.io/commit.txt
RUN echo $GIT_COMMIT > static/commit.txt

# Copy Nginx configuration and ensure it's used instead of the default
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Setup supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy and make executable the startup script
COPY startup.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/startup.sh

RUN mkdir -p /tmp/.cloudflared && chmod 777 /tmp/.cloudflared
ENV CF_CONFIG_DIR=/tmp/.cloudflared

# Use the startup script as the entrypoint
ENTRYPOINT ["/usr/local/bin/startup.sh"]
