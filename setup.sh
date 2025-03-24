#!/bin/bash
# Comprehensive setup script for Hetzner server with Docker and Cloudflare R2 configuration

# Exit on error
set -e

echo "🔄 Updating system..."
apt update && apt upgrade -y

echo "🐳 Installing Docker..."
# Install Docker using official script
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl enable --now docker

# Set up Docker Hub credentials
echo "🔐 Setting up Docker Hub login..."
echo "Enter your Docker Hub username:"
read DOCKER_USERNAME
echo "Enter your Docker Hub password/token:"
read -s DOCKER_PASSWORD
echo $DOCKER_PASSWORD | docker login -u $DOCKER_USERNAME --password-stdin
echo "✅ Docker Hub login configured"

echo "🔄 Installing Node Exporter..."

docker run -d --name node-exporter --restart=unless-stopped \
  --net="host" \
  --pid="host" \
  -v "/:/host:ro,rslave" \
  prom/node-exporter:latest \
  --path.rootfs=/host

echo "node-exporter installed"

echo "🎉 Setup complete! You can find helpful Docker and R2 commands in ~/docker-commands.sh"
echo "Test your R2 connection: aws s3 ls --profile r2"