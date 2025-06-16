import cors from "cors";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";

const config = getServerConfigFromServer();
const origin = config.origin();

const allowedOriginsSet = new Set<string>([origin]);

switch (config.env()) {
  case GameEnv.Prod:
    allowedOriginsSet.add("capacitor://openfront.io");
    allowedOriginsSet.add("https://openfront.io");
    break;
  case GameEnv.Preprod:
    allowedOriginsSet.add("capacitor://openfront.dev");
    allowedOriginsSet.add("https://openfront.dev");
    break;
  case GameEnv.Dev: {
    allowedOriginsSet.add("capacitor://localhost");
    allowedOriginsSet.add("http://localhost");
    allowedOriginsSet.add("http://localhost:8787");
    break;
  }
}

const allowedOrigins = Array.from(allowedOriginsSet);

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some((o) => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export const corsMiddleware = cors(corsOptions);
