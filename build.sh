#!/bin/bash
# build.sh - Build and upload Docker image to Docker Hub
# This script:
# 1. Builds and uploads the Docker image to Docker Hub with appropriate tag

set -e # Exit immediately if a command exits with a non-zero status

# Check command line arguments
if [ $# -ne 2 ]; then
    echo "Error: Please specify environment and version tag"
    echo "Usage: $0 [prod|staging] [version_tag]"
    exit 1
fi

# Validate first argument (environment)
if [ "$1" != "prod" ] && [ "$1" != "staging" ]; then
    echo "Error: First argument must be either 'prod' or 'staging'"
    echo "Usage: $0 [prod|staging] [version_tag]"
    exit 1
fi

ENV=$1
VERSION_TAG=$2

print_header() {
    echo "======================================================"
    echo "🚀 ${1}"
    echo "======================================================"
}

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

# Check required environment variables for build
if [ -z "$DOCKER_USERNAME" ] || [ -z "$DOCKER_REPO" ]; then
    echo "Error: DOCKER_USERNAME or DOCKER_REPO not defined in .env file or environment"
    exit 1
fi

DOCKER_IMAGE="${DOCKER_USERNAME}/${DOCKER_REPO}:${VERSION_TAG}"

# Build and upload Docker image to Docker Hub
echo "Environment: ${ENV}"
echo "Using version tag: $VERSION_TAG"
echo "Docker repository: $DOCKER_REPO"

# Get Git commit for build info
GIT_COMMIT=$(git rev-parse HEAD 2> /dev/null || echo "unknown")
echo "Git commit: $GIT_COMMIT"

docker buildx build \
    --platform linux/amd64 \
    --build-arg GIT_COMMIT=$GIT_COMMIT \
    -t $DOCKER_IMAGE \
    --push \
    .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed."
    exit 1
fi

echo "✅ Docker image built and pushed successfully."
echo "Image: $DOCKER_IMAGE"

print_header "BUILD COMPLETED SUCCESSFULLY ${DOCKER_IMAGE}"
