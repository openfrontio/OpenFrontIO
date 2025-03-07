#!/bin/bash
# Script to update Docker container

# Check if environment parameter is provided
if [ -z "$1" ]; then
  echo "Error: Environment parameter is required (prod or staging)"
  echo "Usage: $0 <environment>"
  exit 1
fi

# Set environment from parameter
ENV=$1
CONTAINER_NAME="openfront-${ENV}"
LOG_GROUP="/aws/ec2/docker-containers/${ENV}"

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.eu-west-1.amazonaws.com/openfront:latest"

echo "Deploying to ${ENV} environment..."
echo "Logging in to ECR..."
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.eu-west-1.amazonaws.com

echo "Pulling latest image..."
docker pull $ECR_REPO

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

echo "Starting new container for ${ENV} environment..."
docker run -d -p 80:80 \
  --restart=always \
  --log-driver=awslogs \
  --log-opt awslogs-region=eu-west-1 \
  --log-opt awslogs-group=${LOG_GROUP} \
  --log-opt awslogs-create-group=true \
  --env GAME_ENV=${ENV} \
  --env-file /home/ec2-user/.env \
  --name ${CONTAINER_NAME} \
  $ECR_REPO

if [ $? -eq 0 ]; then
  echo "Update complete! New ${ENV} container is running."
    # Final cleanup after successful deployment
  echo "Performing final cleanup of unused Docker resources..."
  echo "Removing unused images (not tagged and not referenced)..."
  docker image prune -f
  docker container prune -f
  echo "Cleanup complete."
else
  echo "Failed to start container"
fi