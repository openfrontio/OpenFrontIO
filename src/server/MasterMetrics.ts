import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { HostMetrics } from "@opentelemetry/host-metrics";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as dotenv from "dotenv";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { getOtelResource } from "./OtelResource";

dotenv.config();

// Get server configuration
const config = getServerConfigFromServer();

// Create resource with master information
const resource = getOtelResource();

// Configure headers for basic auth if provided
const getAuthHeaders = () => {
  const headers = {};
  if (config.otelEnabled()) {
    headers["Authorization"] =
      "Basic " +
      Buffer.from(`${config.otelUsername()}:${config.otelPassword()}`).toString(
        "base64",
      );
  }
  return headers;
};

// Create metrics exporter
const metricExporter = new OTLPMetricExporter({
  // Dummy endpoint if OTEL is not enabled to avoid parsing errors
  url: `${config.otelEndpoint() || "https://dummy_endpoint.com"}/v1/metrics`,
  headers: getAuthHeaders(),
});

// Configure the metric reader
const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 15000, // Export metrics every 15 seconds
});

// Create a meter provider
const meterProvider = new MeterProvider({
  resource,
  readers: [metricReader],
});

// Setup host metrics
const hostMetrics = new HostMetrics({ meterProvider });

// Get meter for creating custom metrics
const meter = meterProvider.getMeter("master-metrics");

// Export the metrics for use in the master
export const setupMasterMetrics = () => {
  console.log("Starting host metrics collection for master...");

  // Start collecting host metrics
  hostMetrics.start();

  // Return the meter provider and meter for potential additional metrics
  return {
    meterProvider,
    meter,
  };
};
