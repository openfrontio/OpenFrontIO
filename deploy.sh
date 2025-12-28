#!/bin/bash
# deploy.sh - Deploy application to Hetzner server
# This script:
# 1. Copies the update script to Hetzner server
# 2. Executes the update script on the Hetzner server

set -e # Exit immediately if a command exits with a non-zero status

# Function to print section headers
print_header() {
    echo "======================================================"
    echo "🚀 $1"
    echo "======================================================"
}

# Check command line arguments
if [ $# -ne 4 ]; then
    echo "Error: Please specify environment, host, version tag, and subdomain"
    echo "Usage: $0 [prod|staging] [falk1|nbg1|staging|masters] [version_tag] [subdomain]"
    exit 1
fi

# Validate first argument (environment)
if [ "$1" != "prod" ] && [ "$1" != "staging" ]; then
    echo "Error: First argument must be either 'prod' or 'staging'"
    echo "Usage: $0 [prod|staging] [falk1|nbg1|staging|masters] [version_tag] [subdomain]"
    exit 1
fi

# Validate second argument (host)
if [ "$2" != "falk1" ] && [ "$2" != "nbg1" ] && [ "$2" != "staging" ] && [ "$2" != "masters" ]; then
    echo "Error: Second argument must be either 'falk1', 'nbg1', 'staging', or 'masters'"
    echo "Usage: $0 [prod|staging] [falk1|nbg1|staging|masters] [version_tag] [subdomain]"
    exit 1
fi

ENV=$1
HOST=$2
VERSION_TAG=$3
SUBDOMAIN=$4

# Set subdomain - use the provided subdomain
echo "Using subdomain: $SUBDOMAIN"

# Load common environment variables first
if [ -f .env ]; then
    echo "Loading common configuration from .env file..."
    export $(grep -v '^#' .env | xargs)
fi

# Load environment-specific variables
if [ -f .env.$ENV ]; then
    echo "Loading $ENV-specific configuration from .env.$ENV file..."
    export $(grep -v '^#' .env.$ENV | xargs)
fi

# Check required environment variables for deployment
if [ -z "$GHCR_USERNAME" ] || [ -z "$GHCR_REPO" ]; then
    echo "Error: GHCR_USERNAME or GHCR_REPO not defined in .env file or environment"
    exit 1
fi

if [[ "$VERSION_TAG" == sha256:* ]]; then
    GHCR_IMAGE="${GHCR_USERNAME}/${GHCR_REPO}@${VERSION_TAG}"
else
    GHCR_IMAGE="${GHCR_USERNAME}/${GHCR_REPO}:${VERSION_TAG}"
fi

if [ "$HOST" == "staging" ]; then
    print_header "DEPLOYING TO STAGING HOST"
    SERVER_HOST=$SERVER_HOST_STAGING
elif [ "$HOST" == "nbg1" ]; then
    print_header "DEPLOYING TO NBG1 HOST"
    SERVER_HOST=$SERVER_HOST_NBG1
elif [ "$HOST" == "masters" ]; then
    print_header "DEPLOYING TO MASTERS HOST"
    SERVER_HOST=$SERVER_HOST_MASTERS
else
    print_header "DEPLOYING TO FALK1 HOST"
    SERVER_HOST=$SERVER_HOST_FALK1
fi

# Check required environment variables
if [ -z "$SERVER_HOST" ]; then
    echo "Error: ${HOST} not defined in .env file or environment"
    exit 1
fi

# Configuration
UPDATE_SCRIPT="./update.sh" # Path to your update script
REMOTE_USER="openfront"
REMOTE_UPDATE_PATH="/home/$REMOTE_USER"
REMOTE_UPDATE_SCRIPT="$REMOTE_UPDATE_PATH/update-openfront.sh" # Where to place the script on server

# Check if update script exists
if [ ! -f "$UPDATE_SCRIPT" ]; then
    echo "Error: Update script $UPDATE_SCRIPT not found!"
    exit 1
fi

# Display deployment information
print_header "DEPLOYMENT INFORMATION"
echo "Environment: ${ENV}"
echo "Host: ${HOST}"
echo "Subdomain: ${SUBDOMAIN}"
echo "Image: $GHCR_IMAGE"
echo "Target Server: $SERVER_HOST"

# Copy update script to Hetzner server
print_header "COPYING UPDATE SCRIPT TO SERVER"
echo "Target: $REMOTE_USER@$SERVER_HOST"

# Make sure the update script is executable
chmod +x $UPDATE_SCRIPT

# Copy the update script to the server
scp -i $SSH_KEY $UPDATE_SCRIPT $REMOTE_USER@$SERVER_HOST:$REMOTE_UPDATE_SCRIPT

if [ $? -ne 0 ]; then
    echo "❌ Failed to copy update script to server. Stopping deployment."
    exit 1
fi

# Generate a random filename for the environment file to prevent conflicts
# when multiple deployments are happening at the same time.
ENV_FILE="${REMOTE_UPDATE_PATH}/${SUBDOMAIN}-${RANDOM}.env"

print_header "EXECUTING UPDATE SCRIPT ON SERVER"

ssh -i $SSH_KEY $REMOTE_USER@$SERVER_HOST "chmod +x $REMOTE_UPDATE_SCRIPT && \
cat > $ENV_FILE << 'EOL'
GAME_ENV=$ENV
ENV=$ENV
HOST=$HOST
GHCR_IMAGE=$GHCR_IMAGE
GHCR_TOKEN=$GHCR_TOKEN
CF_ACCOUNT_ID=$CF_ACCOUNT_ID
CF_API_TOKEN=$CF_API_TOKEN
TURNSTILE_SECRET_KEY=$TURNSTILE_SECRET_KEY
API_KEY=$API_KEY
DOMAIN=$DOMAIN
SUBDOMAIN=$SUBDOMAIN
OTEL_EXPORTER_OTLP_ENDPOINT=$OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_AUTH_HEADER=$OTEL_AUTH_HEADER
EOL
chmod 600 $ENV_FILE && \
$REMOTE_UPDATE_SCRIPT $ENV_FILE"

if [ $? -ne 0 ]; then
    echo "❌ Failed to execute update script on server."
    exit 1
fi

print_header "DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "✅ New version deployed to ${ENV} environment in ${HOST} with subdomain ${SUBDOMAIN}!"
echo "🌐 Check your server to verify the deployment."
echo "======================================================="
