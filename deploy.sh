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
# Lowercased so the byte-exact SERVER_HOSTS_JSON lookup and the case-folded
# legacy SERVER_HOST_<NAME> lookup below cannot resolve the same name to two
# different machines (directory keys are lowercase by convention).
HOST=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')
VERSION_TAG=$3
# Lowercased because browsers lowercase the page host and the API rejects a
# site with uppercase letters, so a mixed-case name would never register.
SUBDOMAIN=$(printf '%s' "$4" | tr '[:upper:]' '[:lower:]')

# Validate subdomain - it becomes a DNS label in the Traefik Host() rule, a
# Docker container name, and part of a path on the remote host, so hold it to the
# RFC 1123 label rules: letters, digits and interior hyphens, 63 octets at most.
case "$SUBDOMAIN" in
    "" | *[!a-z0-9-]* | -* | *-)
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

# Optional second domain for GAME traffic (docs/MultiServer.md, "Server list
# v2" -> "Two hostnames per deployment"). A deployment has two hostnames:
#
#   page host: <subdomain>.<DOMAIN>       e.g. main.openfront.dev
#   game host: <subdomain>.<GAME_DOMAIN>  e.g. main.server.openfront.dev
#
# The page host is what players type and what the static Worker will serve;
# the game host is this container, reached directly for WebSockets and /api.
# They must be separate names because the Worker sits on the page host and
# must never proxy game traffic. On prod they already are (openfront.io vs
# blue/green.openfront.io); GAME_DOMAIN is how a dev deployment gets the
# same shape without inventing a per-branch page domain.
#
# DOMAIN keeps its meaning everywhere else: the audience (JWT, api.$DOMAIN)
# and the page domain. Unset GAME_DOMAIN is exactly today's behaviour, both
# hostnames collapsing back onto $DOMAIN -- which is what prod does, and
# what dev does until the variable is set.
GAME_DOMAIN="${GAME_DOMAIN:-}"
# Prod ignores it outright. This is a dev-only mechanism: on prod the page and
# the game already have distinct names (openfront.io vs blue/green.openfront.io),
# so there is nothing for it to fix there. And it arrives from a REPOSITORY-level
# GitHub variable, which every workflow in the repo inherits the moment it is
# set — including the release jobs. Honouring it on prod would compute
# blue.server.openfront.io, a name that resolves nowhere, as the game host.
# Ignoring it here is the guarantee;
# "prod probably won't set it" is not one.
if [ "$ENV" = "prod" ] && [ -n "$GAME_DOMAIN" ]; then
    echo "Ignoring GAME_DOMAIN='${GAME_DOMAIN}' on prod: its page and game hosts are already distinct names"
    GAME_DOMAIN=""
fi
# It lands verbatim inside a Traefik Host(`...`) rule and in a DNS name, so
# hold it to hostname characters. Loose on purpose — this is a typo guard and a
# shell-injection guard, not a validator for what DNS will actually resolve.
if [ -n "$GAME_DOMAIN" ]; then
    case "$GAME_DOMAIN" in
        *[!a-zA-Z0-9.-]* | .* | -* | *. | *-)
            echo "Error: GAME_DOMAIN must be a hostname - letters, digits, dots and hyphens, no leading or trailing dot or hyphen - got: '$GAME_DOMAIN'"
            exit 1
            ;;
    esac
    echo "Using game domain: $GAME_DOMAIN (page domain: $DOMAIN)"
fi

# Identity (docs/MultiServer.md). Where a container answers comes from the
# deploy target and is settled here; WHO it is (its letter, its worker count)
# is the API registry's answer, fetched on the box by update.sh's "register"
# block. INSTANCE_LETTER and NUM_WORKERS are not set by any workflow: a value
# in this script's environment is passed through and wins over the registry,
# for a hand-run deploy while the API is down.
#
#   GAME_HOST        the name clients open sockets to. Defaults to the
#                    standalone shape <subdomain>.<game domain> — which is
#                    also prod's blue.openfront.io behind the balancer. A
#                    fleet member on a machine-scoped name
#                    (blue.nbg2.<game domain>: every box carries its own blue
#                    and green, one wildcard DNS record per box) passes it.
#   SITE_HOST        the page host. Passed explicitly it wins; else the apex
#                    (DOMAIN) for the blue and green slots, which belong to
#                    the apex site by convention; else <subdomain>.<DOMAIN>
#                    under GAME_DOMAIN (the Worker's name for this
#                    deployment's page); else empty — page and game are then
#                    one name.
#
# GAME_HOST travels as-is so the container (Traefik rule, nginx self-match)
# and the server (ServerEnv.publicHost) never re-derive it. A machine-scoped
# deployment also carries the machine in its container name
# (DEPLOYMENT_NAME, update.sh) so the same slot on two machines cannot
# collide when both "machines" are names for one box.
#
# The markers below delimit the block tests/DeployIdentity.test.ts extracts
# and runs against a table of deployments — the rest of this script talks to
# ssh and cannot be executed in a test, but this decision can. Keep them in
# place.
# --- BEGIN identity (tested) ---
INSTANCE_LETTER="${INSTANCE_LETTER:-}"
NUM_WORKERS="${NUM_WORKERS:-}"
case "$INSTANCE_LETTER" in
    "" | [a-z]) ;;
    *)
        echo "Error: INSTANCE_LETTER must be one lowercase letter, got: '${INSTANCE_LETTER}'"
        exit 1
        ;;
