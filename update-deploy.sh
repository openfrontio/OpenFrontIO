#!/bin/bash
# deploy.sh - Complete deployment script for staging and production environments
# This script:
# 1. Builds and uploads the Docker image to ECR with appropriate tag
# 2. Copies the update script to EC2 instance (staging or prod)
# 3. Executes the update script on the EC2 instance
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
if [ $# -ne 1 ] || ([ "$1" != "staging" ] && [ "$1" != "prod" ]); then
    echo "Error: Please specify environment (staging or prod)"
    echo "Usage: $0 [staging|prod]"
    exit 1
fi

ENV=$1
VERSION_TAG=""

# Set environment-specific variables
if [ "$ENV" == "staging" ]; then
    print_header "DEPLOYING TO STAGING ENVIRONMENT"
    EC2_HOST=$EC2_HOST_STAGING
    VERSION_TAG="staging"
else
    print_header "DEPLOYING TO PRODUCTION ENVIRONMENT"
    EC2_HOST=$EC2_HOST_PROD
    VERSION_TAG="latest"
fi

# Check required environment variables
if [ -z "$EC2_HOST" ]; then
    echo "Error: EC2_HOST_${ENV^^} not defined in .env file or environment"
    exit 1
fi

# Configuration
EC2_KEY=${EC2_KEY:-"~/.ssh/id_rsa"}      # Use default or override from .env
BUILD_SCRIPT="./upload.sh"     # Path to your build script
UPDATE_SCRIPT="./update.sh"    # Path to your update script
REMOTE_UPDATE_SCRIPT="/home/ec2-user/update-openfront.sh"  # Where to place the script on EC2

# Check if required scripts exist
if [ ! -f "$BUILD_SCRIPT" ]; then
    echo "Error: Build script $BUILD_SCRIPT not found!"
    exit 1
fi

if [ ! -f "$UPDATE_SCRIPT" ]; then
    echo "Error: Update script $UPDATE_SCRIPT not found!"
    exit 1
fi

# Step 1: Build and upload Docker image to ECR
print_header "STEP 1: Building and uploading Docker image to ECR"
echo "Environment: ${ENV}"
echo "Using version tag: $VERSION_TAG"

# Execute the build script with the version tag
$BUILD_SCRIPT $VERSION_TAG
if [ $? -ne 0 ]; then
    echo "❌ Build and upload failed. Stopping deployment."
    exit 1
fi

# Step 2: Copy update script to EC2 instance
print_header "STEP 2: Copying update script to EC2 instance"
echo "Target: $EC2_HOST"

# Make sure the update script is executable
chmod +x $UPDATE_SCRIPT

# Copy the update script to the EC2 instance
scp -i $EC2_KEY $UPDATE_SCRIPT $EC2_HOST:$REMOTE_UPDATE_SCRIPT
scp -i $EC2_KEY .env $EC2_HOST:/home/ec2-user/.env
# After copying the .env file, secure it
ssh -i $EC2_KEY $EC2_HOST "chmod 600 /home/ec2-user/.env"

if [ $? -ne 0 ]; then
    echo "❌ Failed to copy update script to EC2 instance. Stopping deployment."
    exit 1
fi
echo "✅ Update script successfully copied to EC2 instance."

# Step 3: Execute the update script on the EC2 instance
print_header "STEP 3: Executing update script on EC2 instance"

# Make the script executable on the remote server and execute it with the environment parameter
ssh -i $EC2_KEY $EC2_HOST "chmod +x $REMOTE_UPDATE_SCRIPT && $REMOTE_UPDATE_SCRIPT $ENV"
if [ $? -ne 0 ]; then
    echo "❌ Failed to execute update script on EC2 instance."
    exit 1
fi

print_header "DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "✅ New version deployed to ${ENV} environment!"
echo "🌐 Check your ${ENV} server to verify the deployment."
echo "======================================================"