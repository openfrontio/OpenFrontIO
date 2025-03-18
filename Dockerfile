# Use an official Node runtime as the base image
FROM node:18

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

# Set the working directory for the build
WORKDIR /build

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies while bypassing Husky hooks
ENV HUSKY=0 
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
RUN mkdir -p .git && npm install --include=dev

# Copy the rest of the application code
COPY . .

# Build the client-side application
RUN npm run build-prod

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