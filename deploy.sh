#!/bin/bash
# deploy.sh - Complete deployment script for Hetzner with Docker Hub and R2
# This script:
# 1. Builds and uploads the Docker image to Docker Hub with appropriate tag
# 2. Copies the update script to Hetzner server
# 3. Executes the update script on the Hetzner server

set -e  # Exit immediately if a command exits with a non-zero status

# Function to print section headers
print_header() {
    echo "======================================================"
    echo "🚀 $1"
    echo "======================================================"
}

# Load environment variables
if [ -f .env ]; then
    echo "Loading configuration from .env file..."
    export $(grep -v '^#' .env | xargs)
fi

# Check command line argument
if [ $# -ne 1 ] || ([ "$1" != "staging" ] && [ "$1" != "prod" ] && [ "$1" != "alt" ]); then
    echo "Error: Please specify environment (staging, prod, or alt)"
    echo "Usage: $0 [staging|prod|alt]"
    exit 1
fi

# TODO: fix this - need to build before creating the image
bun run build-prod

ENV=$1
VERSION_TAG="latest"
DOCKER_REPO=""

# Set environment-specific variables
if [ "$ENV" == "staging" ]; then
    print_header "DEPLOYING TO STAGING ENVIRONMENT"
    SERVER_HOST=$SERVER_HOST_STAGING
    DOCKER_REPO=$DOCKER_REPO_STAGING
elif [ "$ENV" == "alt" ]; then
    print_header "DEPLOYING TO ALT ENVIRONMENT"
    SERVER_HOST=$SERVER_HOST_ALT
    DOCKER_REPO=$DOCKER_REPO_PROD  # Uses prod Docker repo for alt environment
    ENV="prod"
else
    print_header "DEPLOYING TO PRODUCTION ENVIRONMENT"
    SERVER_HOST=$SERVER_HOST_PROD
    DOCKER_REPO=$DOCKER_REPO_PROD
fi

# Check required environment variables
if [ -z "$SERVER_HOST" ]; then
    echo "Error: SERVER_HOST_${ENV^^} not defined in .env file or environment"
    exit 1
fi

# Configuration
SSH_KEY=${SSH_KEY:-"~/.ssh/id_rsa"}      # Use default or override from .env
DOCKER_USERNAME=${DOCKER_USERNAME} # Docker Hub username
UPDATE_SCRIPT="./update.sh"                    # Path to your update script
REMOTE_UPDATE_SCRIPT="/root/update-openfront.sh"  # Where to place the script on server

# Check if update script exists
if [ ! -f "$UPDATE_SCRIPT" ]; then
    echo "Error: Update script $UPDATE_SCRIPT not found!"
    exit 1
fi

# Step 1: Build and upload Docker image to Docker Hub
print_header "STEP 1: Building and uploading Docker image to Docker Hub"
echo "Environment: ${ENV}"
echo "Using version tag: $VERSION_TAG"
echo "Docker repository: $DOCKER_REPO"

# Get Git commit for build info
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "Git commit: $GIT_COMMIT"

docker buildx build \
  --no-cache \
  --platform linux/amd64 \
  --build-arg GIT_COMMIT=$GIT_COMMIT \
  -t $DOCKER_USERNAME/$DOCKER_REPO:$VERSION_TAG \
  --push \
  .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed. Stopping deployment."
    exit 1
fi

if [ $? -ne 0 ]; then
    echo "❌ Failed to push image to Docker Hub. Stopping deployment."
    exit 1
fi

echo "✅ Docker image built and pushed successfully."

# Step 2: Copy update script to Hetzner server
print_header "STEP 2: Copying update script to server"
echo "Target: $SERVER_HOST"

# Make sure the update script is executable
chmod +x $UPDATE_SCRIPT

# Copy the update script to the server
scp -i $SSH_KEY $UPDATE_SCRIPT $SERVER_HOST:$REMOTE_UPDATE_SCRIPT

# Copy environment variables if needed
if [ -f .env ]; then
    scp -i $SSH_KEY .env $SERVER_HOST:/root/.env
    # Secure the .env file
    ssh -i $SSH_KEY $SERVER_HOST "chmod 600 /root/.env"
fi

if [ $? -ne 0 ]; then
    echo "❌ Failed to copy update script to server. Stopping deployment."
    exit 1
fi

echo "✅ Update script successfully copied to server."

# Step 3: Execute the update script on the server
print_header "STEP 3: Executing update script on server"

# Make the script executable on the remote server and execute it with the environment parameter
ssh -i $SSH_KEY $SERVER_HOST "chmod +x $REMOTE_UPDATE_SCRIPT && $REMOTE_UPDATE_SCRIPT $ENV $DOCKER_USERNAME $DOCKER_REPO"

if [ $? -ne 0 ]; then
    echo "❌ Failed to execute update script on server."
    exit 1
fi

print_header "DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "✅ New version deployed to ${ENV} environment!"
echo "🌐 Check your ${ENV} server to verify the deployment."
echo "======================================================="