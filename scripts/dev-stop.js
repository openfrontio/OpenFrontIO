import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const clientPort = process.env.OPENFRONT_CLIENT_PORT || "9000";
const serverPort = parseInt(process.env.OPENFRONT_SERVER_PORT || "3000", 10);

const ports = [
  clientPort,
  serverPort,
  serverPort + 1,
  serverPort + 2,
  serverPort + 3,
];

const portArgs = ports.map((p) => `-ti :${p}`).join(" ");

try {
  execSync(`lsof ${portArgs} | xargs kill -9 2>/dev/null || true`, {
    stdio: "inherit",
    shell: true,
  });
  console.log(`Stopped processes on ports: ${ports.join(", ")}`);
} catch {
  // Ignore errors - processes may not be running
}
