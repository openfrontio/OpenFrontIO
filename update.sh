#!/bin/bash
# update.sh - Script to update Docker container on Hetzner server
# Called by deploy.sh after uploading Docker image to Docker Hub

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

# Remove any existing volume for this container if it exists
docker volume rm "cloudflared-${CONTAINER_NAME}" 2> /dev/null || true

docker run -d \
    --restart="${RESTART}" \
    --env-file "$ENV_FILE" \
    --name "${CONTAINER_NAME}" \
    -v "cloudflared-${CONTAINER_NAME}:/etc/cloudflared" \
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
