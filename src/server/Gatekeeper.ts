// src/server/Security.ts
import { NextFunction, Request, Response } from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

export enum LimiterType {
  Get = "get",
  Post = "post",
  Put = "put",
  WebSocket = "websocket",
}

export interface Gatekeeper {
  // The wrapper for request handlers with optional rate limiting
  httpHandler: (
    limiterType: LimiterType,
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

  // The wrapper for WebSocket message handlers with rate limiting
  wsHandler: (
    req: http.IncomingMessage | string,
    fn: (message: string) => Promise<void>,
  ) => (message: string) => Promise<void>;
}

let gk: Gatekeeper | null = null;

async function getGatekeeperCached(): Promise<Gatekeeper> {
  if (gk !== null) {
    return gk;
  }
  return getGatekeeper().then((g) => {
    gk = g;
    return gk;
  });
}

// Function to get the appropriate security middleware implementation
async function getGatekeeper(): Promise<Gatekeeper> {
  try {
    // Get the current file's directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    try {
      // Check if the file exists before attempting to import it
      const realMiddlewarePath = path.resolve(
        __dirname,
        "./gatekeeper/RealGatekeeper.js",
      );
      const tsMiddlewarePath = path.resolve(
        __dirname,
        "./gatekeeper/RealGatekeeper.ts",
      );

      if (
        !fs.existsSync(realMiddlewarePath) &&
        !fs.existsSync(tsMiddlewarePath)
      ) {
        console.log("RealGatekeeper file not found, using NoOpGatekeeper");
        return new NoOpGatekeeper();
      }

      // Use dynamic import for ES modules
      // Using a type assertion to avoid TypeScript errors for optional modules
      const module = await import(
        "./gatekeeper/RealGatekeeper.js" as string
      ).catch(() => import("./gatekeeper/RealGatekeeper.js" as string));

      if (!module || !module.RealGatekeeper) {
        console.log(
          "RealGatekeeper class not found in module, using NoOpGatekeeper",
        );
        return new NoOpGatekeeper();
      }

      console.log("Successfully loaded real gatekeeper");
      return new module.RealGatekeeper();
    } catch (error) {
      console.log("Failed to load real gatekeeper:", error);
      return new NoOpGatekeeper();
    }
  } catch (e) {
    // Fall back to no-op if real implementation isn't available
    console.log("using no-op gatekeeper", e);
    return new NoOpGatekeeper();
  }
}

export class GatekeeperWrapper implements Gatekeeper {
  constructor(private getGK: () => Promise<Gatekeeper>) {}

  httpHandler(
    limiterType: LimiterType,
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const gk = await this.getGK();
        const handler = gk.httpHandler(limiterType, fn);
        return handler(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  // Corrected implementation for WebSocket handler wrapper
  wsHandler(
    req: http.IncomingMessage | string,
    fn: (message: string) => Promise<void>,
  ) {
    return async (message: string) => {
      try {
        const gk = await this.getGK();
        const handler = gk.wsHandler(req, fn);
        return handler(message);
      } catch (error) {
        console.error("WebSocket handler error:", error);
      }
    };
  }
}

export class NoOpGatekeeper implements Gatekeeper {
  // Simple pass-through with no rate limiting
  httpHandler(
    limiterType: LimiterType,
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await fn(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  // Corrected implementation for WebSocket handler wrapper
  wsHandler(
    req: http.IncomingMessage | string,
    fn: (message: string) => Promise<void>,
  ) {
    return async (message: string) => {
      try {
        await fn(message);
      } catch (error) {
        console.error("WebSocket handler error:", error);
      }
    };
  }
}

export const gatekeeper: Gatekeeper = new GatekeeperWrapper(() =>
  getGatekeeperCached(),
);
