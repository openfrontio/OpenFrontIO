# Use an official Node runtime as the base image
FROM oven/bun:1

# Add environment variable
ARG GAME_ENV=prod
ENV GAME_ENV=$GAME_ENV

# Install Nginx, Supervisor and Git (for Husky)
RUN apt-get update && apt-get install -y nginx supervisor git && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package.json bun.lock ./

# Install dependencies while bypassing Husky hooks
ENV HUSKY=0 
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
RUN mkdir -p .git && bun install --include=dev

# Copy the rest of the application code
COPY . .

# Build the client-side application
RUN bun run build-prod

ENV NODE_ENV=production

# Copy Nginx configuration and ensure it's used instead of the default
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Setup supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose only the Nginx port
EXPOSE 80 443

# Start Supervisor to manage both Node.js and Nginx
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]