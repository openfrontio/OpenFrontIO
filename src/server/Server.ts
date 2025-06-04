import cluster from "cluster";
import * as dotenv from "dotenv";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { Cloudflare, TunnelConfig } from "./Cloudflare";
import { logger } from "./Logger";
import { startMaster } from "./Master";
import { startWorker } from "./Worker";

const log = logger.child({
  comp: "startup",
});

const config = getServerConfigFromServer();

dotenv.config();

// Main entry point of the application
async function main() {
  if (cluster.isPrimary) {
    console.log("Starting master process...");
    await startMaster();
    if (config.env() !== GameEnv.Dev) {
      await setupTunnels();
    }
    await startWorkers();
  } else {
    console.log(`Starting worker process ${process.env.WORKER_ID}...`);
    startWorker();
  }
}

// Start the application
main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

async function setupTunnels() {
  const cloudflare = new Cloudflare(
    config.cloudflareAccountId(),
    config.cloudflareApiToken(),
  );

  const domainToService = new Map<string, string>().set(
    config.subdomain(),
    `http://localhost:3000`,
  );

  for (let i = 0; i < config.numWorkers(); i++) {
    domainToService.set(
      `w${i}-${config.subdomain()}`,
      `http://localhost:${3000 + i + 1}`,
    );
  }

  const tunnel = await cloudflare.createTunnel({
    subdomain: config.subdomain(),
    domain: config.domain(),
    subdomainToService: domainToService,
  } as TunnelConfig);

  await cloudflare.startCloudflared(tunnel.tunnelToken);
}

// Start the master process
export async function startWorkers() {
  const readyWorkers = new Set();

  log.info(`Primary ${process.pid} is running`);
  log.info(`Setting up ${config.numWorkers()} workers...`);

  // Fork workers
  for (let i = 0; i < config.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
    });

    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  cluster.on("message", (worker, message) => {
    if (message.type === "WORKER_READY") {
      const workerId = message.workerId;
      readyWorkers.add(workerId);
      log.info(
        `Worker ${workerId} is ready. (${readyWorkers.size}/${config.numWorkers()} ready)`,
      );
      // Start scheduling when all workers are ready
      if (readyWorkers.size === config.numWorkers()) {
        log.info("All workers ready, starting game scheduling");
      }
    }
  });

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (!workerId) {
      log.error(`worker crashed could not find id`);
      return;
    }

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
    });

    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });
}
