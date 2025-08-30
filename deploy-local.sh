#!/bin/bash

# OpenFront.io Local Docker Deployment
# Simplified setup without nginx or cloudflare

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎮 OpenFront.io Local Deployment${NC}"
echo -e "${BLUE}==================================${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    echo -e "${YELLOW}Visit: https://docs.docker.com/get-docker/${NC}"
    exit 1
fi

# Get current git commit for build tracking
GIT_COMMIT=$(git rev-parse --short HEAD 2> /dev/null || echo "local")
export GIT_COMMIT

echo -e "${YELLOW}📋 Build Information:${NC}"
echo -e "   Git Commit: ${GIT_COMMIT}"
echo -e "   Build Date: $(date)"
echo -e "   No nginx or cloudflare dependencies"
echo ""

# Stop and remove existing container
echo -e "${YELLOW}🧹 Cleaning up existing local deployment...${NC}"
docker-compose -f docker-compose.local.yml down --remove-orphans 2> /dev/null || true

# Build and start the local deployment
echo -e "${YELLOW}🔨 Building OpenFront.io local...${NC}"
docker-compose -f docker-compose.local.yml build --no-cache

echo -e "${YELLOW}🚀 Starting OpenFront.io local...${NC}"
docker-compose -f docker-compose.local.yml up -d

# Wait for the service to be ready
echo -e "${YELLOW}⏳ Waiting for service to be ready...${NC}"
sleep 15

# Check if the service is running
if curl -f http://localhost:3000/api/env > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Local deployment successful!${NC}"
    echo -e "${GREEN}🌐 Access your application at: http://localhost:3000${NC}"
    echo ""
    echo -e "${BLUE}📊 Service Status:${NC}"
    docker-compose -f docker-compose.local.yml ps
    echo ""
    echo -e "${BLUE}📝 Useful Commands:${NC}"
    echo -e "   View logs:           ${YELLOW}docker-compose -f docker-compose.local.yml logs -f${NC}"
    echo -e "   Stop deployment:     ${YELLOW}docker-compose -f docker-compose.local.yml down${NC}"
    echo -e "   Restart deployment:  ${YELLOW}docker-compose -f docker-compose.local.yml restart${NC}"
    echo -e "   View service status: ${YELLOW}docker-compose -f docker-compose.local.yml ps${NC}"
    echo ""
    echo -e "${BLUE}💡 Note: This runs directly on Node.js without nginx proxy${NC}"
else
    echo -e "${RED}❌ Local deployment failed to start properly${NC}"
    echo -e "${YELLOW}📋 Container logs:${NC}"
    docker-compose -f docker-compose.local.yml logs --tail=20
    exit 1
fi
