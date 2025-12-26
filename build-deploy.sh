#!/bin/bash
# build-deploy.sh - Wrapper script that runs build.sh and deploy.sh in sequence
# This script maintains backward compatibility with the original build-deploy.sh

set -e # Exit immediately if a command exits with a non-zero status

# Function to print section headers
print_header() {
    echo "======================================================"
    echo "🚀 $1"
    echo "======================================================"
}

print_header "BUILD AND DEPLOY WRAPPER"
echo "This script will run build.sh and deploy.sh in sequence."
echo "You can also run them separately:"
echo "  ./build.sh [prod|staging] [version_tag]"
echo "  ./deploy.sh [prod|staging] [falk1|nbg1|staging|masters] [version_tag] [subdomain]"
echo ""

# Check command line arguments
if [ $# -lt 3 ] || [ $# -gt 5 ]; then
    echo "Error: Please specify environment, host, and subdomain"
    echo "Usage: $0 [prod|staging] [falk1|nbg1|staging|masters] [subdomain]"
    exit 1
fi

# Validate first argument (environment)
if [ "$1" != "prod" ] && [ "$1" != "staging" ]; then
    echo "Error: First argument must be either 'prod' or 'staging'"
    echo "Usage: $0 [prod|staging] [falk1|nbg1|staging|masters] [subdomain]"
    exit 1
fi

# Validate second argument (host)
if [ "$2" != "falk1" ] && [ "$2" != "nbg1" ] && [ "$2" != "staging" ] && [ "$2" != "masters" ]; then
    echo "Error: Second argument must be either 'falk1', 'nbg1', 'staging', or 'masters'"
    echo "Usage: $0 [prod|staging] [falk1|nbg1|staging|masters] [subdomain]"
    exit 1
fi

# Validate third argument (subdomain)
if [ -z "$3" ]; then
    echo "Error: Subdomain is required"
    echo "Usage: $0 [prod|staging] [falk1|nbg1|staging|masters] [subdomain]"
    exit 1
fi

# Generate version tag
VERSION_TAG=$(date +"%Y%m%d-%H%M%S")
echo "Generated version tag: $VERSION_TAG"

# Extract arguments
ENV="$1"
HOST="$2"
SUBDOMAIN="$3"

# Step 1: Run build.sh
echo "Step 1: Running build.sh..."
./build.sh "$ENV" "$VERSION_TAG"

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Stopping deployment."
    exit 1
fi

echo ""
echo "Step 2: Running deploy.sh"
./deploy.sh "$ENV" "$HOST" "$VERSION_TAG" "$SUBDOMAIN"

if [ $? -ne 0 ]; then
    echo "❌ Deploy failed."
    exit 1
fi

print_header "BUILD AND DEPLOY COMPLETED SUCCESSFULLY"
echo "✅ Both build and deploy operations completed successfully!"
echo "Version tag used: $VERSION_TAG"
echo "======================================================="
