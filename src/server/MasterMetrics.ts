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

// Default Prometheus metrics
promClient.collectDefaultMetrics({ register });

// Prometheus metrics endpoint that gathers metrics from workers
export function setupMetricsServer() {
  metricsApp.get("/metrics", async (req, res) => {
    // Set a timeout for the request to avoid hanging
    const timeout = setTimeout(() => {
      res.status(500).end("# Error: Request timed out after 30 seconds");
    }, 30000);
    console.log("Metrics requested");
    try {
      // Get the master's metrics
      const masterMetrics = await register.metrics();

      // Track seen metric names to avoid duplicate metadata
      const seenMetrics = new Set();
      const processedLines = [];
      const allMetricValues = [];

      // Process all metadata information in the master metrics first
      const masterLines = masterMetrics.split("\n");

      for (let j = 0; j < masterLines.length; j++) {
        const line = masterLines[j];

        if (line.startsWith("# HELP ")) {
          const metricName = line.split(" ")[2];
          seenMetrics.add(metricName);
          processedLines.push(line);
        } else if (line.startsWith("# TYPE ")) {
          const metricName = line.split(" ")[2];
          if (seenMetrics.has(metricName)) {
            processedLines.push(line);
          }
        } else if (line.trim() && !line.startsWith("#")) {
          // Add worker label to each metric line and collect for later
          const processedLine = line.replace(
            /^([a-z][a-z0-9_]*)(?:{([^}]*)})?(\s+[0-9\.e+-]+.*)/,
            (match, metricName, existingLabels, valueAndRest) => {
              if (existingLabels) {
                return `${metricName}{${existingLabels},worker="master"}${valueAndRest}`;
              } else {
                return `${metricName}{worker="master"}${valueAndRest}`;
              }
            },
          );
          allMetricValues.push(processedLine);
        }
      }

      // Collect metrics from all workers
      for (let i = 0; i < config.numWorkers(); i++) {
        const workerPort = config.workerPortByIndex(i);
        const workerUrl = `http://localhost:${workerPort}/metrics`;
        console.log(`Fetching metrics from worker ${i} at ${workerUrl}`);

        try {
          const response = await fetch(workerUrl, {
            headers: {
              [config.adminHeader()]: config.adminToken(),
            },
          });

          if (!response.ok) {
            console.error(`Worker ${i} returned status ${response.status}`);
            continue;
          }

          const metricsText = await response.text();
          const lines = metricsText.split("\n");

          for (let j = 0; j < lines.length; j++) {
            const line = lines[j];

            // Collect HELP and TYPE info if we haven't seen this metric before
            if (line.startsWith("# HELP ")) {
              const metricName = line.split(" ")[2];
              if (!seenMetrics.has(metricName)) {
                seenMetrics.add(metricName);
                processedLines.push(line);
              }
            } else if (line.startsWith("# TYPE ")) {
              const metricName = line.split(" ")[2];
              if (
                seenMetrics.has(metricName) &&
                !processedLines.some((l) =>
                  l.startsWith(`# TYPE ${metricName}`),
                )
              ) {
                processedLines.push(line);
              }
            } else if (line.trim() && !line.startsWith("#")) {
              // Process and collect actual metric values
              try {
                const processedLine = line.replace(
                  /^([a-z][a-z0-9_]*)(?:{([^}]*)})?(\s+[0-9\.e+-]+.*)/,
                  (match, metricName, existingLabels, valueAndRest) => {
                    if (existingLabels) {
                      return `${metricName}{${existingLabels},worker="worker-${i}"}${valueAndRest}`;
                    } else {
                      return `${metricName}{worker="worker-${i}"}${valueAndRest}`;
                    }
                  },
                );

                // Make sure the line was actually processed (regex matched)
                if (processedLine !== line) {
                  allMetricValues.push(processedLine);
                } else if (
                  line.match(/^[a-z][a-z0-9_]*(?:{[^}]*})?\s+[0-9\.e+-]+.*/)
                ) {
                  // This looks like a metric line but didn't match our regex, try a more general approach
                  const parts = line.split(/({|\s+)/);
                  if (parts.length >= 3) {
                    const metricName = parts[0];
                    if (line.includes("{")) {
                      // Has labels
                      const labelEndIndex = line.indexOf("}");
                      const valueStartIndex = labelEndIndex + 1;
                      if (labelEndIndex > 0 && valueStartIndex < line.length) {
                        const labels = line.substring(
                          line.indexOf("{") + 1,
                          labelEndIndex,
                        );
                        const valueAndRest = line.substring(valueStartIndex);
                        allMetricValues.push(
                          `${metricName}{${labels},worker="worker-${i}"}${valueAndRest}`,
                        );
                      }
                    } else {
                      // No labels
                      const valueAndRest = line.substring(metricName.length);
                      allMetricValues.push(
                        `${metricName}{worker="worker-${i}"}${valueAndRest}`,
                      );
                    }
                  }
                }
              } catch (error) {
                console.error(`Error processing metric line: ${line}`, error);
                // Skip this line if there's an error
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching metrics from worker ${i}:`, error);
          allMetricValues.push(
            `# Error fetching metrics from worker ${i}: ${error.message}`,
          );
        }
      }

      // Combine metadata with all metric values and ensure it ends with a newline
      const combinedMetrics = [...processedLines, ...allMetricValues].join(
        "\n",
      );

      // Send the combined response with a final newline to prevent unexpected end of input
      clearTimeout(timeout);
      res.set("Content-Type", register.contentType);
      res.end(combinedMetrics + "\n");
    } catch (error) {
      console.error("Error collecting metrics:", error);
      clearTimeout(timeout);
      res.status(500).end(`# Error collecting metrics: ${error.message}`);
    }
  });

  // Start the metrics server on port 9090
  const METRICS_PORT = 9090;
  metricsServer.listen(METRICS_PORT, () => {
    console.log(`Metrics server listening on port ${METRICS_PORT}`);
  });
}
