#!/bin/bash
# update.sh - Script to update Docker container on Hetzner server
# Called by deploy.sh after uploading Docker image to Docker Hub

# Check if environment parameter is provided
if [ $# -lt 3 ]; then
  echo "Error: Required parameters missing"
  echo "Usage: $0 <REGION> <docker_username> <docker_repo>"
  exit 1
fi

# Set parameters
REGION=$1
DOCKER_USERNAME=$2
DOCKER_REPO=$3

# Container and image configuration
CONTAINER_NAME="openfront-${REGION}"
IMAGE_NAME="${DOCKER_USERNAME}/${DOCKER_REPO}"
FULL_IMAGE_NAME="${IMAGE_NAME}:latest"

echo "======================================================"
echo "🔄 UPDATING SERVER: ${REGION} ENVIRONMENT"
echo "======================================================"
echo "Container name: ${CONTAINER_NAME}"
echo "Docker image: ${FULL_IMAGE_NAME}"

# Load environment variables if .env exists
if [ -f /root/.env ]; then
  echo "Loading environment variables from .env file..."
  export $(grep -v '^#' /root/.env | xargs)
fi

echo "Pulling latest image from Docker Hub..."
docker pull $FULL_IMAGE_NAME

echo "Checking for existing container..."
# Check for running container
RUNNING_CONTAINER=$(docker ps | grep ${CONTAINER_NAME} | awk '{print $1}')
if [ -n "$RUNNING_CONTAINER" ]; then
  echo "Stopping running container $RUNNING_CONTAINER..."
  docker stop $RUNNING_CONTAINER
  echo "Waiting for container to fully stop and release resources..."
  sleep 5  # Add a 5-second delay
  docker rm $RUNNING_CONTAINER
  echo "Container $RUNNING_CONTAINER stopped and removed."
fi

# Also check for stopped containers with the same name
STOPPED_CONTAINER=$(docker ps -a | grep ${CONTAINER_NAME} | awk '{print $1}')
if [ -n "$STOPPED_CONTAINER" ]; then
  echo "Removing stopped container $STOPPED_CONTAINER..."
  docker rm $STOPPED_CONTAINER
  echo "Container $STOPPED_CONTAINER removed."
fi

# Check if port 80 is still in use
echo "Checking if port 80 is still in use..."
if command -v lsof >/dev/null 2>&1; then
  PORT_CHECK=$(lsof -i :80 | grep LISTEN)
elif command -v netstat >/dev/null 2>&1; then
  PORT_CHECK=$(netstat -tuln | grep ":80 ")
else
  PORT_CHECK=""
  echo "Warning: Cannot check if port is in use (neither lsof nor netstat found)"
fi

if [ -n "$PORT_CHECK" ]; then
  echo "Warning: Port 80 is still in use by another process:"
  echo "$PORT_CHECK"
  echo "Attempting to proceed anyway..."
fi

ENV="prod"
if [ "$REGION" == "staging" ]; then
  ENV="staging"
fi

echo "Starting new container for ${REGION} environment..."
docker run -d -p 80:80 -p 127.0.0.1:9090:9090 \
  --restart=always \
  $VOLUME_MOUNTS \
  --log-driver json-file \
  --log-opt tag="{{.Name}}" \
  --log-opt labels="log_level" \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  --env GAME_ENV=${ENV} \
  --env-file /root/.env \
  --name ${CONTAINER_NAME} \
  $FULL_IMAGE_NAME

if [ $? -eq 0 ]; then
  echo "Update complete! New ${REGION} container is running."
  
  # Final cleanup after successful deployment
  echo "Performing final cleanup of unused Docker resources..."
  echo "Removing unused images (not tagged and not referenced)..."
  docker image prune -f
  docker container prune -f
  echo "Cleanup complete."
else
  echo "Failed to start container"
  exit 1
fi

echo "======================================================"
echo "✅ SERVER UPDATE COMPLETED SUCCESSFULLY"
echo "Container name: ${CONTAINER_NAME}"
echo "Image: ${FULL_IMAGE_NAME}"
echo "======================================================"