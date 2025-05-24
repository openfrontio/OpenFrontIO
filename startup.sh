#!/bin/bash
set -e

# Check if required environment variables are set
if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ACCOUNT_ID" ] || [ -z "$SUBDOMAIN" ] || [ -z "$DOMAIN" ]; then
    echo "Error: Required environment variables not set"
    echo "Please set CF_API_TOKEN, CF_ACCOUNT_ID, SUBDOMAIN, and DOMAIN"
    exit 1
fi

# Generate a unique tunnel name using timestamp
TIMESTAMP=$(date +%Y%m%d%H%M%S)
TUNNEL_NAME="${SUBDOMAIN}-tunnel-${TIMESTAMP}"
echo "Using unique tunnel name: ${TUNNEL_NAME}"

# Create a new tunnel
echo "Creating Cloudflare tunnel for subdomain ${SUBDOMAIN}..."
TUNNEL_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"name\":\"${TUNNEL_NAME}\"}")

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

# Update DNS record to point to the new tunnel
echo "Updating DNS record to point to the new tunnel..."

# First check if DNS record exists
DNS_RECORDS=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=${DOMAIN}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json")

ZONE_ID=$(echo $DNS_RECORDS | jq -r '.result[0].id')

if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" == "null" ]; then
    echo "Could not find zone ID for domain ${DOMAIN}"
    exit 1
fi

# Check for existing record
EXISTING_RECORDS=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${SUBDOMAIN}.${DOMAIN}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json")

RECORD_ID=$(echo $EXISTING_RECORDS | jq -r '.result[0].id')

# Create or update the DNS record
if [ -z "$RECORD_ID" ] || [ "$RECORD_ID" == "null" ]; then
    # Create new record
    echo "Creating new DNS record..."
    DNS_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"CNAME\",\"name\":\"${SUBDOMAIN}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"ttl\":1,\"proxied\":true}")
else
    # Update existing record
    echo "Updating existing DNS record..."
    DNS_RESPONSE=$(curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"CNAME\",\"name\":\"${SUBDOMAIN}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"ttl\":1,\"proxied\":true}")
fi

# Log the tunnel information
echo "Tunnel is set up! Site will be available at: https://${SUBDOMAIN}.${DOMAIN}"

# Export the tunnel token for supervisord
export CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}

# Check if Basic Auth credentials are set
if [ -z "$BASIC_AUTH_USER" ] || [ -z "$BASIC_AUTH_PASS" ]; then
    echo "HTTP Basic Authentication will be disabled"
else
    # Create the htpasswd file
    echo "Creating basic auth credentials for user: ${BASIC_AUTH_USER}"
    # Ensure apache2-utils is installed for htpasswd
    command -v htpasswd > /dev/null 2>&1 || {
        echo "htpasswd not found, installing apache2-utils..."
        apt-get update && apt-get install -y apache2-utils
    }
    # Create the password file
    htpasswd -bc /etc/nginx/.htpasswd ${BASIC_AUTH_USER} ${BASIC_AUTH_PASS}

    # Update Nginx configuration to enable Basic Auth
    sed -i '1i auth_basic "Restricted Access";' /etc/nginx/conf.d/default.conf
    sed -i '2i auth_basic_user_file /etc/nginx/.htpasswd;' /etc/nginx/conf.d/default.conf

    echo "HTTP Basic Authentication enabled for user: ${BASIC_AUTH_USER}"
fi

# Start supervisord
if [ "$DOMAIN" = openfront.dev ] && [ "$SUBDOMAIN" != main ]; then
    exec timeout 18h /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
else
    exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
