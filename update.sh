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
if [ -f /home/openfront/.env ]; then
  echo "Loading environment variables from .env file..."
  export $(grep -v '^#' /home/openfront/.env | xargs)
fi

docker login -u $DOCKER_USERNAME -p $DOCKER_TOKEN

# Install Loki Docker plugin if not already installed
if ! docker plugin ls | grep -q "loki"; then
  echo "Installing Loki Docker plugin..."
  docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions
  if [ $? -ne 0 ]; then
    echo "Failed to install Loki Docker plugin. Continuing anyway..."
  else
    echo "Loki Docker plugin installed successfully."
  fi
else
  echo "Loki Docker plugin already installed."
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
  --log-driver=loki \
  --log-opt loki-url="http://localhost:3100/loki/api/v1/push" \
  --log-opt loki-batch-size="400" \
  --log-opt loki-external-labels="job=docker,environment=${ENV},host=${REGION},region=${REGION}" \
  --env GAME_ENV=${ENV} \
  --env REGION=${REGION} \
  --env-file /home/openfront/.env \
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
echo "Logs: Configured to send to Loki on port 3100"
echo "======================================================"