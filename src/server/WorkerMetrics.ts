import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as dotenv from "dotenv";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameManager } from "./GameManager";
import { getOtelResource, getPromLabels } from "./OtelResource";

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
    url: `${config.otelEndpoint()}/v1/metrics`,
    headers,
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
