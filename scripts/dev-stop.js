import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const clientPort = parseInt(process.env.OPENFRONT_CLIENT_PORT ?? "9000", 10);
const serverPort = parseInt(process.env.OPENFRONT_SERVER_PORT ?? "3000", 10);

const ports = [
  clientPort,
  serverPort,
  serverPort + 1,
  serverPort + 2,
  serverPort + 3,
];

const isWindows = process.platform === "win32";

function stopProcessesOnPorts(portList) {
  const stoppedPorts = [];

  for (const port of portList) {
    const portNum = String(port);
    try {
      if (isWindows) {
        // Windows: Use netstat to find PID, then taskkill
        const result = execSync(
          `netstat -ano | findstr :${portNum} | findstr LISTENING`,
          { encoding: "utf8", shell: true },
        );
        const lines = result.trim().split("\n");
        const pids = new Set();

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== "0") {
            pids.add(pid);
          }
        }

        let killedAny = false;
        for (const pid of pids) {
          try {
            execSync(`taskkill /PID ${pid} /F`, {
              stdio: "ignore",
              shell: true,
            });
            killedAny = true;
          } catch {
            // Process may have already exited
          }
        }
        if (killedAny) {
          stoppedPorts.push(portNum);
        }
      } else {
        // Unix: Use lsof to find PIDs, then kill if any found
        const pids = execSync(`lsof -ti :${portNum} 2>/dev/null || true`, {
          encoding: "utf8",
          shell: true,
        }).trim();

        if (pids) {
          execSync(`echo "${pids}" | xargs kill -9 2>/dev/null || true`, {
            stdio: "ignore",
            shell: true,
          });
          stoppedPorts.push(portNum);
        }
      }
    } catch {
      // No process on this port or command failed - ignore
    }
  }

  return stoppedPorts;
}

try {
  const stopped = stopProcessesOnPorts(ports);
  if (stopped.length > 0) {
    console.log(`Stopped processes on ports: ${stopped.join(", ")}`);
  } else {
    console.log(`No processes found on ports: ${ports.join(", ")}`);
  }
} catch {
  // Ignore errors - processes may not be running
}
