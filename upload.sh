#!/bin/bash

# Script to build and upload OpenFront Docker image to ECR
# Usage: ./upload-openfront.sh [version_tag]

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    echo "Loading configuration from .env file..."
    export $(grep -v '^#' .env | xargs)
fi

# Configuration with fallbacks
AWS_REGION=${AWS_REGION:-"eu-west-1"}
ECR_REPO_NAME=${ECR_REPO_NAME:-"openfront"}
AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}
ECR_REPO_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME"

# Default version tag is 'latest' if not provided
VERSION_TAG=${1:-"latest"}

echo "===== OpenFront Docker Image Upload Script ====="
echo "Repository: $ECR_REPO_URI"
echo "Version tag: $VERSION_TAG"
echo "================================================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install AWS CLI first."
    exit 1
fi

# Check if we're in the correct directory
if [ ! -f "Dockerfile" ]; then
    echo "Error: Dockerfile not found in current directory."
    echo "Please run this script from the directory containing your Dockerfile."
    exit 1
fi

# Ensure the ECR repository exists
echo "Ensuring ECR repository exists..."
aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $AWS_REGION &> /dev/null
if [ $? -ne 0 ]; then
    echo "Creating ECR repository $ECR_REPO_NAME..."
    aws ecr create-repository --repository-name $ECR_REPO_NAME --region $AWS_REGION
    if [ $? -ne 0 ]; then
        echo "Error: Failed to create ECR repository."
        exit 1
    fi
fi

GIT_COMMIT=$(git rev-parse HEAD)
echo "Git commit: $GIT_COMMIT"

# Build the Docker image
echo "Building Docker image..."
docker buildx build \
  --platform linux/amd64 \
  --build-arg GIT_COMMIT=$GIT_COMMIT \
  -t $ECR_REPO_NAME:$VERSION_TAG \
  .


# Authenticate to ECR
echo "Authenticating to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO_URI
if [ $? -ne 0 ]; then
    echo "Error: Failed to authenticate to ECR."
    exit 1
fi

# Tag the image for ECR
echo "Tagging image for ECR..."
docker tag $ECR_REPO_NAME:$VERSION_TAG $ECR_REPO_URI:$VERSION_TAG
if [ $? -ne 0 ]; then
    echo "Error: Failed to tag image."
    exit 1
fi

# Push the image to ECR
echo "Pushing image to ECR..."
docker push $ECR_REPO_URI:$VERSION_TAG
if [ $? -ne 0 ]; then
    echo "Error: Failed to push image to ECR."
    exit 1
fi

# Also tag and push as 'latest' if we're using a specific version
if [ "$VERSION_TAG" != "latest" ]; then
    echo "Also tagging as 'latest'..."
    docker tag $ECR_REPO_NAME:$VERSION_TAG $ECR_REPO_URI:latest
    docker push $ECR_REPO_URI:latest
fi

echo "Verifying upload..."
aws ecr describe-images --repository-name $ECR_REPO_NAME --region $AWS_REGION --query "imageDetails[?contains(imageTags, '$VERSION_TAG')]"

echo "================================================"
echo "✅ Success! Image uploaded to $ECR_REPO_URI:$VERSION_TAG"
echo "================================================"

# Print helpful deployment instructions
echo "To deploy this image to your EC2 instance, SSH into your instance and run:"
echo "docker pull $ECR_REPO_URI:$VERSION_TAG"
echo "docker stop \$(docker ps -q --filter ancestor=$ECR_REPO_URI)"
echo "docker run -d -p 80:80 $ECR_REPO_URI:$VERSION_TAG"