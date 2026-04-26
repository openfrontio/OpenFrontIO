#!/bin/bash
# update.sh - Script to update Docker container on Hetzner server
# Called by deploy.sh after uploading Docker image to Docker Hub
set -eo pipefail

# Check if environment file is provided
if [ $# -ne 1 ]; then
    echo "Error: Environment file path is required"
    echo "Usage: $0 <env_file_path>"
    exit 1
fi

ENV_FILE="$1"

# Check if environment file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Environment file '$ENV_FILE' not found"
    exit 1
fi

# Load environment variables from the provided file
echo "Loading environment variables from $ENV_FILE..."
export $(grep -v '^#' "$ENV_FILE" | xargs)

echo "======================================================"
echo "🔄 UPDATING SERVER: ${HOST} ENVIRONMENT"
echo "======================================================"

# Container and image configuration
CONTAINER_NAME="openfront-${ENV}-${SUBDOMAIN}"

echo "Pulling ${GHCR_IMAGE} from GitHub Container Registry..."
docker pull "${GHCR_IMAGE}"

# Upload hashed assets to R2 before swapping containers. If this fails the old
# container keeps serving — better than a stop-then-fail outage.
echo "======================================================"
echo "📦 Uploading assets to R2 for ${DOMAIN}..."
echo "======================================================"

if [ -z "$DOMAIN" ] || [ -z "$API_KEY" ]; then
    echo "❌ DOMAIN or API_KEY not set; cannot upload assets."
    exit 1
fi
for cmd in jq curl xargs; do
    if ! command -v "$cmd" > /dev/null 2>&1; then
        echo "❌ Required tool '$cmd' not found. Install via setup.sh."
        exit 1
    fi
done

EXTRACT_DIR="$(mktemp -d -t openfront-assets-XXXXXX)"
trap 'rm -rf "$EXTRACT_DIR"' EXIT

TMP_CONTAINER="$(docker create "${GHCR_IMAGE}")"
if ! docker cp "${TMP_CONTAINER}:/usr/src/app/static" "$EXTRACT_DIR/"; then
    echo "❌ docker cp failed"
    docker rm "${TMP_CONTAINER}" > /dev/null 2>&1 || true
    exit 1
fi
docker rm "${TMP_CONTAINER}" > /dev/null

STATIC_DIR="$EXTRACT_DIR/static"
echo "Extracted to $STATIC_DIR; top-level contents:"
ls -la "$STATIC_DIR/" || true

R2_ENDPOINT="https://api.${DOMAIN}"
MANIFEST="$STATIC_DIR/asset-manifest.json"
if [ ! -f "$MANIFEST" ]; then
    echo "❌ Manifest not found at $MANIFEST"
    exit 1
fi

# Manifest values are like "/_assets/foo/bar.<hash>.png"; strip the leading "/".
KEYS_JSON="$(jq '[.[] | sub("^/"; "")]' "$MANIFEST")"
TOTAL="$(echo "$KEYS_JSON" | jq 'length')"
echo "Checking $TOTAL asset keys against $R2_ENDPOINT..."

CHECK_BODY="$(mktemp)"
HTTP_CODE="$(curl -sS --connect-timeout 10 --max-time 120 \
    -o "$CHECK_BODY" -w "%{http_code}" -X POST "$R2_ENDPOINT/game_assets/check" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"keys\": $KEYS_JSON}")"
if [ "$HTTP_CODE" != "200" ]; then
    echo "❌ /check returned HTTP $HTTP_CODE:"
    cat "$CHECK_BODY"
    rm -f "$CHECK_BODY"
    exit 1
fi
if ! jq -e '.missing | type == "array"' "$CHECK_BODY" > /dev/null; then
    echo "❌ /check response missing '.missing' array:"
    cat "$CHECK_BODY"
    rm -f "$CHECK_BODY"
    exit 1
fi
MISSING="$(jq -r '.missing[]' "$CHECK_BODY")"
rm -f "$CHECK_BODY"

if [ -z "$MISSING" ]; then
    echo "✅ All $TOTAL assets already in R2; nothing to upload."
