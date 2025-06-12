import cors from "cors";
import os from "os";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    const networkInterface = interfaces[interfaceName];
    if (!networkInterface) continue;
    for (const address of networkInterface) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return null;
}

const config = getServerConfigFromServer();
const origin = config.origin();

const allowedOrigins = [
  origin,
  "capacitor://openfront.io",
  "https://openfront.io",
];

if (config.env() === GameEnv.Dev) {
  const localIp = getLocalIP();
  if (localIp) {
    allowedOrigins.push(`http://${localIp}:9000`);
  }
}

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export const corsMiddleware = cors(corsOptions);
