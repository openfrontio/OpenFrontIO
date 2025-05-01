#!/bin/bash
# Comprehensive setup script for Hetzner server with Docker and user setup
# Exit on error
set -e

echo "====================================================="
echo "🚀 STARTING SERVER SETUP"
echo "====================================================="

echo "🔄 Updating system..."
apt update && apt upgrade -y

# Check if Docker is already installed
if command -v docker &> /dev/null; then
    echo "Docker is already installed"
else
    echo "🐳 Installing Docker..."
    # Install Docker using official script
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable --now docker
    echo "Docker installed successfully"
fi

echo "👤 Setting up openfront user..."
# Create openfront user if it doesn't exist
if id "openfront" &>/dev/null; then
    echo "User openfront already exists"
else
    useradd -m -s /bin/bash openfront
    echo "User openfront created"
fi

# Check if openfront is already in docker group
if groups openfront | grep -q '\bdocker\b'; then
    echo "User openfront is already in the docker group"
else
    # Add openfront to docker group
    usermod -aG docker openfront
    echo "Added openfront to docker group"
fi

# Create .ssh directory for openfront if it doesn't exist
if [ ! -d "/home/openfront/.ssh" ]; then
    mkdir -p /home/openfront/.ssh
    chmod 700 /home/openfront/.ssh
    echo "Created .ssh directory for openfront"
fi

# Copy SSH keys from root if they exist and haven't been copied yet
if [ -f /root/.ssh/authorized_keys ] && [ ! -f /home/openfront/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/openfront/.ssh/
    chmod 600 /home/openfront/.ssh/authorized_keys
    echo "SSH keys copied from root to openfront"
fi

# Configure UDP buffer sizes for Cloudflare Tunnel
# https://github.com/quic-go/quic-go/wiki/UDP-Buffer-Sizes
echo "🔧 Configuring UDP buffer sizes..."
# Check if settings already exist in sysctl.conf
if grep -q "net.core.rmem_max" /etc/sysctl.conf && grep -q "net.core.wmem_max" /etc/sysctl.conf; then
    echo "UDP buffer size settings already configured"
else
    # Add UDP buffer size settings to sysctl.conf
    echo "# UDP buffer size settings for improved QUIC performance" >> /etc/sysctl.conf
    echo "net.core.rmem_max=7500000" >> /etc/sysctl.conf
    echo "net.core.wmem_max=7500000" >> /etc/sysctl.conf
    
    # Apply the settings immediately
    sysctl -p
    echo "UDP buffer sizes configured and applied"
fi

# Check if node-exporter container already exists
if docker ps -a | grep -q "node-exporter"; then
    echo "Node Exporter is already installed"
else
    echo "🔄 Installing Node Exporter..."
    docker run -d --name node-exporter --restart=unless-stopped \
      --net="host" \
      --pid="host" \
      -v "/:/host:ro,rslave" \
      prom/node-exporter:latest \
      --path.rootfs=/host
    echo "Node Exporter installed successfully"
fi

# Set proper ownership for openfront's home directory
chown -R openfront:openfront /home/openfront
echo "Set proper ownership for openfront's home directory"

echo "====================================================="
echo "🎉 SETUP COMPLETE!"
echo "====================================================="
echo "The openfront user has been set up and has Docker permissions."
echo "UDP buffer sizes have been configured for optimal QUIC/WebSocket performance."
echo "You can now deploy using the openfront user."
echo "====================================================="