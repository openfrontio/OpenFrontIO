import * as dotenv from "dotenv";
import { startWorker } from "./Worker";

dotenv.config();

startWorker().catch((error) => {
  console.error("Failed to start worker process:", error);
  process.exit(1);
});
