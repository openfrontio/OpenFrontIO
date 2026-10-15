#!/bin/bash
# build.sh - Build and upload image to GitHub Container Registry
# This script:
# 1. Builds and uploads the image to GitHub Container Registry with appropriate tag
# 2. Optionally saves container metadata to a file (if METADATA_FILE is provided as 3rd argument)

set -e # Exit immediately if a command exits with a non-zero status

# Parse command line arguments
DEPLOY_ENV="$1"
VERSION_TAG="$2"
VERSION_TXT="$3"
CHANGELOG_MD="$4"
METADATA_FILE="$5"

# Set default metadata file if not provided
if [ -z "$METADATA_FILE" ]; then
    METADATA_FILE="/tmp/build-metadata-$RANDOM.json"
fi

# Check required arguments
if [ -z "$DEPLOY_ENV" ] || [ -z "$VERSION_TAG" ]; then
    echo "Error: Please specify environment and version tag"
    echo "Usage: $0 [prod|staging] [version_tag] [metadata_file]"
    echo "Note: Provide metadata_file as third argument to save container metadata to a file"
    exit 1
fi

# Validate environment argument
if [ "$DEPLOY_ENV" != "prod" ] && [ "$DEPLOY_ENV" != "staging" ]; then
    echo "Error: First argument must be either 'prod' or 'staging'"
    echo "Usage: $0 [prod|staging] [version_tag] [metadata_file]"
    echo "Note: Provide metadata_file as third argument to save container metadata to a file"
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
    set -o allexport
    source .env
    set +o allexport
fi

# Load environment-specific variables
if [ -f .env.$DEPLOY_ENV ]; then
    echo "Loading $DEPLOY_ENV-specific configuration from .env.$DEPLOY_ENV file..."
    set -o allexport
    source .env.$DEPLOY_ENV
    set +o allexport
fi

# Check required environment variables for build
if [ -z "$GHCR_USERNAME" ] || [ -z "$GHCR_REPO" ]; then
    echo "Error: GHCR_USERNAME or GHCR_REPO not defined in .env file or environment"
    exit 1
fi

GHCR_IMAGE="${GHCR_USERNAME}/${GHCR_REPO}:${VERSION_TAG}"

# If ADDITIONAL_VERSION_TAG is provided ADDITIONAL_GHCR_IMAGE will be set
# example usage: adding latest tag
if [ -n "$ADDITIONAL_VERSION_TAG" ]; then
    ADDITIONAL_GHCR_IMAGE="${GHCR_USERNAME}/${GHCR_REPO}:${ADDITIONAL_VERSION_TAG}"
fi

echo "Environment: ${DEPLOY_ENV}"
echo "Using version tag: $VERSION_TAG"
echo "Docker repository: $GHCR_REPO"
echo "Metadata file: $METADATA_FILE"

# Get Git commit for build info
GIT_COMMIT=$(git rev-parse HEAD 2> /dev/null || echo "unknown")
echo "Git commit: $GIT_COMMIT"

if [ -n "$CHANGELOG_MD" ]; then
    echo "$CHANGELOG_MD" > resources/changelog.md
fi
if [ -n "$VERSION_TXT" ]; then
    echo "$VERSION_TXT" > resources/version.txt
fi

# Set up cache image reference
CACHE_IMAGE="${GHCR_USERNAME}/${GHCR_REPO}:latest"
BUILDCACHE_IMAGE="${GHCR_USERNAME}/${GHCR_REPO}:buildcache"

echo "Building with buildx and registry cache..."

# Create buildx builder with docker-container driver if it doesn't exist
if ! docker buildx inspect cache-builder > /dev/null 2>&1; then
    echo "Creating buildx builder..."
    docker buildx create --name cache-builder --driver docker-container --use
else
    echo "Using existing buildx builder..."
    docker buildx use cache-builder
fi

# Use buildx with registry cache for best performance
# --push will push all tags automatically
docker buildx build \
    --platform linux/amd64 \
    --metadata-file $METADATA_FILE \
    --build-arg GIT_COMMIT=$GIT_COMMIT \
    --cache-from type=registry,ref=$BUILDCACHE_IMAGE \
    --cache-to type=registry,ref=$BUILDCACHE_IMAGE,mode=max \
    --tag $GHCR_IMAGE \
    --tag $CACHE_IMAGE \
    ${ADDITIONAL_GHCR_IMAGE:+--tag "$ADDITIONAL_GHCR_IMAGE"} \
    --push \
    .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed."
    exit 1
fi

echo "✅ Docker image built and pushed successfully."
echo "Image: $GHCR_IMAGE"

print_header "BUILD COMPLETED SUCCESSFULLY ${GHCR_IMAGE}"
