#!/bin/bash

# Quick Docker Demo Build Script
# This script builds the OpenFront.io demo without Docker Compose

set -e

echo "🎮 Building OpenFront.io Docker Demo"
echo "==================================="

# Get current git commit for build tracking
GIT_COMMIT=$(git rev-parse --short HEAD 2> /dev/null || echo "unknown")

echo "Building with commit: $GIT_COMMIT"

# Build the Docker image
docker build --build-arg GIT_COMMIT=$GIT_COMMIT -t openfront-demo .

echo "✅ Build complete!"
echo ""
echo "🚀 To run the demo:"
echo "   docker run -p 8080:80 openfront-demo"
echo ""
echo "🌐 Then access: http://localhost:8080"
