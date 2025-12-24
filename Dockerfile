FROM evanpelle/openfront-base:latest AS base

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT="$GIT_COMMIT"
# Disable Husky hooks
ENV HUSKY=0
# Copy package.json and package-lock.json
COPY package*.json ./
# Install dependencies
RUN npm ci
# Copy the rest of the application code
COPY . .
# Build the client-side application
RUN npm run build-prod
# So we can see which commit was used to build the container
# https://openfront.io/commit.txt
RUN echo "$GIT_COMMIT" > static/commit.txt

# Remove maps data from final image
FROM base AS prod-files
COPY . .
RUN rm -rf resources/maps

FROM base AS npm-dependencies
# Disable Husky hooks
ENV HUSKY=0
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
# Copy package.json and package-lock.json
COPY package*.json ./
# Install dependencies
RUN npm ci --omit=dev

# Final image
FROM base
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT="$GIT_COMMIT"

# Copy Nginx configuration and ensure it's used instead of the default
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default
COPY --from=base /etc/nginx/nginx.conf /etc/nginx/nginx.conf

# Copy npm dependencies
COPY --from=npm-dependencies /usr/src/app/node_modules node_modules
COPY package.json .

# Copy the rest of the application code
COPY --from=prod-files /usr/src/app/ /usr/src/app/

# Copy frontend
COPY --from=base /usr/src/app/static static

# Setup supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy and make executable the startup script
COPY startup.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/startup.sh

RUN mkdir -p /etc/cloudflared \
  && chown -R node:node /etc/cloudflared \
  && chmod -R 755 /etc/cloudflared

# Set Cloudflared config directory to a volume mount location
ENV CF_CONFIG_PATH=/etc/cloudflared/config.yml
ENV CF_CREDS_PATH=/etc/cloudflared/creds.json

# Use the startup script as the entrypoint
ENTRYPOINT ["/usr/local/bin/startup.sh"]
