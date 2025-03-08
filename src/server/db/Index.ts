import dotenv from "dotenv";
import { Pool, PoolClient } from "pg";
import { schemas } from "./Schema";
dotenv.config();

// Environment variable interface for type safety
interface DBConfig {
  user: string;
  host: string;
  database: string;
  password: string;
  port: number;
  ssl?: {
    rejectUnauthorized: boolean;
  };
}

// Create the config from environment variables
const createDBConfig = (): DBConfig => {
  const config: DBConfig = {
    user: process.env.DB_USER || "",
    host: process.env.DB_HOST || "",
    database: process.env.DB_NAME || "",
    password: process.env.DB_PASSWORD || "",
    port: parseInt(process.env.DB_PORT || "5432"),
  };

  // Add SSL if enabled
  if (process.env.DB_SSL === "true") {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
};

const pool = new Pool(createDBConfig());

// Error handling for the pool
pool.on("error", (err: Error) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

// Initialize database
export const initDB = async (): Promise<void> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    console.log("Connected to database, initializing schemas...");

    // Execute all schema creation queries
    await client.query(schemas.playerSessions);

    console.log("Database initialization completed");
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Helper function to get a client from the pool
export const getClient = async (): Promise<PoolClient> => {
  const client = await pool.connect();
  return client;
};

// Query helper with automatic client release
export const query = async (text: string, params?: any[]) => {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
};

// Transaction helper
export const transaction = async <T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Health check function
export const checkConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Database connection check failed:", error);
    return false;
  }
};

// Clean up function for graceful shutdown
export const closePool = async (): Promise<void> => {
  await pool.end();
};

export default pool;
