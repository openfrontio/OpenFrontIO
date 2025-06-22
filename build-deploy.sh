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
echo "  ./deploy.sh [prod|staging] [eu|nbg1|staging|masters] [version_tag] [subdomain] [--enable_basic_auth]"
echo ""

# Check command line arguments
if [ $# -lt 2 ] || [ $# -gt 4 ]; then
    echo "Error: Please specify environment and host, with optional subdomain"
    echo "Usage: $0 [prod|staging] [eu|nbg1|staging|masters] [subdomain] [--enable_basic_auth]"
    exit 1
fi

# Validate first argument (environment)
if [ "$1" != "prod" ] && [ "$1" != "staging" ]; then
    echo "Error: First argument must be either 'prod' or 'staging'"
    echo "Usage: $0 [prod|staging] [eu|nbg1|staging|masters] [subdomain] [--enable_basic_auth]"
    exit 1
fi

# Validate second argument (host)
if [ "$2" != "eu" ] && [ "$2" != "nbg1" ] && [ "$2" != "staging" ] && [ "$2" != "masters" ]; then
    echo "Error: Second argument must be either 'eu', 'nbg1', 'staging', or 'masters'"
    echo "Usage: $0 [prod|staging] [eu|nbg1|staging|masters] [subdomain] [--enable_basic_auth]"
    exit 1
fi

# Generate version tag
VERSION_TAG=$(date +"%Y%m%d-%H%M%S")
echo "Generated version tag: $VERSION_TAG"

# Extract arguments
ENV="$1"
HOST="$2"
SUBDOMAIN=""
DEPLOY_ARGS=""
ENABLE_BASIC_AUTH=""

# Parse remaining arguments
shift 2
while [[ $# -gt 0 ]]; do
    case $1 in
        --enable_basic_auth)
            ENABLE_BASIC_AUTH="--enable_basic_auth"
            shift
            ;;
        *)
            if [ -z "$SUBDOMAIN" ]; then
                SUBDOMAIN=$1
            else
                echo "Error: Too many arguments"
                echo "Usage: $0 [prod|staging] [eu|nbg1|staging|masters] [subdomain] [--enable_basic_auth]"
                exit 1
            fi
            shift
            ;;
    esac
done

# Build arguments (only environment and version tag)
BUILD_ARGS="$ENV $VERSION_TAG"

# Deploy arguments (environment, host, version tag, subdomain, and flags)
DEPLOY_ARGS="$ENV $HOST $VERSION_TAG $SUBDOMAIN $ENABLE_BASIC_AUTH"

# Step 1: Run build.sh
echo "Step 1: Running build.sh..."
./build.sh "$ENV" "$VERSION_TAG"

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Stopping deployment."
    exit 1
fi

echo ""
echo "Step 2: Running deploy.sh $DEPLOY_ARGS"
./deploy.sh $DEPLOY_ARGS

if [ $? -ne 0 ]; then
    echo "❌ Deploy failed."
    exit 1
fi

print_header "BUILD AND DEPLOY COMPLETED SUCCESSFULLY"
echo "✅ Both build and deploy operations completed successfully!"
echo "Version tag used: $VERSION_TAG"
echo "======================================================="
