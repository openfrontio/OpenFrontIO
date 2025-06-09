import cors from "cors";
import os from "os";

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

const allowedOrigins = [
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
  "http://localhost:9000",
  "https://openfront.io",
  "https://openfront.dev",
];

const localIp = getLocalIP();
if (localIp) {
  allowedOrigins.push(`http://${localIp}:9000`);
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
