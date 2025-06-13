import cors from "cors";
import { getLocalIP } from "../../webpack.config";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";

const config = getServerConfigFromServer();
const origin = config.origin();

const allowedOrigins: string[] = [origin];

switch (config.env()) {
  case GameEnv.Prod:
    allowedOrigins.push("capacitor://openfront.io", "https://openfront.io");
    break;
  case GameEnv.Preprod:
    allowedOrigins.push("capacitor://openfront.dev", "https://openfront.dev");
    break;
  case GameEnv.Dev: {
    allowedOrigins.push(
      "capacitor://localhost",
      "http://localhost",
      "http://localhost:8787",
    );
    const localIp = getLocalIP();
    if (localIp) {
      allowedOrigins.push(`http://${localIp}:9000`);
    }
    break;
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