else
    MISSING_COUNT="$(echo "$MISSING" | wc -l | tr -d ' ')"
    echo "Uploading $MISSING_COUNT missing asset(s)..."
    export R2_ENDPOINT API_KEY STATIC_DIR
    # KEY from the manifest is URL-encoded per segment (e.g. flags/C%C3%B4te.png).
    # Files on disk live at the *decoded* path, so decode KEY before reading the
    # file, then encode the whole decoded path as one URL segment for the POST.
    if ! echo "$MISSING" | xargs -P 16 -I{} bash -euc '
        KEY="$1"
        # Validate KEY: only chars that encodeURIComponent leaves literal
        # (A-Z a-z 0-9 - _ . ! ~ * ( ) plus apostrophe), "/" between segments,
        # and well-formed %HH escapes. The %HH check makes the printf-based
        # decoder below safe by rejecting partial escapes; excluding "\" keeps
        # printf "%b" from interpreting unexpected backslash sequences. The
        # regex lives in a variable so the literal apostrophe sits inside a
        # double-quoted assignment instead of being parsed as a shell quote.
        RE="^([A-Za-z0-9._/~!*'\''()-]|%[0-9A-Fa-f]{2})+\$"
        [[ "$KEY" =~ $RE ]] || {
            echo "❌ invalid key from server: $KEY" >&2; exit 1
        }
        DECODED="$(printf "%b" "${KEY//%/\\x}")"
        # Defense-in-depth: refuse any decoded path that escapes the asset tree,
        # in case the trusted /check endpoint is ever compromised.
        case "$DECODED" in
            /* | *..* ) echo "❌ refusing unsafe path: $DECODED" >&2; exit 1 ;;
        esac
        ENC="$(jq -rn --arg k "$DECODED" "\$k|@uri")"
        if ! curl -fsS \
            --retry 5 --retry-all-errors --retry-delay 2 \
            --connect-timeout 10 --max-time 120 \
            -X PUT \
            "$R2_ENDPOINT/game_assets/upload/$ENC" \
            -H "X-API-Key: $API_KEY" \
            -H "Content-Type: application/octet-stream" \
            --data-binary "@$STATIC_DIR/$DECODED" > /dev/null; then
            echo "❌ Failed to upload: $DECODED" >&2
            exit 1
        fi
    ' _ {}; then
        echo "❌ One or more asset uploads failed."
        exit 1
    fi
    echo "✅ Uploaded $MISSING_COUNT asset(s) to R2."
fi

echo "Checking for existing container..."
# Use docker ps with filter for exact name match
RUNNING_CONTAINER="$(docker ps --filter "name=^${CONTAINER_NAME}$" -q)"
if [ -n "$RUNNING_CONTAINER" ]; then
    echo "Stopping running container $RUNNING_CONTAINER..."
    docker stop "$RUNNING_CONTAINER"
    echo "Waiting for container to fully stop and release resources..."
    sleep 5 # Add a 5-second delay
    docker rm "$RUNNING_CONTAINER"
    echo "Container $RUNNING_CONTAINER stopped and removed."
fi

# Also check for stopped containers with the same name
STOPPED_CONTAINER="$(docker ps -a --filter "name=^${CONTAINER_NAME}$" -q)"
if [ -n "$STOPPED_CONTAINER" ]; then
    echo "Removing stopped container $STOPPED_CONTAINER..."
    docker rm "$STOPPED_CONTAINER"
    echo "Container $STOPPED_CONTAINER removed."
fi

if [ "${SUBDOMAIN}" = main ] || [ "${DOMAIN}" = openfront.io ]; then
    RESTART=always
else
    RESTART=no
fi

echo "Starting new container for ${HOST} environment..."

# Ensure the traefik network exists
docker network create web 2> /dev/null || true

docker run -d \
    --restart="${RESTART}" \
    --env-file "$ENV_FILE" \
    --name "${CONTAINER_NAME}" \
    --network web \
    --label "traefik.enable=true" \
    --label "traefik.http.routers.${CONTAINER_NAME}.rule=Host(\`${SUBDOMAIN}.${DOMAIN}\`)" \
    --label "traefik.http.routers.${CONTAINER_NAME}.entrypoints=websecure" \
    --label "traefik.http.routers.${CONTAINER_NAME}.tls=true" \
    --label "traefik.http.services.${CONTAINER_NAME}.loadbalancer.server.port=80" \
    "${GHCR_IMAGE}"

if [ $? -eq 0 ]; then
    echo "Update complete! New ${CONTAINER_NAME} container is running."

    # Final cleanup after successful deployment
    echo "Performing final cleanup of unused Docker resources..."
    echo "Removing unused images (not referenced)..."
    docker image prune -a -f
    docker container prune -f
    echo "Cleanup complete."

    # Remove the environment file
    echo "Removing environment file ${ENV_FILE}..."
    rm -f "$ENV_FILE"
    echo "Environment file removed."
else
    echo "Failed to start container"
    exit 1
fi

echo "======================================================"
echo "✅ SERVER UPDATE COMPLETED SUCCESSFULLY"
echo "Container name: ${CONTAINER_NAME}"
echo "Image: ${FULL_IMAGE_NAME}"
echo "======================================================"
