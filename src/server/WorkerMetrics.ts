import * as dotenv from "dotenv";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { getOtelResource, getPromLabels } from "./OtelResource";
import { GameManager } from "./GameManager";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";

dotenv.config();

export function initWorkerMetrics(gameManager: GameManager): void {
  // Get server configuration
  const config = getServerConfigFromServer();

  // Create resource with worker information
  const resource = getOtelResource();

  // Configure auth headers
  const headers: Record<string, string> = {};
  if (config.otelEnabled()) {
    headers["Authorization"] = config.otelAuthHeader();
  }

  // Create metrics exporter
  const metricExporter = new OTLPMetricExporter({
    headers,
    url: `${config.otelEndpoint()}/v1/metrics`,
  });

  // Configure the metric reader
  const metricReader = new PeriodicExportingMetricReader({
    exportIntervalMillis: 15000, // Export metrics every 15 seconds
    exporter: metricExporter,
  });

  // Create a meter provider
  const meterProvider = new MeterProvider({
    readers: [metricReader],
    resource,
  });

  // Get meter for creating metrics
  const meter = meterProvider.getMeter("worker-metrics");

  // Create observable gauges
  const activeGamesGauge = meter.createObservableGauge(
    "openfront.active_games.gauge",
    {
      description: "Number of active games on this worker",
    },
  );

  const connectedClientsGauge = meter.createObservableGauge(
    "openfront.connected_clients.gauge",
    {
      description: "Number of connected clients on this worker",
    },
  );

  const memoryUsageGauge = meter.createObservableGauge(
    "openfront.memory_usage.bytes",
    {
      description: "Current memory usage of the worker process in bytes",
    },
  );

  // Register callback for active games metric
  activeGamesGauge.addCallback((result) => {
    const count = gameManager.activeGames();
    result.observe(count, getPromLabels());
  });

  // Register callback for connected clients metric
  connectedClientsGauge.addCallback((result) => {
    const count = gameManager.activeClients();
    result.observe(count, getPromLabels());
  });

  // Register callback for memory usage metric
  memoryUsageGauge.addCallback((result) => {
    const memoryUsage = process.memoryUsage();
    result.observe(memoryUsage.heapUsed, getPromLabels());
  });

  console.log("Metrics initialized with GameManager");
}
