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

echo "☁️ Installing AWS CLI for Cloudflare R2..."
# Install AWS CLI
apt install -y unzip curl
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
./aws/install
rm -rf aws awscliv2.zip

# Configure AWS CLI for R2
echo "🔧 Configuring AWS CLI for Cloudflare R2..."
echo "Enter your Cloudflare R2 Access Key ID:"
read R2_ACCESS_KEY
echo "Enter your Cloudflare R2 Secret Access Key:"
read -s R2_SECRET_KEY
echo "Enter your Cloudflare Account ID:"
read CLOUDFLARE_ACCOUNT_ID

# Create R2 profile configuration
mkdir -p ~/.aws
cat > ~/.aws/credentials << EOL
[r2]
aws_access_key_id = $R2_ACCESS_KEY
aws_secret_access_key = $R2_SECRET_KEY
EOL

cat > ~/.aws/config << EOL
[profile r2]
region = auto
endpoint_url = https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com
EOL

echo "✅ R2 configuration complete"

echo "🎉 Setup complete! You can find helpful Docker and R2 commands in ~/docker-commands.sh"
echo "Test your R2 connection: aws s3 ls --profile r2"