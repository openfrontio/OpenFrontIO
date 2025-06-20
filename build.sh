#!/bin/bash
# build.sh - Build and upload Docker image to Docker Hub
# This script:
# 1. Builds and uploads the Docker image to Docker Hub with appropriate tag
# 2. Optionally saves container metadata to a file (if METADATA_FILE env var is set)

set -e # Exit immediately if a command exits with a non-zero status

# Parse command line arguments
ENV="$1"
VERSION_TAG="$2"

# Check required arguments
if [ -z "$ENV" ] || [ -z "$VERSION_TAG" ]; then
    echo "Error: Please specify environment and version tag"
    echo "Usage: $0 [prod|staging] [version_tag]"
    echo "Note: Set METADATA_FILE environment variable to save container metadata to a file"
    exit 1
fi

# Validate environment argument
if [ "$ENV" != "prod" ] && [ "$ENV" != "staging" ]; then
    echo "Error: First argument must be either 'prod' or 'staging'"
    echo "Usage: $0 [prod|staging] [version_tag]"
    echo "Note: Set METADATA_FILE environment variable to save container metadata to a file"
    exit 1
fi

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
    --build-arg METADATA_FILE=$METADATA_FILE \
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

# Save container metadata to file if METADATA_FILE environment variable is set
if [ -n "$METADATA_FILE" ]; then
    echo "Saving container metadata to $METADATA_FILE"
    docker inspect $DOCKER_IMAGE > $METADATA_FILE
    if [ $? -ne 0 ]; then
        echo "❌ Failed to save container metadata to $METADATA_FILE"
        exit 1
    fi
    echo "✅ Container metadata saved successfully to $METADATA_FILE"
fi
