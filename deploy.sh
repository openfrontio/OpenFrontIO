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
    echo "Usage: $0 [prod|staging] [machine_name] [version_tag] [subdomain]"
    exit 1
fi

# Validate first argument (environment)
if [ "$1" != "prod" ] && [ "$1" != "staging" ]; then
    echo "Error: First argument must be either 'prod' or 'staging'"
    echo "Usage: $0 [prod|staging] [machine_name] [version_tag] [subdomain]"
    exit 1
fi

# The machine name is resolved to an SSH target below (SERVER_HOSTS_JSON or
# a legacy SERVER_HOST_<NAME> variable), so any label-shaped name is valid —
# adding a machine must not require editing this script.
case "$2" in
    "" | *[!a-zA-Z0-9-]*)
        echo "Error: machine name must be letters, digits and hyphens, got: '$2'"
        exit 1
        ;;
esac

ENV=$1
HOST=$2
VERSION_TAG=$3
SUBDOMAIN=$4

# Validate subdomain - it becomes a DNS label in the Traefik Host() rule, a
# Docker container name, and part of a path on the remote host, so hold it to the
# RFC 1123 label rules: letters, digits and interior hyphens, 63 octets at most.
case "$SUBDOMAIN" in
    "" | *[!a-zA-Z0-9-]* | -* | *-)
        echo "Error: subdomain must be a valid hostname label - letters, digits and interior hyphens only - got: '$SUBDOMAIN'"
        exit 1
        ;;
esac
if [ "${#SUBDOMAIN}" -gt 63 ]; then
    echo "Error: subdomain must be at most 63 characters, got ${#SUBDOMAIN}: '$SUBDOMAIN'"
    exit 1
fi

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

if [ -z "$DOMAIN" ]; then
    echo "Error: DOMAIN not defined in .env file or environment"
    exit 1
fi

# Cluster map (docs/MultiServer.md). Three jobs here:
#   1. jq -c compacts whatever formatting the CI variable carries into one
#      unspaced line — the remote env file is loaded word-split (update.sh's
#      `export $(... | xargs)`), so any internal whitespace would shatter the
#      assignment and abort the deploy. This also fails fast on invalid JSON.
#   2. A shared map applies only to the deployments it names. Outside prod, a
#      host with no entry (feature branches, nightly) falls back to the
#      synthesized single-entry map below instead of failing the server's
#      boot self-match — so one repo-level CLUSTER_JSON can describe the
#      load-balanced blue/green .dev pair while every other deploy stays
#      standalone. Prod is strict both ways: it always requires an explicit
#      map that names this host, because a synthesized entry would mint game
#      ids under a letter the real fleet map does not own.
#   3. Sharing a multi-entry map means being behind the load balancer, so
#      that also switches on the drain poll: SITE_HOST defaults to the apex
#      ($DOMAIN) for deployments in a map with siblings (release.yml also
#      sets it explicitly, but only for the prod blue/green jobs; this
#      covers the .dev pair). One map = one balanced fleet, so a standalone
#      prod deployment (beta) gets its OWN single-entry map, never an entry
#      in the fleet's — and a single-entry map keeps SITE_HOST empty, like
#      synthesized ones, staying permanently active rather than polling an
#      apex that answers with some other fleet's identity and wrongly
#      draining itself.
FQDN="${SUBDOMAIN}.${DOMAIN}"
if [ -n "${CLUSTER_JSON:-}" ]; then
    CLUSTER_JSON=$(printf '%s' "$CLUSTER_JSON" | jq -c .)
    if printf '%s' "$CLUSTER_JSON" | jq -e --arg host "$FQDN" 'any(.[]; .host == $host)' > /dev/null; then
        if printf '%s' "$CLUSTER_JSON" | jq -e 'length > 1' > /dev/null; then
            SITE_HOST="${SITE_HOST:-$DOMAIN}"
        fi
    elif [ "$ENV" != "prod" ]; then
        echo "Host ${FQDN} not in provided CLUSTER_JSON; ignoring the shared map"
        CLUSTER_JSON=""
    else
        echo "Error: prod host ${FQDN} has no entry in CLUSTER_JSON"
        exit 1
    fi
fi
if [ -z "${CLUSTER_JSON:-}" ]; then
    if [ "$ENV" != "prod" ]; then
        CLUSTER_JSON=$(jq -nc --arg host "$FQDN" \
            '{a: {host: $host, color: "blue", numWorkers: 2}}')
        echo "CLUSTER_JSON not set; synthesized single-entry map for ${FQDN}"
    else
        echo "Error: CLUSTER_JSON must be set for prod deploys"
        exit 1
    fi
fi

# Resolve the machine name to its SSH target. Two sources, directory first:
#   1. SERVER_HOSTS_JSON — a machine directory, {"falk2":"1.2.3.4",...}.
#      Adding a machine to the fleet is one edit to that secret; no workflow
#      or script changes (same spirit as CLUSTER_JSON for topology).
#   2. Legacy SERVER_HOST_<NAME> variables (SERVER_HOST_FALK2, ...), kept so
#      existing setups and .env files work unchanged.
print_header "DEPLOYING TO ${HOST} HOST"
SERVER_HOST=""
if [ -n "${SERVER_HOSTS_JSON:-}" ]; then
    SERVER_HOST=$(printf '%s' "$SERVER_HOSTS_JSON" | jq -r --arg h "$HOST" '.[$h] // empty')
fi
if [ -z "$SERVER_HOST" ]; then
    LEGACY_VAR="SERVER_HOST_$(printf '%s' "$HOST" | tr '[:lower:]-' '[:upper:]_')"
    SERVER_HOST="${!LEGACY_VAR:-}"
fi

# Check required environment variables
if [ -z "$SERVER_HOST" ]; then
    echo "Error: machine '${HOST}' not found in SERVER_HOSTS_JSON and \$${LEGACY_VAR} is unset"
    exit 1
fi

# Configuration
UPDATE_SCRIPT="./update.sh" # Path to your update script
REMOTE_USER="openfront"
REMOTE_UPDATE_PATH="/home/$REMOTE_USER"
# Randomize the remote script name so concurrent deployments (different
# branches share the staging host) don't overwrite each other's copy while
# one of them is executing it.
REMOTE_UPDATE_SCRIPT="$REMOTE_UPDATE_PATH/update-openfront-${SUBDOMAIN}-${RANDOM}.sh"
# Lock serializing the host-side update (container swap, docker prune) across
# concurrent deployments to the same host.
REMOTE_LOCK_FILE="$REMOTE_UPDATE_PATH/update-openfront.lock"

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
API_KEY=$API_KEY
ADMIN_BOT_API_KEY=$ADMIN_BOT_API_KEY
DOMAIN=$DOMAIN
SUBDOMAIN=$SUBDOMAIN
SITE_HOST=$SITE_HOST
CDN_BASE=$CDN_BASE
CLUSTER_JSON=$CLUSTER_JSON
TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY
OTEL_EXPORTER_OTLP_ENDPOINT=$OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_AUTH_HEADER=$OTEL_AUTH_HEADER
EOL
chmod 600 $ENV_FILE && \
flock -w 900 $REMOTE_LOCK_FILE $REMOTE_UPDATE_SCRIPT $ENV_FILE && \
rm -f $REMOTE_UPDATE_SCRIPT"

if [ $? -ne 0 ]; then
    echo "❌ Failed to execute update script on server."
    exit 1
fi

print_header "DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "✅ New version deployed to ${ENV} environment in ${HOST} with subdomain ${SUBDOMAIN}!"
echo "🌐 Check your server to verify the deployment."
echo "======================================================="
