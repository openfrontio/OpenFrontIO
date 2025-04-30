#!/bin/bash

# Metric Collector for Prometheus Pushgateway
# This script collects metrics from Node Exporter and application sources
# and pushes them to a Prometheus Pushgateway with custom labels.

# Configuration
NODE_EXPORTER_URL="http://localhost:9100/metrics"
APP_METRICS_URL="http://localhost:9090/metrics"
PUSHGATEWAY_BASE_URL="https://mon.openfront.io/pushgateway/metrics"
AUTH=$MON_USERNAME:$MON_PASSWORD
INTERVAL=15  # seconds

# Function to fetch metrics from Node Exporter
fetch_node_exporter_metrics() {
  curl -s --connect-timeout 5 --max-time 10 "$NODE_EXPORTER_URL" || 
    echo "# Error fetching Node Exporter metrics"
}

# Function to fetch metrics from your application
fetch_app_metrics() {
  curl -s --connect-timeout 5 --max-time 10 "$APP_METRICS_URL" || 
    echo "# Error fetching application metrics"
}

# Function to push metrics to Pushgateway
push_metrics() {
  local metrics=$1
  local job_name=$2
  
  echo "Pushing $job_name metrics to Pushgateway..."
  
  # Create a temporary file for the metrics
  TEMP_FILE=$(mktemp)
  echo "$metrics" > "$TEMP_FILE"
  
  # Push to Pushgateway with instance label
  curl -s -u "$AUTH" --data-binary @"$TEMP_FILE" \
    "$PUSHGATEWAY_BASE_URL/job/$job_name/instance/$HOSTNAME"
  
  # Check if push was successful
  if [ $? -eq 0 ]; then
    echo "$job_name metrics pushed successfully"
  else
    echo "Error pushing $job_name metrics"
  fi
  
  # Remove temporary file
  rm "$TEMP_FILE"
}

# Function to add labels to metrics
add_labels() {
  local metrics=$1
  
  # First, handle metrics with existing labels
  metrics=$(echo "$metrics" | sed -E 's/(\{[^}]*)\}/\1,env="'$ENV'",host="'$HOST'",subdomain="'$SUBDOMAIN'"}/g')
  
  # Then, handle metrics with no existing labels
  metrics=$(echo "$metrics" | sed -E 's/^([a-zA-Z0-9_:]+)[ \t]+([0-9.e+-]+)$/\1{env="'$ENV'",host="'$HOST'",subdomain="'$SUBDOMAIN'"} \2/g')
  
  echo "$metrics"
}

# Main function to collect and push metrics
collect_and_push_metrics() {
  echo "Starting metrics collection cycle at $(date)"
  
  # Get metrics from both sources
  NODE_METRICS=$(fetch_node_exporter_metrics)
  APP_METRICS=$(fetch_app_metrics)
  
  # Clean up metrics (remove headers etc.)
  NODE_METRICS=$(echo "$NODE_METRICS" | grep -v "^Fetching")
  APP_METRICS=$(echo "$APP_METRICS" | grep -v "^Fetching")
  
  # Add labels to metrics
  NODE_METRICS=$(add_labels "$NODE_METRICS")
  APP_METRICS=$(add_labels "$APP_METRICS")
  
  # Push to Pushgateway separately
  push_metrics "$NODE_METRICS" "node_exporter"
  push_metrics "$APP_METRICS" "app_metrics"
  
  echo "Metrics collection cycle completed at $(date)"
}

# Main execution
echo "===== Starting metrics collector ====="
echo "Environment: $ENV, HOST: $HOST, Subdomain: $SUBDOMAIN"
echo "Collecting and pushing metrics every $INTERVAL seconds"
echo "Node Exporter URL: $NODE_EXPORTER_URL"
echo "App Metrics URL: $APP_METRICS_URL"
echo "Pushgateway URL: $PUSHGATEWAY_BASE_URL"

# Wait for app to be ready.
sleep 30

# Then set up interval loop
while true; do
  sleep $INTERVAL
  collect_and_push_metrics
done