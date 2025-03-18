import express from "express";
import http from "http";
import promClient from "prom-client";
import { getServerConfigFromServer } from "../core/configuration/Config";

const config = getServerConfigFromServer();

// Create a separate metrics server on port 9090
const metricsApp = express();
const metricsServer = http.createServer(metricsApp);

// Initialize the Prometheus registry for the master's own metrics
const register = new promClient.Registry();

// Prometheus metrics endpoint that gathers metrics from workers
export function setupMetricsServer() {
  metricsApp.get("/metrics", async (req, res) => {
    console.log("Metrics requested");
    try {
      // Get the master's metrics
      const masterMetrics = await register.metrics();

      // Collect metrics from all workers
      const workerMetricsPromises = [];

      // For each worker, fetch their metrics
      for (let i = 0; i < config.numWorkers(); i++) {
        const workerPort = config.workerPortByIndex(i);
        const workerUrl = `http://localhost:${workerPort}/metrics`;
        console.log(`Fetching metrics from worker ${i} at ${workerUrl}`);
        const workerMetricsPromise = fetch(workerUrl, {
          headers: {
            [config.adminHeader()]: config.adminToken(),
          },
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Worker ${i} returned status ${response.status}`);
            }
            return response.text();
          })
          .then((metricsText) => {
            // Add worker label to each metric line
            return metricsText.replace(
              /^([a-z][a-z0-9_]*(?:{[^}]*})?)\s/gm,
              `$1{worker="worker-${i}"} `,
            );
          })
          .catch((error) => {
            console.error(`Error fetching metrics from worker ${i}:`, error);
            return `# Error fetching metrics from worker ${i}: ${error.message}`;
          });
        workerMetricsPromises.push(workerMetricsPromise);
      }

      // Wait for all worker metrics to be fetched
      const workerMetricsArray = await Promise.all(workerMetricsPromises);

      // Add worker label to the master metrics
      const masterMetricsWithLabel = masterMetrics.replace(
        /^([a-z][a-z0-9_]*(?:{[^}]*})?)\s/gm,
        `$1{worker="master"} `,
      );

      // Combine all metrics and send the response
      res.set("Content-Type", register.contentType);
      res.end(`${masterMetricsWithLabel}\n${workerMetricsArray.join("\n")}`);
    } catch (error) {
      console.error("Error collecting metrics:", error);
      res.status(500).end(`# Error collecting metrics: ${error.message}`);
    }
  });

  // Start the metrics server on port 9090
  const METRICS_PORT = 9090;
  metricsServer.listen(METRICS_PORT, () => {
    console.log(`Metrics server listening on port ${METRICS_PORT}`);
  });
}
