# Build stage - will use your native architecture
FROM --platform=$BUILDPLATFORM oven/bun:1 AS builder

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

# Set the working directory for the build
WORKDIR /build

# Copy package files
COPY package.json bun.lock ./

# Install dependencies while bypassing Husky hooks
ENV HUSKY=0 
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
RUN mkdir -p .git && bun install --include=dev

# Copy the rest of the application code
COPY . .

# Build the client-side application with verbose output
RUN echo "Starting build process..." && bun run build-prod && echo "Build completed successfully!"

# Check output directory
RUN ls -la static || echo "Static directory not found"

# Production stage
FROM oven/bun:1

# Add environment variable
ARG GAME_ENV=prod
ENV GAME_ENV=$GAME_ENV
ENV NODE_ENV=production
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

# Install Nginx, Supervisor and Git (for Husky)
RUN apt-get update && apt-get install -y nginx supervisor && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy output files from builder (using the correct 'static' directory)
COPY --from=builder /build/static ./static
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json
COPY --from=builder /build/bun.lock ./bun.lock

# Copy server files
COPY --from=builder /build/src ./src


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