esac
case "$NUM_WORKERS" in
    "") ;;
    *[!0-9]* | 0*)
        echo "Error: NUM_WORKERS must be a positive integer, got: '${NUM_WORKERS}'"
        exit 1
        ;;
esac
GAME_HOST="${GAME_HOST:-${SUBDOMAIN}.${GAME_DOMAIN:-$DOMAIN}}"
# Same hostname guard as GAME_DOMAIN above: it lands in a Traefik rule.
case "$GAME_HOST" in
    *[!a-zA-Z0-9.-]* | .* | -* | *. | *-)
        echo "Error: GAME_HOST must be a hostname, got: '${GAME_HOST}'"
        exit 1
        ;;
esac
if [ "$GAME_HOST" = "${SUBDOMAIN}.${HOST}.${GAME_DOMAIN:-$DOMAIN}" ]; then
    DEPLOYMENT_NAME="${HOST}-${SUBDOMAIN}"
else
    DEPLOYMENT_NAME="$SUBDOMAIN"
fi
if [ -z "${SITE_HOST:-}" ]; then
    # Must stay ahead of the GAME_DOMAIN default: a manual dispatch of
    # blue/green passes no SITE_HOST and would otherwise leave the apex list.
    if [ "$SUBDOMAIN" = "blue" ] || [ "$SUBDOMAIN" = "green" ]; then
        SITE_HOST="$DOMAIN"
    elif [ -n "$GAME_DOMAIN" ]; then
        SITE_HOST="${SUBDOMAIN}.${DOMAIN}"
    fi
fi
echo "Identity: game host ${GAME_HOST}, site ${SITE_HOST:-<self>}"
# --- END identity (tested) ---

# Hand the resolved game host back to the workflow (deploy.yml, "Wait for
# deployment to start" polls it): a machine-scoped host cannot be recomputed
# there without repeating the lookup above. No-op outside GitHub Actions.
if [ -n "${GITHUB_ENV:-}" ]; then
    echo "GAME_HOST=${GAME_HOST}" >> "$GITHUB_ENV"
fi

# Resolve the machine name to its SSH target. Two sources, directory first:
#   1. SERVER_HOSTS_JSON — a machine directory, {"falk2":"1.2.3.4",...},
#      lowercase keys. Adding a machine to the fleet is one edit to that
#      secret; no workflow or script changes.
#   2. Legacy SERVER_HOST_<NAME> variables (SERVER_HOST_FALK2, ...), kept so
#      existing setups and .env files work unchanged.
print_header "DEPLOYING TO ${HOST} HOST"
SERVER_HOST=""
if [ -n "${SERVER_HOSTS_JSON:-}" ]; then
    # Validate the shape first: a malformed directory would otherwise die in
    # the lookup below with a bare jq error, taking down every deploy —
    # including machines the legacy variables still cover.
    if ! printf '%s' "$SERVER_HOSTS_JSON" | jq -e 'type == "object"' > /dev/null 2>&1; then
        echo "Error: SERVER_HOSTS_JSON must be a JSON object like {\"falk2\":\"1.2.3.4\"}"
        exit 1
    fi
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

# Trust the target's host key here, next to the resolution that picked it —
# the CI runner's known_hosts starts empty, and scanning only the resolved
# target means an unreachable machine fails its own leg, never anyone
# else's. Skipped when the key is already known (local runs).
mkdir -p ~/.ssh
# -f explicitly: without it ssh-keygen resolves ~ via the passwd database,
# which can disagree with $HOME (the file the keyscan below appends to).
if [ ! -f ~/.ssh/known_hosts ] || ! ssh-keygen -F "$SERVER_HOST" -f ~/.ssh/known_hosts > /dev/null 2>&1; then
    if ! ssh-keyscan -H "$SERVER_HOST" >> ~/.ssh/known_hosts; then
        echo "Error: ssh-keyscan could not reach ${HOST} (${SERVER_HOST})"
        exit 1
    fi
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
echo "Game host: ${GAME_HOST}"
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
# MACHINE is HOST under a name that cannot be misread: in cluster vocabulary a
# host is a game hostname (blue.openfront.io), while this is the box a
# container runs on (falk2, nbg2, staging). Check-in reports it so the registry
# can hold a site to one open server per machine (OPE-455). Kept free of
# quotes, backticks and dollar signs: this heredoc is written inside the
# double-quoted ssh command above, so the local shell reads these lines too.
MACHINE=$HOST
GHCR_IMAGE=$GHCR_IMAGE
GHCR_TOKEN=$GHCR_TOKEN
API_KEY=$API_KEY
ADMIN_BOT_API_KEY=$ADMIN_BOT_API_KEY
DOMAIN=$DOMAIN
SUBDOMAIN=$SUBDOMAIN
GAME_DOMAIN=$GAME_DOMAIN
# The game host deploy.sh settled on (see "identity" above) and the container
# name suffix that goes with it (machine-qualified for a machine-scoped host).
GAME_HOST=$GAME_HOST
DEPLOYMENT_NAME=$DEPLOYMENT_NAME
SITE_HOST=$SITE_HOST
CDN_BASE=$CDN_BASE
INSTANCE_LETTER=$INSTANCE_LETTER
NUM_WORKERS=$NUM_WORKERS
LOBBY_COORDINATOR=$LOBBY_COORDINATOR
TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY
STRIPE_PUBLISHABLE_KEY=$STRIPE_PUBLISHABLE_KEY
FARO_COLLECTOR_URL=$FARO_COLLECTOR_URL
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
