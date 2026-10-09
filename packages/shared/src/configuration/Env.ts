import { AssetManifest } from "@openfront/shared/AssetPaths";
import { z } from "zod";
import { ClusterConfig } from "../ClusterConfig";

declare global {
  interface Window {
    // Values the page carries into the bundle. Every field is optional to
    // TypeScript because the page is data, not code; ClientEnv.get() decides
    // which are actually required. Only gitCommit, gameEnv, turnstileSiteKey
    // and jwtAudience are: they describe the ENVIRONMENT, and are identical
    // for every player on a site. Everything below them names a SERVER, and
    // a static page (docs/MultiServer.md, "Server list v2") carries none of
    // it — the API's list answers instead.
    BOOTSTRAP_CONFIG?: {
      gitCommit?: string;
      assetManifest?: AssetManifest;
      cdnBase?: string;
      gameEnv?: string;
      // The fleet map + which entry served this page (docs/MultiServer.md).
      // Absent on a static page.
      cluster?: ClusterConfig;
      instanceLetter?: string;
      // Legacy scalar, still injected by desktop shells that predate the
      // cluster map. Web shells send cluster/instanceLetter instead; a static
      // page sends neither.
      numWorkers?: number;
      turnstileSiteKey?: string;
      jwtAudience?: string;
      // Environment-scoped like turnstileSiteKey, but optional: a deployment
      // without one (dev, desktop shells) just keeps the inline Stripe flow
      // off.
      stripePublishableKey?: string;
      // Environment-scoped and optional like stripePublishableKey: the
      // Grafana Faro collector URL. Absent keeps client telemetry off.
      faroCollectorUrl?: string;
      // The rendering server's own id. Absent on a static page, which no
      // server rendered; ClientEnv.instanceId() then answers "".
      instanceId?: string;
      // Desktop-only: explicit game-server host for the WebSocket origin.
      // Absent on the web build (client falls back to same-origin location).
      serverHost?: string;
      // The load-balancer apex this deployment sits behind; absent for
      // standalone deployments (beta, branch previews, dev), desktop, and
      // static pages.
      siteHost?: string;
    };
  }
}

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export function parseGameEnv(value: string | undefined): GameEnv {
  switch (value) {
    case "dev":
      return GameEnv.Dev;
    case "staging":
      return GameEnv.Preprod;
    case "prod":
      return GameEnv.Prod;
    default:
      throw new Error(`unsupported game env: ${value}`);
  }
}

export const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});
