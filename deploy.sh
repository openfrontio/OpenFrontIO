#!/bin/bash
# deploy.sh - Complete deployment script for Hetzner with Docker Hub and R2
# This script:
# 1. Builds and uploads the Docker image to Docker Hub with appropriate tag
# 2. Copies the update script to Hetzner server
# 3. Executes the update script on the Hetzner server

set -e  # Exit immediately if a command exits with a non-zero status

# Check command line arguments
if [ $# -ne 2 ]; then
    echo "Error: Please specify both environment and region"
    echo "Usage: $0 [prod|staging] [eu|us|staging]"
    exit 1
fi

# Validate first argument (environment)
if [ "$1" != "prod" ] && [ "$1" != "staging" ]; then
    echo "Error: First argument must be either 'prod' or 'staging'"
    echo "Usage: $0 [prod|staging] [eu|us|staging]"
    exit 1
fi

# Validate second argument (region)
if [ "$2" != "eu" ] && [ "$2" != "us" ] && [ "$2" != "staging" ]; then
    echo "Error: Second argument must be either 'eu', 'us', or 'staging'"
    echo "Usage: $0 [prod|staging] [eu|us|staging]"
    exit 1
fi

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

ENV=$1
REGION=$2

VERSION_TAG="latest"
DOCKER_REPO=""
SSH_KEY=""
ADMIN_TOKEN=""
R2_ACCESS_KEY=""
R2_SECRET_KEY=""
R2_BUCKET=""

# Check if ENV and REGION are set
if [ -z "$ENV" ] || [ -z "$REGION" ]; then
    echo "Error: ENV or REGION not set"
    exit 1
fi

# Set environment-specific variables
if [ "$ENV" == "staging" ]; then
    print_header "DEPLOYING TO STAGING ENVIRONMENT"
    DOCKER_REPO=$DOCKER_REPO_STAGING
    SSH_KEY=$SSH_KEY_STAGING
    R2_ACCESS_KEY=$R2_ACCESS_KEY_STAGING
    R2_SECRET_KEY=$R2_SECRET_KEY_STAGING
    R2_BUCKET=$R2_BUCKET_STAGING
    ADMIN_TOKEN=$ADMIN_TOKEN_STAGING
elif [ "$ENV" == "prod" ]; then
    print_header "DEPLOYING TO US ENVIRONMENT"
    DOCKER_REPO=$DOCKER_REPO_PROD
    SSH_KEY=$SSH_KEY_PROD
    R2_ACCESS_KEY=$R2_ACCESS_KEY_PROD
    R2_SECRET_KEY=$R2_SECRET_KEY_PROD
    R2_BUCKET=$R2_BUCKET_PROD
    ADMIN_TOKEN=$ADMIN_TOKEN_PROD
else
    echo "Error: Invalid environment specified: $ENV"
    exit 1
fi

if [ "$REGION" == "staging" ]; then
    print_header "DEPLOYING TO STAGING ENVIRONMENT"
    SERVER_HOST=$SERVER_HOST_STAGING
elif [ "$REGION" == "us" ]; then
    print_header "DEPLOYING TO US ENVIRONMENT"
    SERVER_HOST=$SERVER_HOST_US
else
    print_header "DEPLOYING TO EU ENVIRONMENT"
    SERVER_HOST=$SERVER_HOST_EU
fi

# Check required environment variables
if [ -z "$SERVER_HOST" ]; then
    echo "Error: SERVER_HOST_${REGION^^} not defined in .env file or environment"
    exit 1
fi


# Configuration
UPDATE_SCRIPT="./update.sh"                    # Path to your update script
REMOTE_USER="openfront"                        
REMOTE_UPDATE_PATH="/home/$REMOTE_USER"        
REMOTE_UPDATE_SCRIPT="$REMOTE_UPDATE_PATH/update-openfront.sh"  # Where to place the script on server

IMAGE_NAME="${DOCKER_USERNAME}/${DOCKER_REPO}"
FULL_IMAGE_NAME="${IMAGE_NAME}:latest"

# Check if update script exists
if [ ! -f "$UPDATE_SCRIPT" ]; then
    echo "Error: Update script $UPDATE_SCRIPT not found!"
    exit 1
fi

# Step 1: Build and upload Docker image to Docker Hub
print_header "STEP 1: Building and uploading Docker image to Docker Hub"
echo "Region: ${REGION}"
echo "Using version tag: $VERSION_TAG"
echo "Docker repository: $DOCKER_REPO"

# Get Git commit for build info
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "Git commit: $GIT_COMMIT"

docker buildx build \
  --platform linux/amd64 \
  --build-arg GIT_COMMIT=$GIT_COMMIT \
  -t $DOCKER_USERNAME/$DOCKER_REPO:$VERSION_TAG \
  --push \
  .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed. Stopping deployment."
    exit 1
fi

echo "✅ Docker image built and pushed successfully."

# Step 2: Copy update script to Hetzner server
print_header "STEP 2: Copying update script to server"
echo "Target: $REMOTE_USER@$SERVER_HOST"

# Make sure the update script is executable
chmod +x $UPDATE_SCRIPT

# Copy the update script to the server
scp -i $SSH_KEY $UPDATE_SCRIPT $REMOTE_USER@$SERVER_HOST:$REMOTE_UPDATE_SCRIPT

if [ $? -ne 0 ]; then
    echo "❌ Failed to copy update script to server. Stopping deployment."
    exit 1
fi

ssh -i $SSH_KEY $REMOTE_USER@$SERVER_HOST "chmod +x $REMOTE_UPDATE_SCRIPT && \
cat > $REMOTE_UPDATE_PATH/.env << 'EOL'
GAME_ENV=$ENV
REGION=$REGION
ADMIN_TOKEN=$ADMIN_TOKEN
R2_ACCOUNT_ID=$R2_ACCOUNT_ID
R2_ACCESS_KEY=$R2_ACCESS_KEY
R2_SECRET_KEY=$R2_SECRET_KEY
R2_BUCKET=$R2_BUCKET
EOL
chmod 600 $REMOTE_UPDATE_PATH/.env && \
$REMOTE_UPDATE_SCRIPT $ENV $REGION $FULL_IMAGE_NAME $DOCKER_TOKEN"

if [ $? -ne 0 ]; then
    echo "❌ Failed to execute update script on server."
    exit 1
fi

print_header "DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "✅ New version deployed to ${REGION} environment!"
echo "🌐 Check your ${REGION} server to verify the deployment."
echo "======================================================="