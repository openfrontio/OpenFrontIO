#!/bin/bash

# OpenFront.io Demo Deployment Script
# This script builds and runs a local demo of OpenFront.io using Docker

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎮 OpenFront.io Demo Deployment${NC}"
echo -e "${BLUE}================================${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    echo -e "${YELLOW}Visit: https://docs.docker.com/get-docker/${NC}"
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not available. Please install Docker Compose.${NC}"
    exit 1
fi

# Get current git commit for build tracking
GIT_COMMIT=$(git rev-parse --short HEAD 2> /dev/null || echo "unknown")
export GIT_COMMIT

echo -e "${YELLOW}📋 Build Information:${NC}"
echo -e "   Git Commit: ${GIT_COMMIT}"
echo -e "   Build Date: $(date)"
echo ""

# Stop and remove existing demo container
echo -e "${YELLOW}🧹 Cleaning up existing demo...${NC}"
docker-compose -f docker-compose.demo.yml down --remove-orphans 2> /dev/null || true

# Build and start the demo
echo -e "${YELLOW}🔨 Building OpenFront.io demo...${NC}"
docker-compose -f docker-compose.demo.yml build --no-cache

echo -e "${YELLOW}🚀 Starting OpenFront.io demo...${NC}"
docker-compose -f docker-compose.demo.yml up -d

# Wait for the service to be ready
echo -e "${YELLOW}⏳ Waiting for service to be ready...${NC}"
sleep 10

# Check if the service is running
if curl -f http://localhost:8080 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Demo deployed successfully!${NC}"
    echo -e "${GREEN}🌐 Access your demo at: http://localhost:8080${NC}"
    echo ""
    echo -e "${BLUE}📊 Service Status:${NC}"
    docker-compose -f docker-compose.demo.yml ps
    echo ""
    echo -e "${BLUE}📝 Useful Commands:${NC}"
    echo -e "   View logs:           ${YELLOW}docker-compose -f docker-compose.demo.yml logs -f${NC}"
    echo -e "   Stop demo:           ${YELLOW}docker-compose -f docker-compose.demo.yml down${NC}"
    echo -e "   Restart demo:        ${YELLOW}docker-compose -f docker-compose.demo.yml restart${NC}"
    echo -e "   View service status: ${YELLOW}docker-compose -f docker-compose.demo.yml ps${NC}"
else
    echo -e "${RED}❌ Demo failed to start properly${NC}"
    echo -e "${YELLOW}📋 Container logs:${NC}"
    docker-compose -f docker-compose.demo.yml logs --tail=20
    exit 1
fi
