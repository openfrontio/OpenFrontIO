import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as dotenv from "dotenv";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameManager } from "./GameManager";
import { getOtelResource } from "./OtelResource";

dotenv.config();

// Get server configuration
const config = getServerConfigFromServer();

// Create resource with worker information
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

// Get meter for creating metrics
const meter = meterProvider.getMeter("worker-metrics");

// Create OpenTelemetry metrics
const activeGamesCounter = meter.createUpDownCounter(
  "openfront.active_games.count",
  {
    description: "Number of active games on this worker",
  },
);

const connectedClientsCounter = meter.createUpDownCounter(
  "openfront.connected_clients.count",
  {
    description: "Number of connected clients on this worker",
  },
);

const memoryUsageObservable = meter.createObservableGauge(
  "openfront.memory_usage.bytes",
  {
    description: "Current memory usage of the worker process in bytes",
  },
);

// Register callback for the memory usage observable
memoryUsageObservable.addCallback((result) => {
  const memoryUsage = process.memoryUsage();
  result.observe(memoryUsage.heapUsed);
});

// Export the metrics for use in the worker
export const metrics = {
  // Function to update game-related metrics
  updateGameMetrics: (gameManager: GameManager) => {
    console.log("Updating game metrics");
    // Get the current counts
    const currentActiveGames = gameManager.activeGames();
    const currentActiveClients = gameManager.activeClients();

    // Set the absolute values (createUpDownCounter allows setting absolute values)
    activeGamesCounter.add(currentActiveGames);
    connectedClientsCounter.add(currentActiveClients);

    // Memory metrics are automatically collected by the observable
  },

  // Expose the meter provider for potential additional metrics
  meterProvider,

  // Expose the meter for creating additional metrics
  meter,
};
