import { GameEnv } from "../core/configuration/Config";

export class OriginValidator {
  /**
   * Validates if the origin is allowed based on the environment
   */
  static isOriginAllowed(origin: string | undefined, env: GameEnv): boolean {
    // Skip validation in dev environment
    if (env === GameEnv.Dev) {
      return true;
    }

    if (!origin) {
      return false;
    }

    try {
      const url = new URL(origin);
      const hostname = url.hostname;

      switch (env) {
        case GameEnv.Preprod:
          // Allow *.openfront.dev
          return hostname.endsWith(".openfront.dev");

        case GameEnv.Prod:
          // Allow openfront.io and *.openfront.io
          return (
            hostname === "openfront.io" || hostname.endsWith(".openfront.io")
          );

        default:
          return false;
      }
    } catch {
      // Invalid URL format
      return false;
    }
  }
}
