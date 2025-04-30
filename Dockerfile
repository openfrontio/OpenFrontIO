# Use an official Node runtime as the base image
FROM node:18
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

# Install Nginx, Supervisor, Git, jq, curl, and Node Exporter dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    git \
    curl \
    jq \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Node Exporter
RUN mkdir -p /opt/node_exporter && \
    wget -qO- https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz | \
    tar xvz --strip-components=1 -C /opt/node_exporter && \
    ln -s /opt/node_exporter/node_exporter /usr/local/bin/

# Install cloudflared
RUN curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb > cloudflared.deb \
    && dpkg -i cloudflared.deb \
    && rm cloudflared.deb

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

# Copy Nginx configuration and ensure it's used instead of the default
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Setup supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy and make executable the startup script
COPY startup.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/startup.sh

# Use the startup script as the entrypoint
ENTRYPOINT ["/usr/local/bin/startup.sh"]