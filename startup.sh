#!/bin/bash
set -e

# Check if required environment variables are set
if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ACCOUNT_ID" ] || [ -z "$SUBDOMAIN" ] || [ -z "$DOMAIN" ]; then
  echo "Error: Required environment variables not set"
  echo "Please set CF_API_TOKEN, CF_ACCOUNT_ID, SUBDOMAIN, and DOMAIN"
  exit 1
fi

# Create a new tunnel
echo "Creating Cloudflare tunnel for subdomain ${SUBDOMAIN}..."
TUNNEL_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"${SUBDOMAIN}-tunnel\"}")

# Extract tunnel ID and token
TUNNEL_ID=$(echo $TUNNEL_RESPONSE | jq -r '.result.id')
TUNNEL_TOKEN=$(echo $TUNNEL_RESPONSE | jq -r '.result.token')

if [ -z "$TUNNEL_ID" ] || [ "$TUNNEL_ID" == "null" ]; then
  echo "Failed to create tunnel"
  echo $TUNNEL_RESPONSE
  exit 1
fi

echo "Tunnel created with ID: ${TUNNEL_ID}"

# Configure the tunnel with hostname
echo "Configuring tunnel to point to ${SUBDOMAIN}.${DOMAIN}..."
curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"config\":{\"ingress\":[{\"hostname\":\"${SUBDOMAIN}.${DOMAIN}\",\"service\":\"http://localhost:80\"},{\"service\":\"http_status:404\"}]}}"

# Export the tunnel token for supervisord
echo "CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}" > /etc/supervisor/conf.d/cloudflared_env.conf

# Log the tunnel information
echo "Tunnel is set up! Site will be available at: https://${SUBDOMAIN}.${DOMAIN}"

# Start supervisord
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf